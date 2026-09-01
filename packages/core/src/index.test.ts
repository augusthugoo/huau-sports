import { describe, expect, it } from "vitest";
import { foundationIdentity } from "./index";

describe("foundationIdentity", () => {
  it("exposes the HUAU application identity", () => {
    expect(foundationIdentity()).toEqual({
      app: "HUAU Sports",
      version: "0.5.2-phase4.1-parity",
    });
  });
});
