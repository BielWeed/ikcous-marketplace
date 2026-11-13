// @vitest-environment jsdom
//
// A ligação entre `AbaVisao` e `serieDoFluxoDeCaixa` para o saldo do gráfico:
// quando o banco entrega `variacao_saldo` em todos os dias (PR #1612), o saldo
// de cada dia sai da variação só das contas ATIVAS; sem a chave (loja que
// ainda não recebeu a migration), o gráfico segue como sempre.
//
// `serieDoFluxoDeCaixa` tem `hoje` como 5º argumento opcional (default
// `null` = método de sempre), então tirar esse argumento da chamada em
// AbaVisao.tsx passa despercebido pelo typecheck e pelos testes da função
// pura. Só um teste que renderiza a aba de verdade pega isso.
//
// Cenário (hoje = 27/09; janela de 30 dias = 29/08 a 27/09; saldo total das
// contas ativas = 100): em 20/09 entraram 50 numa conta ativa e saíram 300 de
// uma conta DESATIVADA (entradas 50, saídas 300, variação das ativas +50).
// Saldo de verdade: até 19/09 = 50; de 20/09 em diante = 100. O método
// antigo (entradas − saídas) mostraria 350 até 19/09.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const { rpcFalso } = vi.hoisted(() => ({ rpcFalso: vi.fn() }));
vi.mock("@/lib/supabase", () => ({ supabase: { rpc: rpcFalso } }));

const { propsCapturadas } = vi.hoisted(() => ({
  propsCapturadas: [] as Array<{
    readonly pontos: readonly { dia: string; saldo: number | null }[];
  }>,
}));
vi.mock("@/components/admin/financeiro/FluxoDeCaixaGrafico", () => ({
  FluxoDeCaixaGrafico: (props: (typeof propsCapturadas)[number]) => {
    propsCapturadas.push(props);
    return null;
  },
}));

import { AdminFinanceiroView } from "@/views/admin/AdminFinanceiroView";

const AGORA_FAKE = new Date("2026-09-27T15:00:00.000Z");

const CONTA = {
  id: "11111111-1111-4111-8111-111111111111",
  nome: "Caixa da loja",
  tipo: "caixa",
  saldo_inicial: 0,
  saldo_inicial_em: "2026-08-01",
  ativa: true,
  ordem: 1,
  sistema: true,
  saldo: 100,
};

/** Os 30 dias de 29/08 a 27/09, como o banco devolve (um ponto por dia). */
function dias30(): string[] {
  const lista: string[] = [];
  for (let d = new Date("2026-08-29T12:00:00Z"); lista.length < 30; ) {
    lista.push(d.toISOString().slice(0, 10));
    d = new Date(d.getTime() + 86_400_000);
  }
  return lista;
}

let comVariacao = true;

function respostaResumo() {
  return {
    data: {
      periodo: { inicio: "2026-08-29", fim: "2026-09-27" },
      saldo_total: 100,
      contas: [],
      entradas: 50,
      saidas: 300,
      resultado: -250,
      a_receber: { total: 0, vencido: 0, proximos_7_dias: 0 },
      a_pagar: { total: 0, vencido: 0, proximos_7_dias: 0 },
      por_forma: [],
      por_canal: { online: 0, presencial: 0 },
      serie: dias30().map((dia) => ({
        dia,
        entradas: dia === "2026-09-20" ? 50 : 0,
        saidas: dia === "2026-09-20" ? 300 : 0,
        ...(comVariacao
          ? { variacao_saldo: dia === "2026-09-20" ? 50 : 0 }
          : {}),
      })),
      caixa_aberto: null,
    },
    error: null,
  };
}

rpcFalso.mockImplementation(async (nome: string) => {
  switch (nome) {
    case "fin_contas_listar":
      return { data: [CONTA], error: null };
    case "fin_categorias_listar":
      return { data: [], error: null };
    case "fin_resumo":
      return respostaResumo();
    default:
      return { data: null, error: null };
  }
});

async function esperar() {
  for (let i = 0; i < 4; i += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

describe("AbaVisao — o saldo do gráfico usa a variação só das contas ativas", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  async function montar() {
    propsCapturadas.length = 0;
    rpcFalso.mockClear();
    vi.useFakeTimers({ now: AGORA_FAKE, toFake: ["Date"] });
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
    await act(async () => {
      raiz.render(<AdminFinanceiroView onNavigate={vi.fn()} active />);
    });
    await esperar();
  }

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    vi.useRealTimers();
  });

  describe("banco com a variação_saldo", () => {
    beforeEach(async () => {
      comVariacao = true;
      await montar();
    });

    it("o gráfico mostra 50 antes de 20/09 e 100 de 20/09 em diante (não 350)", () => {
      expect(propsCapturadas.length).toBeGreaterThan(0);
      const { pontos } = propsCapturadas.at(-1)!;
      const saldo = (dia: string) => pontos.find((p) => p.dia === dia)?.saldo;
      expect(saldo("2026-09-19")).toBe(50);
      expect(saldo("2026-09-05")).toBe(50);
      expect(saldo("2026-09-20")).toBe(100);
      expect(saldo("2026-09-27")).toBe(100);
    });
  });

  describe("loja sem a migration (sem variacao_saldo)", () => {
    beforeEach(async () => {
      comVariacao = false;
      await montar();
    });

    it("o gráfico segue como sempre (entradas − saídas): 350 antes de 20/09", () => {
      expect(propsCapturadas.length).toBeGreaterThan(0);
      const { pontos } = propsCapturadas.at(-1)!;
      const saldo = (dia: string) => pontos.find((p) => p.dia === dia)?.saldo;
      expect(saldo("2026-09-19")).toBe(350);
      expect(saldo("2026-09-20")).toBe(100);
    });
  });
});
