// @vitest-environment jsdom
//
// Achado do Gabriel (23/09, captura de tela): em Admin > Atendimento, ao abrir
// "MODELOS PRONTOS DE MENSAGEM" a folha inferior (bottom sheet) ficava PRESA —
// não fechava tocando fora nem arrastando para baixo. O conserto de então foi
// uma folha própria (alça arrastável + guarda de clique sintético).
//
// ATUALIZAÇÃO do painel simples (D9/D11, 09/10/2026): a tela "Atendimento"
// virou o bloco Contato de Minha loja, e a folha de modelos passou a ser a
// FolhaDoPainel (diálogo acessível do painel, sobre o Radix Dialog). O que
// este arquivo prende é o COMPORTAMENTO que o lojista vê, e ele não mudou:
//
// 1. Tocar fora da folha (no véu) fecha.
// 2. Escape fecha.
// 3. O Voltar do aparelho/AdminLayout fecha SÓ a folha (a tela continua).
// 4. Clicar num modelo continua aplicando e fechando.
// 5. Depois de fechar por qualquer caminho, a classe que trava a rolagem do
//    fundo (admin-modal-open) sai do body.
// 6. Acessibilidade: role="dialog" nomeado pelo título; o foco entra na
//    folha ao abrir e volta para o botão que abriu ao fechar.
// 7. A montagem fria (folha nunca aberta) não puxa o foco para o botão.
//
// O que SAIU de propósito: a alça de arrastar e a guarda do clique sintético
// do mesmo toque. Eram remendos da folha própria; no Radix o toque fora é
// tratado no ponteiro (e, em toque, só depois do clique de quem fecha), então
// não há véu recém-montado para o "clique fantasma" cair em cima.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const updateConfig = vi.fn();
const onSetBackOverride = vi.fn();
const { mockConfig } = vi.hoisted(() => ({
  mockConfig: {
    whatsappNumber: "",
    businessHours: "",
    shareText: "Olha que achei na loja!",
  },
}));

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: mockConfig,
    isLoaded: true,
    updateConfig,
    refresh: vi.fn(),
    products: [],
  }),
}));
vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));
vi.mock("@/lib/supabase", () => ({ supabase: {} }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: "u1" } }) }));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function esperar(ms = 0): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function localizarBotaoPorTexto(
  raizDom: ParentNode,
  texto: string,
): HTMLButtonElement | undefined {
  return [...raizDom.querySelectorAll("button")].find((b) =>
    b.textContent?.includes(texto),
  ) as HTMLButtonElement | undefined;
}

function folhaEstaAberta(): boolean {
  return document.getElementById("preset-search-input") !== null;
}

describe("Minha loja › Contato — folha de modelos prontos fecha por todos os caminhos", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    document.body.classList.remove("admin-modal-open");
    vi.restoreAllMocks();
  });

  async function montar() {
    const { ContatoDaLoja } = await import(
      "@/components/admin/minha-loja/ContatoDaLoja"
    );
    await act(async () => {
      raiz.render(<ContatoDaLoja onSetBackOverride={onSetBackOverride} />);
    });
    await act(async () => {
      await esperar(50);
    });
  }

  async function montarEAbrir() {
    await montar();

    const botaoAbrir = localizarBotaoPorTexto(hospedeiro, "Modelos prontos")!;
    expect(botaoAbrir).toBeDefined();
    await act(async () => {
      botaoAbrir.focus();
      botaoAbrir.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await esperar(400);
    });
    expect(folhaEstaAberta()).toBe(true);
    return botaoAbrir;
  }

  function veuDoBackdrop(): HTMLElement {
    // O véu é o Overlay do Radix: a camada de tela cheia atrás da folha.
    const el = [...document.body.querySelectorAll<HTMLElement>("div")].find(
      (d) => d.className.includes("bg-black/80"),
    );
    expect(el, "véu do backdrop não encontrado").toBeDefined();
    return el!;
  }

  async function apertarEscape() {
    await act(async () => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
      await esperar(300);
    });
  }

  it("montagem fria (folha nunca aberta) NÃO puxa o foco para o botão — a tela não rola sozinha", async () => {
    await montar();
    const botaoAbrir = localizarBotaoPorTexto(hospedeiro, "Modelos prontos");
    expect(botaoAbrir).toBeDefined();
    expect(document.activeElement).not.toBe(botaoAbrir);
  });

  it("tocar no véu (fora da folha) fecha", async () => {
    await montarEAbrir();

    await act(async () => {
      veuDoBackdrop().dispatchEvent(
        new MouseEvent("pointerdown", { bubbles: true }),
      );
      await esperar(300);
    });

    expect(folhaEstaAberta()).toBe(false);
  });

  it("Escape fecha a folha", async () => {
    await montarEAbrir();
    await apertarEscape();
    expect(folhaEstaAberta()).toBe(false);
  });

  it("o botão Fechar da folha fecha", async () => {
    await montarEAbrir();

    const fechar = document.body.querySelector<HTMLButtonElement>(
      'button[aria-label="Fechar"]',
    );
    expect(fechar, "botão Fechar não encontrado").not.toBeNull();
    await act(async () => {
      fechar!.click();
      await esperar(300);
    });

    expect(folhaEstaAberta()).toBe(false);
  });

  it("o Voltar do aparelho fecha SÓ a folha: a tela continua montada com o texto", async () => {
    await montarEAbrir();

    // A tela entrega ao App um Voltar próprio enquanto a folha está aberta.
    const entregas = onSetBackOverride.mock.calls
      .map(([arg]) => arg)
      .filter((arg): arg is () => () => void => typeof arg === "function");
    expect(entregas.length).toBeGreaterThan(0);
    const voltar = entregas[entregas.length - 1]();

    await act(async () => {
      voltar();
      await esperar(300);
    });

    expect(folhaEstaAberta()).toBe(false);
    expect(
      hospedeiro.querySelector("#settings-share-message-editor"),
    ).not.toBeNull();
    // Fechada a folha, o Voltar próprio é devolvido (null) ao App.
    expect(onSetBackOverride).toHaveBeenLastCalledWith(null);
  });

  it("clicar num modelo continua aplicando e fechando (comportamento existente)", async () => {
    await montarEAbrir();

    const botaoAplicar = [
      ...document.body.querySelectorAll<HTMLButtonElement>("button"),
    ].find((b) => b.textContent?.includes("Clássico"));
    expect(botaoAplicar).toBeDefined();

    await act(async () => {
      botaoAplicar!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await esperar(300);
    });

    expect(folhaEstaAberta()).toBe(false);
    expect(
      (
        hospedeiro.querySelector(
          "#settings-share-message-editor",
        ) as HTMLElement
      ).innerHTML,
    ).toContain('data-tag="nome"');
  });

  it("depois de fechar, admin-modal-open sai do body (rolagem do fundo destravada)", async () => {
    await montarEAbrir();
    expect(document.body.classList.contains("admin-modal-open")).toBe(true);

    await apertarEscape();

    expect(document.body.classList.contains("admin-modal-open")).toBe(false);
  });

  it("a11y: role dialog nomeado pelo título, foco entra e volta ao botão ao fechar", async () => {
    const botaoAbrir = await montarEAbrir();

    const dialogo = document.body.querySelector('[role="dialog"]');
    expect(dialogo).not.toBeNull();
    const idRotulo = dialogo?.getAttribute("aria-labelledby");
    expect(idRotulo).toBeTruthy();
    const titulo = document.getElementById(idRotulo!);
    expect(titulo?.textContent).toContain("Modelos prontos de mensagem");

    // Foco entrou em algo dentro da folha (não ficou no <body>).
    expect(document.activeElement).not.toBe(document.body);
    expect(dialogo?.contains(document.activeElement)).toBe(true);

    await apertarEscape();

    expect(document.activeElement).toBe(botaoAbrir);
  });
});
