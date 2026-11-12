import { readFileSync } from 'fs';
import { join } from 'path';
import * as ts from 'typescript';
import { runInNewContext } from 'vm';

/** The generated libs/common/src/logging/mask.ts, compiled and loaded (it has no imports). */
function loadMask(): {
  MASK: string;
  secretKeyMatcher: (keys: string[]) => (key: string) => boolean;
  maskSecrets: (value: unknown, isSecret: (key: string) => boolean) => unknown;
  limitSize: (value: unknown, max: number) => unknown;
  maskUrl: (url: string, isSecret: (key: string) => boolean) => string;
} {
  const source = readFileSync(join(__dirname, 'files/libs/common/src/logging/mask.ts'), 'utf-8');
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } });
  const module = { exports: {} as Record<string, unknown> };
  runInNewContext(js.outputText, { module, exports: module.exports, Buffer, ArrayBuffer, URLSearchParams, WeakSet, Set, Number, Object, Array, JSON, String, Date });
  return module.exports as never;
}

describe('api-logs mask.ts (generated code)', () => {
  const m = loadMask();
  const isSecret = m.secretKeyMatcher([
    'password', 'passwordHash', 'token', 'accessToken', 'refreshToken', 'otp', 'code', 'secret', 'card', 'cardNumber', 'cvv', 'authorization', 'pinfl',
  ]);

  it('masks secret keys at any depth, case and separator insensitive', () => {
    const body = {
      email: 'a@b.c',
      password: 'p',
      profile: { newPassword: 'x', refresh_token: 'r', countryCode: 'UZ', code: '1234', PINFL: '123' },
      cards: [{ card_number: '8600', CVV: '123', holder: 'A' }],
      Authorization: 'Bearer t',
      clientSecret: 's',
      empty: { otp: '' },
    };
    expect(m.maskSecrets(body, isSecret)).toEqual({
      email: 'a@b.c',
      password: '***',
      profile: { newPassword: '***', refresh_token: '***', countryCode: 'UZ', code: '***', PINFL: '***' },
      cards: [{ card_number: '***', CVV: '***', holder: 'A' }],
      Authorization: '***',
      clientSecret: '***',
      empty: { otp: '' },
    });
    expect(body.password).toBe('p');
  });

  it('survives cycles, binary data and huge arrays', () => {
    const a: Record<string, unknown> = { name: 'a', file: Buffer.from('abc') };
    a['self'] = a;
    const out = m.maskSecrets({ a, list: Array.from({ length: 150 }, (_, i) => i) }, isSecret) as {
      a: Record<string, unknown>;
      list: unknown[];
    };
    expect(out.a['self']).toBe('[circular]');
    expect(out.a['file']).toBe('[binary 3 bytes]');
    expect(out.list.length).toBe(101);
    expect(out.list[100]).toBe('[+50 more]');
  });

  it('truncates large bodies to valid JSON with a preview', () => {
    expect(m.limitSize({ a: 1 }, 100)).toEqual({ a: 1 });
    const big = m.limitSize({ text: 'x'.repeat(500) }, 100) as { _truncated: boolean; size: number; preview: string };
    expect(big._truncated).toBeTrue();
    expect(big.size).toBe(511);
    expect(big.preview.length).toBe(100);
  });

  it('masks secret query parameters', () => {
    expect(m.maskUrl('/api/x?token=abc&page=2', isSecret)).toBe('/api/x?token=***&page=2');
    expect(m.maskUrl('/api/x?page=2', isSecret)).toBe('/api/x?page=2');
  });
});
