// @vitest-environment jsdom
//
// Rolagem horizontal na tela inteira do Admin > Enviar Notificações em
// 360-390px (pedido do dono, 23/09/2026): o título "ENVIAR NOTIFICAÇÕES"
// cortava, junto com o card do formulário e a prévia.
//
// jsdom não faz layout de verdade (não calcula largura de texto nem
// scrollWidth) — este arquivo não mede pixel nenhum, ele PRENDE as classes
// que causam e que corrigem o estouro, por análise estática:
//
//   1. O cabeçalho (AdminPageHeader com "acoes") tem DOIS filhos `shrink-0`
//      numa linha `flex ... justify-between` SEM `flex-wrap`: o título
//      "Enviar Notificações" (text-2xl uppercase, ~300px) + o selo de
//      status ("Avisos de Vendas Ativos"/"Desativados", ~160px) somam mais
//      que os ~328px disponíveis em 360px (viewport - px-4 dos dois lados).
//      `AdminPageHeader` é compartilhado por 20 telas — a correção é LOCAL,
//      na própria linha desta view: `flex-wrap` deixa o selo cair para uma
//      segunda linha em vez de forçar a linha inteira a alargar.
//   2. A prévia do celular tinha `w-[300px]` FIXO. Em 360px o card ainda
//      cabe (300 + 12px*2 do padding da página + 14px*2 do cartão = 352 <
//      360, mas só 8px de folga), e em 320px (iPhone SE, ainda em uso) já
//      NÃO cabe. `w-full max-w-[300px]` deixa a prévia encolher com a tela
//      em vez de manter um piso fixo maior que o disponível.
//
// Nenhuma medição em navegador real foi feita neste arquivo (sem sessão de
// admin disponível no ambiente do agente) — a conta de largura acima é a
// evidência, e o relatório da tarefa declara isso.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: "admin-1" } }),
}));

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: { realTimeSalesAlerts: true },
    isLoaded: true,
    updateConfig: vi.fn(),
  }),
}));

vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));

vi.mock("@/hooks/usePushNotifications", () => ({
  usePushNotifications: () => ({
    isSupported: false,
    subscribe: vi.fn(),
  }),
}));

vi.mock("@/hooks/useVOR", () => ({
  useVOR: () => ({ recordAction: vi.fn() }),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => ({
      select: () => ({
        order: () => ({
          limit: () => Promise.resolve({ data: [], error: null }),
        }),
        eq: () => ({
          order: () => Promise.resolve({ data: [], error: null }),
        }),
      }),
    }),
    rpc: () => Promise.resolve({ data: 0, error: null }),
    functions: { invoke: vi.fn() },
  },
}));

// @ts-expect-error flag interna do React, sem tipo público — mesmo padrão
// dos vizinhos deste diretório.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
class IntersectionObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

function esperar(ms = 0): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("AdminPushView — cabeçalho e prévia não travam largura fixa no mobile", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("ResizeObserver", ResizeObserverStub);
    vi.stubGlobal("IntersectionObserver", IntersectionObserverStub);
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
    vi.restoreAllMocks();
  });

  async function abrirTela() {
    const { AdminPushView } = await import("@/views/admin/AdminPushView");
    await act(async () => {
      raiz.render(<AdminPushView onNavigate={vi.fn()} />);
    });
    await act(async () => {
      await esperar(50);
    });
  }

  it("a linha do título e do selo de status pode quebrar em duas linhas (flex-wrap) em vez de forçar a página a alargar", async () => {
    await abrirTela();

    const h1 = hospedeiro.querySelector("h1");
    expect(h1).toBeTruthy();
    expect(h1!.textContent).toContain("Enviar Notificações");

    // A linha que abraça o h1 (título, shrink-0) e o wrapper de `acoes`
    // (selo de status, também shrink-0, vindo do próprio AdminPageHeader)
    // é o pai imediato do h1. Sem `flex-wrap` os dois nunca encolhem e
    // nunca quebram — a soma das duas larguras força a página inteira.
    const linhaDoCabecalho = h1!.parentElement;
    expect(linhaDoCabecalho).toBeTruthy();
    expect(linhaDoCabecalho!.className).toContain("flex-wrap");
  });

  it("a prévia do celular encolhe em telas estreitas em vez de manter piso fixo de 300px", async () => {
    await abrirTela();

    const previa = hospedeiro.querySelector('[data-testid="previa-celular"]');
    expect(previa).toBeTruthy();

    // Primeiro filho da prévia é o "shell" do aparelho — o que carregava o
    // `w-[300px]` fixo.
    const shell = previa!.firstElementChild as HTMLElement | null;
    expect(shell).toBeTruthy();
    expect(shell!.className).toContain("max-w-[300px]");
    expect(shell!.className).toContain("w-full");
  });
});
