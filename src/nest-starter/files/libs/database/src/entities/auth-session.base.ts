import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Column } from 'typeorm';
import { BaseEntity } from '../base.entity';

/**
 * Columns shared by every login session table (`admin_sessions`, and
 * `user_sessions` from the auth-client add-on). One row = one signed-in
 * device. The refresh token is stored only as a sha256 hash and is rotated
 * on every refresh; access tokens are never stored.
 *
 * Abstract (no `@Entity`): a concrete session entity extends it and adds its
 * owner relation and its own indexes (index names are per table).
 */
export abstract class AuthSessionBase extends BaseEntity {
  /** sha256 (hex) of the current refresh token. Never selected by default, never sent to clients. */
  @Column({ type: 'varchar', length: 64, select: false })
  refreshHash: string;

  @ApiPropertyOptional({ type: String, nullable: true, description: 'x-device-id header' })
  @Column({ type: 'varchar', length: 200, nullable: true })
  deviceId: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, description: 'x-device-name header' })
  @Column({ type: 'varchar', length: 200, nullable: true })
  deviceName: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, description: 'x-platform header (web, ios, android...)' })
  @Column({ type: 'varchar', length: 50, nullable: true })
  platform: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, description: 'x-os header, or parsed from the user agent' })
  @Column({ type: 'varchar', length: 100, nullable: true })
  os: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, description: 'x-app-version header' })
  @Column({ type: 'varchar', length: 50, nullable: true })
  appVersion: string | null;

  @ApiProperty({ example: '203.0.113.7' })
  @Column({ type: 'varchar', length: 64, default: '' })
  ip: string;

  @ApiProperty()
  @Column({ type: 'varchar', length: 512, default: '' })
  userAgent: string;

  @ApiProperty()
  @Column({ type: 'timestamptz', default: () => 'now()' })
  lastUsedAt: Date;

  @ApiProperty({ description: 'Refresh token expiry; moved forward on every refresh' })
  @Column({ type: 'timestamptz' })
  expiresAt: Date;

  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true })
  @Column({ type: 'timestamptz', nullable: true })
  revokedAt: Date | null;

  @ApiPropertyOptional({ type: String, nullable: true, example: 'sign_out' })
  @Column({ type: 'varchar', length: 50, nullable: true })
  revokeReason: string | null;
}
