// @vitest-environment jsdom
//
// VERIFICAÇÃO DO PAGAMENTO (cartão em dúvida) — três bordas que o
// `verificacao-do-pagamento.test.tsx` deixava passar (achadas por mutação em
// `VerificacaoDoPagamento.tsx`):
//
//  1. a hora do cancelamento automático sai com DOIS dígitos ("às 09:05", não
//     "às 9:05") — o teste existente usava 15:00;
//  2. erro terminal com a frase da edge em BRANCO cai na frase padrão, nunca um
//     alerta vazio (o `role="alert"` apareceria sem texto nenhum);
//  3. a cadência do botão "Verificar de novo" é a do contrato — 30 s entre
//     consultas, no máximo 5 toques, 35 s de limite por consulta. O teste
//     existente importa as constantes do módulo, então trocar o valor delas
//     mudava a regra e o teste junto. Aqui os números do contrato estão
//     escritos: a consulta bate no Mercado Pago, e é esse o freio dela.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  INTERVALO_ENTRE_VERIFICACOES_MS,
  MAXIMO_DE_VERIFICACOES_PELO_BOTAO,
  TEMPO_LIMITE_DA_VERIFICACAO_MS,
  VerificacaoDoPagamento,
} from "@/components/checkout/VerificacaoDoPagamento";

const { criarPagamento } = vi.hoisted(() => ({ criarPagamento: vi.fn() }));
vi.mock("@/hooks/useOrders", () => ({
  useOrders: () => ({ criarPagamento }),
}));
vi.mock("@/lib/supabase", () => ({
  supabase: { rpc: vi.fn(), functions: { invoke: vi.fn() } },
}));

// @ts-expect-error flag interna do React, sem tipo público
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const PEDIDO = "3f2a1b8c-4d5e-4f60-9a7b-1c2d3e4f5a6b";

let raiz: Root;
let hospedeiro: HTMLDivElement;

beforeEach(() => {
  criarPagamento.mockReset();
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
});

afterEach(() => {
  act(() => {
    raiz.unmount();
  });
  hospedeiro.remove();
  vi.useRealTimers();
});

async function esvaziar() {
  for (let i = 0; i < 6; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

const texto = () => hospedeiro.textContent ?? "";
const botao = (rotulo: string) =>
  Array.from(hospedeiro.querySelectorAll("button")).find(
    (b) => (b.textContent ?? "").trim() === rotulo,
  ) as HTMLButtonElement | undefined;

describe("a cadência do botão é a do contrato (números escritos)", () => {
  it("30 s entre consultas, 5 toques no máximo, 35 s de limite por consulta", () => {
    expect(INTERVALO_ENTRE_VERIFICACOES_MS).toBe(30_000);
    expect(MAXIMO_DE_VERIFICACOES_PELO_BOTAO).toBe(5);
    expect(TEMPO_LIMITE_DA_VERIFICACAO_MS).toBe(35_000);
  });
});

describe("hora do cancelamento automático", () => {
  it("antes das dez da manhã mantém o zero: 'às 09:05'", async () => {
    // O instante nasce do relógio LOCAL, então a hora lida na tela é 09:05 em
    // qualquer fuso do CI.
    const cedo = new Date(2026, 10, 24, 9, 5).toISOString();
    await act(async () => {
      raiz.render(
        <VerificacaoDoPagamento
          orderId={PEDIDO}
          onVerMeusPedidos={vi.fn()}
          onRetomadaLiberada={vi.fn()}
          pontoDePartida={{
            verificacao: "sem_registro",
            canceladoAutomaticamenteAte: cedo,
          }}
        />,
      );
    });
    await esvaziar();
    expect(texto()).toContain("a partir de 24/11/2026 às 09:05.");
    expect(texto()).not.toContain("às 9:05");
    // Veio do ponto de partida: a tela não chamou a edge sozinha.
    expect(criarPagamento).not.toHaveBeenCalled();
  });
});

describe("resposta da consulta com dado em branco ou ilegível", () => {
  async function montarComResposta(resposta: unknown) {
    criarPagamento.mockResolvedValue(resposta);
    await act(async () => {
      raiz.render(
        <VerificacaoDoPagamento
          orderId={PEDIDO}
          onVerMeusPedidos={vi.fn()}
          onRetomadaLiberada={vi.fn()}
        />,
      );
    });
    await esvaziar();
  }

  it("data do cancelamento ilegível não vira 'Invalid Date': a frase sai sem data", async () => {
    await montarComResposta({
      verificacao: "sem_registro",
      canceladoAutomaticamenteAte: "isto não é uma data",
    });
    expect(texto()).toContain(
      "Se nenhuma cobrança aparecer, o pedido é cancelado automaticamente.",
    );
    expect(texto()).not.toContain("Invalid Date");
    expect(texto()).not.toContain("a partir de");
  });

  it("'em análise' com paymentId só de espaços não vale como order: consulta indisponível", async () => {
    await montarComResposta({ verificacao: "em_analise", paymentId: "   " });
    expect(texto()).not.toContain("Pagamento em análise pelo banco.");
    expect(hospedeiro.querySelector('[role="alert"]')?.textContent).toBe(
      "Não foi possível consultar o pagamento agora.",
    );
  });
});

describe("erro terminal da consulta com a frase em branco", () => {
  it("mostra a frase padrão — nunca um alerta vazio", async () => {
    criarPagamento.mockRejectedValue(
      Object.assign(new Error("   "), { terminal: true, httpStatus: 409 }),
    );
    await act(async () => {
      raiz.render(
        <VerificacaoDoPagamento
          orderId={PEDIDO}
          onVerMeusPedidos={vi.fn()}
          onRetomadaLiberada={vi.fn()}
        />,
      );
    });
    await esvaziar();
    const alerta = hospedeiro.querySelector('[role="alert"]');
    expect(alerta?.textContent).toBe("Este pedido não pode ser pago agora.");
    // Terminal: sem "Verificar de novo".
    expect(botao("Verificar de novo")).toBeUndefined();
  });

  it("a frase da edge, quando existe, é a que aparece", async () => {
    criarPagamento.mockRejectedValue(
      Object.assign(new Error("O prazo para pagar este pedido acabou."), {
        terminal: true,
        httpStatus: 409,
      }),
    );
    await act(async () => {
      raiz.render(
        <VerificacaoDoPagamento
          orderId={PEDIDO}
          onVerMeusPedidos={vi.fn()}
          onRetomadaLiberada={vi.fn()}
        />,
      );
    });
    await esvaziar();
    expect(hospedeiro.querySelector('[role="alert"]')?.textContent).toBe(
      "O prazo para pagar este pedido acabou.",
    );
  });
});
