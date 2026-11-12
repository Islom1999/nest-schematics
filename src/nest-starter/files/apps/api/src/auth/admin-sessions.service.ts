import { Inject, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SessionManager } from '@app/common';
import { AdminSession } from '@app/database';
import { ADMIN_AUTH_OPTIONS, AdminAuthOptions } from './auth.config';

/** Admin sessions (`admin_sessions`), tokens with `typ: 'admin'`. */
@Injectable()
export class AdminSessionsService extends SessionManager<AdminSession> {
  constructor(
    @InjectRepository(AdminSession) repository: Repository<AdminSession>,
    jwt: JwtService,
    @Inject(ADMIN_AUTH_OPTIONS) options: AdminAuthOptions,
  ) {
    super(repository, jwt, {
      typ: 'admin',
      ownerKey: 'adminId',
      accessSecret: options.accessSecret,
      refreshSecret: options.refreshSecret,
      accessTtl: options.accessTtl,
      refreshTtl: options.refreshTtl,
      limit: options.sessionLimit,
    });
  }
}
