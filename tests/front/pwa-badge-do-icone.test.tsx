// @vitest-environment jsdom
// O número no ícone do app instalado (carrinho). Nenhum teste cobria este hook:
// regra de "zero apaga o número", navegador sem a API e falha da API.
import { useAppBadge } from "@/hooks/useAppBadge";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

type Badge = ReturnType<typeof useAppBadge>;

let raiz: Root;
let hospedeiro: HTMLDivElement;
let badge: Badge;

function Sonda({ aoLer }: { aoLer: (valor: Badge) => void }) {
  aoLer(useAppBadge());
  return null;
}

function instalarApi(nome: "setAppBadge" | "clearAppBadge", fn: unknown) {
  Object.defineProperty(navigator, nome, {
    configurable: true,
    writable: true,
    value: fn,
  });
}

function montar() {
  act(() =>
    raiz.render(
      <Sonda
        aoLer={(valor) => {
          badge = valor;
        }}
      />,
    ),
  );
}

beforeEach(() => {
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
});

afterEach(() => {
  act(() => raiz.unmount());
  hospedeiro.remove();
  // biome-ignore lint/performance/noDelete: precisa sumir de verdade para `in navigator` voltar a ser falso.
  delete (navigator as unknown as Record<string, unknown>).setAppBadge;
  // biome-ignore lint/performance/noDelete: idem.
  delete (navigator as unknown as Record<string, unknown>).clearAppBadge;
});

describe("useAppBadge — número no ícone do app instalado", () => {
  it("sem a API do navegador, nada acontece e nada lança", async () => {
    montar();
    expect(badge.isSupported).toBe(false);
    await act(async () => {
      await badge.setBadge(5);
      await badge.clearBadge();
    });
    expect(badge.getCurrentBadge()).toBe(0);
  });

  it("contagem positiva vai ao ícone e fica lembrada", async () => {
    const definir = vi.fn(async () => {});
    const limpar = vi.fn(async () => {});
    instalarApi("setAppBadge", definir);
    instalarApi("clearAppBadge", limpar);
    montar();
    expect(badge.isSupported).toBe(true);

    await act(async () => badge.setBadge(3));

    expect(definir).toHaveBeenCalledExactlyOnceWith(3);
    expect(limpar).not.toHaveBeenCalled();
    expect(badge.getCurrentBadge()).toBe(3);
  });

  it.each([0, -1])(
    "contagem %i apaga o número do ícone em vez de mostrar zero",
    async (contagem) => {
      const definir = vi.fn(async () => {});
      const limpar = vi.fn(async () => {});
      instalarApi("setAppBadge", definir);
      instalarApi("clearAppBadge", limpar);
      montar();
      await act(async () => badge.setBadge(4));
      definir.mockClear();

      await act(async () => badge.setBadge(contagem));

      expect(limpar).toHaveBeenCalledTimes(1);
      expect(definir).not.toHaveBeenCalled();
      expect(badge.getCurrentBadge()).toBe(0);
    },
  );

  it("clearBadge apaga o ícone e zera o lembrado", async () => {
    const definir = vi.fn(async () => {});
    const limpar = vi.fn(async () => {});
    instalarApi("setAppBadge", definir);
    instalarApi("clearAppBadge", limpar);
    montar();
    await act(async () => badge.setBadge(2));

    await act(async () => badge.clearBadge());

    expect(limpar).toHaveBeenCalledTimes(1);
    expect(badge.getCurrentBadge()).toBe(0);
  });

  it("a API recusar não derruba a tela nem finge que o número foi mostrado", async () => {
    const definir = vi
      .fn<(n: number) => Promise<void>>()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("contexto sem permissão"));
    const limpar = vi.fn(async () => {
      throw new Error("contexto sem permissão");
    });
    instalarApi("setAppBadge", definir);
    instalarApi("clearAppBadge", limpar);
    montar();
    await act(async () => badge.setBadge(2));
    expect(badge.getCurrentBadge()).toBe(2);

    // Número novo recusado: o lembrado continua sendo o que está no ícone.
    await act(async () => badge.setBadge(7));
    expect(badge.getCurrentBadge()).toBe(2);

    // Apagar recusado: idem, e nenhum dos dois lança.
    await act(async () => badge.clearBadge());
    expect(badge.getCurrentBadge()).toBe(2);
    await act(async () => badge.setBadge(0));
    expect(badge.getCurrentBadge()).toBe(2);
  });

  it("navegador que só tem setAppBadge (sem clearAppBadge) não lança ao zerar", async () => {
    instalarApi(
      "setAppBadge",
      vi.fn(async () => {}),
    );
    montar();
    await act(async () => badge.setBadge(3));

    await act(async () => badge.setBadge(0));

    expect(badge.getCurrentBadge()).toBe(0);
  });

  it("as funções devolvidas são estáveis entre renders (o efeito do carrinho não reexecuta à toa)", () => {
    instalarApi(
      "setAppBadge",
      vi.fn(async () => {}),
    );
    montar();
    const primeiras = { definir: badge.setBadge, limpar: badge.clearBadge };
    montar();
    expect(badge.setBadge).toBe(primeiras.definir);
    expect(badge.clearBadge).toBe(primeiras.limpar);
  });
});
