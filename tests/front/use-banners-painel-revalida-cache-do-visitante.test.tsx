// @vitest-environment jsdom
//
// O pedido do boot (`pedirBannersNoBoot`) semeia o cache de banners ANTES de a
// lojista entrar. Sem sessão, o banco só devolve os banners públicos (ativos e
// dentro da data); pausados, agendados e vencidos ficam de fora. Se ela entra
// em menos de 60 s e abre a tela de Banners, o throttle de 60 s tratava aquele
// cache como fresco e o painel mostrava SÓ os públicos -- banner pausado sumia
// da lista de quem o administra. No painel (`useBanners(true)`) o cache aparece
// na hora e a consulta de verdade SEMPRE roda em segundo plano ao montar.
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

const publico = {
  id: "publico",
  title: "Público",
  image_url: "https://example.com/publico.png",
  position: "home_top",
  active: true,
  order: 1,
};
const pausado = {
  id: "pausado",
  title: "Pausado",
  image_url: "https://example.com/pausado.png",
  position: "home_top",
  active: false,
  order: 2,
};
const agendado = {
  id: "agendado",
  title: "Agendado",
  image_url: "https://example.com/agendado.png",
  position: "home_middle",
  active: true,
  start_date: "2999-01-01T00:00:00Z",
  order: 1,
};

describe("banners — painel revalida o cache que o visitante semeou", () => {
  const raizes: Root[] = [];
  const alvos: HTMLDivElement[] = [];
  let useBanners: typeof import("@/hooks/useBanners").useBanners;
  let pedirBannersNoBoot: () => void;

  async function montar(adminMode: boolean) {
    let atual!: ReturnType<typeof useBanners>;
    function Sonda() {
      const hook = useBanners(adminMode);
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
    return Object.assign(() => atual, {
      desmontar: () => act(() => raiz.unmount()),
    });
  }

  /** O boot da loja, ainda sem sessão: o banco devolve só o que é público. */
  async function bootDoVisitante() {
    h.consultar.mockResolvedValueOnce({ data: [publico], error: null });
    await act(async () => {
      pedirBannersNoBoot();
      await Promise.resolve();
    });
    // deixa a consulta do boot assentar no cache
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(h.consultar).toHaveBeenCalledTimes(1);
  }

  beforeEach(async () => {
    vi.resetModules();
    h.consultar.mockReset();
    h.atualizar.mockReset().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        select: () =>
          Promise.resolve({ data: [{ id: "publico" }], error: null }),
      }),
    });
    h.persistir.mockReset().mockResolvedValue(undefined);
    ({ useBanners } = await import("@/hooks/useBanners"));
    ({ pedirBannersNoBoot } = await import("@/lib/banners-da-vitrine"));
  });
  afterEach(() => {
    act(() => {
      for (const raiz of raizes.splice(0)) raiz.unmount();
    });
    for (const alvo of alvos.splice(0)) alvo.remove();
  });

  it("cache semeado pelo visitante + painel abrindo dentro de 60 s: nova consulta e a lista completa", async () => {
    await bootDoVisitante();
    // Agora a lojista já tem sessão: o banco devolve tudo.
    h.consultar.mockResolvedValueOnce({
      data: [publico, pausado, agendado],
      error: null,
    });

    const painel = await montar(true);

    expect(h.consultar).toHaveBeenCalledTimes(2);
    expect(
      painel()
        .banners.map((b) => b.id)
        .sort(),
    ).toEqual(["agendado", "pausado", "publico"]);
    expect(
      painel()
        .getBannersByPosition("home_top")
        .map((b) => b.id),
    ).toEqual(["publico", "pausado"]);
  });

  it("o painel mostra o cache na hora, sem esqueleto, enquanto a consulta roda", async () => {
    await bootDoVisitante();
    let liberar!: (v: unknown) => void;
    h.consultar.mockReturnValueOnce(
      new Promise((resolve) => {
        liberar = resolve;
      }),
    );

    const painel = await montar(true);
    expect(painel().isLoaded).toBe(true);
    expect(painel().banners.map((b) => b.id)).toEqual(["publico"]);
    expect(h.consultar).toHaveBeenCalledTimes(2);

    await act(async () => {
      liberar({ data: [publico, pausado], error: null });
    });
    expect(painel().banners.map((b) => b.id)).toEqual(["publico", "pausado"]);
  });

  it("cada abertura do painel revalida, mesmo logo depois da anterior", async () => {
    await bootDoVisitante();
    h.consultar.mockResolvedValue({ data: [publico, pausado], error: null });
    const primeira = await montar(true);
    expect(h.consultar).toHaveBeenCalledTimes(2);
    await primeira.desmontar();
    await montar(true);
    expect(h.consultar).toHaveBeenCalledTimes(3);
  });

  it("painel abrindo com o cache vazio faz UMA consulta só (sem repetir ao carregar)", async () => {
    h.consultar.mockResolvedValue({ data: [publico, pausado], error: null });
    const painel = await montar(true);
    expect(h.consultar).toHaveBeenCalledTimes(1);
    expect(painel().banners).toHaveLength(2);
    expect(painel().isLoaded).toBe(true);
  });

  it("política do visitante intacta: a Home abrindo dentro de 60 s do boot NÃO consulta de novo", async () => {
    await bootDoVisitante();
    const home = await montar(false);
    expect(h.consultar).toHaveBeenCalledTimes(1);
    expect(home().banners.map((b) => b.id)).toEqual(["publico"]);
  });

  it("edição feita no painel durante a revalidação vence a resposta que já estava em voo", async () => {
    await bootDoVisitante();
    let liberar!: (v: unknown) => void;
    h.consultar.mockReturnValueOnce(
      new Promise((resolve) => {
        liberar = resolve;
      }),
    );
    const painel = await montar(true);
    expect(h.consultar).toHaveBeenCalledTimes(2);

    await act(async () => {
      await painel().updateBanner("publico", { title: "Novo título" });
    });
    expect(painel().banners[0].title).toBe("Novo título");

    // A resposta velha (anterior à edição) chega por último.
    h.persistir.mockClear();
    await act(async () => {
      liberar({ data: [publico, pausado], error: null });
    });
    expect(painel().banners.find((b) => b.id === "publico")?.title).toBe(
      "Novo título",
    );
    expect(h.persistir).not.toHaveBeenCalled();
  });
});
