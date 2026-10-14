// @vitest-environment jsdom
//
// A lojista digita `wa.me/5511...` ou `instagram.com/loja` (sem https://) no
// campo de link do banner. O painel só deixava passar o que começava com `/`,
// `http://` ou `https://`; o resto ganhava uma `/` na frente — `/wa.me/55...`,
// uma página que a loja não tem — e a cliente tocava no banner e caía numa
// tela vazia. Agora o que PARECE endereço de site ganha `https://`.
//
// Duas camadas:
//   1. `linkDigitadoParaGravar` (função pura): a tabela entrada -> link gravado.
//   2. a tela real (AdminBannersView): o que chega ao `addBanner` é o link
//      corrigido — e o campo não some enquanto a lojista digita.
//
// O que NÃO mudou (e a tabela prova): esquema perigoso (`javascript:`,
// `data:`) continua neutralizado pela `/` na frente, como hoje.
import { linkDigitadoParaGravar } from "@/lib/destino-do-banner";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("linkDigitadoParaGravar: entrada da lojista -> link gravado", () => {
  it.each([
    // o defeito: endereço de site sem https://
    ["wa.me/5511999999999", "https://wa.me/5511999999999"],
    ["instagram.com/loja", "https://instagram.com/loja"],
    ["www.minhaloja.com.br", "https://www.minhaloja.com.br"],
    [
      "www.minhaloja.com.br/ofertas?x=1#topo",
      "https://www.minhaloja.com.br/ofertas?x=1#topo",
    ],
    ["  instagram.com/loja  ", "https://instagram.com/loja"],
    ["loja.com:8080/p", "https://loja.com:8080/p"],
    // já completo: fica como a lojista digitou
    ["https://wa.me/5511999999999", "https://wa.me/5511999999999"],
    ["http://loja.com", "http://loja.com"],
    ["Https://loja.com/ofertas", "Https://loja.com/ofertas"],
    // página da própria loja
    ["/produto", "/produto"],
    ["/", "/"],
    ["/product-detail?id=abc", "/product-detail?id=abc"],
    [
      "/?category=Capas%20%26%20Pel%C3%ADculas",
      "/?category=Capas%20%26%20Pel%C3%ADculas",
    ],
    ["/?category=Capas & Películas", "/?category=Capas & Películas"],
    // sem domínio: continua virando caminho da loja, como hoje
    ["ofertas", "/ofertas"],
    ["product-detail?id=abc", "/product-detail?id=abc"],
    ["?category=Bebidas", "/?category=Bebidas"],
    ["#topo", "/#topo"],
    // esquema perigoso ou desconhecido: continua NEUTRALIZADO (/ na frente)
    ["javascript:alert(1)", "/javascript:alert(1)"],
    ["JavaScript:alert(document.cookie)", "/JavaScript:alert(document.cookie)"],
    [
      "data:text/html,<script>alert(1)</script>",
      "/data:text/html,<script>alert(1)</script>",
    ],
    ["vbscript:x", "/vbscript:x"],
    ["tel:+5511999999999", "/tel:+5511999999999"],
    ["mailto:loja@loja.com", "/mailto:loja@loja.com"],
    // disfarce de domínio com esquema perigoso no meio
    ["javascript:alert('a.com')", "/javascript:alert('a.com')"],
    ["a.com:javascript:alert(1)", "/a.com:javascript:alert(1)"],
    // espaços: não é endereço de site
    ["minha loja.com", "/minha loja.com"],
    ["wa.me/55 11", "/wa.me/55 11"],
    // vazio
    ["", ""],
    ["   ", ""],
  ])("%j -> %j", (digitado, esperado) => {
    expect(linkDigitadoParaGravar(digitado)).toBe(esperado);
  });

  it("nunca devolve link que comece com esquema perigoso", () => {
    for (const perigoso of [
      "javascript:alert(1)",
      "JAVASCRIPT:alert(1)",
      " javascript:alert(1)",
      "data:text/html,x",
      "vbscript:x",
    ]) {
      const gravado = linkDigitadoParaGravar(perigoso).toLowerCase();
      expect(gravado.startsWith("javascript:")).toBe(false);
      expect(gravado.startsWith("data:")).toBe(false);
      expect(gravado.startsWith("vbscript:")).toBe(false);
    }
  });

  it("é idempotente: gravar de novo o que já foi gravado não muda nada", () => {
    for (const entrada of [
      "wa.me/5511999999999",
      "instagram.com/loja",
      "/produto",
      "ofertas",
      "javascript:alert(1)",
      "https://loja.com",
    ]) {
      const uma = linkDigitadoParaGravar(entrada);
      expect(linkDigitadoParaGravar(uma)).toBe(uma);
    }
  });
});

// ---------------------------------------------------------------------------
// A tela real. Mesmo padrão de montagem de
// admin-banners-recorte-salva-o-tipo-real-da-imagem.test.tsx.
// ---------------------------------------------------------------------------

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: "lojista-1" } }),
}));

const addBanner = vi.fn();
const updateBanner = vi.fn();
const uploadBannerImage = vi.fn();
const onNavigate = vi.fn();

const bannerPublicado = {
  id: "banner-existente-1",
  imageUrl: "https://proj.supabase.co/storage/v1/object/public/banners/a.jpg",
  title: "Campanha Ativa",
  link: "",
  position: "home_top" as const,
  active: true,
  order: 1,
};

vi.mock("@/hooks/useBanners", () => ({
  useBanners: () => ({
    banners: [bannerPublicado],
    isLoaded: true,
    uploadBannerImage,
    addBanner,
    updateBanner,
    deleteBanner: vi.fn(),
    deleteStorageFile: vi.fn().mockResolvedValue(undefined),
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
    error: vi.fn(),
    info: vi.fn(),
    loading: vi.fn(() => "toast-id"),
  },
}));

class ObservadorFalso {
  observe() {}
  unobserve() {}
  disconnect() {}
}

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const esperar = (ms = 0) => new Promise((r) => setTimeout(r, ms));

function botaoComTexto(raiz: ParentNode, texto: string) {
  return [...raiz.querySelectorAll("button")].find((b) =>
    b.textContent?.includes(texto),
  ) as HTMLButtonElement | undefined;
}

function digitar(el: HTMLInputElement, valor: string) {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )?.set;
  setter?.call(el, valor);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("AdminBannersView: o link digitado chega corrigido ao salvar", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
    addBanner.mockResolvedValue(undefined);
    uploadBannerImage.mockResolvedValue(
      "https://proj.supabase.co/storage/v1/object/public/banners/nova.jpg",
    );
    vi.stubGlobal("IntersectionObserver", ObservadorFalso);
    vi.stubGlobal("ResizeObserver", ObservadorFalso);
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

  /** Abre "Novo Banner" (modo Completo), sobe a imagem e escolhe "Link / URL". */
  async function abrirNoModoLinkCustomizado() {
    const { AdminBannersView } = await import("@/views/admin/AdminBannersView");
    await act(async () => {
      raiz.render(<AdminBannersView onNavigate={onNavigate} active={true} />);
    });
    await act(async () => {
      await esperar();
    });
    await act(async () => {
      botaoComTexto(hospedeiro, "Novo Banner")?.click();
    });
    // O link só se edita no modo Completo (passo 3: Destino).
    await act(async () => {
      botaoComTexto(document.body, "Completo")?.click();
    });
    const entrada = document.getElementById(
      "banner-upload",
    ) as HTMLInputElement;
    Object.defineProperty(entrada, "files", {
      value: [new File(["x"], "foto.jpg", { type: "image/jpeg" })],
      configurable: true,
    });
    await act(async () => {
      entrada.dispatchEvent(new Event("change", { bubbles: true }));
      await esperar();
      await esperar();
    });
    for (let passo = 0; passo < 2; passo++) {
      await act(async () => {
        botaoComTexto(document.body, "Continuar")?.click();
        // AnimatePresence "wait": o passo novo só monta depois da saída.
        await esperar(400);
      });
    }
    await act(async () => {
      botaoComTexto(document.body, "Link / URL")?.click();
    });
  }

  async function digitarLinkESalvar(texto: string) {
    const campo = document.getElementById(
      "banner-link-custom",
    ) as HTMLInputElement;
    expect(campo, "o campo de link tem de estar na tela").not.toBeNull();
    await act(async () => {
      digitar(campo, texto);
      await esperar(300); // passa o atraso do campo (200 ms)
    });
    await act(async () => {
      botaoComTexto(document.body, "Salvar Alterações")?.click();
      await esperar();
      await esperar();
    });
  }

  it.each([
    ["wa.me/5511999999999", "https://wa.me/5511999999999"],
    ["instagram.com/loja", "https://instagram.com/loja"],
    ["https://wa.me/5511999999999", "https://wa.me/5511999999999"],
    ["javascript:alert(1)", "/javascript:alert(1)"],
    ["data:text/html,<b>x</b>", "/data:text/html,<b>x</b>"],
  ])("digitou %j -> addBanner recebe %j", async (digitado, gravado) => {
    await abrirNoModoLinkCustomizado();
    await digitarLinkESalvar(digitado);
    expect(addBanner).toHaveBeenCalledTimes(1);
    expect(addBanner.mock.calls[0][0].link).toBe(gravado);
  });

  it("endereço de site sem https:// não faz o campo sumir enquanto a lojista digita", async () => {
    await abrirNoModoLinkCustomizado();
    const campo = document.getElementById(
      "banner-link-custom",
    ) as HTMLInputElement;
    await act(async () => {
      digitar(campo, "instagram.com/loja");
      await esperar(300);
    });
    // antes: o painel tratava como "Página da Loja" e o campo sumia
    expect(document.getElementById("banner-link-custom")).not.toBeNull();
    // ao sair do campo, a lojista VÊ o link como ele vai ser gravado
    await act(async () => {
      campo.focus();
      campo.blur();
      await esperar(50);
    });
    expect(
      (document.getElementById("banner-link-custom") as HTMLInputElement).value,
    ).toBe("https://instagram.com/loja");
  });
});
