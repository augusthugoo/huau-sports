# HUAU Sports - Backend & Data Model v1.0

**Estado:** Baseline de datos  
**Fecha:** 2026-08-29  
**Objetivo:** modelo multi-organización compatible con HUAU Club, Tournament y Ref, con D1/SQLite y operación offline-resilient.

---

## 1. Decisiones de modelado

1. **Base compartida multi-tenant inicialmente.**
   - Una base D1 para la plataforma.
   - Toda entidad tenant-scoped lleva `organization_id` o hereda ownership verificable.
   - La autorización se aplica en backend/service layer; D1 no ofrece RLS equivalente a PostgreSQL.

2. **`Organization` es la raíz comercial, no `Club`.**
   - Soporta club, complejo, comunidad, academia, organizador, liga y federación.

3. **Identidad global + participante local por organización.**
   - `users`/auth son globales.
   - `organization_people` unifica usuarios registrados y participantes manuales para operaciones deportivas dentro de una organización.

4. **Tournament entries son abstractos.**
   - Una entry puede ser `individual`, `pair` o `team`.
   - Los miembros de la entry viven en `entry_members`.

5. **Encounter != atomic match.**
   - `competition_encounters` representa el enfrentamiento de dos entries.
   - En singles/dobles estándar, un encounter suele tener un solo atomic match.
   - En equipos, un encounter contiene múltiples `matches`/rubbers.

6. **Formatos versionados.**
   - Config de competición se almacena como JSON validado y versionado.
   - Una vez bloqueada/iniciada la competencia, la versión usada no se muta silenciosamente.

7. **Dinero en unidades menores.**
   - Montos como enteros: centésimos o unidad menor de la moneda.
   - Moneda ISO 4217 (`UYU`, `USD`, etc.).

8. **Timestamps UTC.**
   - `INTEGER` epoch milliseconds o formato equivalente consistente.
   - Timezone local se guarda separadamente en organization/venue/tournament.

9. **IDs opacos.**
   - `TEXT` UUID generado server/client de forma segura.
   - Nunca usar secuenciales públicos como control de seguridad.

10. **Soft state, no “papelera” de UX.**

- Para datos críticos se preserva historial/snapshot.
- Entidades operativas pueden usar `archived_at` cuando borrar físicamente rompería referencias.

---

## 2. Convenciones comunes

Campos recomendados en entidades mutables:

```text
id TEXT PRIMARY KEY
created_at INTEGER NOT NULL
updated_at INTEGER NOT NULL
version INTEGER NOT NULL DEFAULT 1
archived_at INTEGER NULL
```

Para entidades tenant-scoped:

```text
organization_id TEXT NOT NULL
```

Para mutaciones offline/idempotentes:

```text
last_mutation_id TEXT NULL
```

Los índices deben seguir los patrones de lectura reales y siempre incluir tenant scope cuando corresponda.

---

## 3. Auth e identidad

### 3.1 Better Auth tables

Las tablas exactas son generadas por Better Auth y su adapter. Conceptualmente incluyen:

- user;
- session;
- account/provider;
- verification tokens;
- credenciales/password metadata.

No duplicar passwords ni tokens de auth en tablas de HUAU.

### 3.2 `user_profiles`

Extiende al usuario global.

```text
user_id TEXT PK/FK -> auth user
first_name TEXT NOT NULL
last_name TEXT NOT NULL
phone TEXT NULL
birth_date TEXT NULL       -- YYYY-MM-DD
sport_gender TEXT NULL     -- domain value, only when needed
country_code TEXT NULL
city TEXT NULL
avatar_r2_key TEXT NULL
preferred_locale TEXT NOT NULL DEFAULT 'es-UY'
created_at INTEGER
updated_at INTEGER
```

Notas:

- `birth_date` existe desde V1, pero el flow de menores puede estar gated.
- `sport_gender` no debe forzarse como requisito universal de cuenta.
- Avatar opcional.

### 3.3 `platform_admins`

```text
user_id TEXT PRIMARY KEY
status TEXT CHECK(active|disabled)
created_at INTEGER
```

Sólo se administra desde backend/operación segura; no existe UI para auto-promoción.

---

## 4. Organizaciones y módulos

### 4.1 `organizations`

```text
id TEXT PK
name TEXT NOT NULL
slug TEXT NOT NULL UNIQUE
type TEXT NOT NULL CHECK(club|sports_complex|community|academy|organizer|league|federation)
status TEXT NOT NULL CHECK(active|trial|suspended|archived)
default_locale TEXT NOT NULL DEFAULT 'es-UY'
timezone TEXT NOT NULL DEFAULT 'America/Montevideo'
default_currency TEXT NOT NULL DEFAULT 'UYU'
public_description TEXT NULL
contact_email TEXT NULL
contact_phone TEXT NULL
created_at INTEGER
updated_at INTEGER
```

### 4.2 `organization_branding`

```text
organization_id TEXT PK
logo_r2_key TEXT NULL
hero_r2_key TEXT NULL
accent_primary TEXT NULL
accent_secondary TEXT NULL
public_name TEXT NULL
show_powered_by_huau INTEGER NOT NULL DEFAULT 1
updated_at INTEGER
```

HUAU logo/identity global no se guarda como branding de tenant.

### 4.3 `organization_modules`

```text
id TEXT PK
organization_id TEXT NOT NULL
module TEXT NOT NULL CHECK(club|tournament|ref)
enabled INTEGER NOT NULL
plan_key TEXT NULL
starts_at INTEGER NULL
ends_at INTEGER NULL
created_at INTEGER
updated_at INTEGER
UNIQUE(organization_id, module)
```

Ref puede estar habilitado como entitlement dependiente de Tournament.

### 4.4 `organization_feature_flags`

Permite al HUAU Platform Admin habilitar/ocultar capacidades por organización sin desplegar una build distinta. No debe usarse como sustituto de autorización.

```text
id TEXT PK
organization_id TEXT NOT NULL
feature_key TEXT NOT NULL
enabled INTEGER NOT NULL
config_json TEXT NULL
updated_by_user_id TEXT NULL
updated_at INTEGER
UNIQUE(organization_id, feature_key)
```

Ejemplos de keys futuras: `club.open_play`, `club.coach`, `tournament.team_competitions`, `tournament.public_live`.

### 4.5 `organization_capability_policies`

Políticas simples para capacidades no jerárquicas. V1 no implementa un constructor de RBAC empresarial.

```text
id TEXT PK
organization_id TEXT NOT NULL
capability TEXT NOT NULL
permission_key TEXT NOT NULL
allowed INTEGER NOT NULL
updated_at INTEGER
UNIQUE(organization_id, capability, permission_key)
```

Ejemplos cuando la capability exista:

- `coach -> class.create_draft`;
- `coach -> class.publish`;
- `tournament_operator -> result.submit`.

Los permisos de `org_admin` núcleo no deben poder degradarse de forma que la organización quede sin un administrador operativo. Platform Admin permanece fuera de estas policies.

---

## 5. Personas dentro de una organización

### 5.1 `organization_people`

Esta tabla resuelve la necesidad de:

- participantes con cuenta HUAU;
- participantes manuales legacy;
- una misma persona participando en varias categorías;
- evitar que Tournament dependa de cuentas.

```text
id TEXT PK
organization_id TEXT NOT NULL
user_id TEXT NULL          -- link a cuenta HUAU si existe
first_name TEXT NOT NULL
last_name TEXT NOT NULL
email TEXT NULL
phone TEXT NULL
birth_date TEXT NULL
sport_gender TEXT NULL
source TEXT NOT NULL CHECK(user|manual|import)
status TEXT NOT NULL CHECK(active|inactive)
created_at INTEGER
updated_at INTEGER
UNIQUE(organization_id, user_id) WHERE user_id IS NOT NULL
```

### 5.2 Claim/merge de persona manual

Si un usuario se registra después y coincide con una persona manual, no se debe auto-fusionar sólo por nombre.

Flow seguro:

- match fuerte por email verificado u operación manual de admin;
- link `user_id` a existing `organization_people`;
- preservar todos los entry/member references.

### 5.3 `organization_person_sport_profiles`

```text
id TEXT PK
organization_person_id TEXT NOT NULL
sport TEXT NOT NULL CHECK(pickleball|padel|tennis)
singles_rating REAL NULL
doubles_rating REAL NULL
level_label TEXT NULL
rating_system TEXT NULL     -- e.g. DUPR, club_level
rating_updated_at INTEGER NULL
created_at INTEGER
updated_at INTEGER
UNIQUE(organization_person_id, sport)
```

---

## 6. Memberships / pertenencia

### 6.1 `organization_membership_requests`

```text
id TEXT PK
organization_id TEXT NOT NULL
user_id TEXT NOT NULL
status TEXT NOT NULL CHECK(pending|approved|rejected|cancelled)
note TEXT NULL
reviewed_by_user_id TEXT NULL
reviewed_at INTEGER NULL
created_at INTEGER
updated_at INTEGER
UNIQUE(organization_id, user_id) WHERE status='pending'
```

### 6.2 `organization_memberships`

```text
id TEXT PK
organization_id TEXT NOT NULL
user_id TEXT NOT NULL
organization_person_id TEXT NOT NULL
status TEXT NOT NULL CHECK(pending|active|suspended|expired|inactive)
starts_at INTEGER NULL
expires_at INTEGER NULL
admin_notes TEXT NULL
created_at INTEGER
updated_at INTEGER
UNIQUE(organization_id, user_id)
```

### 6.3 `membership_entitlements`

En V1 son administrados manualmente.

```text
id TEXT PK
membership_id TEXT NOT NULL
sport TEXT NULL             -- null can mean general
entitlement_key TEXT NOT NULL  -- court_booking / member_access / etc.
status TEXT NOT NULL CHECK(active|inactive)
starts_at INTEGER NULL
expires_at INTEGER NULL
created_at INTEGER
updated_at INTEGER
```

Ejemplos:

- membership general -> court_booking for pickleball/padel/tennis.
- pickleball-only -> court_booking pickleball.

No se modela billing recurrente de membresía en V1.

---

## 7. Staff/capabilities

### 7.1 `organization_user_capabilities`

Mantiene UX simple sin construir un RBAC empresarial completo.

```text
id TEXT PK
organization_id TEXT NOT NULL
user_id TEXT NOT NULL
capability TEXT NOT NULL CHECK(org_admin|coach|tournament_operator|future_referee)
status TEXT NOT NULL CHECK(active|inactive)
created_at INTEGER
updated_at INTEGER
UNIQUE(organization_id, user_id, capability)
```

Reglas:

- `org_admin` es la única capacidad administrativa principal V1.
- `coach` habilita experiencias P2.
- `tournament_operator` queda disponible para una UI acotada de carga de resultados cuando un evento lo requiera; no crea una jerarquía administrativa nueva.
- `future_referee` reservado.
- Platform Admin no depende de esta tabla.

---

## 8. Venues y canchas

### 8.1 `venues`

```text
id TEXT PK
organization_id TEXT NOT NULL
name TEXT NOT NULL
slug TEXT NULL
address TEXT NULL
city TEXT NULL
country_code TEXT NULL
timezone TEXT NOT NULL
status TEXT CHECK(active|inactive)
created_at INTEGER
updated_at INTEGER
```

Una tournament puede usar un venue de una organización distinta si existe una relación/autorización explícita o el venue se registra como external snapshot.

### 8.2 `courts`

```text
id TEXT PK
venue_id TEXT NOT NULL
name TEXT NOT NULL
sport TEXT NOT NULL CHECK(pickleball|padel|tennis)
indoor INTEGER NULL
status TEXT NOT NULL CHECK(active|inactive|maintenance)
sort_order INTEGER NOT NULL DEFAULT 0
created_at INTEGER
updated_at INTEGER
```

Si una superficie es multi-sport, usar `court_sports` en lugar de forzar sport único.

### 8.3 `court_sports` (opcional recomendado)

```text
court_id TEXT NOT NULL
sport TEXT NOT NULL
PRIMARY KEY(court_id, sport)
```

### 8.4 `booking_policies`

Scope organization + sport, con defaults.

```text
id TEXT PK
organization_id TEXT NOT NULL
sport TEXT NOT NULL
approval_mode TEXT CHECK(auto|manual)
slot_granularity_minutes INTEGER NOT NULL DEFAULT 30
min_booking_minutes INTEGER NOT NULL DEFAULT 60
booking_increment_minutes INTEGER NOT NULL DEFAULT 30
max_booking_minutes INTEGER NULL
min_advance_minutes INTEGER NULL
max_advance_days INTEGER NULL
max_future_reservations INTEGER NULL
max_reservations_per_day INTEGER NULL
cancellation_cutoff_minutes INTEGER NULL
pending_hold_minutes INTEGER NOT NULL DEFAULT 15
open_match_auto_release_minutes INTEGER NULL
open_match_min_players INTEGER NULL
created_at INTEGER
updated_at INTEGER
UNIQUE(organization_id, sport)
```

### 8.5 `court_availability_rules`

```text
id TEXT PK
court_id TEXT NOT NULL
day_of_week INTEGER NOT NULL
start_minute INTEGER NOT NULL
end_minute INTEGER NOT NULL
valid_from TEXT NULL
valid_to TEXT NULL
created_at INTEGER
updated_at INTEGER
```

### 8.6 `court_blocks`

Excepciones/hold administrativo.

```text
id TEXT PK
court_id TEXT NOT NULL
start_at INTEGER NOT NULL
end_at INTEGER NOT NULL
reason TEXT NOT NULL
source_type TEXT CHECK(manual|tournament|activity|maintenance|weather|other)
source_id TEXT NULL
created_by_user_id TEXT NOT NULL
created_at INTEGER
```

---

## 9. Reservas

### 9.1 `reservations`

```text
id TEXT PK
organization_id TEXT NOT NULL
venue_id TEXT NOT NULL
court_id TEXT NOT NULL
created_by_user_id TEXT NOT NULL
sport TEXT NOT NULL
start_at INTEGER NOT NULL
end_at INTEGER NOT NULL
status TEXT NOT NULL CHECK(pending_approval|confirmed|rejected|cancelled|expired)
visibility TEXT NOT NULL CHECK(private|open)
hold_expires_at INTEGER NULL
approved_by_user_id TEXT NULL
approved_at INTEGER NULL
cancelled_at INTEGER NULL
cancellation_reason TEXT NULL
created_at INTEGER
updated_at INTEGER
version INTEGER NOT NULL DEFAULT 1
```

### 9.2 Anti-overlap

D1/SQLite no debe depender de un exclusion constraint de PostgreSQL.

La API debe validar en transacción/batch que no exista overlap de reservas/blocks activas antes de crear/confirmar.

Todos los paths de escritura usan el mismo service de disponibilidad.

### 9.3 `open_matches`

Sólo existe sobre reservation `visibility=open`.

```text
id TEXT PK
organization_id TEXT NOT NULL
reservation_id TEXT NOT NULL UNIQUE
sport TEXT NOT NULL
mode TEXT NULL
required_players INTEGER NOT NULL
reserved_guest_slots INTEGER NOT NULL DEFAULT 0
recommended_level TEXT NULL
competition_gender TEXT NULL CHECK(male|female|mixed|open)
description TEXT NULL
visibility TEXT NOT NULL CHECK(organization|public_link)
status TEXT NOT NULL CHECK(open|full|cancelled|completed|expired)
join_cutoff_at INTEGER NULL
auto_release_at INTEGER NULL
created_at INTEGER
updated_at INTEGER
version INTEGER NOT NULL DEFAULT 1
```

### 9.4 `open_match_participants`

```text
id TEXT PK
open_match_id TEXT NOT NULL
user_id TEXT NOT NULL
organization_person_id TEXT NOT NULL
status TEXT NOT NULL CHECK(joined|left|waitlisted|promoted)
position INTEGER NULL
joined_at INTEGER
updated_at INTEGER
UNIQUE(open_match_id, user_id) WHERE status IN ('joined','waitlisted','promoted')
```

Join/promote debe ejecutarse de forma atómica/idempotente.

---

## 10. Activities / Open Play / classes

### 10.1 `activities`

```text
id TEXT PK
organization_id TEXT NOT NULL
type TEXT NOT NULL CHECK(open_play|class|clinic|event)
title TEXT NOT NULL
description TEXT NULL
sport TEXT NULL
coach_user_id TEXT NULL
visibility TEXT CHECK(public|members|invite)
capacity INTEGER NULL
recommended_level TEXT NULL
price_minor INTEGER NULL
currency TEXT NULL
payment_required INTEGER NOT NULL DEFAULT 0
status TEXT CHECK(draft|published|cancelled|completed)
created_at INTEGER
updated_at INTEGER
```

### 10.2 `activity_sessions`

Permite recurrencia sin duplicar la definición lógica.

```text
id TEXT PK
activity_id TEXT NOT NULL
start_at INTEGER NOT NULL
end_at INTEGER NOT NULL
capacity_override INTEGER NULL
status TEXT CHECK(scheduled|cancelled|completed)
created_at INTEGER
updated_at INTEGER
```

### 10.3 `activity_session_courts`

```text
activity_session_id TEXT NOT NULL
court_id TEXT NOT NULL
PRIMARY KEY(activity_session_id, court_id)
```

### 10.4 `activity_registrations`

```text
id TEXT PK
activity_session_id TEXT NOT NULL
user_id TEXT NOT NULL
status TEXT CHECK(registered|waitlisted|cancelled)
waitlist_position INTEGER NULL
created_at INTEGER
updated_at INTEGER
```

No attendance table en V1.

---

# 11. Tournament root

## 11.1 `tournaments`

```text
id TEXT PK
organizer_organization_id TEXT NOT NULL
host_venue_id TEXT NULL
name TEXT NOT NULL
slug TEXT NOT NULL UNIQUE
sport TEXT NOT NULL
status TEXT NOT NULL CHECK(draft|registration_open|registration_closed|draw_ready|scheduled|live|completed|cancelled)
visibility TEXT NOT NULL CHECK(public|members|invite)
start_at INTEGER NOT NULL
end_at INTEGER NULL
timezone TEXT NOT NULL
court_count INTEGER NOT NULL
public_participants INTEGER NOT NULL DEFAULT 1
public_live INTEGER NOT NULL DEFAULT 1
structure_locked INTEGER NOT NULL DEFAULT 0
published_revision INTEGER NOT NULL DEFAULT 0
working_revision INTEGER NOT NULL DEFAULT 0
created_by_user_id TEXT NOT NULL
created_at INTEGER
updated_at INTEGER
```

### 11.2 `tournament_courts`

```text
tournament_id TEXT NOT NULL
court_id TEXT NULL
court_label TEXT NOT NULL
sort_order INTEGER NOT NULL
PRIMARY KEY(tournament_id, court_label)
```

Permite court real o label virtual/external.

---

## 12. Tournament categories

### 12.1 `tournament_categories`

```text
id TEXT PK
tournament_id TEXT NOT NULL
name TEXT NOT NULL
entry_type TEXT NOT NULL CHECK(individual|pair|team)
competition_gender TEXT NULL CHECK(male|female|mixed|open)
max_entries INTEGER NULL
registration_status TEXT CHECK(closed|open|waitlist_only)
price_scope TEXT NOT NULL CHECK(free|per_entry|per_person)
price_minor INTEGER NULL
currency TEXT NULL
format_version_id TEXT NULL
scheduled_date TEXT NULL
sort_order INTEGER NOT NULL DEFAULT 0
structure_locked INTEGER NOT NULL DEFAULT 0
created_at INTEGER
updated_at INTEGER
version INTEGER NOT NULL DEFAULT 1
```

---

## 13. Tournament entries & rosters

### 13.1 `tournament_entries`

```text
id TEXT PK
category_id TEXT NOT NULL
entry_type TEXT NOT NULL CHECK(individual|pair|team)
display_name TEXT NOT NULL
captain_user_id TEXT NULL
status TEXT NOT NULL CHECK(draft|inviting|ready|pending_payment|confirmed|waitlisted|withdrawn|rejected)
waitlist_position INTEGER NULL
seed_rating REAL NULL
created_by_user_id TEXT NULL
created_by_admin INTEGER NOT NULL DEFAULT 0
created_at INTEGER
updated_at INTEGER
version INTEGER NOT NULL DEFAULT 1
```

### 13.2 `entry_members`

```text
id TEXT PK
entry_id TEXT NOT NULL
organization_person_id TEXT NOT NULL
member_role TEXT CHECK(player|captain|substitute)
roster_slot TEXT NULL
status TEXT CHECK(pending_invite|accepted|manual|declined|removed)
invited_user_id TEXT NULL
accepted_at INTEGER NULL
created_at INTEGER
updated_at INTEGER
UNIQUE(entry_id, organization_person_id)
```

Para individual debe existir exactamente un member activo; pair exactamente dos cuando ready; team según config.

### 13.3 `entry_invitations`

```text
id TEXT PK
entry_id TEXT NOT NULL
inviter_user_id TEXT NOT NULL
invitee_user_id TEXT NULL
invitee_email TEXT NULL
token_hash TEXT NULL
status TEXT CHECK(pending|accepted|declined|expired|cancelled)
expires_at INTEGER NULL
created_at INTEGER
updated_at INTEGER
```

---

## 14. Tournament registration state

Aunque entry y registration están relacionados, conviene separar el acto comercial/inscripción.

### 14.1 `tournament_registrations`

```text
id TEXT PK
tournament_id TEXT NOT NULL
category_id TEXT NOT NULL
entry_id TEXT NOT NULL UNIQUE
registration_number TEXT NULL
status TEXT NOT NULL CHECK(draft|awaiting_roster|awaiting_payment|confirmed|waitlisted|rejected|cancelled)
amount_due_minor INTEGER NOT NULL DEFAULT 0
amount_paid_minor INTEGER NOT NULL DEFAULT 0
currency TEXT NOT NULL
confirmed_at INTEGER NULL
created_at INTEGER
updated_at INTEGER
version INTEGER NOT NULL DEFAULT 1
```

Status se deriva de roster, capacity y payment obligations pero se persiste para lectura simple.

---

## 15. Competition format versions

### 15.1 `competition_format_versions`

```text
id TEXT PK
category_id TEXT NOT NULL
version_number INTEGER NOT NULL
format_kind TEXT NOT NULL CHECK(standard|team)
config_json TEXT NOT NULL
explanation_schema_version INTEGER NOT NULL DEFAULT 1
created_by_user_id TEXT NOT NULL
created_at INTEGER
locked_at INTEGER NULL
UNIQUE(category_id, version_number)
```

`config_json` debe validarse con schema TypeScript/Zod antes de persistir.

### 15.2 Standard config conceptual

```json
{
  "groupRounds": 1,
  "groupSizes": [4, 4, 3],
  "qualifiersPerGroup": 2,
  "wildcardQualifiers": 0,
  "crossGroupMethod": "normalized",
  "playoffMode": "standard",
  "consolationMode": "none",
  "avoidGroupRematches": true,
  "bronzeMatch": true,
  "medalSchedule": "sequential",
  "preliminary": { "bestOf": 1, "pointTarget": 15 },
  "medal": { "bestOf": 3, "pointTarget": 11 },
  "seedingMethod": "serpentine_rating",
  "preferredRestSlots": 1
}
```

### 15.3 Team config conceptual

```json
{
  "roster": {
    "min": 4,
    "max": 6,
    "composition": "mixed",
    "rules": { "maleMin": 2, "femaleMin": 2 }
  },
  "encounter": {
    "winnerRule": "majority",
    "playRemainingAfterClinched": true,
    "rubbers": [
      { "key": "md", "order": 1, "mode": "doubles", "gender": "male", "play": "always" },
      { "key": "wd", "order": 2, "mode": "doubles", "gender": "female", "play": "always" },
      { "key": "ms", "order": 3, "mode": "singles", "gender": "male", "play": "always" },
      { "key": "ws", "order": 4, "mode": "singles", "gender": "female", "play": "always" },
      {
        "key": "xd",
        "order": 5,
        "mode": "doubles",
        "gender": "mixed",
        "play": "if_needed_or_always"
      }
    ]
  },
  "competition": {
    "groupRounds": 1,
    "playoffMode": "standard"
  }
}
```

No usar estos JSON como schemas finales sin validación/versionado.

---

## 16. Competition generated state

### 16.1 `competitions`

Una instancia materializada de categoría + format version.

```text
id TEXT PK
category_id TEXT NOT NULL UNIQUE
format_version_id TEXT NOT NULL
status TEXT CHECK(draft|groups_generated|group_stage|groups_complete|final_phase|completed)
structure_revision INTEGER NOT NULL DEFAULT 1
created_at INTEGER
updated_at INTEGER
```

### 16.2 `competition_groups`

```text
id TEXT PK
competition_id TEXT NOT NULL
name TEXT NOT NULL
sort_order INTEGER NOT NULL
UNIQUE(competition_id, name)
```

### 16.3 `competition_group_entries`

```text
group_id TEXT NOT NULL
entry_id TEXT NOT NULL
seed INTEGER NULL
sort_order INTEGER NOT NULL
PRIMARY KEY(group_id, entry_id)
```

---

## 17. Encounters and atomic matches

### 17.1 `competition_encounters`

Represents one entry-vs-entry contest at the competition level.

```text
id TEXT PK
competition_id TEXT NOT NULL
stage TEXT NOT NULL CHECK(group|playoff|consolation|bronze|final)
group_id TEXT NULL
round_label TEXT NULL
round_number INTEGER NULL
leg_number INTEGER NOT NULL DEFAULT 1
entry_a_id TEXT NULL
entry_b_id TEXT NULL
source_encounter_a_id TEXT NULL
source_encounter_b_id TEXT NULL
source_loser_a_id TEXT NULL
source_loser_b_id TEXT NULL
status TEXT NOT NULL CHECK(pending|bye|ready|in_progress|finished|skipped)
winner_entry_id TEXT NULL
created_at INTEGER
updated_at INTEGER
version INTEGER NOT NULL DEFAULT 1
```

Para dos vueltas:

- `leg_number=1` para Vuelta 1.
- `leg_number=2` para Vuelta 2.

Scheduler debe respetar esta dimensión.

### 17.2 `matches`

Atomic court match/rubber.

```text
id TEXT PK
encounter_id TEXT NOT NULL
rubber_key TEXT NULL
rubber_order INTEGER NOT NULL DEFAULT 1
mode TEXT NOT NULL CHECK(singles|doubles)
competition_gender TEXT NULL
best_of INTEGER NOT NULL DEFAULT 1
point_target INTEGER NULL
scoring_mode TEXT NULL
status TEXT CHECK(pending|ready|in_progress|finished|skipped)
side_a_label TEXT NULL
side_b_label TEXT NULL
winner_side TEXT NULL CHECK(A|B)
manual_override INTEGER NOT NULL DEFAULT 0
created_at INTEGER
updated_at INTEGER
version INTEGER NOT NULL DEFAULT 1
```

### 17.3 `match_side_members`

Necesario especialmente para lineups de equipos.

```text
match_id TEXT NOT NULL
side TEXT NOT NULL CHECK(A|B)
organization_person_id TEXT NOT NULL
position INTEGER NOT NULL
PRIMARY KEY(match_id, side, organization_person_id)
```

Para estándar, puede derivarse de entry_members al crear el match, pero se recomienda snapshotear side members para integridad histórica.

### 17.4 `match_results`

```text
match_id TEXT PRIMARY KEY
score_a INTEGER NULL
score_b INTEGER NULL
winner_side TEXT NULL
result_status TEXT CHECK(pending|final|corrected)
entered_by_user_id TEXT NULL
entered_at INTEGER NULL
corrected_at INTEGER NULL
updated_at INTEGER
```

### 17.5 `match_sets`

```text
id TEXT PK
match_id TEXT NOT NULL
set_number INTEGER NOT NULL
score_a INTEGER NOT NULL
score_b INTEGER NOT NULL
winner_side TEXT NOT NULL
UNIQUE(match_id, set_number)
```

---

## 18. Team-specific lineups

### 18.1 `team_encounter_lineups`

```text
id TEXT PK
encounter_id TEXT NOT NULL
entry_id TEXT NOT NULL
status TEXT CHECK(draft|locked)
locked_at INTEGER NULL
created_at INTEGER
updated_at INTEGER
UNIQUE(encounter_id, entry_id)
```

### 18.2 `team_lineup_assignments`

```text
id TEXT PK
lineup_id TEXT NOT NULL
rubber_key TEXT NOT NULL
organization_person_id TEXT NOT NULL
position INTEGER NOT NULL
created_at INTEGER
UNIQUE(lineup_id, rubber_key, organization_person_id)
```

Validation lives in Team Engine using format config.

---

## 19. Standings

### 19.1 Derived-first principle

Standings should be reproducible from finalized results + format. Avoid treating a mutable standings table as source of truth.

### 19.2 Optional cache

`competition_standings_cache` may cache computed rows by competition revision for fast public reads.

```text
competition_id TEXT
scope_type TEXT CHECK(group|cross_group|team)
scope_id TEXT NULL
revision INTEGER
payload_json TEXT
computed_at INTEGER
PRIMARY KEY(competition_id, scope_type, scope_id, revision)
```

Invalidar cuando cambia resultado relevante.

---

## 20. Schedule

### 20.1 `schedule_items`

```text
id TEXT PK
tournament_id TEXT NOT NULL
category_id TEXT NOT NULL
encounter_id TEXT NULL
match_id TEXT NULL
placeholder_key TEXT NULL
stage TEXT NOT NULL
round_label TEXT NULL
court_label TEXT NOT NULL
start_at INTEGER NOT NULL
end_at INTEGER NOT NULL
status TEXT CHECK(reserved|bound|completed|cancelled)
created_at INTEGER
updated_at INTEGER
version INTEGER NOT NULL DEFAULT 1
```

Final phase placeholders can exist before actual encounter IDs are known.

### 20.2 Schedule generation metadata

```text
schedule_revisions
- id
- tournament_id
- revision_number
- generated_from_structure_revision
- created_by_user_id
- created_at
- is_current
```

Useful for restore/publication.

---

## 21. Payments

### 21.1 `payment_accounts`

Represents a receiver connection.

```text
id TEXT PK
owner_organization_id TEXT NULL
owner_label TEXT NOT NULL
provider TEXT NOT NULL CHECK(mercadopago|manual)
country_code TEXT NULL
status TEXT CHECK(disconnected|connected|error|disabled)
provider_account_id TEXT NULL
encrypted_access_token TEXT NULL
encrypted_refresh_token TEXT NULL
token_expires_at INTEGER NULL
created_at INTEGER
updated_at INTEGER
```

Tokens siempre cifrados server-side. Nunca retornarlos al frontend.

### 21.2 `tournament_payment_configs`

```text
tournament_id TEXT PRIMARY KEY
payment_account_id TEXT NULL
allow_mercadopago INTEGER NOT NULL DEFAULT 0
allow_bank_transfer INTEGER NOT NULL DEFAULT 0
allow_cash INTEGER NOT NULL DEFAULT 0
bank_instructions TEXT NULL
whatsapp_number TEXT NULL
created_at INTEGER
updated_at INTEGER
```

### 21.3 `payments`

```text
id TEXT PK
organization_id TEXT NOT NULL
tournament_id TEXT NOT NULL
registration_id TEXT NOT NULL
user_id TEXT NULL
provider TEXT NOT NULL CHECK(mercadopago|bank_transfer|cash|free|discount)
provider_order_id TEXT NULL
external_reference TEXT NOT NULL UNIQUE
idempotency_key TEXT NOT NULL UNIQUE
amount_minor INTEGER NOT NULL
currency TEXT NOT NULL
status TEXT NOT NULL CHECK(created|pending|approved|rejected|cancelled|refunded|manual_paid)
manual_verified_by_user_id TEXT NULL
provider_payload_hash TEXT NULL
created_at INTEGER
updated_at INTEGER
approved_at INTEGER NULL
```

### 21.4 `payment_events`

Idempotent webhook event store.

```text
id TEXT PK
provider TEXT NOT NULL
provider_event_id TEXT NOT NULL
payment_id TEXT NULL
event_type TEXT NOT NULL
signature_valid INTEGER NOT NULL
payload_hash TEXT NOT NULL
received_at INTEGER NOT NULL
processed_at INTEGER NULL
process_status TEXT CHECK(received|processed|ignored|failed)
UNIQUE(provider, provider_event_id)
```

---

## 22. Discounts/courtesies

### 22.1 `discount_codes`

```text
id TEXT PK
tournament_id TEXT NOT NULL
code TEXT NOT NULL
kind TEXT CHECK(percent|fixed|free)
value INTEGER NOT NULL
max_uses INTEGER NULL
uses INTEGER NOT NULL DEFAULT 0
starts_at INTEGER NULL
ends_at INTEGER NULL
status TEXT CHECK(active|inactive)
UNIQUE(tournament_id, code)
```

### 22.2 `registration_adjustments`

Stores courtesy/manual discount so price calculation is explainable.

---

## 23. Public publishing

### 23.1 `tournament_public_revisions`

Public state should be a deliberate projection, not direct unrestricted database reads.

```text
id TEXT PK
tournament_id TEXT NOT NULL
revision INTEGER NOT NULL
payload_json TEXT NOT NULL
published_at INTEGER NOT NULL
published_by_user_id TEXT NULL
UNIQUE(tournament_id, revision)
```

Advantages:

- public endpoint is fast;
- private/admin-only fields never leak;
- offline operator can diverge locally while public remains last published/synced state;
- TV and phone consume same projection.

For very large future events this projection can be split, but V1 payload size is acceptable if bounded.

---

## 24. Realtime coordination

### 24.1 Durable Object room

One live room per tournament (`TournamentLiveRoom:{tournament_id}`).

DO is not source of truth; D1/public revision is source of truth.

Messages are lightweight invalidations/events:

```json
{
  "type": "tournament_revision",
  "tournamentId": "...",
  "revision": 42,
  "changed": ["results", "standings", "schedule"]
}
```

Clients refetch only required projection/sections.

---

## 25. Offline sync model

### 25.1 Client local store

IndexedDB stores:

- tournament working snapshot;
- current server revision;
- unsynced mutations;
- local snapshots;
- asset/offline readiness metadata.

### 25.2 Mutation envelope

Every offline-capable write:

```json
{
  "mutationId": "uuid",
  "tournamentId": "uuid",
  "baseRevision": 41,
  "type": "match.result.set",
  "entityId": "match-id",
  "payload": {},
  "createdAt": 0,
  "deviceId": "..."
}
```

Server stores processed mutation IDs to guarantee idempotency.

### 25.3 `tournament_mutations`

```text
mutation_id TEXT PRIMARY KEY
tournament_id TEXT NOT NULL
actor_user_id TEXT NOT NULL
device_id TEXT NULL
base_revision INTEGER NOT NULL
applied_revision INTEGER NULL
mutation_type TEXT NOT NULL
entity_id TEXT NULL
payload_hash TEXT NOT NULL
status TEXT CHECK(applied|conflict|rejected)
created_at INTEGER
applied_at INTEGER NULL
```

Payload completo puede ir a audit/snapshot sólo cuando sea necesario; no guardar datos sensibles redundantes.

---

## 26. Snapshots & recovery

### 26.1 `tournament_snapshots`

```text
id TEXT PK
tournament_id TEXT NOT NULL
scope_type TEXT CHECK(tournament|category)
scope_id TEXT NULL
reason TEXT NOT NULL
revision INTEGER NOT NULL
payload_json TEXT NOT NULL
created_by_user_id TEXT NULL
created_at INTEGER NOT NULL
```

Razones típicas:

- groups_confirmed;
- schedule_generated;
- tournament_start;
- first_result;
- final_phase_generated;
- before_structural_change;
- before_restore.

Retention policy se define en TRD/ADR.

---

## 27. Critical audit

### 27.1 `critical_audit_events`

```text
id TEXT PK
organization_id TEXT NULL
tournament_id TEXT NULL
actor_user_id TEXT NULL
actor_type TEXT CHECK(user|platform_admin|system|webhook)
action TEXT NOT NULL
entity_type TEXT NULL
entity_id TEXT NULL
summary TEXT NOT NULL
metadata_json TEXT NULL
created_at INTEGER NOT NULL
```

Registrar sólo eventos críticos, no cada click.

---

## 28. Notifications

### 28.1 `notifications`

```text
id TEXT PK
user_id TEXT NOT NULL
type TEXT NOT NULL
title_key TEXT NOT NULL
body_key TEXT NULL
params_json TEXT NULL
read_at INTEGER NULL
created_at INTEGER
```

### 28.2 `email_outbox`

```text
id TEXT PK
user_id TEXT NULL
to_email TEXT NOT NULL
template_key TEXT NOT NULL
locale TEXT NOT NULL
params_json TEXT NOT NULL
status TEXT CHECK(pending|sent|failed|suppressed)
attempts INTEGER NOT NULL DEFAULT 0
last_error TEXT NULL
created_at INTEGER
sent_at INTEGER NULL
```

Outbox permite retries y evita acoplar la transacción crítica al proveedor de email.

---

## 29. Ref persistence

### 29.1 P0 standalone

Ref conserva IndexedDB/local persistence; no requiere tablas cloud para arbitraje standalone.

### 29.2 Future connected

Agregar:

- `referee_assignments`;
- `ref_match_submissions`;
- assignment status;
- result signature/hash;
- review state.

No construir hasta P2.

---

## 30. Analytics events

No guardar clickstream masivo en D1 V1.

Usar eventos de dominio ya persistidos + contadores simples.

Si se necesita product analytics futuro, integrar servicio/stream separado mediante ADR.

---

## 31. Índices mínimos

Ejemplos:

```text
organization_people(organization_id, user_id)
organization_memberships(organization_id, status)
reservations(court_id, start_at, end_at, status)
open_matches(organization_id, status, join_cutoff_at)
activity_sessions(activity_id, start_at)
tournaments(organizer_organization_id, status, start_at)
tournament_categories(tournament_id, sort_order)
tournament_entries(category_id, status)
entry_members(entry_id, status)
competition_encounters(competition_id, stage, group_id, leg_number)
matches(encounter_id, rubber_order)
schedule_items(tournament_id, start_at, court_label)
payments(tournament_id, status)
payment_events(provider, provider_event_id)
tournament_snapshots(tournament_id, created_at)
critical_audit_events(organization_id, created_at)
```

---

## 32. Authorization ownership rules

### 32.1 User profile

User puede leer/editar su perfil, salvo campos administrados.

### 32.2 Organization

Organization Admin puede leer/escribir datos de su organization.

### 32.3 Cross-organization

Ninguna query tenant-scoped se ejecuta sin validar organization context.

### 32.4 Tournament public

Anonymous nunca consulta tablas internas directamente. Consume public projection sanitizada.

### 32.5 Platform Admin

Acceso elevado sólo mediante middleware explícito y Support Mode para writes tenant-scoped.

---

## 33. Data invariants clave

1. Una reservation confirmada no puede solaparse con otra reserva/block activo de la misma cancha.
2. Un open_match debe tener reservation existente y no cancelada.
3. Un entry `individual` ready tiene 1 miembro.
4. Un entry `pair` ready tiene 2 miembros.
5. Un team ready satisface el roster schema de su format version.
6. Un match finalizado tiene resultado coherente o manual override marcado.
7. Una competencia bloqueada no cambia format_version_id.
8. Un result correction incrementa version/revision y queda auditado.
9. Un payment approved no puede volver a pending por un webhook viejo.
10. Un webhook duplicado no duplica efectos.
11. Un offline mutation duplicado no duplica efectos.
12. Una public projection nunca incluye tokens, notas internas, emails privados o secrets.
13. Una cosmetic person edit no elimina competition state.
14. Vuelta 2 no aparece en schedule antes de que Vuelta 1 haya sido completamente colocada.
15. Un team lineup no puede incluir persona fuera del entry roster.

---

## 34. ERD simplificado

```text
AUTH USER
   │
   ├── user_profiles
   │
   ├── organization_memberships ── organization
   │                                  │
   │                                  ├── organization_people
   │                                  ├── venues ── courts ── reservations ── open_matches
   │                                  ├── activities ── activity_sessions
   │                                  └── tournaments
   │                                         │
   │                                         ├── categories
   │                                         │    ├── entries ── entry_members ── organization_people
   │                                         │    └── format_versions
   │                                         │
   │                                         ├── competitions
   │                                         │    ├── groups
   │                                         │    └── encounters ── matches ── match_results / sets
   │                                         │
   │                                         ├── schedule_items
   │                                         ├── registrations ── payments
   │                                         ├── snapshots
   │                                         └── public_revisions
   │
   └── notifications
```

---

## 35. Migración del JSON legacy

El importador cloud debe poder transformar un `tournament-state.json` V2.4.x en:

- tournament;
- organization_people manuales;
- categories;
- entries/members;
- format version por categoría;
- competition/groups;
- encounters/matches/results;
- schedule items.

El JSON original debe conservarse como snapshot de migración para rollback/auditoría.

No es requisito mantener el schema JSON legacy internamente después de importarlo.

---

## 36. Decisiones que requieren ADR antes de producción

- Retención de snapshots.
- Retención de critical audit.
- Exacta política de deletion/privacy.
- Guardian/minor account model.
- Cifrado/rotación de OAuth tokens.
- Team standings custom rules para el clasificatorio de septiembre.
- Whether `public_revisions` se almacena en D1 o R2 si el payload crece significativamente.
