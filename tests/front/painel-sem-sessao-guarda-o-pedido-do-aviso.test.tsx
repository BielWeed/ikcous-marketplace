// @vitest-environment jsdom
// O aviso (push) de "Pedido novo" abre `/admin-orders?id=<pedido>`. A lojista
// cuja sessão venceu toca nele, entra com e-mail e senha e caía na LISTA de
// pedidos: o redirecionamento ao login trocava a URL por `/auth` ANTES de ler
// o `?id=`, e o retorno do login não repassava o id a `admin-orders`. Agora o
// id (só se for um uuid de pedido) viaja no state do login e chega à ficha.
//
// O mesmo caminho vale para `/admin-settings` e `/admin-product-form?id=<produto>`
// (18/11/2026): a lojista que perde a sessão com um produto em edição, ou nos
// Ajustes, entra de novo e volta para a MESMA tela, não para o Perfil de cliente.
//
// A segurança é o que se prova aqui junto: id malformado/script/URL é
// descartado, só `admin-orders` recebe o id, conta de cliente não ganha acesso
// ao painel por causa disto, e nada fica guardado no aparelho.
//
// Andaime: o MESMO de painel-sem-sessao-pede-entrada.test.tsx.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("framer-motion", async () => {
  const React = await import("react");
  const PROPS_DE_ANIMACAO = new Set([
    "initial",
    "animate",
    "exit",
    "transition",
    "variants",
    "custom",
    "layout",
    "layoutId",
    "whileTap",
    "whileHover",
    "whileInView",
    "whileDrag",
    "drag",
    "dragConstraints",
    "dragElastic",
    "onDragEnd",
    "onAnimationComplete",
    "onAnimationStart",
  ]);
  const criar = (tag: string) =>
    function DubleDeMotion({ children, ...resto }: Record<string, unknown>) {
      const limpo = Object.fromEntries(
        Object.entries(resto).filter(
          ([chave]) => !PROPS_DE_ANIMACAO.has(chave),
        ),
      );
      return React.createElement(tag, limpo, children as React.ReactNode);
    };
  const cache = new Map<string, unknown>();
  const motion = new Proxy({} as Record<string, unknown>, {
    get: (_alvo, tag) => {
      if (typeof tag !== "string") return undefined;
      if (!cache.has(tag)) cache.set(tag, criar(tag));
      return cache.get(tag);
    },
  });
  function AnimatePresence({ children }: { readonly children?: unknown }) {
    return React.createElement(
      React.Fragment,
      null,
      children as React.ReactNode,
    );
  }
  return {
    motion,
    AnimatePresence,
    useReducedMotion: () => true,
    useIsPresent: () => true,
  };
});

// Mutável de propósito: cada teste escolhe visitante, logada ou admin no ato.
const { estadoAuth, avisoErro, PEDIDO, PRODUTO } = vi.hoisted(() => ({
  PEDIDO: "3f2b8c1e-5a47-4d9e-9b1a-7c6d2e4f8a90",
  PRODUTO: "9a1c4e7b-2d3f-4a56-8b90-1c2d3e4f5a6b",
  // `toast.error` espiado: é o aviso "Acesso restrito" que a logada que não é
  // admin lê ao ser mandada para a vitrine.
  avisoErro: vi.fn(),
  estadoAuth: {
    user: null as { id: string } | null,
    isAdmin: false,
    adminStatus: "not-admin" as string,
    loading: false,
    isPasswordRecovery: false,
  },
}));

vi.mock("@/views/customer/HomeView", () => ({
  HomeView: ({
    onNavigate,
  }: {
    readonly onNavigate: (view: string, id?: string) => void;
  }) => (
    <div data-testid="home">
      <button
        type="button"
        data-testid="ir-para-pedido-valido"
        onClick={() => onNavigate("admin-orders", PEDIDO)}
      >
        Pedido do painel
      </button>
      <button
        type="button"
        data-testid="ir-para-produto-do-painel"
        onClick={() => onNavigate("admin-product-form", PRODUTO)}
      >
        Produto do painel
      </button>
      <button
        type="button"
        data-testid="ir-para-pedido-script"
        onClick={() => onNavigate("admin-orders", "javascript:alert(1)")}
      >
        Pedido malformado
      </button>
    </div>
  ),
}));
vi.mock("@/views/customer/CartView", () => ({
  CartView: () => <div data-testid="tela-carrinho" />,
}));
vi.mock("@/views/customer/ProductView", () => ({
  ProductView: () => <div data-testid="tela-produto" />,
}));
vi.mock("@/hooks/useAddresses", () => {
  const fetchAddresses = () => Promise.resolve();
  return {
    useAddresses: () => ({
      addresses: [{ id: "2c13b20b-933f-418b-877f-84b3d85bd08b" }],
      erroAoCarregar: false,
      fetchAddresses,
    }),
  };
});
vi.mock("@/components/ui/custom/AddressForm", () => ({
  AddressForm: ({ initialData }: { initialData?: { id: string } }) => (
    <form data-testid="formulario-endereco" data-id={initialData?.id} />
  ),
}));
vi.mock("@/views/customer/ProfileView", () => ({
  ProfileView: () => <div data-testid="tela-perfil-proprio" />,
}));
vi.mock("@/views/admin/AdminLoginView", () => ({
  AdminLoginView: () => <div data-testid="tela-login-do-lojista" />,
}));
// O portão real fala com o servidor (`is_admin`); aqui basta saber SE o painel
// montou — o que só acontece para quem o App já confirmou como admin.
vi.mock("@/components/layouts/AdminAreaGate", () => ({
  AdminAreaGate: ({
    currentView,
    selectedProductId,
  }: {
    readonly currentView: string;
    readonly selectedProductId: string | null;
  }) => (
    <div
      data-testid="painel"
      data-tela={currentView}
      data-id={selectedProductId ?? ""}
    />
  ),
}));
vi.mock("@/views/shared/AuthView", async () => {
  const React = await import("react");
  return {
    // O AuthView real dispara `onSuccess` num `useEffect` que reage ao
    // `user` sair de `null`. O duble repete o MESMO mecanismo.
    AuthView: ({ onSuccess }: { readonly onSuccess: () => void }) => {
      const user = estadoAuth.user;
      React.useEffect(() => {
        if (user) onSuccess();
      }, [user, onSuccess]);
      return <div data-testid="tela-login" />;
    },
  };
});

vi.mock("@/components/debug/DebugPanel", () => ({ DebugPanel: () => null }));
vi.mock("@/components/pwa/PushNotificationBanner", () => ({
  PushNotificationBanner: () => null,
}));
vi.mock("@/components/pwa/UpdateNotification", () => ({
  UpdateNotification: () => null,
}));
vi.mock("@/components/ui/custom/Header", () => ({ Header: () => null }));
vi.mock("@/components/ui/custom/BottomNav", () => ({
  BottomNav: ({
    onNavigate,
  }: { readonly onNavigate: (view: string) => void }) => (
    <button
      type="button"
      data-testid="inicio"
      onClick={() => onNavigate("home")}
    >
      Início
    </button>
  ),
}));
vi.mock("@/components/ui/custom/CartReminder", () => ({
  CartReminder: () => null,
}));
vi.mock("@/components/ui/sonner", () => ({ Toaster: () => null }));
vi.mock("sonner", () => ({
  toast: Object.assign(() => {}, {
    error: avisoErro,
    success: () => {},
    info: () => {},
    warning: () => {},
    message: () => {},
    loading: () => {},
    dismiss: () => {},
    custom: () => {},
  }),
}));

vi.mock("@/components/ui/custom/LocalErrorBoundary", () => ({
  LocalErrorBoundary: ({ children }: { readonly children?: unknown }) =>
    children as never,
}));

vi.mock("@/components/ui/alert-dialog", () => {
  const nada = () => null;
  return {
    AlertDialog: nada,
    AlertDialogAction: nada,
    AlertDialogCancel: nada,
    AlertDialogContent: nada,
    AlertDialogDescription: nada,
    AlertDialogFooter: nada,
    AlertDialogHeader: nada,
    AlertDialogTitle: nada,
  };
});

vi.mock("@/contexts/StoreContext", () => ({
  StoreProvider: ({ children }: { readonly children?: unknown }) =>
    children as never,
  useStore: () => ({ config: null }),
}));
vi.mock("@/contexts/CartContext", () => ({
  CartProvider: ({ children }: { readonly children?: unknown }) =>
    children as never,
  useCartState: () => ({ cartCount: 0 }),
  useCartActions: () => ({ addToCart: () => {} }),
  useCartContext: () => ({ cartCount: 0, addToCart: () => {} }),
}));
vi.mock("@/contexts/FavoritesContext", () => ({
  FavoritesProvider: ({ children }: { readonly children?: unknown }) =>
    children as never,
}));

vi.mock("@/hooks/useCart", () => ({
  useCart: () => ({ cartCount: 0, addToCart: () => {} }),
  useCartState: () => ({ cartCount: 0 }),
  useCartActions: () => ({ addToCart: () => {} }),
}));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => estadoAuth,
}));
vi.mock("@/hooks/useProducts", () => ({
  useProducts: () => ({
    products: [{ id: "produto-A" }],
    loading: false,
  }),
}));
vi.mock("@/hooks/useFavorites", () => ({
  useFavorites: () => ({
    favorites: [],
    toggleFavorite: () => {},
    isFavorite: () => false,
    loading: false,
  }),
}));
vi.mock("@/hooks/useAppBadge", () => ({
  useAppBadge: () => ({ setBadge: () => {}, clearBadge: () => {} }),
}));
vi.mock("@/hooks/usePrefetchOnHover", () => ({
  usePrefetchOnHover: () => ({
    prefetchView: () => {},
    prefetchAll: () => {},
    prefetchViewPromise: () => Promise.resolve(),
  }),
}));
vi.mock("@/hooks/useNetworkAdaptive", () => ({
  useNetworkAdaptive: () => ({ isSlow: () => false }),
}));
vi.mock("@/hooks/useUpdateCheck", () => ({
  useUpdateCheck: () => ({
    checkUpdate: () => {},
    updateAvailable: false,
    newVersion: null,
    performNuclearPurge: () => {},
  }),
}));
vi.mock("@/hooks/useBehavioralPrefetch", () => ({
  useBehavioralPrefetch: () => {},
}));
vi.mock("@/hooks/useCacheWarmer", () => ({ useCacheWarmer: () => {} }));
vi.mock("@/hooks/usePredictiveNavigation", () => ({
  usePredictiveNavigation: () => {},
}));
vi.mock("@/hooks/useSwipeBack", () => ({ useSwipeBack: () => {} }));
vi.mock("@/hooks/useWebVitals", () => ({ useWebVitals: () => {} }));
vi.mock("@/hooks/useRealtimeUpdate", () => ({ useRealtimeUpdate: () => {} }));

vi.mock("@/lib/supabase", () => {
  const consulta: Record<string, unknown> = {};
  consulta.select = () => consulta;
  consulta.eq = () => consulta;
  consulta.single = () =>
    Promise.resolve({
      data: null,
      error: { message: "not found", code: "PGRST116" },
    });
  return {
    supabase: {
      from: () => consulta,
      rpc: () => Promise.resolve({ data: false, error: null }),
      auth: { getSession: () => Promise.resolve({ data: { session: null } }) },
      channel: () => ({
        on: () => ({ subscribe: () => ({}) }),
        subscribe: () => ({}),
      }),
      removeChannel: () => {},
    },
  };
});

import App from "@/App";

// --- Buracos do jsdom -------------------------------------------------
class ObservadorDeInterseccao {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return [];
  }
}

function dubleDeArmazem() {
  const dados = new Map<string, string>();
  return {
    getItem: (chave: string) => dados.get(chave) ?? null,
    setItem: (chave: string, valor: string) => {
      dados.set(chave, String(valor));
    },
    removeItem: (chave: string) => {
      dados.delete(chave);
    },
    clear: () => {
      dados.clear();
    },
    key: (i: number) => Array.from(dados.keys()).at(i) ?? null,
    get length() {
      return dados.size;
    },
  };
}

describe("o pedido do aviso atravessa o login até a ficha", () => {
  let raiz: Root | null = null;
  let container: HTMLDivElement | null = null;
  let armazemLocal = dubleDeArmazem();
  let armazemSessao = dubleDeArmazem();

  beforeEach(() => {
    estadoAuth.user = null;
    estadoAuth.isAdmin = false;
    estadoAuth.adminStatus = "not-admin";
    estadoAuth.loading = false;
    avisoErro.mockClear();
    armazemLocal = dubleDeArmazem();
    armazemSessao = dubleDeArmazem();
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubGlobal("localStorage", armazemLocal);
    vi.stubGlobal("sessionStorage", armazemSessao);
    vi.stubGlobal("IntersectionObserver", ObservadorDeInterseccao);
    vi.stubGlobal("scrollTo", () => {});
    vi.stubGlobal("matchMedia", (consulta: string) => ({
      matches: false,
      media: consulta,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }));
    if (!Element.prototype.scrollTo) {
      Element.prototype.scrollTo = () => {};
    }

    // @ts-expect-error — bandeira interna do React para o `act`
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;

    globalThis.history.replaceState(null, "", "/");

    container = document.createElement("div");
    document.body.append(container);
    raiz = createRoot(container);
  });

  afterEach(async () => {
    const paraDesmontar = raiz;
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 200));
    });
    await act(async () => {
      paraDesmontar?.unmount();
    });
    container?.remove();
    raiz = null;
    container = null;
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  const assentar = async (voltas = 10) => {
    for (let i = 0; i < voltas; i++) {
      await act(async () => {
        await Promise.resolve();
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
    }
  };

  const clicar = async (marca: string) => {
    const botao = container?.querySelector<HTMLButtonElement>(
      `[data-testid="${marca}"]`,
    );
    if (!botao) throw new Error(`botão ${marca} não encontrado`);
    await act(async () => {
      botao.click();
    });
    await assentar();
  };

  // Abre o app JÁ no endereço (é o que o toque no aviso faz: janela nova).
  const abrirEm = async (endereco: string) => {
    globalThis.history.replaceState(null, "", endereco);
    await act(async () => {
      raiz?.render(<App />);
    });
    await assentar();
  };

  const abrirNaVitrine = async () => {
    await act(async () => {
      raiz?.render(<App />);
    });
    await assentar();
  };

  const tela = (marca: string) =>
    container?.querySelector(`[data-testid="${marca}"]`) ?? null;

  // A ordem REAL de um login (AuthContext, SIGNED_IN): primeiro o usuário novo
  // com `loading: true`, depois o veredito do servidor.
  const entrarEmDoisPassos = async (comoAdmin: boolean) => {
    estadoAuth.user = { id: "pessoa-logada" };
    estadoAuth.loading = true;
    estadoAuth.adminStatus = "not-admin";
    await act(async () => {
      raiz?.render(<App />);
    });
    await assentar();

    estadoAuth.isAdmin = comoAdmin;
    estadoAuth.adminStatus = comoAdmin ? "admin" : "not-admin";
    estadoAuth.loading = false;
    await act(async () => {
      raiz?.render(<App />);
    });
    await assentar();
  };

  const idDaFicha = () => tela("painel")?.getAttribute("data-id");

  const guardadoNoAparelho = () =>
    JSON.stringify([
      Array.from({ length: armazemLocal.length }, (_, i) =>
        armazemLocal.getItem(armazemLocal.key(i) ?? ""),
      ),
      Array.from({ length: armazemSessao.length }, (_, i) =>
        armazemSessao.getItem(armazemSessao.key(i) ?? ""),
      ),
    ]);

  it("(a) sessão vencida: o aviso abre /admin-orders?id=<pedido>, a lojista entra e cai na FICHA daquele pedido", async () => {
    await abrirEm(`/admin-orders?id=${PEDIDO}`);

    // Entrada: o pedido fica guardado no state (a URL de login não o carrega).
    expect(globalThis.location.pathname).toBe("/auth");
    expect(globalThis.location.search).toBe("");
    expect(globalThis.history.state?.requested).toBe("admin-orders");
    expect(globalThis.history.state?.id).toBe(PEDIDO);
    expect(tela("tela-login")).not.toBeNull();
    expect(tela("painel")).toBeNull();

    await entrarEmDoisPassos(true);

    expect(tela("painel")?.getAttribute("data-tela")).toBe("admin-orders");
    expect(idDaFicha()).toBe(PEDIDO);
    expect(globalThis.location.pathname).toBe("/admin-orders");
    expect(globalThis.location.search).toBe(`?id=${PEDIDO}`);
    expect(globalThis.history.state?.view).toBe("admin-orders");
    expect(globalThis.history.state?.id).toBe(PEDIDO);
    expect(tela("tela-login")).toBeNull();
  });

  it("(a) o uuid em maiúsculas (link digitado à mão) também chega à ficha", async () => {
    const maiusculo = PEDIDO.toUpperCase();
    await abrirEm(`/admin-orders?id=${maiusculo}`);
    await entrarEmDoisPassos(true);

    expect(idDaFicha()).toBe(maiusculo);
  });

  it("(a) a navegação interna sem sessão (handleNavigate com o id do pedido) também chega à ficha", async () => {
    await abrirNaVitrine();
    await clicar("ir-para-pedido-valido");
    expect(globalThis.location.pathname).toBe("/auth");

    await entrarEmDoisPassos(true);

    expect(tela("painel")?.getAttribute("data-tela")).toBe("admin-orders");
    expect(idDaFicha()).toBe(PEDIDO);
    expect(globalThis.location.search).toBe(`?id=${PEDIDO}`);
  });

  it("(a controle) sem id no aviso, a lojista continua caindo na LISTA, sem `?id` fantasma", async () => {
    await abrirEm("/admin-orders");
    expect(globalThis.history.state?.id ?? null).toBeNull();

    await entrarEmDoisPassos(true);

    expect(tela("painel")?.getAttribute("data-tela")).toBe("admin-orders");
    expect(idDaFicha()).toBe("");
    expect(globalThis.location.search).toBe("");
  });

  it.each([
    ["script", "javascript:alert(1)"],
    ["URL sem protocolo", "//evil.com"],
    ["URL completa", "https://evil.com/pedido"],
    ["subida de pasta", "../"],
    ["texto longo", "a".repeat(5000)],
    ["tag", "<script>alert(1)</script>"],
    ["uuid com sobra", `${PEDIDO}x`],
    ["uuid com quebra de linha", `${PEDIDO}\n`],
    ["código curto", "ped-1"],
    ["vazio", ""],
  ])(
    "(b) id malformado (%s) é descartado: depois de entrar abre a LISTA, nada de `?id`",
    async (_nome, lixo) => {
      await abrirEm(`/admin-orders?id=${encodeURIComponent(lixo)}`);

      // Nem entra no state do login.
      expect(globalThis.location.pathname).toBe("/auth");
      expect(globalThis.history.state?.requested).toBe("admin-orders");
      expect(globalThis.history.state?.id ?? null).toBeNull();

      await entrarEmDoisPassos(true);

      expect(tela("painel")?.getAttribute("data-tela")).toBe("admin-orders");
      expect(idDaFicha()).toBe("");
      expect(globalThis.location.pathname).toBe("/admin-orders");
      expect(globalThis.location.search).toBe("");
      expect(globalThis.history.state?.id ?? null).toBeNull();
      expect(globalThis.location.href).not.toContain("evil");
    },
  );

  it("(b) navegação interna com id malformado: descartado, abre a lista", async () => {
    await abrirNaVitrine();
    await clicar("ir-para-pedido-script");
    expect(globalThis.location.pathname).toBe("/auth");

    await entrarEmDoisPassos(true);

    expect(tela("painel")?.getAttribute("data-tela")).toBe("admin-orders");
    expect(idDaFicha()).toBe("");
    expect(globalThis.location.search).toBe("");
    expect(globalThis.history.state?.id ?? null).toBeNull();
  });

  it("(b) state FORJADO no /auth (a própria página grava o history.state): id que não é uuid não é repassado", async () => {
    await abrirNaVitrine();
    await act(async () => {
      const estado = {
        view: "auth",
        requested: "admin-orders",
        id: "javascript:alert(1)",
      };
      globalThis.history.pushState(estado, "", "/auth");
      globalThis.dispatchEvent(
        new PopStateEvent("popstate", { state: estado }),
      );
    });
    await assentar();
    expect(tela("tela-login")).not.toBeNull();

    await entrarEmDoisPassos(true);

    expect(tela("painel")?.getAttribute("data-tela")).toBe("admin-orders");
    expect(idDaFicha()).toBe("");
    expect(globalThis.location.search).toBe("");
  });

  it("(c) conta de CLIENTE que entra pelo aviso nunca vê o painel nem o pedido: vai à vitrine, sem o id", async () => {
    await abrirEm(`/admin-orders?id=${PEDIDO}`);
    expect(globalThis.history.state?.id).toBe(PEDIDO);

    await entrarEmDoisPassos(false);

    expect(tela("painel")).toBeNull();
    expect(tela("home")).not.toBeNull();
    expect(globalThis.history.state?.view).toBe("home");
    expect(globalThis.location.pathname).not.toContain("admin");
    expect(globalThis.location.href).not.toContain(PEDIDO);
    expect(globalThis.history.state?.id ?? null).toBeNull();
    expect(avisoErro).toHaveBeenCalledWith(
      "Acesso restrito a administradores.",
    );
  });

  it("(c) cliente JÁ logada abrindo /admin-orders?id=… segue indo à vitrine, como hoje", async () => {
    estadoAuth.user = { id: "pessoa-logada" };
    await abrirEm(`/admin-orders?id=${PEDIDO}`);

    expect(tela("tela-login")).toBeNull();
    expect(tela("painel")).toBeNull();
    expect(tela("home")).not.toBeNull();
    expect(globalThis.location.pathname).not.toContain("admin");
    expect(globalThis.location.href).not.toContain(PEDIDO);
  });

  it("(c) admin JÁ logada abrindo /admin-orders?id=… chega direto à ficha, sem passar pelo login", async () => {
    estadoAuth.user = { id: "lojista" };
    estadoAuth.isAdmin = true;
    estadoAuth.adminStatus = "admin";
    await abrirEm(`/admin-orders?id=${PEDIDO}`);

    expect(tela("tela-login")).toBeNull();
    expect(idDaFicha()).toBe(PEDIDO);
  });

  it("(d) o id de pedido não vaza para outra tela do painel: /admin-settings?id=… volta aos Ajustes SEM id", async () => {
    await abrirEm(`/admin-settings?id=${PEDIDO}`);
    expect(globalThis.location.pathname).toBe("/auth");
    expect(globalThis.history.state?.requested).toBe("admin-settings");
    expect(globalThis.history.state?.id ?? null).toBeNull();

    await entrarEmDoisPassos(true);

    expect(tela("painel")?.getAttribute("data-tela")).toBe("admin-settings");
    expect(idDaFicha()).toBe("");
    expect(globalThis.location.pathname).toBe("/admin-settings");
    expect(globalThis.location.search).toBe("");
    expect(globalThis.history.state?.id ?? null).toBeNull();
  });

  it("sessão vencida no Financeiro: admin volta à tela, sem id", async () => {
    await abrirEm(`/admin-financeiro?id=${PEDIDO}`);
    expect(globalThis.location.pathname).toBe("/auth");

    await entrarEmDoisPassos(true);

    expect(tela("painel")?.getAttribute("data-tela")).toBe("admin-financeiro");
    expect(globalThis.location.pathname).toBe("/admin-financeiro");
    expect(globalThis.location.search).toBe("");
    expect(idDaFicha()).toBe("");
  });

  it("cliente que entra pelo link do Financeiro não vê o painel", async () => {
    await abrirEm("/admin-financeiro");

    await entrarEmDoisPassos(false);

    expect(tela("painel")).toBeNull();
    expect(tela("home")).not.toBeNull();
    expect(avisoErro).toHaveBeenCalledWith(
      "Acesso restrito a administradores.",
    );
  });

  it("o link de edição reabre o mesmo endereço da conta depois do login", async () => {
    const endereco = "2c13b20b-933f-418b-877f-84b3d85bd08b";
    await abrirEm(`/address-form?id=${endereco}`);
    expect(globalThis.location.pathname).toBe("/auth");
    expect(globalThis.history.state?.id).toBe(endereco);

    await entrarEmDoisPassos(false);

    expect(tela("formulario-endereco")?.getAttribute("data-id")).toBe(endereco);
    expect(globalThis.location.pathname + globalThis.location.search).toBe(
      `/address-form?id=${endereco}`,
    );
  });

  it("endereço fora da lista da conta leva à lista com aviso, sem abrir cadastro", async () => {
    const endereco = "2c13b20b-933f-418b-877f-84b3d85bd08c";
    await abrirEm(`/address-form?id=${endereco}`);
    expect(globalThis.location.pathname).toBe("/auth");
    const idGuardado = globalThis.history.state?.id;

    await entrarEmDoisPassos(false);

    expect(idGuardado).toBe(endereco);
    expect(avisoErro).toHaveBeenCalledWith("Este endereço não existe mais.");
    expect(tela("formulario-endereco")).toBeNull();
    expect(tela("tela-perfil-proprio")).not.toBeNull();
    expect(globalThis.location.pathname).toBe("/profile");
  });

  it("id malformado em link de edição não abre cadastro novo", async () => {
    await abrirEm("/address-form?id=");

    await entrarEmDoisPassos(false);

    expect(tela("tela-perfil-proprio")).not.toBeNull();
    expect(tela("formulario-endereco")).toBeNull();
  });

  it("(d) outra tela do painel (/admin-dashboard?id=…) segue FORA da lista: depois de entrar vai ao perfil, sem id", async () => {
    await abrirEm(`/admin-dashboard?id=${PEDIDO}`);
    expect(globalThis.location.pathname).toBe("/auth");
    expect(globalThis.history.state?.id ?? null).toBeNull();

    await entrarEmDoisPassos(true);

    expect(tela("painel")).toBeNull();
    expect(globalThis.location.pathname).toBe("/profile");
    expect(globalThis.location.search).toBe("");
    expect(globalThis.history.state?.id ?? null).toBeNull();
  });

  it("(d) a porta do painel (/admin?id=…) chega ao painel SEM id", async () => {
    await abrirEm(`/admin?id=${PEDIDO}`);
    expect(globalThis.history.state?.id ?? null).toBeNull();

    await entrarEmDoisPassos(true);

    expect(tela("painel")?.getAttribute("data-tela")).toBe("admin");
    expect(idDaFicha()).toBe("");
    expect(globalThis.location.search).toBe("");
  });

  it("(d) state forjado com id de pedido e destino que não é admin-orders: o id não segue para a outra rota", async () => {
    await abrirNaVitrine();
    await act(async () => {
      const estado = { view: "auth", requested: "admin", id: PEDIDO };
      globalThis.history.pushState(estado, "", "/auth");
      globalThis.dispatchEvent(
        new PopStateEvent("popstate", { state: estado }),
      );
    });
    await assentar();

    await entrarEmDoisPassos(true);

    expect(tela("painel")?.getAttribute("data-tela")).toBe("admin");
    expect(idDaFicha()).toBe("");
    expect(globalThis.history.state?.id ?? null).toBeNull();
    expect(globalThis.location.search).toBe("");
  });

  it("(e) sessão vencida em /admin-settings: a lojista entra e volta aos Ajustes, não ao Perfil de cliente", async () => {
    await abrirEm("/admin-settings");

    expect(globalThis.location.pathname).toBe("/auth");
    expect(globalThis.history.state?.requested).toBe("admin-settings");
    expect(tela("painel")).toBeNull();

    await entrarEmDoisPassos(true);

    expect(tela("painel")?.getAttribute("data-tela")).toBe("admin-settings");
    expect(globalThis.location.pathname).toBe("/admin-settings");
    expect(globalThis.history.state?.view).toBe("admin-settings");
    expect(tela("tela-perfil-proprio")).toBeNull();
    expect(tela("tela-login")).toBeNull();
  });

  it("(e) sessão vencida editando um produto: a lojista entra e volta ao MESMO produto (id preservado na ficha e na URL)", async () => {
    await abrirEm(`/admin-product-form?id=${PRODUTO}`);

    // Entrada: o produto fica guardado no state (a URL de login não o carrega).
    expect(globalThis.location.pathname).toBe("/auth");
    expect(globalThis.location.search).toBe("");
    expect(globalThis.history.state?.requested).toBe("admin-product-form");
    expect(globalThis.history.state?.id).toBe(PRODUTO);
    expect(tela("painel")).toBeNull();

    await entrarEmDoisPassos(true);

    expect(tela("painel")?.getAttribute("data-tela")).toBe(
      "admin-product-form",
    );
    expect(idDaFicha()).toBe(PRODUTO);
    expect(globalThis.location.pathname).toBe("/admin-product-form");
    expect(globalThis.location.search).toBe(`?id=${PRODUTO}`);
    expect(globalThis.history.state?.view).toBe("admin-product-form");
    expect(globalThis.history.state?.id).toBe(PRODUTO);
    expect(globalThis.history.state?.requested).toBeUndefined();
    expect(tela("tela-perfil-proprio")).toBeNull();
    expect(tela("tela-login")).toBeNull();
  });

  it("(e) produto NOVO (sem id) que perde a sessão volta ao formulário de produto novo, sem `?id` fantasma", async () => {
    await abrirEm("/admin-product-form");
    expect(globalThis.history.state?.requested).toBe("admin-product-form");

    await entrarEmDoisPassos(true);

    expect(tela("painel")?.getAttribute("data-tela")).toBe(
      "admin-product-form",
    );
    expect(idDaFicha()).toBe("");
    expect(globalThis.location.search).toBe("");
  });

  it("(e) a navegação interna sem sessão para o produto (handleNavigate com id) também volta ao mesmo produto", async () => {
    await abrirNaVitrine();
    await clicar("ir-para-produto-do-painel");
    expect(globalThis.location.pathname).toBe("/auth");
    expect(globalThis.history.state?.requested).toBe("admin-product-form");

    await entrarEmDoisPassos(true);

    expect(tela("painel")?.getAttribute("data-tela")).toBe(
      "admin-product-form",
    );
    expect(idDaFicha()).toBe(PRODUTO);
    expect(globalThis.location.search).toBe(`?id=${PRODUTO}`);
  });

  it("(e) CLIENTE que entra com o produto guardado nunca vê o painel nem o produto: vai à vitrine, sem o id, com o aviso", async () => {
    await abrirEm(`/admin-product-form?id=${PRODUTO}`);
    expect(globalThis.history.state?.id).toBe(PRODUTO);

    await entrarEmDoisPassos(false);

    expect(tela("painel")).toBeNull();
    expect(tela("home")).not.toBeNull();
    expect(globalThis.history.state?.view).toBe("home");
    expect(globalThis.location.pathname).not.toContain("admin");
    expect(globalThis.location.href).not.toContain(PRODUTO);
    expect(globalThis.history.state?.id ?? null).toBeNull();
    expect(avisoErro).toHaveBeenCalledWith(
      "Acesso restrito a administradores.",
    );
  });

  it("(e) CLIENTE que entra com /admin-settings guardado nunca vê o painel: vai à vitrine, com o aviso", async () => {
    await abrirEm("/admin-settings");

    await entrarEmDoisPassos(false);

    expect(tela("painel")).toBeNull();
    expect(tela("home")).not.toBeNull();
    expect(globalThis.history.state?.view).toBe("home");
    expect(globalThis.location.pathname).not.toContain("admin");
    expect(avisoErro).toHaveBeenCalledWith(
      "Acesso restrito a administradores.",
    );
  });

  it.each([
    ["script", "javascript:alert(1)"],
    ["URL sem protocolo", "//evil.com"],
    ["subida de pasta", "../"],
    ["texto longo", "a".repeat(5000)],
    ["uuid com sobra", `${PRODUTO}x`],
    ["código curto", "produto-A"],
    ["vazio", ""],
  ])(
    "(e) id de produto malformado (%s) é descartado: o formulário abre sem `?id`, nada de lixo na URL",
    async (_nome, lixo) => {
      await abrirEm(`/admin-product-form?id=${encodeURIComponent(lixo)}`);

      expect(globalThis.location.pathname).toBe("/auth");
      expect(globalThis.history.state?.requested).toBe("admin-product-form");
      expect(globalThis.history.state?.id ?? null).toBeNull();

      await entrarEmDoisPassos(true);

      expect(tela("painel")?.getAttribute("data-tela")).toBe(
        "admin-product-form",
      );
      expect(idDaFicha()).toBe("");
      expect(globalThis.location.search).toBe("");
      expect(globalThis.location.href).not.toContain("evil");
    },
  );

  it("(e) state FORJADO no /auth com id que não é uuid: não é repassado ao formulário de produto", async () => {
    await abrirNaVitrine();
    await act(async () => {
      const estado = {
        view: "auth",
        requested: "admin-product-form",
        id: "javascript:alert(1)",
      };
      globalThis.history.pushState(estado, "", "/auth");
      globalThis.dispatchEvent(
        new PopStateEvent("popstate", { state: estado }),
      );
    });
    await assentar();
    expect(tela("tela-login")).not.toBeNull();

    await entrarEmDoisPassos(true);

    expect(tela("painel")?.getAttribute("data-tela")).toBe(
      "admin-product-form",
    );
    expect(idDaFicha()).toBe("");
    expect(globalThis.location.search).toBe("");
  });

  it("(e) o id de PRODUTO não vaza para os Ajustes: state forjado só leva o id a admin-product-form", async () => {
    await abrirNaVitrine();
    await act(async () => {
      const estado = { view: "auth", requested: "admin-settings", id: PRODUTO };
      globalThis.history.pushState(estado, "", "/auth");
      globalThis.dispatchEvent(
        new PopStateEvent("popstate", { state: estado }),
      );
    });
    await assentar();

    await entrarEmDoisPassos(true);

    expect(tela("painel")?.getAttribute("data-tela")).toBe("admin-settings");
    expect(idDaFicha()).toBe("");
    expect(globalThis.location.search).toBe("");
  });

  it("(e) o produto em edição não fica guardado no aparelho (só no state do login, que o destino substitui)", async () => {
    await abrirEm(`/admin-product-form?id=${PRODUTO}`);
    expect(guardadoNoAparelho()).not.toContain(PRODUTO);

    await entrarEmDoisPassos(true);

    expect(idDaFicha()).toBe(PRODUTO);
    expect(guardadoNoAparelho()).not.toContain(PRODUTO);
  });

  it("(d) depois do uso o pedido não fica guardado: a entrada de login some, `requested` some, nada vai ao armazenamento do aparelho", async () => {
    await abrirEm(`/admin-orders?id=${PEDIDO}`);
    expect(guardadoNoAparelho()).not.toContain(PEDIDO);

    await entrarEmDoisPassos(true);

    expect(idDaFicha()).toBe(PEDIDO);
    // O state da ficha é o do destino: o `requested` do login não o acompanha.
    expect(globalThis.history.state?.requested).toBeUndefined();
    expect(globalThis.history.state?.view).toBe("admin-orders");
    expect(guardadoNoAparelho()).not.toContain(PEDIDO);
  });
});
