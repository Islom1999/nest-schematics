import { maskToken } from './push-token-mask';

describe('maskToken', () => {
  it('keeps the first 6 and the last 4 characters of a long token', () => {
    const token = 'dQw4w9WgXcQ:APA91bHunWRjJx0aZ_secret_tail';
    const masked = maskToken(token);
    expect(masked).toBe('dQw4w9…tail');
    expect(masked).not.toContain('secret');
  });

  it('hides a short token completely', () => {
    expect(maskToken('short-token')).toBe('…');
    expect(maskToken('')).toBe('…');
  });
});
