// @vitest-environment jsdom
//
// Folha "Responder pergunta" (Atendimento) — bordas que as provas vizinhas não
// pisam:
//  - o campo de resposta é trazido à vista 150 ms DEPOIS de receber o foco, só
//    quando é um campo de texto DENTRO da folha (nem botão, nem campo de fora);
//  - com o teclado do celular aberto a folha sobe acima dele (bottom/maxHeight)
//    e o campo focado é trazido à vista na hora; sem teclado, nada disso;
//  - o campo trava com "sem conexão" OU com "enviando" (cada um sozinho), e o
//    aviso de falta de conexão só aparece sem conexão;
//  - a pergunta de descarte exige o pedido (`perguntandoDescarte`) E os dois
//    handlers; o padrão é NÃO perguntar;
//  - o Voltar do celular com a pergunta na tela só "continua editando": a folha
//    segue aberta e a entrada de histórico que o Voltar gastou é devolvida.
import { FolhaDeResposta } from "@/components/admin/atendimento/FolhaDeResposta";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const teclado = vi.hoisted(() => ({ altura: 0, alturaVisivel: 0 }));
vi.mock("@/hooks/useAlturaDoTeclado", () => ({
  useAlturaDoTeclado: () => ({
    altura: teclado.altura,
    alturaVisivel: teclado.alturaVisivel,
  }),
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

class ObservadorMudo {
  observe() {}
  unobserve() {}
  disconnect() {}
}

describe("FolhaDeResposta — teclado, foco, trava e pergunta de descarte", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  const rolagens: unknown[] = [];
  const aoFechar = vi.fn();

  beforeEach(() => {
    teclado.altura = 0;
    teclado.alturaVisivel = 0;
    rolagens.length = 0;
    aoFechar.mockClear();
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
    // O jsdom não tem `scrollIntoView`: o componente usa `?.`.
    (Element.prototype as unknown as Record<string, unknown>).scrollIntoView = (
      opcoes: unknown,
    ) => {
      rolagens.push(opcoes);
    };
    globalThis.history.replaceState({ view: "admin-qa" }, "", "/admin-qa");
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
    document.body.innerHTML = "";
    Reflect.deleteProperty(Element.prototype, "scrollIntoView");
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function renderizar(extra: Record<string, unknown> = {}) {
    act(() => {
      raiz.render(
        <FolhaDeResposta
          aberta
          aoFechar={aoFechar}
          cliente="Cliente Teste"
          produto="Produto de Teste"
          pergunta="Tem em estoque?"
          resposta="rascunho"
          aoMudarResposta={() => {}}
          aoPublicar={() => {}}
          enviando={false}
          semConexao={false}
          {...extra}
        />,
      );
    });
  }

  const campo = () =>
    document.getElementById("merchant-answer") as HTMLTextAreaElement;
  const folha = () =>
    document.querySelector<HTMLElement>("[data-folha-de-resposta]");
  const focar = (alvo: HTMLElement) =>
    act(() => {
      alvo.focus();
    });

  describe("foco traz o campo à vista", () => {
    it("150 ms depois do foco (não antes), uma vez, com block 'nearest'", () => {
      vi.useFakeTimers();
      renderizar();
      focar(campo());
      act(() => {
        vi.advanceTimersByTime(149);
      });
      expect(rolagens).toHaveLength(0);
      act(() => {
        vi.advanceTimersByTime(1);
      });
      expect(rolagens).toEqual([{ block: "nearest" }]);
    });

    it("foco em botão da própria folha não rola nada", () => {
      vi.useFakeTimers();
      renderizar();
      const descartar = [...document.querySelectorAll("button")].find(
        (b) => b.textContent === "Descartar",
      ) as HTMLElement;
      focar(descartar);
      act(() => {
        vi.advanceTimersByTime(1000);
      });
      expect(rolagens).toHaveLength(0);
    });

    it("campo de texto FORA da folha não rola nada", () => {
      vi.useFakeTimers();
      renderizar();
      const fora = document.createElement("textarea");
      document.body.appendChild(fora);
      focar(fora);
      act(() => {
        vi.advanceTimersByTime(1000);
      });
      expect(rolagens).toHaveLength(0);
    });

    it("foco que não é de elemento (o próprio documento) não rola nem quebra", () => {
      vi.useFakeTimers();
      renderizar();
      act(() => {
        document.dispatchEvent(new Event("focusin", { bubbles: true }));
        vi.advanceTimersByTime(1000);
      });
      expect(rolagens).toHaveLength(0);
    });
  });

  describe("teclado do celular", () => {
    it("sem teclado: a folha não ganha posição própria e nada é rolado na hora", () => {
      vi.useFakeTimers();
      renderizar();
      focar(campo());
      expect(folha()?.style.bottom).toBe("");
      expect(folha()?.style.maxHeight).toBe("");
      expect(rolagens).toHaveLength(0);
    });

    it("com teclado: a folha sobe acima dele, limita a altura à área visível e traz o campo focado à vista na hora", () => {
      vi.useFakeTimers();
      renderizar();
      focar(campo());
      expect(rolagens).toHaveLength(0);
      teclado.altura = 300;
      teclado.alturaVisivel = 500;
      renderizar();
      expect(folha()?.style.bottom).toBe("300px");
      expect(folha()?.style.maxHeight).toBe("calc(500px - 1rem)");
      // sem avançar o relógio: é o efeito do teclado, não o do foco
      expect(rolagens).toEqual([{ block: "nearest" }]);
    });

    it("teclado que fecha (de 300 para 0) com o campo focado: a folha desce e nada é rolado", () => {
      vi.useFakeTimers();
      teclado.altura = 300;
      teclado.alturaVisivel = 500;
      renderizar();
      focar(campo());
      const antes = rolagens.length;
      teclado.altura = 0;
      teclado.alturaVisivel = 0;
      renderizar();
      expect(folha()?.style.bottom).toBe("");
      expect(rolagens).toHaveLength(antes);
    });

    it("com teclado mas com o foco num botão: a folha sobe e nada é rolado", () => {
      vi.useFakeTimers();
      renderizar();
      const descartar = [...document.querySelectorAll("button")].find(
        (b) => b.textContent === "Descartar",
      ) as HTMLElement;
      focar(descartar);
      teclado.altura = 300;
      teclado.alturaVisivel = 500;
      renderizar();
      expect(folha()?.style.bottom).toBe("300px");
      expect(rolagens).toHaveLength(0);
    });

    it("com teclado mas com o foco num campo de fora da folha: nada é rolado", () => {
      vi.useFakeTimers();
      renderizar();
      const fora = document.createElement("textarea");
      document.body.appendChild(fora);
      focar(fora);
      teclado.altura = 300;
      teclado.alturaVisivel = 500;
      renderizar();
      expect(rolagens).toHaveLength(0);
    });
  });

  describe("trava e avisos", () => {
    it("normal: campo liberado, sem aviso de conexão, só os três botões da folha", () => {
      renderizar();
      expect(campo().disabled).toBe(false);
      expect(folha()?.textContent).not.toContain("Sem conexão");
      const nomes = [...(folha()?.querySelectorAll("button") ?? [])].map(
        (b) => b.getAttribute("aria-label") ?? b.textContent?.trim(),
      );
      expect(nomes).toEqual(["Fechar", "Descartar", "Publicar resposta"]);
    });

    it("só sem conexão: campo travado, aviso na tela e placeholder de offline", () => {
      renderizar({ semConexao: true });
      expect(campo().disabled).toBe(true);
      expect(folha()?.textContent).toContain("Sem conexão");
      expect(campo().placeholder).toContain("offline");
    });

    it("só enviando: campo travado e sem o aviso de conexão", () => {
      renderizar({ enviando: true });
      expect(campo().disabled).toBe(true);
      expect(folha()?.textContent).not.toContain("Sem conexão");
      expect(folha()?.textContent).toContain("Enviando...");
    });
  });

  describe("pergunta de descarte", () => {
    const pergunta = () => document.querySelector('[role="alertdialog"]');
    const handlers = () => ({
      aoContinuarEditando: vi.fn(),
      aoDescartar: vi.fn(),
    });

    it("com os dois handlers mas sem pedir: não pergunta (o padrão é não perguntar)", () => {
      renderizar(handlers());
      expect(pergunta()).toBeNull();
      expect(document.querySelector("[inert]")).toBeNull();
    });

    it("sem pedir e só com 'descartar': não pergunta", () => {
      renderizar({ aoDescartar: vi.fn() });
      expect(pergunta()).toBeNull();
      expect(document.querySelector("[inert]")).toBeNull();
    });

    it("pedindo e só com 'descartar' (falta 'continuar editando'): não pergunta", () => {
      renderizar({ perguntandoDescarte: true, aoDescartar: vi.fn() });
      expect(pergunta()).toBeNull();
      expect(document.querySelector("[inert]")).toBeNull();
    });

    it("pedindo e só com 'continuar editando' (falta 'descartar'): não pergunta", () => {
      renderizar({
        perguntandoDescarte: true,
        aoContinuarEditando: vi.fn(),
      });
      expect(pergunta()).toBeNull();
    });

    it("pedindo e com os dois: pergunta e deixa o fundo inerte", () => {
      renderizar({ perguntandoDescarte: true, ...handlers() });
      expect(pergunta()).not.toBeNull();
      expect(document.querySelector("[inert]")).not.toBeNull();
    });

    it("Voltar do celular com a pergunta na tela: só 'continua editando' e devolve a entrada do histórico", async () => {
      const { aoContinuarEditando, aoDescartar } = handlers();
      renderizar({
        perguntandoDescarte: true,
        aoContinuarEditando,
        aoDescartar,
      });
      expect(globalThis.history.state?.folhaDePolitica).toBe(true);
      await act(async () => {
        globalThis.history.back();
        await new Promise((resolve) => setTimeout(resolve, 60));
      });
      expect(aoContinuarEditando).toHaveBeenCalledTimes(1);
      expect(aoDescartar).not.toHaveBeenCalled();
      expect(aoFechar).not.toHaveBeenCalled();
      // a folha recusou fechar: a entrada que o Voltar gastou volta ao histórico
      expect(globalThis.history.state?.folhaDePolitica).toBe(true);
    });
  });
});
