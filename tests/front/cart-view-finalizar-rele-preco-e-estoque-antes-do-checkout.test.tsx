// @vitest-environment jsdom
//
// r60-b — "Finalizar compra" do carrinho relê preço e estoque antes de abrir o
// checkout.
//
// DEFEITO MEDIDO: o botão levava direto ao checkout. Numa aba que nunca ficou
// escondida nada relê o catálogo (só abrir o app de novo ou voltar do segundo
// plano), então a lojista mexia no preço ou pausava o produto e a cliente via
// o total velho até o último toque, quando o servidor recusava ("os valores do
// pedido mudaram"). O servidor sempre conferiu o total — o defeito é a tela
// mostrar um total que não vale.
//
// A releitura NUNCA pode prender a cliente: tem teto (3 s), e leitura que
// falha ou pendura segue ao checkout como antes (o servidor confere). E com
// pedido já enviado e sem resposta (chave do pedido vigente) a releitura
// explícita não roda: ela aplicaria o catálogo ao carrinho, giraria a chave e
// o próximo "Finalizar" criaria um SEGUNDO pedido.
//
// Os três botões que levam ao checkout: "Finalizar Compra" do resumo (desktop),
// "Finalizar compra" da barra de baixo (celular) e "Continuar como Convidado".
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PREFIXO_DA_CHAVE_DO_PEDIDO } from "@/lib/chave-do-pedido";
import { TETO_DA_RELEITURA_DO_CARRINHO_MS } from "@/lib/reler-o-carrinho-com-teto";
import type { CartItem, View } from "@/types";

const { conta, renovar } = vi.hoisted(() => ({
  conta: { usuario: null as { id: string } | null },
  renovar: vi.fn<() => Promise<void>>(),
}));

const itemNoCarrinho: CartItem = {
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
};

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: {
      shippingFee: 10,
      freeShippingMin: 0,
      formasPagamentoEntrega: ["pix", "card", "cash"],
    },
  }),
}));

vi.mock("@/hooks/useProducts", () => ({
  useProducts: () => ({ getFreeShippingEligibleProducts: () => [] }),
}));

vi.mock("@/hooks/useCart", () => ({
  useCart: () => ({
    cart: [itemNoCarrinho],
    cartTotal: 100,
    shippingFee: 10,
    updateQuantity: vi.fn(),
    removeFromCart: vi.fn(),
    selectedShippingOption: null,
    setSelectedShippingOption: vi.fn(),
    setShippingCep: vi.fn(),
    renovarCarrinhoPeloCatalogo: renovar,
  }),
}));

vi.mock("@/hooks/useAddresses", () => ({
  useAddresses: () => ({
    addresses: [],
    fetchAddresses: async () => {},
    loading: false,
  }),
}));

vi.mock("@/hooks/useOrders", () => ({
  useOrders: () => ({
    fetchUserOrders: vi.fn().mockResolvedValue([]),
    orders: [],
  }),
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: conta.usuario }),
}));

vi.mock("@/hooks/useDeferredRender", () => ({ useDeferredRender: () => true }));
vi.mock("@/lib/supabase", () => ({ supabase: {} }));
vi.mock("@/utils/haptic", () => ({
  haptic: { light: vi.fn(), medium: vi.fn(), success: vi.fn() },
}));

vi.mock("@/components/ui/custom/CartItemsList", () => ({
  CartItemsList: () => <div />,
}));
vi.mock("@/components/ui/custom/ShippingCalculator", () => ({
  ShippingCalculator: () => <div />,
}));
vi.mock("@/components/ui/custom/ShippingProgress", () => ({
  ShippingProgress: () => <div />,
}));
vi.mock("@/components/ui/custom/OrderList", () => ({
  OrderList: () => <div />,
}));
vi.mock("@/components/ui/custom/OrderSearch", () => ({
  OrderSearch: () => <div />,
}));
vi.mock("@/components/ui/custom/EmptyCart", () => ({
  EmptyCart: () => <div />,
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const BOTOES = {
  resumo: "Finalizar Compra",
  barra: "Finalizar compra",
  convidado: "Continuar como Convidado",
} as const;

describe("CartView — Finalizar relê preço e estoque antes de abrir o checkout", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let armazem: Map<string, string>;
  const onNavigate = vi.fn<(view: View, id?: string) => void>();

  beforeEach(() => {
    conta.usuario = null;
    renovar.mockReset().mockResolvedValue(undefined);
    onNavigate.mockReset();
    armazem = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (chave: string) => armazem.get(chave) ?? null,
      setItem: (chave: string, valor: string) => {
        armazem.set(chave, valor);
      },
      removeItem: (chave: string) => {
        armazem.delete(chave);
      },
    });
    vi.spyOn(console, "error").mockImplementation(() => {});
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
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  async function montar(isActive = true) {
    const { CartView } = await import("@/views/customer/CartView");
    await act(async () => {
      raiz.render(<CartView onNavigate={onNavigate} isActive={isActive} />);
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
  }

  /** O botão pelo texto EXATO (a barra de baixo mora num portal no body). */
  function botao(texto: string): HTMLButtonElement {
    const achado = Array.from(document.body.querySelectorAll("button")).find(
      (b) => b.textContent?.trim() === texto,
    );
    if (!achado) throw new Error(`botão "${texto}" não está na tela`);
    return achado as HTMLButtonElement;
  }

  async function tocar(texto: string) {
    await act(async () => {
      botao(texto).click();
      await Promise.resolve();
    });
  }

  async function escoar() {
    await act(async () => {
      for (let i = 0; i < 12; i++) await Promise.resolve();
    });
  }

  /** Uma releitura que só termina quando o teste manda. */
  function releituraManual() {
    let terminar: () => void = () => {};
    renovar.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          terminar = resolve;
        }),
    );
    return () => terminar();
  }

  const gravarChaveVigente = (dono: string) =>
    armazem.set(
      `${PREFIXO_DA_CHAVE_DO_PEDIDO}${dono}`,
      JSON.stringify({
        impressao: "qualquer",
        chave: "chave-de-um-envio-sem-resposta",
        expiraEm: Date.now() + 20 * 60 * 1000,
      }),
    );

  describe.each([
    ["resumo (computador)", BOTOES.resumo, "conta"],
    ["barra de baixo (celular)", BOTOES.barra, "conta"],
    ["Continuar como Convidado", BOTOES.convidado, "convidado"],
  ] as const)("botão %s", (_nome, texto, quem) => {
    beforeEach(() => {
      conta.usuario = quem === "conta" ? { id: "conta-a" } : null;
    });

    it("relê preço e estoque e só DEPOIS abre o checkout", async () => {
      const terminar = releituraManual();
      await montar();

      await tocar(texto);
      expect(renovar).toHaveBeenCalledTimes(1);
      // Enquanto a leitura corre, o checkout ainda não abriu.
      expect(onNavigate).not.toHaveBeenCalled();

      await act(async () => {
        terminar();
        await Promise.resolve();
      });
      await escoar();
      expect(onNavigate).toHaveBeenCalledTimes(1);
      expect(onNavigate).toHaveBeenCalledWith("checkout");
    });

    it("leitura que falha NÃO prende a cliente: segue ao checkout (o servidor confere)", async () => {
      renovar.mockRejectedValue(new Error("sem rede"));
      await montar();

      await tocar(texto);
      await escoar();

      expect(renovar).toHaveBeenCalledTimes(1);
      expect(onNavigate).toHaveBeenCalledWith("checkout");
    });

    it("rede pendurada: passado o teto a cliente segue ao checkout e o botão não fica travado", async () => {
      vi.useFakeTimers();
      renovar.mockImplementation(() => new Promise<void>(() => {}));
      await montar();

      await tocar(texto);
      expect(onNavigate).not.toHaveBeenCalled();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(
          TETO_DA_RELEITURA_DO_CARRINHO_MS + 50,
        );
      });
      expect(onNavigate).toHaveBeenCalledTimes(1);
      expect(onNavigate).toHaveBeenCalledWith("checkout");

      // Voltou ao carrinho: o botão responde de novo (nova leitura, novo teto).
      await tocar(texto);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(
          TETO_DA_RELEITURA_DO_CARRINHO_MS + 50,
        );
      });
      expect(renovar).toHaveBeenCalledTimes(2);
      expect(onNavigate).toHaveBeenCalledTimes(2);
    });

    it("toque duplo: lê uma vez e abre o checkout uma vez", async () => {
      const terminar = releituraManual();
      await montar();

      await act(async () => {
        botao(texto).click();
        botao(texto).click();
        await Promise.resolve();
      });
      await act(async () => {
        terminar();
        await Promise.resolve();
      });
      await escoar();

      expect(renovar).toHaveBeenCalledTimes(1);
      expect(onNavigate).toHaveBeenCalledTimes(1);
    });

    it("pedido já enviado e sem resposta (chave vigente): NÃO relê — vai direto, como antes", async () => {
      gravarChaveVigente(conta.usuario?.id ?? "convidado");
      await montar();

      await tocar(texto);

      expect(renovar).not.toHaveBeenCalled();
      expect(onNavigate).toHaveBeenCalledWith("checkout");
    });

    it("chave vigente de OUTRA conta no aparelho não pula a releitura desta", async () => {
      gravarChaveVigente(quem === "conta" ? "convidado" : "conta-a");
      await montar();

      await tocar(texto);
      await escoar();

      expect(renovar).toHaveBeenCalledTimes(1);
      expect(onNavigate).toHaveBeenCalledWith("checkout");
    });
  });

  it("se a cliente já saiu da aba do carrinho durante a leitura, não é arrastada ao checkout", async () => {
    const terminar = releituraManual();
    await montar(true);

    await tocar(BOTOES.resumo);
    await montar(false);
    await act(async () => {
      terminar();
      await Promise.resolve();
    });
    await escoar();

    expect(renovar).toHaveBeenCalledTimes(1);
    expect(onNavigate).not.toHaveBeenCalled();
  });
});
