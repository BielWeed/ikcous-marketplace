// @vitest-environment jsdom
//
// Histórico de cotações (Frete › Consultas de frete) — o que as provas
// vizinhas não conferem:
//  - a CONSULTA ao banco: tabela certa, mais recentes primeiro, só 15;
//  - o selo de cada status ("Sucesso" verde, "Valor de reserva" âmbar, "Erro"
//    vermelho);
//  - o "×N" de erro repetido só aparece de DUAS repetições em diante, e a
//    contagem do rodapé acompanha; sucesso nunca agrupa;
//  - o motivo é cortado em 200 caracteres (200 inteiros passam, 201 viram
//    200 + "…"), com o texto inteiro no `title` e ocupando as 5 colunas;
//  - sem consulta nenhuma, o rodapé não inventa contagem.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { chamadas, logsState } = vi.hoisted(() => ({
  chamadas: {
    tabela: [] as string[],
    ordem: [] as unknown[][],
    limite: [] as number[],
  },
  logsState: { data: [] as Record<string, unknown>[] },
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: (tabela: string) => {
      chamadas.tabela.push(tabela);
      return {
        select: () => ({
          order: (...args: unknown[]) => {
            chamadas.ordem.push(args);
            return {
              limit: (n: number) => {
                chamadas.limite.push(n);
                return Promise.resolve({ data: logsState.data, error: null });
              },
            };
          },
        }),
      };
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

let contador = 0;
function log(sobrescreve: Record<string, unknown> = {}) {
  contador += 1;
  return {
    id: `log-${contador}`,
    created_at: "2026-11-20T12:00:00.000Z",
    destination_cep: "38400000",
    provider: "melhor_envio",
    response_time_ms: 300,
    status: "error",
    error_message: "Sem resposta da transportadora",
    ...sobrescreve,
  };
}

describe("Histórico de cotações — consulta, selos, repetição e corte do motivo", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    chamadas.tabela.length = 0;
    chamadas.ordem.length = 0;
    chamadas.limite.length = 0;
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

  async function abrir(logs: Record<string, unknown>[]) {
    logsState.data = logs;
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
  }

  const secao = () =>
    hospedeiro.querySelector("#historico-cotacoes-section") as HTMLElement;
  const linhasDeDado = () =>
    [...hospedeiro.querySelectorAll("tbody tr")].filter(
      (tr) => tr.querySelectorAll("td").length === 5,
    );
  const selo = (linha: Element) =>
    linha.querySelectorAll("td")[4]?.querySelector("span") as HTMLElement;

  it("pede a tabela de cotações, das mais recentes para as mais antigas, só 15", async () => {
    await abrir([log()]);
    expect(chamadas.tabela).toEqual(["shipping_calculation_logs"]);
    expect(chamadas.ordem).toEqual([["created_at", { ascending: false }]]);
    expect(chamadas.limite).toEqual([15]);
  });

  it("cada status tem o seu selo e a sua cor", async () => {
    await abrir([
      log({
        id: "a",
        status: "success",
        error_message: null,
        destination_cep: "38400001",
      }),
      log({ id: "b", status: "contingency", destination_cep: "38400002" }),
      log({ id: "c", status: "error", destination_cep: "38400003" }),
    ]);
    const selos = linhasDeDado().map(selo);
    expect(selos.map((s) => s.textContent)).toEqual([
      "Sucesso",
      "Valor de reserva",
      "Erro",
    ]);
    expect(selos[0]?.className).toContain("text-emerald-300");
    expect(selos[0]?.className).not.toContain("text-red-300");
    expect(selos[1]?.className).toContain("text-amber-300");
    expect(selos[1]?.className).not.toContain("text-red-300");
    expect(selos[2]?.className).toContain("text-red-300");
    expect(selos[2]?.className).not.toContain("text-emerald-300");
  });

  it("um erro sozinho não tem '×'; dois iguais seguidos viram uma linha '×2' e o rodapé conta os dois jeitos", async () => {
    await abrir([log({ id: "x" })]);
    expect(selo(linhasDeDado()[0] as Element).textContent).toBe("Erro");
    expect(secao().textContent).toContain("Exibindo a consulta mais recente");

    act(() => {
      raiz.unmount();
    });
    raiz = createRoot(hospedeiro);
    await abrir([log({ id: "y1" }), log({ id: "y2" })]);
    expect(linhasDeDado()).toHaveLength(1);
    expect(selo(linhasDeDado()[0] as Element).textContent).toBe("Erro ×2");
    expect(secao().textContent).toContain("2 consultas recentes em 1 linha");
  });

  it("três iguais seguidos: '×3'; uma diferente no meio quebra a sequência", async () => {
    await abrir([
      log({ id: "a1" }),
      log({ id: "a2" }),
      log({ id: "a3" }),
      log({ id: "b1", destination_cep: "38400999" }),
    ]);
    expect(linhasDeDado().map((l) => selo(l).textContent)).toEqual([
      "Erro ×3",
      "Erro",
    ]);
    expect(secao().textContent).toContain("4 consultas recentes em 2 linhas");
  });

  it("sucesso nunca agrupa: dois sucessos iguais seguem em duas linhas", async () => {
    await abrir([
      log({ id: "s1", status: "success", error_message: null }),
      log({ id: "s2", status: "success", error_message: null }),
    ]);
    expect(linhasDeDado()).toHaveLength(2);
    expect(linhasDeDado().map((l) => selo(l).textContent)).toEqual([
      "Sucesso",
      "Sucesso",
    ]);
    expect(secao().textContent).toContain(
      "Exibindo as 2 consultas mais recentes",
    );
  });

  it("motivo com 200 caracteres aparece inteiro; com 201 é cortado em 200 + reticências; o title guarda o texto todo", async () => {
    // Frase que a edge já grava em português passa do tradutor sem alteração;
    // o enchimento deixa o motivo com exatamente 200 e 201 caracteres.
    const inicio = "Nenhuma transportadora ligada. ";
    const m200 = inicio + "a".repeat(200 - inicio.length);
    const m201 = inicio + "b".repeat(201 - inicio.length);
    await abrir([
      log({ id: "m1", error_message: m200, destination_cep: "38400001" }),
      log({ id: "m2", error_message: m201, destination_cep: "38400002" }),
    ]);
    const celulasDoMotivo = [
      ...hospedeiro.querySelectorAll<HTMLElement>("td[title]"),
    ];
    expect(celulasDoMotivo).toHaveLength(2);
    const [curto, longo] = celulasDoMotivo as [HTMLElement, HTMLElement];
    expect(curto.getAttribute("title")).toBe(m200);
    expect(curto.textContent).toBe(`Motivo: ${m200}`);
    expect(longo.getAttribute("title")).toBe(m201);
    expect(longo.textContent).toBe(`Motivo: ${m201.slice(0, 200)}…`);
  });

  it("a célula do motivo ocupa as cinco colunas da tabela", async () => {
    await abrir([log()]);
    const celula = hospedeiro.querySelector("td[title]");
    expect(celula?.getAttribute("colspan")).toBe("5");
    expect(hospedeiro.querySelectorAll("thead th")).toHaveLength(5);
  });

  it("sem nenhuma consulta: mostra o aviso de vazio e o rodapé não inventa contagem", async () => {
    await abrir([]);
    expect(secao().textContent).toContain(
      "Nenhuma cotação registrada recentemente.",
    );
    expect(secao().textContent).not.toContain("Exibindo");
    expect(secao().textContent).not.toContain("consultas recentes");
    expect(secao().textContent).toContain("Atualizar");
  });
});
