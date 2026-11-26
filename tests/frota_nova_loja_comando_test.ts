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
import { createHash, createHmac } from "node:crypto";
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
  PRAZO_DA_TROCA_MS,
  SQL_ADMINS,
  SQL_DEFINIR_DONO,
  SQL_DONO,
  SQL_DONO_EXISTE,
  SQL_FICHA,
  criarEstadoEmArquivo,
  decidirTroca,
  executarPasso,
  lerArgumentos,
  mascararEmail,
  resultadoDaTroca,
  sqlDaTroca,
  sqlTrocarDono,
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
  // a admin única está banida ou apagada no Supabase (IKT06)
  bloqueada = false,
  // só a transação vê o bloqueio (aconteceu depois da leitura)
  bloqueadaNaEscrita = false,
  // store_config.dominio_publico da ficha id = 1
  dominio = null,
  // passo dominio: outro valor gravado por fora ENTRE a leitura e o UPDATE
  dominioNaEscrita = undefined,
  // passo dominio: o UPDATE sem resposta (gateway) ou recusado pela trava
  escritaDoDominioCai = false,
  travaDoDominio = false,
  // passo dominio: a N-ésima leitura de SQL_FICHA cai
  leituraDaFichaCaiNa = null,
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
    bloqueada,
    bloqueadaNaEscrita,
    dominio,
    dominioNaEscrita,
    escritaDoDominioCai,
    travaDoDominio,
    leituraDaFichaCaiNa,
    leiturasDaFicha: 0,
    escritasDoDominio: 0,
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
        b.leiturasDaFicha += 1;
        if (b.leiturasDaFicha === b.leituraDaFichaCaiNa)
          throw Object.assign(new Error("caiu"), { http: 503 });
        return [
          {
            ficha: b.ficha,
            marca: b.marcaDaFicha,
            dominio_publico: b.dominio,
          },
        ];
      }
      // o passo dominio: o UPDATE com a MESMA semântica do Postgres (a
      // guarda `AND dominio_publico IS NULL` decide se sobrescreve)
      const u =
        /^UPDATE public\.store_config SET dominio_publico = '([a-z0-9.-]+)' WHERE id = 1( AND dominio_publico IS NULL)?;$/.exec(
          sql,
        );
      if (u) {
        b.escritasDoDominio += 1;
        if (b.dominioNaEscrita !== undefined) b.dominio = b.dominioNaEscrita;
        if (b.escritaDoDominioCai)
          throw Object.assign(new Error("gateway"), { http: 504 });
        if (b.travaDoDominio)
          throw Object.assign(new Error("DOMINIO_PUBLICO_SO_MUDA_PELA_FROTA"), {
            sqlstate: "42501",
          });
        if (b.ficha === 1 && (!u[2] || b.dominio === null)) b.dominio = u[1];
        return [];
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
          bloqueada: nasDuas > 0 && b.bloqueada,
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
        if (b.bloqueada || b.bloqueadaNaEscrita) throw recusa("IKT06");
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
    apagamentos: 0,
    ler: (slug) => base.ler(slug),
    apagar: (slug) => {
      c.apagamentos += 1;
      return base.apagar(slug);
    },
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
    // o e-mail da nova dona entre a fase 1 e a fase 2 do trocar-dono
    cofreDaTroca: o.cofreDaTroca ?? cofreEspiao([]),
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

const pedido = (passo, extra = {}) => {
  const p = {
    passo,
    slug: SLUG,
    aplicar: true,
    clientId: CLIENT_ID,
    redirect: REDIRECT,
    org: ORG,
    ...extra,
  };
  // autorizar é da org central: nunca leva --loja
  if (passo === "autorizar" && !Object.hasOwn(extra, "slug"))
    Reflect.deleteProperty(p, "slug");
  return p;
};

/** A chave do cofre da autorização da org (scripts/frota/org-central.json). */
const CHAVE_DA_ORG = "org-ikcous-lojas";

/** autorizar + autorizar --receber com --aplicar: a ORG fica conectada
 * (refresh no cofre sob a chave da org); toda loja usa essa autorização. */
async function conectar(amb) {
  amb.entradas.push(CLIENT_SECRET, CODIGO);
  const a = await executarPasso(pedido("autorizar"), amb.deps);
  assertEquals(a.veredito, "SIM", a.mensagem);
  const r = await executarPasso(
    pedido("autorizar", { receber: true }),
    amb.deps,
  );
  assertEquals(r.veredito, "SIM", r.mensagem);
}

async function lerArquivoDeEstado(pasta) {
  return await Deno.readTextFile(join(pasta, `${SLUG}.json`));
}

// ─── 0 escritas sem --aplicar ───────────────────────────────────────────────

const PASSOS_COM_ENSAIO = [
  "autorizar",
  "criar-projeto",
  "banco",
  "ficha",
  "dominio",
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
  assertEquals(amb.deps.cofreDaTroca.gravacoes, 0);
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

// ─── A7: criar-projeto na org central, sem adotar projeto alheio ────────────

Deno.test("A7: sem --org, com a org central ainda sem slug (org-central.json de hoje) = NÃO antes de qualquer fetch", async () => {
  const amb = await ambiente();
  await conectar(amb);
  const n = amb.api.chamadas.length;
  for (const aplicar of [true, false]) {
    const r = await executarPasso(
      pedido("criar-projeto", { org: undefined, aplicar }),
      amb.deps,
    );
    assertEquals(r.veredito, "NÃO", r.mensagem);
    assertStringIncludes(r.mensagem, "org central ainda não criada");
  }
  assertEquals(amb.api.chamadas.length, n);
  assertEquals(amb.deps.cofreDoBanco.gravacoes, 0);
});

Deno.test("A7: sem --org usa o slug de org-central.json — cria nela e confere que a autorização cobre exatamente ela", async () => {
  const amb = await ambiente();
  amb.deps.orgCentral = () => ({ slug: ORG, nome: "IKCOUS Lojas" });
  await conectar(amb);
  const r = await executarPasso(
    pedido("criar-projeto", { org: undefined }),
    amb.deps,
  );
  assertEquals(r.veredito, "SIM", r.mensagem);
  assertEquals(amb.api.corposDoPostProjeto[0].organization_slug, ORG);
  // a org central apontando OUTRA org que a autorizada: para antes do POST
  const outra = await ambiente();
  outra.deps.orgCentral = () => ({ slug: OUTRA_ORG, nome: "IKCOUS Lojas" });
  await conectar(outra);
  const r2 = await executarPasso(
    pedido("criar-projeto", { org: undefined }),
    outra.deps,
  );
  assertEquals(r2.veredito, "NÃO", r2.mensagem);
  assertStringIncludes(r2.mensagem, "exatamente a organização");
  assertEquals(outra.api.posts("/v1/projects").length, 0);
});

Deno.test("A7: a retomada pelo nome RECUSA projeto cujo ref é de loja conhecida (refs fixos, lojas.json ou canais), mesmo chamado ikcous-<slug>", async () => {
  const REF_DO_LOJAS_JSON = "refdeoutralojaaaaaaa";
  const REF_DO_CANAL = "refdeumcanalaaaaaaaa";
  for (const ref of [REF_SAVY, REF_IKCOUS, REF_DO_LOJAS_JSON, REF_DO_CANAL]) {
    const amb = await ambiente({
      apiOpcoes: {
        projetos: [
          {
            ref,
            name: NOME_DO_PROJETO,
            organization_id: ORG,
            organization_slug: ORG,
            status: "ACTIVE_HEALTHY",
          },
        ],
      },
    });
    const lojas = structuredClone(LOJAS_BRUTAS);
    lojas.lojas["outra-loja"] = {
      ...lojas.lojas.savy,
      ref: REF_DO_LOJAS_JSON,
      segredoDoToken: "SUPABASE_ACCESS_TOKEN_LOJAS",
    };
    amb.deps.lojasBrutas = () => structuredClone(lojas);
    amb.deps.canaisBrutos = () => ({ canais: { [REF_DO_CANAL]: {} } });
    await conectar(amb);
    const r = await executarPasso(pedido("criar-projeto"), amb.deps);
    assertEquals(r.veredito, "NÃO", `${ref}: ${r.mensagem}`);
    assertStringIncludes(r.mensagem, "nunca adoto");
    assertEquals(amb.api.posts("/v1/projects").length, 0, ref);
    const e = await amb.deps.estado.ler(SLUG);
    assertEquals(e?.passos?.["criar-projeto"]?.ref, undefined, ref);
  }
  // lojas.json ou canais ilegível: não dá para conferir = INCERTO, nada adotado
  const amb = await ambiente({
    apiOpcoes: {
      projetos: [
        {
          ref: REF,
          name: NOME_DO_PROJETO,
          organization_id: ORG,
          organization_slug: ORG,
          status: "ACTIVE_HEALTHY",
        },
      ],
    },
  });
  amb.deps.canaisBrutos = () => {
    throw new Error("ilegível");
  };
  await conectar(amb);
  const r = await executarPasso(pedido("criar-projeto"), amb.deps);
  assertEquals(r.veredito, "INCERTO", r.mensagem);
  assertEquals(
    (await amb.deps.estado.ler(SLUG))?.passos?.["criar-projeto"]?.ref,
    undefined,
  );
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

Deno.test("banco: 290 migrations contra o limite da Management API (120/min por projeto) terminam SIM, sem 429; o ritmo corre no relógio do passo", async () => {
  const amb = await ambiente();
  await conectar(amb);
  await executarPasso(pedido("criar-projeto"), amb.deps);
  amb.deps.arquivos = () =>
    Array.from({ length: 290 }, (_v, i) => ({
      arquivo: `20260101${String(i).padStart(6, "0")}_m${i}.sql`,
      corpo: "SELECT 1;",
    }));
  // o gateway: mais de 120 database/query em 60 s (janela DESLIZANTE, mais
  // dura que a do servidor) = 429, no relógio falso do ambiente
  const envios = [];
  let recusas = 0;
  amb.api.falharSe = (metodo, caminho) => {
    if (metodo !== "POST" || !caminho.endsWith("/database/query")) return;
    const t = amb.relogio.agora();
    envios.push(t);
    if (envios.filter((x) => x > t - 60_000).length > 120) {
      recusas += 1;
      return 429;
    }
  };
  const sonecasAntes = amb.relogio.sonecas.length;
  const r = await executarPasso(pedido("banco"), amb.deps);
  assertEquals(r.veredito, "SIM", r.mensagem);
  assertEquals(recusas, 0, "nenhum pedido passou do limite");
  assert(envios.length > 290, `${envios.length} pedidos ao database/query`);
  const pico = Math.max(
    ...envios.map((t) => envios.filter((x) => x >= t && x < t + 60_000).length),
  );
  assert(pico <= 101, `no máximo ~100 por minuto (pico ${pico})`);
  // o ritmo usa o d.dormir do passo (falso aqui): nada esperou de verdade
  const sonecas = amb.relogio.sonecas.slice(sonecasAntes);
  assert(sonecas.length >= 290, `${sonecas.length} esperas`);
  assert(
    sonecas.every((ms) => ms > 0 && ms <= 600),
    JSON.stringify(sonecas.slice(0, 10)),
  );
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

// ─── dominio: a ficha declara o domínio da loja nova ────────────────────────
// Sem store_config.dominio_publico o porteiro responde 503 (sem-loja) e o
// identidade-bootstrap --alvo-novo recusa: nada mais o grava numa loja nova.

const DOMINIO = `${SLUG}.vercel.app`;
// o texto EXATO, escrito à mão (não importado): mudar a guarda reprova aqui
const UPDATE_DO_DOMINIO = `UPDATE public.store_config SET dominio_publico = '${DOMINIO}' WHERE id = 1 AND dominio_publico IS NULL;`;
const escritasDoDominio = (amb) =>
  amb.api.banco.consultas.filter((q) =>
    q.startsWith("UPDATE public.store_config"),
  ).length;
const consultasDesde = (amb, n) =>
  amb.api.chamadas
    .slice(n)
    .filter((c) => c.caminho.endsWith("/database/query"));

/** Até a ficha SIM (o passo dominio exige a ficha conferida). */
async function ateDominio(o = {}) {
  const amb = await ateFicha(o);
  const f = await executarPasso(pedido("ficha"), amb.deps);
  assertEquals(f.veredito, "SIM", f.mensagem);
  return amb;
}

Deno.test("dominio: ficha com o domínio vazio = manda EXATAMENTE o UPDATE guardado (sem read_only), relê (read_only) e dá SIM", async () => {
  const amb = await ateDominio();
  const n = amb.api.chamadas.length;
  const m = amb.api.banco.consultas.length;
  const r = await executarPasso(pedido("dominio"), amb.deps);
  assertEquals(r.veredito, "SIM", r.mensagem);
  assertStringIncludes(r.mensagem, DOMINIO);
  assertEquals(amb.api.banco.dominio, DOMINIO);
  // lê, grava, relê: nesta ordem, só estas três consultas
  assertEquals(amb.api.banco.consultas.slice(m), [
    SQL_FICHA,
    UPDATE_DO_DOMINIO,
    SQL_FICHA,
  ]);
  assertEquals(
    consultasDesde(amb, n).map((c) => c.somenteLeitura),
    [true, false, true],
    "só o UPDATE vai sem read_only",
  );
  const e = JSON.parse(await lerArquivoDeEstado(amb.pasta));
  assertEquals(e.passos.dominio.veredito, "SIM");
});

Deno.test("dominio: rodar 2x = SIM nas duas, e o segundo não escreve nada", async () => {
  const amb = await ateDominio();
  const r1 = await executarPasso(pedido("dominio"), amb.deps);
  assertEquals(r1.veredito, "SIM", r1.mensagem);
  const r2 = await executarPasso(pedido("dominio"), amb.deps);
  assertEquals(r2.veredito, "SIM", r2.mensagem);
  assertEquals(escritasDoDominio(amb), 1);
  assertEquals(amb.api.banco.dominio, DOMINIO);
});

Deno.test("dominio: a ficha já declara ESTE domínio = SIM sem nenhuma escrita", async () => {
  const amb = await ateDominio({
    apiOpcoes: { banco: bancoFalso({ dominio: DOMINIO }) },
  });
  const n = amb.api.chamadas.length;
  const r = await executarPasso(pedido("dominio"), amb.deps);
  assertEquals(r.veredito, "SIM", r.mensagem);
  assertEquals(escritasDoDominio(amb), 0);
  const novas = consultasDesde(amb, n);
  assertEquals(novas.length, 1);
  assertEquals(novas[0].somenteLeitura, true);
});

Deno.test("dominio: a ficha já declara OUTRO domínio = NÃO, sem escrita, dizendo qual valor está lá", async () => {
  const amb = await ateDominio({
    apiOpcoes: { banco: bancoFalso({ dominio: "outra-loja.vercel.app" }) },
  });
  const r = await executarPasso(pedido("dominio"), amb.deps);
  assertEquals(r.veredito, "NÃO", r.mensagem);
  assertStringIncludes(r.mensagem, "outra-loja.vercel.app");
  assertStringIncludes(r.mensagem, "não sobrescrev");
  assertEquals(escritasDoDominio(amb), 0);
  assertEquals(amb.api.banco.dominio, "outra-loja.vercel.app");
});

Deno.test("dominio: OUTRO domínio gravado entre a leitura e o UPDATE = NÃO, e a guarda do UPDATE não sobrescreve", async () => {
  // a corrida: a leitura vê vazio, mas quando o UPDATE chega já há outro
  // valor. Só o `AND dominio_publico IS NULL` impede a sobrescrita.
  const amb = await ateDominio({
    apiOpcoes: {
      banco: bancoFalso({ dominioNaEscrita: "outra-loja.vercel.app" }),
    },
  });
  const r = await executarPasso(pedido("dominio"), amb.deps);
  assertEquals(r.veredito, "NÃO", r.mensagem);
  assertStringIncludes(r.mensagem, "outra-loja.vercel.app");
  assertEquals(escritasDoDominio(amb), 1);
  assertEquals(amb.api.banco.dominio, "outra-loja.vercel.app");
});

Deno.test("dominio: o UPDATE sem resposta (gateway) = INCERTO, nunca SIM", async () => {
  const amb = await ateDominio({
    apiOpcoes: { banco: bancoFalso({ escritaDoDominioCai: true }) },
  });
  const r = await executarPasso(pedido("dominio"), amb.deps);
  assertEquals(r.veredito, "INCERTO", r.mensagem);
  assertStringIncludes(r.mensagem, `dominio --loja ${SLUG} --aplicar`);
  const e = JSON.parse(await lerArquivoDeEstado(amb.pasta));
  assertEquals(e.passos.dominio.veredito, "INCERTO");
});

Deno.test("dominio: a releitura cai depois do UPDATE = INCERTO (sem ela não digo SIM)", async () => {
  // 1ª leitura de SQL_FICHA = a do passo ficha; 2ª = a do dominio; 3ª = a releitura
  const amb = await ateDominio({
    apiOpcoes: { banco: bancoFalso({ leituraDaFichaCaiNa: 3 }) },
  });
  const r = await executarPasso(pedido("dominio"), amb.deps);
  assertEquals(r.veredito, "INCERTO", r.mensagem);
  assertEquals(escritasDoDominio(amb), 1);
});

Deno.test("dominio: a leitura antes da escrita cai = INCERTO e nada é escrito", async () => {
  const amb = await ateDominio({
    apiOpcoes: { banco: bancoFalso({ leituraDaFichaCaiNa: 2 }) },
  });
  const r = await executarPasso(pedido("dominio"), amb.deps);
  assertEquals(r.veredito, "INCERTO", r.mensagem);
  assertEquals(escritasDoDominio(amb), 0);
});

Deno.test("dominio: a trava dominio_publico_so_muda_pela_frota recusa (42501) = NÃO com orientação, nada gravado", async () => {
  const amb = await ateDominio({
    apiOpcoes: { banco: bancoFalso({ travaDoDominio: true }) },
  });
  const r = await executarPasso(pedido("dominio"), amb.deps);
  assertEquals(r.veredito, "NÃO", r.mensagem);
  assertStringIncludes(r.mensagem, "DOMINIO_PUBLICO_SO_MUDA_PELA_FROTA");
  assertStringIncludes(r.mensagem, "42501");
  assertEquals(amb.api.banco.dominio, null);
});

Deno.test("dominio: sem a ficha SIM no estado = NÃO antes de qualquer rede", async () => {
  const amb = await ateFicha();
  const n = amb.api.chamadas.length;
  const r = await executarPasso(pedido("dominio"), amb.deps);
  assertEquals(r.veredito, "NÃO", r.mensagem);
  assertStringIncludes(r.mensagem, "ficha");
  assertEquals(amb.api.chamadas.length, n);
});

Deno.test("dominio: vem logo depois da ficha na lista de passos", () => {
  assertEquals(PASSOS.indexOf("dominio"), PASSOS.indexOf("ficha") + 1);
  assert(PASSOS.indexOf("dominio") < PASSOS.indexOf("marca"));
  assertEquals(
    lerArgumentos(["dominio", "--loja", SLUG, "--aplicar"]).passo,
    "dominio",
  );
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
  await executarPasso(pedido("autorizar"), amb.deps);
  const rr = await executarPasso(
    pedido("autorizar", { receber: true }),
    amb.deps,
  );
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

// MARCADOS PARA A A15 (temporário, só dentro da branch claude/nova-loja-central):
// os testes de FLUXO do trocar-dono (`Deno.test.ignore`) montam a troca pela
// autorização DA LOJA, que a A5/A6 tiraram; voltam quando a A15 reescrever o
// trocar-dono para a org central. Os de função pura (decidirTroca, sqlDaTroca…)
// continuam valendo.
// ─── A5: o OAuth uma vez, para a org central ────────────────────────────────

Deno.test("autorizar: imprime o link com PKCE e os passos do DONO para a org 'IKCOUS Lojas'; o pendente fica sob a chave da org, nunca sob uma loja", async () => {
  const amb = await ambiente();
  amb.entradas.push(CLIENT_SECRET);
  const r = await executarPasso(pedido("autorizar"), amb.deps);
  assertEquals(r.veredito, "SIM", r.mensagem);
  const texto = amb.saida.join("\n");
  assertStringIncludes(texto, "https://api.supabase.com/v1/oauth/authorize?");
  assertStringIncludes(texto, "code_challenge_method=S256");
  assertStringIncludes(texto, '"IKCOUS Lojas"');
  assertStringIncludes(texto, "autorizar --receber --aplicar");
  assert(!texto.includes("lojista"), "o passo é do dono, não da lojista");
  const reg = JSON.parse(await amb.deps.cofre.ler(CHAVE_DA_ORG));
  assert(reg.pendente, "o pendente não foi gravado sob a chave da org");
  assertEquals(await amb.deps.cofre.ler(SLUG), null);
  // o autorizar não fala com a Management API (só o cofre)
  assertEquals(amb.api.chamadas.length, 0);
});

Deno.test("autorizar sem --aplicar: nenhum fetch, nada no cofre nem no estado; com e sem --receber", async () => {
  const amb = await ambiente();
  for (const extra of [{}, { receber: true }]) {
    const r = await executarPasso(
      pedido("autorizar", { aplicar: false, ...extra }),
      amb.deps,
    );
    assert(r.veredito !== "SIM", r.mensagem);
    assertStringIncludes(r.mensagem, "ENSAIO");
  }
  assertEquals(amb.api.chamadas.length, 0);
  assertEquals(amb.deps.cofre.gravacoes, 0);
  assertEquals([...Deno.readDirSync(amb.pasta)].length, 0);
});

Deno.test("autorizar --receber troca o código e guarda o refresh sob a chave da org (nenhuma loja ganha cofre)", async () => {
  const amb = await ambiente();
  await conectar(amb);
  const reg = JSON.parse(await amb.deps.cofre.ler(CHAVE_DA_ORG));
  assertEquals(reg.refresh, REFRESH_1);
  assertEquals(reg.pendente, undefined);
  assertEquals(await amb.deps.cofre.ler(SLUG), null);
  assertEquals(amb.api.posts("/v1/oauth/token").length, 1);
});

Deno.test("autorizar --receber sem autorizar antes é NÃO e não lê token nenhum; autorizar com --loja é NÃO", async () => {
  const amb = await ambiente();
  amb.entradas.push(CODIGO);
  const r = await executarPasso(
    pedido("autorizar", { receber: true }),
    amb.deps,
  );
  assertEquals(r.veredito, "NÃO");
  assertEquals(amb.api.chamadas.length, 0);
  const comLoja = await executarPasso(
    pedido("autorizar", { slug: SLUG }),
    amb.deps,
  );
  assertEquals(comLoja.veredito, "NÃO");
  assertStringIncludes(comLoja.mensagem, "não leva --loja");
  assertEquals(amb.api.chamadas.length, 0);
});

Deno.test("abrir e receber --loja x respondem NÃO mandando usar autorizar, sem entrada, rede, cofre nem estado", async () => {
  for (const passo of ["abrir", "receber"]) {
    for (const aplicar of [true, false]) {
      const amb = await ambiente();
      amb.entradas.push(CLIENT_SECRET, CODIGO);
      const r = await executarPasso(pedido(passo, { aplicar }), amb.deps);
      assertEquals(r.veredito, "NÃO", `${passo}: ${r.mensagem}`);
      assertStringIncludes(r.mensagem, "autorizar --client-id");
      assertStringIncludes(r.mensagem, "autorizar --receber --aplicar");
      assertEquals(amb.entradas.length, 2, "leu a entrada");
      assertEquals(amb.api.chamadas.length, 0);
      assertEquals(amb.deps.cofre.gravacoes, 0);
      assertEquals([...Deno.readDirSync(amb.pasta)].length, 0);
    }
  }
});

// ─── A6: todo passo de loja usa o token da org ──────────────────────────────

Deno.test("A6: o passo de loja renova pelo cofre da ORG e nunca pelo da loja", async () => {
  const amb = await ambiente();
  await conectar(amb);
  const lidos = [];
  const ler = amb.deps.cofre.ler;
  amb.deps.cofre.ler = (slug) => {
    lidos.push(slug);
    return ler(slug);
  };
  const r = await executarPasso(pedido("criar-projeto"), amb.deps);
  assertEquals(r.veredito, "SIM", r.mensagem);
  assert(lidos.includes(CHAVE_DA_ORG), `não leu a org: ${lidos}`);
  assert(!lidos.includes(SLUG), "leu o cofre da loja");
  assertEquals(await amb.deps.cofre.ler(SLUG), null);
});

Deno.test("A6: a chave da org (org-ikcous-lojas) é recusada como loja em todo passo, sem rede nem estado", async () => {
  for (const passo of ["criar-projeto", "banco", "ficha", "conferir"]) {
    const amb = await ambiente();
    await conectar(amb);
    const n = amb.api.chamadas.length;
    const r = await executarPasso(
      pedido(passo, { slug: CHAVE_DA_ORG }),
      amb.deps,
    );
    assertEquals(r.veredito, "NÃO", `${passo}: ${r.mensagem}`);
    assertStringIncludes(r.mensagem, "chave do cofre da org central");
    assertEquals(amb.api.chamadas.length, n, passo);
  }
});

Deno.test("A6: duas rodadas de lojas diferentes ao mesmo tempo — com a autorização da org travada, a segunda vira NÃO (CofreTravado) sem nenhum fetch", async () => {
  const amb = await ambiente();
  await conectar(amb);
  // a outra rodada (outra loja) segura a trava da org no cofre
  const liberar = await amb.deps.cofre.travar(CHAVE_DA_ORG);
  try {
    const n = amb.api.chamadas.length;
    const r = await executarPasso(
      pedido("criar-projeto", { slug: "outra-loja" }),
      amb.deps,
    );
    assertEquals(r.veredito, "NÃO", r.mensagem);
    assertStringIncludes(r.mensagem, CHAVE_DA_ORG);
    assertEquals(amb.api.chamadas.length, n, "fez fetch com o cofre travado");
  } finally {
    await liberar();
  }
});

Deno.test("trocar-dono aguarda a A15 (NÃO com a razão, sem rede, entrada, cofre nem estado)", async () => {
  for (const extra of [{}, { receber: true }, { aplicar: false }]) {
    const amb = await ambiente();
    amb.entradas.push(EMAIL);
    const r = await executarPasso(pedido("trocar-dono", extra), amb.deps);
    assertEquals(r.veredito, "NÃO", r.mensagem);
    assertStringIncludes(r.mensagem, "aguardando A15");
    assertEquals(amb.entradas.length, 1);
    assertEquals(amb.api.chamadas.length, 0);
    assertEquals([...Deno.readDirSync(amb.pasta)].length, 0);
  }
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
  // passo desconhecido (o trocar-dono deixou de ser exemplo: existe desde a T2)
  assertThrows(() => lerArgumentos(["apagar-loja", "--loja", SLUG]));
  assertEquals(
    lerArgumentos(["trocar-dono", "--loja", SLUG, "--aplicar"]).passo,
    "trocar-dono",
  );
  // o e-mail da nova dona nunca por argumento
  const e3 = assertThrows(() =>
    lerArgumentos(["trocar-dono", "--loja", SLUG, "--aplicar", EMAIL]),
  );
  assert(!e3.message.includes(EMAIL));
  // --receber: a fase do código (T3), só no trocar-dono, sem valor
  const rec = lerArgumentos([
    "trocar-dono",
    "--loja",
    SLUG,
    "--aplicar",
    "--receber",
  ]);
  assertEquals(rec.receber, true);
  assertEquals(
    lerArgumentos(["trocar-dono", "--loja", SLUG]).receber,
    undefined,
  );
  const e4 = assertThrows(() =>
    lerArgumentos(["receber", "--loja", SLUG, "--receber"]),
  );
  assertStringIncludes(e4.message, "trocar-dono");
  assertThrows(() =>
    lerArgumentos(["trocar-dono", "--loja", SLUG, "--receber", CODIGO]),
  );
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

/** Os passos de loja (todos menos autorizar e os que não existem mais). */
const PASSOS_DE_LOJA = [
  "criar-projeto",
  "banco",
  "ficha",
  "dominio",
  "segredos",
  "functions",
  "login",
  "primeira-admin",
  "definir-dono",
  "conferir",
];

Deno.test("todo passo de loja: nome com mais de 24 caracteres (ou terminado em hífen) é recusado antes de rede, entrada e estado", async () => {
  for (const slug of [
    "a".repeat(25),
    "loja-de-nome-comprido-demais",
    "loja-",
  ]) {
    for (const passo of PASSOS_DE_LOJA) {
      for (const aplicar of [true, false]) {
        const amb = await ambiente();
        amb.entradas.push(EMAIL);
        const r = await executarPasso(
          pedido(passo, { slug, aplicar }),
          amb.deps,
        );
        assertEquals(r.veredito, "NÃO", `${passo} ${slug}: ${r.mensagem}`);
        if (slug.length > 24) assertStringIncludes(r.mensagem, "24");
        assertEquals(amb.api.chamadas.length, 0);
        assertEquals(amb.entradas.length, 1, "leu a entrada");
        assertEquals([...Deno.readDirSync(amb.pasta)].length, 0);
      }
    }
  }
  // o limite exato (24) passa da trava do nome (cai no ensaio)
  const amb = await ambiente();
  const r = await executarPasso(
    pedido("criar-projeto", { slug: "a".repeat(24), aplicar: false }),
    amb.deps,
  );
  assertStringIncludes(r.mensagem, "ENSAIO");
});

Deno.test("todo passo de loja: a loja `org-ikcous-lojas` (a chave do cofre da org central) é recusada sem rede nem estado", async () => {
  for (const [passo, aplicar] of PASSOS_DE_LOJA.flatMap((p) => [
    [p, true],
    [p, false],
  ])) {
    const amb = await ambiente();
    amb.entradas.push(CLIENT_SECRET);
    const r = await executarPasso(
      pedido(passo, { slug: "org-ikcous-lojas", aplicar }),
      amb.deps,
    );
    assertEquals(r.veredito, "NÃO", r.mensagem);
    assertStringIncludes(r.mensagem, "chave do cofre da org central");
    assertEquals(amb.api.chamadas.length, 0);
    assertEquals([...Deno.readDirSync(amb.pasta)].length, 0);
  }
});

Deno.test("todo passo de loja: a loja `lojas` (segredo derivado = o NOME do segredo da org central) é recusada sem rede nem estado", async () => {
  for (const [passo, aplicar] of PASSOS_DE_LOJA.flatMap((p) => [
    [p, true],
    [p, false],
  ])) {
    const amb = await ambiente();
    amb.entradas.push(CLIENT_SECRET);
    const r = await executarPasso(
      pedido(passo, { slug: "lojas", aplicar }),
      amb.deps,
    );
    assertEquals(r.veredito, "NÃO", r.mensagem);
    assertStringIncludes(r.mensagem, "SUPABASE_ACCESS_TOKEN_LOJAS");
    assertStringIncludes(r.mensagem, "segredo da org central");
    assertEquals(amb.api.chamadas.length, 0);
    assertEquals([...Deno.readDirSync(amb.pasta)].length, 0);
  }
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
  // o passo trocar-dono existe desde a T2/T3: a mensagem aponta para ele
  assertStringIncludes(r.mensagem, "trocar-dono --aplicar");
  assert(!r.mensagem.includes("ainda não existe"), r.mensagem);
  assertEquals(escritasDoDono(amb), 0);
  assertEquals(amb.api.banco.dono, "ex");
});

Deno.test("definir-dono: IKT06 — a admin única banida ou apagada no Supabase não vira dona (guarda na transação, depois de IKD05 e antes de IKD06)", async () => {
  const ordem = [
    "USING ERRCODE = 'IKD05'",
    "u.id = v_id AND (u.banned_until > now() OR u.deleted_at IS NOT NULL)",
    "USING ERRCODE = 'IKT06'",
    "USING ERRCODE = 'IKD06'",
    "INSERT INTO public.dono_da_loja",
  ];
  let antes = -1;
  for (const t of ordem) {
    const i = SQL_DEFINIR_DONO.indexOf(t, antes + 1);
    assert(i > antes, `fora de ordem ou ausente: ${t}`);
    antes = i;
  }
  const RECUSA =
    "conta bloqueada ou apagada no Supabase: desbloqueie ou escolha outra pessoa";
  // a LEITURA já vê o bloqueio: NÃO sem mandar a transação
  const amb = await ateADona({
    apiOpcoes: { banco: bancoFalso({ bloqueada: true }) },
  });
  const r = await executarPasso(pedido("definir-dono"), amb.deps);
  assertEquals(r.veredito, "NÃO", r.mensagem);
  assertStringIncludes(r.mensagem, RECUSA);
  assertEquals(escritasDoDono(amb), 0, "mandou a transação");
  assertEquals(amb.api.banco.dono, null);
  assertStringIncludes(SQL_DONO, "AS bloqueada");
  assertStringIncludes(SQL_DONO, "u.banned_until > now()");
  assertStringIncludes(SQL_DONO, "u.deleted_at IS NOT NULL");
  // bloqueada entre a leitura e a escrita: a transação recusa (IKT06)
  const corrida = await ateADona({
    apiOpcoes: { banco: bancoFalso({ bloqueadaNaEscrita: true }) },
  });
  const r2 = await executarPasso(pedido("definir-dono"), corrida.deps);
  assertEquals(r2.veredito, "NÃO", r2.mensagem);
  assertStringIncludes(r2.mensagem, RECUSA);
  assertStringIncludes(r2.mensagem, "IKT06");
  assertEquals(escritasDoDono(corrida), 1);
  assertEquals(corrida.api.banco.dono, null);
});

Deno.test("conferir: a coluna `bloqueada` da leitura do dono NÃO muda a saída do conferir", async () => {
  const amb = await ateConferir();
  const antes = await executarPasso(pedido("conferir"), amb.deps);
  amb.api.banco.bloqueada = true;
  const depois = await executarPasso(pedido("conferir"), amb.deps);
  assertEquals(depois.veredito, antes.veredito);
  assertEquals(depois.itens, antes.itens);
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
    // só a org foi conectada: a loja ainda não tem estado (A5)
    const e = (await amb.deps.estado.ler(SLUG)) ?? {
      versao: 1,
      slug: SLUG,
      passos: {},
    };
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

Deno.test("definir-dono: NUNCA nos alvos legados (loja, sandbox e toda chave `legado` do lojas.json) — mesmo com estado local apontando um projeto que não é de loja que vende", async () => {
  // um projeto qualquer, fora dos refs fixos da IKCOUS e da Savy
  const REF_QUALQUER = "refdeumprojetoaaaaaa";
  const comEstado = async (slug, lojasBrutas) => {
    const amb = await ambiente();
    await conectar(amb);
    // só a org foi conectada: a loja ainda não tem estado (A5)
    const e = (await amb.deps.estado.ler(SLUG)) ?? {
      versao: 1,
      slug: SLUG,
      passos: {},
    };
    e.slug = slug;
    e.passos["criar-projeto"] = {
      veredito: "SIM",
      ref: REF_QUALQUER,
      org: ORG,
    };
    e.passos.banco = { veredito: "SIM" };
    await amb.deps.estado.gravar(slug, e);
    amb.deps.lojasBrutas = () => structuredClone(lojasBrutas);
    return amb;
  };
  const legados = (extra) => ({
    lojas: {
      ...structuredClone(LOJAS_BRUTAS.lojas),
      ...extra,
    },
  });
  const legado = (ref) => ({
    ref,
    classe: "legado",
    apelido: "Legado",
    segredoDoToken: "SUPABASE_ACCESS_TOKEN",
  });
  // pelo nome fixo: com o lojas.json real (as duas chaves legadas lá) e com um
  // lojas.json sem elas (adulterado não tira a proteção)
  for (const slug of ["loja", "sandbox"]) {
    for (const lojas of [
      legados({ [slug]: legado("refdoalvolegadoaaaaa") }),
      structuredClone(LOJAS_BRUTAS),
    ]) {
      const amb = await comEstado(slug, lojas);
      const n = amb.api.chamadas.length;
      for (const aplicar of [true, false]) {
        const r = await executarPasso(
          { passo: "definir-dono", slug, aplicar },
          amb.deps,
        );
        assertEquals(r.veredito, "NÃO", r.mensagem);
        assertStringIncludes(r.mensagem, "nunca");
        assertStringIncludes(r.mensagem, "legado");
      }
      assertEquals(amb.api.chamadas.length, n, `falou com o alvo ${slug}`);
      assertEquals(escritasDoDono(amb), 0);
    }
  }
  // qualquer outra chave `classe: legado` do lojas.json, pelo cadastro
  const amb = await comEstado(
    "legado-novo",
    legados({ "legado-novo": legado(REF_QUALQUER) }),
  );
  const n = amb.api.chamadas.length;
  for (const aplicar of [true, false]) {
    const r = await executarPasso(
      { passo: "definir-dono", slug: "legado-novo", aplicar },
      amb.deps,
    );
    assertEquals(r.veredito, "NÃO", r.mensagem);
    assertStringIncludes(r.mensagem, "nunca");
  }
  assertEquals(amb.api.chamadas.length, n, "falou com o alvo legado");
  // a loja nova já cadastrada (B5) no lojas.json real como assinante segue
  // recebendo o definir-dono: a recusa é pela classe legado, não por ser chave
  const nova = await ateADona();
  nova.deps.lojasBrutas = () => structuredClone(LOJAS_COM_A_NOVA);
  const r = await executarPasso(pedido("definir-dono"), nova.deps);
  assertEquals(r.veredito, "SIM", r.mensagem);
  assertEquals(escritasDoDono(nova), 1);
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
  for (const passo of [
    "ficha",
    "dominio",
    "segredos",
    "functions",
    "login",
    "definir-dono",
  ]) {
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
    "dominio",
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

Deno.test("conferir: a ficha declarando OUTRO domínio = item dominio NÃO com o valor que está lá; só leitura", async () => {
  const amb = await ateFicha({
    apiOpcoes: { banco: bancoFalso({ dominio: "outra-loja.vercel.app" }) },
  });
  const r = await executarPasso(pedido("conferir"), amb.deps);
  const d = r.itens.find((i) => i.item === "dominio");
  assertEquals(d.veredito, "NÃO", d.detalhe);
  assertStringIncludes(d.detalhe, "outra-loja.vercel.app");
  assertEquals(escritasDoDominio(amb), 0);
});

Deno.test("conferir: segredo faltando, 0 admin, sem domínio, functions, login, nem dono, e reconciliação que não rodou = NÃO com o nome do que falta", async () => {
  const amb = await ateFicha({
    apiOpcoes: {
      segredos: ["MP_CHAVES_ENCRYPTION_KEY"],
      banco: bancoFalso({ idadeRodada: null }),
    },
  });
  const r = await executarPasso(pedido("conferir"), amb.deps);
  const v = porItem(r);
  assertEquals(v.segredos, "NÃO");
  assertEquals(v.dominio, "NÃO");
  assertStringIncludes(
    r.itens.find((i) => i.item === "dominio").detalhe,
    `dominio --loja ${SLUG} --aplicar`,
  );
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

Deno.test("conferir: item admin — a dona cadastrada (admin nas duas fontes) que nomeou outras admins NÃO reprova a loja; sem dono, só com exatamente 1 admin", async () => {
  const amb = await ateConferir();
  const banco = amb.api.banco;
  const admin = async () => {
    const r = await executarPasso(pedido("conferir"), amb.deps);
    return r.itens.find((i) => i.item === "admin");
  };
  // depois da abertura, a dona nomeou mais duas administradoras
  banco.outrasAdmins = 2;
  let a = await admin();
  assertEquals(a.veredito, "SIM", a.detalhe);
  assertStringIncludes(a.detalhe, "dono");
  // sem dono cadastrado, 2+ admins continua reprovando (antes do definir-dono)
  banco.dono = null;
  a = await admin();
  assertEquals(a.veredito, "NÃO", a.detalhe);
  // dono cadastrado que não é mais admin, com outras admins: reprova
  banco.dono = "ex";
  a = await admin();
  assertEquals(a.veredito, "NÃO", a.detalhe);
  // a leitura do dono cai com 2+ admins: não dá para dizer SIM nem NÃO
  banco.dono = "alvo";
  const responder = banco.responder;
  banco.responder = (sql) => {
    if (sql === SQL_DONO) throw Object.assign(new Error("caiu"), { http: 503 });
    return responder(sql);
  };
  a = await admin();
  assertEquals(a.veredito, "INCERTO", a.detalhe);
  // exatamente 1 admin (nas duas fontes) segue SIM mesmo com a leitura do dono caída
  banco.outrasAdmins = 0;
  a = await admin();
  assertEquals(a.veredito, "SIM", a.detalhe);
});

Deno.test("conferir: item admin — a dona admin nas duas fontes + outra admin só em auth.users (fora da definir_cargo) = NÃO", async () => {
  const amb = await ateConferir();
  const banco = amb.api.banco;
  const responder = banco.responder;
  // 2 admins na união das fontes, só 1 (a dona) nas duas
  banco.responder = (sql) => {
    if (sql === SQL_ADMINS) return [{ admins: 2, nas_duas: 1 }];
    if (sql === SQL_DONO) {
      return [
        {
          admins: 2,
          nas_duas: 1,
          confirmada: true,
          donos: 1,
          dono_admin: true,
          bloqueada: false,
        },
      ];
    }
    return responder(sql);
  };
  const r = await executarPasso(pedido("conferir"), amb.deps);
  const a = r.itens.find((i) => i.item === "admin");
  assertEquals(a.veredito, "NÃO", a.detalhe);
  assertStringIncludes(a.detalhe, "(1 nas duas)");
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

// ─── trocar-dono (T1 do plano de fechar a loja nova): o SQL e a regra ──────

/** A linha de sqlDaTroca de uma troca possível: 1 dono, 1 conta com o
 * e-mail, admin nas duas fontes, confirmada, e não é a dona de hoje. */
const linhaDaTroca = (o = {}) => [
  {
    donos: 1,
    contas: 1,
    confirmada: true,
    nova_admin: true,
    e_a_dona: false,
    bloqueada: false,
    ...o,
  },
];

Deno.test("trocar-dono: decidirTroca — nova admin nas duas fontes, confirmada e diferente da dona = SIM com escrita", () => {
  const d = decidirTroca(linhaDaTroca());
  assertEquals(d.veredito, "SIM", d.mensagem);
  assertEquals(d.gravar, true);
});

Deno.test("trocar-dono: decidirTroca — e-mail da dona de hoje (admin nas duas fontes) = SIM SEM escrita", () => {
  for (const confirmada of [true, false]) {
    const d = decidirTroca(linhaDaTroca({ e_a_dona: true, confirmada }));
    assertEquals(d.veredito, "SIM", d.mensagem);
    assertEquals(d.gravar, false, "regravaria a mesma dona");
    assertStringIncludes(d.mensagem, "nada foi gravado");
  }
});

Deno.test("trocar-dono: decidirTroca — cada recusa é NÃO, sem escrita, com o código IKT e motivo legível", () => {
  const casos = [
    ["sem dono atual", { donos: 0 }, "IKT01"],
    ["nova não é admin nas duas fontes", { nova_admin: false }, "IKT02"],
    [
      "é a dona, mas ela não é mais admin nas duas fontes",
      { e_a_dona: true, nova_admin: false },
      "IKT02",
    ],
    ["e-mail não confirmado", { confirmada: false }, "IKT03"],
    // a ordem do DO: IKT02 (admin nas duas) vem ANTES de IKT03 (confirmada)
    [
      "nova nem admin nem confirmada",
      { nova_admin: false, confirmada: false },
      "IKT02",
    ],
    [
      "0 contas com o e-mail",
      { contas: 0, confirmada: false, nova_admin: false },
      "IKT04",
    ],
    ["2 contas com o e-mail", { contas: 2 }, "IKT04"],
    ["2 donos (fora do desenho: falha a 88c)", { donos: 2 }, "IKT05"],
    // IKT06 (decisão do sócio 26/11): banida ou apagada no Supabase, logo
    // depois de IKT04 — vale também para "já era a dona"
    ["nova banida ou apagada", { bloqueada: true }, "IKT06"],
    [
      "já é a dona, mas a conta está bloqueada",
      { e_a_dona: true, bloqueada: true },
      "IKT06",
    ],
    [
      "bloqueada E não admin: IKT06 vem antes de IKT02",
      { bloqueada: true, nova_admin: false, confirmada: false },
      "IKT06",
    ],
    [
      "2 contas, uma bloqueada: IKT04 vem antes de IKT06",
      { contas: 2, bloqueada: true },
      "IKT04",
    ],
  ];
  for (const [nome, o, codigo] of casos) {
    const d = decidirTroca(linhaDaTroca(o));
    assertEquals(d.veredito, "NÃO", `${nome}: ${d.mensagem}`);
    assertEquals(d.gravar, false, nome);
    assertEquals(d.codigo, codigo, nome);
    assertStringIncludes(d.mensagem, "Nada foi gravado", nome);
    assert(d.mensagem.length > 40, `${nome}: motivo curto demais`);
  }
});

Deno.test("trocar-dono: decidirTroca — leitura fora do formato = INCERTO, nunca SIM nem escrita", () => {
  const [ok] = linhaDaTroca();
  const semColuna = Object.fromEntries(
    Object.entries(ok).filter(([k]) => k !== "e_a_dona"),
  );
  const foras = [
    null,
    undefined,
    [],
    {},
    "SIM",
    [null],
    [ok, ok],
    [semColuna],
    [{ ...ok, extra: 1 }],
    [{ ...ok, donos: "1" }],
    [{ ...ok, contas: -1 }],
    [{ ...ok, contas: 1.5 }],
    [{ ...ok, nova_admin: "true" }],
    [{ ...ok, e_a_dona: null }],
    [{ ...ok, confirmada: 1 }],
    [{ ...ok, bloqueada: "false" }],
    [Object.fromEntries(Object.entries(ok).filter(([k]) => k !== "bloqueada"))],
  ];
  for (const l of foras) {
    const d = decidirTroca(l);
    assertEquals(d.veredito, "INCERTO", JSON.stringify(l));
    assertEquals(d.gravar, false);
  }
});

/** Os literais '...' de um SQL (aspa dobrada = aspa dentro): [início, fim, valor]. */
function literaisDoSql(sql) {
  const lits = [];
  for (let i = 0; i < sql.length; i++) {
    if (sql.charAt(i) !== "'") continue;
    let j = i + 1;
    for (;;) {
      if (j >= sql.length) throw new Error("literal sem fim");
      if (sql.charAt(j) === "'" && sql.charAt(j + 1) === "'") j += 2;
      else if (sql.charAt(j) === "'") break;
      else j++;
    }
    lits.push([i, j + 1, sql.slice(i + 1, j).replaceAll("''", "'")]);
    i = j;
  }
  return lits;
}

const EMAILS_HOSTIS = [
  "o'brien@exemplo.test",
  "a''b'@exemplo.test",
  "x$$y@exemplo.test",
  "x$trocar_dono$y@exemplo.test",
  "a';DELETE;--@exemplo.test",
  "a;b@exemplo.test",
];

Deno.test("trocar-dono: e-mail com aspa, $$, $trocar_dono$ ou ponto e vírgula fica DENTRO de um literal só; o resto do SQL é fixo", () => {
  const BENIGNO = "lojista.falsa@exemplo.test";
  for (const gerar of [sqlTrocarDono, sqlDaTroca]) {
    const base = gerar(BENIGNO);
    const litBase = `'${BENIGNO}'`;
    assertEquals(base.split(litBase).length, 2, "o e-mail entra uma vez só");
    for (const email of EMAILS_HOSTIS) {
      const sql = gerar(email);
      const lit = `'${email.replaceAll("'", "''")}'`;
      assertEquals(sql.split(lit).length, 2, `${gerar.name}: ${email}`);
      // fora do literal, o SQL é exatamente o do e-mail benigno
      assertEquals(
        sql.replace(lit, "<L>"),
        base.replace(litBase, "<L>"),
        `${gerar.name}: ${email} mudou o SQL fora do literal`,
      );
      // e o literal que o leitor de SQL acha é o e-mail inteiro
      const meu = literaisDoSql(sql).filter(([, , v]) => v === email);
      assertEquals(meu.length, 1, `${gerar.name}: ${email}`);
      if (gerar === sqlTrocarDono) {
        // fora do DO (dollar-quote): na instrução SET LOCAL
        assert(meu[0][0] < sql.indexOf("DO $trocar_dono$"));
        assertStringIncludes(
          sql,
          `SET LOCAL ikcous.trocar_dono_email = ${lit};\nDO $trocar_dono$`,
        );
      }
    }
  }
});

Deno.test("trocar-dono: barra invertida, espaço, quebra de linha ou texto sem @ é recusado antes de virar SQL (sem ecoar)", () => {
  for (const gerar of [sqlTrocarDono, sqlDaTroca]) {
    for (const ruim of [
      "a\\'@exemplo.test",
      "a\\@exemplo.test",
      "a b@exemplo.test",
      "a@exemplo.test\n';COMMIT;--",
      "sem-arroba",
      "",
      "a@b@exemplo.test",
      `${"a".repeat(250)}@x.test`,
      null,
    ]) {
      const e = assertThrows(() => gerar(ruim));
      if (typeof ruim === "string" && ruim !== "")
        assert(!e.message.includes(ruim), "ecoou a entrada");
    }
  }
});

Deno.test("trocar-dono: a transação — BEGIN, papel, travas, LOCK, guardas na ordem, DELETE+INSERT, 88c, COMMIT; uma escrita só", () => {
  const sql = sqlTrocarDono("lojista.falsa@exemplo.test");
  const ordem = [
    "BEGIN ISOLATION LEVEL READ COMMITTED;",
    "SET LOCAL ROLE postgres;",
    "SET LOCAL lock_timeout = '10s';",
    "SET LOCAL ikcous.trocar_dono_email = ",
    "DO $trocar_dono$",
    "lower(current_setting('ikcous.trocar_dono_email'))",
    "PERFORM pg_advisory_xact_lock(hashtext('ikcous.primeira_admin'));",
    "PERFORM pg_advisory_xact_lock(hashtext('ikcous.definir_dono'));",
    "LOCK TABLE public.dono_da_loja IN SHARE ROW EXCLUSIVE MODE;",
    "USING ERRCODE = 'IKT01'",
    "trocar-dono: mais de um dono",
    "USING ERRCODE = 'IKT04'",
    "USING ERRCODE = 'IKT06'",
    "WHERE d.user_id = v_id",
    "'ja_era_dona'",
    "RETURN;",
    "FOR SHARE OF p;",
    "USING ERRCODE = 'IKT02'",
    "USING ERRCODE = 'IKT03'",
    "DELETE FROM public.dono_da_loja;",
    "INSERT INTO public.dono_da_loja (user_id) VALUES (v_id);",
    "trocar-dono: conferencia da 88c falhou",
    "'trocada'",
    "$trocar_dono$;",
    "COMMIT;",
    "SELECT current_setting('ikcous.trocar_dono_resultado', true) AS resultado;",
  ];
  let antes = -1;
  for (const t of ordem) {
    const i = sql.indexOf(t, antes + 1);
    assert(i > antes, `fora de ordem ou ausente: ${t}`);
    antes = i;
  }
  for (const [t, n] of [
    ["BEGIN ISOLATION", 1],
    ["COMMIT;", 1],
    ["DELETE FROM", 1],
    ["INSERT INTO", 1],
    ["ROLLBACK", 0],
    ["UPDATE ", 0],
  ])
    assertEquals(sql.split(t).length - 1, n, t);
  for (const c of ["IKT01", "IKT02", "IKT03", "IKT04", "IKT05", "IKT06"])
    assertStringIncludes(sql, `ERRCODE = '${c}'`);
  // IKT06: só a conta NOVA (v_id) é olhada; a dona de hoje bloqueada não
  // impede a troca (nenhuma guarda de bloqueio olha dono_da_loja)
  const ikt06 = sql.slice(
    sql.indexOf("USING ERRCODE = 'IKT04'"),
    sql.indexOf("USING ERRCODE = 'IKT06'"),
  );
  const guarda = ikt06.slice(ikt06.lastIndexOf("IF EXISTS"));
  assertStringIncludes(guarda, "u.id = v_id");
  assertStringIncludes(guarda, "u.banned_until > now()");
  assertStringIncludes(guarda, "u.deleted_at IS NOT NULL");
  assert(!guarda.includes("dono_da_loja"), "a guarda olha a dona de hoje");
  assertEquals(sql.split("banned_until").length - 1, 1);
  assertEquals(sql.split("deleted_at").length - 1, 1);
  // a nova dona: a linha travada exige admin nas DUAS fontes do cargo
  const fim = sql.indexOf("FOR SHARE OF p;");
  const nova = sql.slice(sql.lastIndexOf(";", fim) + 1, fim);
  assertStringIncludes(nova, "u.id = v_id");
  assertStringIncludes(nova, "p.role = 'admin'");
  assertStringIncludes(nova, "u.raw_app_meta_data ->> 'role' = 'admin'");
  // a 88c depois do INSERT: 1 linha apagada, 1 inserida, 1 dono, admin nas duas
  const c88 = sql.slice(
    sql.indexOf("INSERT INTO public.dono_da_loja"),
    sql.indexOf("trocar-dono: conferencia da 88c falhou"),
  );
  for (const t of [
    "v_apagadas <> 1",
    "v_linhas <> 1",
    "(SELECT count(*) FROM public.dono_da_loja) <> 1",
    "JOIN auth.users u ON u.id = d.user_id",
    "p.role = 'admin'",
    "u.raw_app_meta_data ->> 'role' = 'admin'",
  ])
    assertStringIncludes(c88, t);
});

Deno.test("trocar-dono: a leitura é UMA instrução SELECT, sem escrita, nova_admin pelas duas fontes", () => {
  const sql = sqlDaTroca("lojista.falsa@exemplo.test");
  assert(sql.startsWith("WITH "));
  assertEquals(sql.split(";").length, 2, "mais de uma instrução");
  for (const t of ["INSERT", "DELETE", "UPDATE", "BEGIN", "COMMIT", "SET "])
    assert(!sql.includes(t), t);
  for (const t of [
    "AS donos",
    "AS contas",
    "AS confirmada",
    "AS nova_admin",
    "AS e_a_dona",
    "AS bloqueada",
    "p.role = 'admin'",
    "u.raw_app_meta_data ->> 'role' = 'admin'",
    "lower(u.email)",
  ])
    assertStringIncludes(sql, t);
  // bloqueada vem das contas do E-MAIL (a nova), nunca da dona de hoje
  const contas = sql.slice(
    sql.indexOf("contas AS"),
    sql.indexOf("nas_duas AS"),
  );
  assertStringIncludes(contas, "u.banned_until > now()");
  assertStringIncludes(contas, "u.deleted_at IS NOT NULL");
  assertEquals(sql.split("banned_until").length - 1, 1);
  assertStringIncludes(sql, "bool_or(c.bloqueada) FROM contas c");
});

Deno.test("trocar-dono: resultadoDaTroca só aceita o formato exato do GUC (trocada / ja_era_dona); o resto é null", () => {
  const r = (o) => [{ resultado: JSON.stringify(o) }];
  assertEquals(
    resultadoDaTroca(r({ acao: "trocada", donos: 1, apagadas: 1, linhas: 1 })),
    "trocada",
  );
  assertEquals(
    resultadoDaTroca(
      r({ acao: "ja_era_dona", donos: 1, apagadas: 0, linhas: 0 }),
    ),
    "ja_era_dona",
  );
  for (const fora of [
    r({ acao: "trocada", donos: 1, apagadas: 0, linhas: 1 }),
    r({ acao: "trocada", donos: 2, apagadas: 1, linhas: 1 }),
    r({ acao: "ja_era_dona", donos: 1, apagadas: 0, linhas: 1 }),
    r({ acao: "gravada", donos: 1, apagadas: 1, linhas: 1 }),
    r({ acao: "trocada", donos: 1, apagadas: 1, linhas: 1, id: "x" }),
    [{ resultado: "" }],
    [{ resultado: null }],
    [{ resultado: "{" }],
    [{ resultado: "{}", outra: 1 }],
    [],
    null,
  ])
    assertEquals(resultadoDaTroca(fora), null, JSON.stringify(fora));
});

// ─── trocar-dono, fase 1 (T2): o link novo da dona e o pedido pendente ──────

const EMAIL_NOVA = "nova.dona.falsa@exemplo.test";
const PROXIMO_DA_TROCA = `node scripts/frota/nova-loja.mjs trocar-dono --loja ${SLUG} --aplicar --receber`;
const URL_AUTORIZAR = "https://api.supabase.com/v1/oauth/authorize?";

/** Responde a leitura sqlDaTroca(email) com a linha que o teste escolhe e
 * conta as leituras; qualquer SQL de ESCRITA da troca derruba o teste. */
function comATroca(amb, { email = EMAIL_NOVA, linha = linhaDaTroca } = {}) {
  const banco = amb.api.banco;
  const responder = banco.responder;
  banco.leiturasDaTroca = 0;
  banco.responder = (sql) => {
    if (sql === sqlDaTroca(email)) {
      banco.leiturasDaTroca += 1;
      if (banco.leituraDaTrocaCai)
        throw Object.assign(new Error(`caiu perto de '${email}'`), {
          sqlstate: "XX000",
        });
      return linha();
    }
    if (sql.includes("trocar_dono"))
      throw new Error("a fase 1 mandou a ESCRITA da troca");
    return responder(sql);
  };
  return amb;
}

/** A loja com a dona cadastrada (definir-dono SIM) e a leitura da troca. */
async function ateATroca(o = {}) {
  const amb = await ateADona(o);
  const r = await executarPasso(pedido("definir-dono"), amb.deps);
  assertEquals(r.veredito, "SIM", r.mensagem);
  return comATroca(amb, o.troca);
}

async function registroDoCofre(amb) {
  return JSON.parse(await amb.deps.cofre.ler(SLUG));
}

/** O último link de autorização impresso, já como URL. */
function ultimoLink(amb) {
  const linhas = amb.saida.flatMap((s) => s.split("\n"));
  const l = linhas.filter((x) => x.includes(URL_AUTORIZAR)).at(-1);
  assert(l, "nenhum link impresso");
  return new URL(l.trim());
}

const s256 = (v) =>
  createHash("sha256")
    .update(v)
    .digest("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

Deno.test.ignore(
  "trocar-dono fase 1: dona cadastrada e candidata admin confirmada = link novo (PKCE) amarrado ao pedido pendente, próximo comando, e NADA escrito no banco",
  async () => {
    const amb = await ateATroca();
    const n = amb.api.chamadas.length;
    amb.entradas.push(EMAIL_NOVA);
    // a hora do pedido: o passo banco de ateATroca já andou o relógio falso
    // (o ritmo da Management API dorme entre as consultas)
    const pedidoEm = amb.relogio.agora();
    const r = await executarPasso(pedido("trocar-dono"), amb.deps);
    assertEquals(r.veredito, "SIM", r.mensagem);
    assertEquals(amb.entradas.length, 0, "não leu o e-mail pela entrada");
    assertEquals(amb.api.banco.leiturasDaTroca, 1);
    // só leitura no banco; a dona de hoje segue a mesma
    const novas = amb.api.chamadas.slice(n);
    for (const c of novas.filter((c) => c.caminho.endsWith("/database/query")))
      assertEquals(c.somenteLeitura, true, "consulta sem read_only");
    assertEquals(amb.api.banco.dono, "alvo");
    // o link: o app guardado, S256, e o state e o desafio do pedido no cofre
    const reg = await registroDoCofre(amb);
    const u = ultimoLink(amb);
    assertEquals(u.searchParams.get("client_id"), CLIENT_ID);
    assertEquals(u.searchParams.get("redirect_uri"), REDIRECT);
    assertEquals(u.searchParams.get("code_challenge_method"), "S256");
    assertEquals(u.searchParams.get("state"), reg.pendente.state);
    assertEquals(
      u.searchParams.get("code_challenge"),
      s256(reg.pendente.verificador),
    );
    // o refresh da loja continua no cofre (o pedido não desconecta a loja)
    assertEquals(reg.refresh, amb.api.refreshValido);
    const c = await executarPasso(pedido("conferir"), amb.deps);
    assertEquals(Reflect.get(porItem(c), "definir-dono"), "SIM", c.mensagem);
    // o próximo comando e o prazo de 30 min
    const texto = amb.saida.join("\n");
    assertStringIncludes(texto, PROXIMO_DA_TROCA);
    assertStringIncludes(texto, "30 min");
    assertStringIncludes(
      texto,
      new Date(pedidoEm + 30 * 60_000).toISOString(),
      "o fim do prazo",
    );
  },
);

Deno.test.ignore(
  "trocar-dono fase 1: o pedido pendente tem hora (cofre e estado) e não tem segredo",
  async () => {
    const amb = await ateATroca();
    amb.relogio.t += 5_000;
    const hora = amb.relogio.t;
    amb.entradas.push(EMAIL_NOVA);
    const r = await executarPasso(pedido("trocar-dono"), amb.deps);
    assertEquals(r.veredito, "SIM", r.mensagem);
    // no cofre: só o que o PKCE exige, com a hora
    const { pendente } = await registroDoCofre(amb);
    assertEquals(Object.keys(pendente).sort(), [
      "criadoEm",
      "state",
      "verificador",
    ]);
    assertEquals(pendente.criadoEm, hora);
    const proibidos = [
      ACCESS,
      CODIGO,
      CLIENT_SECRET,
      REFRESH_1,
      amb.api.refreshValido,
      "refresh-FALSO",
      EMAIL,
      EMAIL_NOVA,
    ];
    const doPendente = JSON.stringify(pendente);
    for (const p of proibidos)
      assert(!doPendente.includes(p), `pendente vazou ${p.slice(0, 12)}…`);
    // no estado: a hora do pedido, nenhum segredo, nem o state/verificador
    const texto = await lerArquivoDeEstado(amb.pasta);
    const e = JSON.parse(texto);
    assertEquals(Object.keys(e.passos["trocar-dono"]).sort(), [
      "em",
      "pedidoEm",
    ]);
    assertEquals(
      e.passos["trocar-dono"].pedidoEm,
      new Date(hora).toISOString(),
    );
    for (const p of [...proibidos, pendente.state, pendente.verificador])
      assert(!texto.includes(p), `estado vazou ${p.slice(0, 12)}…`);
    // o link não leva o verificador nem o client_secret
    const link = ultimoLink(amb).href;
    assert(!link.includes(pendente.verificador));
    assert(!link.includes(CLIENT_SECRET));
  },
);

Deno.test.ignore(
  "trocar-dono fase 1: cada chamada gera code_challenge, state e verificador NOVOS (o link anterior deixa de valer)",
  async () => {
    const amb = await ateATroca();
    const vistos = [];
    for (let i = 0; i < 3; i++) {
      amb.relogio.t += 60_000;
      amb.entradas.push(EMAIL_NOVA);
      const r = await executarPasso(pedido("trocar-dono"), amb.deps);
      assertEquals(r.veredito, "SIM", r.mensagem);
      const u = ultimoLink(amb);
      const { pendente } = await registroDoCofre(amb);
      assertEquals(
        u.searchParams.get("code_challenge"),
        s256(pendente.verificador),
      );
      assertEquals(pendente.criadoEm, amb.relogio.t);
      vistos.push([
        u.searchParams.get("code_challenge"),
        u.searchParams.get("state"),
        pendente.verificador,
      ]);
    }
    for (let k = 0; k < 3; k++)
      assertEquals(new Set(vistos.map((v) => v.at(k))).size, 3, `coluna ${k}`);
  },
);

Deno.test.ignore(
  "trocar-dono fase 1: NUNCA na IKCOUS, na Savy nem nos alvos legados — pelo nome (sem rede, trava, estado nem entrada) e pelo ref",
  async () => {
    for (const slug of ["savy", "ikcous-publicada", "loja", "sandbox"]) {
      const amb = await ambiente();
      amb.entradas.push(EMAIL_NOVA);
      for (const aplicar of [true, false]) {
        const r = await executarPasso(
          { passo: "trocar-dono", slug, aplicar },
          amb.deps,
        );
        assertEquals(r.veredito, "NÃO", `${slug}: ${r.mensagem}`);
        assertStringIncludes(r.mensagem, "nunca");
        assertStringIncludes(r.mensagem, "trocar-dono");
      }
      assertEquals(amb.api.chamadas.length, 0, `falou com ${slug}`);
      assertEquals([...Deno.readDirSync(amb.pasta)].length, 0);
      assertEquals(amb.entradas.length, 1, `${slug}: pediu o e-mail`);
    }
    // outro nome, mas o estado aponta o projeto da Savy ou da IKCOUS
    for (const ref of [REF_SAVY, REF_IKCOUS]) {
      const amb = await ambiente();
      await conectar(amb);
      const e = JSON.parse(await lerArquivoDeEstado(amb.pasta));
      e.passos["criar-projeto"] = { veredito: "SIM", ref, org: ORG };
      e.passos.banco = { veredito: "SIM" };
      await amb.deps.estado.gravar(SLUG, e);
      const n = amb.api.chamadas.length;
      amb.entradas.push(EMAIL_NOVA);
      const r = await executarPasso(pedido("trocar-dono"), amb.deps);
      assertEquals(r.veredito, "NÃO", r.mensagem);
      assertStringIncludes(r.mensagem, "nunca");
      assertEquals(amb.api.chamadas.length, n, "falou com a loja protegida");
      assertEquals((await registroDoCofre(amb)).pendente, undefined);
    }
    // uma chave `classe: legado` qualquer do lojas.json
    const amb = await ambiente();
    await conectar(amb);
    const e = JSON.parse(await lerArquivoDeEstado(amb.pasta));
    e.slug = "legado-novo";
    e.passos["criar-projeto"] = {
      veredito: "SIM",
      ref: "refdeumprojetoaaaaaa",
      org: ORG,
    };
    e.passos.banco = { veredito: "SIM" };
    await amb.deps.estado.gravar("legado-novo", e);
    amb.deps.lojasBrutas = () => ({
      lojas: {
        ...structuredClone(LOJAS_BRUTAS.lojas),
        "legado-novo": {
          ref: "refdeumprojetoaaaaaa",
          classe: "legado",
          apelido: "Legado",
          segredoDoToken: "SUPABASE_ACCESS_TOKEN",
        },
      },
    });
    const n = amb.api.chamadas.length;
    const r = await executarPasso(
      { passo: "trocar-dono", slug: "legado-novo", aplicar: true },
      amb.deps,
    );
    assertEquals(r.veredito, "NÃO", r.mensagem);
    assertStringIncludes(r.mensagem, "legado");
    assertEquals(amb.api.chamadas.length, n);
  },
);

Deno.test.ignore(
  "trocar-dono fase 1: loja SEM dona = NÃO (IKT01) pela leitura, e nenhum pedido pendente gravado nem link impresso",
  async () => {
    // a primeira-admin feita, o definir-dono não: dono_da_loja vazia
    const amb = comATroca(await ateADona(), {
      linha: () => linhaDaTroca({ donos: 0 }),
    });
    const antes = await lerArquivoDeEstado(amb.pasta);
    const s = amb.saida.length;
    amb.entradas.push(EMAIL_NOVA);
    const r = await executarPasso(pedido("trocar-dono"), amb.deps);
    assertEquals(r.veredito, "NÃO", r.mensagem);
    assertStringIncludes(r.mensagem, "não tem dona");
    assertStringIncludes(r.mensagem, "definir-dono");
    assertEquals(amb.api.banco.leiturasDaTroca, 1, "não leu pelo OAuth");
    assertEquals((await registroDoCofre(amb)).pendente, undefined);
    assertEquals(await lerArquivoDeEstado(amb.pasta), antes);
    assert(
      !amb.saida.slice(s).join("\n").includes(URL_AUTORIZAR),
      "imprimiu link",
    );
  },
);

Deno.test.ignore(
  "trocar-dono fase 1: candidata que não é admin, e-mail já da dona, leitura que cai ou e-mail sem forma = sem pedido nem link",
  async () => {
    const casos = [
      [() => linhaDaTroca({ nova_admin: false }), "NÃO", "administradora"],
      [() => linhaDaTroca({ confirmada: false }), "NÃO", "confirmou"],
      [() => linhaDaTroca({ contas: 0 }), "NÃO", "exatamente uma conta"],
      [() => linhaDaTroca({ e_a_dona: true }), "SIM", "já é o da dona"],
      [() => [{ donos: 1 }], "INCERTO", "fora do formato"],
    ];
    for (const [linha, veredito, texto] of casos) {
      const amb = await ateATroca({ troca: { linha } });
      const s = amb.saida.length;
      amb.entradas.push(EMAIL_NOVA);
      const r = await executarPasso(pedido("trocar-dono"), amb.deps);
      assertEquals(r.veredito, veredito, r.mensagem);
      assertStringIncludes(r.mensagem, texto);
      assertEquals((await registroDoCofre(amb)).pendente, undefined);
      assert(!amb.saida.slice(s).join("\n").includes(URL_AUTORIZAR));
      assert(!(await lerArquivoDeEstado(amb.pasta)).includes('"trocar-dono"'));
    }
    const cai = await ateATroca();
    cai.api.banco.leituraDaTrocaCai = true;
    cai.entradas.push(EMAIL_NOVA);
    const r = await executarPasso(pedido("trocar-dono"), cai.deps);
    assertEquals(r.veredito, "INCERTO", r.mensagem);
    assertEquals((await registroDoCofre(cai)).pendente, undefined);
    // e-mail sem forma: recusado antes de qualquer leitura do banco
    const ruim = await ateATroca();
    const n = ruim.api.chamadas.length;
    ruim.entradas.push("sem-arroba");
    const r2 = await executarPasso(pedido("trocar-dono"), ruim.deps);
    assertEquals(r2.veredito, "NÃO", r2.mensagem);
    assert(!r2.mensagem.includes("sem-arroba"), "ecoou a entrada");
    assertEquals(ruim.api.chamadas.length, n);
  },
);

Deno.test.ignore(
  "trocar-dono fase 1: o e-mail da candidata não aparece na saída, na mensagem, no estado nem no cofre (sucesso, recusa e leitura que cai)",
  async () => {
    const MAIUSCULO = "Nova.Dona.Falsa@Exemplo.TEST";
    const procurar = async (amb, r) => {
      const tudo = [
        amb.saida.join("\n"),
        r.mensagem,
        await lerArquivoDeEstado(amb.pasta),
        await amb.deps.cofre.ler(SLUG),
      ]
        .join("\n")
        .toLowerCase();
      assert(!tudo.includes(EMAIL_NOVA), "o e-mail vazou");
    };
    // sucesso (o e-mail digitado em maiúsculas chega ao banco como veio)
    const ok = await ateATroca({ troca: { email: MAIUSCULO } });
    ok.entradas.push(`  ${MAIUSCULO}  `);
    const r1 = await executarPasso(pedido("trocar-dono"), ok.deps);
    assertEquals(r1.veredito, "SIM", r1.mensagem);
    assertEquals(ok.api.banco.leiturasDaTroca, 1);
    await procurar(ok, r1);
    // recusa
    const nao = await ateATroca({
      troca: { linha: () => linhaDaTroca({ nova_admin: false }) },
    });
    nao.entradas.push(EMAIL_NOVA);
    const r2 = await executarPasso(pedido("trocar-dono"), nao.deps);
    assertEquals(r2.veredito, "NÃO", r2.mensagem);
    await procurar(nao, r2);
    // a leitura cai com o e-mail na mensagem de erro do banco
    const cai = await ateATroca();
    cai.api.banco.leituraDaTrocaCai = true;
    cai.entradas.push(EMAIL_NOVA);
    const r3 = await executarPasso(pedido("trocar-dono"), cai.deps);
    assertEquals(r3.veredito, "INCERTO", r3.mensagem);
    await procurar(cai, r3);
  },
);

Deno.test.ignore(
  "trocar-dono fase 1: sem --aplicar é ENSAIO — nem o e-mail é pedido, 0 chamadas, nada no cofre",
  async () => {
    const amb = await ateATroca();
    const n = amb.api.chamadas.length;
    const g = amb.deps.cofre.gravacoes;
    const r = await executarPasso(
      pedido("trocar-dono", { aplicar: false }),
      amb.deps,
    );
    assertStringIncludes(r.mensagem, "ENSAIO");
    assert(r.veredito !== "SIM");
    assertEquals(amb.api.chamadas.length, n);
    assertEquals(amb.deps.cofre.gravacoes, g);
    assertEquals(amb.entradas.length, 0);
  },
);

// ─── trocar-dono, fase 2 (T3): o código da dona e a troca ───────────────────

const OUTRO_EMAIL = "outra.pessoa.falsa@exemplo.test";
const MASCARADO = "no•••@exemplo.test";
const RECUSA_IKT06 =
  "conta bloqueada ou apagada no Supabase: desbloqueie ou escolha outra pessoa";

/** O banco da troca COM estado, para EMAIL_NOVA: a leitura (sqlDaTroca) e a
 * escrita (sqlTrocarDono) seguem as guardas do SQL de verdade, na mesma
 * ordem. Qualquer SQL da troca com OUTRO e-mail derruba o teste. A nova já é
 * admin (nomeada pela dona: outrasAdmins = 1). */
function comATrocaViva(amb, o = {}) {
  const banco = amb.api.banco;
  const responder = banco.responder;
  const t = {
    contas: 1,
    nova_admin: true,
    confirmada: true,
    bloqueada: false,
    eANova: false,
    escritas: 0,
    leituras: 0,
    escritaCai: false,
    releituraDiverge: false,
    ...o,
  };
  banco.outrasAdmins = 1;
  banco.troca = t;
  const linha = () => ({
    donos: 1,
    contas: t.contas,
    confirmada: t.confirmada,
    nova_admin: t.nova_admin,
    e_a_dona: t.eANova,
    bloqueada: t.bloqueada,
  });
  banco.responder = (sql) => {
    if (sql === sqlDaTroca(EMAIL_NOVA)) {
      t.leituras += 1;
      if (t.releituraDiverge && t.escritas > 0)
        return [{ ...linha(), e_a_dona: false }];
      return [linha()];
    }
    if (sql === sqlTrocarDono(EMAIL_NOVA)) {
      t.escritas += 1;
      if (t.escritaCai)
        throw Object.assign(new Error("gateway"), { http: 504 });
      const recusa = (sqlstate) =>
        Object.assign(new Error("recusa"), { sqlstate });
      const r = (acao, n) => [
        {
          resultado: JSON.stringify({
            acao,
            donos: 1,
            apagadas: n,
            linhas: n,
          }),
        },
      ];
      if (t.contas !== 1) throw recusa("IKT04");
      if (t.bloqueada) throw recusa("IKT06");
      if (t.eANova) {
        if (!t.nova_admin) throw recusa("IKT02");
        return r("ja_era_dona", 0);
      }
      if (!t.nova_admin) throw recusa("IKT02");
      if (!t.confirmada) throw recusa("IKT03");
      t.eANova = true;
      banco.dono = "outra";
      return r("trocada", 1);
    }
    if (sql.includes("trocar_dono") || sql.startsWith("WITH alvo AS"))
      throw new Error("SQL da troca com outro e-mail");
    return responder(sql);
  };
  return amb;
}

/** Fase 1 feita (pedido no cofre e no estado) e 1 min depois, a dona autorizou. */
async function pedidoDeTroca(o = {}) {
  const amb = await ateADona(o);
  const d = await executarPasso(pedido("definir-dono"), amb.deps);
  assertEquals(d.veredito, "SIM", d.mensagem);
  comATrocaViva(amb, o.troca);
  amb.entradas.push(EMAIL_NOVA);
  const r = await executarPasso(pedido("trocar-dono"), amb.deps);
  assertEquals(r.veredito, "SIM", r.mensagem);
  amb.relogio.t += 60_000;
  return amb;
}

const receberATroca = (amb) =>
  executarPasso(pedido("trocar-dono", { receber: true }), amb.deps);

const tokenPosts = (amb) => amb.api.posts("/v1/oauth/token").length;

async function entradaDaTroca(amb) {
  const t = await amb.deps.cofreDaTroca.ler(SLUG);
  return t === null ? null : JSON.parse(t);
}

Deno.test.ignore(
  "trocar-dono fase 1: depois de decidirTroca aprovar, o e-mail vai para uma entrada PRÓPRIA do cofre da troca, amarrada ao pedido (pedidoEm e criadoEm); o link mostra o e-mail mascarado",
  async () => {
    const amb = await pedidoDeTroca();
    const e = await entradaDaTroca(amb);
    assertEquals(Object.keys(e).sort(), [
      "criadoEm",
      "email",
      "pedidoEm",
      "versao",
    ]);
    assertEquals(e.email, EMAIL_NOVA);
    const { pendente } = await registroDoCofre(amb);
    assertEquals(e.criadoEm, pendente.criadoEm);
    const estado = JSON.parse(await lerArquivoDeEstado(amb.pasta));
    assertEquals(
      new Date(e.pedidoEm).toISOString(),
      estado.passos["trocar-dono"].pedidoEm,
    );
    // o registro do abrir (cofre da loja) não ganhou o e-mail
    assert(!(await amb.deps.cofre.ler(SLUG)).includes(EMAIL_NOVA));
    // o texto do link: 2 letras + ••• + @domínio, nunca o e-mail inteiro
    const texto = amb.saida.join("\n");
    assertStringIncludes(texto, MASCARADO);
    assert(!texto.toLowerCase().includes(EMAIL_NOVA));
    assertEquals(mascararEmail(EMAIL_NOVA), MASCARADO);
    assertEquals(mascararEmail("ab@x.test"), "a•••@x.test");
    assertEquals(mascararEmail("a@x.test"), "•••@x.test");
    // recusada pela leitura: nenhuma entrada nova
    const nao = await ateATroca({
      troca: { linha: () => linhaDaTroca({ bloqueada: true }) },
    });
    nao.entradas.push(EMAIL_NOVA);
    const r = await executarPasso(pedido("trocar-dono"), nao.deps);
    assertEquals(r.veredito, "NÃO", r.mensagem);
    assertStringIncludes(r.mensagem, RECUSA_IKT06);
    assertEquals(nao.deps.cofreDaTroca.gravacoes, 0);
  },
);

Deno.test.ignore(
  "trocar-dono fase 2: o e-mail sai do COFRE (a entrada só dá o código), o token novo alcança o projeto ANTES do refresh ir para o cofre, a troca roda pelo pg-meta, relê e dá SIM; o conferir pós-troca passa no item admin",
  async () => {
    const amb = await pedidoDeTroca();
    const refreshAntes = (await registroDoCofre(amb)).refresh;
    assert(refreshAntes !== REFRESH_1);
    const inicio = amb.linha.length;
    // se o passo pedisse o e-mail pela entrada, receberia OUTRO_EMAIL
    amb.entradas.push(CODIGO, OUTRO_EMAIL);
    const r = await receberATroca(amb);
    assertEquals(r.veredito, "SIM", r.mensagem);
    assertEquals(
      amb.entradas,
      [OUTRO_EMAIL],
      "leu da entrada mais que o código",
    );
    const t = amb.api.banco.troca;
    assertEquals(t.escritas, 1);
    assertEquals(t.leituras, 2, "a fase 1 e a releitura");
    assertEquals(amb.api.banco.dono, "outra");
    // o refresh do código substituiu o antigo; o pendente foi usado
    const reg = await registroDoCofre(amb);
    assertEquals(reg.refresh, REFRESH_1);
    assertEquals(reg.pendente, undefined);
    // a ordem: código → GET do projeto → refresh no cofre → a transação
    const l = amb.linha.slice(inicio);
    const i = (pred) => l.findIndex(pred);
    const token = i((x) => x === "fetch POST /v1/oauth/token");
    const projeto = i((x) => x === `fetch GET /v1/projects/${REF}`);
    const cofre = i(
      (x) => x.startsWith("cofre.gravar") && x.includes(REFRESH_1),
    );
    const sql = i((x) => x === `fetch POST /v1/projects/${REF}/database/query`);
    assert(token >= 0 && token < projeto, l.join("\n"));
    assert(
      projeto < cofre,
      "o refresh foi ao cofre antes de conferir o projeto",
    );
    assert(cofre < sql, l.join("\n"));
    // a entrada do e-mail foi apagada; o estado não tem mais o pedido
    assertEquals(await entradaDaTroca(amb), null);
    const estado = JSON.parse(await lerArquivoDeEstado(amb.pasta));
    assertEquals(Object.keys(estado.passos["trocar-dono"]).sort(), [
      "em",
      "veredito",
    ]);
    assertEquals(estado.passos["trocar-dono"].veredito, "SIM");
    // repetir sem pedido novo: NÃO, sem usar código
    amb.entradas.splice(0);
    amb.entradas.push(CODIGO);
    const n = tokenPosts(amb);
    const r2 = await receberATroca(amb);
    assertEquals(r2.veredito, "NÃO", r2.mensagem);
    assertEquals(tokenPosts(amb), n);
    // o conferir pós-troca: a nova é a dona, a antiga segue admin (2 nas duas)
    const c = await executarPasso(pedido("conferir"), amb.deps);
    const v = porItem(c);
    assertEquals(v.admin, "SIM", JSON.stringify(c.itens));
    assertEquals(Reflect.get(v, "definir-dono"), "SIM");
    const admin = c.itens.find((x) => x.item === "admin");
    assertStringIncludes(admin.detalhe, "2 administradoras");
  },
);

Deno.test.ignore(
  "trocar-dono fase 2: sem pedido, sem a entrada no cofre, entrada de outro pedido ou fora do prazo = NÃO sem usar o código nem escrever no banco",
  async () => {
    // a fase 1 nunca rodou
    const sem = await ateADona();
    await executarPasso(pedido("definir-dono"), sem.deps);
    comATrocaViva(sem);
    sem.entradas.push(CODIGO);
    let r = await receberATroca(sem);
    assertEquals(r.veredito, "NÃO", r.mensagem);
    assertStringIncludes(r.mensagem, "trocar-dono --aplicar");
    assertEquals(sem.entradas.length, 1, "pediu o código sem pedido");
    // a entrada do e-mail sumiu do cofre
    const sumiu = await pedidoDeTroca();
    await sumiu.deps.cofreDaTroca.apagar(SLUG);
    sumiu.entradas.push(CODIGO);
    let n = tokenPosts(sumiu);
    r = await receberATroca(sumiu);
    assertEquals(r.veredito, "NÃO", r.mensagem);
    assertEquals(tokenPosts(sumiu), n);
    assertEquals(sumiu.entradas.length, 1);
    assertEquals(sumiu.api.banco.troca.escritas, 0);
    // a entrada é de OUTRO pedido (hora diferente da do estado)
    const outra = await pedidoDeTroca();
    const e = await entradaDaTroca(outra);
    await outra.deps.cofreDaTroca.gravar(
      SLUG,
      JSON.stringify({ ...e, pedidoEm: e.pedidoEm - 1 }),
    );
    outra.entradas.push(CODIGO);
    n = tokenPosts(outra);
    r = await receberATroca(outra);
    assertEquals(r.veredito, "NÃO", r.mensagem);
    assertEquals(tokenPosts(outra), n);
    assertEquals(await entradaDaTroca(outra), null, "não apagou a entrada");
    // passou o prazo de 30 min (contado do pedidoEm)
    const tarde = await pedidoDeTroca();
    tarde.relogio.t += PRAZO_DA_TROCA_MS - 60_000 + 1;
    tarde.entradas.push(CODIGO);
    n = tokenPosts(tarde);
    r = await receberATroca(tarde);
    assertEquals(r.veredito, "NÃO", r.mensagem);
    assertStringIncludes(r.mensagem, "30 min");
    assertEquals(tokenPosts(tarde), n);
    assertEquals(tarde.api.banco.troca.escritas, 0);
    assertEquals(
      await entradaDaTroca(tarde),
      null,
      "prazo vencido: não apagou",
    );
    assertEquals(tarde.api.banco.dono, "alvo");
  },
);

Deno.test.ignore(
  "trocar-dono fase 2 (T3-a): um abrir DEPOIS da fase 1 troca o pedido pendente e o código dele é recusado — sem trocar o código, sem escrever no banco, refresh intacto",
  async () => {
    const amb = await pedidoDeTroca();
    // alguém roda abrir de novo (mesmo app): pendente novo, criadoEm posterior
    amb.relogio.t += 30_000;
    amb.entradas.push(CLIENT_SECRET);
    const a = await executarPasso(pedido("abrir"), amb.deps);
    assertEquals(a.veredito, "SIM", a.mensagem);
    const antes = await amb.deps.cofre.ler(SLUG);
    amb.relogio.t += 30_000;
    amb.entradas.push(CODIGO);
    const n = tokenPosts(amb);
    const r = await receberATroca(amb);
    assertEquals(r.veredito, "NÃO", r.mensagem);
    assertStringIncludes(r.mensagem, "não é o desta troca");
    assertEquals(tokenPosts(amb), n, "trocou o código do abrir");
    assertEquals(await amb.deps.cofre.ler(SLUG), antes, "mexeu no cofre");
    assertEquals(amb.api.banco.troca.escritas, 0);
    assertEquals(amb.api.banco.dono, "alvo");
    assertEquals(await entradaDaTroca(amb), null);
  },
);

Deno.test.ignore(
  "trocar-dono fase 2 (T3-c): token novo que NÃO alcança o projeto da loja = NÃO, o refresh antigo fica no cofre e nada vai ao banco",
  async () => {
    for (const status of [403, 404]) {
      const amb = await pedidoDeTroca();
      const antes = await registroDoCofre(amb);
      amb.api.falharSe = (metodo, caminho) =>
        metodo === "GET" && caminho === `/v1/projects/${REF}`
          ? status
          : undefined;
      amb.entradas.push(CODIGO);
      const r = await receberATroca(amb);
      assertEquals(r.veredito, "NÃO", `${status}: ${r.mensagem}`);
      assertStringIncludes(r.mensagem, "não alcança o projeto");
      assertStringIncludes(r.mensagem, "NÃO foi trocada");
      // depois de o código virar token, não dá para prometer a autorização antiga
      assert(!r.mensagem.includes("o de antes"), r.mensagem);
      assertStringIncludes(r.mensagem, "Pode ser que a autorização antiga");
      const depois = await registroDoCofre(amb);
      assertEquals(depois.refresh, antes.refresh, "sobrescreveu o refresh");
      assertEquals(amb.api.banco.troca.escritas, 0);
      assertEquals(amb.api.banco.dono, "alvo");
      assertEquals(await entradaDaTroca(amb), null);
    }
  },
);

Deno.test.ignore(
  "trocar-dono fase 2: código que o Supabase recusa = NÃO, refresh da loja intacto, e a mensagem NÃO manda rodar abrir",
  async () => {
    const amb = await pedidoDeTroca();
    const antes = await registroDoCofre(amb);
    amb.entradas.push("codigo-ERRADO-0123456789");
    const r = await receberATroca(amb);
    assertEquals(r.veredito, "NÃO", r.mensagem);
    assertStringIncludes(r.mensagem, "trocar-dono --loja");
    assertStringIncludes(
      r.mensagem,
      "Pode ser que a autorização antiga da loja tenha deixado de valer",
    );
    assertStringIncludes(r.mensagem, "nova-loja abrir/receber");
    assert(!r.mensagem.includes("a de antes"), r.mensagem);
    assertEquals((await registroDoCofre(amb)).refresh, antes.refresh);
    assertEquals(amb.api.banco.troca.escritas, 0);
    assertEquals(await entradaDaTroca(amb), null);
  },
);

Deno.test.ignore(
  "trocar-dono fase 2: IKT06 de dentro da transação (a nova bloqueada depois da fase 1, ou já era a dona e está bloqueada) = NÃO, nada gravado, entrada apagada",
  async () => {
    // bloqueada entre a fase 1 e o código
    const amb = await pedidoDeTroca();
    amb.api.banco.troca.bloqueada = true;
    amb.entradas.push(CODIGO);
    let r = await receberATroca(amb);
    assertEquals(r.veredito, "NÃO", r.mensagem);
    assertStringIncludes(r.mensagem, RECUSA_IKT06);
    assertStringIncludes(r.mensagem, "IKT06");
    assertEquals(amb.api.banco.dono, "alvo");
    assertEquals(await entradaDaTroca(amb), null, "recusa: não apagou");
    // já era a dona (fora do desenho entre as fases) e está bloqueada
    const ja = await pedidoDeTroca();
    ja.api.banco.troca.eANova = true;
    ja.api.banco.troca.bloqueada = true;
    ja.entradas.push(CODIGO);
    r = await receberATroca(ja);
    assertEquals(r.veredito, "NÃO", r.mensagem);
    assertStringIncludes(r.mensagem, RECUSA_IKT06);
    // já era a dona, sem bloqueio: SIM sem gravar
    const igual = await pedidoDeTroca();
    igual.api.banco.troca.eANova = true;
    igual.entradas.push(CODIGO);
    r = await receberATroca(igual);
    assertEquals(r.veredito, "SIM", r.mensagem);
    assertStringIncludes(r.mensagem, "nada foi gravado");
  },
);

Deno.test.ignore(
  "trocar-dono fase 2: releitura divergente ou escrita sem resposta = INCERTO (nunca SIM); a entrada do e-mail é apagada",
  async () => {
    const diverge = await pedidoDeTroca({ troca: { releituraDiverge: true } });
    diverge.entradas.push(CODIGO);
    let r = await receberATroca(diverge);
    assertEquals(r.veredito, "INCERTO", r.mensagem);
    assertStringIncludes(r.mensagem, "conferir");
    assertEquals(await entradaDaTroca(diverge), null);
    const cai = await pedidoDeTroca({ troca: { escritaCai: true } });
    cai.entradas.push(CODIGO);
    r = await receberATroca(cai);
    assertEquals(r.veredito, "INCERTO", r.mensagem);
    assertEquals(await entradaDaTroca(cai), null);
    const estado = JSON.parse(await lerArquivoDeEstado(cai.pasta));
    assertEquals(estado.passos["trocar-dono"].veredito, "INCERTO");
  },
);

Deno.test.ignore(
  "trocar-dono fase 2: o e-mail inteiro nunca aparece na saída, na mensagem, no estado nem no cofre da loja (sucesso, recusa e erro com o e-mail)",
  async () => {
    const procurar = async (amb, r) => {
      const tudo = [
        amb.saida.join("\n"),
        r.mensagem,
        await lerArquivoDeEstado(amb.pasta),
        await amb.deps.cofre.ler(SLUG),
      ]
        .join("\n")
        .toLowerCase();
      assert(!tudo.includes(EMAIL_NOVA), "o e-mail vazou");
    };
    const ok = await pedidoDeTroca();
    ok.entradas.push(CODIGO);
    const r1 = await receberATroca(ok);
    assertEquals(r1.veredito, "SIM", r1.mensagem);
    assertStringIncludes(r1.mensagem, MASCARADO);
    await procurar(ok, r1);
    const nao = await pedidoDeTroca();
    nao.api.banco.troca.confirmada = false;
    nao.entradas.push(CODIGO);
    const r2 = await receberATroca(nao);
    assertEquals(r2.veredito, "NÃO", r2.mensagem);
    await procurar(nao, r2);
    // o banco devolve um erro que ecoa o e-mail
    const eco = await pedidoDeTroca();
    const responder = eco.api.banco.responder;
    eco.api.banco.responder = (sql) => {
      if (sql === sqlTrocarDono(EMAIL_NOVA))
        throw Object.assign(new Error(`falhou perto de '${EMAIL_NOVA}'`), {
          sqlstate: "XX000",
        });
      return responder(sql);
    };
    eco.entradas.push(CODIGO);
    const r3 = await receberATroca(eco);
    assertEquals(r3.veredito, "NÃO", r3.mensagem);
    await procurar(eco, r3);
  },
);

Deno.test.ignore(
  "trocar-dono fase 2: sem --aplicar é ENSAIO — nem o código é pedido, 0 chamadas, cofres intactos",
  async () => {
    const amb = await pedidoDeTroca();
    const n = amb.api.chamadas.length;
    const g = amb.deps.cofre.gravacoes;
    const entrada = await amb.deps.cofreDaTroca.ler(SLUG);
    const apagou = amb.deps.cofreDaTroca.apagamentos;
    const r = await executarPasso(
      pedido("trocar-dono", { aplicar: false, receber: true }),
      amb.deps,
    );
    assertStringIncludes(r.mensagem, "ENSAIO");
    assertStringIncludes(r.mensagem, "código");
    assert(r.veredito !== "SIM");
    assertEquals(amb.api.chamadas.length, n);
    assertEquals(amb.deps.cofre.gravacoes, g);
    assertEquals(await amb.deps.cofreDaTroca.ler(SLUG), entrada);
    assertEquals(amb.deps.cofreDaTroca.apagamentos, apagou);
    assertEquals(amb.entradas.length, 0);
  },
);

Deno.test.ignore(
  "trocar-dono: o e-mail de um pedido VENCIDO (ou ilegível) sai do cofre da troca no começo de qualquer passo com --aplicar da loja, conferir incluído; dentro do prazo fica",
  async () => {
    // dentro do prazo, outro passo da loja não apaga
    const amb = await pedidoDeTroca();
    let c = await executarPasso(pedido("conferir"), amb.deps);
    assert(c.veredito !== undefined);
    assert((await entradaDaTroca(amb)) !== null, "apagou dentro do prazo");
    // venceu: o conferir (só leitura no banco) apaga o e-mail do PC
    amb.relogio.t += PRAZO_DA_TROCA_MS;
    c = await executarPasso(pedido("conferir"), amb.deps);
    assertEquals(await entradaDaTroca(amb), null, "o conferir não limpou");
    // venceu: qualquer outro passo com --aplicar também limpa
    const outro = await pedidoDeTroca();
    outro.relogio.t += PRAZO_DA_TROCA_MS;
    const d = await executarPasso(pedido("definir-dono"), outro.deps);
    assert(d.veredito !== undefined);
    assertEquals(
      await entradaDaTroca(outro),
      null,
      "o definir-dono não limpou",
    );
    // ilegível: sai também, mesmo dentro do prazo
    const ruim = await pedidoDeTroca();
    await ruim.deps.cofreDaTroca.gravar(SLUG, "{nao e json");
    await executarPasso(pedido("conferir"), ruim.deps);
    assertEquals(await ruim.deps.cofreDaTroca.ler(SLUG), null);
    // sem --aplicar (ensaio) nada é apagado
    const ensaio = await pedidoDeTroca();
    ensaio.relogio.t += PRAZO_DA_TROCA_MS;
    const n = ensaio.deps.cofreDaTroca.apagamentos;
    await executarPasso(pedido("conferir", { aplicar: false }), ensaio.deps);
    assertEquals(ensaio.deps.cofreDaTroca.apagamentos, n);
  },
);

Deno.test.ignore(
  "receber comum com troca de dona aberta e no prazo = NÃO sem pedir o código (manda usar trocar-dono --receber); depois do prazo volta a valer",
  async () => {
    const amb = await pedidoDeTroca();
    const antes = await amb.deps.cofre.ler(SLUG);
    amb.entradas.push(CODIGO);
    const n = tokenPosts(amb);
    const r = await executarPasso(pedido("receber"), amb.deps);
    assertEquals(r.veredito, "NÃO", r.mensagem);
    assertStringIncludes(r.mensagem, PROXIMO_DA_TROCA);
    assertEquals(amb.entradas.length, 1, "pediu o código");
    assertEquals(tokenPosts(amb), n, "trocou o código da troca");
    assertEquals(await amb.deps.cofre.ler(SLUG), antes, "mexeu no cofre");
    // vencido o pedido, o receber comum funciona como sempre
    amb.relogio.t += PRAZO_DA_TROCA_MS;
    const r2 = await executarPasso(pedido("receber"), amb.deps);
    assertEquals(r2.veredito, "SIM", r2.mensagem);
  },
);
