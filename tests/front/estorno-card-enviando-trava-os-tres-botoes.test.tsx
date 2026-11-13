// @vitest-environment jsdom
// O hook já tem teste de chamadas simultâneas. Aqui a guarda é ANTES dele:
// enquanto envia, nem uma segunda confirmação financeira pode ser aberta.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { LinhaEstornoDoPedido } from "@/hooks/useEstornosDoPedido";
import type { Order } from "@/types";

const useEstornosDoPedidoMock = vi.fn();
vi.mock("@/hooks/useEstornosDoPedido", () => ({
  useEstornosDoPedido: (orderId: string) => useEstornosDoPedidoMock(orderId),
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const pedido: Order = {
  id: "pedido-estorno-enviando",
  customer: { name: "Cliente Teste", whatsapp: "34999999999" },
  items: [],
  subtotal: 100,
  shipping: 0,
  discount: 0,
  total: 100,
  paymentMethod: "online",
  paymentStatus: "pago",
  status: "cancelled",
  createdAt: new Date(0).toISOString(),
  updatedAt: new Date(0).toISOString(),
  cancelledAfterShipping: false,
};

function linha(extra: Partial<LinhaEstornoDoPedido>): LinhaEstornoDoPedido {
  return {
    id: "refund-falhou",
    amount: 30,
    status: "falhou",
    solicitado_por: "lojista",
    mp_status: null,
    mp_status_detail: null,
    tentativas: 1,
    ultimo_erro: "Falha de teste",
    motivo: null,
    created_at: "2026-09-01T10:00:00.000Z",
    concluido_em: null,
    pode_ter_saido: false,
    por_fora_liberado_em: null,
    por_fora_apos_espera_liberado: false,
    substituida_por_manual: false,
    eh_pix: false,
    ...extra,
  };
}

function hook(enviando: boolean) {
  return {
    linhas: [
      linha({}),
      linha({
        id: "refund-por-fora",
        pode_ter_saido: true,
        por_fora_apos_espera_liberado: true,
      }),
    ],
    pago: 100,
    devolvido: 0,
    emCurso: 0,
    emDuvida: 0,
    disponivel: 100,
    reservadoPorFora: 0,
    carregando: false,
    pedidoCarregado: true,
    erro: false,
    recarregar: vi.fn(),
    solicitarEstorno: vi.fn().mockResolvedValue(undefined),
    registrarPorForaAposEspera: vi.fn().mockResolvedValue(true),
    enviando,
  };
}

let raiz: Root;
let hospedeiro: HTMLDivElement;

beforeEach(() => {
  useEstornosDoPedidoMock.mockReset();
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
});

afterEach(() => {
  act(() => raiz.unmount());
  hospedeiro.remove();
  vi.unstubAllGlobals();
});

function botao(parte: string): HTMLButtonElement {
  const encontrado = Array.from(hospedeiro.querySelectorAll("button")).find(
    (b) => (b.textContent ?? "").replace(/\s+/g, " ").includes(parte),
  );
  if (!encontrado) throw new Error(`Botão não encontrado: ${parte}`);
  return encontrado;
}

async function montar() {
  const { EstornoCard } = await import("@/components/admin/orders/EstornoCard");
  await act(async () => {
    raiz.render(<EstornoCard order={pedido} isOffline={false} />);
  });
}

const acoes = [
  {
    nome: "Devolver",
    durante: "Devolvendo…",
    depois: "Devolver R$ 100,00",
    valor: 100,
    repetindo: undefined,
  },
  {
    nome: "Tentar de novo",
    durante: "Tentar de novo",
    depois: "Tentar de novo",
    valor: 30,
    repetindo: "refund-falhou",
  },
  {
    nome: "Já devolvi por fora",
    durante: "Já devolvi por fora",
    depois: "Já devolvi por fora",
    valor: null,
    repetindo: undefined,
  },
];

describe("EstornoCard — enviando trava as três ações financeiras", () => {
  it.each(acoes)(
    "$nome não abre confirmação nem envia; volta a funcionar quando termina",
    async ({ durante, depois, valor, repetindo }) => {
      const confirmar = vi.fn(() => true);
      const perguntar = vi.fn(() => "DEVOLVI POR FORA");
      vi.stubGlobal("confirm", confirmar);
      vi.stubGlobal("prompt", perguntar);
      const h = hook(true);
      useEstornosDoPedidoMock.mockReturnValue(h);
      await montar();

      const alvo = botao(durante);
      expect(alvo.disabled).toBe(true);
      await act(async () => alvo.click());

      expect(
        document.querySelector('[data-testid="confirmar-acao"]'),
      ).toBeNull();
      expect(confirmar).not.toHaveBeenCalled();
      expect(perguntar).not.toHaveBeenCalled();
      expect(h.solicitarEstorno).not.toHaveBeenCalled();
      expect(h.registrarPorForaAposEspera).not.toHaveBeenCalled();

      // Só enviando muda: rede, saldo e linhas continuam iguais.
      useEstornosDoPedidoMock.mockReturnValue({ ...h, enviando: false });
      await montar();
      expect(botao(depois).disabled).toBe(false);

      // Controle positivo: o mesmo clique agora alcança a confirmação real.
      await act(async () => botao(depois).click());
      if (valor === null) {
        expect(perguntar).toHaveBeenCalledTimes(1);
        expect(h.registrarPorForaAposEspera).toHaveBeenCalledExactlyOnceWith(
          "refund-por-fora",
        );
        expect(h.solicitarEstorno).not.toHaveBeenCalled();
      } else {
        const janela = document.querySelector('[data-testid="confirmar-acao"]');
        expect(janela).not.toBeNull();
        expect(h.solicitarEstorno).not.toHaveBeenCalled();
        const botoes = janela?.querySelectorAll("button");
        const aceitar = botoes?.[botoes.length - 1];
        expect(aceitar).toBeDefined();
        await act(async () => aceitar?.click());
        // Só o "Tentar de novo" leva o id da linha falhada; o "Devolver" comum não repete linha nenhuma.
        expect(h.solicitarEstorno).toHaveBeenCalledExactlyOnceWith(
          repetindo === undefined
            ? { amount: valor, motivo: "" }
            : { amount: valor, motivo: "", repetindo },
        );
        expect(h.registrarPorForaAposEspera).not.toHaveBeenCalled();
        expect(perguntar).not.toHaveBeenCalled();
      }
      expect(confirmar).not.toHaveBeenCalled();
    },
  );
});
