type TransactionalEmailInput = {
  to: string;
  toName?: string | null;
  subject: string;
  eyebrow?: string;
  heading: string;
  body: string;
  actionLabel: string;
  actionUrl: string;
  footer?: string;
  tag?: string;
};

const BREVO_ENDPOINT = "https://api.brevo.com/v3/smtp/email";

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export function buildHuauEmailHtml(input: TransactionalEmailInput) {
  const eyebrow = escapeHtml(input.eyebrow ?? "HUAU");
  const heading = escapeHtml(input.heading);
  const body = escapeHtml(input.body);
  const actionLabel = escapeHtml(input.actionLabel);
  const actionUrl = escapeHtml(input.actionUrl);
  const footer = escapeHtml(input.footer ?? "Si no fuiste vos, podés ignorar este correo.");

  return `<!doctype html>
<html lang="es">
  <head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${heading}</title></head>
  <body style="margin:0;background:#f4f4f4;font-family:Arial,Helvetica,sans-serif;color:#151515">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f4f4f4;padding:32px 16px">
      <tr><td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#fff;border-radius:16px;padding:32px">
          <tr><td>
            <div style="font-size:12px;font-weight:700;letter-spacing:.16em;color:#777;margin-bottom:16px">${eyebrow}</div>
            <h1 style="font-size:26px;line-height:1.2;margin:0 0 16px">${heading}</h1>
            <p style="font-size:16px;line-height:1.6;margin:0 0 24px;color:#444">${body}</p>
            <p style="margin:0 0 28px"><a href="${actionUrl}" style="display:inline-block;background:#111;color:#fff;text-decoration:none;font-weight:700;padding:13px 20px;border-radius:10px">${actionLabel}</a></p>
            <p style="font-size:12px;line-height:1.5;color:#888;margin:0">${footer}</p>
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`;
}

export async function sendTransactionalEmail(env: Env, input: TransactionalEmailInput) {
  const apiKey = env.BREVO_API_KEY?.trim();
  if (!apiKey) throw new Error("BREVO_API_KEY_MISSING");

  const response = await fetch(BREVO_ENDPOINT, {
    method: "POST",
    headers: {
      accept: "application/json",
      "api-key": apiKey,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      sender: {
        name: env.BREVO_FROM_NAME?.trim() || "HUAU",
        email: env.BREVO_FROM_EMAIL?.trim() || "no-reply@huau.app",
      },
      to: [{ email: input.to, ...(input.toName ? { name: input.toName } : {}) }],
      subject: input.subject,
      htmlContent: buildHuauEmailHtml(input),
      tags: [input.tag ?? "huau-transactional"],
    }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    console.error("Brevo transactional email failed", {
      status: response.status,
      detail: detail.slice(0, 300),
    });
    throw new Error("TRANSACTIONAL_EMAIL_SEND_FAILED");
  }

  return (await response.json().catch(() => ({}))) as { messageId?: string };
}
