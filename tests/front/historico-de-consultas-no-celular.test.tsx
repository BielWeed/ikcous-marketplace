// @vitest-environment jsdom
//
// Painel simples (J5): as consultas de frete cabem no celular.
//   - cada consulta vira um bloco (a tabela só é tabela a partir de `sm:`), sem
//     rolagem lateral no celular;
//   - o CEP não quebra no hífen (`whitespace-nowrap`);
//   - o rodapé fala em "linhas" (não em "ocorrências") e explica o "×2";
//   - o botão Atualizar tem 44px de altura.
// `display: block` na tabela tira a semântica de tabela do leitor de tela: por
// isso os papéis ARIA estão escritos no HTML.
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

describe("HistoricoCotacoesSection — cabe no celular", () => {
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

  it("a tabela vira bloco no celular e guarda os papéis de tabela para leitor de tela", async () => {
    logsState.data = [log({})];
    await abrirSecao();

    const tabela = hospedeiro.querySelector("table");
    expect(tabela?.getAttribute("role")).toBe("table");
    expect(tabela?.classList.contains("block")).toBe(true);
    expect(tabela?.classList.contains("sm:table")).toBe(true);
    const cabecalho = hospedeiro.querySelector("thead");
    expect(cabecalho?.getAttribute("role")).toBe("rowgroup");
    expect(cabecalho?.classList.contains("sr-only")).toBe(true);
    expect(hospedeiro.querySelector("tbody")?.getAttribute("role")).toBe(
      "rowgroup",
    );
    expect(
      [...hospedeiro.querySelectorAll("th")].every(
        (th) => th.getAttribute("role") === "columnheader",
      ),
    ).toBe(true);
    const linha = hospedeiro.querySelector("tbody tr");
    expect(linha?.getAttribute("role")).toBe("row");
    expect(linha?.classList.contains("grid")).toBe(true);
    const celulas = [...(linha?.querySelectorAll("td") ?? [])];
    expect(celulas).toHaveLength(5);
    expect(celulas.every((td) => td.getAttribute("role") === "cell")).toBe(
      true,
    );
  });

  it("o CEP não quebra no hífen", async () => {
    logsState.data = [log({})];
    await abrirSecao();

    const celulaDoCep = [...hospedeiro.querySelectorAll("td")].find(
      (td) => td.textContent === "38400-000",
    );
    expect(celulaDoCep).toBeTruthy();
    expect(celulaDoCep?.classList.contains("whitespace-nowrap")).toBe(true);
  });

  it("o contêiner só rola na lateral a partir de sm: (no celular a consulta é um bloco)", async () => {
    logsState.data = [log({})];
    await abrirSecao();

    const conteiner = hospedeiro.querySelector("table")?.parentElement;
    expect(conteiner?.classList.contains("overflow-x-auto")).toBe(false);
    expect(conteiner?.classList.contains("sm:overflow-x-auto")).toBe(true);
  });

  it("o cabeçalho não usa o espaçamento largo que estoura a coluna estreita", async () => {
    logsState.data = [log({})];
    await abrirSecao();

    const cabecalho = hospedeiro.querySelector("thead tr");
    expect(cabecalho?.className).not.toContain("tracking-[0.2em]");
  });

  it("Status e Transportadora ficam na coluna da direita, sempre à vista", async () => {
    logsState.data = [log({})];
    await abrirSecao();

    const celulas = [...hospedeiro.querySelectorAll("tbody tr:first-child td")];
    const transportadora = celulas[2];
    const status = celulas[4];
    expect(status?.textContent).toContain("Sucesso");
    expect(status?.className).toContain("col-start-2");
    expect(transportadora?.textContent).toContain("Melhor Envio");
    expect(transportadora?.className).toContain("col-start-2");
  });

  it("rodapé com repetidas diz 'linhas' e explica o ×2; 'ocorrências' some", async () => {
    const erro = {
      status: "error",
      response_time_ms: 0,
      error_message: "Nenhum método de envio retornado.",
    };
    logsState.data = [
      log({ id: "1", ...erro }),
      log({ id: "2", ...erro }),
      log({ id: "3" }),
      log({ id: "4", ...erro, destination_cep: "01310100" }),
      log({ id: "5", ...erro, destination_cep: "01310100" }),
    ];
    await abrirSecao();

    const rodape = hospedeiro.querySelector(
      "#historico-cotacoes-section > div:last-child",
    )?.textContent;
    expect(rodape).toContain(
      "5 consultas recentes em 3 linhas — as repetidas aparecem juntas (×2).",
    );
    expect(rodape).not.toMatch(/ocorrência/i);
  });

  it("o botão Atualizar tem 44px de altura", async () => {
    logsState.data = [log({})];
    await abrirSecao();

    const botao = [...hospedeiro.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("Atualizar"),
    );
    expect(botao).toBeTruthy();
    expect(botao?.classList.contains("min-h-11")).toBe(true);
    expect(botao?.classList.contains("px-3")).toBe(true);
  });

  it("o motivo da edge em inglês técnico vira frase da lojista, com o texto inteiro no title", async () => {
    const bruto = "tempo esgotado: The signal has been aborted";
    logsState.data = [
      log({ status: "error", response_time_ms: 0, error_message: bruto }),
    ];
    await abrirSecao();

    const texto =
      hospedeiro.querySelector("#historico-cotacoes-section")?.textContent ??
      "";
    expect(texto).toContain(
      "A transportadora demorou demais para responder. Tente de novo mais tarde.",
    );
    expect(texto).not.toContain("The signal has been aborted");
    expect(
      [...hospedeiro.querySelectorAll("[title]")].some(
        (el) => el.getAttribute("title") === bruto,
      ),
    ).toBe(true);
  });
});
