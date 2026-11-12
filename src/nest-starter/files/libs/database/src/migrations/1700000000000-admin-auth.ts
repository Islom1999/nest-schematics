import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Admin auth tables: admin_roles, admins, admin_sessions. Names match the
 * entities (SnakeNamingStrategy + explicit index/constraint names), so
 * `migration:generate` sees no difference afterwards. The early timestamp
 * keeps it before every generated migration.
 */
export class AdminAuth1700000000000 implements MigrationInterface {
  name = 'AdminAuth1700000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);

    await queryRunner.query(`
      CREATE TABLE "admin_roles" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMP WITH TIME ZONE,
        "name" character varying(100) NOT NULL,
        "permissions" text array NOT NULL DEFAULT '{}',
        CONSTRAINT "PK_091baca34754e848b9f8c4e7be9" PRIMARY KEY ("id")
      )`);
    await queryRunner.query(`CREATE INDEX "IDX_e8b16bfff05fda0e9443e44354" ON "admin_roles" ("deleted_at")`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_admin_roles_name" ON "admin_roles" ("name") WHERE deleted_at IS NULL`,
    );

    await queryRunner.query(`
      CREATE TABLE "admins" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMP WITH TIME ZONE,
        "email" character varying(254) NOT NULL,
        "password_hash" character varying(255) NOT NULL,
        "name" character varying(120) NOT NULL DEFAULT '',
        "is_blocked" boolean NOT NULL DEFAULT false,
        "last_login_at" TIMESTAMP WITH TIME ZONE,
        "role_id" uuid,
        CONSTRAINT "PK_e3b38270c97a854c48d2e80874e" PRIMARY KEY ("id")
      )`);
    await queryRunner.query(`CREATE INDEX "IDX_c6ef87dba2fe6e060a957fca9b" ON "admins" ("deleted_at")`);
    await queryRunner.query(`CREATE INDEX "IDX_admins_role_id" ON "admins" ("role_id")`);
    // Emails are stored lowercased by the entity, so this is case-insensitive.
    await queryRunner.query(`CREATE UNIQUE INDEX "UQ_admins_email" ON "admins" ("email") WHERE deleted_at IS NULL`);

    await queryRunner.query(`
      CREATE TABLE "admin_sessions" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMP WITH TIME ZONE,
        "refresh_hash" character varying(64) NOT NULL,
        "device_id" character varying(200),
        "device_name" character varying(200),
        "platform" character varying(50),
        "os" character varying(100),
        "app_version" character varying(50),
        "ip" character varying(64) NOT NULL DEFAULT '',
        "user_agent" character varying(512) NOT NULL DEFAULT '',
        "last_used_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "expires_at" TIMESTAMP WITH TIME ZONE NOT NULL,
        "revoked_at" TIMESTAMP WITH TIME ZONE,
        "revoke_reason" character varying(50),
        "admin_id" uuid NOT NULL,
        CONSTRAINT "PK_38bb553c2372215d48de2306c5e" PRIMARY KEY ("id")
      )`);
    await queryRunner.query(`CREATE INDEX "IDX_1b0ece651c23a701ae498c082a" ON "admin_sessions" ("deleted_at")`);
    await queryRunner.query(`CREATE INDEX "IDX_admin_sessions_admin_id" ON "admin_sessions" ("admin_id")`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_admin_sessions_refresh_hash" ON "admin_sessions" ("refresh_hash")`,
    );

    await queryRunner.query(
      `ALTER TABLE "admins" ADD CONSTRAINT "FK_admins_role_id" FOREIGN KEY ("role_id") ` +
        `REFERENCES "admin_roles"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "admin_sessions" ADD CONSTRAINT "FK_admin_sessions_admin_id" FOREIGN KEY ("admin_id") ` +
        `REFERENCES "admins"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "admin_sessions" DROP CONSTRAINT "FK_admin_sessions_admin_id"`);
    await queryRunner.query(`ALTER TABLE "admins" DROP CONSTRAINT "FK_admins_role_id"`);
    await queryRunner.query(`DROP TABLE "admin_sessions"`);
    await queryRunner.query(`DROP TABLE "admins"`);
    await queryRunner.query(`DROP TABLE "admin_roles"`);
  }
}
