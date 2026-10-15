// As regras PURAS da gestão de categorias (migration 20261237000000): ler a
// resposta do banco pela FORMA, contar o que está em uso em português e traduzir
// a recusa. Quem decide de verdade é o banco; aqui só se prova que o front não
// inventa, não engole e não traduz errado.
import {
  ErroDeCategoria,
  categoriaEmUso,
  chaveDaCategoria,
  descreverUso,
  fraseDoRenome,
  lerCategoriasComUso,
  lerResultadoDoApagar,
  lerResultadoDoRenome,
  mensagemDaFalhaDeCategoria,
  mesmaCategoria,
  trocarNomeNaLista,
} from "@/lib/gestao-de-categorias";
import { afterEach, describe, expect, it, vi } from "vitest";

const linha = (extra: Record<string, unknown> = {}) => ({
  id: "c1",
  nome: "Brinquedos",
  slug: "brinquedos",
  ativo: true,
  produtos: 3,
  banners: 1,
  regra_devolucao: 0,
  ...extra,
});

describe("lerCategoriasComUso", () => {
  it("lê a lista pela forma e devolve os nomes que a tela usa", () => {
    expect(
      lerCategoriasComUso([linha(), linha({ id: "c2", ativo: false })]),
    ).toEqual([
      {
        id: "c1",
        nome: "Brinquedos",
        slug: "brinquedos",
        ativa: true,
        produtos: 3,
        banners: 1,
        regraDeDevolucao: 0,
      },
      expect.objectContaining({ id: "c2", ativa: false }),
    ]);
  });

  it("lista vazia de verdade é lista vazia", () => {
    expect(lerCategoriasComUso([])).toEqual([]);
  });

  it.each([
    ["não é lista", { id: "c1" }],
    ["nulo", null],
    ["item que não é objeto", ["texto"]],
    ["ativo que não é verdadeiro/falso", [linha({ ativo: "sim" })]],
    ["contagem negativa", [linha({ produtos: -1 })]],
    ["contagem quebrada", [linha({ banners: 1.5 })]],
    ["contagem em texto", [linha({ regra_devolucao: "1" })]],
    ["sem id", [linha({ id: undefined })]],
  ])("resposta torta (%s) é erro, nunca lista vazia", (_nome, dados) => {
    expect(() => lerCategoriasComUso(dados)).toThrow(/Resposta inesperada/);
  });
});

describe("lerResultadoDoRenome e lerResultadoDoApagar", () => {
  const renomeou = {
    id: "c1",
    nome_antigo: "Brinquedo",
    nome: "Brinquedos",
    slug: "brinquedos",
    mudou: true,
    produtos: 3,
    banners: 1,
    regra_devolucao: 1,
  };

  it("lê o renome e expõe quantos produtos, banners e regras acompanharam", () => {
    expect(lerResultadoDoRenome(renomeou)).toEqual({
      id: "c1",
      nomeAntigo: "Brinquedo",
      nome: "Brinquedos",
      slug: "brinquedos",
      mudou: true,
      produtos: 3,
      banners: 1,
      regraDeDevolucao: 1,
    });
  });

  it("resposta torta do renome é erro (sem 'mudou', sem contagem)", () => {
    expect(() => lerResultadoDoRenome({ ...renomeou, mudou: "sim" })).toThrow();
    expect(() =>
      lerResultadoDoRenome({ ...renomeou, produtos: undefined }),
    ).toThrow();
    expect(() => lerResultadoDoRenome(null)).toThrow();
  });

  it("o apagar só vale com `apagada: true`", () => {
    expect(
      lerResultadoDoApagar({ id: "c1", nome: "Brinquedos", apagada: true }),
    ).toEqual({
      id: "c1",
      nome: "Brinquedos",
    });
    expect(() =>
      lerResultadoDoApagar({ id: "c1", nome: "x", apagada: false }),
    ).toThrow();
    expect(() => lerResultadoDoApagar({ id: "c1", nome: "x" })).toThrow();
  });
});

describe("o que está em uso", () => {
  it("em uso é produto, banner OU regra de devolução", () => {
    const zero = { produtos: 0, banners: 0, regraDeDevolucao: 0 };
    expect(categoriaEmUso(zero)).toBe(false);
    expect(categoriaEmUso({ ...zero, produtos: 1 })).toBe(true);
    expect(categoriaEmUso({ ...zero, banners: 1 })).toBe(true);
    expect(categoriaEmUso({ ...zero, regraDeDevolucao: 1 })).toBe(true);
  });

  it("descreve no singular e no plural, e junta com 'e'", () => {
    const zero = { produtos: 0, banners: 0, regraDeDevolucao: 0 };
    expect(descreverUso(zero)).toBeNull();
    expect(descreverUso({ ...zero, produtos: 1 })).toBe("1 produto");
    expect(descreverUso({ ...zero, produtos: 2, banners: 1 })).toBe(
      "2 produtos e 1 banner",
    );
    expect(descreverUso({ produtos: 3, banners: 2, regraDeDevolucao: 1 })).toBe(
      "3 produtos, 2 banners e a regra de devolução",
    );
    expect(descreverUso({ ...zero, regraDeDevolucao: 1 })).toBe(
      "a regra de devolução",
    );
  });

  it("a frase do renome diz o que acompanhou, e não promete nada quando o nome era o mesmo", () => {
    const base = {
      id: "c1",
      nomeAntigo: "Brinquedo",
      nome: "Brinquedos",
      slug: "brinquedos",
      mudou: true,
      produtos: 3,
      banners: 0,
      regraDeDevolucao: 0,
    };
    expect(fraseDoRenome(base)).toBe(
      "Categoria renomeada para “Brinquedos”. Acompanharam o nome novo: 3 produtos.",
    );
    expect(fraseDoRenome({ ...base, produtos: 0 })).toBe(
      "Categoria renomeada para “Brinquedos”.",
    );
    expect(fraseDoRenome({ ...base, mudou: false })).toBe(
      "O nome já era esse. Nada foi mudado.",
    );
  });
});

describe("a régua de 'é a mesma categoria' é a da vitrine", () => {
  it("ignora maiúscula e espaço nas pontas, e NÃO ignora acento", () => {
    expect(chaveDaCategoria("  Brinquedos ")).toBe("brinquedos");
    expect(mesmaCategoria("BRINQUEDOS", " brinquedos")).toBe(true);
    expect(mesmaCategoria("Íntimos", "Intimos")).toBe(false);
    expect(mesmaCategoria("", "Brinquedos")).toBe(false);
  });
});

describe("mensagemDaFalhaDeCategoria", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("as frases do banco (nome repetido, em uso, inválido, não achada) sobem como estão", () => {
    for (const code of ["22023", "23505", "55006", "P0002"]) {
      expect(
        mensagemDaFalhaDeCategoria({ code, message: "Frase do banco." }),
      ).toBe("Frase do banco.");
    }
  });

  it("acesso negado vira texto nosso, sem código do banco", () => {
    const m = mensagemDaFalhaDeCategoria({
      code: "42501",
      message: "Acesso negado.",
    });
    expect(m).toMatch(/administra a loja/);
    expect(m).not.toMatch(/42501/);
  });

  it("função que ainda não chegou à loja (front antes do banco) tem frase própria", () => {
    for (const code of ["PGRST202", "42883"]) {
      expect(mensagemDaFalhaDeCategoria({ code, message: "x" })).toMatch(
        /ainda não chegou à sua loja/,
      );
    }
  });

  it("erro desconhecido não vaza texto técnico e diz que nada foi mudado", () => {
    const m = mensagemDaFalhaDeCategoria({
      code: "XX000",
      message:
        'duplicate key value violates unique constraint "categorias_pkey"',
    });
    expect(m).toMatch(/Nada foi mudado/);
    expect(m).not.toMatch(/constraint|pkey/);
    expect(mensagemDaFalhaDeCategoria(undefined)).toMatch(/Nada foi mudado/);
  });

  it("sem internet, diz isso", () => {
    vi.stubGlobal("navigator", { onLine: false });
    expect(mensagemDaFalhaDeCategoria({ message: "Failed to fetch" })).toMatch(
      /Sem internet/,
    );
  });

  it("ErroDeCategoria guarda a mensagem e o código do banco", () => {
    const e = new ErroDeCategoria("Já existe.", "23505");
    expect(e.message).toBe("Já existe.");
    expect(e.code).toBe("23505");
    expect(e).toBeInstanceOf(Error);
  });
});

describe("trocarNomeNaLista (a copia da regra de devolucao acompanha a renomeacao)", () => {
  it("troca pela regua da vitrine, mantem a ordem e o resto", () => {
    expect(
      trocarNomeNaLista(
        ["Calçados", "  brinquedo ", "Moda"],
        "Brinquedo",
        "Brinquedos",
      ),
    ).toEqual(["Calçados", "Brinquedos", "Moda"]);
  });

  it("tira o que ficou repetido e devolve a MESMA lista quando nada muda", () => {
    expect(
      trocarNomeNaLista(["Brinquedo", "Brinquedos"], "Brinquedo", "Brinquedos"),
    ).toEqual(["Brinquedos"]);
    const lista = ["Calçados"];
    expect(trocarNomeNaLista(lista, "Brinquedo", "Brinquedos")).toBe(lista);
  });

  it("nao tira acento: 'Intimos' nao e 'Íntimos'", () => {
    const lista = ["Íntimos"];
    expect(trocarNomeNaLista(lista, "Intimos", "Lingerie")).toBe(lista);
  });
});
