import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { MediaUploaderType } from '@app/database';
import { AuthService } from '../../auth';
import { tokenType, TusAuthService, TusUserAuthenticator } from './tus-auth.service';

/** Unsigned JWT-shaped token: only the `typ` routing is tested here, verification is mocked. */
function token(typ: string): string {
  const part = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${part({ alg: 'HS256' })}.${part({ sub: '1', typ })}.sig`;
}

describe('TusAuthService', () => {
  const admins = { authenticate: jest.fn() };
  const userAuth = jest.fn<Promise<{ id: string }>, [string]>();
  const users: TusUserAuthenticator = { authenticate: userAuth };

  beforeEach(() => jest.resetAllMocks());

  it('reads the typ claim without trusting it', () => {
    expect(tokenType(token('admin'))).toBe('admin');
    expect(tokenType('garbage')).toBeNull();
  });

  it('accepts admins with media_file.write and refuses the rest', async () => {
    const service = new TusAuthService(admins as unknown as AuthService);
    admins.authenticate.mockResolvedValue({ id: 'a1', permissions: ['media_file.write'] });
    await expect(service.authenticate(`Bearer ${token('admin')}`)).resolves.toEqual({ type: MediaUploaderType.ADMIN, id: 'a1' });
    admins.authenticate.mockResolvedValue({ id: 'a2', permissions: ['media_file.read'] });
    await expect(service.authenticate(`Bearer ${token('admin')}`)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.authenticate(undefined)).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(service.authenticate('Basic abc')).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('refuses user tokens without auth-client, accepts them with it', async () => {
    await expect(new TusAuthService(admins as unknown as AuthService).authenticate(`Bearer ${token('user')}`)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    userAuth.mockResolvedValue({ id: 'u1' });
    const service = new TusAuthService(admins as unknown as AuthService, users);
    await expect(service.authenticate(`Bearer ${token('user')}`)).resolves.toEqual({ type: MediaUploaderType.USER, id: 'u1' });
    expect(userAuth).toHaveBeenCalledWith(`Bearer ${token('user')}`);
    expect(admins.authenticate).not.toHaveBeenCalled();
  });
});
