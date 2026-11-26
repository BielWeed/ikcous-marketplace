// @vitest-environment jsdom
//
// Minha loja › Contato › Mensagem de compartilhamento — bordas que as provas
// vizinhas não pisam:
//  - os botões de marcador ("Nome do Produto", "Preço", "Link") inserem o chip
//    ONDE ESTÁ O CURSOR; sem cursor (ou com o cursor fora do editor) o chip vai
//    para o fim, e o resto do texto não se perde;
//  - colar é sempre texto puro, no cursor, e o cursor fica DEPOIS do colado
//    (duas colagens seguidas saem na ordem em que foram coladas);
//  - a prévia usa o PRIMEIRO produto do catálogo (mesmo havendo um só) e cai no
//    exemplo de fábrica sem catálogo, sem foto ou sem descrição;
//  - a pesquisa de modelos acha por nome, por descrição OU por texto (cada um
//    sozinho basta);
//  - a folha de modelos nasce FECHADA, não rouba o foco na montagem e devolve o
//    foco ao botão que a abriu quando fecha;
//  - o desvio do Voltar que engole o retorno da folha expira em 1,5 s.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const loja = vi.hoisted(() => ({ products: [] as Record<string, unknown>[] }));
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ products: loja.products, config: {} }),
}));

import { MensagemDeCompartilhar } from "@/components/admin/minha-loja/MensagemDeCompartilhar";

const esperar = (ms = 50) => new Promise<void>((r) => setTimeout(r, ms));

describe("MensagemDeCompartilhar — cursor, colar, exemplo, busca e folha", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  const onMudar = vi.fn();

  beforeEach(() => {
    loja.products = [];
    onMudar.mockClear();
    window.history.replaceState({ view: "admin-about-store" }, "", "/");
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });
  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
    window.getSelection()?.removeAllRanges();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  async function montar(
    texto = "Olá mundo",
    extra: Record<string, unknown> = {},
  ) {
    await act(async () => {
      raiz.render(
        <MensagemDeCompartilhar
          texto={texto}
          carga={{ texto, id: 1 }}
          onMudar={onMudar}
          {...extra}
        />,
      );
    });
  }

  const editor = () =>
    document.getElementById("settings-share-message-editor") as HTMLDivElement;
  const botao = (trecho: string) =>
    [...document.body.querySelectorAll("button")].find((b) =>
      b.textContent?.includes(trecho),
    ) as HTMLButtonElement;
  const ultimoTexto = () => onMudar.mock.calls.at(-1)?.[0];

  // O jsdom leva o cursor ao início quando `focus()` muda o foco; o navegador
  // mantém o cursor de quem já está dentro do editor. Por isso o editor é
  // focado ANTES de o cursor ser posto (o `focus()` do componente vira no-op).
  function cursorEm(no: Node, posicao: number) {
    editor().focus();
    const faixa = document.createRange();
    faixa.setStart(no, posicao);
    faixa.collapse(true);
    const selecao = window.getSelection() as Selection;
    selecao.removeAllRanges();
    selecao.addRange(faixa);
  }

  it("o editor entra na ordem natural do teclado (tabindex 0, nunca positivo) e é um campo de texto de várias linhas", async () => {
    await montar();
    expect(editor().tabIndex).toBe(0);
    expect(editor().getAttribute("role")).toBe("textbox");
    expect(editor().getAttribute("aria-multiline")).toBe("true");
  });

  describe("botões de marcador", () => {
    it("com o cursor no meio do texto, o chip entra ali e o resto do texto fica", async () => {
      await montar("Olá mundo");
      cursorEm(editor().firstChild as Node, 3);
      await act(async () => botao("Nome do Produto").click());
      expect(ultimoTexto()).toBe("Olá[nome] mundo");
      await act(async () => botao("Preço").click());
      // o cursor ficou DEPOIS do chip: o segundo marcador vem em seguida
      expect(ultimoTexto()).toBe("Olá[nome][preco] mundo");
    });

    it("sem nenhum cursor: o chip vai para o fim do texto", async () => {
      await montar("Olá mundo");
      editor().focus();
      window.getSelection()?.removeAllRanges();
      await act(async () => botao("Link").click());
      expect(ultimoTexto()).toBe("Olá mundo[link]");
    });

    it("com o cursor FORA do editor: o chip vai para o fim do editor e o texto de fora não é tocado", async () => {
      await montar("Olá mundo");
      const fora = document.createElement("p");
      fora.textContent = "texto de fora";
      document.body.appendChild(fora);
      cursorEm(fora.firstChild as Node, 5);
      await act(async () => botao("Link").click());
      expect(ultimoTexto()).toBe("Olá mundo[link]");
      expect(fora.textContent).toBe("texto de fora");
      fora.remove();
    });

    it("texto selecionado é substituído pelo chip", async () => {
      await montar("Olá mundo");
      const no = editor().firstChild as Node;
      editor().focus();
      const faixa = document.createRange();
      faixa.setStart(no, 3);
      faixa.setEnd(no, 9);
      const selecao = window.getSelection() as Selection;
      selecao.removeAllRanges();
      selecao.addRange(faixa);
      await act(async () => botao("Nome do Produto").click());
      expect(ultimoTexto()).toBe("Olá[nome]");
    });
  });

  describe("colar", () => {
    function colar(texto: string) {
      const evento = new Event("paste", { bubbles: true, cancelable: true });
      Object.defineProperty(evento, "clipboardData", {
        value: { getData: () => texto },
      });
      act(() => {
        editor().dispatchEvent(evento);
      });
      return evento;
    }

    it("cola texto puro no cursor, sem a colagem padrão do navegador", async () => {
      await montar("Olá mundo");
      cursorEm(editor().firstChild as Node, 3);
      const evento = colar("XYZ");
      expect(evento.defaultPrevented).toBe(true);
      expect(ultimoTexto()).toBe("OláXYZ mundo");
    });

    it("duas colagens seguidas saem na ordem em que foram coladas (o cursor fica depois do colado)", async () => {
      await montar("Olá mundo");
      cursorEm(editor().firstChild as Node, 3);
      colar("A");
      colar("B");
      expect(ultimoTexto()).toBe("OláAB mundo");
      expect(window.getSelection()?.getRangeAt(0).collapsed).toBe(true);
    });

    it("sem cursor: não cola nada, mas também não quebra nem perde o texto", async () => {
      await montar("Olá mundo");
      editor().focus();
      window.getSelection()?.removeAllRanges();
      const evento = colar("XYZ");
      expect(evento.defaultPrevented).toBe(true);
      expect(ultimoTexto()).toBe("Olá mundo");
    });
  });

  describe("produto de exemplo da prévia", () => {
    const imagem = () =>
      document.body.querySelector("img") as HTMLImageElement | null;
    const produto = (sobrescreve: Record<string, unknown>) => ({
      name: "Bolsa Teste",
      price: 50,
      description: "Bolsa de couro",
      images: ["https://exemplo.test/bolsa.jpg"],
      ...sobrescreve,
    });

    it("usa o PRIMEIRO produto do catálogo, com a foto e a descrição dele", async () => {
      loja.products = [
        produto({}),
        produto({
          name: "Outro Produto",
          description: "Outra descrição",
          images: ["https://exemplo.test/outro.jpg"],
        }),
      ];
      await montar();
      expect(imagem()?.alt).toBe("Bolsa Teste");
      expect(imagem()?.getAttribute("src")).toBe(
        "https://exemplo.test/bolsa.jpg",
      );
      expect(document.body.textContent).toContain("Bolsa de couro");
      expect(document.body.textContent).not.toContain("Outro Produto");
    });

    it("com UM produto só, é ele o exemplo (não o de fábrica)", async () => {
      loja.products = [produto({})];
      await montar();
      expect(imagem()?.alt).toBe("Bolsa Teste");
    });

    it("sem catálogo: o exemplo de fábrica", async () => {
      loja.products = [];
      await montar();
      expect(imagem()?.alt).toBe("Fone de Ouvido Bluetooth");
      expect(document.body.textContent).toContain(
        "Excelente qualidade de som estereofônico",
      );
    });

    it("produto sem foto usa a foto de fábrica; sem descrição usa a frase padrão", async () => {
      loja.products = [produto({ images: [], description: "" })];
      await montar();
      expect(imagem()?.alt).toBe("Bolsa Teste");
      expect(imagem()?.getAttribute("src")).toContain("images.unsplash.com");
      expect(document.body.textContent).toContain(
        "Excelente qualidade, preço justo e entrega rápida.",
      );
    });
  });

  describe("pesquisa de modelos", () => {
    async function abrirEPesquisar(termo: string) {
      await montar();
      await act(async () => {
        botao("Modelos prontos (").click();
        await esperar();
      });
      const campo = document.body.querySelector(
        "#preset-search-input",
      ) as HTMLInputElement;
      await act(async () => {
        Object.getOwnPropertyDescriptor(
          HTMLInputElement.prototype,
          "value",
        )?.set?.call(campo, termo);
        campo.dispatchEvent(new Event("input", { bubbles: true }));
      });
      return [...document.body.querySelectorAll("button span.uppercase")].map(
        (s) => s.textContent?.trim(),
      );
    }

    it("palavra que só existe no NOME do modelo", async () => {
      expect(await abrirEPesquisar("Mais Vendido")).toContain("Mais Vendido");
    });

    it("palavra que só existe na DESCRIÇÃO do modelo", async () => {
      expect(await abrirEPesquisar("refinado")).toContain("Elegante");
    });

    it("palavra que só existe no TEXTO do modelo", async () => {
      expect(await abrirEPesquisar("queridinho")).toContain("Mais Vendido");
    });

    it("palavra que não existe em lugar nenhum: avisa que nada foi encontrado", async () => {
      const nomes = await abrirEPesquisar("zzzxqj");
      expect(nomes).toEqual([]);
      expect(document.body.textContent).toContain("Nenhum modelo encontrado");
    });
  });

  describe("folha de modelos prontos", () => {
    it("nasce fechada, sem empurrar entrada no histórico e sem roubar o foco", async () => {
      const antes = window.history.length;
      await montar();
      expect(document.body.textContent).not.toContain(
        "Modelos prontos de mensagem",
      );
      expect(window.history.length).toBe(antes);
      expect(document.activeElement).not.toBe(botao("Modelos prontos ("));
    });

    it("ao escolher um modelo a folha fecha, o texto é trocado e o foco volta ao botão que a abriu", async () => {
      await montar();
      await act(async () => {
        botao("Modelos prontos (").click();
        await esperar();
      });
      expect(document.body.textContent).toContain(
        "Modelos prontos de mensagem",
      );
      const classico = [...document.body.querySelectorAll("button")].find((b) =>
        b.textContent?.includes("Clássico"),
      ) as HTMLButtonElement;
      await act(async () => {
        classico.click();
        await esperar();
      });
      expect(document.body.textContent).not.toContain(
        "Modelos prontos de mensagem",
      );
      expect(ultimoTexto()).toContain("Confira este produto incrível");
      expect(document.activeElement).toBe(botao("Modelos prontos ("));
    });

    it("o desvio do Voltar que engole o retorno expira em 1,5 s", async () => {
      let desvio: (() => void) | null = null;
      const aoMudarDesvio = vi.fn((fn: unknown) => {
        desvio =
          typeof fn === "function"
            ? (fn as () => (() => void) | null)()
            : (fn as (() => void) | null);
      });
      await montar("Olá mundo", { onSetBackOverride: aoMudarDesvio });
      await act(async () => {
        botao("Modelos prontos (").click();
        await esperar();
      });
      expect(desvio).not.toBeNull();
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      const classico = [...document.body.querySelectorAll("button")].find((b) =>
        b.textContent?.includes("Clássico"),
      ) as HTMLButtonElement;
      await act(async () => {
        classico.click();
      });
      // fechou: o desvio agora é o "engolidor" do retorno da entrada de histórico
      expect(desvio).not.toBeNull();
      await act(async () => {
        vi.advanceTimersByTime(1499);
      });
      expect(desvio).not.toBeNull();
      await act(async () => {
        vi.advanceTimersByTime(1);
      });
      expect(desvio).toBeNull();
    });
  });
});
