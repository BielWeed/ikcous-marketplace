// `fraseEscritaPelaCasa` decide por LÍNGUA e por FORMA quando o texto de um erro
// do banco pode chegar ao lojista. O teste da falha do balcão cobre as frases
// reais e o texto técnico em INGLÊS puro, mas texto sem sinal de português cai
// fora de qualquer jeito, e por isso quase toda a regra de forma técnica ficava
// sem prova: ela só importa quando o texto técnico vem COM uma palavra
// portuguesa junto. Aqui cada pedaço da regra é preso sozinho.
import { fraseEscritaPelaCasa } from "@/lib/frase-escrita-pela-casa";
import { describe, expect, it } from "vitest";

const CODIGO = "22023";

describe("forma técnica rejeita mesmo com palavra portuguesa solta", () => {
  it.each([
    ["schema public", "falha ao ler public.orders"],
    ["permission denied", "falha: permission denied"],
    ["row-level", "falha: row-level security"],
    ["violates", "falha: violates check"],
    ["statement timeout", "falha: statement timeout"],
    ["permissão negada (com til)", "falha: permissão negada"],
    ["permissao negada (sem til)", "falha: permissao negada"],
    ["função (com cedilha e til)", "falha na função"],
    ["funcao (sem acento)", "falha na funcao"],
    ["código de erro ERROR:", "falha: ERROR: boom"],
    ["SQLSTATE", "falha SQLSTATE 42501"],
    ["PGRST + dígito", "falha PGRST301"],
    ["JWT", "falha: JWT vencido"],
    ["identificador snake_case", "falha em registrar_venda"],
    ["snake_case com dígito depois do sublinhado", "falha em tabela_2"],
    ["snake_case com sublinhado depois do primeiro", "falha em a_b_c"],
  ])("%s não passa", (_nome, texto) => {
    expect(fraseEscritaPelaCasa(CODIGO, texto)).toBeNull();
  });

  it.each([
    "falha: PERMISSION DENIED",
    "falha: Row-Level Security",
    "falha: VIOLATES check",
    "falha: Statement Timeout",
    "falha: PERMISSÃO NEGADA",
    "falha na FUNÇÃO",
    "falha: Jwt vencido",
    "falha: error: boom",
    "falha: sqlstate 42501",
    "falha pgrst301",
    "falha ao ler PUBLIC.orders",
  ])("%s não passa, em maiúscula ou minúscula", (texto) => {
    expect(fraseEscritaPelaCasa(CODIGO, texto)).toBeNull();
  });

  it("JWT e ERROR: só contam como palavra inteira, colados em letras não derrubam a frase", () => {
    expect(fraseEscritaPelaCasa(CODIGO, "falha: AJWTA")).toBe("falha: AJWTA");
    expect(fraseEscritaPelaCasa(CODIGO, "falha: AERROR: x")).toBe(
      "falha: AERROR: x",
    );
  });

  it("palavras comuns que só PARECEM técnicas não derrubam uma frase da casa", () => {
    // `\bJWT\b`, `\bERROR:` e `\bPGRST\d` só valem como palavra inteira.
    expect(fraseEscritaPelaCasa(CODIGO, "Houve um erro: tente de novo.")).toBe(
      "Houve um erro: tente de novo.",
    );
    expect(fraseEscritaPelaCasa(CODIGO, "Informe o motivo.")).toBe(
      "Informe o motivo.",
    );
  });
});

describe("os moldes com nome de produto só valem para a frase INTEIRA", () => {
  it("variação com nome de produto em forma de identificador passa pelo molde", () => {
    const frase = "Escolha uma variação para o produto KIT_BASICO.";
    expect(fraseEscritaPelaCasa(CODIGO, frase)).toBe(frase);
  });

  it("molde com texto técnico DEPOIS (em outra linha) não passa", () => {
    for (const molde of [
      "Produto KIT_BASICO não disponível.",
      "Estoque insuficiente para o produto KIT_BASICO (Disponível: 1)",
      "Escolha uma variação para o produto KIT_BASICO.",
    ]) {
      expect(
        fraseEscritaPelaCasa(CODIGO, `${molde}\nERROR: boom`),
        molde,
      ).toBeNull();
    }
  });

  it("molde com texto técnico ANTES (colado na frente) não passa", () => {
    for (const molde of [
      "Produto KIT_BASICO não disponível.",
      "Estoque insuficiente para o produto KIT_BASICO",
      "Escolha uma variação para o produto KIT_BASICO.",
    ]) {
      expect(
        fraseEscritaPelaCasa(CODIGO, `ERROR: boom. ${molde}`),
        molde,
      ).toBeNull();
    }
  });
});

describe("sinal de português: acento ou palavra que não existe em inglês", () => {
  it.each([..."áàâãéêíóôõúç"])(
    "a letra acentuada %s basta para a frase passar",
    (letra) => {
      const frase = `zz${letra}zz zzz`;
      expect(fraseEscritaPelaCasa(CODIGO, frase)).toBe(frase);
    },
  );

  it.each([
    "não",
    "nao",
    "para",
    "um",
    "uma",
    "este",
    "esta",
    "esse",
    "essa",
    "ja",
    "so",
    "com",
    "por",
    "que",
    "dos",
    "das",
    "ao",
    "ou",
    "se",
    "nos",
    "nas",
    "pelo",
    "pela",
    "venda",
    "pedido",
    "loja",
    "produto",
    "motivo",
    "informe",
    "escolha",
    "estoque",
    "acesso",
    "negado",
    "autorizado",
    "falha",
  ])("a palavra '%s' sozinha basta, em qualquer caixa", (palavra) => {
    expect(fraseEscritaPelaCasa(CODIGO, `${palavra} zzz`)).toBe(
      `${palavra} zzz`,
    );
    expect(fraseEscritaPelaCasa(CODIGO, `${palavra.toUpperCase()} zzz`)).toBe(
      `${palavra.toUpperCase()} zzz`,
    );
  });

  it("controle: o enchimento sem nenhum sinal de português NÃO passa", () => {
    expect(fraseEscritaPelaCasa(CODIGO, "zzz zzz")).toBeNull();
  });

  it("a palavra só vale inteira: dentro de outra palavra não conta", () => {
    for (const texto of ["zzvendazz zzz", "zzcomzz zzz", "zzfalhazz zzz"]) {
      expect(fraseEscritaPelaCasa(CODIGO, texto), texto).toBeNull();
    }
  });
});
