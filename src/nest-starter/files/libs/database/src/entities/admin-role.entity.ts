import { ApiProperty } from '@nestjs/swagger';
import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '../base.entity';

/** Permission that grants everything (super admin). */
export const SUPER_PERMISSION = '*';

/**
 * A named set of permission keys (`<resource>.read|write`, see
 * PERMISSION_CATALOG in @app/common). `*` = every permission.
 */
@Entity('admin_roles')
@Index('UQ_admin_roles_name', ['name'], { unique: true, where: 'deleted_at IS NULL' })
export class AdminRole extends BaseEntity {
  @ApiProperty({ example: 'Content manager' })
  @Column({ type: 'varchar', length: 100 })
  name: string;

  @ApiProperty({ type: [String], example: ['product.read', 'product.write'] })
  @Column({ type: 'text', array: true, default: () => "'{}'" })
  permissions: string[];
}
