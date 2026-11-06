// @vitest-environment jsdom
// F3 (29/09): a prévia de desktop mostrava os asteriscos LITERAIS da
// descrição ("* 📖 50 Páginas…") e o separador "---" como texto cru. O
// MarkdownRenderer prometia listas no comentário e nunca as implementou.
// Este teste trava as três conquistas: lista de verdade, separador de
// verdade e o parágrafo comum intacto (literal é contrato do F3.6).
import { MarkdownRenderer } from "@/components/ui/custom/MarkdownRenderer";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// @ts-expect-error flag de teste do React
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("MarkdownRenderer — listas, separador e parágrafo", () => {
  let root: Root;
  let host: HTMLElement;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  async function renderizar(conteudo: string) {
    await act(async () => {
      root.render(<MarkdownRenderer content={conteudo} />);
    });
    return host;
  }

  it("bloco de linhas '* Item' vira <ul> com marcadores, sem asteriscos no texto", async () => {
    const alvo = await renderizar(
      "Título do produto\n\n* 📖 50 Páginas de pura criatividade\n* 📝 Encadernação em espiral\n- Presente perfeito",
    );
    const lista = alvo.querySelector("ul");
    expect(lista).not.toBeNull();
    expect(lista!.querySelectorAll("li").length).toBe(3);
    // O marcador do item não pode vazar asterisco/hífen no conteúdo.
    for (const li of lista!.querySelectorAll("li")) {
      expect(li.textContent).not.toMatch(/^[*-]\s/);
    }
    expect(lista!.textContent).toContain("50 Páginas de pura criatividade");
    expect(lista!.textContent).toContain("Presente perfeito");
    // O texto fora da lista continua sendo parágrafo.
    expect(alvo.querySelector("p")!.textContent).toBe("Título do produto");
  });

  it("linha só de traços vira <hr/>, não texto", async () => {
    const alvo = await renderizar("Antes\n\n---\n\nDepois");
    expect(alvo.querySelector("hr")).not.toBeNull();
    expect(alvo.textContent).not.toContain("---");
    expect(alvo.textContent).toContain("Antes");
    expect(alvo.textContent).toContain("Depois");
  });

  it("negrito continua funcionando dentro do item de lista", async () => {
    const alvo = await renderizar("* Item com **destaque** de verdade");
    const li = alvo.querySelector("li")!;
    expect(li.querySelector("strong")!.textContent).toBe("destaque");
  });

  it("parágrafo comum mantém o literal de classe do contrato F3.6", async () => {
    const alvo = await renderizar("Descrição da blusa");
    const p = alvo.querySelector("p")!;
    expect(p.className).toBe(
      "text-sm leading-relaxed text-gray-600 lg:text-base",
    );
  });

  it("linha de lista solta no meio de texto comum segue parágrafo", async () => {
    const alvo = await renderizar("Texto normal\n* começa no meio do bloco");
    expect(alvo.querySelector("ul")).toBeNull();
    expect(alvo.querySelector("p")!.textContent).toContain("* começa no meio");
  });

  it("lista logo depois de uma linha em negrito vira <ul>, sem asterisco literal", async () => {
    const alvo = await renderizar(
      "**Características do Produto**\n* Tema: Stitch\n* Quantidade: 50 páginas",
    );
    const itens = Array.from(alvo.querySelectorAll("ul li")).map(
      (li) => li.textContent,
    );
    expect(itens).toEqual(["Tema: Stitch", "Quantidade: 50 páginas"]);
    expect(alvo.querySelector("strong")!.textContent).toBe(
      "Características do Produto",
    );
    expect(alvo.textContent).not.toContain("*");
  });

  // Título colado nas linhas de baixo (sem linha em branco): só a PRIMEIRA
  // linha é título; antes o parágrafo inteiro virava um <h3> gigante de uma
  // linha só, com os \n colapsados.
  it("título colado em linhas de texto: <h3> só com o título, o resto segue parágrafo com <br/>", async () => {
    const alvo = await renderizar("### Medidas\nLargura: 10 cm\nAltura: 5 cm");
    const h3 = alvo.querySelectorAll("h3");
    expect(h3.length).toBe(1);
    expect(h3[0].textContent).toBe("Medidas");
    const p = alvo.querySelector("p")!;
    expect(p.textContent).toBe("Largura: 10 cmAltura: 5 cm");
    expect(p.querySelectorAll("br").length).toBe(1);
    expect(p.className).toBe(
      "text-sm leading-relaxed text-gray-600 lg:text-base",
    );
  });

  it("título colado numa lista: <h3> + <ul> de verdade", async () => {
    const alvo = await renderizar("### Detalhes\n* Algodão\n* Lavar à mão");
    expect(alvo.querySelector("h3")!.textContent).toBe("Detalhes");
    const itens = Array.from(alvo.querySelectorAll("ul li")).map(
      (li) => li.textContent,
    );
    expect(itens).toEqual(["Algodão", "Lavar à mão"]);
    expect(alvo.textContent).not.toContain("#");
  });

  it("'#### X' mostra só o texto, sem '#' sobrando", async () => {
    const alvo = await renderizar("#### Cuidados");
    expect(alvo.querySelector("h3")!.textContent).toBe("Cuidados");
    expect(alvo.textContent).not.toContain("#");
  });

  it("'## X' e '# X' viram título, sem os '#' literais", async () => {
    const alvo = await renderizar("## Sobre\n\n# Entrega");
    const titulos = Array.from(alvo.querySelectorAll("h3")).map(
      (h) => h.textContent,
    );
    expect(titulos).toEqual(["Sobre", "Entrega"]);
    expect(alvo.textContent).not.toContain("#");
  });

  it("'#hashtag' sem espaço continua texto comum, não título", async () => {
    const alvo = await renderizar("#promoção da semana");
    expect(alvo.querySelector("h3")).toBeNull();
    expect(alvo.querySelector("p")!.textContent).toBe("#promoção da semana");
  });
});
