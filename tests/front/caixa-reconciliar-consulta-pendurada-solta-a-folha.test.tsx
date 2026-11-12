// @vitest-environment jsdom
//
// Caixa do PDV — a conferência que vem depois de uma divergência ("este caixa já
// está aberto" em outro aparelho, sangria/fechamento com valores diferentes)
// relê o caixa atual e o histórico. Com a rede "pendurada" (conecta e não
// responde) essa releitura esperava para sempre: a folha ficava em "Abrindo…" com
// o botão travado e a janela sem poder fechar. Agora a espera tem prazo: estourou,
// a folha solta, explica e manda conferir o caixa antes de tentar de novo.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const { rpcFalso } = vi.hoisted(() => ({ rpcFalso: vi.fn() }));
vi.mock("@/lib/supabase", () => ({ supabase: { rpc: rpcFalso } }));

import { AbrirCaixaFolha } from "@/components/admin/financeiro/FolhasDoCaixa";
import { conferirCaixaParaReconciliar } from "@/hooks/useFinanceiro";
import { PRAZO_DA_CONSULTA_DO_PAINEL_MS } from "@/lib/prazo-da-requisicao";
import {
  CONTA_BANCARIA,
  CONTA_CAIXA_DA_LOJA,
  type ContaFinanceira,
} from "@/types/financeiro";

const CONTAS: ContaFinanceira[] = [CONTA_BANCARIA, CONTA_CAIXA_DA_LOJA].map(
  (id, i) => ({
    id,
    nome: id === CONTA_BANCARIA ? "Banco" : "Caixa",
    tipo: id === CONTA_BANCARIA ? ("banco" as const) : ("caixa" as const),
    saldoInicial: 0,
    saldoInicialEm: "2026-10-16",
    ativa: true,
    ordem: i + 1,
    sistema: true,
    saldo: 100,
  }),
);

const CAIXA_JA_ABERTO = {
  code: "23505",
  message: "duplicate key value violates unique constraint",
  details: null,
};

let raiz: Root;
let hospedeiro: HTMLDivElement;

const temBotao = (rotulo: string) =>
  [...document.querySelectorAll("button")].some(
    (b) => b.textContent?.trim() === rotulo,
  );
function botao(rotulo: string): HTMLButtonElement {
  const el = [...document.querySelectorAll("button")].find(
    (b) => b.textContent?.trim() === rotulo,
  );
  if (!el) throw new Error(`Botão ${rotulo} não existe`);
  return el;
}
async function passar(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}
async function digitarAbertura(valor: string) {
  const campo = document.getElementById(
    "fin-caixa-abertura",
  ) as HTMLInputElement;
  await act(async () => {
    campo.focus();
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set?.call(campo, valor);
    campo.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => {
    campo.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    await vi.advanceTimersByTimeAsync(150);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  rpcFalso.mockReset();
  localStorage.clear();
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
});
afterEach(async () => {
  await act(async () => raiz.unmount());
  hospedeiro.remove();
  vi.useRealTimers();
});

describe("conferirCaixaParaReconciliar", () => {
  it("consulta que nunca responde: rejeita ao estourar o prazo e não deixa timer pendurado", async () => {
    rpcFalso.mockImplementation(() => new Promise(() => {}));
    const resultado = conferirCaixaParaReconciliar().then(
      () => "resolveu",
      (erro: unknown) => erro,
    );

    await vi.advanceTimersByTimeAsync(PRAZO_DA_CONSULTA_DO_PAINEL_MS - 1_000);
    expect(vi.getTimerCount()).toBe(1);

    await vi.advanceTimersByTimeAsync(2_000);
    const erro = await resultado;
    expect(erro).toBeInstanceOf(Error);
    expect((erro as Error).message).toMatch(/demorou demais/);
    expect((erro as Error).message).toMatch(/confira o caixa/i);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("as duas consultas respondem cedo: resolve sem erro e sem timer pendente", async () => {
    // Sem caixa aberto (`null`) e histórico vazio: respostas válidas.
    rpcFalso.mockImplementation(async (nome: string) => ({
      data: nome === "fin_caixa_historico" ? [] : null,
      error: null,
    }));
    await expect(conferirCaixaParaReconciliar()).resolves.toBeUndefined();
    expect(rpcFalso).toHaveBeenCalledWith("fin_caixa_atual");
    expect(rpcFalso).toHaveBeenCalledWith("fin_caixa_historico", {
      p_limite: 30,
    });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("uma consulta devolve erro: o erro dela chega como antes", async () => {
    const recusa = { code: "42501", message: "sem permissão", details: null };
    rpcFalso.mockImplementation(async (nome: string) =>
      nome === "fin_caixa_historico"
        ? { data: null, error: recusa }
        : { data: null, error: null },
    );
    await expect(conferirCaixaParaReconciliar()).rejects.toBe(recusa);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("abrir caixa com o caixa já aberto em outro aparelho", () => {
  it("consulta de conferência pendurada: a folha solta, explica e volta a poder fechar", async () => {
    rpcFalso.mockImplementation((nome: string) => {
      if (nome === "fin_caixa_abrir") {
        return Promise.resolve({ data: null, error: CAIXA_JA_ABERTO });
      }
      // fin_caixa_atual e fin_caixa_historico: conectam e nunca respondem.
      return new Promise(() => {});
    });
    const aoSalvar = vi.fn();
    const aoMudarEnviando = vi.fn<(enviando: boolean) => void>();
    const aoReconciliar = vi.fn(async (mensagem: string) => {
      // Mesmo molde de AdminFinanceiroView.aoReconciliarCaixa.
      await conferirCaixaParaReconciliar();
      aoSalvar(mensagem);
    });

    await act(async () =>
      raiz.render(
        <AbrirCaixaFolha
          contas={CONTAS}
          aoReconciliar={aoReconciliar}
          aoMudarEnviando={aoMudarEnviando}
          aoFechar={vi.fn()}
          aoSalvar={aoSalvar}
          aoMudarSujo={vi.fn()}
        />,
      ),
    );
    await digitarAbertura("100,00");
    await act(async () => {
      botao("Abrir caixa").click();
    });
    await passar(0);

    // Conferindo no ar: botão trocado e travado, janela marcada como "enviando".
    expect(aoReconciliar).toHaveBeenCalledTimes(1);
    expect(temBotao("Abrindo…")).toBe(true);
    expect(botao("Abrindo…").disabled).toBe(true);
    expect(aoMudarEnviando).toHaveBeenLastCalledWith(true);

    await passar(PRAZO_DA_CONSULTA_DO_PAINEL_MS + 1_000);

    // Soltou: botão de volta e destravado, janela pode fechar, com a explicação.
    expect(temBotao("Abrindo…")).toBe(false);
    expect(botao("Abrir caixa").disabled).toBe(false);
    expect(aoMudarEnviando).toHaveBeenLastCalledWith(false);
    const texto = document.body.textContent ?? "";
    expect(texto).toMatch(/demorou demais para conferir o caixa/);
    expect(texto).toMatch(/Feche esta tela e confira o caixa/);
    expect(texto).not.toMatch(/Algo deu errado no servidor/);
    // Nada foi dado como conferido.
    expect(aoSalvar).not.toHaveBeenCalled();
  });
});
