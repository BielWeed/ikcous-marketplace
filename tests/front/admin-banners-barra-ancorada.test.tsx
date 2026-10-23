import type { View } from "@/types";
// @vitest-environment jsdom
//
// BARRA DE BANNERS — um só botão "Novo banner", ancorado na barra do topo
// (o do corpo da lista saiu): compacto, de cor sólida do tema, sem selo rosa,
// sem gradiente nem sombra pesada. Offline: desabilitado, com o motivo ligado.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

type Diagnostico = {
  isOffline: boolean;
  quality: "excellent" | "good" | "slow" | "offline";
  latency: number;
};
const diagnostico = vi.hoisted(() => ({
  atual: {
    isOffline: false,
    quality: "excellent",
    latency: 80,
  } as Diagnostico,
}));

vi.mock("@/hooks/useOnlineStatus", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/hooks/useOnlineStatus")>()),
  useConnectionDiagnostics: () => diagnostico.atual,
}));

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: {} }),
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: vi.fn(() => {
      const builder: any = {};
      builder.select = vi.fn(() => builder);
      builder.eq = vi.fn(() => builder);
      builder.in = vi.fn(() => builder);
      builder.or = vi.fn(() => builder);
      builder.is = vi.fn(() => builder);
      // biome-ignore lint/suspicious/noThenProperty: mock do query builder thenable do Supabase
      builder.then = (resolve: any, reject?: any) =>
        Promise.resolve({ count: 0, error: null }).then(resolve, reject);
      return builder;
    }),
    rpc: vi.fn(() =>
      Promise.resolve({ data: { total_count: 0 }, error: null }),
    ),
    channel: vi.fn(() => ({
      on: vi.fn().mockReturnThis(),
      subscribe: vi.fn(),
    })),
    removeChannel: vi.fn(),
  },
}));

vi.mock("@/hooks/useAnalytics", () => ({
  useAnalytics: () => ({
    fetchExecutiveSummary: vi.fn(),
    fetchCategoryAnalytics: vi.fn(),
  }),
}));

vi.mock("@/hooks/useLeaderElection", () => ({
  useLeaderElection: () => ({ isLeader: false }),
}));

vi.mock("@/hooks/useOrders", () => ({
  useOrders: () => ({ loadOrders: vi.fn() }),
}));

vi.mock("@/hooks/useProducts", () => ({
  useProducts: () => ({ loadProducts: vi.fn() }),
}));

describe("AdminLayout — barra ancorada de Banners", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    diagnostico.atual = { isOffline: false, quality: "excellent", latency: 80 };
    vi.stubGlobal(
      "BroadcastChannel",
      class {
        postMessage() {}
        close() {}
        addEventListener() {}
        removeEventListener() {}
      },
    );
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
    vi.unstubAllGlobals();
  });

  async function montar(currentView: View = "admin-banners") {
    const { AdminLayout } = await import("@/components/layouts/AdminLayout");
    await act(async () => {
      raiz.render(
        <AdminLayout currentView={currentView} onNavigate={vi.fn()}>
          <div />
        </AdminLayout>,
      );
    });
  }

  function botoesNovoBanner(): HTMLButtonElement[] {
    return Array.from(hospedeiro.querySelectorAll("button")).filter((b) =>
      /^(novo banner|indispon)/i.test(b.textContent?.trim() ?? ""),
    ) as HTMLButtonElement[];
  }

  it("tem UM botão 'Novo banner', compacto e sólido, sem gradiente nem sombra pesada", async () => {
    await montar();
    const botoes = botoesNovoBanner();
    expect(botoes).toHaveLength(1);
    const b = botoes[0];
    expect(b.textContent?.trim()).toBe("Novo banner");
    expect(b.className).toContain("min-h-11");
    expect(b.className).toContain("rounded-full");
    expect(b.className).toContain("bg-foreground");
    expect(b.className).toContain("text-background");
    expect(b.className).not.toContain("admin-gold");
    expect(b.className).not.toContain("bg-gradient-to-b");
    expect(b.className).not.toContain("shadow-lg");
    expect(b.className).toContain("focus-visible:ring-2");
  });

  it("a barra não tem mais o selo rosa e mantém o título Banners", async () => {
    await montar();
    expect(hospedeiro.innerHTML).not.toContain("pink-300");
    const titulo = Array.from(hospedeiro.querySelectorAll("h1")).find(
      (h) => h.textContent === "Banners",
    );
    expect(titulo).toBeTruthy();
  });

  it("online: o clique dispara o evento que abre o formulário", async () => {
    const abrir = vi.fn();
    window.addEventListener("admin:open-new-banner-dialog", abrir);
    try {
      await montar();
      act(() => botoesNovoBanner()[0].click());
      expect(abrir).toHaveBeenCalledTimes(1);
    } finally {
      window.removeEventListener("admin:open-new-banner-dialog", abrir);
    }
  });

  it("offline: desabilitado, texto curto e motivo ligado por aria-describedby", async () => {
    diagnostico.atual = { isOffline: true, quality: "offline", latency: 0 };
    await montar();
    const b = botoesNovoBanner()[0];
    expect(b.disabled).toBe(true);
    expect(b.textContent?.trim()).toBe("Indisponível offline");
    expect(
      document.getElementById(b.getAttribute("aria-describedby")!)?.textContent,
    ).toBe("Disponível quando a conexão retornar.");
  });

  it("a barra some enquanto o editor de banner está aberto", async () => {
    await montar();
    expect(botoesNovoBanner()).toHaveLength(1);
    await act(async () => {
      window.dispatchEvent(
        new CustomEvent("admin:banner-dialog-state", {
          detail: { open: true },
        }),
      );
    });
    expect(botoesNovoBanner()).toHaveLength(0);
  });
});
