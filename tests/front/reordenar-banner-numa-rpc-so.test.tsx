// @vitest-environment jsdom
// O hook real deve persistir a troca numa única transação e restaurar a
// tela e o vault quando a API resolve com error em vez de rejeitar.
import { normalizeBannersOrder, useBanners } from "@/hooks/useBanners";
import type { Banner } from "@/types";
import { act, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  linhas: [] as unknown[],
  isAdmin: true,
  update: vi.fn(),
  rpc: vi.fn(),
  replaceAll: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => ({
      select: () => ({
        order: () => Promise.resolve({ data: h.linhas, error: null }),
        eq: () => ({
          order: () => ({
            order: () => Promise.resolve({ data: h.linhas, error: null }),
          }),
        }),
      }),
      update: (valores: { order: number }) => ({
        eq: (coluna: string, id: string) => h.update(valores, coluna, id),
      }),
    }),
    rpc: h.rpc,
  },
}));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ isAdmin: h.isAdmin }),
}));
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
  toast: { success: vi.fn(), error: h.toastError, info: vi.fn() },
}));

// @ts-expect-error flag interna do React, como nos testes vizinhos.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const desmontagens: (() => Promise<void>)[] = [];

async function montarPainel(
  ordens = [7, 7],
  posicaoDoSegundo: Banner["position"] = "home_top",
) {
  h.linhas = ordens.map((order, idx) => ({
    id: idx === 0 ? "banner-a" : "banner-b",
    image_url: "https://exemplo.com/banner.png",
    title: "Oferta",
    position: idx === 0 ? "home_top" : posicaoDoSegundo,
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
    return (
      <output>{hook.banners.map((b) => `${b.id}:${b.order}`).join(",")}</output>
    );
  }
  desmontagens.push(async () => {
    await act(async () => raiz.unmount());
    hospedeiro.remove();
  });
  await act(async () => raiz.render(<Sonda />));
  await act(async () => ler().refreshBanners(false, true));
  h.replaceAll.mockClear();
  return { ler, hospedeiro };
}

describe("reordenar banner numa RPC só", () => {
  beforeEach(() => {
    h.isAdmin = true;
    h.update.mockReset().mockResolvedValue({ error: null });
    h.rpc.mockReset().mockResolvedValue({ error: null });
    h.replaceAll.mockReset().mockResolvedValue(undefined);
    h.toastError.mockReset();
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(async () => {
    for (const desmontar of desmontagens.splice(0)) await desmontar();
    vi.restoreAllMocks();
  });

  it.each([
    { caso: "com colisão", ordens: [7, 7] },
    { caso: "sem colisão", ordens: [3, 8] },
  ])("persiste $caso sem updates anteriores à RPC", async ({ ordens }) => {
    const { ler } = await montarPainel(ordens);
    await act(async () => ler().reorderBanners("banner-a", "banner-b"));

    expect(h.update).not.toHaveBeenCalled();
    expect(h.rpc).toHaveBeenCalledExactlyOnceWith("reorder_banners_atomic", {
      p_position: "home_top",
      p_banner_id_1: "banner-a",
      p_banner_id_2: "banner-b",
    });
  });

  it("erro resolvido da RPC restaura snapshot, tela e vault e avisa", async () => {
    const { ler, hospedeiro } = await montarPainel();
    const snapshot = ler().banners.map((b) => ({ ...b }));
    const telaAnterior = hospedeiro.textContent;
    let resolver!: (resultado: { error: { message: string } }) => void;
    h.rpc.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolver = resolve;
        }),
    );
    let troca!: Promise<void>;
    await act(async () => {
      troca = ler().reorderBanners("banner-a", "banner-b");
    });
    expect(hospedeiro.textContent).toBe("banner-b:1,banner-a:2");
    expect(snapshot.map((b) => b.order)).toEqual([7, 7]);
    await act(async () => {
      resolver({ error: { message: "x" } });
      await troca;
    });

    expect(ler().banners).toEqual(snapshot);
    expect(hospedeiro.textContent).toBe(telaAnterior);
    expect(h.replaceAll).toHaveBeenLastCalledWith("banners", snapshot);
    expect(h.toastError).toHaveBeenCalledWith("Erro ao reordenar banners.");
  });

  it("posições diferentes não chamam RPC nem mudam estado ou vault", async () => {
    const { ler, hospedeiro } = await montarPainel([3, 8], "home_bottom");
    const originais = ler().banners;
    const telaAnterior = hospedeiro.textContent;
    await act(async () => ler().reorderBanners("banner-a", "banner-b"));

    expect(h.rpc).not.toHaveBeenCalled();
    expect(h.update).not.toHaveBeenCalled();
    expect(h.replaceAll).not.toHaveBeenCalled();
    expect(ler().banners).toBe(originais);
    expect(hospedeiro.textContent).toBe(telaAnterior);
  });

  it("sem permissão de admin não persiste nem altera a tela", async () => {
    h.isAdmin = false;
    const { ler } = await montarPainel();
    const originais = ler().banners;
    await act(async () => ler().reorderBanners("banner-a", "banner-b"));

    expect(h.rpc).not.toHaveBeenCalled();
    expect(h.update).not.toHaveBeenCalled();
    expect(h.replaceAll).not.toHaveBeenCalled();
    expect(ler().banners).toBe(originais);
    expect(h.toastError).toHaveBeenCalledWith(
      "Acesso negado: Apenas administradores podem reordenar banners.",
    );
  });

  it("normalização registra error resolvido sem anunciar sucesso", async () => {
    h.linhas = [
      { id: "banner-a", order: 7 },
      { id: "banner-b", order: 7 },
    ];
    const erro = { message: "boom" };
    h.update
      .mockResolvedValueOnce({ error: null })
      .mockResolvedValueOnce({ error: erro });

    await normalizeBannersOrder("home_top");

    expect(h.update).toHaveBeenCalledTimes(2);
    expect(console.log).not.toHaveBeenCalledWith(
      expect.stringContaining("Normalized"),
    );
    expect(console.error).toHaveBeenCalledWith(
      "[Banners] Error normalizing banners order:",
      erro,
    );
  });
});
