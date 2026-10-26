import { describe, expect, it } from "vitest";

import { lerEmPaginas } from "@/lib/ler-em-paginas";

// Duble do PostgREST: devolve no maximo 1.000 linhas por chamada.
const banco = (total: number) => async (de: number, ate: number) => ({
  data: Array.from(
    { length: Math.max(0, Math.min(ate + 1, total) - de) },
    (_, i) => de + i,
  ),
  error: null as unknown,
});

describe("lerEmPaginas", () => {
  it("junta 1.500 linhas lidas de 1.000 em 1.000", async () => {
    const { data, error } = await lerEmPaginas(banco(1500));
    expect(error).toBeNull();
    expect(data).toHaveLength(1500);
    expect(data?.[1499]).toBe(1499);
  });

  it("com exatamente 1.000 linhas pede a pagina seguinte para confirmar que acabou", async () => {
    const pedidos: number[] = [];
    const leitor = banco(1000);
    const { data } = await lerEmPaginas(async (de, ate) => {
      pedidos.push(de);
      return leitor(de, ate);
    });
    expect(data).toHaveLength(1000);
    expect(pedidos).toEqual([0, 1000]);
  });

  it("erro numa pagina devolve o erro e nenhum dado parcial", async () => {
    const falha = new Error("rede");
    const { data, error } = await lerEmPaginas(async (de) =>
      de === 0
        ? { data: new Array(1000).fill(1), error: null }
        : { data: null, error: falha },
    );
    expect(data).toBeNull();
    expect(error).toBe(falha);
  });
  it("se a ultima pagina permitida ainda vem cheia, devolve erro e nao um corte silencioso", async () => {
    const { data, error } = await lerEmPaginas(async () => ({
      data: new Array(1000).fill(1),
      error: null,
    }));
    expect(data).toBeNull();
    expect(error).toBeInstanceOf(Error);
  });
});
