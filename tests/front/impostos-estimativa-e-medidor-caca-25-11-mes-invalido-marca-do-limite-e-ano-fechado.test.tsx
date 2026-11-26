// @vitest-environment jsdom
//
// Caça por mutação (25/11/2026) — Impostos: estimativa do DAS e medidor do MEI.
// RISCO: dinheiro e prazo de imposto na tela.
//
// O que os testes antigos não viam:
//  - mês inválido ("2026-13") ou com lixo antes ("x2026-10") NUNCA vira um mês
//    inventado ("janeiro de 2027"): a tela usa a frase sem mês;
//  - janeiro e dezembro (as pontas do calendário) escrevem o mês certo;
//  - a marca do limite (100%) fica a 5/6 da barra, que vai até 120%;
//  - no cartão "2026 fechado" o limite proporcional (ano de abertura) é explicado,
//    e só nesse caso.
// Dados inventados; nenhuma loja específica.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

import { EstimativaSimples } from "@/components/admin/financeiro/impostos/EstimativaSimples";
import { MedidorMei } from "@/components/admin/financeiro/impostos/MedidorMei";
import { ContextoValoresOcultos } from "@/components/admin/financeiro/partes";
import {
  type CoberturaDaReceita,
  medirLimiteDoMei,
} from "@/lib/fiscal/medidor-mei";

const COMPLETA: CoberturaDaReceita = { tipo: "completa" };

let raiz: Root | null = null;
let hospedeiro: HTMLDivElement;

beforeEach(() => {
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
});

afterEach(() => {
  if (raiz) {
    const atual = raiz;
    act(() => {
      atual.unmount();
    });
  }
  raiz = null;
  hospedeiro.remove();
});

const texto = (el: HTMLElement) =>
  (el.textContent ?? "")
    .replaceAll(String.fromCharCode(160), " ")
    .replace(/\s+/g, " ")
    .trim();

function montar(no: React.ReactNode): HTMLElement {
  raiz = createRoot(hospedeiro);
  const atual = raiz;
  act(() => {
    atual.render(
      <ContextoValoresOcultos.Provider value={false}>
        {no}
      </ContextoValoresOcultos.Provider>,
    );
  });
  return hospedeiro;
}

function estimativaDoMes(competencia: string): string {
  return texto(
    montar(
      <EstimativaSimples
        estimativa={{ estado: "com_estimativa", valor: 410 }}
        competencia={competencia}
        receitaDoMes={4_000}
      />,
    ),
  );
}

const SEM_MES = "Sobre as vendas do mês registradas no app.";

describe("EstimativaSimples — o mês do subtítulo", () => {
  it.each([
    ["2026-01", "janeiro de 2026"],
    ["2026-02", "fevereiro de 2026"],
    ["2026-12", "dezembro de 2026"],
  ])("competência %s escreve '%s'", (competencia, esperado) => {
    const t = estimativaDoMes(competencia);
    expect(t).toContain(`Sobre as vendas de ${esperado} registradas no app.`);
    expect(t).not.toContain(SEM_MES);
  });

  it.each([
    ["2026-13"],
    ["2026-00"],
    ["x2026-10"],
    ["2026-10x"],
    ["10/2026"],
    ["2026-1"],
    [""],
  ])(
    "competência inválida '%s' usa a frase sem mês (nunca inventa um)",
    (competencia) => {
      const t = estimativaDoMes(competencia);
      expect(t).toContain(SEM_MES);
      // Nenhum nome de mês entra no lugar do que não se sabe.
      expect(t).not.toMatch(
        /janeiro|fevereiro|março|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro/,
      );
    },
  );
});

describe("MedidorMei — a marca do limite na barra", () => {
  it("a marca de 100% fica a 5/6 da barra (a barra vai até 120%) e o enchimento anda junto", () => {
    const medidor = medirLimiteDoMei({
      receitaAcumulada: 40_500,
      ano: 2026,
      cadastro: { abertaEm: null },
    });
    const h = montar(
      <MedidorMei
        medidor={medidor}
        ano={2026}
        receitaAcumulada={40_500}
        cobertura={COMPLETA}
      />,
    );
    const enchimento = h.querySelector<HTMLElement>("[data-barra-enchimento]");
    expect(enchimento).not.toBeNull();
    const marca = enchimento?.nextElementSibling as HTMLElement | null;
    expect(marca).not.toBeNull();
    // 100 / 120 * 100 = 83,333…%
    expect(Number.parseFloat(marca?.style.left ?? "")).toBeCloseTo(83.3333, 3);
    // 50% de 120% = 41,666…%
    expect(Number.parseFloat(enchimento?.style.width ?? "")).toBeCloseTo(
      41.6667,
      3,
    );
  });
});

describe("MedidorMei fechado — o limite proporcional do ano de abertura", () => {
  function fechado(abertaEm: string | null): string {
    const medidor = medirLimiteDoMei({
      receitaAcumulada: 5_000,
      ano: 2026,
      cadastro: { abertaEm },
    });
    return texto(
      montar(
        <MedidorMei
          medidor={medidor}
          ano={2026}
          receitaAcumulada={5_000}
          cobertura={COMPLETA}
          fechado
        />,
      ),
    );
  }

  it("empresa aberta no próprio ano: explica que o limite é proporcional e diz os meses", () => {
    const t = fechado("2026-10-05");
    expect(t).toContain(
      "No ano em que a empresa abre, o limite é proporcional",
    );
    expect(t).toContain("3 meses de atividade");
  });

  it("ano cheio: não fala em limite proporcional", () => {
    expect(fechado(null)).not.toContain("proporcional");
  });
});
