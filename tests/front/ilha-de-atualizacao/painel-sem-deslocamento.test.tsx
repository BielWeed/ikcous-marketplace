// @vitest-environment jsdom
import { AdminLayout } from "@/components/layouts/AdminLayout";
import { definirEstadoDaAtualizacao } from "@/lib/atualizacao/estado-da-atualizacao";
import { type ReactNode, act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: {} }),
}));
vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: vi.fn(() => {
      const resultado = Promise.resolve({ count: 0, error: null });
      type Contagem = typeof resultado &
        Record<
          "select" | "in" | "or" | "is" | "eq" | "gte" | "maybeSingle",
          () => Contagem
        >;
      const builder: Contagem = Object.assign(resultado, {
        select: () => builder,
        in: () => builder,
        or: () => builder,
        is: () => builder,
        eq: () => builder,
        gte: () => builder,
        maybeSingle: () => builder,
      });
      return builder;
    }),
    rpc: vi.fn(() =>
      Promise.resolve({
        data: { total_count: 0, total: 0, itens: [], contagem: {} },
        error: null,
      }),
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
vi.mock("@/hooks/useOnlineStatus", () => ({
  useConnectionDiagnostics: () => ({
    isOffline: false,
    latency: 0,
    quality: "good",
  }),
}));
vi.mock("framer-motion", async (importOriginal) => ({
  ...(await importOriginal<typeof import("framer-motion")>()),
  AnimatePresence: ({ children }: { children?: ReactNode }) => <>{children}</>,
  useReducedMotion: () => true,
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("ilha do painel sem deslocar o PDV", () => {
  let host: HTMLDivElement;
  let raiz: Root;

  beforeEach(() => {
    definirEstadoDaAtualizacao({ fase: "nenhuma", versaoNova: null });
    vi.stubGlobal(
      "BroadcastChannel",
      class {
        postMessage() {}
        close() {}
        addEventListener() {}
        removeEventListener() {}
      },
    );
    vi.stubGlobal("matchMedia", (media: string) => ({
      matches: false,
      media,
      addEventListener() {},
      removeEventListener() {},
      addListener() {},
      removeListener() {},
    }));
    host = document.createElement("div");
    document.body.appendChild(host);
    raiz = createRoot(host);
  });

  afterEach(() => {
    act(() => raiz.unmount());
    definirEstadoDaAtualizacao({ fase: "nenhuma", versaoNova: null });
    host.remove();
  });

  async function montar() {
    await act(async () => {
      raiz.render(
        <AdminLayout currentView="admin-pdv" onNavigate={vi.fn()}>
          <button type="button">Produto do PDV</button>
        </AdminLayout>,
      );
    });
  }

  function regiao() {
    const status = host.querySelector('header [role="status"]');
    if (!(status instanceof HTMLElement)) {
      throw new Error("Região de anúncio da ilha ausente");
    }
    return status;
  }

  it("sobrepõe abaixo do header, centraliza e só a pílula recebe ponteiro", async () => {
    await montar();
    const header = host.querySelector("header");
    const classesDoHeader = header?.className;
    const sobreposicao = regiao().parentElement;
    act(() => definirEstadoDaAtualizacao({ fase: "aguardando" }));

    expect(sobreposicao?.classList.contains("absolute")).toBe(true);
    expect(sobreposicao?.classList.contains("top-full")).toBe(true);
    expect(sobreposicao?.classList.contains("inset-x-0")).toBe(true);
    expect(sobreposicao?.classList.contains("justify-center")).toBe(true);
    expect(sobreposicao?.classList.contains("z-[100]")).toBe(true);
    expect(sobreposicao?.classList.contains("pointer-events-none")).toBe(true);
    const pilula = regiao().firstElementChild;
    expect(pilula?.classList.contains("pointer-events-auto")).toBe(true);
    expect(pilula?.classList.contains("min-h-6")).toBe(true);
    expect(regiao().textContent).toBe("Atualização pronta");
    expect(regiao().querySelector("button, [tabindex]")).toBeNull();
    expect(header?.className).toBe(classesDoHeader);
    expect(
      host.querySelector('header button[aria-label="Notificações"]'),
    ).not.toBeNull();
  });

  it("mantém aria-live vazio, sem caixa ou reserva de altura, antes e após o aviso", async () => {
    await montar();
    const status = regiao();
    const sobreposicao = status.parentElement;
    expect(status.getAttribute("aria-live")).toBe("polite");
    expect(status.getAttribute("aria-atomic")).toBe("true");
    expect(status.classList.contains("contents")).toBe(true);
    expect(status.childElementCount).toBe(0);
    // jsdom não mede layout: posição fora do fluxo e ausência de padding,
    // margem ou altura no invólucro são o contrato verificável aqui.
    expect(sobreposicao?.classList.contains("absolute")).toBe(true);
    expect(sobreposicao?.className).not.toMatch(
      /(?:^|\s)(?:min-h-|h-|p[tyb]?-|m[tyb]?-)/,
    );

    act(() => definirEstadoDaAtualizacao({ fase: "aguardando" }));
    act(() => definirEstadoDaAtualizacao({ fase: "nenhuma" }));

    expect(regiao()).toBe(status);
    expect(status.textContent).toBe("");
    expect(status.childElementCount).toBe(0);
    expect(status.parentElement).toBe(sobreposicao);
  });
});
