// Achado 8 (caça autônoma R4) — o pré-carregamento das Avaliações (rodado
// enquanto a lojista está em Pedidos) não guardava o `status`. A primeira
// imagem da tela de Avaliações vem desse cache, então uma avaliação em
// moderação aparecia como publicada: sem o selo "Em moderação" e sem o botão de
// aprovar, até a consulta real voltar. O mapeamento tem de ser o do useReviews
// (`status: item.status ?? "publicada"`).
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/lib/supabase", () => ({
  supabase: { rpc: h.rpc, from: vi.fn() },
}));

import * as cache from "@/utils/admin_cache";

describe("prefetch das avaliações do painel guarda o status de moderação", () => {
  beforeEach(() => {
    cache.limparCachesDeAdmin();
    h.rpc.mockReset();
  });

  it("avaliação pendente continua pendente no cache; sem status, vale publicada", async () => {
    h.rpc.mockResolvedValueOnce({
      data: {
        data: [
          { id: "r-pendente", status: "pendente", rating: 4 },
          { id: "r-publicada", status: "publicada", rating: 5 },
          { id: "r-sem-status", rating: 3 },
        ],
      },
      error: null,
    });

    await cache.prefetchReviewsData();

    const porId = Object.fromEntries(
      (cache.cachedReviewsData ?? []).map((r) => [r.id, r.status]),
    );
    expect(porId).toEqual({
      "r-pendente": "pendente",
      "r-publicada": "publicada",
      "r-sem-status": "publicada",
    });
  });
});
