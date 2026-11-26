// Cliente MÍNIMO da Management API do Supabase (https://api.supabase.com/v1/...),
// peça T2 do L4b ("ligar loja nova com um comando"). Quem usa: o instalador do
// banco, os segredos e o orquestrador nova-loja.mjs, sempre com o access token
// OAuth da conta da LOJISTA (scripts/frota/acesso-oauth.mjs).
//
// O QUE ESTE ARQUIVO GARANTE (e tests/frota_nova_loja_cliente_test.ts trava):
//  - o host é fixo (API_GESTAO) e o caminho sai de um MODELO fixo (MODELOS),
//    com a lista de métodos que cada modelo aceita. Quem chama escolhe o nome
//    do modelo, nunca o caminho; DELETE não existe em modelo nenhum (este
//    cliente não apaga projeto, segredo nem migration);
//  - `ref` (id do projeto) só entra no caminho depois de casar ^[a-z]{20}$, e
//    isso acontece ANTES de qualquer fetch;
//  - 401/403 viram SemAcesso (a autorização da lojista caiu ou não cobre);
//  - database/query: só 200 e 201 são sucesso, e o corpo de sucesso tem de ser
//    a LISTA de linhas; corpo-objeto com "error" lança;
//  - nenhuma mensagem de erro carrega o token, nem o corpo cru da resposta
//    (o corpo pode ecoar o SQL, e o SQL dos segredos leva valor de segredo).
//    Do corpo de erro sai no máximo o SQLSTATE (5 caracteres [0-9A-Z]);
//  - prazo estourado, rede que cai no meio, ou 2xx que não dá para ler viram
//    ESTADO_DESCONHECIDO: o pedido PODE ter sido aplicado. Quem chama confere o
//    estado real (ledger, listagem) antes de repetir — nunca supõe que não foi.
//
// Sem dependências (Node 20+ ou Deno com node:*). Nenhum segredo é lido aqui:
// o token chega de quem chama (texto ou função que devolve o token atual).
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { RE_REF } = require("./lojas.cjs");

export const API_GESTAO = "https://api.supabase.com";
export const ESTADO_DESCONHECIDO = "ESTADO_DESCONHECIDO";
const PRAZO_PADRAO_MS = 30_000;

/** Os ÚNICOS caminhos que este cliente sabe chamar. Peça nova do L4b que
 * precisar de outro caminho acrescenta um modelo aqui (revisão Opus). */
export const MODELOS = Object.freeze({
  organizacoes: Object.freeze({
    caminho: "/v1/organizations",
    metodos: Object.freeze(["GET"]),
  }),
  projetos: Object.freeze({
    caminho: "/v1/projects",
    metodos: Object.freeze(["GET", "POST"]),
  }),
  projeto: Object.freeze({
    caminho: "/v1/projects/{ref}",
    metodos: Object.freeze(["GET"]),
  }),
  consulta: Object.freeze({
    caminho: "/v1/projects/{ref}/database/query",
    metodos: Object.freeze(["POST"]),
  }),
  migracoes: Object.freeze({
    caminho: "/v1/projects/{ref}/database/migrations",
    metodos: Object.freeze(["GET"]),
  }),
  segredos: Object.freeze({
    caminho: "/v1/projects/{ref}/secrets",
    metodos: Object.freeze(["GET", "POST"]),
  }),
  chaves: Object.freeze({
    caminho: "/v1/projects/{ref}/api-keys",
    metodos: Object.freeze(["GET"]),
  }),
});
const MAPA_MODELOS = new Map(Object.entries(MODELOS));

export class ErroDaGestao extends Error {
  /**
   * @param {string} mensagem  texto SEM token e SEM corpo de resposta
   * @param {{ codigo?: string, status?: number, sqlstate?: string }} [extra]
   */
  constructor(mensagem, extra = {}) {
    super(mensagem);
    this.name = "ErroDaGestao";
    this.codigo = extra.codigo ?? "ERRO";
    if (extra.status !== undefined) this.status = extra.status;
    if (extra.sqlstate !== undefined) this.sqlstate = extra.sqlstate;
  }
}

export class SemAcesso extends ErroDaGestao {
  constructor(mensagem, extra = {}) {
    super(mensagem, { ...extra, codigo: "SEM_ACESSO" });
    this.name = "SemAcesso";
  }
}

/** Nome do erro de baixo nível, só se for um identificador simples (a
 * mensagem dele nunca é usada: pode carregar URL, cabeçalho ou token). */
function nomeSeguro(e) {
  const nome = e?.name;
  return typeof nome === "string" && /^[A-Za-z]{1,40}$/.test(nome)
    ? nome
    : "erro";
}

function desconhecido(onde, motivo) {
  return new ErroDaGestao(
    `${onde}: ${motivo}. O pedido PODE ter sido aplicado (ESTADO_DESCONHECIDO): confira o estado real antes de repetir.`,
    { codigo: ESTADO_DESCONHECIDO },
  );
}

/**
 * fetch com prazo que cobre também a LEITURA do corpo. Devolve { status, texto }.
 * Prazo estourado ou exceção do fetch => ErroDaGestao ESTADO_DESCONHECIDO, sem
 * `cause` (a exceção original pode carregar a URL ou o cabeçalho).
 * `onde` é um rótulo fixo de quem chama (ex.: "POST /v1/oauth/token"), nunca
 * texto vindo da rede.
 */
export async function buscarComPrazo(fetchFn, url, init, prazoMs, onde) {
  const controle = new AbortController();
  let relogio;
  const estouro = new Promise((_ok, falha) => {
    relogio = setTimeout(() => {
      controle.abort();
      falha(desconhecido(onde, `sem resposta em ${prazoMs} ms`));
    }, prazoMs);
  });
  try {
    const r = await Promise.race([
      fetchFn(url, { ...init, signal: controle.signal }),
      estouro,
    ]);
    const texto = await Promise.race([r.text(), estouro]);
    return { status: r.status, texto };
  } catch (e) {
    if (e instanceof ErroDaGestao) throw e;
    throw desconhecido(onde, `a conexão falhou (${nomeSeguro(e)})`);
  } finally {
    clearTimeout(relogio);
  }
}

/** SQLSTATE do corpo de erro do database/query ("ERROR:  42P07: ..."). */
function sqlstateDo(texto) {
  const m = /ERROR:\s+([0-9A-Z]{5}):/.exec(String(texto ?? ""));
  return m ? m[1] : undefined;
}

/** Token de portador: texto visível ASCII sem espaço (barra CR/LF no cabeçalho). */
function tokenValido(token) {
  return (
    typeof token === "string" &&
    token.length > 0 &&
    token.length <= 4096 &&
    /^[\x21-\x7e]+$/.test(token)
  );
}

/**
 * @param {{
 *   token: string | (() => string | Promise<string>),
 *   fetch?: typeof fetch,
 *   prazoMs?: number,
 * }} opcoes
 */
export function criarClienteGestao({
  token,
  fetch: fetchFn = globalThis.fetch,
  prazoMs = PRAZO_PADRAO_MS,
} = {}) {
  async function tokenAtual() {
    const t = typeof token === "function" ? await token() : token;
    if (!tokenValido(t)) {
      throw new ErroDaGestao(
        "Gestão Supabase: sem access token válido (vazio, não-texto ou com caractere proibido).",
        { codigo: "PEDIDO_INVALIDO" },
      );
    }
    return t;
  }

  /** Monta e manda o pedido; devolve { status, corpo } de um 2xx. */
  async function executar(modelo, { ref, metodo = "GET", corpo } = {}) {
    const m = typeof modelo === "string" ? MAPA_MODELOS.get(modelo) : undefined;
    if (!m) {
      throw new ErroDaGestao(
        "Gestão Supabase: modelo de caminho desconhecido (só os de MODELOS).",
        { codigo: "PEDIDO_INVALIDO" },
      );
    }
    if (!m.metodos.includes(metodo)) {
      throw new ErroDaGestao(
        `Gestão Supabase: ${m.caminho} não aceita este método (só ${m.metodos.join(", ")}).`,
        { codigo: "PEDIDO_INVALIDO" },
      );
    }
    const pedeRef = m.caminho.includes("{ref}");
    if (pedeRef && !(typeof ref === "string" && RE_REF.test(ref))) {
      throw new ErroDaGestao(
        `Gestão Supabase: ref inválido para ${m.caminho} (esperado 20 letras minúsculas).`,
        { codigo: "PEDIDO_INVALIDO" },
      );
    }
    if (!pedeRef && ref !== undefined) {
      throw new ErroDaGestao(`Gestão Supabase: ${m.caminho} não leva ref.`, {
        codigo: "PEDIDO_INVALIDO",
      });
    }
    if (metodo === "GET" && corpo !== undefined) {
      throw new ErroDaGestao("Gestão Supabase: GET não leva corpo.", {
        codigo: "PEDIDO_INVALIDO",
      });
    }
    const caminho = pedeRef ? m.caminho.replace("{ref}", ref) : m.caminho;
    const onde = `${metodo} ${caminho}`;
    const cabecalhos = {
      authorization: `Bearer ${await tokenAtual()}`,
      accept: "application/json",
    };
    const init = { method: metodo, headers: cabecalhos, redirect: "manual" };
    if (corpo !== undefined) {
      cabecalhos["content-type"] = "application/json";
      init.body = JSON.stringify(corpo);
    }

    const { status, texto } = await buscarComPrazo(
      fetchFn,
      `${API_GESTAO}${caminho}`,
      init,
      prazoMs,
      onde,
    );
    if (status === 401 || status === 403) {
      throw new SemAcesso(
        `Gestão Supabase: ${onde} respondeu HTTP ${status}: a autorização da lojista não cobre isto ou caiu (renove ou autorize de novo).`,
        { status },
      );
    }
    if (status < 200 || status > 299) {
      const sqlstate = sqlstateDo(texto);
      throw new ErroDaGestao(
        `Gestão Supabase: ${onde} respondeu HTTP ${status}${sqlstate ? ` (SQLSTATE ${sqlstate})` : ""}.`,
        { codigo: "HTTP", status, sqlstate },
      );
    }
    if (texto === "") return { status, corpo: null };
    try {
      return { status, corpo: JSON.parse(texto) };
    } catch {
      throw desconhecido(onde, `HTTP ${status} com corpo que não é JSON`);
    }
  }

  return {
    /** Pedido a um modelo fixo; devolve o corpo JSON (null se vazio). */
    async pedir(modelo, opcoes) {
      return (await executar(modelo, opcoes)).corpo;
    },

    /**
     * SQL no banco do projeto (POST /database/query). Sucesso = HTTP 200 ou
     * 201 com a LISTA de linhas no corpo; devolve a lista.
     */
    async consultarBanco(ref, sql, { somenteLeitura = false } = {}) {
      if (typeof sql !== "string" || sql.trim() === "") {
        throw new ErroDaGestao("Gestão Supabase: SQL vazio.", {
          codigo: "PEDIDO_INVALIDO",
        });
      }
      const onde = "POST /v1/projects/{ref}/database/query";
      const { status, corpo } = await executar("consulta", {
        ref,
        metodo: "POST",
        corpo: { query: sql, read_only: somenteLeitura === true },
      });
      if (status !== 200 && status !== 201) {
        // 2xx diferente: a consulta pode ter rodado; não é sucesso confirmado.
        throw new ErroDaGestao(
          `Gestão Supabase: ${onde} respondeu HTTP ${status} (só 200/201 é sucesso). O pedido PODE ter sido aplicado (ESTADO_DESCONHECIDO).`,
          { codigo: ESTADO_DESCONHECIDO, status },
        );
      }
      if (Array.isArray(corpo)) return corpo;
      if (
        corpo !== null &&
        typeof corpo === "object" &&
        Object.hasOwn(corpo, "error")
      ) {
        throw new ErroDaGestao(
          `Gestão Supabase: ${onde} respondeu HTTP ${status} com "error" no corpo.`,
          { codigo: "CORPO_COM_ERRO", status },
        );
      }
      throw desconhecido(onde, `HTTP ${status} sem a lista de linhas`);
    },
  };
}
