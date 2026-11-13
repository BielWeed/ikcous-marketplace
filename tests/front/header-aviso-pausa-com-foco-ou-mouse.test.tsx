// @vitest-environment jsdom
//
// Acessibilidade (13/11/2026): no celular a cápsula do topo é o único aviso, e
// o "Desfazer" de "Produto removido do carrinho" sumia em 6 s mesmo com o foco
// do teclado no botão (ou com o mouse em cima). Agora o relógio PARA enquanto o
// foco ou o mouse estão na cápsula e recomeça do zero quando saem.
import { StrictMode, act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sonner = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  warning: vi.fn(),
  info: vi.fn(),
  dismiss: vi.fn(),
}));
vi.mock("sonner", () => ({ toast: sonner }));

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: { storeName: "LOJA DA PROVA" } }),
}));
vi.mock("@/contexts/NotificationContextCore", () => ({
  useNotificationCenter: () => ({ unreadCount: 0 }),
}));
vi.mock("@/components/ui/custom/SearchBar", () => ({
  SearchBar: () => null,
}));

import { definirEstadoDaAtualizacao } from "@/lib/atualizacao/estado-da-atualizacao";
import {
  dispensarToastDoHeader,
  initHeaderToastInterceptor,
} from "@/utils/headerToast";

// @ts-expect-error flag interna do React, mesmo padrão de header-center-slot.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const PRAZO_DO_DESFAZER = 6_000;
// O relógio do aviso é falso nos testes; a espera pela animação da cápsula
// (framer, AnimatePresence "wait") usa o `setTimeout` de verdade, guardado aqui.
const setTimeoutReal = globalThis.setTimeout;

describe("Header — o aviso com Desfazer espera quem está nele", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(async () => {
    vi.stubGlobal("matchMedia", (consulta: string) => ({
      matches: consulta === "(max-width: 640px)",
      media: consulta,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
    }));
    initHeaderToastInterceptor();
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
    const { Header } = await import("@/components/ui/custom/Header");
    await act(async () => {
      raiz.render(
        <StrictMode>
          <Header onNavigate={() => {}} />
        </StrictMode>,
      );
    });
    // Só o relógio do aviso é falso: a animação do framer segue no real.
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  });

  afterEach(() => {
    act(() =>
      definirEstadoDaAtualizacao({ fase: "nenhuma", versaoNova: null }),
    );
    act(() => dispensarToastDoHeader());
    vi.useRealTimers();
    act(() => raiz.unmount());
    hospedeiro.remove();
    vi.unstubAllGlobals();
  });

  // A fala do leitor de tela espelha o aviso de pé e esvazia quando ele sai.
  const falado = () =>
    hospedeiro.querySelector('[role="status"].sr-only')?.textContent ?? "";
  const botaoCom = (texto: string) =>
    [...hospedeiro.querySelectorAll("button")].find((b) =>
      b.textContent?.includes(texto),
    ) as HTMLButtonElement;
  // A cápsula só entra depois da saída animada dos atalhos do topo.
  const esperarBotao = async (texto: string) => {
    for (let i = 0; i < 100 && !botaoCom(texto); i++) {
      await act(async () => {
        await new Promise((resolve) => setTimeoutReal(resolve, 20));
      });
    }
    expect(botaoCom(texto)).toBeDefined();
  };
  const passar = (ms: number) =>
    act(() => {
      vi.advanceTimersByTime(ms);
    });
  const avisarComDesfazer = async (
    mensagem = "Produto removido do carrinho",
  ) => {
    const { toast } = await import("sonner");
    act(() => {
      toast.info(mensagem, {
        duration: PRAZO_DO_DESFAZER,
        action: { label: "Desfazer", onClick: vi.fn() },
      });
    });
    expect(falado()).toContain(mensagem);
    await esperarBotao("Desfazer");
  };
  const mouse = (alvo: Element, tipo: "mouseover" | "mouseout") =>
    act(() => {
      alvo.dispatchEvent(
        new MouseEvent(tipo, { bubbles: true, relatedTarget: null }),
      );
    });

  it("controle: sem foco nem mouse o aviso some no prazo de sempre", async () => {
    await avisarComDesfazer();
    await passar(PRAZO_DO_DESFAZER - 100);
    expect(falado()).toContain("Produto removido");
    await passar(200);
    expect(falado()).toBe("");
  });

  it("foco no botão Desfazer: o aviso não some, e some depois de o foco sair", async () => {
    await avisarComDesfazer();
    await act(async () => {
      botaoCom("Desfazer").focus();
    });
    await passar(60_000);
    expect(falado()).toContain("Produto removido");
    await act(async () => {
      botaoCom("Desfazer").blur();
    });
    // Recomeça do zero: ainda dá tempo de ler logo depois de sair.
    await passar(PRAZO_DO_DESFAZER - 100);
    expect(falado()).toContain("Produto removido");
    await passar(200);
    expect(falado()).toBe("");
  });

  it("mouse em cima do aviso: não some; some depois de o mouse sair", async () => {
    await avisarComDesfazer();
    await mouse(botaoCom("Desfazer"), "mouseover");
    await passar(60_000);
    expect(falado()).toContain("Produto removido");
    await mouse(botaoCom("Desfazer"), "mouseout");
    await passar(PRAZO_DO_DESFAZER + 100);
    expect(falado()).toBe("");
  });

  it("mouse sai mas o foco continua no Desfazer: o relógio segue parado", async () => {
    await avisarComDesfazer();
    await mouse(botaoCom("Desfazer"), "mouseover");
    await act(async () => {
      botaoCom("Desfazer").focus();
    });
    await mouse(botaoCom("Desfazer"), "mouseout");
    await passar(60_000);
    expect(falado()).toContain("Produto removido");
  });

  it("foco que pulou do texto para o Desfazer (dentro da cápsula) segue sem relógio", async () => {
    await avisarComDesfazer();
    await act(async () => {
      botaoCom("Produto removido").focus();
    });
    await act(async () => {
      botaoCom("Desfazer").focus();
    });
    await passar(60_000);
    expect(falado()).toContain("Produto removido");
  });

  it("aviso novo depois de um pausado conta o prazo dele (o foco morreu junto com o antigo)", async () => {
    await avisarComDesfazer();
    await act(async () => {
      botaoCom("Desfazer").focus();
    });
    await passar(30_000);
    // O botão focado sai de cena sem `blur` do React: o aviso novo não pode
    // herdar a pausa.
    await avisarComDesfazer("Outro produto removido");
    await passar(PRAZO_DO_DESFAZER + 100);
    expect(falado()).toBe("");
  });

  it("a pausa velha não estende o aviso novo: o `blur` tardio da cápsula antiga não rearma o relógio", async () => {
    await avisarComDesfazer();
    await act(async () => {
      botaoCom("Desfazer").focus();
    });
    await avisarComDesfazer("Outro produto removido");
    await passar(PRAZO_DO_DESFAZER - 1_000);
    // A cápsula antiga ainda sai animada, com o foco nela; quando ele larga,
    // o `blur` chega e pede "retomar" -- o aviso novo já tem o relógio dele.
    await act(async () => {
      (document.activeElement as HTMLElement).blur();
    });
    await passar(1_100);
    expect(falado()).toBe("");
  });

  it("a ilha de atualização entra com o foco no aviso: o relógio volta a correr e o aviso expira", async () => {
    await avisarComDesfazer();
    await act(async () => {
      botaoCom("Desfazer").focus();
    });
    await passar(30_000);
    // A cápsula sai do DOM sem `blur` nem `mouseleave`: sem o efeito do Header
    // o aviso ficaria guardado no módulo, sem relógio, e voltaria depois.
    act(() => definirEstadoDaAtualizacao({ fase: "instalando" }));
    await passar(PRAZO_DO_DESFAZER + 100);
    act(() =>
      definirEstadoDaAtualizacao({ fase: "nenhuma", versaoNova: null }),
    );
    expect(falado()).toBe("");
  });

  it("o Header desmonta com o foco no aviso: o relógio volta a correr e o aviso expira", async () => {
    await avisarComDesfazer();
    await mouse(botaoCom("Desfazer"), "mouseover");
    await passar(30_000);
    // Ida ao painel admin: o Header sai sem `mouseleave`.
    act(() => raiz.render(null));
    await passar(PRAZO_DO_DESFAZER + 100);
    const { Header } = await import("@/components/ui/custom/Header");
    await act(async () => {
      raiz.render(<Header onNavigate={() => {}} />);
    });
    expect(falado()).toBe("");
  });

  it("controle: a ilha entra e sai SEM pausa anterior: o aviso segue o prazo normal", async () => {
    await avisarComDesfazer();
    await passar(1_000);
    act(() => definirEstadoDaAtualizacao({ fase: "instalando" }));
    act(() =>
      definirEstadoDaAtualizacao({ fase: "nenhuma", versaoNova: null }),
    );
    expect(falado()).toContain("Produto removido");
    await passar(PRAZO_DO_DESFAZER);
    expect(falado()).toBe("");
  });

  it("Esc no botão Desfazer dispensa o aviso, como no botão de texto", async () => {
    await avisarComDesfazer();
    await act(async () => {
      botaoCom("Desfazer").focus();
    });
    await act(async () => {
      botaoCom("Desfazer").dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });
    expect(falado()).toBe("");
  });

  it("aviso sem ação também espera o foco no texto", async () => {
    const { toast } = await import("sonner");
    act(() => {
      toast.info("Salvo", { duration: PRAZO_DO_DESFAZER });
    });
    await esperarBotao("Salvo");
    await act(async () => {
      botaoCom("Salvo").focus();
    });
    await passar(60_000);
    expect(falado()).toContain("Salvo");
    await act(async () => {
      botaoCom("Salvo").blur();
    });
    await passar(PRAZO_DO_DESFAZER + 100);
    expect(falado()).toBe("");
  });
});
