/** The fields of a Firebase service account that firebase-admin's `cert()` needs. */
export interface FirebaseServiceAccount {
  projectId: string;
  clientEmail: string;
  privateKey: string;
}

/**
 * Parses FIREBASE_SERVICE_ACCOUNT_JSON: the service account JSON itself, or
 * the same JSON base64-encoded (easier to put in one env line). Error messages
 * never contain the value.
 */
export function parseServiceAccount(raw: string): FirebaseServiceAccount {
  const value = raw.trim();
  const text = value.startsWith('{') ? value : Buffer.from(value, 'base64').toString('utf8');
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error('not valid JSON (raw or base64-encoded service account JSON expected)');
  }
  const account = (json ?? {}) as Record<string, unknown>;
  const field = (snake: string, camel: string): string => {
    const v = account[snake] ?? account[camel];
    return typeof v === 'string' ? v.trim() : '';
  };
  const projectId = field('project_id', 'projectId');
  const clientEmail = field('client_email', 'clientEmail');
  // Keys pasted through some shells keep their newlines escaped.
  const privateKey = field('private_key', 'privateKey').replace(/\\n/g, '\n');
  const missing = [
    ['project_id', projectId],
    ['client_email', clientEmail],
    ['private_key', privateKey],
  ]
    .filter(([, v]) => !v)
    .map(([k]) => k);
  if (missing.length) throw new Error(`missing ${missing.join(', ')}`);
  return { projectId, clientEmail, privateKey };
}
