// O cartão "Sua assinatura" do Início escreve o status do contrato (com a cor
// do significado) e o ciclo ao lado do preço ("R$ 49,90/mês"). Estas duas
// traduções saem de `src/lib/crm.ts` e só eram exercitadas de passagem pelo
// cartão. Aqui cada status e cada ciclo é conferido direto. Valores fictícios.
import { describe, expect, it } from "vitest";

import { infoDoStatusDaAssinatura, rotuloDoCiclo } from "@/lib/crm";

describe("infoDoStatusDaAssinatura: texto e cor de cada situação do contrato", () => {
  it.each([
    ["ativa", "Ativa", "otimo"],
    ["teste", "Em teste", "crescendo"],
    ["pendente", "Pagamento pendente", "atencao"],
    ["atrasada", "Atrasada", "risco"],
    ["suspensa", "Suspensa", "risco"],
    ["cancelada", "Cancelada", "neutro"],
  ] as const)("%s → %s (%s)", (status, rotulo, tom) => {
    expect(infoDoStatusDaAssinatura(status)).toEqual({ rotulo, tom });
  });

  it("sem status não afirma nada: 'Status desconhecido', cor neutra", () => {
    expect(infoDoStatusDaAssinatura(null)).toEqual({
      rotulo: "Status desconhecido",
      tom: "neutro",
    });
  });

  it("status que o app não conhece (vindo de um banco mais novo) também cai em desconhecido", () => {
    const futuro = "em_analise" as unknown as Parameters<
      typeof infoDoStatusDaAssinatura
    >[0];
    expect(infoDoStatusDaAssinatura(futuro)).toEqual({
      rotulo: "Status desconhecido",
      tom: "neutro",
    });
  });

  it("só atraso e suspensão são risco; nenhum outro status pinta de vermelho", () => {
    const status = [
      "ativa",
      "teste",
      "pendente",
      "atrasada",
      "suspensa",
      "cancelada",
      null,
    ] as const;
    expect(
      status.filter((s) => infoDoStatusDaAssinatura(s).tom === "risco"),
    ).toEqual(["atrasada", "suspensa"]);
  });
});

describe("rotuloDoCiclo: o que vai depois do preço", () => {
  it.each([
    ["mensal", "/mês"],
    ["trimestral", "/trimestre"],
    ["semestral", "/semestre"],
    ["anual", "/ano"],
  ])("%s → %s", (ciclo, texto) => {
    expect(rotuloDoCiclo(ciclo)).toBe(texto);
  });

  it("maiúscula e minúscula dão o mesmo texto", () => {
    expect(rotuloDoCiclo("MENSAL")).toBe("/mês");
    expect(rotuloDoCiclo("Trimestral")).toBe("/trimestre");
    expect(rotuloDoCiclo("SeMeStRaL")).toBe("/semestre");
    expect(rotuloDoCiclo("ANUAL")).toBe("/ano");
  });

  it("sem ciclo não escreve nada ao lado do preço", () => {
    expect(rotuloDoCiclo(null)).toBe("");
  });

  it("ciclo desconhecido aparece como veio, depois de um ponto separador, sem inventar tradução", () => {
    expect(rotuloDoCiclo("bimestral")).toBe(" · bimestral");
    expect(rotuloDoCiclo("Quinzenal")).toBe(" · Quinzenal");
  });

  it("nome parecido não é o ciclo: 'mensalidade' e 'anuais' não viram '/mês' nem '/ano'", () => {
    expect(rotuloDoCiclo("mensalidade")).toBe(" · mensalidade");
    expect(rotuloDoCiclo("anuais")).toBe(" · anuais");
  });
});
