// Acesso OAuth à conta da LOJISTA no Supabase (peças T4–T5 do L4b). A lojista
// toca "Autorizar" na tela do Supabase; a IKCOUS recebe um código, troca por
// access token (24 h, só em memória) + refresh token (guardado no cofre local,
// scripts/frota/cofre-local.mjs, junto com o client_secret do app).
//
// FLUXO (cada passo é um comando separado do nova-loja.mjs):
//   abrir    -> gera PKCE (S256) e state de 128 bits, guarda no cofre o
//               client_secret e a autorização PENDENTE (state + verificador) e
//               devolve o link. O link nunca leva segredo nem verificador.
//   receber  -> lê o que o dono colou (URL inteira ou só o código), confere o
//               state com o guardado, troca o código pelo token e grava o
//               refresh no cofre ANTES de devolver o access token.
//   renovar  -> troca o refresh pelo access token; se vier refresh NOVO, ele é
//               gravado no cofre ANTES do access token ser devolvido (se o
//               Supabase gira o refresh e o cofre não grava, a loja perderia o
//               acesso em silêncio). Sem refresh na resposta, fica o antigo.
//   revogar  -> POST /v1/oauth/revoke; só apaga o cofre se o Supabase aceitou
//               ou disse que o refresh já não vale (regra em ERROS_JA_REVOGADO).
//
// CONCORRÊNCIA: toda operação que lê-e-grava o cofre segura cofre.travar(slug).
// Duas renovações da mesma loja no MESMO processo esperam a mesma (um pedido
// só); vinda de OUTRO processo (trava em disco) é recusada com CofreTravado.
//
// SEGREDOS: nenhuma mensagem de erro carrega token, refresh, client_secret,
// código, verificador ou state, nem o corpo cru das respostas. Prazo estourado
// = ESTADO_DESCONHECIDO (o Supabase pode ter girado o refresh).
//
// SÓ O CÓDIGO COLADO, SEM STATE: aceito de propósito (a página /autorizado
// mostra só o código). Quem protege esse caminho é o PKCE: um código emitido
// para outro verificador é recusado pelo Supabase na troca.
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import {
  ESTADO_DESCONHECIDO,
  ErroDaGestao,
  SemAcesso,
  buscarComPrazo,
} from "./supabase-gestao.mjs";

export const URL_AUTORIZAR = "https://api.supabase.com/v1/oauth/authorize";
export const URL_TOKEN = "https://api.supabase.com/v1/oauth/token";
export const URL_REVOGAR = "https://api.supabase.com/v1/oauth/revoke";
const PRAZO_PADRAO_MS = 30_000;
const VERSAO_REGISTRO = 1;

// REVOGAR UM REFRESH QUE JÁ NÃO VALE. O RFC 7009 §2.2 manda o servidor
// responder 200 para token inválido ("the client cannot handle such an error
// in a reasonable way"), e 200/204 já apaga o cofre. A doc do Supabase
// (POST /v1/oauth/revoke, beta, consultada em 26/11/2026) só lista 204, 401,
// 403 e 429; 400/404 não estão documentados. Se ainda assim vier 400 ou 404
// com um destes códigos no campo "error", o refresh guardado já está morto:
// não há o que revogar e guardá-lo só deixa o cofre preso para sempre.
//   invalid_grant            RFC 6749 §5.2: grant inválido, expirado ou revogado
//   refresh_token_not_found  código do Supabase Auth: refresh desconhecido
// Fora disso (401/403: credencial do app; 429/5xx/rede/prazo: falha no
// caminho; invalid_client/invalid_request/outro 4xx: pedido nosso errado) o
// cofre FICA, porque a falha pode ser nossa e o refresh ainda valer.
const ERROS_JA_REVOGADO = new Set(["invalid_grant", "refresh_token_not_found"]);

export class ErroDeAcesso extends ErroDaGestao {
  constructor(mensagem, extra = {}) {
    super(mensagem, extra);
    this.name = "ErroDeAcesso";
  }
}

const b64url = (buf) =>
  Buffer.from(buf)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

/** Texto visível ASCII, sem espaço: o que cabe em cabeçalho e em formulário. */
function opacoValido(t, max = 4096) {
  return (
    typeof t === "string" &&
    t.length > 0 &&
    t.length <= max &&
    /^[\x21-\x7e]+$/.test(t)
  );
}

function bytesAleatorios(aleatorio, n) {
  const b = aleatorio(n);
  if (!b || b.length !== n) {
    throw new ErroDeAcesso(
      "Acesso: o gerador aleatório não devolveu os bytes pedidos.",
    );
  }
  return b;
}

/** PKCE (RFC 7636): verificador de 32 bytes aleatórios, desafio S256. */
export function gerarPkce(aleatorio = randomBytes) {
  const verificador = b64url(bytesAleatorios(aleatorio, 32));
  const desafio = b64url(createHash("sha256").update(verificador).digest());
  return { verificador, desafio };
}

function stateIgual(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

const RE_CODIGO = /^[A-Za-z0-9._~-]{8,512}$/;

/**
 * O que o dono colou depois de a lojista autorizar: a URL inteira de retorno
 * (…?code=…&state=…), só a query, ou só o código. Com state presente, ele tem
 * de ser IGUAL ao guardado. Devolve o código.
 */
export function lerCodigoColado(texto, stateGuardado) {
  if (typeof stateGuardado !== "string" || stateGuardado === "") {
    throw new ErroDeAcesso(
      "Acesso: não há autorização pendente para esta loja (rode o passo abrir antes).",
      { codigo: "SEM_PENDENTE" },
    );
  }
  if (typeof texto !== "string" || texto.trim() === "") {
    throw new ErroDeAcesso("Acesso: o código colado está vazio.", {
      codigo: "CODIGO_INVALIDO",
    });
  }
  const t = texto.trim();
  let params = null;
  if (/^https?:\/\//i.test(t)) {
    try {
      params = new URL(t).searchParams;
    } catch {
      throw new ErroDeAcesso(
        "Acesso: o endereço colado não é uma URL válida.",
        {
          codigo: "CODIGO_INVALIDO",
        },
      );
    }
  } else if (/[?&=#]/.test(t)) {
    params = new URLSearchParams(t.replace(/^[?#]/, ""));
  }
  let codigo = t;
  if (params) {
    if (params.has("error")) {
      const motivo = params.get("error");
      throw new ErroDeAcesso(
        `Acesso: a autorização não foi concedida${/^[a-z_]{1,40}$/.test(motivo ?? "") ? ` (${motivo})` : ""}. Peça para a lojista tocar em Autorizar de novo.`,
        { codigo: "AUTORIZACAO_RECUSADA" },
      );
    }
    const state = params.get("state");
    if (state === null || state === "") {
      throw new ErroDeAcesso(
        "Acesso: o endereço colado não tem o state; cole o endereço inteiro ou só o código.",
        { codigo: "STATE_DIVERGENTE" },
      );
    }
    if (!stateIgual(state, stateGuardado)) {
      throw new ErroDeAcesso(
        "Acesso: o state do endereço colado não é o desta autorização (link de outra tentativa ou de outra loja). Rode abrir de novo.",
        { codigo: "STATE_DIVERGENTE" },
      );
    }
    codigo = params.get("code") ?? "";
  }
  if (!RE_CODIGO.test(codigo)) {
    throw new ErroDeAcesso(
      "Acesso: o código colado não tem o formato esperado (vazio, curto, longo ou com caractere estranho).",
      { codigo: "CODIGO_INVALIDO" },
    );
  }
  return codigo;
}

function exigirApp({ clientId, clientSecret, redirectUri }) {
  if (typeof clientId !== "string" || !/^[A-Za-z0-9-]{8,100}$/.test(clientId)) {
    throw new ErroDeAcesso("Acesso: client_id inválido.", {
      codigo: "PEDIDO_INVALIDO",
    });
  }
  if (!opacoValido(clientSecret)) {
    throw new ErroDeAcesso(
      "Acesso: client_secret vazio ou com caractere proibido.",
      { codigo: "PEDIDO_INVALIDO" },
    );
  }
  let u;
  try {
    u = new URL(redirectUri);
  } catch {
    throw new ErroDeAcesso("Acesso: redirect_uri não é URL.", {
      codigo: "PEDIDO_INVALIDO",
    });
  }
  const local = u.hostname === "localhost" || u.hostname === "127.0.0.1";
  const protocoloOk =
    u.protocol === "https:" || (u.protocol === "http:" && local);
  if (
    !protocoloOk ||
    String(redirectUri).includes("#") ||
    u.username ||
    u.password
  ) {
    throw new ErroDeAcesso(
      "Acesso: redirect_uri tem de ser https (ou http só em localhost), sem # e sem usuário.",
      { codigo: "PEDIDO_INVALIDO" },
    );
  }
}

function jsonOuNull(texto) {
  try {
    return JSON.parse(texto);
  } catch {
    return null;
  }
}

/** O campo "error" do corpo OAuth, só se for um código simples (nunca o
 * error_description, que pode ecoar o que foi enviado). */
function erroOAuthDo(corpo) {
  return typeof corpo?.error === "string" && /^[a-z_]{1,40}$/.test(corpo.error)
    ? corpo.error
    : undefined;
}

/** Lê e valida o registro da loja no cofre; null = nada guardado. */
async function lerRegistro(cofre, slug) {
  const texto = await cofre.ler(slug);
  if (texto === null) return null;
  let r;
  try {
    r = JSON.parse(texto);
  } catch {
    r = null;
  }
  const ok =
    r !== null &&
    typeof r === "object" &&
    r.versao === VERSAO_REGISTRO &&
    typeof r.clientId === "string" &&
    opacoValido(r.clientSecret) &&
    typeof r.redirectUri === "string" &&
    (r.refresh === undefined || opacoValido(r.refresh));
  if (!ok) {
    throw new ErroDeAcesso(
      `Acesso: o registro da loja ${slug} no cofre não está no formato esperado.`,
      { codigo: "REGISTRO_INVALIDO" },
    );
  }
  return r;
}

/**
 * @param {{
 *   cofre: { ler: Function, gravar: Function, apagar: Function, travar: Function },
 *   fetch?: typeof fetch,
 *   prazoMs?: number,
 *   aleatorio?: (n: number) => Uint8Array,
 *   agora?: () => number,
 * }} opcoes
 */
export function criarAcessoOAuth({
  cofre,
  fetch: fetchFn = globalThis.fetch,
  prazoMs = PRAZO_PADRAO_MS,
  aleatorio = randomBytes,
  agora = Date.now,
} = {}) {
  const emVoo = new Map();

  async function comTrava(slug, fn) {
    const liberar = await cofre.travar(slug);
    try {
      return await fn();
    } finally {
      await liberar();
    }
  }

  /** POST /v1/oauth/token. Devolve { accessToken, refresh?, expiraEm }. */
  async function pedirToken(reg, campos) {
    const onde = "POST /v1/oauth/token";
    const basic = Buffer.from(`${reg.clientId}:${reg.clientSecret}`).toString(
      "base64",
    );
    const { status, texto } = await buscarComPrazo(
      fetchFn,
      URL_TOKEN,
      {
        method: "POST",
        redirect: "manual",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          accept: "application/json",
          authorization: `Basic ${basic}`,
        },
        body: new URLSearchParams(campos).toString(),
      },
      prazoMs,
      onde,
    );
    const corpo = jsonOuNull(texto);
    const erroOAuth = erroOAuthDo(corpo);
    if (
      status === 401 ||
      status === 403 ||
      (status === 400 && erroOAuth === "invalid_grant")
    ) {
      throw new SemAcesso(
        `Acesso: ${onde} respondeu HTTP ${status}${erroOAuth ? ` (${erroOAuth})` : ""}: a autorização da lojista caiu ou foi revogada. Rode abrir/receber de novo.`,
        { status },
      );
    }
    if (status !== 200) {
      throw new ErroDeAcesso(
        `Acesso: ${onde} respondeu HTTP ${status}${erroOAuth ? ` (${erroOAuth})` : ""}.`,
        { codigo: "HTTP", status },
      );
    }
    if (corpo === null || typeof corpo !== "object") {
      throw new ErroDaGestao(
        `Acesso: ${onde} respondeu 200 com corpo que não é JSON. O refresh pode ter sido trocado (ESTADO_DESCONHECIDO).`,
        { codigo: ESTADO_DESCONHECIDO, status },
      );
    }
    if (!opacoValido(corpo.access_token)) {
      throw new ErroDeAcesso(
        `Acesso: ${onde} respondeu 200 sem access_token válido.`,
        {
          codigo: "RESPOSTA_INVALIDA",
          status,
        },
      );
    }
    if (
      corpo.refresh_token !== undefined &&
      !opacoValido(corpo.refresh_token)
    ) {
      throw new ErroDeAcesso(
        `Acesso: ${onde} respondeu 200 com refresh_token inválido; o cofre ficou como estava, mas o refresh antigo pode ter sido invalidado.`,
        { codigo: "RESPOSTA_INVALIDA", status },
      );
    }
    const segundos = Number(corpo.expires_in);
    return {
      accessToken: corpo.access_token,
      refresh: corpo.refresh_token,
      expiraEm:
        Number.isFinite(segundos) && segundos > 0
          ? agora() + segundos * 1000
          : null,
    };
  }

  async function gravarRegistro(slug, reg, falhaMsg) {
    try {
      await cofre.gravar(slug, JSON.stringify(reg));
    } catch {
      throw new ErroDeAcesso(falhaMsg, { codigo: "COFRE_NAO_GRAVOU" });
    }
  }

  return {
    async abrir({ slug, clientId, clientSecret, redirectUri }) {
      exigirApp({ clientId, clientSecret, redirectUri });
      return comTrava(slug, async () => {
        // registro ilegível é substituído; falha do PRÓPRIO cofre (DPAPI) sobe
        const atual = await lerRegistro(cofre, slug).catch((e) => {
          if (e instanceof ErroDeAcesso) return null;
          throw e;
        });
        const { verificador, desafio } = gerarPkce(aleatorio);
        const state = b64url(bytesAleatorios(aleatorio, 16));
        // O refresh é do app (client_id) que o emitiu: com outro app ou outro
        // retorno, a loja tem de autorizar de novo e o refresh antigo, usado
        // com as credenciais novas, só daria SemAcesso (e travaria o revogar).
        // Mesmo app com só o client_secret trocado: o refresh segue valendo.
        const mesmoApp =
          atual?.clientId === clientId && atual?.redirectUri === redirectUri;
        const reg = {
          versao: VERSAO_REGISTRO,
          clientId,
          clientSecret,
          redirectUri,
          ...(mesmoApp && atual.refresh ? { refresh: atual.refresh } : {}),
          pendente: { state, verificador, criadoEm: agora() },
        };
        await gravarRegistro(
          slug,
          reg,
          `Acesso: o cofre não gravou a autorização pendente da loja ${slug}.`,
        );
        const url = `${URL_AUTORIZAR}?${new URLSearchParams({
          client_id: clientId,
          redirect_uri: redirectUri,
          response_type: "code",
          state,
          code_challenge: desafio,
          code_challenge_method: "S256",
        })}`;
        return { url };
      });
    },

    /**
     * Opcionais (o trocar-dono do nova-loja.mjs, T3 de 26/11), ambos dentro
     * da trava do cofre e sem nada gravado antes deles:
     *  - conferirPendente(pendente): ANTES de o código ser trocado (recebe
     *    { state, verificador, criadoEm }; não pode imprimir nada disso);
     *  - conferirAcesso(accessToken): depois da troca e ANTES de o refresh
     *    novo ir para o cofre; se lançar, o cofre fica como estava (o refresh
     *    antigo segue lá). Não pode usar o renovar (a trava é a mesma).
     * O que eles lançam sobe como veio.
     */
    async receber({ slug, colado, conferirPendente, conferirAcesso }) {
      return comTrava(slug, async () => {
        const reg = await lerRegistro(cofre, slug);
        if (!reg?.pendente) {
          throw new ErroDeAcesso(
            `Acesso: a loja ${slug} não tem autorização pendente (rode abrir antes).`,
            { codigo: "SEM_PENDENTE" },
          );
        }
        if (conferirPendente) await conferirPendente({ ...reg.pendente });
        const codigo = lerCodigoColado(colado, reg.pendente.state);
        const r = await pedirToken(reg, {
          grant_type: "authorization_code",
          code: codigo,
          redirect_uri: reg.redirectUri,
          code_verifier: reg.pendente.verificador,
        });
        if (r.refresh === undefined) {
          throw new ErroDeAcesso(
            "Acesso: o Supabase não devolveu refresh_token; sem ele a loja não renova o acesso. Rode abrir de novo.",
            { codigo: "SEM_REFRESH" },
          );
        }
        if (conferirAcesso) await conferirAcesso(r.accessToken);
        const { pendente: _usada, ...resto } = reg;
        await gravarRegistro(
          slug,
          { ...resto, refresh: r.refresh },
          `Acesso: o Supabase autorizou, mas o cofre não gravou o refresh da loja ${slug}. Rode abrir/receber de novo.`,
        );
        return { accessToken: r.accessToken, expiraEm: r.expiraEm };
      });
    },

    renovar({ slug }) {
      const andando = emVoo.get(slug);
      if (andando) return andando;
      const p = comTrava(slug, async () => {
        const reg = await lerRegistro(cofre, slug);
        if (!reg?.refresh) {
          throw new ErroDeAcesso(
            `Acesso: a loja ${slug} não tem refresh no cofre (rode abrir/receber).`,
            { codigo: "NAO_CONECTADA" },
          );
        }
        const r = await pedirToken(reg, {
          grant_type: "refresh_token",
          refresh_token: reg.refresh,
        });
        if (r.refresh !== undefined && r.refresh !== reg.refresh) {
          await gravarRegistro(
            slug,
            { ...reg, refresh: r.refresh },
            `Acesso: o Supabase entregou um refresh NOVO para a loja ${slug}, mas o cofre não gravou; o antigo pode ter sido invalidado. Se a próxima renovação der SemAcesso, rode abrir/receber de novo.`,
          );
        }
        return { accessToken: r.accessToken, expiraEm: r.expiraEm };
      }).finally(() => {
        emVoo.delete(slug);
      });
      emVoo.set(slug, p);
      return p;
    },

    async revogar({ slug }) {
      return comTrava(slug, async () => {
        const reg = await lerRegistro(cofre, slug);
        if (!reg) return { revogado: false };
        if (!reg.refresh) {
          await cofre.apagar(slug);
          return { revogado: false };
        }
        const onde = "POST /v1/oauth/revoke";
        const { status, texto } = await buscarComPrazo(
          fetchFn,
          URL_REVOGAR,
          {
            method: "POST",
            redirect: "manual",
            headers: {
              "content-type": "application/json",
              accept: "application/json",
            },
            body: JSON.stringify({
              client_id: reg.clientId,
              client_secret: reg.clientSecret,
              refresh_token: reg.refresh,
            }),
          },
          prazoMs,
          onde,
        );
        if (status === 401 || status === 403) {
          throw new SemAcesso(
            `Acesso: ${onde} respondeu HTTP ${status}; o cofre da loja ${slug} ficou como estava.`,
            { status },
          );
        }
        if (
          (status === 400 || status === 404) &&
          ERROS_JA_REVOGADO.has(erroOAuthDo(jsonOuNull(texto)))
        ) {
          await cofre.apagar(slug);
          return { revogado: true, jaEstavaRevogado: true };
        }
        if (status !== 200 && status !== 204) {
          throw new ErroDeAcesso(
            `Acesso: ${onde} respondeu HTTP ${status}; o cofre da loja ${slug} ficou como estava.`,
            { codigo: "HTTP", status },
          );
        }
        await cofre.apagar(slug);
        return { revogado: true };
      });
    },
  };
}
