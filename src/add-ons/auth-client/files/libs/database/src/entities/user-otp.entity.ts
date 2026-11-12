import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * One-time codes of the client auth (phone sign-in, password reset). Only an
 * HMAC of the code is stored; a code is single use, expires quickly and is
 * dropped after a few wrong attempts. Kept in the database (not in memory) so
 * limits hold across several API instances.
 */
@Entity('user_otps')
@Index('IDX_user_otps_target', ['target', 'purpose', 'createdAt'])
@Index('IDX_user_otps_expires_at', ['expiresAt'])
export class UserOtp {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  /** `phone_sign_in`, `password_reset`. */
  @Column({ type: 'varchar', length: 30 })
  purpose: string;

  /** Normalised phone or email the code was sent to. */
  @Column({ type: 'varchar', length: 254 })
  target: string;

  @Column({ type: 'varchar', length: 64 })
  codeHash: string;

  @Column({ type: 'integer', default: 0 })
  attempts: number;

  @Column({ type: 'timestamptz' })
  expiresAt: Date;

  @Column({ type: 'timestamptz', nullable: true })
  consumedAt: Date | null;

  /** IP that requested the code. */
  @Column({ type: 'varchar', length: 64, default: '' })
  ip: string;
}
