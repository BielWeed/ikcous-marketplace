// @vitest-environment jsdom
import { type ReactNode, act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { BarraSuperiorCliente } from "@/components/ui/custom/BarraSuperiorCliente";
import { Header } from "@/components/ui/custom/Header";
import { definirEstadoDaAtualizacao } from "@/lib/atualizacao/estado-da-atualizacao";
import { dispensarToastDoHeader } from "@/utils/headerToast";

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: {} }),
}));
vi.mock("@/contexts/NotificationContextCore", () => ({
  useNotificationCenter: () => ({ unreadCount: 0 }),
}));
vi.mock("@/components/ui/custom/SearchBar", () => ({
  SearchBar: () => null,
}));
// O tempo de saída do Framer não faz parte da prioridade entre os avisos.
vi.mock("framer-motion", async (importOriginal) => ({
  ...(await importOriginal<typeof import("framer-motion")>()),
  AnimatePresence: ({ children }: { children?: ReactNode }) => <>{children}</>,
  useReducedMotion: () => true,
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("prioridade da ilha no Header do comprador", () => {
  let host: HTMLDivElement;
  let raiz: Root;

  beforeEach(() => {
    vi.useFakeTimers();
    definirEstadoDaAtualizacao({ fase: "nenhuma", versaoNova: null });
    dispensarToastDoHeader();
    vi.stubGlobal("matchMedia", (media: string) => ({
      matches: true,
      media,
      addEventListener() {},
      removeEventListener() {},
      addListener() {},
      removeListener() {},
    }));
    host = document.createElement("div");
    document.body.appendChild(host);
    raiz = createRoot(host);
    act(() => {
      raiz.render(
        <BarraSuperiorCliente>
          <Header onNavigate={() => {}} />
        </BarraSuperiorCliente>,
      );
    });
  });

  afterEach(() => {
    act(() => raiz.unmount());
    definirEstadoDaAtualizacao({ fase: "nenhuma", versaoNova: null });
    dispensarToastDoHeader();
    host.remove();
    vi.useRealTimers();
  });

  function avisar(message = "Pedido salvo") {
    act(() => {
      window.dispatchEvent(
        new CustomEvent("header-toast-event", {
          detail: { id: "aviso-comum", type: "success", message },
        }),
      );
    });
  }

  it("instalação substitui imediatamente um toast, sem cápsulas sobrepostas", () => {
    avisar();
    expect(host.textContent).toContain("Pedido salvo");
    act(() => definirEstadoDaAtualizacao({ fase: "instalando" }));
    expect(host.textContent).toContain("Atualizando o app…");
    expect(host.textContent).not.toContain("Pedido salvo");
    expect(host.querySelector('button[aria-label^="Notificações"]')).toBeNull();
    expect(host.firstElementChild?.className).toContain("z-[140]");

    avisar("Endereço salvo");
    expect(host.textContent).not.toContain("Endereço salvo");
    act(() => definirEstadoDaAtualizacao({ fase: "nenhuma" }));
    expect(host.textContent).toContain("Endereço salvo");
    expect(host.textContent).not.toContain("Atualizando o app…");
  });

  it("a espera fica invisível e deixa os toasts comuns funcionarem", () => {
    act(() => definirEstadoDaAtualizacao({ fase: "aguardando" }));
    expect(host.textContent).not.toContain("Atualização pronta");
    expect(host.firstElementChild?.className).toContain("z-[100]");
    avisar();
    expect(host.textContent).toContain("Pedido salvo");
    act(() => vi.advanceTimersByTime(2600));
    expect(host.firstElementChild?.className).toContain("z-[100]");
  });

  it("a atualização mantém o degrau de aviso mesmo sem toast comum", () => {
    act(() => definirEstadoDaAtualizacao({ fase: "concluida" }));
    expect(host.firstElementChild?.className).toContain("z-[140]");
    expect(host.textContent).toContain("Pronto! App atualizado");
    act(() => definirEstadoDaAtualizacao({ fase: "nenhuma" }));
    expect(host.firstElementChild?.className).toContain("z-[100]");
  });
});
