// @vitest-environment jsdom
//
// Banner da vitrine: o link que a dona digita no painel NUNCA pode rodar
// código no celular de quem toca.
//
// Defeito medido (14/10): o destino `javascript:alert(1)` não tem "://", caiu
// no ramo de caminho interno do `handleNavigation`; o `pushState` com esse
// esquema lança SecurityError e o `catch` fazia `window.location.href = link`
// — o navegador EXECUTA o script. `data:` e `vbscript:` entravam igual, e
// `//evil.com` e `/\evil.com` passavam por "começa com /" mas o navegador os
// trata como OUTRO site.
//
// Regra nova: o banner só abre um caminho do app (UMA barra no começo) ou um
// endereço http/https. Qualquer outra coisa não navega, e o painel recusa o
// link ao salvar. Os disfarces abaixo são os que o navegador "desfaz" sozinho
// (tab e quebra de linha em qualquer posição, controles/espaços no começo,
// maiúsculas no esquema) — por isso a prova confere também com o `new URL()`
// do próprio ambiente, não só com a lista escrita à mão.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  AVISO_DE_LINK_RECUSADO,
  avisoDoLinkDigitado,
  destinoDoBanner,
  destinoSeguroDoBanner,
  linkDoBannerParaSalvar,
} from "@/lib/destino-do-banner";
import type { Banner } from "@/types";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const { emblaApi, updateBanner, toastError, lista } = vi.hoisted(() => ({
  emblaApi: {
    scrollNext: vi.fn(),
    scrollTo: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
    selectedScrollSnap: () => 0,
    // o painel também monta o carrossel de números (AdminKpiCarousel)
    scrollPrev: vi.fn(),
    scrollSnapList: () => [] as number[],
    canScrollPrev: () => false,
    canScrollNext: () => false,
    reInit: vi.fn(),
  },
  updateBanner: vi.fn(),
  toastError: vi.fn(),
  lista: { banners: [] as unknown[] },
}));

vi.mock("embla-carousel-react", () => ({
  default: () => [vi.fn(), emblaApi],
}));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: "lojista-1" } }),
}));
vi.mock("@/hooks/useBanners", () => ({
  useBanners: () => ({
    banners: lista.banners,
    isLoaded: true,
    uploadBannerImage: vi.fn(),
    addBanner: vi.fn(),
    updateBanner,
    deleteBanner: vi.fn(),
    deleteStorageFile: vi.fn(),
    reorderBanners: vi.fn(),
    refreshBanners: vi.fn(),
  }),
}));
vi.mock("@/hooks/useProducts", () => ({
  useProducts: () => ({ products: [] }),
}));
vi.mock("@/hooks/useCoupons", () => ({ useCoupons: () => ({}) }));
vi.mock("@/hooks/useCategories", () => ({
  useCategories: () => ({ categories: [] }),
}));
vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: { primaryColor: "#FFBF00" } }),
}));
vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: toastError,
    info: vi.fn(),
    loading: vi.fn(() => "t"),
  },
}));

class ObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

const LOJA = "https://loja.test";

// Disfarces de link perigoso. Cada um já foi (ou poderia ser) digitado no
// painel e tem de dar "não navega".
const PERIGOSOS: Array<[string, unknown]> = [
  ["javascript: simples", "javascript:alert(1)"],
  ["javascript: em maiúsculas misturadas", "JaVaScRiPt:alert(1)"],
  ["javascript: com espaços antes", "  javascript:alert(1)"],
  ["javascript: com tab no meio", "java\tscript:alert(1)"],
  ["javascript: com quebra de linha no meio", "java\nscript:alert(1)"],
  ["javascript: com retorno de carro no meio", "java\rscript:alert(1)"],
  ["javascript: com controle antes", "\u0001javascript:alert(1)"],
  [
    "javascript: com controle antes e espaço",
    "\u0001 \u001fjavascript:alert(1)",
  ],
  ["javascript: com comentário de URL", "javascript://%0aalert(1)"],
  ["data:", "data:text/html,x"],
  [
    "data: com script",
    "data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==",
  ],
  ["vbscript:", "vbscript:x"],
  ["file:", "file:///etc/passwd"],
  ["blob:", "blob:https://x/y"],
  ["ftp:", "ftp://exemplo.com/arquivo"],
  ["mailto:", "mailto:a@b.com"],
  ["tel:", "tel:+5511999999999"],
  ["outro app (intent)", "intent://scan/#Intent;scheme=zxing;end"],
  ["// (outro site, mesmo protocolo)", "//evil.com"],
  ["//, depois do tab", "/\t/evil.com"],
  ["//, depois da quebra de linha", "/\n/evil.com"],
  ["// com espaços antes", "   //evil.com/x"],
  ["/\\ (o navegador troca \\ por /)", "/\\evil.com"],
  ["começa com \\", "\\\\evil.com"],
  ["vazio", ""],
  ["só espaços", "   "],
  ["null", null],
  ["undefined", undefined],
];

const SEGUROS: Array<[string, string, string]> = [
  ["Home", "/", "/"],
  [
    "categoria codificada",
    "/?category=Cama%20%26%20Banho",
    "/?category=Cama%20%26%20Banho",
  ],
  ["produto da loja", "/produto/abc", "/produto/abc"],
  [
    "detalhe do produto (PR #873)",
    "/product-detail?id=abc",
    "/product-detail?id=abc",
  ],
  ["https", "https://exemplo.com/x", "https://exemplo.com/x"],
  [
    "https do WhatsApp",
    "https://wa.me/5511999999999",
    "https://wa.me/5511999999999",
  ],
  ["http", "http://exemplo.com", "http://exemplo.com"],
  ["HTTPS em maiúsculas", "HTTPS://exemplo.com/x", "HTTPS://exemplo.com/x"],
  ["espaços antes de um caminho", "  /produto/abc", "/produto/abc"],
  ["tab no meio de um caminho vira nada", "/produ\tto/abc", "/produto/abc"],
];

describe("destinoSeguroDoBanner: só caminho do app ou http/https", () => {
  it.each(PERIGOSOS)("recusa %s", (_nome, link) => {
    expect(destinoSeguroDoBanner(link as string | null | undefined)).toBeNull();
  });

  it.each(SEGUROS)("aceita %s", (_nome, link, esperado) => {
    expect(destinoSeguroDoBanner(link)).toBe(esperado);
  });

  it("confere com o new URL() do ambiente: nada aceito sai da loja nem roda código", () => {
    const prefixos = [
      "",
      " ",
      "\t",
      "\n",
      "\r",
      "\u0000",
      "\u0001",
      "\u001f",
      " ",
    ];
    const corpos = [
      "javascript:alert(1)",
      "JAVASCRIPT:alert(1)",
      "data:text/html,x",
      "vbscript:x",
      "//evil.com",
      "/\\evil.com",
      "/\t/evil.com",
      "\\\\evil.com",
      "/ok",
      "/?category=Moda%20%231",
      "https://exemplo.com/x",
      "http://exemplo.com",
    ];
    // Também enfia tab/quebra de linha/controle em CADA posição de cada corpo.
    const metidos = ["\t", "\n", "\r", "\u0001"];
    const candidatos: string[] = [];
    for (const corpo of corpos) {
      for (const p of prefixos) candidatos.push(p + corpo);
      for (const m of metidos) {
        for (let i = 0; i <= corpo.length; i++) {
          candidatos.push(corpo.slice(0, i) + m + corpo.slice(i));
        }
      }
    }
    expect(candidatos.length).toBeGreaterThan(300);

    let aceitos = 0;
    for (const candidato of candidatos) {
      const seguro = destinoSeguroDoBanner(candidato);
      if (seguro === null) continue;
      aceitos++;
      const destino = new URL(seguro, LOJA);
      expect(
        ["http:", "https:"],
        `aceitou ${JSON.stringify(candidato)}`,
      ).toContain(destino.protocol);
      if (seguro.startsWith("/")) {
        // caminho do app: continua na própria loja
        expect(destino.origin, `aceitou ${JSON.stringify(candidato)}`).toBe(
          LOJA,
        );
      }
    }
    // a prova não é vazia: sobrou coisa aceita para conferir
    expect(aceitos).toBeGreaterThan(50);
  });
});

describe("destinoDoBanner: usa o destino seguro", () => {
  it.each(PERIGOSOS)("%s não vira destino", (_nome, link) => {
    expect(destinoDoBanner(link as string | null | undefined)).toBeNull();
  });

  it.each(SEGUROS)("%s continua funcionando", (_nome, link, esperado) => {
    expect(destinoDoBanner(link)).toBe(esperado);
  });

  it("os conserto de banner antigo seguem valendo", () => {
    expect(destinoDoBanner("/produtos")).toBe("/");
    expect(destinoDoBanner("/?category=Cama & Banho")).toBe(
      "/?category=Cama%20%26%20Banho",
    );
  });
});

describe("painel: o link que a dona digita só é gravado se o banner puder abri-lo", () => {
  it.each(
    PERIGOSOS.filter(([, v]) => typeof v === "string" && v.trim() !== ""),
  )("recusa %s", (_nome, link) => {
    expect(linkDoBannerParaSalvar(link as string)).toBeNull();
    expect(avisoDoLinkDigitado(link as string)).toBe(AVISO_DE_LINK_RECUSADO);
  });

  it.each([
    ["vazio", "", ""],
    ["só espaços", "   ", ""],
    ["Home", "/", "/"],
    ["caminho do app", "/categoria", "/categoria"],
    [
      "categoria codificada",
      "/?category=Cama%20%26%20Banho",
      "/?category=Cama%20%26%20Banho",
    ],
    ["https", "https://exemplo.com/x", "https://exemplo.com/x"],
    ["http", " http://exemplo.com ", "http://exemplo.com"],
    // sempre foi assim: sem a barra do começo, o painel a coloca
    ["sem barra no começo", "promocoes/natal", "/promocoes/natal"],
    ["domínio sem esquema", "meusite.com/x", "/meusite.com/x"],
  ])("aceita %s", (_nome, digitado, gravado) => {
    expect(linkDoBannerParaSalvar(digitado)).toBe(gravado);
    expect(avisoDoLinkDigitado(digitado)).toBeNull();
  });

  it("o aviso é o texto combinado", () => {
    expect(AVISO_DE_LINK_RECUSADO).toBe(
      "Use um endereço que comece com https:// ou um caminho do app como /categoria",
    );
  });
});

describe("BannerCarousel: banner de link perigoso aparece, mas não navega", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let pushState: ReturnType<typeof vi.spyOn>;
  let hrefAtribuidos: string[];

  beforeEach(() => {
    vi.stubGlobal("IntersectionObserver", ObserverStub);
    vi.stubGlobal("ResizeObserver", ObserverStub);
    vi.stubGlobal("matchMedia", (consulta: string) => ({
      matches: false,
      media: consulta,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: () => false,
    }));
    // Anota tudo o que o código mandaria o navegador abrir. Sem isto o jsdom
    // só reclamaria "navigation not implemented" e a prova ficaria muda.
    hrefAtribuidos = [];
    vi.stubGlobal("location", {
      origin: LOJA,
      pathname: "/",
      search: "",
      get href() {
        return `${LOJA}/`;
      },
      set href(valor: string) {
        hrefAtribuidos.push(valor);
      },
    });
    pushState = vi.spyOn(globalThis.history, "pushState");
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

  async function montar(link: unknown) {
    const banner = {
      id: "b1",
      imageUrl: "https://example.com/banner.jpg",
      title: "Campanha",
      position: "home_top",
      active: true,
      order: 1,
      link,
    } as Banner;
    const { BannerCarousel } = await import(
      "@/components/ui/custom/BannerCarousel"
    );
    act(() => {
      raiz.render(<BannerCarousel banners={[banner]} autoPlay={false} />);
    });
  }

  const slide = () =>
    hospedeiro.querySelector<HTMLElement>('[aria-label^="1 de 1"]');

  it.each(PERIGOSOS)(
    "%s: sem botão, sem cursor de clique, e tocar não abre nada",
    async (_nome, link) => {
      await montar(link);
      const alvo = slide();
      expect(alvo).not.toBeNull();
      expect(hospedeiro.querySelector('[role="button"]')).toBeNull();
      expect(alvo?.getAttribute("tabindex")).toBeNull();
      expect(alvo?.className).not.toContain("cursor-pointer");

      await act(async () => {
        alvo?.click();
        alvo?.dispatchEvent(
          new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
        );
      });
      expect(hrefAtribuidos).toEqual([]);
      expect(pushState).not.toHaveBeenCalled();
    },
  );

  it("link https externo: continua abrindo o endereço", async () => {
    await montar("https://wa.me/5511999999999");
    const alvo = hospedeiro.querySelector<HTMLElement>('[role="button"]');
    expect(alvo).not.toBeNull();
    expect(alvo?.className).toContain("cursor-pointer");
    await act(async () => {
      alvo?.click();
    });
    expect(hrefAtribuidos).toEqual(["https://wa.me/5511999999999"]);
    expect(pushState).not.toHaveBeenCalled();
  });

  it("caminho do app: continua navegando por dentro, sem recarregar", async () => {
    await montar("/product-detail?id=abc");
    const alvo = hospedeiro.querySelector<HTMLElement>('[role="button"]');
    expect(alvo).not.toBeNull();
    await act(async () => {
      alvo?.click();
    });
    expect(pushState).toHaveBeenCalledTimes(1);
    expect(pushState.mock.calls[0]?.[0]).toMatchObject({
      view: "product-detail",
      id: "abc",
    });
    expect(hrefAtribuidos).toEqual([]);
  });
});

describe("AdminBannersView: o painel recusa o link perigoso ao salvar", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
    updateBanner.mockResolvedValue(undefined);
    lista.banners = [
      {
        id: "banner-1",
        imageUrl:
          "https://proj.supabase.co/storage/v1/object/public/banners/a.jpg",
        title: "Campanha Ativa",
        link: "",
        position: "home_top",
        active: true,
        order: 1,
      },
    ];
    vi.stubGlobal("IntersectionObserver", ObserverStub);
    vi.stubGlobal("ResizeObserver", ObserverStub);
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
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

  const botao = (texto: string) =>
    [...document.body.querySelectorAll("button")].find((b) =>
      b.textContent?.includes(texto),
    ) as HTMLButtonElement | undefined;

  const espera = (ms: number) =>
    act(async () => {
      await new Promise<void>((r) => setTimeout(r, ms));
    });

  async function clicar(el: HTMLElement | undefined | null) {
    expect(el).toBeTruthy();
    await act(async () => {
      el?.click();
    });
  }

  /** Abre o banner, vai ao passo "Destino", escolhe "Link customizado" e digita. */
  async function digitarOLink(link: string) {
    const { AdminBannersView } = await import("@/views/admin/AdminBannersView");
    await act(async () => {
      raiz.render(<AdminBannersView onNavigate={vi.fn()} active={true} />);
    });
    await espera(0);
    await clicar(
      document.body.querySelector<HTMLElement>('button[title="Editar"]'),
    );
    await clicar(botao("3Destino"));
    await espera(600);
    await clicar(botao("Link customizado"));
    const campo = document.getElementById(
      "banner-link-custom",
    ) as HTMLInputElement | null;
    expect(campo).not.toBeNull();
    await act(async () => {
      const escrever = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set;
      escrever?.call(campo, link);
      campo?.dispatchEvent(new Event("input", { bubbles: true }));
    });
    // o campo entrega o valor ao formulário 200 ms depois de digitar
    await espera(300);
  }

  it.each([
    "javascript:alert(1)",
    "JaVaScRiPt:alert(1)",
    "data:text/html,x",
    "//evil.com",
    "/\\evil.com",
  ])("recusa %s: avisa e não grava", async (link) => {
    await digitarOLink(link);

    await clicar(botao("Salvar Alterações"));
    await espera(0);

    expect(updateBanner).not.toHaveBeenCalled();
    expect(toastError).toHaveBeenCalledWith(AVISO_DE_LINK_RECUSADO);
  });

  // Enquanto o link parece um endereço (https://…) o campo continua na tela
  // e já mostra o aviso embaixo, antes de salvar. (Quando o texto não começa
  // com http, o painel — desde antes — troca o campo pela lista de páginas.)
  it("endereço https quebrado: o aviso aparece embaixo do campo e não grava", async () => {
    await digitarOLink("https://");
    expect(document.body.textContent).toContain(AVISO_DE_LINK_RECUSADO);

    await clicar(botao("Salvar Alterações"));
    await espera(0);

    expect(updateBanner).not.toHaveBeenCalled();
    expect(toastError).toHaveBeenCalledWith(AVISO_DE_LINK_RECUSADO);
  });

  it.each([
    ["https://exemplo.com/x", "https://exemplo.com/x"],
    ["/?category=Cama%20%26%20Banho", "/?category=Cama%20%26%20Banho"],
    ["promocoes/natal", "/promocoes/natal"],
  ])("grava %s como %s", async (digitado, gravado) => {
    await digitarOLink(digitado);
    expect(document.body.textContent).not.toContain(AVISO_DE_LINK_RECUSADO);

    await clicar(botao("Salvar Alterações"));
    await espera(0);

    expect(toastError).not.toHaveBeenCalled();
    expect(updateBanner).toHaveBeenCalledTimes(1);
    expect(updateBanner.mock.calls[0]?.[0]).toBe("banner-1");
    expect(updateBanner.mock.calls[0]?.[1]).toMatchObject({ link: gravado });
  });
});
