import { Tree } from '@angular-devkit/schematics';
import { addNamedImports, insertAtMarker, readText } from '../../utils/ops';

/** Marker above `@Controller()` in each provider webhook controller. */
export const PAYMENT_LOG_MARKER = '// @ns:payment-log';

/** Webhook controllers by provider (paths from the project root). */
export const PAYMENT_WEBHOOK_CONTROLLERS: Record<string, string> = {
  payme: 'apps/api/src/payments/payme/payme.controller.ts',
  click: 'apps/api/src/payments/click/click.controller.ts',
};

function prefixed(root: string, path: string): string {
  return root ? `${root}/${path}` : path;
}

/**
 * Puts `@LogPayment({ module: '<provider>' })` on every installed provider
 * webhook controller, so each callback lands in server_api_logs (masked)
 * whatever API_LOG_MODE is. Shared by both install orders:
 * - `payment` after `api-logs`: the payment add-on calls it;
 * - `api-logs` after `payment`: the api-logs add-on calls it.
 * Idempotent: a controller that has the decorator already is left alone, and
 * one without the marker is skipped.
 *
 * @returns the providers that got the decorator in this call.
 */
export function registerPaymentLogging(tree: Tree, root = ''): string[] {
  const added: string[] = [];
  for (const [provider, file] of Object.entries(PAYMENT_WEBHOOK_CONTROLLERS)) {
    const path = prefixed(root, file);
    if (!tree.exists(path)) continue;
    const text = readText(tree, path);
    if (text.includes('@LogPayment(') || !text.split('\n').some((l) => l.trim().startsWith(PAYMENT_LOG_MARKER))) continue;
    insertAtMarker(tree, path, PAYMENT_LOG_MARKER, `@LogPayment({ module: '${provider}' })`, '@LogPayment(');
    addNamedImports(tree, path, [{ name: 'LogPayment', from: '@app/common' }]);
    added.push(provider);
  }
  return added;
}
