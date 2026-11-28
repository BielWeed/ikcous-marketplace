// `src/utils/campos-mexidos-do-produto.ts`: o preço próprio de um tamanho que
// mudou nas DUAS abas ao mesmo tempo.
//
// Defeito (28/11/2026): a aba B pôs M a R$ 99,90 e salvou; a aba A tinha
// limpado o preço de M (ou digitado outro). O salvar da aba A foi recusado pela
// versão, e a junção (`variacoesAposConflito`) manteve o valor da aba A — de
// propósito: campo que ela editou fica. Só que a confirmação de preço não
// listava os tamanhos, e o segundo salvar gravava por cima dos R$ 99,90 sem
// ninguém ver. A junção continua igual; quem acusa o conflito é
// `precosDaGradeEmConflito`, e a tela o mostra antes de deixar salvar.
import {
  type VariacaoComparavel,
  precosDaGradeEmConflito,
  variacoesAposConflito,
} from "@/utils/campos-mexidos-do-produto";
import { describe, expect, it } from "vitest";

const tamanho = (extra: Partial<VariacaoComparavel> = {}) => ({
  id: "v-m",
  name: "Tamanho",
  value: "M",
  sku: null,
  codigoBarras: null,
  stockIncrement: 3,
  priceOverride: 89.9 as number | null,
  active: true,
  imageUrl: null,
  ...extra,
});

describe("precosDaGradeEmConflito", () => {
  it("o banco mudou para 99,90 (abertura 89,90) e ela limpou: conflito", () => {
    const abertura = tamanho();
    const banco = tamanho({ priceOverride: 99.9 });
    const tela = tamanho({ priceOverride: null });
    expect(precosDaGradeEmConflito([tela], [abertura], [banco])).toEqual([
      { id: "v-m", atual: 99.9 },
    ]);
    // A junção segue mantendo o que ela fez: só a confirmação muda.
    const [mesclada] = variacoesAposConflito([tela], [abertura], [banco]);
    expect(mesclada.priceOverride).toBeNull();
  });

  it("o banco não mexeu no preço do tamanho e ela limpou: sem conflito, vale o dela", () => {
    const abertura = tamanho();
    const banco = tamanho({ stockIncrement: 2 });
    const tela = tamanho({ priceOverride: null });
    expect(precosDaGradeEmConflito([tela], [abertura], [banco])).toEqual([]);
    const [mesclada] = variacoesAposConflito([tela], [abertura], [banco]);
    expect(mesclada.priceOverride).toBeNull();
  });

  it("ela não mexeu no preço do tamanho: sem conflito (acompanha o banco)", () => {
    expect(
      precosDaGradeEmConflito(
        [tamanho()],
        [tamanho()],
        [tamanho({ priceOverride: 99.9 })],
      ),
    ).toEqual([]);
  });

  it("os dois chegaram ao MESMO valor: sem conflito", () => {
    expect(
      precosDaGradeEmConflito(
        [tamanho({ priceOverride: 99.9 })],
        [tamanho()],
        [tamanho({ priceOverride: 99.9 })],
      ),
    ).toEqual([]);
  });

  it("R$ 0 e 'automático' são valores diferentes nos dois sentidos", () => {
    // Ela pôs R$ 0 (brinde); o outro aparelho voltou o tamanho para automático.
    expect(
      precosDaGradeEmConflito(
        [tamanho({ priceOverride: 0 })],
        [tamanho()],
        [tamanho({ priceOverride: null })],
      ),
    ).toEqual([{ id: "v-m", atual: null }]);
    // Ela deixou automático; o outro pôs R$ 0.
    expect(
      precosDaGradeEmConflito(
        [tamanho({ priceOverride: null })],
        [tamanho()],
        [tamanho({ priceOverride: 0 })],
      ),
    ).toEqual([{ id: "v-m", atual: 0 }]);
  });

  it("ausente e null são o mesmo 'automático' (não inventa conflito)", () => {
    const { priceOverride: _p, ...semPreco } = tamanho();
    expect(
      precosDaGradeEmConflito(
        [semPreco],
        [tamanho()],
        [tamanho({ priceOverride: null })],
      ),
    ).toEqual([]);
  });

  it("tamanho novo da tela, apagado no banco ou que ela não tinha lido: fora", () => {
    const nova = tamanho({ id: "temp-1", priceOverride: 10 });
    const apagada = tamanho({ id: "v-p", priceOverride: 10 });
    const naoLida = tamanho({ id: "v-g", priceOverride: 10 });
    expect(
      precosDaGradeEmConflito(
        [nova, apagada, naoLida],
        [tamanho({ id: "v-p" })],
        [tamanho({ id: "v-g", priceOverride: 20 })],
      ),
    ).toEqual([]);
  });

  it("troca de valor que o salvar anterior já gravou não é edição de preço (igual à junção)", () => {
    // Ela trocou M por GG e limpou o preço; o salvar anterior gravou a troca
    // (a antiga ficou desligada, com o valor de abertura) e a resposta se
    // perdeu. O que ela digitou foi para a opção nova, que vem do banco.
    const tela = [tamanho({ value: "GG", priceOverride: null })];
    const abertura = [tamanho()];
    const banco = [
      tamanho({ active: false, priceOverride: 99.9 }),
      tamanho({ id: "v-gg", value: "GG", priceOverride: null }),
    ];
    expect(precosDaGradeEmConflito(tela, abertura, banco)).toEqual([]);
  });

  it("vários tamanhos: só os que mudaram nos dois lados, na ordem da tela", () => {
    const tela = [
      tamanho({ id: "v-g", value: "G", priceOverride: 50 }),
      tamanho({ id: "v-p", value: "P", priceOverride: null }),
      tamanho({ id: "v-m", priceOverride: null }),
    ];
    const abertura = [
      tamanho({ id: "v-p", value: "P" }),
      tamanho({ id: "v-m" }),
      tamanho({ id: "v-g", value: "G" }),
    ];
    const banco = [
      tamanho({ id: "v-p", value: "P" }),
      tamanho({ id: "v-m", priceOverride: 99.9 }),
      tamanho({ id: "v-g", value: "G", priceOverride: 60 }),
    ];
    expect(precosDaGradeEmConflito(tela, abertura, banco)).toEqual([
      { id: "v-g", atual: 60 },
      { id: "v-m", atual: 99.9 },
    ]);
  });
});
