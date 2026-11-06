import { pluralizar } from "@/lib/pluralizar";
import { describe, expect, it } from "vitest";

describe("pluralizar", () => {
  it("só o 1 usa o singular", () => {
    expect(pluralizar(1, "alteração", "alterações")).toBe("1 alteração");
  });

  it("zero e os demais usam o plural", () => {
    expect(pluralizar(0, "alteração", "alterações")).toBe("0 alterações");
    expect(pluralizar(2, "alteração", "alterações")).toBe("2 alterações");
  });
});
