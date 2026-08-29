// @vitest-environment jsdom
//
// A cliente toca "Quero Receber!", aceita o balão do navegador — a permissão
// vira `granted` NESSE instante — e a inscrição em si falha depois (o
// `pushManager.subscribe()` ou a gravação no Supabase, em
// `usePushNotifications.ts:149-226`). O `granted` grava no navegador de
// forma permanente; o `PushNotificationBanner` escondia o convite para
// sempre a partir de `permission === "granted"` sozinho, mesmo sem
// `subscription` nenhuma — a cliente acredita que vai receber e não chega
// mais nada.
//
// O conserto: `granted` só some o banner quando HÁ inscrição
// (`subscription` não é `null`). `granted` + `subscription === null` volta a
// contar como "ainda precisa se inscrever".
//
// Os dois controles negativos abaixo são o que decide este teste: um banner
// que aparece sempre passaria trivialmente no cenário principal. Precisa
// provar que quem JÁ está inscrita continua sem ver o banner, e que quem
// NEGOU a permissão (estado permanente e diferente de "granted sem
// inscrição") também continua sem ver.
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

const DISMISS_KEY = "ikcous_push_banner_dismissed_until";

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

// Node 25 pisa em `localStorage` global antes do jsdom — mesmo contorno de
// auth-logout-cleanup.test.tsx e auth-admin-check.test.tsx.
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

describe("PushNotificationBanner — 'granted' sem inscrição não esconde o convite para sempre", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("localStorage", criarLocalStorageFake());
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  function montar() {
    act(() => {
      root.render(<PushNotificationBanner />);
    });
  }

  function avancarDelayDeExibicao() {
    act(() => {
      vi.advanceTimersByTime(2600);
    });
  }

  it("permissão concedida mas SEM inscrição (subscribe/gravação falhou depois): o banner volta a aparecer", () => {
    usePushNotificationsMock.mockReturnValue(
      estadoPadrao({ permission: "granted", subscription: null }),
    );

    montar();
    avancarDelayDeExibicao();

    expect(container.textContent).toContain("Quero Receber!");
  });

  // Controle negativo 1: quem JÁ tem inscrição continua sem ver o banner,
  // mesmo com a mesma permissão "granted" do cenário acima. Sem este teste,
  // um banner que aparecesse sempre passaria no teste de cima.
  it("controle: permissão concedida E já inscrita — o banner NÃO aparece", () => {
    usePushNotificationsMock.mockReturnValue(
      estadoPadrao({
        permission: "granted",
        subscription: { endpoint: "https://push.example/ja-inscrita" },
      }),
    );

    montar();
    avancarDelayDeExibicao();

    expect(container.textContent).not.toContain("Quero Receber!");
  });

  // Controle negativo 2: permissão NEGADA (decisão confirmada da cliente,
  // estado permanente e diferente de "granted sem inscrição") continua sem
  // mostrar o banner — o conserto não pode ter afrouxado esta trava junto.
  it("controle: permissão negada — o banner NÃO aparece", () => {
    usePushNotificationsMock.mockReturnValue(
      estadoPadrao({ permission: "denied", subscription: null }),
    );

    montar();
    avancarDelayDeExibicao();

    expect(container.textContent).not.toContain("Quero Receber!");
  });

  // O cooldown de 7 dias (dispensei o banner) é intencional e não pode
  // regredir: mesmo "granted sem inscrição" tem que respeitar o dismiss.
  it("cliente dispensou o banner nos últimos 7 dias: continua sem aparecer, mesmo com 'granted sem inscrição'", () => {
    const daquiA7Dias = Date.now() + 6 * 24 * 60 * 60 * 1000;
    localStorage.setItem(DISMISS_KEY, daquiA7Dias.toString());
    usePushNotificationsMock.mockReturnValue(
      estadoPadrao({ permission: "granted", subscription: null }),
    );

    montar();
    avancarDelayDeExibicao();

    expect(container.textContent).not.toContain("Quero Receber!");
  });

  // Caminho ainda pendente (nunca respondeu ao balão) não pode ter
  // regredido: continua aparecendo, do jeito que já era antes do conserto.
  it("permissão ainda pendente ('default'): continua aparecendo, como antes", () => {
    usePushNotificationsMock.mockReturnValue(
      estadoPadrao({ permission: "default", subscription: null }),
    );

    montar();
    avancarDelayDeExibicao();

    expect(container.textContent).toContain("Quero Receber!");
  });
});
