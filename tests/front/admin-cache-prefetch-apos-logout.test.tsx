import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn() }));
vi.mock("@/lib/supabase", () => ({
  supabase: { rpc: h.rpc, from: h.from },
}));

import * as cache from "@/utils/admin_cache";

function pendente() {
  let resolver!: (resposta: { data: unknown; error: null }) => void;
  const promessa = new Promise<{ data: unknown; error: null }>((resolve) => {
    resolver = resolve;
  });
  return { promessa, resolver };
}

const clientes = {
  data: [{ id: "cliente-ficticio", full_name: "Cliente fictício" }],
  total_count: 1,
  stats: { global_ltv: 50 },
};

describe("prefetch de admin após a limpeza da sessão", () => {
  beforeEach(() => {
    cache.limparCachesDeAdmin();
    h.rpc.mockReset();
    h.from.mockReset();
  });

  it.each(["clientes", "cupons", "avaliações", "perguntas"] as const)(
    "%s: a resposta antiga não repopula cache limpo nem substitui a conta nova",
    async (secao) => {
      const a = pendente();
      const b = pendente();
      h.rpc.mockReturnValueOnce(a.promessa).mockReturnValueOnce(b.promessa);
      const consulta = vi
        .fn()
        .mockReturnValueOnce(a.promessa)
        .mockReturnValueOnce(b.promessa);
      h.from.mockReturnValue({
        select: () => ({
          order: () =>
            secao === "perguntas" ? { range: consulta } : consulta(),
        }),
      });
      const prefetch =
        secao === "clientes"
          ? cache.prefetchCustomersData
          : secao === "cupons"
            ? cache.prefetchCouponsData
            : secao === "avaliações"
              ? cache.prefetchReviewsData
              : cache.prefetchQAData;
      const ler = () =>
        secao === "clientes"
          ? cache.cachedCustomersData
          : secao === "cupons"
            ? cache.cachedCouponsData
            : secao === "avaliações"
              ? cache.cachedReviewsData
              : cache.cachedQuestionsData;
      const resposta =
        secao === "clientes"
          ? clientes
          : secao === "avaliações"
            ? { data: [{ id: "antigo" }] }
            : [{ id: "antigo" }];

      const antiga = prefetch();
      cache.limparCachesDeAdmin();
      a.resolver({ data: resposta, error: null });
      await antiga;
      expect(ler()).toBeNull();

      // A próxima geração ainda pode carregar; não basta bloquear todo prefetch.
      const atual = prefetch();
      b.resolver({ data: resposta, error: null });
      await atual;
      expect(ler()).not.toBeNull();
    },
  );

  it("a resposta dos clientes da conta anterior não substitui o snapshot da conta nova", async () => {
    const a = pendente();
    h.rpc.mockReturnValueOnce(a.promessa);
    const antiga = cache.prefetchCustomersData();
    cache.limparCachesDeAdmin();
    h.rpc.mockResolvedValueOnce({
      data: { ...clientes, data: [{ id: "cliente-novo" }] },
      error: null,
    });
    await cache.prefetchCustomersData();
    const novo = cache.cachedCustomersData;
    a.resolver({ data: clientes, error: null });
    await antiga;
    expect(cache.cachedCustomersData).toBe(novo);
    expect(cache.cachedCustomersData?.customers[0].id).toBe("cliente-novo");
  });
});
