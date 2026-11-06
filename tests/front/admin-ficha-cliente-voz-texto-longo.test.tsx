// @vitest-environment jsdom
//
// Ficha do cliente, aba "Voz do Cliente": a avaliação e a pergunta que o
// cliente escreveu perdiam as quebras de linha dele e, com um link longo sem
// espaços, o texto era cortado pelo cartão (que tem `overflow-hidden`).
//
// jsdom não calcula layout, então o teste confere o que o CSS precisa em cada
// um dos quatro parágrafos de texto livre: `whitespace-pre-line` (mantém as
// quebras de linha) e `break-words` (quebra a palavra comprida). A pergunta
// mora numa linha flex ao lado do ícone: sem `min-w-0` o `break-words` não
// vale, porque item flex não encolhe abaixo da palavra mais larga.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  type AvaliacaoDaFicha,
  type PerguntaDaFicha,
  VozClienteTab,
} from "@/components/admin/users/VozClienteTab";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const LINK_LONGO = `https://exemplo.com.br/${"a".repeat(120)}`;

const avaliacao: AvaliacaoDaFicha = {
  id: "r1",
  productId: "p1",
  produtoNome: "Sabão Artesanal",
  rating: 4,
  comment: `Linha um\nLinha dois ${LINK_LONGO}`,
  status: "publicada",
  helpful: 0,
  merchantReply: `Resposta da loja ${LINK_LONGO}`,
  createdAt: "2026-08-30T10:00:00Z",
};

const pergunta: PerguntaDaFicha = {
  id: "q1",
  productId: "p1",
  produtoNome: "Sabão Artesanal",
  question: `Pergunta ${LINK_LONGO}`,
  createdAt: "2026-08-28T10:00:00Z",
  respostas: [
    {
      id: "a1",
      answer: `Resposta à pergunta ${LINK_LONGO}`,
      createdAt: "2026-08-29T10:00:00Z",
    },
  ],
};

describe("VozClienteTab — texto livre do cliente mantém as quebras e quebra palavra longa", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
  });

  async function montar() {
    await act(async () => {
      raiz.render(
        <VozClienteTab
          carregando={false}
          erro={null}
          avaliacoes={[avaliacao]}
          perguntas={[pergunta]}
          onTentarDeNovo={() => {}}
        />,
      );
    });
  }

  function paragrafo(trecho: string): HTMLElement {
    const achado = Array.from(
      hospedeiro.querySelectorAll<HTMLElement>("p"),
    ).find((p) => p.textContent?.includes(trecho));
    expect(achado, `parágrafo com "${trecho}"`).toBeTruthy();
    return achado as HTMLElement;
  }

  it.each([
    ["comentário da avaliação", "Linha um"],
    ["resposta da loja", "Resposta da loja https"],
    ["pergunta", "Pergunta https"],
    ["resposta à pergunta", "Resposta à pergunta"],
  ])("%s: whitespace-pre-line e break-words", async (_nome, trecho) => {
    await montar();
    const p = paragrafo(trecho);
    expect(p.classList.contains("whitespace-pre-line")).toBe(true);
    expect(p.classList.contains("break-words")).toBe(true);
  });

  it("a pergunta, item de linha flex, também pode encolher (min-w-0)", async () => {
    await montar();
    const p = paragrafo("Pergunta https");
    expect(p.classList.contains("min-w-0")).toBe(true);
    expect(p.classList.contains("flex-1")).toBe(true);
  });
});
