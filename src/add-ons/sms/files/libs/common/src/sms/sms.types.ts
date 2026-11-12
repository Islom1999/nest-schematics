/** One SMS gateway (`log`, `eskiz`, ...). Registered in `sms.transports.ts`. */
export interface SmsTransport {
  readonly name: string;
  /** `phone` is E.164 (`+998901234567`). Throws when the gateway refuses the message. */
  send(phone: string, text: string): Promise<void>;
}
