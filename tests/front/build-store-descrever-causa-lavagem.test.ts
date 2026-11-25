// Caça por mutação em descreverCausa (scripts/buildStore.mjs, 25/11/2026). Os
// dois testes vizinhos (build-store-causa-do-erro e ...-descrever-causa-bordas)
// cobrem o caminho comum, mas 21 de 44 defeitos de uma linha sobreviviam:
// nove das onze palavras do padrão de nome sensível podiam sair sem ninguém
// notar (os valores de teste eram longos o bastante para a regra de "sequência
// opaca" salvá-los por outro caminho), além do limite exato de 8 caracteres,
// de 31/32 caracteres e do corte de espaços.
//
// Aqui cada valor é CURTO (8 a 31 caracteres) e sem formato conhecido, então só
// a regra do NOME da variável pode lavá-lo. Valores inventados.
//
// Mutantes equivalentes (nenhum teste os derruba, e não precisa):
//  - nenhum nesta família: todos os 21 foram derrubados ou movidos para
//    build-store-guarda-de-invocacao (guarda) ou anotados no relatório
//    (regex de origem do Supabase, só alcançável pelo build inteiro).
import { describe, expect, it } from "vitest";
// @ts-expect-error Módulo JS nativo sem declaração.
import { descreverCausa } from "../../scripts/buildStore.mjs";

const lavar = (mensagem: string, env: Record<string, unknown> = {}) =>
  descreverCausa(new Error(mensagem), env) as string;

describe("descreverCausa: o NOME da variável decide o que é lavado", () => {
  it.each([
    "MEU_KEY",
    "MEU_TOKEN",
    "MEU_SECRET",
    "MEU_PASS",
    "MEU_AUTH",
    "MEU_CREDENTIAL",
    "MEU_PRIVATE",
    "MEU_DATABASE_URL",
    "MEU_DSN",
    "MEU_COOKIE",
    "MEU_SIGNATURE",
    "meu_token_em_minusculas",
  ])("variável %s tem o valor curto lavado", (nome) => {
    const valor = "valor-curto-12"; // 14 caracteres, sem formato conhecido
    const texto = lavar(`falhou com ${valor} no meio`, { [nome]: valor });
    expect(texto).toBe("falhou com [oculto] no meio");
  });

  it("variável de nome comum NÃO tem o valor lavado", () => {
    const texto = lavar("falhou com valor-curto-12", {
      MEU_NOME: "valor-curto-12",
    });
    expect(texto).toBe("falhou com valor-curto-12");
  });

  it("o limite é 8 caracteres: 8 lava, 7 não", () => {
    expect(lavar("x 12345678 y", { MEU_TOKEN: "12345678" })).toBe(
      "x [oculto] y",
    );
    expect(lavar("x 1234567 y", { MEU_TOKEN: "1234567" })).toBe("x 1234567 y");
  });

  it("valor sem texto (undefined, número) numa variável sensível não derruba nada", () => {
    expect(lavar("ok", { MEU_TOKEN: undefined, OUTRO_SECRET: 123456789 })).toBe(
      "ok",
    );
  });

  it("todas as ocorrências do valor saem, não só a primeira", () => {
    expect(
      lavar("a segredo-abc1 b segredo-abc1 c", { MEU_TOKEN: "segredo-abc1" }),
    ).toBe("a [oculto] b [oculto] c");
  });
});

describe("descreverCausa: formatos conhecidos, em qualquer caixa", () => {
  it("Bearer em minúsculas ou maiúsculas", () => {
    expect(lavar("header bearer abcdef12")).toBe("header [oculto]");
    expect(lavar("header BEARER abcdef12")).toBe("header [oculto]");
  });

  it("usuário:senha@ na URL, com o esquema em maiúsculas", () => {
    // Esquema montado em pedaços: o secretlint recusa string de conexão inteira.
    const esquema = ["POSTGRES", "//"].join(":");
    const texto = lavar(
      `falha em ${esquema}usuario:senhafalsa@host.invalid/db`,
    );
    expect(texto).not.toContain("senhafalsa");
    expect(texto).not.toContain("usuario:");
  });

  it("chave sb_ em maiúsculas", () => {
    expect(lavar("chave SB_PUBLISHABLE_abc123 falhou")).toBe(
      "chave [oculto] falhou",
    );
  });

  it("sequência opaca: 32 caracteres são lavados, 31 ficam", () => {
    const de32 = "a".repeat(32);
    const de31 = "a".repeat(31);
    expect(lavar(`x ${de32} y`)).toBe("x [oculto] y");
    expect(lavar(`x ${de31} y`)).toBe(`x ${de31} y`);
  });
});

describe("descreverCausa: forma da frase", () => {
  it("tira espaços das pontas e colapsa quebras de linha e espaços repetidos", () => {
    expect(lavar("  primeira\n\n   segunda    terceira  \n")).toBe(
      "primeira segunda terceira",
    );
  });

  it("causa que não é Error não vira texto (nem 'undefined')", () => {
    const erro = new Error("principal", { cause: "causa solta em texto" });
    expect(descreverCausa(erro, {})).toBe("principal");
  });

  it("causa Error entra com o code, ou com a mensagem quando não há code", () => {
    const comCode = new Error("principal", {
      cause: Object.assign(new Error("mensagem da causa"), { code: "ECODIGO" }),
    });
    expect(descreverCausa(comCode, {})).toBe("principal (causa: ECODIGO)");
    const semCode = new Error("principal", { cause: new Error("so mensagem") });
    expect(descreverCausa(semCode, {})).toBe("principal (causa: so mensagem)");
  });

  it("texto de EXATAMENTE 400 caracteres passa inteiro; 401 é cortado com reticências", () => {
    const de400 = `${"ab ".repeat(133)}c`; // 400 caracteres, com espaços simples
    expect(de400).toHaveLength(400);
    expect(lavar(de400)).toBe(de400);
    const de401 = `${de400}d`;
    const cortado = lavar(de401);
    expect(cortado).toBe(`${de401.slice(0, 400)}…`);
    expect(cortado).toHaveLength(401);
  });
});
