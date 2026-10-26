// @vitest-environment jsdom
//
// Na tela do produto, o Voltar do celular com "Ver no app" (ou a ajuda, o
// recorte, o leitor de código) aberto tirava a lojista da tela e caía na lista
// de produtos. Agora a camada aberta empurra uma entrada de histórico própria
// (mesmo esquema da tela de Banners): o Voltar fecha SÓ a camada e o
// formulário continua; fechar pelo botão da camada devolve a entrada.
import { act } from "react";
import type { ReactNode } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));

vi.mock("@/hooks/useProducts", () => ({
  useProducts: () => ({
    addProduct: vi.fn(),
    updateProduct: vi.fn(),
    upsertVariants: vi.fn().mockResolvedValue(true),
    deleteVariants: vi.fn().mockResolvedValue(undefined),
    uploadProductImages: vi.fn(),
    fetchProduct: vi.fn(),
  }),
}));

vi.mock("@/hooks/useCategories", () => ({
  useCategories: () => ({
    categories: [{ id: "cat-1", name: "Geral", slug: "geral" }],
    addCategory: vi.fn(),
  }),
}));

vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: { shippingCoverage: "national" } }),
}));

vi.mock("@/lib/supabase", () => ({ supabase: { rpc: mocks.rpc } }));

vi.mock("@/components/ui/select", () => ({
  Select: ({ children }: { children: ReactNode }) => <>{children}</>,
  SelectTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  SelectValue: () => null,
  SelectContent: ({ children }: { children: ReactNode }) => <>{children}</>,
  SelectItem: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock("sonner", () => ({
  toast: {
    info: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    loading: vi.fn(),
  },
}));

// A prévia pesada não importa aqui: só se ela está aberta ou não.
vi.mock("@/components/admin/PhoneSimulator", () => ({
  PhoneSimulator: ({ onClose }: { onClose: () => void }) => (
    <div data-testid="previa">
      <button type="button" onClick={onClose}>
        Fechar prévia
      </button>
    </div>
  ),
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const botaoPorTexto = (texto: string) =>
  [...document.body.querySelectorAll("button")].find((b) =>
    b.textContent?.includes(texto),
  ) as HTMLButtonElement | undefined;

const esperar = (ms = 20) =>
  act(async () => {
    await new Promise((r) => setTimeout(r, ms));
  });

describe("AdminProductFormView — Voltar do celular fecha só a camada aberta", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let overrideAtual: (() => void) | null = null;
  // Imita o `setBackOverride` (useState) do App: recebe `() => fn`.
  const onSetBackOverride = vi.fn((fn: unknown) => {
    overrideAtual =
      typeof fn === "function"
        ? (fn as () => (() => void) | null)()
        : (fn as (() => void) | null);
  });

  beforeEach(() => {
    vi.clearAllMocks();
    overrideAtual = null;
    mocks.rpc.mockResolvedValue({ data: { encontrado: false }, error: null });
    const armazem = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (c: string) => armazem.get(c) ?? null,
      setItem: (c: string, v: string) => {
        armazem.set(c, v);
      },
      removeItem: (c: string) => {
        armazem.delete(c);
      },
    });
    window.history.replaceState(
      { view: "admin-product-form" },
      "",
      "/admin-product-form",
    );
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

  async function montar() {
    const { AdminProductFormView } = await import(
      "@/views/admin/AdminProductFormView"
    );
    await act(async () => {
      raiz.render(
        <AdminProductFormView
          userId="u-teste"
          onNavigate={vi.fn()}
          onSetDirty={vi.fn()}
          onSetBackOverride={onSetBackOverride}
        />,
      );
    });
    await esperar();
  }

  const previaAberta = () =>
    document.querySelector('[data-testid="previa"]') !== null;

  it("abrir 'Ver no app' empurra uma entrada própria e registra o Voltar", async () => {
    await montar();
    expect(overrideAtual).toBeNull();

    await act(async () => {
      botaoPorTexto("Ver app")?.click();
    });

    expect(previaAberta()).toBe(true);
    expect(window.history.state).toMatchObject({
      view: "admin-product-form",
      modal: "produto",
    });
    expect(window.location.pathname).toBe("/admin-product-form");
    expect(overrideAtual).toBeInstanceOf(Function);
  });

  it("Voltar do celular (o navegador já fez o pop) fecha a prévia e o formulário continua", async () => {
    await montar();
    await act(async () => {
      botaoPorTexto("Ver app")?.click();
    });
    const voltar = vi.spyOn(window.history, "back");

    // O navegador tira a entrada da camada sozinho, antes do override rodar.
    window.history.replaceState({ view: "admin-product-form" }, "");
    await act(async () => {
      overrideAtual?.();
    });
    await esperar();

    expect(previaAberta()).toBe(false);
    expect(document.getElementById("product-name")).not.toBeNull();
    // Não consome mais nenhuma entrada (senão sairia da tela).
    expect(voltar).not.toHaveBeenCalled();
    expect(overrideAtual).toBeNull();
  });

  it("fechar pelo botão da prévia devolve a entrada de histórico sem sair da tela", async () => {
    await montar();
    await act(async () => {
      botaoPorTexto("Ver app")?.click();
    });
    const voltar = vi.spyOn(window.history, "back");

    await act(async () => {
      botaoPorTexto("Fechar prévia")?.click();
    });
    await esperar();

    expect(previaAberta()).toBe(false);
    expect(voltar).toHaveBeenCalledTimes(1);
    expect(document.getElementById("product-name")).not.toBeNull();
  });
});
