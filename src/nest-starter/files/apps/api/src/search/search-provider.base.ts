import { OnModuleInit } from '@nestjs/common';
import { SearchService } from './search.service';
import { SearchHit, SearchProvider } from './search.types';

/**
 * Extend it and call `super(search)` in the constructor: the provider
 * registers itself when the module starts (after its fields are set).
 */
export abstract class SearchProviderBase implements SearchProvider, OnModuleInit {
  abstract readonly id: string;
  abstract readonly label: string;
  abstract readonly permissions: readonly string[];

  protected constructor(private readonly registry: SearchService) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  abstract search(query: string, limit: number): Promise<SearchHit[]>;
}
