// @vitest-environment jsdom
//
// O rascunho de um produto em edição não pode guardar o id provisório (`temp-…`)
// de uma variação que o salvar JÁ gravou no banco.
//
// A corrida: depois de uma recusa de exclusão, o formulário relê o produto do
// banco (`await fetchProduct`) e passa a ser igual a ele. Se o rascunho for
// apagado ANTES dessa espera, o salvamento automático (agendado 1 s antes) dispara
// no meio dela e regrava o rascunho com a variação nova ainda como `temp-…`.
// Depois da releitura o formulário está igual ao banco e ninguém mais apaga esse
// rascunho: ao reabrir, "Restaurar" + Salvar insere a variação de novo (duas
// linhas, o dobro à venda).
//
// Provado aqui: (1) com releitura lenta o rascunho final NÃO tem `temp-`;
// (2) o salvamento automático não grava enquanto o salvar está em andamento;
// (3) o uso normal continua guardando o rascunho.
import { act } from "react";
import type { ReactNode } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fetchProduct = vi.fn();
const updateProduct = vi.fn();
const upsertVariants = vi.fn();
const deleteVariants = vi.fn();
vi.mock("@/hooks/useProducts", () => ({
  useProducts: () => ({
    addProduct: vi.fn(),
    updateProduct,
    upsertVariants,
    deleteVariants,
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

vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: { shippingCoverage: "national" } }),
}));

vi.mock("@/components/ui/select", () => ({
  Select: ({
    value,
    onValueChange,
    children,
  }: {
    value: string;
    onValueChange: (v: string) => void;
    children: ReactNode;
  }) => (
    <select
      data-testid="select-category"
      value={value}
      onChange={(e) => onValueChange(e.target.value)}
    >
      <option value="" />
      {children}
    </select>
  ),
  SelectTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  SelectValue: () => null,
  SelectContent: ({ children }: { children: ReactNode }) => <>{children}</>,
  SelectItem: ({ value, children }: { value: string; children: ReactNode }) => (
    <option value={value}>{children}</option>
  ),
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

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function digitar(id: string, valor: string) {
  const el = document.getElementById(id) as HTMLInputElement | null;
  if (!el) throw new Error(`Campo "${id}" não está na tela.`);
  Object.getOwnPropertyDescriptor(
    globalThis.HTMLInputElement.prototype,
    "value",
  )?.set?.call(el, valor);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

async function digitarCampo(id: string, valor: string) {
  await act(async () => {
    digitar(id, valor);
    await new Promise((r) => setTimeout(r, 300));
  });
}

const botaoPorTexto = (texto: string) =>
  [...document.querySelectorAll("button")].find(
    (b) => b.textContent?.trim() === texto,
  ) as HTMLButtonElement | undefined;

const variacao = (id: string, valor: string, estoque: number) => ({
  id,
  productId: "p-1",
  name: "Cor",
  value: valor,
  stockIncrement: estoque,
  active: true,
});

// O erro que o Postgres devolve ao apagar variação que já está num pedido.
const ERRO_VENDIDA = {
  code: "23503",
  message:
    'update or delete on table "product_variants" violates foreign key constraint "marketplace_order_items_variant_id_fkey" on table "marketplace_order_items"',
};

const CHAVE_DO_RASCUNHO = "ikcous_product_form_draft_edit_p-1:lojista-1";

const produtoBase = {
  id: "p-1",
  name: "Camiseta",
  description: "Algodão",
  price: 50,
  stock: 5,
  sold: 3,
  category: "Geral",
  images: [],
  freeShipping: false,
  isBestseller: false,
  isActive: true,
};

describe("AdminProductFormView — rascunho x releitura do banco", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let armazem: Map<string, string>;
  let gravacoes: string[];
  let eventos: string[];

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    armazem = new Map();
    gravacoes = [];
    eventos = [];
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => armazem.get(k) ?? null,
      setItem: (k: string, v: string) => {
        gravacoes.push(v);
        eventos.push(v.includes("temp-") ? "grava-com-temp" : "grava");
        armazem.set(k, v);
      },
      removeItem: (k: string) => {
        eventos.push("apaga");
        armazem.delete(k);
      },
    });
    updateProduct.mockResolvedValue(undefined);
    upsertVariants.mockResolvedValue(undefined);
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
          productId="p-1"
          userId="lojista-1"
          onNavigate={vi.fn()}
          onSetDirty={vi.fn()}
        />,
      );
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
  }

  const idsNoRascunho = (): string[] => {
    const bruto = armazem.get(CHAVE_DO_RASCUNHO);
    if (!bruto) return [];
    return (JSON.parse(bruto).variants as Array<{ id: string }>).map(
      (v) => v.id,
    );
  };

  it("releitura LENTA depois da recusa: o rascunho final não guarda a variação nova com id provisório", async () => {
    deleteVariants.mockRejectedValueOnce({
      ...ERRO_VENDIDA,
      recusadas: ["v2"],
    });
    fetchProduct.mockResolvedValueOnce({
      ...produtoBase,
      variants: [variacao("v1", "Rosa", 3), variacao("v2", "Azul", 2)],
    });
    // Releitura lenta (rede de celular): 1,5 s, mais que o 1 s do auto-save.
    fetchProduct.mockImplementationOnce(
      () =>
        new Promise((resolver) =>
          setTimeout(
            () =>
              resolver({
                ...produtoBase,
                stock: 9,
                variants: [
                  variacao("v1", "Rosa", 3),
                  variacao("v2", "Azul", 2),
                  variacao("v-verde", "Verde", 4),
                ],
              }),
            1500,
          ),
        ),
    );
    await montar();
    await act(async () => {
      (
        document.querySelector(
          '[aria-label="Excluir variação Azul"]',
        ) as HTMLButtonElement
      ).click();
    });
    await act(async () => {
      botaoPorTexto("Excluir Variante")?.click();
    });
    await act(async () => {
      (
        [...document.querySelectorAll("button")].find((b) =>
          b.textContent?.includes("+ Novo"),
        ) as HTMLButtonElement
      ).click();
    });
    await digitarCampo("variant-name", "Cor");
    await digitarCampo("variant-value", "Verde");
    await digitarCampo("variant-stock", "4");
    await act(async () => {
      botaoPorTexto("Salvar variação")?.click();
    });

    await act(async () => {
      botaoPorTexto("Salvar")?.click();
      await new Promise((r) => setTimeout(r, 2500));
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 1500));
    });

    expect(fetchProduct).toHaveBeenCalledTimes(2);
    // Depois do último "apaga", nenhuma gravação do rascunho levou o id
    // provisório; e o que sobra no fim também não o tem.
    const depoisDoApaga = eventos.slice(eventos.lastIndexOf("apaga") + 1);
    expect(depoisDoApaga).not.toContain("grava-com-temp");
    expect(idsNoRascunho().filter((id) => id.startsWith("temp-"))).toEqual([]);
  }, 20000);

  it("enquanto o salvar está em andamento o salvamento automático não grava o rascunho", async () => {
    fetchProduct.mockResolvedValueOnce({ ...produtoBase, variants: [] });
    // O salvar demora 2 s: o auto-save de 1 s cairia no meio dele.
    updateProduct.mockImplementationOnce(
      () => new Promise((r) => setTimeout(() => r(undefined), 2000)),
    );
    await montar();
    await digitarCampo("product-sale-price", "60,00");

    // Clica Salvar sem esperar o auto-save de 1 s que a digitação agendou.
    await act(async () => {
      botaoPorTexto("Salvar")?.click();
      await new Promise((r) => setTimeout(r, 1500));
    });

    expect(gravacoes).toEqual([]);
  }, 20000);

  it("uso normal: digitar e esperar 1 s guarda o rascunho", async () => {
    fetchProduct.mockResolvedValueOnce({ ...produtoBase, variants: [] });
    await montar();

    await digitarCampo("product-sale-price", "60,00");
    await act(async () => {
      await new Promise((r) => setTimeout(r, 1200));
    });

    expect(gravacoes.length).toBeGreaterThan(0);
    expect(JSON.parse(armazem.get(CHAVE_DO_RASCUNHO) ?? "{}").price).toMatch(
      /^60[.,]00$/,
    );
  }, 20000);
  it("o rascunho antigo só sai DEPOIS da releitura do banco, não durante a espera", async () => {
    deleteVariants.mockRejectedValueOnce({
      ...ERRO_VENDIDA,
      recusadas: ["v2"],
    });
    fetchProduct.mockResolvedValueOnce({
      ...produtoBase,
      variants: [variacao("v1", "Rosa", 3), variacao("v2", "Azul", 2)],
    });
    fetchProduct.mockImplementationOnce(
      () =>
        new Promise((resolver) =>
          setTimeout(
            () =>
              resolver({
                ...produtoBase,
                variants: [
                  variacao("v1", "Rosa", 3),
                  variacao("v2", "Azul", 2),
                ],
              }),
            1500,
          ),
        ),
    );
    await montar();
    await act(async () => {
      (
        document.querySelector(
          '[aria-label="Excluir variação Azul"]',
        ) as HTMLButtonElement
      ).click();
    });
    await act(async () => {
      botaoPorTexto("Excluir Variante")?.click();
    });
    // Um rascunho que o auto-save guardou antes do Salvar.
    armazem.set(CHAVE_DO_RASCUNHO, JSON.stringify({ name: "Rascunho velho" }));

    let existiaNoMeioDaEspera = false;
    await act(async () => {
      botaoPorTexto("Salvar")?.click();
      await new Promise((r) => setTimeout(r, 800));
      existiaNoMeioDaEspera = armazem.has(CHAVE_DO_RASCUNHO);
      await new Promise((r) => setTimeout(r, 1500));
    });

    expect(existiaNoMeioDaEspera).toBe(true);
    expect(armazem.has(CHAVE_DO_RASCUNHO)).toBe(false);
  }, 20000);
});
