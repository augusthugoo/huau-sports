import { describe, expect, it } from "vitest";
import { publicModelShape } from "./tournament-day-public";

const valid = () => ({
  schemaVersion: 1,
  kind: "live",
  tournament: { id: "tournament-1", name: "Test Cup" },
  players: [{ name: "Jugador de prueba", category: "Open" }],
});

describe("HUAU V3 public Tournament Day model privacy", () => {
  it("allows minimal sporting information", () => {
    const model = valid();
    expect(publicModelShape(model, "live", "tournament-1").model).toEqual(model);
  });

  it.each(["birthDate", "date_of_birth", "age", "city", "ipAddress", "streetAddress", "guardianEmail", "duprId", "identityDocument"])(
    "rejects private field %s rather than publishing it",
    (field) => {
      const model = { ...valid(), players: [{ name: "Jugador", [field]: "sensitive" }] };
      expect(() => publicModelShape(model, "live", "tournament-1")).toThrow("PUBLIC_MODEL_PRIVATE_FIELD");
    },
  );

  it("continues rejecting emails in nested objects", () => {
    const model = { ...valid(), players: [{ name: "Jugador", meta: [{ email: "private@example.test" }] }] };
    expect(() => publicModelShape(model, "live", "tournament-1")).toThrow("PUBLIC_MODEL_PRIVATE_FIELD");
  });
});
