import { useEffect, useMemo, useState } from "react";
import type { FocusEvent } from "react";
import type { Locale } from "./i18n";
import { loadTournamentDaySession } from "./TournamentDayStorage";
import "./TournamentDay.css";

type Props = {
  organizationId: string;
  tournamentId: string;
  locale: Locale;
  go: (path: string) => void;
};

type CoreResponse = {
  ok: true;
  tournament: {
    id: string;
    name: string;
    slug: string;
    sport: string;
    status: string;
    startAt: number;
    endAt: number | null;
    courtCount: number;
    workingRevision: number;
  };
  categories: Array<{ id: string; name: string; entryType: string; entryCount: number }>;
  summary: { playerCount: number; completedStandardMatches: number; pairIssueCount: number };
};

type DayStateResponse = {
  ok: true;
  hasOperatorAccess: boolean;
  hasPublishedSnapshot: boolean;
  publishedRevision: number;
  publishedAt: number | null;
  finalizedAt: number | null;
  syncStatus: "idle" | "syncing" | "synced" | "failed";
  syncedRevision: number;
  syncedAt: number | null;
  syncError: string | null;
};

class HubApiError extends Error {
  constructor(public code: string) {
    super(code);
  }
}

const tr = (locale: Locale, es: string, en: string) => (locale === "es" ? es : en);
const toMs = (value: number) => (value < 10_000_000_000 ? value * 1000 : value);
const date = (value: number) =>
  new Intl.DateTimeFormat("es-UY", { dateStyle: "medium" }).format(new Date(toMs(value)));
const dateTime = (value: number) =>
  new Intl.DateTimeFormat("es-UY", { dateStyle: "short", timeStyle: "short" }).format(new Date(toMs(value)));

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: { "content-type": "application/json", ...init?.headers },
  });
  const payload = (await response.json()) as T & { code?: string };
  if (!response.ok) throw new HubApiError(payload.code ?? `HTTP_${response.status}`);
  return payload;
}

export function TournamentHub({ organizationId, tournamentId, locale, go }: Props) {
  const [core, setCore] = useState<CoreResponse | null>(null);
  const [dayState, setDayState] = useState<DayStateResponse | null>(null);
  const [hasLocalSession, setHasLocalSession] = useState(false);
  const [operatorLink, setOperatorLink] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    let active = true;
    void Promise.all([
      api<CoreResponse>(`/api/admin/tournaments/${encodeURIComponent(tournamentId)}/core`),
      api<DayStateResponse>(`/api/admin/tournaments/${encodeURIComponent(tournamentId)}/day-state`),
      loadTournamentDaySession(`admin:${tournamentId}`),
    ])
      .then(([coreResult, stateResult, localSession]) => {
        if (!active) return;
        setCore(coreResult);
        setDayState(stateResult);
        setHasLocalSession(Boolean(localSession));
      })
      .catch((loadError) => {
        if (!active) return;
        setError(loadError instanceof Error ? loadError.message : "TOURNAMENT_HUB_LOAD_FAILED");
      });
    return () => {
      active = false;
    };
  }, [tournamentId]);

  const teamCount = useMemo(
    () => core?.categories.filter((category) => category.entryType === "team").length ?? 0,
    [core],
  );

  const createOperatorLink = async () => {
    setBusy("share");
    setError("");
    setNotice("");
    try {
      const result = await api<{ ok: true; token: string; path: string }>(
        `/api/admin/tournaments/${encodeURIComponent(tournamentId)}/day-access`,
        { method: "POST", body: "{}" },
      );
      const absolute = new URL(result.path, window.location.origin).toString();
      setOperatorLink(absolute);
      setDayState((current) =>
        current ? { ...current, hasOperatorAccess: true } : current,
      );
      try {
        await navigator.clipboard.writeText(absolute);
        setNotice(tr(locale, "Link de Tournament Day copiado.", "Tournament Day link copied."));
      } catch {
        setNotice(tr(locale, "Link generado. Copialo desde el campo.", "Link generated. Copy it from the field."));
      }
    } catch (shareError) {
      setError(shareError instanceof Error ? shareError.message : "TOURNAMENT_DAY_LINK_FAILED");
    } finally {
      setBusy("");
    }
  };

  const revokeOperatorLink = async () => {
    if (
      !window.confirm(
        tr(
          locale,
          "¿Revocar el acceso compartido a Tournament Day? El operador dejará de poder descargar o publicar checkpoints.",
          "Revoke the shared Tournament Day access? The operator will no longer be able to download or publish checkpoints.",
        ),
      )
    ) return;
    setBusy("revoke");
    setError("");
    try {
      await api(`/api/admin/tournaments/${encodeURIComponent(tournamentId)}/day-access`, {
        method: "DELETE",
      });
      setOperatorLink("");
      setDayState((current) =>
        current ? { ...current, hasOperatorAccess: false } : current,
      );
      setNotice(tr(locale, "Acceso revocado.", "Access revoked."));
    } catch (revokeError) {
      setError(revokeError instanceof Error ? revokeError.message : "TOURNAMENT_DAY_REVOKE_FAILED");
    } finally {
      setBusy("");
    }
  };

  if (!core) {
    return (
      <main className="td-hub">
        <div className="td-loading">{error || tr(locale, "Cargando torneo…", "Loading tournament…")}</div>
      </main>
    );
  }

  const tournament = core.tournament;
  const publishedCopy = dayState?.hasPublishedSnapshot
    ? dayState.syncStatus === "failed"
      ? tr(
          locale,
          `Checkpoint seguro · rev. ${dayState.publishedRevision} · sync D1 pendiente`,
          `Safe checkpoint · rev. ${dayState.publishedRevision} · D1 sync pending`,
        )
      : dayState.syncStatus === "synced"
        ? tr(
            locale,
            `Checkpoint + D1 sincronizados · rev. ${dayState.syncedRevision}${dayState.syncedAt ? ` · ${dateTime(dayState.syncedAt)}` : ""}`,
            `Checkpoint + D1 synced · rev. ${dayState.syncedRevision}${dayState.syncedAt ? ` · ${dateTime(dayState.syncedAt)}` : ""}`,
          )
        : tr(
            locale,
            `Checkpoint publicado · rev. ${dayState.publishedRevision}${dayState.publishedAt ? ` · ${dateTime(dayState.publishedAt)}` : ""}`,
            `Published checkpoint · rev. ${dayState.publishedRevision}${dayState.publishedAt ? ` · ${dateTime(dayState.publishedAt)}` : ""}`,
          )
    : tr(locale, "Todavía no hay checkpoint publicado.", "No checkpoint has been published yet.");

  return (
    <main className="td-hub">
      <button
        className="section-back"
        onClick={() => go(`/admin/organizations/${organizationId}/tournaments`)}
      >
        ← HUAU Tournament
      </button>

      <header className="td-hub-hero">
        <div>
          <div className="eyebrow">
            {tournament.sport.toUpperCase()} · {tournament.status.replaceAll("_", " ")}
          </div>
          <h1>{tournament.name}</h1>
          <p>
            {date(tournament.startAt)}
            {tournament.endAt ? ` → ${date(tournament.endAt)}` : ""} · {tournament.courtCount}{" "}
            {tr(locale, "canchas", "courts")}
          </p>
        </div>
        <div className="td-hub-hero-actions">
          <button className="ghost" onClick={() => go(`/tournaments/${tournament.slug}`)}>
            {tr(locale, "Página pública", "Public page")} ↗
          </button>
        </div>
      </header>

      {error ? <div className="tpw-alert">{error}</div> : null}
      {notice ? <div className="notice-box">{notice}</div> : null}

      <section className="td-hub-modes">
        <article className="td-mode-card">
          <div className="td-mode-icon">A</div>
          <div className="eyebrow">{tr(locale, "ONLINE", "ONLINE")}</div>
          <h2>{tr(locale, "Administración", "Administration")}</h2>
          <p>
            {tr(
              locale,
              "Inscripciones, participantes, pagos, categorías, formato y configuración pública. Esta zona usa el servidor porque recibe cambios externos.",
              "Registrations, participants, payments, categories, format and public settings. This area uses the server because it receives external changes.",
            )}
          </p>
          <div className="td-mode-kpis">
            <span><strong>{core.summary.playerCount}</strong>{tr(locale, "jugadores", "players")}</span>
            <span><strong>{core.categories.length}</strong>{tr(locale, "categorías", "categories")}</span>
            <span><strong>{teamCount}</strong>Team</span>
          </div>
          <button
            className="light full"
            onClick={() =>
              go(`/admin/organizations/${organizationId}/tournaments/${tournamentId}/manage`)
            }
          >
            {tr(locale, "Abrir administración", "Open administration")} →
          </button>
        </article>

        <article className="td-mode-card td-mode-day">
          <div className="td-mode-icon">D</div>
          <div className="eyebrow">LOCAL FIRST</div>
          <h2>Tournament Day</h2>
          <p>
            {tr(
              locale,
              "La jornada vive en este navegador. Resultados, lineups, tablas, cuadro, cronograma y TV no consultan D1 mientras operás.",
              "The event runs in this browser. Results, lineups, standings, bracket, schedule and TV do not query D1 while you operate.",
            )}
          </p>
          <div className="td-local-state">
            <span className={hasLocalSession ? "td-dot on" : "td-dot"} />
            <div>
              <strong>
                {hasLocalSession
                  ? tr(locale, "Sesión local disponible", "Local session available")
                  : tr(locale, "Sin sesión local", "No local session")}
              </strong>
              <small>{publishedCopy}</small>
            </div>
          </div>
          <button
            className="light full"
            onClick={() =>
              go(`/admin/organizations/${organizationId}/tournaments/${tournamentId}/day`)
            }
          >
            {hasLocalSession
              ? tr(locale, "Continuar Tournament Day", "Continue Tournament Day")
              : tr(locale, "Preparar Tournament Day", "Prepare Tournament Day")}{" "}
            →
          </button>
        </article>
      </section>

      <section className="td-share-panel">
        <div>
          <div className="eyebrow">{tr(locale, "ACCESO OPERADOR", "OPERATOR ACCESS")}</div>
          <h2>{tr(locale, "Compartir sólo Tournament Day", "Share Tournament Day only")}</h2>
          <p>
            {tr(
              locale,
              "El link no da acceso a pagos, organización ni otros torneos. Descarga el último checkpoint publicado y después trabaja localmente.",
              "The link does not grant access to payments, the organization or other tournaments. It downloads the latest published checkpoint and then works locally.",
            )}
          </p>
        </div>
        <div className="td-share-actions">
          {operatorLink ? (
            <div className="td-share-link">
              <input readOnly value={operatorLink} onFocus={(event: FocusEvent<HTMLInputElement>) => event.currentTarget.select()} />
              <button
                className="light small"
                onClick={() => void navigator.clipboard.writeText(operatorLink)}
              >
                {tr(locale, "Copiar", "Copy")}
              </button>
            </div>
          ) : null}
          <div className="form-actions">
            <button className="light small" disabled={Boolean(busy)} onClick={() => void createOperatorLink()}>
              {busy === "share"
                ? "…"
                : dayState?.hasOperatorAccess
                  ? tr(locale, "Regenerar link", "Regenerate link")
                  : tr(locale, "Generar link", "Generate link")}
            </button>
            {dayState?.hasOperatorAccess ? (
              <button className="ghost small" disabled={Boolean(busy)} onClick={() => void revokeOperatorLink()}>
                {busy === "revoke" ? "…" : tr(locale, "Revocar", "Revoke")}
              </button>
            ) : null}
          </div>
          <small className="muted">
            {dayState?.hasOperatorAccess
              ? tr(locale, "Hay un acceso compartido activo.", "A shared access is active.")
              : tr(locale, "No hay acceso compartido activo.", "No shared access is active.")}
          </small>
        </div>
      </section>
    </main>
  );
}
