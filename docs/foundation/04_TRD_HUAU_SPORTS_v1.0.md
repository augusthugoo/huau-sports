# HUAU Sports - Technical Requirements Document (TRD) v1.0

**Estado:** Baseline técnica  
**Fecha:** 2026-08-29  
**Depende de:** PRD v1.0 + Backend/Data Model v1.0

---

## 1. Objetivo técnico

Construir HUAU Sports como una plataforma web/PWA multi-organización, de bajo costo inicial y apta para uso comercial, preservando la resiliencia offline de Tournament y Ref.

La arquitectura debe soportar inicialmente cientos o pocos miles de usuarios con costo mínimo, sin introducir decisiones que impidan escalar a múltiples clubes/eventos.

---

## 2. Stack recomendado

### Frontend

- React.
- TypeScript strict.
- Vite.
- Cloudflare Vite plugin / Workers Static Assets.
- React Router o routing equivalente para SPA.
- TanStack Query o una capa equivalente para server state online.
- IndexedDB wrapper pequeño para offline tournament state (Dexie u opción equivalente mediante ADR).
- Zod para schemas compartidos/config validation.
- i18n library con namespaces (`es`, `en`).

### Backend

- Cloudflare Workers.
- TypeScript.
- Hono (recomendado) o router Worker equivalente.
- Cloudflare D1.
- Drizzle ORM + migrations para app data.
- Better Auth para auth/session, conectado a D1/Drizzle.
- Cloudflare R2 para assets/uploads.
- Cloudflare Durable Objects + WebSocket Hibernation para Tournament Live/realtime.
- Cloudflare Cron Triggers para expiraciones/reconciliaciones no críticas.

### Integraciones

- Mercado Pago Checkout Pro / Orders API para pagos automáticos de torneos.
- Mercado Pago OAuth para conectar cuentas receptoras sin pedir access tokens en texto plano.
- Mercado Pago Webhooks para estado de pagos.
- Resend para email transaccional.
- Cloudflare Email Routing opcional para correo entrante corporativo.

### Testing

- Vitest para unit/domain tests.
- Playwright para E2E browser/PWA critical paths.
- Typecheck + lint en CI.
- Fixtures deterministas de Tournament Engine.

### Future mobile

- Mantener domain packages independientes del DOM.
- Evaluar Capacitor/React Native mediante ADR después de estabilizar PWA.
- No acoplar reglas deportivas a browser APIs.

---

## 3. Deployment topology

V1 recomienda **un solo proyecto Cloudflare Worker** que sirva:

```text
https://huau.com.uy/
├── static SPA / landing / app shell
├── /api/*           Worker API
├── /api/auth/*      Better Auth
├── /api/webhooks/*  Mercado Pago
└── /live/*          WebSocket upgrade -> Durable Object
```

Ventajas:

- un origen simplifica cookies/auth/CORS;
- un deployment publica frontend + API como unidad;
- Cloudflare sirve assets estáticos y lógica Worker en la misma plataforma;
- evita Vercel como dependencia fija inicial.

Se puede separar `api.huau...` en el futuro si existe necesidad real.

---

## 4. Monorepo recomendado

```text
huau/
├── apps/
│   └── web/                    # React + Worker entry
├── packages/
│   ├── tournament-engine/      # pure TS
│   ├── team-engine/            # pure TS or part of tournament engine
│   ├── ref-engine/             # ported pure TS
│   ├── format-explanation/     # pure TS + semantic output
│   ├── domain/                 # types, schemas, enums
│   ├── db/                     # Drizzle schema/migrations/repos
│   ├── auth/                   # Better Auth config
│   ├── i18n/                   # translations
│   └── ui/                     # shared components/tokens
├── tests/
│   ├── fixtures/
│   ├── integration/
│   └── e2e/
├── docs/
│   └── foundation/             # this package
├── wrangler.jsonc
├── package.json
└── pnpm-lock.yaml
```

`pnpm` workspace recomendado por simpleza y performance, pero package manager se congela por ADR al crear repo.

---

## 5. Domain architecture

### 5.1 Rule: domain is pure

Tournament, Team y Ref engines no deben importar:

- React;
- Cloudflare;
- DOM;
- localStorage;
- IndexedDB;
- Mercado Pago.

Reciben objetos y devuelven objetos/decisiones.

### 5.2 Tournament Engine responsibilities

- format validation;
- group generation;
- group match generation;
- standings;
- cross-group ranking;
- qualifiers;
- bracket generation;
- progression;
- schedule planning;
- schedule constraints;
- explanations as structured facts/hooks;
- team encounter generation and standings.

### 5.3 Ref Engine responsibilities

- score state machine;
- serving state;
- positions;
- set completion;
- timeouts;
- warnings;
- corrections;
- undo/redo;
- final summary.

### 5.4 Format Explanation Engine

Must not parse UI labels. It consumes typed config and computed facts.

Recommended output:

```ts
interface FormatExplanation {
  summary: SemanticParagraph[];
  sections: {
    groupStage?: SemanticBlock[];
    internalRanking?: SemanticBlock[];
    crossGroup?: SemanticBlock[];
    qualification?: SemanticBlock[];
    playoff?: SemanticBlock[];
    medals?: SemanticBlock[];
    teamEncounter?: SemanticBlock[];
  };
}
```

Localization happens after semantic generation.

---

## 6. Cloudflare D1 requirements

### 6.1 Database model

- Shared multi-tenant D1 database V1.
- Drizzle manages app schema migrations.
- Better Auth schema generated/versioned.
- Prepared statements for all dynamic SQL.
- Batch/transaction semantics used for multi-write atomic operations where D1 supports it.

Cloudflare D1 uses SQLite semantics and its `batch()` API runs statements as a transaction; failure rolls back the batch.

### 6.2 Authorization warning

D1 does **not** provide Supabase-style Row Level Security for application authorization.

Therefore HUAU must enforce tenant isolation in code.

Mandatory pattern:

```ts
const ctx = await requireOrganizationContext(request, organizationId);
return reservationsRepo.listForOrganization(ctx.organizationId, ...);
```

Forbidden pattern:

```ts
return db.select().from(reservations).where(eq(reservations.id, id));
```

without prior ownership check.

### 6.3 Tenant isolation tests

Every sensitive resource family needs integration tests:

- user from Org A cannot read/write Org B member;
- admin Org A cannot access Org B tournament;
- public route only receives sanitized public projection;
- Platform Admin access requires explicit platform authorization/support context.

### 6.4 Query strategy

- Select only required columns.
- Scope by organization/tournament first.
- Use bounded pagination.
- Avoid loading full historical dataset into Club home.
- Cache derived public tournament state by revision.

---

## 7. Auth requirements

### 7.1 Better Auth

Use Better Auth with D1-compatible adapter; Drizzle adapter is recommended so auth schema and app database conventions stay typed and migration-controlled.

### 7.2 V1 auth methods

- email/password;
- email verification;
- password reset.

OAuth social login is optional later.

### 7.3 Session security

- secure/httpOnly cookies;
- same-site appropriate for same-origin architecture;
- HTTPS only production;
- session rotation/expiry according to Better Auth best practice;
- ability to invalidate sessions after credential recovery.

### 7.4 Privilege checks

Never infer admin privilege from frontend state.

Backend middleware:

```text
requireUser
requireOrganizationAdmin
requireTournamentWriteAccess
requirePlatformAdmin
requireSupportMode
```

### 7.5 Support Mode

Platform Admin tenant writes require an explicit support session with:

- target organization;
- start time;
- actor;
- visible UI banner;
- audit event;
- automatic expiry.

No generic invisible impersonation.

---

## 8. Secrets

Store with Cloudflare secrets/environment bindings, never client bundles:

- Better Auth secret;
- Resend API key;
- Mercado Pago app secret/client secret;
- webhook secret;
- encryption key for seller OAuth tokens;
- any signing key.

Environment separation:

- local/dev;
- preview/staging;
- production.

Never reuse production payment credentials in dev.

---

## 9. Mercado Pago integration

### 9.1 Product choice

V1 uses server-created checkout/orders, not a static generic payment link, for automatic registration confirmation.

Current Mercado Pago documentation provides an Orders API for Checkout Pro that returns a `checkout_url`, supports `external_reference` and requires/recommends an idempotency key for order creation.

### 9.2 Seller connection

Preferred model:

- HUAU Mercado Pago application configured as marketplace/platform integration.
- Organization/payment receiver authorizes HUAU through OAuth.
- HUAU stores encrypted seller token(s).
- Tournament chooses a configured `payment_account_id`.

This supports cases where organizer != venue != payment receiver.

### 9.3 Create order

Server must:

1. authenticate user;
2. load registration and payment policy;
3. verify current amount/capacity;
4. create internal `payments` row;
5. create unique `X-Idempotency-Key`;
6. set `external_reference` to HUAU payment/registration reference;
7. create Mercado Pago order with seller token;
8. persist provider order id;
9. return checkout URL.

### 9.4 Webhook

Webhook endpoint requirements:

- HTTPS;
- verify Mercado Pago signature;
- dedupe provider event ID;
- do not trust payload status blindly when provider fetch is appropriate;
- fetch/verify authoritative order/payment state;
- apply monotonic payment state rules;
- idempotently update registration;
- emit realtime invalidation;
- return fast 2xx after safe processing/queue pattern.

### 9.5 Return URL

Return URL may show `Verificando pago...` and query backend.

It **must not** set `approved` itself.

### 9.6 Manual methods

Transfer/cash are internal state transitions performed by Organization Admin.

Manual mark-paid operation must be audited.

### 9.7 HUAU fee

No `marketplace_fee` in P0 unless business model changes by ADR.

Usage can be calculated after event for external billing.

---

## 10. Realtime architecture

### 10.1 Problem

Tournament public/live may have dozens/hundreds of viewers. Frequent polling can waste the free request budget.

### 10.2 Recommended design

Use a **Durable Object per tournament** as WebSocket coordination room.

Cloudflare currently supports Durable Objects on Workers Free and recommends WebSocket Hibernation for idle connections.

### 10.3 Source of truth

Durable Object is a transport/coordination layer, **not** canonical tournament storage.

Canonical:

- D1 state/revision;
- public projection revision.

### 10.4 Event pattern

After authoritative write:

```text
DB commit
-> recompute/public projection if needed
-> increment revision
-> broadcast lightweight invalidation
```

Clients:

```text
receive revision 42
-> if local revision < 42
-> fetch relevant endpoint
```

Avoid broadcasting entire tournament state after every score.

### 10.5 Fallback

If WebSocket fails:

- refresh on focus/visibility change;
- low-frequency adaptive polling (e.g. 30-60s) only as fallback;
- manual refresh always available.

---

## 11. Offline-first Tournament

### 11.1 Requirement

A preloaded event must remain operational without Internet.

### 11.2 Local storage

Use IndexedDB, not localStorage, for new tournament working state.

Store:

- normalized/current tournament snapshot;
- revision;
- mutations outbox;
- snapshots;
- sync metadata;
- device ID.

Service Worker stores app shell/static assets.

### 11.3 Prepare offline

Before event UI should offer/confirm:

```text
Offline ready
✓ App shell
✓ Tournament data
✓ Groups
✓ Schedule
✓ Engine version
Last sync: ...
```

### 11.4 Local-first write

Critical result entry flow:

1. validate locally;
2. apply Tournament Engine locally;
3. persist local mutation + state transactionally in IndexedDB;
4. UI updates immediately;
5. attempt server sync if online.

The user must never wait on network to see their result saved locally.

### 11.5 Mutation idempotency

Every mutation has `mutationId` UUID.

Server maintains dedupe record.

Retrying after network ambiguity is safe.

### 11.6 Revision strategy

Tournament has monotonic `working_revision`.

Client mutation includes `baseRevision`.

Safe simple cases:

- server revision same -> apply.
- server revision advanced by this same device’s already-processed mutation -> dedupe success.
- unrelated conflicting mutation -> conflict.

### 11.7 Conflict behavior

No last-write-wins for critical tournament structure/results.

On conflict:

- stop affected queue;
- preserve local state;
- fetch remote snapshot;
- show exact conflict/support tool;
- allow controlled resolution.

Given V1 assumes one main operator, conflict frequency should be low.

### 11.8 Emergency backup

Keep explicit JSON export/import in new Tournament.

Migration format can differ from legacy but export must be human-transferable file.

---

## 12. Offline Ref

HUAU Ref scoring core must not require cloud APIs during a match.

- Cache app shell.
- Persist active match in IndexedDB/local storage abstraction.
- Every rally saves state locally.
- Undo/redo local.
- Connected result submission is optional layer.

---

## 13. Tournament Engine migration requirements

### 13.1 Do not port UI code as engine

Extract behavior into pure TypeScript.

### 13.2 Fixture suite

Create fixtures from legacy scenarios:

- 4-player single group;
- 3/4/4 groups normalized;
- 3/4/4 equalized;
- wildcards;
- Top 2 Final;
- Top 3 step;
- Top 4 semis;
- standard bracket with byes;
- bronze sequential;
- bronze/final simultaneous;
- BO3 medal;
- consolation;
- two days/categories;
- 2 group rounds;
- duplicate participant across categories/no simultaneous scheduling;
- manual groups;
- live draw seed consistency.

### 13.3 Regression bug fixture

Specific test:

```text
4 entries, 2 group rounds
Expected:
all leg=1 encounters scheduled before any leg=2 encounter
no identical pairing back-to-back when an alternative exists
```

### 13.4 Legacy parity

Where rules are unchanged, outputs should match legacy semantics.

If new implementation intentionally differs, document as ADR and test new behavior.

---

## 14. Team Engine technical model

### 14.1 Typed config

Use discriminated schema:

```ts
type CompetitionFormat = StandardFormat | TeamFormat;
```

### 14.2 Rubber schema

```ts
interface RubberDefinition {
  key: string;
  order: number;
  mode: 'singles' | 'doubles';
  gender: 'male' | 'female' | 'mixed' | 'open';
  playCondition: 'always' | 'if_tied' | 'if_needed';
  isTiebreaker: boolean;
  bestOf: 1 | 3 | 5;
  pointTarget?: number;
  scoringMode?: string;
  weight: number; // default 1
}
```

### 14.3 Deterministic validation

Team Engine validates:

- roster counts;
- composition;
- lineup eligibility;
- player count per rubber;
- player duplication rules;
- conditional rubber activation;
- encounter clinch condition;
- winner.

### 14.4 Schedule

P0 scheduling strategy:

- encounter has ordered rubbers;
- by default rubbers are sequential;
- configurable `parallelAllowed` can exist in schema but UI may remain advanced;
- each rubber gets its own schedule item/court if scheduled individually.

### 14.5 Team standings

Implement default strategy as pure comparator and make comparator key configurable/versioned.

Do not embed tournament-specific prose in comparator code.

---

## 15. Public projection

### 15.1 Security

Anonymous routes never expose internal tables.

Build `PublicTournamentProjection` DTO including only whitelisted fields.

### 15.2 Caching

Use revision-based ETag/cache headers where appropriate.

Example:

```text
ETag: "tournament-<id>-rev-42"
```

### 15.3 Publish semantics

For online writes, publish/update projection automatically for live fields once tournament is live.

For pre-event structure, organization may explicitly publish groups/schedule.

---

## 16. Format explanation i18n

### 16.1 No LLM dependency

The official explanation must be deterministic and available offline.

Do **not** call AI to generate competition rules.

Reason:

- correctness;
- repeatability;
- offline;
- translation quality control;
- no hallucinated rules.

### 16.2 Semantic keys

Example:

```text
format.groups.count
format.groups.sizes
format.cross.normalized.summary
format.cross.normalized.detail
format.playoff.standard
format.medals.bo3
team.rubber.mixedDoubles
```

### 16.3 Translation quality

- Spanish and English are human-reviewed source files.
- Tests ensure both locales contain every P0 key.
- CI fails on missing translation keys.

---

## 17. UI state architecture

Keep separation:

- server/cache state: TanStack Query or equivalent;
- auth/context state: small store/context;
- form state: local/form library;
- tournament offline working state: dedicated repository/service backed by IndexedDB;
- pure domain state calculations: engine packages.

Avoid a single giant global store containing the whole application.

---

## 18. API conventions

### 18.1 REST-ish routes

Example:

```text
GET    /api/me
GET    /api/organizations/:orgId
POST   /api/organizations/:orgId/membership-requests
GET    /api/organizations/:orgId/courts/availability
POST   /api/organizations/:orgId/reservations
POST   /api/tournaments
POST   /api/tournaments/:id/categories
POST   /api/tournaments/:id/mutations
POST   /api/payments/mercadopago/orders
POST   /api/webhooks/mercadopago
GET    /api/public/tournaments/:slug
GET    /live/tournaments/:id
```

### 18.2 Response envelope

Use consistent error schema:

```json
{
  "error": {
    "code": "RESERVATION_CONFLICT",
    "message": "...",
    "details": {}
  }
}
```

UI localizes user-facing message by error code where possible.

### 18.3 Input validation

All write endpoints validate Zod schema server-side even if frontend already validated.

### 18.4 Idempotency

Mandatory for:

- payment creation;
- webhook processing;
- offline mutations;
- waitlist promotion jobs;
- critical retries.

---

## 19. Background/scheduled jobs

Use Cloudflare scheduled triggers for low-frequency maintenance:

- expire provisional reservation holds;
- release incomplete open matches at configured cutoff;
- expire tournament payment windows/waitlist offers;
- retry email outbox;
- payment reconciliation safety check;
- cleanup old ephemeral records.

Jobs must be idempotent.

Do not depend on sub-minute precision for club booking logic unless product requirement later demands it.

---

## 20. R2 requirements

Use for:

- organization logos;
- hero images;
- user avatars;
- generated exports if persistent sharing is required;
- optional larger backup artifacts.

Do not use R2 for:

- primary structured tournament data;
- secrets;
- payment tokens;
- trivial JSON rows better suited to D1.

Key namespacing:

```text
org/<orgId>/branding/logo.ext
org/<orgId>/avatars/<userId>.ext
tournaments/<tournamentId>/exports/...
```

Upload endpoints validate size, MIME and authorization.

---

## 21. Email with Resend

### 21.1 Pattern

Domain service writes `email_outbox`; async/after-commit worker attempts Resend.

Critical domain transaction must not fail because Resend is down.

### 21.2 Templates P0

- verify email;
- password reset;
- tournament registration confirmed;
- payment approved;
- partner/team invitation;
- critical tournament change (explicit organizer action).

### 21.3 Locale

Template selected/rendered with user locale or tournament default.

### 21.4 Suppression

Do not email high-volume trivial activity.

---

## 22. Security requirements

### 22.1 OWASP baseline

- server-side authorization;
- CSRF protection appropriate to auth architecture;
- XSS prevention by React escaping + sanitized rich text;
- no unsafe HTML from organization descriptions without sanitizer;
- SQL parameter binding;
- rate limiting sensitive endpoints;
- brute-force protections via auth provider/config;
- secure headers;
- Content Security Policy after integration review;
- upload validation;
- secret isolation.

### 22.2 Payment token encryption

Seller OAuth access/refresh tokens:

- AES-GCM or equivalent Web Crypto encryption at application layer;
- master key stored as Worker secret;
- random IV per ciphertext;
- version encryption format for rotation;
- never logged;
- never returned to client.

### 22.3 Logs

Never log:

- passwords;
- auth tokens;
- Mercado Pago access tokens;
- full webhook secrets;
- unnecessary PII.

### 22.4 Platform Admin

- strong authentication;
- MFA should be required before production scale; if Better Auth setup supports it, include before external rollout beyond pilot;
- support mode auditing.

---

## 23. Privacy/minors

Before opening self-service minors:

- define guardian model;
- consent flow;
- data retention;
- public participant display defaults;
- applicable Uruguay/international privacy obligations.

P0 safe default:

- minors can be manual tournament participants;
- do not require/publicly expose date of birth;
- public names controlled by organizer policy.

---

## 24. Concurrency

Although V1 UX assumes one main admin, backend must prevent silent overwrite.

Use optimistic concurrency:

```text
UPDATE entity
SET ..., version = version + 1
WHERE id = ? AND version = ?
```

If affected rows = 0 -> `VERSION_CONFLICT`.

Tournament mutations use higher-level revision protocol.

---

## 25. Observability

Minimum production telemetry:

- Worker error rate;
- API latency;
- D1 errors;
- payment webhook failures;
- sync conflicts;
- email outbox failures;
- realtime connection errors;
- offline mutation backlog counts (client diagnostic upload opt-in/when online);
- critical audit events.

Use structured logs with request ID/correlation ID.

Do not add heavy analytics vendor before needed.

---

## 26. Performance targets

Pilot targets, not contractual SLA:

- public initial load usable on modern mobile over normal 4G;
- admin navigation responsive after shell load;
- result save local feedback < 100ms perceived offline/local path;
- online result authoritative API response target p95 < 1s under pilot load;
- realtime live invalidation normally visible within a few seconds;
- no full-tournament refetch on every small UI interaction;
- public projection bounded and compressed.

---

## 27. Browser/device support

### P0

- current Chrome desktop/macOS;
- current Safari iOS/iPadOS;
- current Chrome Android;
- modern Edge.

Legacy iPad Mini 1 compatibility is **not** a hard requirement for the new cloud app because its browser engine is obsolete; legacy Tournament build remains fallback for legacy hardware during transition.

PWA install should work where platform/browser supports it.

---

## 28. CI/CD

Every pull request:

1. install locked dependencies;
2. lint;
3. TypeScript typecheck;
4. unit tests;
5. engine fixture tests;
6. DB schema/migration validation;
7. build Worker/static assets;
8. selected Playwright smoke tests.

Main branch:

- deploy staging;
- run migration on staging;
- E2E;
- manual gate for production while product is pre-1.0.

Production migration must be forward-safe and backed up/exported when schema risk is significant.

---

## 29. Environments

### Local

- Miniflare/Wrangler local Worker;
- local D1;
- payment sandbox/test credentials;
- Resend test/domain-safe mode.

### Staging

- separate Cloudflare resources;
- separate D1;
- separate R2 bucket;
- Mercado Pago test credentials;
- staging hostname.

### Production

- production bindings/secrets;
- custom domain;
- payment production OAuth/webhooks;
- production email domain.

Never share D1/R2 between staging and production.

---

## 30. Backup & recovery

### D1

- rely on D1 platform recovery features plus periodic export strategy before major migrations.
- app-level Tournament snapshots remain separate from DB disaster recovery.

### Tournament

- automatic snapshots;
- user export backup;
- import/migration tool;
- pre-event backup checklist.

### R2

Brand assets are replaceable; backups optional according to business value.

---

## 31. Legacy coexistence

Until cloud version passes event rehearsal:

- keep `HUAU_Tournament_V2_4_2_Local_y_Netlify_Autocarga` archived unchanged;
- keep HUAU Ref Beta 1.8 archived;
- do not deploy partially migrated cloud engine as only production event tool;
- use migration fixtures instead of modifying the legacy app to “meet halfway”.

At cutover, legacy can remain emergency fallback package.

---

## 32. Technical acceptance gates

### Gate A - Foundation

- auth works;
- org isolation tests pass;
- migrations reproducible from empty DB;
- staging deploy repeatable.

### Gate B - Tournament Engine parity

- fixture suite passes;
- no hidden DOM dependency;
- cross-group methods verified;
- two-round regression fixed.

### Gate C - Offline

- preloaded tournament works airplane-mode through result -> standings -> bracket;
- reconnect sync succeeds;
- duplicate mutation retry is safe.

### Gate D - Payments

- test OAuth receiver connected;
- order created idempotently;
- signed webhook verified;
- duplicate webhook safe;
- return URL cannot forge paid state.

### Gate E - Team tournament

- September format configured via UI;
- alternative tiebreak format configured without code;
- lineup validation;
- encounter winner/standings correct.

### Gate F - Live

- mobile + TV same public revision;
- WebSocket reconnect/fallback works;
- no private fields in public DTO.

---

## 33. Current external technical assumptions verified 2026-08-29

These assumptions were checked against current official documentation and should be rechecked before production if APIs/pricing changed:

- Cloudflare Workers supports deploying static assets and Worker logic together and provides a React scaffold with Cloudflare Vite integration.
- Cloudflare D1 is a managed serverless SQLite-semantic database available on Free/Paid plans; D1 prepared statements and `batch()` are available.
- Cloudflare Durable Objects are available on Workers Free/Paid; SQLite-backed objects are available on Free and WebSocket Hibernation is the recommended realtime pattern.
- Better Auth currently supports Cloudflare D1 and Drizzle/SQLite adapters.
- Resend supports Cloudflare Workers.
- Mercado Pago Checkout Pro Orders API supports creation of an order with `checkout_url`, `external_reference`, and idempotency key; Mercado Pago Webhooks support signed event delivery; marketplace-style Checkout Pro can use OAuth seller access tokens.

### Official references

- Cloudflare Workers Static Assets: https://developers.cloudflare.com/workers/static-assets/
- Cloudflare D1: https://developers.cloudflare.com/d1/
- D1 database/batch API: https://developers.cloudflare.com/d1/worker-api/d1-database/
- Durable Objects WebSockets: https://developers.cloudflare.com/durable-objects/best-practices/websockets/
- Durable Objects pricing/free availability: https://developers.cloudflare.com/durable-objects/platform/pricing/
- Better Auth D1 support: https://better-auth.com/blog/1-5
- Better Auth Drizzle adapter: https://better-auth.com/docs/adapters/drizzle
- Resend + Cloudflare: https://resend.com/cloudflare
- Mercado Pago Checkout Pro Orders create order: https://www.mercadopago.com.uy/developers/es/docs/checkout-pro-orders/create-order
- Mercado Pago Webhooks: https://www.mercadopago.com.uy/developers/es/docs/checkout-pro-orders/payment-notifications
- Mercado Pago marketplace/OAuth: https://www.mercadopago.com.uy/developers/es/docs/checkout-pro-orders/additional-settings/integrate-marketplace

---

## 34. ADRs required before first code freeze

1. ADR-001: package manager + monorepo tooling.
2. ADR-002: Better Auth direct D1 vs Drizzle adapter final choice.
3. ADR-003: IndexedDB library.
4. ADR-004: Tournament offline sync revision/conflict protocol.
5. ADR-005: Public projection storage strategy.
6. ADR-006: Mercado Pago OAuth token encryption/rotation.
7. ADR-007: Team standings rule for September event.
8. ADR-008: Native path (deferred, not required for P0).

