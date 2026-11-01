/** Tournament Manager navigation is UX only. It never mutates a tournament status or snapshot. */
export type ManagerStage = "setup" | "registration" | "preparation" | "schedule" | "publication" | "operations" | "close";
export type AdminSection = "overview" | "participants" | "categories" | "payments" | "settings" | "recovery";
export type DaySection = "overview" | "participants" | "format" | "competition" | "schedule" | "results" | "configuration";

export type StageDefinition = {
  id: ManagerStage;
  number: string;
  es: string;
  en: string;
  area: "admin" | "day";
  section: AdminSection | DaySection;
};

export const MANAGER_STAGES: readonly StageDefinition[] = [
  { id: "setup", number: "01", es: "Configuración", en: "Setup", area: "admin", section: "settings" },
  { id: "registration", number: "02", es: "Inscripciones y pagos", en: "Registration & payments", area: "admin", section: "participants" },
  { id: "preparation", number: "03", es: "Preparación deportiva", en: "Competition setup", area: "day", section: "format" },
  { id: "schedule", number: "04", es: "Cronograma", en: "Schedule", area: "day", section: "schedule" },
  { id: "publication", number: "05", es: "Publicación", en: "Publishing", area: "day", section: "configuration" },
  { id: "operations", number: "06", es: "Día del torneo", en: "Tournament day", area: "day", section: "results" },
  { id: "close", number: "07", es: "Cierre", en: "Closeout", area: "day", section: "configuration" },
] as const;

const ADMIN_SECTIONS: readonly AdminSection[] = ["overview", "participants", "categories", "payments", "settings", "recovery"];
const DAY_SECTIONS: readonly DaySection[] = ["overview", "participants", "format", "competition", "schedule", "results", "configuration"];

export function initialAdminSection(search: string): AdminSection {
  const selected = new URLSearchParams(search).get("section");
  return ADMIN_SECTIONS.find((section) => section === selected) ?? "overview";
}

export function initialDaySection(search: string): DaySection | "tv" {
  const params = new URLSearchParams(search);
  if (params.get("view") === "tv") return "tv";
  const selected = params.get("section");
  return DAY_SECTIONS.find((section) => section === selected) ?? "overview";
}

export function managerBase(organizationId: string, tournamentId: string) {
  return `/admin/organizations/${encodeURIComponent(organizationId)}/tournaments/${encodeURIComponent(tournamentId)}`;
}

export function stageHref(organizationId: string, tournamentId: string, stage: StageDefinition) {
  return `${managerBase(organizationId, tournamentId)}/${stage.area === "admin" ? "manage" : "day"}?section=${stage.section}`;
}

export function describeCheckpoint(
  state: { hasPublishedSnapshot: boolean; publishedRevision: number; syncStatus: string } | null,
  failed: boolean,
  locale: "es" | "en",
) {
  if (failed) return locale === "es" ? "No se pudo consultar" : "Unable to check";
  if (!state) return locale === "es" ? "Sin información remota" : "No remote information";
  if (!state.hasPublishedSnapshot) return locale === "es" ? "Sin checkpoint informado" : "No checkpoint reported";
  return `${locale === "es" ? "Revisión informada" : "Reported revision"} ${state.publishedRevision}${state.syncStatus === "failed" ? (locale === "es" ? " · sincronización fallida" : " · sync failed") : ""}`;
}
