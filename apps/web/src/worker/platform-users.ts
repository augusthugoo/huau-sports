type PlatformUserSession = {
  id: string;
  email: string;
  name: string;
};

type PlatformUsersDeps = {
  requireUser: (request: Request, env: Env) => Promise<PlatformUserSession | null>;
  isPlatformAdmin: (userId: string, email: string, env: Env) => Promise<boolean>;
};

const json = (body: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body), {
    ...init,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...init.headers,
    },
  });

type UserRow = {
  id: string;
  name: string;
  email: string;
  createdAt: number;
  platformAdmin: number;
};

type ImpactRow = {
  registrations: number;
  paymentOrders: number;
  competitiveProfiles: number;
  organizationPeople: number;
  memberships: number;
  entries: number;
  invitations: number;
  files: number;
};

async function requirePlatformAdmin(
  request: Request,
  env: Env,
  deps: PlatformUsersDeps,
): Promise<PlatformUserSession | Response> {
  const currentUser = await deps.requireUser(request, env);
  if (!currentUser) return json({ ok: false, code: "UNAUTHENTICATED" }, { status: 401 });
  if (!(await deps.isPlatformAdmin(currentUser.id, currentUser.email, env))) {
    return json({ ok: false, code: "FORBIDDEN" }, { status: 403 });
  }
  return currentUser;
}

function isResponse(value: PlatformUserSession | Response): value is Response {
  return value instanceof Response;
}

async function loadTarget(userId: string, env: Env) {
  return env.HUAU_DB.prepare(
    `SELECT
       u.id,
       u.name,
       u.email,
       u.created_at AS createdAt,
       CASE WHEN pa.user_id IS NOT NULL AND pa.status='active' THEN 1 ELSE 0 END AS platformAdmin
     FROM "user" u
     LEFT JOIN platform_admins pa ON pa.user_id=u.id
     WHERE u.id=?
     LIMIT 1`,
  )
    .bind(userId)
    .first<UserRow>();
}

async function listUsers(request: Request, env: Env, url: URL, deps: PlatformUsersDeps) {
  const authorized = await requirePlatformAdmin(request, env, deps);
  if (isResponse(authorized)) return authorized;

  const q = (url.searchParams.get("q") ?? "").trim().slice(0, 120);
  const cursor = (url.searchParams.get("cursor") ?? "").trim().slice(0, 320);
  const limit = 26;

  const query = q
    ? env.HUAU_DB.prepare(
        `SELECT
           u.id,
           u.name,
           u.email,
           u.created_at AS createdAt,
           CASE WHEN pa.user_id IS NOT NULL AND pa.status='active' THEN 1 ELSE 0 END AS platformAdmin
         FROM "user" u
         LEFT JOIN platform_admins pa ON pa.user_id=u.id
         WHERE (u.email LIKE ? OR u.name LIKE ?)
           AND (?='' OR u.email>?)
         ORDER BY u.email ASC
         LIMIT ?`,
      ).bind(`%${q}%`, `%${q}%`, cursor, cursor, limit)
    : env.HUAU_DB.prepare(
        `SELECT
           u.id,
           u.name,
           u.email,
           u.created_at AS createdAt,
           CASE WHEN pa.user_id IS NOT NULL AND pa.status='active' THEN 1 ELSE 0 END AS platformAdmin
         FROM "user" u
         LEFT JOIN platform_admins pa ON pa.user_id=u.id
         WHERE (?='' OR u.email>?)
         ORDER BY u.email ASC
         LIMIT ?`,
      ).bind(cursor, cursor, limit);

  const result = await query.all<UserRow>();
  const rows = result.results ?? [];
  const hasMore = rows.length === limit;
  const visible = hasMore ? rows.slice(0, limit - 1) : rows;
  const last = visible.at(-1);

  return json({
    ok: true,
    users: visible.map((row) => ({
      ...row,
      platformAdmin: Number(row.platformAdmin) === 1,
    })),
    nextCursor: hasMore && last ? last.email : null,
  });
}

async function userImpact(
  request: Request,
  env: Env,
  userId: string,
  deps: PlatformUsersDeps,
) {
  const authorized = await requirePlatformAdmin(request, env, deps);
  if (isResponse(authorized)) return authorized;

  const target = await loadTarget(userId, env);
  if (!target) return json({ ok: false, code: "USER_NOT_FOUND" }, { status: 404 });

  const targetIsPlatformAdmin = await deps.isPlatformAdmin(target.id, target.email, env);
  const blockedReason =
    target.id === authorized.id
      ? "SELF_DELETE_FORBIDDEN"
      : targetIsPlatformAdmin
        ? "PLATFORM_ADMIN_PROTECTED"
        : null;

  const impact = await env.HUAU_DB.prepare(
    `WITH target(user_id,email) AS (VALUES (?,?))
     SELECT
       (SELECT COUNT(*) FROM tournament_registrations
         WHERE user_id=(SELECT user_id FROM target)) AS registrations,
       (SELECT COUNT(*) FROM payment_orders
         WHERE payer_user_id=(SELECT user_id FROM target)
            OR payer_email=(SELECT email FROM target)
            OR payer_profile_id IN (
              SELECT tpp.id
              FROM tournament_player_profiles tpp
              JOIN organization_people op ON op.id=tpp.organization_person_id
              WHERE op.user_id=(SELECT user_id FROM target)
                 OR op.email=(SELECT email FROM target)
            )) AS paymentOrders,
       (SELECT COUNT(*) FROM tournament_player_profiles
         WHERE organization_person_id IN (
           SELECT id FROM organization_people
           WHERE user_id=(SELECT user_id FROM target)
              OR email=(SELECT email FROM target)
         )) AS competitiveProfiles,
       (SELECT COUNT(*) FROM organization_people
         WHERE user_id=(SELECT user_id FROM target)
            OR email=(SELECT email FROM target)) AS organizationPeople,
       (SELECT COUNT(*) FROM organization_memberships
         WHERE user_id=(SELECT user_id FROM target)
            OR organization_person_id IN (
              SELECT id FROM organization_people
              WHERE user_id=(SELECT user_id FROM target)
                 OR email=(SELECT email FROM target)
            )) AS memberships,
       (SELECT COUNT(DISTINCT te.id)
          FROM tournament_entries te
          LEFT JOIN entry_members em ON em.entry_id=te.id
          LEFT JOIN organization_people op ON op.id=em.organization_person_id
         WHERE te.captain_user_id=(SELECT user_id FROM target)
            OR te.created_by_user_id=(SELECT user_id FROM target)
            OR em.invited_user_id=(SELECT user_id FROM target)
            OR op.user_id=(SELECT user_id FROM target)
            OR op.email=(SELECT email FROM target)) AS entries,
       ((SELECT COUNT(*) FROM registration_match_invitations
          WHERE inviter_user_id=(SELECT user_id FROM target)
             OR invitee_user_id=(SELECT user_id FROM target))
        +
        (SELECT COUNT(*) FROM entry_invitations
          WHERE inviter_user_id=(SELECT user_id FROM target)
             OR invitee_user_id=(SELECT user_id FROM target)
             OR invitee_email=(SELECT email FROM target))) AS invitations,
       (COALESCE((SELECT CASE WHEN avatar_r2_key IS NULL OR trim(avatar_r2_key)='' THEN 0 ELSE 1 END
          FROM user_profiles
          WHERE user_id=(SELECT user_id FROM target)
          LIMIT 1),0)
        +
        (SELECT COUNT(*)
          FROM payment_proofs pp
          JOIN payment_attempts pa ON pa.id=pp.attempt_id
          JOIN payment_orders po ON po.id=pa.order_id
          WHERE po.payer_user_id=(SELECT user_id FROM target)
             OR po.payer_email=(SELECT email FROM target)
             OR po.payer_profile_id IN (
               SELECT tpp.id
               FROM tournament_player_profiles tpp
               JOIN organization_people op ON op.id=tpp.organization_person_id
               WHERE op.user_id=(SELECT user_id FROM target)
                  OR op.email=(SELECT email FROM target)
             ))) AS files`,
  )
    .bind(target.id, target.email)
    .first<ImpactRow>();

  const empty: ImpactRow = {
    registrations: 0,
    paymentOrders: 0,
    competitiveProfiles: 0,
    organizationPeople: 0,
    memberships: 0,
    entries: 0,
    invitations: 0,
    files: 0,
  };

  return json({
    ok: true,
    user: { ...target, platformAdmin: targetIsPlatformAdmin },
    canDelete: blockedReason === null,
    blockedReason,
    impact: impact ?? empty,
  });
}

async function ownedR2Keys(target: UserRow, env: Env): Promise<string[]> {
  const result = await env.HUAU_DB.prepare(
    `SELECT avatar_r2_key AS objectKey
       FROM user_profiles
      WHERE user_id=?
        AND avatar_r2_key IS NOT NULL
        AND trim(avatar_r2_key)<>''
     UNION ALL
     SELECT pp.object_key AS objectKey
       FROM payment_proofs pp
       JOIN payment_attempts pa ON pa.id=pp.attempt_id
       JOIN payment_orders po ON po.id=pa.order_id
      WHERE po.payer_user_id=?
         OR po.payer_email=?
         OR po.payer_profile_id IN (
           SELECT tpp.id
           FROM tournament_player_profiles tpp
           JOIN organization_people op ON op.id=tpp.organization_person_id
           WHERE op.user_id=?
              OR op.email=?
         )`,
  )
    .bind(target.id, target.id, target.email, target.id, target.email)
    .all<{ objectKey: string }>();

  return Array.from(new Set((result.results ?? []).map((row) => row.objectKey).filter(Boolean)));
}

const targetPeopleSql =
  `SELECT id FROM organization_people WHERE user_id=? OR email=?`;

const targetOrdersSql =
  `SELECT po.id
     FROM payment_orders po
    WHERE po.payer_user_id=?
       OR po.payer_email=?
       OR po.payer_profile_id IN (
         SELECT tpp.id
         FROM tournament_player_profiles tpp
         JOIN organization_people op ON op.id=tpp.organization_person_id
         WHERE op.user_id=?
            OR op.email=?
       )`;

const deletableEntriesSql =
  `SELECT te.id
     FROM tournament_entries te
    WHERE (te.captain_user_id=? OR te.created_by_user_id=?)
      AND NOT EXISTS (SELECT 1 FROM entry_members em WHERE em.entry_id=te.id)
      AND NOT EXISTS (SELECT 1 FROM tournament_registrations tr WHERE tr.entry_id=te.id)`;

async function hardDeleteUser(
  request: Request,
  env: Env,
  userId: string,
  deps: PlatformUsersDeps,
) {
  const authorized = await requirePlatformAdmin(request, env, deps);
  if (isResponse(authorized)) return authorized;

  const target = await loadTarget(userId, env);
  if (!target) return json({ ok: false, code: "USER_NOT_FOUND" }, { status: 404 });
  if (target.id === authorized.id) {
    return json({ ok: false, code: "SELF_DELETE_FORBIDDEN" }, { status: 409 });
  }
  if (await deps.isPlatformAdmin(target.id, target.email, env)) {
    return json({ ok: false, code: "PLATFORM_ADMIN_PROTECTED" }, { status: 409 });
  }

  let body: { confirmEmail?: string } = {};
  try {
    body = (await request.json()) as { confirmEmail?: string };
  } catch {
    body = {};
  }
  if (body.confirmEmail !== target.email) {
    return json({ ok: false, code: "EMAIL_CONFIRMATION_MISMATCH" }, { status: 400 });
  }

  const r2Keys = await ownedR2Keys(target, env);
  const emailLike = `%${target.email}%`;

  const statements = [
    env.HUAU_DB.prepare(
      `DELETE FROM payment_events
        WHERE order_id IN (${targetOrdersSql})
           OR actor_user_id=?
           OR summary LIKE ?
           OR COALESCE(metadata_json,'') LIKE ?`,
    ).bind(
      target.id, target.email, target.id, target.email,
      target.id, emailLike, emailLike,
    ),
    env.HUAU_DB.prepare(
      `DELETE FROM critical_audit_events
        WHERE actor_user_id=?
           OR summary LIKE ?
           OR COALESCE(metadata_json,'') LIKE ?`,
    ).bind(target.id, emailLike, emailLike),
    env.HUAU_DB.prepare(
      `DELETE FROM registration_cancellation_requests
        WHERE requested_by_user_id=?
           OR registration_id IN (
             SELECT id FROM tournament_registrations WHERE user_id=?
           )`,
    ).bind(target.id, target.id),
    env.HUAU_DB.prepare(
      `UPDATE registration_cancellation_requests
          SET reviewed_by_user_id=NULL
        WHERE reviewed_by_user_id=?`,
    ).bind(target.id),
    env.HUAU_DB.prepare(
      `DELETE FROM payment_orders WHERE id IN (${targetOrdersSql})`,
    ).bind(target.id, target.email, target.id, target.email),
    env.HUAU_DB.prepare(
      `UPDATE payment_attempts
          SET submitted_by_user_id=CASE WHEN submitted_by_user_id=? THEN NULL ELSE submitted_by_user_id END,
              reviewed_by_user_id=CASE WHEN reviewed_by_user_id=? THEN NULL ELSE reviewed_by_user_id END
        WHERE submitted_by_user_id=? OR reviewed_by_user_id=?`,
    ).bind(target.id, target.id, target.id, target.id),
    env.HUAU_DB.prepare(
      `UPDATE payment_proofs SET uploaded_by_user_id=NULL WHERE uploaded_by_user_id=?`,
    ).bind(target.id),
    env.HUAU_DB.prepare(
      `UPDATE payment_refunds
          SET created_by_user_id=CASE WHEN created_by_user_id=? THEN ? ELSE created_by_user_id END,
              completed_by_user_id=CASE WHEN completed_by_user_id=? THEN NULL ELSE completed_by_user_id END
        WHERE created_by_user_id=? OR completed_by_user_id=?`,
    ).bind(target.id, authorized.id, target.id, target.id, target.id),
    env.HUAU_DB.prepare(
      `UPDATE payment_accounts SET created_by_user_id=? WHERE created_by_user_id=?`,
    ).bind(authorized.id, target.id),
    env.HUAU_DB.prepare(
      `UPDATE tournament_payment_settings SET updated_by_user_id=NULL WHERE updated_by_user_id=?`,
    ).bind(target.id),
    env.HUAU_DB.prepare(
      `DELETE FROM payment_oauth_states WHERE initiated_by_user_id=?`,
    ).bind(target.id),
    env.HUAU_DB.prepare(
      `DELETE FROM registration_match_invitations
        WHERE inviter_user_id=? OR invitee_user_id=?`,
    ).bind(target.id, target.id),
    env.HUAU_DB.prepare(
      `DELETE FROM entry_invitations
        WHERE inviter_user_id=? OR invitee_user_id=? OR invitee_email=?`,
    ).bind(target.id, target.id, target.email),
    env.HUAU_DB.prepare(
      `DELETE FROM registration_adjustments
        WHERE registration_id IN (
          SELECT id FROM tournament_registrations WHERE user_id=?
        )`,
    ).bind(target.id),
    env.HUAU_DB.prepare(
      `UPDATE registration_adjustments SET created_by_user_id=? WHERE created_by_user_id=?`,
    ).bind(authorized.id, target.id),
    env.HUAU_DB.prepare(
      `DELETE FROM tournament_wild_cards WHERE user_id=?`,
    ).bind(target.id),
    env.HUAU_DB.prepare(
      `UPDATE tournament_wild_cards SET created_by_user_id=? WHERE created_by_user_id=?`,
    ).bind(authorized.id, target.id),
    env.HUAU_DB.prepare(
      `DELETE FROM tournament_registrations WHERE user_id=?`,
    ).bind(target.id),
    env.HUAU_DB.prepare(
      `DELETE FROM match_side_members
        WHERE organization_person_id IN (${targetPeopleSql})`,
    ).bind(target.id, target.email),
    env.HUAU_DB.prepare(
      `DELETE FROM team_lineup_assignments
        WHERE organization_person_id IN (${targetPeopleSql})`,
    ).bind(target.id, target.email),
    env.HUAU_DB.prepare(
      `DELETE FROM entry_members
        WHERE invited_user_id=?
           OR organization_person_id IN (${targetPeopleSql})`,
    ).bind(target.id, target.id, target.email),
    env.HUAU_DB.prepare(
      `DELETE FROM tournament_player_profiles
        WHERE organization_person_id IN (${targetPeopleSql})`,
    ).bind(target.id, target.email),
    env.HUAU_DB.prepare(
      `UPDATE competition_encounters
          SET entry_a_id=NULL
        WHERE entry_a_id IN (${deletableEntriesSql})`,
    ).bind(target.id, target.id),
    env.HUAU_DB.prepare(
      `UPDATE competition_encounters
          SET entry_b_id=NULL
        WHERE entry_b_id IN (${deletableEntriesSql})`,
    ).bind(target.id, target.id),
    env.HUAU_DB.prepare(
      `UPDATE competition_encounters
          SET winner_entry_id=NULL
        WHERE winner_entry_id IN (${deletableEntriesSql})`,
    ).bind(target.id, target.id),
    env.HUAU_DB.prepare(
      `DELETE FROM tournament_entries WHERE id IN (${deletableEntriesSql})`,
    ).bind(target.id, target.id),
    env.HUAU_DB.prepare(
      `UPDATE tournament_entries
          SET captain_user_id=CASE WHEN captain_user_id=? THEN NULL ELSE captain_user_id END,
              created_by_user_id=CASE WHEN created_by_user_id=? THEN NULL ELSE created_by_user_id END
        WHERE captain_user_id=? OR created_by_user_id=?`,
    ).bind(target.id, target.id, target.id, target.id),
    env.HUAU_DB.prepare(
      `UPDATE tournaments SET created_by_user_id=? WHERE created_by_user_id=?`,
    ).bind(authorized.id, target.id),
    env.HUAU_DB.prepare(
      `UPDATE competition_format_versions SET created_by_user_id=? WHERE created_by_user_id=?`,
    ).bind(authorized.id, target.id),
    env.HUAU_DB.prepare(
      `UPDATE schedule_revisions SET created_by_user_id=? WHERE created_by_user_id=?`,
    ).bind(authorized.id, target.id),
    env.HUAU_DB.prepare(
      `UPDATE tournament_draw_sessions SET created_by_user_id=? WHERE created_by_user_id=?`,
    ).bind(authorized.id, target.id),
    env.HUAU_DB.prepare(
      `UPDATE tournament_mutations SET actor_user_id=? WHERE actor_user_id=?`,
    ).bind(authorized.id, target.id),
    env.HUAU_DB.prepare(
      `UPDATE tournament_snapshots SET created_by_user_id=NULL WHERE created_by_user_id=?`,
    ).bind(target.id),
    env.HUAU_DB.prepare(
      `UPDATE match_results SET entered_by_user_id=NULL WHERE entered_by_user_id=?`,
    ).bind(target.id),
    env.HUAU_DB.prepare(
      `UPDATE tournament_day_state SET created_by_user_id=NULL WHERE created_by_user_id=?`,
    ).bind(target.id),
    env.HUAU_DB.prepare(
      `DELETE FROM organization_membership_requests WHERE user_id=?`,
    ).bind(target.id),
    env.HUAU_DB.prepare(
      `UPDATE organization_membership_requests
          SET reviewed_by_user_id=NULL
        WHERE reviewed_by_user_id=?`,
    ).bind(target.id),
    env.HUAU_DB.prepare(
      `DELETE FROM organization_memberships
        WHERE user_id=?
           OR organization_person_id IN (${targetPeopleSql})`,
    ).bind(target.id, target.id, target.email),
    env.HUAU_DB.prepare(
      `DELETE FROM organization_user_capabilities WHERE user_id=?`,
    ).bind(target.id),
    env.HUAU_DB.prepare(
      `DELETE FROM organization_people WHERE user_id=? OR email=?`,
    ).bind(target.id, target.email),
    env.HUAU_DB.prepare(
      `DELETE FROM verification WHERE identifier=?`,
    ).bind(target.email),
    env.HUAU_DB.prepare(
      `DELETE FROM "user" WHERE id=?`,
    ).bind(target.id),
  ];

  await env.HUAU_DB.batch(statements);

  const audit = await env.HUAU_DB.prepare(
    `WITH target(user_id,email) AS (VALUES (?,?))
     SELECT
       (SELECT COUNT(*) FROM "user" WHERE id=(SELECT user_id FROM target))
       + (SELECT COUNT(*) FROM session WHERE user_id=(SELECT user_id FROM target))
       + (SELECT COUNT(*) FROM account WHERE user_id=(SELECT user_id FROM target))
       + (SELECT COUNT(*) FROM user_profiles WHERE user_id=(SELECT user_id FROM target))
       + (SELECT COUNT(*) FROM organization_people
           WHERE user_id=(SELECT user_id FROM target)
              OR email=(SELECT email FROM target))
       + (SELECT COUNT(*) FROM tournament_registrations
           WHERE user_id=(SELECT user_id FROM target))
       + (SELECT COUNT(*) FROM payment_orders
           WHERE payer_user_id=(SELECT user_id FROM target)
              OR payer_email=(SELECT email FROM target))
       + (SELECT COUNT(*) FROM tournament_entries
           WHERE captain_user_id=(SELECT user_id FROM target)
              OR created_by_user_id=(SELECT user_id FROM target))
       + (SELECT COUNT(*) FROM entry_invitations
           WHERE inviter_user_id=(SELECT user_id FROM target)
              OR invitee_user_id=(SELECT user_id FROM target)
              OR invitee_email=(SELECT email FROM target))
       + (SELECT COUNT(*) FROM registration_match_invitations
           WHERE inviter_user_id=(SELECT user_id FROM target)
              OR invitee_user_id=(SELECT user_id FROM target))
       + (SELECT COUNT(*) FROM verification
           WHERE identifier=(SELECT email FROM target))
       + (SELECT COUNT(*) FROM critical_audit_events
           WHERE actor_user_id=(SELECT user_id FROM target)
              OR summary LIKE '%' || (SELECT email FROM target) || '%'
              OR COALESCE(metadata_json,'') LIKE '%' || (SELECT email FROM target) || '%')
       + (SELECT COUNT(*) FROM payment_events
           WHERE actor_user_id=(SELECT user_id FROM target)
              OR summary LIKE '%' || (SELECT email FROM target) || '%'
              OR COALESCE(metadata_json,'') LIKE '%' || (SELECT email FROM target) || '%')
       AS remainingD1Traces`,
  )
    .bind(target.id, target.email)
    .first<{ remainingD1Traces: number }>();

  const failed: string[] = [];
  await Promise.all(
    r2Keys.map(async (key) => {
      try {
        await env.HUAU_ASSETS.delete(key);
      } catch {
        failed.push(key);
      }
    }),
  );

  const remainingD1Traces = Number(audit?.remainingD1Traces ?? 0);
  return json({
    ok: true,
    complete: remainingD1Traces === 0 && failed.length === 0,
    audit: { remainingD1Traces },
    r2: {
      deleted: r2Keys.length - failed.length,
      failed,
    },
  });
}

export async function handlePlatformUsersApi(
  request: Request,
  env: Env,
  url: URL,
  deps: PlatformUsersDeps,
): Promise<Response | null> {
  if (url.pathname === "/api/platform/users" && request.method === "GET") {
    return listUsers(request, env, url, deps);
  }

  const impact = url.pathname.match(/^\/api\/platform\/users\/([^/]+)\/impact$/);
  if (impact && request.method === "GET") {
    return userImpact(request, env, decodeURIComponent(impact[1]!), deps);
  }

  const remove = url.pathname.match(/^\/api\/platform\/users\/([^/]+)$/);
  if (remove && request.method === "DELETE") {
    return hardDeleteUser(request, env, decodeURIComponent(remove[1]!), deps);
  }

  return null;
}
