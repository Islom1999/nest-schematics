/** One email. `html` and/or `text` (send both: some clients only show text). */
export interface MailMessage {
  to: string | string[];
  subject: string;
  html?: string;
  text?: string;
  /** Overrides MAIL_FROM for this message. */
  from?: string;
  replyTo?: string;
}

/** One email provider (`log`, `resend`, `smtp`). Registered in `mail.transports.ts`. */
export interface MailTransport {
  readonly name: string;
  /** `message.from` is always set by MailService. Throws when the provider refuses the message. */
  send(message: MailMessage & { from: string }): Promise<void>;
}
