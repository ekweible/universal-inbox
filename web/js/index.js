import "flyonui/dist/collapse";
import "flyonui/dist/tabs";
import "flyonui/dist/overlay";
import "flyonui/dist/tooltip";
import flatpickr from "flatpickr";
export { flatpickr };

// Mount sandboxed email-body iframes (.ui-email-frame-host) entirely from JS.
// Dioxus only renders a `<div class="ui-email-frame-host" data-html="…">`
// placeholder; this code creates the actual `<iframe>` and sets its srcdoc /
// sandbox / load handler. Keeping the heavy srcdoc string off the Dioxus VDOM
// avoids a `Dropped(ValueDroppedError)` panic in long Gmail threads (20+
// messages) where re-rendering many large `srcdoc` attributes raced with
// Dioxus' Callback machinery.
// Email documents deliberately use a light canvas, independently of the app.
// Preserve sender styles instead of guessing backgrounds or rewriting colors:
// nested tables and background images make automatic dark recoloring unreliable.
// Pin sender color-scheme media queries too: browsers can still expose the OS
// preference inside a light iframe. Do this before loading to avoid a flash.
const EMAIL_FRAME_FOOT = "</body></html>";

function buildEmailFrameHead(allowRemoteImages = false) {
    const imageSources = allowRemoteImages ? "data: https: http:" : "data:";
    const policy = "default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; " +
        "img-src " + imageSources + "; font-src 'none'; connect-src 'none'; " +
        "frame-src 'none'; object-src 'none'; media-src 'none'; " +
        "base-uri 'none'; form-action 'none';";
    const textColor = "#0f172a";
    const surfaceColor = "#ffffff";
    const borderColor = "#e2e8f0";
    return (
        '<!doctype html><html><head><meta charset="utf-8">' +
        '<meta http-equiv="Content-Security-Policy" content="' + policy + '">' +
        '<meta name="referrer" content="no-referrer">' +
        '<meta name="color-scheme" content="only light"><base target="_blank">' +
        "<style>" +
        "html{color-scheme:only light;}" +
        // The root paints the iframe canvas — its background covers the entire
        // scrollable area, including horizontal overflow. Filling it with the
        // light canvas color keeps the background continuous behind a wide email
        // (the body stays transparent so an email's own background still wins
        // over the surface within its own width).
        "html{background:" + surfaceColor + ";}" +
        "html,body{margin:0;padding:0;color:" + textColor + ";" +
        "font-family:'DM Sans',system-ui,-apple-system,'Segoe UI',Roboto," +
        "'Helvetica Neue',Arial,sans-serif;font-size:14px;line-height:1.55;" +
        "-webkit-font-smoothing:antialiased;}" +
        "body{background:transparent;}" +
        // Emails with fixed-width layouts (wide tables, hard pixel widths) can be
        // wider than the preview pane. `overflow-x:auto` on the root gives the
        // user a horizontal scrollbar to reach the full content instead of
        // silently clipping it. `overflow-y:hidden` keeps height auto-sized by
        // the resize handler (the preview pane itself scrolls vertically).
        "html{overflow-x:auto;overflow-y:hidden;}img{max-width:100%;height:auto;}" +
        // Match the preview pane's custom scrollbar (#notification-preview-details
        // in the app CSS): thin, transparent track, --ui-border thumb, 3px radius —
        // so the email's horizontal scrollbar aligns with the pane's vertical one.
        "html{scrollbar-width:thin;scrollbar-color:" + borderColor + " transparent;}" +
        "html::-webkit-scrollbar{width:5px;height:5px;}" +
        "html::-webkit-scrollbar-track{background:transparent;}" +
        "html::-webkit-scrollbar-thumb{background:" + borderColor + ";border-radius:3px;}" +
        "</style>" +
        "</head><body>"
    );
}

function lightEmailHtml(html) {
    const template = document.createElement("template");
    template.innerHTML = html;
    const lightMedia = (css) => css.replace(
        /\(\s*prefers-color-scheme\s*:\s*(dark|light)\s*\)/gi,
        (_, scheme) => scheme.toLowerCase() === "dark"
            ? "(max-width: -1px)" : "(min-width: 0px)",
    );
    template.content.querySelectorAll("style").forEach((style) => {
        style.textContent = lightMedia(style.textContent);
    });
    template.content.querySelectorAll("[media]").forEach((element) => {
        element.setAttribute("media", lightMedia(element.getAttribute("media")));
    });
    return template.innerHTML;
}

function buildEmailIframe(host) {
    const html = host.dataset.html || "";
    const srcdoc = buildEmailFrameHead(host.dataset.remoteImages === "true") + lightEmailHtml(html) + EMAIL_FRAME_FOOT;

    // Re-render path: when Dioxus reuses the host div for a new notification,
    // it just rewrites `data-html`. Keep the existing iframe and swap its
    // srcdoc so we don't lose the load handler or flash a fresh reflow.
    const existing = host.querySelector(":scope > iframe.ui-email-frame");
    if (existing) {
        if (existing.srcdoc !== srcdoc) {
            existing.srcdoc = srcdoc;
        }
        return;
    }

    host.dataset.uiEmailFrameMounted = "true";
    const iframe = document.createElement("iframe");
    iframe.className = "ui-email-frame";
    iframe.setAttribute(
        "sandbox",
        "allow-same-origin allow-popups allow-popups-to-escape-sandbox",
    );
    iframe.setAttribute("title", "Email message");
    iframe.setAttribute("referrerpolicy", "no-referrer");
    iframe.setAttribute("loading", "lazy");
    iframe.srcdoc = srcdoc;

    // Measure at the available width first so responsive emails can reflow.
    // Fixed-width templates then get a fitted viewport rather than a clipped
    // right edge. Scaling the iframe preserves sender layout and link targets.
    host.style.position = "relative";
    const resize = () => {
        if (!host.isConnected) return;
        try {
            const doc = iframe.contentDocument;
            if (!doc?.body || !host.clientWidth) return;
            const available = host.clientWidth;
            iframe.style.position = "absolute";
            iframe.style.transformOrigin = "top left";
            iframe.style.transform = "none";
            iframe.style.width = available + "px";
            iframe.style.height = "1px";
            let width = Math.max(available, doc.documentElement.scrollWidth, doc.body.scrollWidth);
            const fit = window.matchMedia("(max-width: 767px)").matches;
            if (fit) {
                // A wider viewport can switch the sender's responsive layout.
                for (let pass = 0; pass < 3; pass++) {
                    iframe.style.width = width + "px";
                    const measured = Math.max(width, doc.documentElement.scrollWidth, doc.body.scrollWidth);
                    if (measured === width) break;
                    width = measured;
                }
                iframe.style.width = width + "px";
            }
            const scale = fit ? Math.min(1, available / width) : 1;
            let height = Math.max(doc.documentElement.scrollHeight, doc.body.scrollHeight);
            if (!fit && width > available) height += 16;
            iframe.style.height = height + "px";
            iframe.style.transform = `scale(${scale})`;
            host.style.height = Math.ceil(height * scale) + "px";
        } catch (_) {
            // Detached document during navigation.
        }
    };
    let pending = false;
    const scheduleResize = () => {
        if (pending) return;
        pending = true;
        requestAnimationFrame(() => { pending = false; resize(); });
    };
    let observedWidth = 0;
    const observer = new ResizeObserver(() => {
        if (host.clientWidth !== observedWidth) {
            observedWidth = host.clientWidth;
            scheduleResize();
        }
    });
    observer.observe(host);
    host.uiEmailCleanup = () => observer.disconnect();
    // Do NOT call `resize` synchronously after `appendChild`: at that point
    // the iframe still hosts an empty `about:blank` document (which already
    // reports `readyState === "complete"`), so measuring its `scrollHeight`
    // would set the iframe to the empty-iframe default (~150px in Chromium,
    // ~8px in Firefox) and the user sees a collapsed frame until the real
    // `srcdoc` finishes parsing. The `load` event below fires once the
    // `srcdoc` content has actually loaded; the listener is attached before
    // `appendChild`, so it cannot have already fired.
    iframe.addEventListener("load", () => {
        resize();
        // Images and webfonts may change the document height after initial load.
        iframe.contentDocument?.addEventListener("load", scheduleResize, true);
        iframe.contentDocument?.fonts?.ready.then(scheduleResize);
    });
    host.appendChild(iframe);
}

if (typeof window !== "undefined" && typeof MutationObserver !== "undefined") {
    const scan = (root) => {
        if (!root || !root.querySelectorAll) return;
        if (root.matches?.(".ui-email-frame-host")) {
            buildEmailIframe(root);
        }
        root.querySelectorAll?.(".ui-email-frame-host").forEach(
            buildEmailIframe,
        );
    };
    const observer = new MutationObserver((records) => {
        for (const r of records) {
            if (r.type === "attributes") {
                if (
                    r.target.nodeType === 1 &&
                    r.target.matches?.(".ui-email-frame-host")
                ) {
                    buildEmailIframe(r.target);
                }
            } else {
                r.removedNodes?.forEach((n) => {
                    if (n.nodeType !== 1 || n.isConnected) return;
                    n.uiEmailCleanup?.();
                    n.querySelectorAll?.(".ui-email-frame-host").forEach((host) => host.uiEmailCleanup?.());
                });
                r.addedNodes?.forEach((n) => {
                    if (n.nodeType === 1) scan(n);
                });
            }
        }
    });
    const start = () => {
        scan(document.body);
        observer.observe(document.body, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ["data-html", "data-remote-images"],
        });
    };
    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", start);
    } else {
        start();
    }
}

// Flyonui collapse component hooks
export function init_flyonui_collapse_element(element) {
    if (typeof window.$hsCollapseCollection === "object") {
        if (
            element &&
            !window.$hsCollapseCollection.find(
                (el) => el?.element?.el === element,
            )
        ) {
            new HSCollapse(element);
        }
    }
}

export function forget_flyonui_collapse_element(element) {
    if (typeof window.$hsCollapseCollection === "object") {
        window.$hsCollapseCollection = window.$hsCollapseCollection.filter(
            (el) => el?.element?.el !== element,
        );
    }
}

// Flyonui tabs component hooks
export function init_flyonui_tabs_element(element) {
    if (typeof window.$hsTabsCollection === "object") {
        if (
            element &&
            !window.$hsTabsCollection.find((el) => el?.element?.el === element)
        ) {
            new HSTabs(element);
        }
    }
}

export function forget_flyonui_tabs_element(element) {
    if (typeof window.$hsTabsCollection === "object") {
        window.$hsTabsCollection = window.$hsTabsCollection.filter(
            (el) => el?.element?.el !== element,
        );
    }
}

// Flyonui modal component hooks
export function init_flyonui_modal(element) {
    if (typeof window.$hsOverlayCollection === "object") {
        if (
            element &&
            !window.$hsOverlayCollection.find(
                (el) => el?.element?.el === element,
            )
        ) {
            new HSOverlay(element);
        }
    }
}

export function forget_flyonui_modal(element) {
    if (typeof window.$hsOverlayCollection === "object") {
        window.$hsOverlayCollection = window.$hsOverlayCollection.filter(
            (el) => el?.element?.el !== element,
        );
    }
}

export function open_flyonui_modal(target) {
    HSOverlay.open(target);
}

export function close_flyonui_modal(target) {
    HSOverlay.close(target);
}

export function has_flyonui_modal_opened() {
    if (typeof window.$hsOverlayCollection === "object") {
        return (
            window.$hsOverlayCollection.filter(
                (el) =>
                    !el?.element?.el.classList.contains(
                        el?.element?.hiddenClass,
                    ),
            ).length > 0
        );
    }
}

// Flyonui tooltip component hooks
export function init_flyonui_tooltip_element(element) {
    if (!element) return;
    // HSTooltip.autoInit() seeds $hsTooltipCollection on window.load. If a
    // Dioxus component mounts before that fires, the array is undefined and
    // HSTooltip's constructor would crash. Seed it ourselves to be safe.
    if (!Array.isArray(window.$hsTooltipCollection)) {
        window.$hsTooltipCollection = [];
    }
    if (
        !window.$hsTooltipCollection.find((el) => el?.element?.el === element)
    ) {
        new HSTooltip(element);
    }
}

export function forget_flyonui_tooltip_element(element) {
    if (!element || !Array.isArray(window.$hsTooltipCollection)) return;
    const entry = window.$hsTooltipCollection.find(
        (el) => el?.element?.el === element,
    );
    if (entry?.element?.destroy) {
        entry.element.destroy();
    } else {
        window.$hsTooltipCollection = window.$hsTooltipCollection.filter(
            (el) => el?.element?.el !== element,
        );
    }
}
