// @vitest-environment jsdom
//
// O caixa pertence ao dia em que abriu (migration 20261654000000): o servidor liga à
// sessão ainda aberta o que foi pago entre o dia da ABERTURA e hoje. O caixa aberto em
// 30/11 e mexido às 00:40 de 01/12 recebe o gasto "pago em 30/11"; o aviso da folha de
// lançamento dizia "use a data de hoje", o que empurrava a lojista para 01/12. Agora,
// com caixa aberto de um dia anterior, o aviso só aparece antes do dia da abertura e
// fala da data do caixa aberto. Caixa de um dia só (ou sem caixa conhecido): igual.
//
// Sem @testing-library: `createRoot` + `act`, padrão da casa.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const { rpcFalso } = vi.hoisted(() => ({ rpcFalso: vi.fn() }));
vi.mock("@/lib/supabase", () => ({ supabase: { rpc: rpcFalso } }));
vi.mock("sonner", () => ({
  toast: {
    success: vi.fn<() => void>(),
    error: vi.fn<() => void>(),
    info: vi.fn<() => void>(),
  },
}));
vi.mock("@/components/admin/financeiro/FluxoDeCaixaGrafico", () => ({
  FluxoDeCaixaGrafico: () => null,
}));

import { NovoLancamentoFolha } from "@/components/admin/financeiro/NovoLancamentoFolha";
import { diaDaAberturaDoCaixa } from "@/lib/financeiro";
import {
  CONTA_BANCARIA,
  CONTA_CAIXA_DA_LOJA,
  type CategoriaFinanceira,
  type ContaFinanceira,
} from "@/types/financeiro";
import { AdminFinanceiroView } from "@/views/admin/AdminFinanceiroView";
import { escolherNaLista } from "./helpers/lista-de-escolha";

const HOJE = "2026-12-01";
const ABERTURA = "2026-11-30";
const ANTES_DA_ABERTURA = "2026-11-29";

const AVISO_ANTIGO =
  "Este valor não entra na conferência do caixa aberto. Se o dinheiro saiu ou entrou na gaveta hoje, use a data de hoje.";
const AVISO_ANTIGO_TRANSFERENCIA =
  "Esta transferência com a conta Caixa não entra na conferência do caixa aberto. Se o dinheiro saiu ou entrou na gaveta hoje, use a data de hoje.";
const AVISO_DO_DIA =
  "Este valor não entra na conferência do caixa aberto em 30/11/2026. Se o dinheiro saiu ou entrou na gaveta depois que esse caixa abriu, use a data de 30/11/2026 ou uma mais recente.";
const AVISO_DO_DIA_TRANSFERENCIA =
  "Esta transferência com a conta Caixa não entra na conferência do caixa aberto em 30/11/2026. Se o dinheiro saiu ou entrou na gaveta depois que esse caixa abriu, use a data de 30/11/2026 ou uma mais recente.";

const CONTAS: ContaFinanceira[] = [
  {
    id: CONTA_CAIXA_DA_LOJA,
    nome: "Caixa da loja",
    tipo: "caixa",
    saldoInicial: 0,
    saldoInicialEm: "2026-01-01",
    ativa: true,
    ordem: 1,
    sistema: true,
    saldo: 300,
  },
  {
    id: CONTA_BANCARIA,
    nome: "Conta bancária",
    tipo: "banco",
    saldoInicial: 0,
    saldoInicialEm: "2026-01-01",
    ativa: true,
    ordem: 2,
    sistema: true,
    saldo: 5000,
  },
];

const CATEGORIAS: CategoriaFinanceira[] = [
  {
    id: "cat-aluguel",
    nome: "Aluguel",
    natureza: "despesa",
    grupoDre: "despesa_fixa",
    ativa: true,
    sistema: false,
  },
];

const CHAVE = "conferência do caixa aberto";
const avisos = () =>
  [...document.querySelectorAll('[role="status"]')]
    .filter((el) => (el.textContent ?? "").includes(CHAVE))
    .map((el) => (el.textContent ?? "").replace(/\s+/g, " ").trim());

function botao(rotulo: string): HTMLButtonElement {
  const achado = [...document.querySelectorAll("button")].find(
    (b) => (b.textContent ?? "").trim() === rotulo,
  );
  if (!achado) throw new Error(`botão "${rotulo}" não existe`);
  return achado as HTMLButtonElement;
}

async function esperar() {
  for (let i = 0; i < 4; i += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

async function clicar(el: HTMLElement) {
  await act(async () => {
    el.click();
  });
  await esperar();
}

async function escolher(id: string, valor: string) {
  await act(async () => {
    escolherNaLista(id, valor);
  });
}

async function mudarData(id: string, valor: string) {
  const el = document.getElementById(id) as HTMLInputElement;
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set?.call(el, valor);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function digitar(id: string, valor: string) {
  const el = document.getElementById(id) as HTMLInputElement;
  await act(async () => {
    el.focus();
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set?.call(el, valor);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => {
    el.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
  });
}

let raiz: Root | null = null;
let hospedeiro: HTMLDivElement | null = null;

afterEach(() => {
  if (raiz) act(() => raiz?.unmount());
  hospedeiro?.remove();
  raiz = null;
  hospedeiro = null;
  rpcFalso.mockReset();
  vi.useRealTimers();
});

async function abrirFolha(diaDoCaixaAberto?: string | null) {
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
  await act(async () => {
    raiz?.render(
      <NovoLancamentoFolha
        autorId="dona-da-loja"
        hoje={HOJE}
        contas={CONTAS}
        categorias={CATEGORIAS}
        diaDoCaixaAberto={diaDoCaixaAberto}
        aoFechar={vi.fn()}
        aoSalvar={vi.fn()}
        aoMudarSujo={vi.fn()}
      />,
    );
  });
}

describe("dia do caixa aberto, lido do instante da abertura em Brasília", () => {
  it("09:00 de 30/11 em Brasília é 30/11; 23:30 de 30/11 em Brasília (02:30Z de 01/12) também", () => {
    expect(diaDaAberturaDoCaixa("2026-11-30T12:00:00Z")).toBe("2026-11-30");
    expect(diaDaAberturaDoCaixa("2026-12-01T02:30:00Z")).toBe("2026-11-30");
    expect(diaDaAberturaDoCaixa("2026-12-01T03:00:00Z")).toBe("2026-12-01");
  });

  it("instante vazio ou inválido não vira dia (nada de aviso inventado)", () => {
    expect(diaDaAberturaDoCaixa("")).toBeNull();
    expect(diaDaAberturaDoCaixa("ontem")).toBeNull();
    expect(diaDaAberturaDoCaixa(null)).toBeNull();
    expect(diaDaAberturaDoCaixa(undefined)).toBeNull();
  });
});

describe("folha de lançamento com caixa aberto de um dia anterior (30/11, hoje 01/12)", () => {
  it("gasto pago no dia da abertura, no Caixa: sem aviso (ele entra no caixa de 30/11)", async () => {
    await abrirFolha(ABERTURA);
    await escolher("fin-lanc-conta", CONTA_CAIXA_DA_LOJA);
    await mudarData("fin-lanc-realizacao", ABERTURA);
    expect(avisos()).toEqual([]);
  });

  it("gasto com a data de hoje, no Caixa: sem aviso", async () => {
    await abrirFolha(ABERTURA);
    await escolher("fin-lanc-conta", CONTA_CAIXA_DA_LOJA);
    await mudarData("fin-lanc-realizacao", HOJE);
    expect(avisos()).toEqual([]);
  });

  it("gasto de antes da abertura, no Caixa: avisa e fala da data do caixa aberto", async () => {
    await abrirFolha(ABERTURA);
    await escolher("fin-lanc-conta", CONTA_CAIXA_DA_LOJA);
    await mudarData("fin-lanc-realizacao", ANTES_DA_ABERTURA);
    expect(avisos()).toEqual([AVISO_DO_DIA]);
  });

  it("receita de antes da abertura, no Caixa: o mesmo aviso", async () => {
    await abrirFolha(ABERTURA);
    await clicar(botao("Receita"));
    await escolher("fin-lanc-conta", CONTA_CAIXA_DA_LOJA);
    await mudarData("fin-lanc-realizacao", ANTES_DA_ABERTURA);
    expect(avisos()).toEqual([AVISO_DO_DIA]);
  });

  it("transferência para o Caixa no dia da abertura: sem aviso; antes dela: o texto da transferência", async () => {
    await abrirFolha(ABERTURA);
    await clicar(botao("Transferência"));
    await escolher("fin-lanc-conta", CONTA_BANCARIA);
    await escolher("fin-lanc-conta-destino", CONTA_CAIXA_DA_LOJA);
    await mudarData("fin-lanc-realizacao", ABERTURA);
    expect(avisos()).toEqual([]);
    await mudarData("fin-lanc-realizacao", ANTES_DA_ABERTURA);
    expect(avisos()).toEqual([AVISO_DO_DIA_TRANSFERENCIA]);
  });

  it("outra conta (banco) antes da abertura: sem aviso", async () => {
    await abrirFolha(ABERTURA);
    await escolher("fin-lanc-conta", CONTA_BANCARIA);
    await mudarData("fin-lanc-realizacao", ANTES_DA_ABERTURA);
    expect(avisos()).toEqual([]);
  });

  it("'a pagar' não avisa, mesmo antes da abertura", async () => {
    await abrirFolha(ABERTURA);
    await escolher("fin-lanc-conta", CONTA_CAIXA_DA_LOJA);
    await mudarData("fin-lanc-realizacao", ANTES_DA_ABERTURA);
    expect(avisos()).toHaveLength(1);
    await clicar(botao("A pagar"));
    expect(avisos()).toEqual([]);
  });

  it("salvar com a data da abertura manda a data como a lojista escolheu", async () => {
    rpcFalso.mockResolvedValue({ data: { ids: ["x"] }, error: null });
    await abrirFolha(ABERTURA);
    await digitar("fin-lanc-valor", "2500");
    await digitar("fin-lanc-descricao", "Troco do motoboy");
    await escolher("fin-lanc-categoria", "cat-aluguel");
    await escolher("fin-lanc-conta", CONTA_CAIXA_DA_LOJA);
    await mudarData("fin-lanc-realizacao", ABERTURA);
    await clicar(botao("Salvar lançamento"));
    expect(rpcFalso).toHaveBeenCalledTimes(1);
    const [nome, args] = rpcFalso.mock.calls[0] as [
      string,
      { p: Record<string, unknown> },
    ];
    expect(nome).toBe("fin_lancamento_salvar");
    expect(args.p.data_realizacao).toBe(ABERTURA);
    expect(args.p.conta_id).toBe(CONTA_CAIXA_DA_LOJA);
  });
});

describe("caixa de um dia só ou desconhecido: o aviso de antes, igual", () => {
  for (const [rotulo, dia] of [
    ["caixa aberto hoje", HOJE],
    ["sem caixa conhecido (null)", null],
    ["sem a informação (prop ausente)", undefined],
    // Relógio do aparelho atrasado: dia da abertura DEPOIS de hoje não abre janela nenhuma.
    ["dia da abertura depois de hoje", "2026-12-02"],
  ] as const) {
    it(`${rotulo}: ontem no Caixa avisa com o texto antigo; hoje não avisa`, async () => {
      await abrirFolha(dia);
      await escolher("fin-lanc-conta", CONTA_CAIXA_DA_LOJA);
      await mudarData("fin-lanc-realizacao", ABERTURA);
      expect(avisos()).toEqual([AVISO_ANTIGO]);
      await mudarData("fin-lanc-realizacao", HOJE);
      expect(avisos()).toEqual([]);
    });
  }

  it("caixa aberto hoje, transferência de ontem com o Caixa: o texto antigo da transferência", async () => {
    await abrirFolha(HOJE);
    await clicar(botao("Transferência"));
    await escolher("fin-lanc-conta", CONTA_CAIXA_DA_LOJA);
    await escolher("fin-lanc-conta-destino", CONTA_BANCARIA);
    await mudarData("fin-lanc-realizacao", ABERTURA);
    expect(avisos()).toEqual([AVISO_ANTIGO_TRANSFERENCIA]);
  });
});

describe("a tela do Financeiro passa o dia do caixa aberto para a folha", () => {
  const CONTAS_DO_BANCO = CONTAS.map((c) => ({
    id: c.id,
    nome: c.nome,
    tipo: c.tipo,
    saldo_inicial: c.saldoInicial,
    saldo_inicial_em: c.saldoInicialEm,
    ativa: c.ativa,
    ordem: c.ordem,
    sistema: c.sistema,
    saldo: c.saldo,
  }));
  const sessao = (abertoEm: string) => ({
    id: "sessao-1",
    conta_id: CONTA_CAIXA_DA_LOJA,
    conta_nome: "Caixa da loja",
    aberto_em: abertoEm,
    valor_abertura: 150,
    vendas_dinheiro: 0,
    devolucoes_dinheiro: 0,
    entradas_manuais: 0,
    saidas_manuais: 0,
    esperado: 150,
    movimentos: [],
  });

  async function abrirTela(caixa: unknown) {
    vi.useFakeTimers({ toFake: ["Date"] });
    // 01/12/2026, 00:40 em Brasília (UTC−3).
    vi.setSystemTime(new Date("2026-12-01T03:40:00Z"));
    rpcFalso.mockImplementation(async (nome: string) => {
      switch (nome) {
        case "fin_contas_listar":
          return { data: CONTAS_DO_BANCO, error: null };
        case "fin_caixa_atual":
          return { data: caixa, error: null };
        case "fin_resumo":
          return { data: { saldo_total: 0 }, error: null };
        default:
          return { data: [], error: null };
      }
    });
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
    await act(async () => {
      raiz?.render(
        <AdminFinanceiroView
          onNavigate={vi.fn()}
          active
          onSetBackOverride={vi.fn()}
          onSetDirty={vi.fn()}
        />,
      );
    });
    await esperar();
    await clicar(botao("Novo lançamento"));
    await escolher("fin-lanc-conta", CONTA_CAIXA_DA_LOJA);
  }

  it("caixa aberto às 09:00 de 30/11, agora 00:40 de 01/12: 30/11 sem aviso, 29/11 com a data do caixa", async () => {
    await abrirTela(sessao("2026-11-30T12:00:00Z"));
    await mudarData("fin-lanc-realizacao", ABERTURA);
    expect(avisos()).toEqual([]);
    await mudarData("fin-lanc-realizacao", ANTES_DA_ABERTURA);
    expect(avisos()).toEqual([AVISO_DO_DIA]);
  });

  it("caixa fechado: ontem no Caixa avisa com o texto antigo", async () => {
    await abrirTela(null);
    await mudarData("fin-lanc-realizacao", ABERTURA);
    expect(avisos()).toEqual([AVISO_ANTIGO]);
  });
});
