/**
 * Small email templates without a template engine: plain functions that
 * return `{ subject, html, text }`. Values are HTML-escaped; add your own
 * functions next to these (or edit `mailLayout` for branding).
 */
export interface RenderedMail {
  subject: string;
  html: string;
  text: string;
}

const HTML_ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]);
}

/** Wraps body HTML in a simple, inline-styled layout that renders in every mail client. */
export function mailLayout(title: string, bodyHtml: string, footer = ''): string {
  return `<!doctype html>
<html>
  <body style="margin:0;padding:24px;background:#f4f4f5;font-family:Arial,Helvetica,sans-serif;color:#18181b">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      <tr><td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:8px;padding:32px">
          <tr><td>
            <h1 style="margin:0 0 16px;font-size:20px">${escapeHtml(title)}</h1>
            ${bodyHtml}
          </td></tr>
        </table>
        ${footer ? `<p style="color:#71717a;font-size:12px;margin-top:16px">${escapeHtml(footer)}</p>` : ''}
      </td></tr>
    </table>
  </body>
</html>`;
}

function paragraphs(lines: string[]): string {
  return lines.map((l) => `<p style="margin:0 0 12px;line-height:1.5">${escapeHtml(l)}</p>`).join('\n');
}

export interface CodeMailOptions {
  subject: string;
  title: string;
  intro: string;
  code: string;
  /** Shown under the code, e.g. 15 → "The code expires in 15 minutes." */
  expiresInMinutes?: number;
  outro?: string;
}

/** A one-time code (sign-in, password reset, email confirmation). */
export function codeMail(options: CodeMailOptions): RenderedMail {
  const expiry = options.expiresInMinutes ? `The code expires in ${options.expiresInMinutes} minutes.` : '';
  const outro = options.outro ?? 'If you did not request this, you can ignore this email.';
  const html = mailLayout(
    options.title,
    `${paragraphs([options.intro])}
            <p style="margin:24px 0;font-size:28px;font-weight:bold;letter-spacing:6px">${escapeHtml(options.code)}</p>
            ${paragraphs([expiry, outro].filter(Boolean))}`,
  );
  const text = [options.title, '', options.intro, '', options.code, '', expiry, outro].filter((l, i, a) => l || a[i - 1]).join('\n');
  return { subject: options.subject, html, text };
}

export interface ActionMailOptions {
  subject: string;
  title: string;
  intro: string;
  actionText: string;
  actionUrl: string;
  outro?: string;
}

/** A message with one button (confirm, open, reset). */
export function actionMail(options: ActionMailOptions): RenderedMail {
  const html = mailLayout(
    options.title,
    `${paragraphs([options.intro])}
            <p style="margin:24px 0"><a href="${escapeHtml(options.actionUrl)}" style="background:#4f46e5;color:#ffffff;padding:12px 20px;border-radius:6px;text-decoration:none;display:inline-block">${escapeHtml(options.actionText)}</a></p>
            ${options.outro ? paragraphs([options.outro]) : ''}`,
  );
  const text = [options.title, '', options.intro, '', `${options.actionText}: ${options.actionUrl}`, '', options.outro ?? '']
    .join('\n')
    .trim();
  return { subject: options.subject, html, text };
}
