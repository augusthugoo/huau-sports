import { describe, expect, it } from "vitest";
import { knockoutRoundLabel } from "./bracket";

describe("standard knockout round labels", () => {
  it("names rounds beyond the round of 16 without a preliminary fallback", () => {
    expect(knockoutRoundLabel(6, 0)).toBe("Round of 64");
    expect(knockoutRoundLabel(5, 0)).toBe("Round of 32");
    expect(knockoutRoundLabel(4, 0)).toBe("Round of 16");
    expect(knockoutRoundLabel(3, 0)).toBe("Quarterfinal");
    expect(knockoutRoundLabel(2, 0)).toBe("Semifinal");
    expect(knockoutRoundLabel(1, 0)).toBe("Final");
  });
});
