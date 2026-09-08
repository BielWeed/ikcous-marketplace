// @vitest-environment jsdom
import { branding } from "@/config/branding";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let mockConfig: { storeName?: string | null } = {};
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: mockConfig, isLoaded: true }),
}));

// As consultas do painel são independentes do nome; não acessamos rede.
vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => {
      const result = Promise.resolve({ count: 0, error: null });
      const builder = {
        select: () => builder,
        eq: () => builder,
        in: () => result,
        is: () => result,
      };
      return builder;
    },
    rpc: () => Promise.resolve({ data: { total_count: 0 }, error: null }),
    channel: () => ({
      on() {
        return this;
      },
      subscribe: vi.fn(),
    }),
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
vi.mock("@/hooks/useAddresses", () => ({
  useAddresses: () => ({
    addresses: [],
    fetchAddresses: vi.fn(),
    addAddress: vi.fn(),
    updateAddress: vi.fn(),
  }),
}));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: null, profile: null }),
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("nome configurado no painel e no endereço", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    mockConfig = {};
    vi.stubGlobal(
      "BroadcastChannel",
      class {
        postMessage() {}
        close() {}
        addEventListener() {}
        removeEventListener() {}
      },
    );
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    vi.stubGlobal("matchMedia", () => ({
      matches: false,
      addEventListener() {},
      removeEventListener() {},
    }));
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
    vi.unstubAllGlobals();
  });

  async function painel() {
    const { AdminLayout } = await import("@/components/layouts/AdminLayout");
    await act(async () => {
      raiz.render(
        <AdminLayout currentView="admin-dashboard" onNavigate={vi.fn()}>
          <div />
        </AdminLayout>,
      );
    });
  }

  it("critério 2 — h1, aba e prévia do painel usam Savy Store", async () => {
    mockConfig = { storeName: "Savy Store" };
    await painel();
    expect(hospedeiro.querySelector("h1")?.textContent).toBe(
      "Savy Store Admin",
    );
    expect(hospedeiro.querySelector("h1 span")?.className).toContain(
      "text-admin-gold",
    );
    expect(document.title).toBe("Savy Store | Admin Dashboard");
    expect(
      document
        .querySelector('meta[property="og:title"]')
        ?.getAttribute("content"),
    ).toBe("Savy Store Admin");
  });

  it("critério 2 — nome ausente usa a marca do build no h1 e na aba", async () => {
    await painel();
    expect(hospedeiro.querySelector("h1")?.textContent).toBe(
      `${branding.appName} Admin`,
    );
    expect(document.title).toBe(`${branding.appName} | Admin Dashboard`);
  });

  it("o painel acompanha a configuração que chega após montar", async () => {
    await painel();
    mockConfig = { storeName: "  Savy Store  " };
    await painel();
    expect(hospedeiro.querySelector("h1")?.textContent).toBe(
      "Savy Store Admin",
    );
    expect(document.title).toBe("Savy Store | Admin Dashboard");
  });

  it.each([{ storeName: "Savy Store" }, { storeName: null }])(
    "critério 3 — endereço novo identifica a loja: %j",
    async (config) => {
      mockConfig = config;
      const { AddressFormView } = await import(
        "@/views/customer/AddressFormView"
      );
      await act(async () => raiz.render(<AddressFormView onBack={vi.fn()} />));
      expect(hospedeiro.textContent).toContain(
        `Onde entregaremos seu produto da ${config.storeName || branding.appName}?`,
      );
    },
  );
});
