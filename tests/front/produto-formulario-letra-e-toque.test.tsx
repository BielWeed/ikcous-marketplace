// @vitest-environment jsdom
//
// Painel simples, onda K, frente K-B (B5 e B1 do formulário) — formulário de
// produto: ajuda com 44px, rótulos de 11px, estoque mínimo que avisa o leitor
// de tela e avisos de tamanho de foto em português.
//
//   a. (render) "-3" no estoque mínimo deixa `aria-invalid="true"` e o
//      `aria-describedby` aponta para a dica E para o erro; "5" tira o
//      `aria-invalid` e o erro;
//   b. (render) foto de 13 MB avisa "12 MB"; três de 11 MB avisam "(33,0 MB)" e
//      "30 MB"; nunca "12MB" colado;
//   c. (estático) os 5 botões de ajuda ("?") são envoltórios de 44px
//      (`min-h-11 min-w-11`) — o desenho do círculo mora no <span> interno;
//   d. (estático) nenhum <label> nem elemento `ml-1` + `block` (a dica ou o
//      erro de um campo) usa letra abaixo de 11px;
//   e. (estático) os dois rótulos "Código interno (SKU)" continuam
//      (caracterização: o jargão da tela não muda).
//
// Montagem real (react-dom/client + jsdom), mesmo molde de
// produto-estoque-minimo.test.tsx (LocalBufferedInput tem debounce de 200 ms).
/* eslint-disable security/detect-non-literal-fs-filename, security/detect-object-injection, security/detect-unsafe-regex --
   a prova estática lê o próprio arquivo-fonte da tela (caminho fixo no repositório, não entrada de usuário) */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act } from "react";
import type { ReactNode } from "react";
import { type Root, createRoot } from "react-dom/client";
import { toast } from "sonner";
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
const ID_DICA = "product-estoque-minimo-dica";
const ID_ERRO = "product-estoque-minimo-erro";
const MB = 1024 * 1024;

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

function campo(): HTMLInputElement {
  return document.getElementById(ID) as HTMLInputElement;
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

/** Arquivo de teste com o tamanho dito (sem alocar os bytes). */
function foto(nome: string, megas: number): File {
  const arquivo = new File(["x"], nome, { type: "image/jpeg" });
  Object.defineProperty(arquivo, "size", { value: megas * MB });
  return arquivo;
}

describe("AdminProductFormView — letra, toque e avisos (K-B)", () => {
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

  async function montar() {
    const { AdminProductFormView } = await import(
      "@/views/admin/AdminProductFormView"
    );
    await act(async () => {
      raiz.render(
        <AdminProductFormView
          productId={undefined}
          onNavigate={vi.fn()}
          onSetDirty={vi.fn()}
        />,
      );
    });
  }

  describe("a. estoque mínimo avisa o leitor de tela", () => {
    it("com erro: aria-invalid='true' e aria-describedby aponta para a dica e para o erro", async () => {
      await montar();
      await digitarCampo(ID, "-3");

      expect(campo().getAttribute("aria-invalid")).toBe("true");
      const ligados = (campo().getAttribute("aria-describedby") ?? "").split(
        " ",
      );
      expect(ligados).toContain(ID_DICA);
      expect(ligados).toContain(ID_ERRO);
      expect(document.getElementById(ID_ERRO)?.textContent).toContain(
        "número inteiro",
      );
      expect(document.getElementById(ID_DICA)?.textContent).toContain(
        "Vazio usa o padrão (5)",
      );
    });

    it("valor bom ('5'): sem aria-invalid, só a dica ligada e nenhum erro na tela", async () => {
      await montar();
      await digitarCampo(ID, "-3");
      await digitarCampo(ID, "5");

      expect(campo().hasAttribute("aria-invalid")).toBe(false);
      expect(campo().getAttribute("aria-describedby")).toBe(ID_DICA);
      expect(document.getElementById(ID_ERRO)).toBeNull();
    });
  });

  describe("b. avisos de tamanho de foto em português", () => {
    async function enviar(...arquivos: File[]) {
      const entrada = document.getElementById(
        "product-image-upload",
      ) as HTMLInputElement;
      Object.defineProperty(entrada, "files", {
        value: arquivos,
        configurable: true,
      });
      await act(async () => {
        entrada.dispatchEvent(new Event("change", { bubbles: true }));
        await esperar(10);
      });
    }

    it("uma foto de 13 MB: o aviso diz '12 MB' (com espaço)", async () => {
      await montar();
      await enviar(foto("grande.jpg", 13));

      expect(toast.error).toHaveBeenCalledTimes(1);
      const mensagem = vi.mocked(toast.error).mock.calls[0][0] as string;
      expect(mensagem).toContain("12 MB");
      expect(mensagem).not.toMatch(/\d(MB)/);
    });

    it("três fotos de 11 MB: o aviso diz '(33,0 MB)' e '30 MB'", async () => {
      await montar();
      await enviar(foto("a.jpg", 11), foto("b.jpg", 11), foto("c.jpg", 11));

      expect(toast.error).toHaveBeenCalledTimes(1);
      const mensagem = vi.mocked(toast.error).mock.calls[0][0] as string;
      expect(mensagem).toContain("(33,0 MB)");
      expect(mensagem).toContain("30 MB");
      expect(mensagem).not.toMatch(/\d(MB)/);
    });
  });

  describe("estático (lê o arquivo-fonte da tela)", () => {
    const FONTE = readFileSync(
      join(__dirname, "..", "..", "src/views/admin/AdminProductFormView.tsx"),
      "utf8",
    );
    const TEXTO_MIUDO = /text-\[(?:[6-9]|10)(?:\.\d+)?px\]/;

    /** A tag de abertura JSX que começa em `inicio` (até o `>` fora de `{}` e de aspas). */
    function tagAPartirDe(inicio: number): string {
      let profundidade = 0;
      let aspas: string | null = null;
      for (let i = inicio + 1; i < FONTE.length; i++) {
        const c = FONTE[i];
        if (aspas) {
          if (c === aspas) aspas = null;
          continue;
        }
        if (profundidade === 0 && (c === '"' || c === "'")) aspas = c;
        else if (c === "{") profundidade++;
        else if (c === "}") profundidade--;
        else if (c === ">" && profundidade === 0)
          return FONTE.slice(inicio, i + 1);
      }
      return "";
    }

    function tagBotaoDoOnClick(onClick: string): string {
      const posicao = FONTE.indexOf(onClick);
      expect(posicao, `onClick ausente: ${onClick}`).toBeGreaterThan(-1);
      return tagAPartirDe(FONTE.lastIndexOf("<button", posicao));
    }

    it("c. os 5 botões de ajuda têm min-h-11 e min-w-11", () => {
      const onClicks = [
        "onClick={() => setShowHelpModal(true)}",
        "onClick={() => setShowPhotoGuide((prev) => !prev)}",
        'onClick={() => toggleHelp("productData")}',
        'onClick={() => toggleHelp("productVariants")}',
        'onClick={() => toggleHelp("productPricing")}',
      ];
      for (const onClick of onClicks) {
        const botao = tagBotaoDoOnClick(onClick);
        expect(botao, onClick).toContain("min-h-11");
        expect(botao, onClick).toContain("min-w-11");
      }
    });

    it("d. nenhum <label> nem dica/erro (ml-1 + block) com letra abaixo de 11px", () => {
      const ruins: string[] = [];
      for (const m of FONTE.matchAll(/<[a-zA-Z][\w.]*/g)) {
        const tag = tagAPartirDe(m.index);
        const ehLabel = m[0] === "<label";
        const ehDicaOuErro =
          /(?:^|[\s"'`])ml-1(?:[\s"'`]|$)/.test(tag) &&
          /(?:^|[\s"'`])block(?:[\s"'`]|$)/.test(tag);
        if ((ehLabel || ehDicaOuErro) && TEXTO_MIUDO.test(tag)) {
          const linha = FONTE.slice(0, m.index).split("\n").length;
          ruins.push(`linha ${linha}: ${tag.slice(0, 90)}`);
        }
      }
      expect(ruins).toEqual([]);
    });

    it("e. os dois 'Código interno (SKU)' (variação e produto) continuam", () => {
      expect(FONTE.match(/Código interno \(SKU\)/g)?.length).toBe(2);
    });
  });
});
