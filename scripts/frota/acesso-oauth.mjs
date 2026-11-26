// Acesso OAuth à conta da LOJISTA no Supabase (peças T4–T5 do L4b). A lojista
// toca "Autorizar" na tela do Supabase; a IKCOUS recebe um código, troca por
// access token (24 h) + refresh token (guardado no cofre local,
// scripts/frota/cofre-local.mjs, junto com o client_secret do app). O access
// token só vai ao cofre pelo tokenVigente (abaixo); os outros caminhos o
// devolvem só em memória.
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
//   renovarComTravaLonga -> para a sessão de publicação: trava a loja, renova
//               e SEGURA a trava até o liberar() (nenhuma outra renovação da
//               loja anda nesse meio, nem de outro processo). renovarDeNovo()
//               renova sob a mesma trava (o fechar da sessão usa para matar o
//               token que foi ao GitHub, se a renovação invalidar o anterior).
//   tokenVigente -> para o ensaio avulso do portão: reaproveita o access token
//               GUARDADO no cofre (token + vencimento) enquanto faltar MAIS que
//               minimoMs; senão renova e guarda o novo. Um ensaio por hora
//               gira o refresh uma vez por dia, não 24.
//
// O TOKEN GUARDADO nunca é mais velho que a última renovação da loja: TODA
// renovação (renovar, sessão, tokenVigente) o tira do cofre ANTES de pedir o
// token novo, e receber o descarta. Assim o cofre fica certo nos dois casos que
// a prova P6b decide: se o Supabase invalida o access token anterior a cada
// renovação, o guardado morreria ali (e já saiu); se não invalida, perde-se só
// um reaproveitamento. Se a limpeza não grava, nada é renovado.
//
// CONCORRÊNCIA: toda operação que lê-e-grava o cofre segura cofre.travar(slug).
// Duas renovações da mesma loja no MESMO processo esperam a mesma (um pedido
// só); vinda de OUTRO processo (trava em disco) é recusada com CofreTravado.
// A trava longa é a mesma trava: enquanto ela vive, tudo da loja recebe
// CofreTravado. Se o processo morrer segurando-a, ela fica órfã e a mensagem
// do CofreTravado diz qual arquivo apagar (cofre-local.mjs, TRAVA ÓRFÃ).
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

/** O token guardado pelo tokenVigente, se estiver bem formado; senão null
 * (guardado estranho é ignorado e substituído, nunca tranca a loja). */
function guardadoDo(reg) {
  const a = reg?.acesso;
  return a !== null &&
    typeof a === "object" &&
    opacoValido(a.token) &&
    Number.isFinite(a.expiraEm) &&
    a.expiraEm > 0
    ? a
    : null;
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
  const vigenteEmVoo = new Map();

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

  /**
   * O miolo de toda renovação, SEM trava (quem chama já a segura). Tira o
   * token guardado do cofre ANTES do pedido; grava o refresh novo (e, com
   * `guardar`, o token novo com o vencimento) ANTES de devolver.
   * @param {string} slug
   * @param {{ guardar?: boolean, lido?: object|null }} [opcoes]  `lido` evita
   *   ler o cofre de novo quando quem chama acabou de ler.
   */
  async function renovarSemTrava(slug, { guardar = false, lido } = {}) {
    const registro = lido === undefined ? await lerRegistro(cofre, slug) : lido;
    if (!registro?.refresh) {
      throw new ErroDeAcesso(
        `Acesso: a loja ${slug} não tem refresh no cofre (rode abrir/receber).`,
        { codigo: "NAO_CONECTADA" },
      );
    }
    const { acesso: guardadoVelho, ...reg } = registro;
    if (guardadoVelho !== undefined) {
      try {
        await cofre.gravar(slug, JSON.stringify(reg));
      } catch {
        throw new ErroDeAcesso(
          `Acesso: não consegui tirar do cofre o token guardado da loja ${slug}; nada foi renovado. Repita o comando.`,
          { codigo: "GUARDADO_NAO_SAIU" },
        );
      }
    }
    const r = await pedirToken(reg, {
      grant_type: "refresh_token",
      refresh_token: reg.refresh,
    });
    const girou = r.refresh !== undefined && r.refresh !== reg.refresh;
    const guarda = guardar && r.expiraEm !== null;
    if (girou || guarda) {
      const novo = girou ? { ...reg, refresh: r.refresh } : reg;
      try {
        await gravarRegistro(
          slug,
          guarda
            ? {
                ...novo,
                acesso: { token: r.accessToken, expiraEm: r.expiraEm },
              }
            : novo,
          `Acesso: o Supabase entregou um refresh NOVO para a loja ${slug}, mas o cofre não gravou; o antigo pode ter sido invalidado. Se a próxima renovação der SemAcesso, rode abrir/receber de novo.`,
        );
      } catch (e) {
        // Só o token guardado deixou de gravar: o refresh do cofre continua
        // o certo, o token vale, e o cofre fica sem guardado (a limpeza acima
        // já o tirou). O próximo tokenVigente renova.
        if (girou) throw e;
      }
    }
    return { accessToken: r.accessToken, expiraEm: r.expiraEm };
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

    async receber({ slug, colado }) {
      return comTrava(slug, async () => {
        const reg = await lerRegistro(cofre, slug);
        if (!reg?.pendente) {
          throw new ErroDeAcesso(
            `Acesso: a loja ${slug} não tem autorização pendente (rode abrir antes).`,
            { codigo: "SEM_PENDENTE" },
          );
        }
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
        // o token guardado de antes da autorização nova sai junto
        const { pendente: _usada, acesso: _guardado, ...resto } = reg;
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
      const p = comTrava(slug, () => renovarSemTrava(slug)).finally(() => {
        emVoo.delete(slug);
      });
      emVoo.set(slug, p);
      return p;
    },

    /**
     * Sessão de publicação: trava a loja, renova UMA vez e devolve o token com
     * a trava PRESA. Falha na renovação solta a trava e o erro sobe. O token
     * desta sessão não é guardado no cofre (ele vai ao GitHub).
     * @returns {Promise<{ accessToken: string, expiraEm: number|null,
     *   renovarDeNovo: () => Promise<{ accessToken: string, expiraEm: number|null }>,
     *   liberar: () => Promise<void> }>}
     */
    async renovarComTravaLonga({ slug }) {
      const soltarTrava = await cofre.travar(slug);
      let r;
      try {
        r = await renovarSemTrava(slug);
      } catch (e) {
        await soltarTrava().catch(() => {});
        throw e;
      }
      let solta = false;
      let deNovoEmVoo = null;
      let liberando = null;
      return {
        accessToken: r.accessToken,
        expiraEm: r.expiraEm,
        // Renova sob a MESMA trava; duas chamadas juntas esperam a mesma.
        renovarDeNovo() {
          if (solta) {
            return Promise.reject(
              new ErroDeAcesso(
                `Acesso: a sessão da loja ${slug} já soltou a trava; nada foi renovado.`,
                { codigo: "TRAVA_SOLTA" },
              ),
            );
          }
          deNovoEmVoo ??= renovarSemTrava(slug).finally(() => {
            deNovoEmVoo = null;
          });
          return deNovoEmVoo;
        },
        // Idempotente. Espera a renovação que estiver no ar: soltar antes
        // deixaria outro processo renovar com o refresh que ela vai trocar.
        liberar() {
          solta = true;
          liberando ??= (async () => {
            await deNovoEmVoo?.catch(() => {});
            await soltarTrava();
          })();
          return liberando;
        },
      };
    },

    /**
     * Ensaio avulso: o token guardado no cofre, se faltar MAIS que minimoMs
     * para ele vencer; senão renova e guarda o novo (token + vencimento).
     * Renovação sem prazo (expires_in ausente) não é guardada.
     * @returns {Promise<{ accessToken: string, expiraEm: number|null,
     *   reaproveitado: boolean }>}
     */
    tokenVigente({ slug, minimoMs }) {
      if (
        typeof minimoMs !== "number" ||
        !Number.isFinite(minimoMs) ||
        minimoMs <= 0
      ) {
        return Promise.reject(
          new ErroDeAcesso(
            "Acesso: tokenVigente precisa de um minimoMs positivo, em milissegundos.",
            { codigo: "PEDIDO_INVALIDO" },
          ),
        );
      }
      const chave = `${slug}\n${minimoMs}`;
      const andando = vigenteEmVoo.get(chave);
      if (andando) return andando;
      const p = comTrava(slug, async () => {
        const reg = await lerRegistro(cofre, slug);
        const g = guardadoDo(reg);
        if (reg?.refresh && g && g.expiraEm - agora() > minimoMs) {
          return {
            accessToken: g.token,
            expiraEm: g.expiraEm,
            reaproveitado: true,
          };
        }
        const r = await renovarSemTrava(slug, { guardar: true, lido: reg });
        return { ...r, reaproveitado: false };
      }).finally(() => {
        vigenteEmVoo.delete(chave);
      });
      vigenteEmVoo.set(chave, p);
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
