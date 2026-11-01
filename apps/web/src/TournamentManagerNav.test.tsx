import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MANAGER_MENU, managerUrl, parseManagerSection, TournamentManagerNav } from "./TournamentManagerNav";

describe("HUAU v3: one navigation and real functional routes", () => {
  it("has unique area + section and no fake separate close/publication routes", () => {
    const all = MANAGER_MENU.flatMap((x) => x.items);
    expect(new Set(all.map((x) => `${x.area}:${x.section}`)).size).toBe(all.length);
    expect(all.find((x) => x.area === "day" && x.section === "configuration")?.es).toBe("Publicación y cierre");
    expect(all.some((x) => ["close", "publication"].includes(x.section))).toBe(false);
  });
  it("preserves all admin and day tabs as one grouped menu", () => {
    const items = MANAGER_MENU.flatMap((group) => group.items);
    for (const tab of ["overview", "settings", "categories", "participants", "payments", "recovery"]) {
      expect(items.some((item) => item.area === "admin" && item.section === tab)).toBe(true);
    }
    for (const tab of ["overview", "participants", "format", "competition", "schedule", "results", "configuration"]) {
      expect(items.some((item) => item.area === "day" && item.section === tab)).toBe(true);
    }
  });
  it("creates encoded, distinct deep links and rejects unknown sections", () => {
    expect(managerUrl("org 1", "tour/id", "day", "results")).toBe("/admin/organizations/org%201/tournaments/tour%2Fid/day?section=results");
    expect(managerUrl("org", "tour", "admin", "payments")).toContain("/manage?section=payments");
    expect(parseManagerSection("?section=payments", "day")).toBe("overview");
    expect(parseManagerSection("?section=results", "day")).toBe("results");
  });
  it("renders one nav with one active item and bilingual text", () => {
    const common = { organizationId: "org", tournamentId: "tid", go: () => undefined, onSelect: () => undefined };
    const es = renderToStaticMarkup(<TournamentManagerNav {...common} area="admin" active="payments" locale="es" />);
    const en = renderToStaticMarkup(<TournamentManagerNav {...common} area="day" active="results" locale="en" />);
    expect((es.match(/<nav\b/g) || []).length).toBe(1);
    expect((es.match(/aria-current="page"/g) || []).length).toBe(1);
    expect((en.match(/aria-current="page"/g) || []).length).toBe(1);
    expect(es).toContain("Pagos y comprobantes");
    expect(en).toContain("Payments &amp; proofs");
    expect(en).toContain("Open TV display");
  });
});
