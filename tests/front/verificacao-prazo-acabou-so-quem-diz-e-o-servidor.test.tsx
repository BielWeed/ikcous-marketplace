// @vitest-environment jsdom
//
// F5 (fase 3 dos pagamentos, 04/10/2026) — "O prazo para pagar este pedido
// acabou" na verificação NÃO vem do relógio do aparelho.
//
// Antes: com `livre`, `recusado` ou `pix`, a tela comparava o `expiraEm` da
// resposta com o `Date.now()` do aparelho. Relógio adiantado transformava uma
// resposta que o servidor deu como VIVA em "o prazo acabou" (e a retomada não
// reabria) — a mesma ressalva B2 que o cartão já resolveu em
// confirmacao-do-cartao.ts. Agora quem diz que o prazo acabou é o servidor: o
// 409 terminal de `criar-pagamento` (que checa `expires_at` no relógio DELE,
// antes de qualquer `livre`/`recusado`/`pix`). Resposta 200 libera a retomada;
// se o prazo tiver mesmo passado, o 409 da próxima chamada diz.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  VerificacaoDoPagamento,
  situacaoDaResposta,
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
// Para o SERVIDOR este prazo está no futuro; o relógio do aparelho,
// adiantado, já passou dele.
const PRAZO_DO_SERVIDOR = "2999-01-01T00:00:00.000Z";
const RELOGIO_ADIANTADO_DO_APARELHO = "2999-06-01T00:00:00.000Z";
const VERIFICACOES = ["livre", "recusado", "pix"] as const;

let raiz: Root;
let hospedeiro: HTMLDivElement;
const onRetomadaLiberada = vi.fn();

beforeEach(() => {
  criarPagamento.mockReset();
  onRetomadaLiberada.mockReset();
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
        onRetomadaLiberada={onRetomadaLiberada}
      />,
    );
  });
  for (let i = 0; i < 6; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

const texto = () => hospedeiro.textContent ?? "";
const botoes = () =>
  Array.from(hospedeiro.querySelectorAll("button")).map((b) =>
    (b.textContent ?? "").trim(),
  );

describe("situacaoDaResposta — o prazo da resposta não é comparado com o relógio do aparelho", () => {
  for (const verificacao of VERIFICACOES) {
    it(`${verificacao} com expiraEm já passado NO APARELHO: libera a retomada (quem encerra por prazo é o 409 do servidor)`, () => {
      const situacao = situacaoDaResposta(
        {
          verificacao,
          paymentId: verificacao === "pix" ? "123456789" : null,
          expiraEm: PRAZO_DO_SERVIDOR,
        },
        Date.parse(RELOGIO_ADIANTADO_DO_APARELHO),
      );
      expect(situacao).toEqual({ tipo: "liberada", verificacao });
    });
  }
});

describe("VerificacaoDoPagamento — relógio adiantado não encerra nada", () => {
  for (const verificacao of VERIFICACOES) {
    it(`${verificacao} com o relógio do aparelho adiantado: devolve a retomada ao pai e não diz que o prazo acabou`, async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date(RELOGIO_ADIANTADO_DO_APARELHO));
      criarPagamento.mockResolvedValue({
        verificacao,
        paymentId: verificacao === "pix" ? "123456789" : null,
        expiraEm: PRAZO_DO_SERVIDOR,
      });
      await montar();

      expect(onRetomadaLiberada).toHaveBeenCalledTimes(1);
      expect(onRetomadaLiberada).toHaveBeenCalledWith(verificacao);
      expect(texto()).not.toContain("O prazo para pagar este pedido acabou");
      expect(texto()).not.toContain("não foi concluído");
    });
  }

  it("CONTROLE: o prazo acabou DE VERDADE (409 terminal do servidor): a frase dele em alerta, só 'Ver meus pedidos', retomada fechada", async () => {
    criarPagamento.mockRejectedValue(
      Object.assign(new Error("O prazo para pagar este pedido acabou."), {
        terminal: true,
        cartaoEmAnalise: false,
        httpStatus: 409,
      }),
    );
    await montar();

    expect(hospedeiro.querySelector('[role="alert"]')?.textContent).toContain(
      "O prazo para pagar este pedido acabou.",
    );
    expect(botoes()).toEqual(["Ver meus pedidos"]);
    expect(onRetomadaLiberada).not.toHaveBeenCalled();
  });
});
