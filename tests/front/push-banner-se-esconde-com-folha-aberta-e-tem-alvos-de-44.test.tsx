// @vitest-environment jsdom
//
// UI-191 (G2): o convite de notificações (fixo, z-[999], a 80 px do fundo)
// cobria o rodapé "Adicionar" da folha de opções e o "Aplicar filtros" da
// busca, porque só se escondia POR NOME DE TELA. Agora ele some enquanto
// houver qualquer folha/diálogo modal aberto (o sinal global que o Radix já
// põe no <body> ao travar a rolagem) e volta quando fecha. Também: alvos de
// toque de 44 px e letra legível (12 px, não 10).
import { act, useState } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: { storeName: "Loja de Teste" } }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
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
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "@/components/ui/sheet";

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

function Tela() {
  const [aberta, setAberta] = useState(false);
  return (
    <>
      <button type="button" data-testid="abrir" onClick={() => setAberta(true)}>
        abrir
      </button>
      <Sheet open={aberta} onOpenChange={setAberta}>
        <SheetContent side="bottom" showCloseButton={false}>
          <SheetTitle>Folha</SheetTitle>
          <SheetDescription>Descrição</SheetDescription>
          <button
            type="button"
            data-testid="fechar"
            onClick={() => setAberta(false)}
          >
            fechar
          </button>
        </SheetContent>
      </Sheet>
      <PushNotificationBanner currentView="home" />
    </>
  );
}

describe("PushNotificationBanner — folha aberta e alvos de toque", () => {
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
  const avancar = (ms: number) =>
    act(() => {
      vi.advanceTimersByTime(ms);
    });

  async function montarEEsperarConvite() {
    await act(async () => {
      root.render(<Tela />);
    });
    await avancar(2600);
  }

  it("controle: sem folha aberta o convite aparece (e no mesmo momento de antes)", async () => {
    await montarEEsperarConvite();
    expect(convite()).toBe(true);
  });

  it("com uma folha aberta o convite SOME; ao fechar, volta", async () => {
    await montarEEsperarConvite();
    expect(convite()).toBe(true);

    await act(async () => {
      document
        .querySelector<HTMLButtonElement>('[data-testid="abrir"]')!
        .click();
    });
    await avancar(50);
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    expect(convite()).toBe(false);

    await act(async () => {
      document
        .querySelector<HTMLButtonElement>('[data-testid="fechar"]')!
        .click();
    });
    await avancar(500);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(convite()).toBe(true);
  });

  it("alvos de 44 px e letra de 12 px: X, 'Quero Receber!' e 'Agora Não'", async () => {
    await montarEEsperarConvite();
    const botao = (rotulo: string) =>
      Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find(
        (b) =>
          b.textContent?.includes(rotulo) ||
          b.getAttribute("aria-label") === rotulo,
      )!;
    const fechar = botao("Fechar");
    expect(fechar.className).toContain("size-11");
    for (const rotulo of ["Quero Receber!", "Agora Não"]) {
      const b = botao(rotulo);
      expect(b.className).toContain("min-h-11");
      expect(b.className).toContain("text-xs");
      expect(b.className).not.toMatch(/text-\[10px\]/);
    }
  });
});
