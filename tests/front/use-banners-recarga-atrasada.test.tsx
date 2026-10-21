// @vitest-environment jsdom
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  consultar: vi.fn(),
  atualizar: vi.fn(),
  persistir: vi.fn(),
}));
vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => ({
      select: () => ({ order: h.consultar }),
      update: h.atualizar,
    }),
  },
}));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ isAdmin: true }) }));
vi.mock("@/hooks/useDataVault", () => ({ useSyncListener: () => {} }));
vi.mock("@/lib/dataVault", () => ({
  DataVault: {
    init: async () => ({
      getAll: async () => [],
      replaceAll: h.persistir,
      setLastSync: vi.fn(),
    }),
  },
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const linha = {
  id: "banner-ficticio",
  title: "Antigo",
  image_url: "https://example.com/banner.png",
  position: "home_top",
  active: true,
  order: 1,
};

describe("banners — recarga anterior à edição", () => {
  const raizes: Root[] = [];
  const alvos: HTMLDivElement[] = [];
  let useBanners: typeof import("@/hooks/useBanners").useBanners;
  async function montar() {
    let atual!: ReturnType<typeof useBanners>;
    function Sonda() {
      const hook = useBanners(true);
      useEffect(() => {
        atual = hook;
      });
      return null;
    }
    const alvo = document.createElement("div");
    document.body.appendChild(alvo);
    const raiz = createRoot(alvo);
    raizes.push(raiz);
    alvos.push(alvo);
    await act(async () => raiz.render(<Sonda />));
    return () => atual;
  }

  beforeEach(async () => {
    vi.resetModules();
    h.consultar.mockReset().mockResolvedValue({ data: [linha], error: null });
    h.atualizar.mockReset().mockReturnValue({
      eq: vi.fn().mockResolvedValue({ error: null }),
    });
    h.persistir.mockReset().mockResolvedValue(undefined);
    ({ useBanners } = await import("@/hooks/useBanners"));
  });
  afterEach(() => {
    act(() => {
      for (const raiz of raizes.splice(0)) raiz.unmount();
    });
    for (const alvo of alvos.splice(0)) alvo.remove();
  });

  it("resposta velha não desfaz o título salvo no painel, cache, cofre nem consumidor em espera", async () => {
    const painel = await montar();
    const home = await montar();
    expect(painel().banners[0].title).toBe("Antigo");
    let liberar!: (valor: unknown) => void;
    const leitura = new Promise((resolve) => {
      liberar = resolve;
    });
    h.consultar.mockReturnValueOnce(leitura);
    let recarga!: Promise<void>;
    let compartilhada!: Promise<void>;
    await act(async () => {
      recarga = painel().refreshBanners(false, true);
      compartilhada = home().refreshBanners(false, true);
    });
    expect(h.consultar).toHaveBeenCalledTimes(2);
    await act(async () => {
      await painel().updateBanner(linha.id, { title: "Novo" });
    });
    expect(h.atualizar).toHaveBeenCalledWith({ title: "Novo" });
    expect(painel().banners[0].title).toBe("Novo");
    h.persistir.mockClear();
    await act(async () => {
      liberar({ data: [linha], error: null });
      await Promise.all([recarga, compartilhada]);
    });
    expect(painel().banners[0].title).toBe("Novo");
    expect(home().banners[0].title).toBe("Novo");
    expect(h.persistir).not.toHaveBeenCalled();
    const proximo = await montar();
    expect(proximo().banners[0].title).toBe("Novo");
    expect(h.consultar).toHaveBeenCalledTimes(2);
  });
});
