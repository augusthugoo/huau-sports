import type { Locale } from "./i18n";
import {
  MANAGER_STAGES, describeCheckpoint, managerBase, stageHref,
} from "./TournamentManagerFlow";
import type { AdminSection, DaySection, ManagerStage } from "./TournamentManagerFlow";

const tr = (locale: Locale, es: string, en: string) => (locale === "es" ? es : en);

type Go = (path: string) => void;

type DayState = {
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

export type LocalManagerSummary = {
  dirty: boolean;
  updatedAt: number;
  structureRevision: number;
  liveRevision: number;
  structureDirty: number;
  liveDirty: number;
};

export function TournamentManagerTrail({
  locale, organizationId, tournamentId, area, currentStage, onLocalSection, go,
}: {
  locale: Locale;
  organizationId: string;
  tournamentId: string;
  area: "admin" | "day";
  currentStage: ManagerStage;
  onLocalSection: (section: AdminSection | DaySection) => void;
  go: Go;
}) {
  return (
    <nav className="hm-trail" aria-label={tr(locale, "Etapas del torneo", "Tournament stages")}>
      {MANAGER_STAGES.map((stage) => (
        <button
          key={stage.id}
          type="button"
          className={`hm-trail-item${stage.id === currentStage ? " is-current" : ""}`}
          aria-current={stage.id === currentStage ? "step" : undefined}
          onClick={() => stage.area === area ? onLocalSection(stage.section) : go(stageHref(organizationId, tournamentId, stage))}
        >
          <span className="hm-trail-number">{stage.number}</span>
          <span>{locale === "es" ? stage.es : stage.en}</span>
        </button>
      ))}
    </nav>
  );
}

export function TournamentManagerHome({
  locale, go, organizationId, tournamentId, tournament, categoriesCount, playerCount,
  hasLocalSession, localStatus, localReadFailed, dayState, dayStateReadFailed,
  operatorLink, busy, error, notice, onCreateAccess, onRevokeAccess,
}: {
  locale: Locale;
  go: Go;
  organizationId: string;
  tournamentId: string;
  tournament: { name: string; slug: string; sport: string; status: string; startAt: number; endAt: number | null; courtCount: number; workingRevision: number };
  categoriesCount: number;
  playerCount: number;
  hasLocalSession: boolean;
  localStatus: LocalManagerSummary | null;
  localReadFailed: boolean;
  dayState: DayState | null;
  dayStateReadFailed: boolean;
  operatorLink: string;
  busy: string;
  error: string;
  notice: string;
  onCreateAccess: () => void;
  onRevokeAccess: () => void;
}) {
  const base = managerBase(organizationId, tournamentId);
  const formatDate = (stamp: number) => new Intl.DateTimeFormat(locale === "es" ? "es-UY" : "en-US", { dateStyle: "medium" }).format(new Date(stamp < 10_000_000_000 ? stamp * 1000 : stamp));
  const localDate = localStatus ? new Intl.DateTimeFormat(locale === "es" ? "es-UY" : "en-US", { dateStyle: "short", timeStyle: "short" }).format(new Date(localStatus.updatedAt)) : null;
  return (
    <main className="hm-home" aria-labelledby="hm-tournament-title">
      <div className="hm-shell">
        <div className="hm-breadcrumb">
          <button type="button" onClick={() => go(`/admin/organizations/${encodeURIComponent(organizationId)}/tournaments`)}>
            {tr(locale, "Organización", "Organization")}
          </button>
          <span aria-hidden="true">/</span>
          <span>Tournament Manager</span>
        </div>
        <header className="hm-hero">
          <div className="hm-hero-copy">
            <p className="hm-kicker">HUAU / TOURNAMENT MANAGER</p>
            <h1 id="hm-tournament-title">{tournament.name}<span className="hm-heading-dot">.</span></h1>
            <p className="hm-hero-meta">
              {tournament.sport} <span aria-hidden="true">·</span> {formatDate(tournament.startAt)}
              {tournament.endAt && tournament.endAt !== tournament.startAt ? ` — ${formatDate(tournament.endAt)}` : ""}
              <span aria-hidden="true">·</span> {tournament.courtCount} {tr(locale, "canchas", "courts")}
            </p>
          </div>
          <a className="hm-outline-link" href={`/tournaments/${encodeURIComponent(tournament.slug)}`} target="_blank" rel="noopener noreferrer">
            {tr(locale, "Ver página pública", "View public page")} <span aria-hidden="true">↗</span>
          </a>
        </header>

        <div className="hm-section-head">
          <p className="hm-kicker">01 / {tr(locale, "RECORRIDO", "WORKFLOW")}</p>
          <p>{tr(locale, "Una secuencia para gestionar todo el torneo. Cada paso abre las herramientas existentes.", "One workflow for the entire event. Every step opens the existing tools.")}</p>
        </div>
        <nav className="hm-stage-grid" aria-label={tr(locale, "Accesos del torneo", "Tournament navigation")}>
          {MANAGER_STAGES.map((stage) => (
            <button key={stage.id} type="button" className="hm-stage" onClick={() => go(stageHref(organizationId, tournamentId, stage))}>
              <span className="hm-stage-index">{stage.number} <span aria-hidden="true">↗</span></span>
              <strong>{locale === "es" ? stage.es : stage.en}</strong>
              <small>{stage.area === "admin" ? "D1 / Online" : "IndexedDB / Local"}</small>
            </button>
          ))}
        </nav>

        <section className="hm-workspace" aria-labelledby="hm-workspace-title">
          <div className="hm-workspace-intro">
            <p className="hm-kicker">02 / {tr(locale, "ESPACIO DE TRABAJO", "WORKSPACE")}</p>
            <h2 id="hm-workspace-title">{tr(locale, "Preparar. Operar. Publicar.", "Prepare. Operate. Publish.")}</h2>
            <p>{tr(locale, "Los datos administrativos se consultan en línea. La competición se trabaja en este dispositivo y se publica cuando vos lo decidís.", "Administration is online. Competition runs on this device and is published only when you decide.")}</p>
            <div className="hm-workspace-actions">
              <button className="hm-primary" onClick={() => go(`${base}/day?section=results`)}>{tr(locale, "Ir a resultados", "Go to results")} <span aria-hidden="true">↗</span></button>
              <button className="hm-secondary" onClick={() => go(`${base}/manage?section=participants`)}>{tr(locale, "Ver inscripciones", "View registrations")}</button>
              <button className="hm-text-link" onClick={() => go(`${base}/day?view=tv`)}>{tr(locale, "Abrir TV", "Open TV")} ↗</button>
            </div>
          </div>
          <div className="hm-figures" aria-label={tr(locale, "Resumen administrativo", "Administrative summary")}>
            <div><strong>{playerCount}</strong><span>{tr(locale, "Jugadores", "Players")}</span></div>
            <div><strong>{categoriesCount}</strong><span>{tr(locale, "Categorías", "Categories")}</span></div>
            <div><strong>{tournament.workingRevision}</strong><span>{tr(locale, "Revisión administrativa", "Admin revision")}</span></div>
          </div>
        </section>

        <section className="hm-sync" aria-labelledby="hm-sync-title">
          <div className="hm-section-head">
            <p className="hm-kicker">03 / {tr(locale, "ESTADO Y PUBLICACIÓN", "STATUS & PUBLISHING")}</p>
            <h2 id="hm-sync-title">{tr(locale, "Qué está guardado. Qué pueden ver.", "What's saved. What's visible.")}</h2>
          </div>
          <div className="hm-sync-list">
            <div><span>{tr(locale, "Este dispositivo", "This device")}</span><strong>{localReadFailed ? tr(locale, "No se pudo consultar", "Unable to check") : !hasLocalSession ? tr(locale, "Sin sesión local", "No local session") : localStatus?.dirty ? tr(locale, "Cambios locales pendientes", "Pending local changes") : tr(locale, "Sesión local disponible", "Local session available")}</strong><small>{localDate ? `${tr(locale, "Último guardado", "Last saved")}: ${localDate}` : tr(locale, "No se consultan resultados en D1 al abrir esta página.", "Results are not fetched from D1 on this page.")}</small></div>
            <div><span>{tr(locale, "Checkpoint deportivo", "Competition checkpoint")}</span><strong>{describeCheckpoint(dayState, dayStateReadFailed, locale)}</strong><small>{tr(locale, "Dato informado por D1; existencia del objeto R2 no comprobada aquí.", "Reported by D1; R2 object existence is not checked here.")}</small></div>
            <div><span>{tr(locale, "Estructura y resultados públicos", "Public structure & results")}</span><strong>{localStatus ? `${tr(locale, "Registros locales", "Local records")}: ${localStatus.structureRevision} / ${localStatus.liveRevision}` : tr(locale, "Sin registro local", "No local record")}</strong><small>{tr(locale, "No se afirma publicación remota desde los contadores locales.", "Local counters do not verify remote publication.")}</small></div>
          </div>
        </section>

        <details className="hm-operator">
          <summary><span><strong>{tr(locale, "Acceso operativo compartido", "Shared operator access")}</strong><small>{tr(locale, "Administrar enlace temporal de Tournament Day", "Manage a Tournament Day operator link")}</small></span><span aria-hidden="true">+</span></summary>
          <div className="hm-operator-body">
            <p>{tr(locale, "El enlace actual permite operar Tournament Day; no concede acceso a pagos ni a la organización. Es un acceso por token, no la futura cuenta limitada por correo.", "The current link operates Tournament Day, not payments or organization administration. It is token access, not the future limited email account.")}</p>
            {operatorLink ? <label className="hm-operator-label">{tr(locale, "Enlace generado", "Generated link")}<input readOnly value={operatorLink} onFocus={(event) => event.currentTarget.select()} /></label> : null}
            <div className="hm-operator-buttons">
              <button disabled={Boolean(busy)} onClick={onCreateAccess}>{busy === "share" ? "…" : dayState?.hasOperatorAccess ? tr(locale, "Regenerar enlace", "Regenerate link") : tr(locale, "Generar enlace", "Generate link")}</button>
              {dayState?.hasOperatorAccess ? <button disabled={Boolean(busy)} onClick={onRevokeAccess}>{tr(locale, "Revocar acceso", "Revoke access")}</button> : null}
            </div>
            <small>{dayStateReadFailed ? tr(locale, "Estado remoto no disponible", "Remote status unavailable") : dayState?.hasOperatorAccess ? tr(locale, "Acceso compartido informado como activo", "Shared access reported as active") : tr(locale, "No se informó acceso compartido activo", "No active shared access reported")}</small>
          </div>
        </details>
        {error ? <p className="hm-alert" role="alert">{error}</p> : null}
        {notice ? <p className="hm-notice" role="status">{notice}</p> : null}
      </div>
    </main>
  );
}
