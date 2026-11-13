// @vitest-environment jsdom
//
// Ficha do cliente, aba "Voz do Cliente": as datas da avaliação, da pergunta e
// da resposta saíam no fuso do aparelho, enquanto o resto da ficha usa o
// calendário de Brasília. 01h30 UTC do dia 12 ainda é 22h30 do dia 11 em
// Brasília: com o aparelho em UTC ou no Japão a aba mostrava 12.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import {
  type AvaliacaoDaFicha,
  type PerguntaDaFicha,
  VozClienteTab,
} from "@/components/admin/users/VozClienteTab";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const INSTANTE = "2026-11-12T01:30:00Z";

const avaliacao: AvaliacaoDaFicha = {
  id: "r1",
  productId: "p1",
  produtoNome: "Sabão Artesanal",
  rating: 4,
  comment: "Gostei",
  status: "publicada",
  helpful: 0,
  createdAt: INSTANTE,
};

const pergunta: PerguntaDaFicha = {
  id: "q1",
  productId: "p1",
  produtoNome: "Sabão Artesanal",
  question: "Tem refil?",
  createdAt: INSTANTE,
  respostas: [{ id: "a1", answer: "Tem sim", createdAt: INSTANTE }],
};

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
  vi.unstubAllEnvs();
});

it.each(["UTC", "Asia/Tokyo", "America/Sao_Paulo"])(
  "as três datas da aba são o dia 11 de Brasília com o aparelho em %s",
  async (fusoDoAparelho) => {
    vi.stubEnv("TZ", fusoDoAparelho);
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
    const texto = hospedeiro.textContent ?? "";
    // Avaliação, pergunta e resposta: três datas, todas no dia de Brasília.
    expect(texto.match(/11\/11\/2026/g)).toHaveLength(3);
    expect(texto).not.toMatch(/12\/11|12 nov/);
  },
);
