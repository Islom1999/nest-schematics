/** Most hits one provider may return, and the most `limit` it is given. */
export const SEARCH_RESULT_LIMIT = 5;
/** Longest query that is searched; longer input is cut. */
export const SEARCH_QUERY_MAX = 100;
/** Shortest query that is searched; shorter gives no results. */
export const SEARCH_QUERY_MIN = 2;

/** One hit (the `SearchResult` of the admin UI). */
export interface SearchHit {
  id: string;
  /** Router link of the admin app. */
  link: string;
  /** Text the search box shows when the hit is picked. */
  value: string;
  title?: string;
}

/**
 * A source of search results (a group of the result list). The starter has
 * admins and roles; an add-on adds its own: write an injectable class that
 * extends `SearchProviderBase` and add it to `providers` of SearchModule at the
 * `// @ns:search-providers` marker.
 */
export interface SearchProvider {
  /** Group key, e.g. `admins`. */
  readonly id: string;
  /** Group title, e.g. `Admins`. */
  readonly label: string;
  /** Permissions needed to search here (every one of them); empty = every admin. */
  readonly permissions: readonly string[];
  /** At most `limit` hits for the (already trimmed) query. */
  search(query: string, limit: number): Promise<SearchHit[]>;
}

/** Escapes `%`, `_` and `\` so user input is matched literally by LIKE / ILIKE. */
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}
