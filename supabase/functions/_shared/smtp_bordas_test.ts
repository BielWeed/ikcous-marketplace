// @ts-nocheck
/**
 * Caça por mutação (25/11/2026) em `smtp.ts` — o único lugar que fala com o
 * Gmail e que promete "a senha nunca sai daqui". 52 mutantes plantados; 16
 * sobreviviam a `smtp_test.ts` e `smtp-prazo_test.ts`. Seis ficam de fora: 3 são
 * equivalentes (`[245]`→`[25]` e `{1,3}`→`{1,2}` na leitura do código estendido,
 * porque a lista fechada só tem códigos 5.x.y de até 2 dígitos, e o
 * `instanceof ErroDeEnvio` que `enviarPor` já garante) e 3 só um socket real mostra
 * (`clearTimeout`, `socket.destroy()` e a fronteira `ms <= 0` do prazo). Os 10
 * restantes viram os casos de borda abaixo, sobre o que `ErroDeEnvio` deixa SUBIR
 * (campos de lista fechada, nunca o texto do transporte), o texto simples do
 * e-mail e a saúde do envio:
 *
 *   * `codigo` só sobe se for TEXTO (um número vira null, nunca um tipo solto);
 *   * `respostaSmtp` vale de 400 a 599, inclusive nas pontas (399 e 600 não);
 *   * o código estendido só é lido como PALAVRA: "15.7.8" não contém "5.7.8", e
 *     uma resposta que não é texto (lista, objeto) nunca vira texto para ser lida;
 *   * `remetente` que não é objeto (texto solto) é "remetente não informado",
 *     e não "SMTP não configurado" — a mensagem certa diz ao chamador o que corrigir.
 */
import {
  assertEquals,
  assertRejects,
} from "https://deno.land/std@0.177.0/testing/asserts.ts";
import { enviarEmail, ErroDeEnvio } from "./smtp.ts";

Deno.test("ErroDeEnvio: `codigo` só sobe quando é texto", () => {
  assertEquals(new ErroDeEnvio({ code: "EAUTH" }).codigo, "EAUTH");
  assertEquals(new ErroDeEnvio({ code: 535 }).codigo, null);
  assertEquals(new ErroDeEnvio({ code: { toString: () => "EAUTH" } }).codigo, null);
  assertEquals(new ErroDeEnvio({ code: null }).codigo, null);
});

Deno.test("ErroDeEnvio: `respostaSmtp` vale de 400 a 599, inclusive as pontas", () => {
  const com = (responseCode: unknown) => new ErroDeEnvio({ responseCode }).respostaSmtp;
  assertEquals(com(399), null);
  assertEquals(com(400), 400);
  assertEquals(com(535), 535);
  assertEquals(com(599), 599);
  assertEquals(com(600), null);
  assertEquals(com(535.5), null);
  assertEquals(com(Number.NaN), null);
});

Deno.test("ErroDeEnvio: o código estendido só vale como palavra inteira, e só em resposta que é texto", () => {
  const com = (response: unknown) => new ErroDeEnvio({ code: "EAUTH", response }).codigoEstendido;
  assertEquals(com("534 5.7.9 senha de app"), "5.7.9");
  // colado a outro número: não é o código 5.7.8
  assertEquals(com("250 build 15.7.8 ok"), null);
  assertEquals(com("250 5.7.89 estranho"), null);
  // resposta que não é texto nunca é lida como se fosse
  assertEquals(com(["534 5.7.9 senha de app"]), null);
  assertEquals(com({ toString: () => "534 5.7.9 senha de app" }), null);
});

Deno.test("enviarEmail: remetente que não é objeto (texto, número) é 'remetente nao informado'", async () => {
  for (const remetente of ["ambiente@exemplo.com", 42, true]) {
    await assertRejects(
      () =>
        enviarEmail(
          { para: "cliente@exemplo.com", assunto: "x", html: "<p>x</p>" },
          remetente,
          { carregarNodemailer: () => Promise.reject(new Error("não deveria abrir conexão")) },
        ),
      Error,
      "SMTP: remetente nao informado",
      String(remetente),
    );
  }
});

Deno.test("enviarEmail: o texto simples vai ao transporte quando existe, e a chave `text` nem aparece quando não existe", async () => {
  const enviadas: unknown[] = [];
  const carregarNodemailer = () =>
    Promise.resolve({
      default: {
        createTransport: () => ({
          sendMail: (mensagem: unknown) => {
            enviadas.push(mensagem);
            return Promise.resolve({});
          },
          close: () => {},
        }),
      },
    });
  const remetente = {
    origem: "ambiente",
    usuario: "ambiente@exemplo.com",
    senha: "senha-do-ambiente",
    reserva: null,
  };
  const base = { para: "cliente@exemplo.com", assunto: "Assunto", html: "<p>oi</p>" };
  await enviarEmail({ ...base, texto: "oi" }, remetente, { carregarNodemailer });
  await enviarEmail(base, remetente, { carregarNodemailer });
  assertEquals(enviadas, [
    { from: "ambiente@exemplo.com", to: "cliente@exemplo.com", subject: "Assunto", html: "<p>oi</p>", text: "oi" },
    { from: "ambiente@exemplo.com", to: "cliente@exemplo.com", subject: "Assunto", html: "<p>oi</p>" },
  ]);
  assertEquals("text" in (enviadas[1] as object), false);
});

Deno.test("saúde do envio: sucesso registra ok=true com a origem de quem enviou (painel e ambiente)", async () => {
  const carregarNodemailer = () =>
    Promise.resolve({
      default: {
        createTransport: () => ({
          sendMail: () => Promise.resolve({}),
          close: () => {},
        }),
      },
    });
  for (const origem of ["painel", "ambiente"]) {
    const registros: unknown[] = [];
    const remetente = {
      origem,
      usuario: "loja@exemplo.com",
      senha: "senha-de-teste",
      reserva: null,
      registrarSaude: (r: unknown) => {
        registros.push(r);
        return Promise.resolve();
      },
    };
    const r = await enviarEmail(
      { para: "cliente@exemplo.com", assunto: "x", html: "<p>x</p>" },
      remetente,
      { carregarNodemailer },
    );
    assertEquals(r, { origem });
    assertEquals(registros, [{ ok: true, origem }]);
  }
});
