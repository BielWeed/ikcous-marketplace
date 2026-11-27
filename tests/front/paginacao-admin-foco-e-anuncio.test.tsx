// @vitest-environment jsdom
//
// Paginação do painel usada só com teclado ou leitor de tela (lote 487):
//  - chegar na última página pelo "Próximo" o deixa `disabled` com o foco
//    dentro (o Chrome joga o foco no <body>): o foco passa ao botão do outro
//    lado, que continua valendo; o mesmo vale para "Anterior" na primeira;
//  - a troca de página não era anunciada: uma região de aviso diz a página e
//    o "Exibindo X - Y de Z" novos. Só a troca pelos botões fala — mudar a
//    lista por filtro ou busca não enche o leitor de tela de avisos.
// O `disabled` das bordas fica (outros testes o fixam): muda só o foco.
import { PaginacaoAdmin } from "@/components/admin/PaginacaoAdmin";
import { act, useState } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let hospedeiro: HTMLDivElement;
let raiz: Root;

beforeEach(() => {
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
});

afterEach(() => {
  act(() => raiz.unmount());
  hospedeiro.remove();
});

function Tela({ inicial, total }: { inicial: number; total: number }) {
  const [pagina, setPagina] = useState(inicial);
  return (
    <PaginacaoAdmin
      pagina={pagina}
      totalPaginas={Math.ceil(total / 12)}
      totalItens={total}
      itensPorPagina={12}
      aoMudar={setPagina}
    />
  );
}

function montar(inicial: number, total: number) {
  act(() => raiz.render(<Tela inicial={inicial} total={total} />));
}

const botao = (texto: string) =>
  [...hospedeiro.querySelectorAll("button")].find((b) =>
    b.textContent?.includes(texto),
  ) as HTMLButtonElement;
const aviso = () => hospedeiro.querySelector('[role="status"]');

function tocar(texto: string) {
  const alvo = botao(texto);
  alvo.focus();
  act(() => alvo.click());
}

it("Próximo até a última página: o foco passa para Anterior", () => {
  montar(0, 24);
  tocar("Próximo");
  expect(botao("Próximo").disabled).toBe(true);
  expect(document.activeElement).toBe(botao("Anterior"));
});

it("Anterior até a primeira página: o foco passa para Próximo", () => {
  montar(1, 24);
  tocar("Anterior");
  expect(botao("Anterior").disabled).toBe(true);
  expect(document.activeElement).toBe(botao("Próximo"));
});

it("no meio da lista o foco fica no botão tocado", () => {
  montar(0, 36);
  tocar("Próximo");
  expect(document.activeElement).toBe(botao("Próximo"));
});

it("a troca de página é anunciada com a página e o contador novos", () => {
  montar(0, 30);
  expect(aviso()?.textContent ?? "").toBe("");
  tocar("Próximo");
  expect(aviso()?.textContent).toBe("Página 2 de 3. Exibindo 13 - 24 de 30");
});
