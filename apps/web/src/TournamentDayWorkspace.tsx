/* eslint-disable @typescript-eslint/no-explicit-any */
import { useCallback, useEffect, useRef, useState } from "react";
import type { ChangeEvent, FormEvent } from "react";
import type { Locale } from "./i18n";
import {
  addLocalPlayer,
  addLocalStandardEntry,
  advanceLocalLiveDraw,
  applyLocalTeamPreset,
  cloneDay,
  createLocalTeam,
  generateLocalStandardSchedule,
  generateLocalStandardStructure,
  generateLocalTeamSchedule,
  generateLocalTeamStructure,
  localDateTimeToUnix,
  saveLocalStandardFormat,
  saveLocalTeamLineup,
  startLocalLiveDraw,
  setLocalStandardResult,
  setLocalTeamFormat,
  setLocalTeamResult,
  teamFormatPreset,
  unixToLocalDateTime,
  updateLocalScheduleRow,
  updateLocalTeamRoster,
  type StandardResultInput,
  type TeamSetInput,
  type TournamentDaySnapshot,
} from "./TournamentDayEngine";
import {
  clearTournamentDaySession,
  loadTournamentDaySession,
  saveTournamentDaySession,
  tournamentDayChannelName,
  type TournamentDaySession,
} from "./TournamentDayStorage";
import type { TeamFormat, TeamLineupAssignment, TeamRosterMember } from "@huau/core";
import "./TournamentDay.css";

type Props = {
  locale: Locale;
  go: (path: string) => void;
  organizationId?: string;
  tournamentId?: string;
  operatorToken?: string;
};

type Tab =
  | "overview"
  | "participants"
  | "format"
  | "competition"
  | "team"
  | "schedule"
  | "results"
  | "tv"
  | "recovery";

class DayApiError extends Error {
  constructor(public code: string) {
    super(code);
  }
}

const tr = (locale: Locale, es: string, en: string) => (locale === "es" ? es : en);
const toMs = (value: number) => (value < 10_000_000_000 ? value * 1000 : value);
const date = (value: number) =>
  new Intl.DateTimeFormat("es-UY", { dateStyle: "medium" }).format(new Date(toMs(value)));
const dt = (value: number) =>
  new Intl.DateTimeFormat("es-UY", { dateStyle: "short", timeStyle: "short" }).format(
    new Date(toMs(value)),
  );

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: { "content-type": "application/json", ...init?.headers },
  });
  const payload = (await response.json()) as T & { code?: string };
  if (!response.ok) throw new DayApiError(payload.code ?? `HTTP_${response.status}`);
  return payload;
}

function storageKeyFor(props: Props) {
  return props.operatorToken
    ? `operator:${props.operatorToken}`
    : `admin:${props.tournamentId ?? ""}`;
}

function emptySets(bestOf: number) {
  return Array.from({ length: bestOf === 3 ? 3 : 1 }, () => ({ a: "", b: "" }));
}

function setsFromForm(form: FormData, prefix: string, bestOf: number): TeamSetInput[] {
  const rows = emptySets(bestOf);
  const result: TeamSetInput[] = [];
  rows.forEach((_, index) => {
    const a = String(form.get(`${prefix}:a:${index}`) ?? "").trim();
    const b = String(form.get(`${prefix}:b:${index}`) ?? "").trim();
    if (!a && !b) return;
    result.push({ scoreA: Number(a), scoreB: Number(b) });
  });
  return result;
}

function standardResultFromForm(
  form: FormData,
  prefix: string,
  bestOf: number,
): StandardResultInput {
  if (bestOf === 3) {
    return { sets: setsFromForm(form, prefix, 3) };
  }
  return {
    scoreA: Number(form.get(`${prefix}:a:0`) ?? 0),
    scoreB: Number(form.get(`${prefix}:b:0`) ?? 0),
  };
}

export function TournamentDayWorkspace(props: Props) {
  const { locale, go, organizationId, tournamentId, operatorToken } = props;
  const [session, setSession] = useState<TournamentDaySession<TournamentDaySnapshot> | null>(null);
  const [tab, setTab] = useState<Tab>(() =>
    new URLSearchParams(window.location.search).get("view") === "tv" ? "tv" : "overview",
  );
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const channelRef = useRef<BroadcastChannel | null>(null);
  const sessionRef = useRef<TournamentDaySession<TournamentDaySnapshot> | null>(null);
  const persistenceQueueRef = useRef<Promise<void>>(Promise.resolve());
  const storageKey = storageKeyFor(props);
  const tvOnly = new URLSearchParams(window.location.search).get("view") === "tv";

  const install = useCallback(
    async (
      next: TournamentDaySession<TournamentDaySnapshot>,
      options: { persist?: boolean; broadcast?: boolean } = {},
    ) => {
      sessionRef.current = next;
      setSession(next);
      if (options.persist !== false) {
        const write = persistenceQueueRef.current.then(() => saveTournamentDaySession(next));
        persistenceQueueRef.current = write.catch(() => undefined);
        await write;
      }
      if (options.broadcast !== false) {
        channelRef.current?.postMessage({
          type: "snapshot",
          storageKey,
          session: next,
        });
      }
    },
    [storageKey],
  );

  const fetchSourceSnapshot = useCallback(async (forceD1 = false): Promise<{
    snapshot: TournamentDaySnapshot;
    publishedRevision: number;
    finalizedAt: number | null;
    syncStatus: "idle" | "syncing" | "synced" | "failed";
    syncError: string | null;
  }> => {
    if (operatorToken) {
      return api<{
        ok: true;
        snapshot: TournamentDaySnapshot;
        publishedRevision: number;
        finalizedAt: number | null;
        syncStatus: "idle" | "syncing" | "synced" | "failed";
        syncError: string | null;
      }>(`/api/operate/${encodeURIComponent(operatorToken)}/bootstrap`);
    }
    if (!tournamentId) throw new Error("TOURNAMENT_ID_REQUIRED");
    return api<{
      ok: true;
      snapshot: TournamentDaySnapshot;
      publishedRevision: number;
      finalizedAt: number | null;
      syncStatus: "idle" | "syncing" | "synced" | "failed";
      syncError: string | null;
    }>(`/api/admin/tournaments/${encodeURIComponent(tournamentId)}/day-bootstrap${forceD1 ? "?source=d1" : ""}`);
  }, [operatorToken, tournamentId]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    void loadTournamentDaySession<TournamentDaySnapshot>(storageKey)
      .then(async (local) => {
        if (!active) return;
        if (local) {
          await install(local, { broadcast: false });
          setNotice(
            tr(
              locale,
              "Sesión local recuperada. No se consultó D1 para abrir Tournament Day.",
              "Local session recovered. D1 was not queried to open Tournament Day.",
            ),
          );
          return;
        }
        const source = await fetchSourceSnapshot();
        if (!active) return;
        const snapshot = source.snapshot;
        const next: TournamentDaySession<TournamentDaySnapshot> = {
          schemaVersion: 1,
          storageKey,
          tournamentId: snapshot.tournamentId,
          source: operatorToken ? "operator" : "admin",
          dirty: false,
          updatedAt: Date.now(),
          publishedRevision: source.publishedRevision,
          finalizedAt: source.finalizedAt,
          syncStatus: source.syncStatus,
          syncError: source.syncError,
          snapshot,
        };
        await install(next, { broadcast: false });
        setNotice(
          operatorToken
            ? tr(
                locale,
                "Checkpoint descargado. Desde ahora la jornada funciona localmente en este navegador.",
                "Checkpoint downloaded. From now on the event runs locally in this browser.",
              )
            : tr(
                locale,
                "Datos del torneo cargados una vez. Desde ahora Tournament Day funciona localmente.",
                "Tournament data loaded once. From now on Tournament Day runs locally.",
              ),
        );
      })
      .catch((loadError) => {
        if (!active) return;
        setError(loadError instanceof Error ? loadError.message : "TOURNAMENT_DAY_LOAD_FAILED");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [fetchSourceSnapshot, install, locale, operatorToken, storageKey]);

  useEffect(() => {
    const id = session?.tournamentId;
    if (!id || typeof BroadcastChannel === "undefined") return;
    const channel = new BroadcastChannel(tournamentDayChannelName(id));
    channelRef.current = channel;
    channel.onmessage = (event) => {
      const data = event.data as {
        type?: string;
        storageKey?: string;
        session?: TournamentDaySession<TournamentDaySnapshot>;
      };
      if (
        data.type !== "snapshot" ||
        data.storageKey !== storageKey ||
        !data.session ||
        data.session.updatedAt <= (sessionRef.current?.updatedAt ?? 0)
      ) return;
      sessionRef.current = data.session;
      setSession(data.session);
      const write = persistenceQueueRef.current.then(() => saveTournamentDaySession(data.session!));
      persistenceQueueRef.current = write.catch(() => undefined);
    };
    return () => {
      channel.close();
      if (channelRef.current === channel) channelRef.current = null;
    };
  }, [session?.tournamentId, storageKey]);

  const mutate = useCallback(
    async (fn: (snapshot: TournamentDaySnapshot) => void, message?: string) => {
      const current = sessionRef.current;
      if (!current) return;
      setError("");
      try {
        const snapshot = cloneDay(current.snapshot);
        fn(snapshot);
        const next: TournamentDaySession<TournamentDaySnapshot> = {
          ...current,
          dirty: true,
          updatedAt: Date.now(),
          finalizedAt: null,
          syncStatus: "idle",
          syncError: null,
          snapshot,
        };
        await install(next);
        if (message) setNotice(message);
      } catch (mutationError) {
        setError(mutationError instanceof Error ? mutationError.message : "LOCAL_MUTATION_FAILED");
      }
    },
    [install],
  );

  const publish = async (finalized = false) => {
    const current = sessionRef.current;
    if (!current) return;
    if (
      finalized &&
      !window.confirm(
        tr(
          locale,
          "¿Publicar este checkpoint como cierre de jornada? La copia local seguirá disponible.",
          "Publish this checkpoint as the event close? The local copy will remain available.",
        ),
      )
    ) return;
    setBusy(finalized ? "finalize" : "publish");
    setError("");
    setNotice("");
    try {
      const endpoint = operatorToken
        ? `/api/operate/${encodeURIComponent(operatorToken)}/publish`
        : `/api/admin/tournaments/${encodeURIComponent(current.tournamentId)}/day-publish`;
      const result = await api<{
        ok: true;
        revision: number;
        publishedAt: number;
        finalizedAt: number | null;
        syncStatus: "idle" | "syncing" | "synced" | "failed";
        syncError: string | null;
      }>(endpoint, {
        method: operatorToken ? "PUT" : "PUT",
        body: JSON.stringify({
          snapshot: current.snapshot,
          finalized,
          basePublishedRevision: current.publishedRevision,
        }),
      });
      const next: TournamentDaySession<TournamentDaySnapshot> = {
        ...current,
        dirty: false,
        updatedAt: Date.now(),
        publishedRevision: result.revision,
        finalizedAt: result.finalizedAt,
        syncStatus: result.syncStatus,
        syncError: result.syncError,
      };
      await install(next);
      setNotice(
        finalized
          ? result.syncStatus === "synced"
            ? tr(
                locale,
                "Jornada finalizada, publicada y sincronizada con D1.",
                "Event finalized, published and synced to D1.",
              )
            : tr(
                locale,
                `El checkpoint final quedó seguro en R2, pero la sincronización normalizada falló: ${result.syncError ?? "TOURNAMENT_DAY_SYNC_FAILED"}. Corregí si hace falta y volvé a cerrar/publicar.`,
                `The final checkpoint is safe in R2, but normalized sync failed: ${result.syncError ?? "TOURNAMENT_DAY_SYNC_FAILED"}. Fix if needed and close/publish again.`,
              )
          : tr(
              locale,
              `Checkpoint publicado · revisión ${result.revision}.`,
              `Checkpoint published · revision ${result.revision}.`,
            ),
      );
    } catch (publishError) {
      setError(publishError instanceof Error ? publishError.message : "TOURNAMENT_DAY_PUBLISH_FAILED");
    } finally {
      setBusy("");
    }
  };

  const reloadSource = async (sourceKind: "published" | "d1" = "published") => {
    const fromD1 = sourceKind === "d1" && !operatorToken;
    const sourceLabel = fromD1
      ? tr(locale, "D1", "D1")
      : tr(locale, "la última revisión publicada", "the latest published revision");

    if (
      sessionRef.current?.dirty &&
      !window.confirm(
        tr(
          locale,
          `Hay cambios locales sin publicar. ¿Descartarlos y cargar ${sourceLabel}?`,
          `There are unpublished local changes. Discard them and load ${sourceLabel}?`,
        ),
      )
    ) return;

    setBusy(fromD1 ? "reload-d1" : "reload-published");
    setError("");
    try {
      const source = await fetchSourceSnapshot(fromD1);
      const snapshot = source.snapshot;
      const next: TournamentDaySession<TournamentDaySnapshot> = {
        schemaVersion: 1,
        storageKey,
        tournamentId: snapshot.tournamentId,
        source: operatorToken ? "operator" : "admin",
        dirty: false,
        updatedAt: Date.now(),
        publishedRevision: source.publishedRevision,
        finalizedAt: source.finalizedAt,
        syncStatus: source.syncStatus,
        syncError: source.syncError,
        snapshot,
      };
      await install(next);
      setNotice(
        fromD1
          ? tr(locale, "Copia restaurada desde D1.", "Copy restored from D1.")
          : tr(
              locale,
              `Última revisión publicada descargada · revisión ${source.publishedRevision}.`,
              `Latest published revision downloaded · revision ${source.publishedRevision}.`,
            ),
      );
    } catch (reloadError) {
      setError(reloadError instanceof Error ? reloadError.message : "TOURNAMENT_DAY_RELOAD_FAILED");
    } finally {
      setBusy("");
    }
  };

  const exportLocal = () => {
    const current = sessionRef.current;
    if (!current) return;
    const blob = new Blob([JSON.stringify(current, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `huau-tournament-day-${current.tournamentId}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const importLocal = async (file: File) => {
    try {
      const parsed = JSON.parse(await file.text()) as TournamentDaySession<TournamentDaySnapshot>;
      const current = sessionRef.current;
      if (
        !current ||
        parsed.schemaVersion !== 1 ||
        parsed.snapshot?.tournamentId !== current.tournamentId
      ) throw new Error("TOURNAMENT_DAY_BACKUP_INVALID");
      await install({
        ...parsed,
        storageKey,
        source: current.source,
        dirty: true,
        updatedAt: Date.now(),
        syncStatus: parsed.syncStatus ?? "idle",
        syncError: parsed.syncError ?? null,
      });
      setNotice(tr(locale, "Backup local importado.", "Local backup imported."));
      setError("");
    } catch (importError) {
      setError(importError instanceof Error ? importError.message : "TOURNAMENT_DAY_IMPORT_FAILED");
    }
  };

  const resetLocal = async () => {
    if (
      !window.confirm(
        tr(
          locale,
          "¿Borrar la sesión local de este navegador? Después tendrás que volver a descargar el torneo.",
          "Delete this browser's local session? You will need to download the tournament again.",
        ),
      )
    ) return;
    await clearTournamentDaySession(storageKey);
    sessionRef.current = null;
    setSession(null);
    setNotice("");
    setError("");
    setLoading(true);
    window.location.reload();
  };

  if (loading) {
    return <main className="td-day"><div className="td-loading">{tr(locale, "Preparando Tournament Day…", "Preparing Tournament Day…")}</div></main>;
  }
  if (!session) {
    return <main className="td-day"><div className="td-loading">{error || "TOURNAMENT_DAY_UNAVAILABLE"}</div></main>;
  }

  const snapshot = session.snapshot;
  const tournament = snapshot.workspace.core.tournament;
  const teamCategories = snapshot.team.categories as any[];
  const standardMatches = snapshot.workspace.standard.matches as any[];
  const teamMatches = teamCategories.flatMap((category) =>
    category.encounters.flatMap((encounter: any) =>
      encounter.matches.map((match: any) => ({
        ...match,
        categoryId: category.id,
        categoryName: category.name,
        encounter,
      })),
    ),
  );
  const completed =
    standardMatches.filter((match) => match.status === "finished").length +
    teamMatches.filter((match: any) => match.status === "finished").length;
  const pending =
    standardMatches.filter((match) => !["finished", "bye", "skipped"].includes(match.status)).length +
    teamMatches.filter((match: any) => !["finished", "skipped"].includes(match.status)).length;

  if (tvOnly) {
    return <TournamentDayTV snapshot={snapshot} locale={locale} />;
  }

  const tabs: Array<[Tab, string]> = [
    ["overview", tr(locale, "Resumen", "Overview")],
    ["participants", tr(locale, "Participantes", "Participants")],
    ["format", tr(locale, "Formato", "Format")],
    ["team", tr(locale, "Equipos", "Teams")],
    ["competition", tr(locale, "Competencia", "Competition")],
    ["schedule", tr(locale, "Cronograma", "Schedule")],
    ["results", tr(locale, "Resultados", "Results")],
    ["tv", "TV"],
    ["recovery", tr(locale, "Recuperación", "Recovery")],
  ];

  const back = () => {
    if (operatorToken) go("/");
    else if (organizationId && tournamentId)
      go(`/admin/organizations/${organizationId}/tournaments/${tournamentId}`);
  };

  return (
    <main className="td-day">
      <button className="section-back" onClick={back}>
        ← {operatorToken ? "HUAU" : "Tournament Hub"}
      </button>

      <header className="td-day-hero">
        <div>
          <div className="eyebrow">TOURNAMENT DAY · LOCAL FIRST</div>
          <h1>{tournament.name}</h1>
          <p>
            {date(tournament.startAt)} · {tournament.courtCount} {tr(locale, "canchas", "courts")}
          </p>
        </div>
        <div className="td-day-actions">
          <span className={`td-local-chip ${session.dirty ? "dirty" : ""}`}>
            <span className="td-dot on" />
            {session.dirty
              ? tr(locale, "LOCAL · cambios sin publicar", "LOCAL · unpublished changes")
              : "LOCAL · 0 D1"}
          </span>
          <button
            className="ghost small"
            onClick={() => {
              const url = new URL(window.location.href);
              url.searchParams.set("view", "tv");
              window.open(url.toString(), "_blank", "noopener");
            }}
          >
            {tr(locale, "Abrir TV", "Open TV")} ↗
          </button>
          <button className="light small" disabled={Boolean(busy)} onClick={() => void publish(false)}>
            {busy === "publish" ? "…" : tr(locale, "Publicar checkpoint", "Publish checkpoint")}
          </button>
        </div>
      </header>

      <section className="td-day-status">
        <div>
          <strong>{completed}</strong>
          <span>{tr(locale, "partidos terminados", "matches completed")}</span>
        </div>
        <div>
          <strong>{pending}</strong>
          <span>{tr(locale, "pendientes", "pending")}</span>
        </div>
        <div>
          <strong>{snapshot.workspace.participants.players.length}</strong>
          <span>{tr(locale, "jugadores locales", "local players")}</span>
        </div>
        <div>
          <strong>{session.publishedRevision}</strong>
          <span>{tr(locale, "revisión publicada", "published revision")}</span>
        </div>
      </section>

      <nav className="td-day-tabs">
        {tabs.map(([key, label]) => (
          <button key={key} className={tab === key ? "active" : ""} onClick={() => setTab(key)}>
            {label}
          </button>
        ))}
      </nav>

      {error ? <div className="tpw-alert">{error}</div> : null}
      {notice ? <div className="notice-box">{notice}</div> : null}

      {tab === "overview" ? (
        <DayOverview
          locale={locale}
          snapshot={snapshot}
          setTab={setTab}
          completed={completed}
          pending={pending}
        />
      ) : null}

      {tab === "participants" ? (
        <DayParticipants locale={locale} snapshot={snapshot} mutate={mutate} />
      ) : null}

      {tab === "format" ? (
        <DayFormat locale={locale} snapshot={snapshot} mutate={mutate} />
      ) : null}

      {tab === "competition" ? (
        <DayStandardCompetition locale={locale} snapshot={snapshot} mutate={mutate} />
      ) : null}

      {tab === "team" ? (
        <DayTeam locale={locale} snapshot={snapshot} mutate={mutate} />
      ) : null}

      {tab === "schedule" ? (
        <DaySchedule locale={locale} snapshot={snapshot} mutate={mutate} />
      ) : null}

      {tab === "results" ? (
        <DayResults locale={locale} snapshot={snapshot} mutate={mutate} />
      ) : null}

      {tab === "tv" ? <TournamentDayTV snapshot={snapshot} locale={locale} embedded /> : null}

      {tab === "recovery" ? (
        <DayRecovery
          locale={locale}
          session={session}
          busy={busy}
          publish={publish}
          reloadSource={reloadSource}
          exportLocal={exportLocal}
          importLocal={importLocal}
          resetLocal={resetLocal}
        />
      ) : null}
    </main>
  );
}

function DayOverview({
  locale,
  snapshot,
  setTab,
  completed,
  pending,
}: {
  locale: Locale;
  snapshot: TournamentDaySnapshot;
  setTab: (tab: Tab) => void;
  completed: number;
  pending: number;
}) {
  const categories = snapshot.workspace.core.categories as any[];
  const schedule = snapshot.workspace.schedule.schedule as any[];
  const upcoming = [...schedule]
    .filter((row) => row.status !== "completed" && row.status !== "cancelled")
    .sort((a, b) => Number(a.startAt) - Number(b.startAt))
    .slice(0, 5);
  return (
    <section className="td-grid">
      <article className="panel wide">
        <div className="eyebrow">{tr(locale, "ESTADO LOCAL", "LOCAL STATE")}</div>
        <h2>{tr(locale, "Centro de operación", "Operations center")}</h2>
        <div className="td-kpis">
          <div><strong>{categories.length}</strong><span>{tr(locale, "categorías", "categories")}</span></div>
          <div><strong>{completed}</strong><span>{tr(locale, "terminados", "completed")}</span></div>
          <div><strong>{pending}</strong><span>{tr(locale, "pendientes", "pending")}</span></div>
          <div><strong>{schedule.length}</strong><span>{tr(locale, "bloques", "schedule rows")}</span></div>
        </div>
        <p className="muted">
          {tr(
            locale,
            "Todo lo que hagas en estas pestañas se guarda en IndexedDB. No se publica nada hasta que uses Publicar checkpoint.",
            "Everything you do in these tabs is saved in IndexedDB. Nothing is published until you use Publish checkpoint.",
          )}
        </p>
      </article>

      <article className="panel">
        <h2>{tr(locale, "Accesos rápidos", "Quick actions")}</h2>
        <div className="td-quick">
          <button onClick={() => setTab("participants")}>{tr(locale, "Participantes", "Participants")} →</button>
          <button onClick={() => setTab("format")}>{tr(locale, "Formato", "Format")} →</button>
          <button onClick={() => setTab("team")}>{tr(locale, "Equipos", "Teams")} →</button>
          <button onClick={() => setTab("competition")}>{tr(locale, "Competencia", "Competition")} →</button>
          <button onClick={() => setTab("results")}>{tr(locale, "Resultados", "Results")} →</button>
          <button onClick={() => setTab("tv")}>TV →</button>
        </div>
      </article>

      <article className="panel wide">
        <div className="panel-title">
          <h2>{tr(locale, "Próximos en cronograma", "Next on schedule")}</h2>
          <span>{upcoming.length}</span>
        </div>
        {upcoming.length ? (
          <div className="td-upcoming-list">
            {upcoming.map((row) => (
              <div key={row.id}>
                <span>{row.startAt ? dt(row.startAt) : "—"} · {row.courtLabel}</span>
                <strong>{row.sideA || row.roundLabel || row.categoryName} {row.sideB ? `vs ${row.sideB}` : ""}</strong>
                <small>{row.categoryName}{row.rubberKey ? ` · ${row.rubberKey}` : ""}</small>
              </div>
            ))}
          </div>
        ) : (
          <p className="muted">{tr(locale, "Todavía no hay cronograma local.", "No local schedule yet.")}</p>
        )}
      </article>
    </section>
  );
}

function DayParticipants({
  locale,
  snapshot,
  mutate,
}: {
  locale: Locale;
  snapshot: TournamentDaySnapshot;
  mutate: (fn: (snapshot: TournamentDaySnapshot) => void, message?: string) => Promise<void>;
}) {
  const players = snapshot.workspace.participants.players as any[];
  const categories = snapshot.workspace.core.categories as any[];
  const add = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    await mutate(
      (next) => {
        addLocalPlayer(next, {
          name: String(data.get("name") ?? "").trim(),
          sportGender: String(data.get("sportGender") ?? "unspecified") as "male" | "female" | "unspecified",
          club: String(data.get("club") ?? "").trim(),
          contact: String(data.get("contact") ?? "").trim(),
          duprSingles: Number(data.get("duprSingles") ?? 0),
          duprDoubles: Number(data.get("duprDoubles") ?? 0),
          categoryId: String(data.get("categoryId") ?? "") || null,
        });
      },
      tr(locale, "Jugador agregado sólo a la jornada local.", "Player added to the local event only."),
    );
    form.reset();
  };

  return (
    <section className="td-stack">
      <article className="panel">
        <div className="panel-title">
          <div>
            <div className="eyebrow">WALK-IN</div>
            <h2>{tr(locale, "Agregar jugador el día del torneo", "Add a tournament-day player")}</h2>
          </div>
        </div>
        <form className="td-inline-form" onSubmit={add}>
          <label><span>{tr(locale, "Nombre", "Name")}</span><input name="name" required /></label>
          <label><span>{tr(locale, "Género deportivo", "Sport gender")}</span><select name="sportGender" defaultValue="unspecified"><option value="unspecified">—</option><option value="male">{tr(locale, "Masculino", "Male")}</option><option value="female">{tr(locale, "Femenino", "Female")}</option></select></label>
          <label><span>{tr(locale, "Club", "Club")}</span><input name="club" /></label>
          <label><span>{tr(locale, "Contacto", "Contact")}</span><input name="contact" /></label>
          <label><span>DUPR S</span><input name="duprSingles" type="number" step="0.001" min="0" max="8" /></label>
          <label><span>DUPR D</span><input name="duprDoubles" type="number" step="0.001" min="0" max="8" /></label>
          <label><span>{tr(locale, "Categoría individual (opcional)", "Individual category (optional)")}</span><select name="categoryId" defaultValue=""><option value="">—</option>{categories.filter((category) => category.entryType === "individual").map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label>
          <button className="light">{tr(locale, "Agregar local", "Add locally")}</button>
        </form>
      </article>

      <article className="panel wide">
        <div className="panel-title"><h2>{tr(locale, "Roster operativo", "Operational roster")}</h2><span>{players.length}</span></div>
        <div className="td-player-table table-wrap">
          <table>
            <thead><tr><th>{tr(locale, "Jugador", "Player")}</th><th>{tr(locale, "Género", "Gender")}</th><th>Singles</th><th>Doubles</th><th>{tr(locale, "Estado", "Status")}</th></tr></thead>
            <tbody>
              {players.map((player) => (
                <tr key={player.id}>
                  <td><strong>{player.displayName}</strong><small>{player.club || "—"}</small></td>
                  <td>{player.sportGender === "male" ? "M" : player.sportGender === "female" ? "F" : "—"}</td>
                  <td>{player.duprSingles || "—"}</td>
                  <td>{player.duprDoubles || "—"}</td>
                  <td><span className="pill">{player.playerStatus}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </article>
    </section>
  );
}

function DayFormat({
  locale,
  snapshot,
  mutate,
}: {
  locale: Locale;
  snapshot: TournamentDaySnapshot;
  mutate: (fn: (snapshot: TournamentDaySnapshot) => void, message?: string) => Promise<void>;
}) {
  const settings = snapshot.workspace.core.settings as any;
  const tournament = snapshot.workspace.core.tournament as any;
  const standardCategories = (snapshot.workspace.core.categories as any[]).filter(
    (category) => category.entryType !== "team",
  );
  const teamCategories = snapshot.team.categories as any[];
  const [standardCategoryId, setStandardCategoryId] = useState(standardCategories[0]?.id ?? "");
  const [teamCategoryId, setTeamCategoryId] = useState(teamCategories[0]?.id ?? "");

  const standardCategory =
    standardCategories.find((category) => category.id === standardCategoryId) ?? standardCategories[0];
  const standardCompetition = (snapshot.workspace.standard.competitions as any[]).find(
    (competition) => competition.categoryId === standardCategory?.id,
  );
  const standardFormat = standardCompetition?.format ?? (() => {
    try {
      return standardCategory?.configJson ? JSON.parse(standardCategory.configJson) as any : null;
    } catch {
      return null;
    }
  })();

  const teamCategory =
    teamCategories.find((category) => category.id === teamCategoryId) ?? teamCategories[0];
  const teamFormat = (teamCategory?.format ?? null) as TeamFormat | null;

  useEffect(() => {
    if (!standardCategoryId && standardCategories[0]?.id) setStandardCategoryId(standardCategories[0].id);
    if (standardCategoryId && !standardCategories.some((category) => category.id === standardCategoryId)) {
      setStandardCategoryId(standardCategories[0]?.id ?? "");
    }
  }, [standardCategories, standardCategoryId]);

  useEffect(() => {
    if (!teamCategoryId && teamCategories[0]?.id) setTeamCategoryId(teamCategories[0].id);
    if (teamCategoryId && !teamCategories.some((category) => category.id === teamCategoryId)) {
      setTeamCategoryId(teamCategories[0]?.id ?? "");
    }
  }, [teamCategories, teamCategoryId]);

  const saveOperational = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    await mutate((next) => {
      const nextSettings = next.workspace.core.settings as any;
      const nextTournament = next.workspace.core.tournament as any;
      nextSettings.dailyStart = String(data.get("dailyStart") ?? "09:00");
      nextSettings.dailyEnd = String(data.get("dailyEnd") ?? "20:00");
      nextSettings.defaultMatchMinutes = Math.max(5, Number(data.get("defaultMatchMinutes") ?? 30));
      nextSettings.minimumGroup = Math.max(2, Number(data.get("minimumGroup") ?? 3));
      nextSettings.preferredGroup = Math.max(nextSettings.minimumGroup, Number(data.get("preferredGroup") ?? 4));
      nextSettings.maximumGroup = Math.max(nextSettings.preferredGroup, Number(data.get("maximumGroup") ?? 4));
      nextSettings.suggestedQualifiersPerGroup = Math.max(0, Math.min(2, Number(data.get("suggestedQualifiersPerGroup") ?? 2)));
      nextSettings.seedingMethod = String(data.get("seedingMethod") ?? "snake");
      nextSettings.minimumRestSlots = Math.max(0, Math.min(4, Number(data.get("minimumRestSlots") ?? 1)));
      nextTournament.courtCount = Math.max(1, Number(data.get("courtCount") ?? 1));
      next.workspace.schedule.schedule = [];
    }, tr(locale, "Parámetros operativos guardados localmente.", "Operational parameters saved locally."));
  };

  const saveStandard = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!standardCategory) return;
    const data = new FormData(event.currentTarget);
    await mutate((next) => {
      saveLocalStandardFormat(next, standardCategory.id, {
        groupRounds: Number(data.get("groupRounds")) === 2 ? 2 : 1,
        qualifiersPerGroup: Math.max(1, Number(data.get("qualifiersPerGroup") ?? 2)),
        wildcardQualifiers: Math.max(0, Number(data.get("wildcardQualifiers") ?? 0)),
        playoffMode: String(data.get("playoffMode") ?? "standard") as any,
        crossGroupMethod: String(data.get("crossGroupMethod") ?? "normalized") as any,
        consolationMode: String(data.get("consolationMode") ?? "none") as any,
        avoidGroupRematches: data.get("avoidGroupRematches") === "on",
        bronzeMatch: data.get("bronzeMatch") === "on",
        medalSchedule: String(data.get("medalSchedule") ?? "sequential") as any,
        finalDrawMethod: String(data.get("finalDrawMethod") ?? "performance") as any,
        preferredRestSlots: Math.max(0, Number(data.get("preferredRestSlots") ?? 1)),
        preliminary: {
          bestOf: Number(data.get("preBestOf")) === 3 ? 3 : 1,
          pointTarget: Math.max(1, Number(data.get("preTarget") ?? 15)),
        },
        medal: {
          bestOf: Number(data.get("medalBestOf")) === 3 ? 3 : 1,
          pointTarget: Math.max(1, Number(data.get("medalTarget") ?? 11)),
        },
      });
    }, tr(locale, "Formato Standard guardado localmente.", "Standard format saved locally."));
  };

  const saveTeam = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!teamCategory) return;
    const data = new FormData(event.currentTarget);
    await mutate((next) => {
      const currentCategory = (next.team.categories as any[]).find((category) => category.id === teamCategory.id);
      const base = cloneDay((currentCategory?.format ?? teamFormatPreset("generic")) as TeamFormat);
      base.roster.min = Math.max(1, Number(data.get("rosterMin") ?? base.roster.min));
      base.roster.max = Math.max(base.roster.min, Number(data.get("rosterMax") ?? base.roster.max));
      base.roster.composition = String(data.get("composition") ?? base.roster.composition) as TeamFormat["roster"]["composition"];
      base.roster.rules.maleMin = Math.max(0, Number(data.get("maleMin") ?? base.roster.rules.maleMin));
      base.roster.rules.femaleMin = Math.max(0, Number(data.get("femaleMin") ?? base.roster.rules.femaleMin));
      base.roster.rules.maleMax = String(data.get("maleMax") ?? "").trim() ? Math.max(0, Number(data.get("maleMax"))) : null;
      base.roster.rules.femaleMax = String(data.get("femaleMax") ?? "").trim() ? Math.max(0, Number(data.get("femaleMax"))) : null;
      base.roster.substitutesAllowed = data.get("substitutesAllowed") === "on";
      base.roster.captainRequired = data.get("captainRequired") === "on";

      base.encounter.winnerRule = String(data.get("winnerRule") ?? base.encounter.winnerRule) as TeamFormat["encounter"]["winnerRule"];
      base.encounter.targetWins = String(data.get("targetWins") ?? "").trim()
        ? Math.max(1, Number(data.get("targetWins")))
        : null;
      base.encounter.playRemainingAfterClinched = data.get("playRemainingAfterClinched") === "on";

      base.competition.groupRounds = Number(data.get("teamGroupRounds")) === 2 ? 2 : 1;
      base.competition.playoffMode = String(data.get("teamPlayoffMode") ?? "standard") as any;
      base.competition.qualifiersPerGroup = Math.max(1, Number(data.get("teamQualifiersPerGroup") ?? 2));
      base.competition.wildcardQualifiers = Math.max(0, Number(data.get("teamWildcardQualifiers") ?? 0));
      base.competition.bronzeMatch = data.get("teamBronzeMatch") === "on";

      const criteria = ["standing_points","encounter_wins","head_to_head","rubber_diff","point_diff","points_for"]
        .filter((criterion) => data.get(`criterion:${criterion}`) === "on");
      base.standings.criteria = (criteria.length ? criteria : ["standing_points","head_to_head","rubber_diff","point_diff"]) as TeamFormat["standings"]["criteria"];

      base.encounter.rubbers = base.encounter.rubbers.map((rubber, index) => ({
        ...rubber,
        label: String(data.get(`rubber:${rubber.key}:label`) ?? rubber.label).trim() || rubber.label,
        order: index + 1,
        mode: String(data.get(`rubber:${rubber.key}:mode`) ?? rubber.mode) as any,
        gender: String(data.get(`rubber:${rubber.key}:gender`) ?? rubber.gender) as any,
        play: String(data.get(`rubber:${rubber.key}:play`) ?? rubber.play) as any,
        isTiebreaker: data.get(`rubber:${rubber.key}:tiebreaker`) === "on",
        weight: Math.max(0, Number(data.get(`rubber:${rubber.key}:weight`) ?? rubber.weight)),
        bestOf: Number(data.get(`rubber:${rubber.key}:bestOf`)) === 3 ? 3 : 1,
        pointTarget: Math.max(1, Number(data.get(`rubber:${rubber.key}:target`) ?? rubber.pointTarget)),
        scoringMode: String(data.get(`rubber:${rubber.key}:scoringMode`) ?? "").trim() || null,
      }));
      setLocalTeamFormat(next, teamCategory.id, base);
    }, tr(locale, "Formato Team guardado localmente.", "Team format saved locally."));
  };

  const applyPreset = (preset: "senior_cup_2026" | "generic") => {
    if (!teamCategory) return;
    void mutate(
      (next) => applyLocalTeamPreset(next, teamCategory.id, preset),
      preset === "senior_cup_2026"
        ? tr(locale, "Preset Senior Cup 2026 aplicado localmente.", "Senior Cup 2026 preset applied locally.")
        : tr(locale, "Preset Team configurable aplicado localmente.", "Configurable Team preset applied locally."),
    );
  };

  const addRubber = () => {
    if (!teamCategory) return;
    void mutate((next) => {
      const currentCategory = (next.team.categories as any[]).find((category) => category.id === teamCategory.id);
      const base = cloneDay((currentCategory?.format ?? teamFormatPreset("generic")) as TeamFormat);
      const order = base.encounter.rubbers.length + 1;
      base.encounter.rubbers.push({
        key: `r${Date.now()}`,
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
      });
      setLocalTeamFormat(next, teamCategory.id, base);
    }, tr(locale, "Rubber agregado localmente.", "Rubber added locally."));
  };

  const mutateRubber = (key: string, action: "up" | "down" | "remove") => {
    if (!teamCategory) return;
    void mutate((next) => {
      const currentCategory = (next.team.categories as any[]).find((category) => category.id === teamCategory.id);
      const base = cloneDay((currentCategory?.format ?? teamFormatPreset("generic")) as TeamFormat);
      const index = base.encounter.rubbers.findIndex((rubber) => rubber.key === key);
      if (index < 0) return;
      if (action === "remove") {
        if (base.encounter.rubbers.length <= 1) throw new Error("TEAM_RUBBER_REQUIRED");
        base.encounter.rubbers.splice(index, 1);
      } else {
        const target = action === "up" ? index - 1 : index + 1;
        if (target < 0 || target >= base.encounter.rubbers.length) return;
        [base.encounter.rubbers[index], base.encounter.rubbers[target]] =
          [base.encounter.rubbers[target]!, base.encounter.rubbers[index]!];
      }
      base.encounter.rubbers = base.encounter.rubbers.map((rubber, rubberIndex) => ({
        ...rubber,
        order: rubberIndex + 1,
      }));
      setLocalTeamFormat(next, teamCategory.id, base);
    }, tr(locale, "Rubbers actualizados localmente.", "Rubbers updated locally."));
  };

  return (
    <section className="td-stack">
      <article className="panel">
        <div className="panel-title">
          <div>
            <div className="eyebrow">TOURNAMENT DAY · LOCAL</div>
            <h2>{tr(locale, "Parámetros operativos", "Operational parameters")}</h2>
            <p className="muted">{tr(
              locale,
              "Estos valores determinan cómo se ejecuta la jornada y no cambian la inscripción pública. Al modificarlos se invalida el cronograma local para regenerarlo.",
              "These values control event operation and do not change public registration. Changing them clears the local schedule so it can be regenerated."
            )}</p>
          </div>
        </div>
        <form className="td-format-grid" onSubmit={saveOperational}>
          <label><span>{tr(locale,"Inicio jornada","Day start")}</span><input name="dailyStart" type="time" defaultValue={settings.dailyStart ?? "09:00"} /></label>
          <label><span>{tr(locale,"Fin objetivo","Target end")}</span><input name="dailyEnd" type="time" defaultValue={settings.dailyEnd ?? "20:00"} /></label>
          <label><span>{tr(locale,"Canchas","Courts")}</span><input name="courtCount" type="number" min="1" defaultValue={tournament.courtCount ?? 1} /></label>
          <label><span>{tr(locale,"Min/partido","Min/match")}</span><input name="defaultMatchMinutes" type="number" min="5" defaultValue={settings.defaultMatchMinutes ?? 30} /></label>
          <label><span>{tr(locale,"Grupo mínimo","Min group")}</span><input name="minimumGroup" type="number" min="2" defaultValue={settings.minimumGroup ?? 3} /></label>
          <label><span>{tr(locale,"Grupo preferido","Preferred group")}</span><input name="preferredGroup" type="number" min="2" defaultValue={settings.preferredGroup ?? 4} /></label>
          <label><span>{tr(locale,"Grupo máximo","Max group")}</span><input name="maximumGroup" type="number" min="2" defaultValue={settings.maximumGroup ?? 4} /></label>
          <label><span>{tr(locale,"Clasificados sugeridos","Suggested qualifiers")}</span><select name="suggestedQualifiersPerGroup" defaultValue={String(settings.suggestedQualifiersPerGroup ?? 2)}><option value="0">Auto</option><option value="1">1</option><option value="2">2</option></select></label>
          <label><span>{tr(locale,"Siembra default","Default seeding")}</span><select name="seedingMethod" defaultValue={settings.seedingMethod ?? "snake"}><option value="snake">DUPR / snake</option><option value="random">{tr(locale,"Aleatorio","Random")}</option><option value="manual">{tr(locale,"Manual","Manual")}</option><option value="live">{tr(locale,"Sorteo en vivo","Live draw")}</option></select></label>
          <label><span>{tr(locale,"Descanso mínimo","Minimum rest")}</span><select name="minimumRestSlots" defaultValue={String(settings.minimumRestSlots ?? 1)}><option value="0">0</option><option value="1">1</option><option value="2">2</option><option value="3">3</option><option value="4">4</option></select></label>
          <button className="light">{tr(locale,"Guardar parámetros locales","Save local parameters")}</button>
        </form>
      </article>

      {standardCategories.length ? (
        <article className="panel">
          <div className="panel-title">
            <div><div className="eyebrow">STANDARD FORMAT</div><h2>{tr(locale,"Formato por categoría","Format by category")}</h2></div>
          </div>
          <div className="td-category-tabs">
            {standardCategories.map((category) => <button type="button" key={category.id} className={category.id===standardCategory?.id?"light small":"ghost small"} onClick={()=>setStandardCategoryId(category.id)}>{category.name}</button>)}
          </div>
          {standardCategory ? (
            <form className="td-format-grid" onSubmit={saveStandard}>
              <label><span>{tr(locale,"Vueltas de grupo","Group rounds")}</span><select name="groupRounds" defaultValue={standardFormat?.groupRounds ?? 1}><option value="1">1</option><option value="2">2</option></select></label>
              <label><span>{tr(locale,"Clasifican/grupo","Qualifiers/group")}</span><input name="qualifiersPerGroup" type="number" min="1" defaultValue={standardFormat?.qualifiersPerGroup ?? 2} /></label>
              <label><span>Wildcards</span><input name="wildcardQualifiers" type="number" min="0" defaultValue={standardFormat?.wildcardQualifiers ?? 0} /></label>
              <label><span>Playoff</span><select name="playoffMode" defaultValue={standardFormat?.playoffMode ?? "standard"}><option value="standard">Standard</option><option value="top2_final">Top 2 → Final</option><option value="top4_semis">Top 4 → Semis</option><option value="top3_step">Top 3 ladder</option><option value="league_only">League only</option></select></label>
              <label><span>{tr(locale,"Comparación grupos","Cross-group")}</span><select name="crossGroupMethod" defaultValue={standardFormat?.crossGroupMethod ?? "normalized"}><option value="normalized">Normalized</option><option value="equalized">Equalized</option></select></label>
              <label><span>{tr(locale,"Consolación","Consolation")}</span><select name="consolationMode" defaultValue={standardFormat?.consolationMode ?? "none"}><option value="none">{tr(locale,"Sin consolación","None")}</option><option value="knockout">Knockout</option></select></label>
              <label className="check"><input name="avoidGroupRematches" type="checkbox" defaultChecked={standardFormat?.avoidGroupRematches ?? true}/><span>{tr(locale,"Evitar revancha inmediata","Avoid group rematch")}</span></label>
              <label className="check"><input name="bronzeMatch" type="checkbox" defaultChecked={standardFormat?.bronzeMatch ?? true}/><span>{tr(locale,"Partido por bronce","Bronze match")}</span></label>
              <label><span>{tr(locale,"Cruce final","Final draw")}</span><select name="finalDrawMethod" defaultValue={standardFormat?.finalDrawMethod ?? "performance"}><option value="performance">Performance</option><option value="pots">Pots</option></select></label>
              <label><span>{tr(locale,"Medallas","Medals")}</span><select name="medalSchedule" defaultValue={standardFormat?.medalSchedule ?? "sequential"}><option value="sequential">{tr(locale,"Secuencial","Sequential")}</option><option value="simultaneous">{tr(locale,"Simultáneo","Simultaneous")}</option></select></label>
              <label><span>{tr(locale,"Descanso preferido","Preferred rest")}</span><input name="preferredRestSlots" type="number" min="0" defaultValue={standardFormat?.preferredRestSlots ?? settings.minimumRestSlots ?? 1}/></label>
              <label><span>Grupos BO</span><select name="preBestOf" defaultValue={standardFormat?.preliminary?.bestOf ?? 1}><option value="1">BO1</option><option value="3">BO3</option></select></label>
              <label><span>{tr(locale,"Puntos grupos","Group target")}</span><input name="preTarget" type="number" min="1" defaultValue={standardFormat?.preliminary?.pointTarget ?? 15}/></label>
              <label><span>Medallas BO</span><select name="medalBestOf" defaultValue={standardFormat?.medal?.bestOf ?? 3}><option value="1">BO1</option><option value="3">BO3</option></select></label>
              <label><span>{tr(locale,"Puntos medallas","Medal target")}</span><input name="medalTarget" type="number" min="1" defaultValue={standardFormat?.medal?.pointTarget ?? 11}/></label>
              <button className="light">{tr(locale,"Guardar Standard local","Save Standard locally")}</button>
            </form>
          ) : null}
        </article>
      ) : null}

      {teamCategories.length ? (
        <article className="panel team-format-builder">
          <div className="panel-title">
            <div><div className="eyebrow">TEAM FORMAT BUILDER</div><h2>{teamCategory?.name ?? "Team"}</h2></div>
            <div className="form-actions">
              <button type="button" className="ghost small" onClick={()=>applyPreset("senior_cup_2026")}>Senior Cup 2026</button>
              <button type="button" className="ghost small" onClick={()=>applyPreset("generic")}>{tr(locale,"Team configurable","Configurable Team")}</button>
            </div>
          </div>
          <div className="td-category-tabs">
            {teamCategories.map((category) => <button type="button" key={category.id} className={category.id===teamCategory?.id?"light small":"ghost small"} onClick={()=>setTeamCategoryId(category.id)}>{category.name}</button>)}
          </div>
          {teamCategory && teamFormat ? (
            <form className="td-stack" onSubmit={saveTeam}>
              <section className="team-config-block">
                <h3>{tr(locale,"Roster","Roster")}</h3>
                <div className="td-format-grid">
                  <label><span>{tr(locale,"Mínimo","Minimum")}</span><input name="rosterMin" type="number" min="1" defaultValue={teamFormat.roster.min}/></label>
                  <label><span>{tr(locale,"Máximo","Maximum")}</span><input name="rosterMax" type="number" min="1" defaultValue={teamFormat.roster.max}/></label>
                  <label><span>{tr(locale,"Composición","Composition")}</span><select name="composition" defaultValue={teamFormat.roster.composition}><option value="mixed">Mixed</option><option value="open">Open</option><option value="male">Male</option><option value="female">Female</option></select></label>
                  <label><span>{tr(locale,"Hombres mín.","Men min.")}</span><input name="maleMin" type="number" min="0" defaultValue={teamFormat.roster.rules.maleMin}/></label>
                  <label><span>{tr(locale,"Hombres máx.","Men max.")}</span><input name="maleMax" type="number" min="0" defaultValue={teamFormat.roster.rules.maleMax ?? ""}/></label>
                  <label><span>{tr(locale,"Mujeres mín.","Women min.")}</span><input name="femaleMin" type="number" min="0" defaultValue={teamFormat.roster.rules.femaleMin}/></label>
                  <label><span>{tr(locale,"Mujeres máx.","Women max.")}</span><input name="femaleMax" type="number" min="0" defaultValue={teamFormat.roster.rules.femaleMax ?? ""}/></label>
                  <label className="check"><input name="substitutesAllowed" type="checkbox" defaultChecked={teamFormat.roster.substitutesAllowed}/><span>{tr(locale,"Permitir suplentes","Allow substitutes")}</span></label>
                  <label className="check"><input name="captainRequired" type="checkbox" defaultChecked={teamFormat.roster.captainRequired}/><span>{tr(locale,"Capitán obligatorio","Captain required")}</span></label>
                </div>
              </section>

              <section className="team-config-block">
                <h3>{tr(locale,"Serie y clasificación","Encounter & competition")}</h3>
                <div className="td-format-grid">
                  <label><span>{tr(locale,"Regla ganador","Winner rule")}</span><select name="winnerRule" defaultValue={teamFormat.encounter.winnerRule}><option value="majority">Majority</option><option value="first_to">First to</option></select></label>
                  <label><span>{tr(locale,"Objetivo victorias","Target wins")}</span><input name="targetWins" type="number" min="1" defaultValue={teamFormat.encounter.targetWins ?? ""}/></label>
                  <label className="check"><input name="playRemainingAfterClinched" type="checkbox" defaultChecked={teamFormat.encounter.playRemainingAfterClinched}/><span>{tr(locale,"Jugar restantes tras definir","Play remaining after clinched")}</span></label>
                  <label><span>{tr(locale,"Vueltas","Group rounds")}</span><select name="teamGroupRounds" defaultValue={teamFormat.competition.groupRounds}><option value="1">1</option><option value="2">2</option></select></label>
                  <label><span>Playoff</span><select name="teamPlayoffMode" defaultValue={teamFormat.competition.playoffMode}><option value="standard">Standard</option><option value="top2_final">Top 2 → Final</option><option value="top4_semis">Top 4 → Semis</option><option value="top3_step">Top 3 ladder</option><option value="league_only">League only</option></select></label>
                  <label><span>{tr(locale,"Clasifican/grupo","Qualifiers/group")}</span><input name="teamQualifiersPerGroup" type="number" min="1" defaultValue={teamFormat.competition.qualifiersPerGroup ?? 2}/></label>
                  <label><span>Wildcards</span><input name="teamWildcardQualifiers" type="number" min="0" defaultValue={teamFormat.competition.wildcardQualifiers ?? 0}/></label>
                  <label className="check"><input name="teamBronzeMatch" type="checkbox" defaultChecked={Boolean(teamFormat.competition.bronzeMatch)}/><span>{tr(locale,"Bronce","Bronze")}</span></label>
                </div>
              </section>

              <section className="team-config-block">
                <div className="panel-title"><h3>Rubbers</h3><button type="button" className="ghost small" onClick={addRubber}>{tr(locale,"Agregar rubber","Add rubber")}</button></div>
                <div className="td-team-grid">
                  {teamFormat.encounter.rubbers.map((rubber,index)=>(
                    <div className="td-team-card" key={rubber.key}>
                      <div className="panel-title">
                        <strong>{index+1}. {rubber.label}</strong>
                        <div className="form-actions">
                          <button type="button" className="ghost small" disabled={index===0} onClick={()=>mutateRubber(rubber.key,"up")}>↑</button>
                          <button type="button" className="ghost small" disabled={index===teamFormat.encounter.rubbers.length-1} onClick={()=>mutateRubber(rubber.key,"down")}>↓</button>
                          <button type="button" className="danger small" onClick={()=>mutateRubber(rubber.key,"remove")}>×</button>
                        </div>
                      </div>
                      <div className="td-format-grid">
                        <label><span>{tr(locale,"Nombre","Name")}</span><input name={`rubber:${rubber.key}:label`} defaultValue={rubber.label}/></label>
                        <label><span>{tr(locale,"Modalidad","Mode")}</span><select name={`rubber:${rubber.key}:mode`} defaultValue={rubber.mode}><option value="singles">Singles</option><option value="doubles">Doubles</option></select></label>
                        <label><span>{tr(locale,"Género","Gender")}</span><select name={`rubber:${rubber.key}:gender`} defaultValue={rubber.gender}><option value="open">Open</option><option value="male">Male</option><option value="female">Female</option><option value="mixed">Mixed</option></select></label>
                        <label><span>{tr(locale,"Se juega","Play")}</span><select name={`rubber:${rubber.key}:play`} defaultValue={rubber.play}><option value="always">{tr(locale,"Siempre","Always")}</option><option value="if_tied">{tr(locale,"Si empatan","If tied")}</option></select></label>
                        <label><span>{tr(locale,"Peso","Weight")}</span><input name={`rubber:${rubber.key}:weight`} type="number" min="0" defaultValue={rubber.weight}/></label>
                        <label><span>BO</span><select name={`rubber:${rubber.key}:bestOf`} defaultValue={rubber.bestOf}><option value="1">BO1</option><option value="3">BO3</option></select></label>
                        <label><span>{tr(locale,"Puntos","Target")}</span><input name={`rubber:${rubber.key}:target`} type="number" min="1" defaultValue={rubber.pointTarget}/></label>
                        <label><span>Scoring mode</span><input name={`rubber:${rubber.key}:scoringMode`} defaultValue={rubber.scoringMode ?? ""} placeholder="rally-win-by-2-cap-21"/></label>
                        <label className="check"><input name={`rubber:${rubber.key}:tiebreaker`} type="checkbox" defaultChecked={rubber.isTiebreaker}/><span>Tiebreaker</span></label>
                      </div>
                    </div>
                  ))}
                </div>
              </section>

              <section className="team-config-block">
                <h3>{tr(locale,"Desempates de tabla","Standings criteria")}</h3>
                <div className="td-chip-list">
                  {[
                    ["standing_points",tr(locale,"Puntos de serie","Standing points")],
                    ["encounter_wins",tr(locale,"Series ganadas","Encounter wins")],
                    ["head_to_head",tr(locale,"Enfrentamiento directo","Head to head")],
                    ["rubber_diff",tr(locale,"Diferencia de partidos","Rubber diff")],
                    ["point_diff",tr(locale,"Diferencia de puntos","Point diff")],
                    ["points_for",tr(locale,"Puntos a favor","Points for")],
                  ].map(([value,label])=><label className="check" key={value}><input type="checkbox" name={`criterion:${value}`} defaultChecked={teamFormat.standings.criteria.includes(value as any)}/><span>{label}</span></label>)}
                </div>
              </section>

              <button className="light">{tr(locale,"Guardar formato Team local","Save Team format locally")}</button>
            </form>
          ) : (
            <div className="notice-box">
              {tr(locale,"Esta categoría todavía no tiene formato. Aplicá Senior Cup 2026 o Team configurable para empezar.","This category has no format yet. Apply Senior Cup 2026 or Configurable Team to start.")}
            </div>
          )}
        </article>
      ) : null}
    </section>
  );
}

function DayStandardCompetition({
  locale,
  snapshot,
  mutate,
}: {
  locale: Locale;
  snapshot: TournamentDaySnapshot;
  mutate: (fn: (snapshot: TournamentDaySnapshot) => void, message?: string) => Promise<void>;
}) {
  const categories = (snapshot.workspace.core.categories as any[]).filter(
    (category) => category.entryType !== "team",
  );
  const [categoryId, setCategoryId] = useState(categories[0]?.id ?? "");
  const category = categories.find((candidate) => candidate.id === categoryId) ?? categories[0];
  const competition = (snapshot.workspace.standard.competitions as any[]).find(
    (candidate) => candidate.categoryId === category?.id,
  );
  const drawSession = (snapshot.workspace.standard.drawSessions as any[]).find(
    (candidate) => candidate.categoryId === category?.id,
  );
  const drawState = (() => {
    try {
      return drawSession?.stateJson ? JSON.parse(drawSession.stateJson) as any : null;
    } catch {
      return null;
    }
  })();
  const entries = (snapshot.workspace.standard.entries as any[]).filter(
    (entry) => entry.categoryId === category?.id,
  );
  const players = (snapshot.workspace.participants.players as any[]).filter(
    (player) => player.playerStatus === "confirmed",
  );
  const standings = (snapshot.workspace.standard.standings as any[]).filter(
    (standing) => standing.categoryId === category?.id,
  );

  useEffect(() => {
    if (!categoryId && categories[0]?.id) setCategoryId(categories[0].id);
    if (categoryId && !categories.some((candidate) => candidate.id === categoryId)) {
      setCategoryId(categories[0]?.id ?? "");
    }
  }, [categories, categoryId]);

  const addEntry = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!category) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    const first = String(data.get("playerA") ?? "");
    const second = String(data.get("playerB") ?? "");
    await mutate((next) => {
      addLocalStandardEntry(next, {
        categoryId: category.id,
        profileIds: category.entryType === "pair" ? [first, second] : [first],
        rating: Number(data.get("rating") ?? 0),
      });
    }, tr(locale, "Entrada agregada localmente.", "Entry added locally."));
    form.reset();
  };

  const generate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!category) return;
    const data = new FormData(event.currentTarget);
    await mutate((next) => {
      generateLocalStandardStructure(
        next,
        category.id,
        Number(data.get("groupCount") ?? 1),
        String(data.get("method") ?? "snake") as "snake" | "random",
      );
    }, tr(locale, "Estructura Standard regenerada localmente.", "Standard structure regenerated locally."));
  };

  const startDraw = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!category) return;
    const data = new FormData(event.currentTarget);
    await mutate((next) => {
      startLocalLiveDraw(next, category.id, Number(data.get("liveGroupCount") ?? 1));
    }, tr(locale, "Sorteo en vivo preparado localmente.", "Live draw prepared locally."));
  };

  const revealDraw = async () => {
    if (!category) return;
    await mutate((next) => {
      advanceLocalLiveDraw(next, category.id);
    }, tr(locale, "Siguiente entrada sorteada localmente.", "Next entry drawn locally."));
  };

  return (
    <section className="td-stack">
      <article className="panel">
        <div className="panel-title"><h2>{tr(locale, "Categorías Standard", "Standard categories")}</h2><span>{categories.length}</span></div>
        <div className="td-category-tabs">
          {categories.map((item) => <button key={item.id} className={item.id === category?.id ? "light small" : "ghost small"} onClick={() => setCategoryId(item.id)}>{item.name}</button>)}
        </div>
      </article>

      {category ? (
        <>
          <article className="panel">
            <div className="panel-title"><div><div className="eyebrow">ENTRIES</div><h2>{category.name}</h2></div><span>{entries.length}</span></div>
            <form className="td-inline-form" onSubmit={addEntry}>
              <label><span>{category.entryType === "pair" ? tr(locale, "Jugador A", "Player A") : tr(locale, "Jugador", "Player")}</span><select name="playerA" required defaultValue=""><option value="">—</option>{players.map((player) => <option key={player.id} value={player.id}>{player.displayName}</option>)}</select></label>
              {category.entryType === "pair" ? <label><span>{tr(locale, "Jugador B", "Player B")}</span><select name="playerB" required defaultValue=""><option value="">—</option>{players.map((player) => <option key={player.id} value={player.id}>{player.displayName}</option>)}</select></label> : null}
              <label><span>{tr(locale, "Rating / seed", "Rating / seed")}</span><input name="rating" type="number" step="0.001" min="0" /></label>
              <button className="light" disabled={!players.length}>{tr(locale, "Agregar entrada", "Add entry")}</button>
            </form>
            <div className="td-chip-list">{entries.map((entry) => <span key={entry.id}>{entry.displayName} · {Number(entry.seedRating || 0).toFixed(3)}</span>)}</div>
          </article>


          <article className="panel">
            <div className="panel-title"><div><div className="eyebrow">DRAW / GROUPS</div><h2>{tr(locale, "Generar grupos", "Generate groups")}</h2></div><span>{competition?.groups?.length ?? 0}</span></div>
            <form className="td-inline-form" onSubmit={generate}>
              <label><span>{tr(locale, "Grupos", "Groups")}</span><input name="groupCount" type="number" min="1" max={Math.max(1, Math.floor(entries.length / 2))} defaultValue={competition?.groups?.length || 1} /></label>
              <label><span>{tr(locale, "Método", "Method")}</span><select name="method" defaultValue="snake"><option value="snake">Snake / seed</option><option value="random">{tr(locale, "Aleatorio", "Random")}</option></select></label>
              <button className="light" disabled={entries.length < 2}>{competition ? tr(locale, "Regenerar local", "Regenerate locally") : tr(locale, "Generar local", "Generate locally")}</button>
            </form>
            {competition?.groups?.length ? (
              <div className="td-group-grid">
                {competition.groups.map((group: any) => <div key={group.id}><strong>{tr(locale, "Grupo", "Group")} {group.name}</strong>{group.entries.map((entry: any, index: number) => <span key={entry.id}>{index + 1}. {entry.name}</span>)}</div>)}
              </div>
            ) : null}
          </article>

          <article className="panel">
            <div className="panel-title"><div><div className="eyebrow">LIVE DRAW</div><h2>{tr(locale, "Sorteo en vivo local", "Local live draw")}</h2></div><span>{drawState?.revealIndex ?? 0}/{entries.length}</span></div>
            {!drawState || drawState.status === "complete" ? (
              <form className="td-inline-form" onSubmit={startDraw}>
                <label><span>{tr(locale, "Cantidad de grupos", "Group count")}</span><input name="liveGroupCount" type="number" min="1" max={Math.max(1, Math.floor(entries.length / 2))} defaultValue={competition?.groups?.length || 1} /></label>
                <button className="ghost" disabled={entries.length < 2}>{drawState?.status === "complete" ? tr(locale, "Nuevo sorteo local", "New local draw") : tr(locale, "Preparar sorteo", "Prepare draw")}</button>
              </form>
            ) : (
              <div className="td-live-draw">
                <div className="td-live-draw-reveal">
                  <small>{tr(locale, "ÚLTIMO SORTEO", "LAST DRAW")}</small>
                  <strong>{entries.find((entry) => entry.id === drawState.lastEntryId)?.displayName ?? "—"}</strong>
                  <span>{drawState.lastGroup ? `${tr(locale, "Grupo", "Group")} ${drawState.lastGroup}` : "—"}</span>
                </div>
                <button className="light" onClick={() => void revealDraw()}>{tr(locale, "Sortear siguiente", "Draw next")}</button>
                <div className="td-group-grid">
                  {Object.entries(drawState.assignments ?? {}).map(([label, ids]) => <div key={label}><strong>{tr(locale, "Grupo", "Group")} {label}</strong>{(ids as string[]).map((id, index) => <span key={id}>{index + 1}. {entries.find((entry) => entry.id === id)?.displayName ?? id}</span>)}</div>)}
                </div>
              </div>
            )}
            {drawState?.status === "complete" ? <p className="notice-box">{tr(locale, "Sorteo completo: la estructura Standard ya quedó generada en la copia local.", "Draw complete: the Standard structure is now generated in the local copy.")}</p> : null}
          </article>

          {standings.length ? (
            <article className="panel wide">
              <div className="eyebrow">STANDINGS</div>
              <h2>{tr(locale, "Tablas Standard", "Standard standings")}</h2>
              <div className="td-standing-grid">
                {standings.map((standing) => <div key={standing.groupId} className="td-standing-card"><strong>{tr(locale, "Grupo", "Group")} {standing.groupName}</strong>{standing.rows.map((row: any) => <span key={row.entryId}>{row.position}. {row.name} · {row.wins}-{row.losses} · {row.diff >= 0 ? "+" : ""}{row.diff}</span>)}</div>)}
              </div>
            </article>
          ) : null}
        </>
      ) : <div className="empty-state">{tr(locale, "No hay categorías Standard.", "No Standard categories.")}</div>}
    </section>
  );
}

function DayTeam({
  locale,
  snapshot,
  mutate,
}: {
  locale: Locale;
  snapshot: TournamentDaySnapshot;
  mutate: (fn: (snapshot: TournamentDaySnapshot) => void, message?: string) => Promise<void>;
}) {
  const categories = snapshot.team.categories as any[];
  const [categoryId, setCategoryId] = useState(categories[0]?.id ?? "");
  const category = categories.find((candidate) => candidate.id === categoryId) ?? categories[0];

  useEffect(() => {
    if (!categoryId && categories[0]?.id) setCategoryId(categories[0].id);
    if (categoryId && !categories.some((candidate) => candidate.id === categoryId)) {
      setCategoryId(categories[0]?.id ?? "");
    }
  }, [categories, categoryId]);

  if (!categories.length) {
    return (
      <section className="td-stack">
        <article className="panel team-empty">
          <div className="eyebrow">TEAM · ADMIN → DAY</div>
          <h2>{tr(locale, "No hay categorías por equipos", "No Team categories")}</h2>
          <p>{tr(
            locale,
            "Las categorías se crean en Administración porque forman parte de la inscripción pública. Creá allí una categoría con modalidad Equipo y después volvé a Tournament Day para armar equipos, rosters y formato.",
            "Categories are created in Administration because they belong to public registration. Create a Team-mode category there, then return to Tournament Day to build teams, rosters and format."
          )}</p>
        </article>
      </section>
    );
  }

  const format = category?.format as TeamFormat | null;

  const createTeam = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    await mutate((next) => {
      createLocalTeam(next, category.id, String(data.get("name") ?? "").trim());
    }, tr(locale, "Equipo creado localmente.", "Team created locally."));
    form.reset();
  };

  const generate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    await mutate((next) => {
      generateLocalTeamStructure(next, category.id, Number(data.get("groupCount") ?? 1));
    }, tr(locale, "Estructura Team generada localmente.", "Team structure generated locally."));
  };

  return (
    <section className="td-stack">
      <article className="panel">
        <div className="panel-title"><h2>{tr(locale, "Categorías Team", "Team categories")}</h2><span>{categories.length}</span></div>
        <div className="td-category-tabs">{categories.map((item) => <button key={item.id} className={item.id === category.id ? "light small" : "ghost small"} onClick={() => setCategoryId(item.id)}>{item.name}</button>)}</div>
      </article>


      <article className="panel">
        <div className="panel-title"><div><div className="eyebrow">ROSTERS</div><h2>{tr(locale, "Equipos", "Teams")}</h2></div><span>{category.entries.length}</span></div>
        <form className="td-inline-form" onSubmit={createTeam}>
          <label><span>{tr(locale, "Nombre del equipo", "Team name")}</span><input name="name" required /></label>
          <button className="light">{tr(locale, "Crear equipo local", "Create local team")}</button>
        </form>
        <div className="td-team-grid">
          {category.entries.map((entry: any) => (
            <LocalRosterEditor key={entry.id} locale={locale} snapshot={snapshot} category={category} entry={entry} mutate={mutate} />
          ))}
        </div>
      </article>

      <article className="panel">
        <div className="panel-title"><div><div className="eyebrow">GROUPS</div><h2>{tr(locale, "Estructura Team", "Team structure")}</h2></div><span>{category.encounters.length}</span></div>
        {!format ? <p className="warning-line">{tr(locale, "Primero guardá o aplicá un formato en la pestaña Formato.", "Save or apply a format in the Format tab first.")}</p> : null}
        <form className="td-inline-form" onSubmit={generate}>
          <label><span>{tr(locale, "Cantidad de grupos", "Group count")}</span><input name="groupCount" type="number" min="1" max={format?.competition.playoffMode === "standard" ? Math.max(1, Math.floor(category.entries.length / 2)) : 1} defaultValue={Math.max(1, new Set(category.groups.map((row: any) => row.id)).size)} /></label>
          <button className="light" disabled={!format || category.entries.length < 2}>{category.encounters.length ? tr(locale, "Regenerar local", "Regenerate locally") : tr(locale, "Generar local", "Generate locally")}</button>
        </form>
        {category.groups.length ? <div className="td-group-grid">{[...new Set(category.groups.map((row: any) => row.id))].map((groupId: unknown) => { const rows = category.groups.filter((row: any) => row.id === groupId); return <div key={String(groupId)}><strong>{tr(locale, "Grupo", "Group")} {rows[0]?.name}</strong>{rows.map((row: any, index: number) => <span key={row.entryId}>{index + 1}. {row.entryName}</span>)}</div>; })}</div> : null}
      </article>

      {category.encounters.length ? (
        <article className="panel">
          <div className="eyebrow">LINEUPS</div>
          <h2>{tr(locale, "Alineaciones locales", "Local lineups")}</h2>
          <p className="muted">{tr(locale, "Bloqueá ambas alineaciones antes de cargar un rubber. Todo queda sólo en este navegador hasta publicar.", "Lock both lineups before entering a rubber. Everything stays in this browser until published.")}</p>
          <div className="td-lineup-list">
            {category.encounters.filter((encounter: any) => encounter.status !== "bye").map((encounter: any) => (
              <LocalLineupEncounter key={encounter.id} locale={locale} category={category} encounter={encounter} mutate={mutate} />
            ))}
          </div>
        </article>
      ) : null}

      {category.standings.length ? (
        <article className="panel wide">
          <div className="eyebrow">STANDINGS</div>
          <h2>{tr(locale, "Tabla Team", "Team standings")}</h2>
          <div className="td-standing-grid">{category.standings.map((standing: any) => <div className="td-standing-card" key={standing.groupId}><strong>{tr(locale, "Grupo", "Group")} {standing.groupName}</strong>{standing.rows.map((row: any, index: number) => <span key={row.entryId}>{index + 1}. {row.entryName} · <b>{row.standingPoints} PTS</b> · {row.wins}-{row.losses} · DIF {row.rubberDiff >= 0 ? "+" : ""}{row.rubberDiff}</span>)}</div>)}</div>
        </article>
      ) : null}
    </section>
  );
}

function LocalRosterEditor({
  locale,
  snapshot,
  category,
  entry,
  mutate,
}: {
  locale: Locale;
  snapshot: TournamentDaySnapshot;
  category: any;
  entry: any;
  mutate: (fn: (snapshot: TournamentDaySnapshot) => void, message?: string) => Promise<void>;
}) {
  const profiles = snapshot.team.profiles as any[];
  const rosterById = new Map(entry.roster.map((member: any) => [member.personId, member] as const));
  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const roster: TeamRosterMember[] = profiles
      .filter((profile) => data.get(`member:${profile.personId}`) === "on")
      .map((profile) => ({
        personId: profile.personId,
        name: profile.displayName,
        sportGender: profile.sportGender,
        role: String(data.get(`role:${profile.personId}`) ?? "player") as any,
      }));
    await mutate((next) => {
      updateLocalTeamRoster(next, category.id, entry.id, roster);
    }, tr(locale, `Roster de ${entry.displayName} guardado localmente.`, `${entry.displayName} roster saved locally.`));
  };
  return (
    <details className="td-team-card">
      <summary><strong>{entry.displayName}</strong><span>{entry.roster.length} {tr(locale, "jugadores", "players")}</span></summary>
      <form onSubmit={save}>
        <div className="td-roster-picker">
          {profiles.map((profile) => {
            const member = rosterById.get(profile.personId) as any;
            return <div key={profile.personId}><label className="check"><input type="checkbox" name={`member:${profile.personId}`} defaultChecked={Boolean(member)} /><span>{profile.displayName} · {profile.sportGender === "male" ? "M" : profile.sportGender === "female" ? "F" : "—"}</span></label><select name={`role:${profile.personId}`} defaultValue={member?.role ?? "player"}><option value="player">Player</option><option value="captain">Captain</option><option value="substitute">Sub</option></select></div>;
          })}
        </div>
        <button className="light small">{tr(locale, "Guardar roster local", "Save local roster")}</button>
      </form>
    </details>
  );
}

function LocalLineupEncounter({
  locale,
  category,
  encounter,
  mutate,
}: {
  locale: Locale;
  category: any;
  encounter: any;
  mutate: (fn: (snapshot: TournamentDaySnapshot) => void, message?: string) => Promise<void>;
}) {
  const side = (entryId: string, label: string) => {
    const entry = category.entries.find((candidate: any) => candidate.id === entryId);
    const existing = encounter.lineups.find((lineup: any) => lineup.entryId === entryId);
    const checked = new Set((existing?.assignments ?? []).map((assignment: any) => `${assignment.rubberKey}:${assignment.personId}`));
    const save = async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const data = new FormData(event.currentTarget);
      const assignments: TeamLineupAssignment[] = category.format.encounter.rubbers.map((rubber: any) => ({
        rubberKey: rubber.key,
        personIds: entry.roster
          .filter((member: any) => data.get(`${rubber.key}:${member.personId}`) === "on")
          .map((member: any) => member.personId),
      }));
      await mutate((next) => {
        saveLocalTeamLineup(next, category.id, encounter.id, entryId, assignments);
      }, tr(locale, `Alineación ${label} bloqueada localmente.`, `${label} lineup locked locally.`));
    };
    return (
      <form onSubmit={save} className="td-lineup-side">
        <h4>{label}</h4>
        {category.format.encounter.rubbers.map((rubber: any) => (
          <div key={rubber.key} className="td-lineup-rubber">
            <strong>{rubber.label}</strong>
            <div>{entry?.roster.map((member: any) => <label className="check compact-check" key={member.personId}><input type="checkbox" name={`${rubber.key}:${member.personId}`} defaultChecked={checked.has(`${rubber.key}:${member.personId}`)} /><span>{member.name}</span></label>)}</div>
          </div>
        ))}
        <button className="light small">{existing?.status === "locked" ? tr(locale, "Rebloquear local", "Relock locally") : tr(locale, "Bloquear local", "Lock locally")}</button>
      </form>
    );
  };
  return (
    <details className="td-lineup-encounter">
      <summary><strong>{encounter.sideA} vs {encounter.sideB}</strong><span>{encounter.roundLabel ?? encounter.stage}</span></summary>
      <div className="td-lineup-sides">
        {encounter.entryAId ? side(encounter.entryAId, encounter.sideA) : null}
        {encounter.entryBId ? side(encounter.entryBId, encounter.sideB) : null}
      </div>
    </details>
  );
}

function DaySchedule({
  locale,
  snapshot,
  mutate,
}: {
  locale: Locale;
  snapshot: TournamentDaySnapshot;
  mutate: (fn: (snapshot: TournamentDaySnapshot) => void, message?: string) => Promise<void>;
}) {
  const schedule = [...(snapshot.workspace.schedule.schedule as any[])].sort(
    (a, b) => Number(a.startAt) - Number(b.startAt),
  );
  const generateStandard = () =>
    mutate((next) => generateLocalStandardSchedule(next), tr(locale, "Cronograma Standard generado localmente.", "Standard schedule generated locally."));
  const generateTeam = () =>
    mutate((next) => generateLocalTeamSchedule(next), tr(locale, "Cronograma Team generado localmente.", "Team schedule generated locally."));

  return (
    <section className="td-stack">
      <article className="panel">
        <div className="panel-title"><div><div className="eyebrow">LOCAL SCHEDULE</div><h2>{tr(locale, "Cronograma operativo", "Operational schedule")}</h2></div><span>{schedule.length}</span></div>
        <div className="form-actions">
          <button className="ghost small" onClick={() => void generateStandard()}>{tr(locale, "Regenerar Standard", "Regenerate Standard")}</button>
          <button className="ghost small" onClick={() => void generateTeam()}>{tr(locale, "Regenerar Team", "Regenerate Team")}</button>
        </div>
        <p className="muted">{tr(locale, "Los botones regeneran únicamente la copia local. También podés ajustar cancha y hora fila por fila.", "The buttons regenerate only the local copy. You can also adjust court and time row by row.")}</p>
      </article>
      <div className="td-schedule-list">
        {schedule.map((row) => <ScheduleRowEditor key={row.id} locale={locale} row={row} mutate={mutate} />)}
      </div>
    </section>
  );
}

function ScheduleRowEditor({
  locale,
  row,
  mutate,
}: {
  locale: Locale;
  row: any;
  mutate: (fn: (snapshot: TournamentDaySnapshot) => void, message?: string) => Promise<void>;
}) {
  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const startAt = localDateTimeToUnix(
      String(data.get("start") ?? "").slice(0, 10),
      String(data.get("start") ?? "").slice(11, 16),
    );
    const duration = Math.max(5, Number(data.get("duration") ?? Math.round((row.endAt - row.startAt) / 60)));
    await mutate((next) => {
      updateLocalScheduleRow(next, row.id, {
        courtLabel: String(data.get("courtLabel") ?? row.courtLabel),
        startAt,
        endAt: startAt + duration * 60,
      });
    }, tr(locale, "Bloque actualizado localmente.", "Schedule row updated locally."));
  };
  return (
    <form className="td-schedule-row" onSubmit={save}>
      <div><strong>{row.sideA || row.roundLabel || row.categoryName}{row.sideB ? ` vs ${row.sideB}` : ""}</strong><span>{row.categoryName}{row.rubberKey ? ` · ${row.rubberKey}` : ""} · {row.status}</span></div>
      <label><span>{tr(locale, "Inicio", "Start")}</span><input name="start" type="datetime-local" defaultValue={unixToLocalDateTime(Number(row.startAt))} /></label>
      <label><span>{tr(locale, "Cancha", "Court")}</span><input name="courtLabel" defaultValue={row.courtLabel} /></label>
      <label><span>Min</span><input name="duration" type="number" min="5" defaultValue={Math.max(5, Math.round((Number(row.endAt) - Number(row.startAt)) / 60))} /></label>
      <button className="ghost small">{tr(locale, "Guardar", "Save")}</button>
    </form>
  );
}

function DayResults({
  locale,
  snapshot,
  mutate,
}: {
  locale: Locale;
  snapshot: TournamentDaySnapshot;
  mutate: (fn: (snapshot: TournamentDaySnapshot) => void, message?: string) => Promise<void>;
}) {
  const standard = (snapshot.workspace.standard.matches as any[]).filter(
    (match) => match.entryAId && match.entryBId && !["bye", "skipped"].includes(match.status),
  );
  const team = (snapshot.team.categories as any[]).flatMap((category) =>
    category.encounters.flatMap((encounter: any) =>
      encounter.matches.map((match: any) => ({ category, encounter, match })),
    ),
  );
  return (
    <section className="td-stack">
      <article className="panel">
        <div className="panel-title"><div><div className="eyebrow">STANDARD</div><h2>{tr(locale, "Resultados Standard", "Standard results")}</h2></div><span>{standard.filter((match) => match.status === "finished").length}/{standard.length}</span></div>
        <div className="td-result-list">
          {standard.map((match) => <StandardResultCard key={match.matchId ?? match.encounterId} locale={locale} match={match} mutate={mutate} />)}
        </div>
      </article>
      <article className="panel">
        <div className="panel-title"><div><div className="eyebrow">TEAM</div><h2>{tr(locale, "Resultados Team", "Team results")}</h2></div><span>{team.filter(({ match }) => match.status === "finished").length}/{team.length}</span></div>
        <div className="td-result-list">
          {team.map(({ category, encounter, match }) => <TeamResultCard key={match.id} locale={locale} category={category} encounter={encounter} match={match} mutate={mutate} />)}
        </div>
      </article>
    </section>
  );
}

function ScoreInputs({ prefix, bestOf, sets }: { prefix: string; bestOf: number; sets?: any[] }) {
  return (
    <div className="td-score-inputs">
      {emptySets(bestOf).map((_, index) => (
        <div key={index}>
          <span>S{index + 1}</span>
          <input name={`${prefix}:a:${index}`} type="number" min="0" defaultValue={sets?.[index]?.scoreA ?? ""} />
          <b>–</b>
          <input name={`${prefix}:b:${index}`} type="number" min="0" defaultValue={sets?.[index]?.scoreB ?? ""} />
        </div>
      ))}
    </div>
  );
}

function StandardResultCard({
  locale,
  match,
  mutate,
}: {
  locale: Locale;
  match: any;
  mutate: (fn: (snapshot: TournamentDaySnapshot) => void, message?: string) => Promise<void>;
}) {
  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    await mutate((next) => {
      setLocalStandardResult(
        next,
        match.categoryId,
        match.encounterId,
        standardResultFromForm(data, "score", Number(match.bestOf)),
      );
    }, tr(locale, "Resultado Standard guardado localmente.", "Standard result saved locally."));
  };
  return (
    <form className={`td-result-card ${match.status === "finished" ? "done" : ""}`} onSubmit={save}>
      <div><span>{match.categoryName} · {match.roundLabel ?? match.stage}</span><strong>{match.sideA} <em>vs</em> {match.sideB}</strong></div>
      <ScoreInputs prefix="score" bestOf={Number(match.bestOf)} sets={match.sets} />
      <button className={match.status === "finished" ? "ghost small" : "light small"}>{match.status === "finished" ? tr(locale, "Corregir local", "Correct locally") : tr(locale, "Guardar local", "Save locally")}</button>
    </form>
  );
}

function TeamResultCard({
  locale,
  category,
  encounter,
  match,
  mutate,
}: {
  locale: Locale;
  category: any;
  encounter: any;
  match: any;
  mutate: (fn: (snapshot: TournamentDaySnapshot) => void, message?: string) => Promise<void>;
}) {
  const bothLocked = new Set(encounter.lineups.filter((lineup: any) => lineup.status === "locked").map((lineup: any) => lineup.entryId));
  const ready = bothLocked.has(encounter.entryAId) && bothLocked.has(encounter.entryBId);
  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    await mutate((next) => {
      setLocalTeamResult(
        next,
        category.id,
        encounter.id,
        match.id,
        setsFromForm(data, "score", Number(match.bestOf)),
      );
    }, tr(locale, "Rubber Team guardado localmente.", "Team rubber saved locally."));
  };
  return (
    <form className={`td-result-card ${match.status === "finished" ? "done" : ""}`} onSubmit={save}>
      <div><span>{category.name} · {match.rubberKey} · {match.status}</span><strong>{encounter.sideA} <em>vs</em> {encounter.sideB}</strong><small>{ready ? tr(locale, "Lineups bloqueadas", "Lineups locked") : tr(locale, "Faltan lineups bloqueadas", "Locked lineups required")}</small></div>
      <ScoreInputs prefix="score" bestOf={Number(match.bestOf)} sets={match.sets} />
      <button className={match.status === "finished" ? "ghost small" : "light small"} disabled={!ready || match.status === "skipped" || match.status === "pending"}>{match.status === "finished" ? tr(locale, "Corregir local", "Correct locally") : tr(locale, "Guardar local", "Save locally")}</button>
    </form>
  );
}

function TournamentDayTV({
  snapshot,
  locale,
  embedded = false,
}: {
  snapshot: TournamentDaySnapshot;
  locale: Locale;
  embedded?: boolean;
}) {
  const schedule = [...(snapshot.workspace.schedule.schedule as any[])].sort(
    (a, b) => Number(a.startAt) - Number(b.startAt),
  );
  const active = schedule.filter((row) => row.status !== "completed" && row.status !== "cancelled").slice(0, 8);
  const standardStandings = snapshot.workspace.standard.standings as any[];
  const teamStandings = (snapshot.team.categories as any[]).flatMap((category) =>
    category.standings.map((standing: any) => ({ categoryName: category.name, ...standing })),
  );
  return (
    <section className={`td-tv ${embedded ? "embedded" : "fullscreen"}`}>
      <header>
        <div><div className="eyebrow">HUAU LIVE · LOCAL</div><h1>{snapshot.workspace.core.tournament.name}</h1></div>
        <span className="td-live-dot">● LIVE</span>
      </header>
      <div className="td-tv-grid">
        <article className="td-tv-next">
          <h2>{tr(locale, "Ahora / próximos", "Now / next")}</h2>
          {active.length ? active.map((row) => (
            <div key={row.id}>
              <span>{row.startAt ? dt(row.startAt) : "—"} · {row.courtLabel}</span>
              <strong>{row.sideA || row.roundLabel || row.categoryName}{row.sideB ? ` vs ${row.sideB}` : ""}</strong>
              <small>{row.categoryName}{row.rubberKey ? ` · ${row.rubberKey}` : ""}</small>
            </div>
          )) : <p>{tr(locale, "Sin partidos pendientes.", "No pending matches.")}</p>}
        </article>
        <article className="td-tv-tables">
          <h2>{tr(locale, "Tablas", "Standings")}</h2>
          {[...standardStandings.slice(0, 2).map((standing) => ({ title: standing.groupName, rows: standing.rows.map((row: any) => ({ id: row.entryId, name: row.name, value: `${row.wins}-${row.losses}` })) })), ...teamStandings.slice(0, 2).map((standing) => ({ title: `${standing.categoryName} · ${standing.groupName}`, rows: standing.rows.map((row: any) => ({ id: row.entryId, name: row.entryName, value: `${row.standingPoints} PTS` })) }))].map((table, index) => (
            <div className="td-tv-table" key={`${table.title}-${index}`}><strong>{table.title}</strong>{table.rows.slice(0, 8).map((row: any, position: number) => <span key={row.id}><b>{position + 1}</b>{row.name}<em>{row.value}</em></span>)}</div>
          ))}
        </article>
      </div>
    </section>
  );
}

function DayRecovery({
  locale,
  session,
  busy,
  publish,
  reloadSource,
  exportLocal,
  importLocal,
  resetLocal,
}: {
  locale: Locale;
  session: TournamentDaySession<TournamentDaySnapshot>;
  busy: string;
  publish: (finalized?: boolean) => Promise<void>;
  reloadSource: (sourceKind?: "published" | "d1") => Promise<void>;
  exportLocal: () => void;
  importLocal: (file: File) => Promise<void>;
  resetLocal: () => Promise<void>;
}) {
  return (
    <section className="td-grid">
      <article className="panel wide">
        <div className="eyebrow">RECOVERY</div>
        <h2>{tr(locale, "Seguridad local de la jornada", "Local event safety")}</h2>
        <div className="td-recovery-meta">
          <span><strong>{session.dirty ? tr(locale, "Cambios locales", "Local changes") : tr(locale, "Sin cambios pendientes", "No pending changes")}</strong><small>{tr(locale, "Estado IndexedDB", "IndexedDB state")}</small></span>
          <span><strong>{session.publishedRevision}</strong><small>{tr(locale, "Revisión publicada", "Published revision")}</small></span>
          <span><strong>{session.syncStatus.toUpperCase()}</strong><small>{tr(locale, "Sync D1 final", "Final D1 sync")}</small></span>
          <span><strong>{dt(Math.floor(session.updatedAt / 1000))}</strong><small>{tr(locale, "Último guardado local", "Last local save")}</small></span>
        </div>
        {session.syncStatus === "failed" && session.syncError ? (
          <p className="warning-line">
            {tr(
              locale,
              `El checkpoint está guardado en R2, pero D1 no terminó de sincronizar: ${session.syncError}. Podés corregir la jornada y volver a cerrarla/publicarla.`,
              `The checkpoint is stored in R2, but D1 did not finish syncing: ${session.syncError}. You can correct the event and close/publish it again.`,
            )}
          </p>
        ) : null}
        <div className="form-actions">
          <button className="light" disabled={Boolean(busy)} onClick={() => void publish(false)}>{busy === "publish" ? "…" : tr(locale, "Publicar checkpoint", "Publish checkpoint")}</button>
          <button
            className="ghost"
            disabled={Boolean(busy) || (session.syncStatus === "synced" && !session.dirty)}
            onClick={() => void publish(true)}
          >
            {busy === "finalize"
              ? "…"
              : session.syncStatus === "synced" && !session.dirty
                ? tr(locale, "Jornada ya sincronizada", "Event already synced")
                : tr(locale, "Cerrar y publicar jornada", "Close & publish event")}
          </button>
        </div>
      </article>

      <article className="panel">
        <h2>{tr(locale, "Backup", "Backup")}</h2>
        <div className="td-quick">
          <button onClick={exportLocal}>{tr(locale, "Exportar JSON local", "Export local JSON")}</button>
          <label className="td-file-action">{tr(locale, "Importar backup", "Import backup")}<input type="file" accept="application/json,.json" onChange={(event: ChangeEvent<HTMLInputElement>) => { const file = event.currentTarget.files?.[0]; if (file) void importLocal(file); event.currentTarget.value = ""; }} /></label>
        </div>
      </article>

      <article className="panel">
        <h2>{tr(locale, "Fuente", "Source")}</h2>
        <p className="muted">
          {session.source === "operator"
            ? tr(
                locale,
                "Descargá manualmente el último checkpoint compartido para actualizar esta copia local.",
                "Manually download the latest shared checkpoint to update this local copy.",
              )
            : tr(
                locale,
                "Ante un conflicto entre operadores, cargá la última revisión publicada. Restaurar desde D1 queda como recuperación deliberada.",
                "After an operator conflict, load the latest published revision. Restoring from D1 remains a deliberate recovery action.",
              )}
        </p>
        <button
          className="ghost full"
          disabled={Boolean(busy)}
          onClick={() => void reloadSource("published")}
        >
          {busy === "reload-published"
            ? "…"
            : tr(locale, "Cargar última revisión publicada", "Load latest published revision")}
        </button>
        {session.source !== "operator" ? (
          <button
            className="ghost full"
            disabled={Boolean(busy)}
            onClick={() => void reloadSource("d1")}
          >
            {busy === "reload-d1"
              ? "…"
              : tr(locale, "Restaurar desde D1", "Restore from D1")}
          </button>
        ) : null}
      </article>

      <article className="panel danger-zone">
        <h2>{tr(locale, "Borrar sesión local", "Delete local session")}</h2>
        <p className="muted">{tr(locale, "No borra el torneo del servidor. Sólo elimina esta copia de este navegador.", "This does not delete the server tournament. It only removes this browser copy.")}</p>
        <button className="danger full" onClick={() => void resetLocal()}>{tr(locale, "Borrar copia local", "Delete local copy")}</button>
      </article>
    </section>
  );
}
