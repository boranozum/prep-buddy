// Locale-aware text utilities: CLAUDE.md rule 8 ("locale-aware casing and
// collation, Turkish dotted and dotless i") and docs/data-model.md section 2
// ("Ingredient aliases ... used for search across both languages regardless
// of UI language"). Pure.

/**
 * Case-folds text for search comparison, treating Turkish dotted/dotless i
 * (İ, I, i, ı) as equivalent regardless of which locale typed the query or
 * the stored text. Plain `toLowerCase()`/`toUpperCase()` get this wrong in
 * both directions: default casing turns Turkish 'İ' into 'i̇' (with a
 * combining dot) instead of 'i', and Turkish-locale casing turns an English
 * lowercase 'i' into a dotted 'İ' when uppercased, which then no longer
 * matches a plain ASCII 'I' typed by the user.
 */
export function foldForSearch(text: string): string {
  return text.toLocaleLowerCase('tr').replace(/ı/g, 'i').trim();
}

/** Turkish-correct uppercasing, e.g. for display casing of Turkish content. */
export function turkishUpperCase(text: string): string {
  return text.toLocaleUpperCase('tr');
}

/** Turkish-correct lowercasing, e.g. for display casing of Turkish content. */
export function turkishLowerCase(text: string): string {
  return text.toLocaleLowerCase('tr');
}

/** Turkish collation, for sorting ingredient/recipe lists shown to a Turkish user. */
export function compareTurkish(a: string, b: string): number {
  return a.localeCompare(b, 'tr');
}

export interface SearchableIngredient {
  id: string;
  names: { en: string; tr: string };
  aliases?: { en: readonly string[]; tr: readonly string[] };
}

/**
 * Finds ingredients whose name or alias, in either locale, contains the
 * query — independent of which language the query or the ingredient's
 * content is in (docs/data-model.md section 2).
 */
export function searchIngredients<T extends SearchableIngredient>(
  query: string,
  ingredients: readonly T[],
): T[] {
  const needle = foldForSearch(query);
  if (needle === '') return [];

  return ingredients.filter((ingredient) => {
    const haystacks = [
      ingredient.names.en,
      ingredient.names.tr,
      ...(ingredient.aliases?.en ?? []),
      ...(ingredient.aliases?.tr ?? []),
    ];
    return haystacks.some((h) => foldForSearch(h).includes(needle));
  });
}
