import {
  assert,
  assertEquals,
  assertStringIncludes,
  assertThrows,
} from "https://deno.land/std@0.177.0/testing/asserts.ts";
import { montarEmailsAuth } from "./auth-email.ts";

import { payload } from "./auth-email_fixtures.ts";

const PROJETO = "https://projeto.exemplo.com";

for (
  const [acao, assunto, botao, mostraCodigo] of [
    ["signup", "Confirme seu cadastro", "Confirmar cadastro", false],
    ["recovery", "Redefina sua senha", "Redefinir senha", false],
    ["magiclink", "Seu acesso", "Entrar na loja", true],
    ["invite", "Seu convite", "Aceitar convite", true],
    ["email", "Seu acesso", "Entrar na loja", true],
  ] as const
) {
  Deno.test(`Auth ${acao}: destinatário, assunto da loja, código só quando aplicável e link do próprio projeto`, () => {
    const [email] = montarEmailsAuth(payload(acao), PROJETO, "Loja da Praça");
    assertEquals(email?.para, "cliente@example.com");
    assertStringIncludes(email.assunto, assunto);
    assertStringIncludes(email.assunto, "Loja da Praça");
    assertStringIncludes(email.html, botao);
    assertEquals(email.html.includes("123456"), mostraCodigo);
    assertStringIncludes(email.texto, "Loja da Praça");
    assertEquals(email.texto.includes("123456"), mostraCodigo);
    if (!mostraCodigo) {
      assertEquals(email.html.includes("Código:"), false);
      assertEquals(email.texto.includes("Código:"), false);
      assertEquals(email.texto.includes("digite o código"), false);
      assertStringIncludes(email.texto, "Se você não solicitou esta ação");
      assertStringIncludes(email.html, "Se você não solicitou esta ação");
    }
    const link = email.texto.match(
      /https:\/\/projeto\.exemplo\.com\/auth\/v1\/verify\?\S+/,
    )?.[0];
    assert(link);
    const url = new URL(link);
    assertEquals(url.pathname, "/auth/v1/verify");
    assertEquals(url.searchParams.get("token"), "hash-atual-ficticio");
    assertEquals(url.searchParams.get("type"), acao);
    assertEquals(
      url.searchParams.get("redirect_to"),
      payload().email_data.redirect_to,
    );
    assertEquals(email.html.includes("host-nao-confiavel"), false);
  });
}

Deno.test("Auth reauthentication: só código, sem botão ou link", () => {
  const corpo = payload("reauthentication");
  corpo.email_data.token_hash = "";
  const [email] = montarEmailsAuth(corpo, PROJETO, "Loja");
  assertEquals(email?.para, "cliente@example.com");
  assertStringIncludes(email.texto, "123456");
  assertStringIncludes(email.assunto, "confirmação");
  assertEquals(email.html.includes("<a "), false);
  assertEquals(email.texto.includes("/auth/v1/verify"), false);
});

Deno.test("Auth email_change segura: dois destinatários com os hashes INVERTIDOS", () => {
  const corpo = payload("email_change");
  corpo.email_data.token_new = "654321";
  corpo.email_data.token_hash_new = "hash-do-atual";
  const emails = montarEmailsAuth(corpo, PROJETO, "Loja");
  assertEquals(emails.map((e) => e.para), [
    "cliente@example.com",
    "novo@example.com",
  ]);
  assertStringIncludes(emails[0].texto, "123456");
  assertStringIncludes(
    emails[0].texto,
    "token=hash-do-atual&type=email_change",
  );
  assertEquals(emails[0].texto.includes("654321"), false);
  assertStringIncludes(emails[1].texto, "654321");
  assertStringIncludes(
    emails[1].texto,
    "token=hash-atual-ficticio&type=email_change",
  );
  assertEquals(emails[1].texto.includes("123456"), false);
});

for (const campo of ["token", "token_new"] as const) {
  Deno.test(`Auth email_change sem proteção: só novo endereço, com ${campo} e token_hash`, () => {
    const corpo = payload("email_change");
    corpo.email_data.token = "";
    corpo.email_data.token_new = "";
    Object.assign(corpo.email_data, { [campo]: "654321" });
    const emails = montarEmailsAuth(corpo, PROJETO, "Loja");
    assertEquals(emails.length, 1);
    assertEquals(emails[0].para, "novo@example.com");
    assertStringIncludes(emails[0].texto, "654321");
    assertStringIncludes(
      emails[0].texto,
      "token=hash-atual-ficticio&type=email_change",
    );
  });
}

for (
  const [acao, trecho] of [
    ["password_changed_notification", "senha"],
    ["email_changed_notification", "e-mail"],
    ["phone_changed_notification", "telefone"],
    ["identity_linked_notification", "vinculado"],
    ["identity_unlinked_notification", "desvinculado"],
    ["mfa_factor_enrolled_notification", "adicionado"],
    ["mfa_factor_unenrolled_notification", "removido"],
  ]
) {
  Deno.test(`Auth aviso ${acao}: português, sem códigos ou botões`, () => {
    const [email] = montarEmailsAuth(payload(acao), PROJETO, "Loja da Praça");
    assertEquals(
      email?.para,
      acao === "email_changed_notification"
        ? "antigo@example.com"
        : "cliente@example.com",
    );
    assertStringIncludes(email.assunto, "Loja da Praça");
    assertStringIncludes(email.texto, trecho);
    assertEquals(email.html.includes("<a "), false);
    assertEquals(email.texto.includes("123456"), false);
    assertEquals(email.texto.includes("hash-atual-ficticio"), false);
    assertEquals(email.texto.includes("http"), false);
  });
}

for (const antigo of [undefined, "", "invalido", "a@example.com,b@example.com"]) {
  Deno.test(`Auth aviso de troca recusa old_email inválido: ${String(antigo)}`, () => {
    const corpo = payload("email_changed_notification");
    if (antigo === undefined) Reflect.deleteProperty(corpo.email_data, "old_email");
    else corpo.email_data.old_email = antigo;
    assertThrows(
      () => montarEmailsAuth(corpo, PROJETO, "Loja"),
      Error,
      "payload_invalido",
    );
  });
}

Deno.test("Auth HTML: nome, código e link escapados; assunto sem quebra de cabeçalho", () => {
  const corpo = payload("magiclink");
  corpo.email_data.token = '<img src=x onerror="1">&';
  const [email] = montarEmailsAuth(corpo, PROJETO, 'Loja <b>"&\r\nBcc: outra');
  assertStringIncludes(email.html, "&lt;b&gt;&quot;&amp;");
  assertStringIncludes(
    email.html,
    "&lt;img src=x onerror=&quot;1&quot;&gt;&amp;",
  );
  assertEquals(email.html.includes("<img"), false);
  assertEquals(email.html.includes("<b>"), false);
  assertEquals(/[\r\n]/.test(email.assunto), false);
  assertStringIncludes(email.html, "&amp;type=magiclink");
  assertEquals(email.html.includes('origem="email"'), false);
});

for (
  const [nome, alterar] of [
    [
      "tipo desconhecido",
      (c: any) => c.email_data.email_action_type = "nao_existe",
    ],
    [
      "tipo de protótipo",
      (c: any) => c.email_data.email_action_type = "constructor",
    ],
    ["sem destinatário", (c: any) => c.user.email = ""],
    [
      "destinatário injetado",
      (c: any) => c.user.email = "a@example.com,b@example.com",
    ],
    ["sem hash", (c: any) => c.email_data.token_hash = ""],
    ["sem código", (c: any) => c.email_data.token = ""],
    ["hash omitido", (c: any) => delete c.email_data.token_hash],
    ["código omitido", (c: any) => delete c.email_data.token],
    ["troca segura incompleta", (c: any) => {
      c.email_data.email_action_type = "email_change";
      c.email_data.token_hash_new = "hash-do-atual";
    }],
    ["sem novo endereço", (c: any) => {
      c.email_data.email_action_type = "email_change";
      c.user.new_email = "";
    }],
  ] as const
) {
  Deno.test(`Auth recusa ${nome} em vez de sucesso sem envio`, () => {
    const corpo = payload();
    alterar(corpo);
    assertThrows(() => montarEmailsAuth(corpo, PROJETO, "Loja"));
  });
}

Deno.test("Auth não aceita URL do projeto insegura ou com credencial", () => {
  for (
    const url of [
      "javascript:alert(1)",
      "http://externo.example.com",
      "https://u:senha@projeto.example.com",
    ]
  ) {
    assertThrows(() => montarEmailsAuth(payload(), url, "Loja"));
  }
});
