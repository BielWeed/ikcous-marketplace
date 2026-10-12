// @vitest-environment jsdom
//
// PAINEL SIMPLES, onda J, frente J3 ("produtos-no-celular"), FORMULÁRIO.
// Render num celular simulado (360px) mostrou: o botão Salvar/Publicar com
// 83x30 e letra de 9px; o código de barras de 13 dígitos cortado pelo botão
// "Ler com a câmera" ao lado; "o PDV lê" (jargão — a tela se chama Vender); o
// erro do estoque mínimo citando "2147483647"; as dicas das fotos em 8px e o
// selo "Principal" em 7px.
//
//   a. Salvar/Publicar com alvo de 44px (`min-h-11 min-w-11`) e 11px;
//   b. com câmera, o código de barras (produto e variação) empilha no celular
//      (`flex-col`) e fica lado a lado do xs para cima (`xs:flex-row`);
//   c. nenhum "PDV" nem "ROI" escrito no código da tela (fora de comentário);
//   d. o estoque mínimo fala humano: acima do teto "Número grande demais…",
//      negativo/decimal "Use um número inteiro…", e nunca o número 2147483647;
//   e. selo "Principal", dicas das fotos e ações da foto sem letra < 11px.
//
// Montagem real (react-dom/client + jsdom), mesmo molde de
// produto-estoque-minimo.test.tsx (LocalBufferedInput tem debounce de 200 ms).
import { readFileSync } from "node:fs";
import { join } from "node:path";
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

const RAIZ = join(__dirname, "..", "..");
const ARQUIVO = "src/views/admin/AdminProductFormView.tsx";
const ID_ESTOQUE_MINIMO = "product-estoque-minimo";
/** text-[6px] … text-[10.5px], com ou sem prefixo de tela (`md:`) — a mesma
 * regex da régua visual (regua-visual-do-painel.test.ts). */
// eslint-disable-next-line security/detect-unsafe-regex -- regex constante, sem entrada de usuário; só lê classes do próprio DOM do teste
const LETRA_PEQUENA = /text-\[(?:[6-9]|10)(?:\.\d+)?px\]/;

const FOTO =
  "https://proj.supabase.co/storage/v1/object/public/products/foto1.jpg";

const produtoDoBanco = {
  id: "prod-1",
  name: "Camiseta",
  description: "Camiseta de algodão",
  price: 50,
  costPrice: 20,
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

/** Mesmo dublê de admin-product-form-ler-com-a-camera.test.tsx: o botão
 * "Ler com a câmera" só existe quando `getUserMedia` é função. */
function definirCamera(comCamera: boolean): void {
  Object.defineProperty(navigator, "mediaDevices", {
    value: comCamera ? { getUserMedia: vi.fn() } : undefined,
    configurable: true,
    writable: true,
  });
}

function digitar(id: string, valor: string) {
  const el = document.getElementById(id) as HTMLInputElement;
  Object.getOwnPropertyDescriptor(
    globalThis.HTMLInputElement.prototype,
    "value",
  )?.set?.call(el, valor);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

async function digitarCampo(id: string, valor: string) {
  await act(async () => {
    digitar(id, valor);
    await esperar(300);
  });
}

function botoes(texto: string): HTMLButtonElement[] {
  return [...document.querySelectorAll("button")].filter((b) =>
    b.textContent?.includes(texto),
  ) as HTMLButtonElement[];
}

/** A linha do código de barras: o ancestral mais próximo do campo que também
 * tem o botão "Ler com a câmera" (o `LocalBufferedInput` embrulha o input
 * num `div` próprio, então não é o pai direto). */
function linhaDoCodigo(idDoCampo: string): HTMLElement {
  let el = document.getElementById(idDoCampo)?.parentElement ?? null;
  while (
    el &&
    ![...el.querySelectorAll("button")].some((b) =>
      b.textContent?.includes("Ler com a câmera"),
    )
  ) {
    el = el.parentElement;
  }
  if (!el) throw new Error(`linha do campo #${idDoCampo} ausente`);
  return el;
}

function secao(titulo: string): HTMLElement {
  const el = document.querySelector(`section[aria-label="${titulo}"]`);
  if (!el) throw new Error(`seção "${titulo}" ausente`);
  return el as HTMLElement;
}

/** Linhas de código do arquivo, sem as de comentário (mesma regra das guardas). */
function codigoSemComentario(): string {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- caminho fixo do repo
  return readFileSync(join(RAIZ, ARQUIVO), "utf8")
    .split("\n")
    .filter((linha) => {
      const limpa = linha.trim();
      return !(
        limpa.startsWith("//") ||
        limpa.startsWith("/*") ||
        limpa.startsWith("*") ||
        limpa.startsWith("{/*")
      );
    })
    .join("\n");
}

describe("Formulário de produto cabe no celular (onda J, J3)", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
    addProduct.mockResolvedValue({ id: "novo-1" });
    updateProduct.mockResolvedValue({ id: "prod-1" });
    fetchProduct.mockResolvedValue(produtoDoBanco);
    rpcDoSupabase.mockResolvedValue({
      data: { encontrado: false },
      error: null,
    });
    definirCamera(true);
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
    definirCamera(false);
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

  describe("a. Salvar/Publicar com alvo de 44px e letra de 11px", () => {
    it.each([
      ["produto novo", undefined, "Publicar"],
      ["edição", "prod-1", "Salvar"],
    ])("%s", async (_caso, productId, texto) => {
      await montar(productId);

      const [botao] = botoes(texto as string);
      expect(botao, `botão ${texto} ausente`).toBeDefined();
      expect(botao.className).toContain("min-h-11");
      expect(botao.className).toContain("min-w-11");
      expect(botao.className).toContain("text-[11px]");
      expect(botao.className).not.toMatch(LETRA_PEQUENA);
    });
  });

  describe("b. código de barras inteiro no celular", () => {
    it("produto: o botão da câmera fica ABAIXO do campo no celular", async () => {
      await montar();

      const campo = document.getElementById("product-codigo-barras");
      const linha = linhaDoCodigo("product-codigo-barras");
      expect(linha.className).toContain("flex-col");
      expect(linha.className).toContain("xs:flex-row");
      expect(campo?.className).toContain("font-mono");
      expect(campo?.className).toContain("tabular-nums");
    });

    it("variação: mesmo empilhamento e o botão da câmera com 44px e 11px", async () => {
      await montar();
      await act(async () => {
        botoes("+ Novo")[0].click();
        await esperar(0);
      });

      const linha = linhaDoCodigo("variant-codigo-barras");
      expect(linha.className).toContain("flex-col");
      expect(linha.className).toContain("xs:flex-row");

      const camera = [...linha.querySelectorAll("button")].find((b) =>
        b.textContent?.includes("Ler com a câmera"),
      );
      expect(camera, "botão da câmera da variação ausente").toBeDefined();
      expect(camera?.className).toContain("min-h-11");
      expect(camera?.className).toContain("text-[11px]");
    });
  });

  describe("c. sem jargão escrito na tela", () => {
    it("nenhum 'PDV' (a tela se chama Vender) nem 'ROI' fora de comentário", () => {
      const codigo = codigoSemComentario();
      expect(codigo).not.toMatch(/\bPDV\b/);
      expect(codigo).not.toMatch(/\bROI\b/);
    });

    it("a ajuda do código de barras diz 'a tela Vender lê'", async () => {
      await montar();
      expect(document.body.textContent).toContain("a tela Vender lê");
      expect(document.body.textContent).not.toMatch(/\bPDV\b/);
    });
  });

  describe("d. erro do estoque mínimo em palavras da loja", () => {
    it("acima do que o banco guarda: 'Número grande demais', sem o número", async () => {
      await montar("prod-1");
      await digitarCampo(ID_ESTOQUE_MINIMO, "3000000000");

      const texto = secao("Avançado").textContent ?? "";
      expect(texto).toContain("Número grande demais. Use um valor menor.");
      expect(texto).not.toContain("2147483647");
      expect(botoes("Salvar")[0].disabled).toBe(true);
    });

    it.each([
      ["negativo", "-3"],
      ["decimal", "2.5"],
    ])("%s (%s): 'Use um número inteiro…', sem o número", async (_c, valor) => {
      await montar("prod-1");
      await digitarCampo(ID_ESTOQUE_MINIMO, valor);

      const texto = secao("Avançado").textContent ?? "";
      expect(texto).toContain(
        "Use um número inteiro: 0, 1, 2… (sem vírgula nem sinal de menos).",
      );
      expect(texto).not.toContain("2147483647");
      expect(botoes("Salvar")[0].disabled).toBe(true);
    });
  });

  describe("e. fotos: selo, dicas e ações legíveis e tocáveis", () => {
    it("selo 'Principal' sem letra < 11px e ações da foto com 44px", async () => {
      fetchProduct.mockResolvedValue({ ...produtoDoBanco, images: [FOTO] });
      await montar("prod-1");

      const selo = [...document.querySelectorAll("div")].find(
        (el) => el.textContent === "Principal" && el.children.length === 0,
      );
      expect(selo, "selo 'Principal' ausente").toBeDefined();
      expect(selo?.className).toContain("text-[11px]");
      expect(selo?.className).not.toMatch(LETRA_PEQUENA);

      for (const titulo of ["Ajustar e Cortar", "Excluir"]) {
        const acao = document.querySelector(
          `button[title="${titulo}"]`,
        ) as HTMLButtonElement | null;
        expect(acao, `ação '${titulo}' ausente`).not.toBeNull();
        expect(acao?.className).toContain("size-11");
      }
    });

    it("dicas das fotos em 11px e '12 MB' com espaço", async () => {
      await montar();

      const dica = [...document.querySelectorAll("span")].find(
        (el) => el.textContent === "Até 12 MB cada",
      );
      expect(dica, "dica 'Até 12 MB cada' ausente").toBeDefined();
      const faixa = dica?.parentElement as HTMLElement;
      expect(faixa.className).toContain("text-[11px]");
      expect(faixa.className).not.toMatch(LETRA_PEQUENA);

      const arraste = [...document.querySelectorAll("p")].find((el) =>
        el.textContent?.includes("Arraste as imagens"),
      );
      expect(arraste?.className).toContain("text-[11px]");
    });
  });
});
