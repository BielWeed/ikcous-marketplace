// @vitest-environment jsdom
//
// Caderno das guias — a linha "Vendas registradas no app (menos devoluções): R$ X" em cada
// mês (decisão do sócio, 25/11/2026, item 5). É INFORMAÇÃO do mês, nunca um quarto valor ao
// lado de "Valor da guia / A pagar / Pago", e nunca leva palavra fiscal ("receita
// tributável", "base de cálculo", "faturamento"): o que importa é que a lojista veja o
// quanto vendeu no mês ao lado da guia daquele mês, sem o app concluir nada.
//
// Componente de APRESENTAÇÃO: o número chega pronto em `vendasDoMes`. Mês sem o número
// (a leitura não chegou, ou veio torta) não mostra a linha: nunca vira "R$ 0,00".
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

import {
  CadernoDeGuias,
  type MesParaOCaderno,
} from "@/components/admin/financeiro/impostos/CadernoDeGuias";
import type { AbrirFolha } from "@/components/admin/financeiro/navegacao";
import { ContextoValoresOcultos } from "@/components/admin/financeiro/partes";
import type { EstadoDoMes, MesDoCaderno } from "@/lib/fiscal/caderno";

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const semNbsp = (t: string | null | undefined) =>
  (t ?? "")
    .replaceAll(String.fromCharCode(160), " ")
    .replace(/\s+/g, " ")
    .trim();

function mes(
  competencia: string,
  estado: EstadoDoMes,
  valores: { guia?: number; pago?: number; aPagar?: number } = {},
): MesDoCaderno {
  return {
    mes: competencia,
    guia: valores.guia ?? 0,
    pago: valores.pago ?? 0,
    aPagar: valores.aPagar ?? 0,
    estado,
  };
}

async function montar(
  meses: readonly MesParaOCaderno[],
  ocultos = false,
): Promise<void> {
  await act(async () =>
    root.render(
      <ContextoValoresOcultos.Provider value={ocultos}>
        <CadernoDeGuias
          meses={meses}
          cadastro={null}
          abrirFolha={vi.fn() as unknown as AbrirFolha}
        />
      </ContextoValoresOcultos.Provider>,
    ),
  );
}

function cartao(competencia: string): HTMLElement {
  const el = host.querySelector<HTMLElement>(`li[data-mes="${competencia}"]`);
  if (!el) throw new Error(`cartão de ${competencia} não encontrado`);
  return el;
}

const linhaDeVendas = (competencia: string): HTMLElement | null =>
  cartao(competencia).querySelector<HTMLElement>("[data-vendas-do-mes]");

const ROTULO = "Vendas registradas no app (menos devoluções):";

describe("Caderno das guias — vendas registradas no app, em cada mês", () => {
  it("cada um dos 3 meses mostra a sua linha, com o seu número", async () => {
    await montar([
      { caderno: mes("2026-11", "sem_guia"), vendasDoMes: 3_333.33 },
      {
        caderno: mes("2026-10", "a_pagar", { guia: 50, aPagar: 50 }),
        vendasDoMes: 2_000,
      },
      {
        caderno: mes("2026-09", "paga", { guia: 40, pago: 40 }),
        vendasDoMes: 1_111.1,
      },
    ]);
    expect(semNbsp(linhaDeVendas("2026-11")?.textContent)).toBe(
      `${ROTULO} R$ 3.333,33`,
    );
    expect(semNbsp(linhaDeVendas("2026-10")?.textContent)).toBe(
      `${ROTULO} R$ 2.000,00`,
    );
    expect(semNbsp(linhaDeVendas("2026-09")?.textContent)).toBe(
      `${ROTULO} R$ 1.111,10`,
    );
  });

  it("é uma linha de texto menor, FORA da lista de valores (nunca um quarto valor ao lado de Valor da guia / A pagar / Pago)", async () => {
    await montar([
      {
        caderno: mes("2026-10", "a_pagar", { guia: 50, aPagar: 50 }),
        vendasDoMes: 2_000,
      },
    ]);
    const linha = linhaDeVendas("2026-10");
    expect(linha).not.toBeNull();
    // não está dentro do <dl> dos três valores, e não é um <dt>/<dd>
    expect(cartao("2026-10").querySelector("dl")?.contains(linha)).toBe(false);
    expect(linha?.tagName).toBe("P");
    expect(cartao("2026-10").querySelectorAll("dl > div")).toHaveLength(3);
    // estilo discreto: texto pequeno e cinza, nunca o tamanho dos valores da guia
    expect(linha?.className).toContain("text-xs");
    expect(linha?.className).not.toMatch(/text-(lg|xl|2xl|3xl)|font-bold/);
  });

  it("também aparece no mês SEM guia lançada (o caderno vazio do mês continua dizendo isso)", async () => {
    await montar([{ caderno: mes("2026-11", "sem_guia"), vendasDoMes: 500 }]);
    expect(semNbsp(linhaDeVendas("2026-11")?.textContent)).toBe(
      `${ROTULO} R$ 500,00`,
    );
    expect(semNbsp(cartao("2026-11").textContent)).toContain(
      "Nenhuma guia lançada para as vendas deste mês.",
    );
  });

  it("nenhuma palavra fiscal na linha: sem 'tributável', 'imposto', 'base de cálculo' nem 'faturamento'", async () => {
    await montar([{ caderno: mes("2026-11", "sem_guia"), vendasDoMes: 500 }]);
    expect(semNbsp(linhaDeVendas("2026-11")?.textContent)).not.toMatch(
      /tribut|imposto|base de c[aá]lculo|faturamento|guia|\bDAS\b|lucro/i,
    );
  });

  it("mês zerado mostra 'R$ 0,00' (mês medido sem venda é informação)", async () => {
    await montar([{ caderno: mes("2026-10", "sem_guia"), vendasDoMes: 0 }]);
    expect(semNbsp(linhaDeVendas("2026-10")?.textContent)).toBe(
      `${ROTULO} R$ 0,00`,
    );
  });

  it("mês com mais devolução que venda mostra o número como está (negativo), o mesmo do Resultado", async () => {
    await montar([
      { caderno: mes("2026-10", "sem_guia"), vendasDoMes: -120.5 },
    ]);
    expect(semNbsp(linhaDeVendas("2026-10")?.textContent)).toContain("120,50");
    expect(semNbsp(linhaDeVendas("2026-10")?.textContent)).toMatch(/-|−/);
  });

  it.each([
    ["ausente", undefined],
    ["nulo (a leitura não chegou)", null],
    ["NaN", Number.NaN],
    ["infinito", Number.POSITIVE_INFINITY],
  ])(
    "número %s: NENHUMA linha (nunca 'R$ 0,00' no lugar do que não se sabe)",
    async (_nome, vendasDoMes) => {
      await montar([
        {
          caderno: mes("2026-10", "sem_guia"),
          vendasDoMes: vendasDoMes as number | null | undefined,
        },
      ]);
      expect(linhaDeVendas("2026-10")).toBeNull();
      expect(semNbsp(cartao("2026-10").textContent)).not.toContain(
        "Vendas registradas",
      );
    },
  );

  it("um mês sem o número não apaga o dos outros", async () => {
    await montar([
      { caderno: mes("2026-11", "sem_guia"), vendasDoMes: null },
      { caderno: mes("2026-10", "sem_guia"), vendasDoMes: 700 },
    ]);
    expect(linhaDeVendas("2026-11")).toBeNull();
    expect(semNbsp(linhaDeVendas("2026-10")?.textContent)).toContain(
      "R$ 700,00",
    );
  });

  it("Ocultar valores: o número vira máscara e o rótulo fica", async () => {
    await montar(
      [{ caderno: mes("2026-10", "sem_guia"), vendasDoMes: 2_345.67 }],
      true,
    );
    const texto = semNbsp(linhaDeVendas("2026-10")?.textContent);
    expect(texto).toContain(ROTULO);
    expect(texto).not.toContain("2.345");
    expect(texto).toContain("Valor oculto");
  });

  it("a linha não muda o que o cartão diz da guia: Valor da guia, A pagar e Pago seguem os mesmos três", async () => {
    await montar([
      {
        caderno: mes("2026-10", "a_pagar", {
          guia: 100.5,
          pago: 40,
          aPagar: 60.5,
        }),
        vendasDoMes: 9_999,
      },
    ]);
    const rotulos = Array.from(cartao("2026-10").querySelectorAll("dt")).map(
      (dt) => semNbsp(dt.textContent),
    );
    expect(rotulos).toEqual(["Valor da guia", "A pagar", "Pago"]);
  });
});
