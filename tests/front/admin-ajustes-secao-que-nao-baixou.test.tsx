// @vitest-environment jsdom
//
// Ajustes do painel: a seção Mercado Pago é baixada sob demanda, quando o
// lojista abre o cabeçalho. Se o arquivo dela não baixa (aba antiga, versão
// nova no ar), só aquela seção mostra um aviso com "Tentar de novo": as outras
// seções e o que o lojista já digitou na tela continuam onde estavam.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const servidor = vi.hoisted(() => ({ ok: false }));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    user: { id: "admin-a" },
    session: { user: { id: "admin-a" } },
    isAdmin: true,
    adminStatus: "admin",
  }),
}));
vi.mock("@/lib/env-valores", () => ({
  lerSupabaseUrl: () => "https://abcdefghijklmnopqrst.supabase.co",
}));
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: {
      storeName: "Loja Teste",
      storeCity: "Uberlândia",
      storeState: "MG",
    },
    isLoaded: true,
    updateConfig: vi.fn().mockResolvedValue(true),
  }),
}));
vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));
vi.mock("@/lib/revisao-do-frete", () => ({
  descartarCacheDeFreteDoNavegador: vi.fn(),
}));
vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => ({ select: () => Promise.resolve({ data: [], error: null }) }),
    functions: {
      invoke: () => Promise.resolve({ data: { success: true }, error: null }),
    },
  },
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
// O arquivo da seção: pedir o módulo falha enquanto o servidor não responde
// (getter: o vitest guarda o resultado da fábrica entre os testes).
vi.mock("@/components/admin/settings/MercadoPagoSection", async () => {
  const { createElement } = await import("react");
  const Secao = () =>
    createElement("div", { "data-testid": "mp-ok" }, "chaves do Mercado Pago");
  return {
    get MercadoPagoSection() {
      if (!servidor.ok) {
        throw new TypeError(
          "Failed to fetch dynamically imported module: http://x/assets/MercadoPagoSection-abc.js",
        );
      }
      return Secao;
    },
  };
});

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

class ObservadorFalso {
  observe() {}
  unobserve() {}
  disconnect() {}
}

describe("Ajustes — seção Mercado Pago que não baixou", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    servidor.ok = false;
    vi.stubGlobal(
      "BroadcastChannel",
      class {
        postMessage() {}
        close() {}
        addEventListener() {}
        removeEventListener() {}
      },
    );
    vi.stubGlobal("ResizeObserver", ObservadorFalso);
    vi.stubGlobal("IntersectionObserver", ObservadorFalso);
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: false,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }));
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
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
    vi.restoreAllMocks();
  });

  const cabecalho = (texto: string) =>
    [...hospedeiro.querySelectorAll("button")].find((b) =>
      b.textContent?.includes(texto),
    ) as HTMLButtonElement | undefined;

  async function assentar() {
    await act(async () => {
      for (let i = 0; i < 12; i++) await Promise.resolve();
      await new Promise((r) => setTimeout(r, 30));
    });
  }

  async function abrirMercadoPago() {
    const { AdminSettingsView } = await import(
      "@/views/admin/AdminSettingsView"
    );
    await act(async () => {
      raiz.render(<AdminSettingsView onNavigate={vi.fn()} active={true} />);
    });
    await assentar();
    await act(async () => {
      cabecalho("Mercado Pago")?.click();
    });
    await assentar();
  }

  it("só a seção mostra o aviso: as outras seções da tela seguem no lugar", async () => {
    await abrirMercadoPago();

    expect(hospedeiro.querySelector('[role="alert"]')?.textContent).toContain(
      "Esta parte não abriu",
    );
    expect(cabecalho("Tentar de novo")).toBeDefined();
    expect(cabecalho("E-mail da loja")).toBeDefined();
    expect(cabecalho("Mercado Pago")).toBeDefined();
  });

  it("'Tentar de novo' com o arquivo de volta abre a seção", async () => {
    await abrirMercadoPago();

    servidor.ok = true;
    await act(async () => {
      cabecalho("Tentar de novo")?.click();
    });
    await assentar();

    expect(hospedeiro.querySelector('[data-testid="mp-ok"]')).not.toBeNull();
    expect(hospedeiro.querySelector('[role="alert"]')).toBeNull();
  });
});
