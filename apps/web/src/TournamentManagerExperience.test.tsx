import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { TournamentManagerHome, TournamentManagerTrail } from "./TournamentManagerExperience";

const tournament = {
  name: "Copa de prueba", slug: "copa-prueba", sport: "pickleball", status: "scheduled",
  startAt: 1793491200, endAt: null, courtCount: 4, workingRevision: 3,
};
const noop = () => undefined;

describe("Unified Manager semantic rendering", () => {
  it("renders 7 real workflow stages, without old twin cards", () => {
    const html = renderToStaticMarkup(
      <TournamentManagerHome
        locale="es" go={noop} organizationId="org" tournamentId="tour"
        tournament={tournament} categoriesCount={3} playerCount={20}
        hasLocalSession={false} localStatus={null} localReadFailed={false}
        dayState={null} dayStateReadFailed={true}
        operatorLink="" busy="" error="" notice=""
        onCreateAccess={noop} onRevokeAccess={noop}
      />,
    );
    expect((html.match(/class="hm-stage"/g) ?? []).length).toBe(7);
    expect(html).toContain("Inscripciones y pagos");
    expect(html).toContain("No se pudo consultar");
    expect(html).not.toContain('class="td-hub-modes"');
    expect(html).not.toContain("Checkpoint seguro");
  });
  it("renders a consistent English trail with current step semantics", () => {
    const html = renderToStaticMarkup(
      <TournamentManagerTrail
        locale="en" organizationId="org" tournamentId="tour"
        area="day" currentStage="schedule" onLocalSection={noop} go={noop}
      />,
    );
    expect(html).toContain("Tournament stages");
    expect(html).toContain("Registration &amp; payments");
    expect(html).toContain('aria-current="step"');
    expect((html.match(/hm-trail-item/g) ?? []).length).toBe(7);
  });
});
