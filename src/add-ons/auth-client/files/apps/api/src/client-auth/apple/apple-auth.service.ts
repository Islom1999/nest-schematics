import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DeviceInfo } from '@app/common';
import { ClientAuthResponseDto } from '../dto/client-auth.dto';
import { IdTokenDto } from '../social/id-token.dto';
import { IdTokenVerifier, parseList } from '../social/id-token.verifier';
import { SocialAccountsService } from '../social/social-accounts.service';

/**
 * Sign in with Apple: the app posts the `identityToken` from Apple.
 * `APPLE_CLIENT_IDS` lists the accepted audiences, comma separated: the iOS
 * bundle id and, for web / Android, the Services ID. Apple gives the user's
 * name only to the app and only on the first sign-in, so send it as `name`.
 */
@Injectable()
export class AppleAuthService {
  private readonly verifier: IdTokenVerifier;

  constructor(
    config: ConfigService,
    private readonly accounts: SocialAccountsService,
  ) {
    this.verifier = new IdTokenVerifier(
      {
        name: 'Apple',
        jwksUrl: 'https://appleid.apple.com/auth/keys',
        issuers: ['https://appleid.apple.com'],
        clientIdsEnv: 'APPLE_CLIENT_IDS',
      },
      parseList(config.get<string>('APPLE_CLIENT_IDS')),
    );
  }

  async signIn(dto: IdTokenDto, device: DeviceInfo): Promise<ClientAuthResponseDto> {
    const profile = await this.verifier.verify(dto.idToken, dto.nonce);
    return this.accounts.signIn('appleSub', profile, device, dto.name);
  }
}
