// @vitest-environment jsdom
//
// Financeiro redesenhado (23/10/2026) — aba Resultado: quadros 2×2 no alto,
// controle Período/Mês a mês acima deles, tabela de 3 colunas em qualquer
// tamanho de tela, lucro líquido em caixa própria, valor em dinheiro que nunca
// quebra de linha, cor só pelo sinal e a explicação da estimativa de custo
// escrita uma vez. O jsdom não vê CSS: aqui se prova estrutura e classes.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const { rpcFalso } = vi.hoisted(() => ({ rpcFalso: vi.fn() }));
vi.mock("@/lib/supabase", () => ({ supabase: { rpc: rpcFalso } }));

import { AbaDre } from "@/components/admin/financeiro/AbaDre";
import { ContextoValoresOcultos } from "@/components/admin/financeiro/partes";
import type { IntervaloDeDatas } from "@/types/financeiro";

const DRE = {
  receita_bruta: 10000,
  receita_online: 6000,
  receita_balcao: 4000,
  deducoes: 500,
  receita_liquida: 9500,
  cmv: 3800,
  cmv_estimado: true,
  lucro_bruto: 5700,
  custos_variaveis: 950,
  margem_contribuicao: 4750,
  despesas_fixas: 2850,
  resultado_operacional: 1900,
  resultado_financeiro: -95,
  lucro_liquido: 1805,
  linhas: [
    { grupo: "receita", categoria: "App (vendas online)", valor: 6000 },
    { grupo: "despesa_fixa", categoria: "Aluguel", valor: 2000 },
  ],
};

const AVISO_LONGO =
  "Inclui estimativa: usa o custo de hoje do produto, ou R$ 0 se ele não tem custo cadastrado";

const normalizar = (t: string | null | undefined) =>
  (t ?? "").replace(/\s+/g, " ");

async function esperar() {
  for (let i = 0; i < 4; i += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

describe("Financeiro — aba Resultado redesenhada", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    rpcFalso.mockReset();
    rpcFalso.mockResolvedValue({ data: DRE, error: null });
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
  });

  async function montar(
    intervalo: IntervaloDeDatas = { inicio: "2026-09-01", fim: "2026-09-30" },
    ocultos = false,
  ) {
    await act(async () => {
      raiz.render(
        <ContextoValoresOcultos.Provider value={ocultos}>
          <AbaDre
            ativo
            intervalo={intervalo}
            versao={0}
            rotuloDoPeriodo="Setembro de 2026"
          />
        </ContextoValoresOcultos.Provider>,
      );
    });
    await esperar();
  }

  const linha = (chave: string) =>
    hospedeiro.querySelector(`[data-linha-dre="${chave}"]`) as HTMLElement;
  const quadros = () => [
    ...hospedeiro.querySelectorAll<HTMLElement>("[data-quadro-do-resultado]"),
  ];
  const quadro = (rotulo: string) =>
    quadros().find(
      (q) => q.querySelector("[data-rotulo-do-kpi]")?.textContent === rotulo,
    ) as HTMLElement;

  it("quatro quadros em duas colunas, na ordem do desenho aprovado", async () => {
    await montar();
    expect(
      quadros().map((q) =>
        q.querySelector("[data-rotulo-do-kpi]")?.textContent?.trim(),
      ),
    ).toEqual([
      "Lucro líquido",
      "Receita líquida",
      "Lucro bruto",
      "Sobra depois dos custos da venda",
    ]);
    const grade = quadros()[0]?.parentElement as HTMLElement;
    expect(grade.className).toContain("grid-cols-2");
    expect(grade.className).not.toContain("grid-cols-1");
    // Margens escritas por extenso; a sobra mostra quanto da receita ela é.
    expect(normalizar(quadro("Lucro líquido").textContent)).toContain(
      "Margem líquida 19,0%",
    );
    expect(normalizar(quadro("Lucro bruto").textContent)).toContain(
      "Margem bruta 60,0%",
    );
    expect(
      normalizar(quadro("Sobra depois dos custos da venda").textContent),
    ).toContain("50,0% da receita");
  });

  it("o controle Período / Mês a mês fica ACIMA dos quadros, não dentro do cartão da tabela", async () => {
    await montar({ inicio: "2026-07-01", fim: "2026-09-30" });
    const controle = hospedeiro.querySelector(
      '[aria-label="Visão do resultado"]',
    ) as HTMLElement;
    expect(controle).not.toBeNull();
    const primeiroQuadro = quadros()[0] as HTMLElement;
    expect(
      controle.compareDocumentPosition(primeiroQuadro) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(controle.closest("section")).toBeNull();
    // Um mês só: não há o que abrir mês a mês, então o controle não aparece.
    act(() => raiz.unmount());
    raiz = createRoot(hospedeiro);
    await montar({ inicio: "2026-09-01", fim: "2026-09-30" });
    expect(
      hospedeiro.querySelector('[aria-label="Visão do resultado"]'),
    ).toBeNull();
  });

  it("a estimativa de custo: selo curto nos quadros e na linha, explicação inteira uma vez só", async () => {
    await montar();
    const selos = [
      ...hospedeiro.querySelectorAll<HTMLElement>("[data-aviso-de-estimativa]"),
    ];
    // Lucro líquido, lucro bruto e sobra (todos descontam o custo estimado) e
    // a própria linha do custo; a receita líquida não depende dele.
    expect(selos).toHaveLength(4);
    for (const selo of selos) {
      expect(normalizar(selo.textContent)).toBe("Inclui estimativa de custo");
      expect(selo.title).toBe(AVISO_LONGO);
      expect(selo.className).toContain("rounded-full");
    }
    expect(
      quadro("Lucro líquido").querySelector("[data-aviso-de-estimativa]"),
    ).not.toBeNull();
    expect(
      quadro("Lucro bruto").querySelector("[data-aviso-de-estimativa]"),
    ).not.toBeNull();
    expect(
      quadro("Sobra depois dos custos da venda").querySelector(
        "[data-aviso-de-estimativa]",
      ),
    ).not.toBeNull();
    expect(
      quadro("Receita líquida").querySelector("[data-aviso-de-estimativa]"),
    ).toBeNull();
    expect(
      linha("cmv").querySelector("[data-aviso-de-estimativa]"),
    ).not.toBeNull();
    // A explicação inteira aparece uma única vez, embaixo da tabela.
    const texto = normalizar(hospedeiro.textContent);
    expect(texto.split(AVISO_LONGO)).toHaveLength(2);
  });

  it("sem estimativa não há selo nem explicação", async () => {
    rpcFalso.mockResolvedValue({
      data: { ...DRE, cmv_estimado: false },
      error: null,
    });
    await montar();
    expect(hospedeiro.querySelector("[data-aviso-de-estimativa]")).toBeNull();
    expect(normalizar(hospedeiro.textContent)).not.toContain("estimativa");
  });

  it("a tabela tem 3 colunas em qualquer tela, sem versão empilhada do celular", async () => {
    await montar();
    const tabela = hospedeiro.querySelector("table") as HTMLElement;
    expect(tabela.className).not.toMatch(/(^|\s)block(\s|$)/);
    expect(tabela.className).not.toContain("sm:table");
    expect(
      [...tabela.querySelectorAll("thead th")].map((th) =>
        normalizar(th.textContent),
      ),
    ).toEqual(["Linha", "Valor", "% rec. líq."]);
    for (const l of hospedeiro.querySelectorAll("[data-linha-dre]")) {
      expect(l.children).toHaveLength(3);
      expect(l.className).not.toContain("grid");
    }
    // A coluna da linha e a do valor/percentual são as de cabeçalho.
    expect(linha("receita_bruta").querySelector("th")?.scope).toBe("row");
  });

  it("valor em dinheiro NUNCA quebra de linha: nowrap em todo quadro e em toda célula, e menor quando longo", async () => {
    await montar();
    const valores = [
      ...hospedeiro.querySelectorAll<HTMLElement>(
        "[data-quadro-do-resultado] .tabular-nums, [data-linha-dre] td span.tabular-nums",
      ),
    ];
    expect(valores.length).toBeGreaterThan(10);
    for (const v of valores) {
      expect(v.className, v.textContent ?? "").toContain("whitespace-nowrap");
    }

    const tamanho = (el: HTMLElement) =>
      [...el.classList].find((c) => /^text-(\[\d+px\]|xs|sm|base)$/.test(c));

    // Curto = 22px; longo ("R$ 1.234.567,89" = 15 caracteres) = pequeno.
    await act(async () => {
      raiz.unmount();
    });
    raiz = createRoot(hospedeiro);
    rpcFalso.mockResolvedValue({
      data: { ...DRE, lucro_liquido: 1234567.89, receita_liquida: 9 },
      error: null,
    });
    await montar();
    const longo = quadro("Lucro líquido").querySelector(
      ".tabular-nums",
    ) as HTMLElement;
    expect(tamanho(longo)).toBe("text-xs");
    const curto = quadro("Receita líquida").querySelector(
      ".tabular-nums",
    ) as HTMLElement;
    expect(tamanho(curto)).toBe("text-[22px]");
    const celulaLonga = linha("lucro_liquido").querySelectorAll("td")[0]
      ?.firstElementChild as HTMLElement;
    expect(celulaLonga.className).toContain("whitespace-nowrap");
    expect(tamanho(celulaLonga)).toBe("text-xs");
  });

  it("cor só pelo sinal: positivo verde, negativo vermelho, zero cinza; o resto neutro", async () => {
    rpcFalso.mockResolvedValue({
      data: {
        ...DRE,
        lucro_liquido: 0,
        lucro_bruto: -100,
        resultado_operacional: 1900,
      },
      error: null,
    });
    await montar();
    const valorDoQuadro = (rotulo: string) =>
      quadro(rotulo).querySelector(".tabular-nums") as HTMLElement;
    expect(valorDoQuadro("Lucro líquido").className).toContain("text-zinc-400");
    expect(valorDoQuadro("Lucro bruto").className).toContain("text-red-400");
    expect(
      valorDoQuadro("Sobra depois dos custos da venda").className,
    ).toContain("text-emerald-400");
    // Receita líquida é neutra (não é resultado, é base).
    expect(valorDoQuadro("Receita líquida").className).toContain("text-white");

    const corDaLinha = (chave: string) =>
      linha(chave).querySelector("td span")?.className ?? "";
    expect(corDaLinha("lucro_liquido")).toContain("text-zinc-400");
    expect(corDaLinha("lucro_bruto")).toContain("text-red-400");
    expect(corDaLinha("resultado_operacional")).toContain("text-emerald-400");
    expect(corDaLinha("resultado_financeiro")).toContain("text-red-400");
    for (const chave of ["deducoes", "cmv", "despesas_fixas"]) {
      expect(corDaLinha(chave), chave).toContain("text-white");
    }
  });

  it("o lucro líquido tem caixa própria, sem violeta, e é a única linha assim", async () => {
    await montar();
    const final = linha("lucro_liquido");
    expect(final.hasAttribute("data-linha-final")).toBe(true);
    expect(final.className).toContain("font-bold");
    expect(hospedeiro.querySelectorAll("[data-linha-final]")).toHaveLength(1);
    // Caixa: cantos arredondados nas pontas e borda, nas células.
    const celulas = [...final.children] as HTMLElement[];
    expect(celulas[0]?.className).toContain("rounded-l-2xl");
    expect(celulas[2]?.className).toContain("rounded-r-2xl");
    expect(hospedeiro.innerHTML).not.toMatch(/violet|indigo|purple/);
  });

  it("subtotais em negrito; linhas comuns não", async () => {
    await montar();
    for (const chave of [
      "receita_liquida",
      "lucro_bruto",
      "margem_contribuicao",
      "resultado_operacional",
    ]) {
      expect(linha(chave).className, chave).toContain("font-bold");
    }
    for (const chave of ["deducoes", "cmv", "despesas_fixas"]) {
      expect(linha(chave).className, chave).not.toContain("font-bold");
    }
  });

  it("Ocultar esconde os valores dos quadros e da tabela (inclusive das categorias abertas)", async () => {
    await montar(undefined, true);
    // O "R$ 0" da explicação do custo é texto fixo, não um valor da loja.
    const texto = normalizar(hospedeiro.textContent).replace(AVISO_LONGO, "");
    expect(texto).not.toMatch(/R\$ \d/);
    expect(texto).toContain("R$ ••••••");
    expect(quadro("Lucro líquido").textContent).toContain("Valor oculto");
    expect(linha("receita_bruta").textContent).toContain("Valor oculto");
    // O percentual não é dinheiro: continua visível.
    expect(normalizar(linha("receita_liquida").textContent)).toContain(
      "100,0%",
    );
  });

  it("período sem nada: estado vazio explicado, e os quadros zerados continuam", async () => {
    rpcFalso.mockResolvedValue({
      data: {
        receita_bruta: 0,
        receita_online: 0,
        receita_balcao: 0,
        deducoes: 0,
        receita_liquida: 0,
        cmv: 0,
        cmv_estimado: false,
        lucro_bruto: 0,
        custos_variaveis: 0,
        margem_contribuicao: 0,
        despesas_fixas: 0,
        resultado_operacional: 0,
        resultado_financeiro: 0,
        lucro_liquido: 0,
        linhas: [],
      },
      error: null,
    });
    await montar();
    const texto = normalizar(hospedeiro.textContent);
    expect(texto).toContain("Nada no período ainda");
    expect(quadros()).toHaveLength(4);
    expect(hospedeiro.querySelector("table")).toBeNull();
    // Sem receita não há base para percentual: traço, nunca "NaN%".
    expect(texto).not.toContain("NaN");
    expect(normalizar(quadro("Lucro líquido").textContent)).toContain(
      "Margem líquida —",
    );
  });

  it("enquanto carrega mostra o esqueleto no formato da tela pronta", async () => {
    rpcFalso.mockReturnValue(new Promise(() => {}));
    await montar();
    const esqueleto = hospedeiro.querySelector('[aria-busy="true"]');
    expect(esqueleto).not.toBeNull();
    expect(esqueleto?.querySelector(".grid-cols-2")).not.toBeNull();
    expect(hospedeiro.querySelector("table")).toBeNull();
  });

  it("erro na primeira busca: mensagem e tentar de novo, sem quadros", async () => {
    rpcFalso.mockResolvedValue({
      data: null,
      error: { message: "Failed to fetch" },
    });
    await montar();
    expect(hospedeiro.querySelector('[role="alert"]')).not.toBeNull();
    expect(quadros()).toHaveLength(0);
  });

  it("a nota de transferências e retiradas continua, e as categorias abrem como antes", async () => {
    await montar();
    expect(normalizar(hospedeiro.textContent)).toContain(
      "Transferências entre contas, compra de mercadoria para estoque e aporte ou retirada do dono ficam fora do resultado",
    );
    // A receita bruta já abre separando app e loja física; despesas fecham.
    expect(
      linha("receita_bruta")
        .querySelector("button[aria-expanded]")
        ?.getAttribute("aria-expanded"),
    ).toBe("true");
    expect(
      linha("despesas_fixas")
        .querySelector("button[aria-expanded]")
        ?.getAttribute("aria-expanded"),
    ).toBe("false");
    // Alvo de toque confortável no botão que abre a linha.
    expect(
      linha("despesas_fixas").querySelector("button")?.className,
    ).toContain("min-h-11");
  });
});
