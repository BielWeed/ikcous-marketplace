// @vitest-environment jsdom
//
// A recusa por estoque que traz um número de VÁRIOS DÍGITOS ("Disponível: 12")
// tem de chegar à tela com o número: "Ainda há 12 unidades de X disponíveis."
//
// Os testes vizinhos só usam estoque de um dígito (2 e 9). Com o padrão
// `(\d+)` trocado por `(\d)`, a frase do banco com 2+ dígitos deixa de casar
// com a regra "COM número" e cai na regra "sem número": o produto vira o texto
// inteiro ("Camiseta (Disponível: 12, Solicitado: 15)"), `disponivel` some e o
// painel PERDE a frase "Ainda há N unidades". Medido: todos os 86 testes
// de `recusa-do-pedido-classifica` e `recusa-e-toast-nao-divergem` continuavam
// verdes. Loja com 10 peças, 12, 100 é o caso comum, não a exceção.
//
// Aqui o caminho é o de verdade: a frase do banco passa pelo classificador e o
// resultado, exatamente como ele sai, é desenhado pelo painel.
import { SaidaDaRecusa } from "@/components/ui/custom/SaidaDaRecusa";
import { classificarRecusaDoPedido } from "@/lib/recusaDoPedido";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const fraseDoBanco = (disponivel: number, solicitado: number) => ({
  code: "P0001",
  message: `Estoque insuficiente para o produto Camiseta (Disponível: ${disponivel}, Solicitado: ${solicitado})`,
});

describe("recusa por estoque com número de vários dígitos", () => {
  it.each([
    [10, 11],
    [12, 15],
    [100, 150],
    [10000, 10001],
  ])(
    "Disponível: %s / Solicitado: %s -> o classificador guarda o número e o nome limpo",
    (disponivel, solicitado) => {
      const r = classificarRecusaDoPedido(fraseDoBanco(disponivel, solicitado));
      expect(r.acao).toBe("ajustar_estoque");
      expect(r.disponivel).toBe(disponivel);
      // O nome do produto NÃO pode levar o "(Disponível: ...)" junto.
      expect(r.produto).toBe("Camiseta");
    },
  );

  it("o painel escreve 'Ainda há 12 unidades' a partir da frase crua do banco", () => {
    const recusa = classificarRecusaDoPedido(fraseDoBanco(12, 15));
    act(() => {
      root.render(
        <SaidaDaRecusa recusa={recusa} onAgir={() => {}} onFechar={() => {}} />,
      );
    });
    expect(container.textContent).toContain(
      'Ainda há 12 unidades de "Camiseta" disponíveis.',
    );
  });

  it("estoque 0 (última unidade perdida na corrida) vira 'Acabou o estoque', não 'Ainda há 0'", () => {
    const recusa = classificarRecusaDoPedido(fraseDoBanco(0, 1));
    expect(recusa.disponivel).toBe(0);
    act(() => {
      root.render(
        <SaidaDaRecusa recusa={recusa} onAgir={() => {}} onFechar={() => {}} />,
      );
    });
    expect(container.textContent).toContain(
      'Acabou o estoque de "Camiseta" no que você escolheu.',
    );
    expect(container.textContent).not.toContain("Ainda há");
  });

  it("estoque 1 (quantidade pedida passou por uma) fala no singular", () => {
    const recusa = classificarRecusaDoPedido(fraseDoBanco(1, 2));
    act(() => {
      root.render(
        <SaidaDaRecusa recusa={recusa} onAgir={() => {}} onFechar={() => {}} />,
      );
    });
    expect(container.textContent).toContain(
      'Ainda há 1 unidade de "Camiseta" disponível.',
    );
  });
});
