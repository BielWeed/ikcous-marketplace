// @vitest-environment jsdom
//
// Dois buracos que o teste de "tornar foto principal" (cadastro de produto
// NOVO) não cobria:
//
//   1. EDIÇÃO de produto que já existe. Tornar a 3ª foto a principal só muda a
//      ORDEM das fotos (mesmas fotos, outra sequência). O formulário tem de se
//      reconhecer "alterado" (senão o botão Salvar e o aviso de "sair sem
//      salvar" ignoram a mudança), o "Salvar" tem de gravar [C, A, B], e a
//      variação que aponta para a foto B continua apontando para a foto B —
//      o vínculo é pela foto, não pela posição.
//   2. CADASTRO que não criou nada. A lista de produtos só deve ser avisada
//      ("acabou de cadastrar um produto, mostre a página 1") quando o produto
//      foi criado de verdade. Se o cadastro falha (rejeita) ou não devolve o
//      produto criado (sem permissão), a lista continua lembrando a busca, a
//      categoria e a página em que a lojista estava.
//
// Mesmo padrão de admin-product-form-tornar-foto-principal.test.tsx.
import { act } from "react";
import type { ReactNode } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  addProduct: vi.fn(),
  updateProduct: vi.fn(),
  upsertVariants: vi.fn(),
  fetchProduct: vi.fn(),
  rpc: vi.fn(),
  toastSuccess: vi.fn(),
}));

vi.mock("@/hooks/useProducts", () => ({
  useProducts: () => ({
    addProduct: mocks.addProduct,
    updateProduct: mocks.updateProduct,
    upsertVariants: mocks.upsertVariants,
    deleteVariants: vi.fn().mockResolvedValue(undefined),
    uploadProductImages: vi.fn().mockResolvedValue([]),
    fetchProduct: mocks.fetchProduct,
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
    success: mocks.toastSuccess,
    error: vi.fn(),
    warning: vi.fn(),
    loading: vi.fn(),
  },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const FOTO_A = "https://cdn/a.jpg";
const FOTO_B = "https://cdn/b.jpg";
const FOTO_C = "https://cdn/c.jpg";

function digitar(id: string, valor: string) {
  const el = document.getElementById(id) as HTMLInputElement;
  Object.getOwnPropertyDescriptor(
    globalThis.HTMLInputElement.prototype,
    "value",
  )?.set?.call(el, valor);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

function digitarTextarea(id: string, valor: string) {
  const el = document.getElementById(id) as HTMLTextAreaElement;
  Object.getOwnPropertyDescriptor(
    globalThis.HTMLTextAreaElement.prototype,
    "value",
  )?.set?.call(el, valor);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

function selecionarCategoria(valor: string) {
  const el = document.querySelector(
    '[data-testid="select-category"]',
  ) as HTMLSelectElement;
  Object.getOwnPropertyDescriptor(
    globalThis.HTMLSelectElement.prototype,
    "value",
  )?.set?.call(el, valor);
  el.dispatchEvent(new Event("change", { bubbles: true }));
}

const botaoPorTexto = (texto: string) =>
  [...document.body.querySelectorAll("button")].find((b) =>
    b.textContent?.includes(texto),
  ) as HTMLButtonElement | undefined;

/** Os botões "Tornar principal", na ordem em que aparecem na tela. */
const botoesTornarPrincipal = () => [
  ...document.body.querySelectorAll<HTMLButtonElement>(
    'button[aria-label^="Tornar principal"]',
  ),
];

/** As fotos do produto na tela, na ordem do carrossel. */
const fotosNaTela = () =>
  [...document.body.querySelectorAll("img")]
    .map((i) => i.getAttribute("src"))
    .filter((src): src is string => !!src && src.startsWith("https://cdn/"));

/**
 * Espera uma CONDIÇÃO (não um tempo fixo). A cada tentativa deixa o React
 * processar o que estiver pendente (`act`) — sem isso, o que o formulário
 * atualiza por timer (os campos digitados têm debounce) nunca chegaria à tela.
 */
async function esperarAte(condicao: () => void) {
  const limite = Date.now() + 5000;
  for (;;) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
    try {
      condicao();
      return;
    } catch (erro) {
      // Não chegou lá ainda: tenta de novo até o limite.
      if (Date.now() > limite) throw erro;
    }
  }
}

describe("AdminProductFormView — foto principal na edição e cadastro que não criou nada", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    mocks.rpc.mockResolvedValue({
      data: { encontrado: false },
      error: null,
    });
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

  describe("edição: tornar a 3ª foto a principal", () => {
    async function abrirProdutoComTresFotos() {
      mocks.updateProduct.mockResolvedValue({ id: "p-1" });
      mocks.upsertVariants.mockResolvedValue(true);
      mocks.fetchProduct.mockResolvedValue({
        id: "p-1",
        name: "Camiseta",
        description: "Algodão",
        price: 50,
        stock: 5,
        sold: 0,
        category: "Geral",
        images: [FOTO_A, FOTO_B, FOTO_C],
        freeShipping: false,
        isBestseller: false,
        isActive: true,
        variants: [
          {
            id: "v-1",
            productId: "p-1",
            name: "Cor",
            value: "Rosa",
            stockIncrement: 5,
            stock: 5,
            active: true,
            imageUrl: FOTO_B,
          },
        ],
      });
      const onSetDirty = vi.fn();
      const { AdminProductFormView } = await import(
        "@/views/admin/AdminProductFormView"
      );
      await act(async () => {
        raiz.render(
          <AdminProductFormView
            productId="p-1"
            onNavigate={vi.fn()}
            onSetDirty={onSetDirty}
          />,
        );
      });
      await esperarAte(() => {
        expect(fotosNaTela().slice(0, 3)).toEqual([FOTO_A, FOTO_B, FOTO_C]);
      });
      return { onSetDirty };
    }

    it("o formulário passa a contar como alterado e o aviso de sair sem salvar liga", async () => {
      const { onSetDirty } = await abrirProdutoComTresFotos();
      // Abrir o produto não é alteração: nada de "alterado" ainda.
      expect(onSetDirty).not.toHaveBeenCalledWith(true);

      await act(async () => {
        botoesTornarPrincipal()[1].click();
      });
      await esperarAte(() => {
        expect(onSetDirty).toHaveBeenCalledWith(true);
      });

      expect(fotosNaTela().slice(0, 3)).toEqual([FOTO_C, FOTO_A, FOTO_B]);
      expect(mocks.toastSuccess).toHaveBeenCalledWith(
        "Essa foto agora é a principal.",
      );
    });

    it("Salvar grava as fotos na nova ordem e a variação continua apontando para a mesma foto", async () => {
      await abrirProdutoComTresFotos();

      await act(async () => {
        botoesTornarPrincipal()[1].click();
      });
      expect(fotosNaTela().slice(0, 3)).toEqual([FOTO_C, FOTO_A, FOTO_B]);

      await act(async () => {
        botaoPorTexto("Salvar")?.click();
      });
      await esperarAte(() => {
        expect(mocks.upsertVariants).toHaveBeenCalledTimes(1);
      });

      expect(mocks.updateProduct).toHaveBeenCalledTimes(1);
      expect(mocks.updateProduct.mock.calls[0][1].images).toEqual([
        FOTO_C,
        FOTO_A,
        FOTO_B,
      ]);
      // A variação "Rosa" era da foto B e segue sendo da foto B — mesmo que a
      // foto B tenha passado da posição 2 para a 3.
      const variacoesGravadas: { imageUrl?: string }[] =
        mocks.upsertVariants.mock.calls[0][1];
      expect(variacoesGravadas.map((v) => v.imageUrl)).toEqual([FOTO_B]);
    });
  });

  describe("cadastro que não criou o produto", () => {
    async function preencherEPublicar() {
      const { AdminProductFormView } = await import(
        "@/views/admin/AdminProductFormView"
      );
      await act(async () => {
        raiz.render(
          <AdminProductFormView
            userId="u-teste"
            onNavigate={vi.fn()}
            onSetDirty={vi.fn()}
          />,
        );
      });
      await act(async () => {
        digitar("product-name", "Camiseta");
        digitarTextarea("product-description", "Algodão");
        digitar("product-sale-price", "5000");
        digitar("product-stock", "3");
        selecionarCategoria("Geral");
      });
      // Os campos têm debounce: o botão só liga quando o formulário os leu.
      await esperarAte(() => {
        const publicar = botaoPorTexto("Publicar");
        expect(publicar).toBeDefined();
        expect(publicar?.disabled).toBe(false);
      });
      await act(async () => {
        botaoPorTexto("Publicar")?.click();
      });
      await esperarAte(() => {
        expect(mocks.addProduct).toHaveBeenCalledTimes(1);
      });
    }

    it("quando o cadastro dá erro, a lista não é avisada de produto novo", async () => {
      const erroNoConsole = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});
      mocks.addProduct.mockRejectedValue(new Error("rede caiu"));
      const { consumirProdutoNovoCadastrado } = await import(
        "@/utils/produto-recem-cadastrado"
      );
      // Zera qualquer aviso que sobrou de outro teste neste mesmo arquivo.
      consumirProdutoNovoCadastrado();

      await preencherEPublicar();
      // Espera o formulário terminar de tratar o erro antes de olhar o aviso.
      await esperarAte(() => {
        expect(erroNoConsole).toHaveBeenCalledWith(
          "Erro ao salvar produto:",
          expect.any(Error),
        );
      });

      expect(consumirProdutoNovoCadastrado()).toBe(false);
    });

    it("quando o cadastro não devolve o produto criado, a lista não é avisada", async () => {
      mocks.addProduct.mockResolvedValue(undefined);
      const { consumirProdutoNovoCadastrado } = await import(
        "@/utils/produto-recem-cadastrado"
      );
      consumirProdutoNovoCadastrado();

      await preencherEPublicar();
      // Sem produto criado o formulário segue o caminho normal e mostra "Salvo".
      await esperarAte(() => {
        expect(botaoPorTexto("Salvo")).toBeDefined();
      });

      expect(consumirProdutoNovoCadastrado()).toBe(false);
    });

    it("quando o produto é criado de verdade, a lista é avisada uma vez só", async () => {
      mocks.addProduct.mockResolvedValue({ id: "novo-1" });
      const { consumirProdutoNovoCadastrado } = await import(
        "@/utils/produto-recem-cadastrado"
      );
      consumirProdutoNovoCadastrado();

      await preencherEPublicar();
      await esperarAte(() => {
        expect(botaoPorTexto("Salvo")).toBeDefined();
      });

      expect(consumirProdutoNovoCadastrado()).toBe(true);
      expect(consumirProdutoNovoCadastrado()).toBe(false);
    });
  });
});
