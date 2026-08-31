// @vitest-environment jsdom
//
// O MODAL DE PUSH NÃO PISA NO CAMINHO DO DINHEIRO (laudo ofensiva+mobile
// 3108, achado N6).
//
// O DEFEITO PROVADO EM TELA (31/08, viewport 390×844): o banner é
// `fixed z-[999] bottom-20` — exatamente sobre a barra inferior do carrinho
// e do checkout onde mora o botão Finalizar. O toque no Finalizar era
// interceptado pelo "Agora Não" do modal (a automação do navegador tentou
// 15+ vezes; o alvo do toque era sempre o botão do modal). Cliente real:
// toca Finalizar, recusa push sem querer (e o cooldown de 7 dias matava o
// convite), e só numa segunda tentativa consegue fechar o pedido — se
// perceber que precisa de segunda tentativa.
//
// O conserto: `cart` e `checkout` entram na MESMA lista de exclusão do
// `admin`/`order-success` (passo 2 do efeito). Controles negativos decidem
// o teste: banner que nunca aparece passaria trivialmente — precisa provar
// que na VITRINE ele continua nascendo.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: { storeName: "Loja de Teste" },
  }),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

const usePushNotificationsMock = vi.fn();
vi.mock("@/hooks/usePushNotifications", () => ({
  usePushNotifications: () => usePushNotificationsMock(),
}));

// @ts-expect-error flag interna do React, sem tipo público — mesmo padrão
// dos outros testes de componente deste projeto.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

import { PushNotificationBanner } from "@/components/pwa/PushNotificationBanner";

interface EstadoDoHook {
  isSupported: boolean;
  permission: NotificationPermission;
  subscription: unknown;
  subscribe: ReturnType<typeof vi.fn>;
  unsubscribe: ReturnType<typeof vi.fn>;
}

function estadoPadrao(sobrescreve: Partial<EstadoDoHook>): EstadoDoHook {
  return {
    isSupported: true,
    permission: "default",
    subscription: null,
    subscribe: vi.fn(),
    unsubscribe: vi.fn(),
    ...sobrescreve,
  };
}

function criarLocalStorageFake() {
  const armazem = new Map<string, string>();
  return {
    getItem: (chave: string) => armazem.get(chave) ?? null,
    setItem: (chave: string, valor: string) => {
      armazem.set(chave, valor);
    },
    removeItem: (chave: string) => {
      armazem.delete(chave);
    },
    clear: () => {
      armazem.clear();
    },
    key: (index: number) => Array.from(armazem.keys()).at(index) ?? null,
    get length() {
      return armazem.size;
    },
  };
}

describe("PushNotificationBanner — não pisa no caminho do dinheiro", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("localStorage", criarLocalStorageFake());
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    usePushNotificationsMock.mockReturnValue(estadoPadrao({}));
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  function montar(currentView: string) {
    act(() => {
      root.render(<PushNotificationBanner currentView={currentView} />);
    });
  }

  function avancarDelayDeExibicao() {
    act(() => {
      vi.advanceTimersByTime(2600);
    });
  }

  it("no CHECKOUT o banner não nasce nem depois do delay", () => {
    montar("checkout");
    avancarDelayDeExibicao();
    expect(container.textContent).not.toContain("Quero Receber!");
  });

  it("no CARRINHO o banner não nasce nem depois do delay", () => {
    montar("cart");
    avancarDelayDeExibicao();
    expect(container.textContent).not.toContain("Quero Receber!");
  });

  // Controle negativo: um banner que nunca aparece passaria nos dois testes
  // de cima. Na vitrine o convite CONTINUA nascendo — o conserto é uma
  // exclusão de duas telas, não a morte do convite.
  it("controle: na vitrine (home) o banner continua aparecendo", () => {
    montar("home");
    avancarDelayDeExibicao();
    expect(container.textContent).toContain("Quero Receber!");
  });

  // O cenário real do N6: o cliente estava na home (banner visível) e
  // NAVEGOU para o checkout. O efeito roda de novo com currentView novo —
  // o banner tem de SAIR de cima do Finalizar, não só "não nascer".
  it("banner que já estava visível SAI quando a cliente entra no checkout", () => {
    montar("home");
    avancarDelayDeExibicao();
    expect(container.textContent).toContain("Quero Receber!");

    act(() => {
      root.render(<PushNotificationBanner currentView="checkout" />);
    });
    expect(container.textContent).not.toContain("Quero Receber!");
  });

  it("sair do checkout sem tocar no banner não gera cooldown de 7 dias", () => {
    montar("home");
    avancarDelayDeExibicao();
    act(() => {
      root.render(<PushNotificationBanner currentView="checkout" />);
    });
    // Navegar de volta SEM ter tocado em "Agora Não": o convite volta, e o
    // localStorage NUNCA ganhou o selo de dispensa (o toque acidental no
    // "Agora Não" de antes matava o convite por 7 dias).
    act(() => {
      root.render(<PushNotificationBanner currentView="home" />);
    });
    avancarDelayDeExibicao();
    expect(container.textContent).toContain("Quero Receber!");
    expect(localStorage.getItem("ikcous_push_banner_dismissed_until")).toBe(
      null,
    );
  });
});
