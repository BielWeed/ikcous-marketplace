// @vitest-environment jsdom
//
// Revisão independente: a ligação entre `AbaVisao` e
// `FluxoDeCaixaGrafico` — passar `marco` para `serieDoFluxoDeCaixa` E para o
// componente — não tinha teste de INTEGRAÇÃO nenhum. `serieDoFluxoDeCaixa`
// tem `marco: DataIso | null = null` como default, então tirar o 4º
// argumento da chamada em AbaVisao.tsx passa DESPERCEBIDO pelo typecheck E
// pelos testes unitários da função pura (que chamam `marco` explicitamente) —
// só um teste que renderiza a ABA DE VERDADE, com contas reais vindas do
// mock de `fin_contas_listar`, pega essa regressão.
//
// Monta `AdminFinanceiroView` inteira (aba "Visão" é a inicial) com
// `@/lib/supabase` dublado e `FluxoDeCaixaGrafico` trocado por um espião que
// só guarda as props recebidas — mede o que a `AbaVisao` de verdade calcula e
// entrega, sem depender do recharts.
//
// Prova de mutação: comentei o `marco,` da chamada de `serieDoFluxoDeCaixa`
// em `AbaVisao.tsx` (~linha 284) e rodei só este arquivo — o teste
// "o gráfico recebe saldo null…" caiu (`saldo` virou um número, não `null`).
// Restaurei a linha antes de terminar; ver o relatório para a saída real.
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
    readonly marco: string | null;
  }>,
}));
vi.mock("@/components/admin/financeiro/FluxoDeCaixaGrafico", () => ({
  FluxoDeCaixaGrafico: (props: (typeof propsCapturadas)[number]) => {
    propsCapturadas.push(props);
    return null;
  },
}));

import { hojeEmSaoPaulo } from "@/lib/financeiro";
import { AdminFinanceiroView } from "@/views/admin/AdminFinanceiroView";

// Hoje fixo (só o `Date`, não os timers — `Promise.resolve()` real segue
// resolvendo normalmente): a view lê `hojeEmSaoPaulo()` do relógio de
// verdade, e a janela de 30 dias (29/08–27/09) precisa bater com o marco e
// a série que o mock de `fin_resumo` devolve. Meio-dia em Brasília, bem
// longe da virada de dia nos dois fusos.
const HOJE = "2026-09-27";
const AGORA_FAKE = new Date("2026-09-27T15:00:00.000Z");
const MARCO = "2026-09-10";

const CONTA = {
  id: "11111111-1111-4111-8111-111111111111",
  nome: "Caixa da loja",
  tipo: "caixa",
  saldo_inicial: 0,
  saldo_inicial_em: MARCO,
  ativa: true,
  ordem: 1,
  sistema: true,
  saldo: 0,
};

function respostaResumo() {
  return {
    data: {
      periodo: { inicio: "2026-08-29", fim: "2026-09-27" },
      saldo_total: 0,
      contas: [],
      entradas: 187.4,
      saidas: 0,
      resultado: 187.4,
      a_receber: { total: 0, vencido: 0, proximos_7_dias: 0 },
      a_pagar: { total: 0, vencido: 0, proximos_7_dias: 0 },
      por_forma: [],
      por_canal: { online: 0, presencial: 0 },
      // Um único PIX em 18/09 — dias antes do marco (10/09) ficam sem saldo
      // conhecido; dias do marco até o PIX (10 a 17/09) têm saldo −187,40,
      // um valor de VERDADE (o saldo_inicial que a conta declarou); do PIX
      // em diante, 0.
      serie: [{ dia: "2026-09-18", entradas: 187.4, saidas: 0 }],
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

describe("AbaVisao — o marco do saldo inicial chega de verdade no FluxoDeCaixaGrafico", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  // Confere o relógio falso ANTES de confiar nele: se `AGORA_FAKE` não cair
  // no dia certo em São Paulo, todo o resto do teste (janela de 30 dias,
  // marco, série) mede a coisa errada sem avisar.
  it("sanidade: AGORA_FAKE cai em HOJE no calendário de São Paulo", () => {
    expect(hojeEmSaoPaulo(AGORA_FAKE)).toBe(HOJE);
  });

  beforeEach(async () => {
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
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    vi.useRealTimers();
  });

  it("o gráfico recebe saldo null antes do marco e o marco certo — não é o default null da função pura", () => {
    expect(propsCapturadas.length).toBeGreaterThan(0);
    const últimasProps = propsCapturadas.at(-1)!;

    // Se `marco` nunca chegasse (o mutante: tirar o 4º argumento da chamada
    // de `serieDoFluxoDeCaixa` em AbaVisao.tsx), `serieDoFluxoDeCaixa` usa o
    // default `null` — a prop `marco` do componente também seria `null`, e
    // NENHUM ponto teria `saldo: null`. As três asserções abaixo caem juntas
    // nesse cenário.
    expect(últimasProps.marco).toBe(MARCO);

    const antesDoMarco = últimasProps.pontos.find(
      (p) => p.dia === "2026-09-05",
    );
    expect(antesDoMarco).toBeTruthy();
    expect(antesDoMarco?.saldo).toBeNull();

    const depoisDoMarco = últimasProps.pontos.find(
      (p) => p.dia === "2026-09-15",
    );
    expect(depoisDoMarco).toBeTruthy();
    expect(depoisDoMarco?.saldo).toBe(-187.4);
  });
});
