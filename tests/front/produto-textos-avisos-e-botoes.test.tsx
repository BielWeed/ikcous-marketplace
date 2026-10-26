// @vitest-environment jsdom
//
// Formulário de produto: textos, avisos e botões que contavam uma coisa e
// faziam outra (frente "u179-textos"). Cada bloco `describe` é um item:
//   1. rótulo do estoque curto (não quebra em 2 linhas no celular)
//   2. depois de uma falha que pede recarregar, a barra diz isso (e não "Pronto")
//   3. a frase "falta preencher" leva ao PRIMEIRO campo que falta
//   4. análise do lucro em três faixas, em palavras simples
//   5. "Excluir variante?": botão vermelho existente, 44 px, título normal
//   6. custo apagado tecla por tecla fica vazio (sem custo), não "0,00"
//   7. peso acima de 30 kg avisa (suave) que talvez sejam gramas
//   8. jargão: "offline", "1 ativas", "UND", "ID do Sistema", "banco de dados"
//   9. o resumo de "Custo e lucro" fala só de custo (a promoção saiu de lá)
//
// Montagem real (react-dom/client + jsdom), molde de produto-basico-primeiro.
import { act } from "react";
import type { ReactNode } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { escolherCategoriaDoProduto } from "./helpers/escolher-categoria-do-produto";

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
    warning: vi.fn(),
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
  costPrice: null as number | null,
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

const variacao = (id: string, valor: string, ativa: boolean) => ({
  id,
  productId: "prod-1",
  name: "Cor",
  value: valor,
  sku: `SKU-${valor}`,
  codigoBarras: "",
  stockIncrement: 3,
  stock: 3,
  priceOverride: null,
  active: ativa,
  imageUrl: "",
});

const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

function digitar(id: string, valor: string) {
  const el = document.getElementById(id) as
    | HTMLInputElement
    | HTMLTextAreaElement;
  if (!el) throw new Error(`campo #${id} ausente`);
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

async function escolherCategoria(nome: string) {
  await act(async () => {
    escolherCategoriaDoProduto(nome);
    await esperar(50);
  });
}

async function preencherOBasico() {
  await digitarCampo("product-name", "Produto Teste");
  await digitarCampo("product-description", "Descrição de teste");
  await digitarCampo("product-sale-price", "1000");
  await digitarCampo("product-stock", "5");
  await escolherCategoria("Geral");
}

const botaoPorTexto = (texto: string) =>
  [...document.querySelectorAll("button")].find(
    (b) => b.textContent?.trim() === texto,
  ) as HTMLButtonElement | undefined;

function barraDeAcoes(): HTMLElement {
  return document.querySelector(
    '[aria-label="Ações do produto"]',
  ) as HTMLElement;
}

const secao = (titulo: string) =>
  document.querySelector(`section[aria-label="${titulo}"]`) as HTMLElement;

describe("AdminProductFormView — textos, avisos e botões (u179)", () => {
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

  async function montar(productId?: string) {
    const { AdminProductFormView } = await import(
      "@/views/admin/AdminProductFormView"
    );
    await act(async () => {
      raiz.render(
        <AdminProductFormView
          userId="u-teste"
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

  describe("1. rótulo do estoque", () => {
    it("é curto: 'Estoque *' (o longo quebrava em duas linhas sobre o número)", async () => {
      await montar();
      const rotulo = document.querySelector('label[for="product-stock"]');
      expect(rotulo?.textContent?.trim()).toBe("Estoque *");
      expect(document.body.textContent).not.toContain("Quantidade em Estoque");
    });
  });

  describe("2. falha que pede recarregar", () => {
    it("a barra não diz 'Pronto', manda recarregar e oferece o botão", async () => {
      updateProduct.mockRejectedValue(
        Object.assign(new Error("releitura falhou"), { gradeGravada: true }),
      );
      vi.spyOn(console, "error").mockImplementation(() => {});
      await montar("prod-1");
      await digitarCampo("product-name", "Camiseta nova");
      expect(barraDeAcoes().textContent).toContain("Pronto para salvar");
      await act(async () => {
        botaoPorTexto("Salvar")?.click();
        await esperar(100);
      });
      const texto = barraDeAcoes().textContent ?? "";
      expect(texto).not.toContain("Pronto");
      expect(texto).toContain("Recarregue a tela antes de salvar de novo");
      expect(botaoPorTexto("Recarregar")).toBeDefined();
      expect(botaoPorTexto("Salvar")?.disabled).toBe(true);
    });
  });

  describe("3. 'falta preencher' leva ao primeiro campo que falta", () => {
    const frase = () =>
      barraDeAcoes().querySelector(
        '[data-testid="motivo-do-bloqueio"] button',
      ) as HTMLButtonElement | null;

    it("sem descrição: tocar na frase foca a descrição", async () => {
      await montar();
      await digitarCampo("product-name", "Produto Teste");
      await digitarCampo("product-sale-price", "1000");
      await digitarCampo("product-stock", "5");
      await escolherCategoria("Geral");
      expect(frase()?.textContent).toContain("descrição");
      await act(async () => {
        frase()?.click();
        await esperar(50);
      });
      expect(document.activeElement?.id).toBe("product-description");
    });

    it("nome vazio e preço 0,00: a frase fala do nome e leva ao nome (não ao preço)", async () => {
      await montar();
      await digitarCampo("product-description", "Descrição de teste");
      await digitarCampo("product-sale-price", "0");
      await digitarCampo("product-stock", "5");
      await escolherCategoria("Geral");
      expect(frase()?.textContent).toMatch(/falta preencher: nome/);
      await act(async () => {
        frase()?.click();
        await esperar(50);
      });
      expect(document.activeElement?.id).toBe("product-name");
    });

    it("tocar no Publicar cinza também leva ao primeiro campo que falta", async () => {
      await montar();
      await digitarCampo("product-name", "Produto Teste");
      const publicar = botaoPorTexto("Publicar") as HTMLButtonElement;
      expect(publicar.disabled).toBe(true);
      // O botão desligado não recebe o toque (pointer-events: none): quem o
      // recebe é o invólucro dele.
      await act(async () => {
        publicar.parentElement?.click();
        await esperar(50);
      });
      expect(document.activeElement?.id).toBe("product-description");
    });
  });

  describe("4. análise do lucro", () => {
    async function comCusto(custoEmCentavos: string) {
      await montar();
      await digitarCampo("product-sale-price", "10000");
      await digitarCampo("product-cost-price", custoEmCentavos);
      const p = [...document.querySelectorAll("p")].find((x) =>
        x.textContent?.includes("Análise do Sistema"),
      ) as HTMLElement;
      return p;
    }

    it("lucro de 5% é 'Lucro baixo (menos de 30%)', em âmbar, nunca 'Alta Performance'", async () => {
      const p = await comCusto("9500");
      expect(p.textContent).toContain("Lucro baixo (menos de 30%)");
      expect(p.className).toContain("text-amber-300");
      expect(p.className).not.toContain("emerald");
      expect(document.body.textContent).not.toContain("Alta Performance");
    });

    it("custo igual ao preço é 'Sem lucro'", async () => {
      const p = await comCusto("10000");
      expect(p.textContent).toContain("Sem lucro");
      expect(p.textContent).not.toContain("Margem Negativa");
    });

    it("custo maior que o preço é 'Prejuízo', em vermelho", async () => {
      const p = await comCusto("12000");
      expect(p.textContent).toContain("Prejuízo");
      expect(p.className).toContain("text-rose-300");
    });

    it("margem de 40% é 'Lucro bom', em verde", async () => {
      const p = await comCusto("6000");
      expect(p.textContent).toContain("Lucro bom");
      expect(p.className).toContain("text-emerald-300");
    });
  });

  describe("5. aviso 'Excluir variante?'", () => {
    it("botão vermelho de classe existente, 44 px de toque e título em caixa normal", async () => {
      fetchProduct.mockResolvedValue({
        ...produtoDoBanco,
        variants: [variacao("v-1", "Azul", true)],
      });
      await montar("prod-1");
      await act(async () => {
        (
          document.querySelector(
            '[aria-label="Excluir variação Azul"]',
          ) as HTMLButtonElement
        ).click();
      });
      const confirmar = botaoPorTexto("Excluir Variante") as HTMLButtonElement;
      const cancelar = botaoPorTexto("Cancelar") as HTMLButtonElement;
      expect(confirmar.className).not.toContain("rose-650");
      expect(confirmar.className).toContain("bg-red-600");
      expect(confirmar.className).toContain("min-h-11");
      expect(cancelar.className).toContain("min-h-11");
      const titulo = document.querySelector(
        '[role="alertdialog"] h2',
      ) as HTMLElement;
      expect(titulo.textContent).toBe("Excluir variante?");
      expect(titulo.className).not.toContain("uppercase");
      const aviso = document.querySelector('[role="alertdialog"]')?.textContent;
      expect(aviso).not.toContain("banco de dados");
    });
  });

  describe("6. custo apagado", () => {
    it("apagar o custo tecla por tecla deixa o campo vazio e salva sem custo", async () => {
      fetchProduct.mockResolvedValue({ ...produtoDoBanco, costPrice: 12.5 });
      await montar("prod-1");
      expect(campoDeCusto().value).toBe("12,50");
      // O último backspace do "0,05" deixa "0,0": a máscara lia como "0,00".
      await digitarCampo("product-cost-price", "0,0");
      expect(campoDeCusto().value).toBe("");
      await act(async () => {
        botaoPorTexto("Salvar")?.click();
        await esperar(100);
      });
      expect(updateProduct).toHaveBeenCalledTimes(1);
      expect(updateProduct.mock.calls[0][1]).toMatchObject({ costPrice: null });
    });

    function campoDeCusto() {
      return document.getElementById("product-cost-price") as HTMLInputElement;
    }
  });

  describe("7. peso", () => {
    const aviso = () => document.getElementById("product-weight-aviso");

    it("acima de 30 kg avisa que talvez sejam gramas e não bloqueia", async () => {
      await montar();
      await preencherOBasico();
      await digitarCampo("product-weight", "350");
      expect(aviso()?.textContent).toContain("Isso é mais de 30 kg");
      expect(aviso()?.textContent).toContain("0,350 para 350 g");
      expect((botaoPorTexto("Publicar") as HTMLButtonElement).disabled).toBe(
        false,
      );
      await act(async () => {
        botaoPorTexto("Publicar")?.click();
        await esperar(100);
      });
      expect(addProduct.mock.calls[0][0].weightKg).toBe(350);
    });

    it("0,35 kg não avisa, e o exemplo usa vírgula", async () => {
      await montar();
      await digitarCampo("product-weight", "0.35");
      expect(aviso()).toBeNull();
      expect(
        (document.getElementById("product-weight") as HTMLInputElement)
          .placeholder,
      ).toBe("Ex.: 0,350");
    });
  });

  describe("8. jargão e ajuda que contradiz a tela", () => {
    it("variações: '1 ativa', 'desligada' e 'un.' (sem offline, 'ativas' errado nem UND)", async () => {
      fetchProduct.mockResolvedValue({
        ...produtoDoBanco,
        variants: [
          variacao("v-1", "Azul", true),
          variacao("v-2", "Rosa", false),
        ],
      });
      await montar("prod-1");
      // O resumo só aparece com a seção fechada: fecha a das variações.
      const cabecalho = [
        ...document.querySelectorAll<HTMLButtonElement>(
          "button[aria-expanded]",
        ),
      ].find((b) => b.textContent?.startsWith("Variações"));
      expect(cabecalho?.getAttribute("aria-expanded")).toBe("true");
      await act(async () => {
        cabecalho?.click();
      });
      const texto = document.body.textContent ?? "";
      expect(texto).toContain("1 ativa · 3 un. · 1 desligada");
      expect(texto).not.toContain("1 ativas");
      expect(texto).not.toMatch(/offline/i);
      expect(texto).not.toContain("UND");
      expect(texto).toContain("Desligada3 un.");
    });

    it("produto novo não mostra o código técnico; o existente mostra só o número", async () => {
      await montar();
      expect(document.body.textContent).not.toContain("NEW_ENTRY");
      expect(document.body.textContent).not.toContain("ID do Sistema");
      act(() => raiz.unmount());
      raiz = createRoot(hospedeiro);
      await montar("prod-1");
      expect(document.body.textContent).toContain("prod-1");
      expect(document.body.textContent).not.toContain("ID do Sistema");
    });

    it("a ajuda usa os nomes reais das seções e uma só proporção de foto", async () => {
      await montar();
      await act(async () => {
        (
          document.querySelector(
            '[aria-label="Como cadastrar um produto"]',
          ) as HTMLButtonElement
        ).click();
      });
      const ajuda = document.body.textContent ?? "";
      expect(ajuda).toContain("Custo e lucro");
      expect(ajuda).toContain("preço de venda menos custo");
      expect(ajuda).not.toContain("Precificação & Custos");
      expect(ajuda).not.toContain("Galeria de Mídia");
      expect(ajuda).not.toContain("lucro líquido");
      expect(ajuda).not.toContain("margem de contribuição");
      expect(ajuda).not.toContain("quadradas");
      expect(ajuda).toContain("4:5; use o recorte Vitrine");
      const titulos = [...document.querySelectorAll("h4")].filter((h) =>
        h.textContent?.includes("Estrutura do Formulário"),
      );
      expect(titulos).toHaveLength(1);
      expect(titulos[0].className).not.toContain("uppercase");
    });
  });

  describe("9. resumo de 'Custo e lucro'", () => {
    it("fala só de custo, mesmo com a promoção ligada (a promoção mora junto do preço)", async () => {
      await montar();
      expect(secao("Custo e lucro").textContent).toContain("Custo · opcional");
      await act(async () => {
        (
          document.getElementById("product-promo-active") as HTMLInputElement
        ).click();
      });
      const texto = secao("Custo e lucro").textContent ?? "";
      expect(texto).toContain("Custo · opcional");
      expect(texto).not.toContain("Promoção");
      expect(texto).not.toContain("De/Por");
      expect(texto).not.toContain("só você vê");
    });
  });
});
