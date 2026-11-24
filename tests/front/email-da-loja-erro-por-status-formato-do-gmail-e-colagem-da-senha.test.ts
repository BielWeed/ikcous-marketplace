// Caça de provas fracas (24/11/2026), tela de e-mail da loja: três regras puras
// cujas BORDAS a suíte antiga não fechava.
//
//  1. `traduzirFalha`: cada status HTTP tem a SUA frase (401/403 = sessão ou
//     permissão; 409 = mudou no meio do caminho; 400 = o painel recusou;
//     429 = espere N; o resto = genérica). Trocar uma pela outra manda a
//     lojista para o conserto errado (ex.: "recarregue" quando o problema é a
//     senha). O 429 só devolve um número de espera quando o servidor mandou um
//     número FINITO e positivo.
//  2. `validarGmailDaLoja`: 254 caracteres é o limite do endereço inteiro.
//  3. `normalizarSenhaDeApp`: a colagem tem lixo invisível (junção de palavras,
//     hífen suave, sinal de menos) além dos espaços; colagem boa nunca é
//     recusada.
// Valores fictícios; nenhuma senha real.
import { describe, expect, it } from "vitest";

import {
  mensagemDoMotivo,
  normalizarSenhaDeApp,
  traduzirFalha,
  validarGmailDaLoja,
} from "@/components/admin/settings/email-da-loja-conteudo";

describe("traduzirFalha: cada status tem a sua frase", () => {
  it.each([401, 403])(
    "status %i: sessão expirada ou sem permissão (não é 'genérico', nem 'indisponível')",
    (status) => {
      const t = traduzirFalha({ status }, "salvar");
      expect(t.mensagem).toContain("sessão no painel expirou");
      expect(t.indisponivel).toBe(false);
    },
  );

  it("status 409: o Gmail ou a senha mudaram no meio do caminho", () => {
    const t = traduzirFalha({ status: 409 }, "testar");
    expect(t.mensagem).toContain("mudaram no meio do caminho");
    expect(t.indisponivel).toBe(false);
  });

  it("status 400: o painel não aceitou o Gmail ou a senha digitados", () => {
    const t = traduzirFalha({ status: 400 }, "salvar");
    expect(t.mensagem).toContain("O painel não aceitou o Gmail ou a senha");
  });

  it.each([500, 502, undefined])(
    "status %s sem motivo: frase genérica, sem texto do servidor",
    (status) => {
      const t = traduzirFalha({ status }, "remover");
      expect(t.mensagem).toContain("Algo saiu do previsto no servidor");
      expect(t.indisponivel).toBe(false);
    },
  );

  it("as frases de status 401, 409, 400 e 500 são todas DIFERENTES entre si", () => {
    const frases = [401, 409, 400, 500].map(
      (status) => traduzirFalha({ status }, "salvar").mensagem,
    );
    expect(new Set(frases).size).toBe(frases.length);
  });

  it("o status manda mais que o motivo: 401/403/404/429 ignoram o motivo que veio no corpo", () => {
    const comMotivo = { motivo: "senha_errada" };
    expect(
      traduzirFalha({ status: 401, ...comMotivo }, "salvar").mensagem,
    ).toContain("sessão no painel expirou");
    expect(
      traduzirFalha({ status: 403, ...comMotivo }, "salvar").mensagem,
    ).toContain("sessão no painel expirou");
    expect(
      traduzirFalha({ status: 404, ...comMotivo }, "salvar").indisponivel,
    ).toBe(true);
    expect(
      traduzirFalha({ status: 429, ...comMotivo }, "salvar").mensagem,
    ).toContain("Calma");
  });

  it("motivo conhecido (lista fechada) vence os status 400/409/500/503", () => {
    for (const status of [400, 409, 500, 503]) {
      expect(
        traduzirFalha({ status, motivo: "limite_diario" }, "testar").mensagem,
      ).toBe(mensagemDoMotivo("limite_diario"));
    }
  });
});

describe("traduzirFalha: 429 só devolve espera quando o número presta", () => {
  it("90 s: devolve 90 e a frase diz '2 minutos'", () => {
    const t = traduzirFalha({ status: 429, espereSegundos: 90 }, "testar");
    expect(t.espereSegundos).toBe(90);
    expect(t.mensagem).toContain("em 2 minutos");
  });

  it.each([
    ["zero", 0],
    ["negativo", -10],
    ["NaN", Number.NaN],
    ["infinito", Number.POSITIVE_INFINITY],
    ["texto", "90"],
    ["ausente", undefined],
  ])(
    "espera %s: NÃO devolve número e a frase diz 'alguns instantes'",
    (_n, valor) => {
      const t = traduzirFalha({ status: 429, espereSegundos: valor }, "testar");
      expect(t.espereSegundos).toBeUndefined();
      expect(t.mensagem).toContain("em alguns instantes");
    },
  );
});

describe("mensagemDoMotivo: sem motivo cai na frase de 'recusado'", () => {
  it("null devolve exatamente a frase do motivo 'recusado'", () => {
    expect(mensagemDoMotivo(null)).toBe(mensagemDoMotivo("recusado"));
    expect(mensagemDoMotivo(null)).not.toBe(mensagemDoMotivo("senha_errada"));
  });
});

describe("validarGmailDaLoja: o limite de 254 caracteres", () => {
  const gmailComTamanho = (total: number) =>
    `${"a".repeat(total - "@gmail.com".length)}@gmail.com`;

  it("254 caracteres ainda vale; 255 não", () => {
    const noLimite = gmailComTamanho(254);
    expect(noLimite).toHaveLength(254);
    expect(validarGmailDaLoja(noLimite)).toEqual({
      ok: true,
      usuario: noLimite,
    });
    const passou = gmailComTamanho(255);
    expect(passou).toHaveLength(255);
    expect(validarGmailDaLoja(passou).ok).toBe(false);
  });
});

describe("normalizarSenhaDeApp: lixo invisível da colagem", () => {
  const SENHA = "abcdefghijklmnop";

  it.each([
    ["junção de palavras (U+2060)", "⁠"],
    ["hífen suave (U+00AD)", "­"],
    ["sinal de menos (U+2212)", "−"],
    ["largura zero (U+200B)", "​"],
    ["espaço que não quebra (U+00A0)", " "],
    ["travessão (U+2014)", "—"],
    ["hífen comum", "-"],
    ["espaço comum", " "],
  ])("%s entre os grupos não derruba a senha", (_nome, lixo) => {
    const colada = `abcd${lixo}efgh${lixo}ijkl${lixo}mnop`;
    expect(normalizarSenhaDeApp(colada)).toEqual({ ok: true, senha: SENHA });
  });

  it("o lixo repetido em vários pontos (não só a primeira ocorrência) some todo", () => {
    expect(normalizarSenhaDeApp(" ⁠a­b−c d-e f​g h ijklmnop ")).toEqual({
      ok: true,
      senha: SENHA,
    });
  });

  it("maiúsculas viram minúsculas; número ou símbolo de verdade continua recusado", () => {
    expect(normalizarSenhaDeApp("ABCD EFGH IJKL MNOP")).toEqual({
      ok: true,
      senha: SENHA,
    });
    expect(normalizarSenhaDeApp("abcd efgh ijkl mn0p").ok).toBe(false);
    expect(normalizarSenhaDeApp("abcd efgh ijkl mnop!").ok).toBe(false);
    expect(normalizarSenhaDeApp("abcd efgh ijkl mno").ok).toBe(false);
    expect(normalizarSenhaDeApp("abcd efgh ijkl mnopq").ok).toBe(false);
  });
});
