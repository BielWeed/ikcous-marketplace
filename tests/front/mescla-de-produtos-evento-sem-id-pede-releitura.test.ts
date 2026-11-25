// O merge fino do realtime só troca UM slot da lista quando sabe QUAL produto
// mudou. Evento sem o id do registro (broadcast em massa, catch-up) não pode
// ser resolvido localmente: a função devolve `null` e quem chamou relê o cofre
// inteiro. O teste vizinho cobre o DELETE sem id e a falta do registro; aqui
// entra o caso do INSERT/UPDATE que TRAZ o registro mas não traz o id: sem a
// guarda, o registro seria anexado ao fim da lista como se fosse um produto
// novo, duplicando o que já existe. Dados fictícios.
import { mesclarProdutoNaLista } from "@/lib/mescla-de-produtos";
import { describe, expect, it } from "vitest";

const produto = (id: string, preco: number) =>
  ({ id, name: `Produto ${id}`, price: preco }) as never;

describe("mesclarProdutoNaLista: sem id não há como saber qual slot trocar", () => {
  const lista = [produto("p1", 10), produto("p2", 20)];

  it.each(["INSERT", "UPDATE"] as const)(
    "%s com registro mas SEM id: devolve null (relê o cofre), não anexa o registro",
    (eventType) => {
      expect(
        mesclarProdutoNaLista(lista, {
          eventType,
          registro: produto("p2", 99),
        }),
      ).toBeNull();
    },
  );

  it.each(["INSERT", "UPDATE"] as const)(
    "%s com id vazio e registro: também pede a releitura",
    (eventType) => {
      expect(
        mesclarProdutoNaLista(lista, {
          eventType,
          id: "",
          registro: produto("p2", 99),
        }),
      ).toBeNull();
    },
  );

  it.each(["INSERT", "UPDATE"] as const)(
    "%s com id mas SEM registro: pede a releitura",
    (eventType) => {
      expect(mesclarProdutoNaLista(lista, { eventType, id: "p2" })).toBeNull();
    },
  );

  it("a lista de entrada nunca é alterada por um evento que pede releitura", () => {
    const copia = [...lista];
    mesclarProdutoNaLista(lista, {
      eventType: "UPDATE",
      registro: produto("p9", 1),
    });
    expect(lista).toEqual(copia);
    expect(lista).toHaveLength(2);
  });

  it("controle: com id e registro o evento é resolvido localmente", () => {
    const novo = produto("p3", 30);
    expect(
      mesclarProdutoNaLista(lista, {
        eventType: "INSERT",
        id: "p3",
        registro: novo,
      }),
    ).toEqual([...lista, novo]);
  });
});
