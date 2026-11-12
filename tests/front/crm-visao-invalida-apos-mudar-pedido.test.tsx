// @vitest-environment jsdom
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/lib/supabase", () => ({ supabase: { rpc: h.rpc } }));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    session: { user: { id: "admin-fixture" } },
    isAdmin: true,
  }),
}));
vi.mock("@/hooks/useRevalidarAoVoltar", () => ({
  useRevalidarAoVoltar: vi.fn(),
}));
vi.mock("@/lib/dataVault", () => ({ DataVault: { init: vi.fn() } }));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const intervalo = { inicio: "2026-11-01", fim: "2026-11-11" };
const resposta = (receita: number, pedidos: number) => ({
  data: { kpis: { receita, pedidos } },
  error: null,
});

describe("CRM invalida os números após mudar pedido", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let useCrmVisao: typeof import("@/hooks/useCrm").useCrmVisao;
  let clearAnalyticsCache: () => void;

  function Sonda({ ativa }: { ativa: boolean }) {
    const { visao } = useCrmVisao(intervalo, ativa);
    return (
      <p>
        {visao ? `${visao.kpis.receita}/${visao.kpis.pedidos}` : "aguardando"}
      </p>
    );
  }

  async function montar(ativa = true) {
    await act(async () => raiz.render(<Sonda ativa={ativa} />));
    await act(async () => vi.advanceTimersByTimeAsync(300));
  }

  beforeEach(async () => {
    vi.resetModules();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-11T15:00:00Z"));
    h.rpc.mockReset().mockResolvedValue(resposta(500, 3));
    ({ useCrmVisao } = await import("@/hooks/useCrm"));
    ({ clearAnalyticsCache } = await import("@/hooks/useAnalytics"));
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
    vi.useRealTimers();
  });

  it("sem mudança, voltar antes de 30 s reutiliza a visão fresca", async () => {
    await montar();
    expect(hospedeiro.textContent).toBe("500/3");
    await montar(false);
    await montar();
    expect(h.rpc).toHaveBeenCalledTimes(1);
    expect(hospedeiro.textContent).toBe("500/3");
  });

  it("cancelamento/estorno limpa a visão fresca pelo mesmo caminho do resumo", async () => {
    await montar();
    expect(hospedeiro.textContent).toBe("500/3");
    await montar(false);
    // Mesmo evento de invalidação chamado pelas ações de pedido em useOrders.
    clearAnalyticsCache();
    h.rpc.mockResolvedValue(resposta(300, 2));
    await montar();
    expect(h.rpc).toHaveBeenCalledTimes(2);
    expect(h.rpc).toHaveBeenLastCalledWith("crm_visao", {
      p_inicio: intervalo.inicio,
      p_fim: intervalo.fim,
    });
    expect(hospedeiro.textContent).toBe("300/2");
  });

  it("resposta iniciada antes da invalidação não repovoa o cache ao terminar", async () => {
    let resolver!: (valor: ReturnType<typeof resposta>) => void;
    h.rpc.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolver = resolve;
        }),
    );
    await montar();
    expect(h.rpc).toHaveBeenCalledTimes(1);
    await montar(false);
    clearAnalyticsCache();
    await act(async () => resolver(resposta(500, 3)));
    h.rpc.mockResolvedValue(resposta(300, 2));
    await montar();
    expect(h.rpc).toHaveBeenCalledTimes(2);
    expect(hospedeiro.textContent).toBe("300/2");
  });
});
