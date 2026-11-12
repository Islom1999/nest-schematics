import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { ensureSuperAdmin } from '@app/database/seeds/super-admin.seed';

/**
 * First start: when the `admins` table is empty and ADMIN_EMAIL /
 * ADMIN_PASSWORD are set, creates the "Super admin" role (`*`) and that admin.
 * Never touches existing admins; change the password after the first sign-in.
 */
@Injectable()
export class AdminBootstrapService implements OnApplicationBootstrap {
  private readonly logger = new Logger('AdminBootstrap');

  constructor(
    private readonly dataSource: DataSource,
    private readonly config: ConfigService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (process.env.SWAGGER_EXPORT === '1' || !this.dataSource.isInitialized) return;
    try {
      const result = await ensureSuperAdmin(
        this.dataSource,
        {
          email: this.config.get<string>('ADMIN_EMAIL'),
          password: this.config.get<string>('ADMIN_PASSWORD'),
        },
        { onlyIfNoAdmins: true },
      );
      if (result.status === 'created') {
        this.logger.log(`Created the first super admin (${this.config.get<string>('ADMIN_EMAIL')})`);
      } else if (result.status === 'skipped') {
        this.logger.warn(`No admin exists and none was created: ${result.reason}`);
      }
    } catch (error) {
      this.logger.error(`Could not create the first admin (did the migrations run?): ${(error as Error).message}`);
    }
  }
}
