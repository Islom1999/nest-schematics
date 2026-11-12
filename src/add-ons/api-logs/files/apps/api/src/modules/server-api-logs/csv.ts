/**
 * One CSV cell. Text that a spreadsheet would run as a formula (starts with
 * `=`, `+`, `-`, `@`, tab or carriage return) gets a leading `'`; the cell is
 * quoted when it holds a comma, quote or line break. Numbers and dates are
 * written as they are.
 */
export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'number' || typeof value === 'bigint' || typeof value === 'boolean') return String(value);
  let text = typeof value === 'string' ? value : JSON.stringify(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** One CSV line (CRLF, RFC 4180). */
export function csvRow(values: unknown[]): string {
  return `${values.map(csvCell).join(',')}\r\n`;
}
