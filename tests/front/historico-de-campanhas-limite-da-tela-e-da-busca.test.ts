// O histórico de campanhas do painel de avisos mostra, por padrão, as 20
// campanhas mais novas DEPOIS de tirar as respostas da loja (que não são
// campanha), e a busca pede ao banco 100 linhas para sobrar campanha de verdade
// mesmo com muita resposta no meio.
import { describe, expect, it } from "vitest";

import {
  LIMITE_DA_BUSCA_DO_HISTORICO,
  LIMITE_DO_HISTORICO,
  TITULOS_DE_RESPOSTA_DA_LOJA,
  somenteCampanhasReais,
} from "@/lib/historico-de-campanhas";

interface Linha {
  readonly id: number;
  readonly title: string;
}

const campanhas = (quantidade: number, inicio = 1): Linha[] =>
  Array.from({ length: quantidade }, (_, i) => ({
    id: inicio + i,
    title: `Campanha ${inicio + i}`,
  }));

describe("somenteCampanhasReais: o teto padrão da tela", () => {
  it("o teto da tela é 20 e o da busca é 100", () => {
    expect(LIMITE_DO_HISTORICO).toBe(20);
    expect(LIMITE_DA_BUSCA_DO_HISTORICO).toBe(100);
  });

  it("com 25 campanhas a tela mostra exatamente as 20 primeiras, na ordem recebida", () => {
    const resultado = somenteCampanhasReais(campanhas(25));

    expect(resultado).toHaveLength(20);
    expect(resultado[0]?.id).toBe(1);
    expect(resultado[19]?.id).toBe(20);
  });

  it("com exatamente 20 campanhas, mostra as 20; com 19, mostra as 19", () => {
    expect(somenteCampanhasReais(campanhas(20))).toHaveLength(20);
    expect(somenteCampanhasReais(campanhas(19))).toHaveLength(19);
  });

  it("as respostas da loja não gastam o teto: 30 respostas na frente de 25 campanhas", () => {
    const resposta = (id: number): Linha => ({
      id,
      title:
        TITULOS_DE_RESPOSTA_DA_LOJA[id % TITULOS_DE_RESPOSTA_DA_LOJA.length],
    });
    const linhas = [
      ...Array.from({ length: 30 }, (_, i) => resposta(1000 + i)),
      ...campanhas(25),
    ];

    const resultado = somenteCampanhasReais(linhas);

    expect(resultado).toHaveLength(20);
    expect(resultado.every((l) => l.title.startsWith("Campanha"))).toBe(true);
    expect(resultado[0]?.id).toBe(1);
  });

  it("o teto explícito vale no lugar do padrão", () => {
    expect(somenteCampanhasReais(campanhas(25), 3).map((l) => l.id)).toEqual([
      1, 2, 3,
    ]);
    expect(somenteCampanhasReais(campanhas(25), 0)).toEqual([]);
  });
});
