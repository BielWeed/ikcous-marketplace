// @vitest-environment jsdom
//
// Lista premium, Lote F (plano de 26/11/2026): os `<select>` nativos da tela de
// Banners viraram a lista de escolha do painel (`primitivos/lista-de-escolha`).
// Aqui a lojista escolhe como faz na tela — toca no campo, toca na opção — e o
// teste prova que a escolha chega ao banner:
//
//  F.1 Situação filtra a lista de banners.
//  F.2 Onde aparece troca a seção e recalcula a ordem.
//  F.3 Disposição, Fonte e O que colorir gravam o que foi escolhido.
//  F.4 Combinações prontas é MODO AÇÃO: aplica as cores, volta a mostrar
//      "Escolha uma combinação", a linha de baixo é a descrição e escolher a
//      mesma de novo reaplica (o `<select>` nativo não disparava nada aí).
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { abrirMaisOpcoes, configurarTextos } from "./helpers/editor-de-banner";
import {
  escolherNaLista,
  opcoesDaLista,
  valorDaLista,
} from "./helpers/lista-de-escolha";

const updateBanner = vi.fn();

const bannerDe = (
  n: number,
  position: "home_top" | "home_middle",
  extra: Record<string, unknown> = {},
) => ({
  id: `banner-${position}-${n}`,
  imageUrl: `https://proj.supabase.co/storage/v1/object/public/banners/${position}-${n}.jpg`,
  title: `Banner ${position} ${n}`,
  link: "",
  position,
  active: true,
  order: n,
  ...extra,
});
const estado = {
  banners: [] as ReturnType<typeof bannerDe>[],
};

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: "lojista-1" } }),
}));

vi.mock("@/hooks/useBanners", () => ({
  useBanners: () => ({
    banners: estado.banners,
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

vi.mock("@/hooks/useCoupons", () => ({
  useCoupons: () => ({}),
}));

vi.mock("@/hooks/useCategories", () => ({
  useCategories: () => ({ categories: [] }),
}));

vi.mock("@/hooks/useOnlineStatus", () => ({
  useOnlineStatus: () => false,
}));

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: { primaryColor: "#FFBF00" } }),
}));

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
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

function esperarMicrotarefas(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe("Banners — lista de escolha no lugar dos selects (Lote F)", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
    estado.banners = [];
    vi.stubGlobal("IntersectionObserver", ObservadorFalso);
    vi.stubGlobal("ResizeObserver", ObservadorFalso);
    // Celular: a lista sobe como folha de baixo.
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
      getItem: (chave: string) => armazem.get(chave) ?? null,
      setItem: (chave: string, valor: string) => {
        armazem.set(chave, valor);
      },
      removeItem: (chave: string) => {
        armazem.delete(chave);
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

  async function renderizar() {
    const { AdminBannersView } = await import("@/views/admin/AdminBannersView");
    await act(async () => {
      raiz.render(
        <AdminBannersView
          onNavigate={vi.fn()}
          active={true}
          onSetBackOverride={vi.fn()}
        />,
      );
    });
    await act(async () => {
      await esperarMicrotarefas();
    });
  }

  async function escolher(id: string, valor: string) {
    await act(async () => {
      escolherNaLista(id, valor);
    });
  }

  async function editarOPrimeiro() {
    const editar = document.querySelector<HTMLButtonElement>(
      'button[title="Editar"]',
    );
    expect(editar).toBeTruthy();
    await act(async () => editar!.click());
  }

  async function abrirCores() {
    const resumo = [...document.querySelectorAll("summary")].find(
      (s) => s.textContent?.trim() === "Cores e filtro da imagem",
    );
    expect(resumo).toBeTruthy();
    if (!resumo!.parentElement!.hasAttribute("open")) {
      await act(async () => resumo!.click());
    }
  }

  async function salvar() {
    const botao = [...document.querySelectorAll("button")].find(
      (b) => b.textContent?.trim() === "Salvar Alterações",
    );
    expect(botao).toBeTruthy();
    await act(async () => botao!.click());
    await act(async () => {
      await esperarMicrotarefas();
    });
  }

  const corPersonalizada = () =>
    document.querySelector<HTMLInputElement>(
      'input[aria-label="Cor personalizada"]',
    )!;

  it("nenhum <select> nativo sobra na tela de Banners", async () => {
    estado.banners = [bannerDe(1, "home_top", { buttonText: "Comprar" })];
    await renderizar();
    expect(document.querySelectorAll("select")).toHaveLength(0);
    await editarOPrimeiro();
    await configurarTextos(true);
    await abrirCores();
    expect(document.querySelectorAll("select")).toHaveLength(0);
    for (const id of [
      "banner-position",
      "banner-old-layout",
      "banner-font",
      "banner-color-element",
      "banner-theme",
    ]) {
      expect(
        document.getElementById(id)?.getAttribute("aria-haspopup"),
        id,
      ).toBe("listbox");
    }
  });

  it("F.1 Situação: as cinco situações e a escolha filtra a lista", async () => {
    estado.banners = [
      bannerDe(1, "home_top", { title: "Alfa ligado" }),
      bannerDe(2, "home_top", { title: "Beta pausado", active: false }),
    ];
    await renderizar();
    expect(valorDaLista("banner-status-filter")).toBe("all");
    expect(opcoesDaLista("banner-status-filter")).toEqual([
      { valor: "all", rotulo: "Todos", desabilitada: false },
      { valor: "active", rotulo: "No ar", desabilitada: false },
      { valor: "paused", rotulo: "Pausados", desabilitada: false },
      { valor: "scheduled", rotulo: "Agendados", desabilitada: false },
      { valor: "expired", rotulo: "Expirados", desabilitada: false },
    ]);
    expect(hospedeiro.textContent).toContain("Alfa ligado");
    expect(hospedeiro.textContent).toContain("Beta pausado");

    await escolher("banner-status-filter", "paused");
    expect(valorDaLista("banner-status-filter")).toBe("paused");
    expect(hospedeiro.textContent).not.toContain("Alfa ligado");
    expect(hospedeiro.textContent).toContain("Beta pausado");
  });

  it("F.2 Onde aparece: troca a seção e a ordem vai para o fim da nova", async () => {
    estado.banners = [
      bannerDe(1, "home_top"),
      bannerDe(1, "home_middle"),
      bannerDe(2, "home_middle"),
    ];
    await renderizar();
    await editarOPrimeiro();
    await abrirMaisOpcoes();
    expect(valorDaLista("banner-position")).toBe("home_top");
    expect(opcoesDaLista("banner-position").map((o) => o.valor)).toEqual([
      "home_top",
      "home_middle",
      "home_bottom",
    ]);

    await escolher("banner-position", "home_middle");
    expect(valorDaLista("banner-position")).toBe("home_middle");
    expect(
      document.querySelector<HTMLInputElement>(
        "#banner-order, #banner-simple-order",
      )!.value,
    ).toBe("3");
  });

  it("F.3 Disposição, Fonte e O que colorir: a escolha chega ao banner salvo", async () => {
    estado.banners = [bannerDe(1, "home_top", { buttonText: "Comprar" })];
    await renderizar();
    await editarOPrimeiro();
    await configurarTextos(true);
    expect(valorDaLista("banner-old-layout")).toBe("default");
    expect(valorDaLista("banner-font")).toBe("system");

    await escolher("banner-old-layout", "split_center");
    await escolher("banner-font", "font-serif");
    expect(valorDaLista("banner-old-layout")).toBe("split_center");
    expect(valorDaLista("banner-font")).toBe("font-serif");

    await abrirCores();
    expect(valorDaLista("banner-color-element")).toBe("titleColor");
    // Com texto no botão, as cores do botão também aparecem.
    expect(opcoesDaLista("banner-color-element").map((o) => o.rotulo)).toEqual([
      "Título",
      "Subtítulo",
      "Fundo Botão",
      "Texto Botão",
      "Filtro Fundo",
    ]);
    await escolher("banner-color-element", "overlayColor");
    expect(valorDaLista("banner-color-element")).toBe("overlayColor");
    // A cor personalizada passa a mexer no filtro do fundo.
    await act(async () => {
      const cor = corPersonalizada();
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set?.call(cor, "#123456");
      cor.dispatchEvent(new Event("input", { bubbles: true }));
    });

    await salvar();
    expect(updateBanner).toHaveBeenCalledTimes(1);
    expect(updateBanner.mock.calls[0][1]).toMatchObject({
      templateType: "split_center",
      fontFamily: "font-serif",
      overlayColor: "#123456",
    });
  });

  it("F.4 Combinações: modo ação aplica as cores, volta ao convite e reaplica", async () => {
    estado.banners = [bannerDe(1, "home_top")];
    await renderizar();
    await editarOPrimeiro();
    await configurarTextos(true);
    await abrirCores();

    const campo = document.getElementById("banner-theme")!;
    expect(campo.textContent).toContain("Escolha uma combinação");
    expect(valorDaLista("banner-theme")).toBe("");

    // A linha de baixo de cada combinação é a descrição dela.
    act(() => campo.click());
    const opcao = document.querySelector<HTMLElement>(
      '#banner-theme-lista [data-valor="Neon Cyber"]',
    );
    expect(opcao?.textContent).toContain("Visual futurista rosa e violeta");
    // Nada fica marcado no modo ação.
    expect(
      document.querySelectorAll(
        '#banner-theme-lista [role="option"][aria-selected="true"]',
      ),
    ).toHaveLength(0);
    // Esc fecha SÓ a lista: o editor de baixo (que também ouve Esc, na
    // janela) continua aberto.
    await act(async () => {
      document.getElementById("banner-theme-lista")!.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Escape",
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    expect(document.getElementById("banner-theme-lista")).toBeNull();
    expect(document.getElementById("banner-theme")).not.toBeNull();

    await escolher("banner-theme", "Dourado Premium");
    expect(corPersonalizada().value.toUpperCase()).toBe("#FFBF00");
    expect(campo.textContent).toContain("Escolha uma combinação");
    expect(valorDaLista("banner-theme")).toBe("");
    expect(valorDaLista("banner-old-layout")).toBe("glassmorphic");
    expect(valorDaLista("banner-font")).toBe("font-display");

    // A lojista mexe na cor e escolhe a MESMA combinação: volta a valer.
    await act(async () => {
      const cor = corPersonalizada();
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set?.call(cor, "#123456");
      cor.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(corPersonalizada().value).toBe("#123456");
    await escolher("banner-theme", "Dourado Premium");
    expect(corPersonalizada().value.toUpperCase()).toBe("#FFBF00");
    expect(campo.textContent).toContain("Escolha uma combinação");
  });
});
