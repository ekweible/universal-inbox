# Studio fork

This fork keeps `main` aligned with upstream. `studio` contains the reviewed changes
running on the personal Studio installation. Make each product change on a focused
`fix/*` or `feat/*` branch, validate it, then merge it into `studio`. Contributions
upstream are a separate, deliberate step; there is no automatic upstream publishing.

The first change preserves the selected notification by identity when a page is
refreshed or refilled. Selection is read after the request completes so navigation
while loading is respected. This does not implement a concurrent shortcut queue.

## Build

Docker Desktop is sufficient; Devbox/Nix and Rust run inside the existing upstream
Dockerfile. The first build downloads and compiles the toolchain and dependencies;
subsequent builds reuse Docker's cache. No host Nix installation is required.

From a clean checkout of the revision to deploy:

```sh
revision=$(git rev-parse HEAD)
docker build --build-arg VERSION="$revision" \
  -t "ekweible/universal-inbox:$revision" .
```

Record the image ID with `docker image inspect`. The Studio Compose file uses this
immutable local image ID rather than a moving tag. Keep the image locally: it is
not automatically published to a container registry.

## Studio installations

Private operational files live outside this repository:

- Production: `~/.local/share/universal-inbox/compose.yaml` and `.env`.
- Disposable fixture instance: `~/.local/share/universal-inbox-fork-test/`.
- Production listens on loopback port 3187, behind the existing tailnet service.
- Fixture testing uses loopback port 3188, its own Postgres/Redis, synthetic data,
  dry-run mode, and no personal OAuth or SMTP credentials.

Do not copy production credentials into the fixture instance. Avoid using actual
notifications to exercise delete or other source-changing actions.

## Validate and deploy

1. Build and start the candidate in the isolated fixture instance.
2. Run frontend formatting, Clippy, and WASM tests. Verify the interaction in the
   browser against synthetic data, including selection while a request is pending.
3. Back up production with `manage.py backup`; preserve the previous Compose file
   and image ID. Review migration differences before changing the image.
4. Change only the production `app.image` pin, then run `docker compose up -d
   --no-deps app` against the production Compose file.
5. Verify health, served assets/version, and the authenticated application. Keep
   the hostname, environment, database volume, and connector registrations intact.

For rollback without schema changes, restore the preceding Compose image pin and
recreate only `app`. If a future change includes migrations, establish a database
restore/compatibility plan before deploying; changing the image alone may not be
sufficient.

## Upstream updates

Fetch `upstream` read-only, fast-forward fork `main`, then merge it into `studio`
and repeat validation. Keep personal deployment documentation separate from
focused product fixes so those fixes can be proposed upstream independently.

The inherited upstream CI includes upstream deployment assumptions. `studio` is
not an upstream deployment trigger. Do not add production credentials to inherited
workflows or push changes to the upstream remote.

## Install and use on a phone

The web manifest supplies stable app identity, standalone launch, and padded PNG
icons for home screens. The iOS touch icon and status-bar metadata are included in
both HTML entry points. Trunk copies `web/pwa/`; the Dioxus asset preparation also
copies it into `web/public/pwa/`.

- iPhone/iPad: open the inbox in Safari, use Share → Add to Home Screen, and enable
  Open as Web App if that option appears.
- Android/desktop Chromium: use the browser's Install app action.
- The phone must be able to reach the Studio's tailnet address.

This first version is online-only. There is no service worker, offline inbox copy,
or background action queue. Installation does not change source-service actions
or require new connector credentials. Modern installation uses the manifest and
HTTPS; see [MDN's installability guide](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Making_PWAs_installable).

Mobile layouts account for safe-area insets, keep two lines of notification title,
use 44px action targets and navigation links, and combine detail navigation with
primary actions in one bottom bar. Secondary notification actions are labeled in
More. The mobile detail title scrolls with content; the source header replaces the
branding row, and integration status lives in the navigation drawer. Only the
bottom bar owns its bottom safe-area inset. Desktop density is retained.
