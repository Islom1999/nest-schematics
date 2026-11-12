export interface Schema {
  /** Payment provider to add (positional): `payme` or `click`. */
  provider?: 'payme' | 'click';
  /**
   * `wallet` (default on the first run): balances topped up by payments;
   * `order`: pay your own PaymentTarget; `both`. Modes add up across runs.
   */
  mode?: 'wallet' | 'order' | 'both';
  /** Overwrite generated files that you have edited. */
  force?: boolean;
  /** Do not run npm install. */
  skipInstall?: boolean;
  /** Project directory relative to the current directory. */
  root?: string;
}
