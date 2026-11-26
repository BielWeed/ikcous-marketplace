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
//    estado real (ledger, listagem) antes de repetir — nunca supõe que não foi;
//  - PATCH de config/auth só com as chaves de CHAVES_DO_CONFIG_AUTH, cada uma
//    do tipo certo; qualquer outra é recusada ANTES da rede;
//  - deploy de function só por implantarFuncao (multipart montado aqui, slug e
//    caminhos de arquivo conferidos, verify_jwt obrigatório, só 201 é sucesso).
//
// Sem dependências (Node 20+ ou Deno com node:*). Nenhum segredo é lido aqui:
// o token chega de quem chama (texto ou função que devolve o token atual).
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { RE_REF } = require("./lojas.cjs");

export const API_GESTAO = "https://api.supabase.com";
export const ESTADO_DESCONHECIDO = "ESTADO_DESCONHECIDO";
const PRAZO_PADRAO_MS = 30_000;

/**
 * As ÚNICAS chaves que o PATCH de /config/auth pode levar, com o tipo de cada
 * uma (plano nova-loja, A4, 26/11/2026): os endereços e o limite de e-mail do
 * login (as CAMPOS_URLS de scripts/publicacao/login-da-loja-regras.cjs) e o
 * Send Email Hook (as CAMPOS_HOOK de scripts/publicacao/ativar-email-do-login.cjs).
 * Tipos da spec `UpdateAuthConfigBody` (https://api.supabase.com/api/v1-json),
 * sem o `null` que ela aceita (aqui `null` é recusado em todas). Só o tipo se
 * confere: `hook_send_email_enabled: false` e texto vazio ("") passam, então
 * desligar o hook ou esvaziar o endereço dele É possível por aqui. O `site_url`
 * vazio quem barra é o servidor (a spec exige `pattern: ^[^,]+$`). Qualquer
 * outra chave (smtp_*, mailer_*, external_*, hook_* de outro gancho) é recusada
 * ANTES da rede.
 */
export const CHAVES_DO_CONFIG_AUTH = Object.freeze({
  site_url: "texto",
  uri_allow_list: "texto",
  rate_limit_email_sent: "inteiro-positivo",
  hook_send_email_enabled: "booleano",
  hook_send_email_uri: "texto",
  hook_send_email_secrets: "texto",
});

/** Os ÚNICOS caminhos que este cliente sabe chamar. Peça nova do L4b que
 * precisar de outro caminho acrescenta um modelo aqui (revisão Opus).
 * `corpoPermitido`: o corpo só pode ter estas chaves, deste tipo.
 * `multipart`: o corpo é montado só por `implantarFuncao` (pedir() recusa).
 * `consulta`: os únicos parâmetros de query que o modelo aceita. */
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
  // v1-list-all-functions (edge_functions:read).
  funcoes: Object.freeze({
    caminho: "/v1/projects/{ref}/functions",
    metodos: Object.freeze(["GET"]),
  }),
  // v1-deploy-a-function (edge_functions:write): multipart/form-data com o
  // campo `metadata` (JSON) e um campo `file` por arquivo, nome = caminho
  // relativo; `?slug=`. Cria a function se não existir. Só por implantarFuncao.
  implantarFuncao: Object.freeze({
    caminho: "/v1/projects/{ref}/functions/deploy",
    metodos: Object.freeze(["POST"]),
    multipart: true,
    consulta: Object.freeze(["slug"]),
  }),
  // v1-get-auth-service-config (auth:read) e v1-update-auth-service-config
  // (auth:write). O GET devolve também smtp_pass e o hash do hook: quem chama
  // não imprime o corpo.
  configAuth: Object.freeze({
    caminho: "/v1/projects/{ref}/config/auth",
    metodos: Object.freeze(["GET", "PATCH"]),
    corpoPermitido: CHAVES_DO_CONFIG_AUTH,
  }),
});

/** Slug de function, pelo padrão da spec do deploy (^[A-Za-z][A-Za-z0-9_-]*$). */
const RE_SLUG = /^[A-Za-z][A-Za-z0-9_-]{0,127}$/;
/** Chaves de metadata do deploy (FunctionDeployBody.metadata, spec oficial). */
const CHAVES_DA_METADATA = new Set([
  "entrypoint_path",
  "import_map_path",
  "static_patterns",
  "verify_jwt",
  "name",
]);

function pedidoInvalido(mensagem) {
  return new ErroDaGestao(`Gestão Supabase: ${mensagem}`, {
    codigo: "PEDIDO_INVALIDO",
  });
}

/** Objeto literal: protótipo Object ou null, e nenhuma chave símbolo. */
function objetoSimples(v) {
  if (v === null || typeof v !== "object" || Array.isArray(v)) return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

function tipoConfere(tipo, valor) {
  if (tipo === "texto") return typeof valor === "string";
  if (tipo === "booleano") return typeof valor === "boolean";
  if (tipo === "inteiro-positivo")
    return Number.isSafeInteger(valor) && valor >= 1;
  return false;
}

/**
 * Corpo de um modelo com `corpoPermitido`: devolve uma CÓPIA só com as chaves
 * da lista, cada uma do tipo certo. Recusa (sem ecoar chave nem valor) objeto
 * vazio, não-literal, com chave de fora — inclusive símbolo ou não enumerável,
 * o que barra um `toJSON` escondido —, ou valor de outro tipo.
 */
function corpoDaListaBranca(permitido, corpo) {
  if (!objetoSimples(corpo))
    throw pedidoInvalido("corpo tem de ser um objeto.");
  const chaves = Reflect.ownKeys(corpo);
  if (chaves.length === 0) throw pedidoInvalido("corpo vazio.");
  const tipos = new Map(Object.entries(permitido));
  const conferidas = [];
  for (const k of chaves) {
    if (typeof k !== "string" || !tipos.has(k)) {
      throw pedidoInvalido(
        "corpo com chave fora da lista branca deste modelo (não impressa).",
      );
    }
    // getter não tem `value` (undefined): cai no tipo e é recusado também
    const d = Object.getOwnPropertyDescriptor(corpo, k);
    if (!d?.enumerable || !tipoConfere(tipos.get(k), d.value)) {
      throw pedidoInvalido(
        "corpo com valor de tipo inesperado numa chave da lista branca (não impresso).",
      );
    }
    conferidas.push([k, d.value]);
  }
  return Object.fromEntries(conferidas);
}

/** Caminho relativo seguro de arquivo do deploy ("supabase/functions/x/index.ts"). */
function caminhoDeArquivoSeguro(c) {
  if (typeof c !== "string" || c.length === 0 || c.length > 512) return false;
  if (!/^[A-Za-z0-9._\-/]+$/.test(c)) return false;
  return c.split("/").every((seg) => seg !== "" && seg !== "." && seg !== "..");
}
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
 * fetch com prazo que cobre também a LEITURA do corpo. Devolve { status, texto,
 * headers }.
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
    // headers: a ponte lê o limite de pedidos do GitHub (retry-after)
    return { status: r.status, texto, headers: r.headers };
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

  /**
   * Monta e manda o pedido; devolve { status, corpo } de um 2xx.
   * `multipart` (o FormData já montado) e `consulta` só chegam de
   * implantarFuncao, nunca de pedir().
   */
  async function executar(
    modelo,
    { ref, metodo = "GET", corpo, consulta } = {},
    { multipart } = {},
  ) {
    const m = typeof modelo === "string" ? MAPA_MODELOS.get(modelo) : undefined;
    if (!m) {
      throw new ErroDaGestao(
        "Gestão Supabase: modelo de caminho desconhecido (só os de MODELOS).",
        { codigo: "PEDIDO_INVALIDO" },
      );
    }
    if (m.multipart === true) {
      if (!(multipart instanceof FormData) || corpo !== undefined) {
        throw pedidoInvalido(
          `${m.caminho} só se chama por implantarFuncao (corpo multipart).`,
        );
      }
    } else if (multipart !== undefined) {
      throw pedidoInvalido(`${m.caminho} não leva corpo multipart.`);
    }
    if (consulta !== undefined) {
      const aceitas = m.consulta ?? [];
      if (
        !objetoSimples(consulta) ||
        !Reflect.ownKeys(consulta).every(
          (k) =>
            typeof k === "string" &&
            aceitas.includes(k) &&
            typeof Object.getOwnPropertyDescriptor(consulta, k)?.value ===
              "string",
        )
      ) {
        throw pedidoInvalido(`${m.caminho} não aceita esta query.`);
      }
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
    // Lista branca do corpo: vale para todo método que não seja GET (PATCH do
    // config/auth); o que sai na rede é a CÓPIA conferida, nunca o objeto cru.
    const corpoFinal =
      m.corpoPermitido && metodo !== "GET"
        ? corpoDaListaBranca(m.corpoPermitido, corpo)
        : corpo;
    const caminho = pedeRef ? m.caminho.replace("{ref}", ref) : m.caminho;
    const onde = `${metodo} ${caminho}`;
    const query =
      consulta === undefined ? "" : `?${new URLSearchParams(consulta)}`;
    const cabecalhos = {
      authorization: `Bearer ${await tokenAtual()}`,
      accept: "application/json",
    };
    const init = { method: metodo, headers: cabecalhos, redirect: "manual" };
    if (multipart !== undefined) {
      // sem content-type: o fetch o põe com o boundary do FormData
      init.body = multipart;
    } else if (corpoFinal !== undefined) {
      cabecalhos["content-type"] = "application/json";
      init.body = JSON.stringify(corpoFinal);
    }

    const { status, texto } = await buscarComPrazo(
      fetchFn,
      `${API_GESTAO}${caminho}${query}`,
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

    /**
     * Publica (ou cria) UMA function: POST /functions/deploy?slug=<slug>,
     * multipart com `metadata` (JSON) e um `file` por arquivo — a mesma forma
     * do `supabase functions deploy --use-api` (supabase/cli,
     * pkg/function/deploy.go, writeForm). `verify_jwt` é OBRIGATÓRIO e
     * booleano: sem ele o servidor mantém o valor antigo ou o padrão, e uma
     * function com o verify_jwt errado quebra (OTP, webhook). O
     * `entrypoint_path` (e o `import_map_path`, se houver) tem de ser um dos
     * arquivos enviados. Sucesso = HTTP 201 com o mesmo slug no corpo; outro
     * 2xx vira ESTADO_DESCONHECIDO (a publicação PODE ter acontecido).
     * Nenhuma mensagem de erro carrega o conteúdo dos arquivos.
     *
     * @param {string} ref
     * @param {{
     *   slug: string,
     *   metadata: { entrypoint_path: string, verify_jwt: boolean,
     *     import_map_path?: string, static_patterns?: string[], name?: string },
     *   arquivos: { caminho: string, conteudo: string | Uint8Array }[],
     * }} pedido
     */
    async implantarFuncao(ref, { slug, metadata, arquivos } = {}) {
      if (!(typeof slug === "string" && RE_SLUG.test(slug))) {
        throw pedidoInvalido(
          "slug de function inválido (esperado ^[A-Za-z][A-Za-z0-9_-]*$).",
        );
      }
      if (!objetoSimples(metadata)) {
        throw pedidoInvalido("metadata do deploy tem de ser um objeto.");
      }
      for (const k of Reflect.ownKeys(metadata)) {
        if (typeof k !== "string" || !CHAVES_DA_METADATA.has(k)) {
          throw pedidoInvalido("metadata do deploy com chave fora da spec.");
        }
      }
      const {
        entrypoint_path: entrada,
        import_map_path: mapa,
        static_patterns: estaticos,
        verify_jwt: verifyJwt,
        name,
      } = metadata;
      if (typeof verifyJwt !== "boolean") {
        throw pedidoInvalido("metadata.verify_jwt obrigatório e booleano.");
      }
      if (name !== undefined && typeof name !== "string") {
        throw pedidoInvalido("metadata.name tem de ser texto.");
      }
      if (
        estaticos !== undefined &&
        !(
          Array.isArray(estaticos) &&
          estaticos.every((p) => typeof p === "string")
        )
      ) {
        throw pedidoInvalido(
          "metadata.static_patterns tem de ser lista de texto.",
        );
      }
      if (!Array.isArray(arquivos) || arquivos.length === 0) {
        throw pedidoInvalido("deploy sem arquivos.");
      }
      const caminhos = new Set();
      for (const a of arquivos) {
        if (!objetoSimples(a) || !caminhoDeArquivoSeguro(a.caminho)) {
          throw pedidoInvalido(
            "arquivo do deploy com caminho inválido (relativo, com /, sem . nem ..).",
          );
        }
        if (caminhos.has(a.caminho)) {
          throw pedidoInvalido("arquivo do deploy repetido.");
        }
        if (
          !(typeof a.conteudo === "string" || a.conteudo instanceof Uint8Array)
        ) {
          throw pedidoInvalido(
            "conteúdo de arquivo do deploy tem de ser texto ou bytes.",
          );
        }
        caminhos.add(a.caminho);
      }
      if (!(typeof entrada === "string" && caminhos.has(entrada))) {
        throw pedidoInvalido(
          "metadata.entrypoint_path tem de ser um dos arquivos enviados.",
        );
      }
      if (mapa !== undefined && typeof mapa !== "string") {
        throw pedidoInvalido("metadata.import_map_path tem de ser texto.");
      }
      if (mapa !== undefined && mapa !== "" && !caminhos.has(mapa)) {
        throw pedidoInvalido(
          "metadata.import_map_path tem de ser um dos arquivos enviados.",
        );
      }

      // Cópia com os valores JÁ conferidos (nunca o objeto de quem chama).
      const meta = {
        entrypoint_path: entrada,
        verify_jwt: verifyJwt,
        ...(name !== undefined ? { name } : {}),
        ...(mapa !== undefined ? { import_map_path: mapa } : {}),
        ...(estaticos !== undefined ? { static_patterns: [...estaticos] } : {}),
      };
      const form = new FormData();
      form.append("metadata", JSON.stringify(meta));
      for (const a of arquivos) {
        form.append("file", new Blob([a.conteudo]), a.caminho);
      }
      const onde = "POST /v1/projects/{ref}/functions/deploy";
      const { status, corpo } = await executar(
        "implantarFuncao",
        { ref, metodo: "POST", consulta: { slug } },
        { multipart: form },
      );
      if (status !== 201) {
        throw new ErroDaGestao(
          `Gestão Supabase: ${onde} respondeu HTTP ${status} (só 201 é sucesso). A publicação PODE ter acontecido (ESTADO_DESCONHECIDO): confira a lista de functions antes de repetir.`,
          { codigo: ESTADO_DESCONHECIDO, status },
        );
      }
      if (!objetoSimples(corpo) || corpo.slug !== slug) {
        throw desconhecido(onde, `HTTP ${status} sem o slug pedido no corpo`);
      }
      return corpo;
    },
  };
}
