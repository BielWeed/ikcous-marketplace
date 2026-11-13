// @vitest-environment jsdom
//
// Defeito: o Financeiro aberto de 23h59 a 00h01 (São Paulo) seguia mostrando
// os números de ontem. O servidor calcula "a pagar / a receber" (vencidos e
// próximos 7 dias), o saldo e o que já virou "realizado" com o dia de HOJE
// dele; mas a chave de cada consulta é o período (início/fim), e o período
// "Mês atual" não muda na virada — então nada era lido de novo até a lojista
// trocar de aba ou o foco voltar. Agora a virada do dia relê tudo, em silêncio.
// Relógio falso cruzando a meia-noite de São Paulo (UTC−3: 03:00Z).
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

import { AdminFinanceiroView } from "@/views/admin/AdminFinanceiroView";

const ANTES_DA_MEIA_NOITE = "2026-11-13T02:59:50Z"; // 12/11, 23:59:50 em SP
const DEPOIS_DA_MEIA_NOITE = "2026-11-13T03:00:10Z"; // 13/11, 00:00:10 em SP
const MES = { p_inicio: "2026-11-01", p_fim: "2026-11-30" };

const leiturasDoResumoDoMes = () =>
  rpcFalso.mock.calls.filter(
    ([nome, args]) =>
      nome === "fin_resumo" &&
      (args as typeof MES).p_inicio === MES.p_inicio &&
      (args as typeof MES).p_fim === MES.p_fim,
  );
const leiturasDe = (rpc: string) =>
  rpcFalso.mock.calls.filter(([nome]) => nome === rpc);

async function esperar() {
  for (let i = 0; i < 4; i += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

async function avancar(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
  await esperar();
}

function botaoEm(raiz: ParentNode, rotulo: string): HTMLButtonElement {
  const el = [...raiz.querySelectorAll("button")].find(
    (b) => (b.textContent ?? "").trim() === rotulo,
  );
  if (!el) throw new Error(`botão ${rotulo} não existe`);
  return el;
}

describe("Financeiro — acompanha a virada do dia", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    vi.setSystemTime(new Date(ANTES_DA_MEIA_NOITE));
    rpcFalso.mockReset();
    rpcFalso.mockImplementation(async (nome: string) => {
      if (nome === "fin_resumo") {
        return { data: { saldo_total: 0 }, error: null };
      }
      return { data: [], error: null };
    });
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
    Reflect.deleteProperty(document, "visibilityState");
    vi.useRealTimers();
  });

  async function desenhar(ativo: boolean) {
    await act(async () => {
      raiz.render(
        <AdminFinanceiroView
          onNavigate={vi.fn()}
          active={ativo}
          onSetBackOverride={vi.fn()}
          onSetDirty={vi.fn()}
        />,
      );
    });
    await esperar();
  }

  it("com a tela aberta na virada do dia, o resumo do mês e as contas são lidos de novo", async () => {
    await desenhar(true);
    const resumoAntes = leiturasDoResumoDoMes().length;
    const contasAntes = leiturasDe("fin_contas_listar").length;
    expect(resumoAntes).toBeGreaterThan(0);

    await avancar(12_000); // o temporizador da meia-noite dispara aos ~11 s

    expect(leiturasDoResumoDoMes().length).toBe(resumoAntes + 1);
    expect(leiturasDe("fin_contas_listar").length).toBe(contasAntes + 1);
  });

  it("controle: sem virada de dia, passar o tempo e o foco não relê nada", async () => {
    await desenhar(true);
    const antes = rpcFalso.mock.calls.length;
    await act(async () => {
      vi.setSystemTime(new Date("2026-11-13T02:59:55Z"));
      window.dispatchEvent(new Event("focus"));
    });
    await avancar(2_000);
    expect(rpcFalso.mock.calls.length).toBe(antes);
  });

  it("tela inativa não consulta, nem na virada do dia", async () => {
    await desenhar(false);
    expect(rpcFalso).not.toHaveBeenCalled();
    await avancar(12_000);
    expect(rpcFalso).not.toHaveBeenCalled();
  });

  it("tela que fica ativa já no dia seguinte lê UMA vez só (sem rajada)", async () => {
    await desenhar(false);
    await act(async () => {
      vi.setSystemTime(new Date(DEPOIS_DA_MEIA_NOITE));
    });
    await desenhar(true);
    await avancar(1_000);
    expect(leiturasDoResumoDoMes().length).toBe(1);
    expect(leiturasDe("fin_contas_listar").length).toBe(1);
  });

  it("com uma folha aberta na virada, a leitura espera a folha fechar", async () => {
    await desenhar(true);
    await act(async () => botaoEm(hospedeiro, "Novo lançamento").click());
    await esperar();
    expect(
      document.querySelector('[data-slot="sheet-content"]'),
    ).not.toBeNull();
    const antes = leiturasDoResumoDoMes().length;

    await avancar(12_000);
    expect(leiturasDoResumoDoMes().length).toBe(antes);

    const fechar = document.querySelector<HTMLButtonElement>(
      '[aria-label="Fechar"]',
    );
    await act(async () => fechar?.click());
    await esperar();
    expect(leiturasDoResumoDoMes().length).toBe(antes + 1);
  });
});
