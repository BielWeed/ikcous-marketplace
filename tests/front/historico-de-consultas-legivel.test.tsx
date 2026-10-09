// @vitest-environment jsdom
//
// Painel simples (G5): o histórico de cotações fala a língua da lojista.
//   - a coluna se chama "CEP do cliente" (não "Destino");
//   - a transportadora aparece pelo nome ("Melhor Envio", "SuperFrete"), não
//     pelo id com "_" trocado por espaço;
//   - o motivo que veio como corpo bruto da API da transportadora vira frase,
//     e o texto INTEIRO continua no `title` para quem precisar do detalhe;
//   - o cabeçalho não usa texto menor que 11px.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { invoke, logsState } = vi.hoisted(() => ({
  invoke: vi.fn(),
  logsState: { data: [] as any[] },
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
      invoke: (...args: unknown[]) => invoke(...(args as [any, any])),
    },
  },
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function esperarMicrotarefas(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

const CORPO_BRUTO =
  'Melhor Envio API retornou 422: {"errors":{"postal_code":["O campo cep_destino está invalido"]}}';

function log(sobrescreve: Record<string, unknown>) {
  return {
    id: "1",
    created_at: new Date().toISOString(),
    destination_cep: "38400000",
    provider: "melhor_envio",
    response_time_ms: 320,
    status: "success",
    error_message: null,
    ...sobrescreve,
  };
}

describe("HistoricoCotacoesSection — leitura de lojista", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
    invoke.mockResolvedValue({
      data: {
        success: true,
        modo: "multi",
        ligados: ["melhor_envio"],
        provedores: {},
      },
      error: null,
    });
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    vi.restoreAllMocks();
  });

  async function abrirSecao() {
    const { HistoricoCotacoesSection } = await import(
      "@/components/admin/settings/HistoricoCotacoesCard"
    );
    await act(async () => {
      raiz.render(<HistoricoCotacoesSection />);
    });
    await act(async () => {
      await esperarMicrotarefas();
    });
    await act(async () => {
      await esperarMicrotarefas();
    });
  }

  const texto = () =>
    hospedeiro.querySelector("#historico-cotacoes-section")?.textContent ?? "";

  it("a coluna do CEP se chama 'CEP do cliente' e 'Destino' some", async () => {
    logsState.data = [log({})];
    await abrirSecao();

    const cabecalhos = [...hospedeiro.querySelectorAll("thead th")].map((th) =>
      th.textContent?.trim(),
    );
    expect(cabecalhos).toContain("CEP do cliente");
    expect(cabecalhos).not.toContain("Destino");
    expect(texto()).toContain("38400-000");
  });

  it("a transportadora aparece pelo nome, não pelo id", async () => {
    logsState.data = [
      log({ id: "1", provider: "superfrete" }),
      log({ id: "2", provider: "melhor_envio" }),
      log({ id: "3", provider: "frenet" }),
    ];
    await abrirSecao();

    expect(texto()).toContain("SuperFrete");
    expect(texto()).toContain("Melhor Envio");
    expect(texto()).toContain("Frenet");
    expect(texto()).not.toMatch(/melhor envio/); // o antigo "melhor envio" em minúsculas
    expect(texto()).not.toContain("_");
  });

  it("corpo bruto da API vira frase; o texto inteiro fica no title", async () => {
    logsState.data = [
      log({ status: "error", response_time_ms: 0, error_message: CORPO_BRUTO }),
    ];
    await abrirSecao();

    expect(texto()).toContain(
      "A transportadora não respondeu direito (erro 422). Tente de novo mais tarde.",
    );
    expect(texto()).not.toContain("postal_code");
    expect(texto()).not.toContain("{");
    const celula = [...hospedeiro.querySelectorAll("[title]")].find(
      (el) => el.getAttribute("title") === CORPO_BRUTO,
    );
    expect(celula).toBeTruthy();
  });

  it("o motivo em português que a edge escreveu continua igual", async () => {
    const motivo =
      'Sem credencial cadastrada para o provedor "melhor_envio". Conecte a transportadora para cotar entregas fora da cidade.';
    logsState.data = [
      log({ status: "error", response_time_ms: 0, error_message: motivo }),
    ];
    await abrirSecao();

    expect(texto()).toContain(motivo);
  });

  it("o cabeçalho e o selo de status não usam texto menor que 11px", async () => {
    logsState.data = [log({})];
    await abrirSecao();

    const secao = hospedeiro.querySelector("#historico-cotacoes-section");
    expect(secao?.innerHTML).not.toMatch(/text-\[(?:[6-9]|10)(?:\.5)?px\]/);
  });
});
