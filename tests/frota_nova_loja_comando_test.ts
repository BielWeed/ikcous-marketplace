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
import { createRequire } from "node:module";
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
  decidirTroca,
  executarPasso,
  lerArgumentos,
  mascararEmail,
  resultadoDaTroca,
  resumoDoConferir,
  sqlDaConfirmacao,
  sqlDaTroca,
  sqlTrocarDono,
  vereditoGeral,
} from "../scripts/frota/nova-loja.mjs";
const { CONSULTA_GMAIL } = createRequire(import.meta.url)(
  "../scripts/publicacao/login-da-loja-regras.cjs",
);
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
  // o Gmail da loja cadastrado no painel (app_settings email_da_loja)
  gmail = false,
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
    gmail,
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
      if (sql === CONSULTA_GMAIL)
        return [{ dominio_publico: b.dominio, gmail_cadastrado: b.gmail }];
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
    // slug → [{ caminho, conteudo }]: o código no ar de cada function
    codigo: new Map(),
    downloads: 0,
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
      // o código publicado: é o que o download (baixar) devolve depois
      s.codigo.set(
        slug,
        await Promise.all(
          init.body.getAll("file").map(async (a) => ({
            caminho: a.name,
            conteudo: await a.text(),
          })),
        ),
      );
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
  // o download do código no ar (no lugar do CLI do portão; nunca rede)
  s.baixar = async (ref, nome) => {
    s.downloads += 1;
    if (ref !== REF || !s.codigo.has(nome))
      throw new Error("function não existe no ar");
    return s.codigo.get(nome).map((a) => ({ ...a }));
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
    baixarFuncao: api.baixar,
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
  "trocar-dono",
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

Deno.test("criar-projeto (lote 566): HTTP 402 aponta a organização CENTRAL e o dono, nunca a lojista (que não tem conta no Supabase)", async () => {
  const amb = await ambiente({
    apiOpcoes: { postProjeto: () => resposta(402, { message: "pague" }) },
  });
  await conectar(amb);
  const r = await executarPasso(pedido("criar-projeto"), amb.deps);
  assertEquals(r.veredito, "NÃO", r.mensagem);
  assertStringIncludes(r.mensagem, "402");
  assertStringIncludes(r.mensagem, "organização central");
  assertStringIncludes(r.mensagem, "O dono confere Billing");
  assert(!r.mensagem.includes("A lojista confere"), r.mensagem);
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

// ─── A8: uma guarda só para os passos que escrevem ──────────────────────────

const PASSOS_QUE_ESCREVEM = [
  "banco",
  "ficha",
  "dominio",
  "segredos",
  "functions",
  "login",
  "primeira-admin",
  "definir-dono",
  "trocar-dono",
  "marca",
  "chave-do-plano",
];
const REF_DE_OUTRA_LOJA = "refdeoutralojaaaaaaa";

/** A org conectada e o estado local da loja ADULTERADO para apontar `ref`. */
async function comEstadoAdulterado(ref) {
  const amb = await ambiente();
  const lojas = structuredClone(LOJAS_BRUTAS);
  lojas.lojas["outra-loja"] = {
    ...lojas.lojas.savy,
    ref: REF_DE_OUTRA_LOJA,
    segredoDoToken: "SUPABASE_ACCESS_TOKEN_LOJAS",
  };
  amb.deps.lojasBrutas = () => structuredClone(lojas);
  await conectar(amb);
  await amb.deps.estado.gravar(SLUG, {
    versao: 1,
    slug: SLUG,
    passos: {
      "criar-projeto": { veredito: "SIM", ref, org: ORG },
      banco: { veredito: "SIM" },
      ficha: { veredito: "SIM" },
    },
  });
  return amb;
}

Deno.test("A8: todo passo que escreve, com o estado local apontando o projeto da IKCOUS, da Savy ou de outra loja do lojas.json = NÃO, sem fetch, sem cofre e sem mexer no estado", async () => {
  for (const ref of [REF_IKCOUS, REF_SAVY, REF_DE_OUTRA_LOJA]) {
    const amb = await comEstadoAdulterado(ref);
    const estadoAntes = await lerArquivoDeEstado(amb.pasta);
    const n = amb.api.chamadas.length;
    const g = amb.deps.cofre.gravacoes;
    const gb = amb.deps.cofreDoBanco.gravacoes;
    amb.entradas.push(EMAIL, EMAIL, EMAIL, EMAIL);
    for (const passo of PASSOS_QUE_ESCREVEM) {
      for (const aplicar of [true, false]) {
        const r = await executarPasso(pedido(passo, { aplicar }), amb.deps);
        assertEquals(r.veredito, "NÃO", `${ref} ${passo}: ${r.mensagem}`);
      }
    }
    assertEquals(amb.api.chamadas.length, n, `${ref}: fez fetch`);
    assertEquals(amb.deps.cofre.gravacoes, g, `${ref}: gravou no cofre`);
    assertEquals(amb.deps.cofreDoBanco.gravacoes, gb);
    assertEquals(await lerArquivoDeEstado(amb.pasta), estadoAntes, ref);
    assertEquals(amb.entradas.length, 4, `${ref}: leu a entrada`);
  }
});

Deno.test("A8: a guarda nomeia o motivo, e a PRÓPRIA loja cadastrada (lojas.json e canal dela) passa", async () => {
  const amb = await comEstadoAdulterado(REF_DE_OUTRA_LOJA);
  const r = await executarPasso(pedido("banco"), amb.deps);
  assertStringIncludes(r.mensagem, REF_DE_OUTRA_LOJA);
  assertStringIncludes(r.mensagem, "nunca");
  // a loja já cadastrada: o ref dela no lojas.json e o canal dela não a barram
  const propria = await ambiente();
  const lojas = structuredClone(LOJAS_BRUTAS);
  lojas.lojas["loja-nova"] = {
    ...lojas.lojas.savy,
    ref: REF,
    segredoDoToken: "SUPABASE_ACCESS_TOKEN_LOJAS",
  };
  propria.deps.lojasBrutas = () => structuredClone(lojas);
  propria.deps.canaisBrutos = () => ({
    canais: { [REF]: { migrations: SLUG, functions: SLUG } },
  });
  await conectar(propria);
  await propria.deps.estado.gravar(SLUG, {
    versao: 1,
    slug: SLUG,
    passos: { "criar-projeto": { veredito: "SIM", ref: REF, org: ORG } },
  });
  const ok = await executarPasso(
    pedido("banco", { aplicar: false }),
    propria.deps,
  );
  assertStringIncludes(ok.mensagem, "ENSAIO");
});

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
  // modelo da org central (lote 566): o segredo é o ÚNICO da org
  // (org-central.json, segredoDoGitHub), nunca um por loja
  assertStringIncludes(
    texto,
    '"segredoDoToken": "SUPABASE_ACCESS_TOKEN_LOJAS"',
  );
  assert(
    !texto.includes("SUPABASE_ACCESS_TOKEN_LOJA_NOVA"),
    "o segredo do modelo antigo (um por loja) não sai mais",
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
  // --receber: só no autorizar (a troca de dona é uma fase só desde a A15)
  assertEquals(
    lerArgumentos(["trocar-dono", "--loja", SLUG]).receber,
    undefined,
  );
  const e4 = assertThrows(() =>
    lerArgumentos(["receber", "--loja", SLUG, "--receber"]),
  );
  assertStringIncludes(e4.message, "autorizar");
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

// ─── banco depois de uma release nova (lote 566) ────────────────────────────

/** A release trouxe uma migration nova, no FIM da fila. */
const MIGRATION_NOVA = {
  arquivo: "20260103000000_tres.sql",
  corpo: "SELECT 3;",
};
const envelopesDo = (banco) =>
  banco.consultas.filter(
    (q) => q.startsWith("BEGIN;\n") && q !== ddlDoLedger(),
  );
const vereditoNoEstado = async (amb, passo) =>
  JSON.parse(await lerArquivoDeEstado(amb.pasta)).passos[passo]?.veredito;
/** O lojas.json com a loja nova JÁ no cadastro da frota (o ref é o dela). */
const LOJAS_COM_A_NOVA_CADASTRADA = () => ({
  lojas: {
    ...structuredClone(LOJAS_BRUTAS.lojas),
    [SLUG]: {
      ref: REF,
      classe: "assinante",
      apelido: "Nova",
      segredoDoToken: "SUPABASE_ACCESS_TOKEN_LOJAS",
      functionsNomeadas: true,
    },
  },
});

Deno.test("banco (lote 566): release nova depois do SIM — rodar banco aplica SÓ a migration nova, termina SIM e os passos seguintes seguem", async () => {
  const amb = await ateFicha();
  assertEquals(envelopesDo(amb.api.banco).length, 2);
  amb.deps.arquivos = () => [...MIGRATIONS, MIGRATION_NOVA];
  // antes: o ensaio diz o que aplicaria, sem escrever
  const e = await executarPasso(pedido("banco", { aplicar: false }), amb.deps);
  assertStringIncludes(e.mensagem, "ENSAIO");
  assertEquals(envelopesDo(amb.api.banco).length, 2);
  const r = await executarPasso(pedido("banco"), amb.deps);
  assertEquals(r.veredito, "SIM", r.mensagem);
  const env = envelopesDo(amb.api.banco);
  assertEquals(env.length, 3, "só a nova foi enviada");
  assertStringIncludes(env.at(-1), "SELECT 3;");
  assertEquals(amb.api.banco.marcaInstalacao, "concluida");
  assertEquals(await vereditoNoEstado(amb, "banco"), "SIM");
  // rodar de novo não manda nada
  const r2 = await executarPasso(pedido("banco"), amb.deps);
  assertEquals(r2.veredito, "SIM", r2.mensagem);
  assertEquals(envelopesDo(amb.api.banco).length, 3);
  // e a ficha não trava
  const f = await executarPasso(pedido("ficha"), amb.deps);
  assertEquals(f.veredito, "SIM", f.mensagem);
});

Deno.test("banco (lote 566): a loja JÁ no cadastro da frota e atrasada = NÃO sem enviar nada (o portão decide), e o SIM gravado é MANTIDO", async () => {
  const amb = await ateFicha();
  amb.deps.lojasBrutas = LOJAS_COM_A_NOVA_CADASTRADA;
  amb.deps.arquivos = () => [...MIGRATIONS, MIGRATION_NOVA];
  const r = await executarPasso(pedido("banco"), amb.deps);
  assertEquals(r.veredito, "NÃO", r.mensagem);
  assertStringIncludes(r.mensagem, "aplicar-migrations.yml");
  assertStringIncludes(r.mensagem, "mantido");
  assertEquals(envelopesDo(amb.api.banco).length, 2, "nada enviado");
  assertEquals(await vereditoNoEstado(amb, "banco"), "SIM");
  const f = await executarPasso(pedido("ficha", { nome: "Nova" }), amb.deps);
  assertEquals(f.veredito, "SIM", f.mensagem);
});

Deno.test("banco (lote 566): checkout VELHO (o ledger tem versão que esta pasta não tem) = NÃO sem gravar, e o SIM fica", async () => {
  const amb = await ateFicha();
  amb.deps.arquivos = () => MIGRATIONS.slice(0, 1);
  const r = await executarPasso(pedido("banco"), amb.deps);
  assertEquals(r.veredito, "NÃO", r.mensagem);
  assertStringIncludes(r.mensagem, "20260102000000");
  assertEquals(envelopesDo(amb.api.banco).length, 2);
  assertEquals(await vereditoNoEstado(amb, "banco"), "SIM");
});

Deno.test("banco (lote 566): recusa que INDICA DANO (public sem tabela com ledger cheio) rebaixa o SIM para NÃO", async () => {
  const amb = await ateFicha();
  amb.api.banco.tabelas = 0;
  const r = await executarPasso(pedido("banco"), amb.deps);
  assertEquals(r.veredito, "NÃO", r.mensagem);
  assertStringIncludes(r.mensagem, "incoerente");
  assertEquals(await vereditoNoEstado(amb, "banco"), "NÃO");
});

Deno.test("conferir (lote 566): fila com migration nova = item banco NÃO dizendo que a instalação está CONCLUÍDA e o que falta, sem se contradizer", async () => {
  const amb = await ateFicha();
  amb.deps.arquivos = () => [...MIGRATIONS, MIGRATION_NOVA];
  const r = await executarPasso(pedido("conferir"), amb.deps);
  const b = r.itens.find((i) => i.item === "banco");
  assertEquals(b.veredito, "NÃO", b.detalhe);
  assert(!b.detalhe.includes("não está concluída"), b.detalhe);
  assert(!b.detalhe.includes("RECUSADO"), b.detalhe);
  assertStringIncludes(b.detalhe, "está concluída");
  assertStringIncludes(b.detalhe, "1 migration(s) nova(s)");
  assertStringIncludes(b.detalhe, `banco --loja ${SLUG} --aplicar`);
  // a loja já no cadastro: o caminho é o portão, não o banco
  amb.deps.lojasBrutas = LOJAS_COM_A_NOVA_CADASTRADA;
  const r2 = await executarPasso(pedido("conferir"), amb.deps);
  const b2 = r2.itens.find((i) => i.item === "banco");
  assertEquals(b2.veredito, "NÃO", b2.detalhe);
  assertStringIncludes(b2.detalhe, "está concluída");
  assertStringIncludes(b2.detalhe, "aplicar-migrations.yml");
  assert(!b2.detalhe.includes("não está concluída"), b2.detalhe);
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

Deno.test("functions (lote 566): release nova muda o código de uma function já no ar — o conferir dá NÃO, o passo functions a republica SEM --substituir e o conferir volta a SIM", async () => {
  const amb = await ateFicha();
  assertEquals(
    (await executarPasso(pedido("functions"), amb.deps)).veredito,
    "SIM",
  );
  const alvo = "criar-pagamento";
  // o que está no ar passa a ser o código de uma release ANTERIOR
  amb.api.codigo.set(
    alvo,
    amb.api.codigo
      .get(alvo)
      .map((a) =>
        a.caminho.endsWith(`/${alvo}/index.ts`)
          ? { ...a, conteudo: `${a.conteudo}\n// release anterior\n` }
          : a,
      ),
  );
  const c1 = await executarPasso(pedido("conferir"), amb.deps);
  const f1 = c1.itens.find((i) => i.item === "functions");
  assertEquals(f1.veredito, "NÃO", f1.detalhe);
  const de = amb.api.deploys.length;
  const r = await executarPasso(pedido("functions"), amb.deps);
  assertEquals(r.veredito, "SIM", r.mensagem);
  assertEquals(amb.api.deploys.slice(de), [alvo], "só a diferente subiu");
  const c2 = await executarPasso(pedido("conferir"), amb.deps);
  const f2 = c2.itens.find((i) => i.item === "functions");
  assertEquals(f2.veredito, "SIM", f2.detalhe);
});

Deno.test("functions (lote 566): sem o download do código (dependência ausente) o conferir nunca dá o item functions SIM", async () => {
  const amb = await ateFicha();
  assertEquals(
    (await executarPasso(pedido("functions"), amb.deps)).veredito,
    "SIM",
  );
  amb.deps.baixarFuncao = undefined;
  const c = await executarPasso(pedido("conferir"), amb.deps);
  const f = c.itens.find((i) => i.item === "functions");
  assertEquals(f.veredito, "INCERTO", f.detalhe);
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

Deno.test("definir-dono: dono DIFERENTE da admin única = NÃO, não troca, e diz que trocar é pedido escrito da assinante", async () => {
  const amb = await ateADona({
    apiOpcoes: { banco: bancoFalso({ dono: "ex" }) },
  });
  const r = await executarPasso(pedido("definir-dono"), amb.deps);
  assertEquals(r.veredito, "NÃO");
  // D1 (sócio 26/11): quem pede é a ASSINANTE do contrato, por escrito
  assertStringIncludes(r.mensagem, "pedido por escrito da assinante");
  // o passo trocar-dono existe (uma fase só desde a A15): a mensagem aponta para ele
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

// ─── conferir: pronta para VENDER (lote 566) ────────────────────────────────

const itemDe = (r, nome) => r.itens.find((i) => i.item === nome);

Deno.test("conferir (lote 566): ganha os itens 'e-mail de confirmação' e 'mercado pago'; gancho desligado sem Gmail = ATENÇÃO, MP = ATENÇÃO 'a conferir pela lojista no painel'; nunca 'pronta para vender'", async () => {
  const amb = await ateConferir();
  const n = amb.api.chamadas.length;
  const r = await executarPasso(pedido("conferir"), amb.deps);
  const email = itemDe(r, "e-mail de confirmação");
  assert(email, JSON.stringify(r.itens.map((i) => i.item)));
  assertEquals(email.veredito, "ATENÇÃO", email.detalhe);
  assertStringIncludes(email.detalhe, "Gmail");
  const mp = itemDe(r, "mercado pago");
  assert(mp, JSON.stringify(r.itens.map((i) => i.item)));
  assertEquals(mp.veredito, "ATENÇÃO", mp.detalhe);
  assertStringIncludes(mp.detalhe, "a conferir pela lojista no painel");
  // o login (passo do dono) continua SIM: preparar o gancho desligado é o
  // certo para ele; o que falta é da lojista e aparece à parte
  assertEquals(itemDe(r, "login").veredito, "SIM");
  assertEquals(r.veredito, "NÃO");
  assert(!/a loja está pronta para vender/.test(r.mensagem), r.mensagem);
  assertStringIncludes(amb.saida.join("\n"), "[ATENÇÃO] mercado pago");
  // só leitura: o que o item novo lê é GET e consulta read_only
  for (const c of amb.api.chamadas.slice(n)) {
    if (c.metodo === "GET" || c.caminho === "/v1/oauth/token") continue;
    assertEquals(c.somenteLeitura, true, `${c.metodo} ${c.caminho}`);
  }
});

Deno.test("conferir (lote 566): e-mail de confirmação — ligado COM Gmail = SIM; ligado SEM Gmail = NÃO (todo e-mail falha); Gmail sem o gancho ligado = NÃO; leitura que cai = INCERTO", async () => {
  const casos = [
    [true, true, "SIM"],
    [true, false, "NÃO"],
    [false, true, "NÃO"],
  ];
  for (const [ligado, gmail, esperado] of casos) {
    const amb = await ateConferir({
      apiOpcoes: { banco: bancoFalso({ gmail }) },
    });
    amb.api.auth.hook_send_email_enabled = ligado;
    const r = await executarPasso(pedido("conferir"), amb.deps);
    const e = itemDe(r, "e-mail de confirmação");
    assertEquals(e.veredito, esperado, `${ligado}/${gmail}: ${e.detalhe}`);
  }
  const amb = await ateConferir();
  const responder = amb.api.banco.responder;
  amb.api.banco.responder = (sql) => {
    if (sql === CONSULTA_GMAIL)
      throw Object.assign(new Error("caiu"), { http: 503 });
    return responder(sql);
  };
  const r = await executarPasso(pedido("conferir"), amb.deps);
  assertEquals(itemDe(r, "e-mail de confirmação").veredito, "INCERTO");
});

Deno.test("conferir (lote 566): resumoDoConferir — 'pronta para vender' SÓ com todos SIM; ATENÇÃO nunca vira pronta (o veredito é NÃO e diz o que é da lojista); NÃO e INCERTO como antes", () => {
  const i = (item, veredito) => ({ item, veredito, detalhe: "" });
  const todos = [i("banco", "SIM"), i("e-mail de confirmação", "SIM")];
  const sim = resumoDoConferir([...todos, i("mercado pago", "SIM")]);
  assertEquals(sim.veredito, "SIM");
  assertStringIncludes(sim.mensagem, "pronta para vender");

  const atencao = resumoDoConferir([...todos, i("mercado pago", "ATENÇÃO")]);
  assertEquals(atencao.veredito, "NÃO");
  assert(
    !/a loja está pronta para vender/.test(atencao.mensagem),
    atencao.mensagem,
  );
  assertStringIncludes(atencao.mensagem, "ainda não está pronta para vender");
  assertStringIncludes(atencao.mensagem, "mercado pago");

  const nao = resumoDoConferir([
    ...todos,
    i("ficha", "NÃO"),
    i("mercado pago", "ATENÇÃO"),
  ]);
  assertEquals(nao.veredito, "NÃO");
  assert(!/a loja está pronta para vender/.test(nao.mensagem), nao.mensagem);

  const incerto = resumoDoConferir([...todos, i("functions", "INCERTO")]);
  assertEquals(incerto.veredito, "INCERTO");
  assertEquals(resumoDoConferir([]).veredito, "NÃO");
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

// ─── trocar-dono (A15): uma fase só, pelo acesso da org central ─────────────
// No modelo da org central a lojista não tem conta técnica: não há link nem
// código da dona. O pedido escrito da assinante e o aviso à outra admin são
// do runbook (D1); aqui, a dupla confirmação no terminal e a transação.

const EMAIL_NOVA = "nova.dona.falsa@exemplo.test";
const OUTRO_EMAIL = "outra.pessoa.falsa@exemplo.test";
const MASCARADO = "no•••@exemplo.test";
// as 2 primeiras letras do e-mail da dona de HOJE (EMAIL, a lojista)
const LETRAS_DA_DONA = EMAIL.slice(0, 2);
const URL_AUTORIZAR = "https://api.supabase.com/v1/oauth/authorize?";
const RECUSA_IKT06 =
  "conta bloqueada ou apagada no Supabase: desbloqueie ou escolha outra pessoa";
// o SQL da conferência das letras em volta do literal (para o dublê achar a
// letra digitada sem supor o texto)
const [CONF_ANTES, CONF_DEPOIS] = sqlDaConfirmacao("zz").split("'zz'");

/** O banco da troca COM estado, para EMAIL_NOVA: a leitura (sqlDaTroca), a
 * conferência das letras (sqlDaConfirmacao) e a escrita (sqlTrocarDono)
 * seguem a regra do SQL de verdade, na mesma ordem. Qualquer SQL da troca
 * com OUTRO e-mail derruba o teste. A nova já é admin (nomeada pela dona:
 * outrasAdmins = 1). `naEscrita` muda o banco ENTRE a leitura e a escrita. */
function comATrocaViva(amb, o = {}) {
  const banco = amb.api.banco;
  const responder = banco.responder;
  const t = {
    donos: 1,
    contas: 1,
    nova_admin: true,
    confirmada: true,
    bloqueada: false,
    eANova: false,
    leituras: 0,
    confirmacoes: 0,
    escritas: 0,
    leituraCai: false,
    leituraForaDoFormato: false,
    confirmacaoCai: false,
    confirmacaoForaDoFormato: false,
    escritaCai: false,
    escritaSqlstate: null,
    escritaForaDoFormato: false,
    releituraDiverge: false,
    releituraCai: false,
    naEscrita: null,
    ...o,
  };
  banco.outrasAdmins = 1;
  banco.troca = t;
  const linha = () => ({
    donos: t.donos,
    contas: t.contas,
    confirmada: t.confirmada,
    nova_admin: t.nova_admin,
    e_a_dona: t.eANova,
    bloqueada: t.bloqueada,
  });
  banco.responder = (sql) => {
    if (sql === sqlDaTroca(EMAIL_NOVA)) {
      t.leituras += 1;
      const releitura = t.escritas > 0;
      if ((releitura ? t.releituraCai : t.leituraCai) === true)
        throw Object.assign(new Error(`caiu perto de '${EMAIL_NOVA}'`), {
          sqlstate: "XX000",
        });
      if (!releitura && t.leituraForaDoFormato) return [{ donos: 1 }];
      if (releitura && t.releituraDiverge)
        return [{ ...linha(), e_a_dona: false }];
      return [linha()];
    }
    if (sql.startsWith(CONF_ANTES) && sql.endsWith(CONF_DEPOIS)) {
      t.confirmacoes += 1;
      if (t.confirmacaoCai)
        throw Object.assign(new Error("caiu"), { http: 503 });
      if (t.confirmacaoForaDoFormato) return [{ confere: true }];
      const [[, , letras]] = literaisDoSql(
        sql.slice(CONF_ANTES.length, sql.length - CONF_DEPOIS.length),
      );
      // a mesma regra do SQL: lower(left(e-mail da dona de hoje, 2))
      const daDona = t.eANova ? EMAIL_NOVA : EMAIL;
      return [
        {
          donos: t.donos,
          confere:
            t.donos === 1 &&
            daDona.slice(0, 2).toLowerCase() === letras.toLowerCase(),
        },
      ];
    }
    if (sql === sqlTrocarDono(EMAIL_NOVA)) {
      t.escritas += 1;
      if (t.naEscrita) Object.assign(t, t.naEscrita);
      if (t.escritaCai)
        throw Object.assign(new Error("gateway"), { http: 504 });
      const recusa = (sqlstate) =>
        Object.assign(new Error(`recusa perto de '${EMAIL_NOVA}'`), {
          sqlstate,
        });
      if (t.escritaSqlstate) throw recusa(t.escritaSqlstate);
      if (t.escritaForaDoFormato) return [{ resultado: "{}" }];
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
      if (t.donos === 0) throw recusa("IKT01");
      if (t.donos > 1) throw recusa("IKT05");
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
    if (
      sql.includes("trocar_dono") ||
      sql.startsWith("WITH alvo AS") ||
      sql.includes("AS confere")
    )
      throw new Error("SQL da troca com outro e-mail");
    return responder(sql);
  };
  return amb;
}

/** A loja com a dona cadastrada (definir-dono SIM) e o banco da troca. */
async function ateATroca(o = {}) {
  const amb = await ateADona(o);
  const d = await executarPasso(pedido("definir-dono"), amb.deps);
  assertEquals(d.veredito, "SIM", d.mensagem);
  return comATrocaViva(amb, o.troca);
}

const trocar = (amb, extra = {}) =>
  executarPasso(pedido("trocar-dono", extra), amb.deps);

const tokenPosts = (amb) => amb.api.posts("/v1/oauth/token").length;

/** O estado da loja não ganhou entrada do trocar-dono. */
async function semTrocaNoEstado(amb) {
  const e = JSON.parse(await lerArquivoDeEstado(amb.pasta));
  assertEquals(e.passos["trocar-dono"], undefined, "gravou o trocar-dono");
}

Deno.test("trocar-dono: sqlDaConfirmacao é UMA instrução SELECT que devolve só donos e confere (nunca o e-mail), compara as 2 letras sem diferenciar maiúsculas e recusa forma errada sem ecoar", () => {
  const sql = sqlDaConfirmacao("lo");
  assert(sql.startsWith("SELECT "));
  assertEquals(sql.split(";").length, 2, "mais de uma instrução");
  for (const t of ["INSERT", "DELETE", "UPDATE", "BEGIN", "COMMIT", "SET "])
    assert(!sql.includes(t), t);
  // as colunas da resposta: só a contagem e o booleano
  const colunas = [...sql.matchAll(/ AS ([a-z_]+)/g)].map((m) => m[1]);
  assertEquals(colunas, ["donos", "confere"]);
  for (const t of [
    "FROM public.dono_da_loja d JOIN auth.users u ON u.id = d.user_id",
    "lower(left(u.email, 2)) = lower('lo')",
    "bool_and(",
    "COALESCE(",
  ])
    assertStringIncludes(sql, t);
  // aspa dobrada: o literal é um só e é a letra digitada
  for (const letras of ["o'", "''", "'-", "$$", ";-"]) {
    const s = sqlDaConfirmacao(letras);
    const meus = literaisDoSql(s).filter(([, , v]) => v === letras);
    assertEquals(meus.length, 1, letras);
    assertEquals(
      s.replace(`'${letras.replaceAll("'", "''")}'`, "<L>"),
      sql.replace("'lo'", "<L>"),
      `${letras} mudou o SQL fora do literal`,
    );
  }
  for (const ruim of [
    "l",
    "lox",
    "l\\",
    "\\'",
    "l ",
    " l",
    "l\n",
    "lá",
    "",
    null,
    undefined,
    42,
  ]) {
    const e = assertThrows(() => sqlDaConfirmacao(ruim));
    if (typeof ruim === "string" && (ruim.length > 2 || ruim.includes("\\")))
      assert(!e.message.includes(ruim), "ecoou a entrada");
  }
});

Deno.test("trocar-dono: dona cadastrada, nova admin confirmada e a dupla confirmação certa = UMA transação pelo acesso da ORG, relê e dá SIM; nenhum link, nenhum cofre da loja; o conferir passa", async () => {
  const amb = await ateATroca();
  const n = amb.api.chamadas.length;
  const tokens = tokenPosts(amb);
  const lidos = [];
  const ler = amb.deps.cofre.ler;
  amb.deps.cofre.ler = (slug) => {
    lidos.push(slug);
    return ler(slug);
  };
  const s = amb.saida.length;
  const perguntas = [];
  const lerEntrada = amb.deps.lerEntrada;
  amb.deps.lerEntrada = (p) => {
    perguntas.push(p);
    return lerEntrada(p);
  };
  // se o passo pedisse mais alguma coisa, receberia OUTRO_EMAIL
  amb.entradas.push(EMAIL_NOVA, SLUG, LETRAS_DA_DONA, OUTRO_EMAIL);
  const r = await trocar(amb);
  assertEquals(r.veredito, "SIM", r.mensagem);
  assertEquals(amb.entradas, [OUTRO_EMAIL], "leu da entrada mais que 3");
  assertStringIncludes(perguntas[0], "NOVA dona");
  assertStringIncludes(perguntas[1], "nome da loja");
  assertStringIncludes(perguntas[2], "2 primeiras letras");
  assertStringIncludes(perguntas[2], "dona de HOJE");
  const t = amb.api.banco.troca;
  assertEquals([t.leituras, t.confirmacoes, t.escritas], [2, 1, 1]);
  assertEquals(amb.api.banco.dono, "outra");
  // a ordem no banco: lê, confere as letras, UMA escrita, relê
  assertEquals(
    consultasDesde(amb, n).map((c) => c.somenteLeitura === true),
    [true, true, true, false, true],
  );
  // tudo pelo acesso da org: renovou UMA vez (sem código de dona), leu só o
  // cofre da org e a loja não tem cofre
  assertEquals(tokenPosts(amb) - tokens, 1);
  assert(lidos.length > 0 && lidos.every((s) => s === CHAVE_DA_ORG), lidos);
  assertEquals(await ler(SLUG), null);
  for (const c of amb.api.chamadas.slice(n))
    if (c.caminho !== "/v1/oauth/token")
      assertEquals(c.auth, `Bearer ${ACCESS}`);
  const texto = amb.saida.slice(s).join("\n");
  assert(!texto.includes(URL_AUTORIZAR), "imprimiu link de autorização");
  assertStringIncludes(texto, MASCARADO);
  assertStringIncludes(r.mensagem, MASCARADO);
  assertStringIncludes(r.mensagem, "agora é a dona");
  // 2 letras + ••• + @domínio, nunca a parte local inteira
  assertEquals(mascararEmail(EMAIL_NOVA), MASCARADO);
  assertEquals(mascararEmail("ab@x.test"), "a•••@x.test");
  assertEquals(mascararEmail("a@x.test"), "•••@x.test");
  // o estado: só o veredito e a hora
  const e = JSON.parse(await lerArquivoDeEstado(amb.pasta));
  assertEquals(Object.keys(e.passos["trocar-dono"]).sort(), ["em", "veredito"]);
  assertEquals(e.passos["trocar-dono"].veredito, "SIM");
  // o conferir pós-troca: a nova é a dona, a antiga segue admin (2 nas duas)
  const c = await executarPasso(pedido("conferir"), amb.deps);
  const v = porItem(c);
  assertEquals(v.admin, "SIM", JSON.stringify(c.itens));
  assertEquals(Reflect.get(v, "definir-dono"), "SIM");
  const admin = c.itens.find((x) => x.item === "admin");
  assertStringIncludes(admin.detalhe, "2 administradoras");
});

Deno.test("trocar-dono: rodar de novo com a mesma nova dona = SIM sem pedir a dupla confirmação e sem escrever (idempotente)", async () => {
  const amb = await ateATroca();
  amb.entradas.push(EMAIL_NOVA, SLUG, LETRAS_DA_DONA);
  assertEquals((await trocar(amb)).veredito, "SIM");
  amb.entradas.push(EMAIL_NOVA, SLUG, LETRAS_DA_DONA);
  const r = await trocar(amb);
  assertEquals(r.veredito, "SIM", r.mensagem);
  assertStringIncludes(r.mensagem, "já é o da dona");
  assertEquals(amb.entradas, [SLUG, LETRAS_DA_DONA], "pediu a confirmação");
  const t = amb.api.banco.troca;
  assertEquals([t.confirmacoes, t.escritas], [1, 1]);
});

Deno.test("trocar-dono: a dupla confirmação errada = NÃO e nada escrito — nome de outra loja ou com outra caixa, letras de outra pessoa (até as da NOVA dona) ou com forma errada; maiúsculas nas letras valem", async () => {
  // o nome da loja errado: as letras nem são pedidas, nem a conferência roda
  for (const nome of ["outra-loja", "Loja-Nova", "loja-nov", "loja-nova-"]) {
    const amb = await ateATroca();
    amb.entradas.push(EMAIL_NOVA, nome, LETRAS_DA_DONA);
    const r = await trocar(amb);
    assertEquals(r.veredito, "NÃO", `${nome}: ${r.mensagem}`);
    assertStringIncludes(r.mensagem, "nome da loja");
    assertStringIncludes(r.mensagem, "nada foi escrito");
    assertEquals(amb.entradas, [LETRAS_DA_DONA], `${nome}: pediu as letras`);
    const t = amb.api.banco.troca;
    assertEquals([t.confirmacoes, t.escritas], [0, 0], nome);
    assertEquals(amb.api.banco.dono, "alvo");
    await semTrocaNoEstado(amb);
  }
  // as letras com forma errada: recusadas antes de irem ao banco
  for (const letras of ["l", "lox", "l\\", "lá"]) {
    const amb = await ateATroca();
    amb.entradas.push(EMAIL_NOVA, SLUG, letras);
    const r = await trocar(amb);
    assertEquals(r.veredito, "NÃO", `${letras}: ${r.mensagem}`);
    assertStringIncludes(r.mensagem, "2 caracteres");
    if (letras.length > 2 || letras.includes("\\"))
      assert(!r.mensagem.includes(letras), "ecoou as letras");
    const t = amb.api.banco.troca;
    assertEquals([t.confirmacoes, t.escritas], [0, 0], letras);
    await semTrocaNoEstado(amb);
  }
  // as letras de outra pessoa: a conferência roda e recusa
  for (const letras of ["xy", EMAIL_NOVA.slice(0, 2), "ol"]) {
    const amb = await ateATroca();
    amb.entradas.push(EMAIL_NOVA, SLUG, letras);
    const r = await trocar(amb);
    assertEquals(r.veredito, "NÃO", `${letras}: ${r.mensagem}`);
    assertStringIncludes(r.mensagem, "dona de hoje");
    assertStringIncludes(r.mensagem, "nada foi escrito");
    const t = amb.api.banco.troca;
    assertEquals([t.confirmacoes, t.escritas], [1, 0], letras);
    assertEquals(amb.api.banco.dono, "alvo");
    await semTrocaNoEstado(amb);
  }
  // controle: as letras certas em maiúsculas (e com espaço em volta) trocam
  const ok = await ateATroca();
  ok.entradas.push(EMAIL_NOVA, ` ${SLUG} `, LETRAS_DA_DONA.toUpperCase());
  const r = await trocar(ok);
  assertEquals(r.veredito, "SIM", r.mensagem);
  assertEquals(ok.api.banco.troca.escritas, 1);
});

Deno.test("trocar-dono: a conferência das letras que cai, volta fora do formato ou acha a loja sem UMA dona = INCERTO e nada escrito", async () => {
  for (const troca of [
    { confirmacaoCai: true },
    { confirmacaoForaDoFormato: true },
  ]) {
    const amb = await ateATroca({ troca });
    amb.entradas.push(EMAIL_NOVA, SLUG, LETRAS_DA_DONA);
    const r = await trocar(amb);
    assertEquals(
      r.veredito,
      "INCERTO",
      `${JSON.stringify(troca)}: ${r.mensagem}`,
    );
    assertStringIncludes(r.mensagem, "nada foi escrito");
    assertEquals(amb.api.banco.troca.escritas, 0);
    await semTrocaNoEstado(amb);
  }
  // a dona sumiu entre a leitura e a conferência
  const amb = await ateATroca();
  const responder = amb.api.banco.responder;
  amb.api.banco.responder = (sql) => {
    if (sql.startsWith(CONF_ANTES)) amb.api.banco.troca.donos = 0;
    return responder(sql);
  };
  amb.entradas.push(EMAIL_NOVA, SLUG, LETRAS_DA_DONA);
  const r = await trocar(amb);
  assertEquals(r.veredito, "INCERTO", r.mensagem);
  assertEquals(amb.api.banco.troca.escritas, 0);
});

Deno.test("trocar-dono: NUNCA na IKCOUS, na Savy nem nos alvos legados — pelo nome (sem rede, trava, estado nem entrada) e pelo ref", async () => {
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
    await amb.deps.estado.gravar(SLUG, {
      versao: 1,
      slug: SLUG,
      passos: {
        "criar-projeto": { veredito: "SIM", ref, org: ORG },
        banco: { veredito: "SIM" },
      },
    });
    const n = amb.api.chamadas.length;
    amb.entradas.push(EMAIL_NOVA);
    const r = await trocar(amb);
    assertEquals(r.veredito, "NÃO", r.mensagem);
    assertStringIncludes(r.mensagem, "nunca");
    assertEquals(amb.api.chamadas.length, n, "falou com a loja protegida");
    assertEquals(amb.entradas.length, 1);
  }
  // uma chave `classe: legado` qualquer do lojas.json
  const amb = await ambiente();
  await conectar(amb);
  await amb.deps.estado.gravar("legado-novo", {
    versao: 1,
    slug: "legado-novo",
    passos: {
      "criar-projeto": {
        veredito: "SIM",
        ref: "refdeumprojetoaaaaaa",
        org: ORG,
      },
      banco: { veredito: "SIM" },
    },
  });
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
});

Deno.test("trocar-dono: as recusas da leitura (IKT01..IKT06), o e-mail já da dona, a leitura fora do formato ou que cai e o e-mail sem forma = sem dupla confirmação e sem escrita", async () => {
  const casos = [
    [{ donos: 0 }, "NÃO", "não tem dona"],
    [{ nova_admin: false }, "NÃO", "administradora"],
    [{ confirmada: false }, "NÃO", "confirmou"],
    [{ contas: 0 }, "NÃO", "exatamente uma conta"],
    [{ donos: 2 }, "NÃO", "88c"],
    [{ bloqueada: true }, "NÃO", RECUSA_IKT06],
    [{ eANova: true }, "SIM", "já é o da dona"],
    [{ leituraForaDoFormato: true }, "INCERTO", "fora do formato"],
    [{ leituraCai: true }, "INCERTO", "não consegui ler"],
  ];
  for (const [troca, veredito, texto] of casos) {
    const amb = await ateATroca({ troca });
    const s = amb.saida.length;
    amb.entradas.push(EMAIL_NOVA, SLUG, LETRAS_DA_DONA);
    const r = await trocar(amb);
    const nome = JSON.stringify(troca);
    assertEquals(r.veredito, veredito, `${nome}: ${r.mensagem}`);
    assertStringIncludes(r.mensagem, texto, nome);
    assertEquals(amb.entradas, [SLUG, LETRAS_DA_DONA], `${nome}: confirmou`);
    const t = amb.api.banco.troca;
    assertEquals([t.leituras, t.confirmacoes, t.escritas], [1, 0, 0], nome);
    assert(!amb.saida.slice(s).join("\n").includes(MASCARADO), nome);
    await semTrocaNoEstado(amb);
  }
  // a tabela dono_da_loja não existe: NÃO, sem a leitura da troca
  const sem = await ateATroca();
  sem.api.banco.donoTabela = false;
  sem.entradas.push(EMAIL_NOVA);
  const r1 = await trocar(sem);
  assertEquals(r1.veredito, "NÃO", r1.mensagem);
  assertStringIncludes(r1.mensagem, "dono_da_loja não existe");
  assertEquals(sem.api.banco.troca.leituras, 0);
  // e-mail sem forma: recusado antes de qualquer leitura do banco
  const ruim = await ateATroca();
  const n = ruim.api.chamadas.length;
  ruim.entradas.push("sem-arroba");
  const r2 = await trocar(ruim);
  assertEquals(r2.veredito, "NÃO", r2.mensagem);
  assert(!r2.mensagem.includes("sem-arroba"), "ecoou a entrada");
  assertEquals(ruim.api.chamadas.length, n);
  await semTrocaNoEstado(ruim);
});

Deno.test("trocar-dono: recusa de DENTRO da transação (o banco mudou depois da leitura: IKT02, IKT03, IKT04, IKT06, 55P03, 42501) = NÃO, nada gravado; já virou a dona = SIM sem gravar", async () => {
  const casos = [
    [{ naEscrita: { bloqueada: true } }, "IKT06", RECUSA_IKT06],
    [{ naEscrita: { confirmada: false } }, "IKT03", "confirmou"],
    [{ naEscrita: { nova_admin: false } }, "IKT02", "administradora"],
    [{ naEscrita: { contas: 2 } }, "IKT04", "exatamente uma conta"],
    [{ escritaSqlstate: "55P03" }, "55P03", "trava do cargo"],
    [{ escritaSqlstate: "42501" }, "42501", "permissão"],
  ];
  for (const [troca, codigo, texto] of casos) {
    const amb = await ateATroca({ troca });
    amb.entradas.push(EMAIL_NOVA, SLUG, LETRAS_DA_DONA);
    const r = await trocar(amb);
    assertEquals(r.veredito, "NÃO", `${codigo}: ${r.mensagem}`);
    assertStringIncludes(r.mensagem, `SQLSTATE ${codigo}`);
    assertStringIncludes(r.mensagem, texto);
    assertStringIncludes(r.mensagem, "NÃO foi trocada");
    assertEquals(amb.api.banco.dono, "alvo", codigo);
    // a escrita saiu: o estado registra o veredito
    const e = JSON.parse(await lerArquivoDeEstado(amb.pasta));
    assertEquals(e.passos["trocar-dono"].veredito, "NÃO", codigo);
  }
  const ja = await ateATroca({ troca: { naEscrita: { eANova: true } } });
  ja.entradas.push(EMAIL_NOVA, SLUG, LETRAS_DA_DONA);
  const r = await trocar(ja);
  assertEquals(r.veredito, "SIM", r.mensagem);
  assertStringIncludes(r.mensagem, "nada foi gravado");
  assertEquals(ja.api.banco.troca.escritas, 1);
});

Deno.test("trocar-dono: releitura divergente, releitura que cai, escrita sem resposta ou fora do formato = INCERTO (nunca SIM), com o veredito no estado", async () => {
  for (const troca of [
    { releituraDiverge: true },
    { releituraCai: true },
    { escritaCai: true },
    { escritaForaDoFormato: true },
  ]) {
    const amb = await ateATroca({ troca });
    amb.entradas.push(EMAIL_NOVA, SLUG, LETRAS_DA_DONA);
    const r = await trocar(amb);
    const nome = JSON.stringify(troca);
    assertEquals(r.veredito, "INCERTO", `${nome}: ${r.mensagem}`);
    assertStringIncludes(r.mensagem, "conferir");
    assertEquals(amb.api.banco.troca.escritas, 1, nome);
    const e = JSON.parse(await lerArquivoDeEstado(amb.pasta));
    assertEquals(e.passos["trocar-dono"].veredito, "INCERTO", nome);
  }
});

Deno.test("trocar-dono: o estado que não grava depois da troca transforma o SIM em INCERTO (a dona pode ter sido trocada)", async () => {
  const amb = await ateATroca();
  const gravar = amb.deps.estado.gravar;
  amb.deps.estado.gravar = (slug, e) => {
    if (e.passos["trocar-dono"]) throw new Error("disco cheio (falso)");
    return gravar(slug, e);
  };
  amb.entradas.push(EMAIL_NOVA, SLUG, LETRAS_DA_DONA);
  const r = await trocar(amb);
  assertEquals(r.veredito, "INCERTO", r.mensagem);
  assertEquals(amb.api.banco.dono, "outra");
  assertStringIncludes(r.mensagem, "conferir");
});

Deno.test("trocar-dono: o e-mail inteiro da nova dona nunca aparece na saída, na mensagem, no estado nem no cofre (sucesso, recusa, leitura e escrita que ecoam o e-mail)", async () => {
  const procurar = async (amb, r) => {
    const tudo = [
      amb.saida.join("\n"),
      r.mensagem,
      await lerArquivoDeEstado(amb.pasta),
      String(await amb.deps.cofre.ler(SLUG)),
      String(await amb.deps.cofre.ler(CHAVE_DA_ORG)),
    ]
      .join("\n")
      .toLowerCase();
    assert(!tudo.includes(EMAIL_NOVA), "o e-mail vazou");
  };
  const MAIUSCULO = "Nova.Dona.Falsa@Exemplo.TEST";
  const casos = [
    [{}, "SIM"],
    [{ nova_admin: false }, "NÃO"],
    [{ leituraCai: true }, "INCERTO"],
    [{ escritaSqlstate: "XX000" }, "NÃO"],
    [{ releituraCai: true }, "INCERTO"],
  ];
  for (const [troca, veredito] of casos) {
    const amb = await ateATroca({ troca });
    amb.entradas.push(EMAIL_NOVA, SLUG, LETRAS_DA_DONA);
    const r = await trocar(amb);
    assertEquals(
      r.veredito,
      veredito,
      `${JSON.stringify(troca)}: ${r.mensagem}`,
    );
    await procurar(amb, r);
  }
  // o e-mail digitado em maiúsculas e com espaço: nem assim aparece
  const amb = await ateATroca();
  const responder = amb.api.banco.responder;
  amb.api.banco.responder = (sql) =>
    responder(sql.replaceAll(`'${MAIUSCULO}'`, `'${EMAIL_NOVA}'`));
  amb.entradas.push(`  ${MAIUSCULO}  `, SLUG, LETRAS_DA_DONA);
  const r = await trocar(amb);
  assertEquals(r.veredito, "SIM", r.mensagem);
  await procurar(amb, r);
});

Deno.test("trocar-dono sem --aplicar é ENSAIO: nem o e-mail é pedido, 0 chamadas, nada gravado; diz a dupla confirmação", async () => {
  const amb = await ateATroca();
  const n = amb.api.chamadas.length;
  const g = amb.deps.cofre.gravacoes;
  const estadoAntes = await lerArquivoDeEstado(amb.pasta);
  const r = await trocar(amb, { aplicar: false });
  assertStringIncludes(r.mensagem, "ENSAIO");
  assertStringIncludes(r.mensagem, "nome da loja");
  assertStringIncludes(r.mensagem, "2 primeiras letras");
  assert(r.veredito !== "SIM");
  assertEquals(amb.api.chamadas.length, n);
  assertEquals(amb.deps.cofre.gravacoes, g);
  assertEquals(await lerArquivoDeEstado(amb.pasta), estadoAntes);
  assertEquals(amb.entradas.length, 0);
});

Deno.test("trocar-dono --receber não existe mais (a troca é uma fase só): o argumento é recusado e o passo diz NÃO sem entrada, rede nem estado", async () => {
  const e = assertThrows(() =>
    lerArgumentos(["trocar-dono", "--loja", SLUG, "--aplicar", "--receber"]),
  );
  assertStringIncludes(e.message, "uma fase só");
  for (const aplicar of [true, false]) {
    const amb = await ambiente();
    amb.entradas.push(CODIGO);
    const r = await trocar(amb, { receber: true, aplicar });
    assertEquals(r.veredito, "NÃO", r.mensagem);
    assertStringIncludes(r.mensagem, "uma fase só");
    assertStringIncludes(r.mensagem, `trocar-dono --loja ${SLUG} --aplicar`);
    assertEquals(amb.entradas.length, 1);
    assertEquals(amb.api.chamadas.length, 0);
    assertEquals([...Deno.readDirSync(amb.pasta)].length, 0);
  }
});

Deno.test("trocar-dono: com outro comando da MESMA loja rodando (trava), é NÃO sem pedir o e-mail nem falar com o banco", async () => {
  const amb = await ateATroca();
  const liberar = await amb.deps.estado.travar(SLUG);
  try {
    const n = amb.api.chamadas.length;
    amb.entradas.push(EMAIL_NOVA, SLUG, LETRAS_DA_DONA);
    const r = await trocar(amb);
    assertEquals(r.veredito, "NÃO", r.mensagem);
    assertEquals(amb.entradas.length, 3, "pediu o e-mail");
    assertEquals(amb.api.chamadas.length, n);
  } finally {
    await liberar();
  }
});

Deno.test("trocar-dono: o estado antigo da troca em duas fases (com pedidoEm) não trava a loja, e a troca nova o substitui por só o veredito", async () => {
  const amb = await ateATroca();
  const e = JSON.parse(await lerArquivoDeEstado(amb.pasta));
  const antiga = new Date(AGORA - 3_600_000).toISOString();
  e.passos["trocar-dono"] = { pedidoEm: antiga, em: antiga };
  await amb.deps.estado.gravar(SLUG, e);
  // outro passo da loja lê o estado sem recusar
  const c = await executarPasso(pedido("conferir"), amb.deps);
  assert(!c.mensagem.includes("lista branca"), c.mensagem);
  amb.entradas.push(EMAIL_NOVA, SLUG, LETRAS_DA_DONA);
  const r = await trocar(amb);
  assertEquals(r.veredito, "SIM", r.mensagem);
  const depois = JSON.parse(await lerArquivoDeEstado(amb.pasta));
  assertEquals(Object.keys(depois.passos["trocar-dono"]).sort(), [
    "em",
    "veredito",
  ]);
});
