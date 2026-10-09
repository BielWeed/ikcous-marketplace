// @vitest-environment jsdom
//
// PAINEL SIMPLES, onda I, frente 3 — "Avisar quando o estoque chegar a".
//
// O limiar de estoque baixo de cada produto (`produtos.estoque_minimo`) já
// existia no banco e nos avisos do Início, mas a lojista não tinha onde
// escolhê-lo. O campo mora na seção "Avançado" do formulário de produto:
//
//   a. existe, montado e fechado dentro de "Avançado", com a ajuda dizendo que
//      vazio usa o padrão (5) e que, com variações, vale para a soma;
//   b. produto com 8 mostra 8; produto com 0 mostra 0 (zero é escolha, não
//      ausência); produto sem valor mostra vazio;
//   c. o que vai no payload: vazio = `null` (volta ao padrão), "7" = 7,
//      "0" = 0 — nunca `undefined` (que o hook descartaria e o valor antigo
//      sobreviveria) e nunca NaN;
//   d. negativo e decimal não passam: erro no campo, salvar desligado, nada
//      gravado;
//   e. o rascunho (novo e de edição) leva o campo junto.
//
// Montagem real (react-dom/client + jsdom), mesmo molde de
// produto-basico-primeiro.test.tsx (LocalBufferedInput tem debounce de 200 ms).
import { act } from "react";
import type { ReactNode } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const addProduct = vi.fn();
const updateProduct = vi.fn();
const fetchProduct = vi.fn();
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

vi.mock("@/lib/supabase", () => ({
  supabase: { rpc: rpcDoSupabase },
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
      id="product-category"
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
  SelectItem: ({
    value,
    children,
  }: {
    value: string;
    children: ReactNode;
  }) => <option value={value}>{children}</option>,
}));

vi.mock("sonner", () => ({
  toast: {
    info: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
    loading: vi.fn(),
  },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const ID = "product-estoque-minimo";

const produtoDoBanco = {
  id: "prod-1",
  name: "Camiseta",
  description: "Camiseta de algodão",
  price: 50,
  costPrice: null,
  originalPrice: null,
  stock: 20,
  estoqueMinimo: null as number | null,
  category: "Geral",
  images: [] as string[],
  freeShipping: false,
  isBestseller: false,
  isActive: true,
  metaTitle: "",
  metaDescription: "",
  sku: "",
  codigoBarras: "",
  variants: [] as unknown[],
  weightKg: null,
  widthCm: null,
  heightCm: null,
  lengthCm: null,
};

const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

function secao(titulo: string): HTMLElement {
  const el = document.querySelector(`section[aria-label="${titulo}"]`);
  if (!el) throw new Error(`seção "${titulo}" ausente`);
  return el as HTMLElement;
}

function campo(): HTMLInputElement {
  return document.getElementById(ID) as HTMLInputElement;
}

function digitar(id: string, valor: string) {
  const el = document.getElementById(id) as
    | HTMLInputElement
    | HTMLTextAreaElement;
  const proto =
    el instanceof globalThis.HTMLTextAreaElement
      ? globalThis.HTMLTextAreaElement.prototype
      : globalThis.HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value")?.set?.call(el, valor);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

async function digitarCampo(id: string, valor: string) {
  await act(async () => {
    digitar(id, valor);
    await esperar(300);
  });
}

function botao(texto: string): HTMLButtonElement {
  return [...document.querySelectorAll("button")].find((b) =>
    b.textContent?.includes(texto),
  ) as HTMLButtonElement;
}

describe("AdminProductFormView — Avisar quando o estoque chegar a", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let armazem: Map<string, string>;

  beforeEach(() => {
    vi.clearAllMocks();
    addProduct.mockResolvedValue({ id: "novo-1" });
    updateProduct.mockResolvedValue({ id: "prod-1" });
    fetchProduct.mockResolvedValue(produtoDoBanco);
    rpcDoSupabase.mockResolvedValue({
      data: { encontrado: false },
      error: null,
    });
    armazem = new Map();
    vi.stubGlobal("localStorage", {
      getItem: (c: string) => armazem.get(c) ?? null,
      setItem: (c: string, v: string) => {
        armazem.set(c, v);
      },
      removeItem: (c: string) => {
        armazem.delete(c);
      },
    });
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

  async function montar(productId?: string) {
    const { AdminProductFormView } = await import(
      "@/views/admin/AdminProductFormView"
    );
    await act(async () => {
      raiz.render(
        <AdminProductFormView
          productId={productId}
          onNavigate={vi.fn()}
          onSetDirty={vi.fn()}
        />,
      );
    });
    if (productId) {
      await act(async () => {
        await esperar(0);
        await esperar(0);
        await esperar(0);
      });
    }
  }

  async function preencherOBasico() {
    await act(async () => {
      digitar("product-name", "Produto Teste");
      digitar("product-description", "Descrição de teste");
      digitar("product-sale-price", "1000");
      digitar("product-stock", "5");
      const categoria = document.querySelector(
        '[data-testid="select-category"]',
      ) as HTMLSelectElement;
      Object.getOwnPropertyDescriptor(
        globalThis.HTMLSelectElement.prototype,
        "value",
      )?.set?.call(categoria, "Geral");
      categoria.dispatchEvent(new Event("change", { bubbles: true }));
      await esperar(300);
    });
  }

  async function salvarEdicao() {
    await act(async () => {
      botao("Salvar").click();
      await esperar(50);
    });
  }

  async function publicar() {
    await act(async () => {
      botao("Publicar").click();
      await esperar(50);
    });
  }

  describe("a. o campo existe, no Avançado", () => {
    it("fica montado dentro da seção 'Avançado' (fechada), como número inteiro >= 0", async () => {
      await montar();

      expect(campo(), "campo #product-estoque-minimo ausente").not.toBeNull();
      const painelId = secao("Avançado")
        .querySelector("button")
        ?.getAttribute("aria-controls");
      expect(document.getElementById(painelId ?? "")?.contains(campo())).toBe(
        true,
      );
      expect(campo().closest("[hidden]")).not.toBeNull();
      expect(campo().type).toBe("number");
      expect(campo().min).toBe("0");
      expect(campo().step).toBe("1");
    });

    it("tem rótulo ligado ao campo e a ajuda que diz o padrão e a regra das variações", async () => {
      await montar();

      const rotulo = document.querySelector(`label[for="${ID}"]`);
      expect(rotulo?.textContent).toContain("Avisar quando o estoque chegar a");
      expect(secao("Avançado").textContent).toContain(
        "Vazio usa o padrão (5). Com variações, vale para a soma.",
      );
    });

    it("o resumo da seção passa a falar do aviso de estoque", async () => {
      await montar();
      expect(secao("Avançado").textContent).toContain(
        "Código interno, código de barras e aviso de estoque",
      );
    });
  });

  describe("b. o que o campo mostra ao abrir o produto", () => {
    it("produto com 8 mostra 8", async () => {
      fetchProduct.mockResolvedValue({ ...produtoDoBanco, estoqueMinimo: 8 });
      await montar("prod-1");
      expect(campo().value).toBe("8");
    });

    it("produto com 0 mostra 0 — zero é escolha da lojista, não campo vazio", async () => {
      fetchProduct.mockResolvedValue({ ...produtoDoBanco, estoqueMinimo: 0 });
      await montar("prod-1");
      expect(campo().value).toBe("0");
    });

    it("produto sem valor (padrão) mostra o campo vazio", async () => {
      await montar("prod-1");
      expect(campo().value).toBe("");
    });
  });

  describe("c. o que vai no payload", () => {
    it("salvar sem mexer num produto com 8 devolve 8 (não apaga o que já estava lá)", async () => {
      fetchProduct.mockResolvedValue({ ...produtoDoBanco, estoqueMinimo: 8 });
      await montar("prod-1");
      await salvarEdicao();

      expect(updateProduct).toHaveBeenCalledTimes(1);
      expect(updateProduct.mock.calls[0][1].estoqueMinimo).toBe(8);
    });

    it("digitar 7 manda 7", async () => {
      await montar("prod-1");
      await digitarCampo(ID, "7");
      await salvarEdicao();

      expect(updateProduct).toHaveBeenCalledTimes(1);
      expect(updateProduct.mock.calls[0][1].estoqueMinimo).toBe(7);
    });

    it("digitar 0 manda 0, não null", async () => {
      await montar("prod-1");
      await digitarCampo(ID, "0");
      await salvarEdicao();

      expect(updateProduct).toHaveBeenCalledTimes(1);
      const { estoqueMinimo } = updateProduct.mock.calls[0][1];
      expect(estoqueMinimo).toBe(0);
    });

    it("limpar o campo (tinha 8) manda null — volta ao padrão, nunca undefined", async () => {
      fetchProduct.mockResolvedValue({ ...produtoDoBanco, estoqueMinimo: 8 });
      await montar("prod-1");
      await digitarCampo(ID, "");
      await salvarEdicao();

      expect(updateProduct).toHaveBeenCalledTimes(1);
      const [, payload] = updateProduct.mock.calls[0];
      expect(payload).toHaveProperty("estoqueMinimo", null);
    });

    it("produto novo com o campo vazio manda null", async () => {
      await montar();
      await preencherOBasico();
      await publicar();

      expect(addProduct).toHaveBeenCalledTimes(1);
      expect(addProduct.mock.calls[0][0]).toHaveProperty("estoqueMinimo", null);
    });

    it("produto novo com 7 manda 7", async () => {
      await montar();
      await preencherOBasico();
      await digitarCampo(ID, "7");
      await publicar();

      expect(addProduct).toHaveBeenCalledTimes(1);
      expect(addProduct.mock.calls[0][0].estoqueMinimo).toBe(7);
    });
  });

  describe("d. negativo e decimal não passam", () => {
    it.each([
      ["negativo", "-3"],
      ["decimal", "2.5"],
    ])(
      "%s (%s): mostra o erro no campo, desliga o salvar e não grava",
      async (_nome, texto) => {
        await montar("prod-1");
        await digitarCampo(ID, texto);

        expect(secao("Avançado").textContent).toContain(
          "Use um número inteiro, 0 ou mais.",
        );
        expect(botao("Salvar").disabled).toBe(true);

        await act(async () => {
          const form = document.querySelector("form") as HTMLFormElement;
          form.dispatchEvent(
            new Event("submit", { bubbles: true, cancelable: true }),
          );
          await esperar(100);
        });
        expect(updateProduct).not.toHaveBeenCalled();
      },
    );

    it("o erro abre a seção 'Avançado' sozinho", async () => {
      await montar("prod-1");
      await digitarCampo(ID, "-3");

      const cabecalho = secao("Avançado").querySelector(
        "button",
      ) as HTMLButtonElement;
      expect(cabecalho.getAttribute("aria-expanded")).toBe("true");
    });

    it("corrigido o valor, o erro some e o salvar volta", async () => {
      await montar("prod-1");
      await digitarCampo(ID, "-3");
      await digitarCampo(ID, "4");

      expect(secao("Avançado").textContent).not.toContain(
        "Use um número inteiro, 0 ou mais.",
      );
      expect(botao("Salvar").disabled).toBe(false);
    });
  });

  describe("e. o rascunho leva o campo junto", () => {
    it("rascunho de produto novo com estoqueMinimo 9: o campo volta com 9", async () => {
      armazem.set(
        "ikcous_product_form_draft",
        JSON.stringify({
          name: "Produto Teste",
          description: "Descrição de teste",
          price: "10.00",
          stock: "5",
          category: "Geral",
          estoqueMinimo: "9",
        }),
      );
      await montar();
      await act(async () => {
        await esperar(50);
      });

      expect(campo().value).toBe("9");
    });

    it("o auto-salvar grava o campo no rascunho", async () => {
      await montar();
      await digitarCampo(ID, "4");
      await act(async () => {
        await esperar(1100);
      });

      const rascunho = JSON.parse(
        armazem.get("ikcous_product_form_draft") ?? "{}",
      );
      expect(rascunho.estoqueMinimo).toBe("4");
    });

    it("rascunho de edição com estoqueMinimo diferente do banco: aparece o aviso e 'Restaurar' aplica o campo", async () => {
      armazem.set(
        "ikcous_product_form_draft_edit_prod-1",
        JSON.stringify({ ...produtoDoBanco, estoqueMinimo: "12" }),
      );
      await montar("prod-1");
      expect(campo().value).toBe("");

      const { toast } = await import("sonner");
      const aviso = vi
        .mocked(toast.info)
        .mock.calls.find((c) => String(c[0]).includes("Rascunho não salvo"));
      expect(
        aviso,
        "o campo novo conta como diferença no rascunho",
      ).toBeDefined();
      const restaurar = (
        aviso?.[1] as unknown as { action: { onClick: () => void } }
      ).action.onClick;
      await act(async () => {
        restaurar();
        await esperar(300);
      });

      expect(campo().value).toBe("12");
    });

    it("'Descartar' o rascunho novo esvazia o campo", async () => {
      armazem.set(
        "ikcous_product_form_draft",
        JSON.stringify({ name: "Produto Teste", estoqueMinimo: "9" }),
      );
      await montar();
      await act(async () => {
        await esperar(50);
      });
      expect(campo().value).toBe("9");

      const { toast } = await import("sonner");
      const aviso = vi
        .mocked(toast.success)
        .mock.calls.find((c) => String(c[0]).includes("Rascunho recuperado"));
      const descartar = (
        aviso?.[1] as unknown as { action: { onClick: () => void } }
      ).action.onClick;
      await act(async () => {
        descartar();
        await esperar(300);
      });

      expect(campo().value).toBe("");
    });
  });
});
