// @vitest-environment jsdom
//
// Avisar clientes: a previa da notificacao mostra o ICONE DO APP (icon_192),
// o mesmo que o celular do cliente recebe (sw.ts) - nunca a logo larga do
// cabecalho (config.logoUrl). Sem icone, a inicial da loja.
import { buildIdentity } from "@/config/buildIdentity";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { estadoDoBanco } = vi.hoisted(() => ({
  estadoDoBanco: {
    subCount: 8,
    porSegmento: {
      vip: [{ id: "1" }, { id: "2" }] as unknown[],
      inactive: [] as unknown[],
      new: [] as unknown[],
    } as Record<string, unknown[] | null>,
    historico: [] as Record<string, unknown>[],
  },
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: "admin-1" } }),
}));

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: {
      realTimeSalesAlerts: false,
      storeName: "Loja Teste",
      logoUrl:
        "https://x.supabase.co/storage/v1/object/public/branding/header.png",
    },
    isLoaded: true,
    updateConfig: vi.fn(),
  }),
}));

vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));

vi.mock("@/hooks/usePushNotifications", () => ({
  usePushNotifications: () => ({
    // true: o bloco "Ajustes" só existe quando o botão de teste aparece (a
    // chave de avisos de compras está escondida).
    isSupported: true,
    subscribe: vi.fn(),
  }),
}));

vi.mock("@/hooks/useVOR", () => ({
  useVOR: () => ({ recordAction: vi.fn() }),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: (tabela: string) => {
      if (tabela === "push_subscriptions") {
        return {
          select: () =>
            Promise.resolve({ count: estadoDoBanco.subCount, error: null }),
        };
      }
      if (tabela === "push_notifications_log") {
        return {
          select: () => ({
            order: () => ({
              limit: () =>
                Promise.resolve({ data: estadoDoBanco.historico, error: null }),
            }),
          }),
        };
      }
      // vw_produtos_public, public_profiles: sem linha — não é o que este
      // arquivo mede.
      if (tabela === "vw_produtos_public") {
        return {
          select: () => ({
            eq: () => ({
              // `.order("nome").order("id").range()`: o desempate por id.
              order: () => ({
                order: () => ({
                  range: () =>
                    Promise.resolve({
                      data: [{ id: "p1", nome: "Tênis Veloz" }],
                      error: null,
                    }),
                }),
              }),
            }),
          }),
        };
      }
      return {
        select: () => ({
          order: () => ({
            limit: () => Promise.resolve({ data: [], error: null }),
          }),
          eq: () => ({
            order: () =>
              Object.assign(Promise.resolve({ data: [], error: null }), {
                range: () => Promise.resolve({ data: [], error: null }),
              }),
          }),
        }),
      };
    },
    rpc: (nome: string, args: { p_segment: string }) => {
      // Mesma fronteira do irmão: medição pela count, envio pela targets —
      // este arquivo não envia, então a targets só precisa existir.
      if (
        nome !== "get_segmented_push_targets" &&
        nome !== "get_segmented_push_count"
      ) {
        return Promise.resolve({
          data: null,
          error: new Error("rpc desconhecida"),
        });
      }
      const linhas = estadoDoBanco.porSegmento[args.p_segment] ?? null;
      if (linhas === null) {
        return Promise.resolve({
          data: null,
          error: new Error("sem segmento"),
        });
      }
      if (nome === "get_segmented_push_count") {
        return Promise.resolve({ data: linhas.length, error: null });
      }
      return Promise.resolve({ data: linhas, error: null });
    },
    functions: { invoke: vi.fn() },
  },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
class IntersectionObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

function esperar(ms = 0): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("AdminPushView — previa usa o icone do app", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
    estadoDoBanco.subCount = 8;
    estadoDoBanco.porSegmento = {
      vip: [{ id: "1" }, { id: "2" }],
      inactive: [],
      new: [],
    };
    estadoDoBanco.historico = [];
    const armazem = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (chave: string) => armazem.get(chave) ?? null,
      setItem: (chave: string, valor: string) => {
        armazem.set(chave, valor);
      },
      removeItem: (chave: string) => {
        armazem.delete(chave);
      },
    });
    vi.stubGlobal("ResizeObserver", ResizeObserverStub);
    vi.stubGlobal("IntersectionObserver", IntersectionObserverStub);
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: false,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }));
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    vi.restoreAllMocks();
  });

  async function abrirTela() {
    const { AdminPushView } = await import("@/views/admin/AdminPushView");
    await act(async () => {
      raiz.render(<AdminPushView onNavigate={vi.fn()} />);
    });
    await act(async () => {
      await esperar(50);
    });
  }

  const previa = () =>
    hospedeiro.querySelector('[data-testid="previa-celular"]') as HTMLElement;

  it("a imagem da notificacao e o icone do app, nao a logo do cabecalho", async () => {
    await abrirTela();
    const img = previa().querySelector("img");
    expect(img).not.toBeNull();
    expect(img?.getAttribute("src")).toBe(buildIdentity.localUrls.icon_192);
    expect(previa().innerHTML).not.toContain("branding/header.png");
  });

  it("se o icone nao carrega, aparece a inicial da loja", async () => {
    await abrirTela();
    const img = previa().querySelector("img") as HTMLImageElement;
    await act(async () => {
      img.dispatchEvent(new Event("error"));
    });
    expect(previa().querySelector("img")).toBeNull();
    expect(previa().textContent).toContain("L");
  });
});
