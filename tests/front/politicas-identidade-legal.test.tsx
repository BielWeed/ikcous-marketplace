// @vitest-environment jsdom
//
// A cliente lê QUEM é a loja (razão social, CNPJ ou CPF) e por onde falar
// (e-mail de atendimento) — mas só quando a lojista preencheu. O que se mede é
// o que a cliente enxerga: a linha "Responsável: …" na primeira seção dos Termos
// e da Privacidade (página e folha), o e-mail no bloco de contato das três
// políticas, e o rodapé da vitrine. A promessa do dono: loja que não preencheu
// NADA não muda nada para ninguém.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { montarPolitica, textoCorrido } from "@/lib/textos-das-politicas";

const { configAtual } = vi.hoisted(() => ({
  configAtual: { valor: {} as Record<string, unknown> },
}));

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: configAtual.valor }),
}));
vi.mock("@/hooks/useDocumentMeta", () => ({ useDocumentMeta: () => ({}) }));
vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => {
      const cadeia = {
        select: () => cadeia,
        eq: () => cadeia,
        maybeSingle: () => Promise.resolve({ data: null, error: null }),
      };
      return cadeia;
    },
  },
}));
vi.mock("@/hooks/useBanners", () => ({
  useBanners: () => ({
    banners: [],
    loading: false,
    getBannersByPosition: () => [],
  }),
}));
vi.mock("@/hooks/useCategories", () => ({
  useCategories: () => ({ categories: [], addCategory: vi.fn() }),
}));
vi.mock("@/components/ui/custom/BannerCarousel", () => ({
  BannerCarousel: () => null,
}));
vi.mock("@/components/ui/custom/CategoryFilter", () => ({
  CategoryFilter: () => null,
}));
vi.mock("@/components/ui/custom/FreeShippingBlock", () => ({
  FreeShippingBlock: () => null,
}));
vi.mock("@/components/ui/custom/InfoBlockCarousel", () => ({
  InfoBlockCarousel: () => null,
}));
vi.mock("@/components/ui/custom/PremiumOffers", () => ({
  PremiumOffers: () => null,
}));
vi.mock("@/components/ui/custom/ProductCarousel", () => ({
  ProductCarousel: () => null,
}));
vi.mock("@/components/ui/custom/ProductList", () => ({
  ProductList: () => <div data-testid="product-list" />,
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const LINHA = "Responsável: Loja da Ana Ltda — CNPJ 11.222.333/0001-81";
const LINHA_COM_EMAIL = `${LINHA} — contato: oi@loja.com`;
const COM_IDENTIDADE = {
  storeName: "Loja da Ana",
  storeLegalName: "Loja da Ana Ltda",
  storeLegalDocument: "11222333000181",
  storeSupportEmail: "oi@loja.com",
};

function esperar(): Promise<void> {
  return new Promise((r) => setTimeout(r, 0));
}

describe("identidade legal nas políticas", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    configAtual.valor = { storeName: "Loja da Ana" };
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
  });

  async function montarPagina(tipo: "termos" | "privacidade" | "trocas") {
    const { PoliticaDaLojaView } = await import(
      "@/views/customer/PoliticaDaLojaView"
    );
    await act(async () => {
      raiz.render(<PoliticaDaLojaView tipo={tipo} onNavigate={vi.fn()} />);
    });
    await act(async () => {
      await esperar();
    });
  }

  describe("os textos (montarPolitica)", () => {
    it("sem responsável o documento é IDÊNTICO ao de antes (nada muda para quem não preencheu)", () => {
      for (const tipo of ["termos", "privacidade", "trocas"] as const) {
        const antes = textoCorrido(montarPolitica(tipo, { nome: "L" }, null));
        expect(
          textoCorrido(
            montarPolitica(tipo, { nome: "L", responsavel: null }, null),
          ),
        ).toBe(antes);
        expect(
          textoCorrido(
            montarPolitica(tipo, { nome: "L", responsavel: "" }, null),
          ),
        ).toBe(antes);
        expect(antes).not.toContain("Responsável:");
      }
    });

    it("Termos: a linha entra NA PRIMEIRA seção (quem vende), depois do texto de sempre", () => {
      const doc = montarPolitica(
        "termos",
        { nome: "L", responsavel: LINHA_COM_EMAIL },
        null,
      );
      expect(doc.secoes[0].id).toBe("quem-somos");
      expect(doc.secoes[0].paragrafos.at(-1)).toBe(LINHA_COM_EMAIL);
      expect(doc.secoes[0].paragrafos).toHaveLength(2);
      // e em nenhuma outra
      const resto = doc.secoes
        .slice(1)
        .flatMap((s) => s.paragrafos)
        .join("\n");
      expect(resto).not.toContain("Responsável:");
    });

    it("Privacidade: a linha entra na seção de quem cuida dos dados (a controladora)", () => {
      const doc = montarPolitica(
        "privacidade",
        { nome: "L", responsavel: LINHA },
        null,
      );
      expect(doc.secoes[0].id).toBe("quem-cuida");
      expect(doc.secoes[0].paragrafos.at(-1)).toBe(LINHA);
    });

    it("Trocas: não ganha a linha (não há seção de 'quem é a loja'; o contato mostra o e-mail)", () => {
      const doc = montarPolitica(
        "trocas",
        { nome: "L", responsavel: LINHA },
        null,
      );
      expect(textoCorrido(doc)).not.toContain("Responsável:");
    });
  });

  describe("a página", () => {
    it("Termos com tudo preenchido: a linha completa, dentro da seção 'Quem vende'", async () => {
      configAtual.valor = COM_IDENTIDADE;
      await montarPagina("termos");
      const secao = hospedeiro.querySelector(
        'section[aria-labelledby="politica-quem-somos"]',
      );
      expect(secao?.textContent).toContain(LINHA_COM_EMAIL);
      // a linha existe UMA vez só na página
      expect(
        (hospedeiro.textContent ?? "").split("Responsável:").length - 1,
      ).toBe(1);
    });

    it("Privacidade com tudo preenchido: a linha na seção de quem cuida dos dados", async () => {
      configAtual.valor = COM_IDENTIDADE;
      await montarPagina("privacidade");
      const secao = hospedeiro.querySelector(
        'section[aria-labelledby="politica-quem-cuida"]',
      );
      expect(secao?.textContent).toContain(LINHA_COM_EMAIL);
    });

    it("só razão social e CPF: a linha junta só o que existe", async () => {
      configAtual.valor = {
        storeName: "Loja da Ana",
        storeLegalName: "Ana Souza",
        storeLegalDocument: "52998224725",
      };
      await montarPagina("termos");
      expect(hospedeiro.textContent).toContain(
        "Responsável: Ana Souza — CPF 529.982.247-25",
      );
      expect(hospedeiro.textContent).not.toContain("contato:");
    });

    it("documento gravado com dígito errado NÃO é publicado (nunca mostra um CNPJ que não existe)", async () => {
      configAtual.valor = {
        storeName: "Loja da Ana",
        storeLegalName: "Loja da Ana Ltda",
        storeLegalDocument: "11222333000182",
      };
      await montarPagina("termos");
      expect(hospedeiro.textContent).toContain("Responsável: Loja da Ana Ltda");
      expect(hospedeiro.textContent).not.toContain("CNPJ");
      expect(hospedeiro.textContent).not.toContain("11222333000182");
    });

    it.each(["termos", "privacidade", "trocas"] as const)(
      "%s: o e-mail de atendimento aparece no bloco de contato, como link de e-mail com alvo de 44px",
      async (tipo) => {
        configAtual.valor = COM_IDENTIDADE;
        await montarPagina(tipo);
        const bloco = hospedeiro.querySelector(
          'section[aria-labelledby="politica-contato-da-loja"]',
        ) as HTMLElement;
        const link = bloco.querySelector(
          'a[href="mailto:oi@loja.com"]',
        ) as HTMLAnchorElement;
        expect(link, "link mailto").not.toBeNull();
        expect(link.textContent).toContain("oi@loja.com");
        expect(link.className).toContain("min-h-11");
        expect(link.className).toMatch(/underline/);
        // com e-mail, o aviso de "ainda não cadastrou contato" não aparece
        expect(bloco.textContent).not.toContain("ainda não cadastrou");
      },
    );

    it("o e-mail sozinho já é um contato (não aparece o aviso de 'sem contato')", async () => {
      configAtual.valor = {
        storeName: "Loja da Ana",
        storeSupportEmail: "oi@loja.com",
      };
      await montarPagina("termos");
      expect(hospedeiro.textContent).not.toContain("ainda não cadastrou");
      expect(hospedeiro.textContent).not.toContain("Responsável:");
    });

    it("loja que não preencheu NADA: nenhuma linha, nenhum e-mail, o aviso de contato de sempre", async () => {
      configAtual.valor = { storeName: "Loja da Ana" };
      await montarPagina("termos");
      expect(hospedeiro.textContent).not.toContain("Responsável:");
      expect(hospedeiro.textContent).not.toContain("CNPJ");
      expect(hospedeiro.querySelector('a[href^="mailto:"]')).toBeNull();
      expect(hospedeiro.textContent).toContain(
        "ainda não cadastrou um contato",
      );
    });

    it("e-mail gravado sem forma de e-mail não vira link", async () => {
      configAtual.valor = { storeName: "L", storeSupportEmail: "lixo" };
      await montarPagina("privacidade");
      expect(hospedeiro.querySelector('a[href^="mailto:"]')).toBeNull();
    });
  });

  describe("a folha (checkout, produto, cadastro)", () => {
    it("a folha dos Termos mostra a mesma linha — a fonte é uma só", async () => {
      configAtual.valor = COM_IDENTIDADE;
      const { PoliticaEmFolha } = await import(
        "@/components/politicas/PoliticaEmFolha"
      );
      await act(async () => {
        raiz.render(<PoliticaEmFolha tipo="termos" onFechar={vi.fn()} />);
      });
      await act(async () => {
        await esperar();
      });
      const folha = document.querySelector('[data-testid="folha-politica"]');
      expect(folha?.textContent).toContain(LINHA_COM_EMAIL);
    });
  });

  describe("o rodapé da vitrine", () => {
    async function montarRodape(identidade: unknown) {
      const { RodapeDasPoliticas } = await import(
        "@/components/politicas/RodapeDasPoliticas"
      );
      await act(async () => {
        raiz.render(
          <RodapeDasPoliticas
            onNavigate={vi.fn()}
            identidade={identidade as never}
          />,
        );
      });
    }

    it("sem identidade: o rodapé é só os três links, como sempre", async () => {
      await montarRodape(undefined);
      const nav = hospedeiro.querySelector(
        '[data-testid="rodape-das-politicas"]',
      ) as HTMLElement;
      expect(nav.querySelectorAll("button")).toHaveLength(3);
      expect(nav.querySelector('[data-testid="rodape-identidade-legal"]')).toBe(
        null,
      );
      expect(hospedeiro.querySelector("a")).toBeNull();
      await montarRodape(null);
      expect(
        hospedeiro.querySelector('[data-testid="rodape-identidade-legal"]'),
      ).toBeNull();
    });

    it("com identidade: razão social e CNPJ numa linha curta e o e-mail como link; os links de política seguem iguais", async () => {
      await montarRodape({
        razaoSocial: "Loja da Ana Ltda",
        tipoDoDocumento: "cnpj",
        documento: "11.222.333/0001-81",
        email: "oi@loja.com",
      });
      const bloco = hospedeiro.querySelector(
        '[data-testid="rodape-identidade-legal"]',
      ) as HTMLElement;
      expect(bloco.textContent).toContain("Loja da Ana Ltda");
      expect(bloco.textContent).toContain("CNPJ 11.222.333/0001-81");
      const link = bloco.querySelector(
        'a[href="mailto:oi@loja.com"]',
      ) as HTMLAnchorElement;
      expect(link.className).toContain("min-h-11");
      // o rodapé continua leve: nenhum texto jurídico (nada de "Responsável:")
      expect(bloco.textContent).not.toContain("Responsável:");
      expect(
        hospedeiro.querySelectorAll(
          '[data-testid="rodape-das-politicas"] button',
        ),
      ).toHaveLength(3);
    });

    it("só e-mail: mostra só o e-mail; só razão social: mostra só ela", async () => {
      await montarRodape({
        razaoSocial: null,
        tipoDoDocumento: null,
        documento: null,
        email: "oi@loja.com",
      });
      let bloco = hospedeiro.querySelector(
        '[data-testid="rodape-identidade-legal"]',
      ) as HTMLElement;
      expect(bloco.textContent).toContain("oi@loja.com");
      await montarRodape({
        razaoSocial: "Ana Souza",
        tipoDoDocumento: null,
        documento: null,
        email: null,
      });
      bloco = hospedeiro.querySelector(
        '[data-testid="rodape-identidade-legal"]',
      ) as HTMLElement;
      expect(bloco.textContent).toBe("Ana Souza");
      expect(bloco.querySelector("a")).toBeNull();
    });

    it("usa as cores do tema (vale no claro e no escuro), nunca cor fixa", async () => {
      await montarRodape({
        razaoSocial: "Loja da Ana Ltda",
        tipoDoDocumento: "cnpj",
        documento: "11.222.333/0001-81",
        email: "oi@loja.com",
      });
      const bloco = hospedeiro.querySelector(
        '[data-testid="rodape-identidade-legal"]',
      ) as HTMLElement;
      expect(bloco.outerHTML).toContain("text-muted-foreground");
      expect(bloco.outerHTML).not.toMatch(/\b(text|bg)-(zinc|white|black)/);
    });
  });

  describe("a Home entrega o dado do config ao rodapé", () => {
    async function montarHome() {
      const { HomeView } = await import("@/views/customer/HomeView");
      await act(async () => {
        raiz.render(
          <HomeView
            products={[]}
            favorites={[]}
            onToggleFavorite={vi.fn()}
            onProductClick={vi.fn()}
            onNavigate={vi.fn()}
            searchQuery=""
            selectedCategory="Todas"
            onCategoryChange={vi.fn()}
            sortBy="default"
            onSortByChange={vi.fn()}
          />,
        );
      });
      await act(async () => {
        await esperar();
      });
    }

    it("loja com dados: o rodapé da Home mostra razão social, CNPJ e e-mail", async () => {
      configAtual.valor = COM_IDENTIDADE;
      await montarHome();
      const bloco = hospedeiro.querySelector(
        '[data-testid="rodape-identidade-legal"]',
      );
      expect(bloco?.textContent).toContain("Loja da Ana Ltda");
      expect(bloco?.textContent).toContain("11.222.333/0001-81");
      expect(
        bloco?.querySelector('a[href="mailto:oi@loja.com"]'),
      ).not.toBeNull();
    });

    it("loja sem dados: a Home fica como era (nenhum bloco novo)", async () => {
      configAtual.valor = { storeName: "Loja da Ana" };
      await montarHome();
      expect(
        hospedeiro.querySelector('[data-testid="rodape-identidade-legal"]'),
      ).toBeNull();
      expect(
        hospedeiro.querySelector('[data-testid="rodape-das-politicas"]'),
      ).not.toBeNull();
    });
  });
});
