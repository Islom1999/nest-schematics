import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AdminRole } from '@app/database';
import { SearchProviderBase } from '../search-provider.base';
import { SearchService } from '../search.service';
import { escapeLike, SearchHit } from '../search.types';

@Injectable()
export class RolesSearchProvider extends SearchProviderBase {
  readonly id = 'roles';
  readonly label = 'Roles';
  readonly permissions = ['role.read'];

  constructor(
    search: SearchService,
    @InjectRepository(AdminRole) private readonly roles: Repository<AdminRole>,
  ) {
    super(search);
  }

  async search(query: string, limit: number): Promise<SearchHit[]> {
    const rows = await this.roles
      .createQueryBuilder('role')
      .where(`role.name ILIKE :q ESCAPE '\\'`, { q: `%${escapeLike(query)}%` })
      .orderBy('role.name', 'ASC')
      .take(limit)
      .getMany();
    return rows.map((r) => ({ id: r.id, link: `/roles/${r.id}`, value: r.name, title: r.name }));
  }
}
