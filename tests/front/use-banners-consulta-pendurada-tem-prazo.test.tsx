// @vitest-environment jsdom
//
// BANNERS DA HOME: REDE PENDURADA TEM PRAZO.
//
// O DEFEITO: rede que conecta e não responde (nem erro) deixava a consulta dos
// banners esperando para sempre. `isLoaded` só vira true quando a consulta
// termina, e a Home mantém o esqueleto dos banners enquanto ele for falso: a
// cliente via o "carregando" da faixa de banners sem fim, sem aviso.
//
// O CONSERTO: a consulta (`pedirBanners`) ganhou prazo. Estourou, ela REJEITA
// com "consulta sem resposta" -- o MESMO caminho de uma falha comum (o hook
// liga `isLoaded` no `finally`, a home segue sem a faixa e a próxima tentativa
// pede de novo). Nenhum banner é inventado, e a resposta tardia da consulta
// abandonada é descartada.
//
// Esta suíte cai se o prazo sair de `pedirBanners`.
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Banner } from "@/types";

const h = vi.hoisted(() => ({
  consultar: vi.fn<() => Promise<unknown>>(),
}));
vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => ({
      select: () => ({ order: () => h.consultar() }),
    }),
  },
}));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ isAdmin: false }) }));
vi.mock("@/hooks/useDataVault", () => ({ useSyncListener: () => {} }));
vi.mock("@/lib/dataVault", () => ({
  DataVault: {
    init: async () => ({
      getAll: async () => [],
      replaceAll: vi.fn(async () => {}),
      setLastSync: vi.fn(),
    }),
  },
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const PRAZO_ESTOURADO_MS = 25_000;
const pendurada = () => new Promise<never>(() => {});

const LINHA = {
  id: "banner-1",
  image_url: "https://exemplo.com/banner-1.png",
  title: "Queima de estoque",
  position: "home_top",
  active: true,
  order: 1,
};

type Visto = {
  banners: Banner[];
  isLoaded: boolean;
  refreshBanners: (onlyActive?: boolean, force?: boolean) => Promise<void>;
};

describe("banners da home — consulta pendurada tem prazo", () => {
  let raiz: Root | null = null;
  let alvo: HTMLDivElement | null = null;
  let useBanners: typeof import("@/hooks/useBanners").useBanners;
  let bannersEmCache: typeof import("@/lib/banners-da-vitrine").bannersEmCache;
  let visto: Visto;

  async function montar() {
    function Tela() {
      const { banners, isLoaded, refreshBanners } = useBanners(false);
      useEffect(() => {
        visto = { banners, isLoaded, refreshBanners };
      });
      return null;
    }
    alvo = document.createElement("div");
    document.body.appendChild(alvo);
    raiz = createRoot(alvo);
    await act(async () => {
      raiz?.render(<Tela />);
    });
  }

  async function passar(ms: number) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });
  }

  beforeEach(async () => {
    vi.useFakeTimers();
    vi.resetModules();
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
    h.consultar.mockReset();
    ({ useBanners } = await import("@/hooks/useBanners"));
    ({ bannersEmCache } = await import("@/lib/banners-da-vitrine"));
  });
  afterEach(() => {
    act(() => raiz?.unmount());
    alvo?.remove();
    raiz = null;
    alvo = null;
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("sem resposta da rede, o esqueleto sai e a home segue sem banner inventado", async () => {
    h.consultar.mockImplementation(pendurada);

    await montar();
    // Antes do prazo: a consulta segue esperando, o esqueleto segue ligado.
    await passar(5_000);
    expect(visto.isLoaded).toBe(false);

    await passar(PRAZO_ESTOURADO_MS);

    expect(visto.isLoaded).toBe(true);
    expect(visto.banners).toEqual([]);
    expect(bannersEmCache()).toBeNull();
  });

  it("depois do prazo, a próxima tentativa pede de novo e os banners aparecem", async () => {
    h.consultar.mockImplementationOnce(pendurada);
    h.consultar.mockResolvedValue({ data: [LINHA], error: null });

    await montar();
    await passar(PRAZO_ESTOURADO_MS);
    expect(visto.isLoaded).toBe(true);

    await act(async () => {
      await visto.refreshBanners(false, true);
    });

    expect(h.consultar.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(visto.banners.map((b) => b.id)).toEqual(["banner-1"]);
    expect(visto.isLoaded).toBe(true);
  });

  it("a resposta tardia da consulta abandonada é descartada, sem estragar a tela", async () => {
    let responderTarde: (resposta: unknown) => void = () => {};
    h.consultar.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          responderTarde = resolve;
        }),
    );
    h.consultar.mockImplementation(pendurada);

    await montar();
    await passar(PRAZO_ESTOURADO_MS);
    expect(visto.isLoaded).toBe(true);

    await act(async () => {
      responderTarde({ data: [LINHA], error: null });
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(visto.banners).toEqual([]);
    expect(bannersEmCache()).toBeNull();
  });
});
