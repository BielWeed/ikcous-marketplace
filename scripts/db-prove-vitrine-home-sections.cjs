#!/usr/bin/env node
/**
 * Prova a migration que fecha o "sucesso mentiroso" de Vitrines & Carrosséis
 * sem gravar nada no banco.
 *
 *   supabase/migrations/20260940000000_home_sections_em_store_config.sql
 *
 * O BURACO
 *   O lojista reorganiza as vitrines da home e clica salvar. A tela mostra
 *   "Vitrines salvas com sucesso!" porque `public.upsert_store_config`
 *   devolve sucesso de verdade — só que a coluna `home_sections` não existe
 *   em `store_config`, a função tem uma lista FIXA de 23 colunas que não
 *   inclui `home_sections` (ela é ignorada em silêncio, só `updated_at`
 *   muda), e `public.v_store_config` (a view que o COMPRADOR lê, quando
 *   `isAdmin` é falso) também não expõe a coluna.
 *
 * TUDO DENTRO DE UMA TRANSAÇÃO QUE TERMINA EM ROLLBACK
 *   A migration foi conferida: não tem BEGIN/COMMIT próprio (o script se
 *   recusa a rodar se tiver — senão o COMMIT dela fecharia esta transação e
 *   o ROLLBACK final viraria no-op).
 *
 * POR QUE SAVEPOINT em volta de cada tentativa que TEM de falhar
 *   Uma query que falha deixa a transação "abortada" até um ROLLBACK (ou
 *   ROLLBACK TO SAVEPOINT). Como o roteiro PRECISA que a leitura de
 *   `home_sections` falhe antes da migration (42703, coluna inexistente),
 *   cada tentativa roda isolada num savepoint.
 *
 * POR QUE RESET ROLE antes/depois de cada SET LOCAL ROLE
 *   `upsert_store_config` exige `is_admin() = true`. A conexão direta usada
 *   aqui não tem esse claim de graça, então cada chamada assume
 *   `authenticated` + `request.jwt.claims` com `app_metadata.role = admin`
 *   (mesmo padrão de scripts/db-prove-estoque-efetivo-no-kpi.cjs) e devolve
 *   o papel ao normal logo em seguida — `SET LOCAL ROLE` é escopo de
 *   TRANSAÇÃO, não desaparece sozinho até o fim dela.
 *
 * O ROTEIRO
 *   1. RESET ALL; BEGIN READ WRITE (a migration e a RPC escrevem; o
 *      ROLLBACK final é que garante que nada fica).
 *   2. ANTES da migration (controle negativo — TEM de falhar/ignorar):
 *      a. SELECT home_sections FROM store_config → TEM de dar erro 42703.
 *         Se funcionar, o defeito não existe como descrito: para e reporta.
 *      b. upsert_store_config com home_sections, como admin → TEM de
 *         devolver SUCESSO (o "sucesso mentiroso") e o jsonb devolvido NÃO
 *         pode ter a chave home_sections.
 *      c. SELECT home_sections FROM v_store_config → TEM de dar erro 42703.
 *   3. Migration aplicada (lendo o arquivo do disco, dentro da transação).
 *      Confere que a função e a view aplicadas já mencionam home_sections;
 *      que upsert_store_config continua com exatamente 1 sobrecarga,
 *      SECURITY DEFINER e SET search_path TO 'public' (CREATE OR REPLACE é
 *      substituição — o que a migration não repetir por extenso some em
 *      silêncio); e que v_store_config continua com
 *      WITH (security_invoker = on) em pg_class.reloptions (mesmo motivo,
 *      aplicado à view que o comprador lê).
 *   4. DEPOIS (controle positivo — TEM de funcionar):
 *      Grava, pela RPC, home_sections (valor reconhecível e improvável) e
 *      share_text (para provar que colunas explicitamente enviadas mudam e
 *      as demais não), e confere: o retorno da própria RPC, a releitura da
 *      TABELA, a releitura da VIEW (prova de que o comprador passa a ver),
 *      que as outras colunas continuam com o valor de antes, que
 *      updated_at mudou, e que uma segunda chamada SEM a chave
 *      home_sections preserva o valor gravado (ramo ELSE).
 *   5. ROLLBACK. Fora da transação, confere que home_sections voltou a não
 *      existir — senão a prova pode ter gravado no banco sem avisar.
 *
 * USO:  node scripts/db-prove-vitrine-home-sections.cjs [caminho-alternativo-da-migration]
 * Sai com código 0 só se todas as 17 asserções passarem.
 *
 * O argumento opcional existe só para a prova de mutação da própria guarda
 * (nunca para uso normal): aponta o script para uma CÓPIA mutilada da
 * migration, num scratchpad, sem tocar no arquivo real em
 * supabase/migrations/.
 */
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { Client } = require("pg");

const PROJECT_ROOT = path.resolve(__dirname, "..");
const MIGRATION = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.join(
      PROJECT_ROOT,
      "supabase",
      "migrations",
      "20260940000000_home_sections_em_store_config.sql",
    );
const ESPERADAS = 17;

// Arranjo de vitrine com valor reconhecível e improvável — não colide com
// nenhum padrão real, e tem exatamente o formato de src/types/index.ts
// (StoreConfig.homeSections).
const VALOR_PROVA = [
  {
    id: "prova-20260940",
    title: "PROVA-20260940-nao-commitar",
    active: true,
    type: "custom",
    maxItems: 11,
    productIds: [],
    isCustom: true,
  },
];
const SHARE_TEXT_PROVA = "PROVA-20260940-share-text-nao-commitar";

const CAMPOS_OUTROS = [
  "free_shipping_min",
  "shipping_fee",
  "whatsapp_number",
  "share_text",
  "business_hours",
  "enable_reviews",
  "enable_coupons",
  "primary_color",
  "theme_mode",
  "logo_url",
  "real_time_sales_alerts",
  "push_marketing_enabled",
  "min_app_version",
  "origin_cep",
  "shipping_provider",
  "enabled_shipping_methods",
  "shipping_coverage",
  "local_delivery_fee",
  "local_cep_range",
  "store_name",
  "store_city",
  "store_state",
];

function lerDatabaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  for (const arquivo of [".env.local", ".env"]) {
    const caminho = path.join(PROJECT_ROOT, arquivo);
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    if (!fs.existsSync(caminho)) continue;
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    const conteudo = fs.readFileSync(caminho, "utf8");
    const linha = conteudo
      .split(/\r?\n/)
      .find((l) => l.startsWith("DATABASE_URL="));
    if (linha) return linha.slice("DATABASE_URL=".length).replace(/^"|"$/g, "");
  }
  throw new Error("DATABASE_URL não encontrada.");
}

/** Apaga (com espaços, preservando as quebras de linha) o conteúdo de todo
 * bloco delimitado por `$tag$...$tag$` (dollar-quoting do plpgsql). Existe
 * porque o corpo de `upsert_store_config` tem um `BEGIN` legítimo e
 * obrigatório na coluna 0 — sem isto, a guarda abaixo reprovaria a própria
 * migration correta. */
function mascararCorpoDolarQuotado(sql) {
  return sql.replace(/\$([A-Za-z_]*)\$[\s\S]*?\$\1\$/g, (bloco) =>
    bloco.replace(/[^\n]/g, " "),
  );
}

// Alternation de frases LITERAIS, sem nenhum quantificador aninhado dentro
// de outro (o que o security/detect-unsafe-regex acusa como ambíguo/ReDoS,
// mesmo sem repetição de fato perigosa aqui). O espaço interno da linha é
// normalizado para um único " " em contemComandoDeTransacao ANTES de testar
// — assim a regex nunca precisa de \s+/\s* para casar "BEGIN  TRANSACTION"
// com espaçamento irregular.
const RE_COMANDO_TRANSACAO =
  /^(BEGIN|BEGIN TRANSACTION|BEGIN WORK|START TRANSACTION|COMMIT|COMMIT TRANSACTION|COMMIT WORK);?$/i;

/** Verdadeiro se alguma linha do SQL já mascarado (sem o corpo
 * $tag$...$tag$) for, sozinha, um comando de transação. */
function contemComandoDeTransacao(sqlMascarado) {
  return sqlMascarado
    .split("\n")
    .some((linha) =>
      RE_COMANDO_TRANSACAO.test(linha.trim().replace(/\s+/g, " ")),
    );
}

function lerMigration() {
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  if (!fs.existsSync(MIGRATION))
    throw new Error(`Migration não encontrada: ${MIGRATION}`);
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  const sql = fs.readFileSync(MIGRATION, "utf8");
  const semCorpoDolarQuotado = mascararCorpoDolarQuotado(sql);
  if (contemComandoDeTransacao(semCorpoDolarQuotado)) {
    throw new Error(
      "A migration tem um comando de transação (BEGIN/START TRANSACTION/COMMIT) fora de bloco $tag$...$tag$: o ROLLBACK desta prova viraria no-op.",
    );
  }
  return sql;
}

let passou = 0;
let falhou = 0;

/** Cada asserção imprime o que era esperado e o que foi obtido, sempre —
 * inclusive quando passa. condicao indefinida/indeterminável conta como
 * falha (fail closed), nunca como sucesso. */
function conferir(nome, condicao, esperado, obtido) {
  const ok = condicao === true;
  if (ok) passou++;
  else falhou++;
  console.log(
    `  ${ok ? "ok   " : "FALHA"} ${nome} — esperado: ${esperado} · obtido: ${obtido}`,
  );
}

/** Normaliza para comparar jsonb ida-e-volta sem depender de ordem de
 * chaves (o round-trip pelo banco pode reordenar objeto, nunca array). */
function normalizar(v) {
  if (Array.isArray(v)) return v.map(normalizar);
  if (v && typeof v === "object") {
    // Object.entries + Object.fromEntries em vez de Object.keys + colchete:
    // nenhuma leitura nem escrita indexada por variável (obj[k]).
    return Object.fromEntries(
      Object.entries(v)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([k, valor]) => [k, normalizar(valor)]),
    );
  }
  return v;
}
function jsonIgual(a, b) {
  return JSON.stringify(normalizar(a)) === JSON.stringify(normalizar(b));
}

let contadorSavepoint = 0;
/** Roda `fn(client)` isolada num SAVEPOINT: se `fn` lançar, o savepoint é
 * desfeito e o resto da transação continua utilizável. */
async function comSavepoint(client, fn) {
  const sp = `sp_home_sections_${++contadorSavepoint}`;
  await client.query(`SAVEPOINT ${sp}`);
  try {
    const valor = await fn();
    await client.query(`RELEASE SAVEPOINT ${sp}`);
    return { ok: true, valor };
  } catch (erro) {
    await client.query(`ROLLBACK TO SAVEPOINT ${sp}`);
    return { ok: false, erro };
  }
}

async function trocarPara(client, papel) {
  await client.query("RESET ROLE");
  if (papel) await client.query(`SET LOCAL ROLE ${papel}`);
}

/** Chama upsert_store_config como admin (authenticated + claim de admin) e
 * devolve o papel ao normal logo em seguida. */
async function chamarUpsertComoAdmin(client, payload) {
  return comSavepoint(client, async () => {
    await trocarPara(client, "authenticated");
    await client.query("SELECT set_config('request.jwt.claims', $1, true)", [
      JSON.stringify({
        sub: "00000000-0000-0000-0000-000000000000",
        role: "authenticated",
        app_metadata: { role: "admin" },
      }),
    ]);
    const { rows } = await client.query(
      "SELECT public.upsert_store_config($1::jsonb) AS j",
      [JSON.stringify(payload)],
    );
    await trocarPara(client, null);
    return rows[0].j;
  });
}

async function selecionarHomeSections(client, tabelaOuView) {
  return comSavepoint(client, async () => {
    const { rows } = await client.query(
      `SELECT home_sections FROM public.${tabelaOuView} WHERE id = 1`,
    );
    return rows[0] ? rows[0].home_sections : undefined;
  });
}

/** Mesma checagem, mas SEM savepoint — usada fora de qualquer transação
 * aberta (depois do ROLLBACK final), onde SAVEPOINT lançaria "SAVEPOINT
 * can only be used in transaction blocks" em vez do erro que queremos
 * medir. Em modo autocommit, uma query que falha não contamina a próxima. */
async function selecionarHomeSectionsSemTransacao(client, tabelaOuView) {
  try {
    const { rows } = await client.query(
      `SELECT home_sections FROM public.${tabelaOuView} WHERE id = 1`,
    );
    return { ok: true, valor: rows[0] ? rows[0].home_sections : undefined };
  } catch (erro) {
    return { ok: false, erro };
  }
}

async function snapshotLinha(client) {
  const { rows } = await client.query(
    "SELECT to_jsonb(sc.*) AS j FROM public.store_config sc WHERE id = 1",
  );
  if (!rows[0]) throw new Error("store_config id=1 não encontrado.");
  return rows[0].j;
}

function is42703(resultadoFalho) {
  return Boolean(
    resultadoFalho &&
      !resultadoFalho.ok &&
      resultadoFalho.erro &&
      resultadoFalho.erro.code === "42703",
  );
}

/** Devolve o CONJUNTO de assinaturas (lista de tipos de argumento) de
 * `public.upsert_store_config`, ordenado. Mede o DELTA que a migration causa
 * — imune a schema alheio (filtra por pronamespace) e a sobrecarga legítima
 * preexistente (compara o conjunto inteiro, não uma contagem). */
async function assinaturasUpsert(client) {
  const { rows } = await client.query(
    `SELECT pg_get_function_identity_arguments(oid) AS args
       FROM pg_proc
      WHERE proname = 'upsert_store_config'
        AND pronamespace = 'public'::regnamespace
      ORDER BY 1`,
  );
  return rows.map((linha) => linha.args);
}

async function main() {
  const migrationSql = lerMigration();
  // Carimbo de identidade: qualquer saída colada num relatório precisa
  // dizer O QUE foi provado. Sem isto, "17/17" de uma cópia sabotada no
  // scratchpad (process.argv[2]) é indistinguível da migration real.
  const migrationSha256 = crypto
    .createHash("sha256")
    .update(migrationSql, "utf8")
    .digest("hex");
  console.log(`MIGRATION: ${MIGRATION}`);
  console.log(`sha256: ${migrationSha256}`);

  const client = new Client({
    connectionString: lerDatabaseUrl(),
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  console.log(`Conectado em ${new URL(lerDatabaseUrl()).hostname}`);
  console.log(
    "Nada será comitado: tudo roda numa transação que termina em ROLLBACK.\n",
  );

  await client.query("RESET ALL");
  // BEGIN READ WRITE (não só BEGIN): a conexão pode abrir em modo somente
  // leitura, e este roteiro precisa escrever via RPC dentro da transação —
  // o ROLLBACK no fim é que garante que nada fica.
  await client.query("BEGIN READ WRITE");

  try {
    console.log("=== 1. ANTES da migration: o defeito reproduz? ===");

    const selectTabelaAntes = await selecionarHomeSections(
      client,
      "store_config",
    );
    conferir(
      "ANTES: SELECT home_sections na tabela dá erro 42703 (coluna não existe)",
      is42703(selectTabelaAntes),
      "erro 42703 (undefined_column)",
      selectTabelaAntes.ok
        ? `sucesso, devolveu ${JSON.stringify(selectTabelaAntes.valor)}`
        : `${selectTabelaAntes.erro.code}: ${selectTabelaAntes.erro.message}`,
    );
    if (!is42703(selectTabelaAntes)) {
      throw new Error(
        "O defeito NÃO reproduziu antes da migration (a coluna já existe, ou o erro não é 42703). Pare e investigue: ou o defeito não existe como descrito, ou este script está medindo a coisa errada.",
      );
    }

    const rpcAntes = await chamarUpsertComoAdmin(client, {
      home_sections: VALOR_PROVA,
    });
    conferir(
      "ANTES: upsert_store_config com home_sections devolve SUCESSO (o sucesso mentiroso)",
      rpcAntes.ok,
      "sucesso (sem lançar erro)",
      rpcAntes.ok ? "sucesso" : `erro: ${rpcAntes.erro.message}`,
    );
    conferir(
      "ANTES: o jsonb devolvido pela RPC NÃO tem a chave home_sections (foi ignorada em silêncio)",
      rpcAntes.ok && !Object.prototype.hasOwnProperty.call(
        rpcAntes.valor || {},
        "home_sections",
      ),
      "chave home_sections ausente do retorno",
      rpcAntes.ok
        ? `chaves do retorno: ${Object.keys(rpcAntes.valor).join(", ")}`
        : "RPC não retornou (falhou antes)",
    );

    const selectViewAntes = await selecionarHomeSections(
      client,
      "v_store_config",
    );
    conferir(
      "ANTES: SELECT home_sections na view dá erro 42703 (o comprador também não tem a coluna)",
      is42703(selectViewAntes),
      "erro 42703 (undefined_column)",
      selectViewAntes.ok
        ? `sucesso, devolveu ${JSON.stringify(selectViewAntes.valor)}`
        : `${selectViewAntes.erro.code}: ${selectViewAntes.erro.message}`,
    );

    // Assinaturas ANTES da migration — âncora do delta medido depois (ver
    // "upsert_store_config continua com o mesmo conjunto de assinaturas",
    // abaixo). Só leitura, não é asserção: não altera ESPERADAS.
    const assinaturasAntesMigration = await assinaturasUpsert(client);

    console.log("\n=== 2. Migration aplicada (dentro da transação) ===");
    await trocarPara(client, null);
    await client.query(migrationSql);

    const defFuncao = await client.query(
      "SELECT pg_get_functiondef(oid) AS def FROM pg_proc WHERE proname = 'upsert_store_config'",
    );
    conferir(
      "a função aplicada na transação menciona home_sections",
      defFuncao.rows[0].def.includes("home_sections"),
      "definição contém 'home_sections'",
      defFuncao.rows[0].def.includes("home_sections")
        ? "contém"
        : "NÃO contém",
    );

    // CREATE OR REPLACE é SUBSTITUIÇÃO: tudo que a migration não repetir por
    // extenso some em silêncio. Para a função, isso vale para SECURITY
    // DEFINER, SET search_path e para o próprio CONJUNTO de assinaturas —
    // uma reescrita com assinatura diferente criaria uma SEGUNDA função em
    // vez de substituir a existente, e o app continuaria chamando a antiga.
    //
    // Compara o CONJUNTO (não a contagem): `WHERE proname = '…'` sozinho
    // varreria `pg_proc` inteiro sem filtrar schema, e uma contagem
    // "inalterada" sozinha não pegaria uma sobrecarga NOVA que substituísse
    // uma preexistente sem mudar o total. Comparar as assinaturas antes ×
    // depois mede o delta real que a migration introduziu.
    const assinaturasDepoisMigration = await assinaturasUpsert(client);
    conferir(
      "upsert_store_config continua com o mesmo conjunto de assinaturas de antes da migration (uma sobrecarga nova criaria uma SEGUNDA função em vez de substituir)",
      JSON.stringify(assinaturasAntesMigration) ===
        JSON.stringify(assinaturasDepoisMigration),
      JSON.stringify(assinaturasAntesMigration),
      JSON.stringify(assinaturasDepoisMigration),
    );

    // Presa à assinatura EXATA via to_regprocedure (não `::regprocedure`,
    // que lança exceção em vez de devolver NULL quando não resolve — e
    // escaparia do contador de asserções). oid = NULL faz o WHERE devolver
    // 0 linhas, e o `conferir` abaixo já trata isso como falha (fail
    // closed), não como sucesso.
    const funcaoUpsertRows = await client.query(
      "SELECT prosecdef, proconfig FROM pg_proc WHERE oid = to_regprocedure('public.upsert_store_config(jsonb)')",
    );
    const [funcaoUpsert] = funcaoUpsertRows.rows;
    conferir(
      "upsert_store_config continua SECURITY DEFINER (prosecdef = true) — sem isso a gravação de configuração quebra para o lojista",
      Boolean(funcaoUpsert && funcaoUpsert.prosecdef === true),
      "prosecdef = true",
      funcaoUpsert
        ? `prosecdef = ${funcaoUpsert.prosecdef}`
        : "função não encontrada (to_regprocedure não resolveu 'public.upsert_store_config(jsonb)')",
    );
    const proconfigUpsert = funcaoUpsert ? funcaoUpsert.proconfig : null;
    conferir(
      "upsert_store_config continua com SET search_path TO 'public' (proconfig contém search_path=public) — sem isso uma SECURITY DEFINER fica exposta a sequestro de search_path",
      Array.isArray(proconfigUpsert) &&
        proconfigUpsert.includes("search_path=public"),
      'proconfig contém "search_path=public"',
      JSON.stringify(proconfigUpsert),
    );

    const defView = await client.query(
      "SELECT pg_get_viewdef('public.v_store_config'::regclass, true) AS def",
    );
    conferir(
      "a view aplicada na transação menciona home_sections",
      defView.rows[0].def.includes("home_sections"),
      "definição contém 'home_sections'",
      defView.rows[0].def.includes("home_sections") ? "contém" : "NÃO contém",
    );

    // v_store_config é a view que o COMPRADOR lê (isAdmin=false). Ela só
    // existe com WITH (security_invoker=on) para o RLS de store_config
    // valer para quem consulta por ela. Um CREATE OR REPLACE VIEW sem o
    // WITH derruba essa reloption em silêncio — checagem só de coluna
    // (acima) não detecta isso.
    const reloptionsView = await client.query(
      "SELECT reloptions FROM pg_class WHERE oid = 'public.v_store_config'::regclass",
    );
    const opcoesView = reloptionsView.rows[0]
      ? reloptionsView.rows[0].reloptions
      : null;
    conferir(
      "a view aplicada mantém WITH (security_invoker = on) — sem isso o RLS da tabela deixa de valer para quem lê pela view",
      Array.isArray(opcoesView) && opcoesView.includes("security_invoker=on"),
      'reloptions contém "security_invoker=on"',
      JSON.stringify(opcoesView),
    );

    console.log(
      "\n=== 3. DEPOIS: grava pela RPC e confere tabela, view e as outras colunas ===",
    );
    const snapshotAntes = await snapshotLinha(client);

    const resultadoRpc = await chamarUpsertComoAdmin(client, {
      home_sections: VALOR_PROVA,
      share_text: SHARE_TEXT_PROVA,
    });
    if (!resultadoRpc.ok) {
      throw new Error(
        `A RPC falhou DEPOIS da migration (deveria funcionar): ${resultadoRpc.erro.message}`,
      );
    }

    conferir(
      "DEPOIS: o jsonb devolvido pela RPC já traz home_sections com o valor certo",
      jsonIgual(resultadoRpc.valor.home_sections, VALOR_PROVA),
      JSON.stringify(VALOR_PROVA),
      JSON.stringify(resultadoRpc.valor.home_sections),
    );
    conferir(
      "DEPOIS: o jsonb devolvido pela RPC traz share_text atualizado (prova de que a chamada realmente processou o payload)",
      resultadoRpc.valor.share_text === SHARE_TEXT_PROVA,
      SHARE_TEXT_PROVA,
      resultadoRpc.valor.share_text,
    );

    const snapshotDepois = await snapshotLinha(client);

    conferir(
      "DEPOIS: releitura da TABELA — home_sections igual ao que foi enviado",
      jsonIgual(snapshotDepois.home_sections, VALOR_PROVA),
      JSON.stringify(VALOR_PROVA),
      JSON.stringify(snapshotDepois.home_sections),
    );

    const selectViewDepois = await selecionarHomeSections(
      client,
      "v_store_config",
    );
    conferir(
      "DEPOIS: releitura da VIEW — home_sections igual ao que foi enviado (é isto que o comprador passa a ver)",
      selectViewDepois.ok && jsonIgual(selectViewDepois.valor, VALOR_PROVA),
      JSON.stringify(VALOR_PROVA),
      selectViewDepois.ok
        ? JSON.stringify(selectViewDepois.valor)
        : `erro: ${selectViewDepois.erro.message}`,
    );

    // Map + .get() em vez de snapshotAntes[campo]/snapshotDepois[campo]:
    // nenhuma leitura indexada por variável.
    const mapaAntes = new Map(Object.entries(snapshotAntes));
    const mapaDepois = new Map(Object.entries(snapshotDepois));
    const divergencias = [];
    for (const campo of CAMPOS_OUTROS) {
      const esperadoCampo =
        campo === "share_text" ? SHARE_TEXT_PROVA : mapaAntes.get(campo);
      const obtidoCampo = mapaDepois.get(campo);
      if (!jsonIgual(obtidoCampo, esperadoCampo)) {
        divergencias.push(
          `${campo}: esperado ${JSON.stringify(esperadoCampo)}, obtido ${JSON.stringify(obtidoCampo)}`,
        );
      }
    }
    conferir(
      "DEPOIS: as outras colunas continuam com o valor esperado (as 21 que não foram enviadas, iguais a antes; share_text, que foi enviada, igual ao que foi mandado)",
      divergencias.length === 0,
      "nenhuma divergência",
      divergencias.length === 0 ? "nenhuma divergência" : divergencias.join(" | "),
    );

    // Sem asserção de "updated_at mudou": now() é estável DENTRO da mesma
    // transação (equivale a transaction_timestamp()), e este roteiro já fez
    // uma escrita antes (o "sucesso mentiroso" da seção 1) -- comparar
    // updated_at contra o valor de ANTES desta chamada daria o MESMO
    // carimbo mesmo com a migration certa, e provaria só o funcionamento do
    // Postgres, não da correção. Os valores de home_sections/share_text
    // lidos de volta por SELECT novo já provam que a escrita aconteceu.

    console.log(
      "\n=== 4. Chamada seguinte SEM a chave home_sections preserva o valor (ramo ELSE) ===",
    );
    const rpcSemChave = await chamarUpsertComoAdmin(client, {
      business_hours: "PROVA-20260940-outro-horario",
    });
    if (!rpcSemChave.ok) {
      throw new Error(
        `A RPC (sem home_sections) falhou: ${rpcSemChave.erro.message}`,
      );
    }
    const selectDepoisDaSegunda = await snapshotLinha(client);
    conferir(
      "home_sections permanece igual ao valor gravado (a chamada seguinte não mandou a chave)",
      jsonIgual(selectDepoisDaSegunda.home_sections, VALOR_PROVA),
      JSON.stringify(VALOR_PROVA),
      JSON.stringify(selectDepoisDaSegunda.home_sections),
    );
  } finally {
    await trocarPara(client, null).catch(() => {});
    await client.query("ROLLBACK").catch(() => {});
  }

  console.log(
    "\n=== 5. Fora da transação: nada ficou gravado ===",
  );
  const selectForaDaTransacao = await selecionarHomeSectionsSemTransacao(
    client,
    "store_config",
  );
  conferir(
    "home_sections voltou a NÃO existir depois do ROLLBACK (a prova não gravou nada)",
    is42703(selectForaDaTransacao),
    "erro 42703 (undefined_column)",
    selectForaDaTransacao.ok
      ? `sucesso, devolveu ${JSON.stringify(selectForaDaTransacao.valor)}`
      : `${selectForaDaTransacao.erro.code}: ${selectForaDaTransacao.erro.message}`,
  );

  await client.end();

  console.log(`\n${passou} / ${ESPERADAS} asserções esperadas passaram, ${falhou} falharam.`);
  console.log(`MIGRATION: ${MIGRATION}`);
  console.log(`sha256: ${migrationSha256}`);
  process.exit(falhou > 0 || passou !== ESPERADAS ? 1 : 0);
}

main().catch((erro) => {
  console.error("Erro:", erro.message);
  process.exit(1);
});
