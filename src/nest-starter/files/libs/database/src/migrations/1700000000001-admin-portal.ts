import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Admin password-reset tokens (admin_password_resets) and the admin's own
 * notifications (admin_notifications). Names match the entities, so
 * `migration:generate` sees no difference afterwards.
 */
export class AdminPortal1700000000001 implements MigrationInterface {
  name = 'AdminPortal1700000000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "admin_password_resets" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMP WITH TIME ZONE,
        "admin_id" uuid NOT NULL,
        "token_hash" character varying(64) NOT NULL,
        "expires_at" TIMESTAMP WITH TIME ZONE NOT NULL,
        "used_at" TIMESTAMP WITH TIME ZONE,
        CONSTRAINT "PK_f931ba04ff569afe74eb1be7018" PRIMARY KEY ("id")
      )`);
    await queryRunner.query(`CREATE INDEX "IDX_0f84a32429a381cf3f02eb4593" ON "admin_password_resets" ("deleted_at")`);
    await queryRunner.query(
      `CREATE INDEX "IDX_admin_password_resets_admin_id" ON "admin_password_resets" ("admin_id")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_admin_password_resets_token_hash" ON "admin_password_resets" ("token_hash")`,
    );
    await queryRunner.query(
      `ALTER TABLE "admin_password_resets" ADD CONSTRAINT "FK_admin_password_resets_admin_id" FOREIGN KEY ("admin_id") ` +
        `REFERENCES "admins"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );

    await queryRunner.query(`
      CREATE TABLE "admin_notifications" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMP WITH TIME ZONE,
        "admin_id" uuid NOT NULL,
        "title" character varying(200) NOT NULL,
        "description" text,
        "icon" character varying(100),
        "link" character varying(500),
        "read_at" TIMESTAMP WITH TIME ZONE,
        CONSTRAINT "PK_1fecd1cab747b7ab6e850091901" PRIMARY KEY ("id")
      )`);
    await queryRunner.query(`CREATE INDEX "IDX_d035fea9b5d1c78af4f5e1161b" ON "admin_notifications" ("deleted_at")`);
    await queryRunner.query(
      `CREATE INDEX "IDX_admin_notifications_admin_created" ON "admin_notifications" ("admin_id", "created_at")`,
    );
    await queryRunner.query(
      `ALTER TABLE "admin_notifications" ADD CONSTRAINT "FK_admin_notifications_admin_id" FOREIGN KEY ("admin_id") ` +
        `REFERENCES "admins"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "admin_notifications" DROP CONSTRAINT "FK_admin_notifications_admin_id"`);
    await queryRunner.query(`ALTER TABLE "admin_password_resets" DROP CONSTRAINT "FK_admin_password_resets_admin_id"`);
    await queryRunner.query(`DROP TABLE "admin_notifications"`);
    await queryRunner.query(`DROP TABLE "admin_password_resets"`);
  }
}
