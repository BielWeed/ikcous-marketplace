// @vitest-environment jsdom
//
// Seis defeitos de DADOS na tela criar/editar produto, provados no fluxo real
// da tela (createRoot + act, hooks de dados mockados; mesmo molde de
// admin-product-form-rascunho-nao-devolve-estoque e de
// admin-product-form-fotos-e-grade-nao-travam-o-publicar):
//
//  1. Produto novo cuja grade não gravou: tocar Salvar SEM restaurar o rascunho
//     dava "Salvo" vazio e apagava o rascunho que guardava a grade.
//  2. Restaurar um rascunho de EDIÇÃO regravava preço e "ativo" velhos por cima
//     do que mudou depois no banco.
//  3. Grade que soma mais de 10.000: o aviso aparece ANTES do Salvar (e só para
//     o estoque que a lojista mexeu; o já gravado não trava a edição).
//  4. Tocar no campo de preço e sair, sem mudar nada, marcava "alterações não
//     salvas" ("100" virava "100.00").
//  5. Voltar o formulário ao que está no banco apaga o rascunho (o "Restaurar"
//     não oferece o valor de que ela desistiu).
//  6. Apagar uma variação e recriá-la com o MESMO código de barras no mesmo
//     Salvar não pode ser barrado pela própria variação apagada.
import { act } from "react";
import type { ReactNode } from "react";
import { type Root, createRoot } from "react-dom/client";
import { toast } from "sonner";
import {
  type Mock,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { escolherCategoriaDoProduto } from "./helpers/escolher-categoria-do-produto";

const mocks = vi.hoisted(() => ({
  addProduct: vi.fn(),
  updateProduct: vi.fn(),
  salvarProdutoComGrade: vi.fn(),
  upsertVariants: vi.fn(),
  deleteVariants: vi.fn(),
  fetchProduct: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock("@/hooks/useProducts", () => ({
  useProducts: () => ({
    addProduct: mocks.addProduct,
    updateProduct: mocks.updateProduct,
    salvarProdutoComGrade: mocks.salvarProdutoComGrade,
    upsertVariants: mocks.upsertVariants,
    deleteVariants: mocks.deleteVariants,
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
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    loading: vi.fn(),
    dismiss: vi.fn(),
  },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const USUARIO = "lojista-1";
const CHAVE_EDICAO = `ikcous_product_form_draft_edit_p-1:${USUARIO}`;
const CHAVE_NOVO = `ikcous_product_form_draft:${USUARIO}`;

const botaoPorTexto = (texto: string) =>
  [...document.querySelectorAll("button")].find(
    (b) => b.textContent?.trim() === texto,
  ) as HTMLButtonElement | undefined;

const campo = (id: string) =>
  document.getElementById(id) as HTMLInputElement | null;

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
  escolherCategoriaDoProduto(valor);
}

const esperar = (ms: number) =>
  act(async () => {
    await new Promise((r) => setTimeout(r, ms));
  });

const variacao = (
  id: string,
  valor: string,
  estoque: number,
  extra: Record<string, unknown> = {},
) => ({
  id,
  productId: "p-1",
  name: "Cor",
  value: valor,
  stockIncrement: estoque,
  active: true,
  ...extra,
});

/** O produto como o banco o devolve. */
const produtoDoBanco = (extra: Record<string, unknown> = {}) => ({
  id: "p-1",
  name: "Camiseta",
  description: "Algodão",
  price: 100,
  stock: 3,
  sold: 0,
  category: "Geral",
  images: [],
  freeShipping: false,
  isBestseller: false,
  isActive: true,
  variants: [],
  ...extra,
});

/** O rascunho como o formulário o guarda (campos em texto). */
const rascunho = (extra: Record<string, unknown> = {}) => ({
  name: "Camiseta",
  description: "Algodão",
  price: "100",
  costPrice: "",
  originalPrice: "",
  stock: "3",
  estoqueMinimo: "",
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
  weightKg: "",
  widthCm: "",
  heightCm: "",
  lengthCm: "",
  ...extra,
});

describe("AdminProductFormView — dados do produto", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let armazem: Map<string, string>;
  let onNavigate: Mock<
    (view: string, id?: string, bypassDirtyCheck?: boolean) => void
  >;
  let onSetDirty: Mock<(dirty: boolean) => void>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
    armazem = new Map();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => armazem.get(k) ?? null,
      setItem: (k: string, v: string) => {
        armazem.set(k, v);
      },
      removeItem: (k: string) => {
        armazem.delete(k);
      },
    });
    mocks.rpc.mockResolvedValue({ data: { encontrado: false }, error: null });
    mocks.updateProduct.mockResolvedValue(undefined);
    mocks.upsertVariants.mockResolvedValue(undefined);
    mocks.deleteVariants.mockResolvedValue(true);
    mocks.salvarProdutoComGrade.mockResolvedValue({
      produto: undefined,
      recusadas: [],
    });
    onNavigate = vi.fn();
    onSetDirty = vi.fn();
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

  /** `undefined` abre o formulário de produto NOVO. */
  async function montar(productId?: string) {
    const { AdminProductFormView } = await import(
      "@/views/admin/AdminProductFormView"
    );
    await act(async () => {
      raiz.render(
        <AdminProductFormView
          productId={productId}
          userId={USUARIO}
          onNavigate={onNavigate}
          onSetDirty={onSetDirty}
        />,
      );
    });
    await esperar(60);
  }

  async function desmontar() {
    await act(async () => {
      raiz.render(<div />);
    });
  }

  const perguntaDoRascunho = () =>
    vi
      .mocked(toast.info)
      .mock.calls.filter(([t]) => String(t).includes("Rascunho não salvo"))
      .at(-1);

  /** A ação "Restaurar" do aviso de rascunho pendente. */
  async function restaurar() {
    const chamada = perguntaDoRascunho();
    if (!chamada) throw new Error("O aviso de rascunho não apareceu.");
    const opcoes = chamada[1] as unknown as {
      action: { onClick: () => void };
    };
    await act(async () => {
      opcoes.action.onClick();
    });
  }

  async function salvar() {
    const botao = botaoPorTexto("Salvar alterações");
    if (!botao) throw new Error("O botão Salvar não está na tela.");
    await act(async () => {
      botao.click();
      await new Promise((r) => setTimeout(r, 60));
    });
  }

  async function mudarNome(nome: string) {
    await act(async () => {
      digitar("product-name", nome);
      await new Promise((r) => setTimeout(r, 300));
    });
  }

  // ---------------------------------------------------------------------
  describe("1. produto novo cuja grade não gravou", () => {
    async function publicarProdutoNovoComGradeQueFalha() {
      mocks.addProduct.mockResolvedValueOnce({
        id: "p-1",
        variantesNaoSalvas: { motivo: "Este SKU já está em outra variação." },
      });
      await montar();
      await act(async () => {
        digitar("product-name", "Camiseta");
        digitarTextarea("product-description", "Algodão");
        digitar("product-sale-price", "10000");
        digitar("product-stock", "3");
        selecionarCategoria("Geral");
        await new Promise((r) => setTimeout(r, 300));
      });
      await act(async () => {
        botaoPorTexto("Publicar")?.click();
        await new Promise((r) => setTimeout(r, 0));
      });
      // O que a lojista tinha na tela incluía uma grade; o banco só tem o produto.
      const guardado = JSON.parse(armazem.get(CHAVE_EDICAO) as string);
      guardado.variants = [
        variacao("temp-1", "P", 10, { productId: "" }),
        variacao("temp-2", "M", 10, { productId: "" }),
      ];
      armazem.set(CHAVE_EDICAO, JSON.stringify(guardado));
      await desmontar();
      mocks.fetchProduct.mockResolvedValue(produtoDoBanco());
      await montar("p-1");
    }

    it("Salvar SEM restaurar não dá 'Salvo', não sai da tela e NÃO apaga o rascunho com a grade", async () => {
      await publicarProdutoNovoComGradeQueFalha();
      expect(perguntaDoRascunho()).toBeDefined();
      onNavigate.mockClear();

      await salvar();
      await esperar(1700);

      expect(botaoPorTexto("Salvo")).toBeUndefined();
      expect(onNavigate).not.toHaveBeenCalledWith(
        "admin-products",
        undefined,
        true,
      );
      // O rascunho segue guardado, com as duas variações.
      expect(
        JSON.parse(armazem.get(CHAVE_EDICAO) as string).variants,
      ).toHaveLength(2);
      // E ela lê por quê.
      const erros = vi.mocked(toast.error).mock.calls.map((c) => String(c[0]));
      expect(
        erros.some((t) => /variações ainda não foram salvas/i.test(t)),
      ).toBe(true);
    });

    it("o aviso 'Restaurar' não some sozinho enquanto a grade está pendente", async () => {
      await publicarProdutoNovoComGradeQueFalha();

      const opcoes = perguntaDoRascunho()?.[1] as unknown as {
        duration?: number;
      };
      expect(opcoes.duration).toBe(Number.POSITIVE_INFINITY);
    });

    it("Restaurar e Salvar: a grade vai ao banco", async () => {
      await publicarProdutoNovoComGradeQueFalha();

      await restaurar();
      await salvar();

      const variantes = mocks.salvarProdutoComGrade.mock.calls[0]?.[2]
        .variantes as Array<{ id: string }>;
      expect(variantes.map((v) => v.id)).toEqual(["temp-1", "temp-2"]);
    });

    it("editar o nome antes de restaurar não troca o rascunho da grade pelo do nome", async () => {
      await publicarProdutoNovoComGradeQueFalha();

      await mudarNome("Camiseta nova");
      await esperar(1300);

      expect(
        JSON.parse(armazem.get(CHAVE_EDICAO) as string).variants,
      ).toHaveLength(2);
    });

    it("depois de Restaurar e mexer, o salvamento automático mantém a marca: ao reabrir a grade segue pendente e Salvar segue barrado", async () => {
      await publicarProdutoNovoComGradeQueFalha();

      await restaurar();
      await mudarNome("Camiseta nova");
      await esperar(1300);

      // O rascunho regravado ainda carrega a grade E a marca de pendente: a
      // grade só existe nele, o banco não a tem.
      const regravado = JSON.parse(armazem.get(CHAVE_EDICAO) as string);
      expect(regravado.variants).toHaveLength(2);
      expect(regravado.variacoesPendentes).toBe(true);

      // Sai sem salvar e volta.
      await desmontar();
      vi.mocked(toast.info).mockClear();
      vi.mocked(toast.error).mockClear();
      onNavigate.mockClear();
      await montar("p-1");

      const opcoes = perguntaDoRascunho()?.[1] as unknown as {
        duration?: number;
      };
      expect(opcoes.duration).toBe(Number.POSITIVE_INFINITY);

      await salvar();
      await esperar(1700);

      expect(botaoPorTexto("Salvo")).toBeUndefined();
      expect(onNavigate).not.toHaveBeenCalledWith(
        "admin-products",
        undefined,
        true,
      );
      expect(
        JSON.parse(armazem.get(CHAVE_EDICAO) as string).variants,
      ).toHaveLength(2);
      const erros = vi.mocked(toast.error).mock.calls.map((c) => String(c[0]));
      expect(
        erros.some((t) => /variações ainda não foram salvas/i.test(t)),
      ).toBe(true);
    });

    it("controle: Restaurar e Salvar com sucesso não deixa o salvamento automático ressuscitar o rascunho", async () => {
      await publicarProdutoNovoComGradeQueFalha();

      await restaurar();
      await salvar();
      await esperar(1300);

      expect(mocks.salvarProdutoComGrade).toHaveBeenCalledTimes(1);
      expect(armazem.has(CHAVE_EDICAO)).toBe(false);
    });

    it("controle: Descartar a grade pendente — o que ela mexer depois não carrega a marca", async () => {
      await publicarProdutoNovoComGradeQueFalha();

      const chamada = perguntaDoRascunho();
      const opcoes = chamada?.[1] as unknown as {
        cancel: { onClick: () => void };
      };
      await act(async () => {
        opcoes.cancel.onClick();
      });
      await mudarNome("Camiseta nova");
      await esperar(1300);

      const regravado = JSON.parse(armazem.get(CHAVE_EDICAO) as string);
      expect(regravado.variacoesPendentes).toBeUndefined();
    });

    it("controle: edição comum com rascunho (sem grade pendente) segue o aviso de 10 s", async () => {
      mocks.fetchProduct.mockResolvedValue(produtoDoBanco());
      armazem.set(CHAVE_EDICAO, JSON.stringify(rascunho({ name: "Outro" })));
      await montar("p-1");

      const opcoes = perguntaDoRascunho()?.[1] as unknown as {
        duration?: number;
      };
      expect(opcoes.duration).toBe(10000);
    });
  });

  // ---------------------------------------------------------------------
  describe("2. restaurar rascunho depois que o banco mudou", () => {
    it("o que ela não editou fica como está no banco hoje (ativo e preço); o que editou volta", async () => {
      // Dia 1: abre com preço 100 e ativo; só muda o nome. O rascunho nasce.
      mocks.fetchProduct.mockResolvedValue(produtoDoBanco());
      await montar("p-1");
      await mudarNome("Camiseta nova");
      await esperar(1300);
      expect(armazem.has(CHAVE_EDICAO)).toBe(true);
      await desmontar();

      // Dia 2, pelo computador: desativou e baixou o preço; outra descrição.
      mocks.fetchProduct.mockResolvedValue(
        produtoDoBanco({
          isActive: false,
          price: 90,
          description: "Outra descrição",
        }),
      );
      await montar("p-1");
      await restaurar();
      expect(campo("product-name")?.value).toBe("Camiseta nova");

      await salvar();

      const enviado = mocks.updateProduct.mock.calls[0]?.[1] as Record<
        string,
        unknown
      >;
      expect(enviado.name).toBe("Camiseta nova");
      expect(enviado).not.toHaveProperty("isActive");
      expect(enviado).not.toHaveProperty("price");
      expect(enviado).not.toHaveProperty("description");
      // E ela é avisada de que o produto mudou no meio do caminho.
      const descricaoDoAviso = String(
        (perguntaDoRascunho()?.[1] as { description?: string }).description,
      );
      expect(descricaoDoAviso).toMatch(/alterado depois/i);
    });

    it("controle: banco que NÃO mudou desde o rascunho — tudo o que ela editou volta (preço incluso)", async () => {
      mocks.fetchProduct.mockResolvedValue(produtoDoBanco());
      await montar("p-1");
      await mudarNome("Camiseta nova");
      await act(async () => {
        digitar("product-sale-price", "8000");
        await new Promise((r) => setTimeout(r, 300));
      });
      await esperar(1300);
      await desmontar();

      await montar("p-1");
      await restaurar();
      await salvar();

      const enviado = mocks.updateProduct.mock.calls[0]?.[1] as Record<
        string,
        unknown
      >;
      expect(enviado.name).toBe("Camiseta nova");
      expect(enviado.price).toBe(80);
      const descricaoDoAviso = String(
        (perguntaDoRascunho()?.[1] as { description?: string }).description,
      );
      expect(descricaoDoAviso).not.toMatch(/alterado depois/i);
    });

    it("campo que ela editou e o banco também mudou: vale o que ela editou (é a escolha dela)", async () => {
      mocks.fetchProduct.mockResolvedValue(produtoDoBanco());
      await montar("p-1");
      await act(async () => {
        digitar("product-sale-price", "8000");
        await new Promise((r) => setTimeout(r, 300));
      });
      await esperar(1300);
      await desmontar();

      mocks.fetchProduct.mockResolvedValue(produtoDoBanco({ price: 90 }));
      await montar("p-1");
      await restaurar();
      await salvar();

      expect(mocks.updateProduct.mock.calls[0]?.[1].price).toBe(80);
    });
  });

  // ---------------------------------------------------------------------
  describe("3. grade que soma mais de 10.000", () => {
    const tresDe4000 = () => [
      variacao("v1", "P", 4000),
      variacao("v2", "M", 4000),
      variacao("v3", "G", 4000),
    ];

    it("produto NOVO com 3 variações de 4.000: o aviso aparece antes do Salvar e o botão fica desligado", async () => {
      armazem.set(
        CHAVE_NOVO,
        JSON.stringify(
          rascunho({
            name: "Camiseta",
            stock: "12000",
            variants: tresDe4000().map((v, i) => ({ ...v, id: `temp-${i}` })),
          }),
        ),
      );
      await montar();

      expect(document.body.textContent).toContain("10.000");
      expect((botaoPorTexto("Publicar") as HTMLButtonElement).disabled).toBe(
        true,
      );
    });

    it("controle: produto que JÁ está com 12.000 gravados — editar só o nome não ganha aviso e o Salvar segue ligado", async () => {
      mocks.fetchProduct.mockResolvedValue(
        produtoDoBanco({ stock: 12000, variants: tresDe4000() }),
      );
      await montar("p-1");
      await mudarNome("Camiseta nova");

      expect(document.body.textContent).not.toContain("10.000");
      expect(
        (botaoPorTexto("Salvar alterações") as HTMLButtonElement).disabled,
      ).toBe(false);
      await salvar();
      const atualizacao = mocks.salvarProdutoComGrade.mock.calls[0]?.[1];
      expect(atualizacao.name).toBe("Camiseta nova");
      expect(atualizacao).not.toHaveProperty("stock");
    });
  });

  // ---------------------------------------------------------------------
  describe("4. tocar no preço e sair sem mudar nada", () => {
    it("não marca 'alterações não salvas' (100 não vira 100.00)", async () => {
      mocks.fetchProduct.mockResolvedValue(produtoDoBanco());
      await montar("p-1");
      onSetDirty.mockClear();

      const preco = campo("product-sale-price") as HTMLInputElement;
      await act(async () => {
        preco.focus();
      });
      await act(async () => {
        preco.blur();
        await new Promise((r) => setTimeout(r, 300));
      });

      expect(onSetDirty).not.toHaveBeenCalledWith(true);
    });

    it("controle: mudar o preço de verdade marca como não salvo", async () => {
      mocks.fetchProduct.mockResolvedValue(produtoDoBanco());
      await montar("p-1");
      onSetDirty.mockClear();

      await act(async () => {
        digitar("product-sale-price", "9000");
        await new Promise((r) => setTimeout(r, 300));
      });

      expect(onSetDirty).toHaveBeenCalledWith(true);
    });
  });

  // ---------------------------------------------------------------------
  describe("5. voltar ao que está no banco apaga o rascunho", () => {
    it("muda o preço, o rascunho grava; volta ao preço de antes, o rascunho some", async () => {
      mocks.fetchProduct.mockResolvedValue(produtoDoBanco());
      await montar("p-1");

      await act(async () => {
        digitar("product-sale-price", "8000");
        await new Promise((r) => setTimeout(r, 300));
      });
      await esperar(1300);
      expect(armazem.has(CHAVE_EDICAO)).toBe(true);

      await act(async () => {
        digitar("product-sale-price", "10000");
        await new Promise((r) => setTimeout(r, 300));
      });
      await esperar(1300);

      expect(armazem.has(CHAVE_EDICAO)).toBe(false);
    });

    it("controle: abrir com um rascunho pendente e não mexer em nada NÃO apaga o rascunho (#98)", async () => {
      mocks.fetchProduct.mockResolvedValue(produtoDoBanco());
      armazem.set(CHAVE_EDICAO, JSON.stringify(rascunho({ name: "Outro" })));
      await montar("p-1");
      await esperar(1500);

      expect(armazem.has(CHAVE_EDICAO)).toBe(true);
    });
  });

  // ---------------------------------------------------------------------
  describe("6. apagar uma variação e recriar com o mesmo código de barras", () => {
    const CODIGO = "7891234567895";

    it("a variação que ela acabou de apagar não barra o salvar", async () => {
      // Sem conexão do navegador o salvar usa o caminho de duas etapas.
      vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
      mocks.fetchProduct.mockResolvedValue(
        produtoDoBanco({
          stock: 3,
          variants: [variacao("v-x", "Azul", 3, { codigoBarras: CODIGO })],
        }),
      );
      armazem.set(
        CHAVE_EDICAO,
        JSON.stringify(
          rascunho({
            variants: [
              variacao("v-x", "Azul", 3, { codigoBarras: CODIGO }),
              variacao("temp-9", "Verde", 2, { codigoBarras: CODIGO }),
            ],
          }),
        ),
      );
      // O banco ainda tem a variação apagada: é ela que a consulta devolve.
      mocks.rpc.mockResolvedValue({
        data: {
          encontrado: true,
          origem: "variante",
          produto: { id: "p-1", nome: "Camiseta" },
          variante: { variant_id: "v-x", nome: "Cor", valor: "Azul" },
        },
        error: null,
      });
      await montar("p-1");
      await restaurar();

      const lixeira = document.querySelector(
        '[aria-label="Excluir variação Azul"]',
      ) as HTMLButtonElement;
      await act(async () => {
        lixeira.click();
      });
      await act(async () => {
        botaoPorTexto("Excluir Variante")?.click();
      });

      await salvar();

      const erros = vi.mocked(toast.error).mock.calls.map((c) => String(c[0]));
      expect(erros.some((t) => t.includes("Este código já está em"))).toBe(
        false,
      );
      expect(mocks.deleteVariants).toHaveBeenCalledWith(["v-x"]);
      expect(mocks.upsertVariants).toHaveBeenCalledTimes(1);
    });

    it("o código do PRODUTO igual ao de uma variação apagada NESTE salvar segue barrado (o banco ainda vê a variação quando grava o produto)", async () => {
      vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
      mocks.fetchProduct.mockResolvedValue(
        produtoDoBanco({
          stock: 3,
          variants: [variacao("v-x", "Azul", 3, { codigoBarras: CODIGO })],
        }),
      );
      armazem.set(
        CHAVE_EDICAO,
        JSON.stringify(
          rascunho({
            codigoBarras: CODIGO,
            variants: [variacao("v-x", "Azul", 3, { codigoBarras: CODIGO })],
          }),
        ),
      );
      mocks.rpc.mockResolvedValue({
        data: {
          encontrado: true,
          origem: "variante",
          produto: { id: "p-1", nome: "Camiseta" },
          variante: { variant_id: "v-x", nome: "Cor", valor: "Azul" },
        },
        error: null,
      });
      await montar("p-1");
      await restaurar();

      const lixeira = document.querySelector(
        '[aria-label="Excluir variação Azul"]',
      ) as HTMLButtonElement;
      await act(async () => {
        lixeira.click();
      });
      await act(async () => {
        botaoPorTexto("Excluir Variante")?.click();
      });

      await salvar();

      const erros = vi.mocked(toast.error).mock.calls.map((c) => String(c[0]));
      expect(erros.some((t) => t.includes("Este código já está em"))).toBe(
        true,
      );
      // Nada foi gravado: nem o produto, nem a exclusão da variação.
      expect(mocks.updateProduct).not.toHaveBeenCalled();
      expect(mocks.deleteVariants).not.toHaveBeenCalled();
    });

    it("controle: o mesmo código em OUTRA variação que continua existindo segue barrado", async () => {
      vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
      mocks.fetchProduct.mockResolvedValue(
        produtoDoBanco({
          stock: 5,
          variants: [
            variacao("v-x", "Azul", 3, { codigoBarras: CODIGO }),
            variacao("v-y", "Rosa", 2),
          ],
        }),
      );
      armazem.set(
        CHAVE_EDICAO,
        JSON.stringify(
          rascunho({
            variants: [
              variacao("v-x", "Azul", 3),
              variacao("v-y", "Rosa", 2),
              variacao("temp-9", "Verde", 2, { codigoBarras: CODIGO }),
            ],
          }),
        ),
      );
      mocks.rpc.mockResolvedValue({
        data: {
          encontrado: true,
          origem: "variante",
          produto: { id: "p-1", nome: "Camiseta" },
          variante: { variant_id: "v-x", nome: "Cor", valor: "Azul" },
        },
        error: null,
      });
      await montar("p-1");
      await restaurar();

      await salvar();

      const erros = vi.mocked(toast.error).mock.calls.map((c) => String(c[0]));
      expect(erros.some((t) => t.includes("Este código já está em"))).toBe(
        true,
      );
      expect(mocks.upsertVariants).not.toHaveBeenCalled();
    });
  });
});
