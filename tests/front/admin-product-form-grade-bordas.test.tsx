// @vitest-environment jsdom
//
// As bordas da grade de variações, na tela de verdade — o que o caminho feliz
// (admin-product-form-grade-criar.test.tsx) não pega:
//
//  - efetivar DUAS vezes seguidas (duplo clique, ou o clique que chega
//    durante a animação de saída do modal) não duplica as linhas;
//  - três camadas (Cor × Tamanho × Material) viram UMA linha por combinação;
//  - a grade que passaria do teto de 60 variações do produto é recusada
//    inteira, sem cortar em silêncio;
//  - efetivar uma grade passa pela regra do estoque do produto: ele vira a
//    soma das combinações ligadas (e as desligadas não entram na conta);
//  - preço por combinação: o digitado numa linha vai só nela, o vazio fica
//    como "usa o preço do produto".
//
// Mesmo padrão de admin-product-form-grade-criar.test.tsx (createRoot + act,
// hooks mockados, debounce do LocalBufferedInput esperado a cada digitação).
import { act } from "react";
import type { ReactNode } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fetchProduct = vi.fn();
const upsertVariants = vi.fn().mockResolvedValue(undefined);
const updateProduct = vi.fn().mockResolvedValue(undefined);
const addProduct = vi.fn().mockResolvedValue(undefined);
// A lista da loja alimenta a checagem de SKU (UNIQUE global da tabela).
let produtosDaLoja: Array<Record<string, unknown>> = [];

vi.mock("@/hooks/useProducts", () => ({
  useProducts: () => ({
    addProduct,
    updateProduct,
    upsertVariants,
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

const toastError = vi.fn();
const toastInfo = vi.fn();
vi.mock("sonner", () => ({
  toast: {
    info: toastInfo,
    success: vi.fn(),
    error: toastError,
    warning: vi.fn(),
    loading: vi.fn(),
  },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function botaoPorTexto(raiz: ParentNode, texto: string) {
  return [...raiz.querySelectorAll("button")].find((b) =>
    b.textContent?.includes(texto),
  ) as HTMLButtonElement | undefined;
}

function clicarObrigatorio(texto: string) {
  const botao = botaoPorTexto(document.body, texto);
  if (!botao) throw new Error(`Botão "${texto}" não está na tela.`);
  botao.click();
}

/** Botão só-ícone: o nome mora no aria-label, não no textContent. */
function clicarPorRotulo(rotulo: string) {
  const botao = document.body.querySelector(
    `[aria-label="${rotulo}"]`,
  ) as HTMLButtonElement | null;
  if (!botao) throw new Error(`Botão "${rotulo}" não está na tela.`);
  botao.click();
}

function digitar(id: string, valor: string) {
  const el = document.getElementById(id) as HTMLInputElement;
  if (!el) throw new Error(`Campo "${id}" não está na tela.`);
  const setter = Object.getOwnPropertyDescriptor(
    globalThis.HTMLInputElement.prototype,
    "value",
  )?.set;
  setter?.call(el, valor);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

async function digitarCampo(id: string, valor: string) {
  await act(async () => {
    digitar(id, valor);
    await new Promise((r) => setTimeout(r, 300));
  });
}

function valorDoCampo(id: string): string {
  const el = document.getElementById(id) as HTMLInputElement | null;
  return el?.value ?? "";
}

function variantesNaTela(): string[] {
  return [
    ...document.querySelectorAll('[data-testid="variante-cadastrada"]'),
  ].map((el) => el.textContent?.replace(/\s+/g, " ").trim() ?? "");
}

function linhasDaGrade(): string[] {
  return [...document.querySelectorAll('[data-testid="linha-da-grade"]')].map(
    (el) => el.textContent?.replace(/\s+/g, " ").trim() ?? "",
  );
}

describe("AdminProductFormView — bordas da grade", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
    produtosDaLoja = [];
    vi.stubGlobal("localStorage", {
      getItem: () => null,
      setItem: () => undefined,
      removeItem: () => undefined,
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

  async function montarNovo() {
    const { AdminProductFormView } = await import(
      "@/views/admin/AdminProductFormView"
    );
    await act(async () => {
      raiz.render(
        <AdminProductFormView onNavigate={vi.fn()} onSetDirty={vi.fn()} />,
      );
    });
  }

  async function montarEmEdicao(variantes: unknown[], estoque = 3) {
    fetchProduct.mockResolvedValue({
      id: "prod-1",
      name: "Blusa de Tricô",
      description: "Blusa quente de tricô",
      price: 89.9,
      stock: estoque,
      category: "cat-1",
      images: [],
      freeShipping: false,
      isBestseller: false,
      isActive: true,
      variants: variantes,
    });
    const { AdminProductFormView } = await import(
      "@/views/admin/AdminProductFormView"
    );
    await act(async () => {
      raiz.render(
        <AdminProductFormView
          productId="prod-1"
          onNavigate={vi.fn()}
          onSetDirty={vi.fn()}
        />,
      );
      await new Promise((r) => setTimeout(r, 50));
    });
  }

  /** Passo 1 de uma camada: nome do atributo + valores digitados. */
  async function camada(indice: number, nome: string, valores: string[]) {
    await digitarCampo(`grade-nome-${indice}`, nome);
    for (const valor of valores) {
      await digitarCampo(`grade-valor-${indice}`, valor);
      await act(async () => {
        clicarPorRotulo(`Adicionar valor do atributo ${indice + 1}`);
      });
    }
  }

  const salva = (id: string, valor: string, estoque: number, ativa = true) => ({
    id,
    productId: "prod-1",
    name: "Tamanho",
    value: valor,
    stockIncrement: estoque,
    active: ativa,
  });

  it("efetivar duas vezes seguidas NÃO duplica as linhas", async () => {
    await montarNovo();
    await act(async () => {
      clicarObrigatorio("+ Grade");
    });
    await camada(0, "Cor", ["Azul", "Verde"]);
    await act(async () => {
      clicarObrigatorio("Gerar grade");
    });
    expect(linhasDaGrade()).toEqual(["Azul", "Verde"]);

    // Dois cliques no mesmo botão antes de a tela responder ao primeiro.
    await act(async () => {
      const botao = botaoPorTexto(document.body, "Efetivar 2 variantes");
      botao?.click();
      botao?.click();
    });

    expect(variantesNaTela()).toEqual(["Cor: Azul", "Cor: Verde"]);
  });

  it("três camadas viram UMA linha por combinação, no formato da casa", async () => {
    await montarNovo();
    await act(async () => {
      clicarObrigatorio("+ Grade");
    });
    await camada(0, "Cor", ["Preto"]);
    await act(async () => {
      clicarObrigatorio("+ Atributo");
    });
    await camada(1, "Tamanho", ["P", "M"]);
    await act(async () => {
      clicarObrigatorio("+ Atributo");
    });
    await camada(2, "Material", ["Algodão", "Linho"]);
    // O teto é de 3 camadas: não há quarto "+ Atributo".
    expect(botaoPorTexto(document.body, "+ Atributo")).toBeUndefined();

    await act(async () => {
      clicarObrigatorio("Gerar grade");
    });
    expect(linhasDaGrade()).toEqual([
      "Preto / P / Algodão",
      "Preto / P / Linho",
      "Preto / M / Algodão",
      "Preto / M / Linho",
    ]);

    await act(async () => {
      clicarObrigatorio("Efetivar 4 variantes");
    });
    expect(toastError).not.toHaveBeenCalled();
    expect(variantesNaTela()).toEqual([
      "Cor / Tamanho / Material: Preto / P / Algodão",
      "Cor / Tamanho / Material: Preto / P / Linho",
      "Cor / Tamanho / Material: Preto / M / Algodão",
      "Cor / Tamanho / Material: Preto / M / Linho",
    ]);
  });

  it("a grade que passaria de 60 variações é recusada inteira, sem criar nenhuma", async () => {
    const cinquentaEOito = Array.from({ length: 58 }, (_, i) =>
      salva(`v-${i + 1}`, `T${i + 1}`, 1),
    );
    await montarEmEdicao(cinquentaEOito);
    await act(async () => {
      clicarObrigatorio("+ Grade");
    });
    // O produto já usa "Tamanho" (grupo único): a grade completa o mesmo grupo.
    expect(valorDoCampo("grade-nome-0")).toBe("Tamanho");
    for (const valor of ["N1", "N2", "N3"]) {
      await digitarCampo("grade-valor-0", valor);
      await act(async () => {
        clicarPorRotulo("Adicionar valor do atributo 1");
      });
    }
    await act(async () => {
      clicarObrigatorio("Gerar grade");
    });

    expect(toastError).toHaveBeenCalledTimes(1);
    expect(toastError.mock.calls[0][0]).toContain("60");
    // Ficou no passo 1, nada foi gerado nem entrou na lista.
    expect(linhasDaGrade()).toEqual([]);
    expect(variantesNaTela()).toHaveLength(58);
  });

  it("efetivar uma grade acerta o estoque do produto: soma das ligadas, sem as desligadas", async () => {
    // Produto com uma variação DESLIGADA (estoque 9, não conta) e estoque 3.
    await montarEmEdicao([salva("v-velha", "XG", 9, false)], 3);

    await act(async () => {
      clicarObrigatorio("+ Grade");
    });
    await camada(0, "Tamanho", ["P", "M"]);
    await act(async () => {
      clicarObrigatorio("Gerar grade");
    });
    await digitarCampo("grade-aplicar-estoque", "4");
    await act(async () => {
      clicarObrigatorio("Aplicar para todas");
    });
    await act(async () => {
      clicarObrigatorio("Efetivar 2 variantes");
    });

    expect(toastError).not.toHaveBeenCalled();
    // 4 + 4 das duas novas ligadas; o 9 da desligada fica de fora.
    expect(valorDoCampo("product-stock")).toBe("8");
  });

  it("preço por combinação: o digitado vai só na linha, o vazio fica 'Auto'", async () => {
    await montarNovo();
    await act(async () => {
      clicarObrigatorio("+ Grade");
    });
    await camada(0, "Tamanho", ["P", "G"]);
    await act(async () => {
      clicarObrigatorio("Gerar grade");
    });
    // A G custa mais; a P usa o preço do produto.
    await digitarCampo("grade-linha-preco-1", "109,90");
    expect(valorDoCampo("grade-linha-preco-0")).toBe("");

    await act(async () => {
      clicarObrigatorio("Efetivar 2 variantes");
    });

    expect(toastError).not.toHaveBeenCalled();
    const texto = document.body.textContent ?? "";
    expect(texto).toContain("R$ 109.90");
    // Só UMA linha ganhou selo de preço próprio.
    expect(texto.match(/R\$ \d+\.\d{2}/g)).toHaveLength(1);
  });
});
