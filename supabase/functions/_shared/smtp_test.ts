import {
  assert,
  assertEquals,
  assertRejects,
} from "https://deno.land/std@0.177.0/testing/asserts.ts";
import { enviarEmail, ErroDeEnvio, verificarRemetente } from "./smtp.ts";

/**
 * O que esta suite prova, e o que ela NAO prova.
 *
 * PROVA: as recusas que acontecem ANTES de abrir conexao — remetente ausente ou
 * incompleto e destinatario vazio —, QUAL credencial chega ao transporte (por um
 * dubla do nodemailer), a segunda chance pelo ambiente quando o login do painel
 * e' recusado, e que nenhuma mensagem de erro carrega a senha.
 *
 * NAO PROVA: que a porta 465 sai, que o Gmail aceita a credencial, nem que a
 * biblioteca roda no runtime da edge function. Nada disso e' testavel aqui, e
 * fingir que e' seria pior que nao testar. Os tres foram medidos no ar em
 * 19/08/2026 com uma sonda descartavel: 465 abre em 48 ms, `verify()` autentica
 * e `npm:nodemailer@9.0.5` roda.
 */

const AMBIENTE = {
  origem: "ambiente",
  usuario: "ambiente@exemplo.com",
  senha: "senha-do-ambiente",
  motivo: null,
  reserva: null,
};
const SENHA_PAINEL = "senhadopainelfalsa";
const PAINEL = {
  origem: "painel",
  usuario: "painel@gmail.com",
  senha: SENHA_PAINEL,
  motivo: null,
  reserva: null,
};
const MENSAGEM = { para: "cliente@exemplo.com", assunto: "x", html: "<p>x</p>" };

/** Dublê do nodemailer: devolve, a cada createTransport, um transporte que
 * falha conforme o roteiro (um item por tentativa de envio). */
function nodemailerFalso(roteiro: Array<unknown | null> = []) {
  const visto = {
    configs: [] as any[],
    mensagens: [] as any[],
    fechou: 0,
    verificou: 0,
  };
  const carregarNodemailer = async () => ({
    default: {
      createTransport(config: unknown) {
        visto.configs.push(config);
        return {
          sendMail(mensagem: unknown) {
            visto.mensagens.push(mensagem);
            const falha = roteiro.shift();
            return falha ? Promise.reject(falha) : Promise.resolve({});
          },
          verify() {
            visto.verificou++;
            const falha = roteiro.shift();
            return falha ? Promise.reject(falha) : Promise.resolve(true);
          },
          close() {
            visto.fechou++;
          },
        };
      },
    },
  });
  return { visto, carregarNodemailer };
}

/** O erro do nodemailer carrega a configuração (e a senha) junto — o dublê também. */
function erroDoNodemailer(
  extra: Record<string, unknown>,
  senha = SENHA_PAINEL,
) {
  return Object.assign(new Error(`Invalid login: senha ${senha} recusada`), {
    config: { auth: { pass: senha } },
    ...extra,
  });
}

// ── Recusas antes de abrir conexão ──────────────────────────────────────────

Deno.test("enviarEmail: remetente 'nenhum' recusa ANTES de abrir conexao", async () => {
  const { visto, carregarNodemailer } = nodemailerFalso();
  await assertRejects(
    () =>
      enviarEmail(
        MENSAGEM,
        { origem: "nenhum", usuario: null, senha: null, motivo: "sem_registro", reserva: null },
        { carregarNodemailer },
      ),
    Error,
    "SMTP nao configurado",
  );
  assertEquals(visto.configs.length, 0);
});

Deno.test("enviarEmail: remetente incompleto (senha vazia) recusa — nao cai calado no ambiente", async () => {
  const user = Deno.env.get("SMTP_USER");
  const pass = Deno.env.get("SMTP_PASSWORD");
  Deno.env.set("SMTP_USER", "ambiente@exemplo.com");
  Deno.env.set("SMTP_PASSWORD", "senha-do-ambiente");
  const { visto, carregarNodemailer } = nodemailerFalso();
  try {
    await assertRejects(
      () => enviarEmail(MENSAGEM, { ...PAINEL, senha: "" }, { carregarNodemailer }),
      Error,
      "SMTP nao configurado",
    );
    assertEquals(visto.configs.length, 0);
  } finally {
    restaurar("SMTP_USER", user);
    restaurar("SMTP_PASSWORD", pass);
  }
});

Deno.test("enviarEmail: SEM remetente (chamador que esqueceu de resolver) lanca — nunca le o ambiente por conta propria", async () => {
  const user = Deno.env.get("SMTP_USER");
  const pass = Deno.env.get("SMTP_PASSWORD");
  Deno.env.set("SMTP_USER", "ambiente@exemplo.com");
  Deno.env.set("SMTP_PASSWORD", "senha-do-ambiente");
  const { visto, carregarNodemailer } = nodemailerFalso();
  try {
    for (const esquecido of [undefined, null, Promise.resolve(AMBIENTE)]) {
      await assertRejects(
        () => enviarEmail(MENSAGEM, esquecido as any, { carregarNodemailer }),
        Error,
        "remetente nao informado",
      );
    }
    assertEquals(visto.configs.length, 0);
  } finally {
    restaurar("SMTP_USER", user);
    restaurar("SMTP_PASSWORD", pass);
  }
});

Deno.test("enviarEmail: destinatario vazio recusa sem tocar a rede", async () => {
  const { visto, carregarNodemailer } = nodemailerFalso();
  await assertRejects(
    () => enviarEmail({ ...MENSAGEM, para: "" }, AMBIENTE, { carregarNodemailer }),
    Error,
    "destinatario vazio",
  );
  assertEquals(visto.configs.length, 0);
});

Deno.test("enviarEmail: a mensagem de erro nunca contem a senha", async () => {
  const SENHA = "senhasecretissima1234";
  try {
    await enviarEmail(
      { ...MENSAGEM, para: "" },
      { ...AMBIENTE, senha: SENHA },
    );
    throw new Error("deveria ter falhado com destinatario vazio");
  } catch (e) {
    assertEquals(String((e as Error).message).includes(SENHA), false);
  }
});

// ── O caminho do ambiente é o de sempre ─────────────────────────────────────

Deno.test("enviarEmail: remetente do AMBIENTE chega ao transporte exatamente como antes (host, porta, auth, from)", async () => {
  const { visto, carregarNodemailer } = nodemailerFalso();
  const resultado = await enviarEmail(MENSAGEM, AMBIENTE, { carregarNodemailer });
  assertEquals(resultado, { origem: "ambiente" });
  assertEquals(visto.configs, [
    {
      host: "smtp.gmail.com",
      port: 465,
      secure: true,
      auth: { user: "ambiente@exemplo.com", pass: "senha-do-ambiente" },
    },
  ]);
  assertEquals(visto.mensagens, [
    {
      from: "ambiente@exemplo.com",
      to: "cliente@exemplo.com",
      subject: "x",
      html: "<p>x</p>",
    },
  ]);
  assertEquals(visto.fechou, 1);
});

Deno.test("enviarEmail: remetente do PAINEL chega ao transporte com a credencial DELE", async () => {
  const { visto, carregarNodemailer } = nodemailerFalso();
  const resultado = await enviarEmail(MENSAGEM, PAINEL, { carregarNodemailer });
  assertEquals(resultado, { origem: "painel" });
  assertEquals(visto.configs[0].auth, { user: "painel@gmail.com", pass: SENHA_PAINEL });
  assertEquals(visto.mensagens[0].from, "painel@gmail.com");
});

// ── A falha é reembrulhada, sem texto e sem senha ───────────────────────────

Deno.test("enviarEmail: falha do transporte vira ErroDeEnvio — mensagem fixa SEM a senha, com os codigos de lista fechada", async () => {
  const { visto, carregarNodemailer } = nodemailerFalso([
    erroDoNodemailer({
      code: "EAUTH",
      responseCode: 535,
      response: `535-5.7.8 Username and Password not accepted ${SENHA_PAINEL}`,
    }),
  ]);
  let capturado: any = null;
  try {
    await enviarEmail(MENSAGEM, PAINEL, { carregarNodemailer });
  } catch (e) {
    capturado = e;
  }
  assert(capturado instanceof Error);
  assert(capturado instanceof ErroDeEnvio);
  assertEquals(capturado.message, "SMTP: envio recusado (EAUTH)");
  assertEquals(capturado.codigo, "EAUTH");
  assertEquals(capturado.respostaSmtp, 535);
  assertEquals(capturado.codigoEstendido, "5.7.8");
  assertEquals(JSON.stringify(capturado).includes(SENHA_PAINEL), false);
  assertEquals(String(capturado.stack).includes(SENHA_PAINEL), false);
  assertEquals(visto.fechou, 1, "o transporte fecha mesmo na falha");
});

Deno.test("ErroDeEnvio: so' sobe codigo estendido da lista curta; texto qualquer vira null", () => {
  const com = (response: unknown, responseCode?: unknown) =>
    new ErroDeEnvio({ code: "EAUTH", response, responseCode });
  assertEquals(com("534-5.7.9 Application-specific password required").codigoEstendido, "5.7.9");
  assertEquals(com("534-5.7.14 <https://accounts.google.com/...> Please log in").codigoEstendido, "5.7.14");
  assertEquals(com("550 5.4.5 Daily user sending limit exceeded").codigoEstendido, "5.4.5");
  assertEquals(com("550 5.1.1 usuario@x.com nao existe").codigoEstendido, null);
  assertEquals(com(undefined).codigoEstendido, null);
  assertEquals(com(12345).codigoEstendido, null);
  assertEquals(com("x", 535).respostaSmtp, 535);
  assertEquals(com("x", "535").respostaSmtp, null);
  assertEquals(com("x", 99).respostaSmtp, null);
  assertEquals(new ErroDeEnvio({}).message, "SMTP: envio recusado (sem codigo)");
  assertEquals(new ErroDeEnvio(undefined).codigo, null);
});

// ── Segunda chance pelo ambiente ────────────────────────────────────────────

const PAINEL_COM_RESERVA = {
  ...PAINEL,
  reserva: { usuario: "ambiente@exemplo.com", senha: "senha-do-ambiente" },
};

function remetenteComSaude(base: any) {
  const registros: any[] = [];
  return {
    registros,
    remetente: { ...base, registrarSaude: async (r: any) => void registros.push(r) },
  };
}

Deno.test("login do PAINEL recusado (EAUTH) com ambiente disponivel: tenta UMA vez pelo ambiente, e a recusa do painel fica registrada", async () => {
  const { visto, carregarNodemailer } = nodemailerFalso([
    erroDoNodemailer({ code: "EAUTH", responseCode: 535 }),
  ]);
  const { registros, remetente } = remetenteComSaude(PAINEL_COM_RESERVA);
  const resultado = await enviarEmail(MENSAGEM, remetente, { carregarNodemailer });
  assertEquals(resultado, { origem: "ambiente" });
  assertEquals(visto.configs.map((c) => c.auth.user), ["painel@gmail.com", "ambiente@exemplo.com"]);
  assertEquals(visto.mensagens[1].from, "ambiente@exemplo.com");
  assertEquals(registros, [
    { ok: false, origem: "painel", motivo: "senha_errada" },
    { ok: true, origem: "ambiente" },
  ]);
});

Deno.test("a segunda chance so' vale para login recusado: falha de rede do painel NAO tenta o ambiente", async () => {
  const { visto, carregarNodemailer } = nodemailerFalso([
    erroDoNodemailer({ code: "ETIMEDOUT" }),
  ]);
  await assertRejects(
    () => enviarEmail(MENSAGEM, PAINEL_COM_RESERVA, { carregarNodemailer }),
    ErroDeEnvio,
    "ETIMEDOUT",
  );
  assertEquals(visto.configs.length, 1);
});

Deno.test("sem reserva (ou remetente do proprio ambiente) o login recusado so' lanca — nada de laco", async () => {
  for (const remetente of [PAINEL, { ...AMBIENTE, reserva: { usuario: "x@y.com", senha: "z" } }]) {
    const { visto, carregarNodemailer } = nodemailerFalso([
      erroDoNodemailer({ code: "EAUTH", responseCode: 535 }),
    ]);
    await assertRejects(
      () => enviarEmail(MENSAGEM, remetente, { carregarNodemailer }),
      ErroDeEnvio,
    );
    assertEquals(visto.configs.length, 1);
  }
});

Deno.test("se a reserva tambem falhar, lanca o erro da reserva (so' duas tentativas) e registra as duas", async () => {
  const { visto, carregarNodemailer } = nodemailerFalso([
    erroDoNodemailer({ code: "EAUTH", responseCode: 535 }),
    erroDoNodemailer({ code: "ECONNECTION" }),
  ]);
  const { registros, remetente } = remetenteComSaude(PAINEL_COM_RESERVA);
  await assertRejects(
    () => enviarEmail(MENSAGEM, remetente, { carregarNodemailer }),
    ErroDeEnvio,
    "ECONNECTION",
  );
  assertEquals(visto.configs.length, 2);
  assertEquals(registros.map((r) => [r.origem, r.ok]), [["painel", false], ["ambiente", false]]);
});

Deno.test("a saude do envio e' melhor esforco: se registrar lanca, o envio segue e o resultado e' o mesmo", async () => {
  const { carregarNodemailer } = nodemailerFalso();
  const remetente = {
    ...AMBIENTE,
    registrarSaude: async () => {
      throw new Error("banco fora do ar");
    },
  };
  assertEquals(await enviarEmail(MENSAGEM, remetente, { carregarNodemailer }), {
    origem: "ambiente",
  });
});

// ── verificarRemetente (o login, sem mandar mensagem) ───────────────────────

Deno.test("verificarRemetente: confere o login com verify() e NAO manda mensagem", async () => {
  const { visto, carregarNodemailer } = nodemailerFalso();
  await verificarRemetente(PAINEL, { carregarNodemailer });
  assertEquals(visto.verificou, 1);
  assertEquals(visto.mensagens.length, 0);
  assertEquals(visto.configs[0].auth, { user: "painel@gmail.com", pass: SENHA_PAINEL });
  assertEquals(visto.fechou, 1);
});

Deno.test("verificarRemetente: login recusado vira ErroDeEnvio sem a senha", async () => {
  const { carregarNodemailer } = nodemailerFalso([
    erroDoNodemailer({ code: "EAUTH", responseCode: 534, response: "534-5.7.9 Application-specific password required" }),
  ]);
  let capturado: any = null;
  try {
    await verificarRemetente(PAINEL, { carregarNodemailer });
  } catch (e) {
    capturado = e;
  }
  assert(capturado instanceof ErroDeEnvio);
  assertEquals(capturado.codigoEstendido, "5.7.9");
  assertEquals(JSON.stringify(capturado).includes(SENHA_PAINEL), false);
});

Deno.test("verificarRemetente: remetente incompleto recusa sem abrir conexao", async () => {
  const { visto, carregarNodemailer } = nodemailerFalso();
  await assertRejects(
    () => verificarRemetente({ ...PAINEL, usuario: "" }, { carregarNodemailer }),
    Error,
    "SMTP nao configurado",
  );
  assertEquals(visto.configs.length, 0);
});

/** Devolve a variavel ao estado anterior. Ternario como comando e erro de lint. */
function restaurar(nome: string, valor: string | undefined): void {
  if (valor === undefined) {
    Deno.env.delete(nome);
  } else {
    Deno.env.set(nome, valor);
  }
}
