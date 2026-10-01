"use strict";

/**
 * Util compartilhado do teste de CONVERGÊNCIA DE PERMISSÕES (workflow
 * .github/workflows/teste-convergencia-acl.yml).
 *
 * O que este teste prova, em uma frase: partindo do estado de permissões da
 * loja principal medido em 01/10/2026 (anon e authenticated com poder demais),
 * cada pacote de SQL avulso — `seis-funcoes.sql` (primário) e
 * `convergencia-completa.sql` (secundário) — corrige o que diz corrigir SEM
 * quebrar o que o app faz, e o respectivo rollback devolve o estado anterior
 * byte a byte (texto cru do ACL, grantor, grants de coluna, tudo).
 *
 * TRAVA DE BANCO: toda conexão daqui nasce de lerDatabaseUrlEfemera() (só roda
 * com CI_BANCO_EFEMERO=1 e host localhost — tests/banco/efemero.cjs). Os
 * bancos extras (acl_antes, acl_rollback, acl_pix) são CLONES do efêmero do
 * job, criados e apagados aqui; nenhum banco real é alcançável.
 */

/* eslint-disable security/detect-non-literal-fs-filename, security/detect-object-injection --
 * Os caminhos vêm de constantes deste diretório (fixtures versionadas) e os
 * índices de objeto vêm de listas fixas do próprio teste — nunca de entrada de
 * rede nem de terceiro. Mesma convenção dos demais arquivos de tests/banco. */

const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { Client } = require("pg");
const {
  falhar,
  lerDatabaseUrlEfemera,
  anexarAoSummary,
} = require("../efemero.cjs");

const DIR_FIXTURES = path.join(__dirname, "..", "fixtures", "convergencia-acl");
// Fotografias e afins moram fora do repositório (RUNNER_TEMP no Actions).
const DIR_SAIDA = path.join(
  process.env.RUNNER_TEMP || os.tmpdir(),
  "convergencia-acl",
);

const BANCO_ANTES = "acl_antes";
const BANCO_ROLLBACK = "acl_rollback";
const BANCO_PIX = "acl_pix";

// Os sete privilégios que a medição de produção (e o pacote) enxergam.
const SETE_PRIVILEGIOS = [
  "DELETE",
  "INSERT",
  "REFERENCES",
  "SELECT",
  "TRIGGER",
  "TRUNCATE",
  "UPDATE",
];

// ---- Conexão ---------------------------------------------------------------

function nomeDoBancoBase() {
  return (
    new URL(lerDatabaseUrlEfemera()).pathname.replace(/^\//, "") || "postgres"
  );
}

function urlDoBanco(nome) {
  if (!/^[a-z0-9_]+$/.test(nome)) {
    falhar("RECUSADO", `Nome de banco inválido: '${nome}'.`);
  }
  const url = new URL(lerDatabaseUrlEfemera());
  url.pathname = `/${nome}`;
  return url.toString();
}

/** Conecta no banco base (sem argumento) ou num clone pelo nome. */
async function conectar(nome) {
  const url = nome ? urlDoBanco(nome) : lerDatabaseUrlEfemera();
  const cliente = new Client({ connectionString: url });
  try {
    await cliente.connect();
  } catch (erro) {
    falhar(
      "INDETERMINADO",
      `Não conectei no banco efêmero${nome ? ` '${nome}'` : ""}: ${erro.message}`,
    );
  }
  return cliente;
}

async function comAdmin(fn) {
  // template1: o banco usado como molde não pode ter sessão aberta.
  const cliente = await conectar("template1");
  try {
    return await fn(cliente);
  } finally {
    await cliente.end().catch(() => {});
  }
}

async function soltarBanco(nome) {
  await comAdmin((admin) => admin.query(`DROP DATABASE IF EXISTS "${nome}"`));
}

/**
 * CREATE DATABASE … TEMPLATE. O Postgres recusa (55006) enquanto o molde tem
 * sessão aberta — e o fim de uma conexão é visto pelo servidor um instante
 * depois do `end()` do cliente. Tenta de novo por ~5 s antes de desistir.
 */
async function clonarBanco(origem, destino) {
  await soltarBanco(destino);
  let ultimoErro = null;
  for (let tentativa = 1; tentativa <= 10; tentativa++) {
    try {
      await comAdmin((admin) =>
        admin.query(`CREATE DATABASE "${destino}" TEMPLATE "${origem}"`),
      );
      return;
    } catch (erro) {
      ultimoErro = erro;
      if (erro.code !== "55006") break;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  falhar(
    "FALHOU",
    `Não consegui clonar '${origem}' em '${destino}': ${ultimoErro.message}`,
  );
}

// ---- Fixtures versionadas --------------------------------------------------

function lerFixture(nome) {
  return fs.readFileSync(path.join(DIR_FIXTURES, nome), "utf8");
}

/** principal-acl.txt: `assinatura~AU;assinatura~--;…` (AU = anon e auth). */
function lerPrincipalAcl() {
  return lerFixture("principal-acl.txt")
    .trim()
    .split(";")
    .filter(Boolean)
    .map((item) => {
      const corte = item.lastIndexOf("~");
      return { fn: item.slice(0, corte), marca: item.slice(corte + 1).trim() };
    });
}

/** savy-acl.json: o stdout do CLI traz uma linha de ruído antes do JSON. */
function lerSavyAcl() {
  const bruto = lerFixture("savy-acl.json");
  const json = JSON.parse(bruto.slice(bruto.indexOf("{")));
  return json.rows;
}

/** savy-tab-priv.txt: `rel~papel~PRIVILEGIOSCOLADOS;…` -> Map rel -> papel -> str. */
function lerSavyTabPriv() {
  const mapa = new Map();
  for (const item of lerFixture("savy-tab-priv.txt")
    .trim()
    .split(";")
    .filter(Boolean)) {
    const [rel, papel, privilegios = ""] = item.trim().split("~");
    if (!mapa.has(rel)) mapa.set(rel, {});
    mapa.get(rel)[papel] = privilegios;
  }
  return mapa;
}

// ---- Os dois pacotes -------------------------------------------------------

/**
 * Dois objetos de teste, dois jobs do workflow (variável PACOTE_ACL):
 *   seis  — PRIMÁRIO. Fecha para anon/authenticated 6 funções de pagamento.
 *   amplo — SECUNDÁRIO. A convergência completa para o estado da Savy.
 *
 * `sentinela` é o que prova, de uma conexão nova, que o COMMIT valeu: o EXECUTE
 * de anon numa função que o pacote fecha (e o desfazer reabre).
 */
const SEIS = [
  {
    sig: "pagamentos_a_reconciliar()",
    sql: "SELECT count(*)::int AS r FROM public.pagamentos_a_reconciliar()",
    params: [],
  },
  {
    sig: "liberar_cobranca_do_pedido(uuid,text)",
    sql: "SELECT public.liberar_cobranca_do_pedido($1::uuid, $2::text) AS r",
    params: ["O_PIX", "GW_PIX"],
  },
  {
    sig: "concluir_estorno(uuid,text,text,text)",
    sql: "SELECT public.concluir_estorno($1::uuid, 'mp-acl-1', 'approved', 'accredited') AS r",
    params: ["REFUND"],
  },
  {
    sig: "devolver_estoque(uuid)",
    sql: "SELECT public.devolver_estoque($1::uuid) AS r",
    params: ["O_PIX"],
  },
  {
    sig: "expirar_pedidos_vencidos()",
    sql: "SELECT public.expirar_pedidos_vencidos() AS r",
    params: [],
  },
  {
    sig: "devolver_cupons_de_pedidos_mortos()",
    sql: "SELECT public.devolver_cupons_de_pedidos_mortos() AS r",
    params: [],
  },
];

const DUAS_FECHADAS = [
  "confirmar_pagamento(uuid,text,text)",
  "devolver_uso_cupom(uuid)",
];

const PUBLICAS_EXPLICITAS = [
  "branding_a2_assets_valid(jsonb)",
  "branding_a2_file_valid(jsonb,text)",
  "branding_a2_logo_valid(jsonb,text)",
  "f_digitos(text)",
  "f_unaccent(text)",
  "forma_de_pagamento_aceita(text)",
  "formas_pagamento_sem_duplicata(text[])",
  "get_segmented_push_count(text,numeric,integer)",
  "handle_produto_atualizado()",
  "handle_variant_atualiza_produto()",
  "is_local_cep(text,text,text)",
  "limpar_cotacoes_fora_da_janela()",
  "marca_avaliacao_nasce_verificada()",
  "marca_avaliacoes_do_pedido_verificadas()",
  "notifica_cliente_de_mudanca_de_pagamento()",
  "notifica_cliente_de_mudanca_de_status()",
];

const PACOTES = {
  seis: {
    id: "seis",
    rotulo: "PRIMÁRIO — seis funções",
    aplica: "seis-funcoes.sql",
    desfaz: "seis-funcoes-rollback.sql",
    sentinela: "public.pagamentos_a_reconciliar()",
    anon: 152,
    auth: 152,
    // A 2ª aplicação (e o 2º desfazer) recusam na PRÉ-CONDIÇÃO do próprio SQL
    // (proacl exato medido) — por desenho: abortam sem mudar nada.
    reaplicacao: "recusa",
    redesfazer: "recusa",
    mensagemRecusaAplicar: "pré-condição",
    mensagemRecusaDesfazer: "pré-condição do desfazer",
  },
  amplo: {
    id: "amplo",
    rotulo: "SECUNDÁRIO — pacote amplo",
    aplica: "convergencia-completa.sql",
    desfaz: "rollback-completo.sql",
    sentinela: "public.check_is_admin()",
    anon: 27,
    auth: 95,
    reaplicacao: "idempotente",
    redesfazer: "idempotente",
  },
};

function pacoteDoJob() {
  const id = process.env.PACOTE_ACL;
  if (!id || !Object.hasOwn(PACOTES, id)) {
    falhar(
      "USO",
      `PACOTE_ACL ausente ou inválido ('${id || ""}'). Valores: ${Object.keys(PACOTES).join(", ")}.`,
    );
  }
  return PACOTES[id];
}

// ---- Aplicar SQL (transacional, com prova de COMMIT) -----------------------

/** Roda texto SQL numa conexão própria; devolve null (ok) ou o erro do Postgres. */
async function executarSql(banco, sql) {
  const cliente = await conectar(banco);
  try {
    await cliente.query('SET search_path = "$user", public, extensions');
    await cliente.query(sql);
    return null;
  } catch (erro) {
    return erro;
  } finally {
    await cliente.end().catch(() => {});
  }
}

async function anonExecuta(banco, sentinela) {
  const prova = await conectar(banco);
  try {
    const r = await prova.query(
      "SELECT has_function_privilege('anon', $1, 'EXECUTE') AS anon",
      [sentinela],
    );
    return r.rows[0].anon;
  } finally {
    await prova.end().catch(() => {});
  }
}

/**
 * Roda um arquivo SQL do pacote (que traz o próprio BEGIN … COMMIT) num banco
 * e prova, de uma conexão NOVA, que ele COMMITOU: `sentinela` é uma função que
 * o pacote fecha — depois de aplicar, anon NÃO a executa; depois de desfazer,
 * executa (`anonExecutaDepois`).
 */
async function aplicarSql(banco, arquivo, sentinela, anonExecutaDepois) {
  const erro = await executarSql(banco, lerFixture(arquivo));
  if (erro) {
    falhar(
      "ABORTOU",
      `${arquivo} abortou em '${banco || nomeDoBancoBase()}' e a transação foi desfeita inteira: ${erro.message}\n${erro.where || ""}`,
    );
  }
  const anon = await anonExecuta(banco, sentinela);
  if (anon !== anonExecutaDepois) {
    falhar(
      "NAO_COMMITOU",
      `${arquivo} rodou sem erro, mas de uma conexão nova anon ${anon ? "AINDA" : "NÃO"} executa ${sentinela} — o COMMIT não valeu.`,
    );
  }
}

// ---- Fotografia do privilégio efetivo --------------------------------------

/*
 * Formatos das linhas (separador `|`):
 *   FN_PROACL|<sig>|<proacl::text, ou <NULO>>        texto CRU do ACL da função
 *   FN_PROACL_NULO|<sig>|true|false                  proacl IS NULL
 *   FN_ACLDEFAULT|<sig>|<acldefault('f', dono)::text>
 *   FN|<sig>|<grantee>|<grantor>|<privilégio>|<grantable>   cada entrada de
 *        aclexplode(coalesce(proacl, acldefault('f', dono))); PUBLIC quando 0
 *   FN_EFETIVO|<sig>|anon=…|authenticated=…|service_role=…
 *   FN_DONO|<sig>|<dono>
 *   REL|<relação>|<relkind>|<grantee>|<grantor>|<privilégios>
 *   REL_EFETIVO|<relação>|<papel>|<privilégios efetivos dos 7>
 *   COL|<relação.coluna>|<grantee>|<grantor>|<privilégio>|<grantable>
 */
const SQL_FOTOGRAFIA = `
SELECT linha FROM (
  SELECT 'FN_PROACL|' || regexp_replace(p.oid::regprocedure::text, '^public\\.', '')
         || '|' || COALESCE(p.proacl::text, '<NULO>') AS linha
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
  UNION ALL
  SELECT 'FN_PROACL_NULO|' || regexp_replace(p.oid::regprocedure::text, '^public\\.', '')
         || '|' || (p.proacl IS NULL)::text
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
  UNION ALL
  SELECT 'FN_ACLDEFAULT|' || regexp_replace(p.oid::regprocedure::text, '^public\\.', '')
         || '|' || acldefault('f', p.proowner)::text
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
  UNION ALL
  -- cada entrada do ACL das funcoes (proacl NULL = padrao: dono + PUBLIC)
  SELECT 'FN|' || regexp_replace(p.oid::regprocedure::text, '^public\\.', '')
         || '|' || CASE x.grantee WHEN 0 THEN 'PUBLIC' ELSE pg_get_userbyid(x.grantee) END
         || '|' || CASE x.grantor WHEN 0 THEN 'PUBLIC' ELSE pg_get_userbyid(x.grantor) END
         || '|' || x.privilege_type
         || '|' || x.is_grantable::text
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) x
   WHERE n.nspname = 'public'
  UNION ALL
  -- EFETIVO por papel (inclui PUBLIC e heranca)
  SELECT 'FN_EFETIVO|' || regexp_replace(p.oid::regprocedure::text, '^public\\.', '')
         || '|anon=' || has_function_privilege('anon', p.oid, 'EXECUTE')
         || '|authenticated=' || has_function_privilege('authenticated', p.oid, 'EXECUTE')
         || '|service_role=' || has_function_privilege('service_role', p.oid, 'EXECUTE')
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
  UNION ALL
  SELECT 'FN_DONO|' || regexp_replace(p.oid::regprocedure::text, '^public\\.', '')
         || '|' || pg_get_userbyid(p.proowner)
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
  UNION ALL
  -- ACL das relacoes (tabelas, views, matviews), por grantee e grantor
  SELECT 'REL|' || c.relname || '|' || c.relkind::text
         || '|' || CASE x.grantee WHEN 0 THEN 'PUBLIC' ELSE pg_get_userbyid(x.grantee) END
         || '|' || CASE x.grantor WHEN 0 THEN 'PUBLIC' ELSE pg_get_userbyid(x.grantor) END
         || '|' || string_agg(x.privilege_type || CASE WHEN x.is_grantable THEN '+grant' ELSE '' END,
                              ',' ORDER BY x.privilege_type)
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl, acldefault('r', c.relowner))) x
   WHERE n.nspname = 'public' AND c.relkind IN ('r', 'v', 'm', 'p', 'f')
   GROUP BY c.relname, c.relkind, x.grantee, x.grantor
  UNION ALL
  -- EFETIVO por relacao x papel x os sete privilegios
  SELECT 'REL_EFETIVO|' || c.relname || '|' || r.rolname || '|'
         || COALESCE(string_agg(pr.privilegio, ',' ORDER BY pr.privilegio)
                     FILTER (WHERE has_table_privilege(r.rolname::name, c.oid, pr.privilegio)), '')
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    CROSS JOIN (VALUES ('anon'), ('authenticated'), ('service_role')) r(rolname)
    CROSS JOIN (VALUES ('DELETE'), ('INSERT'), ('REFERENCES'), ('SELECT'),
                       ('TRIGGER'), ('TRUNCATE'), ('UPDATE')) pr(privilegio)
   WHERE n.nspname = 'public' AND c.relkind IN ('r', 'v', 'm', 'p', 'f')
   GROUP BY c.relname, c.oid, r.rolname
  UNION ALL
  -- ACL de COLUNA (os grants proprios por coluna)
  SELECT 'COL|' || c.relname || '.' || a.attname
         || '|' || CASE x.grantee WHEN 0 THEN 'PUBLIC' ELSE pg_get_userbyid(x.grantee) END
         || '|' || CASE x.grantor WHEN 0 THEN 'PUBLIC' ELSE pg_get_userbyid(x.grantor) END
         || '|' || x.privilege_type
         || '|' || x.is_grantable::text
    FROM pg_attribute a
    JOIN pg_class c ON c.oid = a.attrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    CROSS JOIN LATERAL aclexplode(a.attacl) x
   WHERE n.nspname = 'public' AND a.attnum > 0 AND NOT a.attisdropped
     AND a.attacl IS NOT NULL
) t
`;

/** Lista ordenada de linhas: o privilégio efetivo da loja, sem ruído de OID. */
async function fotografar(cliente) {
  const r = await cliente.query(SQL_FOTOGRAFIA);
  return r.rows.map((linha) => linha.linha).sort();
}

function diferencas(a, b) {
  const conjuntoA = new Set(a);
  const conjuntoB = new Set(b);
  return {
    soNoA: a.filter((linha) => !conjuntoB.has(linha)),
    soNoB: b.filter((linha) => !conjuntoA.has(linha)),
  };
}

function imprimirLista(rotulo, linhas, limite = 80) {
  if (linhas.length === 0) return;
  console.log(`  ${rotulo} (${linhas.length}):`);
  for (const linha of linhas.slice(0, limite)) console.log(`    - ${linha}`);
  if (linhas.length > limite) {
    console.log(`    … e mais ${linhas.length - limite}`);
  }
}

/** Compara com a fotografia esperada; imprime a diferença LITERAL e lança se houver. */
function exigirIgual(esperada, obtida, rotulo) {
  const { soNoA, soNoB } = diferencas(esperada, obtida);
  imprimirLista(`${rotulo}: só no ESPERADO`, soNoA, 200);
  imprimirLista(`${rotulo}: só no OBTIDO`, soNoB, 200);
  if (soNoA.length || soNoB.length) {
    throw new Falha(
      `${rotulo}: fotografia diferente (${soNoA.length} linha(s) só no esperado, ${soNoB.length} só no obtido)`,
      [...soNoA.map((l) => `- ${l}`), ...soNoB.map((l) => `+ ${l}`)].slice(
        0,
        120,
      ),
    );
  }
}

/**
 * Prova ESTÁTICA de que o arquivo é uma transação inteira: sem comentários, a
 * primeira instrução é `BEGIN;`, a última é `COMMIT;`, e há exatamente um de
 * cada (nenhum COMMIT no meio, que fecharia a transação antes da conferência
 * final). Isto NÃO se prova rodando: o protocolo simples do `pg` já embrulha um
 * texto de várias instruções numa transação implícita, então um arquivo sem
 * BEGIN também "aborta inteiro" quando vai por `client.query(texto)`. O BEGIN
 * importa para quem roda o arquivo por outra via (psql sem `-1`, editor de SQL),
 * onde cada instrução gravaria sozinha — por isso a conferência é do TEXTO.
 * Devolve uma descrição curta; lança Falha se a estrutura não for essa.
 */
function exigirBeginCommit(sql, rotulo) {
  const semComentarios = sql
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split(/\r?\n/)
    .filter((linha) => !/^\s*--/.test(linha) && linha.trim() !== "")
    .join("\n")
    .trim();
  const begins = (semComentarios.match(/^\s*BEGIN\s*;\s*$/gim) || []).length;
  const commits = (semComentarios.match(/^\s*COMMIT\s*;\s*$/gim) || []).length;
  const comecaComBegin = /^BEGIN\s*;/i.test(semComentarios);
  const terminaComCommit = /(^|\n)\s*COMMIT\s*;$/i.test(semComentarios);
  const problemas = [];
  if (!comecaComBegin) problemas.push("a primeira instrução NÃO é BEGIN;");
  if (!terminaComCommit) problemas.push("a última instrução NÃO é COMMIT;");
  if (begins !== 1) problemas.push(`${begins} linha(s) BEGIN; (esperava 1)`);
  if (commits !== 1) problemas.push(`${commits} linha(s) COMMIT; (esperava 1)`);
  if (problemas.length) {
    throw new Falha(`${rotulo}: não é uma transação inteira`, problemas);
  }
  return `${rotulo}: primeira instrução BEGIN;, última COMMIT;, 1 BEGIN e 1 COMMIT`;
}

function gravarFotografia(nome, linhas) {
  fs.mkdirSync(DIR_SAIDA, { recursive: true });
  fs.writeFileSync(
    path.join(DIR_SAIDA, `${nome}.json`),
    JSON.stringify(linhas),
    "utf8",
  );
}

function lerFotografia(nome) {
  const caminho = path.join(DIR_SAIDA, `${nome}.json`);
  if (!fs.existsSync(caminho)) {
    falhar(
      "INDETERMINADO",
      `Fotografia '${nome}' não existe em ${DIR_SAIDA} — o passo que a grava rodou antes?`,
    );
  }
  return JSON.parse(fs.readFileSync(caminho, "utf8"));
}

// ---- Medidas que mais de um script usa -------------------------------------

async function medirFuncoes(cliente) {
  const r = await cliente.query(`
    SELECT regexp_replace(p.oid::regprocedure::text, '^public\\.', '') AS fn,
           has_function_privilege('anon', p.oid, 'EXECUTE') AS anon,
           has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth,
           has_function_privilege('service_role', p.oid, 'EXECUTE') AS sr,
           p.prosecdef AS secdef,
           pg_get_userbyid(p.proowner) AS dono,
           COALESCE((SELECT bool_or(x.grantee = 0 AND x.privilege_type = 'EXECUTE')
                       FROM aclexplode(p.proacl) x), false) AS public_explicito
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
  `);
  return r.rows;
}

async function medirRelacoes(cliente) {
  const r = await cliente.query(
    `
    SELECT c.relname,
           r.rolname AS papel,
           COALESCE(string_agg(pr.privilegio, '' ORDER BY pr.privilegio)
                    FILTER (WHERE has_table_privilege(r.rolname::name, c.oid, pr.privilegio)), '') AS privs
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      CROSS JOIN (VALUES ('anon'), ('authenticated')) r(rolname)
      CROSS JOIN unnest($1::text[]) pr(privilegio)
     WHERE n.nspname = 'public' AND c.relkind IN ('r', 'v', 'm', 'p', 'f')
     GROUP BY c.relname, r.rolname
    `,
    [SETE_PRIVILEGIOS],
  );
  return r.rows;
}

// ---- Resultado por caso ----------------------------------------------------

class Falha extends Error {
  constructor(mensagem, detalhe = []) {
    super(mensagem);
    this.code = "ASSERT";
    this.detalhe = detalhe;
  }
}

function criarRelator() {
  const resultado = { ok: 0, falhas: 0, infos: 0, linhas: [] };
  return {
    resultado,
    ok(grupo, caso, detalhe) {
      resultado.ok++;
      const linha = `OK ${grupo} ${caso}${detalhe ? ` — ${detalhe}` : ""}`;
      resultado.linhas.push(linha);
      console.log(linha);
    },
    falha(grupo, caso, erro) {
      resultado.falhas++;
      const linha = `FALHA ${grupo} ${caso}: ${erro.code || "-"} ${String(erro.message).split("\n")[0]}`;
      resultado.linhas.push(linha);
      console.log(linha);
      for (const extra of erro.detalhe || []) console.log(`    ${extra}`);
    },
    // Registro de um resultado real que NÃO decide o job (ex.: o bloqueio do
    // pacote amplo medido no pacote pequeno, onde continua aberto).
    info(grupo, caso, detalhe, itens = []) {
      resultado.infos++;
      const linha = `INFO ${grupo} ${caso}: ${detalhe}`;
      resultado.linhas.push(linha);
      console.log(linha);
      for (const item of itens.slice(0, 60)) console.log(`    ${item}`);
    },
    aviso(grupo, caso, detalhe, itens = []) {
      const linha = `AVISO ${grupo} ${caso}: ${detalhe}`;
      resultado.linhas.push(linha);
      console.log(linha);
      for (const item of itens.slice(0, 60)) console.log(`    ${item}`);
    },
  };
}

function resumir(titulo, resultado) {
  const corpo = `**${resultado.ok} OK · ${resultado.falhas} FALHA · ${resultado.infos || 0} INFO**\n\n\`\`\`\n${resultado.linhas.join("\n")}\n\`\`\``;
  anexarAoSummary(titulo, corpo);
}

// ---- O servidor (service_role) ---------------------------------------------

/**
 * As funções de `public` que o service_role NÃO executa. Não é invariante do
 * produto ("o servidor executa tudo" não vale: a Savy tem 5 ausências
 * intencionais, as migrations as pretendem) — é o que o pacote tem de deixar
 * EXATAMENTE como achou. Devolve as assinaturas, ordenadas.
 */
async function ausenciasDoServidor(cliente) {
  const r = await cliente.query(`
    SELECT regexp_replace(p.oid::regprocedure::text, '^public\\.', '') AS fn
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND NOT has_function_privilege('service_role', p.oid, 'EXECUTE')`);
  return r.rows.map((l) => l.fn).sort();
}

function imprimirAusencias(rotulo, lista) {
  console.log(`  ausências do servidor — ${rotulo}: ${lista.length}`);
  for (const sig of lista) console.log(`    - ${sig}`);
}

/**
 * Compara duas listas de ausências do servidor; imprime as duas (lista e
 * contagem) e lança Falha se diferirem.
 */
function exigirAusenciasIguais(esperada, obtida, rotulo) {
  imprimirAusencias(`${rotulo}: esperado`, esperada);
  imprimirAusencias(`${rotulo}: obtido`, obtida);
  const { soNoA, soNoB } = diferencas(esperada, obtida);
  if (soNoA.length || soNoB.length) {
    throw new Falha(
      `${rotulo}: o conjunto de ausências do servidor mudou (${esperada.length} → ${obtida.length})`,
      [
        ...soNoA.map((l) => `- passou a ser executada pelo servidor: ${l}`),
        ...soNoB.map((l) => `+ passou a NÃO ser executada pelo servidor: ${l}`),
      ],
    );
  }
}

// ---- Análise de duas fotografias -------------------------------------------

const PAPEIS_DO_APP = ["anon", "authenticated"];

/**
 * O que MUDOU entre duas fotografias e NÃO é privilégio de anon/authenticated:
 * service_role, PUBLIC, dono e grants de coluna de outros papéis têm de ficar
 * idênticos. Devolve as linhas que violam isso (vazio = tudo certo).
 */
function mudancasForaDeAnonEAuth(antes, depois) {
  const { soNoA, soNoB } = diferencas(antes, depois);
  const srDe = (linhas) => {
    const mapa = new Map();
    for (const linha of linhas) {
      const p = linha.split("|");
      if (p[0] === "FN_EFETIVO") mapa.set(p[1], p[4]);
    }
    return mapa;
  };
  const srAntes = srDe(antes);
  const srDepois = srDe(depois);
  const ruins = [];
  for (const [lado, linhas] of [
    ["só antes", soNoA],
    ["só depois", soNoB],
  ]) {
    for (const linha of linhas) {
      const p = linha.split("|");
      const tipo = p[0];
      let permitido;
      if (tipo === "FN" || tipo === "COL")
        permitido = PAPEIS_DO_APP.includes(p[2]);
      else if (tipo === "REL") permitido = PAPEIS_DO_APP.includes(p[3]);
      else if (tipo === "REL_EFETIVO") permitido = PAPEIS_DO_APP.includes(p[2]);
      else if (tipo === "FN_EFETIVO")
        permitido = srAntes.get(p[1]) === srDepois.get(p[1]);
      // O texto cru do ACL muda porque as entradas de anon/authenticated mudam
      // (essas já foram julgadas nas linhas FN); PUBLIC, dono e acldefault não.
      else permitido = tipo === "FN_PROACL"; // FN_DONO, FN_ACLDEFAULT, FN_PROACL_NULO…
      if (!permitido) ruins.push(`${lado}: ${linha}`);
    }
  }
  return ruins;
}

const PROACL_ABERTA =
  "{postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}";
const PROACL_FECHADA = "{postgres=X/postgres,service_role=X/postgres}";

/**
 * A diferença antes→depois é EXATAMENTE a das `assinaturas` fechadas — de
 * `PROACL_ABERTA` para `PROACL_FECHADA`, linha a linha — e nada além.
 */
function mudancasAlemDasFechadas(antes, depois, assinaturas) {
  const esperadoSoAntes = new Set();
  const esperadoSoDepois = new Set();
  for (const sig of assinaturas) {
    esperadoSoAntes.add(`FN_PROACL|${sig}|${PROACL_ABERTA}`);
    esperadoSoAntes.add(`FN|${sig}|anon|postgres|EXECUTE|false`);
    esperadoSoAntes.add(`FN|${sig}|authenticated|postgres|EXECUTE|false`);
    esperadoSoAntes.add(
      `FN_EFETIVO|${sig}|anon=true|authenticated=true|service_role=true`,
    );
    esperadoSoDepois.add(`FN_PROACL|${sig}|${PROACL_FECHADA}`);
    esperadoSoDepois.add(
      `FN_EFETIVO|${sig}|anon=false|authenticated=false|service_role=true`,
    );
  }
  const { soNoA, soNoB } = diferencas(antes, depois);
  const ruins = [];
  for (const l of soNoA) {
    if (!esperadoSoAntes.has(l))
      ruins.push(`mudou além do esperado (só antes): ${l}`);
  }
  for (const l of soNoB) {
    if (!esperadoSoDepois.has(l))
      ruins.push(`mudou além do esperado (só depois): ${l}`);
  }
  for (const l of esperadoSoAntes) {
    if (!soNoA.includes(l)) ruins.push(`deveria ter saído e não saiu: ${l}`);
  }
  for (const l of esperadoSoDepois) {
    if (!soNoB.includes(l))
      ruins.push(`deveria ter entrado e não entrou: ${l}`);
  }
  return ruins;
}

// ---- Prova existente: rodar no "antes" e no "depois" e comparar ------------

/** Roda um script node contra um banco do job; captura a saída. */
function rodarNode(argumentos, banco) {
  const r = spawnSync(process.execPath, argumentos, {
    env: { ...process.env, DATABASE_URL: urlDoBanco(banco) },
    encoding: "utf8",
    maxBuffer: 512 * 1024 * 1024,
  });
  return {
    status: r.status ?? 1,
    saida: `${r.stdout || ""}\n${r.stderr || ""}${r.error ? `\n${r.error.message}` : ""}`,
  };
}

/** As provas vivas imprimem `  PASSOU <nome>` / `  FALHOU <nome>`. */
function lerPassouFalhou(saida) {
  const passou = [];
  const falhou = [];
  for (const linha of saida.split(/\r?\n/)) {
    const m = /^\s*(PASSOU|FALHOU)\s+(.+?)\s*$/.exec(linha);
    if (m) (m[1] === "PASSOU" ? passou : falhou).push(m[2]);
  }
  return { passou, falhou };
}

function cauda(saida, n = 40) {
  return saida
    .split(/\r?\n/)
    .filter((l) => l.trim() !== "")
    .slice(-n);
}

/**
 * Roda a MESMA prova no estado de antes (controle) e no banco depois do pacote
 * e decide por diferença, não por valor absoluto:
 *   - passa depois                       -> OK;
 *   - falha depois e passava antes       -> FALHA (regressão do pacote);
 *   - falha igual nos dois (mesmas provas) -> INFO (já falhava no estado de
 *     produção reproduzido; não é culpa do pacote);
 *   - controle "antes" nem chegou a rodar -> FALHA (sem controle não há prova);
 *   - `rodar` devolveu `migracaoFalhou: true` (uma migration que a prova exige
 *     nem aplicou) em QUALQUER dos dois estados -> FALHA, mesmo se falhar igual
 *     nos dois: sem a migration não há prova, e isso não é "pré-existente".
 * `rodar(banco)` (pode ser async) devolve { status, saida }.
 */
async function compararAntesDepois(relator, grupo, caso, rodar, bancoDepois) {
  const antes = await rodar(BANCO_ANTES);
  const depois = await rodar(bancoDepois);
  const migracoes = [
    ["antes", antes],
    ["depois", depois],
  ].filter(([, r]) => r.migracaoFalhou);
  if (migracoes.length) {
    relator.falha(grupo, caso, {
      code: "MIGRACAO_NAO_APLICOU",
      message: `uma migration que a prova exige NÃO aplicou (estado: ${migracoes.map(([n]) => n).join(" e ")})`,
      detalhe: migracoes.flatMap(([n, r]) => [`[${n}]`, ...cauda(r.saida, 8)]),
    });
    return;
  }
  const pa = lerPassouFalhou(antes.saida);
  const pd = lerPassouFalhou(depois.saida);
  const sumiram = pa.passou.filter((nome) => !pd.passou.includes(nome));
  const resumo = `antes: exit ${antes.status}, ${pa.passou.length} PASSOU/${pa.falhou.length} FALHOU · depois: exit ${depois.status}, ${pd.passou.length} PASSOU/${pd.falhou.length} FALHOU`;

  if (antes.status !== 0 && pa.passou.length + pa.falhou.length === 0) {
    relator.falha(grupo, caso, {
      code: "SEM_CONTROLE",
      message: `a prova nem rodou no estado de antes (${resumo})`,
      detalhe: cauda(antes.saida, 25),
    });
    return;
  }
  if (depois.status === 0 && sumiram.length === 0) {
    relator.ok(grupo, caso, resumo);
    return;
  }
  if (antes.status !== 0 && depois.status !== 0 && sumiram.length === 0) {
    relator.info(
      grupo,
      caso,
      `falha PRÉ-EXISTENTE (igual no estado de antes, não é do pacote) — ${resumo}`,
      cauda(depois.saida, 12),
    );
    return;
  }
  relator.falha(grupo, caso, {
    code: "REGRESSAO",
    message: `o pacote quebrou a prova (${resumo})`,
    detalhe: [
      ...sumiram.map((n) => `passava antes e deixou de passar depois: ${n}`),
      ...cauda(depois.saida, 25),
    ],
  });
}

module.exports = {
  BANCO_ANTES,
  BANCO_PIX,
  BANCO_ROLLBACK,
  DIR_FIXTURES,
  DIR_SAIDA,
  DUAS_FECHADAS,
  Falha,
  PACOTES,
  PROACL_ABERTA,
  PROACL_FECHADA,
  PUBLICAS_EXPLICITAS,
  SEIS,
  SETE_PRIVILEGIOS,
  aplicarSql,
  anonExecuta,
  ausenciasDoServidor,
  clonarBanco,
  comAdmin,
  compararAntesDepois,
  conectar,
  criarRelator,
  diferencas,
  executarSql,
  exigirAusenciasIguais,
  exigirBeginCommit,
  exigirIgual,
  falhar,
  fotografar,
  gravarFotografia,
  imprimirAusencias,
  imprimirLista,
  lerFixture,
  lerFotografia,
  lerPassouFalhou,
  lerPrincipalAcl,
  lerSavyAcl,
  lerSavyTabPriv,
  medirFuncoes,
  medirRelacoes,
  mudancasAlemDasFechadas,
  mudancasForaDeAnonEAuth,
  nomeDoBancoBase,
  pacoteDoJob,
  resumir,
  rodarNode,
  soltarBanco,
  urlDoBanco,
};
