// @vitest-environment jsdom
//
// Calculadora e CheckoutView REAIS: uma resposta parcial mais nova não pode
// deixar o Finalizar promover a cópia completa ANTIGA a "preço fresco".
// Sem a invalidação no recebimento da resposta, R$ 45 volta a R$ 30.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  chaveDoCacheDeFrete,
  cotacaoCacheadaQueAindaServe,
} from "@/components/ui/custom/ShippingCalculator";
import { contextoDaLojaParaFrete } from "@/contexts/ContextoDoFreteDaLoja";
import type { Address, CartItem, ShippingOption } from "@/types";

const { invoke, createOrder, conta } = vi.hoisted(() => ({
  invoke: vi.fn(),
  createOrder: vi.fn(),
  conta: { id: "user-1" },
}));

const CARRINHO: CartItem[] = [
  {
    product: {
      id: "prod-1",
      name: "Blusa Teste",
      description: "",
      price: 100,
      images: [],
      category: "Roupas",
      stock: 5,
      sold: 0,
      isActive: true,
      isBestseller: false,
      freeShipping: false,
      createdAt: new Date(0).toISOString(),
    },
    quantity: 1,
  },
];
const ENDERECOS: Address[] = [
  {
    id: "end-1",
    user_id: "user-1",
    name: "Casa",
    recipient_name: "Cliente Teste",
    cep: "01001-000",
    street: "Rua Teste",
    number: "100",
    neighborhood: "Centro",
    city: "São Paulo",
    state: "SP",
    is_default: true,
  },
];
const PAC_ANTIGO: ShippingOption = {
  id: "melhorenvio-pac",
  name: "PAC",
  price: 30,
  deliveryDays: 6,
  provider: "melhor_envio",
};
const PAC_NOVO: ShippingOption = { ...PAC_ANTIGO, price: 45 };

vi.mock("@/lib/supabase", () => ({
  supabase: { functions: { invoke: (...args: unknown[]) => invoke(...args) } },
}));
vi.mock("@/lib/sessao-ainda-e-do-dono", () => ({
  sessaoAindaEhDoDono: async () => true,
}));
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: {
      shippingCoverage: "national",
      originCep: "38500-000",
      enableCoupons: false,
      freeShippingMin: 0,
    },
    isLoaded: true,
  }),
}));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: conta, profile: null, loading: false }),
}));
vi.mock("@/hooks/useAddresses", () => ({
  useAddresses: () => ({
    addresses: ENDERECOS,
    fetchAddresses: vi.fn(),
    addAddress: vi.fn(),
    updateAddress: vi.fn(),
    loading: false,
  }),
}));
// O estado real de React devolve à calculadora o que o checkout seleciona,
// inclusive o objeto antigo que o defeito recolocava depois de Finalizar.
vi.mock("@/hooks/useCart", async () => {
  const { useState } = await import("react");
  function useCartComEstado() {
    const [selecionada, setSelecionada] = useState<ShippingOption | null>(null);
    const [shippingCep, setShippingCep] = useState<string | null>(null);
    const [enderecoSelecionadoId, setEnderecoSelecionadoId] = useState<
      string | null
    >(null);
    return {
      cart: CARRINHO,
      cartTotal: 100,
      shippingFee: selecionada?.price ?? 0,
      freteIndefinido: !selecionada,
      freteGratis: false,
      freteEscolhidoPelaCliente: false,
      selectedShippingOption: selecionada,
      setSelectedShippingOption: setSelecionada,
      shippingCep,
      setShippingCep,
      enderecoSelecionadoId,
      setEnderecoSelecionadoId,
      clearCart: vi.fn(),
    };
  }
  return { useCart: useCartComEstado };
});
vi.mock("@/hooks/useOrders", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/hooks/useOrders")>()),
  useOrders: () => ({ createOrder, updateOrderStatus: vi.fn() }),
}));
vi.mock("@/hooks/useCoupons", () => ({
  useCoupons: () => ({ validateCoupon: vi.fn() }),
}));
vi.mock("@/hooks/useEconomiaDoFreteExibida", () => ({
  useEconomiaDoFreteExibida: () => 0,
}));
vi.mock("@/hooks/useDeferredRender", () => ({
  useDeferredRender: () => true,
}));
vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));
vi.mock("@/lib/flags", () => ({
  pagamentoOnlineLigado: () => true,
  lerFlagPagamentoOnline: (v: string | undefined) => v === "true",
}));
vi.mock("@/components/checkout/PagamentoOnline", () => ({
  PagamentoOnline: () => null,
}));
vi.mock("canvas-confetti", () => ({ default: vi.fn() }));
vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function digitar(id: string, valor: string) {
  const campo = document.getElementById(id) as HTMLInputElement;
  const setter = Object.getOwnPropertyDescriptor(
    globalThis.HTMLInputElement.prototype,
    "value",
  )!.set!;
  setter.call(campo, valor);
  campo.dispatchEvent(new Event("input", { bubbles: true }));
}

const esperar = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe("cotação parcial nova × Finalizar com cópia completa antiga", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let armazem: Map<string, string>;
  let concluirPedido: () => void;

  beforeEach(() => {
    invoke.mockReset();
    createOrder.mockReset();
    // A RPC fica em voo para observar o resumo DEPOIS da conferência local,
    // sem navegar para o pagamento nem fabricar uma resposta do servidor.
    concluirPedido = () => {};
    createOrder.mockImplementation(
      () =>
        new Promise((resolve) => {
          concluirPedido = () => resolve({ id: "pedido-1", totalAmount: 145 });
        }),
    );
    armazem = new Map();
    vi.stubGlobal("localStorage", {
      getItem: (chave: string) => armazem.get(chave) ?? null,
      setItem: (chave: string, valor: string) => armazem.set(chave, valor),
      removeItem: (chave: string) => armazem.delete(chave),
    });
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(async () => {
    await act(async () => {
      raiz.unmount();
      // Encerra também o prazo de espera da RPC, já com a tela desmontada.
      concluirPedido();
      await esperar();
    });
    hospedeiro.remove();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function resumoDoFrete() {
    return hospedeiro.querySelector('[data-testid="opcao-de-frete-escolhida"]')
      ?.textContent;
  }

  it.each(["cotacaoParcial", "cotacaoIncompleta"] as const)(
    "%s: revisão mudou, rede mostra R$ 45 e Finalizar não volta para R$ 30",
    async (marca) => {
      // Cache completo de antes da mudança, ainda válido para ESTE carrinho,
      // contexto e CEP. Só a revisão do servidor mudou (ex.: ajuste de preço).
      const contexto = contextoDaLojaParaFrete(undefined);
      const envelope = {
        contexto,
        assinatura: "prod-1::1:100",
        gravadoEm: Date.now() - 60_000,
        revisaoConfig: "rev-antiga",
        opcoes: [PAC_ANTIGO],
      };
      expect(
        cotacaoCacheadaQueAindaServe(
          envelope,
          "prod-1::1:100",
          Date.now(),
          contexto,
        ),
      ).toEqual([PAC_ANTIGO]);
      armazem.set(chaveDoCacheDeFrete("01001000"), JSON.stringify(envelope));
      invoke.mockImplementation(
        async (
          _nome: string,
          init: {
            body: { action?: string; cep?: string };
          },
        ) =>
          init.body.action === "revisao_config_frete"
            ? { data: { revisaoConfig: "rev-nova" }, error: null }
            : {
                data: {
                  options: [PAC_NOVO],
                  revisaoConfig: "rev-nova",
                  [marca]: true,
                },
                error: null,
              },
      );

      const { CheckoutView } = await import("@/views/customer/CheckoutView");
      await act(async () => {
        raiz.render(
          <CheckoutView onNavigate={vi.fn()} onSetBackOverride={vi.fn()} />,
        );
        await esperar();
        await esperar();
      });
      // Confirma o elo de revisão, não um cache descartado por assinatura ruim.
      expect(invoke).toHaveBeenCalledWith("calculate-shipping", {
        body: { action: "revisao_config_frete" },
      });
      expect(invoke).toHaveBeenCalledWith("calculate-shipping", {
        body: expect.objectContaining({ cep: "01001000", cart: CARRINHO }),
      });
      expect(resumoDoFrete()).toContain("45,00");
      expect(resumoDoFrete()).not.toContain("30,00");

      await act(async () => {
        const online = [...hospedeiro.querySelectorAll("button")].find((b) =>
          b.textContent?.includes("Pagar agora com PIX"),
        )!;
        online.click();
        digitar("checkout-name", "Cliente Teste");
        digitar("checkout-tel", "34999999999");
        digitar("checkout-cpf", "11144477735");
        await esperar();
      });
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 420));
      });
      const finalizar = document.querySelector<HTMLButtonElement>(
        'button[aria-label="Finalizar pedido"]',
      )!;
      expect(finalizar.disabled).toBe(false);
      await act(async () => {
        finalizar.click();
        await esperar();
        await esperar();
      });

      // Asserção principal: o resumo REAL não retrocede depois do toque.
      expect(resumoDoFrete()).toContain("45,00");
      expect(resumoDoFrete()).not.toContain("30,00");
      expect(createOrder).toHaveBeenCalledWith(
        expect.objectContaining({ shippingCost: 45, totalAmount: 145 }),
        expect.anything(),
      );
      // Parcial continua sem ser guardada como se fosse completa por 2 h.
      expect(armazem.has(chaveDoCacheDeFrete("01001000"))).toBe(false);
    },
  );
});
