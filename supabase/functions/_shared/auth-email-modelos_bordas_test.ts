// @ts-nocheck
/**
 * Caça por mutação (25/11/2026) em `auth-email-modelos.ts` — o texto dos
 * e-mails de login, recuperação de senha e avisos de segurança. 16 mutantes
 * plantados; 10 sobreviviam à suíte de `auth-email_test.ts` (que passa pelo
 * módulo todo via `montarEmailsAuth`); 4 são equivalentes (escapar o HTML de
 * texto fixo sem caractere especial, em 3 lugares, e `< 32` → `<= 32`, que
 * troca um espaço por um espaço) e 6 viram os casos abaixo:
 *
 *   * o nome da loja vai no assunto: caractere de controle (0x00 a 0x1f e o
 *     0x7f) vira espaço — nunca quebra de cabeçalho — e o espaço comum (0x20)
 *     e o til (0x7e) ficam;
 *   * nome vazio, só de espaços ou só de controle vira "Nossa loja";
 *   * o rodapé dos AVISOS (senha, e-mail, telefone alterados...) é o de "se
 *     você não reconhece esta alteração"; o dos demais e-mails é o de "se você
 *     não solicitou, ignore" e nunca pede o código a ninguém.
 */
import {
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.177.0/testing/asserts.ts";
import { renderizarEmailAuth } from "./auth-email-modelos.ts";

const nomeNoAssunto = (nome: string) =>
  renderizarEmailAuth("magiclink", nome, "123456", "https://projeto.exemplo.com/auth/v1/verify?x=1").assunto;

Deno.test("nome da loja: controle (0x00 a 0x1f e 0x7f) vira espaço; espaço comum e til ficam", () => {
  assertEquals(nomeNoAssunto("A\u0000B"), "Seu acesso — A B");
  assertEquals(nomeNoAssunto("A\u001fB"), "Seu acesso — A B");
  assertEquals(nomeNoAssunto("A\tB"), "Seu acesso — A B");
  assertEquals(nomeNoAssunto("A\u007fB"), "Seu acesso — A B");
  assertEquals(nomeNoAssunto("A B"), "Seu acesso — A B");
  assertEquals(nomeNoAssunto("A~B"), "Seu acesso — A~B");
  assertEquals(nomeNoAssunto("A!B"), "Seu acesso — A!B");
});

Deno.test("nome da loja: sem quebra de linha no assunto e sem espaço sobrando nas pontas", () => {
  assertEquals(nomeNoAssunto("\u0001Loja\u001f"), "Seu acesso — Loja");
  assertEquals(/[\r\n]/.test(nomeNoAssunto("Loja\r\nBcc: x@y.com")), false);
});

Deno.test("nome da loja vazio, só de espaços ou só de controle vira 'Nossa loja' (assunto, texto e HTML)", () => {
  for (const nome of ["", "   ", "\u0001\u0002", "\u007f", " \t\r\n "]) {
    const e = renderizarEmailAuth("magiclink", nome, "123456");
    assertEquals(e.assunto, "Seu acesso — Nossa loja", JSON.stringify(nome));
    assertEquals(e.texto.split("\n\n")[0], "Nossa loja", JSON.stringify(nome));
    assertStringIncludes(e.html, "<h1 style=\"font-size:22px\">Nossa loja</h1>");
  }
});

Deno.test("rodapé: aviso de alteração pede contato com a loja; os demais mandam ignorar e nunca compartilhar o código", () => {
  const aviso = renderizarEmailAuth("password_changed_notification", "Loja", undefined, undefined);
  assertEquals(aviso.texto.endsWith("Se você não reconhece esta alteração, entre em contato com a loja."), true);
  assertStringIncludes(aviso.html, "Se você não reconhece esta alteração, entre em contato com a loja.");
  assertEquals(aviso.texto.includes("ignore este e-mail"), false);

  for (const acao of ["signup", "recovery", "magiclink", "invite", "email_change", "reauthentication"]) {
    const e = renderizarEmailAuth(acao, "Loja", "123456", "https://projeto.exemplo.com/auth/v1/verify?x=1");
    const frase = "Se você não solicitou esta ação, ignore este e-mail. Nunca compartilhe seu código.";
    assertEquals(e.texto.endsWith(frase), true, acao);
    assertStringIncludes(e.html, frase);
    assertEquals(e.texto.includes("não reconhece"), false, acao);
  }
});

Deno.test("texto simples: nome, mensagem, código (só quando visível), link e rodapé, nesta ordem e separados por linha em branco", () => {
  const link = "https://projeto.exemplo.com/auth/v1/verify?token=h&type=magiclink";
  const e = renderizarEmailAuth("magiclink", "Loja da Praça", "123456", link);
  assertEquals(e.texto.split("\n\n"), [
    "Loja da Praça",
    "Use o link ou o código para entrar na sua conta.",
    "Código: 123456",
    `Entrar na loja: ${link}`,
    "Se você não solicitou esta ação, ignore este e-mail. Nunca compartilhe seu código.",
  ]);
  // cadastro e recuperação nunca mostram código, mesmo que ele seja passado
  for (const acao of ["signup", "recovery"]) {
    const sem = renderizarEmailAuth(acao, "Loja da Praça", "123456", link);
    assertEquals(sem.texto.includes("123456"), false, acao);
    assertEquals(sem.html.includes("123456"), false, acao);
  }
});
