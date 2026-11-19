// @vitest-environment jsdom
import type { Banner } from "@/types";
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ consultar: vi.fn() }));
vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => ({ select: () => ({ order: () => ({ order: h.consultar }) }) }),
  },
}));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ isAdmin: false }) }));
vi.mock("@/hooks/useDataVault", () => ({ useSyncListener: () => {} }));
vi.mock("@/lib/dataVault", () => ({
  DataVault: {
    init: async () => ({
      getAll: async () => [],
      replaceAll: vi.fn(),
      setLastSync: vi.fn(),
    }),
  },
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function banner(id: string, order: number): Banner {
  return {
    id,
    order,
    title: id,
    imageUrl: "https://example.com/banner.webp",
    desktopImageUrl: "https://example.com/banner-pc.webp",
    position: "home_top",
    active: true,
  };
}

describe("vitrine respeita a ordem dos banners definida no painel", () => {
  let raiz: Root;
  let alvo: HTMLDivElement;

  beforeEach(() => {
    vi.resetModules();
    h.consultar.mockReset();
    alvo = document.createElement("div");
    document.body.append(alvo);
    raiz = createRoot(alvo);
  });

  afterEach(() => {
    act(() => raiz.unmount());
    alvo.remove();
  });

  async function montar(items: Banner[]) {
    const { gravarBannersLocais } = await import("@/lib/banners-da-vitrine");
    gravarBannersLocais(items);
    const { useBanners } = await import("@/hooks/useBanners");
    const estado: { atual?: ReturnType<typeof useBanners> } = {};
    function Sonda() {
      const hook = useBanners(false);
      useEffect(() => {
        estado.atual = hook;
      });
      return null;
    }
    await act(async () => raiz.render(<Sonda />));
    expect(h.consultar).not.toHaveBeenCalled();
    // O cache continua fora de ordem: é a seleção da vitrine que deve ordenar.
    expect(estado.atual?.banners.map((b) => b.id)).toEqual(
      items.map((b) => b.id),
    );
    return estado.atual!.getBannersByPosition("home_top").map((b) => b.id);
  }

  it("ordena pelo campo order mesmo quando o cache chega como C, A, B", async () => {
    expect(
      await montar([banner("C", 3), banner("A", 1), banner("B", 2)]),
    ).toEqual(["A", "B", "C"]);
  });

  it.each([
    ["A", "B"],
    ["B", "A"],
  ])(
    "desempata pelo id quando o cache chega como %s, %s",
    async (primeiro, segundo) => {
      expect(
        await montar([banner("C", 2), banner(primeiro, 1), banner(segundo, 1)]),
      ).toEqual(["A", "B", "C"]);
    },
  );
});
