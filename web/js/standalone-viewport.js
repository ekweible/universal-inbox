// iOS standalone can retain stale CSS viewport dimensions across suspension.
// Refresh from the browser's usable viewport, never from physical screen height
// or an added safe-area guess (either can put controls below the visible screen).
export function installStandaloneViewportSync() {
    const standalone = window.matchMedia("(display-mode: standalone)").matches ||
        window.navigator.standalone === true;
    if (!standalone || !CSS.supports("-webkit-touch-callout", "none")) return;

    const root = document.documentElement;
    let frame = 0;
    let retries = [];
    const update = () => {
        frame = 0;
        if (document.visibilityState === "hidden") return;
        // Pinching changes the visual viewport, not the layout viewport.
        if (window.visualViewport && window.visualViewport.scale !== 1) return;
        const height = window.innerHeight;
        if (height > 0) root.style.setProperty("--ui-app-height", `${height}px`);
    };
    const schedule = () => {
        if (!frame) frame = requestAnimationFrame(update);
    };
    const resume = () => {
        retries.forEach(clearTimeout);
        retries = [];
        if (document.visibilityState === "hidden") return;
        if (window.visualViewport && window.visualViewport.scale !== 1) return;
        // Clear the stale measurement and force layout before remeasuring. Only
        // reset accidental document scrolling; inbox/email scroll containers
        // retain their own position. Never move the page while an input is active.
        const editing = document.activeElement?.matches("input, textarea, [contenteditable=true]");
        if (!editing && root.querySelector(".ui-app-shell")) {
            root.style.removeProperty("--ui-app-height");
            void root.clientHeight;
            if (window.scrollY || window.scrollX) window.scrollTo({top: 0, left: 0, behavior: "instant"});
        }
        schedule();
        // WebKit can settle its insets after pageshow/visibilitychange fires.
        retries = [100, 300, 1000].map(delay => setTimeout(schedule, delay));
    };
    window.addEventListener("resize", schedule);
    window.visualViewport?.addEventListener("resize", schedule);
    window.addEventListener("pageshow", resume);
    document.addEventListener("visibilitychange", resume);
    resume();
}

if (typeof window !== "undefined") installStandaloneViewportSync();
