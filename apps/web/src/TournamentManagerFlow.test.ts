import { describe, expect, it } from "vitest";
import { MANAGER_STAGES, describeCheckpoint, initialAdminSection, initialDaySection, managerBase, stageHref } from "./TournamentManagerFlow";

describe("Tournament Manager navigation contracts", () => {
  it("keeps exactly seven UX stages without status mutations", () => {
    expect(MANAGER_STAGES.map((stage) => stage.number)).toEqual(["01", "02", "03", "04", "05", "06", "07"]);
    expect(new Set(MANAGER_STAGES.map((stage) => stage.id)).size).toBe(7);
    expect(MANAGER_STAGES.every((stage) => Boolean(stage.es && stage.en))).toBe(true);
  });
  it("opens each stage on a real existing workspace", () => {
    for (const stage of MANAGER_STAGES) {
      const href = stageHref("org 1", "tour/id", stage);
      expect(href).toContain("/admin/organizations/org%201/tournaments/tour%2Fid/");
      expect(href).toContain(stage.area === "admin" ? "/manage?" : "/day?");
      expect(href.endsWith(`section=${stage.section}`)).toBe(true);
    }
  });
  it("maps public changes to the correct isolated workspaces", () => {
    expect(MANAGER_STAGES.find((stage) => stage.id === "registration")?.area).toBe("admin");
    expect(MANAGER_STAGES.find((stage) => stage.id === "operations")?.section).toBe("results");
    expect(MANAGER_STAGES.find((stage) => stage.id === "close")?.section).toBe("configuration");
  });
  it("validates deep links without accepting arbitrary tabs", () => {
    expect(initialAdminSection("?section=participants")).toBe("participants");
    expect(initialAdminSection("?section=payments")).toBe("payments");
    expect(initialAdminSection("?section=results")).toBe("overview");
    expect(initialDaySection("?section=schedule")).toBe("schedule");
    expect(initialDaySection("?section=payments")).toBe("overview");
    expect(initialDaySection("?view=tv&section=results")).toBe("tv");
  });
  it("does not claim remote publication on unknown or failed reads", () => {
    expect(describeCheckpoint(null, true, "es")).toBe("No se pudo consultar");
    expect(describeCheckpoint(null, false, "en")).toBe("No remote information");
    expect(describeCheckpoint({ hasPublishedSnapshot: false, publishedRevision: 0, syncStatus: "idle" }, false, "es")).toBe("Sin checkpoint informado");
    expect(describeCheckpoint({ hasPublishedSnapshot: true, publishedRevision: 17, syncStatus: "failed" }, false, "es")).toContain("sincronización fallida");
  });
  it("keeps the base hub route stable", () => {
    expect(managerBase("org", "tour")).toBe("/admin/organizations/org/tournaments/tour");
  });
});
