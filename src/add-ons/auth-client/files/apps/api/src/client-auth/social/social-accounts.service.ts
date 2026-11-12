import { ConflictException, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { DeviceInfo } from '@app/common';
import { User } from '@app/database';
import { ClientAuthService } from '../client-auth.service';
import { isUniqueViolation } from '../client-auth.types';
import { ClientAuthResponseDto } from '../dto/client-auth.dto';
import { UserSessionsService } from '../user-sessions.service';
import { SocialProfile } from './id-token.verifier';

/** User columns that hold a provider's subject id. */
export type SocialSubKey = Extract<keyof User, 'googleSub' | 'appleSub'>;

/**
 * Finds or creates the user of a verified Google / Apple identity.
 *
 * 1. A user with this provider subject signs in.
 * 2. Otherwise, when the provider says the email is verified and an account
 *    with that email exists, the identity is linked to it. If that account's
 *    email was never verified, someone may have registered it in advance to
 *    take it over: its password is cleared and its sessions are ended before
 *    linking (the provider proved who owns the email).
 * 3. Otherwise a new user is created (the email is kept only when verified).
 */
@Injectable()
export class SocialAccountsService {
  private readonly logger = new Logger('SocialAccounts');

  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly auth: ClientAuthService,
    private readonly sessions: UserSessionsService,
  ) {}

  async signIn(key: SocialSubKey, profile: SocialProfile, device: DeviceInfo, name?: string): Promise<ClientAuthResponseDto> {
    const linked = await this.findBySub(key, profile.sub);
    if (linked) return this.auth.startSession(linked, device);

    if (profile.email && profile.emailVerified) {
      const existing = await this.users.findOne({ where: { email: profile.email } });
      if (existing) {
        if (existing[key]) throw new ConflictException('This email belongs to an account linked to another login');
        await this.link(existing, key, profile.sub);
        existing[key] = profile.sub;
        existing.emailVerified = true;
        return this.auth.startSession(existing, device);
      }
    }

    const patch: Partial<User> = {
      name: (name ?? profile.name ?? '').slice(0, 120),
      email: profile.emailVerified ? profile.email : null,
      emailVerified: profile.emailVerified,
    };
    patch[key] = profile.sub;
    try {
      const user = await this.users.save(this.users.create(patch));
      return this.auth.startSession(user, device, true);
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      // Two first sign-ins racing: the other request created the account.
      const user = await this.findBySub(key, profile.sub);
      if (!user) throw new ConflictException('This email is already used by another account');
      return this.auth.startSession(user, device);
    }
  }

  private findBySub(key: SocialSubKey, sub: string): Promise<User | null> {
    return this.users.createQueryBuilder('user').where(`user.${key} = :sub`, { sub }).getOne();
  }

  private async link(user: User, key: SocialSubKey, sub: string): Promise<void> {
    if (!user.emailVerified) {
      if (this.users.metadata.findColumnWithPropertyName('passwordHash')) {
        await this.users.query('UPDATE "users" SET "password_hash" = NULL WHERE "id" = $1', [user.id]);
      }
      await this.sessions.revokeAll(user.id, 'revoked');
      await this.auth.invalidateUser(user.id);
      this.logger.warn(`Unverified account ${user.id} was claimed by a verified ${key} identity; password and sessions cleared`);
    }
    const patch: Partial<User> = { emailVerified: true };
    patch[key] = sub;
    await this.users.update(user.id, patch);
  }
}
