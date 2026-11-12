import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { CreateDateColumn, DeleteDateColumn, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

/**
 * Shared columns for every table. Properties are camelCase (JSON too); the
 * SnakeNamingStrategy stores them as id / created_at / updated_at / deleted_at.
 *
 * `deletedAt` = soft delete: `softDelete()` fills it, normal queries skip the
 * row, `restore()` clears it. The admin "archive" view lists these rows.
 */
export abstract class BaseEntity {
  @ApiProperty({ format: 'uuid' })
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty()
  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @ApiProperty()
  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;

  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true })
  @Index()
  @DeleteDateColumn({ type: 'timestamptz', nullable: true })
  deletedAt?: Date | null;
}
