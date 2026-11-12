import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Admin } from '@app/database';
import { SearchProviderBase } from '../search-provider.base';
import { SearchService } from '../search.service';
import { escapeLike, SearchHit } from '../search.types';

@Injectable()
export class AdminsSearchProvider extends SearchProviderBase {
  readonly id = 'admins';
  readonly label = 'Admins';
  readonly permissions = ['admin.read'];

  constructor(
    search: SearchService,
    @InjectRepository(Admin) private readonly admins: Repository<Admin>,
  ) {
    super(search);
  }

  async search(query: string, limit: number): Promise<SearchHit[]> {
    const rows = await this.admins
      .createQueryBuilder('admin')
      .where(`admin.email ILIKE :q ESCAPE '\\' OR admin.name ILIKE :q ESCAPE '\\'`, { q: `%${escapeLike(query)}%` })
      .orderBy('admin.email', 'ASC')
      .take(limit)
      .getMany();
    return rows.map((a) => ({ id: a.id, link: `/admins/${a.id}`, value: a.email, title: a.name || a.email }));
  }
}
