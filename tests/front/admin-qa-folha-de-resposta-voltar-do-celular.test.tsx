// @vitest-environment jsdom
//
// Em Atendimento, "Responder" abre a folha "Responder pergunta". Ela não tinha
// entrada no histórico: o Voltar do celular saía da tela (ou, com texto
// digitado, disparava o aviso de "alterações não salvas" do roteador por cima
// da folha). Agora usa `useVoltarFechaAFolha`: o Voltar fecha SÓ a folha; com
// texto digitado ele faz o mesmo que o X/Esc (a pergunta "descartar?" DENTRO da
// folha, uma só) e a folha continua. Fechar por X/Descartar devolve a entrada.
// Histórico REAL do jsdom e um "App" simulado, registrado ANTES (no navegador de
// verdade o App acorda primeiro): com desvio do Voltar ele só o chama; sem
// desvio e com a tela suja ele abre o aviso dele. Molde:
// admin-order-card-voltar-do-celular.test.tsx.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  const perguntas = [
    {
      id: "q-1",
      userId: "cliente-1",
      productId: "prod-1",
      productName: "Produto de Teste",
      customerName: "Cliente Teste",
      question: "Tem em estoque?",
      createdAt: "2026-08-20T10:00:00Z",
      answers: [],
    },
  ];
  return {
    perguntas,
    getAllQuestions: async () => ({ questions: perguntas, total: 1 }),
    getQAStats: async () => ({
      status: "ok",
      total: 1,
      pending: 1,
      answered: 0,
      rate: 0,
    }),
  };
});

vi.mock("@/hooks/useQuestions", () => ({
  useQuestions: () => ({
    questions: h.perguntas,
    loading: false,
    getAllQuestions: h.getAllQuestions,
    getQAStats: h.getQAStats,
    subscribeToQuestions: () => () => {},
    addAnswer: vi.fn(),
    deleteQuestion: vi.fn(),
  }),
}));
vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), loading: vi.fn() },
}));

class ObservadorMudo {
  observe() {}
  unobserve() {}
  disconnect() {}
}
// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const esperar = (ms = 60) => new Promise<void>((r) => setTimeout(r, ms));

describe("Atendimento — a folha de resposta e o Voltar do celular", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let navegacoesDoApp: string[];
  let avisosDoApp: number;
  let sujo: boolean;
  let desvio: (() => void) | null;
  let ouvinteDoApp: (() => void) | null;

  const tela = () =>
    `${globalThis.history.state?.view}|${globalThis.location.pathname}`;

  // Igual ao `setBackOverride` do App (um useState): função vira "atualizador".
  const aoMudarDesvio = vi.fn((fn: unknown) => {
    desvio =
      typeof fn === "function" ? (fn as () => (() => void) | null)() : null;
  });
  const aoMudarSujo = vi.fn((valor: boolean) => {
    sujo = valor;
  });

  beforeEach(() => {
    vi.stubGlobal("IntersectionObserver", ObservadorMudo);
    vi.stubGlobal("ResizeObserver", ObservadorMudo);
    vi.stubGlobal("matchMedia", (media: string) => ({
      matches: false,
      media,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
    const armazem = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (chave: string) => armazem.get(chave) ?? null,
      setItem: (chave: string, valor: string) => armazem.set(chave, valor),
      removeItem: (chave: string) => armazem.delete(chave),
    });
    globalThis.history.replaceState({ view: "home" }, "", "/");
    globalThis.history.pushState({ view: "admin-qa" }, "", "/admin-qa");
    navegacoesDoApp = [];
    avisosDoApp = 0;
    sujo = false;
    desvio = null;
    vi.clearAllMocks();
    let mostrada = tela();
    ouvinteDoApp = () => {
      if (desvio) {
        desvio();
        return;
      }
      if (sujo) {
        avisosDoApp += 1;
        return;
      }
      const alvo = tela();
      if (alvo === mostrada) return;
      mostrada = alvo;
      navegacoesDoApp.push(alvo);
    };
    // Captura: no jsdom é o que faz o ouvinte do App rodar antes do da folha,
    // como no navegador de verdade.
    globalThis.addEventListener("popstate", ouvinteDoApp, true);
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
    document.body.innerHTML = "";
    if (ouvinteDoApp) {
      globalThis.removeEventListener("popstate", ouvinteDoApp, true);
    }
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const botao = (texto: string, dentro: ParentNode = document.body) =>
    [...dentro.querySelectorAll<HTMLButtonElement>("button")].find(
      (b) =>
        b.textContent?.trim() === texto ||
        b.getAttribute("aria-label") === texto,
    );
  const campo = () =>
    document.getElementById("merchant-answer") as HTMLTextAreaElement | null;
  const pergunta = () => document.body.querySelector('[role="alertdialog"]');

  async function clicar(alvo: HTMLElement | undefined) {
    await act(async () => {
      alvo?.click();
      await esperar(0);
    });
  }
  async function abrirFolha(texto = "") {
    const { AdminQAView } = await import("@/views/admin/AdminQAView");
    await act(async () => {
      raiz.render(
        <AdminQAView
          onNavigate={() => {}}
          active
          onSetDirty={aoMudarSujo}
          onSetBackOverride={aoMudarDesvio}
        />,
      );
      await esperar(0);
    });
    await clicar(botao("Responder"));
    if (texto) {
      await act(async () => {
        const area = campo() as HTMLTextAreaElement;
        area.focus();
        Object.getOwnPropertyDescriptor(
          HTMLTextAreaElement.prototype,
          "value",
        )?.set?.call(area, texto);
        area.dispatchEvent(new Event("input", { bubbles: true }));
        await esperar(0);
      });
    }
  }
  async function apertarVoltar() {
    await act(async () => {
      globalThis.history.back();
      await esperar();
    });
  }

  it("aberta, a folha ganha UMA entrada no histórico, na mesma tela", async () => {
    const antes = globalThis.history.length;
    await abrirFolha();

    expect(campo()).not.toBeNull();
    expect(globalThis.history.length).toBe(antes + 1);
    expect(globalThis.history.state?.folhaDePolitica).toBe(true);
    expect(globalThis.location.pathname).toBe("/admin-qa");
  });

  it("sem texto, o Voltar fecha SÓ a folha: a tela de Atendimento fica", async () => {
    await abrirFolha();
    await apertarVoltar();

    expect(campo()).toBeNull();
    expect(pergunta()).toBeNull();
    expect(navegacoesDoApp).toEqual([]);
    expect(avisosDoApp).toBe(0);
    expect(globalThis.location.pathname).toBe("/admin-qa");
    expect(globalThis.history.state?.view).toBe("admin-qa");
  });

  it("fechar pelo X devolve a entrada: o Voltar seguinte é do roteador", async () => {
    await abrirFolha();
    await act(async () => {
      botao("Fechar")?.click();
      await esperar(200);
    });

    expect(campo()).toBeNull();
    expect(globalThis.history.state?.folhaDePolitica).not.toBe(true);
    expect(navegacoesDoApp).toEqual([]);

    await apertarVoltar();
    expect(navegacoesDoApp).toEqual(["home|/"]);
  });

  it("com texto, o Voltar faz a pergunta 'descartar?' DENTRO da folha, uma só, e o texto fica", async () => {
    await abrirFolha("Resposta preservada");
    expect(sujo).toBe(true);
    await apertarVoltar();

    expect(campo()?.value).toBe("Resposta preservada");
    expect(document.body.querySelectorAll('[role="alertdialog"]')).toHaveLength(
      1,
    );
    expect(
      campo()
        ?.closest('[data-slot="sheet-content"]')
        ?.contains(pergunta() as Node),
    ).toBe(true);
    // O aviso do roteador não abre por cima, e a tela não troca.
    expect(avisosDoApp).toBe(0);
    expect(navegacoesDoApp).toEqual([]);
    // A entrada voltou: o próximo Voltar também encontra a folha.
    expect(globalThis.history.state?.folhaDePolitica).toBe(true);
  });

  it("com a pergunta na tela, o Voltar vale 'continuar editando'; Descartar fecha e devolve a entrada", async () => {
    await abrirFolha("Resposta preservada");
    await apertarVoltar();
    expect(pergunta()).not.toBeNull();

    await apertarVoltar();
    expect(pergunta()).toBeNull();
    expect(campo()?.value).toBe("Resposta preservada");
    expect(avisosDoApp).toBe(0);
    expect(navegacoesDoApp).toEqual([]);

    await apertarVoltar();
    expect(pergunta()).not.toBeNull();
    await act(async () => {
      botao("Descartar", pergunta() as HTMLElement)?.click();
      await esperar(200);
    });
    expect(campo()).toBeNull();
    expect(globalThis.history.state?.folhaDePolitica).not.toBe(true);
    expect(navegacoesDoApp).toEqual([]);
  });

  it("com texto digitado a folha liga o desvio do Voltar do roteador, e o solta ao fechar", async () => {
    await abrirFolha("Resposta preservada");
    expect(desvio).toBeTypeOf("function");

    await apertarVoltar();
    await act(async () => {
      botao("Descartar", pergunta() as HTMLElement)?.click();
      await esperar(200);
    });
    expect(desvio).toBeNull();
  });
});
