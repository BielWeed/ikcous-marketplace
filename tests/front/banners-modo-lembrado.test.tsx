// @vitest-environment jsdom
//
// Banners — o modo do editor (Simples / Completo) é lembrado NO APARELHO
// (painel simples, H4). Simples continua o padrão da primeira abertura.
//
// O PERIGO DE DADO que este arquivo prende: salvar em Simples APAGA título,
// subtítulo, botão, selo, cores e fonte do banner (`dataToSubmit` do
// `handleSubmit`). Por isso o modo lembrado só vale para banner NOVO ou sem
// texto; banner com texto abre SEMPRE em Completo, mesmo com "simple"
// lembrado — senão um salvar distraído apagaria a campanha.
//
//   a. funções puras (`modo-do-editor-de-banner`): valor desconhecido vira
//      Simples, armazenamento que lança não quebra, regra do banner com texto;
//   b. a view: primeira abertura Simples; Completo lembrado após remontar;
//      banner com texto abre Completo; localStorage que lança não quebra.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  CHAVE_DO_MODO_DO_EDITOR,
  gravarModoDoEditor,
  lerModoDoEditor,
  modoAoAbrirOBanner,
} from "@/lib/modo-do-editor-de-banner";

const addBanner = vi.fn();
const updateBanner = vi.fn();

type BannerDaLista = {
  id: string;
  imageUrl: string;
  title: string;
  subtitle?: string;
  buttonText?: string;
  badgeText?: string;
  link: string;
  position: "home_top";
  active: boolean;
  order: number;
};

const umBanner = (extra: Partial<BannerDaLista> = {}): BannerDaLista => ({
  id: "banner-1",
  imageUrl: "https://proj.supabase.co/storage/v1/object/public/banners/a.jpg",
  title: "",
  link: "",
  position: "home_top",
  active: true,
  order: 1,
  ...extra,
});

const lista = vi.hoisted(() => ({ banners: [] as unknown[] }));

vi.mock("@/hooks/useBanners", () => ({
  useBanners: () => ({
    banners: lista.banners,
    isLoaded: true,
    uploadBannerImage: vi.fn(),
    addBanner,
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
  toast: { success: vi.fn(), error: vi.fn(), loading: vi.fn(() => "t") },
}));

class ObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const esperar = () => new Promise<void>((r) => setTimeout(r, 0));

/**
 * Armazenamento de dublê: comum, ou que lança ao ler/gravar. `soNaChave`
 * restringe o erro à chave do modo: o rascunho do formulário (código antigo da
 * view, fora desta tarefa) lê `localStorage` sem proteção, e o que se prova
 * aqui é que a PREFERÊNCIA DE MODO nunca derruba a tela.
 */
function armazenamento(opcoes: { lanca?: boolean; soNaChave?: string } = {}) {
  const mapa = new Map<string, string>();
  const explode = (k: string) => {
    if (opcoes.lanca && (!opcoes.soNaChave || opcoes.soNaChave === k)) {
      throw new DOMException("bloqueado", "SecurityError");
    }
  };
  return {
    mapa,
    api: {
      getItem: (k: string) => {
        explode(k);
        return mapa.get(k) ?? null;
      },
      setItem: (k: string, v: string) => {
        explode(k);
        mapa.set(k, v);
      },
      removeItem: (k: string) => {
        explode(k);
        mapa.delete(k);
      },
    },
  };
}

function stubarDom() {
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
}

describe("modo-do-editor-de-banner (funções puras)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("a chave tem o mesmo prefixo do rascunho do formulário", () => {
    expect(CHAVE_DO_MODO_DO_EDITOR).toBe("admin_banner_modo");
  });

  it("sem nada gravado, o modo é Simples", () => {
    vi.stubGlobal("localStorage", armazenamento().api);
    expect(lerModoDoEditor()).toBe("simple");
  });

  it("grava e lê de volta os dois modos", () => {
    vi.stubGlobal("localStorage", armazenamento().api);
    gravarModoDoEditor("complete");
    expect(lerModoDoEditor()).toBe("complete");
    gravarModoDoEditor("simple");
    expect(lerModoDoEditor()).toBe("simple");
  });

  it("valor desconhecido vira Simples", () => {
    const a = armazenamento();
    a.mapa.set(CHAVE_DO_MODO_DO_EDITOR, "qualquer-coisa");
    vi.stubGlobal("localStorage", a.api);
    expect(lerModoDoEditor()).toBe("simple");
  });

  it("armazenamento que lança: lê Simples e grava sem estourar", () => {
    vi.stubGlobal("localStorage", armazenamento({ lanca: true }).api);
    expect(lerModoDoEditor()).toBe("simple");
    expect(() => gravarModoDoEditor("complete")).not.toThrow();
  });

  it("sem o objeto localStorage (ambiente restrito) também não quebra", () => {
    vi.stubGlobal("localStorage", undefined);
    expect(lerModoDoEditor()).toBe("simple");
    expect(() => gravarModoDoEditor("complete")).not.toThrow();
  });

  describe("modoAoAbrirOBanner", () => {
    it("banner novo segue o modo lembrado", () => {
      expect(modoAoAbrirOBanner(null, "simple")).toBe("simple");
      expect(modoAoAbrirOBanner(null, "complete")).toBe("complete");
      expect(modoAoAbrirOBanner(undefined, "complete")).toBe("complete");
    });

    it("banner sem texto segue o modo lembrado", () => {
      const semTexto = { title: "", subtitle: "  ", buttonText: "" };
      expect(modoAoAbrirOBanner(semTexto, "simple")).toBe("simple");
      expect(modoAoAbrirOBanner(semTexto, "complete")).toBe("complete");
    });

    it.each([
      ["título", { title: "Campanha" }],
      ["subtítulo", { subtitle: "Só hoje" }],
      ["botão", { buttonText: "Comprar" }],
      ["selo", { badgeText: "Novo" }],
    ])("banner com %s abre SEMPRE em Completo", (_nome, banner) => {
      expect(modoAoAbrirOBanner(banner, "simple")).toBe("complete");
      expect(modoAoAbrirOBanner(banner, "complete")).toBe("complete");
    });
  });
});

describe("AdminBannersView — o modo do editor é lembrado no aparelho", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
    lista.banners = [umBanner({ title: "Campanha Ativa" })];
    stubarDom();
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
    const { AdminBannersView } = await import("@/views/admin/AdminBannersView");
    await act(async () => {
      raiz.render(<AdminBannersView onNavigate={vi.fn()} active={true} />);
    });
    await act(async () => {
      await esperar();
    });
  }

  async function desmontarEMontarDeNovo() {
    await act(async () => {
      raiz.unmount();
    });
    raiz = createRoot(hospedeiro);
    await montar();
  }

  const botao = (texto: string) =>
    [...document.body.querySelectorAll("button")].find((b) =>
      b.textContent?.includes(texto),
    ) as HTMLButtonElement | undefined;

  async function clicar(el: HTMLElement | undefined | null) {
    expect(el).toBeTruthy();
    await act(async () => {
      el!.click();
    });
  }

  const abrirNovo = () => clicar(botao("Novo Banner"));
  const abrirEdicao = () =>
    clicar(document.body.querySelector<HTMLElement>('button[title="Editar"]'));

  /** O campo "Ordem" do editor Simples só existe no modo Simples. */
  const emModoSimples = () =>
    document.body.querySelector("#banner-simple-order") !== null;

  /** Sem o campo do modo Simples, o editor está no Completo. */
  const emModoCompleto = () => !emModoSimples();

  /** A troca de modo anima (AnimatePresence): espera a saída terminar. */
  const aguardarATroca = () =>
    act(async () => {
      await new Promise<void>((r) => setTimeout(r, 600));
    });

  it("primeira abertura (nada lembrado): banner novo abre em Simples", async () => {
    vi.stubGlobal("localStorage", armazenamento().api);
    await montar();
    await abrirNovo();
    expect(emModoSimples()).toBe(true);
  });

  it("abrir não grava nada: só o toque no alternador grava", async () => {
    const a = armazenamento();
    vi.stubGlobal("localStorage", a.api);
    await montar();
    await abrirNovo();
    expect(a.mapa.has(CHAVE_DO_MODO_DO_EDITOR)).toBe(false);

    await clicar(botao("Completo"));
    expect(a.mapa.get(CHAVE_DO_MODO_DO_EDITOR)).toBe("complete");
  });

  it("Completo escolhido é lembrado depois de remontar a tela", async () => {
    const a = armazenamento();
    vi.stubGlobal("localStorage", a.api);
    await montar();
    await abrirNovo();
    await clicar(botao("Completo"));
    await aguardarATroca();
    expect(emModoCompleto()).toBe(true);

    await desmontarEMontarDeNovo();
    await abrirNovo();
    expect(emModoCompleto()).toBe(true);
  });

  it("voltar para Simples também é lembrado", async () => {
    const a = armazenamento();
    a.mapa.set(CHAVE_DO_MODO_DO_EDITOR, "complete");
    vi.stubGlobal("localStorage", a.api);
    await montar();
    await abrirNovo();
    expect(emModoCompleto()).toBe(true);

    await clicar(botao("Simples"));
    await aguardarATroca();
    expect(emModoSimples()).toBe(true);
    expect(a.mapa.get(CHAVE_DO_MODO_DO_EDITOR)).toBe("simple");

    await desmontarEMontarDeNovo();
    await abrirNovo();
    expect(emModoSimples()).toBe(true);
  });

  it("banner COM título abre em Completo mesmo com 'simple' lembrado — salvar em Simples apagaria o texto", async () => {
    const a = armazenamento();
    a.mapa.set(CHAVE_DO_MODO_DO_EDITOR, "simple");
    vi.stubGlobal("localStorage", a.api);
    lista.banners = [umBanner({ title: "Campanha Ativa" })];
    await montar();
    await abrirEdicao();

    expect(emModoCompleto()).toBe(true);
    // Abrir não mexe na preferência do aparelho.
    expect(a.mapa.get(CHAVE_DO_MODO_DO_EDITOR)).toBe("simple");
  });

  it("banner com só o selo (sem título) também abre em Completo", async () => {
    const a = armazenamento();
    a.mapa.set(CHAVE_DO_MODO_DO_EDITOR, "simple");
    vi.stubGlobal("localStorage", a.api);
    lista.banners = [umBanner({ title: "", badgeText: "Novo" })];
    await montar();
    await abrirEdicao();

    expect(emModoCompleto()).toBe(true);
  });

  it("banner SEM texto segue o modo lembrado ao editar", async () => {
    const a = armazenamento();
    a.mapa.set(CHAVE_DO_MODO_DO_EDITOR, "complete");
    vi.stubGlobal("localStorage", a.api);
    lista.banners = [umBanner({ title: "" })];
    await montar();
    await abrirEdicao();
    expect(emModoCompleto()).toBe(true);

    await desmontarEMontarDeNovo();
    a.mapa.set(CHAVE_DO_MODO_DO_EDITOR, "simple");
    await abrirEdicao();
    expect(emModoSimples()).toBe(true);
  });

  it("valor desconhecido lembrado: banner novo abre em Simples", async () => {
    const a = armazenamento();
    a.mapa.set(CHAVE_DO_MODO_DO_EDITOR, "ultra");
    vi.stubGlobal("localStorage", a.api);
    await montar();
    await abrirNovo();
    expect(emModoSimples()).toBe(true);
  });

  it("localStorage que lança ao ler e gravar o modo não quebra a tela", async () => {
    vi.stubGlobal(
      "localStorage",
      armazenamento({ lanca: true, soNaChave: CHAVE_DO_MODO_DO_EDITOR }).api,
    );
    await montar();
    await abrirNovo();
    expect(emModoSimples()).toBe(true);

    // Tocar no alternador troca o modo na tela mesmo sem conseguir lembrar.
    await clicar(botao("Completo"));
    await aguardarATroca();
    expect(emModoCompleto()).toBe(true);
  });
});
