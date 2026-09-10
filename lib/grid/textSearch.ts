/**
 * SOFT1_ERP uses a Greek accent-sensitive collation, so a plain LIKE treats 'έ' and
 * 'ε' as different letters and "ΕΛΛΑΣ" never finds "Ελλάς". Greek_CI_AI folds accents,
 * dialytika and final sigma while keeping the Greek and Latin alphabets distinct.
 */
export const SEARCH_COLLATION = 'Greek_CI_AI';

/** Wraps a text expression so comparisons against it ignore case and accents. */
export const collateSearch = (expression: string): string =>
  `${expression} COLLATE ${SEARCH_COLLATION}`;

/** Browser-side twin: accent-folded, lowercased, final sigma normalised. */
export const normalizeSearchText = (value: unknown): string => {
  if (value === null || value === undefined) return '';
  return String(value)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/ς/g, 'σ');
};
