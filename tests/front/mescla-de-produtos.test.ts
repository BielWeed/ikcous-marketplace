// Laudo novos-ângulos 01/09, achado C4 (ponta 2): cada evento de realtime
// fazia o StoreContext reler TODO o cofre e trocar o array de produtos —
// identidade nova para todos os objetos, memo dos cards inútil, e a Home
// inteira re-renderizada porque a lojista mexeu num preço.
//
// O conserto é o merge fino: o evento chega com o id do registro afetado,
// o cofre já foi atualizado pelo motor, e a lista do estado recebe SÓ
// aquele slot trocado. Este teste prende a função pura que decide a
// próxima lista, com as garantias que o listener depende de verdade:
//   1. identidade preservada dos produtos não tocados (é isso que faz o
//      memo do card funcionar);
//   2. posição preservada (o card não pula de lugar na vitrine);
//   3. evento que não dá para resolver localmente (sem id/sem registro —
//      catchUp, bulk) devolve null = "releia o cofre inteiro".
import { describe, expect, it } from "vitest";

import { mesclarProdutoNaLista } from "@/lib/mescla-de-produtos";

const produto = (id: string, preco: number) =>
  ({
    id,
    name: `Produto ${id}`,
    price: preco,
  }) as any;

describe("mesclarProdutoNaLista — merge fino do evento de realtime", () => {
  const lista = [produto("p1", 10), produto("p2", 20), produto("p3", 30)];

  it("UPDATE substitui só o slot do produto, no mesmo lugar", () => {
    const atualizado = produto("p2", 25);
    const nova = mesclarProdutoNaLista(lista, {
      eventType: "UPDATE",
      id: "p2",
      registro: atualizado,
    });

    expect(nova).not.toBeNull();
    expect(nova!.length).toBe(3);
    expect(nova![1]).toBe(atualizado); // o slot trocou
    expect(nova![0]).toBe(lista[0]); // identidade dos outros preservada
    expect(nova![2]).toBe(lista[2]);
  });

  it("INSERT de produto novo appenda no fim", () => {
    const novo = produto("p4", 40);
    const nova = mesclarProdutoNaLista(lista, {
      eventType: "INSERT",
      id: "p4",
      registro: novo,
    });

    expect(nova).not.toBeNull();
    expect(nova!.length).toBe(4);
    expect(nova![3]).toBe(novo);
  });

  it("UPDATE de produto que não está na lista também appenda (a vitrine o ganha)", () => {
    const novo = produto("p9", 90);
    const nova = mesclarProdutoNaLista(lista, {
      eventType: "UPDATE",
      id: "p9",
      registro: novo,
    });

    expect(nova).not.toBeNull();
    expect(nova!.length).toBe(4);
    expect(nova![3]).toBe(novo);
  });

  it("DELETE remove só o alvo e preserva a identidade dos demais", () => {
    const nova = mesclarProdutoNaLista(lista, {
      eventType: "DELETE",
      id: "p2",
    });

    expect(nova).not.toBeNull();
    expect(nova!.map((p) => p.id)).toEqual(["p1", "p3"]);
    expect(nova![0]).toBe(lista[0]);
    expect(nova![1]).toBe(lista[2]);
  });

  it("DELETE de id que não está devolve a MESMA lista (nada a fazer, zero re-render)", () => {
    const nova = mesclarProdutoNaLista(lista, {
      eventType: "DELETE",
      id: "inexistente",
    });

    expect(nova).toBe(lista);
  });

  it("não muta a lista de entrada", () => {
    const copia = [...lista];
    mesclarProdutoNaLista(lista, {
      eventType: "UPDATE",
      id: "p1",
      registro: produto("p1", 99),
    });
    mesclarProdutoNaLista(lista, { eventType: "DELETE", id: "p3" });

    expect(lista).toEqual(copia);
    expect(lista.length).toBe(3);
  });

  it("evento sem registro nem id (catchUp, bulk) devolve null: releia o cofre", () => {
    expect(mesclarProdutoNaLista(lista, { eventType: "UPDATE" })).toBeNull();
    expect(mesclarProdutoNaLista(lista, { eventType: "DELETE" })).toBeNull();
    expect(
      mesclarProdutoNaLista(lista, {
        eventType: "INSERT",
        id: "p1",
      }),
    ).toBeNull();
  });
});
