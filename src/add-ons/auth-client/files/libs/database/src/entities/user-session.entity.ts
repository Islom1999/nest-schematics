import { ApiProperty } from '@nestjs/swagger';
import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { AuthSessionBase } from './auth-session.base';
import { User } from './user.entity';

/**
 * One signed-in client device. Hard-deleting the user deletes its sessions.
 * The device's push token lives here, so a device that signs out (or is
 * revoked) stops receiving pushes.
 */
@Entity('user_sessions')
@Index('UQ_user_sessions_refresh_hash', ['refreshHash'], { unique: true })
@Index('IDX_user_sessions_user_id', ['userId'])
@Index('IDX_user_sessions_push_token', ['pushToken'])
export class UserSession extends AuthSessionBase {
  @ApiProperty({ format: 'uuid' })
  @Column({ type: 'uuid' })
  userId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id', foreignKeyConstraintName: 'FK_user_sessions_user_id' })
  user?: User;

  /** FCM / APNs token of this device (`PUT client/auth/push-token`). Not exposed in the API. */
  @Column({ type: 'text', nullable: true })
  pushToken: string | null;

  /** `ios`, `android` or `web`. */
  @Column({ type: 'varchar', length: 20, nullable: true })
  pushPlatform: string | null;
}
