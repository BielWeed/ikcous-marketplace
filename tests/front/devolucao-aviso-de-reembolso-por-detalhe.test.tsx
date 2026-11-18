// @vitest-environment jsdom
// Ignorar o detalhe do servidor não pode orientar um segundo pagamento.
import { act, createElement } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ReembolsoDaDevolucao } from "@/components/admin/devolucoes/ReembolsoDaDevolucao";
import { lerDevolucaoDetalhe } from "@/lib/devolucao";

const { rpc, invoke, toast } = vi.hoisted(() => ({
  rpc: vi.fn(),
  invoke: vi.fn(),
  toast: {
    warning: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    success: vi.fn(),
  },
}));
vi.mock("@/lib/supabase", () => ({
  supabase: { rpc, functions: { invoke } },
}));
vi.mock("sonner", () => ({ toast }));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const DETALHE = lerDevolucaoDetalhe({
  id: "dev-1",
  protocolo: "DV261015-ABCDE",
  order_id: "pedido-1",
  user_id: "u-1",
  tipo: "arrependimento",
  motivo: "tamanho_pequeno",
  detalhe: null,
  resolucao_desejada: "reembolso",
  resolucao_final: "reembolso",
  modalidade: "nacional",
  metodo_retorno: "envio_proprio",
  status: "concluida",
  valor_itens: 50,
  valor_frete_ida: 0,
  valor_reembolso: 50,
  refund_id: "refund-1",
  reembolso_manual: false,
  fotos: [],
  codigo_rastreio: null,
  codigo_postagem: null,
  etiqueta_url: null,
  me_reverse_id: null,
  coleta_em: null,
  mensagem_loja: null,
  observacao_inspecao: null,
  entregue_em: "2026-09-24T15:00:00Z",
  prazo_ate: "2026-10-01",
  politica: null,
  created_at: "2026-09-26T10:00:00Z",
  updated_at: "2026-09-26T10:00:00Z",
  aprovada_em: "2026-09-26T11:00:00Z",
  postada_em: null,
  recebida_em: "2026-09-27T12:00:00Z",
  concluida_em: "2026-09-28T12:00:00Z",
  encerrada_em: null,
  itens: [],
  eventos: [],
  pedido: null,
});
if (!DETALHE) throw new Error("fixture de devolução inválida");

let raiz: Root;
let hospedeiro: HTMLDivElement;
const aoMudar = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("confirm", vi.fn().mockReturnValue(true));
  rpc.mockResolvedValue({
    data: {
      total: 100,
      valor_estornado: 0,
      em_voo: 0,
      em_duvida: 0,
      manual: 0,
      disponivel: 100,
      reservado_por_fora: 0,
      linhas: [
        {
          id: "refund-1",
          status: "falhou",
          amount: 50,
          pode_ter_saido: false,
          por_fora_liberado_em: null,
          por_fora_apos_espera_liberado: false,
          substituida_por_manual: false,
          eh_pix: true,
        },
      ],
    },
    error: null,
  });
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
});

afterEach(() => {
  act(() => raiz.unmount());
  hospedeiro.remove();
  vi.unstubAllGlobals();
});

const CONSERVADOR =
  "O Mercado Pago não refez o reembolso. Confira o valor no Mercado Pago antes de devolver por fora.";

describe("aviso de use_por_fora conforme o detalhe do servidor", () => {
  it.each([
    [
      "devolvido_pelo_painel_do_mp",
      "Já existe um reembolso concluído pelo painel do Mercado Pago. Não repita esse valor; confira lá se falta alguma diferença.",
    ],
    [
      "sem_prova_de_que_nao_saiu",
      "Não foi possível confirmar se o dinheiro saiu. Confira no Mercado Pago antes de devolver por fora.",
    ],
    [
      "pedido_nao_entregue",
      "O pedido ainda não foi entregue. Confirme que o valor continua pendente antes de devolver por fora.",
    ],
    [
      "sem_pagamento_pelo_app",
      "O pagamento não foi feito pelo app. Confirme que o valor continua pendente antes de devolver por fora.",
    ],
    [
      "fora_do_prazo_ou_da_forma",
      "O reembolso está fora do prazo ou da forma aceita pelo Mercado Pago. Confirme que o valor continua pendente antes de devolver por fora.",
    ],
    ["detalhe_desconhecido", CONSERVADOR],
    [undefined, CONSERVADOR],
    [null, CONSERVADOR],
    ["toString", CONSERVADOR],
  ])(
    "o detalhe %s não vira ordem de pagar novamente",
    async (detalhe, aviso) => {
      invoke.mockResolvedValue({
        data: { resultado: "use_por_fora", detalhe },
        error: null,
      });
      await act(async () => {
        raiz.render(
          createElement(ReembolsoDaDevolucao, {
            detalhe: DETALHE!,
            aoMudar,
          }),
        );
      });
      const botoes = Array.from(hospedeiro.querySelectorAll("button"));
      const tentar = botoes.find((b) => b.textContent === "Tentar de novo");
      expect(tentar).toBeDefined();
      await act(async () => {
        tentar!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });

      expect(toast.warning).toHaveBeenCalledExactlyOnceWith(aviso, {
        duration: 20_000,
      });
      expect(invoke).toHaveBeenCalledTimes(1);
      expect(aoMudar).toHaveBeenCalledOnce();
      const porFora = botoes.find(
        (b) => b.textContent === "Já devolvi por fora",
      );
      expect(porFora).toBeDefined();
      expect(porFora!.disabled).toBe(false);
    },
  );
});
