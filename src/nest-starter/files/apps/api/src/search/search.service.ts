import { Injectable, Logger } from '@nestjs/common';
import { hasPermissions } from '../auth/auth.types';
import { SearchResultSetDto } from './search.dto';
import { SEARCH_QUERY_MAX, SEARCH_QUERY_MIN, SEARCH_RESULT_LIMIT, SearchProvider } from './search.types';

/**
 * Global admin search: the registered providers, each only for admins who hold
 * its permissions, run in parallel; a failing provider is skipped. Every
 * provider returns at most SEARCH_RESULT_LIMIT hits and empty groups are left out.
 */
@Injectable()
export class SearchService {
  private readonly logger = new Logger('Search');
  private readonly providers: SearchProvider[] = [];

  /** Called by `SearchProviderBase`; the registration order is the group order. */
  register(provider: SearchProvider): void {
    if (this.providers.some((p) => p.id === provider.id)) {
      throw new Error(`Search provider "${provider.id}" is registered twice`);
    }
    this.providers.push(provider);
  }

  async search(granted: readonly string[], rawQuery: string): Promise<SearchResultSetDto[]> {
    const query = rawQuery.trim().slice(0, SEARCH_QUERY_MAX);
    if (query.length < SEARCH_QUERY_MIN) return [];

    const allowed = this.providers.filter((p) => hasPermissions(granted, p.permissions));
    const sets = await Promise.all(
      allowed.map(async (provider): Promise<SearchResultSetDto | null> => {
        try {
          const hits = (await provider.search(query, SEARCH_RESULT_LIMIT)).slice(0, SEARCH_RESULT_LIMIT);
          return hits.length ? { id: provider.id, label: provider.label, results: hits } : null;
        } catch (error) {
          this.logger.error(`Provider "${provider.id}" failed: ${(error as Error).message}`);
          return null;
        }
      }),
    );
    return sets.filter((s): s is SearchResultSetDto => s !== null);
  }
}
