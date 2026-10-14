// @vitest-environment jsdom
//
// A FIAÇÃO do cartão de avisos no Início do painel. A aba do Início fica
// montada quando a lojista vai para outra tela; o cartão lê o navegador ao
// montar. Por isso ele só existe com o Início À VISTA (`active`): ao voltar,
// monta de novo, confere de novo e some sozinho se ligaram os avisos em outra
// tela. O cartão em si (casos, textos, teste de aviso) é provado em
// cartao-de-avisos-do-aparelho.test.tsx — aqui ele é um marcador.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/components/admin/inicio/CartaoDeAvisosDoAparelho", () => ({
  CartaoDeAvisosDoAparelho: () => <div data-testid="cartao-de-avisos" />,
}));
vi.mock("@/lib/supabase", () => ({
  supabase: {
    rpc: () => Promise.resolve({ data: null, error: null }),
    channel: () => {
      const canal = { on: () => canal, subscribe: () => canal };
      return canal;
    },
    removeChannel: () => undefined,
  },
}));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ profile: { full_name: "Gabriel Dono" }, isAdmin: true }),
}));
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: { storeName: "Loja do Gabriel" },
    isLoaded: true,
    products: [],
    loadingProducts: false,
  }),
}));
vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));
vi.mock("@/hooks/useScrollRestoration", () => ({
  useScrollRestoration: () => ({ ref: { current: null } }),
}));
vi.mock("@/hooks/usePrefetchOnHover", () => ({
  usePrefetchOnHover: () => ({ prefetchView: vi.fn() }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("Início — cartão de avisos do aparelho", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.resetModules();
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
  });

  async function montar(ativo: boolean) {
    const { AdminDashboardView } = await import(
      "@/views/admin/AdminDashboardView"
    );
    await act(async () => {
      raiz.render(<AdminDashboardView active={ativo} onNavigate={vi.fn()} />);
    });
  }

  it("com o Início à vista, o cartão está na tela", async () => {
    await montar(true);

    expect(
      hospedeiro.querySelector('[data-testid="cartao-de-avisos"]'),
    ).not.toBeNull();
  });

  it("com o Início montado mas fora de vista, o cartão não existe", async () => {
    await montar(false);

    expect(
      hospedeiro.querySelector('[data-testid="cartao-de-avisos"]'),
    ).toBeNull();
  });
});
