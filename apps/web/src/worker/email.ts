type TransactionalEmailDetail = {
  label: string;
  value: string;
};

type TransactionalEmailInput = {
  to: string;
  toName?: string | null;
  subject: string;
  heading: string;
  body: string;
  actionLabel: string;
  actionUrl: string;
  footer?: string;
  tag?: string;
  details?: TransactionalEmailDetail[];
  logoUrl?: string;
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
  const heading = escapeHtml(input.heading);
  const body = escapeHtml(input.body);
  const actionLabel = escapeHtml(input.actionLabel);
  const actionUrl = escapeHtml(input.actionUrl);
  const footer = escapeHtml(input.footer ?? "Si no fuiste vos, podés ignorar este correo.");
  const logoUrl = escapeHtml(input.logoUrl ?? "https://huau.app/huau-email-logo.png");
  const details = input.details ?? [];
  const detailsHtml = details.length
    ? `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:0 0 24px;border-collapse:collapse">
${details.map((detail) => `          <tr>
            <td style="padding:8px 0;border-bottom:1px solid #ececec;font-size:13px;color:#777;vertical-align:top">${escapeHtml(detail.label)}</td>
            <td align="right" style="padding:8px 0;border-bottom:1px solid #ececec;font-size:13px;font-weight:700;color:#202020;vertical-align:top">${escapeHtml(detail.value)}</td>
          </tr>`).join("\n")}
        </table>`
    : "";

  return `<!doctype html>
<html lang="es">
  <head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${heading}</title></head>
  <body style="margin:0;background:#f4f4f4;font-family:Arial,Helvetica,sans-serif;color:#151515">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f4f4f4;padding:32px 16px">
      <tr><td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#fff;border-radius:16px;padding:32px">
          <tr><td>
            <img src="${logoUrl}" alt="HUAU" width="124" style="display:block;width:124px;max-width:124px;height:auto;margin:0 0 28px">
            <h1 style="font-size:26px;line-height:1.2;margin:0 0 16px;font-family:Arial,Helvetica,sans-serif">${heading}</h1>
            <p style="font-size:16px;line-height:1.6;margin:0 0 24px;color:#444">${body}</p>
            ${detailsHtml}
            <p style="margin:0 0 28px">
              <a href="${actionUrl}" style="display:inline-block;background:#111;color:#fff;text-decoration:none;font-weight:700;padding:13px 20px;border-radius:10px">${actionLabel}</a>
            </p>
            <p style="font-size:12px;line-height:1.5;color:#888;margin:0">${footer}</p>
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`;
}

export async function sendTransactionalEmail(
  env: Env,
  input: TransactionalEmailInput,
) {
  const apiKey = env.BREVO_API_KEY?.trim();
  if (!apiKey) throw new Error("BREVO_API_KEY_MISSING");

  const appBaseUrl = env.BETTER_AUTH_URL.replace(/\/$/, "");
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
      htmlContent: buildHuauEmailHtml({
        ...input,
        logoUrl: input.logoUrl ?? `${appBaseUrl}/huau-email-logo.png`,
      }),
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

export async function sendTransactionalEmailOnce(
  env: Env,
  input: {
    eventKey: string;
    kind: string;
    email: TransactionalEmailInput;
  },
) {
  const stamp = Math.floor(Date.now() / 1000);

  try {
    const initialClaim = await env.HUAU_DB.prepare(
      `INSERT OR IGNORE INTO email_dispatches
       (event_key,kind,recipient,status,provider_message_id,error_text,created_at,updated_at,sent_at)
       VALUES (?,?,?,'pending',NULL,NULL,?,?,NULL)`,
    ).bind(
      input.eventKey,
      input.kind,
      input.email.to.toLowerCase(),
      stamp,
      stamp,
    ).run();

    let claimed = Number(initialClaim.meta.changes ?? 0) > 0;
    if (!claimed) {
      const reclaim = await env.HUAU_DB.prepare(
        `UPDATE email_dispatches
            SET status='pending',error_text=NULL,updated_at=?
          WHERE event_key=?
            AND (status='failed' OR (status='pending' AND updated_at<?))`,
      ).bind(stamp, input.eventKey, stamp - 600).run();
      claimed = Number(reclaim.meta.changes ?? 0) > 0;
    }

    if (!claimed) return { sent: false, skipped: true as const };

    try {
      const result = await sendTransactionalEmail(env, input.email);
      await env.HUAU_DB.prepare(
        `UPDATE email_dispatches
            SET status='sent',provider_message_id=?,error_text=NULL,sent_at=?,updated_at=?
          WHERE event_key=?`,
      ).bind(result.messageId ?? null, stamp, stamp, input.eventKey).run();
      return { sent: true, skipped: false as const, messageId: result.messageId };
    } catch (error) {
      const message = error instanceof Error ? error.message : "EMAIL_SEND_FAILED";
      try {
        await env.HUAU_DB.prepare(
          `UPDATE email_dispatches
              SET status='failed',error_text=?,updated_at=?
            WHERE event_key=?`,
        ).bind(message.slice(0, 300), stamp, input.eventKey).run();
      } catch (trackingError) {
        console.error("Transactional email failure tracking failed", {
          eventKey: input.eventKey,
          kind: input.kind,
          error: trackingError instanceof Error ? trackingError.message : "EMAIL_TRACKING_FAILED",
        });
      }
      console.error("Transactional email dispatch failed", {
        eventKey: input.eventKey,
        kind: input.kind,
        error: message,
      });
      return { sent: false, skipped: false as const, error: message };
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "EMAIL_DISPATCH_CLAIM_FAILED";
    console.error("Transactional email claim failed", {
      eventKey: input.eventKey,
      kind: input.kind,
      error: message,
    });
    return { sent: false, skipped: false as const, error: message };
  }
}
