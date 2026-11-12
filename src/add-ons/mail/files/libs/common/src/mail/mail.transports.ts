import { ConfigService } from '@nestjs/config';
import { LogMailTransport } from './log-mail.transport';
import { MailTransport } from './mail.types';

/** Builds a transport from `.env`; returns null when its settings are missing. */
export type MailTransportFactory = (config: ConfigService) => MailTransport | null;

/**
 * Installed transports by MAIL_PROVIDER value. `npm run g -- mail <provider>`
 * adds its entry above the marker.
 */
export const MAIL_TRANSPORTS: Record<string, MailTransportFactory> = {
  log: () => new LogMailTransport(),
  // @ns:mail-transports
};
