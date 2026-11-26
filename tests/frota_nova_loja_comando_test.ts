// @ts-nocheck
/**
 * O COMANDO ASSISTIDO da loja nova (scripts/frota/nova-loja.mjs), tarefa C1
 * do plano nova-loja (26/11/2026): os passos abrir, receber, criar-projeto,
 * banco e ficha. O que este arquivo trava:
 *
 *  - sem --aplicar NENHUM passo escreve: o dublê do fetch conta POST, PATCH e
 *    DELETE (e o próprio fetch), o cofre conta gravações e o arquivo de estado
 *    nem nasce;
 *  - criar-projeto PARA se a autorização não cobre exatamente a organização
 *    informada (outra org, ou mais de uma);
 *  - criar-projeto espera ACTIVE_HEALTHY com intervalo e prazo de 5 min no
 *    relógio falso; prazo estourado = INCERTO (nunca SIM); INIT_FAILED e
 *    REMOVED = NÃO;
 *  - retomar NUNCA repete o POST do projeto (nem depois de prazo estourado,
 *    nem depois de a resposta do POST se perder);
 *  - o arquivo de estado não guarda token, refresh, código, client_secret,
 *    db_pass, e-mail nem chave da loja (o teste lê o arquivo e procura os
 *    valores dos dublês);
 *  - código e token nunca aparecem na saída;
 *  - o refresh novo é gravado no cofre ANTES de o access token ser usado, e
 *    uma rodada renova uma vez só;
 *  - o limite de 2 projetos grátis vira mensagem em português (é POR PESSOA);
 *  - banco chama o instalador e só diz SIM com a fila inteira no ledger e a
 *    marca concluída; ficha confere store_config id=1 e gera (sem executar)
 *    o SQL de frota_lojas e a entrada de lojas.json.
 *
 * Nenhuma chamada de rede real: todo fetch aqui é falso; os cofres são os de
 * memória; o estado vai para uma pasta temporária.
 */
import { createHmac } from "node:crypto";
import { open } from "node:fs/promises";
import { fromFileUrl, join } from "https://deno.land/std@0.177.0/path/mod.ts";
import {
  assert,
  assertEquals,
  assertStringIncludes,
  assertThrows,
} from "https://deno.land/std@0.177.0/testing/asserts.ts";
import { criarCofreMemoria } from "../scripts/frota/cofre-local.mjs";
import {
  SQL_CONCLUIR,
  SQL_ESTADO,
  SQL_LEDGER,
  SQL_MARCA,
  SQL_PRIVILEGIOS,
  ddlDoLedger,
} from "../scripts/frota/instalador-banco.mjs";
import {
  INTERVALO_CONSULTA_MS,
  MARCA_DA_FICHA,
  PASSOS,
  PRAZO_ATIVO_MS,
  SQL_ADMINS,
  SQL_DEFINIR_DONO,
  SQL_DONO,
  SQL_DONO_EXISTE,
  SQL_FICHA,
  criarEstadoEmArquivo,
  executarPasso,
  lerArgumentos,
  vereditoGeral,
} from "../scripts/frota/nova-loja.mjs";
import {
  sqlDaPromocao,
  sqlDoDiagnostico,
} from "../scripts/frota/primeira-admin.mjs";
import {
  SQL_ESTADO_DO_BANCO,
  SQL_NOMES_NO_VAULT,
  SQL_SAUDE,
  SQL_STORE_CONFIG,
} from "../scripts/frota/segredos-da-loja.mjs";

const SLUG = "loja-nova";
const ORG = "orgdalojistaaaaaaaaa";
const OUTRA_ORG = "orgdeoutrapessoaaaaa";
const REF = "refdalojanovaaaaaaaa";
const NOME_DO_PROJETO = `ikcous-${SLUG}`;
const CLIENT_ID = "b5f97263-0000-4000-8000-000000000000";
const CLIENT_SECRET = "sba_SEGREDO_DO_APP_FALSO_inventado_123";
const REDIRECT = "https://gestao.exemplo.test/autorizado";
const CODIGO = "codigo-FALSO-da-lojista-0123456789";
const ACCESS = "sbp_oauth_ACCESS_FALSO_0123456789abcdef";
const REFRESH_1 = "refresh-FALSO-um-0123456789";
const EMAIL = "lojista.falsa@exemplo.test";
// o digest que GET /secrets devolve junto do nome: nunca pode sair
const DIGEST_DO_SEGREDO = "digest-FALSO-do-valor-0123456789abcdef";
const SEGREDOS_DO_B1 = [
  "MP_CHAVES_ENCRYPTION_KEY",
  "RECONCILIACAO_SECRET",
  "VAPID_PUBLIC_KEY",
  "VAPID_PRIVATE_KEY",
];
const PUBLICAVEL = "sb_publishable_CHAVE_PUBLICA_FALSA_0123";
const SERVICE_ROLE = "eyJSERVICE_ROLE_FALSA.nunca.imprimir";
// montada em pedaços: um literal com a forma de chave secreta do Supabase
// (sb_secret_…) faz o secretlint barrar o commit, mesmo sendo inventada
const SECRETA = ["sb", "secret", "CHAVE_SECRETA_FALSA_0123456"].join("_");
const AGORA = 1_800_000_000_000;

const MIGRATIONS = [
  { arquivo: "20260101000000_um.sql", corpo: "SELECT 1;" },
  { arquivo: "20260102000000_dois.sql", corpo: "SELECT 2;" },
];
const REF_SAVY = "gnjsrucsmjkajijrakzr";
const REF_IKCOUS = "cafkrminfnokvgjqtkle";
const LOJAS_BRUTAS = {
  lojas: {
    "ikcous-publicada": {
      ref: REF_IKCOUS,
      classe: "assinante",
      apelido: "IKCOUS",
      segredoDoToken: "SUPABASE_ACCESS_TOKEN_IKCOUS",
      functionsNomeadas: true,
    },
    savy: {
      ref: REF_SAVY,
      classe: "assinante",
      apelido: "Savy",
      segredoDoToken: "SUPABASE_ACCESS_TOKEN_SAVY",
      functionsNomeadas: true,
    },
  },
};

// ─── o repositório, para o functions-da-loja (B2) ───────────────────────────
// A loja nova entra no lojas.json e nos canais como o cadastro (B5) a
// deixaria (fora de functionsSoPeloWorkflow); o resto vem do disco.
const RAIZ = fromFileUrl(new URL("..", import.meta.url));
const CAMINHO_CANAIS = "scripts/frota/canais-de-backend.json";
const CAMINHO_LOJAS = "scripts/frota/lojas.json";
function lerDoDisco(caminho) {
  try {
    return Deno.readTextFileSync(`${RAIZ}/${caminho}`);
  } catch {
    return null;
  }
}
const CANAIS_COM_A_NOVA = (() => {
  const c = JSON.parse(lerDoDisco(CAMINHO_CANAIS));
  const daSavy = Reflect.get(c.canais, REF_SAVY).functionsPublicaveis;
  c.canais = {
    ...c.canais,
    [REF]: {
      nome: "Loja nova",
      migrations: SLUG,
      functions: SLUG,
      projetosNoMesmoBanco: [],
      functionsPublicaveis: [...daSavy],
    },
  };
  return c;
})();
const LOJAS_COM_A_NOVA = (() => {
  const l = JSON.parse(lerDoDisco(CAMINHO_LOJAS));
  l.lojas = {
    ...l.lojas,
    [SLUG]: {
      ref: REF,
      classe: "assinante",
      apelido: "Nova",
      segredoDoToken: "SUPABASE_ACCESS_TOKEN_LOJA_NOVA",
      functionsNomeadas: true,
    },
  };
  return l;
})();
const PUBLICAVEIS = [
  ...Reflect.get(CANAIS_COM_A_NOVA.canais, REF).functionsPublicaveis,
];
const TOPO = "0123456789abcdef0123456789abcdef01234567";
const OUTRO_SHA = "fedcba9876543210fedcba9876543210fedcba98";

/** git falso: HEAD e topo do ramo da release; o commit é o disco + trocas. */
function gitFalso({ head = TOPO, topo = TOPO } = {}) {
  const g = { leituras: 0 };
  g.head = async () => head;
  g.topoDoRamo = async () => topo;
  g.ler = (sha, caminho) => {
    g.leituras += 1;
    if (sha !== topo && sha !== head) return null;
    if (caminho === CAMINHO_CANAIS) return JSON.stringify(CANAIS_COM_A_NOVA);
    if (caminho === CAMINHO_LOJAS) return JSON.stringify(LOJAS_COM_A_NOVA);
    return lerDoDisco(caminho);
  };
  return g;
}

function resposta(status, corpo) {
  return new Response(
    corpo === undefined
      ? null
      : typeof corpo === "string"
        ? corpo
        : JSON.stringify(corpo),
    { status, headers: { "content-type": "application/json" } },
  );
}

/** O banco do projeto, do lado de lá do database/query (o mesmo roteiro do
 * bancoFalso do teste do instalador, devolvendo HTTP). */
function bancoFalso({
  ficha = 1,
  marca = MARCA_DA_FICHA,
  alvo = "customer",
  outrasAdmins = 0,
  vault = ["reconciliacao_secret", "reconciliacao_url"],
  temVapid = true,
  idadeRodada = 120,
  degradado = false,
  rodadasDegradadas = 0,
  // o dono: null (nenhum), "alvo" (a lojista), "outra" (uma das outras
  // admins) ou "ex" (alguém que não é mais admin)
  dono = null,
  donoTabela = true,
  confirmada = true,
  // a admin é admin só em UMA das duas fontes do cargo
  fontesDiscordam = false,
  promocaoCai = false,
} = {}) {
  const b = {
    alvo,
    outrasAdmins,
    vault: [...vault],
    temVapid,
    idadeRodada,
    degradado,
    rodadasDegradadas,
    dono,
    donoTabela,
    confirmada,
    fontesDiscordam,
    promocaoCai,
    falharEstadoNa: null,
    leiturasDoEstado: 0,
    tabelas: 0,
    ledger: null,
    marcaInstalacao: null,
    privilegios: false,
    ficha,
    marcaDaFicha: marca,
    consultas: [],
    responder(sql) {
      b.consultas.push(sql);
      if (sql === SQL_PRIVILEGIOS) {
        return [
          {
            papel_dono: "postgres",
            faltando: b.privilegios ? "" : "tabelas:anon",
          },
        ];
      }
      if (sql === SQL_ESTADO) {
        b.leiturasDoEstado += 1;
        if (b.leiturasDoEstado === b.falharEstadoNa)
          throw Object.assign(new Error("leitura caiu"), { http: 503 });
        return [
          {
            tabelas_em_public: b.tabelas,
            ledger_existe: b.ledger !== null,
            marca_existe: b.marcaInstalacao !== null,
          },
        ];
      }
      if (sql === SQL_LEDGER)
        return [...b.ledger].map((version) => ({ version }));
      if (sql === SQL_MARCA)
        return [{ concluida: b.marcaInstalacao === "concluida" }];
      if (sql === ddlDoLedger()) {
        b.ledger ??= new Set();
        b.marcaInstalacao ??= "em_curso";
        b.privilegios = true;
        return [];
      }
      if (sql === SQL_CONCLUIR) {
        b.marcaInstalacao = "concluida";
        return [];
      }
      if (sql === SQL_FICHA) {
        return [
          {
            ficha: b.ficha,
            marca: b.marcaDaFicha,
            dominio_publico: null,
          },
        ];
      }
      const admins = () => (b.alvo === "admin" ? 1 : 0) + b.outrasAdmins;
      if (sql === SQL_ADMINS) return [{ admins: admins(), nas_duas: admins() }];
      if (sql === sqlDoDiagnostico(EMAIL)) {
        return [
          {
            contas: 1,
            confirmada: true,
            cargo_login: b.alvo,
            tem_perfil: true,
            cargo_perfil: b.alvo,
            admins: admins(),
            alvo_admin: b.alvo === "admin",
          },
        ];
      }
      if (sql === sqlDaPromocao(EMAIL)) {
        if (b.promocaoCai)
          throw Object.assign(new Error("gateway"), { http: 503 });
        if (b.outrasAdmins > 0)
          throw Object.assign(new Error("ja tem"), { sqlstate: "IKA05" });
        const acao = b.alvo === "admin" ? "ja_era_admin" : "promovida";
        const linhas = b.alvo === "admin" ? 0 : 1;
        b.alvo = "admin";
        return [
          {
            resultado: JSON.stringify({ acao, usuarios: 1, linhas, admins: 1 }),
          },
        ];
      }
      if (sql === SQL_ESTADO_DO_BANCO) {
        return [
          { vault_existe: true, store_config_existe: true, saude_existe: true },
        ];
      }
      if (sql === SQL_STORE_CONFIG)
        return [{ linhas: 1, tem_vapid: b.temVapid }];
      if (sql === SQL_NOMES_NO_VAULT)
        return [...b.vault].sort().map((name) => ({ name }));
      if (sql === SQL_SAUDE)
        return [
          {
            saude: {
              idade_rodada_s: b.idadeRodada,
              degradado: b.idadeRodada === null ? null : b.degradado,
              rodadas_degradadas_seguidas:
                b.idadeRodada === null ? null : b.rodadasDegradadas,
            },
          },
        ];
      // a transação do segredos-da-loja (B1): o Vault e a vapid_public_key
      if (sql.startsWith("BEGIN;\nDO $b1$")) {
        for (const n of ["reconciliacao_secret", "reconciliacao_url"]) {
          if (sql.includes(`'${n}'`) && !b.vault.includes(n)) b.vault.push(n);
        }
        if (sql.includes("SET vapid_public_key")) b.temVapid = true;
        return [{ gravado: true }];
      }
      // o dono (definir-dono): o mesmo critério do SQL de verdade
      const linhaDoDono = () => {
        const n = admins();
        const nasDuas = b.fontesDiscordam ? Math.max(n - 1, 0) : n;
        const donoAdmin =
          (b.dono === "alvo" && b.alvo === "admin" && !b.fontesDiscordam) ||
          (b.dono === "outra" && b.outrasAdmins > 0);
        return {
          admins: n,
          nas_duas: nasDuas,
          confirmada: nasDuas > 0 && b.confirmada,
          donos: b.dono === null ? 0 : 1,
          dono_admin: donoAdmin,
        };
      };
      if (sql === SQL_DONO_EXISTE) return [{ tabela: b.donoTabela }];
      if (sql === SQL_DONO) {
        b.leiturasDoDono = (b.leiturasDoDono ?? 0) + 1;
        if (b.leituraDoDonoCaiNa === b.leiturasDoDono)
          throw Object.assign(new Error("caiu"), { http: 503 });
        return [linhaDoDono()];
      }
      if (sql === SQL_DEFINIR_DONO) {
        b.escritasDoDono = (b.escritasDoDono ?? 0) + 1;
        if (b.escritaDoDonoCai)
          throw Object.assign(new Error("gateway"), { http: 504 });
        const l = linhaDoDono();
        const resultado = (acao, linhas) => [
          {
            resultado: JSON.stringify({
              acao,
              donos: 1,
              linhas,
              admins: l.admins,
            }),
          },
        ];
        if (l.donos === 1) {
          if (l.dono_admin) return resultado("ja_era_dona", 0);
          throw Object.assign(new Error("dono"), {
            sqlstate: l.admins === 0 ? "IKD02" : "IKD01",
          });
        }
        const recusa = (sqlstate) =>
          Object.assign(new Error("recusa"), { sqlstate });
        if (l.admins === 0) throw recusa("IKD03");
        if (l.admins > 1) throw recusa("IKD04");
        if (l.nas_duas !== 1) throw recusa("IKD05");
        if (!l.confirmada) throw recusa("IKD06");
        b.dono = "alvo";
        return resultado("gravada", 1);
      }
      const m = /VALUES \('(\d{13,14})', '([a-z0-9_-]+)'/.exec(sql);
      if (!m || !sql.startsWith("BEGIN;\n"))
        throw new Error(`consulta inesperada: ${sql.slice(0, 60)}`);
      b.tabelas += 1;
      b.ledger.add(m[1]);
      return [];
    },
  };
  return b;
}

/**
 * A Management API e o /oauth/token falsos. Conta método por chamada e
 * escreve cada evento na `linha` (compartilhada com o cofre espião), para o
 * teste ver a ORDEM entre gravar o refresh e usar o access token.
 */
function apiFalsa({
  orgs = [{ id: ORG, slug: ORG, name: "Loja da Ana", billing_email: EMAIL }],
  projetos = [],
  statusSeq = ["ACTIVE_HEALTHY"],
  postProjeto,
  banco = bancoFalso(),
  linha = [],
  segredos = SEGREDOS_DO_B1,
} = {}) {
  const s = {
    segredos: [...segredos],
    chamadas: [],
    linha,
    banco,
    projetos: [...projetos],
    statusSeq: [...statusSeq],
    refreshValido: REFRESH_1,
    nRefresh: 1,
    corposDoPostProjeto: [],
    valoresGravados: [],
    funcoes: new Map(),
    deploys: [],
    // o Auth de um projeto novo: site_url de fábrica, sem gancho
    auth: {
      site_url: "http://localhost:3000",
      uri_allow_list: "",
      rate_limit_email_sent: 2,
      hook_send_email_enabled: false,
      hook_send_email_uri: null,
      hook_send_email_secrets: null,
    },
  };
  s.fetch = async (url, init = {}) => {
    const u = new URL(String(url));
    const metodo = init.method ?? "GET";
    const auth = init.headers?.authorization ?? "";
    const somenteLeitura = u.pathname.endsWith("/database/query")
      ? JSON.parse(init.body).read_only
      : undefined;
    s.chamadas.push({ metodo, caminho: u.pathname, auth, somenteLeitura });
    s.linha.push(`fetch ${metodo} ${u.pathname}`);
    if (u.pathname === "/v1/oauth/token") {
      const campos = new URLSearchParams(init.body);
      if (campos.get("grant_type") === "authorization_code") {
        if (campos.get("code") !== CODIGO)
          return resposta(400, { error: "invalid_grant" });
        s.refreshValido = REFRESH_1;
      } else if (campos.get("refresh_token") === s.refreshValido) {
        s.nRefresh += 1;
        s.refreshValido = `refresh-FALSO-n${s.nRefresh}-0123456789`;
      } else {
        return resposta(400, { error: "invalid_grant" });
      }
      return resposta(200, {
        access_token: ACCESS,
        refresh_token: s.refreshValido,
        expires_in: 86400,
        token_type: "Bearer",
      });
    }
    // dublê: comparar o token falso em tempo constante não protege nada aqui
    // eslint-disable-next-line security/detect-possible-timing-attacks
    if (auth !== `Bearer ${ACCESS}`) return resposta(401, { message: "no" });
    // falha injetada pelo teste: (método, caminho) → status HTTP ou nada
    const falha = s.falharSe?.(metodo, u.pathname);
    if (falha) return resposta(falha, { message: "falha injetada" });
    if (metodo === "GET" && u.pathname === "/v1/organizations")
      return resposta(200, orgs);
    if (metodo === "GET" && u.pathname === "/v1/projects")
      return resposta(200, s.projetos);
    if (metodo === "POST" && u.pathname === "/v1/projects") {
      const corpo = JSON.parse(init.body);
      s.corposDoPostProjeto.push(corpo);
      if (postProjeto) return postProjeto(corpo, s);
      s.projetos.push({
        ref: REF,
        name: corpo.name,
        organization_id: corpo.organization_slug,
        organization_slug: corpo.organization_slug,
        status: "COMING_UP",
      });
      return resposta(201, {
        ref: REF,
        name: corpo.name,
        organization_slug: corpo.organization_slug,
        status: "COMING_UP",
      });
    }
    if (metodo === "GET" && u.pathname === `/v1/projects/${REF}`) {
      const status =
        s.statusSeq.length > 1 ? s.statusSeq.shift() : s.statusSeq[0];
      return resposta(200, {
        ref: REF,
        name: NOME_DO_PROJETO,
        organization_id: ORG,
        organization_slug: ORG,
        status,
      });
    }
    if (
      metodo === "POST" &&
      u.pathname === `/v1/projects/${REF}/database/query`
    ) {
      const { query } = JSON.parse(init.body);
      try {
        return resposta(201, s.banco.responder(query));
      } catch (e) {
        if (e.http) return resposta(e.http, { message: "indisponível" });
        return resposta(400, {
          message: `ERROR:  ${e.sqlstate ?? "XX000"}: ${e.message}`,
        });
      }
    }
    if (metodo === "GET" && u.pathname === `/v1/projects/${REF}/secrets`) {
      return resposta(
        200,
        s.segredos.map((name) => ({ name, value: DIGEST_DO_SEGREDO })),
      );
    }
    if (metodo === "POST" && u.pathname === `/v1/projects/${REF}/secrets`) {
      for (const { name, value } of JSON.parse(init.body)) {
        if (!s.segredos.includes(name)) s.segredos.push(name);
        s.valoresGravados.push(value);
      }
      return resposta(201, {});
    }
    if (metodo === "GET" && u.pathname === `/v1/projects/${REF}/functions`) {
      return resposta(
        200,
        [...s.funcoes].map(([slug, f]) => ({ slug, ...f })),
      );
    }
    if (
      metodo === "POST" &&
      u.pathname === `/v1/projects/${REF}/functions/deploy`
    ) {
      const slug = u.searchParams.get("slug");
      const meta = JSON.parse(String(init.body.get("metadata")));
      const antes = s.funcoes.get(slug);
      s.funcoes.set(slug, {
        status: "ACTIVE",
        verify_jwt: meta.verify_jwt,
        version: (antes?.version ?? 0) + 1,
      });
      s.deploys.push(slug);
      return resposta(201, { slug, status: "ACTIVE" });
    }
    if (metodo === "GET" && u.pathname === `/v1/projects/${REF}/config/auth`) {
      return resposta(200, { ...s.auth });
    }
    if (
      metodo === "PATCH" &&
      u.pathname === `/v1/projects/${REF}/config/auth`
    ) {
      for (const [k, v] of Object.entries(JSON.parse(init.body))) {
        // o GET devolve o segredo do gancho como HMAC-SHA256(chave = ref)
        Reflect.set(
          s.auth,
          k,
          k === "hook_send_email_secrets"
            ? createHmac("sha256", REF).update(v, "utf8").digest("hex")
            : v,
        );
      }
      return resposta(200, { ...s.auth });
    }
    if (metodo === "GET" && u.pathname === `/v1/projects/${REF}/api-keys`) {
      return resposta(200, [
        { name: "anon", api_key: "eyJANON_FALSA.x.y", type: "legacy" },
        { name: "service_role", api_key: SERVICE_ROLE, type: "legacy" },
        { name: "default", api_key: PUBLICAVEL, type: "publishable" },
        { name: "default", api_key: SECRETA, type: "secret" },
      ]);
    }
    return resposta(404, { message: "rota falsa desconhecida" });
  };
  s.escritas = () =>
    s.chamadas.filter((c) => ["POST", "PATCH", "DELETE"].includes(c.metodo));
  s.posts = (caminho) =>
    s.chamadas.filter((c) => c.metodo === "POST" && c.caminho === caminho);
  return s;
}

/** Cofre de memória que escreve cada gravação na linha do tempo. */
function cofreEspiao(linha, { falharGravacao = false } = {}) {
  const base = criarCofreMemoria();
  const c = {
    gravacoes: 0,
    ler: (slug) => base.ler(slug),
    apagar: (slug) => base.apagar(slug),
    travar: (slug) => base.travar(slug),
    async gravar(slug, valor) {
      c.gravacoes += 1;
      if (falharGravacao) throw new Error("disco cheio (falso)");
      linha.push(`cofre.gravar ${valor}`);
      return base.gravar(slug, valor);
    },
  };
  return c;
}

/** Relógio falso: dormir avança o tempo, nada espera de verdade. */
function relogioFalso() {
  const r = { t: AGORA, sonecas: [] };
  r.agora = () => r.t;
  r.dormir = async (ms) => {
    r.sonecas.push(ms);
    r.t += ms;
  };
  return r;
}

async function pastaTemporaria() {
  return await Deno.makeTempDir({ prefix: "nova-loja-teste-" });
}

/** Tudo de que um passo precisa, falso. `entradas` = o que a "stdin" devolve. */
async function ambiente(o = {}) {
  const linha = o.linha ?? [];
  const api = o.api ?? apiFalsa({ linha, ...(o.apiOpcoes ?? {}) });
  api.linha = linha;
  const pasta = o.pasta ?? (await pastaTemporaria());
  const relogio = o.relogio ?? relogioFalso();
  const saida = [];
  const entradas = [...(o.entradas ?? [])];
  const deps = {
    fetch: api.fetch,
    cofre: o.cofre ?? cofreEspiao(linha, o.cofreOpcoes),
    cofreDoBanco: o.cofreDoBanco ?? cofreEspiao([]),
    estado: o.estado ?? criarEstadoEmArquivo({ pasta }),
    lerEntrada: async () => {
      const v = entradas.shift();
      if (v === undefined) throw new Error("stdin falsa vazia");
      return v;
    },
    saida: {
      out: (...a) => saida.push(a.join(" ")),
      err: (...a) => saida.push(a.join(" ")),
    },
    agora: relogio.agora,
    dormir: relogio.dormir,
    arquivos: () => MIGRATIONS,
    lojasBrutas: () => structuredClone(LOJAS_BRUTAS),
    git: o.git ?? gitFalso(),
  };
  return { api, pasta, relogio, saida, deps, linha, entradas };
}

const pedido = (passo, extra = {}) => ({
  passo,
  slug: SLUG,
  aplicar: true,
  clientId: CLIENT_ID,
  redirect: REDIRECT,
  org: ORG,
  ...extra,
});

/** abrir + receber com --aplicar: a loja fica conectada (refresh no cofre). */
async function conectar(amb) {
  amb.entradas.push(CLIENT_SECRET, CODIGO);
  const a = await executarPasso(pedido("abrir"), amb.deps);
  assertEquals(a.veredito, "SIM", a.mensagem);
  const r = await executarPasso(pedido("receber"), amb.deps);
  assertEquals(r.veredito, "SIM", r.mensagem);
}

async function lerArquivoDeEstado(pasta) {
  return await Deno.readTextFile(join(pasta, `${SLUG}.json`));
}

// ─── 0 escritas sem --aplicar ───────────────────────────────────────────────

const PASSOS_COM_ENSAIO = [
  "abrir",
  "receber",
  "criar-projeto",
  "banco",
  "ficha",
  "segredos",
  "functions",
  "login",
  "primeira-admin",
  "definir-dono",
  "conferir",
];

Deno.test("sem --aplicar: nenhum passo faz POST/PATCH/DELETE, grava cofre ou cria o estado", async () => {
  const amb = await ambiente();
  for (const passo of PASSOS_COM_ENSAIO) {
    const r = await executarPasso(pedido(passo, { aplicar: false }), amb.deps);
    assert(r.veredito !== "SIM", `${passo} em ensaio não pode dizer SIM`);
    assertStringIncludes(r.mensagem, "ENSAIO");
  }
  assertEquals(amb.api.escritas().length, 0);
  assertEquals(amb.api.chamadas.length, 0);
  assertEquals(amb.deps.cofre.gravacoes, 0);
  assertEquals(amb.deps.cofreDoBanco.gravacoes, 0);
  const arquivos = [...Deno.readDirSync(amb.pasta)].map((e) => e.name);
  assertEquals(arquivos, []);
});

Deno.test("sem --aplicar com a loja já conectada e projeto criado: ainda 0 escritas", async () => {
  const amb = await ambiente();
  await conectar(amb);
  const c = await executarPasso(pedido("criar-projeto"), amb.deps);
  assertEquals(c.veredito, "SIM", c.mensagem);
  const antes = amb.api.chamadas.length;
  const gravacoes = amb.deps.cofre.gravacoes;
  const estadoAntes = await lerArquivoDeEstado(amb.pasta);
  for (const passo of PASSOS_COM_ENSAIO) {
    await executarPasso(pedido(passo, { aplicar: false }), amb.deps);
  }
  assertEquals(amb.api.chamadas.length, antes);
  assertEquals(amb.deps.cofre.gravacoes, gravacoes);
  assertEquals(await lerArquivoDeEstado(amb.pasta), estadoAntes);
});

// ─── org ────────────────────────────────────────────────────────────────────

Deno.test("criar-projeto: autorização de OUTRA org para antes de qualquer POST de projeto", async () => {
  const amb = await ambiente({
    apiOpcoes: { orgs: [{ id: OUTRA_ORG, slug: OUTRA_ORG, name: "x" }] },
  });
  await conectar(amb);
  const r = await executarPasso(pedido("criar-projeto"), amb.deps);
  assertEquals(r.veredito, "NÃO");
  assertStringIncludes(r.mensagem, "organização");
  assertEquals(amb.api.posts("/v1/projects").length, 0);
  assertEquals(amb.deps.cofreDoBanco.gravacoes, 0);
});

Deno.test("criar-projeto: autorização com DUAS orgs (mesmo contendo a certa) para", async () => {
  const amb = await ambiente({
    apiOpcoes: {
      orgs: [
        { id: ORG, slug: ORG, name: "a" },
        { id: OUTRA_ORG, slug: OUTRA_ORG, name: "b" },
      ],
    },
  });
  await conectar(amb);
  const r = await executarPasso(pedido("criar-projeto"), amb.deps);
  assertEquals(r.veredito, "NÃO");
  assertEquals(amb.api.posts("/v1/projects").length, 0);
});

Deno.test("criar-projeto: sem --org é NÃO e nada sai", async () => {
  const amb = await ambiente();
  await conectar(amb);
  const n = amb.api.chamadas.length;
  const r = await executarPasso(
    pedido("criar-projeto", { org: undefined }),
    amb.deps,
  );
  assertEquals(r.veredito, "NÃO");
  assertEquals(amb.api.chamadas.length, n);
});

// ─── esperar ACTIVE_HEALTHY ─────────────────────────────────────────────────

Deno.test("criar-projeto: corpo do POST certo e espera ACTIVE_HEALTHY consultando com intervalo", async () => {
  const amb = await ambiente({
    apiOpcoes: {
      statusSeq: ["COMING_UP", "COMING_UP", "UNKNOWN", "ACTIVE_HEALTHY"],
    },
  });
  await conectar(amb);
  const r = await executarPasso(pedido("criar-projeto"), amb.deps);
  assertEquals(r.veredito, "SIM", r.mensagem);
  const [corpo] = amb.api.corposDoPostProjeto;
  assertEquals(Object.keys(corpo).sort(), [
    "db_pass",
    "name",
    "organization_slug",
    "region_selection",
  ]);
  assertEquals(corpo.name, NOME_DO_PROJETO);
  assertEquals(corpo.organization_slug, ORG);
  assertEquals(corpo.region_selection, { type: "specific", code: "sa-east-1" });
  assert(/^[A-Za-z0-9_-]{40,}$/.test(corpo.db_pass), "db_pass forte");
  // a senha do banco foi para o cofre do banco ANTES do POST, e é a mesma
  assertEquals(await amb.deps.cofreDoBanco.ler(SLUG), corpo.db_pass);
  const gets = amb.api.chamadas.filter(
    (c) => c.metodo === "GET" && c.caminho === `/v1/projects/${REF}`,
  );
  assertEquals(gets.length, 4);
  assertEquals(amb.relogio.sonecas, [
    INTERVALO_CONSULTA_MS,
    INTERVALO_CONSULTA_MS,
    INTERVALO_CONSULTA_MS,
  ]);
});

Deno.test("criar-projeto: nunca ACTIVE_HEALTHY em 5 min = INCERTO, com consultas limitadas pelo prazo", async () => {
  const amb = await ambiente({ apiOpcoes: { statusSeq: ["COMING_UP"] } });
  await conectar(amb);
  const r = await executarPasso(pedido("criar-projeto"), amb.deps);
  assertEquals(r.veredito, "INCERTO");
  const esperado = amb.relogio.sonecas.reduce((a, b) => a + b, 0);
  assert(esperado >= PRAZO_ATIVO_MS, "esperou o prazo inteiro");
  assert(
    esperado <= PRAZO_ATIVO_MS + INTERVALO_CONSULTA_MS,
    "não passou do prazo",
  );
  assertEquals(PRAZO_ATIVO_MS, 5 * 60_000);
});

for (const fatal of ["INIT_FAILED", "REMOVED"]) {
  Deno.test(`criar-projeto: ${fatal} para na hora com NÃO`, async () => {
    const amb = await ambiente({
      apiOpcoes: { statusSeq: ["COMING_UP", fatal] },
    });
    await conectar(amb);
    const r = await executarPasso(pedido("criar-projeto"), amb.deps);
    assertEquals(r.veredito, "NÃO");
    assertStringIncludes(r.mensagem, fatal);
    assertEquals(amb.relogio.sonecas.length, 1);
  });
}

Deno.test("criar-projeto: limite de projetos grátis vira mensagem POR PESSOA em português", async () => {
  const amb = await ambiente({
    apiOpcoes: {
      postProjeto: () =>
        resposta(400, {
          message:
            "The following organization members have reached their maximum limits for the number of active free projects within organizations where they are an administrator or owner: fulana (2 project limit).",
        }),
    },
  });
  await conectar(amb);
  const r = await executarPasso(pedido("criar-projeto"), amb.deps);
  assertEquals(r.veredito, "NÃO");
  assertStringIncludes(r.mensagem, "POR PESSOA");
  assertStringIncludes(r.mensagem, "pausar");
  assert(!r.mensagem.includes("fulana"), "não ecoa o nome da conta");
});

// ─── retomar ────────────────────────────────────────────────────────────────

Deno.test("retomar depois do prazo estourado NÃO repete o POST do projeto", async () => {
  const amb = await ambiente({ apiOpcoes: { statusSeq: ["COMING_UP"] } });
  await conectar(amb);
  const r1 = await executarPasso(pedido("criar-projeto"), amb.deps);
  assertEquals(r1.veredito, "INCERTO");
  amb.api.statusSeq = ["ACTIVE_HEALTHY"];
  const r2 = await executarPasso(pedido("criar-projeto"), amb.deps);
  assertEquals(r2.veredito, "SIM", r2.mensagem);
  assertEquals(amb.api.posts("/v1/projects").length, 1);
  // e de novo, já SIM: nada de POST
  const r3 = await executarPasso(pedido("criar-projeto"), amb.deps);
  assertEquals(r3.veredito, "SIM");
  assertEquals(amb.api.posts("/v1/projects").length, 1);
});

Deno.test("retomar depois de a resposta do POST se perder acha o projeto pelo nome e não cria outro", async () => {
  const amb = await ambiente({
    apiOpcoes: {
      postProjeto: (corpo, s) => {
        s.projetos.push({
          ref: REF,
          name: corpo.name,
          organization_id: ORG,
          organization_slug: ORG,
          status: "COMING_UP",
        });
        throw new TypeError("a conexão caiu depois de criar");
      },
    },
  });
  await conectar(amb);
  const r1 = await executarPasso(pedido("criar-projeto"), amb.deps);
  assertEquals(r1.veredito, "INCERTO");
  const dbPass = await amb.deps.cofreDoBanco.ler(SLUG);
  const r2 = await executarPasso(pedido("criar-projeto"), amb.deps);
  assertEquals(r2.veredito, "SIM", r2.mensagem);
  assertEquals(amb.api.posts("/v1/projects").length, 1);
  assertEquals(await amb.deps.cofreDoBanco.ler(SLUG), dbPass);
});

Deno.test("retomar depois de HTTP 5xx no POST (sem projeto criado) reusa a MESMA senha do cofre", async () => {
  let vez = 0;
  const amb = await ambiente({
    apiOpcoes: {
      postProjeto: (corpo, s) => {
        vez += 1;
        if (vez === 1) return resposta(500, { message: "falha" });
        s.projetos.push({
          ref: REF,
          name: corpo.name,
          organization_slug: ORG,
          status: "COMING_UP",
        });
        return resposta(201, { ref: REF, status: "COMING_UP" });
      },
    },
  });
  await conectar(amb);
  const r1 = await executarPasso(pedido("criar-projeto"), amb.deps);
  // 5xx: o projeto PODE ter nascido; INCERTO, e a retomada procura pelo nome
  assertEquals(r1.veredito, "INCERTO");
  const r2 = await executarPasso(pedido("criar-projeto"), amb.deps);
  assertEquals(r2.veredito, "SIM", r2.mensagem);
  assertEquals(amb.api.posts("/v1/projects").length, 2);
  const [a, b] = amb.api.corposDoPostProjeto;
  assertEquals(a.db_pass, b.db_pass);
});

// ─── refresh e renovação ────────────────────────────────────────────────────

Deno.test("o refresh novo é gravado no cofre ANTES de o access token ser usado", async () => {
  const amb = await ambiente();
  await conectar(amb);
  amb.linha.length = 0;
  const tokensAntes = amb.api.posts("/v1/oauth/token").length;
  const r = await executarPasso(pedido("criar-projeto"), amb.deps);
  assertEquals(r.veredito, "SIM", r.mensagem);
  const iGravou = amb.linha.findIndex(
    (l) => l.startsWith("cofre.gravar") && l.includes("refresh-FALSO-n2"),
  );
  const iUsou = amb.linha.findIndex((l) =>
    l.startsWith("fetch GET /v1/organizations"),
  );
  assert(iGravou >= 0, "gravou o refresh novo");
  assert(iUsou > iGravou, `usou o token antes de gravar: ${amb.linha}`);
  // uma rodada inteira (orgs, projetos, POST, espera) renova UMA vez só
  assertEquals(amb.api.posts("/v1/oauth/token").length, tokensAntes + 1);
});

Deno.test("cofre que não grava o refresh novo = nenhuma chamada à Management API", async () => {
  const linha = [];
  const cofre = cofreEspiao(linha);
  const amb = await ambiente({ linha, cofre });
  await conectar(amb);
  const quebrado = cofreEspiao(linha, { falharGravacao: true });
  quebrado.ler = (s) => cofre.ler(s);
  amb.deps.cofre = quebrado;
  const n = amb.api.chamadas.length;
  const r = await executarPasso(pedido("criar-projeto"), amb.deps);
  assertEquals(r.veredito, "INCERTO");
  const depois = amb.api.chamadas.slice(n).map((c) => c.caminho);
  assertEquals(depois, ["/v1/oauth/token"]);
});

Deno.test("banco: uma rodada com várias consultas renova o acesso UMA vez", async () => {
  const amb = await ambiente();
  await conectar(amb);
  await executarPasso(pedido("criar-projeto"), amb.deps);
  const antes = amb.api.posts("/v1/oauth/token").length;
  const r = await executarPasso(pedido("banco"), amb.deps);
  assertEquals(r.veredito, "SIM", r.mensagem);
  assertEquals(amb.api.posts("/v1/oauth/token").length, antes + 1);
});

// ─── banco ──────────────────────────────────────────────────────────────────

Deno.test("banco: instala uma migration por chamada e só diz SIM com a fila inteira e a marca concluída", async () => {
  const amb = await ambiente();
  await conectar(amb);
  await executarPasso(pedido("criar-projeto"), amb.deps);
  const r = await executarPasso(pedido("banco"), amb.deps);
  assertEquals(r.veredito, "SIM", r.mensagem);
  const envelopes = amb.api.banco.consultas.filter(
    (q) => q.startsWith("BEGIN;\n") && q !== ddlDoLedger(),
  );
  assertEquals(envelopes.length, 2);
  assertEquals(amb.api.banco.marcaInstalacao, "concluida");
  // rodar de novo: JA_INSTALADA, nenhum envelope a mais
  const r2 = await executarPasso(pedido("banco"), amb.deps);
  assertEquals(r2.veredito, "SIM", r2.mensagem);
  const envelopes2 = amb.api.banco.consultas.filter(
    (q) => q.startsWith("BEGIN;\n") && q !== ddlDoLedger(),
  );
  assertEquals(envelopes2.length, 2);
});

Deno.test("banco: erro do Postgres numa migration = NÃO, e a seguinte não é enviada", async () => {
  const banco = bancoFalso();
  const responder = banco.responder;
  banco.responder = (sql) => {
    if (sql.includes("SELECT 1;") && sql.startsWith("BEGIN;\n")) {
      banco.consultas.push(sql);
      throw new Error("sabotada");
    }
    return responder(sql);
  };
  const amb = await ambiente({ apiOpcoes: { banco } });
  await conectar(amb);
  await executarPasso(pedido("criar-projeto"), amb.deps);
  const r = await executarPasso(pedido("banco"), amb.deps);
  assertEquals(r.veredito, "NÃO");
  assert(!banco.consultas.some((q) => q.includes("SELECT 2;")));
});

Deno.test("banco: sem criar-projeto SIM antes é NÃO e nada sai", async () => {
  const amb = await ambiente();
  await conectar(amb);
  const n = amb.api.chamadas.length;
  const r = await executarPasso(pedido("banco"), amb.deps);
  assertEquals(r.veredito, "NÃO");
  assertEquals(amb.api.chamadas.length, n);
});

// ─── ficha ──────────────────────────────────────────────────────────────────

async function ateFicha(o = {}) {
  const amb = await ambiente(o);
  await conectar(amb);
  assertEquals(
    (await executarPasso(pedido("criar-projeto"), amb.deps)).veredito,
    "SIM",
  );
  assertEquals(
    (await executarPasso(pedido("banco"), amb.deps)).veredito,
    "SIM",
  );
  return amb;
}

Deno.test("ficha: confere store_config id=1 e gera (sem executar) o SQL de frota_lojas e a entrada de lojas.json", async () => {
  const amb = await ateFicha();
  const n = amb.api.escritas().length;
  const r = await executarPasso(pedido("ficha"), amb.deps);
  assertEquals(r.veredito, "SIM", r.mensagem);
  const texto = amb.saida.join("\n");
  assertStringIncludes(
    texto,
    `INSERT INTO public.frota_lojas (id, nome, dominio_publico, project_ref, supabase_url, publishable_key) VALUES ('${SLUG}', '${SLUG}', '${SLUG}.vercel.app', '${REF}', 'https://${REF}.supabase.co', '${PUBLICAVEL}') ON CONFLICT (id) DO NOTHING;`,
  );
  assertStringIncludes(
    texto,
    '"segredoDoToken": "SUPABASE_ACCESS_TOKEN_LOJA_NOVA"',
  );
  assertStringIncludes(texto, '"functionsNomeadas": true');
  // a única escrita da ficha é a LEITURA read_only pelo database/query
  const novas = amb.api.escritas().slice(n);
  assert(
    novas.every(
      (c) =>
        c.caminho.endsWith("/database/query") ||
        c.caminho === "/v1/oauth/token",
    ),
  );
  assertEquals(amb.api.banco.consultas.at(-1), SQL_FICHA);
  // nenhuma chave secreta da loja sai
  assert(!texto.includes(SERVICE_ROLE));
  assert(!texto.includes(SECRETA));
});

Deno.test("ficha: sem a linha id=1 é NÃO", async () => {
  const amb = await ateFicha({
    apiOpcoes: { banco: bancoFalso({ ficha: 0 }) },
  });
  const r = await executarPasso(pedido("ficha"), amb.deps);
  assertEquals(r.veredito, "NÃO");
  assertStringIncludes(r.mensagem, "20261540000000");
});

Deno.test("ficha: linha sem a marca da migration é INCERTO (nunca SIM)", async () => {
  const amb = await ateFicha({
    apiOpcoes: { banco: bancoFalso({ marca: null }) },
  });
  const r = await executarPasso(pedido("ficha"), amb.deps);
  assertEquals(r.veredito, "INCERTO");
});

// ─── estado sem segredo e log sem segredo ───────────────────────────────────

Deno.test("estado sem segredo: o arquivo não guarda token, refresh, código, client_secret, db_pass, e-mail nem chave", async () => {
  const amb = await ateFicha();
  await executarPasso(pedido("ficha"), amb.deps);
  const texto = await lerArquivoDeEstado(amb.pasta);
  const dbPass = await amb.deps.cofreDoBanco.ler(SLUG);
  assert(dbPass && dbPass.length >= 40);
  const proibidos = [
    ACCESS,
    CODIGO,
    CLIENT_SECRET,
    REFRESH_1,
    amb.api.refreshValido,
    dbPass,
    EMAIL,
    PUBLICAVEL,
    SERVICE_ROLE,
    SECRETA,
    "refresh-FALSO",
  ];
  for (const p of proibidos) {
    assert(!texto.includes(p), `estado vazou ${p.slice(0, 12)}…`);
  }
  // e o estado registra o progresso de verdade
  const e = JSON.parse(texto);
  assertEquals(e.passos["criar-projeto"].ref, REF);
  assertEquals(e.passos.banco.veredito, "SIM");
  assertEquals(e.passos.ficha.veredito, "SIM");
});

Deno.test("estado: gravar campo fora da lista branca é recusado (não vai para o disco)", async () => {
  const pasta = await pastaTemporaria();
  const estado = criarEstadoEmArquivo({ pasta });
  let falhou = false;
  try {
    await estado.gravar(SLUG, {
      versao: 1,
      slug: SLUG,
      passos: { "criar-projeto": { veredito: "SIM", dbPass: "x" } },
    });
  } catch {
    falhou = true;
  }
  assert(falhou);
  assertEquals([...Deno.readDirSync(pasta)].length, 0);
});

Deno.test("estado: pasta relativa ou dentro do repositório é recusada", () => {
  assertThrows(() => criarEstadoEmArquivo({ pasta: "relativa/x" }));
  assertThrows(() =>
    criarEstadoEmArquivo({
      pasta: join(Deno.cwd(), "scripts", "frota", "estado-teste"),
    }),
  );
});

Deno.test("código, token, refresh e client_secret nunca aparecem na saída", async () => {
  const amb = await ateFicha();
  await executarPasso(pedido("ficha"), amb.deps);
  // e também no caminho de erro (código recusado pelo Supabase)
  amb.entradas.push(CLIENT_SECRET, "codigo-ERRADO-0123456789");
  await executarPasso(pedido("abrir"), amb.deps);
  const rr = await executarPasso(pedido("receber"), amb.deps);
  assert(rr.veredito !== "SIM");
  const texto = amb.saida.join("\n");
  for (const p of [
    ACCESS,
    CODIGO,
    "codigo-ERRADO",
    CLIENT_SECRET,
    REFRESH_1,
    "refresh-FALSO",
    await amb.deps.cofreDoBanco.ler(SLUG),
    SERVICE_ROLE,
    SECRETA,
    EMAIL,
  ]) {
    assert(!texto.includes(p), `saída vazou ${p.slice(0, 12)}…`);
  }
});

Deno.test("abrir imprime o link de autorização com PKCE e os passos da lojista", async () => {
  const amb = await ambiente();
  amb.entradas.push(CLIENT_SECRET);
  const r = await executarPasso(pedido("abrir"), amb.deps);
  assertEquals(r.veredito, "SIM", r.mensagem);
  const texto = amb.saida.join("\n");
  assertStringIncludes(texto, "https://api.supabase.com/v1/oauth/authorize?");
  assertStringIncludes(texto, "code_challenge_method=S256");
  assertStringIncludes(texto, "POR PESSOA");
});

Deno.test("receber sem abrir antes é NÃO e não lê token nenhum", async () => {
  const amb = await ambiente();
  amb.entradas.push(CODIGO);
  const r = await executarPasso(pedido("receber"), amb.deps);
  assertEquals(r.veredito, "NÃO");
  assertEquals(amb.api.chamadas.length, 0);
});

// ─── argumentos ─────────────────────────────────────────────────────────────

Deno.test("argumentos: forma da chamada e o código NUNCA por argumento", () => {
  const a = lerArgumentos([
    "criar-projeto",
    "--loja",
    SLUG,
    "--aplicar",
    "--org",
    ORG,
  ]);
  assertEquals(a.passo, "criar-projeto");
  assertEquals(a.slug, SLUG);
  assertEquals(a.aplicar, true);
  assertEquals(a.org, ORG);
  assertEquals(lerArgumentos(["banco", "--loja", SLUG]).aplicar, false);
  const e = assertThrows(() =>
    lerArgumentos(["receber", "--loja", SLUG, CODIGO]),
  );
  assert(!e.message.includes(CODIGO));
  assertStringIncludes(e.message, "entrada");
  const e2 = assertThrows(() =>
    lerArgumentos(["receber", "--loja", SLUG, "--codigo", CODIGO]),
  );
  assert(!e2.message.includes(CODIGO));
  assertThrows(() => lerArgumentos(["trocar-dono", "--loja", SLUG]));
  assertThrows(() => lerArgumentos(["banco", "--loja", "Loja Errada"]));
  assertThrows(() => lerArgumentos(["banco"]));
});

// ─── C3: a trava de verdade (achado ANTES DE CRESCER da revisão do C1) ──────

/** fetch que segura a 1ª chamada a `caminho` até `soltar()`. */
function fetchComPortao(fetchFn, caminho) {
  let soltar;
  const portao = new Promise((ok) => {
    soltar = ok;
  });
  let chegou;
  const chegada = new Promise((ok) => {
    chegou = ok;
  });
  let segurou = false;
  const f = async (url, init) => {
    if (!segurou && new URL(String(url)).pathname === caminho) {
      segurou = true;
      chegou();
      await portao;
    }
    return fetchFn(url, init);
  };
  return { fetch: f, soltar: () => soltar(), chegada };
}

Deno.test("trava: dois executarPasso simultâneos na mesma loja — o segundo é NÃO 'outro comando está rodando' e faz 0 fetch", async () => {
  const amb = await ambiente();
  await conectar(amb);
  // o 1º para DEPOIS de renovar o acesso (a trava do cofre já foi solta),
  // no GET das organizações: só a trava do comando segura o 2º
  const p = fetchComPortao(amb.api.fetch, "/v1/organizations");
  const primeiro = executarPasso(pedido("criar-projeto"), {
    ...amb.deps,
    fetch: p.fetch,
  });
  await p.chegada;
  const doSegundo = [];
  const segundo = await executarPasso(pedido("criar-projeto"), {
    ...amb.deps,
    fetch: (url, init) => {
      doSegundo.push(String(url));
      return amb.api.fetch(url, init);
    },
  });
  p.soltar();
  const r1 = await primeiro;
  assertEquals(segundo.veredito, "NÃO", segundo.mensagem);
  assertStringIncludes(segundo.mensagem, "Outro comando");
  assertStringIncludes(segundo.mensagem, "está rodando");
  assertEquals(doSegundo, [], "o segundo chamou a rede");
  assertEquals(r1.veredito, "SIM", r1.mensagem);
  assertEquals(amb.api.posts("/v1/projects").length, 1);
  // e a trava foi solta: o próximo roda
  const r3 = await executarPasso(pedido("criar-projeto"), amb.deps);
  assertEquals(r3.veredito, "SIM", r3.mensagem);
});

/** open() de verdade, mas o handle da TRAVA falha ao escrever. */
function abrirQueFalhaNaTrava(antes = async () => {}) {
  return async (caminho, flags, modo) => {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- caminho da pasta temporária do teste.
    const h = await open(caminho, flags, modo);
    if (!String(caminho).endsWith(".trava")) return h;
    return {
      async writeFile(dados) {
        await antes(caminho, h, String(dados));
        throw Object.assign(new Error(`EIO: falha ao escrever ${caminho}`), {
          code: "EIO",
        });
      },
      close: () => h.close(),
    };
  };
}

Deno.test("trava: a marca não grava = a própria trava apaga o arquivo que criou (nada fica órfão) e o passo não sai", async () => {
  for (const antes of [
    async () => {},
    async (_c, h, marca) => {
      await h.write(marca.slice(0, 5));
    },
  ]) {
    const pasta = await pastaTemporaria();
    const estado = criarEstadoEmArquivo({
      pasta,
      abrirArquivo: abrirQueFalhaNaTrava(antes),
    });
    const e = await estado.travar(SLUG).then(
      () => null,
      (x) => x,
    );
    assert(e, "travar não recusou");
    assertEquals(e.codigo, "TRAVA_NAO_GRAVOU");
    assert(!e.message.includes(pasta), "a mensagem carrega o caminho");
    assert(!e.message.includes("EIO"), "a mensagem carrega o erro cru");
    assertEquals(
      [...Deno.readDirSync(pasta)].map((x) => x.name),
      [],
      "a trava ficou órfã",
    );
    // e pelo comando: não diz SIM e não chama a rede
    const amb = await ambiente({ estado, pasta });
    const r = await executarPasso(pedido("criar-projeto"), amb.deps);
    assert(r.veredito !== "SIM");
    assertEquals(amb.api.chamadas.length, 0);
    assertEquals(
      [...Deno.readDirSync(pasta)].map((x) => x.name),
      [],
    );
    // a loja continua travável por quem vier depois
    const liberar = await criarEstadoEmArquivo({ pasta }).travar(SLUG);
    await liberar();
  }
});

Deno.test("trava: a marca não grava mas o arquivo já é de OUTRO = não apaga a trava alheia", async () => {
  const pasta = await pastaTemporaria();
  const alheia = "99999 2026-11-26T00:00:00.000Z outro-processo";
  const estado = criarEstadoEmArquivo({
    pasta,
    abrirArquivo: abrirQueFalhaNaTrava(async (caminho) => {
      await Deno.writeTextFile(caminho, alheia);
    }),
  });
  const e = await estado.travar(SLUG).then(
    () => null,
    (x) => x,
  );
  assertEquals(e?.codigo, "TRAVA_NAO_GRAVOU");
  assertEquals(await Deno.readTextFile(join(pasta, `${SLUG}.trava`)), alheia);
});

// ─── C3: estado que não grava DEPOIS do POST (achado :266-271) ──────────────

/** O erro que o estado de verdade lança quando o disco falha. */
async function falhaDeGravacao(slug) {
  const pasta = await pastaTemporaria();
  const estado = criarEstadoEmArquivo({
    pasta,
    abrirArquivo: async () => {
      throw Object.assign(new Error("ENOSPC"), { code: "ENOSPC" });
    },
  });
  return await estado.gravar(slug, { versao: 1, slug, passos: {} }).then(
    () => new Error("devia falhar"),
    (e) => e,
  );
}

Deno.test("criar-projeto: o POST deu certo e o estado não grava = INCERTO 'pode ter sido criado'; a retomada acha pelo nome", async () => {
  const amb = await ambiente({ apiOpcoes: { statusSeq: ["COMING_UP"] } });
  await conectar(amb);
  const real = amb.deps.estado;
  const erroDoDisco = await falhaDeGravacao(SLUG);
  assertEquals(erroDoDisco.codigo, "ESTADO_NAO_GRAVOU");
  // o disco "enche" na 1ª gravação DEPOIS do POST (a do ref)
  amb.deps.estado = {
    ler: (s) => real.ler(s),
    travar: (s) => real.travar(s),
    gravar: (s, e) => {
      if (amb.api.posts("/v1/projects").length > 0) throw erroDoDisco;
      return real.gravar(s, e);
    },
  };
  const r1 = await executarPasso(pedido("criar-projeto"), amb.deps);
  assertEquals(r1.veredito, "INCERTO", r1.mensagem);
  assertStringIncludes(r1.mensagem, "PODE ter sido criado");
  assertStringIncludes(r1.mensagem, "pelo nome");
  assertEquals(amb.api.posts("/v1/projects").length, 1);
  // o disco volta: a retomada acha ikcous-loja-nova pelo nome, sem 2º POST
  amb.deps.estado = real;
  amb.api.statusSeq = ["ACTIVE_HEALTHY"];
  const r2 = await executarPasso(pedido("criar-projeto"), amb.deps);
  assertEquals(r2.veredito, "SIM", r2.mensagem);
  assertEquals(amb.api.posts("/v1/projects").length, 1);
});

Deno.test("criar-projeto: o estado não grava ANTES do POST = NÃO, e nenhum POST sai", async () => {
  const amb = await ambiente();
  await conectar(amb);
  const real = amb.deps.estado;
  const erroDoDisco = await falhaDeGravacao(SLUG);
  amb.deps.estado = {
    ler: (s) => real.ler(s),
    travar: (s) => real.travar(s),
    gravar: () => {
      throw erroDoDisco;
    },
  };
  const r = await executarPasso(pedido("criar-projeto"), amb.deps);
  assertEquals(r.veredito, "NÃO", r.mensagem);
  assertEquals(amb.api.posts("/v1/projects").length, 0);
});

// ─── C3: banco com a leitura de conferência caída (achado :839-840) ─────────

Deno.test("banco: envios certos e a releitura de conferência do instalador cai = INCERTO (nunca NÃO); a retomada fecha SIM", async () => {
  const banco = bancoFalso();
  const amb = await ambiente({ apiOpcoes: { banco } });
  await conectar(amb);
  await executarPasso(pedido("criar-projeto"), amb.deps);
  // 1ª leitura do estado: o passo banco; 2ª: o instalar; 3ª: a conferência
  banco.falharEstadoNa = banco.leiturasDoEstado + 3;
  const r = await executarPasso(pedido("banco"), amb.deps);
  assertEquals(r.veredito, "INCERTO", r.mensagem);
  const envelopes = banco.consultas.filter(
    (q) => q.startsWith("BEGIN;\n") && q !== ddlDoLedger(),
  );
  assertEquals(envelopes.length, 2, "os envios foram feitos");
  assertEquals(banco.marcaInstalacao, "em_curso");
  const r2 = await executarPasso(pedido("banco"), amb.deps);
  assertEquals(r2.veredito, "SIM", r2.mensagem);
});

Deno.test("banco: conferência que LÊ e não fecha (versão fora do ledger) continua NÃO", async () => {
  const banco = bancoFalso();
  const responder = banco.responder;
  let leituras = 0;
  banco.responder = (sql) => {
    const r = responder(sql);
    if (sql === SQL_LEDGER && ++leituras >= 2) return r.slice(0, 1);
    return r;
  };
  const amb = await ambiente({ apiOpcoes: { banco } });
  await conectar(amb);
  await executarPasso(pedido("criar-projeto"), amb.deps);
  const r = await executarPasso(pedido("banco"), amb.deps);
  assertEquals(r.veredito, "NÃO", r.mensagem);
});

// ─── C3: o slug que não cabe no cadastro para no abrir ──────────────────────

Deno.test("abrir: loja com mais de 24 caracteres (ou terminada em hífen) é recusada já no abrir, sem rede nem entrada", async () => {
  for (const slug of [
    "a".repeat(25),
    "loja-de-nome-comprido-demais",
    "loja-",
  ]) {
    for (const aplicar of [true, false]) {
      const amb = await ambiente();
      amb.entradas.push(CLIENT_SECRET);
      const r = await executarPasso(
        pedido("abrir", { slug, aplicar }),
        amb.deps,
      );
      assertEquals(r.veredito, "NÃO", `${slug}: ${r.mensagem}`);
      if (slug.length > 24) assertStringIncludes(r.mensagem, "24");
      assertEquals(amb.api.chamadas.length, 0);
      assertEquals(amb.entradas.length, 1, "leu o client_secret");
      assertEquals([...Deno.readDirSync(amb.pasta)].length, 0);
    }
  }
  // o limite exato (24) passa
  const amb = await ambiente();
  amb.entradas.push(CLIENT_SECRET);
  const r = await executarPasso(
    pedido("abrir", { slug: "a".repeat(24) }),
    amb.deps,
  );
  assertEquals(r.veredito, "SIM", r.mensagem);
});

// ─── C3: primeira-admin ─────────────────────────────────────────────────────

Deno.test("primeira-admin: promove pela transação do B3 (SET LOCAL ROLE postgres), e-mail só pela entrada e em lugar nenhum mais", async () => {
  const amb = await ateFicha();
  amb.entradas.push(EMAIL);
  const r = await executarPasso(pedido("primeira-admin"), amb.deps);
  assertEquals(r.veredito, "SIM", r.mensagem);
  assertEquals(amb.entradas.length, 0, "o e-mail não foi lido");
  const promocao = amb.api.banco.consultas.filter(
    (q) => q === sqlDaPromocao(EMAIL),
  );
  assertEquals(promocao.length, 1);
  assertStringIncludes(promocao[0], "SET LOCAL ROLE postgres;");
  assertEquals(amb.api.banco.alvo, "admin");
  const estado = await lerArquivoDeEstado(amb.pasta);
  assertEquals(JSON.parse(estado).passos["primeira-admin"].veredito, "SIM");
  const tudo = `${amb.saida.join("\n")}\n${estado}\n${r.mensagem}`;
  for (const p of [EMAIL, EMAIL.toLowerCase(), EMAIL.toUpperCase(), ACCESS]) {
    assert(!tudo.includes(p), `vazou ${p.slice(0, 8)}…`);
  }
});

Deno.test("primeira-admin: rodar de novo com a mesma pessoa já admin = SIM sem escrita", async () => {
  const amb = await ateFicha();
  amb.entradas.push(EMAIL, EMAIL);
  await executarPasso(pedido("primeira-admin"), amb.deps);
  const antes = amb.api.banco.consultas.length;
  const r = await executarPasso(pedido("primeira-admin"), amb.deps);
  assertEquals(r.veredito, "SIM", r.mensagem);
  const novas = amb.api.banco.consultas.slice(antes);
  assertEquals(novas, [sqlDoDiagnostico(EMAIL)], "gravou de novo");
});

Deno.test("primeira-admin: a loja já tem OUTRA admin = NÃO, nenhuma escrita enviada", async () => {
  const amb = await ateFicha({
    apiOpcoes: { banco: bancoFalso({ outrasAdmins: 1 }) },
  });
  amb.entradas.push(EMAIL);
  const r = await executarPasso(pedido("primeira-admin"), amb.deps);
  assertEquals(r.veredito, "NÃO", r.mensagem);
  assertStringIncludes(r.mensagem, "outra administradora");
  assert(!amb.api.banco.consultas.includes(sqlDaPromocao(EMAIL)));
});

Deno.test("primeira-admin: sem --aplicar nenhuma chamada e o e-mail nem é pedido; sem banco SIM é NÃO", async () => {
  const amb = await ateFicha();
  amb.entradas.push(EMAIL);
  const n = amb.api.chamadas.length;
  const estadoAntes = await lerArquivoDeEstado(amb.pasta);
  const r = await executarPasso(
    pedido("primeira-admin", { aplicar: false }),
    amb.deps,
  );
  assertEquals(r.veredito, "INCERTO");
  assertStringIncludes(r.mensagem, "ENSAIO");
  assertEquals(amb.api.chamadas.length, n);
  assertEquals(amb.entradas.length, 1);
  assertEquals(await lerArquivoDeEstado(amb.pasta), estadoAntes);
  // loja com projeto pronto e SEM banco instalado
  const crua = await ambiente();
  await conectar(crua);
  assertEquals(
    (await executarPasso(pedido("criar-projeto"), crua.deps)).veredito,
    "SIM",
  );
  crua.entradas.push(EMAIL);
  const m = crua.api.chamadas.length;
  const r2 = await executarPasso(pedido("primeira-admin"), crua.deps);
  assertEquals(r2.veredito, "NÃO");
  assertEquals(crua.api.chamadas.length, m);
  assertEquals(crua.entradas.length, 1);
});

Deno.test("primeira-admin: INCERTO do B3 é repassado SEM mandar 'rodar sem --aplicar' (pelo nova-loja isso não lê nada): aponta o conferir", async () => {
  const amb = await ateFicha({
    apiOpcoes: { banco: bancoFalso({ promocaoCai: true }) },
  });
  amb.entradas.push(EMAIL);
  const r = await executarPasso(pedido("primeira-admin"), amb.deps);
  assertEquals(r.veredito, "INCERTO", r.mensagem);
  assert(!/sem --aplicar/i.test(r.mensagem), r.mensagem);
  assertStringIncludes(r.mensagem, "conferir");
  assert(!amb.saida.join("\n").includes(EMAIL));
});

// ─── C2: cadastro, marca e chave-do-plano esperam o portão OAuth ────────────

Deno.test("cadastro: recusa NÃO 'trava a publicação de todas as lojas', com e sem --aplicar, sem rede, trava nem estado", async () => {
  assert(PASSOS.includes("cadastro"));
  assertEquals(
    lerArgumentos(["cadastro", "--loja", SLUG, "--aplicar"]).passo,
    "cadastro",
  );
  const amb = await ateFicha();
  const n = amb.api.chamadas.length;
  const estadoAntes = await lerArquivoDeEstado(amb.pasta);
  for (const aplicar of [true, false]) {
    const r = await executarPasso(pedido("cadastro", { aplicar }), amb.deps);
    assertEquals(r.veredito, "NÃO");
    assertStringIncludes(
      r.mensagem,
      "cadastrar a loja agora trava a publicação de todas as lojas: aguarda o portão ler loja OAuth (CACA-PORTAO-LE-LOJA-NOVA)",
    );
  }
  assertEquals(amb.api.chamadas.length, n);
  assertEquals(await lerArquivoDeEstado(amb.pasta), estadoAntes);
  const travas = [...Deno.readDirSync(amb.pasta)].filter((e) =>
    e.name.endsWith(".trava"),
  );
  assertEquals(travas.length, 0);
});

Deno.test("marca e chave-do-plano: pendentes (NÃO) com o motivo, sem rede nem estado", async () => {
  const amb = await ateFicha();
  const n = amb.api.chamadas.length;
  const estadoAntes = await lerArquivoDeEstado(amb.pasta);
  const marca = await executarPasso(pedido("marca"), amb.deps);
  assertEquals(marca.veredito, "NÃO");
  assertStringIncludes(marca.mensagem, "pendente");
  assertStringIncludes(marca.mensagem, "chave de serviço");
  const chave = await executarPasso(pedido("chave-do-plano"), amb.deps);
  assertEquals(chave.veredito, "NÃO");
  assertStringIncludes(chave.mensagem, "pendente");
  assertStringIncludes(chave.mensagem, "instalar-chave-da-loja.yml");
  assertEquals(amb.api.chamadas.length, n);
  assertEquals(await lerArquivoDeEstado(amb.pasta), estadoAntes);
});

// ─── C2: segredos ───────────────────────────────────────────────────────────

const TOKEN_DO_AMBIENTE = "sbp_DO_AMBIENTE_FALSO_nunca_usar_0123";

Deno.test("segredos: grava pelo B1 com o token OAuth da rodada (NUNCA o SUPABASE_ACCESS_TOKEN do ambiente) e dá SIM conferido", async () => {
  const amb = await ateFicha({
    apiOpcoes: {
      segredos: [],
      banco: bancoFalso({ vault: [], temVapid: false }),
    },
  });
  const n = amb.api.chamadas.length;
  const antigo = Deno.env.get("SUPABASE_ACCESS_TOKEN");
  Deno.env.set("SUPABASE_ACCESS_TOKEN", TOKEN_DO_AMBIENTE);
  let r;
  try {
    r = await executarPasso(pedido("segredos"), amb.deps);
  } finally {
    if (antigo === undefined) Deno.env.delete("SUPABASE_ACCESS_TOKEN");
    else Deno.env.set("SUPABASE_ACCESS_TOKEN", antigo);
  }
  assertEquals(r.veredito, "SIM", r.mensagem);
  const novas = amb.api.chamadas.slice(n);
  for (const c of novas) {
    assert(!c.auth.includes(TOKEN_DO_AMBIENTE), "usou o token do ambiente");
    if (c.caminho !== "/v1/oauth/token")
      assertEquals(c.auth, `Bearer ${ACCESS}`, c.caminho);
  }
  assertEquals(
    novas.filter((c) => c.caminho === "/v1/oauth/token").length,
    1,
    "uma rodada renova uma vez",
  );
  assertEquals(amb.api.posts(`/v1/projects/${REF}/secrets`).length, 1);
  for (const nome of SEGREDOS_DO_B1) assert(amb.api.segredos.includes(nome));
  assert(amb.api.banco.temVapid);
  assertEquals(amb.api.banco.vault.length, 2);
  const estado = await lerArquivoDeEstado(amb.pasta);
  assertEquals(JSON.parse(estado).passos.segredos.veredito, "SIM");
  const tudo = `${amb.saida.join("\n")}\n${estado}\n${r.mensagem}`;
  assert(amb.api.valoresGravados.length >= 4);
  for (const v of amb.api.valoresGravados)
    assert(!tudo.includes(v), "valor de segredo vazou");
  assert(!tudo.includes(ACCESS));
});

Deno.test("segredos: o que já existe fica (SIM sem escrita); sem banco SIM é NÃO sem rede", async () => {
  const amb = await ateFicha();
  const r = await executarPasso(pedido("segredos"), amb.deps);
  assertEquals(r.veredito, "SIM", r.mensagem);
  assertEquals(amb.api.posts(`/v1/projects/${REF}/secrets`).length, 0);
  assert(!amb.api.banco.consultas.some((q) => q.startsWith("BEGIN;\nDO $b1$")));
  const crua = await ambiente();
  await conectar(crua);
  await executarPasso(pedido("criar-projeto"), crua.deps);
  const m = crua.api.chamadas.length;
  const r2 = await executarPasso(pedido("segredos"), crua.deps);
  assertEquals(r2.veredito, "NÃO");
  assertEquals(crua.api.chamadas.length, m);
});

Deno.test("segredos: POST sem resposta (503) é INCERTO repassado, nunca SIM", async () => {
  const amb = await ateFicha({
    apiOpcoes: {
      segredos: [],
      banco: bancoFalso({ vault: [], temVapid: false }),
    },
  });
  amb.api.falharSe = (metodo, caminho) =>
    metodo === "POST" && caminho === `/v1/projects/${REF}/secrets`
      ? 503
      : undefined;
  const r = await executarPasso(pedido("segredos"), amb.deps);
  assertEquals(r.veredito, "INCERTO", r.mensagem);
  assertStringIncludes(r.mensagem, "ESTADO DESCONHECIDO");
  const estado = JSON.parse(await lerArquivoDeEstado(amb.pasta));
  assertEquals(estado.passos.segredos.veredito, "INCERTO");
});

// ─── C2: functions ──────────────────────────────────────────────────────────

Deno.test("functions: publica pelo B2 (HEAD == topo) com o token OAuth, SIM conferido; rodar de novo não republica", async () => {
  const amb = await ateFicha();
  const n = amb.api.chamadas.length;
  const r = await executarPasso(pedido("functions"), amb.deps);
  assertEquals(r.veredito, "SIM", r.mensagem);
  assertEquals([...amb.api.deploys].sort(), [...PUBLICAVEIS].sort());
  for (const c of amb.api.chamadas.slice(n)) {
    if (c.caminho !== "/v1/oauth/token")
      assertEquals(c.auth, `Bearer ${ACCESS}`, c.caminho);
  }
  const estado = JSON.parse(await lerArquivoDeEstado(amb.pasta));
  assertEquals(estado.passos.functions.veredito, "SIM");
  const de = amb.api.deploys.length;
  const r2 = await executarPasso(pedido("functions"), amb.deps);
  assertEquals(r2.veredito, "SIM", r2.mensagem);
  assertEquals(amb.api.deploys.length, de, "republicou");
  assert(!amb.saida.join("\n").includes(ACCESS));
});

Deno.test("functions: HEAD diferente do topo da release = NÃO com a recusa do B2 repassada e 0 chamadas ao Supabase", async () => {
  const amb = await ateFicha({ git: gitFalso({ head: OUTRO_SHA }) });
  const n = amb.api.chamadas.length;
  const r = await executarPasso(pedido("functions"), amb.deps);
  assertEquals(r.veredito, "NÃO");
  assertStringIncludes(r.mensagem, "não é o topo");
  assertEquals(amb.api.chamadas.length, n);
  assertEquals(amb.api.deploys.length, 0);
});

Deno.test("functions: deploy da ÚLTIMA sem resposta (504) = INCERTO repassado, nunca SIM", async () => {
  const amb = await ateFicha();
  const ultima = PUBLICAVEIS.at(-1);
  let falhou = false;
  amb.api.falharSe = (metodo, caminho) => {
    if (
      !falhou &&
      metodo === "POST" &&
      caminho === `/v1/projects/${REF}/functions/deploy` &&
      amb.api.deploys.length === PUBLICAVEIS.length - 1
    ) {
      falhou = true;
      return 504;
    }
    return undefined;
  };
  const r = await executarPasso(pedido("functions"), amb.deps);
  assert(falhou, `a falha não foi injetada (${ultima})`);
  assertEquals(r.veredito, "INCERTO", r.mensagem);
});

// ─── C2: login ──────────────────────────────────────────────────────────────

Deno.test("login: endereços de <slug>.vercel.app e gancho DESLIGADO pelo B4 com o token OAuth; SIM conferido; o segredo do gancho não sai", async () => {
  const amb = await ateFicha();
  const n = amb.api.chamadas.length;
  const r = await executarPasso(pedido("login"), amb.deps);
  assertEquals(r.veredito, "SIM", r.mensagem);
  assertEquals(amb.api.auth.site_url, `https://${SLUG}.vercel.app`);
  assertStringIncludes(
    amb.api.auth.uri_allow_list,
    `https://${SLUG}.vercel.app/**`,
  );
  assertEquals(amb.api.auth.hook_send_email_enabled, false);
  assert(amb.api.segredos.includes("SEND_EMAIL_HOOK_SECRET"));
  for (const c of amb.api.chamadas.slice(n)) {
    if (c.caminho !== "/v1/oauth/token")
      assertEquals(c.auth, `Bearer ${ACCESS}`, c.caminho);
  }
  const estado = await lerArquivoDeEstado(amb.pasta);
  assertEquals(JSON.parse(estado).passos.login.veredito, "SIM");
  const tudo = `${amb.saida.join("\n")}\n${estado}\n${r.mensagem}`;
  for (const v of amb.api.valoresGravados) assert(!tudo.includes(v));
  assert(!tudo.includes(amb.api.auth.hook_send_email_secrets));
  // de novo: as duas pontas presentes, nada a gravar
  const m = amb.api.escritas().length;
  const r2 = await executarPasso(pedido("login"), amb.deps);
  assertEquals(r2.veredito, "SIM", r2.mensagem);
  const novas = amb.api
    .escritas()
    .slice(m)
    .filter((c) => !c.caminho.endsWith("/database/query"));
  assertEquals(novas.filter((c) => c.caminho !== "/v1/oauth/token").length, 0);
});

Deno.test("login: meia configuração do gancho = NÃO repassado e 0 escritas", async () => {
  const amb = await ateFicha();
  amb.api.auth.hook_send_email_enabled = true;
  const r = await executarPasso(pedido("login"), amb.deps);
  assertEquals(r.veredito, "NÃO", r.mensagem);
  assertStringIncludes(r.mensagem, "meia configuração");
  assertEquals(
    amb.api.chamadas.filter(
      (c) =>
        (c.metodo === "PATCH" || c.metodo === "POST") &&
        (c.caminho.endsWith("/config/auth") || c.caminho.endsWith("/secrets")),
    ).length,
    0,
  );
});

Deno.test("login: INCERTO do B4 é repassado SEM mandar 'rodar sem --aplicar': aponta o conferir", async () => {
  const amb = await ateFicha();
  let leituras = 0;
  amb.api.falharSe = (metodo, caminho) => {
    if (metodo === "GET" && caminho === `/v1/projects/${REF}/config/auth`) {
      leituras += 1;
      if (leituras === 2) return 503;
    }
    return undefined;
  };
  const r = await executarPasso(pedido("login"), amb.deps);
  assertEquals(r.veredito, "INCERTO", r.mensagem);
  assert(!/sem --aplicar/i.test(r.mensagem), r.mensagem);
  assert(
    !/sem --aplicar/i.test(amb.saida.join("\n")),
    "a saída manda tirar o --aplicar",
  );
  assertStringIncludes(r.mensagem, "conferir");
});

// ─── C2: definir-dono ───────────────────────────────────────────────────────

/** Até a primeira-admin (a lojista admin única), com o banco escolhido. */
async function ateADona(o = {}) {
  const amb = await ateFicha(o);
  amb.entradas.push(EMAIL);
  const r = await executarPasso(pedido("primeira-admin"), amb.deps);
  assertEquals(r.veredito, "SIM", r.mensagem);
  return amb;
}

const escritasDoDono = (amb) =>
  amb.api.banco.consultas.filter((q) => q === SQL_DEFINIR_DONO).length;

Deno.test("definir-dono: sem dono e 1 admin (nas duas fontes, confirmada) = grava numa transação protegida, confere pela 88c e dá SIM; sem e-mail", async () => {
  const amb = await ateADona();
  const n = amb.api.chamadas.length;
  const r = await executarPasso(pedido("definir-dono"), amb.deps);
  assertEquals(r.veredito, "SIM", r.mensagem);
  assertEquals(amb.api.banco.dono, "alvo");
  assertEquals(escritasDoDono(amb), 1);
  assertEquals(amb.entradas.length, 0, "pediu entrada");
  // a escrita: trava, papel do dono da tabela, sem e-mail, e as guardas
  for (const t of [
    "BEGIN ISOLATION LEVEL READ COMMITTED;",
    "SET LOCAL ROLE postgres;",
    "pg_advisory_xact_lock",
    "LOCK TABLE public.dono_da_loja",
    "INSERT INTO public.dono_da_loja (user_id) VALUES (v_id)",
    "IF v_admins > 1 THEN",
    "IF v_donos > 0 THEN",
    "email_confirmed_at",
    "COMMIT;",
  ])
    assertStringIncludes(SQL_DEFINIR_DONO, t);
  assert(!SQL_DEFINIR_DONO.includes("@"), "e-mail no SQL");
  assert(!/lower\(u\.email\)/.test(SQL_DEFINIR_DONO));
  // leu antes (só leitura) e releu depois (critério da 88c)
  assertEquals(amb.api.banco.leiturasDoDono, 2);
  const consultas = amb.api.chamadas
    .slice(n)
    .filter((c) => c.caminho.endsWith("/database/query"));
  assertEquals(
    consultas.filter((c) => c.somenteLeitura !== true).length,
    1,
    "só a transação escreve",
  );
  const estado = JSON.parse(await lerArquivoDeEstado(amb.pasta));
  assertEquals(estado.passos["definir-dono"].veredito, "SIM");
});

Deno.test("definir-dono: dono igual à admin única = SIM sem gravar (rodar de novo é seguro)", async () => {
  const amb = await ateADona();
  await executarPasso(pedido("definir-dono"), amb.deps);
  const r = await executarPasso(pedido("definir-dono"), amb.deps);
  assertEquals(r.veredito, "SIM", r.mensagem);
  assertEquals(escritasDoDono(amb), 1, "gravou de novo");
});

Deno.test("definir-dono: dono DIFERENTE da admin única = NÃO, não troca, e diz que trocar é pedido da dona", async () => {
  const amb = await ateADona({
    apiOpcoes: { banco: bancoFalso({ dono: "ex" }) },
  });
  const r = await executarPasso(pedido("definir-dono"), amb.deps);
  assertEquals(r.veredito, "NÃO");
  assertStringIncludes(r.mensagem, "pedido da dona");
  assertEquals(escritasDoDono(amb), 0);
  assertEquals(amb.api.banco.dono, "ex");
});

Deno.test("definir-dono: dono que não é mais admin (loja sem admin) = NÃO, nada gravado", async () => {
  const amb = await ateFicha({
    apiOpcoes: { banco: bancoFalso({ dono: "ex" }) },
  });
  const r = await executarPasso(pedido("definir-dono"), amb.deps);
  assertEquals(r.veredito, "NÃO");
  assertStringIncludes(r.mensagem, "não é mais administrador");
  assertEquals(escritasDoDono(amb), 0);
});

Deno.test("definir-dono: 0 admins = NÃO 'rode primeira-admin'", async () => {
  const amb = await ateFicha();
  const r = await executarPasso(pedido("definir-dono"), amb.deps);
  assertEquals(r.veredito, "NÃO");
  assertStringIncludes(r.mensagem, "primeira-admin");
  assertEquals(escritasDoDono(amb), 0);
});

Deno.test("definir-dono: 2 admins = NÃO, não escolhe ninguém (nem a primeira)", async () => {
  const amb = await ateFicha({
    apiOpcoes: { banco: bancoFalso({ alvo: "admin", outrasAdmins: 1 }) },
  });
  const r = await executarPasso(pedido("definir-dono"), amb.deps);
  assertEquals(r.veredito, "NÃO");
  assertStringIncludes(r.mensagem, "não escolho");
  assertEquals(escritasDoDono(amb), 0);
  assertEquals(amb.api.banco.dono, null);
});

Deno.test("definir-dono: fontes do cargo discordam, ou e-mail não confirmado = NÃO, nada gravado", async () => {
  for (const [banco, texto] of [
    [bancoFalso({ alvo: "admin", fontesDiscordam: true }), "fontes do cargo"],
    [bancoFalso({ alvo: "admin", confirmada: false }), "confirmou o e-mail"],
  ]) {
    const amb = await ateFicha({ apiOpcoes: { banco } });
    const r = await executarPasso(pedido("definir-dono"), amb.deps);
    assertEquals(r.veredito, "NÃO", r.mensagem);
    assertStringIncludes(r.mensagem, texto);
    assertEquals(escritasDoDono(amb), 0);
  }
});

Deno.test("definir-dono: dono cadastrado e admin, com outras admins = SIM sem gravar", async () => {
  const amb = await ateFicha({
    apiOpcoes: {
      banco: bancoFalso({ alvo: "admin", outrasAdmins: 1, dono: "alvo" }),
    },
  });
  const r = await executarPasso(pedido("definir-dono"), amb.deps);
  assertEquals(r.veredito, "SIM", r.mensagem);
  assertEquals(escritasDoDono(amb), 0);
});

Deno.test("definir-dono: leitura que falha = INCERTO e nada gravado; tabela do dono ausente = NÃO", async () => {
  const amb = await ateADona();
  amb.api.banco.leituraDoDonoCaiNa = 1;
  const r = await executarPasso(pedido("definir-dono"), amb.deps);
  assertEquals(r.veredito, "INCERTO", r.mensagem);
  assertEquals(escritasDoDono(amb), 0);
  const sem = await ateADona({
    apiOpcoes: { banco: bancoFalso({ donoTabela: false }) },
  });
  const r2 = await executarPasso(pedido("definir-dono"), sem.deps);
  assertEquals(r2.veredito, "NÃO");
  assertStringIncludes(r2.mensagem, "20261383000000");
  assertEquals(escritasDoDono(sem), 0);
});

Deno.test("definir-dono: escrita sem resposta = INCERTO (nunca SIM); repetir é seguro e fecha SIM", async () => {
  const amb = await ateADona();
  amb.api.banco.escritaDoDonoCai = true;
  const r = await executarPasso(pedido("definir-dono"), amb.deps);
  assertEquals(r.veredito, "INCERTO", r.mensagem);
  assert(!/sem --aplicar/i.test(r.mensagem));
  amb.api.banco.escritaDoDonoCai = false;
  const r2 = await executarPasso(pedido("definir-dono"), amb.deps);
  assertEquals(r2.veredito, "SIM", r2.mensagem);
  assertEquals(amb.api.banco.dono, "alvo");
});

Deno.test("definir-dono: a transação gravou mas a releitura cai = INCERTO, não SIM", async () => {
  const amb = await ateADona();
  amb.api.banco.leituraDoDonoCaiNa = 2;
  const r = await executarPasso(pedido("definir-dono"), amb.deps);
  assertEquals(r.veredito, "INCERTO", r.mensagem);
  assertEquals(amb.api.banco.dono, "alvo");
});

Deno.test("definir-dono: NUNCA na savy nem na ikcous-publicada — pelo slug (sem rede, trava nem estado) e pelo ref do estado", async () => {
  for (const slug of ["savy", "ikcous-publicada"]) {
    const amb = await ambiente();
    for (const aplicar of [true, false]) {
      const r = await executarPasso(
        { passo: "definir-dono", slug, aplicar },
        amb.deps,
      );
      assertEquals(r.veredito, "NÃO", r.mensagem);
      assertStringIncludes(r.mensagem, "nunca");
    }
    assertEquals(amb.api.chamadas.length, 0);
    assertEquals([...Deno.readDirSync(amb.pasta)].length, 0);
  }
  // loja com outro nome, mas o estado aponta o projeto da Savy (ou da IKCOUS)
  for (const ref of [REF_SAVY, REF_IKCOUS]) {
    const amb = await ambiente();
    await conectar(amb);
    const e = JSON.parse(await lerArquivoDeEstado(amb.pasta));
    e.passos["criar-projeto"] = { veredito: "SIM", ref, org: ORG };
    e.passos.banco = { veredito: "SIM" };
    await amb.deps.estado.gravar(SLUG, e);
    const n = amb.api.chamadas.length;
    for (const aplicar of [true, false]) {
      const r = await executarPasso(
        pedido("definir-dono", { aplicar }),
        amb.deps,
      );
      assertEquals(r.veredito, "NÃO", r.mensagem);
      assertStringIncludes(r.mensagem, "nunca");
    }
    assertEquals(amb.api.chamadas.length, n, "falou com a loja protegida");
  }
});

Deno.test("definir-dono: só em loja aberta pelo nova-loja (sem estado local = NÃO sem rede); lojas.json ilegível = INCERTO sem rede", async () => {
  const amb = await ambiente();
  const r = await executarPasso(pedido("definir-dono"), amb.deps);
  assertEquals(r.veredito, "NÃO");
  assertEquals(amb.api.chamadas.length, 0);
  const comLoja = await ateADona();
  comLoja.deps.lojasBrutas = () => {
    throw new Error("disco");
  };
  const n = comLoja.api.chamadas.length;
  const r2 = await executarPasso(pedido("definir-dono"), comLoja.deps);
  assertEquals(r2.veredito, "INCERTO", r2.mensagem);
  assertEquals(comLoja.api.chamadas.length, n);
  assertEquals(escritasDoDono(comLoja), 0);
});

// ─── conferir ───────────────────────────────────────────────────────────────

Deno.test("vereditoGeral: SIM só com todos SIM; INCERTO nunca vira SIM; lista vazia não é SIM", () => {
  const i = (veredito) => ({ item: "x", veredito, detalhe: "" });
  assertEquals(vereditoGeral([i("SIM"), i("SIM")]), "SIM");
  assertEquals(vereditoGeral([i("SIM"), i("INCERTO")]), "INCERTO");
  assertEquals(vereditoGeral([i("INCERTO"), i("NÃO")]), "NÃO");
  assertEquals(vereditoGeral([i("SIM"), i("NÃO")]), "NÃO");
  assertEquals(vereditoGeral([]), "NÃO");
  assertEquals(vereditoGeral([i("SIM"), i("talvez")]), "INCERTO");
});

/** Todos os passos ligados, cada um com SIM. */
async function ateConferir(o = {}) {
  const amb = await ateADona(o);
  for (const passo of ["segredos", "functions", "login", "definir-dono"]) {
    const r = await executarPasso(pedido(passo), amb.deps);
    assertEquals(r.veredito, "SIM", `${passo}: ${r.mensagem}`);
  }
  return amb;
}

const porItem = (r) =>
  Object.fromEntries(r.itens.map((i) => [i.item, i.veredito]));

Deno.test("conferir: todos os passos ligados dão SIM item a item; só cadastro, marca e chave-do-plano ficam pendentes (NÃO); só leitura", async () => {
  const amb = await ateConferir();
  const n = amb.api.chamadas.length;
  const deploys = amb.api.deploys.length;
  const estadoAntes = await lerArquivoDeEstado(amb.pasta);
  const r = await executarPasso(pedido("conferir"), amb.deps);
  const v = porItem(r);
  for (const k of [
    "projeto",
    "banco",
    "ficha",
    "segredos",
    "reconciliação",
    "functions",
    "login",
    "admin",
    "definir-dono",
  ]) {
    assertEquals(Reflect.get(v, k), "SIM", `${k}: ${JSON.stringify(r.itens)}`);
  }
  const pendentes = r.itens.filter((i) =>
    i.detalhe.startsWith("pendente: passo"),
  );
  assertEquals(pendentes.map((i) => i.item).sort(), [
    "cadastro",
    "chave-do-plano",
    "marca",
  ]);
  assert(pendentes.every((i) => i.veredito === "NÃO"));
  assertEquals(r.veredito, "NÃO");
  // só leitura: além de renovar o acesso, só GET e consultas read_only
  const novas = amb.api.chamadas.slice(n);
  for (const c of novas) {
    if (c.metodo === "GET") continue;
    if (c.caminho === "/v1/oauth/token") continue;
    assert(c.caminho.endsWith("/database/query"), `${c.metodo} ${c.caminho}`);
    assertEquals(c.somenteLeitura, true, "consulta sem read_only");
  }
  assertEquals(
    novas.filter((c) => c.caminho === "/v1/oauth/token").length,
    1,
    "a conferência renova uma vez só",
  );
  assertEquals(amb.api.deploys.length, deploys);
  assertEquals(await lerArquivoDeEstado(amb.pasta), estadoAntes);
  const texto = amb.saida.join("\n");
  assert(!texto.includes(DIGEST_DO_SEGREDO), "o digest do segredo saiu");
  assert(!texto.includes(EMAIL));
});

Deno.test("conferir: segredo faltando, 0 admin, sem functions, login, nem dono, e reconciliação que não rodou = NÃO com o nome do que falta", async () => {
  const amb = await ateFicha({
    apiOpcoes: {
      segredos: ["MP_CHAVES_ENCRYPTION_KEY"],
      banco: bancoFalso({ idadeRodada: null }),
    },
  });
  const r = await executarPasso(pedido("conferir"), amb.deps);
  const v = porItem(r);
  assertEquals(v.segredos, "NÃO");
  assertEquals(v.admin, "NÃO");
  assertEquals(v.reconciliação, "NÃO");
  assertEquals(v.functions, "NÃO");
  assertEquals(v.login, "NÃO");
  assertEquals(Reflect.get(v, "definir-dono"), "NÃO");
  const seg = r.itens.find((i) => i.item === "segredos");
  assertStringIncludes(seg.detalhe, "VAPID_PRIVATE_KEY");
  assertEquals(r.veredito, "NÃO");
  assertEquals(amb.api.deploys.length, 0);
});

Deno.test("conferir: reconciliação DEGRADADA = NÃO mostrando rodadas_degradadas_seguidas, mesmo tendo rodado há pouco", async () => {
  const amb = await ateConferir({
    apiOpcoes: {
      banco: bancoFalso({
        idadeRodada: 60,
        degradado: true,
        rodadasDegradadas: 4,
      }),
    },
  });
  const r = await executarPasso(pedido("conferir"), amb.deps);
  const rec = r.itens.find((i) => i.item === "reconciliação");
  assertEquals(rec.veredito, "NÃO", rec.detalhe);
  assertStringIncludes(rec.detalhe, "rodadas_degradadas_seguidas");
  assertStringIncludes(rec.detalhe, "4");
  assertEquals(r.veredito, "NÃO");
});

Deno.test("conferir: dono que não é mais admin = NÃO no item definir-dono", async () => {
  const amb = await ateConferir();
  amb.api.banco.dono = "ex";
  const r = await executarPasso(pedido("conferir"), amb.deps);
  assertEquals(Reflect.get(porItem(r), "definir-dono"), "NÃO");
});

Deno.test("conferir: leitura que cai é INCERTO no item (nunca SIM); sem projeto no estado é NÃO sem rede; sem --aplicar 0 chamadas", async () => {
  const amb = await ateConferir();
  const responder = amb.api.banco.responder;
  amb.api.banco.responder = (sql) => {
    if (sql === SQL_ADMINS || sql === SQL_DONO)
      throw Object.assign(new Error("caiu"), { http: 503 });
    return responder(sql);
  };
  const r = await executarPasso(pedido("conferir"), amb.deps);
  assertEquals(porItem(r).admin, "INCERTO");
  assertEquals(Reflect.get(porItem(r), "definir-dono"), "INCERTO");
  assert(r.veredito !== "SIM");
  // ensaio
  const n = amb.api.chamadas.length;
  const e = await executarPasso(
    pedido("conferir", { aplicar: false }),
    amb.deps,
  );
  assertStringIncludes(e.mensagem, "ENSAIO");
  assert(e.veredito !== "SIM");
  assertEquals(amb.api.chamadas.length, n);
  // loja sem projeto
  const crua = await ambiente();
  await conectar(crua);
  const m = crua.api.chamadas.length;
  const r2 = await executarPasso(pedido("conferir"), crua.deps);
  assertEquals(r2.veredito, "NÃO");
  assertEquals(porItem(r2).projeto, "NÃO");
  assertEquals(crua.api.chamadas.length, m);
});
