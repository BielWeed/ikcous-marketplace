// @vitest-environment jsdom
//
// Financeiro — a aba Impostos é baixada sob demanda, quando a lojista a abre. Se o arquivo
// dela não baixa (sinal ruim no primeiro toque, versão nova no ar que trocou o nome do
// arquivo), a falha fica PRESA na aba Impostos: ela mostra um aviso curto com "Tentar de
// novo" e o resto do Financeiro (cabeçalho, as outras abas, o botão de novo lançamento)
// segue como estava. Antes o erro subia até a tela de erro e derrubava o Financeiro inteiro.
//
// O que prova:
//   1  falha ao baixar: aviso dentro da aba, com "Tentar de novo"; as seis abas e o botão
//      "Novo lançamento" continuam na tela
//   2  as outras abas seguem funcionando (Visão, Extrato): abrem, sem o aviso
//   3  voltar para Impostos sem "Tentar de novo" mostra o aviso de novo (nunca tela em branco)
//   4  abrindo direto em Impostos (abaInicial) com o arquivo fora: o Financeiro abre e o
//      aviso está na aba
//   5  "Tentar de novo" com o arquivo AINDA fora: continua o aviso (não quebra nem fica
//      girando) e o arquivo é pedido de novo; na tentativa seguinte, com o arquivo de
//      volta, a aba abre e o aviso some
//
// O módulo da aba é trocado por um que falha enquanto `servidor.ok` for falso (getter: o
// vitest guarda o resultado da fábrica entre os testes). A aba de verdade é provada em
// `financeiro-aba-impostos-no-fim-da-fila.test.tsx`. Supabase falso, fixtures inventadas.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const { rpcFalso, servidor, pedidosDoModulo } = vi.hoisted(() => ({
  rpcFalso: vi.fn(),
  servidor: { ok: false },
  pedidosDoModulo: { total: 0 },
}));

vi.mock("@/lib/supabase", () => {
  const construtor = () => {
    const c: Record<string, unknown> = Object.fromEntries(
      ["select", "eq", "neq", "gte", "lte", "order", "limit"].map((metodo) => [
        metodo,
        () => c,
      ]),
    );
    c.maybeSingle = () => c;
    // biome-ignore lint/suspicious/noThenProperty: dublê do query builder thenable do Supabase
    c.then = (
      resolver: (v: unknown) => unknown,
      rejeitar?: (e: unknown) => unknown,
    ) => Promise.resolve({ data: [], error: null }).then(resolver, rejeitar);
    return c;
  };
  return {
    supabase: {
      rpc: rpcFalso,
      from: () => construtor(),
      auth: {
        getSession: async () => ({ data: { session: null }, error: null }),
      },
    },
  };
});
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/components/admin/financeiro/FluxoDeCaixaGrafico", () => ({
  FluxoDeCaixaGrafico: () => null,
}));
vi.mock("@/components/admin/financeiro/impostos/AbaImpostos", async () => {
  const { createElement } = await import("react");
  const Aba = () =>
    createElement(
      "section",
      { "data-testid": "aba-impostos-ok", "aria-label": "Aba de teste" },
      "aba Impostos aberta",
    );
  return {
    get AbaImpostos() {
      pedidosDoModulo.total += 1;
      if (!servidor.ok) {
        throw new TypeError(
          "Failed to fetch dynamically imported module: http://x/assets/AbaImpostos-abc.js",
        );
      }
      return Aba;
    },
  };
});

import { AdminFinanceiroView } from "@/views/admin/AdminFinanceiroView";

const normalizar = (t: string | null | undefined) =>
  (t ?? "").replace(/\s+/g, " ").trim();

const RESUMO = {
  periodo: { inicio: "2026-11-01", fim: "2026-11-30" },
  saldo_total: 0,
  contas: [],
  entradas: 0,
  saidas: 0,
  resultado: 0,
  a_receber: { total: 0, vencido: 0, proximos_7_dias: 0 },
  a_pagar: { total: 0, vencido: 0, proximos_7_dias: 0 },
  por_forma: [],
  por_canal: { online: 0, presencial: 0 },
  serie: [],
  caixa_aberto: null,
};

describe("Financeiro — aba Impostos que não baixou", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    localStorage.clear();
    servidor.ok = false;
    pedidosDoModulo.total = 0;
    rpcFalso.mockReset();
    rpcFalso.mockImplementation(async (nome: string) => {
      if (nome === "fin_resumo") return { data: RESUMO, error: null };
      if (nome === "fin_caixa_atual")
        return { data: { sessao: null }, error: null };
      return { data: [], error: null };
    });
    // O limite de erro avisa no console, e o React também (erro capturado).
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    localStorage.clear();
    vi.restoreAllMocks();
  });

  async function assentar() {
    for (let i = 0; i < 6; i += 1) {
      await act(async () => {
        await new Promise((resolver) => setTimeout(resolver, 0));
      });
    }
  }

  async function esperarAte(condicao: () => boolean, teto = 20_000) {
    const limite = Date.now() + teto;
    while (!condicao() && Date.now() < limite) {
      await act(async () => {
        await new Promise((resolver) => setTimeout(resolver, 25));
      });
    }
    await assentar();
  }

  async function montar(abaInicial?: string | null) {
    await act(async () => {
      raiz.render(
        <AdminFinanceiroView
          onNavigate={vi.fn()}
          active={true}
          abaInicial={abaInicial}
        />,
      );
    });
    await assentar();
  }

  const abas = () => [
    ...hospedeiro.querySelectorAll<HTMLElement>('[role="tab"]'),
  ];
  const nomesDasAbas = () => abas().map((a) => normalizar(a.textContent));
  const abaAtiva = () =>
    normalizar(
      hospedeiro.querySelector('[role="tab"][data-state="active"]')
        ?.textContent,
    );
  const alerta = () =>
    hospedeiro.querySelector<HTMLElement>('[role="tabpanel"] [role="alert"]');
  const abaAberta = () =>
    hospedeiro.querySelector('[data-testid="aba-impostos-ok"]');
  const botaoPorRotulo = (rotulo: string) =>
    [...hospedeiro.querySelectorAll<HTMLButtonElement>("button")].find(
      (b) => normalizar(b.textContent) === rotulo,
    );
  const novoLancamento = () =>
    hospedeiro.querySelector('button[aria-label="Novo lançamento"]');

  async function abrirAba(rotulo: string) {
    const aba = abas().find((a) => normalizar(a.textContent) === rotulo);
    if (!aba) throw new Error(`aba não achada: ${rotulo}`);
    await act(async () => {
      aba.dispatchEvent(
        new MouseEvent("mousedown", { bubbles: true, button: 0 }),
      );
    });
    await assentar();
  }

  /** Abre Impostos com o arquivo fora e espera o aviso aparecer. */
  async function abrirImpostosComArquivoFora() {
    await montar();
    await abrirAba("Impostos");
    await esperarAte(() => alerta() !== null);
  }

  it("falha ao baixar: o aviso fica DENTRO da aba, e o resto do Financeiro continua na tela", async () => {
    await abrirImpostosComArquivoFora();

    expect(pedidosDoModulo.total).toBeGreaterThan(0);
    expect(abaAtiva()).toBe("Impostos");
    expect(alerta()?.textContent).toContain("Esta parte não abriu");
    expect(botaoPorRotulo("Tentar de novo")).toBeDefined();
    expect(abaAberta()).toBeNull();
    // o Financeiro não caiu: as seis abas e o botão de novo lançamento seguem aí
    expect(nomesDasAbas()).toEqual([
      "Visão",
      "Caixa",
      "Extrato",
      "Pagar e receber",
      "Resultado",
      "Impostos",
    ]);
    expect(novoLancamento()).not.toBeNull();
    expect(normalizar(hospedeiro.textContent)).toContain(
      "Seu regime e suas guias",
    );
  });

  it("as outras abas seguem funcionando: abrem, sem o aviso da aba que falhou", async () => {
    await abrirImpostosComArquivoFora();

    await abrirAba("Extrato");
    expect(abaAtiva()).toBe("Extrato");
    expect(alerta()?.textContent ?? "").not.toContain("Esta parte não abriu");
    expect(hospedeiro.querySelector('[role="tabpanel"]')).not.toBeNull();

    await abrirAba("Visão");
    expect(abaAtiva()).toBe("Visão");
    expect(hospedeiro.textContent ?? "").not.toContain("Esta parte não abriu");
    expect(novoLancamento()).not.toBeNull();
  });

  it("voltar para Impostos sem 'Tentar de novo': o aviso aparece de novo (nunca tela em branco)", async () => {
    await abrirImpostosComArquivoFora();
    await abrirAba("Visão");

    await abrirAba("Impostos");
    await esperarAte(() => alerta() !== null);
    expect(abaAtiva()).toBe("Impostos");
    expect(alerta()?.textContent).toContain("Esta parte não abriu");
    expect(botaoPorRotulo("Tentar de novo")).toBeDefined();
  });

  it("abrindo direto em Impostos com o arquivo fora: o Financeiro abre e o aviso está na aba", async () => {
    await montar("impostos");
    await esperarAte(() => alerta() !== null);

    expect(abaAtiva()).toBe("Impostos");
    expect(alerta()?.textContent).toContain("Esta parte não abriu");
    expect(nomesDasAbas()).toHaveLength(6);
    expect(novoLancamento()).not.toBeNull();
  });

  // ESTE TESTE TEM DE SER O ÚLTIMO DO ARQUIVO: o pedaço é um módulo único (o `lazy` guarda
  // o componente que baixou), então depois da primeira abertura com sucesso nenhum teste
  // consegue mais ver a falha.
  it("'Tentar de novo' com o arquivo AINDA fora: continua o aviso e pede o arquivo de novo; com o arquivo de volta, abre e o aviso some", async () => {
    await abrirImpostosComArquivoFora();

    // 1ª tentativa, arquivo ainda fora: pede o arquivo DE NOVO (não fica preso na falha
    // guardada) e o aviso continua, sem quebrar nem ficar girando.
    const pedidosAntes = pedidosDoModulo.total;
    await act(async () => {
      botaoPorRotulo("Tentar de novo")?.click();
    });
    await esperarAte(() => pedidosDoModulo.total > pedidosAntes);
    expect(pedidosDoModulo.total).toBeGreaterThan(pedidosAntes);
    await esperarAte(() => alerta() !== null);
    expect(alerta()?.textContent).toContain("Esta parte não abriu");
    expect(abaAberta()).toBeNull();

    // 2ª tentativa, arquivo de volta: a aba abre e o aviso some.
    servidor.ok = true;
    await act(async () => {
      botaoPorRotulo("Tentar de novo")?.click();
    });
    await esperarAte(() => abaAberta() !== null);
    expect(abaAberta()).not.toBeNull();
    expect(alerta()).toBeNull();
    expect(abaAtiva()).toBe("Impostos");
    expect(nomesDasAbas()).toHaveLength(6);
  });
});
