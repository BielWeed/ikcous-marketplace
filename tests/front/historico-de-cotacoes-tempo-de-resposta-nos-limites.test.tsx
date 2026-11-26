// @vitest-environment jsdom
//
// Histórico de cotações — coluna "Tempo": a coluna guarda milissegundos e a
// lojista lê segundos com UMA casa. Os limites que as provas vizinhas não
// pisam: 99 ms ainda é "menos de 0,1 s", 100 ms já é "0,1 s" (o corte é
// exatamente em 100), e a conversão é por 1000 (não 1001): 150 ms arredonda
// para "0,2 s" e 350 ms para "0,4 s" — com divisor errado cairiam para 0,1/0,3.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { logsState } = vi.hoisted(() => ({
  logsState: { data: [] as Record<string, unknown>[] },
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: (table: string) => {
      if (table === "shipping_calculation_logs") {
        return {
          select: () => ({
            order: () => ({
              limit: () =>
                Promise.resolve({ data: logsState.data, error: null }),
            }),
          }),
        };
      }
      return { select: () => Promise.resolve({ data: [], error: null }) };
    },
    functions: {
      invoke: () =>
        Promise.resolve({
          data: {
            success: true,
            modo: "multi",
            ligados: ["melhor_envio"],
            provedores: {},
          },
          error: null,
        }),
    },
  },
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const esperar = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function log(indice: number, ms: number | null) {
  return {
    id: `l${indice}`,
    created_at: "2026-11-20T12:00:00.000Z",
    // CEP diferente por linha: linhas iguais seguidas se juntam em uma só.
    destination_cep: `3840000${indice}`,
    provider: "melhor_envio",
    response_time_ms: ms,
    status: "success",
    error_message: null,
  };
}

describe("Histórico de cotações — tempo de resposta nos limites", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });
  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
  });

  async function tempos(valores: (number | null)[]) {
    logsState.data = valores.map((ms, i) => log(i, ms));
    const { HistoricoCotacoesSection } = await import(
      "@/components/admin/settings/HistoricoCotacoesCard"
    );
    await act(async () => {
      raiz.render(<HistoricoCotacoesSection />);
    });
    await act(async () => {
      await esperar();
    });
    await act(async () => {
      await esperar();
    });
    return [...hospedeiro.querySelectorAll("tbody tr")].map(
      (tr) => tr.querySelectorAll("td")[3]?.textContent?.trim() ?? "",
    );
  }

  it("99 ms é 'menos de 0,1 s' e 100 ms já é '0,1 s'", async () => {
    expect(await tempos([99, 100])).toEqual(["menos de 0,1 s", "0,1 s"]);
  });

  it("zero e vazio viram travessão (consulta que nem saiu)", async () => {
    expect(await tempos([0, null])).toEqual(["—", "—"]);
  });

  it("a conversão é por 1000: 150 ms → 0,2 s, 350 ms → 0,4 s, 1500 ms → 1,5 s", async () => {
    expect(await tempos([150, 350, 1500, 12345])).toEqual([
      "0,2 s",
      "0,4 s",
      "1,5 s",
      "12,3 s",
    ]);
  });
});
