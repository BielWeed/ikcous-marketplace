// @ts-nocheck
/**
 * O unico lugar do projeto que fala SMTP.
 *
 * PORTA 465, E NAO 587
 *   Medido na propria edge function em 19/08/2026, com uma sonda descartavel:
 *   a 465 abre em 48 ms e `verify()` autentica com a senha de aplicativo do
 *   Gmail. A doc do Supabase declara que "outgoing connections to ports 25 and
 *   587 are not allowed" — e a 587 e' justamente a porta que o painel de Auth
 *   usa e que funciona LA, porque o GoTrue nao e' a edge function. Confundir os
 *   dois lados ja custou tempo antes.
 *
 *   (No mesmo teste o TCP da 587 tambem abriu, contra a doc. NAO tome isso como
 *   permissao: so' o TCP foi medido, nunca a autenticacao por ela. O que esta'
 *   provado ponta a ponta e' a 465.)
 *
 * npm:nodemailer@9.0.5
 *   Tambem medido na mesma sonda: roda neste runtime, importado por
 *   especificador `npm:`, sem gambiarra. O relato de que "nodemailer nao roda
 *   em edge function" vale para Deno Deploy, que NAO e' o mesmo produto.
 *
 * A SENHA NUNCA SAI DAQUI
 *   Nem em log, nem em mensagem de erro, nem em resposta HTTP. O erro do
 *   transporte e' reembrulhado antes de subir, porque ele carrega a config
 *   inteira junto — e config inclui a senha. O reembrulho (`ErroDeEnvio`) leva
 *   so' tres coisas de lista fechada para quem precisa explicar a falha: o
 *   codigo do transporte, o codigo numerico da resposta SMTP e o codigo
 *   estendido (5.7.8...) quando ele esta numa lista curta. Nunca o texto.
 *
 * QUEM ENVIA VEM RESOLVIDO (14/10/2026)
 *   `enviarEmail` EXIGE o remetente que `resolverRemetente`
 *   (`_shared/email-da-loja.ts`) devolve — o Gmail que a lojista cadastrou no
 *   painel ou, na falta dele, os segredos SMTP_USER/SMTP_PASSWORD do ambiente.
 *   O antigo `remetenteConfigurado()` sincrono foi APAGADO: um chamador que
 *   esquecesse o `await` do resolvedor testaria `!Promise`.
 *
 * POR QUE LANCA EM VEZ DE DEVOLVER `false`
 *   Quem chama precisa da causa para decidir o que dizer na tela. Engolir a
 *   excecao aqui recriaria o defeito que esta inversao existe para matar: a
 *   promessa de entrega que ninguem sabe se aconteceu (#86).
 *
 * POR QUE O IMPORT E' TARDIO, E NAO NO TOPO
 *   `npm run test:edge` roda `deno test` sobre esta pasta numa maquina que tem
 *   node_modules do npm. Vendo node_modules, o Deno se recusa a resolver
 *   `npm:` sozinho e o import ESTATICO derruba a suite inteira com
 *   "Could not find a matching package" — no CI tambem, que roda `npm ci`
 *   antes. Medido em 19/08/2026.
 *
 *   Import dentro da funcao resolve isso sem trocar o especificador `npm:`,
 *   que e' o unico que foi PROVADO no runtime da edge function. De quebra, loja
 *   com SMTP nao configurado nunca paga o custo de carregar a biblioteca.
 *
 *   O preco, dito na cara: nenhum teste desta suite chega a carregar o
 *   nodemailer, entao o CI nao prova que ele carrega. Quem provou foi a sonda,
 *   no ar. Se um dia o import quebrar, o sintoma aparece no envio, nao no CI.
 */

import { connect } from "node:net";
import { classificarFalhaDeEnvio } from "./email-da-loja.ts";

const HOST = "smtp.gmail.com";
const PORTA = 465;

/** Os unicos codigos estendidos que sobem (lista FECHADA; ver o cabecalho). */
const CODIGOS_ESTENDIDOS = new Set(["5.7.8", "5.7.9", "5.7.14", "5.4.5"]);

/**
 * A falha do transporte, sem o texto original. A mensagem e' FIXA (a mesma de
 * sempre: `SMTP: envio recusado (<codigo>)`); o resto sao campos tipados que
 * `classificarFalhaDeEnvio` transforma numa causa que a lojista entende.
 */
export class ErroDeEnvio extends Error {
  constructor(e) {
    super(`SMTP: envio recusado (${e?.code ?? "sem codigo"})`);
    this.codigo = typeof e?.code === "string" ? e.code : null;
    this.respostaSmtp =
      Number.isInteger(e?.responseCode) && e.responseCode >= 400 &&
        e.responseCode < 600
        ? e.responseCode
        : null;
    const achado = /\b([245]\.\d{1,3}\.\d{1,3})\b/.exec(
      typeof e?.response === "string" ? e.response : "",
    );
    this.codigoEstendido = achado && CODIGOS_ESTENDIDOS.has(achado[1])
      ? achado[1]
      : null;
  }
}

/** Quem envia tem de vir de `resolverRemetente` — e ter usuario e senha. */
function conferirRemetente(remetente) {
  // `then` presente = Promise: o chamador esqueceu o `await` do resolvedor.
  if (!remetente || typeof remetente !== "object" || typeof remetente.then === "function") {
    throw new Error("SMTP: remetente nao informado (use resolverRemetente)");
  }
  const origemValida = remetente.origem === "painel" ||
    remetente.origem === "ambiente";
  if (!origemValida || !remetente.usuario || !remetente.senha) {
    throw new Error("SMTP nao configurado: falta SMTP_USER ou SMTP_PASSWORD");
  }
}

async function abrirTransporte({ usuario, senha }, deps, opcoesDoPrazo?) {
  // Ver o cabecalho: tardio de proposito, para a suite de testes nao morrer na
  // resolucao do especificador `npm:`.
  const { default: nodemailer } = await (deps?.carregarNodemailer
    ? deps.carregarNodemailer()
    : import("npm:nodemailer@9.0.5"));
  return nodemailer.createTransport({
    host: HOST,
    port: PORTA,
    secure: true,
    auth: { user: usuario, pass: senha },
    ...opcoesDoPrazo?.(),
  });
}

async function enviarPor(credencial, { para, assunto, html, texto }, deps) {
  let socket;
  let relogio;
  let transporter;
  const prazo = deps?.prazoFinalMs;
  const erroDePrazo = () => Object.assign(new Error("SMTP: prazo esgotado"), { code: "ETIMEDOUT" });
  const restante = () => {
    const ms = Math.floor(prazo - performance.now());
    if (!Number.isFinite(ms) || ms <= 0) throw erroDePrazo();
    return ms;
  };
  // Opt-in do hook: pedidos existentes mantêm seus timeouts e sua reserva.
  const opcoesDoPrazo = prazo === undefined ? undefined : () => ({
    connectionTimeout: restante(),
    greetingTimeout: restante(),
    socketTimeout: restante(),
    dnsTimeout: restante(),
    // close() do transporte sem pool NÃO encerra envios ativos. O socket é
    // nosso para poder destruí-lo no prazo TOTAL, mesmo com bytes pingando.
    // Nodemailer envolve este TCP em TLS quando secure=true (porta 465).
    getSocket(opcoes, callback) {
      let devolveu = false;
      const devolver = (erro, resultado?) => {
        if (devolveu) return;
        devolveu = true;
        callback(erro, resultado);
      };
      try {
        const ms = restante();
        socket = connect({ host: opcoes.host, port: opcoes.port });
        relogio = setTimeout(() => socket.destroy(erroDePrazo()), ms);
        socket.once("error", (erro) => devolver(erro));
        socket.once("connect", () => devolver(null, { connection: socket }));
      } catch (erro) {
        devolver(erro);
      }
    },
  });
  try {
    // Reconfere o prazo DEPOIS do import tardio: nunca inicia envio atrasado.
    transporter = await abrirTransporte(credencial, deps, opcoesDoPrazo);
    await transporter.sendMail({
      from: credencial.usuario,
      to: para,
      subject: assunto,
      html,
      ...(texto === undefined ? {} : { text: texto }),
    });
  } catch (e) {
    // Reembrulha: o erro do nodemailer carrega o objeto de configuracao, e com
    // ele a senha, para o log de quem chamar.
    throw new ErroDeEnvio(e);
  } finally {
    clearTimeout(relogio);
    socket?.destroy();
    transporter?.close?.();
  }
}

/** Saude do envio: melhor esforco, nunca lanca e nunca atrasa o envio por erro dela. */
async function registrar(remetente, resultado) {
  try {
    await remetente.registrarSaude?.(resultado);
  } catch {
    // nada: a saude e' um aviso, nao pode virar outra falha
  }
}

/**
 * Envia UM e-mail. `remetente` e' o que `resolverRemetente` devolveu.
 *
 * Remetente do PAINEL recusado no login (EAUTH: a lojista trocou a senha da
 * conta e o Google revogou a senha de app, por exemplo) tenta UMA vez o do
 * ambiente, se ele existir: o que funcionava antes do painel nao para por
 * causa dele. A recusa do painel fica na saude do envio mesmo assim.
 *
 * Devolve `{ origem }` — quem de fato enviou.
 */
export async function enviarEmail(
  mensagem: { para: string; assunto: string; html: string; texto?: string },
  remetente,
  deps?,
): Promise<{ origem: string }> {
  conferirRemetente(remetente);
  if (!mensagem?.para) {
    throw new Error("SMTP: destinatario vazio");
  }
  try {
    await enviarPor(remetente, mensagem, deps);
    await registrar(remetente, { ok: true, origem: remetente.origem });
    return { origem: remetente.origem };
  } catch (erro) {
    await registrar(remetente, {
      ok: false,
      origem: remetente.origem,
      motivo: classificarFalhaDeEnvio(erro),
    });
    const reserva = remetente.origem === "painel" ? remetente.reserva : null;
    if (!(erro instanceof ErroDeEnvio) || erro.codigo !== "EAUTH" || !reserva) {
      throw erro;
    }
    try {
      await enviarPor(reserva, mensagem, deps);
    } catch (erroDaReserva) {
      await registrar(remetente, {
        ok: false,
        origem: "ambiente",
        motivo: classificarFalhaDeEnvio(erroDaReserva),
      });
      throw erroDaReserva;
    }
    await registrar(remetente, { ok: true, origem: "ambiente" });
    return { origem: "ambiente" };
  }
}

/**
 * Confere o login SEM mandar mensagem (`transporter.verify()`: conecta e
 * autentica). E' o que o `salvar` do painel faz antes de gravar a senha nova.
 * Lanca `ErroDeEnvio` na falha — nunca com o texto original.
 */
export async function verificarRemetente(remetente, deps?): Promise<void> {
  conferirRemetente(remetente);
  const transporter = await abrirTransporte(remetente, deps);
  try {
    await transporter.verify();
  } catch (e) {
    throw new ErroDeEnvio(e);
  } finally {
    transporter.close?.();
  }
}
