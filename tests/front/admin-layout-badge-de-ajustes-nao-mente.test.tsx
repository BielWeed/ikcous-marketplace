// @vitest-environment jsdom
//
// Relato do Gabriel (02/09, com foto): a engrenagem de Ajustes na barra do
// painel mostrava o badge "2" — mas clicar nela abre as CONFIGURAÇÕES da
// loja, onde pendência nenhuma existe. Medido no banco de desenvolvimento:
// eram 2 perguntas de clientes SEM RESPOSTA ("Eu amei" e "Este livro de
// colorir vem com giz de cera?") — pendências reais, no DESTINO errado.
// Ajustes nunca lista pergunta; quem acende e leva à lista delas é o SINO
// (temAvisoNoSino → tela de Notificações).
//
// O CONTRATO (este arquivo):
//   1. Botão "Ajustes" (sidebar e barra inferior) NUNCA exibe o contador
//      de perguntas pendentes — badge com destino que não mostra a
//      pendência é badge mentiroso.
//   2. O aviso não desaparece do app: o botão "Notificações" continua
//      acendendo (dot vermelho) com perguntas pendentes.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// O que a RPC `get_admin_questions_paged('', 'pending', 0, 1)` devolve no
// banco de dev medido em 02/09: DUAS perguntas sem resposta.
const PERGUNTAS_PENDENTES_REAIS = 2;

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: vi.fn(() => {
      const builder: any = {};
      builder.select = vi.fn(() => builder);
      builder.eq = vi.fn(() => builder);
      builder.in = vi.fn(() => builder);
      builder.is = vi.fn(() => builder);
      // biome-ignore lint/suspicious/noThenProperty: mock do query builder thenable do Supabase
      builder.then = (resolve: any, reject?: any) =>
        Promise.resolve({ count: 0, error: null }).then(resolve, reject);
      return builder;
    }),
    rpc: vi.fn(() =>
      Promise.resolve({
        data: { total_count: PERGUNTAS_PENDENTES_REAIS },
        error: null,
      }),
    ),
    channel: vi.fn(() => ({
      on: vi.fn().mockReturnThis(),
      subscribe: vi.fn(),
    })),
    removeChannel: vi.fn(),
  },
}));

vi.mock("@/hooks/useAnalytics", () => ({
  useAnalytics: () => ({
    fetchExecutiveSummary: vi.fn(),
    fetchCategoryAnalytics: vi.fn(),
  }),
}));

vi.mock("@/hooks/useLeaderElection", () => ({
  useLeaderElection: () => ({ isLeader: false }),
}));

vi.mock("@/hooks/useOrders", () => ({
  useOrders: () => ({ loadOrders: vi.fn() }),
}));

vi.mock("@/hooks/useProducts", () => ({
  useProducts: () => ({ loadProducts: vi.fn() }),
}));

// @ts-expect-error flag interna do React, sem tipo público — mesmo padrão
// dos outros testes de componente deste projeto.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("AdminLayout — a engrenagem de Ajustes não carrega badge de perguntas", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.stubGlobal(
      "BroadcastChannel",
      class {
        postMessage() {}
        close() {}
        addEventListener() {}
        removeEventListener() {}
      },
    );
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: false,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }));
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

  it("com 2 perguntas pendentes, NENHUM botão de Ajustes mostra o número", async () => {
    const { AdminLayout } = await import("@/components/layouts/AdminLayout");

    await act(async () => {
      raiz.render(
        <AdminLayout currentView="admin-dashboard" onNavigate={vi.fn()}>
          <div />
        </AdminLayout>,
      );
    });

    // Espera a rodada de contagens chegar (coalescência de 1s no layout —
    // contagem chega antes disso, mas esperarAte não prejudica).
    const botoesAjustes = () =>
      Array.from(hospedeiro.querySelectorAll("button")).filter((b) =>
        b.textContent?.includes("Ajustes"),
      );
    await new Promise((r) => setTimeout(r, 50));

    expect(botoesAjustes().length).toBeGreaterThan(0);
    for (const botao of botoesAjustes()) {
      expect(botao.textContent).not.toContain(
        String(PERGUNTAS_PENDENTES_REAIS),
      );
    }
  });

  it("a pendência não some do app: o botão Notificações acende com perguntas pendentes", async () => {
    const { AdminLayout } = await import("@/components/layouts/AdminLayout");

    await act(async () => {
      raiz.render(
        <AdminLayout currentView="admin-dashboard" onNavigate={vi.fn()}>
          <div />
        </AdminLayout>,
      );
    });

    await new Promise((r) => setTimeout(r, 50));

    const sino = hospedeiro.querySelector<HTMLButtonElement>(
      'button[aria-label="Notificações"]',
    );
    expect(sino).toBeTruthy();
    // O dot vermelho de aviso — o caminho verdadeiro para as 2 perguntas.
    expect(sino!.querySelector("span.animate-pulse.bg-red-500")).not.toBeNull();
  });
});
