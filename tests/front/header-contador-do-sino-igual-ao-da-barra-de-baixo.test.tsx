// @vitest-environment jsdom
//
// Pedido do Gabriel (21/10/2026): o contador de notificações da barra
// superior estava em âmbar/laranja, mas o padrão do app para contador é a
// bolinha preta com número branco e anel branco — a que a barra inferior já
// usa em Favoritos e Carrinho. Esta suíte trava as duas bolinhas na mesma
// família visual: se uma mudar, a outra tem de mudar junto.
import { StrictMode, act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { StoreConfig } from "@/types";

let mockConfig: Partial<StoreConfig> = {};
let mockNaoLidas = 0;
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: mockConfig }),
}));
vi.mock("@/contexts/NotificationContextCore", () => ({
  useNotificationCenter: () => ({ unreadCount: mockNaoLidas }),
}));
vi.mock("@/components/ui/custom/SearchBar", () => ({
  SearchBar: () => null,
}));

// @ts-expect-error flag interna do React, mesmo padrão de header-center-slot.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("Header — contador do sino segue o padrão da barra de baixo", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    mockConfig = { storeName: "LOJA DA PROVA" };
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
  });

  async function desenhar(naoLidas: number) {
    mockNaoLidas = naoLidas;
    const { Header } = await import("@/components/ui/custom/Header");
    await act(async () => {
      raiz.render(
        <StrictMode>
          <Header onNavigate={() => {}} onOpenNotifications={() => {}} />
        </StrictMode>,
      );
    });
    return hospedeiro.querySelector<HTMLButtonElement>(
      'button[aria-label^="Notificações"]',
    );
  }

  it("com notificações não lidas: bolinha preta, número branco, anel branco, sem laranja", async () => {
    const sino = await desenhar(6);
    const bolinha = Array.from(sino?.querySelectorAll("span") ?? []).find(
      (s) => s.textContent === "6",
    );
    expect(bolinha).toBeDefined();
    const classes = bolinha?.className ?? "";
    expect(classes).toContain("bg-zinc-950");
    expect(classes).toContain("text-white");
    expect(classes).toContain("border-2");
    expect(classes).toContain("border-white");
    expect(classes).not.toMatch(/amber|orange/);
  });

  it("acima de 99 mostra 99+, como a barra de baixo", async () => {
    const sino = await desenhar(120);
    const textos = Array.from(sino?.querySelectorAll("span") ?? []).map(
      (s) => s.textContent,
    );
    expect(textos).toContain("99+");
  });

  it("sem não lidas, nenhuma bolinha aparece", async () => {
    const sino = await desenhar(0);
    expect(sino?.querySelectorAll("span").length ?? 0).toBe(0);
  });
});
