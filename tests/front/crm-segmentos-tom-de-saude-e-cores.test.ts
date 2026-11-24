// A cor que o grupo de clientes ganha no CRM (achado por mutação em
// 24/11/2026: trocar o tom de "Podem não voltar" de risco para atenção, ou de
// "Parados há muito tempo" para risco, não derrubava nenhum teste). O tom
// agrupa os 12 grupos pela SAÚDE da relação — verde bom, azul chegando, âmbar
// esfriando, vermelho perdendo, cinza sem sinal — e é o que a lojista lê de
// relance antes de ler o nome. O texto nunca depende só da cor, mas a cor
// errada manda a lojista atrás do grupo errado.
import {
  SEGMENTOS_DO_CRM,
  type TomDoCrm,
  classesDoTom,
  infoDoSegmento,
} from "@/lib/crm";
import { describe, expect, it } from "vitest";

const TOM_ESPERADO: Record<(typeof SEGMENTOS_DO_CRM)[number], TomDoCrm> = {
  campeoes: "otimo",
  leais: "otimo",
  ativos: "otimo",
  novos: "crescendo",
  promissores: "crescendo",
  precisam_atencao: "atencao",
  quase_dormindo: "atencao",
  pediu_nao_pagou: "atencao",
  em_risco: "risco",
  nao_pode_perder: "risco",
  hibernando: "neutro",
  nunca_comprou: "neutro",
};

describe("tom de saúde de cada grupo de clientes", () => {
  it.each(SEGMENTOS_DO_CRM)("%s tem o tom da saúde da relação", (segmento) => {
    // eslint-disable-next-line security/detect-object-injection -- chave vem da lista fixa SEGMENTOS_DO_CRM
    expect(infoDoSegmento(segmento).tom).toBe(TOM_ESPERADO[segmento]);
  });

  it("a tabela do teste cobre os 12 grupos, sem sobrar nem faltar", () => {
    expect(Object.keys(TOM_ESPERADO).sort()).toEqual(
      [...SEGMENTOS_DO_CRM].sort(),
    );
  });
});

describe("cores de cada tom", () => {
  it.each([
    ["otimo", "emerald"],
    ["crescendo", "sky"],
    ["atencao", "amber"],
    ["risco", "rose"],
  ] as const)("%s usa a família %s no crachá e na marca", (tom, cor) => {
    const { cracha, marca } = classesDoTom(tom);

    expect(cracha).toContain(`border-${cor}-500/25`);
    expect(cracha).toContain(`bg-${cor}-500/10`);
    expect(cracha).toContain(`text-${cor}-300`);
    expect(marca).toBe(`bg-${cor}-400`);
  });

  it("neutro é cinza e não puxa para nenhuma cor de alerta", () => {
    const { cracha, marca } = classesDoTom("neutro");

    expect(cracha).toContain("text-zinc-300");
    expect(marca).toBe("bg-zinc-500");
    expect(`${cracha} ${marca}`).not.toMatch(/emerald|sky|amber|rose/);
  });
});
