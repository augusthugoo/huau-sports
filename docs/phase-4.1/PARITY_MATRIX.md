# HUAU Tournament — Full Legacy Parity Matrix (Phase 4.1)

**Functional baseline:** HUAU Tournament V2.4.2 Local + Netlify Autocarga  
**Pack:** `0.5.2-phase4.1-parity`  
**Rule:** a legacy capability counts as ported only when the organizer can use it from the new workspace and the data model/engine can preserve it.

Legend:
- ✅ Ported in this pack.
- 🔁 Replaced deliberately by the new cloud architecture.
- ⏭ Kept as a later architectural phase; not a Tournament-admin parity omission.

## Players, categories and manual registration

| Legacy capability | Status | New HUAU implementation |
|---|---|---|
| One player record reused across categories | ✅ | `tournament_player_profiles` + assignments |
| Name, club, contact and notes | ✅ | Player editor |
| DUPR Singles and DUPR Doubles separately | ✅ | Profile fields and category-specific seed derivation |
| Paid / pending | ✅ | Player payment status |
| Confirmed / pending | ✅ | Player competitive status |
| Multiple categories per player | ✅ | Player↔category assignments |
| Different partner per category | ✅ | Reciprocal partner assignment |
| Detect incomplete/non-reciprocal pairs | ✅ | Category/player warnings; invalid pair excluded from derived entries |
| Cosmetic typo edit without destroying competition | ✅ | Cosmetic change refreshes derived labels/ratings; structural changes require impact confirmation |
| Existing Phase 4 manual entries survive migration | ✅ | Migration 0003 backfills profiles, category assignments and pair links |
| Category presets | ✅ | Legacy preset selector |
| Custom category | ✅ | Custom create |
| Edit / delete category safely | ✅ | Snapshot + impact flow for structural changes |
| Order categories | ✅ | Up/down order controls |
| Assign category to a day/jornada | ✅ | `scheduled_date` exposed |

## Format simulator and competition formats

| Legacy capability | Status | New HUAU implementation |
|---|---|---|
| Free simulator before/independent of category | ✅ | Tournament format simulator |
| Simulator per category | ✅ | Category format simulator |
| Minimum / preferred / maximum group size | ✅ | Tournament settings + simulator |
| Available time, courts and match duration | ✅ | Simulator inputs |
| Recommended / Fastest / More matches options | ✅ | `buildLegacyFormatOptions` |
| Exact proposed group sizes | ✅ | Candidate cards |
| Fits / overruns available window | ✅ | Candidate calculation/UI |
| 1 or 2 round robins | ✅ | Format config + scheduler |
| Qualifiers Auto / 1 / 2 per group | ✅ | Simulator/config |
| Wildcards | ✅ | Format config and qualification |
| Unequal group sizes | ✅ | Engine + simulator |
| Normalized cross-group comparison | ✅ | Engine + admin standings |
| Equalized cross-group comparison | ✅ | Engine + admin standings |
| Standard bracket | ✅ | Engine |
| Top 2 → Final | ✅ | Engine/UI |
| Top 4 → Semifinals | ✅ | Engine/UI |
| Top 3 step ladder | ✅ | Engine/UI |
| Champion by table / league only | ✅ | Engine/UI |
| Consolation | ✅ | Engine/UI |
| Bronze match | ✅ | Engine/UI |
| BO1 / BO3 medals | ✅ | Engine + inline set editor |
| Group and medal point targets | ✅ | Format config |
| Bronze/final sequential or simultaneous | ✅ | Scheduler |
| Performance draw | ✅ | Engine/config |
| Pots draw | ✅ | Engine/config |
| Avoid/allow immediate group rematch | ✅ | Engine/config |
| Minimum guaranteed matches objective | ✅ | Simulator/config |

## Seeding, groups and live draw

| Legacy capability | Status | New HUAU implementation |
|---|---|---|
| DUPR snake seeding | ✅ | Explicit `snake` method |
| Random draw | ✅ | Explicit `random` method |
| Manual order / manual groups | ✅ | Exact-capacity editor |
| Automatic suggestion inside manual groups | ✅ | Snake-based suggestion |
| Validate exact group capacities / duplicate assignments | ✅ | Core validation |
| Batch generation for ready categories | ✅ | Workspace action |
| Progressive live draw | ✅ | Persistent `tournament_draw_sessions` |
| One participant at a time | ✅ | `draw/next` |
| Rotating A/B/C… respecting unequal capacities | ✅ | Core live-draw target sequence |
| Automatic draw / pause | ✅ | UI timer/pause |
| Reshuffle / reset | ✅ | Resets only draw-session state |
| Competition remains untouched until Confirm | ✅ | Start/reset are non-structural; confirmation is the destructive boundary |
| Confirm completed draw | ✅ | Snapshot on locked category, then groups/schedule replacement |

## Schedule

| Legacy capability | Status | New HUAU implementation |
|---|---|---|
| Multiple courts | ✅ | Scheduler |
| Match duration per category | ✅ | Format config |
| Preferred rest | ✅ | Global tournament setting |
| Never schedule one person simultaneously | ✅ | Scheduler invariant |
| Maximize rotation/rest where possible | ✅ | Scheduler heuristic |
| Degrade ideal rest when required | ✅ | Scheduler |
| Finish Round 1 before any Round 2 match | ✅ | Regression-tested engine rule |
| Avoid consecutive repeat when alternative exists | ✅ | Scheduler heuristic |
| Category by day | ✅ | `scheduled_date` |
| Category order within day | ✅ | Sort order |
| Complete category before moving to next | ✅ | Scheduler |
| Independent daily start | ✅ | Tournament/day scheduling |
| End time is planning target, not hard cap | ✅ | Simulator/window display |
| Reserve final-stage slots before qualifiers are known | ✅ | Schedule placeholders |
| BO3 medal reserve gets longer duration | ✅ | Scheduler |
| Bronze/final simultaneous when configured/courts permit | ✅ | Scheduler |
| Bind real playoff match to reserved slot without moving it | ✅ | Final generation/schedule binding |
| Show real match, date/time, court, category, group/leg | ✅ | Schedule UI |
| Category real start/end window | ✅ | Schedule UI |
| Vertical schedule PNG, multi-page when needed | ✅ | Canvas export |

## Results, standings and final phase

| Legacy capability | Status | New HUAU implementation |
|---|---|---|
| BO1 result entry | ✅ | Inline editor |
| BO3 set-by-set result entry | ✅ | Inline set editor |
| Correct a result | ✅ | Result update flow |
| Results ordered by schedule | ✅ | Backend schedule-order query + UI |
| Highlight next pending match | ✅ | Results UI |
| Pending and completed sections | ✅ | Results UI |
| Group standings in the results workspace | ✅ | Engine output |
| Legacy group tie-break rules | ✅ | Tournament Engine |
| Cross-group Normalized/Equalized table | ✅ | Engine output/UI |
| Automatic qualification | ✅ | Engine |
| Automatically create final phase after last group result | ✅ | Result route |
| Standard bracket/byes/winner propagation | ✅ | Engine |
| Bronze from semifinal losers | ✅ | Engine |
| Correcting group result can rebuild affected final phase safely | ✅ | Snapshot + impact guard; refuses silent rewrite of played finals |
| Finals replace reserved placeholders | ✅ | Schedule binding |
| Tournament completion state | ✅ | Backend status flow |

## Operation, sharing and recovery

| Legacy capability | Status | New HUAU implementation |
|---|---|---|
| Internal TV mode | ✅ | Dedicated admin TV surface |
| Auto active category | ✅ | TV derives active/next category |
| Standings during groups | ✅ | TV |
| Bracket during finals | ✅ | TV |
| Upcoming matches | ✅ | TV |
| Latest results | ✅ | TV |
| Auto-advance category | ✅ | TV |
| Auto refresh | ✅ | TV refresh |
| Group PNG | ✅ | Canvas export |
| Promotional tournament image | ✅ | Canvas export |
| Backup/export JSON | ✅ | Admin backup endpoint + UI |
| Import legacy state as a new tournament | ✅ | Phase 3 importer exposed safely |
| Reset competition but keep tournament/player setup | ✅ | Snapshot-protected reset |
| Snapshots before destructive changes | ✅ | New architecture |
| Restore snapshot | ✅ | Recovery UI/backend |
| Audit trail / working revisions | ✅ | New architecture |

## Deliberate architectural replacements

These legacy implementation details are **not missing functions**:

| Legacy implementation | New decision |
|---|---|
| Mac/Python local server | 🔁 Cloudflare Worker + D1 |
| `/api/state` local source of truth | 🔁 D1 domain persistence |
| Netlify polling/autoload of `tournament-state.json` | 🔁 Explicit backup/import + cloud persistence |
| localStorage as canonical tournament state | 🔁 D1; local operational cache comes in PWA phase |
| Application Cache / old-iOS compatibility hacks | 🔁 Modern PWA/offline architecture |
| Two separate local/Netlify distributions | 🔁 One cloud product |

## Later architectural phases, not legacy-parity omissions

- ⏭ Public HUAU Live/realtime surface: Phase 9.
- ⏭ PWA/offline queue/conflict sync: Phase 10.
- ⏭ Team Competition Engine: Phase 5 (new capability).
- ⏭ Online registrations: Phase 6 (new capability).
- ⏭ Payments: Phase 7 (new capability).
- ⏭ Bilingual Format Explanation Engine: Phase 8 (expanded new capability).

## Acceptance gate

Before merging Phase 4 into `main`:

1. Apply migration 0003 to `huau-dev`.
2. Run `pnpm typecheck`, `pnpm test`, `pnpm lint`.
3. Validate the branch preview with at least:
   - 4-pair single group;
   - unequal 3/4/4;
   - two-round regression;
   - manual groups;
   - live draw without modifying confirmed competition until Confirm;
   - BO3 medal match;
   - result correction after final phase generation;
   - schedule/results chronological parity;
   - TV mode;
   - backup export/import and snapshot restore.
4. Only after branch validation, apply the same migration to `huau-staging`, merge to `main`, and rehearse a realistic tournament.

