import type { Locale } from "./i18n";
import { managerUrl } from "./TournamentManagerNav";

const tr = (locale: Locale, es: string, en: string) => locale === "es" ? es : en;
type Go = (path: string) => void;
type DayState = { hasOperatorAccess: boolean; hasPublishedSnapshot: boolean; publishedRevision: number; publishedAt: number | null; finalizedAt: number | null; syncStatus: "idle" | "syncing" | "synced" | "failed"; syncedRevision: number; syncedAt: number | null; syncError: string | null };
export type LocalManagerSummary = { dirty: boolean; updatedAt: number; structureRevision: number; liveRevision: number; structureDirty: number; liveDirty: number };

export function TournamentManagerHome({
  locale, go, organizationId, tournamentId, tournament, categoriesCount, playerCount, hasLocalSession,
  localStatus, localReadFailed, dayState, dayStateReadFailed, operatorLink, busy, error, notice, onCreateAccess, onRevokeAccess,
}: {
  locale: Locale; go: Go; organizationId: string; tournamentId: string;
  tournament: { name: string; slug: string; sport: string; status: string; startAt: number; endAt: number | null; courtCount: number; workingRevision: number };
  categoriesCount: number; playerCount: number; hasLocalSession: boolean; localStatus: LocalManagerSummary | null; localReadFailed: boolean;
  dayState: DayState | null; dayStateReadFailed: boolean; operatorLink: string; busy: string; error: string; notice: string;
  onCreateAccess: () => void; onRevokeAccess: () => void;
}) {
  const url = (area: "admin" | "day", section: "overview" | "settings" | "categories" | "participants" | "payments" | "format" | "competition" | "schedule" | "results" | "configuration") => managerUrl(organizationId, tournamentId, area, section);
  const fmtDate = (value: number) => new Intl.DateTimeFormat(locale === "es" ? "es-UY" : "en-US", { day: "numeric", month: "short", year: "numeric" }).format(new Date(value < 10_000_000_000 ? value * 1000 : value));
  const checkpoint = dayStateReadFailed ? tr(locale, "No se pudo consultar", "Unable to check")
    : !dayState?.hasPublishedSnapshot ? tr(locale, "Sin checkpoint confirmado", "No confirmed checkpoint")
    : `${tr(locale, "Revisión informada", "Reported revision")} ${dayState.publishedRevision}${dayState.syncStatus === "failed" ? tr(locale, " · sincronización fallida", " · sync failed") : ""}`;
  return <main className="h3-home">
    <div className="h3-container">
      <button className="h3-back" type="button" onClick={() => go(`/admin/organizations/${encodeURIComponent(organizationId)}/tournaments`)}>{tr(locale, "← Torneos de la organización", "← Organization tournaments")}</button>
      <div className="h3-hero">
        <div>
          <p className="h3-eyebrow">HUAU / TOURNAMENT MANAGER</p>
          <h1>{tournament.name}<span className="h3-dot">.</span></h1>
          <p className="h3-hero-meta">{tournament.sport} <span>·</span> {fmtDate(tournament.startAt)} {tournament.endAt && tournament.endAt !== tournament.startAt ? `– ${fmtDate(tournament.endAt)}` : ""} <span>·</span> {tournament.courtCount} {tr(locale, "canchas", "courts")}</p>
        </div>
        <a className="h3-link-outline" href={`/tournaments/${encodeURIComponent(tournament.slug)}`} target="_blank" rel="noopener noreferrer">{tr(locale, "Página pública", "Public page")} ↗</a>
      </div>
      <div className="h3-intro"><h2>{tr(locale, "Un torneo. Un lugar para gestionarlo.", "One tournament. One place to run it.")}</h2><p>{tr(locale, "Entrá directamente a la tarea que necesitás. Los cambios deportivos se guardan en este dispositivo; la información pública se publica por separado.", "Go straight to the work you need. Competition changes are saved on this device; public information is published separately.")}</p></div>
      <section className="h3-module-grid" aria-label={tr(locale,"Áreas del torneo","Tournament areas")}>
        <article className="h3-module"><span className="h3-module-number">01 / {tr(locale,"INFORMACIÓN","INFORMATION")}</span><h3>{tr(locale,"Preparar el evento", "Set up the event")}</h3><p>{tr(locale,"Datos, reglas, precios y categorías de inscripción.","Details, rules, prices and registration categories.")}</p><div className="h3-module-links"><button onClick={() => go(url("admin","settings"))}>{tr(locale,"Información y reglas","Information & rules")} <span>↗</span></button><button onClick={() => go(url("admin","categories"))}>{tr(locale,"Categorías","Categories")} <span>↗</span></button></div></article>
        <article className="h3-module"><span className="h3-module-number">02 / {tr(locale,"INSCRIPCIONES","REGISTRATION")}</span><h3>{tr(locale,"Jugadores y pagos", "Players & payments")}</h3><p>{tr(locale,"Consultar inscripciones y revisar comprobantes bajo demanda.","Review registrations and payment proofs on demand.")}</p><div className="h3-module-links"><button onClick={() => go(url("admin","participants"))}>{tr(locale,"Participantes","Participants")} <span>↗</span></button><button onClick={() => go(url("admin","payments"))}>{tr(locale,"Pagos y comprobantes","Payments & proofs")} <span>↗</span></button></div></article>
        <article className="h3-module"><span className="h3-module-number">03 / {tr(locale,"PREPARACIÓN","PREPARATION")}</span><h3>{tr(locale,"Diseñar la competencia", "Plan competition")}</h3><p>{tr(locale,"Standard, Team, sorteos, grupos y programación sin perder opciones avanzadas.","Standard, Team, draws, groups and scheduling without losing advanced controls.")}</p><div className="h3-module-links"><button onClick={() => go(url("day","format"))}>{tr(locale,"Formatos","Formats")} <span>↗</span></button><button onClick={() => go(url("day","schedule"))}>{tr(locale,"Cronograma","Schedule")} <span>↗</span></button></div></article>
        <article className="h3-module h3-module-featured"><span className="h3-module-number">04 / {tr(locale,"JORNADA","EVENT DAY")}</span><h3>{tr(locale,"Operar y publicar", "Operate & publish")}</h3><p>{tr(locale,"Resultados, grupos, TV y publicaciones independientes.","Results, brackets, TV and independent publishing controls.")}</p><div className="h3-module-links"><button onClick={() => go(url("day","results"))}>{tr(locale,"Cargar resultados","Enter results")} <span>↗</span></button><button onClick={() => go(url("day","configuration"))}>{tr(locale,"Publicar y cerrar","Publish & close")} <span>↗</span></button></div></article>
      </section>
      <section className="h3-status" aria-label={tr(locale,"Estado de guardado y publicación","Save and publishing status")}>
        <div className="h3-section-title"><h2>{tr(locale,"Estado del torneo", "Tournament status")}</h2><p>{tr(locale,"No confundimos lo guardado aquí con lo que ya pueden ver los jugadores.","Local saves and publicly visible information are different.")}</p></div>
        <div className="h3-status-list">
          <div><span>{tr(locale,"Administración","Administration")}</span><strong>{playerCount} {tr(locale,"jugadores","players")} · {categoriesCount} {tr(locale,"categorías","categories")}</strong><small>{tr(locale,"Datos del servidor, rev.","Server data, rev.")} {tournament.workingRevision}</small></div>
          <div><span>{tr(locale,"Este dispositivo","This device")}</span><strong>{localReadFailed ? tr(locale,"No se pudo consultar","Unable to check") : !hasLocalSession ? tr(locale,"Sin sesión local","No local session") : localStatus?.dirty ? tr(locale,"Cambios locales sin publicar","Unpublished local changes") : tr(locale,"Sesión local disponible","Local session available")}</strong><small>{localStatus?.updatedAt ? `${tr(locale,"Guardado local","Local save")}: ${new Intl.DateTimeFormat(locale === "es" ? "es-UY" : "en-US", {dateStyle:"short",timeStyle:"short"}).format(new Date(localStatus.updatedAt))}` : tr(locale,"No significa publicado","Not necessarily published")}</small></div>
          <div><span>{tr(locale,"Checkpoint deportivo","Competition checkpoint")}</span><strong>{checkpoint}</strong><small>{tr(locale,"Estado informado por D1; objeto R2 no verificado aquí","Reported by D1; R2 object not checked here")}</small></div>
        </div>
        <p className="h3-status-note">{tr(locale,"Estructura pública y resultados públicos se publican de forma independiente desde Publicación y cierre.","Public structure and live results are published separately from Publish & closeout.")}</p>
      </section>
      <details className="h3-operator"><summary>{tr(locale,"Acceso operativo compartido", "Shared operator access")} <span>+</span></summary>
        <div className="h3-operator-content"><p>{tr(locale,"Este enlace da acceso a la operación de Tournament Day. No habilita pagos ni equivale a la futura cuenta limitada del organizador.","This link grants Tournament Day operation, not payment access or a future organizer account.")}</p>
          {operatorLink ? <label>{tr(locale,"Enlace generado","Generated link")}<input readOnly value={operatorLink} onFocus={(e) => e.currentTarget.select()} /></label> : null}
          <div className="h3-operator-actions"><button onClick={onCreateAccess} disabled={Boolean(busy)}>{busy === "share" ? "…" : dayState?.hasOperatorAccess ? tr(locale,"Regenerar enlace","Regenerate link") : tr(locale,"Generar enlace","Generate link")}</button>{dayState?.hasOperatorAccess ? <button disabled={Boolean(busy)} onClick={onRevokeAccess}>{tr(locale,"Revocar acceso","Revoke access")}</button> : null}</div>
        </div>
      </details>
      {error ? <p role="alert" className="h3-error">{error}</p> : null}{notice ? <p role="status" className="h3-notice">{notice}</p> : null}
    </div>
  </main>;
}
