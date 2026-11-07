// @vitest-environment jsdom
//
// CartView + Sheet + useVoltarFechaAFolha REAIS. Só dados/rede são dublês.
// O defeito aparece ANTES de o roteador gravar /address-form: fechar a folha
// pede history.back(). Contamos chamadas, pois o jsdom não prova a ordem de
// travessia do navegador real. A segunda suíte monta também o App REAL e
// atravessa uma entrada por vez, sem reescrever o histórico após o cadastro.
import { type ReactNode, StrictMode, act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Address, CartItem, Product, View } from "@/types";

const { carrinho, enderecos, usuario } = vi.hoisted(() => {
  const produto: Product = {
    id: "produto-teste",
    name: "Blusa Teste",
    description: "",
    price: 50,
    images: [],
    category: "Roupas",
    stock: 10,
    sold: 0,
    isActive: true,
    isBestseller: false,
    freeShipping: false,
    createdAt: new Date(0).toISOString(),
  };
  const casa: Address = {
    id: "end-casa",
    user_id: "conta-teste",
    name: "Casa",
    recipient_name: "Cliente Teste",
    cep: "38500-000",
    street: "Rua Teste",
    number: "10",
    complement: "",
    neighborhood: "Centro",
    city: "Monte Carmelo",
    state: "MG",
    reference: "",
    is_default: true,
  };
  return {
    enderecos: [casa],
    usuario: { id: "conta-teste", user_metadata: { name: "Cliente Teste" } },
    carrinho: {
      cart: [{ product: produto, quantity: 1 }] as CartItem[],
      cartTotal: 50,
      isLoading: false,
      shippingFee: 0,
      freteIndefinido: true,
      freteGratis: false,
      selectedShippingOption: null,
      shippingCep: null,
      enderecoSelecionadoId: null,
      updateQuantity: vi.fn(),
      removeFromCart: vi.fn(),
      clearCart: vi.fn(),
      setSelectedShippingOption: vi.fn(),
      setShippingCep: vi.fn(),
      setEnderecoSelecionadoId: vi.fn(),
    },
  };
});

vi.mock("@/contexts/StoreContext", () => ({
  StoreProvider: ({ children }: { readonly children: ReactNode }) => children,
  useStore: () => ({
    config: {
      shippingCoverage: "national",
      originCep: "38500-000",
      freeShippingMin: 0,
      enableCoupons: false,
    },
    isLoaded: true,
  }),
}));
vi.mock("@/hooks/useCart", () => ({
  useCart: () => carrinho,
  useCartState: () => ({ ...carrinho, cartCount: 1 }),
  useCartActions: () => ({ addToCart: vi.fn() }),
}));
vi.mock("@/contexts/CartContext", () => ({
  CartProvider: ({ children }: { readonly children: ReactNode }) => children,
  useCartState: () => ({ freteGratis: false }),
}));
vi.mock("@/hooks/useAddresses", () => ({
  useAddresses: () => ({
    addresses: enderecos,
    fetchAddresses: vi.fn(async () => {}),
    loading: false,
  }),
}));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    user: usuario,
    isAdmin: false,
    adminStatus: "not-admin",
    isPasswordRecovery: false,
    profile: null,
    loading: false,
  }),
}));
vi.mock("@/hooks/useProducts", () => ({
  useProducts: () => ({
    products: [],
    loading: false,
    getFreeShippingEligibleProducts: () => [],
  }),
}));
vi.mock("@/hooks/useOrders", () => ({
  useOrders: () => ({ fetchUserOrders: vi.fn(async () => {}), orders: [] }),
}));
vi.mock("@/lib/supabase", () => ({
  supabase: {
    rpc: vi.fn(async () => ({ data: false, error: null })),
    auth: { getSession: async () => ({ data: { session: null } }) },
    functions: {
      invoke: vi.fn(async () => ({ data: { options: [] }, error: null })),
    },
  },
}));
vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));
vi.mock("@/utils/haptic", () => ({
  haptic: { light: vi.fn(), medium: vi.fn(), success: vi.fn() },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("Carrinho — cadastrar endereço não pede o Voltar da folha", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  const onNavigate = vi.fn<(view: View, id?: string) => void>();

  beforeEach(() => {
    vi.clearAllMocks();
    window.history.replaceState({ view: "cart" }, "", "/cart");
    // Não atravessa de verdade: a regressão é a CHAMADA indevida, não o
    // resultado da simulação de histórico do jsdom.
    vi.spyOn(window.history, "back").mockImplementation(() => {});
    const armazem = new Map<string, string>();
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
    await act(async () => raiz.unmount());
    hospedeiro.remove();
    // Desarma também o ouvinte de retorno nos casos de fechar pelo X/Esc.
    window.dispatchEvent(new PopStateEvent("popstate"));
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  async function montar(isActive = true) {
    const { CartView } = await import("@/views/customer/CartView");
    await act(async () => {
      raiz.render(<CartView onNavigate={onNavigate} isActive={isActive} />);
    });
  }

  const folha = () =>
    document.querySelector<HTMLElement>(
      '[data-testid="seletor-endereco-entrega"]',
    );

  function botao(texto: string) {
    const encontrado = Array.from(document.querySelectorAll("button")).find(
      (b) => b.textContent?.includes(texto),
    );
    expect(encontrado, texto).toBeDefined();
    return encontrado as HTMLButtonElement;
  }

  async function clicar(elemento: HTMLElement) {
    await act(async () => elemento.click());
  }

  async function abrir() {
    await clicar(botao("Trocar"));
    expect(folha()).not.toBeNull();
    expect(window.history.state).toMatchObject({
      view: "cart",
      folhaDePolitica: true,
    });
  }

  it("fecha e solicita o formulário UMA vez sem back, inclusive ao perder foco", async () => {
    await montar();
    await abrir();
    const gravarEntrada = vi.spyOn(window.history, "pushState");

    await clicar(botao("Cadastrar novo endereço"));

    expect(folha()).toBeNull();
    expect(onNavigate).toHaveBeenCalledExactlyOnceWith("address-form");
    // O roteador ainda não gravou o destino: é a janela da corrida real.
    expect(gravarEntrada).not.toHaveBeenCalled();
    expect(window.history.back).not.toHaveBeenCalled();

    await montar(false);
    expect(window.history.back).not.toHaveBeenCalled();
    expect(onNavigate).toHaveBeenCalledTimes(1);
  });

  it.each(["X", "Escape", "fora", "endereço"])(
    "fechar por %s continua devolvendo UMA entrada, sem navegar",
    async (caminho) => {
      await montar();
      await abrir();

      if (caminho === "X") {
        const fechar = folha()?.querySelector<HTMLButtonElement>(
          '[aria-label="Fechar"]',
        );
        expect(fechar).toBeTruthy();
        await clicar(fechar as HTMLButtonElement);
      } else if (caminho === "Escape") {
        await act(async () => {
          document.activeElement?.dispatchEvent(
            new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
          );
        });
      } else if (caminho === "fora") {
        // O DismissableLayer do Radix arma o toque fora no próximo ciclo.
        await new Promise((resolve) => setTimeout(resolve, 0));
        await act(async () => {
          document.body.dispatchEvent(
            new MouseEvent("pointerdown", { bubbles: true, button: 0 }),
          );
        });
      } else {
        const casa = folha()?.querySelector<HTMLElement>('[role="button"]');
        expect(casa).toBeTruthy();
        await clicar(casa as HTMLElement);
      }

      expect(folha()).toBeNull();
      expect(window.history.back).toHaveBeenCalledTimes(1);
      expect(onNavigate).not.toHaveBeenCalled();
    },
  );

  it("Voltar do navegador fecha a folha sem pedir outro back nem navegar", async () => {
    await montar();
    await abrir();

    await act(async () => {
      window.history.replaceState({ view: "cart" }, "", "/cart");
      window.dispatchEvent(
        new PopStateEvent("popstate", { state: { view: "cart" } }),
      );
    });

    expect(folha()).toBeNull();
    expect(window.history.back).not.toHaveBeenCalled();
    expect(onNavigate).not.toHaveBeenCalled();
  });
});

// Entorno do App: dados e trabalho de fundo dublados; roteador, carrinho,
// folha, gancho de Voltar e transição de tela continuam REAIS.
vi.mock("@/contexts/FavoritesContext", () => ({
  FavoritesProvider: ({ children }: { readonly children: ReactNode }) =>
    children,
}));
vi.mock("@/hooks/useFavorites", () => ({
  useFavorites: () => ({
    favorites: [],
    toggleFavorite: vi.fn(),
    loading: false,
  }),
}));
vi.mock("@/hooks/useAppBadge", () => ({
  useAppBadge: () => ({ setBadge: vi.fn(), clearBadge: vi.fn() }),
}));
vi.mock("@/hooks/usePrefetchOnHover", () => {
  const api = {
    prefetchView: vi.fn(),
    prefetchAll: vi.fn(),
    prefetchViewPromise: async () => {},
  };
  return { usePrefetchOnHover: () => api };
});
vi.mock("@/hooks/useNetworkAdaptive", () => ({
  useNetworkAdaptive: () => ({ isSlow: () => false }),
}));
vi.mock("@/hooks/useUpdateCheck", () => ({
  useUpdateCheck: () => ({
    checkUpdate: vi.fn(),
    updateAvailable: false,
    newVersion: null,
    performNuclearPurge: vi.fn(),
  }),
}));
vi.mock("@/hooks/useBehavioralPrefetch", () => ({
  useBehavioralPrefetch: vi.fn(),
}));
vi.mock("@/hooks/useCacheWarmer", () => ({ useCacheWarmer: vi.fn() }));
vi.mock("@/hooks/usePredictiveNavigation", () => ({
  usePredictiveNavigation: vi.fn(),
}));
vi.mock("@/hooks/useSwipeBack", () => ({ useSwipeBack: vi.fn() }));
vi.mock("@/hooks/useWebVitals", () => ({ useWebVitals: vi.fn() }));
vi.mock("@/hooks/useRealtimeUpdate", () => ({ useRealtimeUpdate: vi.fn() }));
vi.mock("@/components/debug/DebugPanel", () => ({ DebugPanel: () => null }));
vi.mock("@/components/pwa/PushNotificationBanner", () => ({
  PushNotificationBanner: () => null,
}));
vi.mock("@/components/pwa/UpdateNotification", () => ({
  UpdateNotification: () => null,
}));
vi.mock("@/components/ui/custom/Header", () => ({ Header: () => null }));
vi.mock("@/components/ui/custom/BottomNav", () => ({ BottomNav: () => null }));
vi.mock("@/components/ui/custom/CartReminder", () => ({
  CartReminder: () => null,
}));
vi.mock("@/components/ui/sonner", () => ({ Toaster: () => null }));
vi.mock("@/views/customer/HomeView", () => ({
  HomeView: () => <h1 data-testid="inicio">Início</h1>,
}));
vi.mock("@/views/customer/AddressFormView", () => ({
  AddressFormView: () => <h1 data-testid="formulario">Novo Endereço</h1>,
}));

describe("App real — cadastro não deixa uma folha fantasma no histórico", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
    const armazem = () => {
      const dados = new Map<string, string>();
      return {
        getItem: (chave: string) => dados.get(chave) ?? null,
        setItem: (chave: string, valor: string) => dados.set(chave, valor),
        removeItem: (chave: string) => dados.delete(chave),
      };
    };
    vi.stubGlobal("localStorage", armazem());
    vi.stubGlobal("sessionStorage", armazem());
    vi.stubGlobal("scrollTo", vi.fn());
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    vi.stubGlobal("matchMedia", () => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
    }));
    // ÚNICA montagem da pilha. Depois daqui só ações da interface e back().
    window.history.replaceState({ view: "home" }, "", "/");
    window.history.pushState({ view: "cart", from: "home" }, "", "/cart");
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(async () => {
    await act(async () => raiz.unmount());
    hospedeiro.remove();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  async function esperar(condicao: () => void) {
    const prazo = Date.now() + 5_000;
    for (;;) {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
      });
      try {
        condicao();
        return;
      } catch (erro) {
        if (Date.now() >= prazo) throw erro;
      }
    }
  }

  async function clicar(texto: string) {
    const botao = Array.from(document.querySelectorAll("button")).find((b) =>
      b.textContent?.includes(texto),
    );
    expect(botao, texto).toBeDefined();
    await act(async () => botao?.click());
  }

  async function montar(strict: boolean) {
    const { default: App } = await import("@/App");
    await act(async () => {
      raiz.render(
        strict ? (
          <StrictMode>
            <App />
          </StrictMode>
        ) : (
          <App />
        ),
      );
    });
    await esperar(() => expect(hospedeiro.textContent).toContain("Trocar"));
  }

  async function abrirCadastro() {
    await clicar("Trocar");
    expect(window.history.state.folhaDePolitica).toBe(true);
    await clicar("Cadastrar novo endereço");
    await esperar(() => {
      expect(window.location.pathname).toBe("/address-form");
      expect(
        hospedeiro.querySelector('[data-testid="formulario"]'),
      ).not.toBeNull();
    });
    // A transição REAL sem View Transitions API destrava em 350 ms.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 450));
    });
  }

  it.each([false, true])(
    "depois de voltar do formulário, o PRIMEIRO Voltar no carrinho sai para o início (Strict Mode=%s)",
    async (strict) => {
      await montar(strict);
      await abrirCadastro();
      const voltar = vi.spyOn(window.history, "back");

      await act(async () => window.history.back());
      await esperar(() => expect(window.location.pathname).toBe("/cart"));
      expect(voltar).toHaveBeenCalledTimes(1);
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 450));
      });

      await act(async () => window.history.back());
      await esperar(() => expect(window.location.pathname).toBe("/"));
      expect(voltar).toHaveBeenCalledTimes(2);
      expect(window.history.state.folhaDePolitica).toBeUndefined();
    },
  );

  it("carrinho aberto direto (sem state.view): o PRIMEIRO Voltar também sai do /cart", async () => {
    // Atalho do ícone do app e aviso de carrinho esquecido abrem /cart sem
    // nenhum `view` gravado no estado do histórico.
    window.history.replaceState(null, "", "/cart");
    await montar(false);
    await abrirCadastro();
    const voltar = vi.spyOn(window.history, "back");

    await act(async () => window.history.back());
    await esperar(() => expect(window.location.pathname).toBe("/cart"));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 450));
    });

    await act(async () => window.history.back());
    await esperar(() => expect(window.location.pathname).toBe("/"));
    expect(voltar).toHaveBeenCalledTimes(2);
  });

  it("substitui a entrada da folha sem back, popstate nem crescimento da pilha", async () => {
    await montar(false);
    await clicar("Trocar");
    const entradas = window.history.length;
    const voltar = vi.spyOn(window.history, "back");
    const aoPopState = vi.fn();
    window.addEventListener("popstate", aoPopState);
    try {
      await clicar("Cadastrar novo endereço");
      await esperar(() =>
        expect(window.location.pathname).toBe("/address-form"),
      );
      expect(window.history.length).toBe(entradas);
      expect(window.history.state).toMatchObject({
        view: "address-form",
        from: "cart",
      });
      expect(window.history.state.folhaDePolitica).toBeUndefined();
      expect(voltar).not.toHaveBeenCalled();
      expect(aoPopState).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener("popstate", aoPopState);
    }
  });
});
