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
import { join } from "https://deno.land/std@0.177.0/path/mod.ts";
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
  PRAZO_ATIVO_MS,
  SQL_FICHA,
  criarEstadoEmArquivo,
  executarPasso,
  lerArgumentos,
} from "../scripts/frota/nova-loja.mjs";

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
const LOJAS_BRUTAS = {
  lojas: {
    savy: {
      ref: "gnjsrucsmjkajijrakzr",
      classe: "assinante",
      apelido: "Savy",
      segredoDoToken: "SUPABASE_ACCESS_TOKEN_SAVY",
      functionsNomeadas: true,
    },
  },
};

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
function bancoFalso({ ficha = 1, marca = MARCA_DA_FICHA } = {}) {
  const b = {
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
} = {}) {
  const s = {
    chamadas: [],
    linha,
    banco,
    projetos: [...projetos],
    statusSeq: [...statusSeq],
    refreshValido: REFRESH_1,
    nRefresh: 1,
    corposDoPostProjeto: [],
  };
  s.fetch = async (url, init = {}) => {
    const u = new URL(String(url));
    const metodo = init.method ?? "GET";
    const auth = init.headers?.authorization ?? "";
    s.chamadas.push({ metodo, caminho: u.pathname, auth });
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
        return resposta(400, { message: `ERROR:  XX000: ${e.message}` });
      }
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

Deno.test("sem --aplicar: nenhum passo faz POST/PATCH/DELETE, grava cofre ou cria o estado", async () => {
  const amb = await ambiente();
  for (const passo of ["abrir", "receber", "criar-projeto", "banco", "ficha"]) {
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
  for (const passo of ["abrir", "receber", "criar-projeto", "banco", "ficha"]) {
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
  assertThrows(() => lerArgumentos(["segredos", "--loja", SLUG]));
  assertThrows(() => lerArgumentos(["banco", "--loja", "Loja Errada"]));
  assertThrows(() => lerArgumentos(["banco"]));
});
