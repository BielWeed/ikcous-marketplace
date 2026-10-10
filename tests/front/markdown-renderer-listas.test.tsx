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
});
