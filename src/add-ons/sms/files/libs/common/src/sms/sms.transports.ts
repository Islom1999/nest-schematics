import { ConfigService } from '@nestjs/config';
import { LogSmsTransport } from './log-sms.transport';
import { SmsTransport } from './sms.types';

/** Builds a transport from `.env`; returns null when its settings are missing. */
export type SmsTransportFactory = (config: ConfigService) => SmsTransport | null;

/**
 * Installed transports by SMS_PROVIDER value. `npm run g -- sms <provider>`
 * adds its entry above the marker.
 */
export const SMS_TRANSPORTS: Record<string, SmsTransportFactory> = {
  log: () => new LogSmsTransport(),
  // @ns:sms-transports
};
