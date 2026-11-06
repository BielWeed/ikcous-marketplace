// @vitest-environment jsdom
//
// Sobre a loja › Contato › Modelos prontos: com o formulário da tela alterado
// (a tela hospedeira marca dirty), fechar a folha pelo X, pelo véu ou
// escolhendo um modelo chama `history.back()` para devolver a entrada que a
// folha empurrou. O desvio do Voltar era zerado no mesmo commit; o popstate
// desse `back()` chegava DEPOIS, o App não via desvio nenhum e, com a tela
// ainda suja, abria "Alterações não salvas" sem a lojista ter saído de lugar.
//
// A correção copia o desvio de uso único do Financeiro: ao devolver a entrada,
// registra um engolidor que consome exatamente esse popstate.
//
// O histórico e o popstate são os do jsdom. O "App" é um dublê que copia a
// ordem do `handlePopState` real (src/App.tsx): desvio registrado é chamado
// ANTES do gate de dirty; sem desvio e com dirty, abre o diálogo.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ products: [], config: {} }),
}));

import { MensagemDeCompartilhar } from "@/components/admin/minha-loja/MensagemDeCompartilhar";

const ESTADO_BASE = { view: "admin-about-store" };

function botaoPorTexto(texto: string): HTMLButtonElement | undefined {
  return [...document.body.querySelectorAll("button")].find((b) =>
    b.textContent?.includes(texto),
  ) as HTMLButtonElement | undefined;
}

describe("MensagemDeCompartilhar — fechar a folha com a tela suja não abre 'Alterações não salvas'", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  // Dublê do painel: a tela hospedeira está SEMPRE suja neste arquivo.
  let desvioDoApp: (() => void) | null;
  let dialogosDeNaoSalvo: number;
  let popstatesVistos: number;
  const onSetBackOverride = vi.fn((fn: unknown) => {
    desvioDoApp =
      typeof fn === "function"
        ? (fn as () => (() => void) | null)()
        : (fn as (() => void) | null);
  });
  const aoPopstate = () => {
    popstatesVistos += 1;
    if (desvioDoApp) {
      desvioDoApp();
      return;
    }
    dialogosDeNaoSalvo += 1; // tela suja e nenhum desvio: o gate de dirty abre.
  };

  async function renderizar(
    comDesvio: boolean | "sem-prop" = true,
  ): Promise<void> {
    await act(async () => {
      raiz.render(
        <MensagemDeCompartilhar
          texto="Olha que achei!"
          carga={{ texto: "Olha que achei!", id: 1 }}
          onMudar={() => {}}
          onSetBackOverride={comDesvio === true ? onSetBackOverride : undefined}
        />,
      );
    });
  }

  async function abrirFolha(): Promise<void> {
    const abrir = botaoPorTexto("Modelos prontos (");
    expect(abrir).toBeDefined();
    await act(async () => {
      abrir?.click();
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    expect(document.body.textContent).toContain("Modelos prontos de mensagem");
    expect(window.history.state?.modal).toBe("presets");
  }

  /** Deixa o jsdom entregar o popstate (macrotarefa real) até o n-ésimo. */
  async function esperarPopstate(total: number): Promise<void> {
    for (let i = 0; i < 100 && popstatesVistos < total; i++) {
      await act(async () => {
        await new Promise((r) => setTimeout(r, 5));
      });
    }
    expect(popstatesVistos).toBe(total);
  }

  beforeEach(() => {
    desvioDoApp = null;
    dialogosDeNaoSalvo = 0;
    popstatesVistos = 0;
    onSetBackOverride.mockClear();
    window.history.replaceState(ESTADO_BASE, "", "/admin-about-store");
    window.addEventListener("popstate", aoPopstate);
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    window.removeEventListener("popstate", aoPopstate);
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("fechar pelo X: o popstate da devolução é engolido e nenhum aviso abre", async () => {
    await renderizar();
    await abrirFolha();

    const x = document.body.querySelector<HTMLButtonElement>(
      '[aria-label="Fechar"]',
    );
    expect(x).not.toBeNull();
    await act(async () => {
      x?.click();
    });
    await esperarPopstate(1);

    expect(dialogosDeNaoSalvo).toBe(0);
    // A entrada voltou ao que era antes da folha, e o desvio se soltou.
    expect(window.history.state).toEqual(ESTADO_BASE);
    expect(desvioDoApp).toBeNull();
    expect(document.body.textContent).not.toContain(
      "Modelos prontos de mensagem",
    );
  });

  it("escolher um modelo (a folha fecha sozinha): mesmo caminho, sem aviso", async () => {
    await renderizar();
    await abrirFolha();

    const aplicar = botaoPorTexto("Aplicar");
    expect(aplicar).toBeDefined();
    await act(async () => {
      aplicar?.click();
    });
    await esperarPopstate(1);

    expect(dialogosDeNaoSalvo).toBe(0);
    expect(window.history.state).toEqual(ESTADO_BASE);
    expect(desvioDoApp).toBeNull();
  });

  it("abrir e fechar três vezes seguidas não acumula entrada nem aviso", async () => {
    await renderizar();
    for (let volta = 1; volta <= 3; volta++) {
      await abrirFolha();
      const x = document.body.querySelector<HTMLButtonElement>(
        '[aria-label="Fechar"]',
      );
      await act(async () => {
        x?.click();
      });
      await esperarPopstate(volta);
      expect(window.history.state).toEqual(ESTADO_BASE);
    }
    expect(dialogosDeNaoSalvo).toBe(0);
    expect(desvioDoApp).toBeNull();
  });

  it("o Voltar do aparelho com a folha aberta continua fechando SÓ a folha, sem segundo back()", async () => {
    await renderizar();
    await abrirFolha();
    const backSpy = vi.spyOn(window.history, "back");

    await act(async () => {
      window.history.back();
    });
    await esperarPopstate(1);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });

    expect(document.body.textContent).not.toContain(
      "Modelos prontos de mensagem",
    );
    // Só o back() do próprio teste: a folha não devolve uma entrada que o
    // navegador já consumiu (nem arma engolidor).
    expect(backSpy).toHaveBeenCalledTimes(1);
    expect(window.history.state).toEqual(ESTADO_BASE);
    expect(dialogosDeNaoSalvo).toBe(0);
    expect(desvioDoApp).toBeNull();
  });

  it("se o popstate nunca chegar, o engolidor se solta pela rede de segurança (1500 ms)", async () => {
    await renderizar();
    await abrirFolha();
    // back() que não entrega popstate.
    vi.spyOn(window.history, "back").mockImplementation(() => {});
    vi.useFakeTimers();

    const x = document.body.querySelector<HTMLButtonElement>(
      '[aria-label="Fechar"]',
    );
    await act(async () => {
      x?.click();
    });
    // Engolidor armado, esperando um popstate que não vem…
    expect(desvioDoApp).toBeInstanceOf(Function);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1400);
    });
    expect(desvioDoApp).toBeInstanceOf(Function);
    // …e solto depois do prazo: o próximo Voltar de verdade volta a valer.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    expect(desvioDoApp).toBeNull();
  });

  it("a folha reaberta antes do popstate assume o desvio: o engolidor velho não derruba o novo", async () => {
    await renderizar();
    await abrirFolha();
    vi.spyOn(window.history, "back").mockImplementation(() => {});
    vi.useFakeTimers();

    const x = document.body.querySelector<HTMLButtonElement>(
      '[aria-label="Fechar"]',
    );
    await act(async () => {
      x?.click();
    });
    expect(desvioDoApp).toBeInstanceOf(Function);

    // Reabre antes de o popstate (que não vem) chegar.
    const abrir = botaoPorTexto("Modelos prontos (");
    await act(async () => {
      abrir?.click();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(50);
    });
    expect(document.body.textContent).toContain("Modelos prontos de mensagem");
    const desvioDaFolhaReaberta = desvioDoApp;
    expect(desvioDaFolhaReaberta).toBeInstanceOf(Function);

    // O relógio do engolidor antigo passa: não pode zerar o desvio da folha
    // que está aberta agora.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(desvioDoApp).toBe(desvioDaFolhaReaberta);
  });

  it("sem quem consuma o Voltar (sem onSetBackOverride) a folha fecha como sempre", async () => {
    await renderizar("sem-prop");
    await abrirFolha();
    const x = document.body.querySelector<HTMLButtonElement>(
      '[aria-label="Fechar"]',
    );
    await act(async () => {
      x?.click();
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 30));
    });
    expect(document.body.textContent).not.toContain(
      "Modelos prontos de mensagem",
    );
    expect(onSetBackOverride).not.toHaveBeenCalled();
  });
});
