import { useCallback, useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { createMixedFiveRubberTeamFormat, type TeamFormat } from "@huau/core";
import type { Locale } from "./i18n";

type Profile = {
  profileId: string;
  personId: string;
  displayName: string;
  club: string;
  playerStatus: string;
  sportGender: "male" | "female" | "unspecified";
};

type RosterMember = {
  personId: string;
  name: string;
  role: "player" | "captain" | "substitute";
  sportGender: "male" | "female" | "unspecified";
};

type TeamEntry = {
  id: string;
  categoryId: string;
  displayName: string;
  status: string;
  roster: RosterMember[];
};

type TeamGroupRow = {
  id: string;
  name: string;
  categoryId: string;
  entryId: string | null;
  entryName: string | null;
  sortOrder: number | null;
};

type TeamMatch = {
  id: string;
  encounterId: string;
  rubberKey: string;
  rubberOrder: number;
  mode: "singles" | "doubles";
  competitionGender: "male" | "female" | "mixed" | "open";
  bestOf: number;
  pointTarget: number;
  status: string;
  winnerSide: "A" | "B" | null;
  scoreA: number | null;
  scoreB: number | null;
  resultStatus: string | null;
  scheduleStart: number | null;
  scheduleEnd: number | null;
  courtLabel: string | null;
  scheduleStatus: string | null;
  sets: Array<{ setNumber: number; scoreA: number; scoreB: number; winnerSide: string }>;
};

type TeamLineup = {
  id: string;
  encounterId: string;
  entryId: string;
  status: "draft" | "locked";
  lockedAt: number | null;
  assignments: Array<{ lineupId: string; rubberKey: string; personId: string; position: number }>;
};

type TeamEncounter = {
  id: string;
  categoryId: string;
  groupId: string | null;
  groupName: string | null;
  legNumber: number;
  entryAId: string;
  sideA: string;
  entryBId: string;
  sideB: string;
  status: string;
  winnerEntryId: string | null;
  matches: TeamMatch[];
  lineups: TeamLineup[];
};

type Standing = {
  groupId: string;
  groupName: string;
  rows: Array<{
    entryId: string;
    entryName: string;
    played: number;
    wins: number;
    losses: number;
    winRate: number;
    rubbersFor: number;
    rubbersAgainst: number;
    rubberDiff: number;
    pointsFor: number;
    pointsAgainst: number;
    pointDiff: number;
  }>;
  explanation: { criteria: string[]; fallback: string };
};

type TeamCategory = {
  id: string;
  name: string;
  scheduledDate: string | null;
  structureLocked: number;
  formatVersionId: string | null;
  entryCount: number;
  format: TeamFormat | null;
  entries: TeamEntry[];
  groups: TeamGroupRow[];
  encounters: TeamEncounter[];
  standings: Standing[];
};

type TeamDetail = { ok: true; profiles: Profile[]; categories: TeamCategory[] };

type Props = { tournamentId: string; locale: Locale };

class ApiError extends Error {
  code: string;
  impact: string | undefined;
  constructor(code: string, impact?: string) {
    super(code);
    this.code = code;
    this.impact = impact;
  }
}

const tr = (locale: Locale, es: string, en: string) => (locale === "es" ? es : en);

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: { "content-type": "application/json", ...init?.headers },
  });
  const payload = (await response.json()) as T & { code?: string; impact?: string };
  if (!response.ok) throw new ApiError(payload.code ?? `HTTP_${response.status}`, payload.impact);
  return payload;
}

async function impactApi<T>(locale: Locale, path: string, method: "POST" | "PUT" | "DELETE", body: Record<string, unknown>): Promise<T> {
  try {
    return await api<T>(path, { method, body: JSON.stringify(body) });
  } catch (error) {
    if (error instanceof ApiError && error.code === "STRUCTURE_CHANGE_CONFIRM_REQUIRED") {
      const proceed = window.confirm(
        error.impact ?? tr(locale, "Este cambio modifica la estructura Team. ¿Continuar?", "This change modifies the Team structure. Continue?"),
      );
      if (!proceed) throw error;
      return api<T>(path, { method, body: JSON.stringify({ ...body, confirmImpact: true }) });
    }
    throw error;
  }
}

function cloneFormat(format: TeamFormat): TeamFormat {
  return JSON.parse(JSON.stringify(format)) as TeamFormat;
}

export function TeamTournamentPanel({ tournamentId, locale }: Props) {
  const [detail, setDetail] = useState<TeamDetail | null>(null);
  const [selectedCategoryId, setSelectedCategoryId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const result = await api<TeamDetail>(`/api/admin/tournaments/${tournamentId}/team`);
      setDetail(result);
      setSelectedCategoryId((current) => {
        if (current && result.categories.some((category) => category.id === current)) return current;
        return result.categories[0]?.id ?? "";
      });
      setError("");
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "TEAM_LOAD_FAILED");
    }
  }, [tournamentId]);

  useEffect(() => {
    void load();
  }, [load]);

  const mutate = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError("");
    try {
      await fn();
      await load();
    } catch (mutationError) {
      if (mutationError instanceof ApiError && mutationError.code === "STRUCTURE_CHANGE_CONFIRM_REQUIRED") return;
      setError(mutationError instanceof Error ? mutationError.message : "TEAM_MUTATION_FAILED");
    } finally {
      setBusy(false);
    }
  };

  if (!detail) return <section className="panel team-loading">{error || "Loading Team Engine…"}</section>;
  const category = detail.categories.find((item) => item.id === selectedCategoryId) ?? detail.categories[0] ?? null;

  return (
    <section className="team-workspace tpw-stack">
      <article className="panel team-intro">
        <div>
          <div className="eyebrow">TEAM COMPETITION ENGINE</div>
          <h2>{tr(locale, "Competencia por equipos", "Team competition")}</h2>
          <p>
            {tr(
              locale,
              "Rosters, series configurables, rubbers, alineaciones y standings viven dentro del mismo Tournament.",
              "Rosters, configurable encounters, rubbers, lineups and standings live inside the same Tournament.",
            )}
          </p>
        </div>
        <span className="pill strong">PHASE 5C</span>
      </article>

      {error ? <div className="tpw-alert">{error}</div> : null}

      <TeamCategoryCreate tournamentId={tournamentId} locale={locale} busy={busy} mutate={mutate} />

      {detail.categories.length > 0 ? (
        <>
          <article className="panel team-category-switcher">
            <div className="panel-title">
              <div>
                <div className="eyebrow">TEAM CATEGORIES</div>
                <h2>{tr(locale, "Categoría activa", "Active category")}</h2>
              </div>
              <span>{detail.categories.length}</span>
            </div>
            <div className="team-category-tabs">
              {detail.categories.map((item) => (
                <button
                  className={item.id === category?.id ? "light" : "ghost"}
                  key={item.id}
                  onClick={() => setSelectedCategoryId(item.id)}
                >
                  {item.name} · {item.entryCount}
                </button>
              ))}
            </div>
          </article>

          {category ? (
            <>
              <TeamFormatBuilder category={category} locale={locale} busy={busy} mutate={mutate} />
              <TeamRosterManager category={category} profiles={detail.profiles} locale={locale} busy={busy} mutate={mutate} />
              <TeamStructure category={category} locale={locale} busy={busy} mutate={mutate} />
              <TeamEncounters category={category} locale={locale} busy={busy} mutate={mutate} />
            </>
          ) : null}
        </>
      ) : (
        <article className="panel team-empty">
          <div className="eyebrow">READY</div>
          <h2>{tr(locale, "Creá la primera categoría Team", "Create the first Team category")}</h2>
          <p>
            {tr(
              locale,
              "El preset inicial usa 2 hombres + 2 mujeres como mínimo y MD · WD · MS · WS · XD. Todo se puede editar después.",
              "The initial preset uses at least 2 men + 2 women and MD · WD · MS · WS · XD. Everything can be edited afterwards.",
            )}
          </p>
        </article>
      )}
    </section>
  );
}

function TeamCategoryCreate({
  tournamentId,
  locale,
  busy,
  mutate,
}: {
  tournamentId: string;
  locale: Locale;
  busy: boolean;
  mutate: (fn: () => Promise<unknown>) => Promise<void>;
}) {
  const create = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    await mutate(async () => {
      await api(`/api/admin/tournaments/${tournamentId}/team/categories`, {
        method: "POST",
        body: JSON.stringify({
          name: data.get("name"),
          scheduledDate: data.get("scheduledDate") || null,
          mixedDoublesPlay: data.get("mixedDoublesPlay"),
        }),
      });
      form.reset();
    });
  };
  return (
    <article className="panel">
      <div className="panel-title">
        <div>
          <div className="eyebrow">NEW TEAM CATEGORY</div>
          <h2>{tr(locale, "Nueva categoría por equipos", "New team category")}</h2>
        </div>
      </div>
      <form className="inline-admin-form team-create-category" onSubmit={create}>
        <label>
          <span>{tr(locale, "Nombre", "Name")}</span>
          <input name="name" placeholder="Teams Open" required />
        </label>
        <label>
          <span>{tr(locale, "Jornada", "Day")}</span>
          <input name="scheduledDate" type="date" />
        </label>
        <label>
          <span>{tr(locale, "Mixto decisivo", "Mixed doubles")}</span>
          <select name="mixedDoublesPlay" defaultValue="always">
            <option value="always">{tr(locale, "Siempre se juega", "Always played")}</option>
            <option value="if_tied">{tr(locale, "Sólo si llegan empatados", "Only if tied")}</option>
          </select>
        </label>
        <button className="light" disabled={busy}>
          {tr(locale, "Crear Team", "Create Team")}
        </button>
      </form>
    </article>
  );
}

function TeamFormatBuilder({
  category,
  locale,
  busy,
  mutate,
}: {
  category: TeamCategory;
  locale: Locale;
  busy: boolean;
  mutate: (fn: () => Promise<unknown>) => Promise<void>;
}) {
  const [draft, setDraft] = useState<TeamFormat>(() => cloneFormat(category.format ?? createMixedFiveRubberTeamFormat()));
  useEffect(() => setDraft(cloneFormat(category.format ?? createMixedFiveRubberTeamFormat())), [category.id, category.formatVersionId]);

  const updateRoster = (patch: Partial<TeamFormat["roster"]>) => setDraft((current) => ({ ...current, roster: { ...current.roster, ...patch } }));
  const updateRules = (patch: Partial<TeamFormat["roster"]["rules"]>) =>
    setDraft((current) => ({ ...current, roster: { ...current.roster, rules: { ...current.roster.rules, ...patch } } }));
  const updateEncounter = (patch: Partial<TeamFormat["encounter"]>) => setDraft((current) => ({ ...current, encounter: { ...current.encounter, ...patch } }));
  const updateRubber = (index: number, patch: Partial<TeamFormat["encounter"]["rubbers"][number]>) =>
    setDraft((current) => ({
      ...current,
      encounter: {
        ...current.encounter,
        rubbers: current.encounter.rubbers.map((rubber, rubberIndex) => (rubberIndex === index ? { ...rubber, ...patch } : rubber)),
      },
    }));
  const reorder = (index: number, direction: -1 | 1) => {
    setDraft((current) => {
      const rubbers = [...current.encounter.rubbers];
      const target = index + direction;
      if (target < 0 || target >= rubbers.length) return current;
      [rubbers[index], rubbers[target]] = [rubbers[target]!, rubbers[index]!];
      return {
        ...current,
        encounter: { ...current.encounter, rubbers: rubbers.map((rubber, rubberIndex) => ({ ...rubber, order: rubberIndex + 1 })) },
      };
    });
  };
  const removeRubber = (index: number) =>
    setDraft((current) => ({
      ...current,
      encounter: {
        ...current.encounter,
        rubbers: current.encounter.rubbers.filter((_, rubberIndex) => rubberIndex !== index).map((rubber, rubberIndex) => ({ ...rubber, order: rubberIndex + 1 })),
      },
    }));
  const addRubber = () =>
    setDraft((current) => {
      const order = current.encounter.rubbers.length + 1;
      return {
        ...current,
        encounter: {
          ...current.encounter,
          rubbers: [
            ...current.encounter.rubbers,
            {
              key: `r${order}`,
              label: `${tr(locale, "Partido", "Rubber")} ${order}`,
              order,
              mode: "doubles",
              gender: "open",
              play: "always",
              isTiebreaker: false,
              weight: 1,
              bestOf: 1,
              pointTarget: 15,
              scoringMode: null,
            },
          ],
        },
      };
    });

  const save = () =>
    mutate(() => impactApi(locale, `/api/admin/team-categories/${category.id}/format`, "PUT", { format: draft }));

  return (
    <article className="panel team-format-builder">
      <div className="panel-title">
        <div>
          <div className="eyebrow">FORMAT BUILDER</div>
          <h2>{category.name}</h2>
          <p>{tr(locale, "El formato de 5 partidos es un preset, no una regla hardcodeada.", "The five-rubber format is a preset, not a hardcoded rule.")}</p>
        </div>
        <span className="pill strong">{category.structureLocked ? tr(locale, "GENERADO", "GENERATED") : tr(locale, "EDITABLE", "EDITABLE")}</span>
      </div>

      <div className="team-builder-grid">
        <section className="team-config-block">
          <h3>{tr(locale, "Roster", "Roster")}</h3>
          <div className="four">
            <label><span>{tr(locale, "Mínimo", "Minimum")}</span><input type="number" min="1" value={draft.roster.min} onChange={(event) => updateRoster({ min: Number(event.target.value) })} /></label>
            <label><span>{tr(locale, "Máximo", "Maximum")}</span><input type="number" min="1" value={draft.roster.max} onChange={(event) => updateRoster({ max: Number(event.target.value) })} /></label>
            <label><span>{tr(locale, "Hombres mín.", "Men min.")}</span><input type="number" min="0" value={draft.roster.rules.maleMin} onChange={(event) => updateRules({ maleMin: Number(event.target.value) })} /></label>
            <label><span>{tr(locale, "Mujeres mín.", "Women min.")}</span><input type="number" min="0" value={draft.roster.rules.femaleMin} onChange={(event) => updateRules({ femaleMin: Number(event.target.value) })} /></label>
          </div>
          <div className="three">
            <label><span>{tr(locale, "Composición", "Composition")}</span><select value={draft.roster.composition} onChange={(event) => updateRoster({ composition: event.target.value as TeamFormat["roster"]["composition"] })}><option value="mixed">Mixed</option><option value="open">Open</option><option value="male">Male</option><option value="female">Female</option></select></label>
            <label className="check team-check"><input type="checkbox" checked={draft.roster.substitutesAllowed} onChange={(event) => updateRoster({ substitutesAllowed: event.target.checked })} /><span>{tr(locale, "Permitir suplentes", "Allow substitutes")}</span></label>
            <label className="check team-check"><input type="checkbox" checked={draft.roster.captainRequired} onChange={(event) => updateRoster({ captainRequired: event.target.checked })} /><span>{tr(locale, "Capitán obligatorio", "Captain required")}</span></label>
          </div>
        </section>

        <section className="team-config-block">
          <h3>{tr(locale, "Serie", "Encounter")}</h3>
          <div className="four">
            <label><span>{tr(locale, "Ganador", "Winner rule")}</span><select value={draft.encounter.winnerRule} onChange={(event) => updateEncounter({ winnerRule: event.target.value as TeamFormat["encounter"]["winnerRule"], targetWins: event.target.value === "majority" ? null : draft.encounter.targetWins ?? 3 })}><option value="majority">Majority</option><option value="first_to">First to X</option></select></label>
            <label><span>{tr(locale, "Objetivo", "Target")}</span><input type="number" min="1" disabled={draft.encounter.winnerRule !== "first_to"} value={draft.encounter.targetWins ?? ""} onChange={(event) => updateEncounter({ targetWins: Number(event.target.value) || null })} /></label>
            <label><span>{tr(locale, "Vueltas de grupos", "Group rounds")}</span><select value={draft.competition.groupRounds} onChange={(event) => setDraft((current) => ({ ...current, competition: { ...current.competition, groupRounds: Number(event.target.value) as 1 | 2 } }))}><option value="1">1</option><option value="2">2</option></select></label>
            <label><span>Playoff</span><select value={draft.competition.playoffMode} onChange={(event) => setDraft((current) => ({ ...current, competition: { ...current.competition, playoffMode: event.target.value as TeamFormat["competition"]["playoffMode"] } }))}><option value="standard">Standard</option><option value="top2_final">Top 2 → Final</option><option value="top4_semis">Top 4 → Semis</option><option value="top3_step">Top 3 ladder</option><option value="league_only">League only</option></select></label>
          </div>
          <label className="check team-check"><input type="checkbox" checked={draft.encounter.playRemainingAfterClinched} onChange={(event) => updateEncounter({ playRemainingAfterClinched: event.target.checked })} /><span>{tr(locale, "Jugar rubbers restantes aunque la serie ya esté definida", "Play remaining rubbers after the encounter is clinched")}</span></label>
        </section>
      </div>

      <section className="team-rubbers">
        <div className="team-section-head">
          <div><h3>Rubbers</h3><p>{tr(locale, "Agregá, quitá y ordená los partidos de cada serie.", "Add, remove and order the matches inside each encounter.")}</p></div>
          <button className="ghost small" type="button" onClick={addRubber}>+ {tr(locale, "Agregar rubber", "Add rubber")}</button>
        </div>
        <div className="team-rubber-list">
          {draft.encounter.rubbers.map((rubber, index) => (
            <div className="team-rubber-row" key={`${rubber.key}-${index}`}>
              <div className="team-rubber-order"><strong>{index + 1}</strong><button type="button" onClick={() => reorder(index, -1)} disabled={index === 0}>↑</button><button type="button" onClick={() => reorder(index, 1)} disabled={index === draft.encounter.rubbers.length - 1}>↓</button></div>
              <label><span>{tr(locale, "Código", "Key")}</span><input value={rubber.key} onChange={(event) => updateRubber(index, { key: event.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, "") })} /></label>
              <label className="team-rubber-label"><span>{tr(locale, "Nombre", "Label")}</span><input value={rubber.label} onChange={(event) => updateRubber(index, { label: event.target.value })} /></label>
              <label><span>{tr(locale, "Modalidad", "Mode")}</span><select value={rubber.mode} onChange={(event) => updateRubber(index, { mode: event.target.value as "singles" | "doubles" })}><option value="singles">Singles</option><option value="doubles">Doubles</option></select></label>
              <label><span>{tr(locale, "Género", "Gender")}</span><select value={rubber.gender} onChange={(event) => updateRubber(index, { gender: event.target.value as TeamFormat["encounter"]["rubbers"][number]["gender"] })}><option value="male">Male</option><option value="female">Female</option><option value="mixed">Mixed</option><option value="open">Open</option></select></label>
              <label><span>BO</span><select value={rubber.bestOf} onChange={(event) => updateRubber(index, { bestOf: Number(event.target.value) as 1 | 3 })}><option value="1">1</option><option value="3">3</option></select></label>
              <label><span>{tr(locale, "A puntos", "To points")}</span><input type="number" min="1" value={rubber.pointTarget} onChange={(event) => updateRubber(index, { pointTarget: Number(event.target.value) })} /></label>
              <label><span>{tr(locale, "Peso", "Weight")}</span><input type="number" min="0.1" step="0.1" value={rubber.weight} onChange={(event) => updateRubber(index, { weight: Number(event.target.value) })} /></label>
              <label><span>{tr(locale, "Se juega", "Play")}</span><select value={rubber.play} onChange={(event) => updateRubber(index, { play: event.target.value as "always" | "if_tied", isTiebreaker: event.target.value === "if_tied" })}><option value="always">Always</option><option value="if_tied">If tied</option></select></label>
              <button className="danger small" type="button" onClick={() => removeRubber(index)} disabled={draft.encounter.rubbers.length <= 1}>×</button>
            </div>
          ))}
        </div>
      </section>

      <div className="form-actions team-format-actions">
        <button className="ghost" type="button" onClick={() => setDraft(createMixedFiveRubberTeamFormat("always"))}>{tr(locale, "Preset 5 partidos", "5-rubber preset")}</button>
        <button className="ghost" type="button" onClick={() => setDraft(createMixedFiveRubberTeamFormat("if_tied"))}>{tr(locale, "Preset XD decisivo", "Deciding XD preset")}</button>
        <button className="light" type="button" disabled={busy} onClick={() => void save()}>{tr(locale, "Guardar formato Team", "Save Team format")}</button>
      </div>
    </article>
  );
}

function TeamRosterManager({
  category,
  profiles,
  locale,
  busy,
  mutate,
}: {
  category: TeamCategory;
  profiles: Profile[];
  locale: Locale;
  busy: boolean;
  mutate: (fn: () => Promise<unknown>) => Promise<void>;
}) {
  const create = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const members = profiles
      .filter((profile) => data.get(`member:${profile.personId}`) === "on")
      .map((profile) => ({
        personId: profile.personId,
        role: String(data.get(`role:${profile.personId}`) ?? "player"),
      }));
    await mutate(async () => {
      await impactApi(locale, `/api/admin/team-categories/${category.id}/teams`, "POST", { name: data.get("name"), members });
      form.reset();
    });
  };

  const usedPersonIds = new Set(category.entries.flatMap((entry) => entry.roster.map((member) => member.personId)));
  const availableProfiles = profiles.filter((profile) => !usedPersonIds.has(profile.personId));

  return (
    <article className="panel team-rosters">
      <div className="panel-title">
        <div>
          <div className="eyebrow">ROSTERS</div>
          <h2>{tr(locale, "Equipos y jugadores", "Teams & players")}</h2>
          <p>{tr(locale, "Los jugadores salen de la ficha única del torneo; acá sólo definís quién integra cada roster.", "Players come from the tournament profile registry; here you only define each roster.")}</p>
        </div>
        <span>{category.entries.length}</span>
      </div>

      <form className="team-roster-create" onSubmit={create}>
        <label className="team-name-field"><span>{tr(locale, "Nombre del equipo", "Team name")}</span><input name="name" required placeholder="HUAU Black" /></label>
        <div className="team-player-picker">
          {availableProfiles.length ? availableProfiles.map((profile) => (
            <div className="team-player-option" key={profile.personId}>
              <label className="check"><input type="checkbox" name={`member:${profile.personId}`} /><span><strong>{profile.displayName}</strong><small>{profile.club || "—"} · {profile.sportGender === "male" ? "M" : profile.sportGender === "female" ? "F" : tr(locale, "género pendiente", "gender pending")}</small></span></label>
              <select name={`role:${profile.personId}`} defaultValue="player"><option value="player">Player</option><option value="captain">Captain</option><option value="substitute">Sub</option></select>
            </div>
          )) : <p className="muted">{profiles.length ? tr(locale, "Todos los jugadores disponibles ya pertenecen a un equipo de esta categoría.", "All available players already belong to a team in this category.") : tr(locale, "Primero cargá jugadores y su género en la pestaña Jugadores.", "Add players and their gender in the Players tab first.")}</p>}
        </div>
        <button className="light" disabled={busy || !availableProfiles.length}>{tr(locale, "Crear equipo", "Create team")}</button>
      </form>

      <div className="team-entry-grid">
        {category.entries.map((entry) => <TeamEntryCard key={entry.id} entry={entry} category={category} profiles={profiles} locale={locale} busy={busy} mutate={mutate} />)}
      </div>
    </article>
  );
}

function TeamEntryCard({
  entry,
  category,
  profiles,
  locale,
  busy,
  mutate,
}: {
  entry: TeamEntry;
  category: TeamCategory;
  profiles: Profile[];
  locale: Locale;
  busy: boolean;
  mutate: (fn: () => Promise<unknown>) => Promise<void>;
}) {
  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const members = profiles
      .filter((profile) => data.get(`member:${profile.personId}`) === "on")
      .map((profile) => ({
        personId: profile.personId,
        role: String(data.get(`role:${profile.personId}`) ?? "player"),
      }));
    await mutate(() => impactApi(locale, `/api/admin/team-entries/${entry.id}`, "PUT", { name: data.get("name"), members }));
  };
  const remove = async () => {
    if (!window.confirm(tr(locale, `¿Eliminar ${entry.displayName}?`, `Delete ${entry.displayName}?`))) return;
    await mutate(() => impactApi(locale, `/api/admin/team-entries/${entry.id}`, "DELETE", {}));
  };
  const rosterById = new Map(entry.roster.map((member) => [member.personId, member] as const));
  const usedByOtherTeams = new Set(category.entries.filter((candidate) => candidate.id !== entry.id).flatMap((candidate) => candidate.roster.map((member) => member.personId)));
  const editableProfiles = profiles.filter((profile) => rosterById.has(profile.personId) || !usedByOtherTeams.has(profile.personId));
  return (
    <article className="team-entry-card">
      <header><div><strong>{entry.displayName}</strong><span>{entry.roster.length} {tr(locale, "jugadores", "players")}</span></div><div className="form-actions"><span className="pill">{entry.status}</span><button className="danger small" type="button" disabled={busy} onClick={() => void remove()}>×</button></div></header>
      <div className="team-roster-chips">{entry.roster.map((member) => <span key={member.personId}>{member.name} · {member.sportGender === "male" ? "M" : member.sportGender === "female" ? "F" : "—"}{member.role !== "player" ? ` · ${member.role}` : ""}</span>)}</div>
      <details>
        <summary>{tr(locale, "Editar roster", "Edit roster")}</summary>
        <form className="team-entry-edit" onSubmit={save}>
          <label><span>{tr(locale, "Nombre", "Name")}</span><input name="name" defaultValue={entry.displayName} required /></label>
          <div className="team-player-picker compact">
            {editableProfiles.map((profile) => {
              const member = rosterById.get(profile.personId);
              return <div className="team-player-option" key={profile.personId}>
                <label className="check"><input type="checkbox" name={`member:${profile.personId}`} defaultChecked={Boolean(member)} /><span><strong>{profile.displayName}</strong><small>{profile.sportGender === "male" ? "M" : profile.sportGender === "female" ? "F" : tr(locale, "género pendiente", "gender pending")}</small></span></label>
                <select name={`role:${profile.personId}`} defaultValue={member?.role ?? "player"}><option value="player">Player</option><option value="captain">Captain</option><option value="substitute">Sub</option></select>
              </div>;
            })}
          </div>
          <button className="light small" disabled={busy}>{tr(locale, "Guardar roster", "Save roster")}</button>
        </form>
      </details>
    </article>
  );
}

function TeamStructure({
  category,
  locale,
  busy,
  mutate,
}: {
  category: TeamCategory;
  locale: Locale;
  busy: boolean;
  mutate: (fn: () => Promise<unknown>) => Promise<void>;
}) {
  const maxGroups = Math.max(1, Math.floor(category.entries.length / 2));
  const generate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    await mutate(() => impactApi(locale, `/api/admin/team-categories/${category.id}/generate`, "POST", { groupCount: Number(data.get("groupCount") || 1) }));
  };
  const grouped = useMemo(() => {
    const map = new Map<string, { id: string; name: string; entries: string[] }>();
    category.groups.forEach((row) => {
      const group = map.get(row.id) ?? { id: row.id, name: row.name, entries: [] };
      if (row.entryName) group.entries.push(row.entryName);
      map.set(row.id, group);
    });
    return [...map.values()];
  }, [category.groups]);
  return (
    <article className="panel team-structure">
      <div className="panel-title"><div><div className="eyebrow">COMPETITION</div><h2>{tr(locale, "Grupos y series", "Groups & encounters")}</h2><p>{tr(locale, "La primera versión genera round-robin de grupos. El playoff Team se conecta en el siguiente bloque.", "This first version generates group round-robin. Team playoffs connect in the next block.")}</p></div><span>{category.encounters.length}</span></div>
      <form className="inline-admin-form" onSubmit={generate}>
        <label><span>{tr(locale, "Cantidad de grupos", "Group count")}</span><input name="groupCount" type="number" min="1" max={maxGroups} defaultValue="1" /></label>
        <button className="light" disabled={busy || category.entries.length < 2}>{category.structureLocked ? tr(locale, "Regenerar estructura", "Regenerate structure") : tr(locale, "Generar estructura", "Generate structure")}</button>
      </form>
      {grouped.length ? <div className="team-group-grid">{grouped.map((group) => <div className="team-group-card" key={group.id}><strong>{tr(locale, "Grupo", "Group")} {group.name}</strong>{group.entries.map((entry, index) => <span key={`${entry}-${index}`}>{index + 1}. {entry}</span>)}</div>)}</div> : null}
    </article>
  );
}

function TeamStandings({ category, locale }: { category: TeamCategory; locale: Locale }) {
  if (!category.standings.length) return null;
  return (
    <article className="panel team-standings">
      <div className="panel-title"><div><div className="eyebrow">STANDINGS</div><h2>{tr(locale, "Tabla de equipos", "Team standings")}</h2></div></div>
      <div className="team-standing-grid">
        {category.standings.map((standing) => <div className="team-standing-card" key={standing.groupId}>
          <h3>{tr(locale, "Grupo", "Group")} {standing.groupName}</h3>
          <div className="table-wrap"><table><thead><tr><th>#</th><th>{tr(locale, "Equipo", "Team")}</th><th>PJ</th><th>PG</th><th>PP</th><th>RF</th><th>RC</th><th>DIF R</th><th>PF</th><th>PC</th><th>DIF P</th></tr></thead><tbody>{standing.rows.map((row, index) => <tr key={row.entryId}><td>{index + 1}</td><td>{row.entryName}</td><td>{row.played}</td><td>{row.wins}</td><td>{row.losses}</td><td>{row.rubbersFor}</td><td>{row.rubbersAgainst}</td><td>{row.rubberDiff}</td><td>{row.pointsFor}</td><td>{row.pointsAgainst}</td><td>{row.pointDiff}</td></tr>)}</tbody></table></div>
          <small>{tr(locale, "Criterios", "Criteria")}: {standing.explanation.criteria.join(" → ")}</small>
        </div>)}
      </div>
    </article>
  );
}

function TeamEncounters({
  category,
  locale,
  busy,
  mutate,
}: {
  category: TeamCategory;
  locale: Locale;
  busy: boolean;
  mutate: (fn: () => Promise<unknown>) => Promise<void>;
}) {
  if (!category.encounters.length) return null;
  const entryById = new Map(category.entries.map((entry) => [entry.id, entry] as const));
  return (
    <article className="panel team-encounters">
      <div className="panel-title"><div><div className="eyebrow">LINEUP DESK</div><h2>{tr(locale, "Series y alineaciones", "Encounters & lineups")}</h2><p>{tr(locale, "La operación de resultados vive ahora en Resultados y respeta el cronograma global.", "Result operation now lives in Results and follows the global schedule.")}</p></div><span>{category.encounters.length}</span></div>
      <div className="team-encounter-list">
        {category.encounters.map((encounter) => <TeamEncounterCard key={encounter.id} encounter={encounter} format={category.format} entryA={entryById.get(encounter.entryAId)} entryB={entryById.get(encounter.entryBId)} locale={locale} busy={busy} mutate={mutate} />)}
      </div>
    </article>
  );
}

function TeamEncounterCard({
  encounter,
  format,
  entryA,
  entryB,
  locale,
  busy,
  mutate,
}: {
  encounter: TeamEncounter;
  format: TeamFormat | null;
  entryA: TeamEntry | undefined;
  entryB: TeamEntry | undefined;
  locale: Locale;
  busy: boolean;
  mutate: (fn: () => Promise<unknown>) => Promise<void>;
}) {
  if (!format || !entryA || !entryB) return null;
  const rubberByKey = new Map(format.encounter.rubbers.map((rubber) => [rubber.key, rubber] as const));
  const winsA = encounter.matches
    .filter((match) => match.winnerSide === "A")
    .reduce((sum, match) => sum + (rubberByKey.get(match.rubberKey)?.weight ?? 1), 0);
  const winsB = encounter.matches
    .filter((match) => match.winnerSide === "B")
    .reduce((sum, match) => sum + (rubberByKey.get(match.rubberKey)?.weight ?? 1), 0);
  const lineupA = encounter.lineups.find((lineup) => lineup.entryId === entryA.id);
  const lineupB = encounter.lineups.find((lineup) => lineup.entryId === entryB.id);
  return (
    <article className="team-encounter-card">
      <header>
        <div><span>{tr(locale, "Grupo", "Group")} {encounter.groupName ?? "—"} · V{encounter.legNumber}</span><h3>{entryA.displayName} <em>{winsA} — {winsB}</em> {entryB.displayName}</h3></div>
        <span className={`pill team-status-${encounter.status}`}>{encounter.status}</span>
      </header>
      <details>
        <summary>{tr(locale, "Alineaciones", "Lineups")} · {lineupA?.status ?? "draft"} / {lineupB?.status ?? "draft"}</summary>
        <div className="team-lineup-grid">
          <TeamLineupEditor encounter={encounter} entry={entryA} lineup={lineupA} format={format} locale={locale} busy={busy} mutate={mutate} />
          <TeamLineupEditor encounter={encounter} entry={entryB} lineup={lineupB} format={format} locale={locale} busy={busy} mutate={mutate} />
        </div>
      </details>

    </article>
  );
}

function rosterEligibleForRubber(member:RosterMember,rubber:TeamFormat["encounter"]["rubbers"][number],slot:number){if(rubber.gender==="open")return true;if(rubber.gender==="male")return member.sportGender==="male";if(rubber.gender==="female")return member.sportGender==="female";if(rubber.gender==="mixed")return slot===0?member.sportGender==="male":member.sportGender==="female";return true;}

function TeamLineupEditor({
  encounter,
  entry,
  lineup,
  format,
  locale,
  busy,
  mutate,
}: {
  encounter: TeamEncounter;
  entry: TeamEntry;
  lineup: TeamLineup | undefined;
  format: TeamFormat;
  locale: Locale;
  busy: boolean;
  mutate: (fn: () => Promise<unknown>) => Promise<void>;
}) {
  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const submitter = (event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
    const lock = submitter?.value === "lock";
    const data = new FormData(event.currentTarget);
    const assignments = format.encounter.rubbers.map((rubber) => ({
      rubberKey: rubber.key,
      personIds: Array.from({ length: rubber.mode === "singles" ? 1 : 2 }, (_, index) => String(data.get(`${rubber.key}:${index}`) ?? "")).filter(Boolean),
    }));
    const administrativeOverride = lineup?.status === "locked";
    await mutate(() => api(`/api/admin/team-encounters/${encounter.id}/lineups/${entry.id}`, {
      method: "PUT",
      body: JSON.stringify({ assignments, lock, administrativeOverride }),
    }));
  };
  const assignmentMap = new Map<string, string[]>();
  lineup?.assignments.forEach((assignment) => {
    const list = assignmentMap.get(assignment.rubberKey) ?? [];
    list[assignment.position - 1] = assignment.personId;
    assignmentMap.set(assignment.rubberKey, list);
  });
  return (
    <form className="team-lineup-editor" onSubmit={(event) => void save(event)}>
      <div className="team-lineup-title"><strong>{entry.displayName}</strong><span className="pill">{lineup?.status ?? "draft"}</span></div>
      {format.encounter.rubbers.slice().sort((a, b) => a.order - b.order).map((rubber) => {
        const current = assignmentMap.get(rubber.key) ?? [];
        const slots = rubber.mode === "singles" ? 1 : 2;
        return <div className="team-lineup-rubber" key={rubber.key}><span>{rubber.label}</span><div>{Array.from({ length: slots }, (_, index) => <select name={`${rubber.key}:${index}`} key={index} defaultValue={current[index] ?? ""} required><option value="">—</option>{entry.roster.filter(member=>rosterEligibleForRubber(member,rubber,index)).map((member) => <option key={member.personId} value={member.personId}>{member.name} · {member.sportGender === "male" ? "M" : member.sportGender === "female" ? "F" : "—"}</option>)}</select>)}</div></div>;
      })}
      <div className="form-actions"><button className="ghost small" name="lineupAction" value="draft" disabled={busy}>{tr(locale, "Guardar draft", "Save draft")}</button><button className="light small" name="lineupAction" value="lock" disabled={busy}>{tr(locale, "Guardar y bloquear", "Save & lock")}</button></div>
    </form>
  );
}

function TeamRubberResultEditor({
  match,
  rubberLabel,
  sideA,
  sideB,
  lineupsLocked,
  locale,
  busy,
  mutate,
}: {
  match: TeamMatch;
  rubberLabel: string;
  sideA: string;
  sideB: string;
  lineupsLocked: boolean;
  locale: Locale;
  busy: boolean;
  mutate: (fn: () => Promise<unknown>) => Promise<void>;
}) {
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const setCount = match.bestOf === 3 ? 3 : 1;
    const sets = Array.from({ length: setCount }, (_, index) => ({
      scoreA: Number(data.get(`a${index + 1}`) ?? 0),
      scoreB: Number(data.get(`b${index + 1}`) ?? 0),
    })).filter((set, index) => index === 0 || set.scoreA > 0 || set.scoreB > 0);
    await mutate(() => api(`/api/admin/team-matches/${match.id}/result`, { method: "POST", body: JSON.stringify({ sets }) }));
  };
  const existingBySet = new Map(match.sets.map((set) => [set.setNumber, set] as const));
  return (
    <form className={`team-result-row is-${match.status}`} onSubmit={submit}>
      <div className="team-result-label"><span>{match.rubberOrder}</span><div><strong>{rubberLabel}</strong><small>{match.mode} · {match.competitionGender} · BO{match.bestOf}</small></div></div>
      <div className="team-result-score"><span>{sideA}</span>{Array.from({ length: match.bestOf === 3 ? 3 : 1 }, (_, index) => <div className="team-set-input" key={index}><input name={`a${index + 1}`} type="number" min="0" defaultValue={existingBySet.get(index + 1)?.scoreA ?? ""} placeholder={`S${index + 1}`} /><b>—</b><input name={`b${index + 1}`} type="number" min="0" defaultValue={existingBySet.get(index + 1)?.scoreB ?? ""} placeholder={`S${index + 1}`} /></div>)}<span>{sideB}</span></div>
      <div className="team-result-action">{match.resultStatus ? <strong>{match.scoreA} — {match.scoreB}</strong> : <small>{match.status}</small>}<button className="light small" disabled={busy || !lineupsLocked || (match.status !== "ready" && !match.resultStatus)}>{match.resultStatus ? tr(locale, "Corregir", "Correct") : tr(locale, "Cargar", "Enter")}</button></div>
    </form>
  );
}

function useTeamSnapshot(tournamentId: string, pollMs = 0) {
  const [detail, setDetail] = useState<TeamDetail | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    try {
      const result = await api<TeamDetail>(`/api/admin/tournaments/${tournamentId}/team`);
      setDetail(result);
      setError("");
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "TEAM_LOAD_FAILED");
    } finally {
      setLoading(false);
    }
  }, [tournamentId]);
  useEffect(() => {
    void load();
    if (!pollMs) return;
    const timer = window.setInterval(() => void load(), pollMs);
    return () => window.clearInterval(timer);
  }, [load, pollMs]);
  return { detail, error, loading, reload: load };
}

function encounterDisplayScore(category:TeamCategory,encounter:TeamEncounter){const weights=new Map<string,number>(category.format?.encounter.rubbers.map(rubber=>[rubber.key,rubber.weight] as const)??[]);return {a:encounter.matches.filter(match=>match.winnerSide==="A").reduce((sum,match)=>sum+(weights.get(match.rubberKey)??1),0),b:encounter.matches.filter(match=>match.winnerSide==="B").reduce((sum,match)=>sum+(weights.get(match.rubberKey)??1),0)};}

export function TeamCompetitionPanel({ tournamentId, locale }: Props) {
  const { detail, error, loading } = useTeamSnapshot(tournamentId);
  if (loading) return <article className="panel"><p className="muted">{tr(locale, "Cargando competencia Team…", "Loading Team competition…")}</p></article>;
  if (error) return <div className="tpw-alert">{error}</div>;
  if (!detail?.categories.length) return null;
  return <section className="tpw-stack team-global-competition">
    {detail.categories.map((category) => <article className="panel" key={category.id}>
      <div className="panel-title"><div><div className="eyebrow">TEAM COMPETITION</div><h2>{category.name}</h2><p>{tr(locale,"Series y standings del Team Engine integrados a Competencia.","Team Engine encounters and standings integrated into Competition.")}</p></div><span>{category.encounters.length} {tr(locale,"series","encounters")}</span></div>
      <TeamStandings category={category} locale={locale}/>
      {category.groups.length ? <div className="team-competition-groups">{[...new Map<string,{id:string;name:string}>(category.groups.map(row=>[row.id,{id:row.id,name:row.name}] as const)).values()].map(group=><div className="team-competition-group" key={group.id}><h3>{tr(locale,"Grupo","Group")} {group.name}</h3>{category.encounters.filter(encounter=>encounter.groupId===group.id).map(encounter=>{
        const score=encounterDisplayScore(category,encounter);
        return <div className="team-competition-series" key={encounter.id}><span>{encounter.sideA}</span><strong>{score.a} — {score.b}</strong><span>{encounter.sideB}</span><small>{encounter.status}</small></div>;
      })}</div>)}</div> : <div className="empty-state">{tr(locale,"Generá la estructura Team para ver series y standings.","Generate the Team structure to see encounters and standings.")}</div>}
    </article>)}
  </section>;
}

type TeamResultItem = { category: TeamCategory; encounter: TeamEncounter; match: TeamMatch; label: string; lineupsLocked: boolean };
function teamResultItems(detail: TeamDetail): TeamResultItem[] {
  const items: TeamResultItem[] = [];
  detail.categories.forEach(category => {
    const labelByKey = new Map<string,string>(category.format?.encounter.rubbers.map(rubber => [rubber.key, rubber.label] as const) ?? []);
    category.encounters.forEach(encounter => {
      const lineupsLocked = encounter.lineups.filter(lineup => lineup.status === "locked").length >= 2;
      encounter.matches.forEach(match => items.push({ category, encounter, match, label: labelByKey.get(match.rubberKey) ?? match.rubberKey, lineupsLocked }));
    });
  });
  return items.sort((a,b)=>{
    const aTime=a.match.scheduleStart ?? Number.MAX_SAFE_INTEGER;
    const bTime=b.match.scheduleStart ?? Number.MAX_SAFE_INTEGER;
    return aTime-bTime || a.category.name.localeCompare(b.category.name) || a.encounter.id.localeCompare(b.encounter.id) || a.match.rubberOrder-b.match.rubberOrder;
  });
}

export function TeamResultsPanel({ tournamentId, locale }: Props) {
  const { detail, error, loading, reload } = useTeamSnapshot(tournamentId);
  const [busy,setBusy]=useState(false);
  const [mutationError,setMutationError]=useState("");
  if (loading) return <article className="panel"><p className="muted">{tr(locale,"Cargando resultados Team…","Loading Team results…")}</p></article>;
  if (error) return <div className="tpw-alert">{error}</div>;
  if (!detail?.categories.length) return null;
  const items=teamResultItems(detail);
  const active=items.filter(item=>item.match.status!=="finished"&&item.match.status!=="skipped"&&item.match.scheduleStatus!=="cancelled");
  const completed=items.filter(item=>item.match.status==="finished");
  const mutate=async(fn:()=>Promise<unknown>)=>{setBusy(true);setMutationError("");try{await fn();await reload();}catch(e){setMutationError(e instanceof Error?e.message:"TEAM_RESULT_FAILED");}finally{setBusy(false);}};
  const row=(item:TeamResultItem,next=false)=><article className={`team-global-result ${next?"is-next":""}`} key={item.match.id}><div className="team-global-result-context"><span className="pill">TEAM · {item.category.name}</span><strong>{item.encounter.sideA} — {item.encounter.sideB}</strong><small>{item.match.scheduleStart?`${new Date(item.match.scheduleStart*1000).toLocaleString("es-UY",{day:"2-digit",month:"2-digit",hour:"2-digit",minute:"2-digit"})} · ${item.match.courtLabel??"—"}`:tr(locale,"Sin horario","Unscheduled")} · {tr(locale,"Grupo","Group")} {item.encounter.groupName??"—"}</small></div><TeamRubberResultEditor match={item.match} rubberLabel={item.label} sideA={item.encounter.sideA} sideB={item.encounter.sideB} lineupsLocked={item.lineupsLocked} locale={locale} busy={busy} mutate={mutate}/></article>;
  return <section className="tpw-stack team-global-results"><article className="panel"><div className="panel-title"><div><div className="eyebrow">TEAM RESULTS</div><h2>{tr(locale,"Resultados Team por cronograma","Team results by schedule")}</h2><p>{tr(locale,"Los rubbers aparecen en el orden real del cronograma global y actualizan automáticamente la serie y los standings.","Rubbers follow the global schedule order and automatically update encounter score and standings.")}</p></div><span>{completed.length}/{items.filter(item=>item.match.status!=="skipped").length}</span></div>{mutationError&&<div className="tpw-alert">{mutationError}</div>}<div className="results-section"><h3>{tr(locale,"Pendientes","Pending")}</h3>{active.length?active.map((item,index)=>row(item,index===0)):<div className="empty-state">{tr(locale,"No quedan rubbers Team pendientes.","No pending Team rubbers.")}</div>}</div>{completed.length>0&&<details className="completed-results"><summary>{tr(locale,"Resultados Team cargados","Completed Team results")} · {completed.length}</summary>{completed.slice().sort((a,b)=>(b.match.scheduleStart??0)-(a.match.scheduleStart??0)).map(item=>row(item))}</details>}</article></section>;
}

export function TeamTVPanel({ tournamentId, categoryId, locale, tournamentName }: Props & { categoryId:string; tournamentName:string }) {
  const { detail, error, loading } = useTeamSnapshot(tournamentId, 5000);
  if (loading) return <section className="tv-shell"><div className="empty-state">{tr(locale,"Cargando TV Team…","Loading Team TV…")}</div></section>;
  if (error) return <section className="tv-shell"><div className="tpw-alert">{error}</div></section>;
  const category=detail?.categories.find(item=>item.id===categoryId);
  if(!category)return <section className="tv-shell"><div className="empty-state">{tr(locale,"Categoría Team no disponible.","Team category unavailable.")}</div></section>;
  const allMatches=category.encounters.flatMap(encounter=>encounter.matches.map(match=>({encounter,match})));
  const current=category.encounters.find(encounter=>encounter.matches.some(match=>match.status==="ready"||match.status==="in_progress"))
    ?? category.encounters.find(encounter=>encounter.status!=="finished")
    ?? category.encounters.slice().reverse().find(encounter=>encounter.status==="finished") ?? null;
  const labelByKey=new Map<string,string>(category.format?.encounter.rubbers.map(rubber=>[rubber.key,rubber.label] as const)??[]);
  const upcoming=allMatches.filter(item=>item.match.status!=="finished"&&item.match.status!=="skipped"&&item.match.scheduleStatus!=="cancelled").sort((a,b)=>(a.match.scheduleStart??Number.MAX_SAFE_INTEGER)-(b.match.scheduleStart??Number.MAX_SAFE_INTEGER)).slice(0,6);
  const recent=allMatches.filter(item=>item.match.status==="finished").sort((a,b)=>(b.match.scheduleStart??0)-(a.match.scheduleStart??0)).slice(0,5);
  const standing=category.standings.find(item=>item.groupId===current?.groupId)??category.standings[0];
  const currentScore=current?encounterDisplayScore(category,current):{a:0,b:0};
  const entryById=new Map(category.entries.map(entry=>[entry.id,entry] as const));
  const lineupNames=(entryId:string,rubberKey:string)=>{if(!current)return "";const lineup=current.lineups.find(item=>item.entryId===entryId);const entry=entryById.get(entryId);if(!lineup||!entry)return "";return lineup.assignments.filter(item=>item.rubberKey===rubberKey).sort((a,b)=>a.position-b.position).map(item=>entry.roster.find(member=>member.personId===item.personId)?.name).filter(Boolean).join(" + ");};
  return <section className="tv-shell team-tv-shell"><header><div><span>HUAU TEAM TOURNAMENT</span><h2>{tournamentName}</h2></div><strong>{new Date().toLocaleTimeString("es-UY",{hour:"2-digit",minute:"2-digit"})}</strong></header><div className="tv-category"><div><span>TEAM · {category.name}</span><h1>{current?`${current.sideA} ${currentScore.a} — ${currentScore.b} ${current.sideB}`:category.name}</h1></div><span className="pill strong">LIVE</span></div><div className="team-tv-grid"><div className="team-tv-main">{current?<><div className="team-tv-rubbers">{current.matches.slice().sort((a,b)=>a.rubberOrder-b.rubberOrder).map(match=><div className={`team-tv-rubber ${match.status}`} key={match.id}><span>{match.rubberOrder}</span><div><strong>{labelByKey.get(match.rubberKey)??match.rubberKey}</strong><small>{match.courtLabel??"—"}{match.scheduleStart?` · ${new Date(match.scheduleStart*1000).toLocaleTimeString("es-UY",{hour:"2-digit",minute:"2-digit"})}`:""}</small><small>{current?`${lineupNames(current.entryAId,match.rubberKey)||"—"} / ${lineupNames(current.entryBId,match.rubberKey)||"—"}`:""}</small></div><b>{match.status==="finished"?`${match.scoreA} — ${match.scoreB}`:match.status}</b></div>)}</div></>:<div className="empty-state">{tr(locale,"No hay series generadas.","No encounters generated.")}</div>}{standing?.rows?.length?<div className="team-tv-standing"><h3>{tr(locale,"Tabla","Standings")} · {tr(locale,"Grupo","Group")} {standing.groupName}</h3>{standing.rows.slice(0,6).map((row,index)=><div key={row.entryId}><span>{index+1}</span><strong>{row.entryName}</strong><b>{row.wins}-{row.losses}</b><small>{row.rubberDiff>0?`+${row.rubberDiff}`:row.rubberDiff}</small></div>)}</div>:null}</div><aside><h3>{tr(locale,"Próximos rubbers","Upcoming rubbers")}</h3>{upcoming.map(({encounter,match})=><div className="tv-match" key={match.id}><b>{match.scheduleStart?new Date(match.scheduleStart*1000).toLocaleTimeString("es-UY",{hour:"2-digit",minute:"2-digit"}):"—"} · {match.courtLabel??"—"}</b><span>{labelByKey.get(match.rubberKey)??match.rubberKey} · {encounter.sideA} — {encounter.sideB}</span></div>)}<h3>{tr(locale,"Últimos resultados","Latest results")}</h3>{recent.map(({encounter,match})=><div className="tv-match" key={match.id}><b>{match.scoreA} — {match.scoreB}</b><span>{labelByKey.get(match.rubberKey)??match.rubberKey} · {encounter.sideA} / {encounter.sideB}</span></div>)}</aside></div></section>;
}
