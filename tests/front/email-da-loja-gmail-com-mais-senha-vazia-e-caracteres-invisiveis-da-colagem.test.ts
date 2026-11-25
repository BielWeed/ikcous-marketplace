// Caça por mutação (25/11/2026), e-mail da loja: o que a lojista digita e cola.
// Pontos que nenhum teste prendia:
//   - o Gmail aceita "+" antes do @ (nome+loja@gmail.com é endereço de verdade);
//   - campo vazio (ou só espaços) pede para digitar; o aviso de "não parece
//     certo" é para endereço preenchido errado;
//   - senha de app vazia, ou só com sujeira de colagem, pede para colar; a
//     frase das "16 letras" é para o que veio com letra a mais ou a menos;
//   - os caracteres invisíveis que o copiar-e-colar mete entre as letras (junta-
//     palavras de largura zero, barra horizontal, hífens parentes) são
//     descartados, senão a colagem boa seria recusada.
//   - um motivo de falha que a tela não conhece cai na causa genérica, nunca em
//     texto vazio.
import { describe, expect, it } from "vitest";

import {
  type StatusDoEmail,
  normalizarSenhaDeApp,
  textoDaSaudeDoEnvio,
  validarGmailDaLoja,
} from "@/components/admin/settings/email-da-loja-conteudo";

const PEDE_GMAIL = "Digite o Gmail da loja, como nomedaloja@gmail.com.";
const PEDE_SENHA = "Cole a senha de app de 16 letras (passo 3).";
const SENHA = "abcdefghijklmnop";

describe("validarGmailDaLoja: caracteres do começo do endereço", () => {
  it.each([
    ["mais (plus addressing)", "nome+loja@gmail.com"],
    ["ponto", "nome.da.loja@gmail.com"],
    ["sublinhado", "nome_loja@gmail.com"],
    ["porcentagem", "nome%loja@gmail.com"],
    ["hífen", "nome-loja@gmail.com"],
    ["números", "loja2026@gmail.com"],
    ["domínio googlemail", "loja@googlemail.com"],
  ])("aceita %s", (_nome, entrada) => {
    expect(validarGmailDaLoja(entrada)).toEqual({ ok: true, usuario: entrada });
  });

  it("maiúsculas e espaços nas pontas são arrumados, não recusados", () => {
    expect(validarGmailDaLoja("  Loja.Teste@GMAIL.com \n")).toEqual({
      ok: true,
      usuario: "loja.teste@gmail.com",
    });
  });

  it.each([
    ["espaço no meio", "nome loja@gmail.com"],
    ["exclamação", "nome!loja@gmail.com"],
    ["sem nada antes do @", "@gmail.com"],
    ["outro provedor", "loja@outlook.com"],
    ["domínio com sufixo", "loja@gmail.com.br"],
    ["texto antes do endereço", "meu email: loja@gmail.com"],
  ])("recusa %s com o aviso de 'não parece certo'", (_nome, entrada) => {
    const r = validarGmailDaLoja(entrada);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.erro).toMatch(/^Esse endereço não parece certo/);
  });
});

describe("validarGmailDaLoja: campo vazio", () => {
  it.each([
    ["texto vazio", ""],
    ["só espaços", "   "],
    ["só quebra de linha e tabulação", "\n\t"],
  ])("%s pede para digitar o Gmail", (_nome, entrada) => {
    expect(validarGmailDaLoja(entrada)).toEqual({
      ok: false,
      erro: PEDE_GMAIL,
    });
  });
});

describe("normalizarSenhaDeApp: campo vazio ou só sujeira de colagem", () => {
  it.each([
    ["texto vazio", ""],
    ["só espaços", "    "],
    ["só hífens e invisíveis", " - \u200b\u2060 \u00ad -"],
  ])("%s pede para colar a senha", (_nome, entrada) => {
    expect(normalizarSenhaDeApp(entrada)).toEqual({
      ok: false,
      erro: PEDE_SENHA,
    });
  });

  it("letra a mais ou a menos recebe a frase das 16 letras, não o pedido de colar", () => {
    for (const entrada of [SENHA.slice(1), `${SENHA}q`]) {
      const r = normalizarSenhaDeApp(entrada);
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.erro).toMatch(/^A senha de app tem 16 letras/);
      }
    }
  });
});

describe("normalizarSenhaDeApp: cada caractere invisível da colagem some", () => {
  it.each([
    ["espaço comum", " "],
    ["espaço que não quebra (U+00A0)", "\u00a0"],
    ["espaço largo (U+2003)", "\u2003"],
    ["largura zero (U+200B)", "\u200b"],
    ["não-junta (U+200C)", "\u200c"],
    ["junta (U+200D)", "\u200d"],
    ["junta-palavras (U+2060)", "\u2060"],
    ["hífen suave (U+00AD)", "\u00ad"],
    ["hífen (U+2010)", "\u2010"],
    ["hífen que não quebra (U+2011)", "\u2011"],
    ["travessão de figura (U+2012)", "\u2012"],
    ["meia-risca (U+2013)", "\u2013"],
    ["risca (U+2014)", "\u2014"],
    ["barra horizontal (U+2015)", "\u2015"],
    ["sinal de menos (U+2212)", "\u2212"],
    ["hífen comum", "-"],
    ["tabulação", "\t"],
  ])("%s entre os grupos de 4 letras", (_nome, separador) => {
    const colada = [
      SENHA.slice(0, 4),
      SENHA.slice(4, 8),
      SENHA.slice(8, 12),
      SENHA.slice(12),
    ].join(separador);
    expect(normalizarSenhaDeApp(colada)).toEqual({ ok: true, senha: SENHA });
  });

  it("a senha vem em minúsculas mesmo colada em maiúsculas", () => {
    expect(normalizarSenhaDeApp(SENHA.toUpperCase())).toEqual({
      ok: true,
      senha: SENHA,
    });
  });

  it("separador repetido em vários lugares sai inteiro, não só o primeiro", () => {
    expect(normalizarSenhaDeApp(` ${SENHA.split("").join(" - ")} `)).toEqual({
      ok: true,
      senha: SENHA,
    });
  });
});

describe("textoDaSaudeDoEnvio: motivo de falha que a tela não conhece", () => {
  it("cai na causa genérica 'o Google recusou o envio', nunca em frase vazia", () => {
    const status = {
      usuario: "loja@gmail.com",
      senhaGuardada: true,
      ultimoTeste: null,
      origem: "painel",
      cofrePronto: true,
      registroIlegivel: false,
      falha: {
        em: null,
        // Um motivo novo do servidor que esta versão da tela não conhece.
        motivo: "motivo_novo_do_servidor" as never,
        origem: "painel",
      },
    } satisfies StatusDoEmail;

    expect(textoDaSaudeDoEnvio(status)).toBe(
      "Seus e-mails pararam \u2014 o Google recusou o envio.",
    );
  });
});
