/** `abcdef…wxyz`: enough to tell two devices apart, useless as a token. Short tokens are hidden entirely. */
export function maskToken(token: string): string {
  return token.length > 16 ? `${token.slice(0, 6)}…${token.slice(-4)}` : '…';
}
