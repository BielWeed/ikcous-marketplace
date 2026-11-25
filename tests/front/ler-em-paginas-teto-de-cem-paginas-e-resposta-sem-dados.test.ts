// Bordas da leitura em páginas de 1.000 linhas (`src/lib/ler-em-paginas.ts`)
// que o teste do módulo não pisava:
//   · o freio contra laço infinito é de EXATAMENTE 100 páginas: nem 99 (cortaria
//     uma lista legítima de 99.000 linhas e uma de 100.000 que acaba bem no
//     fim), nem 101 (mais uma ida ao banco por nada);
//   · resposta sem dados e sem erro (`data: null`) é "lista vazia", não queda;
//   · o erro de "lista grande demais" diz isso em português para quem lê o log.
import {
  MAXIMO_DE_PAGINAS,
  TAMANHO_DA_PAGINA,
  lerEmPaginas,
} from "@/lib/ler-em-paginas";
import { describe, expect, it } from "vitest";

describe("lerEmPaginas — teto de páginas e respostas vazias", () => {
  it("os números do contrato: páginas de 1.000 e no máximo 100 páginas", () => {
    expect(TAMANHO_DA_PAGINA).toBe(1000);
    expect(MAXIMO_DE_PAGINAS).toBe(100);
  });

  it("com todas as páginas cheias, pede exatamente 100 e então desiste com erro", async () => {
    const pedidos: Array<[number, number]> = [];
    const { data, error } = await lerEmPaginas(async (de, ate) => {
      pedidos.push([de, ate]);
      return { data: new Array(1000).fill(1), error: null };
    });

    expect(pedidos).toHaveLength(100);
    expect(pedidos[0]).toEqual([0, 999]);
    expect(pedidos[99]).toEqual([99_000, 99_999]);
    expect(data).toBeNull();
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe(
      "Lista grande demais para ler de uma vez",
    );
  });

  it("uma lista que acaba na centésima página (parcial) ainda é entregue inteira", async () => {
    const { data, error } = await lerEmPaginas(async (de) => ({
      data: new Array(de === 99_000 ? 250 : 1000).fill(1),
      error: null,
    }));

    expect(error).toBeNull();
    expect(data).toHaveLength(99_250);
  });

  it("uma lista que acaba na página 99 e vazia na 100ª também é entregue inteira", async () => {
    const { data, error } = await lerEmPaginas(async (de) => ({
      data: de < 99_000 ? new Array(1000).fill(1) : [],
      error: null,
    }));

    expect(error).toBeNull();
    expect(data).toHaveLength(99_000);
  });

  it("resposta com dados nulos e sem erro vale como lista vazia", async () => {
    const { data, error } = await lerEmPaginas(async () => ({
      data: null,
      error: null,
    }));

    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it("dados nulos numa página do meio terminam a leitura com o que já veio", async () => {
    const { data, error } = await lerEmPaginas(async (de) =>
      de === 0
        ? { data: new Array(1000).fill(7), error: null }
        : { data: null, error: null },
    );

    expect(error).toBeNull();
    expect(data).toHaveLength(1000);
  });
});
