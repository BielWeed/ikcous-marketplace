// @vitest-environment jsdom
//
// Na tela do produto, o Voltar do celular com "Ver app" (ou a ajuda, o
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

  it("abrir 'Ver app' empurra uma entrada própria e registra o Voltar", async () => {
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
  // As janelas do formulário (variação, grade, categoria) também são camadas:
  // antes o Voltar com uma delas aberta deixava o App abrir "Alterações Não
  // Salvas" ATRÁS da janela (z-50 < z-[100]) e o toque ficava travado.
  const abrirVariacoes = async () => {
    await act(async () => {
      botaoPorTexto("Variações")?.click();
    });
    await esperar();
  };
  const voltarFisico = async () => {
    // O navegador tira a entrada da camada sozinho, antes do override rodar.
    window.history.replaceState({ view: "admin-product-form" }, "");
    await act(async () => {
      overrideAtual?.();
    });
    await esperar(60);
  };
  // A janela sai com animação de saída (framer-motion): espera ela sumir.
  const esperarSumir = async (achar: () => unknown) => {
    for (let i = 0; i < 40 && achar() !== null; i++) await esperar(50);
  };
  const janelaDeVariacao = () => document.getElementById("titulo-da-variacao");
  const janelaDaGrade = () => document.getElementById("titulo-da-grade");
  const folhaDeCategoria = () =>
    [...document.body.querySelectorAll('[role="dialog"]')].find((d) =>
      d.textContent?.includes("Onde este produto aparece na loja"),
    ) ?? null;

  it("Voltar com 'Nova variação' aberta fecha só a janela; o Voltar seguinte sai do cadastro", async () => {
    await montar();
    await abrirVariacoes();
    await act(async () => {
      botaoPorTexto("+ Novo")?.click();
    });
    await esperar();

    expect(janelaDeVariacao()).not.toBeNull();
    expect(window.history.state).toMatchObject({ modal: "produto" });
    expect(overrideAtual).toBeInstanceOf(Function);
    const voltar = vi.spyOn(window.history, "back");

    await voltarFisico();
    await esperarSumir(janelaDeVariacao);

    expect(janelaDeVariacao()).toBeNull();
    expect(document.getElementById("product-name")).not.toBeNull();
    expect(voltar).not.toHaveBeenCalled();
    // Sem desvio sobrando: o próximo Voltar é o do App (sair do cadastro).
    expect(overrideAtual).toBeNull();
  });

  it("Voltar fecha a variação e, ao reabrir, a janela volta limpa e o Voltar volta a valer", async () => {
    await montar();
    await abrirVariacoes();
    await act(async () => {
      botaoPorTexto("+ Novo")?.click();
    });
    await esperar();
    await voltarFisico();
    await esperarSumir(janelaDeVariacao);
    expect(janelaDeVariacao()).toBeNull();
    // Reabrir depois do Voltar abre uma janela de variação NOVA e de pé.
    await act(async () => {
      botaoPorTexto("+ Novo")?.click();
    });
    await esperar();
    expect(janelaDeVariacao()?.textContent).toBe("Nova variação");
    expect(overrideAtual).toBeInstanceOf(Function);
  });

  it("Voltar com a grade aberta fecha só a grade e o formulário continua", async () => {
    await montar();
    await abrirVariacoes();
    await act(async () => {
      (
        document.querySelector('[data-testid="abrir-grade"]') as HTMLElement
      )?.click();
    });
    await esperar();

    expect(janelaDaGrade()).not.toBeNull();
    expect(overrideAtual).toBeInstanceOf(Function);
    const voltar = vi.spyOn(window.history, "back");

    await voltarFisico();
    await esperarSumir(janelaDaGrade);

    expect(janelaDaGrade()).toBeNull();
    expect(document.getElementById("product-name")).not.toBeNull();
    expect(voltar).not.toHaveBeenCalled();
    expect(overrideAtual).toBeNull();
  });

  it("Voltar com a folha de Categoria aberta fecha só a folha", async () => {
    await montar();
    await act(async () => {
      document.getElementById("product-category")?.click();
    });
    await esperar();

    expect(folhaDeCategoria()).not.toBeNull();
    expect(overrideAtual).toBeInstanceOf(Function);
    const voltar = vi.spyOn(window.history, "back");

    await voltarFisico();

    expect(folhaDeCategoria()).toBeNull();
    expect(document.getElementById("product-name")).not.toBeNull();
    expect(voltar).not.toHaveBeenCalled();
    expect(overrideAtual).toBeNull();
  });

  it("Voltar com a folha 'Nova categoria' aberta fecha só ela", async () => {
    await montar();
    await act(async () => {
      document.getElementById("product-category")?.click();
    });
    await esperar();
    await act(async () => {
      botaoPorTexto("Nova categoria")?.click();
    });
    await esperar(100);

    expect(overrideAtual).toBeInstanceOf(Function);
    const abertas = () =>
      [...document.body.querySelectorAll('[role="dialog"]')].length;
    expect(abertas()).toBeGreaterThan(0);

    await voltarFisico();

    expect(abertas()).toBe(0);
    expect(document.getElementById("product-name")).not.toBeNull();
    expect(overrideAtual).toBeNull();
  });
});
