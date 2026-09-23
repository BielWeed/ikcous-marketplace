// @vitest-environment jsdom
//
// Achado do Gabriel (23/09, captura de tela): em Admin > Atendimento, ao abrir
// "MODELOS PRONTOS DE MENSAGEM" a folha inferior (bottom sheet) ficava PRESA —
// não fechava tocando fora nem arrastando para baixo. Causa raiz: o
// fechamento dependia inteiramente do gesto `drag`/`dragControls` do
// framer-motion (useDragControls + onDragEnd), mecanismo que nenhum outro
// lugar do repo usa para fechar folha (ProductCard.tsx ~196/765 resolve o
// mesmo problema com listeners de pointer NA JANELA, sem depender da API de
// gesto do framer-motion) — e o clique no véu (backdrop) não tinha nenhuma
// guarda contra o clique sintético atrasado que o toque em mobile dispara
// ~300ms depois do toque original, na MESMA coordenada de tela (que passa a
// cair sobre o véu recém-montado).
//
// A correção porta o padrão comprovado do ProductCard (alça arrastável com
// listeners de pointer na janela + guarda `movimentou` contra o clique
// sintético pós-arrasto) e acrescenta uma guarda de tempo no véu contra o
// clique sintético do MESMO toque que abriu a folha.
//
// Este arquivo prova, no nível do componente (React puro via createRoot +
// act, sem @testing-library, mesmo padrão de atendimento-presets-abre.test.tsx):
//
// 1. Tocar no véu (backdrop) fecha a folha.
// 2. Um clique sintético que chega logo (mesma janela de guarda) depois de a
//    folha abrir NÃO fecha — só um clique fora dessa janela fecha.
// 3. Arrastar a alça para baixo além do limiar fecha; abaixo do limiar não
//    fecha (a folha volta ao lugar).
// 4. Escape fecha a folha.
// 5. Clicar num modelo continua fechando a folha (comportamento existente,
//    preservado).
// 6. Depois de fechar por qualquer caminho, a classe que trava a rolagem do
//    fundo (admin-modal-open) sai do body.
// 7. Acessibilidade: role="dialog", aria-modal="true" e aria-labelledby
//    apontando para o título; o foco entra na folha ao abrir e volta para o
//    botão que abriu ao fechar.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const updateConfig = vi.fn();
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

describe("Atendimento — folha de modelos prontos fecha por todos os caminhos", () => {
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

  async function montarEAbrir() {
    const { AdminWhatsAppConfigView } = await import(
      "@/views/admin/AdminWhatsAppConfigView"
    );
    await act(async () => {
      raiz.render(<AdminWhatsAppConfigView active />);
    });
    await act(async () => {
      await esperar(50);
    });

    const botaoAbrir = localizarBotaoPorTexto(hospedeiro, "Modelos prontos")!;
    expect(botaoAbrir).toBeDefined();
    await act(async () => {
      botaoAbrir.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await esperar(400);
    });
    expect(folhaEstaAberta()).toBe(true);
    return botaoAbrir;
  }

  function veuDoBackdrop(): HTMLElement {
    // O véu é o primeiro motion.div com bg-black dentro do portal — mesma
    // técnica usada no teste irmão do ProductCard (sheet-clique-fora).
    const el = [...document.body.querySelectorAll<HTMLElement>("div")].find(
      (d) => d.className.includes("bg-black/70"),
    );
    expect(el, "véu do backdrop não encontrado").toBeDefined();
    return el!;
  }

  function alcaDaFolha(): HTMLButtonElement {
    const el = document.body.querySelector<HTMLButtonElement>(
      'button[aria-label*="Fechar"]',
    );
    expect(el, "alça/botão de fechar não encontrado").toBeDefined();
    return el!;
  }

  it("montagem fria (folha nunca aberta) NÃO puxa o foco para o botão — a tela não rola sozinha", async () => {
    const { AdminWhatsAppConfigView } = await import(
      "@/views/admin/AdminWhatsAppConfigView"
    );
    await act(async () => {
      raiz.render(<AdminWhatsAppConfigView active />);
    });
    await act(async () => {
      await esperar(50);
    });
    const botaoAbrir = localizarBotaoPorTexto(hospedeiro, "Modelos prontos");
    expect(botaoAbrir).toBeDefined();
    expect(document.activeElement).not.toBe(botaoAbrir);
  });

  it("tocar no véu (fora da folha) fecha", async () => {
    await montarEAbrir();
    // Fora da janela de guarda do clique sintético pós-abertura.
    await act(async () => {
      await esperar(500);
    });

    const veu = veuDoBackdrop();
    await act(async () => {
      veu.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await esperar(700);
    });

    expect(folhaEstaAberta()).toBe(false);
  });

  it("clique sintético que chega logo após abrir NÃO fecha (guarda do mesmo toque)", async () => {
    await montarEAbrir();

    const veu = veuDoBackdrop();
    // SEM esperar a janela de guarda — simula o clique fantasma do toque
    // que abriu a folha, chegando ~poucos ms depois no véu recém-montado.
    await act(async () => {
      veu.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await esperar(10);
    });

    expect(folhaEstaAberta()).toBe(true);
  });

  it("arrastar a alça para baixo além do limiar fecha", async () => {
    await montarEAbrir();
    const alca = alcaDaFolha();

    await act(async () => {
      alca.dispatchEvent(
        new MouseEvent("pointerdown", { bubbles: true, clientY: 100 }),
      );
      window.dispatchEvent(
        new MouseEvent("pointermove", { bubbles: true, clientY: 200 }),
      );
      window.dispatchEvent(
        new MouseEvent("pointerup", { bubbles: true, clientY: 190 }),
      );
      await esperar(700);
    });

    expect(folhaEstaAberta()).toBe(false);
  });

  it("arrastar a alça abaixo do limiar NÃO fecha", async () => {
    await montarEAbrir();
    const alca = alcaDaFolha();

    await act(async () => {
      alca.dispatchEvent(
        new MouseEvent("pointerdown", { bubbles: true, clientY: 100 }),
      );
      window.dispatchEvent(
        new MouseEvent("pointermove", { bubbles: true, clientY: 130 }),
      );
      window.dispatchEvent(
        new MouseEvent("pointerup", { bubbles: true, clientY: 128 }),
      );
      await esperar(50);
    });

    expect(folhaEstaAberta()).toBe(true);
  });

  it("Escape fecha a folha", async () => {
    await montarEAbrir();

    await act(async () => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
      await esperar(700);
    });

    expect(folhaEstaAberta()).toBe(false);
  });

  it("clicar num modelo continua aplicando e fechando (comportamento existente)", async () => {
    await montarEAbrir();

    const botaoAplicar = [
      ...document.body.querySelectorAll<HTMLButtonElement>("button"),
    ].find((b) => b.textContent?.includes("Clássico"));
    expect(botaoAplicar).toBeDefined();

    await act(async () => {
      botaoAplicar!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await esperar(700);
    });

    expect(folhaEstaAberta()).toBe(false);
  });

  it("depois de fechar, admin-modal-open sai do body (rolagem do fundo destravada)", async () => {
    await montarEAbrir();
    expect(document.body.classList.contains("admin-modal-open")).toBe(true);

    await act(async () => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
      await esperar(700);
    });

    expect(document.body.classList.contains("admin-modal-open")).toBe(false);
  });

  it("a11y: role dialog, aria-modal, aria-labelledby no título, foco entra e volta ao fechar", async () => {
    const botaoAbrir = await montarEAbrir();

    const dialogo = document.body.querySelector('[role="dialog"]');
    expect(dialogo).not.toBeNull();
    expect(dialogo?.getAttribute("aria-modal")).toBe("true");
    const idRotulo = dialogo?.getAttribute("aria-labelledby");
    expect(idRotulo).toBeTruthy();
    const titulo = document.getElementById(idRotulo!);
    expect(titulo?.textContent).toContain("Modelos prontos de mensagem");

    // Foco entrou em algo dentro da folha (não ficou no <body>).
    expect(document.activeElement).not.toBe(document.body);
    expect(dialogo?.contains(document.activeElement)).toBe(true);

    await act(async () => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
      await esperar(700);
    });

    expect(document.activeElement).toBe(botaoAbrir);
  });
});
