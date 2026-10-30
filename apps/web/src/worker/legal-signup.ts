import { HUAU_PRIVACY_VERSION, HUAU_TERMS_VERSION } from "../HuauLegalVersions";

/* No collection of private home addresses. Server-side signup acknowledgement trail. */
const respond = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
});

const normalize = (email: unknown): string => typeof email === "string" ? email.trim().toLowerCase() : "";
const goodEmail = (email: string) => email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
const now = () => Math.floor(Date.now() / 1000);

export async function createLegalSignupIntent(request: Request, env: Env): Promise<Response> {
  const payload = await request.json().catch(() => null) as Record<string, unknown> | null;
  const email = normalize(payload?.email);
  const role = payload?.accountRole;
  if (!goodEmail(email) || payload?.acceptTerms !== true || payload?.acknowledgePrivacy !== true ||
      payload?.termsVersion !== HUAU_TERMS_VERSION || payload?.privacyVersion !== HUAU_PRIVACY_VERSION ||
      (role !== "adult" && role !== "guardian") || (role === "guardian" && payload?.guardianAttested !== true)) {
    return respond({ ok: false, code: "LEGAL_ACCEPTANCE_REQUIRED" }, 400);
  }
  const stamp = now();
  // Delete expired, unredeemed signup attempts after a brief grace period.
  await env.HUAU_DB.prepare(
    `DELETE FROM legal_signup_acceptances WHERE status='pending' AND expires_at < ?`,
  ).bind(stamp - 86400).run();
  const volume = await env.HUAU_DB.prepare(
    `SELECT COUNT(*) AS n FROM legal_signup_acceptances WHERE email=? AND created_at>?`,
  ).bind(email, stamp - 3600).first<{ n: number }>();
  if (Number(volume?.n ?? 0) >= 10) return respond({ ok: false, code: "LEGAL_ACCEPTANCE_RATE_LIMIT" }, 429);
  const token = crypto.randomUUID();
  await env.HUAU_DB.prepare(
    `INSERT INTO legal_signup_acceptances
      (id,email,terms_version,privacy_version,account_role,guardian_attested,accepted_at,created_at,expires_at,status)
     VALUES (?,?,?,?,?,?,?,?,?,'pending')`,
  ).bind(token,email,HUAU_TERMS_VERSION,HUAU_PRIVACY_VERSION,role,role === "guardian" ? 1 : 0,stamp,stamp,stamp + 900).run();
  return respond({ ok: true, token, termsVersion: HUAU_TERMS_VERSION, privacyVersion: HUAU_PRIVACY_VERSION });
}

/** Recover a persisted acceptance after an otherwise successful sign-up.
 * Verify the matching account creation window to avoid linking older users.
 */
export async function reconcileLegalSignupAcceptance(userId: string, emailInput: string, env: Env): Promise<void> {
  const email = normalize(emailInput);
  if (!userId || !goodEmail(email)) return;
  const user = await env.HUAU_DB.prepare(
    `SELECT id, created_at as createdAt FROM "user" WHERE id=? AND lower(email)=? LIMIT 1`,
  ).bind(userId,email).first<{ id:string; createdAt:number }>();
  if (!user || !Number.isFinite(Number(user.createdAt))) return;
  const createdAt=Number(user.createdAt);
  await env.HUAU_DB.prepare(
    `UPDATE legal_signup_acceptances SET status='recorded',user_id=?,recorded_at=?
     WHERE email=? AND status='started' AND accepted_at<=? AND expires_at>=?`,
  ).bind(userId,now(),email,createdAt+5,createdAt).run();
}

/** If Better Auth did not succeed, release unused intents only after checking whether
 * a matching new user was actually inserted. Preserve evidence during DB outages.
 */
async function settleFailedSignup(env: Env, email: string, token: string, startedAt: number): Promise<void> {
  try {
    const user = await env.HUAU_DB.prepare(
      `SELECT id FROM "user" WHERE lower(email)=? AND created_at>=? AND created_at<=? LIMIT 1`,
    ).bind(email,startedAt-5,now()+5).first<{id:string}>();
    if (user?.id) {
      await env.HUAU_DB.prepare(
        `UPDATE legal_signup_acceptances SET status='recorded',user_id=?,recorded_at=?
         WHERE id=? AND email=? AND status='started'`,
      ).bind(user.id,now(),token,email).run();
    } else {
      await env.HUAU_DB.prepare(
        `UPDATE legal_signup_acceptances SET status='pending',started_at=NULL
         WHERE id=? AND email=? AND status='started'`,
      ).bind(token,email).run();
    }
  } catch {
    console.error("HUAU legal signup: could not settle incomplete authentication");
  }
}

/** Wrap Better Auth's existing email signup; all successful new signups require an auditable server-side intent. */
export async function signupWithLegalAcceptance(request: Request, env: Env, handler: (request: Request) => Promise<Response>): Promise<Response> {
  const input = await request.clone().json().catch(() => null) as Record<string,unknown> | null;
  const email = normalize(input?.email);
  const token = request.headers.get("x-huau-legal-token")?.trim() ?? "";
  if (!goodEmail(email) || !/^[0-9a-f-]{36}$/i.test(token)) return respond({ ok:false,code:"LEGAL_ACCEPTANCE_REQUIRED" },400);
  const stamp = now();
  const claim = await env.HUAU_DB.prepare(
    `UPDATE legal_signup_acceptances SET status='started', started_at=?
       WHERE id=? AND email=? AND status='pending' AND expires_at>=?
         AND terms_version=? AND privacy_version=?`,
  ).bind(stamp, token, email, stamp, HUAU_TERMS_VERSION, HUAU_PRIVACY_VERSION).run();
  if (Number(claim.meta.changes ?? 0) !== 1) return respond({ ok:false,code:"LEGAL_ACCEPTANCE_INVALID_OR_EXPIRED" },409);
  let response: Response;
  try { response = await handler(request); }
  catch (error) {
    await settleFailedSignup(env,email,token,stamp);
    throw error;
  }
  if (!response.ok) {
    await settleFailedSignup(env,email,token,stamp);
    return response;
  }
  const data = await response.clone().json().catch(() => null) as { user?: { id?: string; email?: string } } | null;
  try {
    let userId = typeof data?.user?.id === "string" && normalize(data.user.email) === email ? data.user.id : "";
    if (!userId) {
      const created = await env.HUAU_DB.prepare(
        `SELECT id FROM "user" WHERE lower(email)=? AND created_at>=? AND created_at<=? LIMIT 1`,
      ).bind(email,stamp-5,now()+5).first<{id:string}>();
      userId=created?.id??"";
    }
    if (!userId) throw new Error("AUDIT_USER_NOT_FOUND");
    const recorded = await env.HUAU_DB.prepare(
      `UPDATE legal_signup_acceptances SET status='recorded',user_id=?,recorded_at=?
       WHERE id=? AND email=? AND status='started'`,
    ).bind(userId,now(),token,email).run();
    if (Number(recorded.meta.changes??0)!==1) throw new Error("AUDIT_LINK_FAILED");
  } catch {
    // The immutable acknowledgement was persisted BEFORE Better Auth ran.
    // Never return a false signup failure after the user has been created.
    console.error("HUAU legal signup: account created; audit linkage deferred");
  }
  return response;
}
