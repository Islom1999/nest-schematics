/** Injection token of the optional `AdminMailer` (provided by the mail add-on). */
export const ADMIN_MAILER = 'ADMIN_MAILER';

export interface PasswordResetMail {
  to: string;
  name: string;
  /** The one-time token; `resetUrl` already contains it. */
  token: string;
  /** Link of the admin app's reset page: `<ADMIN_APP_URL>/reset-password?token=...`. */
  resetUrl: string;
  expiresInMinutes: number;
}

/**
 * Port for mail the admin auth needs to send. The `mail` add-on provides the
 * implementation under `ADMIN_MAILER` (in either install order); without it
 * AuthModule only logs a warning, so the project works with no mail at all.
 */
export interface AdminMailer {
  sendPasswordReset(mail: PasswordResetMail): Promise<void>;
}
