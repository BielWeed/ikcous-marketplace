import {
  assertEquals,
  assertRejects,
} from "https://deno.land/std@0.177.0/testing/asserts.ts";
import { enviarEmail, remetenteConfigurado } from "./smtp.ts";

/**
 * O que esta suite prova, e o que ela NAO prova.
 *
 * PROVA: as recusas que acontecem ANTES de abrir conexao — falta de segredo e
 * destinatario vazio — e que nenhuma mensagem de erro carrega a senha.
 *
 * NAO PROVA: que a porta 465 sai, que o Gmail aceita a credencial, nem que a
 * biblioteca roda no runtime da edge function. Nada disso e' testavel aqui, e
 * fingir que e' seria pior que nao testar. Os tres foram medidos no ar em
 * 19/08/2026 com uma sonda descartavel: 465 abre em 48 ms, `verify()` autentica
 * e `npm:nodemailer@9.0.5` roda.
 */

/** Devolve a variavel ao estado anterior. Ternario como comando e erro de lint. */
function restaurar(nome: string, valor: string | undefined): void {
  if (valor === undefined) {
    Deno.env.delete(nome);
  } else {
    Deno.env.set(nome, valor);
  }
}

function semSegredos<T>(corpo: () => T): T {
  const user = Deno.env.get("SMTP_USER");
  const pass = Deno.env.get("SMTP_PASSWORD");
  Deno.env.delete("SMTP_USER");
  Deno.env.delete("SMTP_PASSWORD");
  try {
    return corpo();
  } finally {
    if (user) Deno.env.set("SMTP_USER", user);
    if (pass) Deno.env.set("SMTP_PASSWORD", pass);
  }
}

Deno.test("remetenteConfigurado: falso quando falta segredo", () => {
  assertEquals(semSegredos(() => remetenteConfigurado()), false);
});

Deno.test("remetenteConfigurado: verdadeiro com os dois presentes", () => {
  const user = Deno.env.get("SMTP_USER");
  const pass = Deno.env.get("SMTP_PASSWORD");
  Deno.env.set("SMTP_USER", "conta@gmail.com");
  Deno.env.set("SMTP_PASSWORD", "senha-de-app");
  try {
    assertEquals(remetenteConfigurado(), true);
  } finally {
    restaurar("SMTP_USER", user);
    restaurar("SMTP_PASSWORD", pass);
  }
});

Deno.test("remetenteConfigurado: falso com so' UM dos dois", () => {
  const user = Deno.env.get("SMTP_USER");
  const pass = Deno.env.get("SMTP_PASSWORD");
  Deno.env.set("SMTP_USER", "conta@gmail.com");
  Deno.env.delete("SMTP_PASSWORD");
  try {
    // Meio configurado e' o pior caso: passaria a guarda e falharia so' na hora
    // de enviar, depois de o codigo ja ter sido gravado.
    assertEquals(remetenteConfigurado(), false);
  } finally {
    restaurar("SMTP_USER", user);
    if (pass) Deno.env.set("SMTP_PASSWORD", pass);
  }
});

Deno.test("enviarEmail: recusa ANTES de abrir conexao quando falta segredo", async () => {
  const user = Deno.env.get("SMTP_USER");
  const pass = Deno.env.get("SMTP_PASSWORD");
  Deno.env.delete("SMTP_USER");
  Deno.env.delete("SMTP_PASSWORD");
  try {
    await assertRejects(
      () => enviarEmail({ para: "a@b.c", assunto: "x", html: "<p>x</p>" }),
      Error,
      "SMTP nao configurado",
    );
  } finally {
    if (user) Deno.env.set("SMTP_USER", user);
    if (pass) Deno.env.set("SMTP_PASSWORD", pass);
  }
});

Deno.test("enviarEmail: destinatario vazio recusa sem tocar a rede", async () => {
  const user = Deno.env.get("SMTP_USER");
  const pass = Deno.env.get("SMTP_PASSWORD");
  Deno.env.set("SMTP_USER", "conta@gmail.com");
  Deno.env.set("SMTP_PASSWORD", "senha-de-app");
  try {
    await assertRejects(
      () => enviarEmail({ para: "", assunto: "x", html: "<p>x</p>" }),
      Error,
      "destinatario vazio",
    );
  } finally {
    restaurar("SMTP_USER", user);
    restaurar("SMTP_PASSWORD", pass);
  }
});

Deno.test("enviarEmail: a mensagem de erro nunca contem a senha", async () => {
  const user = Deno.env.get("SMTP_USER");
  const pass = Deno.env.get("SMTP_PASSWORD");
  const SENHA = "senhasecretissima1234";
  Deno.env.set("SMTP_USER", "conta@gmail.com");
  Deno.env.set("SMTP_PASSWORD", SENHA);
  try {
    await enviarEmail({ para: "", assunto: "x", html: "<p>x</p>" });
    throw new Error("deveria ter falhado com destinatario vazio");
  } catch (e) {
    // Vale para QUALQUER falha, nao so' esta: e' o erro que vai parar no log
    // da funcao, que o Gabriel e qualquer um com acesso ao painel enxergam.
    assertEquals(String((e as Error).message).includes(SENHA), false);
  } finally {
    restaurar("SMTP_USER", user);
    restaurar("SMTP_PASSWORD", pass);
  }
});
