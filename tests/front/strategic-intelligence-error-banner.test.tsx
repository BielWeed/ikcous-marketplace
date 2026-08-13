// @vitest-environment jsdom
//
// Trilha 4 (#104): o bloco "Divisão de Faturamento" tratava falha de RPC e
// ausência real de dados da mesma forma — as duas caíam no mesmo empty state
// "Sem Dados Registrados", e o admin concluía que não houve vendas quando na
// verdade a consulta quebrou. Estes testes provam:
//
//   1. com `error` setado, aparece um banner de falha com "tentar de novo",
//      e NÃO o empty state;
//   2. sem `error` e sem categorias, continua aparecendo "Sem Dados
//      Registrados" (a consulta teve sucesso e devolveu zero linhas);
//   3. o banner de erro é visualmente distinto do empty state (classes de
//      cor diferentes — vermelho vs. cinza neutro).
//
// Os dois primeiros casos retornam ANTES da árvore do Recharts (mesmo padrão
// do empty state que já existia), então não precisam de polyfill de
// ResizeObserver/matchMedia — só o teste do gráfico com dados de verdade
// precisaria disso, e não é o que esta tarefa cobre.
import type { CategoryData } from "@/components/admin/dashboard/StrategicIntelligenceBlocks";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público — mesmo padrão de
// tests/front/admin-orders-payment-filter.test.tsx.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// O componente só sai do esqueleto depois que `isChartReady` vira `true`,
// via um `setTimeout(..., 180)` real (não fake timer). Renderizar com
// `act(() => ...)` SÍNCRONO e só then esperar por fora do `act` — dentro de
// um `act(async () => { ...; await wait(); })` o timer do componente não
// dispara antes do callback do act resolver (reproduzido isolado num teste
// mínimo antes deste arquivo). 220ms dá folga sobre os 180ms do componente.
function esperarChartPronto(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 220));
}

describe("StrategicIntelligenceBlocks — erro distinto do vazio (#104)", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    // `useMediaQuery` (usado internamente para `_isMobile`) chama
    // `window.matchMedia`, que o jsdom deste projeto não implementa —
    // mesmo em cima dos ramos de erro/vazio, que retornam ANTES do gráfico:
    // o hook roda no mount independente de qual ramo é renderizado.
    vi.stubGlobal(
      "matchMedia",
      vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    );
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    vi.unstubAllGlobals();
  });

  it("com error setado, mostra banner de falha com botão de tentar de novo — não o empty state", async () => {
    const { StrategicIntelligenceBlocks } = await import(
      "@/components/admin/dashboard/StrategicIntelligenceBlocks"
    );
    const onRetry = vi.fn();

    act(() => {
      raiz.render(
        <StrategicIntelligenceBlocks
          categoryData={[] as CategoryData[]}
          loading={false}
          error="RPC de categoria quebrada"
          onRetry={onRetry}
        />,
      );
    });
    await esperarChartPronto();
    act(() => {});

    expect(hospedeiro.textContent).not.toContain("Sem Dados Registrados");
    expect(hospedeiro.textContent).toContain("RPC de categoria quebrada");

    const botaoTentar = Array.from(hospedeiro.querySelectorAll("button")).find(
      (b) => /tentar/i.test(b.textContent ?? ""),
    );
    expect(botaoTentar).toBeTruthy();

    act(() => {
      botaoTentar?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("sem error e sem categorias, continua mostrando 'Sem Dados Registrados'", async () => {
    const { StrategicIntelligenceBlocks } = await import(
      "@/components/admin/dashboard/StrategicIntelligenceBlocks"
    );

    act(() => {
      raiz.render(
        <StrategicIntelligenceBlocks
          categoryData={[] as CategoryData[]}
          loading={false}
          error={null}
        />,
      );
    });
    await esperarChartPronto();
    act(() => {});

    expect(hospedeiro.textContent).toContain("Sem Dados Registrados");
  });

  it("o banner de erro usa classes visuais distintas do empty state (vermelho vs. neutro)", async () => {
    const { StrategicIntelligenceBlocks } = await import(
      "@/components/admin/dashboard/StrategicIntelligenceBlocks"
    );

    act(() => {
      raiz.render(
        <StrategicIntelligenceBlocks
          categoryData={[] as CategoryData[]}
          loading={false}
          error="RPC de categoria quebrada"
        />,
      );
    });
    await esperarChartPronto();
    act(() => {});
    const containerErro = hospedeiro.firstElementChild as HTMLElement;
    expect(containerErro.className).toMatch(/red/);

    act(() => {
      raiz.render(
        <StrategicIntelligenceBlocks
          categoryData={[] as CategoryData[]}
          loading={false}
          error={null}
        />,
      );
    });
    await esperarChartPronto();
    act(() => {});
    const containerVazio = hospedeiro.firstElementChild as HTMLElement;
    expect(containerVazio.className).not.toMatch(/red/);
  });
});
