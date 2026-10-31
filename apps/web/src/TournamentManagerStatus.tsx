import type { Locale } from "./i18n";

export type LocalManagerStatus = {
  dirty: boolean;
  updatedAt: number | null;
  publicDirty: {
    structure: number;
    live: number;
    structureRevision: number;
    liveRevision: number;
    lastStructurePublishedAt: number | null;
    lastLivePublishedAt: number | null;
  } | null;
};

type DayRemoteStatus = {
  hasPublishedSnapshot: boolean;
  publishedRevision: number;
  syncStatus: "idle" | "syncing" | "synced" | "failed";
  finalizedAt: number | null;
};

type Props = {
  organizationId: string;
  tournamentId: string;
  slug: string;
  locale: Locale;
  go: (path: string) => void;
  local: LocalManagerStatus | null;
  localReadFailed: boolean;
  remote: DayRemoteStatus | null;
  remoteReadFailed: boolean;
};

function record(input: unknown): Record<string, unknown> | null {
  return input !== null && typeof input === "object" && !Array.isArray(input)
    ? input as Record<string, unknown>
    : null;
}

function nonnegative(input: unknown): number {
  return typeof input === "number" && Number.isFinite(input) && input >= 0
    ? Math.trunc(input)
    : 0;
}

function timestamp(input: unknown): number | null {
  return typeof input === "number" && Number.isFinite(input) && input > 0 ? input : null;
}

// Solo lee los metadatos de la sesión; nunca inicializa ni modifica el snapshot.
export function summarizeTournamentDaySession(session: unknown): LocalManagerStatus | null {
  const source = record(session);
  if (!source) return null;
  const snapshot = record(source.snapshot);
  const metadata = record(snapshot?.localMeta);
  const dirty = record(metadata?.publicDirty);
  return {
    dirty: source.dirty === true,
    updatedAt: timestamp(source.updatedAt),
    publicDirty: dirty ? {
      structure: nonnegative(dirty.structure),
      live: nonnegative(dirty.live),
      structureRevision: nonnegative(dirty.structureRevision),
      liveRevision: nonnegative(dirty.liveRevision),
      lastStructurePublishedAt: timestamp(dirty.lastStructurePublishedAt),
      lastLivePublishedAt: timestamp(dirty.lastLivePublishedAt),
    } : null,
  };
}

export function projectTournamentManagerStatus(
  local: LocalManagerStatus | null,
  remote: DayRemoteStatus | null,
  localReadFailed = false,
  remoteReadFailed = false,
) {
  return {
    local: localReadFailed ? "unknown" : !local ? "absent" : local.dirty ? "dirty" : "saved",
    checkpoint: remoteReadFailed || !remote ? "unknown"
      : remote.hasPublishedSnapshot ? "reported" : "not-recorded",
    revision: remote?.hasPublishedSnapshot && !remoteReadFailed
      ? nonnegative(remote.publishedRevision) : null,
    sync: remoteReadFailed || !remote ? "unknown" : remote.syncStatus,
    structure: localReadFailed || !local ? null : local.publicDirty ? {
      revision: local.publicDirty.lastStructurePublishedAt !== null
        ? local.publicDirty.structureRevision : null,
      dirty: local.publicDirty.structure > 0,
    } : null,
    live: localReadFailed || !local ? null : local.publicDirty ? {
      revision: local.publicDirty.lastLivePublishedAt !== null
        ? local.publicDirty.liveRevision : null,
      dirty: local.publicDirty.live > 0,
    } : null,
  } as const;
}

const tr = (locale: Locale, es: string, en: string) => locale === "es" ? es : en;

export function tournamentManagerPaths(organizationId: string, tournamentId: string, slug: string) {
  const root = `/admin/organizations/${encodeURIComponent(organizationId)}/tournaments/${encodeURIComponent(tournamentId)}`;
  return { admin: `${root}/manage`, day: `${root}/day`, tv: `${root}/day?view=tv`,
    public: `/tournaments/${encodeURIComponent(slug)}` };
}

export function TournamentManagerStatus(props: Props) {
  const { organizationId, tournamentId, slug, locale, go, local, remote } = props;
  const status = projectTournamentManagerStatus(local, remote, props.localReadFailed, props.remoteReadFailed);
  const paths = tournamentManagerPaths(organizationId, tournamentId, slug);
  const adminPath = paths.admin;
  const dayPath = paths.day;
  const steps = [
    { es: "Configuración", en: "Setup", path: adminPath },
    { es: "Inscripciones y pagos", en: "Registration & payments", path: adminPath },
    { es: "Preparación deportiva", en: "Competition setup", path: dayPath },
    { es: "Cronograma", en: "Schedule", path: dayPath },
    { es: "Publicación", en: "Publishing", path: dayPath },
    { es: "Día del torneo", en: "Tournament day", path: dayPath },
    { es: "Cierre", en: "Closeout", path: dayPath },
  ];
  const recommendation = status.local === "unknown"
    ? tr(locale, "Revisar la sesión local", "Check local session")
    : status.local === "absent"
      ? status.checkpoint === "reported"
        ? tr(locale, "Recuperar checkpoint", "Recover checkpoint")
        : tr(locale, "Preparar competición", "Prepare competition")
      : status.local === "dirty"
        ? tr(locale, "Revisar cambios locales", "Review local changes")
        : tr(locale, "Continuar el torneo", "Continue tournament");
  const when = local?.updatedAt && !props.localReadFailed
    ? new Intl.DateTimeFormat(locale === "es" ? "es-UY" : "en-US", {
      dateStyle: "short", timeStyle: "short",
    }).format(new Date(local.updatedAt))
    : null;

  const publicText = (kind: "structure" | "live") => {
    const detail = status[kind];
    if (!detail) return tr(locale, "Estado remoto no comprobado", "Remote status not verified");
    if (detail.revision === null) return tr(locale, "Sin constancia en esta sesión", "No record in this session");
    const revision = `${tr(locale, "Registro local", "Local record")} · rev. ${detail.revision}`;
    return detail.dirty ? `${revision} · ${tr(locale, "hay cambios", "changes pending")}` : revision;
  };

  return (
    <section className="tm-status" aria-label={tr(locale, "Centro del torneo", "Tournament control center")}>
      <div className="tm-status-lead">
        <div>
          <p className="tm-status-kicker">TOURNAMENT MANAGER</p>
          <h2>{tr(locale, "Centro de control", "Control center")}</h2>
          <p className="tm-status-suggestion">
            {tr(locale, "Orientación sugerida", "Suggested next step")}: <strong>{recommendation}</strong>
            <span> · {tr(locale, "No cambia el estado del torneo", "Does not change tournament status")}</span>
          </p>
        </div>
        <div className="tm-status-actions">
          <button type="button" onClick={() => go(adminPath)}>{tr(locale, "Administración", "Administration")}</button>
          <button type="button" onClick={() => go(dayPath)}>{tr(locale, "Tournament Day", "Tournament Day")}</button>
          <button type="button" onClick={() => go(paths.tv)}>TV</button>
          <button type="button" onClick={() => go(paths.public)}>{tr(locale, "Página pública", "Public page")}</button>
        </div>
      </div>
      <nav aria-label={tr(locale, "Etapas del torneo", "Tournament stages")} className="tm-status-stages">
        {steps.map((step, index) => (
          <button key={index} type="button" onClick={() => go(step.path)}>
            <span className="tm-status-stage-number">{index + 1}</span>
            {tr(locale, step.es, step.en)}
          </button>
        ))}
      </nav>
      <div className="tm-status-cards">
        <div className="tm-status-card">
          <span>{tr(locale, "Sesión de este navegador", "This browser's session")}</span>
          <strong>{status.local === "unknown" ? tr(locale, "No se pudo comprobar", "Unable to check")
            : status.local === "absent" ? tr(locale, "Sin sesión local", "No local session")
            : status.local === "dirty" ? tr(locale, "Cambios sin publicar", "Unpublished changes")
            : tr(locale, "Sesión guardada", "Session saved")}</strong>
          <small>{when ? `${tr(locale, "Último guardado · hora del dispositivo", "Last saved · device time")}: ${when}` : tr(locale, "Sin hora de guardado disponible", "Save time unavailable")}</small>
        </div>
        <div className="tm-status-card">
          <span>{tr(locale, "Checkpoint deportivo", "Competition checkpoint")}</span>
          <strong>{status.checkpoint === "unknown" ? tr(locale, "Estado no disponible", "Status unavailable")
            : status.checkpoint === "not-recorded" ? tr(locale, "Sin registro D1", "No D1 record")
            : `${tr(locale, "D1 informa revisión", "D1 reports revision")} ${status.revision}`}</strong>
          <small>{status.sync === "failed" ? tr(locale, "Sincronización D1 fallida; revisar", "D1 sync failed; review")
            : tr(locale, "Objeto R2 no verificado desde esta pantalla", "R2 object not verified on this screen")}</small>
        </div>
        <div className="tm-status-card">
          <span>{tr(locale, "Estructura pública", "Public structure")}</span>
          <strong>{publicText("structure")}</strong>
          <small>{tr(locale, "Publicación R2 no verificada", "R2 publication not verified")}</small>
        </div>
        <div className="tm-status-card">
          <span>{tr(locale, "Resultados públicos", "Public results")}</span>
          <strong>{publicText("live")}</strong>
          <small>{tr(locale, "Publicación R2 no verificada", "R2 publication not verified")}</small>
        </div>
      </div>
    </section>
  );
}
