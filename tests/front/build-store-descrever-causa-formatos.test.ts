// scripts/buildStore.mjs — descreverCausa, a LAVAGEM (cada nome sensível,
// cada formato de segredo, cada borda do tamanho). O log do CLI na Vercel é
// público para quem tem acesso ao projeto; se uma linha das regras sumir, o
// segredo vaza ali sem nenhum teste vermelho. Aqui cada regra tem uma entrada
// que SÓ ela pega, com o resultado exato esperado. Todos os valores são
// inventados e montados em tempo de execução (o secretlint barra os
// formatos reais escritos por extenso, mesmo fictícios).
import { afterEach, describe, expect, it, vi } from "vitest";
// @ts-expect-error Node entry é JavaScript nativo, sem declaração de tipos.
import { descreverCausa } from "../../scripts/buildStore.mjs";

afterEach(() => {
  vi.unstubAllEnvs();
});

const erro = (texto: string) => new Error(texto);
const lavar = (texto: string, env: Record<string, unknown> = {}) =>
  descreverCausa(erro(texto), env) as string;

const NOMES = [
  "KEY",
  "TOKEN",
  "SECRET",
  "PASS",
  "AUTH",
  "CREDENTIAL",
  "PRIVATE",
  "DATABASE_URL",
  "DSN",
  "COOKIE",
  "SIGNATURE",
];

describe("nome de variável sensível: cada palavra da lista", () => {
  it.each(NOMES)(
    "%s esconde o valor, em maiúsculas e em minúsculas, em todas as ocorrências",
    (palavra) => {
      const valor = "valor-ficticio-98765";
      const mensagem = `1 ${valor} 2 ${valor} 3`;
      for (const nome of [
        `MINHA_${palavra}`,
        `minha_${palavra.toLowerCase()}`,
      ]) {
        expect(lavar(mensagem, { [nome]: valor })).toBe(
          "1 [oculto] 2 [oculto] 3",
        );
      }
    },
  );

  it("variável de nome comum não esconde, nem com valor longo", () => {
    expect(
      lavar("pasta valor-ficticio-98765 ok", {
        PASTA_DO_BUILD: "valor-ficticio-98765",
      }),
    ).toBe("pasta valor-ficticio-98765 ok");
  });

  it("valor que não é texto é ignorado sem quebrar a lavagem", () => {
    expect(
      lavar("falhou 123456789012", {
        MINHA_KEY: 123456789012,
        OUTRA_KEY: undefined,
      }),
    ).toBe("falhou 123456789012");
  });

  it("sem segundo argumento, usa o process.env de verdade", () => {
    vi.stubEnv("MINHA_CHAVE_DE_TESTE_KEY", "valor-do-ambiente-777");
    expect(descreverCausa(erro("falhou com valor-do-ambiente-777"))).toBe(
      "falhou com [oculto]",
    );
  });
});

describe("formatos conhecidos de segredo", () => {
  const eyJ = (...partes: string[]) => ["eyJ", ...partes].join("");

  it("JWT: 8 caracteres é o piso das duas primeiras partes; a terceira pode ser vazia", () => {
    expect(lavar(`x ${eyJ("abcdefgh")}.abcdefgh. y`)).toBe("x [oculto] y");
    expect(lavar(`x ${eyJ("abcdefgh")}.abcdefgh.assinatura-1 y`)).toBe(
      "x [oculto] y",
    );
  });

  it("JWT: 7 caracteres na primeira ou na segunda parte NÃO é lavado como JWT", () => {
    expect(lavar(`x ${eyJ("abcdefg")}.abcdefgh.zz y`)).toContain(
      eyJ("abcdefg"),
    );
    expect(lavar(`x ${eyJ("abcdefgh")}.abcdefg.zz y`)).toContain("abcdefg.zz");
  });

  it("JWT: todas as ocorrências", () => {
    const jwt = `${eyJ("abcdefgh")}.abcdefgh.zz`;
    expect(lavar(`${jwt} e ${jwt}`)).toBe("[oculto] e [oculto]");
  });

  it.each([
    "sb_publishable_abc-123_xyz",
    "sb_secret_abc-123_xyz",
    "SB_SECRET_ABC123",
    "Sb_Publishable_Qq9",
  ])("chave nova do Supabase %s some por inteiro", (chave) => {
    expect(lavar(`k ${chave} fim`)).toBe("k [oculto] fim");
  });

  it("chave sb_ em duas ocorrências e com texto colado antes (sem \\b não é chave)", () => {
    expect(lavar("a sb_secret_aaa b sb_publishable_bbb")).toBe(
      "a [oculto] b [oculto]",
    );
    expect(lavar("xsb_secret_aaa")).toBe("xsb_secret_aaa");
  });

  it("sb_ de outro tipo (não publishable nem secret) não é chave", () => {
    expect(lavar("sb_outra_aaa")).toBe("sb_outra_aaa");
  });

  it.each(["Bearer", "bearer", "BEARER"])(
    "cabeçalho %s some com o token inteiro, em qualquer caixa",
    (palavra) => {
      expect(lavar(`h ${palavra}   abc.def-ghi/jkl=mn fim`)).toBe(
        "h [oculto] fim",
      );
    },
  );

  it("Bearer: duas ocorrências; colado em outra palavra não conta", () => {
    expect(lavar("Bearer a1 e Bearer b2")).toBe("[oculto] e [oculto]");
    expect(lavar("xBearer abc")).toBe("xBearer abc");
  });

  it("usuário:senha@ em URL: some só a credencial, o host fica", () => {
    const banco = ["postgresql:", "//admin:hunter2@db.exemplo.invalid/x"].join(
      "",
    );
    expect(lavar(`u ${banco}`)).toBe("u [oculto]db.exemplo.invalid/x");
  });

  it("URL com esquema composto (+) e em maiúsculas, duas vezes", () => {
    const ssh = ["git+ssh:", "//deploy:segredo9@host.exemplo.invalid/r"].join(
      "",
    );
    expect(lavar(ssh)).toBe("[oculto]host.exemplo.invalid/r");
    const web = [
      "HTTP:",
      "//ana:senha1@h1.exemplo.invalid e ",
      "ftp:",
      "//bia:senha2@h2.exemplo.invalid",
    ].join("");
    expect(lavar(web)).toBe(
      "[oculto]h1.exemplo.invalid e [oculto]h2.exemplo.invalid",
    );
  });

  it("usuário de um caractere e senha de um caractere também somem", () => {
    const url = ["https:", "//a:b@h.exemplo.invalid"].join("");
    expect(lavar(url)).toBe("[oculto]h.exemplo.invalid");
  });

  it("URL sem senha fica legível", () => {
    const url = ["https:", "//usuario@h.exemplo.invalid/p"].join("");
    expect(lavar(url)).toBe(url);
  });
});

describe("sequência opaca longa: piso de 32, alfabeto completo", () => {
  it("31 caracteres ficam; 32 somem", () => {
    expect(lavar(`k ${"a1".repeat(15)}z fim`)).toBe(
      `k ${"a1".repeat(15)}z fim`,
    );
    expect(lavar(`k ${"a1".repeat(16)} fim`)).toBe("k [oculto] fim");
  });

  it("hífen e sublinhado fazem parte da sequência (base64url)", () => {
    expect(lavar(`k ${"a".repeat(20)}-${"b".repeat(20)} fim`)).toBe(
      "k [oculto] fim",
    );
    expect(lavar(`k ${"a".repeat(20)}_${"b".repeat(20)} fim`)).toBe(
      "k [oculto] fim",
    );
  });

  it("maiúsculas e dígitos fazem parte; duas sequências somem", () => {
    expect(lavar(`${"A".repeat(40)} e ${"9".repeat(40)}`)).toBe(
      "[oculto] e [oculto]",
    );
  });

  it("a barra NÃO faz parte: caminho comprido fica legível", () => {
    const caminho =
      "/vercel/path0/aaaaaaaaaaaaaaaaaaaa/bbbbbbbbbbbbbbbbbbbb/x.svg";
    expect(lavar(`ENOENT ${caminho}`)).toBe(`ENOENT ${caminho}`);
  });
});

describe("forma da saída", () => {
  it("espaços, tabs e quebras viram um espaço só; as pontas são aparadas", () => {
    expect(lavar("  a   b\t\tc\n\n d  ")).toBe("a b c d");
  });

  it("causa que é Error com código usa o código; sem código usa a mensagem", () => {
    const comCodigo = new Error("topo", {
      cause: Object.assign(new Error("interna"), { code: "EACCES" }),
    });
    const semCodigo = new Error("topo", { cause: new Error("interna") });
    expect(descreverCausa(comCodigo, {})).toBe("topo (causa: EACCES)");
    expect(descreverCausa(semCodigo, {})).toBe("topo (causa: interna)");
  });

  it.each([
    ["texto", "texto solto"],
    ["nulo", null],
    ["número", 5],
    ["objeto", { message: "x" }],
  ])("causa que não é Error (%s) é ignorada", (_n, causa) => {
    expect(descreverCausa(new Error("topo", { cause: causa }), {})).toBe(
      "topo",
    );
  });

  it.each([
    ["texto", "senha=1"],
    ["indefinido", undefined],
    ["nulo", null],
    ["objeto com message", { message: "x" }],
  ])("valor lançado que não é Error (%s) nunca é impresso", (_n, valor) => {
    expect(descreverCausa(valor, {})).toBe("valor lançado que não é Error");
  });

  it("a causa também é lavada (o segredo pode estar na causa interna)", () => {
    const e = new Error("topo", {
      cause: Object.assign(new Error("x"), { code: "sb_secret_zzz" }),
    });
    expect(descreverCausa(e, {})).toBe("topo (causa: [oculto])");
  });
});
