// @vitest-environment jsdom
//
// Folha da política "sob demanda": o pedaço da folha NÃO é baixado antes da
// primeira abertura (quem a usa — checkout, produto, cadastro — não paga esse
// peso na abertura da tela); ao abrir, baixa uma vez só.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PoliticaEmFolhaSobDemanda } from "@/components/politicas/PoliticaEmFolhaSobDemanda";

const { carregou } = vi.hoisted(() => ({ carregou: { vezes: 0 } }));

// A folha de verdade é trocada por uma dublê; o corpo da fábrica só roda quando
// o módulo é importado de fato, então conta quantas vezes o pedaço foi baixado.
vi.mock("@/components/politicas/PoliticaEmFolha", () => {
  carregou.vezes += 1;
  return {
    PoliticaEmFolha: ({ tipo }: { tipo: string | null }) => (
      <p data-testid="folha-dublada">{tipo ?? "fechada"}</p>
    ),
  };
});

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let raiz: Root;
let hospedeiro: HTMLDivElement;

beforeEach(() => {
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
});

afterEach(() => {
  act(() => raiz.unmount());
  hospedeiro.remove();
});

const esperar = (ms: number) =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });

describe("PoliticaEmFolhaSobDemanda — o pedaço só vem ao abrir", () => {
  it("fechada desde o começo não baixa a folha; ao abrir, baixa; ao fechar de novo, continua montada", async () => {
    await act(async () => {
      raiz.render(<PoliticaEmFolhaSobDemanda tipo={null} onFechar={vi.fn()} />);
    });
    await esperar(50);
    expect(carregou.vezes).toBe(0);
    expect(document.querySelector('[data-testid="folha-dublada"]')).toBeNull();

    await act(async () => {
      raiz.render(
        <PoliticaEmFolhaSobDemanda tipo="termos" onFechar={vi.fn()} />,
      );
    });
    await esperar(50);
    expect(carregou.vezes).toBe(1);
    expect(
      document.querySelector('[data-testid="folha-dublada"]')?.textContent,
    ).toBe("termos");

    // Depois da primeira abertura a folha fica montada (fechada), para a
    // animação de saída acontecer inteira.
    await act(async () => {
      raiz.render(<PoliticaEmFolhaSobDemanda tipo={null} onFechar={vi.fn()} />);
    });
    await esperar(50);
    expect(
      document.querySelector('[data-testid="folha-dublada"]')?.textContent,
    ).toBe("fechada");
    expect(carregou.vezes).toBe(1);
  });
});
