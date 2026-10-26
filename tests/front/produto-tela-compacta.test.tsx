// @vitest-environment jsdom
//
// Formulário de produto — o redesenho compacto (u186): topo com anel e barra
// fina de progresso, rótulos ESSENCIAL / PROMOÇÃO / MAIS DETALHES, cartão de
// fotos compacto e a barra de baixo de UMA linha de estado. Só layout e texto:
// o que habilita e desabilita o Publicar é o de sempre (os outros testes do
// formulário protegem isso).
//
// Montagem real (react-dom/client + jsdom), mesmo molde dos outros testes do
// formulário (LocalBufferedInput tem debounce de 200 ms).
import { ContextoDaBarra } from "@/components/layouts/AcaoDaBarra";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { escolherCategoriaDoProduto } from "./helpers/escolher-categoria-do-produto";

const addProduct = vi.fn();
const updateProduct = vi.fn();
const fetchProduct = vi.fn();
const rpcDoSupabase = vi.fn();
const configDaLoja = { shippingCoverage: "national" as "national" | "local" };

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
  useStore: () => ({ config: configDaLoja }),
}));

vi.mock("@/lib/supabase", () => ({
  supabase: { rpc: rpcDoSupabase },
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

const q = (seletor: string) => document.querySelector(seletor);
const texto = (seletor: string) => q(seletor)?.textContent ?? null;

describe("AdminProductFormView — tela compacta (u186)", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let prateleira: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
    configDaLoja.shippingCoverage = "national";
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
    prateleira = document.createElement("div");
    document.body.appendChild(prateleira);
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    prateleira.remove();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  async function montar(productId?: string) {
    const { AdminProductFormView } = await import(
      "@/views/admin/AdminProductFormView"
    );
    await act(async () => {
      raiz.render(
        <ContextoDaBarra.Provider
          value={{
            destino: prateleira,
            receberPrateleira: vi.fn(),
            larga: false,
            altura: 90,
          }}
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

  async function digitarCampo(id: string, valor: string) {
    await act(async () => {
      digitar(id, valor);
      await esperar(300);
    });
  }

  async function preencherOBasico() {
    await act(async () => {
      digitar("product-name", "Produto Teste");
      digitar("product-description", "Descrição de teste");
      digitar("product-sale-price", "1000");
      digitar("product-stock", "5");
      escolherCategoriaDoProduto("Geral");
      await esperar(300);
    });
  }

  const barra = () => q('[aria-label="Ações do produto"]') as HTMLElement;
  const botaoDaBarra = (rotulo: string) =>
    [...barra().querySelectorAll("button")].find(
      (b) => b.textContent?.trim() === rotulo,
    ) as HTMLButtonElement | undefined;

  describe("1. o topo: anel, subtítulo e barra fina", () => {
    it("produto novo e vazio: 0/5, anel cinza, barra fina em zero com os valores certos", async () => {
      await montar();
      expect(texto('[data-testid="progresso-do-produto"]')).toContain(
        "0 de 5 essenciais prontos",
      );
      const anel = q('[data-testid="anel-do-produto"]') as HTMLElement;
      expect(anel.textContent).toBe("0/5");
      expect(anel.dataset.estado).toBe("vazio");
      const barraFina = q('[role="progressbar"]') as HTMLElement;
      expect(barraFina.getAttribute("aria-valuemin")).toBe("0");
      expect(barraFina.getAttribute("aria-valuemax")).toBe("5");
      expect(barraFina.getAttribute("aria-valuenow")).toBe("0");
      expect(barraFina.getAttribute("aria-valuetext")).toBe(
        "0 de 5 essenciais prontos",
      );
      expect((barraFina.firstElementChild as HTMLElement).style.width).toBe(
        "0%",
      );
    });

    it("os cinco tracinhos grandes do desenho antigo não existem mais", async () => {
      await montar();
      expect(q(".produto-progresso")).toBeNull();
      expect(q(".produto-etapa-preenchida")).toBeNull();
    });

    it("com um campo pronto o anel vira esmeralda (parcial) e a barra anda 1/5", async () => {
      await montar();
      await digitarCampo("product-name", "Camiseta");
      const anel = q('[data-testid="anel-do-produto"]') as HTMLElement;
      expect(anel.textContent).toBe("1/5");
      expect(anel.dataset.estado).toBe("parcial");
      const barraFina = q('[role="progressbar"]') as HTMLElement;
      expect(barraFina.getAttribute("aria-valuenow")).toBe("1");
      expect((barraFina.firstElementChild as HTMLElement).style.width).toBe(
        "20%",
      );
    });

    it("os mesmos cinco critérios de sempre: nome, descrição, categoria, preço e estoque", async () => {
      await montar();
      await preencherOBasico();
      const anel = q('[data-testid="anel-do-produto"]') as HTMLElement;
      expect(anel.textContent).toBe("5/5");
      expect(anel.dataset.estado).toBe("completo");
      expect(
        (q('[role="progressbar"]') as HTMLElement).getAttribute(
          "aria-valuenow",
        ),
      ).toBe("5");
      expect(texto('[data-testid="progresso-do-produto"]')).toContain(
        "5 de 5 essenciais prontos",
      );
    });

    it("mantém o botão de ajuda do topo e o título", async () => {
      await montar();
      expect(
        q('button[aria-label="Como cadastrar um produto"]'),
      ).not.toBeNull();
      expect(q("h1")?.textContent).toMatch(/novo/i);
    });

    it("o anel é só desenho (aria-hidden): quem lê é a barra e o subtítulo", async () => {
      await montar();
      expect(
        (q('[data-testid="anel-do-produto"]') as HTMLElement).getAttribute(
          "aria-hidden",
        ),
      ).toBe("true");
    });
  });

  describe("3. rótulos de seção, na ordem do desenho", () => {
    it("ESSENCIAL, PROMOÇÃO e MAIS DETALHES existem, nessa ordem, em volta dos campos certos", async () => {
      await montar();
      const rotulos = [...document.querySelectorAll("h2")].map((h) =>
        h.textContent?.trim(),
      );
      const i = (t: string) => rotulos.indexOf(t);
      expect(i("Essencial")).toBeGreaterThanOrEqual(0);
      expect(i("Promoção")).toBeGreaterThan(i("Essencial"));
      expect(i("Mais detalhes")).toBeGreaterThan(i("Promoção"));

      const h2 = (t: string) =>
        [...document.querySelectorAll("h2")].find(
          (h) => h.textContent?.trim() === t,
        ) as HTMLElement;
      const depois = (a: Element, b: Element) =>
        (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
      const campo = (id: string) => document.getElementById(id) as HTMLElement;

      expect(depois(h2("Essencial"), campo("product-name"))).toBe(true);
      expect(depois(campo("product-stock"), h2("Promoção"))).toBe(true);
      expect(depois(h2("Promoção"), campo("product-promo-active"))).toBe(true);
      expect(depois(campo("product-promo-active"), h2("Mais detalhes"))).toBe(
        true,
      );
      // Fotos vêm antes de tudo.
      expect(
        depois(
          q('[aria-label="Fotos do produto"]') as HTMLElement,
          h2("Essencial"),
        ),
      ).toBe(true);
    });

    it("as linhas de MAIS DETALHES vêm na ordem: Variações, Custo e lucro, Peso e medidas, Códigos e câmera", async () => {
      await montar();
      const secoes = [
        "Variações",
        "Custo e lucro",
        "Peso e medidas",
        "Códigos e câmera",
      ].map((t) => q(`section[aria-label="${t}"]`) as HTMLElement);
      for (const s of secoes) expect(s, "linha ausente").not.toBeNull();
      const vemDepois = (antes: HTMLElement | undefined, atual: HTMLElement) =>
        ((antes?.compareDocumentPosition(atual) ?? 0) &
          Node.DOCUMENT_POSITION_FOLLOWING) !==
        0;
      secoes.slice(1).forEach((atual, k) => {
        expect(vemDepois(secoes.slice(0, -1).at(k), atual)).toBe(true);
      });
      const maisDetalhes = [...document.querySelectorAll("h2")].find(
        (h) => h.textContent?.trim() === "Mais detalhes",
      ) as HTMLElement;
      expect(
        maisDetalhes.compareDocumentPosition(secoes[0]) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).not.toBe(0);
    });

    it("as linhas recolhíveis seguem fechadas, montadas, e com a seta que gira (abrem no lugar)", async () => {
      await montar();
      for (const t of [
        "Variações",
        "Custo e lucro",
        "Peso e medidas",
        "Códigos e câmera",
      ]) {
        const botao = q(`section[aria-label="${t}"] > button`) as HTMLElement;
        expect(botao.getAttribute("aria-expanded")).toBe("false");
        expect(botao.querySelector("svg")).not.toBeNull();
        expect(
          document.getElementById(botao.getAttribute("aria-controls") ?? "")
            ?.hidden,
        ).toBe(true);
      }
    });

    it("a promoção que já existia segue com o mesmo campo e o mesmo comportamento", async () => {
      await montar();
      expect(q("#product-original-price")).toBeNull();
      const chave = q("#product-promo-active") as HTMLInputElement;
      await act(async () => {
        chave.click();
      });
      expect(q("#product-original-price")).not.toBeNull();
    });
  });

  describe("2. cartão de fotos compacto (estado vazio)", () => {
    it("capa com + e 'Capa', frase curta e os dois botões de sempre", async () => {
      await montar();
      const cartao = q('[aria-label="Fotos do produto"]') as HTMLElement;
      const capa = cartao.querySelector(
        'label[for="product-image-upload"].produto-fotos-envio',
      ) as HTMLElement;
      expect(capa).not.toBeNull();
      expect(capa.textContent).toContain("Capa");
      expect(cartao.textContent).toContain("Até 10 · a primeira é a capa");

      const camera = cartao.querySelector(
        'label[for="product-image-capture"]',
      ) as HTMLElement;
      expect(camera.textContent).toContain("Tirar foto");
      const galeria = cartao.querySelector(
        'label.produto-fotos-galeria[for="product-image-upload"]',
      ) as HTMLElement;
      expect(galeria.textContent).toContain("Galeria");
    });

    it("os dois campos de arquivo de sempre: galeria sem `capture`, câmera com `capture`", async () => {
      await montar();
      const galeria = q("#product-image-upload") as HTMLInputElement;
      const camera = q("#product-image-capture") as HTMLInputElement;
      expect(galeria.type).toBe("file");
      expect(galeria.multiple).toBe(true);
      expect(galeria.hasAttribute("capture")).toBe(false);
      expect(camera.getAttribute("capture")).toBe("environment");
    });

    it("três quadradinhos vazios de contorno (decoração) ao lado da capa", async () => {
      await montar();
      const miniaturas = q(".produto-fotos-miniaturas") as HTMLElement;
      expect(miniaturas.getAttribute("aria-hidden")).toBe("true");
      expect(miniaturas.children).toHaveLength(3);
    });

    it("arrastar um arquivo sobre a capa avisa 'Solte' (o arraste de sempre)", async () => {
      await montar();
      const capa = q("label.produto-fotos-envio") as HTMLElement;
      await act(async () => {
        capa.dispatchEvent(
          new Event("dragover", { bubbles: true, cancelable: true }),
        );
      });
      expect(capa.textContent).toContain("Solte");
    });
  });

  describe("4. a barra de baixo: uma linha de estado e dois botões", () => {
    it("vazio: âmbar 'Faltam 5 campos · toque para ver', com a lista completa no nome acessível", async () => {
      await montar();
      const estado = q('[data-testid="motivo-do-bloqueio"]') as HTMLElement;
      expect(estado.textContent).toContain("Faltam 5 campos · toque para ver");
      const botao = estado.querySelector("button") as HTMLButtonElement;
      expect(botao).not.toBeNull();
      // A frase completa (a lista do que falta) é o nome acessível e o título.
      const completa =
        "Para publicar, falta preencher: nome, descrição, categoria, preço de venda, estoque.";
      expect(botao.getAttribute("title")).toBe(completa);
      expect(botao.querySelector(".sr-only")?.textContent).toBe(completa);
      expect(
        (botao.querySelector('[aria-hidden="true"]') as HTMLElement)
          .textContent,
      ).toBe("Faltam 5 campos · toque para ver");
      // E é UMA linha: tudo que a frase comprida tem fica fora da vista (só para
      // leitor de tela); o que se vê é só a frase curta.
      const aVista = [...estado.querySelectorAll("*")].filter(
        (el) => el.children.length === 0 && !el.closest(".sr-only"),
      );
      expect(
        aVista.map((el) => el.textContent?.trim()).filter(Boolean),
      ).toEqual(["Faltam 5 campos · toque para ver"]);
    });

    it("a mesma ação de sempre: tocar na frase leva ao primeiro campo que falta", async () => {
      await montar();
      const botao = q(
        '[data-testid="motivo-do-bloqueio"] button',
      ) as HTMLButtonElement;
      await act(async () => {
        botao.click();
        await esperar(30);
      });
      expect(document.activeElement?.id).toBe("product-name");
    });

    it("Publicar continua bloqueado enquanto falta campo, e tocar no invólucro leva ao campo", async () => {
      await montar();
      const publicar = botaoDaBarra("Publicar") as HTMLButtonElement;
      expect(publicar.disabled).toBe(true);
      await act(async () => {
        (publicar.parentElement as HTMLElement).click();
        await esperar(30);
      });
      expect(document.activeElement?.id).toBe("product-name");
      expect(addProduct).not.toHaveBeenCalled();
      expect((publicar.parentElement as HTMLElement).getAttribute("role")).toBe(
        "presentation",
      );
    });

    it("conta de campos que faltam acompanha o que se digita", async () => {
      await montar();
      await digitarCampo("product-name", "Camiseta");
      expect(texto('[data-testid="motivo-do-bloqueio"]')).toContain(
        "Faltam 4 campos",
      );
    });

    it("tudo pronto: verde 'Tudo pronto para publicar', Publicar liberado, sem frase de bloqueio", async () => {
      await montar();
      await preencherOBasico();
      expect(q('[data-testid="motivo-do-bloqueio"]')).toBeNull();
      expect(barra().textContent).toContain("Tudo pronto para publicar");
      expect((botaoDaBarra("Publicar") as HTMLButtonElement).disabled).toBe(
        false,
      );
    });

    it("na edição: 'Alterações prontas para salvar' e 'Salvar alterações' (nunca 'Publicar')", async () => {
      await montar("prod-1");
      expect(barra().textContent).toContain("Alterações prontas para salvar");
      const salvar = botaoDaBarra("Salvar alterações") as HTMLButtonElement;
      expect(salvar).toBeDefined();
      expect(salvar.disabled).toBe(false);
      expect(botaoDaBarra("Publicar")).toBeUndefined();
    });

    it("na edição com campo apagado: 'Falta 1 campo' e o botão bloqueia", async () => {
      await montar("prod-1");
      await digitarCampo("product-name", "");
      expect(texto('[data-testid="motivo-do-bloqueio"]')).toContain(
        "Falta 1 campo · toque para ver",
      );
      expect(
        (botaoDaBarra("Salvar alterações") as HTMLButtonElement).disabled,
      ).toBe(true);
    });

    it("o secundário agora é 'Ver app' e abre a prévia de sempre", async () => {
      await montar();
      expect(barra().textContent).not.toContain("Ver no app");
      const ver = botaoDaBarra("Ver app") as HTMLButtonElement;
      expect(ver).toBeDefined();
      await act(async () => {
        ver.click();
        await esperar(30);
      });
      // A prévia abre por cima: o botão de fechar dela existe.
      expect(q('[aria-label="Fechar o simulador"]')).not.toBeNull();
    });

    it("botões de 44 px (min-h-11), Publicar pílula e a barra sem faixa fixa própria", async () => {
      await montar();
      const publicar = botaoDaBarra("Publicar") as HTMLButtonElement;
      expect(publicar.className).toContain("min-h-11");
      expect(publicar.className).toContain("rounded-full");
      const ver = botaoDaBarra("Ver app") as HTMLButtonElement;
      expect(ver.className).toContain("min-h-11");
      expect(barra().querySelector(".fixed")).toBeNull();
      expect(barra().outerHTML).not.toMatch(
        /bg-gradient|admin-barra-principal/,
      );
    });
  });
});
