/// Keep the current item selected when a refreshed page reorders or inserts rows.
/// If it disappeared, select its former position (or the new last row).
/// An unselected mobile list must remain unselected.
pub(super) fn selection_after_refresh<T: PartialEq>(
    current_ids: &[T],
    selected_index: Option<usize>,
    refreshed_ids: &[T],
) -> Option<usize> {
    let index = selected_index?;
    if refreshed_ids.is_empty() {
        // Leave the existing index for the page effect to clear the stale detail URL.
        return selected_index;
    }
    current_ids
        .get(index)
        .and_then(|id| refreshed_ids.iter().position(|candidate| candidate == id))
        .or(Some(index.min(refreshed_ids.len() - 1)))
}

#[cfg(test)]
mod tests {
    use super::selection_after_refresh;

    #[cfg_attr(target_arch = "wasm32", wasm_bindgen_test::wasm_bindgen_test)]
    #[cfg_attr(not(target_arch = "wasm32"), test)]
    fn keeps_identity_when_new_rows_arrive_before_selection() {
        assert_eq!(
            selection_after_refresh(&[1, 2, 3], Some(1), &[4, 1, 2, 3]),
            Some(2)
        );
    }

    #[cfg_attr(target_arch = "wasm32", wasm_bindgen_test::wasm_bindgen_test)]
    #[cfg_attr(not(target_arch = "wasm32"), test)]
    fn keeps_identity_when_refill_removes_earlier_rows() {
        assert_eq!(
            selection_after_refresh(&[1, 2, 3], Some(2), &[3, 4, 5]),
            Some(0)
        );
    }

    #[cfg_attr(target_arch = "wasm32", wasm_bindgen_test::wasm_bindgen_test)]
    #[cfg_attr(not(target_arch = "wasm32"), test)]
    fn follows_the_latest_selection_not_the_selection_when_loading_started() {
        // Loading began on 1, but the user selected 3 while the request was pending.
        assert_eq!(
            selection_after_refresh(&[1, 2, 3], Some(2), &[4, 1, 2, 3]),
            Some(3)
        );
    }

    #[cfg_attr(target_arch = "wasm32", wasm_bindgen_test::wasm_bindgen_test)]
    #[cfg_attr(not(target_arch = "wasm32"), test)]
    fn uses_nearest_remaining_row_when_selected_item_disappears() {
        assert_eq!(
            selection_after_refresh(&[1, 2, 3], Some(1), &[1, 3]),
            Some(1)
        );
        assert_eq!(
            selection_after_refresh(&[1, 2, 3], Some(2), &[1, 2]),
            Some(1)
        );
    }

    #[cfg_attr(target_arch = "wasm32", wasm_bindgen_test::wasm_bindgen_test)]
    #[cfg_attr(not(target_arch = "wasm32"), test)]
    fn preserves_no_selection_and_handles_an_empty_page() {
        assert_eq!(selection_after_refresh(&[1, 2], None, &[1, 2, 3]), None);
        assert_eq!(selection_after_refresh(&[1, 2], Some(1), &[]), Some(1));
    }
}
