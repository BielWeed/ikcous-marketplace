// @vitest-environment jsdom
import { FluxoDeCaixaGrafico } from "@/components/admin/financeiro/FluxoDeCaixaGrafico";
import { ContextoValoresOcultos } from "@/components/admin/financeiro/partes";
import { type ReactElement, type ReactNode, act, cloneElement } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// Exercita o conteúdo real do balão, sem depender do layout do jsdom.
vi.mock("recharts", () => {
  const filhos = ({ children }: { children?: ReactNode }) => children;
  return {
    ResponsiveContainer: filhos,
    AreaChart: ({ children }: { children?: ReactNode }) => (
      <svg>{children}</svg>
    ),
    BarChart: ({ children }: { children?: ReactNode }) => <svg>{children}</svg>,
    Area: () => null,
    Bar: () => null,
    CartesianGrid: () => null,
    ReferenceLine: () => null,
    XAxis: () => null,
    YAxis: () => null,
    Tooltip: ({ content }: { content: ReactElement }) => (
      <>
        {cloneElement(content, {
          active: true,
          payload: [
            {
              payload: {
                dia: "2026-11-17",
                entradas: 50,
                saidas: saidaDoDia,
                resultado: 50 - saidaDoDia,
                saldo: 100,
              },
            },
          ],
        } as object)}
      </>
    ),
  };
});

let saidaDoDia = 0;
let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.useFakeTimers();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
});

it.each([
  [0, false, "R$ 0,00"],
  [12.5, false, "−R$ 12,50"],
  [12.5, true, "−R$ ••••"],
] as const)(
  "saída %s, valores ocultos %s: mostra %s nos dois gráficos",
  (saida, ocultos, esperado) => {
    saidaDoDia = saida;
    act(() => {
      root.render(
        <ContextoValoresOcultos.Provider value={ocultos}>
          <FluxoDeCaixaGrafico
            pontos={[
              {
                dia: "2026-11-16",
                entradas: 50,
                saidas: saida,
                resultado: 50 - saida,
                saldo: 100,
              },
              {
                dia: "2026-11-17",
                entradas: 50,
                saidas: 0,
                resultado: 50,
                saldo: 150,
              },
            ]}
            carregando={false}
            ativo={true}
            marco={null}
          />
        </ContextoValoresOcultos.Provider>,
      );
      vi.advanceTimersByTime(300);
    });
    act(() => vi.advanceTimersByTime(300));
    const conferirSaida = () => {
      const balao = container.querySelector('[data-testid="fluxo-tooltip"]');
      expect(balao).not.toBeNull();
      const linha = [...balao!.querySelectorAll("p")].find((p) =>
        p.textContent?.includes("Saídas"),
      );
      expect(
        linha?.lastElementChild?.textContent?.replace(/\s/g, " ").trim(),
      ).toBe(esperado);
    };
    conferirSaida();
    const movimentos = [...container.querySelectorAll("button")].find(
      (b) => b.textContent === "Entradas e saídas",
    );
    expect(movimentos).toBeTruthy();
    act(() => movimentos!.click());
    conferirSaida();
  },
);
