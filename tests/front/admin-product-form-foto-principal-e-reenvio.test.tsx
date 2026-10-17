// @vitest-environment jsdom
//
// Cadastro de produto da lojista: duas coisas que travavam quem tem mais de
// uma foto (na loja real, 54 de 77 produtos têm 2+ fotos).
//
//  1. A foto principal (a do cartão da vitrine, `images[0]`) era sempre a
//     primeira que subiu. Para trocar, só apagando fotos e enviando de novo --
//     e esse caminho falhava: o seletor de arquivo não era zerado depois do
//     envio, então escolher o MESMO arquivo outra vez não disparava nada no
//     Chrome. Agora o seletor é zerado e cada foto que não é a primeira tem
//     "Tornar principal".
//  2. (O texto do bloco do cartão tem o teste dele, em
//     formas-de-pagamento-cartao-pelo-app.test.tsx.)
//
// Mesmo padrão dos testes irmãos: createRoot + act, hooks de dados mockados.
import { act } from "react";
import type { ReactNode } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  addProduct: vi.fn(),
  updateProduct: vi.fn(),
  upsertVariants: vi.fn(),
  uploadProductImages: vi.fn(),
  rpc: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
  fetchProduct: vi.fn(),
}));

vi.mock("@/hooks/useProducts", () => ({
  useProducts: () => ({
    addProduct: mocks.addProduct,
    updateProduct: mocks.updateProduct,
    upsertVariants: mocks.upsertVariants,
    deleteVariants: vi.fn().mockResolvedValue(undefined),
    uploadProductImages: mocks.uploadProductImages,
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
    error: mocks.toastError,
    warning: vi.fn(),
    loading: vi.fn(),
  },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const CHAVE_NOVO = "ikcous_product_form_draft:u-teste";

function botaoPorTexto(texto: string) {
  return [...document.body.querySelectorAll("button")].find((b) =>
    b.textContent?.includes(texto),
  ) as HTMLButtonElement | undefined;
}

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

function escolherFotos(arquivos: File[], idDoInput = "product-image-upload") {
  const input = document.getElementById(idDoInput) as HTMLInputElement;
  Object.defineProperty(input, "files", {
    value: arquivos,
    configurable: true,
  });
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

const foto = (nome: string) =>
  new File(["x"], nome, { type: "image/jpeg", lastModified: 1 });

/** URLs das fotos na ordem em que aparecem no carrossel do formulário. */
const urlsNaTela = () =>
  [
    ...document.querySelectorAll(
      '[aria-label="Galeria de fotos do produto"] img[src^="https://cdn/"]',
    ),
  ].map((i) => i.getAttribute("src"));

const botoesTornarPrincipal = () => [
  ...document.querySelectorAll<HTMLButtonElement>(
    'button[aria-label^="Tornar principal"]',
  ),
];

describe("AdminProductFormView — foto principal e reenvio do mesmo arquivo", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let armazem: Map<string, string>;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.addProduct.mockResolvedValue({ id: "novo-1" });
    mocks.updateProduct.mockResolvedValue({ id: "p-1" });
    mocks.upsertVariants.mockResolvedValue(true);
    mocks.rpc.mockResolvedValue({ data: { encontrado: false }, error: null });
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

  async function montarPreenchido() {
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
      await new Promise((r) => setTimeout(r, 300));
    });
  }

  /** Sobe N fotos de uma vez; cada uma recebe https://cdn/<nome>.jpg. */
  async function subirFotos(...nomes: string[]) {
    for (const nome of nomes) {
      mocks.uploadProductImages.mockResolvedValueOnce([
        `https://cdn/${nome}.jpg`,
      ]);
    }
    await act(async () => {
      escolherFotos(nomes.map((n) => foto(`${n}.jpg`)));
      await new Promise((r) => setTimeout(r, 0));
    });
  }

  const botaoPublicar = () => botaoPorTexto("Publicar") as HTMLButtonElement;

  describe("o seletor de arquivo zera depois de ler as fotos", () => {
    function espiarValor(input: HTMLInputElement) {
      const atribuicoes: string[] = [];
      Object.defineProperty(input, "value", {
        configurable: true,
        get: () => "",
        set: (v: string) => {
          atribuicoes.push(v);
        },
      });
      return atribuicoes;
    }

    it("galeria: depois de escolher, o campo é esvaziado (o MESMO arquivo dispara de novo)", async () => {
      await montarPreenchido();
      const input = document.getElementById(
        "product-image-upload",
      ) as HTMLInputElement;
      const atribuicoes = espiarValor(input);
      mocks.uploadProductImages.mockResolvedValue(["https://cdn/a.jpg"]);

      await act(async () => {
        escolherFotos([foto("a.jpg")]);
        await new Promise((r) => setTimeout(r, 0));
      });

      expect(atribuicoes).toContain("");
      // E a foto escolhida foi lida ANTES de esvaziar (não perdeu o arquivo).
      expect(mocks.uploadProductImages).toHaveBeenCalledTimes(1);
      expect(urlsNaTela()).toEqual(["https://cdn/a.jpg"]);
    });

    it("câmera: o campo de 'Tirar foto' também é esvaziado", async () => {
      await montarPreenchido();
      const input = document.getElementById(
        "product-image-capture",
      ) as HTMLInputElement;
      const atribuicoes = espiarValor(input);
      mocks.uploadProductImages.mockResolvedValue(["https://cdn/a.jpg"]);

      await act(async () => {
        escolherFotos([foto("a.jpg")], "product-image-capture");
        await new Promise((r) => setTimeout(r, 0));
      });

      expect(atribuicoes).toContain("");
      expect(urlsNaTela()).toEqual(["https://cdn/a.jpg"]);
    });
  });

  describe("Tornar principal", () => {
    it("com uma foto só, não há o que trocar: nenhum botão", async () => {
      await montarPreenchido();
      await subirFotos("a");

      expect(botoesTornarPrincipal()).toHaveLength(0);
    });

    it("a primeira foto já é a principal e diz 'Principal'; só as outras têm o botão, com 'Foto N de M'", async () => {
      await montarPreenchido();
      await subirFotos("a", "b", "c");

      expect(urlsNaTela()).toEqual([
        "https://cdn/a.jpg",
        "https://cdn/b.jpg",
        "https://cdn/c.jpg",
      ]);
      expect(
        botoesTornarPrincipal().map((b) => b.getAttribute("aria-label")),
      ).toEqual([
        "Tornar principal: foto 2 de 3",
        "Tornar principal: foto 3 de 3",
      ]);
      // O emblema "Principal" é uma folha (sem filhos) e só a primeira tem.
      const emblemas = [...document.querySelectorAll("div")].filter(
        (d) => d.children.length === 0 && d.textContent === "Principal",
      );
      expect(emblemas).toHaveLength(1);
      expect(
        emblemas[0].closest("[data-foto-principal]")?.querySelector("img"),
      ).toHaveProperty("src", "https://cdn/a.jpg");
      // Alvo de toque de pelo menos 44px (min-h-11 = 2.75rem = 44px).
      for (const botao of botoesTornarPrincipal()) {
        expect(botao.className).toMatch(/min-h-11/);
        expect(botao.textContent).toMatch(/Tornar principal/);
      }
    });

    it("tocar na terceira a leva para o começo, as outras mantêm a ordem, e Publicar manda essa ordem", async () => {
      await montarPreenchido();
      await subirFotos("a", "b", "c");

      await act(async () => {
        botoesTornarPrincipal()[1].click();
      });

      expect(urlsNaTela()).toEqual([
        "https://cdn/c.jpg",
        "https://cdn/a.jpg",
        "https://cdn/b.jpg",
      ]);
      // A nova capa já não tem o botão; as duas de trás têm, renumeradas.
      expect(
        botoesTornarPrincipal().map((b) => b.getAttribute("aria-label")),
      ).toEqual([
        "Tornar principal: foto 2 de 3",
        "Tornar principal: foto 3 de 3",
      ]);

      await act(async () => {
        botaoPublicar().click();
        await new Promise((r) => setTimeout(r, 0));
      });
      expect(mocks.addProduct).toHaveBeenCalledTimes(1);
      expect(mocks.addProduct.mock.calls[0][0].images).toEqual([
        "https://cdn/c.jpg",
        "https://cdn/a.jpg",
        "https://cdn/b.jpg",
      ]);
    });

    it("o rascunho guarda a ordem nova", async () => {
      await montarPreenchido();
      await subirFotos("a", "b");

      await act(async () => {
        botoesTornarPrincipal()[0].click();
        await new Promise((r) => setTimeout(r, 1200));
      });

      const rascunho = JSON.parse(armazem.get(CHAVE_NOVO) ?? "null");
      expect(rascunho?.images).toEqual([
        "https://cdn/b.jpg",
        "https://cdn/a.jpg",
      ]);
    });

    it("o foco não se perde: depois de trocar, cai dentro da nova capa", async () => {
      await montarPreenchido();
      await subirFotos("a", "b");

      await act(async () => {
        botoesTornarPrincipal()[0].click();
      });

      const ativo = document.activeElement as HTMLElement;
      const capa = [...document.querySelectorAll("img")].find(
        (i) => i.getAttribute("src") === "https://cdn/b.jpg",
      )?.parentElement?.parentElement;
      expect(capa).toBeDefined();
      expect(capa?.contains(ativo)).toBe(true);
      expect(ativo).not.toBe(document.body);
    });

    it("enquanto uma foto está subindo, não dá para mexer na ordem", async () => {
      await montarPreenchido();
      await subirFotos("a", "b");
      mocks.uploadProductImages.mockImplementationOnce(
        () => new Promise<string[]>(() => {}),
      );
      await act(async () => {
        escolherFotos([foto("c.jpg")]);
        await new Promise((r) => setTimeout(r, 0));
      });

      const botoes = botoesTornarPrincipal();
      expect(botoes).toHaveLength(1);
      expect(botoes[0].disabled).toBe(true);
      await act(async () => {
        botoes[0].click();
      });
      expect(urlsNaTela()).toEqual(["https://cdn/a.jpg", "https://cdn/b.jpg"]);
    });

    it("'Excluir' continua valendo: apagar a capa deixa a próxima como principal", async () => {
      await montarPreenchido();
      await subirFotos("a", "b");

      await act(async () => {
        (
          document.querySelector('button[title="Excluir"]') as HTMLButtonElement
        ).click();
        // A foto apagada ainda sai com uma animação de saída (AnimatePresence).
        await new Promise((r) => setTimeout(r, 1000));
      });

      expect(urlsNaTela()).toEqual(["https://cdn/b.jpg"]);
      expect(botoesTornarPrincipal()).toHaveLength(0);
    });
  });
});
