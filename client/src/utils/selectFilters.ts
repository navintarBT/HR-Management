// @refinedev/core's useSelect only wires its remote search to `optionLabel`
// when optionLabel is a plain field name (a string). Whenever optionLabel is
// a function — which is how this app combines firstName + lastName into a
// display name — the search silently falls back to searching a "title"
// field that none of our resources have, so typing anything returns zero
// results. Swap remote search for a local filter against the label text
// useSelect already computed, wherever optionLabel is a function.
export function withLocalTextFilter(selectProps: any): any {
  return {
    ...selectProps,
    onSearch: undefined,
    filterOption: (input: string, option: any) => ((option?.label as string) ?? '').toLowerCase().includes(input.toLowerCase()),
    showSearch: true,
  };
}
