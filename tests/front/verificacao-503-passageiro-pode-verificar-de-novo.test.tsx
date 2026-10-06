// @vitest-environment jsdom
//
// F3 (fase 3 dos pagamentos, 04/10/2026) — o 503 passageiro na VERIFICAÇÃO.
//
// A edge marca `terminal: true` também no 503 "Pagamento indisponível."
// (credencial do Mercado Pago que não pôde ser lida agora). Isso não fala do
// pedido: a consulta `verificar` não cobra nada, e repetir é seguro. Antes, a
// tela tratava o erro como fim de linha (só "Ver meus pedidos"); agora o 503
// cai em "indisponível" e mantém "Verificar de novo", com o limite de toques
// que já existia. 409/404/403 marcados terminal continuam terminais.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  INTERVALO_ENTRE_VERIFICACOES_MS,
  MAXIMO_DE_VERIFICACOES_PELO_BOTAO,
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

const erroDaEdge = (
  mensagem: string,
  extra: { terminal: boolean; httpStatus?: number },
) => Object.assign(new Error(mensagem), { cartaoEmAnalise: false, ...extra });

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
  vi.restoreAllMocks();
});

async function montar() {
  await act(async () => {
    raiz.render(
      <VerificacaoDoPagamento
        orderId={PEDIDO}
        onVerMeusPedidos={vi.fn()}
        onRetomadaLiberada={vi.fn()}
      />,
    );
  });
  for (let i = 0; i < 6; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

const botoes = () =>
  Array.from(hospedeiro.querySelectorAll("button")).map((b) =>
    (b.textContent ?? "").trim(),
  );
const botao = (rotulo: string) =>
  Array.from(hospedeiro.querySelectorAll("button")).find(
    (b) => (b.textContent ?? "").trim() === rotulo,
  ) as HTMLButtonElement | undefined;
const alerta = () => hospedeiro.querySelector('[role="alert"]')?.textContent;

describe("VerificacaoDoPagamento — 503 'Pagamento indisponível.' (terminal na edge)", () => {
  it("não vira fim de linha: alerta de indisponível e 'Verificar de novo' continuam na tela", async () => {
    criarPagamento.mockRejectedValue(
      erroDaEdge("Pagamento indisponível.", {
        terminal: true,
        httpStatus: 503,
      }),
    );
    await montar();

    expect(alerta()).toContain("Não foi possível consultar o pagamento agora.");
    expect(botoes()).toEqual(["Verificar de novo", "Ver meus pedidos"]);
  });

  it("o toque em 'Verificar de novo' consulta de novo, e o 'pago' que vem depois aparece (sem o limite de toques ser contornado)", async () => {
    vi.useFakeTimers();
    criarPagamento
      .mockRejectedValueOnce(
        erroDaEdge("Pagamento indisponível.", {
          terminal: true,
          httpStatus: 503,
        }),
      )
      .mockResolvedValueOnce({ verificacao: "pago", paymentId: "123" });
    await montar();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(INTERVALO_ENTRE_VERIFICACOES_MS);
    });
    expect(botao("Verificar de novo")?.disabled).toBe(false);

    await act(async () => {
      botao("Verificar de novo")?.click();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(criarPagamento).toHaveBeenCalledTimes(2);
    expect(hospedeiro.textContent).toContain("Pagamento recebido.");
  });

  it("o limite que já existia vale: depois de MAXIMO toques seguidos o botão some", async () => {
    vi.useFakeTimers();
    criarPagamento.mockRejectedValue(
      erroDaEdge("Pagamento indisponível.", {
        terminal: true,
        httpStatus: 503,
      }),
    );
    await montar();
    for (let i = 0; i < MAXIMO_DE_VERIFICACOES_PELO_BOTAO; i++) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(INTERVALO_ENTRE_VERIFICACOES_MS);
      });
      await act(async () => {
        botao("Verificar de novo")?.click();
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
    }
    expect(criarPagamento).toHaveBeenCalledTimes(
      1 + MAXIMO_DE_VERIFICACOES_PELO_BOTAO,
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(INTERVALO_ENTRE_VERIFICACOES_MS);
    });
    expect(hospedeiro.textContent).toContain("Você já verificou várias vezes");
  });

  for (const [rotulo, extra, mensagem] of [
    [
      "409 (prazo acabou)",
      { terminal: true, httpStatus: 409 },
      "O prazo para pagar este pedido acabou.",
    ],
    [
      "404 (não encontrado)",
      { terminal: true, httpStatus: 404 },
      "Pedido não encontrado.",
    ],
    [
      "403 (exige conta)",
      { terminal: true, httpStatus: 403 },
      "Pagar pelo site exige conta. Entre ou crie uma conta para continuar.",
    ],
    [
      "terminal sem status legível",
      { terminal: true },
      "Este pedido não pode ser pago agora.",
    ],
  ] as const) {
    it(`CONTROLE: ${rotulo} segue terminal — a frase da edge e só 'Ver meus pedidos'`, async () => {
      criarPagamento.mockRejectedValue(erroDaEdge(mensagem, extra));
      await montar();

      expect(alerta()).toContain(mensagem);
      expect(botoes()).toEqual(["Ver meus pedidos"]);
    });
  }
});
