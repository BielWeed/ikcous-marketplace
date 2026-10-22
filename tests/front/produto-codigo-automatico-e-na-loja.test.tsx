// @vitest-environment jsdom
//
// Formulário de produto — código interno (SKU) AUTOMÁTICO e a seção "Na loja"
// (aparece na loja, em destaque, frete grátis). Tudo usa campos que o modelo
// já tem e que o salvar já grava; o salvar em si não muda.
//
// Montagem real (react-dom/client + jsdom), mesmo molde dos outros testes do
// formulário (LocalBufferedInput tem debounce de 200 ms).
import { ContextoDaBarra } from "@/components/layouts/AcaoDaBarra";
import { act } from "react";
import type { ReactNode } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const addProduct = vi.fn();
const updateProduct = vi.fn();
const fetchProduct = vi.fn();
let produtosDaLoja: unknown[] = [];
const rpcDoSupabase = vi.fn();
const configDaLoja: Record<string, unknown> = { shippingCoverage: "national" };

vi.mock("@/hooks/useProducts", () => ({
  useProducts: () => ({
    addProduct,
    updateProduct,
    upsertVariants: vi.fn().mockResolvedValue(undefined),
    deleteVariants: vi.fn().mockResolvedValue(undefined),
    uploadProductImages: vi.fn().mockResolvedValue([]),
    fetchProduct,
    products: produtosDaLoja,
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
  useStore: () => ({ config: configDaLoja }),
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

const produtoDoBanco = {
  id: "prod-1",
  name: "Camiseta",
  description: "Camiseta de algodão",
  price: 50,
  costPrice: null,
  originalPrice: null,
  stock: 3,
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

function botaoDaSecao(titulo: string): HTMLButtonElement {
  return secao(titulo).querySelector("button") as HTMLButtonElement;
}

function estaAberta(titulo: string): boolean {
  return botaoDaSecao(titulo).getAttribute("aria-expanded") === "true";
}

function campo(id: string): HTMLInputElement {
  return document.getElementById(id) as HTMLInputElement;
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

describe("AdminProductFormView — código automático e Na loja", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let armazem: Map<string, string>;
  let sorteio = 0;

  beforeEach(() => {
    vi.clearAllMocks();
    sorteio = 0;
    produtosDaLoja = [];
    for (const k of Object.keys(configDaLoja)) delete configDaLoja[k];
    configDaLoja.shippingCoverage = "national";
    // Sorteio previsível: cada caractere sai do próximo índice do alfabeto.
    vi.spyOn(globalThis.crypto, "getRandomValues").mockImplementation(((
      a: Uint32Array,
    ) => {
      a[0] = sorteio;
      sorteio += 1;
      return a;
    }) as never);
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
    document.querySelector('[data-testid="navegacao-do-teste"]')?.remove();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  async function montar(productId?: string, prateleira?: HTMLDivElement) {
    const { AdminProductFormView } = await import(
      "@/views/admin/AdminProductFormView"
    );
    await act(async () => {
      raiz.render(
        <ContextoDaBarra.Provider
          value={
            prateleira
              ? {
                  destino: prateleira,
                  receberPrateleira: vi.fn(),
                  larga: false,
                  altura: 120,
                }
              : null
          }
        >
          <AdminProductFormView
            userId="u-teste"
            productId={productId}
            onNavigate={vi.fn()}
            onSetDirty={vi.fn()}
          />
        </ContextoDaBarra.Provider>,
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

  // --- ajudantes deste arquivo -------------------------------------------

  const chave = (rotulo: string) =>
    document.querySelector(
      `button[role="switch"][aria-label="${rotulo}"]`,
    ) as HTMLButtonElement | null;

  async function tocar(el: HTMLElement | null) {
    if (!el) throw new Error("elemento ausente");
    await act(async () => {
      el.click();
      await esperar(10);
    });
  }

  const codigoNaTela = () =>
    document.querySelector('[data-testid="codigo-automatico"]')?.textContent ??
    null;

  async function clicarNaBarra(texto: string) {
    const botao = [...document.querySelectorAll("button")].find(
      (b) => b.textContent?.trim() === texto,
    ) as HTMLButtonElement;
    await act(async () => {
      botao.click();
      await esperar(50);
    });
  }
  const publicar = () => clicarNaBarra("Publicar");
  const salvarEdicao = () => clicarNaBarra("Salvar");

  const ligado = (rotulo: string) =>
    chave(rotulo)?.getAttribute("aria-checked");

  async function abrirAGradeEGerar() {
    await tocar(
      document.querySelector('[data-testid="abrir-grade"]') as HTMLElement,
    );
    await digitarCampo("grade-nome-0", "Cor");
    await digitarCampo("grade-valor-0", "Azul");
    await tocar(
      document.querySelector(
        '[aria-label="Adicionar valor do atributo 1"]',
      ) as HTMLElement,
    );
    const gerar = [...document.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("Gerar grade"),
    ) as HTMLButtonElement;
    await tocar(gerar);
  }

  describe("código interno automático", () => {
    it("nasce desligado: o campo de digitar aparece e nada é gerado", async () => {
      await montar();
      expect(ligado("Gerar código automático")).toBe("false");
      expect(campo("product-sku")).not.toBeNull();
      expect(codigoNaTela()).toBeNull();
      await preencherOBasico();
      await publicar();
      expect(addProduct.mock.calls[0][0].sku).toBeNull();
    });

    it("ligado: esconde o campo, mostra o código pela categoria e grava esse código", async () => {
      await montar();
      await preencherOBasico();
      await tocar(chave("Gerar código automático"));

      expect(ligado("Gerar código automático")).toBe("true");
      expect(document.getElementById("product-sku")).toBeNull();
      expect(codigoNaTela()).toMatch(/^GER-[2-9A-HJ-NP-Z]{4}$/);
      const mostrado = codigoNaTela();

      await publicar();
      expect(addProduct.mock.calls[0][0].sku).toBe(mostrado);
    });

    it("o começo do código acompanha a categoria escolhida depois de ligar; o final fica", async () => {
      await montar();
      await tocar(chave("Gerar código automático"));
      const antes = codigoNaTela() ?? "";
      expect(antes).toMatch(/^PRD-/);

      await preencherOBasico();
      const depois = codigoNaTela() ?? "";
      expect(depois).toMatch(/^GER-/);
      expect(depois.slice(4)).toBe(antes.slice(4));
    });

    it("gerar outro troca só o final e nunca sai do formato aceito", async () => {
      await montar();
      await preencherOBasico();
      await tocar(chave("Gerar código automático"));
      const primeiro = codigoNaTela();
      await tocar(
        document.querySelector(
          'button[aria-label="Gerar outro código"]',
        ) as HTMLButtonElement,
      );
      const segundo = codigoNaTela();
      expect(segundo).not.toBe(primeiro);
      expect(segundo).toMatch(/^GER-[A-Z0-9]{4}$/);
    });

    it("desligar devolve o que a lojista tinha digitado", async () => {
      await montar();
      await digitarCampo("product-sku", "meu cod");
      await tocar(chave("Gerar código automático"));
      expect(document.getElementById("product-sku")).toBeNull();
      await tocar(chave("Gerar código automático"));
      expect(campo("product-sku").value).toBe("MEU-COD");
      expect(codigoNaTela()).toBeNull();
    });

    it("desligar sem nada digitado antes volta ao campo vazio e salva sem código", async () => {
      await montar();
      await preencherOBasico();
      await tocar(chave("Gerar código automático"));
      await tocar(chave("Gerar código automático"));
      expect(campo("product-sku").value).toBe("");
      await publicar();
      expect(addProduct.mock.calls[0][0].sku).toBeNull();
    });

    it("pula um código que já é de uma variação da loja", async () => {
      // O primeiro sorteio dá GER-2345; ele já é o código de uma variação.
      produtosDaLoja = [
        { sku: "", variants: [{ sku: "ger-2345" }, { sku: null }] },
      ];
      await montar();
      await preencherOBasico();
      await tocar(chave("Gerar código automático"));
      expect(codigoNaTela()).toBe("GER-6789");
    });

    it("produto já salvo: o código dele nunca é trocado sozinho", async () => {
      fetchProduct.mockResolvedValue({ ...produtoDoBanco, sku: "ABC-1" });
      await montar("prod-1");
      expect(ligado("Gerar código automático")).toBe("false");
      expect(campo("product-sku").value).toBe("ABC-1");

      // Mexe em outra coisa e salva sem tocar no automático.
      await act(async () => {
        digitar("product-name", "Camiseta Nova");
        await esperar(300);
      });
      await salvarEdicao();
      expect(updateProduct.mock.calls[0][1].sku).toBe("ABC-1");
    });

    it("produto já salvo: ligar troca (ela pediu) e desligar traz o código salvo de volta", async () => {
      fetchProduct.mockResolvedValue({ ...produtoDoBanco, sku: "ABC-1" });
      await montar("prod-1");
      await tocar(chave("Gerar código automático"));
      expect(codigoNaTela()).toMatch(/^GER-/);
      await tocar(chave("Gerar código automático"));
      expect(campo("product-sku").value).toBe("ABC-1");
      await salvarEdicao();
      expect(updateProduct.mock.calls[0][1].sku).toBe("ABC-1");
    });

    it("a grade nasce com o código do produto como base", async () => {
      await montar();
      await preencherOBasico();
      await tocar(chave("Gerar código automático"));
      const codigo = codigoNaTela();
      await abrirAGradeEGerar();
      expect(campo("grade-sku-base").value).toBe(codigo);
    });

    it("com o automático desligado a grade continua nascendo sem base", async () => {
      await montar();
      await abrirAGradeEGerar();
      expect(campo("grade-sku-base").value).toBe("");
    });
  });

  describe("seção Na loja", () => {
    it("fica depois de Avançado, fechada, com o resumo do que está valendo", async () => {
      await montar();
      expect(estaAberta("Na loja")).toBe(false);
      expect(
        secao("Avançado").compareDocumentPosition(secao("Na loja")) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).not.toBe(0);
      expect(secao("Na loja").textContent).toContain("Aparece na loja");
    });

    it("produto novo nasce aparecendo na loja, sem destaque e sem frete grátis", async () => {
      await montar();
      await tocar(botaoDaSecao("Na loja"));
      expect(ligado("Aparece na loja")).toBe("true");
      expect(ligado("Em destaque")).toBe("false");
      expect(ligado("Frete grátis neste produto")).toBe("false");
    });

    it("cada chave grava o campo que já existia no salvar", async () => {
      await montar();
      await preencherOBasico();
      await tocar(botaoDaSecao("Na loja"));
      await tocar(chave("Aparece na loja"));
      await tocar(chave("Em destaque"));
      await tocar(chave("Frete grátis neste produto"));
      await publicar();
      expect(addProduct.mock.calls[0][0]).toMatchObject({
        isActive: false,
        isBestseller: true,
        freeShipping: true,
      });
    });

    it("produto salvo abre com as chaves como estão no banco e salva o que ela mudou", async () => {
      fetchProduct.mockResolvedValue({
        ...produtoDoBanco,
        isActive: false,
        isBestseller: true,
        freeShipping: true,
      });
      await montar("prod-1");
      expect(ligado("Aparece na loja")).toBe("false");
      expect(ligado("Em destaque")).toBe("true");
      expect(ligado("Frete grátis neste produto")).toBe("true");
      await tocar(chave("Aparece na loja"));
      await salvarEdicao();
      expect(updateProduct.mock.calls[0][1]).toMatchObject({
        isActive: true,
        isBestseller: true,
        freeShipping: true,
      });
    });

    it("avisa quando a loja não usa só produtos marcados e a marca não terá efeito", async () => {
      Object.assign(configDaLoja, {
        freeShippingMin: 0,
        nationalShippingStrategy: "desligado",
        nationalShippingMin: 0,
      });
      await montar();
      await tocar(botaoDaSecao("Na loja"));
      await tocar(chave("Frete grátis neste produto"));
      expect(
        document.querySelector('[data-testid="aviso-frete-por-produto"]'),
      ).not.toBeNull();
    });

    it("não avisa quando a loja usa só produtos marcados", async () => {
      Object.assign(configDaLoja, {
        freeShippingMin: 0,
        nationalShippingStrategy: "por_produto",
        nationalShippingMin: 0,
      });
      await montar();
      await tocar(botaoDaSecao("Na loja"));
      await tocar(chave("Frete grátis neste produto"));
      expect(
        document.querySelector('[data-testid="aviso-frete-por-produto"]'),
      ).toBeNull();
    });

    it("sem a configuração de frete carregada, não inventa aviso", async () => {
      await montar();
      await tocar(botaoDaSecao("Na loja"));
      await tocar(chave("Frete grátis neste produto"));
      expect(
        document.querySelector('[data-testid="aviso-frete-por-produto"]'),
      ).toBeNull();
    });
  });
  describe("campo de categoria", () => {
    it("mostra as categorias e as duas portas em letra normal, não em CAIXA-ALTA", async () => {
      await montar();
      const select = document.querySelector(
        '[data-testid="select-category"]',
      ) as HTMLSelectElement;
      const textos = [...select.options].map((o) => o.textContent);
      expect(textos).toContain("Geral");
      expect(textos).toContain("➕ Criar nova categoria");
      expect(textos).toContain("✏️ Renomear, esconder ou apagar");
      expect(textos.join(" ")).not.toMatch(/GERAL|CRIAR NOVA|RENOMEAR/);
    });

    it("continua gravando o nome da categoria escolhida", async () => {
      await montar();
      await preencherOBasico();
      await publicar();
      expect(addProduct.mock.calls[0][0].category).toBe("Geral");
    });
  });
});
