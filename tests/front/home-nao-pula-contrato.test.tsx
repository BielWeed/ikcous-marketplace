// @vitest-environment jsdom
//
// CONTRATO da frente cls-home-0409 ("A HOME PARA DE PULAR", dossiê
// 20260904-2148): o CLS ~0,78 medido na vitrine vinha de conteúdo que
// "nascia depois" — banner, seções de lançamentos/ofertas/destaques e
// categorias entravam acima do Catálogo visível e empurravam tudo para
// baixo (87% do salto num bloco só). O conserto é RESERVA DE ESPAÇO: cada
// esqueleto espelha a geometria da contraparte carregada, e a troca
// esqueleto→real não desloca nada. Este teste trava os espelhos.
//
// Por que lê FONTE e não renderiza: HomeView arrasta hooks, supabase e
// framer-motion (mesma decisão da acess-onda1/onda2-contrato, cujo padrão
// este arquivo espelha). E altura em jsdom não existe (offsetHeight = 0) —
// o que se prova aqui é a GEOMETRIA declarada: as classes de proporção e
// padding do esqueleto são as mesmas do componente carregado.
//
// Quem mudar a geometria real (ProductCarousel, PremiumOffers, banner,
// barra de categorias) sem atualizar o espelho quebra aqui — e quem
// devolver o `return null` da seção durante o load também.
//
// RESSALVA 1 do PR #431 → DESENHO DA MEMÓRIA (frente cls-ressalva1-0409,
// laudo 6ab5s4 + mesa #476): esqueleto só onde há sinal de conteúdo —
// curada com productIds e new_arrivals sempre; offers/bestsellers
// derivadas por filtro reservam quando a MEMÓRIA da última visita dizia
// que havia conteúdo, e nada reservam quando dizia que não havia. O
// banner segue o mesmo princípio (memória dizia sem banner → esqueleto
// do banner não nasce). Primeira visita = aposta de hoje (develop).
import { describe, expect, it } from "vitest";

// ── Caso comportamental (laudo edj3ka, E2): montar o HomeView DE VERDADE ──
// O teste de fonte acima é catraca contra deletar a guarda; este aqui prova
// o efeito no DOM — "sem ofertas → nenhum esqueleto de ofertas montado",
// literalmente. Mesmo padrão de produto-pausado-nao-aparece-na-vitrine.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, vi } from "vitest";

import type { Product, View } from "@/types";

// @ts-expect-error flag interna do React, sem tipo público — mesmo padrão
// de produto-pausado-nao-aparece-na-vitrine.test.tsx.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

class IntersectionObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
const matchMediaStub = (consulta: string) => ({
  matches: false,
  media: consulta,
  onchange: null,
  addEventListener: () => {},
  removeEventListener: () => {},
  addListener: () => {},
  removeListener: () => {},
  dispatchEvent: () => false,
});

let configDaLoja: Record<string, unknown> = {};
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: configDaLoja }),
}));

// Banners controláveis por caso: `bannersDaLoja.isLoaded` decide se o
// esqueleto do banner entra em cena (memória da última visita decide se
// ele NASCE).
let bannersDaLoja: { isLoaded: boolean; banners: unknown[] } = {
  isLoaded: true,
  banners: [],
};
vi.mock("@/hooks/useBanners", () => ({
  useBanners: () => ({
    getBannersByPosition: (pos: string) =>
      pos === "home_top" ? bannersDaLoja.banners : [],
    isLoaded: bannersDaLoja.isLoaded,
  }),
}));

vi.mock("@/lib/supabase", () => {
  const consulta: Record<string, unknown> = {};
  consulta.select = () => consulta;
  consulta.eq = () => consulta;
  consulta.single = () => Promise.resolve({ data: null, error: null });
  return {
    supabase: {
      from: () => consulta,
      rpc: () => Promise.resolve({ data: false, error: null }),
      auth: { getSession: () => Promise.resolve({ data: { session: null } }) },
      channel: () => ({
        on: () => ({ subscribe: () => ({}) }),
        subscribe: () => ({}),
      }),
      removeChannel: () => {},
    },
  };
});

vi.mock("@/hooks/useCategories", () => ({
  useCategories: () => ({ categories: [], isLoading: false }),
}));

vi.mock("@/components/ui/custom/CategoryFilter", () => ({
  CategoryFilter: () => null,
}));

vi.mock("@/components/ui/custom/ProductList", () => ({
  ProductList: () => null,
}));

vi.mock("@/components/ui/custom/ProductCarousel", () => ({
  ProductCarousel: () => null,
}));

const FONTES_HOME = import.meta.glob<string>("/src/views/customer/*.tsx", {
  query: "?raw",
  import: "default",
  eager: true,
});

const FONTES_COMPONENTES = import.meta.glob<string>(
  "/src/components/**/*.tsx",
  { query: "?raw", import: "default", eager: true },
);

const FONTES: Record<string, string> = {
  ...FONTES_HOME,
  ...FONTES_COMPONENTES,
};

function fonte(caminho: string): string {
  // Acesso por CONTEÚDO, não por índice: FONTES com chave em variável
  // dispara `security/detect-object-injection` e subia o teto do
  // lint-ratchet. Padrão da casa (a-fabrica-do-whatsapp-morre-na-coluna):
  // Object.entries + find.
  const par = Object.entries(FONTES).find(([chave]) => chave === caminho);
  expect(par, `falta o fonte de ${caminho}`).toBeDefined();
  return par ? par[1] : "";
}

const HOME = "/src/views/customer/HomeView.tsx";
const PRODUCT_LIST = "/src/components/ui/custom/ProductList.tsx";
const PRODUCT_CARD = "/src/components/ui/custom/ProductCard.tsx";
const PRODUCT_CARD_SKELETON =
  "/src/components/ui/custom/ProductCardSkeleton.tsx";
const CATEGORY_FILTER = "/src/components/ui/custom/CategoryFilter.tsx";
const BANNER_CAROUSEL = "/src/components/ui/custom/BannerCarousel.tsx";
const PRODUCT_CAROUSEL = "/src/components/ui/custom/ProductCarousel.tsx";
const PREMIUM_OFFERS = "/src/components/ui/custom/PremiumOffers.tsx";
const INFO_BLOCK = "/src/components/ui/custom/InfoBlockCarousel.tsx";
const FREE_SHIPPING_BLOCK = "/src/components/ui/custom/FreeShippingBlock.tsx";

describe("o glob casou os arquivos da home (nada de prova vazia)", () => {
  const esperados = [
    HOME,
    PRODUCT_LIST,
    PRODUCT_CARD,
    PRODUCT_CARD_SKELETON,
    CATEGORY_FILTER,
    BANNER_CAROUSEL,
    PRODUCT_CAROUSEL,
    PREMIUM_OFFERS,
    INFO_BLOCK,
    FREE_SHIPPING_BLOCK,
  ];
  it("os 10 fontes existem no glob", () => {
    for (const caminho of esperados) {
      expect(FONTES, `falta o fonte de ${caminho}`).toHaveProperty(caminho);
    }
  });
});

describe("banner do topo: o esqueleto tem a geometria do banner real", () => {
  it("o banner real declara aspect 2/1 (4/1 no md) com mínimo de 200px", () => {
    const real = fonte(BANNER_CAROUSEL);
    expect(real).toContain("aspect-[2/1]");
    expect(real).toContain("md:aspect-[4/1]");
    expect(real).toContain('minHeight: "200px"');
  });

  it("o esqueleto do banner na home replica as três declarações", () => {
    const home = fonte(HOME);
    expect(home).toContain("aspect-[2/1]");
    expect(home).toContain("md:aspect-[4/1]");
    // O mínimo de 200px no esqueleto é inline, igual ao real.
    expect(home).toMatch(/style=\{\{ minHeight: "200px" \}\}/);
  });
});

describe("bloco de frete: altura estável da primeira pintura ao config", () => {
  it("enquanto o config não carrega, um esqueleto de 74px segura o lugar", () => {
    const home = fonte(HOME);
    // A troca esqueleto→real é decidida por configLoaded, e o esqueleto
    // tem a altura do bloco real (p-3.5 + ícone 44px + borda = 74px).
    expect(home).toMatch(/const blocoFrete = configLoaded \?/);
    expect(home).toContain("h-[74px] w-full animate-pulse rounded-[24px]");
  });

  it("o 74px é assertado CONTRA o bloco real, não solto (laudo da ponte)", () => {
    const frete = fonte(FREE_SHIPPING_BLOCK);
    // O cálculo do esqueleto (74px) deriva destas três declarações do
    // bloco real: p-3.5 (28px) + ícone size-11 (44px) + borda (2px).
    // Se a loja mudar o bloco (p-5, ícone maior), este teste força a
    // revisão do espelho. Folga conhecida e aceita: o real vira sm:p-4
    // (78px) em telas >= 640px — 4px de recuo no desktop, fora do alvo
    // mobile medido.
    expect(frete).toMatch(/p-3\.5 shadow-md/);
    expect(frete).toContain("size-11");
  });

  it("o bloco real carregado continua vindo pelo InfoBlockCarousel", () => {
    const home = fonte(HOME);
    expect(home).toMatch(
      /<InfoBlockCarousel>\s*<FreeShippingBlock onNavigate=\{onNavigate\} \/>\s*<\/InfoBlockCarousel>/,
    );
    // O esqueleto do frete espelha o wrapper do InfoBlockCarousel real
    // (mt-2 + px-4) para a troca não mudar nem margem.
    const info = fonte(INFO_BLOCK);
    expect(info).toContain('className="relative mt-2 w-full px-4"');
    expect(home).toContain('className="relative mt-2 w-full px-4"');
  });
});

describe("seções da home: esqueleto durante o load (87% do salto)", () => {
  it("seção vazia durante o load renderiza ESQUELETO, não null", () => {
    const home = fonte(HOME);
    // O ramo antigo era `if (secProducts.length === 0) return null;` —
    // a seção nascia depois do load e empurrava o Catálogo ~0,676 de CLS.
    // (Ressalva 1: este ramo agora é alcançável só com sinal de conteúdo
    // — ver describe abaixo.)
    expect(home).toMatch(
      /if \(secProducts\.length === 0\) \{\s*\n\s*if \(!isLoading\) return null;/,
    );
    expect(home).toContain("<SecaoOfertasEsqueleto key={section.id} />");
    expect(home).toContain("<SecaoCarrosselEsqueleto key={section.id} />");
  });

  it("memória dizia sem ofertas → nenhum esqueleto de ofertas montado (laudo 6ab5s4)", () => {
    const home = fonte(HOME);
    // offers/bestsellers nascem de FILTRO sobre os produtos: o único sinal
    // antes dos dados é a MEMÓRIA da última visita (localStorage síncrono,
    // lido no primeiro render). A última visita sem ofertas = a próxima
    // também não reserva — o esqueleto de ~600px não nasce para morrer.
    // Primeira visita (sem memória) reserva: aposta de hoje (develop).
    expect(home).toMatch(
      /const secaoCurada =\s*\n\s*!!section\.productIds && section\.productIds\.length > 0;/,
    );
    expect(home).toMatch(
      /const derivadaPorFiltro =\s*\n\s*!secaoCurada &&\s*\n\s*\(section\.id === "offers" \|\| section\.id === "bestsellers"\);/,
    );
    expect(home).toMatch(
      /const ultimaVisitaTinhaConteuto =\s*\n\s*section\.id === "offers"\s*\n\s*\? memoriaDaUltimaVisita\?\.temOfertas\s*\n\s*: memoriaDaUltimaVisita\?\.temBestsellers;/,
    );
    // A guarda devolve null DEPOIS do !isLoading e ANTES de qualquer
    // esqueleto: a ordem no fonte é parte do contrato (guarda solta no
    // fim não protege ninguém).
    const idxIsLoading = home.indexOf("if (!isLoading) return null;");
    const idxGuarda = home.indexOf(
      "if (derivadaPorFiltro && ultimaVisitaTinhaConteuto === false)",
    );
    const idxEsqueletoOfertas = home.indexOf(
      "<SecaoOfertasEsqueleto key={section.id} />",
    );
    expect(idxIsLoading).toBeGreaterThan(-1);
    expect(idxGuarda).toBeGreaterThan(idxIsLoading);
    expect(idxEsqueletoOfertas).toBeGreaterThan(idxGuarda);
  });

  it("banner: memória dizia sem banner → esqueleto do banner não nasce", () => {
    const home = fonte(HOME);
    // O colapso do esqueleto do banner em loja sem banner é o defeito
    // dominante medido (0,33-0,53 de CLS, ressalva 2 do laudo 2228): quem
    // já visitou a loja e ela não tinha banner não ganha o esqueleto —
    // quando `bannersLoaded` confirmar o vazio, nada colapsa.
    expect(home).toMatch(
      /memoriaDaUltimaVisita !== null &&\s*\n\s*!memoriaDaUltimaVisita\.temBanner \? null : \(/,
    );
    // E a memória é gravada quando dados e banners da visita resolveram.
    expect(home).toMatch(
      /if \(isLoading \|\| !bannersLoaded\) return;\s*\n\s*gravarMemoriaDaHome\(\{/,
    );
  });

  it("seção curada (productIds) e new_arrivals continuam reservando espaço", () => {
    const home = fonte(HOME);
    // Conteúdo PREVISÍVEL mantém esqueleto: curada tem productIds
    // escolhidos pela lojista; new_arrivals acompanha o Catálogo (se a
    // loja tem produto ativo, tem lançamentos). O esqueleto de ofertas
    // segue vivo para a offers CURADA — a troca esqueleto→PremiumOffers
    // real continua 1:1.
    expect(home).toMatch(
      /section\.productIds && section\.productIds\.length > 0/,
    );
    expect(home).toContain("function SecaoOfertasEsqueleto() {");
    expect(home).toContain("function SecaoCarrosselEsqueleto() {");
  });

  it("esqueleto de carrossel espelha o padding do ProductCarousel real", () => {
    const home = fonte(HOME);
    const real = fonte(PRODUCT_CAROUSEL);
    // Container real: px-5 sm:px-6 py-4; header: mb-6; faixa: pb-2;
    // card: w-[260px] com py-2 — tudo presente no esqueleto.
    expect(real).toContain('"px-5 sm:px-6 py-4 overflow-hidden"');
    expect(home).toContain('"overflow-hidden px-5 py-4 sm:px-6"');
    expect(real).toContain('"mb-6 flex flex-col"');
    expect(home).toContain('"mb-6 flex flex-col"');
    expect(real).toContain("scroll-smooth pb-2");
    expect(home).toContain('"flex pb-2"');
    expect(real).toContain('"flex-shrink-0 w-[260px] py-2 flex flex-col"');
    expect(home).toContain('"w-[260px] flex-shrink-0 py-2"');
  });

  it("esqueleto de ofertas espelha a moldura do PremiumOffers real", () => {
    const home = fonte(HOME);
    const real = fonte(PREMIUM_OFFERS);
    // O container real carrega as classes de padding no meio de um
    // bg-gradient (string maior); o esqueleto as replica literal.
    expect(real).toContain("px-5 py-4 sm:px-6");
    expect(home).toContain('"px-5 py-4 sm:px-6"');
    // Header compacto (mb-4 + text-xl leading-none = 20px → h-5) e a
    // moldura do embla (-mx-1 -my-3 px-1 py-3 + p-1.5).
    expect(real).toContain('"relative z-10 mb-4 flex items-center');
    expect(home).toContain('"mb-4 flex items-center justify-between gap-3"');
    expect(real).toContain('"-mx-1 -my-3 w-full cursor-grab');
    expect(home).toContain('"-mx-1 -my-3 w-full px-1 py-3"');
    expect(real).toContain('"flex min-w-0 flex-[0_0_100%] flex-col p-1.5"');
    expect(home).toContain('"flex min-w-0 flex-[0_0_100%] flex-col p-1.5"');
    // Dots: mt-2 mb-1 com h-1.5.
    expect(real).toContain('"mb-1 mt-2 flex items-center justify-center');
    expect(home).toContain('"mb-1 mt-2 flex items-center justify-center');
  });
});

describe("catálogo: o esqueleto do card reserva a mesma proporção do real", () => {
  it("a grade de esqueletos mora no ProductList com a mesma classe da grade real", () => {
    const src = fonte(PRODUCT_LIST);
    expect(src).toMatch(/if \(isLoading\) \{/);
    expect(src).toContain("[1, 2, 3, 4, 5, 6, 7, 8].map((i) => (");
    // A grade de esqueleto e a grade real compartilham a MESMA classe de
    // grid (2 colunas no mobile) — mesma largura de card, mesma coluna.
    expect(src).toContain(
      'className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 lg:grid-cols-4"',
    );
  });

  it("imagem do esqueleto e imagem do card real têm a MESMA proporção 4/5", () => {
    const skel = fonte(PRODUCT_CARD_SKELETON);
    const real = fonte(PRODUCT_CARD);
    expect(skel).toContain("aspect-[4/5]");
    expect(real).toContain("relative aspect-[4/5]");
  });
});

describe("barra de categorias: altura estável sem dados", () => {
  it("o esqueleto dos pills espelha o wrapper e a altura dos botões reais", () => {
    const src = fonte(CATEGORY_FILTER);
    // Wrapper do esqueleto = wrapper real (flex w-full items-center).
    expect(src).toMatch(
      /<div\s+role="status"\s+className="flex w-full items-center"/,
    );
    // A faixa de pills do esqueleto usa a MESMA classe da faixa real
    // (px-1 py-0.5), com pills h-8 (32px ≥ botão real py-2 text-[10px]
    // ≈ 31px) — sem dados a barra já tem a altura de carregada.
    expect(src).toContain(
      '"scrollbar-hide flex w-full gap-2 overflow-x-auto px-1 py-0.5"',
    );
    expect(src).toContain("h-8 w-24");
    // A altura do botão REAL também é parte do contrato (laudo da ponte,
    // buraco 2): sem ela, um py-3 no botão real envelhece o pill h-8 do
    // esqueleto em silêncio.
    expect(src).toMatch(/rounded-full px-5 py-2 text-\[10px\]/);
  });
});

// ── Comportamental (laudo edj3ka E2 + desenho da memória 6ab5s4): montar ───
// o HomeView de verdade e olhar o DOM. O teste de fonte acima é a catraca;
// este é a prova de efeito — quem volta à loja não vê esqueleto nascer para
// morrer; primeira visita vê exatamente o que o build de hoje mostra.
describe("memória da última visita, comportamental: o DOM durante o load", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    configDaLoja = {};
    bannersDaLoja = { isLoaded: true, banners: [] };
    // O jsdom deste runner não entrega localStorage funcional (o hook lê
    // dentro de try/catch e cairia sempre em "1ª visita"): um fake por
    // caso dá o storage que os casos de memória precisam.
    const dados = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (chave: string) => dados.get(chave) ?? null,
      setItem: (chave: string, valor: string) => {
        dados.set(chave, String(valor));
      },
      removeItem: (chave: string) => {
        dados.delete(chave);
      },
    });
    vi.stubGlobal("CSS", { escape: (v: string) => v });
    vi.stubGlobal("IntersectionObserver", IntersectionObserverStub);
    vi.stubGlobal("ResizeObserver", ResizeObserverStub);
    vi.stubGlobal("matchMedia", matchMediaStub);
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
  });

  const semearMemoria = (memoria: {
    temBanner: boolean;
    temOfertas: boolean;
    temBestsellers: boolean;
  }) => {
    window.localStorage.setItem(
      "ikcous_home_memoria",
      JSON.stringify({ ...memoria, gravadoEm: Date.now() }),
    );
  };

  const montar = async (products: Product[], isLoading = false) => {
    const { HomeView } = await import("@/views/customer/HomeView");
    await act(async () => {
      raiz.render(
        <HomeView
          products={products}
          favorites={[]}
          onToggleFavorite={() => {}}
          onProductClick={() => {}}
          onNavigate={(_view: View) => {}}
          searchQuery=""
          isLoading={isLoading}
          selectedCategory="Todas"
          onCategoryChange={() => {}}
          sortBy="default"
          onSortByChange={() => {}}
        />,
      );
    });
  };

  const criarProduto = (
    overrides: Partial<Product> & { id: string },
  ): Product => ({
    name: overrides.id,
    description: "produto de teste",
    price: 100,
    images: [],
    category: "geral",
    stock: 10,
    sold: 0,
    isActive: true,
    isBestseller: false,
    freeShipping: false,
    createdAt: new Date().toISOString(),
    ...overrides,
  });

  const esqueletoDeOfertas = () =>
    hospedeiro.querySelector('[data-testid="esqueleto-ofertas"]');
  const esqueletoDeCarrossel = () =>
    hospedeiro.querySelector('[data-testid="esqueleto-carrossel"]');
  const esqueletoDeBanner = () =>
    hospedeiro.querySelector('[data-testid="esqueleto-banner"]');

  it("1ª visita (sem memória): esqueleto de ofertas nasce — aposta de hoje (develop)", async () => {
    // Primeira visita: localStorage sem snapshot. O comportamento é o do
    // build atual da develop: banner e ofertas reservam espaço otimista.
    bannersDaLoja = { isLoaded: false, banners: [] };
    await montar([], true);

    expect(esqueletoDeOfertas()).not.toBeNull();
    expect(esqueletoDeCarrossel()).not.toBeNull();
    expect(esqueletoDeBanner()).not.toBeNull();
  });

  it("volta a loja SEM ofertas e SEM banner: nenhum esqueleto de ofertas/banner nasce", async () => {
    // Quem volta não vê nada nascer para morrer: a memória dizia que não
    // tinha banner nem ofertas — os esqueletos não montam; quando os dados
    // confirmarem o vazio, NADA colapsa. O carrossel de lançamentos segue
    // reservando (new_arrivals tem sinal de conteúdo) — controle negativo.
    semearMemoria({
      temBanner: false,
      temOfertas: false,
      temBestsellers: false,
    });
    bannersDaLoja = { isLoaded: false, banners: [] };
    await montar([], true);

    expect(esqueletoDeOfertas()).toBeNull();
    expect(esqueletoDeBanner()).toBeNull();
    expect(esqueletoDeCarrossel()).not.toBeNull();
  });

  it("volta a loja COM ofertas: esqueleto de ofertas reserva (troca 1:1, sem nascimento)", async () => {
    semearMemoria({
      temBanner: false,
      temOfertas: true,
      temBestsellers: false,
    });
    bannersDaLoja = { isLoaded: false, banners: [] };
    await montar([], true);

    expect(esqueletoDeOfertas()).not.toBeNull();
  });

  it("com ofertas na mão: a seção real nasce, sem esqueleto", async () => {
    // Dados já chegaram (products é prop): a seção offers renderiza o
    // PremiumOffers de verdade, com o título — nunca o esqueleto.
    const comOferta = criarProduto({ id: "p-oferta", originalPrice: 130 });
    await montar([comOferta], true);

    expect(hospedeiro.textContent).toContain("Ofertas Imperdíveis");
    expect(esqueletoDeOfertas()).toBeNull();
  });

  it("a visita carregada grava a memória para a próxima", async () => {
    // isLoading=false + banners carregados: os três booleanos da home viva
    // viram o snapshot da próxima visita.
    const comOferta = criarProduto({ id: "p-oferta", originalPrice: 130 });
    bannersDaLoja = { isLoaded: true, banners: [] };
    await montar([comOferta], false);

    const bruto = window.localStorage.getItem("ikcous_home_memoria");
    expect(bruto).not.toBeNull();
    expect(JSON.parse(bruto!)).toMatchObject({
      temBanner: false,
      temOfertas: true,
      temBestsellers: false,
    });
  });
});
