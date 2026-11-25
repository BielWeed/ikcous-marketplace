// A purga de versão obrigatória apaga service worker, caches e IndexedDB: só
// roda com rede PROVADA. O teste vizinho prova os casos de desenho; aqui ficam
// os números LITERAIS, para que mudar a janela sem querer (ou o sentido da
// borda) seja visto:
//  - a leitura de /version.json vale por 5 minutos (300 000 ms) — 299 999 e
//    300 000 ainda provam a rede, 300 001 não;
//  - leitura feita NO MESMO instante (idade 0) prova a rede;
//  - relógio que andou para trás (idade -1) não prova nada.
import { describe, expect, it } from "vitest";

import {
  VALIDADE_DA_LEITURA_DE_VERSAO_MS,
  redeVerificadaParaPurga,
} from "@/lib/atualizacao/rede-para-purga";

const AGORA = 1_000_000_000;

function comIdade(idade: number) {
  return redeVerificadaParaPurga({
    ultimaLeituraBemSucedidaEm: AGORA - idade,
    agora: AGORA,
    online: true,
  });
}

describe("redeVerificadaParaPurga — a janela de 5 minutos, em milissegundos literais", () => {
  it("a validade é de 5 minutos (300 000 ms)", () => {
    expect(VALIDADE_DA_LEITURA_DE_VERSAO_MS).toBe(300_000);
  });

  it.each([
    [0, true],
    [1, true],
    [299_999, true],
    [300_000, true],
    [300_001, false],
    [-1, false],
  ])("leitura com %i ms de idade: verificada = %s", (idade, esperado) => {
    expect(comIdade(idade)).toBe(esperado);
  });
});
