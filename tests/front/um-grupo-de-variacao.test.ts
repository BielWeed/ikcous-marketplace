// Um produto guarda variação como LISTA PLANA de pares {name, value}: existem
// "Cor: Rosa" e "Tamanho: P" separadas, cada uma com o próprio estoque. Não
// existe — e não há onde existir — a variante combinada "Rosa tamanho P".
//
// Medido em 24/08/2026, com DOIS grupos no mesmo produto quebram, ao mesmo
// tempo: o estoque do produto (que é a SOMA das variantes, contando Rosa 3 +
// Azul 2 + P 3 + M 2 = 10 quando existem 5 peças), o carrinho (o item leva UM
// `variantId` só, o da primeira variação clicada, e duas combinações diferentes
// fundem numa linha), o banco (`UNIQUE (user_id, product_id, variant_id)` em
// `cart_items` não deixa duas combinações do mesmo produto coexistirem) e o
// pedido (grava só `variant_id`; a combinação inteira vira texto solto na nota).
// Quem compra um P e um M recebe dois P.
//
// A trava aqui fecha a porta na origem: o painel passa a aceitar UM grupo por
// produto. Produto legado que já tenha dois não fica trancado — a regra é não
// PIORAR, e a tela avisa o que está errado.
import { describe, expect, it } from "vitest";

import {
  gruposDeVariacao,
  temGrupoDemais,
  travaDeUmGrupoSo,
} from "@/utils/um-grupo-de-variacao";

type V = { id: string; name: string; value: string };

const v = (id: string, name: string, value: string): V => ({ id, name, value });

describe("gruposDeVariacao", () => {
  it("conta grupos distintos, ignorando caixa e espaço em volta", () => {
    expect(gruposDeVariacao([])).toEqual([]);
    expect(
      gruposDeVariacao([v("1", "Cor", "Rosa"), v("2", " cor ", "Azul")]),
    ).toEqual(["Cor"]);
    expect(
      gruposDeVariacao([v("1", "Cor", "Rosa"), v("2", "Tamanho", "P")]),
    ).toEqual(["Cor", "Tamanho"]);
  });
});

describe("temGrupoDemais — o que a tela usa para avisar", () => {
  it("é falso com zero ou um grupo, verdadeiro com dois", () => {
    expect(temGrupoDemais([])).toBe(false);
    expect(temGrupoDemais([v("1", "Cor", "Rosa"), v("2", "Cor", "Azul")])).toBe(
      false,
    );
    expect(
      temGrupoDemais([v("1", "Cor", "Rosa"), v("2", "Tamanho", "P")]),
    ).toBe(true);
  });
});

describe("travaDeUmGrupoSo — ao adicionar variante", () => {
  it("deixa passar a primeira variante do produto", () => {
    expect(travaDeUmGrupoSo([], null, "Cor").bloqueia).toBe(false);
  });

  it("deixa passar outra opção do MESMO grupo", () => {
    const atuais = [v("1", "Cor", "Rosa")];
    expect(travaDeUmGrupoSo(atuais, null, "Cor").bloqueia).toBe(false);
  });

  it("deixa passar o mesmo grupo escrito com outra caixa ou com espaços", () => {
    const atuais = [v("1", "Cor", "Rosa")];
    expect(travaDeUmGrupoSo(atuais, null, "  cor ").bloqueia).toBe(false);
  });

  it("BLOQUEIA um segundo grupo, e diz qual grupo já está em uso", () => {
    const atuais = [v("1", "Cor", "Rosa")];
    const r = travaDeUmGrupoSo(atuais, null, "Tamanho");
    expect(r.bloqueia).toBe(true);
    expect(r.grupoEmUso).toBe("Cor");
  });
});

describe("travaDeUmGrupoSo — ao EDITAR variante existente", () => {
  it("deixa renomear o grupo quando a variante editada é a única", () => {
    const atuais = [v("1", "Cor", "Rosa")];
    expect(travaDeUmGrupoSo(atuais, "1", "Tamanho").bloqueia).toBe(false);
  });

  it("deixa salvar a edição que não mexe no grupo", () => {
    const atuais = [v("1", "Cor", "Rosa"), v("2", "Cor", "Azul")];
    expect(travaDeUmGrupoSo(atuais, "2", "Cor").bloqueia).toBe(false);
  });

  it("BLOQUEIA tirar uma variante do grupo único e criar um segundo grupo", () => {
    const atuais = [v("1", "Cor", "Rosa"), v("2", "Cor", "Azul")];
    expect(travaDeUmGrupoSo(atuais, "2", "Tamanho").bloqueia).toBe(true);
  });
});

describe("travaDeUmGrupoSo — produto LEGADO que já tem dois grupos", () => {
  const legado = [v("1", "Cor", "Rosa"), v("2", "Tamanho", "P")];

  it("NÃO tranca a edição do que já existe — a regra é não piorar", () => {
    expect(travaDeUmGrupoSo(legado, "1", "Cor").bloqueia).toBe(false);
    expect(travaDeUmGrupoSo(legado, "2", "Tamanho").bloqueia).toBe(false);
  });

  it("deixa CONSERTAR o legado, juntando tudo num grupo só", () => {
    expect(travaDeUmGrupoSo(legado, "2", "Cor").bloqueia).toBe(false);
  });

  it("BLOQUEIA um TERCEIRO grupo", () => {
    expect(travaDeUmGrupoSo(legado, null, "Voltagem").bloqueia).toBe(true);
  });

  it("BLOQUEIA acrescentar mais uma variante de um dos dois grupos existentes", () => {
    // Continuaria em dois grupos, mas com MAIS uma peça de estoque somada
    // errado. Empatar em dois não é "não piorar": é engordar o defeito.
    expect(travaDeUmGrupoSo(legado, null, "Cor").bloqueia).toBe(true);
  });
});
