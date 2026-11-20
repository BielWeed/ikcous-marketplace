// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

const addProduct = vi.fn();
const updateProduct = vi.fn();
const fetchProduct = vi.fn();
const onNavigate = vi.fn();
const onSetDirty = vi.fn();
const rpcDoSupabase = vi.fn();

vi.mock("@/hooks/useProducts", () => ({
  useProducts: () => ({
    addProduct,
    updateProduct,
    upsertVariants: vi.fn().mockResolvedValue(undefined),
    deleteVariants: vi.fn().mockResolvedValue(undefined),
    uploadProductImages: vi.fn().mockResolvedValue([]),
    fetchProduct,
  }),
}));

vi.mock("@/hooks/useCategories", () => ({
  useCategories: () => ({
    categories: [{ id: "cat-1", name: "Geral", slug: "geral" }],
    addCategory: vi.fn(),
  }),
}));

vi.mock("@/hooks/useOnlineStatus", () => ({
  useOnlineStatus: () => false,
}));

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: { shippingCoverage: "national" } }),
}));

// A duplicidade contra o catálogo inteiro é checada pela MESMA RPC do PDV
// (buscar_por_codigo_barras). A view importa o cliente Supabase por import
// DINÂMICO dentro de conferirCodigoNoBanco — o mock abaixo intercepta essa
// importação tardia do mesmo jeito que interceptaria um import estático.
vi.mock("@/lib/supabase", () => ({
  supabase: { rpc: rpcDoSupabase },
}));

const toastInfo = vi.fn();
const toastSuccess = vi.fn();
const toastError = vi.fn();
vi.mock("sonner", () => ({
  toast: {
    info: toastInfo,
    success: toastSuccess,
    error: toastError,
    loading: vi.fn(),
  },
}));

// @ts-expect-error flag interna do React, sem tipo público — mesmo padrão do
// molde admin-product-form-draft-e-duplo-clique.test.tsx.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function esperarMicrotarefas(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function campoPorId(id: string): HTMLInputElement {
  const el = document.getElementById(id) as HTMLInputElement | null;
  if (!el) {
    throw new Error(`campo ausente nesta tela: #${id}`);
  }
  return el;
}

// LocalBufferedInput/LocalBufferedTextarea só propagam o valor digitado para
// o estado depois do debounce (200ms por padrão).
function digitarInput(id: string, valor: string) {
  const el = campoPorId(id);
  const setter = Object.getOwnPropertyDescriptor(
    globalThis.HTMLInputElement.prototype,
    "value",
  )!.set!;
  setter.call(el, valor);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

function respostaDeProduto(id: string, nome: string) {
  return {
    data: {
      encontrado: true,
      origem: "produto",
      codigo: "7891234567890",
      produto: {
        id,
        nome,
        ativo: true,
        preco_venda: 100,
        estoque: 1,
        imagem: null,
        codigo_barras: "7891234567890",
        tem_variantes: false,
      },
      variante: null,
      preco: 100,
      estoque: 1,
      variacoes: [],
    },
    error: null,
  };
}

it.each([false, true])(
  "distingue erro anunciado de falha de rede (rede falhou: %s)",
  async (falhou) => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    try {
      rpcDoSupabase.mockResolvedValue(
        falhou
          ? { error: new TypeError("Failed to fetch") }
          : respostaDeProduto("outro", "Camiseta Azul"),
      );
      const { AdminProductFormView } = await import(
        "@/views/admin/AdminProductFormView"
      );
      await act(async () =>
        root.render(
          <AdminProductFormView
            userId="u-teste"
            onNavigate={onNavigate}
            onSetDirty={onSetDirty}
          />,
        ),
      );
      const novo = [...host.querySelectorAll("button")].find((botao) =>
        botao.textContent?.includes("+ Novo"),
      )!;
      await act(async () => novo.click());
      const id = "variant-codigo-barras";
      const campo = campoPorId(id);
      const cancelar = [...document.querySelectorAll("button")]
        .filter((botao) => botao.textContent?.trim() === "Cancelar")
        .at(-1)!;
      expect(campo.hasAttribute("aria-invalid")).toBe(false);
      await act(async () => {
        campo.focus();
        digitarInput(id, "7891234567890");
      });
      await act(async () => {
        cancelar.focus();
        await esperarMicrotarefas();
      });
      expect(rpcDoSupabase).toHaveBeenCalledWith("buscar_por_codigo_barras", {
        p_codigo: "7891234567890",
      });
      expect(document.activeElement).toBe(cancelar);
      if (falhou) {
        expect(document.body.textContent).toContain(
          "Não consegui conferir agora.",
        );
        expect(campo.hasAttribute("aria-invalid")).toBe(false);
        expect(campo.hasAttribute("aria-describedby")).toBe(false);
      } else {
        expect(campo.getAttribute("aria-invalid")).toBe("true");
        const ids = campo.getAttribute("aria-describedby")?.split(" ") ?? [];
        const alerta = ids
          .map((id) => document.getElementById(id))
          .find((elemento) => elemento?.getAttribute("role") === "alert");
        expect(alerta?.textContent).toContain(
          "Este código já está em Camiseta Azul",
        );
      }
    } finally {
      await act(async () => root.unmount());
      host.remove();
      localStorage.clear();
      rpcDoSupabase.mockReset();
    }
  },
);
