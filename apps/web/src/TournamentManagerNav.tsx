import type { Locale } from "./i18n";

export type ManagerArea = "admin" | "day";
export type ManagerSection =
  | "overview" | "settings" | "categories" | "participants" | "payments" | "recovery"
  | "format" | "competition" | "schedule" | "results" | "configuration";

type Link = {
  area: ManagerArea;
  section: ManagerSection;
  es: string;
  en: string;
  source: "online" | "local";
};

type Group = { es: string; en: string; items: readonly Link[] };

/** A single global tool navigation. It does not duplicate the legacy tab bars. */
export const MANAGER_MENU: readonly Group[] = [
  { es: "Torneo", en: "Tournament", items: [
    { area: "admin", section: "overview", es: "Resumen", en: "Overview", source: "online" },
    { area: "admin", section: "settings", es: "Información y reglas", en: "Information & rules", source: "online" },
    { area: "admin", section: "categories", es: "Categorías", en: "Categories", source: "online" },
  ] },
  { es: "Inscripciones", en: "Registration", items: [
    { area: "admin", section: "participants", es: "Participantes e inscripciones", en: "Players & registrations", source: "online" },
    { area: "admin", section: "payments", es: "Pagos y comprobantes", en: "Payments & proofs", source: "online" },
  ] },
  { es: "Preparación deportiva", en: "Competition preparation", items: [
    { area: "day", section: "overview", es: "Estado deportivo", en: "Competition overview", source: "local" },
    { area: "day", section: "participants", es: "Participantes locales", en: "Local participants", source: "local" },
    { area: "day", section: "format", es: "Formatos y sorteos", en: "Formats & draws", source: "local" },
    { area: "day", section: "competition", es: "Grupos y cuadros", en: "Groups & brackets", source: "local" },
  ] },
  { es: "Operación", en: "Operations", items: [
    { area: "day", section: "schedule", es: "Cronograma", en: "Schedule", source: "local" },
    { area: "day", section: "results", es: "Resultados", en: "Results", source: "local" },
    { area: "day", section: "configuration", es: "Publicación y cierre", en: "Publishing & closeout", source: "local" },
  ] },
  { es: "Herramientas", en: "Tools", items: [
    { area: "admin", section: "recovery", es: "Recuperación administrativa", en: "Admin recovery", source: "online" },
  ] },
];

export function managerUrl(organizationId: string, tournamentId: string, area: ManagerArea, section: ManagerSection): string {
  return `/admin/organizations/${encodeURIComponent(organizationId)}/tournaments/${encodeURIComponent(tournamentId)}/${area === "admin" ? "manage" : "day"}?section=${section}`;
}

export function parseManagerSection(search: string, area: ManagerArea): ManagerSection {
  const asked = new URLSearchParams(search).get("section");
  const allowed = MANAGER_MENU.flatMap((group) => group.items).filter((item) => item.area === area).map((item) => item.section);
  return asked && allowed.includes(asked as ManagerSection) ? asked as ManagerSection : "overview";
}

export function managerNavLabels(locale: Locale, area: ManagerArea, section: string): { title: string; source: string } {
  const item = MANAGER_MENU.flatMap((group) => group.items).find((x) => x.area === area && x.section === section);
  return {
    title: item ? locale === "es" ? item.es : item.en : locale === "es" ? "Resumen" : "Overview",
    source: area === "admin" ? (locale === "es" ? "Administración en línea" : "Online administration") : (locale === "es" ? "Sesión deportiva · este dispositivo" : "Competition session · this device"),
  };
}

export function TournamentManagerNav({
  locale, organizationId, tournamentId, area, active, onSelect, go,
}: {
  locale: Locale;
  organizationId: string;
  tournamentId: string;
  area: ManagerArea;
  active: string;
  onSelect: (section: ManagerSection) => void;
  go: (path: string) => void;
}) {
  const root = `/admin/organizations/${encodeURIComponent(organizationId)}/tournaments/${encodeURIComponent(tournamentId)}`;
  return <nav className="h3-menu" aria-label={locale === "es" ? "Navegación del torneo" : "Tournament navigation"}>
    <button type="button" className="h3-menu-home" onClick={() => go(root)}>{locale === "es" ? "← Centro del torneo" : "← Tournament home"}</button>
    {MANAGER_MENU.map((group, index) => <section key={group.es} className="h3-menu-group" aria-label={locale === "es" ? group.es : group.en}>
      <h2>{String(index + 1).padStart(2, "0")} / {locale === "es" ? group.es : group.en}</h2>
      {group.items.map((item) => {
        const selected = area === item.area && active === item.section;
        const switchTo = () => item.area === area
          ? onSelect(item.section)
          : go(managerUrl(organizationId, tournamentId, item.area, item.section));
        return <button key={`${item.area}:${item.section}`} type="button" className={`h3-menu-item${selected ? " is-active" : ""}`} aria-current={selected ? "page" : undefined} onClick={switchTo}>
          <span>{locale === "es" ? item.es : item.en}</span>
          <span className="h3-menu-source" aria-label={item.source === "local" ? "Local" : "Online"}>{item.source === "local" ? "○" : "•"}</span>
        </button>;
      })}
    </section>)}
    <button type="button" className="h3-menu-tv" onClick={() => window.open(`${root}/day?view=tv`, "_blank", "noopener")}>{locale === "es" ? "Abrir pantalla TV" : "Open TV display"} ↗</button>
    <p className="h3-menu-foot">{locale === "es" ? "• En línea  ·  ○ Este dispositivo" : "• Online  ·  ○ This device"}</p>
  </nav>;
}
