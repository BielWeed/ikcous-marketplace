// Funções puras novas da aba Clientes do redesenho visual do CRM (spec
// `docs/superpowers/specs/2026-09-27-crm-visual-profissional-design.md`):
// agrupar os 10 segmentos RFM em 3 faixas de saúde da relação (Melhores ·
// Atenção · Perdendo) e o texto da linha de filtro ativo
// ("Mostrando: Em risco · 2"). Arquivo novo para não conflitar com
// `crm-e-inicio-funcoes-puras.test.ts`, que outro agente também está editando.
import {
  FAIXAS_DE_SEGMENTOS_DO_CRM,
  SEGMENTOS_DO_CRM,
  textoDoFiltroDeSegmento,
} from "@/lib/crm";
import { describe, expect, it } from "vitest";

describe("FAIXAS_DE_SEGMENTOS_DO_CRM", () => {
  it("agrupa os 10 segmentos em 3 faixas, sem repetir nem esquecer nenhum", () => {
    const todos = FAIXAS_DE_SEGMENTOS_DO_CRM.flatMap(
      (faixa) => faixa.segmentos,
    );
    expect(todos).toHaveLength(SEGMENTOS_DO_CRM.length);
    expect(new Set(todos)).toEqual(new Set(SEGMENTOS_DO_CRM));
  });

  it("Melhores, Atenção e Perdendo na ordem certa com os segmentos da spec", () => {
    expect(FAIXAS_DE_SEGMENTOS_DO_CRM).toEqual([
      {
        titulo: "Melhores",
        segmentos: ["campeoes", "leais", "ativos", "novos", "promissores"],
      },
      {
        titulo: "Atenção",
        segmentos: ["precisam_atencao", "quase_dormindo"],
      },
      {
        titulo: "Perdendo",
        segmentos: ["em_risco", "nao_pode_perder", "hibernando"],
      },
    ]);
  });
});

describe("textoDoFiltroDeSegmento", () => {
  it("null quando nenhum segmento está selecionado (mostra todos)", () => {
    expect(textoDoFiltroDeSegmento(null, 42)).toBeNull();
  });

  it("mostra o rótulo do segmento e a contagem de clientes filtrados", () => {
    expect(textoDoFiltroDeSegmento("em_risco", 2)).toBe(
      "Mostrando: Em risco · 2",
    );
  });

  it("formata a contagem com separador de milhar", () => {
    expect(textoDoFiltroDeSegmento("campeoes", 1234)).toBe(
      "Mostrando: Campeões · 1.234",
    );
  });

  it("mostra 0 quando o segmento escolhido não tem cliente algum", () => {
    expect(textoDoFiltroDeSegmento("hibernando", 0)).toBe(
      "Mostrando: Hibernando · 0",
    );
  });
});
