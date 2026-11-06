// @vitest-environment jsdom
//
// Na Home, o convite de avisos (fixo, z-[999], ~150 px de altura a 80 px do
// fundo) cobria o lembrete "Seu carrinho" (z-40, a 76 px do fundo) -- e o
// lembrete gastava os 8 s dele escondido por baixo, sumindo sem ninguém ver.
// Os dois nunca podem disputar o lugar: enquanto o convite está à mostra o
// lembrete nem monta; quando o convite sai, o lembrete aparece e conta os 8 s
// dele do zero.
//
// Componentes de verdade; a `Home` abaixo repete a ligação feita no App
// (`docked={isHeaderDocked && !conviteVisivel}` + `onVisibleChange`), e o último
// teste confere que o App tem essa mesma ligação.
import { readFileSync } from "node:fs";
import { act, useState } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: { storeName: "Loja de Teste", shippingFee: 0, freeShippingMin: 0 },
  }),
}));
vi.mock("@/lib/supabase", () => ({ supabase: {} }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/hooks/useCart", () => ({
  useCart: () => ({ cart: [{ id: "p1" }], cartCount: 1, cartTotal: 10 }),
}));
vi.mock("@/hooks/usePushNotifications", () => ({
  usePushNotifications: () => ({
    isSupported: true,
    permission: "default" as NotificationPermission,
    subscription: null,
    semConta: false,
    subscribe: vi.fn(),
    unsubscribe: vi.fn(),
  }),
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

import { PushNotificationBanner } from "@/components/pwa/PushNotificationBanner";
import { CartReminder } from "@/components/ui/custom/CartReminder";

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
    clear: () => armazem.clear(),
    key: (i: number) => Array.from(armazem.keys()).at(i) ?? null,
    get length() {
      return armazem.size;
    },
  };
}

function Home({ headerDocked = true }: { headerDocked?: boolean }) {
  const [conviteVisivel, setConviteVisivel] = useState(false);
  return (
    <>
      <CartReminder
        onAction={() => {}}
        docked={headerDocked && !conviteVisivel}
      />
      <PushNotificationBanner
        currentView="home"
        onVisibleChange={setConviteVisivel}
      />
    </>
  );
}

describe("convite de avisos x lembrete do carrinho na Home", () => {
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

  const convite = () => document.body.textContent?.includes("Quero Receber!");
  const lembrete = () => document.body.textContent?.includes("Seu carrinho");
  // Em passos curtos: o React só processa a cadeia convite -> lembrete entre
  // um `act` e outro, e a saída animada do lembrete também gasta relógio.
  const avancar = async (ms: number) => {
    for (let gasto = 0; gasto < ms; gasto += 250) {
      await act(async () => {
        vi.advanceTimersByTime(250);
      });
    }
  };

  // Um teste só, de ponta a ponta: o framer-motion perde o fio das animações
  // quando o relógio falso é desligado e religado entre dois testes.
  it("convite à mostra: lembrete fora e sem gastar os 8 s; convite dispensado: lembrete volta e conta do zero", async () => {
    await act(async () => {
      root.render(<Home />);
    });
    await avancar(4000);
    expect(convite()).toBe(true);
    expect(lembrete()).toBe(false);

    // Bem além dos 8 s do lembrete: o convite segue lá, o lembrete não voltou.
    await avancar(20_000);
    expect(convite()).toBe(true);
    expect(lembrete()).toBe(false);

    await act(async () => {
      Array.from(document.querySelectorAll<HTMLButtonElement>("button"))
        .find((b) => b.textContent?.includes("Agora Não"))!
        .click();
    });
    await avancar(2000);
    expect(convite()).toBe(false);
    expect(lembrete()).toBe(true);

    // 8 s do zero: ainda na tela aos ~6 s, fora depois dos ~9 s.
    await avancar(4000);
    expect(lembrete()).toBe(true);
    await avancar(4000);
    expect(lembrete()).toBe(false);
  });

  it("o App liga o convite ao lembrete: docked só quando o convite não está à mostra", () => {
    const app = readFileSync("src/App.tsx", "utf8");
    expect(app).toContain("docked={isHeaderDocked && !conviteVisivel}");
    expect(app).toContain("onVisibleChange={setConviteVisivel}");
  });
});
