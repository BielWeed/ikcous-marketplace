// @vitest-environment jsdom
//
// Formulário de produto — o que faltava para chegar no desenho aprovado:
//
//   1. aviso de erro de uma seção FECHADA nunca aparece cortado com reticências;
//   2. o topo encolhe ao rolar (título + anel; o progressbar continua existindo)
//      sem mudar a altura da linha que cola no alto (nada pula);
//   3. com fotos: a foto em foco grande, a faixa de miniaturas de 50 px e, no
//      lado, as ações DA foto em foco (cortar, tornar principal, excluir).
//
// O jsdom não faz layout: o que depende de medida (corte, rolagem, 320 px) é
// provado em navegador real e está no relatório. Aqui se prova o que é texto,
// estado, ordem e foco.
/* eslint-disable security/detect-non-literal-fs-filename, security/detect-unsafe-regex --
   lê arquivos-fonte de caminho fixo do repositório; as regex são constantes (sem entrada
   de usuário) e só recortam blocos do CSS */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ContextoDaBarra } from "@/components/layouts/AcaoDaBarra";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fetchProduct = vi.fn();
const rpcDoSupabase = vi.fn();

vi.mock("@/hooks/useProducts", () => ({
  useProducts: () => ({
    addProduct: vi.fn(),
    updateProduct: vi.fn(),
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

vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: { shippingCoverage: "national" } }),
}));

vi.mock("@/lib/supabase", () => ({ supabase: { rpc: rpcDoSupabase } }));

vi.mock("sonner", () => ({
  toast: {
    info: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
    loading: vi.fn(),
    warning: vi.fn(),
    dismiss: vi.fn(),
  },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const RAIZ = join(__dirname, "..", "..");
const CSS = readFileSync(
  join(RAIZ, "src/components/admin/products/formulario-produto.css"),
  "utf8",
);

const url = (n: number) => `https://cdn/${n}.jpg`;

const produtoDoBanco = (fotos: number) => ({
  id: "prod-1",
  name: "Camiseta",
  description: "Camiseta de algodão",
  price: 50,
  costPrice: null,
  originalPrice: null,
  stock: 3,
  category: "Geral",
  images: Array.from({ length: fotos }, (_, i) => url(i + 1)),
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
});

const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));
const q = (seletor: string) => document.querySelector(seletor);
const qa = <T extends Element = HTMLElement>(seletor: string) => [
  ...document.querySelectorAll<T>(seletor),
];

describe("AdminProductFormView — o que faltava para chegar no desenho", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let prateleira: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
    fetchProduct.mockResolvedValue(produtoDoBanco(0));
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
    // Dublê de leitura de imagem: o jsdom não decodifica foto de verdade.
    vi.stubGlobal(
      "Image",
      class {
        onload: (() => void) | null = null;
        onerror: (() => void) | null = null;
        width = 800;
        height = 1000;
        naturalWidth = 800;
        naturalHeight = 1000;
        crossOrigin = "";
        set src(_v: string) {
          queueMicrotask(() => this.onload?.());
        }
      },
    );
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

  async function montar(fotos = 0, productId = "prod-1") {
    fetchProduct.mockResolvedValue(produtoDoBanco(fotos));
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
    await act(async () => {
      await esperar(0);
      await esperar(0);
      await esperar(0);
    });
  }

  // ---------------------------------------------------------------------------
  describe("1. aviso de erro de seção fechada nunca é cortado", () => {
    it("o aviso quebra de linha: sem reticências, sem corte, sem linha única", () => {
      const bloco = CSS.match(
        /\.produto-secao-aviso\s*>\s*section\s*>\s*button\s*>\s*span\s*\{[^}]*\}/,
      )?.[0];
      expect(bloco, "regra do aviso ausente").toBeDefined();
      expect(bloco).toMatch(/white-space:\s*normal/);
      expect(bloco).toMatch(/overflow:\s*visible/);
      expect(bloco).toMatch(/text-overflow:\s*clip/);
    });

    it("o resumo comum (sem aviso) segue em uma linha com reticências", () => {
      const bloco = CSS.match(
        /\.produto-secao\s*>\s*section\s*>\s*button\s*>\s*span\s*\{[^}]*\}/,
      )?.[0];
      expect(bloco).toMatch(/white-space:\s*nowrap/);
      expect(bloco).toMatch(/text-overflow:\s*ellipsis/);
    });

    it("'Códigos e câmera' fechada com erro de código mostra a frase INTEIRA do erro, em vermelho", async () => {
      await montar(0);
      // O erro de código interno só aparece ao salvar; o caminho curto para o
      // MESMO aviso de seção é o erro do aviso de estoque (número inválido).
      const campo = document.getElementById(
        "product-estoque-minimo",
      ) as HTMLInputElement;
      expect(campo).not.toBeNull();
      await act(async () => {
        Object.getOwnPropertyDescriptor(
          globalThis.HTMLInputElement.prototype,
          "value",
        )?.set?.call(campo, "2.5");
        campo.dispatchEvent(new Event("input", { bubbles: true }));
        await esperar(300);
      });
      const secao = q('section[aria-label="Códigos e câmera"]') as HTMLElement;
      const botao = secao.querySelector(":scope > button") as HTMLButtonElement;
      // Fecha a seção (ela se abriu sozinha por causa do erro).
      if (botao.getAttribute("aria-expanded") === "true") {
        await act(async () => {
          botao.click();
        });
      }
      expect(botao.getAttribute("aria-expanded")).toBe("false");
      expect(
        botao
          .closest(".produto-secao")
          ?.classList.contains("produto-secao-aviso"),
      ).toBe(true);
      expect(botao.textContent).toContain(
        "Use um número inteiro: 0, 1, 2… (sem vírgula nem sinal de menos).",
      );
    });
  });

  // ---------------------------------------------------------------------------
  describe("2. o topo encolhe ao rolar", () => {
    /** Quanto o conteúdo já passou do ponto em que o topo cola (px). */
    let rolado = 0;

    beforeEach(() => {
      rolado = 0;
      vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(
        function (this: Element) {
          const topo = this.matches("header.produto-topo")
            ? rolado
            : 0; /* o ponto de partida (sentinela) fica em 0 */
          return {
            x: 0,
            y: topo,
            top: topo,
            bottom: topo,
            left: 0,
            right: 0,
            width: 0,
            height: 0,
            toJSON: () => ({}),
          } as DOMRect;
        },
      );
    });

    async function rolarPara(px: number) {
      rolado = px;
      await act(async () => {
        document.dispatchEvent(new Event("scroll"));
        await esperar(40);
      });
    }

    const topo = () => q("header.produto-topo") as HTMLElement;

    it("nasce expandido e o topo existe com título, anel, ajuda e a barra de progresso", async () => {
      await montar(0, "");
      expect(topo()).not.toBeNull();
      expect(topo().dataset.compacto).toBe("false");
      expect(topo().querySelector("h1")?.textContent).toMatch(/novo/i);
      expect(topo().querySelector('[data-testid="anel-do-produto"]')).not.toBe(
        null,
      );
      expect(
        topo().querySelector('button[aria-label="Como cadastrar um produto"]'),
      ).not.toBeNull();
      expect(q('[role="progressbar"]')).not.toBeNull();
    });

    it("rolou além de 24 px: fica compacto; voltou ao alto: expande de novo", async () => {
      await montar(0, "");
      await rolarPara(60);
      expect(topo().dataset.compacto).toBe("true");
      await rolarPara(0);
      expect(topo().dataset.compacto).toBe("false");
    });

    it("não pisca na fronteira: entra acima de 24 px e só sai abaixo de 8 px", async () => {
      await montar(0, "");
      await rolarPara(30);
      expect(topo().dataset.compacto).toBe("true");
      await rolarPara(15);
      expect(topo().dataset.compacto).toBe("true");
      await rolarPara(5);
      expect(topo().dataset.compacto).toBe("false");
      await rolarPara(15);
      expect(topo().dataset.compacto).toBe("false");
    });

    it("compacto, o progresso continua acessível (progressbar e o anel com a conta)", async () => {
      await montar(0, "");
      await rolarPara(80);
      const barra = q('[role="progressbar"]') as HTMLElement;
      expect(barra).not.toBeNull();
      expect(barra.getAttribute("aria-valuemax")).toBe("5");
      expect(barra.getAttribute("aria-valuetext")).toMatch(
        /\d de 5 essenciais prontos/,
      );
      expect(
        (q('[data-testid="anel-do-produto"]') as HTMLElement).textContent,
      ).toMatch(/^\d\/5$/);
    });

    it("o ouvinte de rolagem é passivo e sai junto com a tela (nada vaza)", async () => {
      const adicionar = vi.spyOn(document, "addEventListener");
      const remover = vi.spyOn(document, "removeEventListener");
      await montar(0, "");
      const chamada = adicionar.mock.calls.find(([tipo]) => tipo === "scroll");
      expect(chamada, "ouvinte de scroll ausente").toBeDefined();
      expect(chamada?.[2]).toMatchObject({ passive: true });
      act(() => {
        raiz.unmount();
      });
      expect(remover.mock.calls.some(([tipo]) => tipo === "scroll")).toBe(true);
      raiz = createRoot(hospedeiro);
    });

    it("a altura da linha do topo não depende do estado (nada pula): só estilo muda", () => {
      // Estático: a regra do estado compacto não mexe em altura nem em margem
      // do topo — só em tamanho de letra, escala do anel e cor da borda.
      const compacto = CSS.match(
        /\.produto-topo\[data-compacto="true"\][^{]*\{[^}]*\}/g,
      );
      expect(compacto, "regras do estado compacto ausentes").not.toBeNull();
      for (const regra of compacto ?? []) {
        expect(regra).not.toMatch(
          /(^|[;{\s])(height|min-height|padding|margin)[a-z-]*:/,
        );
      }
      expect(CSS).toMatch(/\.produto-topo-linha\s*\{[^}]*min-height:\s*64px/);
    });

    it("respeita prefers-reduced-motion: sem transição no topo", () => {
      const bloco = CSS.match(
        /@media \(prefers-reduced-motion: reduce\)\s*\{[^@]*\.produto-topo[^@]*\}/,
      )?.[0];
      expect(bloco, "reduced-motion do topo ausente").toBeDefined();
      expect(bloco).toMatch(/transition:\s*none/);
    });
  });

  // ---------------------------------------------------------------------------
  describe("3. com fotos: foto em foco grande, faixa de miniaturas, ações da foto", () => {
    const faixa = () =>
      q('[aria-label="Galeria de fotos do produto"]') as HTMLElement;
    const miniaturas = () => [
      ...faixa().querySelectorAll<HTMLButtonElement>("button[aria-pressed]"),
    ];
    const emFoco = () =>
      q('[data-testid="foto-em-foco"]') as HTMLElement | null;
    const imgDoFoco = () =>
      emFoco()?.querySelector("img")?.getAttribute("src") ?? null;
    const tornarPrincipal = () =>
      qa<HTMLButtonElement>('button[aria-label^="Tornar principal"]');
    const tocar = async (n: number) => {
      await act(async () => {
        miniaturas()[n - 1].click();
      });
    };

    it("a faixa tem uma miniatura por foto, na ordem; a primeira em foco e marcada", async () => {
      await montar(3);
      expect(
        [...faixa().querySelectorAll("img")].map((i) => i.getAttribute("src")),
      ).toEqual([url(1), url(2), url(3)]);
      expect(miniaturas()).toHaveLength(3);
      expect(miniaturas().map((b) => b.getAttribute("aria-pressed"))).toEqual([
        "true",
        "false",
        "false",
      ]);
      expect(miniaturas().map((b) => b.getAttribute("aria-label"))).toEqual([
        "Ver foto 1 de 3 (principal)",
        "Ver foto 2 de 3",
        "Ver foto 3 de 3",
      ]);
      // A foto grande NÃO está dentro da faixa (a ordem da faixa não duplica).
      expect(faixa().contains(emFoco())).toBe(false);
      expect(imgDoFoco()).toBe(url(1));
    });

    it("a foto 1 é a principal: diz 'Principal' e não oferece 'Tornar principal'", async () => {
      await montar(3);
      const selo = [...document.querySelectorAll("div")].filter(
        (d) => d.children.length === 0 && d.textContent === "Principal",
      );
      expect(selo).toHaveLength(1);
      expect(selo[0].closest("[data-foto-principal]")).not.toBeNull();
      expect(tornarPrincipal()).toHaveLength(0);
      expect(emFoco()?.querySelector('button[title="Excluir"]')).not.toBeNull();
      expect(
        emFoco()?.querySelector('button[title="Ajustar e Cortar"]'),
      ).not.toBeNull();
    });

    it("tocar na miniatura 3 põe a foto 3 em foco, com o botão certo e o aviso de qualidade", async () => {
      await montar(3);
      await tocar(3);
      expect(imgDoFoco()).toBe(url(3));
      expect(miniaturas().map((b) => b.getAttribute("aria-pressed"))).toEqual([
        "false",
        "false",
        "true",
      ]);
      expect(
        tornarPrincipal().map((b) => b.getAttribute("aria-label")),
      ).toEqual(["Tornar principal: foto 3 de 3"]);
      expect(tornarPrincipal()[0].className).toMatch(/min-h-11/);
      expect(emFoco()?.textContent).toContain("Foto 3");
      expect(emFoco()?.textContent).toContain("Boa qualidade.");
      expect(emFoco()?.textContent).toContain("800 × 1000 px");
      expect(
        document.querySelectorAll("[data-foto-principal]").length,
      ).toBeLessThanOrEqual(0);
    });

    it("cada foto que não é a primeira oferece 'Tornar principal: foto N de M' ao entrar em foco", async () => {
      await montar(4);
      const rotulos: string[][] = [];
      for (const n of [1, 2, 3, 4]) {
        await tocar(n);
        rotulos.push(
          tornarPrincipal().map((b) => b.getAttribute("aria-label") ?? ""),
        );
      }
      expect(rotulos).toEqual([
        [],
        ["Tornar principal: foto 2 de 4"],
        ["Tornar principal: foto 3 de 4"],
        ["Tornar principal: foto 4 de 4"],
      ]);
    });

    it("tornar a foto 3 a principal: ela vai ao começo, o foco do teclado fica dentro da foto grande e ela continua em foco", async () => {
      await montar(3);
      await tocar(3);
      await act(async () => {
        tornarPrincipal()[0].click();
      });
      expect(
        [...faixa().querySelectorAll("img")].map((i) => i.getAttribute("src")),
      ).toEqual([url(3), url(1), url(2)]);
      expect(imgDoFoco()).toBe(url(3));
      expect(miniaturas().map((b) => b.getAttribute("aria-pressed"))).toEqual([
        "true",
        "false",
        "false",
      ]);
      expect(tornarPrincipal()).toHaveLength(0);
      const ativo = document.activeElement as HTMLElement;
      expect(ativo).not.toBe(document.body);
      expect(emFoco()?.contains(ativo)).toBe(true);
    });

    it("excluir a foto em foco (a última): o foco anda para a anterior, nada quebra", async () => {
      await montar(3);
      await tocar(3);
      await act(async () => {
        (
          emFoco()?.querySelector(
            'button[title="Excluir"]',
          ) as HTMLButtonElement
        ).click();
        await esperar(900);
      });
      expect(miniaturas()).toHaveLength(2);
      expect(imgDoFoco()).toBe(url(2));
      expect(miniaturas().at(-1)?.getAttribute("aria-pressed")).toBe("true");
    });

    it("excluir TODAS volta ao cartão vazio com a capa e os dois botões", async () => {
      await montar(1);
      await act(async () => {
        (
          emFoco()?.querySelector(
            'button[title="Excluir"]',
          ) as HTMLButtonElement
        ).click();
        await esperar(900);
      });
      expect(q('[aria-label="Galeria de fotos do produto"]')).toBeNull();
      expect(q("label.produto-fotos-envio")).not.toBeNull();
    });

    it("com o limite de 10 fotos: 10 miniaturas, contagem '10 de 10' e a faixa rola (não quebra a linha)", async () => {
      await montar(10);
      expect(miniaturas()).toHaveLength(10);
      expect(document.body.textContent).toContain("10 de 10");
      expect(CSS).toMatch(/\.produto-fotos-faixa\s*\{[^}]*overflow-x:\s*auto/);
    });

    it("a miniatura é um alvo de toque de 50 px (≥ 44) e a faixa é 'relative' (nada de sr-only escapando)", () => {
      expect(CSS).toMatch(
        /\.produto-fotos-faixa\s*>\s*button\s*\{[^}]*width:\s*50px[^}]*height:\s*50px/,
      );
      expect(CSS).toMatch(
        /\.produto-fotos-faixa\s*\{[^}]*position:\s*relative/,
      );
    });

    it("as ações da foto ficam na ordem Ajustar e Cortar, Excluir, Tornar principal (Excluir não se mexe quando a foto vira capa)", async () => {
      await montar(3);
      await tocar(2);
      const acoes = qa<HTMLButtonElement>(
        '[data-testid="foto-em-foco"] button',
      ).map((b) => b.getAttribute("title") ?? b.getAttribute("aria-label"));
      expect(acoes).toEqual([
        "Ajustar e Cortar",
        "Excluir",
        "Tornar principal: foto 2 de 3",
      ]);
    });

    it("a foto em foco tem alvo de 44 px nos botões e letra mínima de 11 px", async () => {
      await montar(2);
      await tocar(2);
      for (const botao of qa<HTMLButtonElement>(
        '[data-testid="foto-em-foco"] button',
      )) {
        expect(botao.className).toMatch(/min-h-11/);
        expect(botao.className).not.toMatch(
          /text-\[(?:[6-9]|10)(?:\.\d+)?px\]/,
        );
      }
    });
  });

  // ---------------------------------------------------------------------------
  describe("4. textos de campo que cabem a 320 px (medido em navegador real)", () => {
    it("o exemplo do nome é o do desenho e cabe na caixa (era cortado no meio de 'Tamanho M')", async () => {
      await montar(0, "");
      const nome = document.getElementById("product-name") as HTMLInputElement;
      expect(nome.placeholder).toBe("Ex: Camiseta básica preta");
    });

    it("'Ver app': o título do simulador tem versão curta no celular (a longa era cortada em 'Simulador do…')", async () => {
      await montar(0, "");
      const verApp = [...document.querySelectorAll("button")].find(
        (b) => b.textContent?.trim() === "Ver app",
      ) as HTMLButtonElement;
      await act(async () => {
        verApp.click();
        await esperar(50);
      });
      const titulo = document.querySelector("h3") as HTMLElement;
      expect(titulo.textContent).toContain("Simulador do Aplicativo");
      const curto = titulo.querySelector(
        '[data-testid="titulo-curto-do-simulador"]',
      ) as HTMLElement;
      const longo = titulo.querySelector(
        '[data-testid="titulo-longo-do-simulador"]',
      ) as HTMLElement;
      expect(curto?.textContent).toBe("Simulador");
      expect(curto?.className).not.toMatch(/(^|\s)hidden(\s|$)/);
      expect(longo?.textContent).toBe("Simulador do Aplicativo");
      expect(longo?.className).toMatch(/(^|\s)hidden(\s|$)/);
    });

    it("campo de rótulo flutuante: o fundo transparente VENCE o fundo 'elevado' (sem caixa cinza dentro do cartão)", () => {
      // O seletor geral (`:is(.produto-formulario, …) :is(input:not(…):not(…),
      // …)`) tem especificidade 0,3,1; a regra do campo tem de ser ao menos
      // tão forte, senão o cinza do tema claro aparecia como uma caixa dentro
      // do cartão branco (e, no escuro, um degrau mais claro).
      const regra = CSS.match(
        /\.produto-formulario\s*\.produto-campo\s*:is\(\s*input:not\(\[type="checkbox"\]\):not\(\[type="file"\]\)[^{]*\{[^}]*\}/,
      )?.[0];
      expect(regra, "regra do campo com a especificidade certa").toBeDefined();
      expect(regra).toMatch(/background:\s*transparent/);
      // E nada que mexa em padding/altura: as folgas do preço, do estoque e do
      // custo (rótulo flutuante, "R$", ícone) são de regras MENOS específicas.
      expect(regra).not.toMatch(/(padding|min-height)/);
    });

    it("modal da variação: Quantidade e Preço em UMA coluna abaixo de 380 px (em duas, o número ficava com 16 px de largura)", () => {
      const fonte = readFileSync(
        join(RAIZ, "src/views/admin/AdminProductFormView.tsx"),
        "utf8",
      );
      const ancora = fonte.indexOf('htmlFor="variant-stock"');
      expect(ancora).toBeGreaterThan(-1);
      const grade = fonte.lastIndexOf('<div className="grid', ancora);
      const tag = fonte.slice(grade, fonte.indexOf(">", grade) + 1);
      expect(tag).toContain("grid-cols-1");
      expect(tag).toContain("min-[380px]:grid-cols-2");
    });
  });
});
