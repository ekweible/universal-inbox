//! Gmail counts requests even when a full inbox sync has not committed yet.
//! Pace all clients created by a service and retry quota failures in place.
use std::{sync::Arc, time::Duration};

use async_trait::async_trait;
use http::Extensions;
use reqwest_middleware::{
    Middleware, Next, Result,
    reqwest::{Request, Response, StatusCode},
};
use serde_json::Value;
use tokio::{
    sync::Mutex,
    time::{Instant, sleep_until},
};

use super::api::ApiClientError;

#[derive(Clone)]
pub struct GmailQuota {
    next_request: Arc<Mutex<Instant>>,
    interval: Duration,
    retry_delay: Duration,
    max_retry_duration: Duration,
}

impl GmailQuota {
    pub fn new(max_retry_duration: Duration) -> Self {
        Self {
            next_request: Arc::new(Mutex::new(Instant::now())),
            // threads.get costs 40 units under the current Gmail quota model.
            // 60 requests/minute leaves room below the 6,000 units/user/minute
            // limit, including the separate HTTP and worker service instances.
            interval: Duration::from_secs(1),
            retry_delay: Duration::from_secs(2),
            max_retry_duration,
        }
    }

    async fn wait(&self) {
        let mut next = self.next_request.lock().await;
        sleep_until(*next).await;
        // Schedule from actual dispatch time: no catch-up burst after a delay.
        *next = Instant::now() + self.interval;
    }
}

fn is_quota_error(body: &[u8]) -> bool {
    let Ok(value) = serde_json::from_slice::<Value>(body) else {
        return false;
    };
    let error = &value["error"];
    error["errors"].as_array().is_some_and(|errors| {
        errors.iter().any(|e| {
            matches!(
                e["reason"].as_str(),
                Some("rateLimitExceeded" | "userRateLimitExceeded")
            )
        })
    }) || error["details"].as_array().is_some_and(|details| {
        details
            .iter()
            .any(|e| e["reason"].as_str() == Some("RATE_LIMIT_EXCEEDED"))
    })
}

fn retry_after(response: &Response) -> Option<Duration> {
    let value = response.headers().get("retry-after")?.to_str().ok()?;
    if let Ok(seconds) = value.parse::<u64>() {
        return Some(Duration::from_secs(seconds));
    }
    let date = chrono::DateTime::parse_from_rfc2822(value).ok()?;
    (date.with_timezone(&chrono::Utc) - chrono::Utc::now())
        .to_std()
        .ok()
}

#[async_trait]
impl Middleware for GmailQuota {
    async fn handle(
        &self,
        request: Request,
        extensions: &mut Extensions,
        next: Next<'_>,
    ) -> Result<Response> {
        let deadline = Instant::now() + self.max_retry_duration;
        let mut delay = self.retry_delay;
        loop {
            self.wait().await;
            let cloned = request.try_clone().ok_or_else(|| {
                reqwest_middleware::Error::Middleware(anyhow::anyhow!(
                    "Gmail request body cannot be retried"
                ))
            })?;
            let response = next.clone().run(cloned, extensions).await?;
            let status = response.status();
            if status != StatusCode::FORBIDDEN && status != StatusCode::TOO_MANY_REQUESTS {
                return Ok(response);
            }
            let requested_delay = retry_after(&response);
            if status == StatusCode::FORBIDDEN {
                let error = response.error_for_status_ref().unwrap_err();
                if !is_quota_error(&response.bytes().await?) {
                    // Never turn missing scopes, disabled APIs, or access denials
                    // into long-running quota retries. Do not log response bodies.
                    return Err(error.into());
                }
            }
            let wait = requested_delay.unwrap_or_default().max(delay);
            if Instant::now() + wait >= deadline {
                return Err(reqwest_middleware::Error::Middleware(
                    ApiClientError::rate_limit_error(
                        "Gmail quota retry budget exhausted; sync will retry later".to_string(),
                    )
                    .into(),
                ));
            }
            tracing::warn!(
                retry_in_seconds = wait.as_secs(),
                "Gmail quota reached; retrying the same request"
            );
            // Share cooldown with other requests through this service as well.
            {
                let mut next_request = self.next_request.lock().await;
                *next_request = (*next_request).max(Instant::now() + wait);
            }
            delay = (delay * 2).min(Duration::from_secs(60));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use reqwest_middleware::{ClientBuilder, reqwest::Client};
    use serde_json::json;
    use wiremock::{
        Mock, MockServer, ResponseTemplate,
        matchers::{method, path},
    };

    fn policy(budget: Duration) -> GmailQuota {
        GmailQuota {
            interval: Duration::from_millis(15),
            retry_delay: Duration::from_millis(20),
            ..GmailQuota::new(budget)
        }
    }

    #[tokio::test]
    async fn quota_retry_preserves_prior_requests() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/first"))
            .respond_with(ResponseTemplate::new(200))
            .expect(1)
            .mount(&server)
            .await;
        Mock::given(path("/second"))
            .respond_with(
                ResponseTemplate::new(403)
                    .set_body_json(json!({"error":{"details":[{"reason":"RATE_LIMIT_EXCEEDED"}]}})),
            )
            .up_to_n_times(1)
            .with_priority(1)
            .expect(1)
            .mount(&server)
            .await;
        Mock::given(path("/second"))
            .respond_with(ResponseTemplate::new(200))
            .with_priority(2)
            .expect(1)
            .mount(&server)
            .await;
        let client = ClientBuilder::new(Client::new())
            .with(policy(Duration::from_secs(1)))
            .build();
        assert_eq!(
            client
                .get(format!("{}/first", server.uri()))
                .send()
                .await
                .unwrap()
                .status(),
            200
        );
        assert_eq!(
            client
                .get(format!("{}/second", server.uri()))
                .send()
                .await
                .unwrap()
                .status(),
            200
        );
        server.verify().await;
    }

    #[tokio::test]
    async fn permission_errors_are_not_retried() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .respond_with(
                ResponseTemplate::new(403).set_body_json(
                    json!({"error":{"errors":[{"reason":"insufficientPermissions"}]}}),
                ),
            )
            .expect(1)
            .mount(&server)
            .await;
        let client = ClientBuilder::new(Client::new())
            .with(policy(Duration::from_secs(1)))
            .build();
        assert!(client.get(server.uri()).send().await.is_err());
        server.verify().await;
    }

    #[tokio::test]
    async fn retry_after_cannot_exceed_budget() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .respond_with(ResponseTemplate::new(429).insert_header("retry-after", "60"))
            .expect(1)
            .mount(&server)
            .await;
        let client = ClientBuilder::new(Client::new())
            .with(policy(Duration::from_millis(100)))
            .build();
        assert!(
            client
                .get(server.uri())
                .send()
                .await
                .unwrap_err()
                .to_string()
                .contains("quota retry budget")
        );
        server.verify().await;
    }

    #[tokio::test]
    async fn cloned_policy_paces_separate_clients() {
        let quota = policy(Duration::ZERO);
        quota.wait().await;
        let start = Instant::now();
        quota.clone().wait().await;
        assert!(start.elapsed() >= quota.interval);
    }

    #[test]
    fn recognizes_only_rate_quota_reasons() {
        for reason in ["rateLimitExceeded", "userRateLimitExceeded"] {
            assert!(is_quota_error(
                json!({"error":{"errors":[{"reason":reason}]}})
                    .to_string()
                    .as_bytes()
            ));
        }
        for reason in ["dailyLimitExceeded", "insufficientPermissions", "forbidden"] {
            assert!(!is_quota_error(
                json!({"error":{"errors":[{"reason":reason}]}})
                    .to_string()
                    .as_bytes()
            ));
        }
        assert!(!is_quota_error(b"not json"));
    }
}
