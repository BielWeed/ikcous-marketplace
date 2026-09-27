// Casca visual do Dashboard CRM (27/09/2026, spec
// docs/superpowers/specs/2026-09-27-crm-visual-profissional-design.md): o
// período deixa de ser "seis palavras soltas" e passa a mostrar as datas do
// intervalo escolhido — "28 ago – 26 set" — ao lado do trilho segmentado.
// Este arquivo é NOVO de propósito: não mexe em
// crm-e-inicio-funcoes-puras.test.ts para não conflitar com os outros dois
// agentes que também mexem em src/lib/crm.ts em paralelo.
import { formatarIntervaloCurto } from "@/lib/crm";
import { describe, expect, it } from "vitest";

describe("formatarIntervaloCurto — o intervalo de datas em texto curto", () => {
  it("intervalo dentro do mesmo ano: '28 ago – 26 set', sem ano", () => {
    expect(
      formatarIntervaloCurto({ inicio: "2026-08-28", fim: "2026-09-26" }),
    ).toBe("28 ago – 26 set");
  });

  it("início e fim iguais (período 'Hoje'): só uma data", () => {
    expect(
      formatarIntervaloCurto({ inicio: "2026-09-26", fim: "2026-09-26" }),
    ).toBe("26 set");
  });

  it("dia sem zero à esquerda: '3 jan', não '03 jan'", () => {
    expect(
      formatarIntervaloCurto({ inicio: "2026-01-03", fim: "2026-01-05" }),
    ).toBe("3 jan – 5 jan");
  });

  it("intervalo cruza o ano: mostra o ano dos dois lados", () => {
    expect(
      formatarIntervaloCurto({ inicio: "2025-12-28", fim: "2026-01-03" }),
    ).toBe("28 dez/2025 – 3 jan/2026");
  });
});
