// @vitest-environment jsdom
//
// Excluir um produto deixa o banner dele no ar: a cliente toca e cai na Home
// com "Este produto não está mais disponível". A lista de Banners só avisava
// produto PAUSADO (a lista de produtos é paginada: "não achei" não prova
// exclusão). Agora o painel pergunta ao banco, por id e só dos produtos que os
// banners apontam, e avisa no cartão quando o banco CONFIRMA a exclusão.
//
// Falha, demora ou resposta vazia contam como "não sei": sem aviso (a tela da
// lojista nunca ganha um aviso falso). O aviso não desliga nem apaga banner.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ID_EXCLUIDO = "11111111-1111-4111-8111-111111111111";
const ID_VIVO = "22222222-2222-4222-8222-222222222222";
const ID_SUMIDO = "33333333-3333-4333-8333-333333333333";

const h = vi.hoisted(() => ({
  banners: [] as unknown[],
  consulta: vi.fn(),
  updateBanner: vi.fn(),
  deleteBanner: vi.fn(),
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: (tabela: string) => ({
      select: (colunas: string) => ({
        in: (coluna: string, ids: string[]) =>
          h.consulta(tabela, colunas, coluna, ids),
      }),
    }),
  },
}));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: "lojista-1" } }),
}));
vi.mock("@/hooks/useBanners", () => ({
  useBanners: () => ({
    banners: h.banners,
    isLoaded: true,
    uploadBannerImage: vi.fn(),
    addBanner: vi.fn(),
    updateBanner: h.updateBanner,
    deleteBanner: h.deleteBanner,
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
    warning: vi.fn(),
    loading: vi.fn(() => "t"),
    dismiss: vi.fn(),
  },
}));

class ObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const AVISO_EXCLUIDO =
  "O produto deste banner foi excluído: o toque no banner leva à Home";

const banner = (id: string, title: string, produto: string | null) => ({
  id,
  imageUrl: `https://loja.test/${id}.jpg`,
  title,
  link: produto ? `/product-detail?id=${produto}` : "/",
  position: "home_top" as const,
  active: true,
  order: 1,
});

const esperar = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe("AdminBannersView — banner de produto excluído", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
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
    h.banners = [
      banner("b-excluido", "Banner do excluído", ID_EXCLUIDO),
      banner("b-vivo", "Banner do vivo", ID_VIVO),
      banner("b-sem-produto", "Banner sem produto", null),
    ];
    h.consulta.mockReset().mockResolvedValue({
      data: [
        { id: ID_EXCLUIDO, deleted_at: "2026-11-01T10:00:00Z" },
        { id: ID_VIVO, deleted_at: null },
      ],
      error: null,
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
    vi.useRealTimers();
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
      await esperar();
    });
  }

  /** O cartão que contém o título (cada cartão tem o botão "Editar banner <título>"). */
  function cartaoDe(titulo: string): HTMLElement {
    const editar = document.querySelector(
      `button[aria-label="Editar banner ${titulo}"]`,
    );
    expect(editar, `cartão "${titulo}"`).not.toBeNull();
    // Sobe até o cartão inteiro (o que também guarda o texto do aviso).
    let no: HTMLElement | null = editar as HTMLElement;
    while (no && !no.textContent?.includes(titulo)) no = no.parentElement;
    while (
      no?.parentElement &&
      no.parentElement.querySelectorAll('button[title="Editar"]').length === 1
    ) {
      no = no.parentElement;
    }
    return no as HTMLElement;
  }

  it("avisa no cartão do banner cujo produto o banco confirma excluído", async () => {
    await montar();

    expect(cartaoDe("Banner do excluído").textContent).toContain(
      AVISO_EXCLUIDO,
    );
    expect(cartaoDe("Banner do vivo").textContent).not.toContain(
      AVISO_EXCLUIDO,
    );
    expect(cartaoDe("Banner sem produto").textContent).not.toContain(
      AVISO_EXCLUIDO,
    );
  });

  it("faz UMA consulta pequena: só os ids dos produtos dos banners, no painel", async () => {
    await montar();

    expect(h.consulta).toHaveBeenCalledTimes(1);
    const [tabela, colunas, coluna, ids] = h.consulta.mock.calls[0];
    expect(tabela).toBe("vw_produtos_admin");
    expect(colunas).toBe("id, deleted_at");
    expect(coluna).toBe("id");
    expect([...ids].sort()).toEqual([ID_EXCLUIDO, ID_VIVO].sort());
  });

  it("não desliga nem apaga banner sozinho", async () => {
    await montar();

    expect(h.updateBanner).not.toHaveBeenCalled();
    expect(h.deleteBanner).not.toHaveBeenCalled();
  });

  it("produto que o banco NÃO devolve é 'não sei': sem aviso", async () => {
    h.banners = [banner("b-sumido", "Banner do sumido", ID_SUMIDO)];
    h.consulta.mockResolvedValue({ data: [], error: null });
    await montar();

    expect(h.consulta).toHaveBeenCalledTimes(1);
    expect(document.body.textContent).not.toContain(AVISO_EXCLUIDO);
  });

  it("consulta que falha é 'não sei': sem aviso e sem quebrar a tela", async () => {
    // Resposta com erro nunca vale, nem que traga linhas junto.
    h.consulta.mockResolvedValue({
      data: [{ id: ID_EXCLUIDO, deleted_at: "2026-11-01T10:00:00Z" }],
      error: { message: "boom" },
    });
    await montar();

    expect(h.consulta).toHaveBeenCalledTimes(1);
    expect(document.body.textContent).not.toContain(AVISO_EXCLUIDO);
    expect(cartaoDe("Banner do excluído")).toBeDefined();
  });

  it("consulta que rejeita é 'não sei': sem aviso e sem quebrar a tela", async () => {
    h.consulta.mockRejectedValue(new Error("rede caiu"));
    await montar();

    expect(document.body.textContent).not.toContain(AVISO_EXCLUIDO);
    expect(cartaoDe("Banner do vivo")).toBeDefined();
  });

  it("consulta que pendura é 'não sei': passado o prazo, sem aviso", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    h.consulta.mockImplementation(() => new Promise<never>(() => {}));
    const { AdminBannersView } = await import("@/views/admin/AdminBannersView");
    await act(async () => {
      raiz.render(<AdminBannersView onNavigate={vi.fn()} active={true} />);
      await vi.advanceTimersByTimeAsync(0);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });

    expect(h.consulta).toHaveBeenCalledTimes(1);
    expect(document.body.textContent).not.toContain(AVISO_EXCLUIDO);
  });

  it("banner sem link de produto não faz consulta nenhuma", async () => {
    h.banners = [banner("b-sem-produto", "Banner sem produto", null)];
    await montar();

    expect(h.consulta).not.toHaveBeenCalled();
  });

  it("id que não parece id de produto não entra na consulta", async () => {
    h.banners = [
      banner("b-torto", "Banner torto", "nao-e-um-uuid"),
      banner("b-excluido", "Banner do excluído", ID_EXCLUIDO),
    ];
    await montar();

    expect(h.consulta).toHaveBeenCalledTimes(1);
    expect(h.consulta.mock.calls[0][3]).toEqual([ID_EXCLUIDO]);
  });
});
