import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DeviceInfo } from '@app/common';
import { ClientAuthResponseDto } from '../dto/client-auth.dto';
import { IdTokenDto } from '../social/id-token.dto';
import { IdTokenVerifier, parseList } from '../social/id-token.verifier';
import { SocialAccountsService } from '../social/social-accounts.service';

/**
 * Google sign-in: the app gets an ID token from Google Sign-In (Android, iOS
 * or web) and posts it here. `GOOGLE_CLIENT_IDS` lists every OAuth client ID
 * of your apps (comma separated); the token's `aud` must be one of them.
 */
@Injectable()
export class GoogleAuthService {
  private readonly verifier: IdTokenVerifier;

  constructor(
    config: ConfigService,
    private readonly accounts: SocialAccountsService,
  ) {
    this.verifier = new IdTokenVerifier(
      {
        name: 'Google',
        jwksUrl: 'https://www.googleapis.com/oauth2/v3/certs',
        issuers: ['https://accounts.google.com', 'accounts.google.com'],
        clientIdsEnv: 'GOOGLE_CLIENT_IDS',
      },
      parseList(config.get<string>('GOOGLE_CLIENT_IDS')),
    );
  }

  async signIn(dto: IdTokenDto, device: DeviceInfo): Promise<ClientAuthResponseDto> {
    const profile = await this.verifier.verify(dto.idToken, dto.nonce);
    return this.accounts.signIn('googleSub', profile, device, dto.name);
  }
}
