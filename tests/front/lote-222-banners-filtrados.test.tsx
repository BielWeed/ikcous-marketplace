// @vitest-environment jsdom
//
// Lote 222 (M3): filtrar não pode oferecer "Adicionar Primeiro Banner" numa
// posição que TEM banners, e o contador usa o singular.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const addBanner = vi.fn();
const updateBanner = vi.fn();
const deleteStorageFile = vi.fn();
const uploadBannerImage = vi.fn();
const onNavigate = vi.fn();

// Só precisa de um banner publicado para o botão "Novo Banner" renderizar
// (AdminBannersView: `isLoaded && banners.length > 0`).
const base = {
  id: "banner-existente-1",
  imageUrl:
    "https://proj.supabase.co/storage/v1/object/public/banners/banner-publicado-na-home.jpg",
  title: "Campanha Ativa",
  link: "",
  position: "home_top" as const,
  active: true,
  order: 1,
};
const BANNERS = [
  { ...base, id: "b1", title: "Alfa", position: "home_top" as const, order: 1 },
  {
    ...base,
    id: "b2",
    title: "Alfa dois",
    position: "home_top" as const,
    order: 2,
  },
  {
    ...base,
    id: "b3",
    title: "Beta",
    position: "home_middle" as const,
    order: 1,
  },
];

// L10: o rascunho do formulário de banner é do usuário (`:<uid>`) — a tela
// agora lê o hook de auth, dublado aqui.
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: "lojista-1" } }),
}));

vi.mock("@/hooks/useBanners", () => ({
  useBanners: () => ({
    banners: BANNERS,
    isLoaded: true,
    uploadBannerImage,
    addBanner,
    updateBanner,
    deleteBanner: vi.fn(),
    deleteStorageFile,
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

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function esperarMicrotarefas(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe("lote 222 — banners filtrados", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("IntersectionObserver", IntersectionObserverStub);
    vi.stubGlobal("ResizeObserver", ResizeObserverStub);
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

  async function montar() {
    const { AdminBannersView } = await import("@/views/admin/AdminBannersView");
    await act(async () => {
      raiz.render(
        <AdminBannersView
          onNavigate={onNavigate}
          active={true}
          onSetBackOverride={vi.fn()}
        />,
      );
    });
    await act(async () => {
      await esperarMicrotarefas();
    });
  }

  async function buscar(texto: string) {
    const campo = hospedeiro.querySelector<HTMLInputElement>(
      "#banner-search-input",
    ) as HTMLInputElement;
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set?.call(campo, texto);
      campo.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }

  function secao(rotulo: string): HTMLElement {
    const h2 = [...hospedeiro.querySelectorAll("h2")].find((h) =>
      h.textContent?.includes(rotulo),
    ) as HTMLElement;
    return h2.parentElement as HTMLElement;
  }

  it("posição com banner que o filtro esconde diz 'Nenhum banner com este filtro'", async () => {
    await montar();
    await buscar("Alfa");
    const meio = secao("Seção Intermediária").textContent ?? "";
    expect(meio).toContain("Nenhum banner com este filtro");
    expect(meio).not.toContain("Adicionar Primeiro Banner");
    // posição realmente vazia continua convidando a criar o primeiro
    expect(secao("Rodapé da Página").textContent).toContain(
      "Adicionar Primeiro Banner",
    );
  });

  it("contador no singular e no plural", async () => {
    await montar();
    expect(secao("Seção Intermediária").textContent).toContain("1 banner");
    expect(secao("Seção Intermediária").textContent).not.toContain("1 banners");
    expect(secao("Cabeçalho Inicial").textContent).toContain("2 banners");
  });
});
