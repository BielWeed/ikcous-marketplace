// Fronteiras da gestão de categorias que a tela "Gerenciar categorias" sente:
//  - a lista que o banco devolve (slug ausente, ordem entre nomes que só
//    diferem em acento ou caixa);
//  - a resposta do "apagar", que só vale com `apagada` exatamente `true`;
//  - a frase que recusa o nome "Todas"/"all", que mostra o nome SEM os espaços
//    das pontas;
//  - o nome novo da categoria (vazio, espaço repetido, emoji) e a recusa do
//    banco que chega sem mensagem.
import {
  categoriaParecida,
  erroDoNomeDaCategoria,
  erroDoNomeReservado,
  lerCategoriasComUso,
  lerResultadoDoApagar,
  lerResultadoDoRenome,
  mensagemDaFalhaDeCategoria,
} from "@/lib/gestao-de-categorias";
import { describe, expect, it } from "vitest";

const linha = (extra: Record<string, unknown> = {}) => ({
  id: "c1",
  nome: "Brinquedos",
  slug: "brinquedos",
  ativo: true,
  produtos: 0,
  produtos_excluidos: 0,
  banners: 0,
  regra_devolucao: 0,
  ...extra,
});

describe("lerCategoriasComUso: slug que o banco não mandou", () => {
  it.each([
    ["ausente", undefined],
    ["nulo", null],
    ["número", 7],
  ])("slug %s vira texto vazio, sem inventar endereço", (_nome, slug) => {
    const [categoria] = lerCategoriasComUso([linha({ slug })]);
    expect(categoria.slug).toBe("");
  });
});

describe("lerCategoriasComUso: nomes que só diferem em acento ou caixa", () => {
  // O Collator da vitrine trata "Ação" e "Acao" como iguais (sensibilidade
  // base); o que decide a ordem entre eles é o idioma (pt-BR), e SÓ DEPOIS o
  // id. Com os ids na ordem contrária, a ordem certa não pode vir do id.
  it("sem acento vem antes do acentuado, mesmo com o id maior", () => {
    const ordem = lerCategoriasComUso([
      linha({ id: "a1", nome: "Ação" }),
      linha({ id: "a2", nome: "Acao" }),
    ]).map((c) => c.nome);
    expect(ordem).toEqual(["Acao", "Ação"]);
  });

  it("minúscula vem antes da maiúscula, mesmo com o id maior", () => {
    const ordem = lerCategoriasComUso([
      linha({ id: "b1", nome: "Joias" }),
      linha({ id: "b2", nome: "joias" }),
    ]).map((c) => c.nome);
    expect(ordem).toEqual(["joias", "Joias"]);
  });

  it("só o nome IGUAL (mesma grafia) é desempatado pelo id", () => {
    const ordem = lerCategoriasComUso([
      linha({ id: "z9", nome: "Joias" }),
      linha({ id: "a1", nome: "Joias" }),
    ]).map((c) => c.id);
    expect(ordem).toEqual(["a1", "z9"]);
  });
});

describe("lerResultadoDoRenome: slug que o banco não mandou", () => {
  it("slug ausente vira texto vazio", () => {
    const lido = lerResultadoDoRenome({
      id: "c1",
      nome_antigo: "Brinquedo",
      nome: "Brinquedos",
      mudou: true,
      produtos: 0,
      banners: 0,
      regra_devolucao: 0,
    });
    expect(lido.slug).toBe("");
  });
});

describe("lerResultadoDoApagar: só `apagada: true` de verdade vale", () => {
  it.each([
    ["texto 'true'", "true"],
    ["número 1", 1],
    ["texto 'sim'", "sim"],
    ["objeto", {}],
    ["nulo", null],
  ])("%s NÃO é confirmação de que apagou", (_nome, apagada) => {
    expect(() =>
      lerResultadoDoApagar({ id: "c1", nome: "Brinquedos", apagada }),
    ).toThrow(/Resposta inesperada do servidor ao apagar a categoria/);
  });
});

describe("erroDoNomeReservado: a frase mostra o nome sem os espaços das pontas", () => {
  it("'  Todas  ' aparece como “Todas”, sem espaço dentro das aspas", () => {
    expect(erroDoNomeReservado("  Todas  ")).toBe(
      "O nome “Todas” já é do filtro que mostra todos os produtos da loja. Escolha outro nome.",
    );
  });

  it("mantém a grafia que a lojista digitou (caixa)", () => {
    expect(erroDoNomeReservado(" ALL ")).toBe(
      "O nome “ALL” já é do filtro que mostra todos os produtos da loja. Escolha outro nome.",
    );
  });
});

describe("erroDoNomeDaCategoria: a régua do banco para o nome novo", () => {
  it.each([
    ["vazio", ""],
    ["só espaços", "     "],
    ["só tabulação e quebra de linha", "\t\n "],
  ])("nome %s pede para escrever o nome", (_nome, nome) => {
    expect(erroDoNomeDaCategoria(nome)).toBe("Escreva o nome da categoria.");
  });

  it("sem letra nem número (só símbolo) tem frase própria", () => {
    expect(erroDoNomeDaCategoria("🎉🎉")).toBe(
      "O nome da categoria precisa ter pelo menos uma letra ou um número.",
    );
  });

  it("o espaço repetido conta como UM só, como no banco", () => {
    expect(erroDoNomeDaCategoria(`a${" ".repeat(100)}b`)).toBeNull();
  });

  it("os espaços das pontas não contam para o limite de 80 letras", () => {
    expect(erroDoNomeDaCategoria(` ${"a".repeat(80)} `)).toBeNull();
    expect(erroDoNomeDaCategoria(`   ${"a".repeat(81)}   `)).toMatch(
      /no máximo 80 letras/,
    );
  });

  it("emoji conta como UMA letra, não como duas unidades de texto", () => {
    // 1 letra + 40 emojis = 41 letras; em unidades UTF-16 seriam 81.
    expect(erroDoNomeDaCategoria(`a${"😀".repeat(40)}`)).toBeNull();
    // 1 letra + 80 emojis = 81 letras: passou do limite.
    expect(erroDoNomeDaCategoria(`a${"😀".repeat(80)}`)).toMatch(
      /no máximo 80 letras/,
    );
  });
});

describe("categoriaParecida: nome só de símbolo não acusa categoria só de símbolo", () => {
  it("endereço vazio dos dois lados NÃO é colisão", () => {
    expect(categoriaParecida("😀", [{ name: "🎉", slug: "" }])).toBeNull();
    expect(categoriaParecida("😀", [{ name: "🎉" }])).toBeNull();
    expect(categoriaParecida("😀", [{ name: "🎉", slug: null }])).toBeNull();
  });
});

describe("mensagemDaFalhaDeCategoria: recusa do banco que chega sem mensagem", () => {
  it.each(["22023", "23505", "55006", "P0002"])(
    "código %s sem texto vira a frase nossa, nunca uma mensagem vazia",
    (code) => {
      const nossa =
        "Não foi possível concluir agora. Nada foi mudado; tente de novo.";
      expect(mensagemDaFalhaDeCategoria({ code })).toBe(nossa);
      expect(mensagemDaFalhaDeCategoria({ code, message: "" })).toBe(nossa);
    },
  );
});
