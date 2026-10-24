import { afterEach, describe, expect, it, vi } from "vitest";
import { buildHuauEmailHtml, sendTransactionalEmail, sendTransactionalEmailOnce } from "./email";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("HUAU transactional email", () => {
  it("uses the HUAU logo, no eyebrow label, and escapes copy", () => {
    const html = buildHuauEmailHtml({
      to: "player@example.com",
      subject: "Test",
      heading: "<script>alert(1)</script>",
      body: "A&B",
      actionLabel: "Abrir",
      actionUrl: "https://huau.app/?a=1&b=2",
      details: [{ label: "Torneo", value: "Open <HUAU>" }],
    });
    expect(html).toContain('src="https://huau.app/huau-email-logo.png"');
    expect(html).not.toContain("HUAU ·");
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).toContain("A&amp;B");
    expect(html).toContain("a=1&amp;b=2");
    expect(html).toContain("Open &lt;HUAU&gt;");
  });

  it("sends the expected Brevo payload", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ messageId: "message-1" }), {
        status: 201,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await sendTransactionalEmail({
      BREVO_API_KEY: "test-secret",
      BREVO_FROM_EMAIL: "no-reply@huau.app",
      BREVO_FROM_NAME: "HUAU",
      BETTER_AUTH_URL: "https://huau.app",
    } as Env, {
      to: "player@example.com",
      toName: "Jugador",
      subject: "Confirmá tu email",
      heading: "Confirmá tu email",
      body: "Probando HUAU.",
      actionLabel: "Confirmar",
      actionUrl: "https://huau.app/verify",
      tag: "huau-test",
    });

    expect(result.messageId).toBe("message-1");
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://api.brevo.com/v3/smtp/email");
    expect(init.headers["api-key"]).toBe("test-secret");
    const payload = JSON.parse(String(init.body));
    expect(payload.sender).toEqual({ name: "HUAU", email: "no-reply@huau.app" });
    expect(payload.to).toEqual([{ email: "player@example.com", name: "Jugador" }]);
    expect(payload.tags).toEqual(["huau-test"]);
    expect(payload.htmlContent).toContain("https://huau.app/huau-email-logo.png");
  });

  it("fails closed when Brevo is missing", async () => {
    await expect(sendTransactionalEmail({
      BETTER_AUTH_URL: "https://huau.app",
    } as Env, {
      to: "player@example.com",
      subject: "Test",
      heading: "Test",
      body: "Test",
      actionLabel: "Abrir",
      actionUrl: "https://huau.app",
    })).rejects.toThrow("BREVO_API_KEY_MISSING");
  });

  it("never breaks the business action when dispatch tracking is unavailable", async () => {
    const result = await sendTransactionalEmailOnce({
      HUAU_DB: {
        prepare: () => {
          throw new Error("D1_UNAVAILABLE");
        },
      },
    } as unknown as Env, {
      eventKey: "registration-created:test",
      kind: "tournament_registration_created",
      email: {
        to: "player@example.com",
        subject: "Test",
        heading: "Test",
        body: "Test",
        actionLabel: "Abrir",
        actionUrl: "https://huau.app",
      },
    });

    expect(result.sent).toBe(false);
    expect(result.skipped).toBe(false);
    expect(result.error).toBe("D1_UNAVAILABLE");
  });
});
