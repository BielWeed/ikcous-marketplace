import { useBanners } from "@/hooks/useBanners";
import type { Banner } from "@/types";
// @vitest-environment jsdom
// Exercita o hook real: mutar order quebra objetos congelados; ignorar .error
// ou capturar o snapshot tarde deixa a tela e o vault com a ordem errada.
import { act, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  linhas: [] as unknown[],
  update: vi.fn(),
  rpc: vi.fn(),
  replaceAll: vi.fn(),
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => ({
      select: () => ({
        order: () => Promise.resolve({ data: h.linhas, error: null }),
      }),
      update: (valores: { order: number }) => ({
        eq: (coluna: string, id: string) => h.update(valores, coluna, id),
      }),
    }),
    rpc: h.rpc,
  },
}));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ isAdmin: true }) }));
vi.mock("@/hooks/useDataVault", () => ({ useSyncListener: () => {} }));
vi.mock("@/lib/dataVault", () => ({
  DataVault: {
    init: vi.fn().mockResolvedValue({
      getAll: vi.fn().mockResolvedValue([]),
      replaceAll: h.replaceAll,
      setLastSync: vi.fn(),
    }),
  },
}));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

// @ts-expect-error flag interna do React, como nos testes vizinhos.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const desmontagens: (() => Promise<void>)[] = [];

async function montarPainel(ordens: number[] = [7, 7]) {
  h.linhas = ordens.map((order, idx) => ({
    id: idx === 0 ? "banner-a" : "banner-b",
    image_url: "https://exemplo.com/banner.png",
    title: "Oferta",
    position: "home_top",
    active: true,
    order,
  }));
  const hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  const raiz = createRoot(hospedeiro);
  let captura: ReturnType<typeof useBanners> | undefined;
  const ler = () => {
    if (!captura) throw new Error("sonda não capturou useBanners");
    return captura;
  };
  function Sonda() {
    const hook = useBanners(true);
    useEffect(() => {
      captura = hook;
    });
    return null;
  }
  desmontagens.push(async () => {
    await act(async () => raiz.unmount());
    hospedeiro.remove();
  });
  await act(async () => raiz.render(<Sonda />));
  // Cada caso carrega sua lista pela API pública, mesmo com cache do anterior.
  await act(async () => ler().refreshBanners(false, true));
  h.replaceAll.mockClear();
  return ler;
}

const ordensPorId = (banners: Banner[]) =>
  Object.fromEntries(banners.map((b) => [b.id, b.order]));

describe("reordenar banner sem mutar o estado", () => {
  beforeEach(() => {
    h.update.mockReset().mockResolvedValue({ error: null });
    h.rpc.mockReset().mockResolvedValue({ error: null });
    h.replaceAll.mockReset().mockResolvedValue(undefined);
  });
  afterEach(async () => {
    for (const desmontar of desmontagens.splice(0)) await desmontar();
  });

  it("normaliza e troca banners congelados sem alterar os objetos originais", async () => {
    const painel = await montarPainel();
    const originais = painel().banners;
    for (const banner of originais) Object.freeze(banner);
    await act(async () => painel().reorderBanners("banner-a", "banner-b"));

    expect(originais.every(Object.isFrozen)).toBe(true);
    expect(ordensPorId(originais)).toEqual({ "banner-a": 7, "banner-b": 7 });
    expect(ordensPorId(painel().banners)).toEqual({
      "banner-a": 2,
      "banner-b": 1,
    });
    for (const banner of painel().banners) {
      expect(banner).not.toBe(originais.find((b) => b.id === banner.id));
    }
    expect(h.update).toHaveBeenCalledWith({ order: 1 }, "id", "banner-a");
    expect(h.update).toHaveBeenCalledWith({ order: 2 }, "id", "banner-b");
    expect(h.rpc).toHaveBeenCalledWith("swap_banner_order", {
      banner_id_1: "banner-a",
      banner_id_2: "banner-b",
    });
  });

  it("erro resolvido na normalização restaura o snapshot na tela e no vault", async () => {
    const painel = await montarPainel();
    const snapshot = painel().banners.map((b) => ({ ...b }));
    h.update
      .mockResolvedValueOnce({ error: null })
      .mockResolvedValueOnce({ error: { message: "x" } });
    await act(async () => painel().reorderBanners("banner-a", "banner-b"));

    expect(painel().banners).toEqual(snapshot);
    expect(h.replaceAll).toHaveBeenLastCalledWith("banners", snapshot);
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it("falha da troca após normalizar restaura as ordens anteriores à normalização", async () => {
    const painel = await montarPainel();
    const snapshot = painel().banners.map((b) => ({ ...b }));
    h.rpc.mockResolvedValueOnce({ error: { message: "troca recusada" } });
    await act(async () => painel().reorderBanners("banner-a", "banner-b"));

    expect(painel().banners).toEqual(snapshot);
    expect(h.replaceAll).toHaveBeenLastCalledWith("banners", snapshot);
    expect(h.rpc).toHaveBeenCalledTimes(1);
  });

  it("continua trocando as ordens quando não existe colisão", async () => {
    const painel = await montarPainel([3, 8]);
    await act(async () => painel().reorderBanners("banner-a", "banner-b"));

    expect(ordensPorId(painel().banners)).toEqual({
      "banner-a": 8,
      "banner-b": 3,
    });
    expect(h.replaceAll).toHaveBeenLastCalledWith("banners", painel().banners);
    expect(h.update).not.toHaveBeenCalled();
    expect(h.rpc).toHaveBeenCalledTimes(1);
  });
});
