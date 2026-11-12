import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Column, Entity, Generated, Index } from 'typeorm';
import { BaseEntity } from '../base.entity';

/**
 * Client app account (`npm run g -- auth-client`). Sessions (devices) live in
 * `user_sessions`. Columns of the sign-in methods (phone, email, googleSub...)
 * are added above the `@ns:user-columns` marker by the generator, each with a
 * migration; unique values are unique among rows that are not soft-deleted.
 */
@Entity('users')
@Index('UQ_users_account_no', ['accountNo'], { unique: true })
export class User extends BaseEntity {
  /** bigint comes back as a string (it can exceed Number.MAX_SAFE_INTEGER). */
  @ApiProperty({ type: String, example: '100000', description: 'Account number for payments (Payme, Click); starts at 100000' })
  @Column({ type: 'bigint' })
  @Generated('increment')
  accountNo: string;

  @ApiProperty({ example: 'Ali Valiyev' })
  @Column({ type: 'varchar', length: 120, default: '' })
  name: string;

  @ApiPropertyOptional({ type: String, nullable: true, example: 'uz' })
  @Column({ type: 'varchar', length: 10, nullable: true })
  language: string | null;

  @ApiProperty()
  @Column({ type: 'boolean', default: false })
  isBlocked: boolean;

  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true })
  @Column({ type: 'timestamptz', nullable: true })
  lastLoginAt: Date | null;
  // @ns:user-columns (sign-in method columns are added above this line)
}
