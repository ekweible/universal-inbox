#![allow(non_snake_case)]

use dioxus::prelude::*;

/// Secondary mobile actions reuse the same buttons and handlers as desktop.
#[component]
pub fn MobileMoreActions(actions: Vec<Element>) -> Element {
    let mut open = use_signal(|| false);
    rsx! {
        div { class: "relative",
            onkeydown: move |event| {
                if event.key() == Key::Escape { open.set(false); }
            },
            button {
                class: "relative z-20 w-11 h-11 flex items-center justify-center rounded-ui-md text-ui-base-muted hover:bg-ui-surface-hover",
                r#type: "button",
                "aria-label": "More actions",
                "aria-expanded": "{open}",
                onclick: move |_| { let next = !open(); open.set(next); },
                span { class: "icon-[lucide--ellipsis] size-5" }
            }
            if open() {
                button {
                    class: "fixed inset-0 z-10 cursor-default",
                    r#type: "button",
                    "aria-label": "Close more actions",
                    onclick: move |_| open.set(false),
                }
                div {
                    class: "mobile-more-actions absolute bottom-full right-0 mb-2 z-30 w-64 max-h-[60dvh] overflow-y-auto p-2 rounded-ui-md border border-ui-border bg-ui-surface shadow-ui-sm",
                    role: "group",
                    "aria-label": "Additional notification actions",
                    onclick: move |_| open.set(false),
                    for action in actions { {action} }
                }
            }
        }
    }
}
