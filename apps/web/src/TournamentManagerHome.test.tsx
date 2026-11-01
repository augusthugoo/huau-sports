import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { TournamentManagerHome } from "./TournamentManagerHome";

const fixture = {
  locale: "es" as const, go: () => undefined, organizationId: "org", tournamentId: "t",
  tournament: { name: "Torneo QA", slug: "qa", sport: "pickleball", status: "scheduled", startAt: 1790000000, endAt: null, courtCount: 4, workingRevision: 4 },
  categoriesCount: 5, playerCount: 34, hasLocalSession: true, localStatus: { dirty: true, updatedAt: 1790000000 * 1000, structureRevision: 2, liveRevision: 3, structureDirty: 1, liveDirty: 1 },
  localReadFailed: false, dayState: { hasOperatorAccess: false, hasPublishedSnapshot: false, publishedRevision: 0, publishedAt: null, finalizedAt: null, syncStatus: "idle" as const, syncedRevision: 0, syncedAt: null, syncError: null }, dayStateReadFailed: false,
  operatorLink: "", busy: "", error: "", notice: "", onCreateAccess: () => undefined, onRevokeAccess: () => undefined,
};

describe("HUAU v3: editorial home without duplicate navigation", () => {
  it("keeps local edits different from remote publication", () => {
    const markup = renderToStaticMarkup(<TournamentManagerHome {...fixture} />);
    expect(markup).toContain("Cambios locales sin publicar");
    expect(markup).toContain("Sin checkpoint confirmado");
    expect(markup).not.toContain("Checkpoint publicado");
  });
  it("does not render a second toolbar and uses clear task cards", () => {
    const markup = renderToStaticMarkup(<TournamentManagerHome {...fixture} />);
    expect((markup.match(/<nav\b/g) || []).length).toBe(0);
    expect((markup.match(/class="h3-module(?: h3-module-featured)?"/g) || []).length).toBe(4);
    expect(markup).toContain("Publicar y cerrar");
    expect(markup).toContain("Pagos y comprobantes");
  });
  it("keeps the token access copy explicit about its limitations", () => {
    const markup = renderToStaticMarkup(<TournamentManagerHome {...fixture} />);
    expect(markup).toContain("No habilita pagos");
  });
});
