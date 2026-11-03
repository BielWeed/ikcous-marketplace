// @vitest-environment jsdom
// Caça 03/11 (achado d7, mais d9 na jornada): a entrada /auth do histórico não
// pode sobreviver ao login.
//
// Antes: visitante no checkout toca em "Pagar com PIX", é mandada ao login e,
// ao entrar, o App EMPURRAVA outra entrada (/checkout) por cima da de login.
// Histórico: [carrinho, checkout, auth, checkout']. A seta Voltar do app fazia
// history.back() para a entrada /auth, a guarda "logada não fica em /auth"
// trocava por /profile, e a cliente caía no PERFIL no meio da compra (Voltar
// de novo devolvia o pagamento de antes do login).
//
// Agora o destino SUBSTITUI a entrada de login (replaceState) e, quando o
// destino é a mesma tela que estava atrás do login E essa cópia tem uma
// entrada antes dela, a seta pula a cópia (history.go(-2)) em vez de gastar um
// toque sem efeito visível. Sem entrada antes (link direto), não pula.
//
// Andaime: o MESMO de destino-pos-login-volta-com-id.test.tsx.
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
  return { motion, AnimatePresence, useReducedMotion: () => true };
});

// Mutável de propósito: o teste loga a pessoa NO MEIO da jornada.
const { estadoAuth } = vi.hoisted(() => ({
  estadoAuth: {
    user: null as { id: string } | null,
    isAdmin: false,
    adminStatus: "not-admin",
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
        data-testid="ir-para-perfil-publico"
        onClick={() => onNavigate("user-profile", "outra-pessoa")}
      >
        Perfil público
      </button>
      <button
        type="button"
        data-testid="ir-para-carrinho"
        onClick={() => onNavigate("cart")}
      >
        Carrinho
      </button>
      <button
        type="button"
        data-testid="ir-para-pedidos"
        onClick={() => onNavigate("orders")}
      >
        Pedidos
      </button>
    </div>
  ),
}));
// O CartView real serve as abas Carrinho e Pedidos (a mesma instância).
vi.mock("@/views/customer/CartView", () => ({
  CartView: ({
    onNavigate,
  }: {
    readonly onNavigate: (view: string) => void;
  }) => (
    <div data-testid="tela-carrinho">
      <button
        type="button"
        data-testid="ir-para-checkout"
        onClick={() => onNavigate("checkout")}
      >
        Fechar compra
      </button>
      <button
        type="button"
        data-testid="entrar-pela-aba"
        onClick={() => onNavigate("auth")}
      >
        Entrar
      </button>
    </div>
  ),
}));
vi.mock("@/views/customer/CheckoutView", () => ({
  CheckoutView: ({
    onNavigate,
  }: {
    readonly onNavigate: (view: string) => void;
  }) => (
    <div data-testid="tela-checkout">
      <button
        type="button"
        data-testid="pagar-com-pix"
        onClick={() => onNavigate("auth")}
      >
        Pagar com PIX
      </button>
    </div>
  ),
}));
vi.mock("@/views/customer/ProductView", () => ({
  ProductView: () => <div data-testid="tela-produto" />,
}));
vi.mock("@/views/customer/ProfileView", () => ({
  ProfileView: () => <div data-testid="tela-perfil-proprio" />,
}));
// O duble expõe o `userId` recebido — é exatamente ele o objeto do conserto.
vi.mock("@/views/customer/UserProfileView", () => ({
  UserProfileView: ({ userId }: { readonly userId: string }) => (
    <div data-testid="tela-perfil-publico" data-user-id={userId} />
  ),
}));
vi.mock("@/views/shared/AuthView", async () => {
  const React = await import("react");
  return {
    // O AuthView real dispara `onSuccess` num `useEffect` que reage ao
    // `user` sair de `null`. O duble repete o MESMO mecanismo — e a ordem é
    // parte do que se prova: efeito de filho roda antes do efeito de pai,
    // então o onSuccess (e o repasse do id) vence a checagem do
    // `syncWithUrl` que devolveria um usuário logado em /auth ao perfil.
    AuthView: ({ onSuccess }: { readonly onSuccess: () => void }) => {
      // Local de propósito: é ele a dependência legítima do efeito — o
      // duble reexecuta a cada render do App e relê o estado mutável.
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
// A seta do cabeçalho é o `handleBack` do App: é ela que a cliente aperta.
vi.mock("@/components/ui/custom/Header", () => ({
  Header: ({ onBack }: { readonly onBack: () => void }) => (
    <button type="button" data-testid="seta-voltar" onClick={onBack}>
      Voltar
    </button>
  ),
}));
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
    error: () => {},
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

describe("a entrada de login não sobrevive ao login (Voltar não cai no Perfil)", () => {
  let raiz: Root | null = null;
  let container: HTMLDivElement | null = null;

  beforeEach(() => {
    estadoAuth.user = null;
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.stubGlobal("localStorage", dubleDeArmazem());
    vi.stubGlobal("sessionStorage", dubleDeArmazem());
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
    // O App agenda um setTimeout de 350 ms ao fim de cada transição de tela (App.tsx,
    // `onTransitionEnd`). Se ele disparar depois de o ambiente de teste ser desfeito, vira
    // "window is not defined" como erro não tratado e derruba o CI (visto na junção do PR 1227).
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 400));
    });
    const paraDesmontar = raiz;
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

  const existe = (marca: string) =>
    container?.querySelector(`[data-testid="${marca}"]`) != null;

  const abrir = async () => {
    await act(async () => {
      raiz?.render(<App />);
    });
    await assentar();
    expect(globalThis.history.state).toBeNull();
  };

  // Loga NO MEIO do teste (mesma mecânica do arquivo irmão).
  const entrar = async () => {
    estadoAuth.user = { id: "pessoa-logada" };
    await act(async () => {
      raiz?.render(<App />);
    });
    await assentar();
  };

  // O Voltar do NAVEGADOR/aparelho: o jsdom enfileira o popstate sozinho.
  const voltarDoAparelho = async () => {
    await act(async () => {
      globalThis.history.back();
    });
    await assentar();
  };

  it("checkout -> login -> entrar -> seta Voltar: cai no CARRINHO, nunca no Perfil, e nenhuma entrada de login resta atrás", async () => {
    await abrir();
    await clicar("ir-para-carrinho");
    await clicar("ir-para-checkout");
    expect(globalThis.location.pathname).toBe("/checkout");
    await clicar("pagar-com-pix");
    expect(globalThis.location.pathname).toBe("/auth");
    expect(globalThis.history.state?.from).toBe("checkout");

    await entrar();

    // Voltou ao pagamento (comportamento que já existia e tem de continuar).
    expect(globalThis.location.pathname).toBe("/checkout");
    expect(existe("tela-checkout")).toBe(true);
    expect(globalThis.history.state?.view).toBe("checkout");

    await clicar("seta-voltar");

    expect(globalThis.location.pathname).toBe("/cart");
    expect(existe("tela-perfil-proprio")).toBe(false);
    expect(existe("tela-carrinho")).toBe(true);

    // Anda o resto do histórico pelo Voltar do aparelho: /auth e /profile não
    // podem aparecer em ponto nenhum do caminho.
    const visitados: string[] = [];
    for (let i = 0; i < 3; i++) {
      await voltarDoAparelho();
      visitados.push(globalThis.location.pathname);
    }
    expect(visitados).not.toContain("/auth");
    expect(visitados).not.toContain("/profile");
  });

  it("Voltar do APARELHO logo depois de entrar também não passa por /auth nem /profile", async () => {
    await abrir();
    await clicar("ir-para-carrinho");
    await clicar("ir-para-checkout");
    await clicar("pagar-com-pix");
    await entrar();
    expect(globalThis.location.pathname).toBe("/checkout");

    const visitados: string[] = [];
    for (let i = 0; i < 3; i++) {
      await voltarDoAparelho();
      visitados.push(globalThis.location.pathname);
    }

    expect(visitados).not.toContain("/auth");
    expect(visitados).not.toContain("/profile");
    expect(visitados).toContain("/cart");
    // LIMITE CONHECIDO (só o Voltar do APARELHO; a seta do app pula): a cópia
    // de /checkout que o login deixou logo atrás ainda gasta um toque sem
    // efeito visível. Se alguém fechar isso, troque por ["/cart", ...].
    expect(visitados.slice(0, 2)).toEqual(["/checkout", "/cart"]);
  });

  it("aba Pedidos -> Entrar -> login: volta para Pedidos (d9) e a seta Voltar sai para a tela de antes", async () => {
    await abrir();
    await clicar("ir-para-pedidos");
    expect(globalThis.location.pathname).toBe("/orders");
    await clicar("entrar-pela-aba");
    expect(globalThis.location.pathname).toBe("/auth");
    expect(globalThis.history.state?.from).toBe("orders");

    await entrar();

    expect(globalThis.location.pathname).toBe("/orders");
    expect(existe("tela-perfil-proprio")).toBe(false);

    await clicar("seta-voltar");

    expect(globalThis.location.pathname).not.toBe("/auth");
    expect(globalThis.location.pathname).not.toBe("/profile");
    expect(globalThis.location.pathname).not.toBe("/orders");
    expect(existe("home")).toBe(true);
  });

  it("LIMITE: destino diferente da tela de origem (perfil público pedido da Home) — o destino ocupa o lugar do login e Voltar volta à Home", async () => {
    await abrir();
    await clicar("ir-para-perfil-publico");
    expect(globalThis.location.pathname).toBe("/auth");

    await entrar();

    expect(globalThis.location.pathname).toBe("/user-profile");
    expect(globalThis.location.search).toBe("?id=outra-pessoa");
    expect(existe("tela-perfil-publico")).toBe(true);

    await clicar("seta-voltar");

    expect(globalThis.location.pathname).not.toBe("/auth");
    expect(globalThis.location.pathname).not.toBe("/profile");
    expect(existe("home")).toBe(true);
  });

  it("LIMITE: /auth aberto direto (sem tela de origem) — entra no Perfil e a seta Voltar leva à Home, sem history.back()", async () => {
    await abrir();
    await act(async () => {
      globalThis.history.pushState({ view: "auth" }, "", "/auth");
      globalThis.dispatchEvent(
        new PopStateEvent("popstate", { state: { view: "auth" } }),
      );
    });
    await assentar();
    expect(globalThis.location.pathname).toBe("/auth");

    await entrar();

    expect(globalThis.location.pathname).toBe("/profile");
    // A entrada de login foi trocada, não empilhada: sem `from` herdado de
    // "auth", a seta cai no ramo absoluto (Home) em vez de history.back().
    expect(globalThis.history.state?.from).toBeUndefined();

    await clicar("seta-voltar");

    expect(existe("home")).toBe(true);
    expect(globalThis.location.pathname).not.toBe("/auth");
  });

  // Revisão do d7: a tela de ENTRADA aberta por link direto (WhatsApp, aba
  // nova, toque no aviso com o app fechado) não tem entrada alguma antes da
  // cópia. Pular "duas" ali (history.go(-2)) cai FORA do histórico: a seta
  // morre, ou a cliente sai da loja.
  it("LIMITE: /checkout aberto por LINK DIRETO -> Pagar -> entrar -> seta Voltar leva à Home (não morre, não sai da loja)", async () => {
    globalThis.history.replaceState(null, "", "/checkout");
    await abrir();
    expect(existe("tela-checkout")).toBe(true);
    await clicar("pagar-com-pix");
    expect(globalThis.location.pathname).toBe("/auth");

    await entrar();

    expect(globalThis.location.pathname).toBe("/checkout");
    expect(existe("tela-checkout")).toBe(true);

    const espiaGo = vi.spyOn(globalThis.history, "go");
    await clicar("seta-voltar");

    // Nunca pede ao navegador um passo que pode não existir.
    expect(espiaGo).not.toHaveBeenCalledWith(-2);
    expect(existe("home")).toBe(true);
    expect(globalThis.location.pathname).not.toBe("/auth");
    expect(globalThis.location.pathname).not.toBe("/profile");
  });

  it("LIMITE: /orders aberto por LINK DIRETO -> Entrar -> login -> volta a Pedidos e a seta Voltar leva à Home", async () => {
    globalThis.history.replaceState(null, "", "/orders");
    await abrir();
    await clicar("entrar-pela-aba");
    expect(globalThis.location.pathname).toBe("/auth");

    await entrar();

    expect(globalThis.location.pathname).toBe("/orders");

    const espiaGo = vi.spyOn(globalThis.history, "go");
    await clicar("seta-voltar");

    expect(espiaGo).not.toHaveBeenCalledWith(-2);
    expect(existe("home")).toBe(true);
  });

  it("LIMITE: sair do login SEM entrar (visitante vai para a Home) continua empilhando — a entrada de login não é trocada", async () => {
    await abrir();
    await clicar("ir-para-carrinho");
    await clicar("ir-para-checkout");
    await clicar("pagar-com-pix");
    expect(globalThis.location.pathname).toBe("/auth");

    // Sem conta: o BottomNav leva à Home. A entrada /auth tem de continuar
    // no histórico (Voltar volta ao login).
    await clicar("inicio");
    expect(globalThis.location.pathname).not.toBe("/auth");

    await voltarDoAparelho();

    expect(globalThis.location.pathname).toBe("/auth");
  });
});
