// Laudo 0109 (C5) — guarda de rede lenta para downloads em segundo plano.
// O warmer mandava o SW baixar todas as imagens na URL original sem olhar
// a rede; o util é o critério do usePrefetchOnHover tornado puro e
// testável. Sem a Network Information API (iOS Safari), devolve false:
// sem informação, não há como acusar lentidão.
import { describe, expect, it } from "vitest";

import { redeLenta } from "@/lib/rede-lenta";

describe("redeLenta — laudo 0109 (C5)", () => {
  it("saveData ligado é lento, independente do effectiveType", () => {
    expect(redeLenta({ saveData: true, effectiveType: "4g" })).toBe(true);
  });

  it("2g e slow-2g são lentos", () => {
    expect(redeLenta({ effectiveType: "2g" })).toBe(true);
    expect(redeLenta({ effectiveType: "slow-2g" })).toBe(true);
  });

  it("3g/4g/wifi sem saveData não são lentos", () => {
    expect(redeLenta({ effectiveType: "3g" })).toBe(false);
    expect(redeLenta({ effectiveType: "4g" })).toBe(false);
    expect(redeLenta({ effectiveType: "wifi" })).toBe(false);
  });

  it("sem informação de conexão (iOS Safari), não acusa lentidão", () => {
    expect(redeLenta(undefined)).toBe(false);
    expect(redeLenta({})).toBe(false);
  });
});
