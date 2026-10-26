// @vitest-environment jsdom
//
// O banco responde "sucesso" a um UPDATE/DELETE que a política de acesso barra
// (ou de uma linha que não existe mais): 0 linhas, sem erro. Banner, cupom e
// avaliação diziam "salvo / removido / publicado" mesmo assim, e a tela seguia
// mostrando uma mudança que nunca chegou ao banco. Agora cada um confere que
// ao menos uma linha mudou (`.select("id")`), avisa o erro e devolve a tela ao
// que era (mesmo padrão de `setCategoryActive` em useCategories).
vi.hoisted(() => {
  if (typeof globalThis.BroadcastChannel === "undefined") {
    class BroadcastChannelFalso {
      postMessage(): void {}
      addEventListener(): void {}
      removeEventListener(): void {}
      close(): void {}
    }
    (globalThis as unknown as Record<string, unknown>).BroadcastChannel =
      BroadcastChannelFalso;
  }
});

const h = vi.hoisted(() => ({
  // O que o UPDATE/DELETE (já com `.select("id")`) devolve.
  gravacao: { data: [] as unknown[] | null, error: null as unknown },
  linhasBanner: [] as unknown[],
  linhasCupom: [] as unknown[],
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: (tabela: string) => ({
      select: () => ({
        order: () =>
          Promise.resolve({
            data: tabela === "banners" ? h.linhasBanner : h.linhasCupom,
            error: null,
          }),
      }),
      update: () => ({
        eq: () => ({ select: () => Promise.resolve(h.gravacao) }),
      }),
      delete: () => ({
        eq: () => ({ select: () => Promise.resolve(h.gravacao) }),
      }),
    }),
  },
}));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: "admin-teste" }, isAdmin: true }),
}));
vi.mock("@/hooks/useDataVault", () => ({ useSyncListener: () => {} }));
vi.mock("@/hooks/useLeaderElection", () => ({
  useLeaderElection: () => ({ isLeader: false }),
}));
vi.mock("@/lib/dataVault", () => ({
  DataVault: {
    init: async () => ({
      getAll: async () => [],
      replaceAll: vi.fn().mockResolvedValue(undefined),
      setLastSync: vi.fn(),
    }),
  },
}));
vi.mock("@/utils/admin_cache", () => ({
  cachedReviewsData: null,
  setCachedReviewsData: vi.fn(),
  cachedCouponsData: null,
  setCachedCouponsData: vi.fn(),
}));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useBanners } from "@/hooks/useBanners";
import { useCoupons } from "@/hooks/useCoupons";
import { useReviews } from "@/hooks/useReviews";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const SEM_LINHA = { data: [] as unknown[], error: null };
const UMA_LINHA = { data: [{ id: "x" }], error: null };

describe("painel: UPDATE/DELETE que não mexeu em linha nenhuma não vira sucesso", () => {
  let raiz: Root;
  let alvo: HTMLDivElement;

  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(toast.success).mockClear();
    vi.mocked(toast.error).mockClear();
    h.gravacao = SEM_LINHA;
    h.linhasBanner = [
      {
        id: "banner-1",
        title: "Antigo",
        image_url: "https://example.com/b.png",
        position: "home_top",
        active: true,
        order: 1,
      },
    ];
    h.linhasCupom = [
      {
        id: "cupom-1",
        code: "CUPOM1",
        type: "percentage",
        value: 10,
        min_purchase: null,
        usage_limit: null,
        usage_count: 0,
        valid_until: null,
        active: true,
        alcance: "codigo",
      },
    ];
    alvo = document.createElement("div");
    document.body.appendChild(alvo);
    raiz = createRoot(alvo);
  });
  afterEach(() => {
    act(() => raiz.unmount());
    alvo.remove();
    vi.restoreAllMocks();
  });

  async function montar<T>(usar: () => T): Promise<() => T> {
    let atual!: T;
    function Sonda() {
      const hook = usar();
      useEffect(() => {
        atual = hook;
      });
      return null;
    }
    await act(async () => raiz.render(<Sonda />));
    return () => atual;
  }

  describe("banner", () => {
    it("atualizar com 0 linhas: avisa erro, recusa e volta ao título de antes", async () => {
      const banners = await montar(() => useBanners(true));
      expect(banners().banners[0].title).toBe("Antigo");

      let recusou = false;
      await act(async () => {
        await banners()
          .updateBanner("banner-1", { title: "Novo" })
          .catch(() => {
            recusou = true;
          });
      });

      expect(recusou).toBe(true);
      expect(toast.error).toHaveBeenCalledWith("Erro ao atualizar banner.");
      expect(toast.success).not.toHaveBeenCalled();
      expect(banners().banners[0].title).toBe("Antigo");
    });

    it("excluir com 0 linhas: avisa erro, recusa e o banner continua na lista", async () => {
      const banners = await montar(() => useBanners(true));

      let recusou = false;
      await act(async () => {
        await banners()
          .deleteBanner("banner-1")
          .catch(() => {
            recusou = true;
          });
      });

      expect(recusou).toBe(true);
      expect(toast.error).toHaveBeenCalledWith("Erro ao excluir banner.");
      expect(toast.success).not.toHaveBeenCalled();
      expect(banners().banners.map((b) => b.id)).toEqual(["banner-1"]);
    });

    it("controle: com 1 linha gravada, atualizar continua dando certo", async () => {
      h.gravacao = UMA_LINHA;
      const banners = await montar(() => useBanners(true));
      await act(async () => {
        await banners().updateBanner("banner-1", { title: "Novo" });
      });
      expect(toast.success).toHaveBeenCalledWith(
        "Banner atualizado com sucesso!",
      );
      expect(banners().banners[0].title).toBe("Novo");
    });
  });

  describe("cupom", () => {
    it("ligar/desligar com 0 linhas: avisa erro, recusa e o cupom volta a ativo", async () => {
      const cupons = await montar(() => useCoupons(true));
      expect(cupons().coupons[0].active).toBe(true);

      let recusou = false;
      await act(async () => {
        await cupons()
          .updateCoupon("cupom-1", { active: false })
          .catch(() => {
            recusou = true;
          });
      });

      expect(recusou).toBe(true);
      expect(toast.error).toHaveBeenCalledWith("Erro ao atualizar cupom");
      expect(toast.success).not.toHaveBeenCalled();
      expect(cupons().coupons[0].active).toBe(true);
    });

    it("apagar com 0 linhas: avisa erro, recusa e não diz 'Cupom removido'", async () => {
      const cupons = await montar(() => useCoupons(true));

      let recusou = false;
      await act(async () => {
        await cupons()
          .deleteCoupon("cupom-1")
          .catch(() => {
            recusou = true;
          });
      });

      expect(recusou).toBe(true);
      expect(toast.error).toHaveBeenCalledWith("Erro ao remover cupom");
      expect(toast.success).not.toHaveBeenCalledWith("Cupom removido");
    });

    it("controle: com 1 linha apagada, o aviso de sucesso sai", async () => {
      h.gravacao = UMA_LINHA;
      const cupons = await montar(() => useCoupons(true));
      await act(async () => {
        await cupons().deleteCoupon("cupom-1");
      });
      expect(toast.success).toHaveBeenCalledWith("Cupom removido");
    });
  });

  describe("avaliação", () => {
    it("publicar com 0 linhas: devolve false e avisa erro, sem 'Avaliação publicada'", async () => {
      const reviews = await montar(() => useReviews());
      let resposta: boolean | undefined;
      await act(async () => {
        resposta = await reviews().aprovarReview("rev-1");
      });
      expect(resposta).toBe(false);
      expect(toast.error).toHaveBeenCalledWith("Erro ao publicar avaliação.");
      expect(toast.success).not.toHaveBeenCalled();
    });

    it("apagar com 0 linhas: devolve false e avisa erro, sem 'Avaliação removida'", async () => {
      const reviews = await montar(() => useReviews());
      let resposta: boolean | undefined;
      await act(async () => {
        resposta = await reviews().deleteReview("rev-1");
      });
      expect(resposta).toBe(false);
      expect(toast.error).toHaveBeenCalledWith("Erro ao remover avaliação.");
      expect(toast.success).not.toHaveBeenCalled();
    });

    it("controle: com 1 linha publicada, devolve true", async () => {
      h.gravacao = UMA_LINHA;
      const reviews = await montar(() => useReviews());
      let resposta: boolean | undefined;
      await act(async () => {
        resposta = await reviews().aprovarReview("rev-1");
      });
      expect(resposta).toBe(true);
    });
  });
});
