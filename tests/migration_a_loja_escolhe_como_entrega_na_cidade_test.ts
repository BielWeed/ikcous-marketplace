// @ts-nocheck
/* eslint-disable security/detect-object-injection, security/detect-non-literal-regexp --
 * As chaves de objeto vêm de listas fixas deste arquivo (os nomes das três funções) e os padrões de regexp são montados
 * só dessas constantes: nenhuma entrada de rede nem de terceiro. */
// A LOJA ESCOLHE COMO ENTREGA NA CIDADE E EM QUANTOS DIAS — prova offline do trio 20261244000000 + rollback comum +
// rollback destrutivo (dinheiro e dado de cliente; 15/10/2026). O COMPORTAMENTO (a matriz das duas portas de compra
// x convidado/logado x CEP local/fora x os três modos, a trigger, as duas chaves da upsert, o pré-voo que recusa sem
// escrever, os rollbacks nos dois degraus e os mutantes) é provado em tests/banco/a-loja-escolhe-como-entrega-viva.cjs;
// aqui fica o que se prova só lendo o texto, no `npm run test:unit`.
//
// Riscos amarrados: corpo de partida que não é o VIGENTE de cada função (apaga uma guarda em silêncio); mais mudança
// do que a declarada nos três corpos (uma regra de preço ou de cobertura que mudou de passagem); hash de preflight
// que não é o md5 real; rollback que não volta byte a byte; coluna/CHECK/trigger sem a guarda de idempotência;
// BEGIN/COMMIT de nível superior; GRANT/REVOKE/COMMENT escondido; a view com as colunas fora de ordem (o `CREATE OR
// REPLACE VIEW` só aceita coluna nova no FIM); as consultas e as provas que fixam os corpos antigos e precisam saber
// da sucessora; a entrada de `VERIFICACOES` do db-apply (sem ela o apply sai PULADA).
//
// Asserções por `node:assert/strict` (embutido no Deno): roda sem rede.
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  avaliarFase0,
  detectarTransacaoExplicita,
  removerRuido,
} = require("../scripts/db-prove-rollback.cjs");
const { createHash } = require("node:crypto");

const DIR = new URL("../", import.meta.url);
const NOME = "20261244000000_a_loja_escolhe_como_entrega_na_cidade.sql";
const NOME_RB = `rollback-manual-${NOME}`;
const NOME_RBD = `rollback-manual-destrutivo-${NOME}`;
const ANTECESSORAS = {
  create_marketplace_order_v23:
    "20261229000000_o_endereco_da_compra_fica_no_pedido.sql",
  create_marketplace_order_v24:
    "20261236000000_a_compra_que_da_zero_reais_nao_se_paga_pelo_app.sql",
  upsert_store_config:
    "20261239000000_a_loja_declara_quem_e_na_nota_e_como_falar_com_ela.sql",
};
const VIGENTE = {
  create_marketplace_order_v23: "6cb5a00cfa290f00dc9de053fee40759",
  create_marketplace_order_v24: "6002fc8db6c1d402bc704f018a0c2621",
  upsert_store_config: "b562669936df1cda31d4bdd4d075bff3",
};
const NOVO = {
  create_marketplace_order_v23: "79445d64a87843be2d42bf601c7090ec",
  create_marketplace_order_v24: "85c37af4baa2f5ce1375bdd9e943c746",
  upsert_store_config: "391e8e1064400df5aea579f3472b203c",
};
const HASH_TRIGGER = "979fe4cc3287c6ae254223bc1c28759e";
const ASSINATURAS = {
  create_marketplace_order_v23:
    "public.create_marketplace_order_v23(jsonb, numeric, numeric, text, uuid, text, text, text, text, jsonb, text, text, uuid)",
  create_marketplace_order_v24:
    "public.create_marketplace_order_v24(jsonb, numeric, numeric, text, uuid, text, text, text, text, jsonb, text, text, uuid)",
  upsert_store_config: "public.upsert_store_config(jsonb)",
};
const FUNCOES = Object.keys(VIGENTE);

const lerArquivo = (rel) =>
  Deno.readTextFileSync(new URL(rel, DIR)).replace(/\r\n/g, "\n");
const ler = (n) => lerArquivo(`supabase/migrations/${n}`);
const migration = ler(NOME);
const rollback = ler(NOME_RB);
const destrutivo = ler(NOME_RBD);

const md5 = (s) => createHash("md5").update(s).digest("hex");
const semComentarios = (s) =>
  s
    .split("\n")
    .map((l) => l.replace(/--.*$/, ""))
    .join("\n");

/** O corpo (o que o Postgres grava em prosrc) da ÚLTIMA definição de `fn` num texto, com a tag do dollar-quote. */
function corpoDa(texto, fn) {
  const re = new RegExp(
    `CREATE\\s+(?:OR\\s+REPLACE\\s+)?FUNCTION\\s+(?:"?public"?\\.)?"?${fn}"?\\s*\\(`,
    "gi",
  );
  let ultimo = null;
  let m;
  while ((m = re.exec(texto))) ultimo = m.index;
  assert.ok(ultimo !== null, `${fn} não encontrada`);
  const resto = texto.slice(ultimo);
  const abre = /\bAS\s+(\$[a-z_0-9]*\$)/i.exec(resto);
  assert.ok(abre, `${fn}: sem AS $tag$`);
  const tag = abre[1];
  const ini = abre.index + abre[0].length;
  const fim = resto.indexOf(tag, ini);
  assert.ok(fim > ini, `${fn}: dollar-quote não fecha`);
  return resto.slice(ini, fim);
}
/** O cabeçalho da última definição (do CREATE até o `AS $tag$`). */
function cabecalhoDa(texto, fn) {
  const re = new RegExp(
    `CREATE\\s+(?:OR\\s+REPLACE\\s+)?FUNCTION\\s+(?:"?public"?\\.)?"?${fn}"?\\s*\\(`,
    "gi",
  );
  let ultimo = null;
  let m;
  while ((m = re.exec(texto))) ultimo = m.index;
  const resto = texto.slice(ultimo);
  return resto.slice(0, /\bAS\s+\$[a-z_0-9]*\$/i.exec(resto).index);
}
const contar = (linhas) => {
  const m = new Map();
  for (const l of linhas) m.set(l, (m.get(l) ?? 0) + 1);
  return m;
};
/** Linhas que saíram e linhas que entraram (multiconjunto): a ordem de sempre fica provada pelo md5 do rollback. */
function diferencaDeLinhas(velho, novo) {
  const a = contar(velho.split("\n"));
  const b = contar(novo.split("\n"));
  const saiu = [];
  const entrou = [];
  for (const [l, n] of a)
    for (let i = 0; i < n - (b.get(l) ?? 0); i++) saiu.push(l);
  for (const [l, n] of b)
    for (let i = 0; i < n - (a.get(l) ?? 0); i++) entrou.push(l);
  return { saiu, entrou };
}
const codigo = (linhas) =>
  linhas.filter((l) => l.trim() !== "" && !l.trim().startsWith("--"));

// O corpo da ÚLTIMA definição anterior a esta migration, por função.
const ARQUIVOS_ANTERIORES = [
  ...Deno.readDirSync(new URL("supabase/migrations/", DIR)),
]
  .filter((e) => e.isFile && /^\d{14}_.*\.sql$/.test(e.name))
  .map((e) => e.name)
  .filter((n) => n < NOME)
  .sort();
function ultimaAnterior(fn) {
  const re = new RegExp(
    `CREATE\\s+(?:OR\\s+REPLACE\\s+)?FUNCTION\\s+(?:"?public"?\\.)?"?${fn}"?\\s*\\(`,
    "i",
  );
  const com = ARQUIVOS_ANTERIORES.filter((n) =>
    re.test(semComentarios(ler(n))),
  );
  assert.ok(com.length > 0, `${fn}: nenhuma definição anterior`);
  return com.at(-1);
}

Deno.test("avaliarFase0 não recusa o par migration+rollback e nenhum dos três arquivos abre ou fecha transação de nível superior", () => {
  const res = avaliarFase0({
    sqlMigration: migration,
    sqlRollback: rollback,
    temRollback: true,
  });
  assert.equal(
    res.recusado,
    false,
    `motivos: ${(res.motivos || []).join("; ")}`,
  );
  for (const sql of [migration, rollback, destrutivo])
    assert.deepEqual(detectarTransacaoExplicita(removerRuido(sql)).achados, []);
});

Deno.test("a migration redefine só as três funções de sempre mais a da trigger; o rollback só as três; o destrutivo nenhuma", () => {
  const nomesDe = (sql) =>
    [
      ...semComentarios(sql).matchAll(
        /^CREATE OR REPLACE FUNCTION public\.([a-z_0-9]+)\(/gm,
      ),
    ].map((m) => m[1]);
  assert.deepEqual(nomesDe(migration).sort(), [
    "create_marketplace_order_v23",
    "create_marketplace_order_v24",
    "store_config_so_retirada_exige_retirada",
    "upsert_store_config",
  ]);
  assert.deepEqual(nomesDe(rollback).sort(), [
    "create_marketplace_order_v23",
    "create_marketplace_order_v24",
    "upsert_store_config",
  ]);
  assert.deepEqual(nomesDe(destrutivo), []);
});

Deno.test("o ponto de partida de cada função é a ÚLTIMA definição antes desta migration, com o md5 citado no preflight", () => {
  for (const fn of FUNCOES) {
    const dona = ultimaAnterior(fn);
    assert.equal(
      dona,
      ANTECESSORAS[fn],
      `${fn}: a última definição anterior mudou`,
    );
    assert.equal(
      md5(corpoDa(ler(dona), fn)),
      VIGENTE[fn],
      `${fn}: md5 da vigente`,
    );
    assert.ok(
      migration.includes(
        `('${ASSINATURAS[fn]}', '${VIGENTE[fn]}', '${NOVO[fn]}')`,
      ),
      `${fn}: o preflight tem de citar ('assinatura', 'vigente', 'desta')`,
    );
  }
});

Deno.test("cada corpo novo é o vigente MAIS as edições declaradas: as linhas que saem e as que entram estão fixadas", () => {
  const SAI_PEDIDO = [
    "        IF NOT public.is_local_cep(v_store_config.origin_cep, v_cep_de_entrega, v_store_config.local_cep_range) THEN",
    "        IF NOT public.is_local_cep(v_store_config.origin_cep, v_cep_de_entrega, v_store_config.local_cep_range) THEN",
    "           OR COALESCE(public.is_local_cep(v_store_config.origin_cep, v_cep_de_entrega, v_store_config.local_cep_range), false) = false THEN",
  ];
  const ENTRA_PEDIDO = [
    "    v_so_retirada boolean := false;",
    "    v_retirada_livre boolean := false;",
    "        END IF;",
    "    v_so_retirada := (COALESCE(v_store_config.local_delivery_enabled, true) = false);",
    "    v_retirada_livre := (v_so_retirada AND p_shipping_option_id IS NOT DISTINCT FROM 'store-pickup');",
    "        IF NOT v_retirada_livre AND NOT public.is_local_cep(v_store_config.origin_cep, v_cep_de_entrega, v_store_config.local_cep_range) THEN",
    "        IF NOT v_retirada_livre AND NOT public.is_local_cep(v_store_config.origin_cep, v_cep_de_entrega, v_store_config.local_cep_range) THEN",
    "        IF v_so_retirada THEN",
    "            RAISE EXCEPTION 'Opção de entrega inválida. Volte ao carrinho e escolha uma entrega válida.'",
    "                USING DETAIL = 'entrega_propria_desligada';",
    "           OR (NOT v_retirada_livre AND COALESCE(public.is_local_cep(v_store_config.origin_cep, v_cep_de_entrega, v_store_config.local_cep_range), false) = false) THEN",
  ];
  const SAI_UPSERT = [
    "    store_legal_name, store_legal_document, store_support_email",
    "    config_json->>'store_support_email'",
  ];
  const ENTRA_UPSERT = [
    "    store_legal_name, store_legal_document, store_support_email,",
    "    local_delivery_enabled, local_delivery_days",
    "    config_json->>'store_support_email',",
    "    COALESCE((config_json->>'local_delivery_enabled')::boolean, true),",
    "    COALESCE((config_json->>'local_delivery_days')::integer, 1)",
    "    local_delivery_enabled = CASE WHEN config_json ? 'local_delivery_enabled'",
    "      THEN (config_json->>'local_delivery_enabled')::boolean",
    "      ELSE store_config.local_delivery_enabled END,",
    "    local_delivery_days = CASE WHEN config_json ? 'local_delivery_days'",
    "      THEN (config_json->>'local_delivery_days')::integer",
    "      ELSE store_config.local_delivery_days END,",
  ];
  for (const fn of FUNCOES) {
    const velho = corpoDa(ler(ANTECESSORAS[fn]), fn);
    const novo = corpoDa(migration, fn);
    assert.equal(md5(novo), NOVO[fn], `${fn}: md5 do corpo novo`);
    const { saiu, entrou } = diferencaDeLinhas(velho, novo);
    const pedido = fn !== "upsert_store_config";
    assert.deepEqual(
      saiu,
      pedido ? SAI_PEDIDO : SAI_UPSERT,
      `${fn}: linhas que saíram`,
    );
    assert.deepEqual(
      codigo(entrou),
      pedido ? ENTRA_PEDIDO : ENTRA_UPSERT,
      `${fn}: linhas de código que entraram`,
    );
    // o resto (comentários) é só comentário
    assert.ok(
      entrou.every(
        (l) =>
          l.trim() === "" ||
          l.trim().startsWith("--") ||
          codigo([l]).length === 1,
      ),
    );
  }
  // O 'local-delivery' em só retiro recusa ANTES de qualquer outra prova do ramo, com a frase de sempre do app.
  for (const fn of [
    "create_marketplace_order_v23",
    "create_marketplace_order_v24",
  ]) {
    const c = corpoDa(migration, fn);
    const ramo = c.indexOf("ELSIF v_opcao = 'local-delivery' THEN");
    const recusa = c.indexOf("IF v_so_retirada THEN", ramo);
    assert.ok(ramo > 0 && recusa > ramo);
    assert.equal(
      c.indexOf("Entrega local não disponível", ramo) > recusa,
      true,
    );
    // a retirada livre só vale com o id EXATO 'store-pickup'
    assert.equal(c.split("IS NOT DISTINCT FROM 'store-pickup'").length - 1, 1);
    // nenhuma recusa nova além da do 'local-delivery'
    assert.equal(
      c.split("RAISE EXCEPTION").length - 1,
      corpoDa(ler(ANTECESSORAS[fn]), fn).split("RAISE EXCEPTION").length -
        1 +
        1,
    );
  }
});

Deno.test("o rollback devolve os três corpos VIGENTES byte a byte (md5), com o mesmo cabeçalho; a migration não mexe em atributo, dono nem ACL das três", () => {
  for (const fn of FUNCOES) {
    const antes = corpoDa(ler(ANTECESSORAS[fn]), fn);
    assert.equal(
      corpoDa(rollback, fn),
      antes,
      `${fn}: o rollback não devolve o corpo anterior`,
    );
    assert.equal(md5(corpoDa(rollback, fn)), VIGENTE[fn]);
    const cab = cabecalhoDa(ler(ANTECESSORAS[fn]), fn).replace(/\s+/g, " ");
    assert.equal(
      cabecalhoDa(migration, fn).replace(/\s+/g, " "),
      cab,
      `${fn}: cabeçalho da migration`,
    );
    assert.equal(
      cabecalhoDa(rollback, fn).replace(/\s+/g, " "),
      cab,
      `${fn}: cabeçalho do rollback`,
    );
    assert.ok(
      cab.includes("SECURITY DEFINER") && cab.includes("SET search_path"),
    );
  }
  // as outras versões em disco (rollbacks de sempre) não são tocadas: nenhum arquivo anterior cita o hash novo
  for (const fn of FUNCOES)
    for (const n of ARQUIVOS_ANTERIORES)
      assert.ok(!ler(n).includes(NOVO[fn]), `${n} cita o hash novo de ${fn}`);
});

Deno.test("todo hash de 32 hex dos arquivos é um dos conhecidos (vigentes, novos, o da função da trigger)", () => {
  const conhecidos = new Set([
    ...Object.values(VIGENTE),
    ...Object.values(NOVO),
    HASH_TRIGGER,
  ]);
  for (const [nome, sql] of [
    [NOME, migration],
    [NOME_RB, rollback],
    [NOME_RBD, destrutivo],
  ]) {
    for (const m of sql.matchAll(/'([0-9a-f]{32})'/g))
      assert.ok(conhecidos.has(m[1]), `${nome}: hash estranho ${m[1]}`);
  }
  // o rollback exige "o desta migration OU o anterior" antes de reescrever e o anterior depois
  for (const fn of FUNCOES)
    assert.ok(
      rollback.includes(
        `('${ASSINATURAS[fn]}', '${VIGENTE[fn]}', '${NOVO[fn]}')`,
      ),
      `${fn}: preflight do rollback`,
    );
  for (const fn of FUNCOES)
    assert.ok(
      rollback.includes(`('${ASSINATURAS[fn]}', '${VIGENTE[fn]}')`),
      `${fn}: pós-voo do rollback`,
    );
  assert.ok(migration.includes("RAISE EXCEPTION 'B1_BASELINE_DIVERGENT:"));
  assert.ok(rollback.includes("RAISE EXCEPTION 'B1_BASELINE_DIVERGENT:"));
  // o pré-voo e o pós-voo olham atributos, ACL e sobrecarga
  for (const trecho of [
    "tem sobrecarga em public",
    "p.proconfig = ARRAY['search_path=public']::text[]",
    "has_function_privilege('authenticated', v_oid, 'EXECUTE')",
    "has_function_privilege('service_role', v_oid, 'EXECUTE')",
    "has_function_privilege('anon', v_oid, 'EXECUTE') IS DISTINCT FROM r.anon_executa",
  ])
    assert.ok(migration.includes(trecho), `a migration não confere: ${trecho}`);
});

Deno.test("a função da trigger tem o md5 do preflight, ignora o INSERT fantasma do ON CONFLICT e tem uma mensagem só, com dois DETAIL", () => {
  const c = corpoDa(migration, "store_config_so_retirada_exige_retirada");
  assert.equal(md5(c), HASH_TRIGGER);
  assert.ok(
    migration.split(HASH_TRIGGER).length - 1 >= 2,
    "o hash da trigger aparece no preflight e no pós-voo",
  );
  const limpo = semComentarios(c);
  assert.ok(limpo.includes("TG_OP = 'INSERT' AND EXISTS"));
  assert.ok(
    limpo.includes("COALESCE(NEW.local_delivery_enabled, true) = false"),
  );
  assert.ok(
    limpo.includes(
      "'store-pickup' = ANY(COALESCE(NEW.enabled_shipping_methods",
    ),
  );
  assert.ok(
    limpo.includes(
      "NULLIF(btrim(COALESCE(NEW.store_address, '')), '') IS NULL",
    ),
  );
  assert.equal(
    limpo.split("RAISE EXCEPTION 'LOJA_SO_RETIRADA_SEM_RETIRADA'").length - 1,
    2,
  );
  assert.ok(
    c.includes("DETAIL = 'sem_retirada:") &&
      c.includes("DETAIL = 'sem_endereco:"),
  );
  const cab = cabecalhoDa(migration, "store_config_so_retirada_exige_retirada");
  assert.ok(
    cab.includes("SECURITY DEFINER") &&
      cab.includes("SET search_path = public, pg_temp"),
  );
  // BEFORE INSERT OR UPDATE por linha, e ninguém executa a função à mão
  const sql = semComentarios(migration);
  assert.ok(
    /CREATE TRIGGER store_config_so_retirada_exige_retirada\s+BEFORE INSERT OR UPDATE ON public\.store_config\s+FOR EACH ROW\s+EXECUTE FUNCTION public\.store_config_so_retirada_exige_retirada\(\);/.test(
      sql,
    ),
  );
  assert.ok(
    sql.includes(
      "REVOKE ALL ON FUNCTION public.store_config_so_retirada_exige_retirada() FROM PUBLIC, anon, authenticated, service_role;",
    ),
  );
  assert.ok(
    sql.includes(
      "DROP TRIGGER IF EXISTS store_config_so_retirada_exige_retirada ON public.store_config;",
    ),
  );
});

Deno.test("as duas colunas são ADITIVAS e idempotentes (NOT NULL com DEFAULT constante, IF NOT EXISTS) e a CHECK do prazo só entra uma vez", () => {
  const sql = semComentarios(migration);
  assert.ok(
    sql.includes(
      "ALTER TABLE public.store_config ADD COLUMN IF NOT EXISTS local_delivery_enabled boolean NOT NULL DEFAULT true;",
    ),
  );
  assert.ok(
    sql.includes(
      "ALTER TABLE public.store_config ADD COLUMN IF NOT EXISTS local_delivery_days integer NOT NULL DEFAULT 1;",
    ),
  );
  assert.ok(sql.includes("store_config_local_delivery_days_check"));
  assert.ok(sql.includes("CHECK (local_delivery_days BETWEEN 0 AND 30)"));
  assert.ok(
    sql.includes("IF NOT EXISTS ("),
    "a CHECK é criada só se ainda não existe",
  );
  // nada que apague ou reescreva dado existente
  for (const proibido of [
    /\bDROP\s+(TABLE|COLUMN)\b/i,
    /^\s*(INSERT|UPDATE|DELETE|TRUNCATE)\b/im,
    /^\s*COMMENT\s+ON\b/im,
    /^\s*(GRANT)\b/im,
  ])
    assert.ok(
      !proibido.test(
        sql
          .replace(/\$function\$[\s\S]*?\$function\$/g, "")
          .replace(/\$\$[\s\S]*?\$\$/g, ""),
      ),
      `${proibido} na migration`,
    );
  // lock_timeout antes do ALTER
  assert.ok(sql.indexOf("SET LOCAL lock_timeout = '5s';") > 0);
  assert.ok(
    sql.indexOf("SET LOCAL lock_timeout = '5s';") <
      sql.indexOf("ALTER TABLE public.store_config ADD COLUMN"),
  );
  // o pré-voo vem ANTES de qualquer escrita
  const i = migration.indexOf("DO $preflight_20261244$");
  assert.ok(i >= 0 && migration.indexOf("END $preflight_20261244$") > i);
  const antesDoPreflight = semComentarios(migration.slice(0, i));
  for (const escrita of [
    /CREATE\s/i,
    /REVOKE\s/i,
    /GRANT\s/i,
    /ALTER\s/i,
    /DROP\s/i,
  ])
    assert.ok(!escrita.test(antesDoPreflight), `${escrita} antes do preflight`);
  // o NOTIFY do PostgREST fecha os três arquivos que mexem em coluna/view
  for (const t of [migration, rollback, destrutivo])
    assert.ok(t.trimEnd().endsWith("NOTIFY pgrst, 'reload schema';"));
});

Deno.test("v_store_config: as 45 colunas de antes na MESMA ordem + as duas novas no FIM; o rollback refaz a view das 45 e devolve os GRANT", () => {
  const colunasDa = (sql, depoisDe) => {
    const i = sql.indexOf(depoisDe);
    assert.ok(i >= 0, `não achei ${depoisDe}`);
    const f = sql.indexOf("FROM store_config", i);
    return sql
      .slice(sql.indexOf("SELECT", i) + "SELECT".length, f)
      .split(",")
      .map((c) => c.trim())
      .filter(Boolean);
  };
  const v39 = colunasDa(
    ler(ANTECESSORAS.upsert_store_config),
    "CREATE OR REPLACE VIEW public.v_store_config",
  );
  const v44 = colunasDa(
    migration,
    "CREATE OR REPLACE VIEW public.v_store_config",
  );
  const vrb = colunasDa(rollback, "CREATE VIEW public.v_store_config");
  assert.equal(v39.length, 45);
  assert.deepEqual(v44, [
    ...v39,
    "local_delivery_enabled",
    "local_delivery_days",
  ]);
  assert.deepEqual(vrb, v39);
  assert.ok(migration.includes("WITH (security_invoker=on)"));
  assert.ok(rollback.includes("DROP VIEW public.v_store_config;"));
  assert.ok(
    rollback.includes(
      "GRANT ALL ON TABLE public.v_store_config TO anon, authenticated, service_role;",
    ),
  );
  // as duas listas do preflight/pós-voo da migration citam as 45 e as 47
  assert.ok(migration.includes(v39.join(",")));
  assert.ok(migration.includes(v44.join(",")));
  assert.ok(rollback.includes(v39.join(",")));
});

Deno.test("o rollback comum RECUSA com loja em So retiro e NÃO apaga as colunas; o destrutivo exige o comum antes, recusa escolha da lojista e só então apaga", () => {
  const sqlRb = semComentarios(rollback);
  assert.ok(sqlRb.includes("LOJA_EM_SO_RETIRO_NAO_SE_REVERTE_SEM_QUERER"));
  assert.ok(sqlRb.includes("WHERE local_delivery_enabled = false"));
  assert.ok(
    !/DROP\s+COLUMN/i.test(sqlRb),
    "o rollback comum não apaga colunas",
  );
  assert.ok(
    sqlRb.includes(
      "DROP TRIGGER IF EXISTS store_config_so_retirada_exige_retirada ON public.store_config;",
    ),
  );
  assert.ok(
    sqlRb.includes(
      "DROP FUNCTION IF EXISTS public.store_config_so_retirada_exige_retirada();",
    ),
  );
  // a recusa vem ANTES da primeira reescrita
  assert.ok(
    rollback.indexOf("LOJA_EM_SO_RETIRO_NAO_SE_REVERTE_SEM_QUERER") <
      rollback.indexOf("CREATE OR REPLACE FUNCTION public.upsert_store_config"),
  );
  const sqlD = semComentarios(destrutivo);
  assert.ok(sqlD.includes("ENTREGA_NA_CIDADE_ROLLBACK_COMUM_PRIMEIRO"));
  assert.ok(sqlD.includes("ESCOLHA_DA_LOJISTA_NAO_SE_APAGA_SEM_QUERER"));
  assert.ok(
    sqlD.includes("local_delivery_enabled = false OR local_delivery_days <> 1"),
  );
  assert.ok(sqlD.includes("DROP COLUMN IF EXISTS local_delivery_days;"));
  assert.ok(sqlD.includes("DROP COLUMN IF EXISTS local_delivery_enabled;"));
  assert.ok(
    sqlD.indexOf("ESCOLHA_DA_LOJISTA_NAO_SE_APAGA_SEM_QUERER") <
      sqlD.indexOf("DROP COLUMN IF EXISTS"),
  );
});

Deno.test("os cabeçalhos apontam a prova viva e os rollbacks, e dizem o que acontece com os dados que já existem", () => {
  assert.ok(
    migration.includes("tests/banco/a-loja-escolhe-como-entrega-viva.cjs"),
  );
  assert.ok(migration.includes(NOME_RB));
  assert.ok(migration.includes(NOME_RBD));
  assert.ok(migration.includes("a-loja-escolhe-como-entrega-posterior.cjs"));
  assert.ok(/DADOS EXISTENTES/i.test(migration));
  assert.ok(/IDEMPOT/i.test(migration));
  assert.ok(
    rollback.includes('ATENÇÃO — O QUE PERDE QUEM TEM LOJA EM "SÓ RETIRO"'),
  );
});

Deno.test("as consultas antecessoras (8e, 9a, 31a, 37a, 40a) e as provas que fixam os corpos antigos conhecem esta sucessora", () => {
  const c8e = lerArquivo(
    "scripts/publicacao/consultas/8e-conferir-92-a-202-aplicado.sql",
  );
  assert.ok(
    c8e.includes(
      `('upsert_store_config', '${NOVO.upsert_store_config}', '20261244000000')`,
    ),
  );
  assert.ok(
    c8e.includes("('upsert_store_config', '9c56a9c6953e1d774a1ee97d5d8a7e16')"),
    "a 8e segue com o corpo da 99 como `final`",
  );
  const c9a = lerArquivo(
    "scripts/publicacao/consultas/9a-conferir-60-a-66-aplicado.sql",
  );
  assert.ok(c9a.includes(`c.h = '${NOVO.upsert_store_config}'`));
  assert.ok(!c9a.includes(VIGENTE.upsert_store_config));
  const c31a = lerArquivo(
    "scripts/publicacao/consultas/31a-conferir-endereco-da-compra-fica-no-pedido.sql",
  );
  // (a 20261350000000, a sucessora desta, entra como o ULTIMO hash aceito de cada lista)
  assert.ok(
    c31a.includes(
      `f.m IN ('${VIGENTE.create_marketplace_order_v23}', '${NOVO.create_marketplace_order_v23}', '`,
    ),
  );
  assert.ok(c31a.includes(`'${NOVO.create_marketplace_order_v24}', '`));
  const c37a = lerArquivo(
    "scripts/publicacao/consultas/37a-conferir-compra-de-zero-reais-nao-se-paga-pelo-app-aplicado.sql",
  );
  assert.ok(
    c37a.includes(
      `f.m IN ('${VIGENTE.create_marketplace_order_v24}', '${NOVO.create_marketplace_order_v24}', '`,
    ),
  );
  const c40a = lerArquivo(
    "scripts/publicacao/consultas/40a-conferir-identidade-legal-da-loja-aplicado.sql",
  );
  assert.ok(
    c40a.includes(
      `f.m IN ('${VIGENTE.upsert_store_config}', '${NOVO.upsert_store_config}', 'aa4ed730ac6ad3d3c2644b4285ff39a9')`,
    ),
  );
  // as quatro 'b' (ausência) NÃO citam os corpos desta migration
  for (const b of [
    "31b-antes-endereco-da-compra-corpos-vigentes",
    "37b-antes-compra-de-zero-reais-corpo-vigente",
    "40b-antes-identidade-legal-da-loja-corpo-vigente",
  ]) {
    try {
      const sql = lerArquivo(`scripts/publicacao/consultas/${b}.sql`);
      for (const h of Object.values(NOVO))
        assert.ok(!sql.includes(h), `${b} cita ${h}`);
    } catch (e) {
      if (!(e instanceof Deno.errors.NotFound)) throw e;
    }
  }
  // a cadeia de sucessoras da 99 (provas vivas) lista a migration com os TRÊS pares
  const suc = lerArquivo("tests/banco/sucessoras-da-99.cjs");
  assert.ok(suc.includes(`"${NOME}",`));
  assert.ok(suc.includes(`["${NOME}", 3]`));
  // o módulo "posterior" desta migration existe e é o ponto único das provas antecessoras
  const posterior = lerArquivo(
    "tests/banco/a-loja-escolhe-como-entrega-posterior.cjs",
  );
  assert.ok(posterior.includes(NOME));
});

// ---------------------------------------------------------------------------
// O PORTÃO DA RELEASE (consultas 47a/47b, db-apply, canais-de-backend): o que se prova só lendo o texto.
// O que as consultas DECIDEM (um negativo por linha, mutantes, o portão) é de
// tests/banco/a-loja-escolhe-como-entrega-portao-viva.cjs; o que o lote declara para o portão (ordem, ledger, apply) é de
// tests/frota_publicar_release_test.ts.
// ---------------------------------------------------------------------------
const CONF = require("../scripts/publicacao/conferir-banco.cjs");
const A47 = "47a-conferir-a-loja-escolhe-como-entrega-aplicado";
const B47 = "47b-antes-a-loja-escolhe-como-entrega-base-vigente";
const consulta = (n) => lerArquivo(`scripts/publicacao/consultas/${n}.sql`);

Deno.test("47a/47b — no menu e no rpc-ci, rol fechado de 9 e 9 itens no código, UM statement só de leitura, e cada item do rol está no .sql", () => {
  const yaml = lerArquivo(".github/workflows/conferir-banco-da-loja.yml");
  const rpc = lerArquivo(".github/workflows/rpc-ci.yml");
  for (const n of [A47, B47]) {
    assert.ok(yaml.includes(`- ${n}\n`), `${n}: no menu`);
    assert.equal(
      rpc.split(`scripts/publicacao/consultas/${n}.sql`).length - 1,
      2,
      `${n}: nos dois gatilhos de path do rpc-ci`,
    );
    const sql = consulta(n);
    assert.equal(CONF.contarStatements(sql), 1, `${n}: UM statement`);
    const limpo = removerRuido(sql);
    assert.ok(/^\s*WITH\b/i.test(limpo), `${n}: começa por WITH`);
    assert.ok(
      !/\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|TRUNCATE|GRANT|REVOKE|COPY|CALL|DO|SET|BEGIN|COMMIT|LOCK)\b/i.test(
        limpo.replace(/'(?:[^']|'')*'/g, "''"),
      ),
      `${n}: palavra de escrita`,
    );
    // só catálogo: nenhuma tabela de dado é lida (nem a store_config: só pg_attribute dela)
    assert.ok(
      !/\b(FROM|JOIN)\s+(public\.)?(store_config|v_store_config|marketplace_orders|marketplace_order_items|profiles)\b/i.test(
        limpo,
      ),
      `${n}: leu uma tabela de dado`,
    );
  }
  assert.equal(CONF.ROL_DA_47A.length, 9);
  assert.equal(CONF.ROL_DA_47B.length, 9);
  assert.equal(new Set(CONF.ROL_DA_47A).size, 9);
  assert.equal(new Set(CONF.ROL_DA_47B).size, 9);
  assert.equal(CONF.ROL_FECHADO_POR_CONSULTA[A47], CONF.ROL_DA_47A);
  assert.equal(CONF.ROL_FECHADO_POR_CONSULTA[B47], CONF.ROL_DA_47B);
  for (const [n, rol] of [
    [A47, CONF.ROL_DA_47A],
    [B47, CONF.ROL_DA_47B],
  ])
    for (const item of rol)
      assert.ok(
        consulta(n).includes(`'${item}'`),
        `${n}: "${item}" fora do .sql`,
      );
  // ASCII só (a consulta viaja pela API de gerenciamento): a exceção é o travessão do cabeçalho, como nas outras
  for (const n of [A47, B47]) {
    const fora = consulta(n)
      .split("\n")
      .slice(1)
      .filter((l) => [...l].some((ch) => ch.charCodeAt(0) > 127));
    assert.deepEqual(fora, [], `${n}: acento ou símbolo fora do cabeçalho`);
  }
});

Deno.test("47a/47b — os md5 citados são os dos ARQUIVOS: a 47a os corpos desta migration, a 47b os vigentes; nenhuma cita o do outro", () => {
  const a = consulta(A47);
  const b = consulta(B47);
  for (const fn of FUNCOES) {
    assert.ok(a.includes(`'${NOVO[fn]}'`), `a 47a cita o corpo novo de ${fn}`);
    assert.ok(!a.includes(VIGENTE[fn]), `a 47a não cita o vigente de ${fn}`);
    assert.ok(b.includes(`'${VIGENTE[fn]}'`), `a 47b cita o vigente de ${fn}`);
    assert.ok(!b.includes(NOVO[fn]), `a 47b não cita o corpo novo de ${fn}`);
  }
  assert.ok(
    a.includes(`'${HASH_TRIGGER}'`),
    "a 47a cita o corpo da função da trigger",
  );
  assert.ok(!b.includes(HASH_TRIGGER));
  // o md5 da lista de colunas: a 47b as 45, a 47a as 47 (calculado do arquivo, não copiado)
  const colunas = (sql, de) => {
    const i = sql.indexOf(de);
    const f = sql.indexOf("FROM store_config", i);
    return sql
      .slice(sql.indexOf("SELECT", i) + 6, f)
      .split(",")
      .map((c) => c.trim())
      .filter(Boolean);
  };
  const v45 = colunas(
    ler(ANTECESSORAS.upsert_store_config),
    "CREATE OR REPLACE VIEW public.v_store_config",
  );
  const v47 = colunas(
    migration,
    "CREATE OR REPLACE VIEW public.v_store_config",
  );
  assert.ok(
    b.includes(`'${md5(v45.join(","))}'`),
    "a 47b cita o md5 das 45 colunas",
  );
  assert.ok(
    a.includes("e27d843e36ba4197f400d010aefe930e") &&
      md5(v47.join(",")) === "e27d843e36ba4197f400d010aefe930e",
  );
  assert.ok(!a.includes(md5(v45.join(","))) && !b.includes(md5(v47.join(","))));
});

Deno.test("47a/47b — a ACL, os atributos, a CHECK e a trigger que as consultas medem são os que o pré-voo e o pós-voo da migration exigem", () => {
  for (const n of [A47, B47]) {
    const c = consulta(n);
    for (const trecho of [
      "p.prosecdef",
      "l.lanname = 'plpgsql'",
      "p.provolatile = 'v'",
      "ARRAY['search_path=public']::text[]",
      "a.grantee = 0 AND a.privilege_type = 'EXECUTE'",
      "has_function_privilege('anon'",
      "has_function_privilege('authenticated'",
      "has_function_privilege('service_role'",
      "'v23: PUBLIC=nao anon=sim authenticated=sim service_role=sim | v24: PUBLIC=nao anon=sim authenticated=sim service_role=sim | upsert: PUBLIC=nao anon=nao authenticated=sim service_role=sim'",
    ])
      assert.ok(c.includes(trecho), `${n}: falta ${trecho}`);
  }
  const a = consulta(A47);
  for (const trecho of [
    "CHECK (((local_delivery_days >= 0) AND (local_delivery_days <= 30)))",
    "t.tgtype = 23",
    "t.tgenabled = 'O'",
    "ARRAY['search_path=public, pg_temp']::text[]",
    "store_config_local_delivery_days_check",
  ])
    assert.ok(a.includes(trecho), `47a: falta ${trecho}`);
  // a migration confere os mesmos fatos no pós-voo
  for (const trecho of [
    "pg_get_constraintdef(oid) = 'CHECK (((local_delivery_days >= 0) AND (local_delivery_days <= 30)))'",
    "t.tgtype = 23",
    "t.tgenabled = 'O'",
    "ARRAY['search_path=public, pg_temp']::text[]",
  ])
    assert.ok(
      migration.includes(trecho),
      `pós-voo da migration: falta ${trecho}`,
    );
});

Deno.test("db-apply.cjs — a migration TEM entrada em VERIFICACOES (sem ela o apply sai PULADA) e cada marcador aparece o número certo de vezes no corpo novo e REPROVA no corpo antigo", () => {
  const { VERIFICACOES, conferirMarcador } = require("../scripts/db-apply.cjs");
  const entrada = VERIFICACOES[NOME];
  assert.ok(entrada, "a migration não tem entrada em VERIFICACOES");
  assert.deepEqual(entrada.map((e) => e.funcao).sort(), [...FUNCOES].sort());
  for (const checagem of entrada) {
    const novo = corpoDa(migration, checagem.funcao);
    const velho = corpoDa(ler(ANTECESSORAS[checagem.funcao]), checagem.funcao);
    assert.ok(
      checagem.esperado.length >= 4,
      `${checagem.funcao}: marcadores a menos`,
    );
    for (const marcador of checagem.esperado) {
      const r = conferirMarcador(novo, marcador);
      assert.ok(
        r.ok,
        `${checagem.funcao} ${JSON.stringify(marcador)}: ${r.achou}x (esperado ${r.esperado}x)`,
      );
      assert.ok(
        !conferirMarcador(velho, marcador).ok,
        `${checagem.funcao} ${JSON.stringify(marcador)}: o corpo ANTIGO também passaria`,
      );
    }
  }
});

Deno.test("canais-de-backend.json, publicar-release e rpc-ci — o lote da 20261244000000 está registrado com a consulta, a ausência e a versão; as duas provas vivas rodam no job bloqueante", () => {
  const canais = JSON.parse(lerArquivo("scripts/frota/canais-de-backend.json"));
  const lote = canais.provasDeObjetos.find((p) => p.consulta === A47);
  assert.ok(lote, "lote 47a ausente");
  assert.deepEqual(lote.versoes, ["20261244000000"]);
  assert.equal(lote.ausenciaConfirmadaPor, B47);
  assert.equal(
    canais.provasDeObjetos.filter((p) =>
      (p.versoes ?? []).includes("20261244000000"),
    ).length,
    1,
    "a versão está em UM lote só",
  );
  for (const n of [NOME_RB, NOME_RBD])
    assert.ok(
      Deno.statSync(new URL(`../supabase/migrations/${n}`, import.meta.url))
        .isFile,
    );
  const release = lerArquivo("scripts/frota/publicar-release.mjs");
  assert.ok(release.includes(`"${A47}",`) && release.includes(`"${B47}",`));
  const rpc = lerArquivo(".github/workflows/rpc-ci.yml");
  const bloqueante = rpc.slice(
    rpc.indexOf("\n  contrato-dinheiro:"),
    rpc.indexOf("\n  provas-informacionais:"),
  );
  for (const prova of [
    "a-loja-escolhe-como-entrega-viva",
    "a-loja-escolhe-como-entrega-portao-viva",
  ]) {
    const k = bloqueante.indexOf(
      `run: node tests/banco/rodar-isolado.cjs tests/banco/${prova}.cjs`,
    );
    assert.ok(
      k > bloqueante.indexOf("id: aplica"),
      `${prova}: no job bloqueante, depois de aplica`,
    );
    assert.ok(
      bloqueante
        .slice(0, k)
        .split("\n")
        .at(-2)
        .includes("steps.aplica.outcome == 'success'"),
      `${prova}: if do passo`,
    );
  }
});
