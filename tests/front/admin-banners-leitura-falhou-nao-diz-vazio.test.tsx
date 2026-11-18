// @vitest-environment jsdom
//
// TELA DE BANNERS: leitura que FALHOU não é "Nenhum Banner encontrado". Antes,
// a consulta que falhava deixava a tela dizer que a loja estava sem banner e
// sugerir criar o primeiro — a lojista criava duplicados. Agora a tela avisa
// que não deu para carregar, oferece "Tentar de novo", e reserva o texto de
// lista vazia para a consulta que funcionou e veio vazia.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  banners: [] as Array<Record<string, unknown>>,
  erroDeLeitura: false,
  // O que a PRÓXIMA releitura entrega: lista, ou `null` para falhar de novo.
  proximaLeitura: null as Array<Record<string, unknown>> | null,
  releitura: vi.fn(),
}));

const bannerSalvo = {
  id: "banner-existente-1",
  imageUrl:
    "https://proj.supabase.co/storage/v1/object/public/banners/banner-publicado-na-home.jpg",
  title: "Campanha Ativa",
  link: "",
  position: "home_top" as const,
  active: true,
  order: 1,
};

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: "lojista-1" } }),
}));

vi.mock("@/hooks/useBanners", async () => {
  const { useState } = await import("react");
  return {
    useBanners: () => {
      const [, redesenhar] = useState(0);
      return {
        banners: h.banners,
        isLoaded: true,
        erroDeLeitura: h.erroDeLeitura,
        uploadBannerImage: vi.fn(),
        addBanner: vi.fn(),
        updateBanner: vi.fn(),
        deleteBanner: vi.fn(),
        deleteStorageFile: vi.fn(),
        reorderBanners: vi.fn(),
        refreshBanners: async (...args: unknown[]) => {
          h.releitura(...args);
          if (h.proximaLeitura) {
            h.banners = h.proximaLeitura;
            h.erroDeLeitura = false;
          }
          redesenhar((n) => n + 1);
        },
      };
    },
  };
});

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
  toast: { success: vi.fn(), error: vi.fn(), loading: vi.fn(() => "toast-id") },
}));

class ObservadorStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function esperarMicrotarefas(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe("AdminBannersView — leitura que falhou não diz que está vazio", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
    h.banners = [];
    h.erroDeLeitura = false;
    h.proximaLeitura = null;
    vi.stubGlobal("IntersectionObserver", ObservadorStub);
    vi.stubGlobal("ResizeObserver", ObservadorStub);
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

  const botaoTentar = () =>
    [...hospedeiro.querySelectorAll("button")].find((b) =>
      /tentar de novo/i.test(b.textContent ?? ""),
    );

  it("consulta falhou e não há banner: avisa e NÃO diz 'Nenhum Banner encontrado'", async () => {
    h.erroDeLeitura = true;
    await montar();
    const aviso = hospedeiro.querySelector('[role="alert"]');
    expect(aviso?.textContent).toContain(
      "Não foi possível carregar os banners. Verifique a internet e tente de novo.",
    );
    expect(botaoTentar()).toBeTruthy();
    expect(hospedeiro.textContent).not.toContain("Nenhum Banner encontrado");
    expect(hospedeiro.textContent).not.toContain("Crie seu primeiro banner");
  });

  it("'Tentar de novo' refaz a leitura e, quando responde, a lista aparece", async () => {
    h.erroDeLeitura = true;
    h.proximaLeitura = [bannerSalvo];
    await montar();
    await act(async () => {
      botaoTentar()?.click();
      await esperarMicrotarefas();
    });
    expect(h.releitura).toHaveBeenCalledTimes(1);
    expect(hospedeiro.textContent).toContain("Campanha Ativa");
    expect(hospedeiro.querySelector('[role="alert"]')).toBeNull();
    expect(botaoTentar()).toBeUndefined();
  });

  it("releitura que falha de novo mantém o aviso e o botão", async () => {
    h.erroDeLeitura = true;
    await montar();
    await act(async () => {
      botaoTentar()?.click();
      await esperarMicrotarefas();
    });
    expect(h.releitura).toHaveBeenCalledTimes(1);
    expect(hospedeiro.querySelector('[role="alert"]')).toBeTruthy();
    expect(botaoTentar()).toBeTruthy();
  });

  it("consulta que funcionou e veio vazia: 'Nenhum Banner encontrado' e sem aviso", async () => {
    await montar();
    expect(hospedeiro.textContent).toContain("Nenhum Banner encontrado");
    expect(hospedeiro.textContent).toContain("Crie seu primeiro banner");
    expect(hospedeiro.querySelector('[role="alert"]')).toBeNull();
    expect(botaoTentar()).toBeUndefined();
  });

  it("falhou mas há banners salvos no aparelho: a lista continua, sem esconder nada", async () => {
    h.banners = [bannerSalvo];
    h.erroDeLeitura = true;
    await montar();
    expect(hospedeiro.textContent).toContain("Campanha Ativa");
    expect(hospedeiro.textContent).not.toContain("Nenhum Banner encontrado");
  });
});
