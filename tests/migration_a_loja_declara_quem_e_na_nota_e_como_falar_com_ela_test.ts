// @ts-nocheck
// A LOJA PODE DECLARAR RAZAO SOCIAL, CNPJ/CPF E E-MAIL DE ATENDIMENTO — prova offline do par 20261239000000 +
// rollback (decisao do dono e do socio, 14/10/2026; aditiva e opcional). O COMPORTAMENTO (salvar um campo nao apaga
// os outros, a CHECK de forma, a leitura publica, ida e volta, o rollback que recusa apagar dado da loja, os
// mutantes) e' provado em tests/banco/loja-declara-quem-e-viva.cjs, num Postgres de verdade. Aqui fica o que se
// prova so lendo o texto.
//
// Riscos que este arquivo fecha: o corpo novo da upsert_store_config (funcao SECURITY DEFINER, a porta de toda a
// configuracao da loja) tem de ser o da 20261199000000 com SO as tres trocas declaradas; o rollback tem de repetir o
// corpo da 99 byte a byte; os hashes fixados (preflight, pos-voo e rollback) tem de bater com o texto; a migration
// so ACRESCENTA (nenhum DROP, nenhum DELETE, nenhum UPDATE, nenhum GRANT/REVOKE novo) e o rollback so volta.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  avaliarFase0,
  detectarTransacaoExplicita,
  removerRuido,
} = require("../scripts/db-prove-rollback.cjs");
const { avaliarChecagem, VERIFICACOES } = require("../scripts/db-apply.cjs");

const DIR = new URL("../", import.meta.url);
const NOME =
  "20261239000000_a_loja_declara_quem_e_na_nota_e_como_falar_com_ela.sql";
const NOME_99 = "20261199000000_portas_do_painel_exigem_admin_atual.sql";
const ler = (n) =>
  Deno.readTextFileSync(new URL(`supabase/migrations/${n}`, DIR)).replace(
    /\r\n/g,
    "\n",
  );
const migration = ler(NOME);
const rollback = ler(`rollback-manual-${NOME}`);
const migration99 = ler(NOME_99);
const md5 = (s) => createHash("md5").update(s).digest("hex");

const H_99 = "9c56a9c6953e1d774a1ee97d5d8a7e16";
const H_NOVO = "b562669936df1cda31d4bdd4d075bff3";

/** O corpo (entre as aspas de dolar) do UM `CREATE OR REPLACE FUNCTION public.upsert_store_config(` do arquivo. */
function corpoDaUpsert(sql) {
  const marca = "CREATE OR REPLACE FUNCTION public.upsert_store_config(";
  assert.equal(sql.split(marca).length - 1, 1, "uma definicao da upsert");
  const ini = sql.indexOf(marca);
  const m = /\bAS (\$\w*\$)/.exec(sql.slice(ini));
  const abre = ini + m.index + m[0].length;
  return sql.slice(abre, sql.indexOf(m[1], abre));
}
const CORPO_99 = corpoDaUpsert(migration99);
const CORPO_NOVO = corpoDaUpsert(migration);
// `limpo` tira comentarios, literais e o INTERIOR de todo bloco entre aspas de dolar (so sobra o esqueleto dos
// comandos de nivel superior); `norm` tira so os comentarios de linha e junta os espacos (o texto dos DO e da
// funcao fica).
const limpo = (s) => removerRuido(s).replace(/\s+/g, " ");
const norm = (s) =>
  s
    .split("\n")
    .map((l) => l.replace(/--.*$/, ""))
    .join("\n")
    .replace(/\s+/g, " ")
    .trim();

Deno.test("avaliarFase0 nao recusa o par migration+rollback", () => {
  const r = avaliarFase0({
    sqlMigration: migration,
    sqlRollback: rollback,
    temRollback: true,
  });
  assert.equal(r.recusado, false, `motivos: ${(r.motivos || []).join("; ")}`);
});

Deno.test("nenhum arquivo do par abre ou fecha transacao de nivel superior (regra da casa)", () => {
  assert.deepEqual(
    detectarTransacaoExplicita(removerRuido(migration)).achados,
    [],
  );
  assert.deepEqual(
    detectarTransacaoExplicita(removerRuido(rollback)).achados,
    [],
  );
});

Deno.test("os hashes fixados batem com o texto: o corpo da 99, o corpo novo e o do rollback", () => {
  assert.equal(md5(CORPO_99), H_99, "o corpo da 20261199000000 mudou");
  assert.equal(
    md5(CORPO_NOVO),
    H_NOVO,
    "o corpo da migration mudou sem refixar o hash",
  );
  assert.equal(CORPO_99.split("\r").length, 1, "LF no fonte");
  // preflight: UM par (vigente, desta) no formato que tests/banco/sucessoras-da-99.cjs le
  const pares = [
    ...migration.matchAll(
      /\('(public\.[a-z_0-9]+\([^)]*\))', '([0-9a-f]{32})', '([0-9a-f]{32})'\)/g,
    ),
  ];
  assert.equal(pares.length, 1, "o preflight cita UM par de hashes");
  assert.deepEqual(pares[0].slice(1), [
    "public.upsert_store_config(jsonb)",
    H_99,
    H_NOVO,
  ]);
  // pos-voo e rollback: o mesmo hash
  assert.equal(
    migration.split(`IS DISTINCT FROM '${H_NOVO}'`).length - 1,
    1,
    "pos-voo confere o corpo novo",
  );
  assert.equal(
    rollback.split(`IS DISTINCT FROM '${H_NOVO}'`).length - 1,
    1,
    "o rollback so reverte o corpo desta migration",
  );
});

Deno.test("o rollback devolve o corpo da 20261199000000 BYTE A BYTE", () => {
  assert.equal(corpoDaUpsert(rollback), CORPO_99);
});

Deno.test("o corpo novo e' o da 99 com SO as tres trocas declaradas (a lista do INSERT, os VALUES sem COALESCE e os tres CASE do ON CONFLICT)", () => {
  const TROCAS = [
    [
      "    formas_pagamento_entrega\n  )\n  VALUES (",
      "    formas_pagamento_entrega,\n    store_legal_name, store_legal_document, store_support_email\n  )\n  VALUES (",
    ],
    [
      "    v_formas_pagamento\n  )\n  -- A partir daqui",
      "    v_formas_pagamento,\n" +
        "    -- 20261239000000: sem default de fábrica — razão social, documento e\n" +
        "    -- e-mail de atendimento só existem quando a lojista digita.\n" +
        "    config_json->>'store_legal_name',\n" +
        "    config_json->>'store_legal_document',\n" +
        "    config_json->>'store_support_email'\n" +
        "  )\n  -- A partir daqui",
    ],
    [
      "      ELSE store_config.formas_pagamento_entrega END,\n    updated_at = now()",
      "      ELSE store_config.formas_pagamento_entrega END,\n" +
        "    -- 20261239000000: razão social, documento e e-mail de atendimento — o\n" +
        "    -- CASE por coluna garante que salvar um deles (ou qualquer outro campo\n" +
        "    -- da loja) não apaga os demais.\n" +
        "    store_legal_name = CASE WHEN config_json ? 'store_legal_name'\n" +
        "      THEN config_json->>'store_legal_name'\n" +
        "      ELSE store_config.store_legal_name END,\n" +
        "    store_legal_document = CASE WHEN config_json ? 'store_legal_document'\n" +
        "      THEN config_json->>'store_legal_document'\n" +
        "      ELSE store_config.store_legal_document END,\n" +
        "    store_support_email = CASE WHEN config_json ? 'store_support_email'\n" +
        "      THEN config_json->>'store_support_email'\n" +
        "      ELSE store_config.store_support_email END,\n" +
        "    updated_at = now()",
    ],
  ];
  let esperado = CORPO_99;
  for (const [de, para] of TROCAS) {
    assert.equal(
      esperado.split(de).length - 1,
      1,
      `trecho unico na 99: ${de.slice(0, 40)}`,
    );
    esperado = esperado.replace(de, para);
  }
  assert.equal(CORPO_NOVO, esperado);
});

Deno.test("sem COALESCE: ausencia grava NULL e nunca inventa texto que ninguem digitou", () => {
  for (const chave of [
    "store_legal_name",
    "store_legal_document",
    "store_support_email",
  ]) {
    assert.equal(
      CORPO_NOVO.split(`config_json->>'${chave}'`).length - 1,
      2,
      `${chave}: 1 no INSERT + 1 no CASE`,
    );
    assert.equal(
      CORPO_NOVO.split(`COALESCE(config_json->>'${chave}'`).length - 1,
      0,
    );
    assert.equal(
      CORPO_NOVO.split(`${chave} = CASE WHEN config_json ? '${chave}'`).length -
        1,
      1,
    );
  }
});

Deno.test("as colunas sao text, nulas e SEM DEFAULT; a forma mora em CHECK; o documento nao tem a conta do DV no banco", () => {
  for (const c of [
    "store_legal_name",
    "store_legal_document",
    "store_support_email",
  ]) {
    assert.ok(
      migration.includes(
        `ALTER TABLE public.store_config ADD COLUMN IF NOT EXISTS ${c} text;`,
      ),
      `${c}: text, aditiva`,
    );
  }
  const sql = norm(migration);
  assert.equal(
    /ADD COLUMN IF NOT EXISTS store_(legal_name|legal_document|support_email) text (NOT NULL|DEFAULT)/.test(
      sql,
    ),
    false,
  );
  assert.ok(
    sql.includes(
      "CHECK (store_legal_name IS NULL OR char_length(btrim(store_legal_name)) BETWEEN 1 AND 200)",
    ),
  );
  assert.ok(
    sql.includes("store_legal_document ~ '^([0-9]{11}|[0-9A-Z]{12}[0-9]{2})$'"),
  );
  assert.ok(sql.includes("char_length(store_support_email) <= 254"));
});

Deno.test("a view ganha as tres colunas NO FIM por CREATE OR REPLACE (o ACL e as opcoes nao sao recriados)", () => {
  const ini = migration.indexOf("CREATE OR REPLACE VIEW public.v_store_config");
  assert.ok(ini > 0);
  const view = norm(
    migration.slice(ini, migration.indexOf("WHERE id = 1;", ini)),
  );
  assert.ok(view.includes("security_invoker=on"));
  const ordem = [
    "manutencao",
    "store_address",
    "store_description",
    "formas_pagamento_entrega",
    "store_legal_name",
    "store_legal_document",
    "store_support_email",
  ];
  ordem.slice(1).forEach((nome, i) => {
    const anterior = ordem.at(i) ?? "";
    assert.ok(
      view.indexOf(nome) > view.indexOf(anterior),
      `${nome} depois de ${anterior}`,
    );
  });
  assert.ok(
    view.endsWith("store_support_email FROM store_config"),
    "as tres sao as ULTIMAS",
  );
  assert.equal(
    limpo(migration).includes("DROP VIEW"),
    false,
    "a ida nunca derruba a view",
  );
  assert.equal(
    limpo(migration).includes("GRANT "),
    false,
    "a ida nao mexe em ACL",
  );
});

Deno.test("a ida SO acrescenta: nenhum DROP, DELETE, UPDATE nem TRUNCATE em codigo (o texto dos avisos nao conta)", () => {
  const codigo = limpo(migration);
  for (const proibido of [
    /\bDROP\b/,
    /\bDELETE\b/,
    /\bUPDATE\b/,
    /\bTRUNCATE\b/,
    /\bREVOKE\b/,
  ]) {
    assert.equal(
      proibido.test(codigo),
      false,
      `a ida nao pode conter ${proibido}`,
    );
  }
  assert.equal(
    migration.split("INSERT INTO public.store_config").length - 1,
    1,
    "so o INSERT da propria RPC, nenhum seed",
  );
});

Deno.test("ordem: o preflight vem antes de qualquer mudanca e o pos-voo depois da funcao", () => {
  const iPre = migration.indexOf("DO $preflight_20261239$");
  const iAlter = migration.indexOf(
    "ALTER TABLE public.store_config ADD COLUMN",
  );
  const iView = migration.indexOf(
    "CREATE OR REPLACE VIEW public.v_store_config",
  );
  const iFn = migration.indexOf(
    "CREATE OR REPLACE FUNCTION public.upsert_store_config",
  );
  const iPos = migration.indexOf("DO $posvoo_20261239$");
  assert.ok(
    iPre > 0 && iPre < iAlter && iAlter < iView && iView < iFn && iFn < iPos,
  );
  assert.ok(
    migration.trimEnd().endsWith("NOTIFY pgrst, 'reload schema';"),
    "recarrega o cache do PostgREST no fim",
  );
});

Deno.test("o rollback: recusa com dado da loja, encolhe a view por DROP+CREATE+GRANT, derruba as colunas por ULTIMO", () => {
  const r = norm(rollback);
  assert.ok(r.includes("DADO_DA_LOJA_NAO_SE_APAGA_SEM_QUERER"));
  assert.ok(
    r.indexOf("DADO_DA_LOJA_NAO_SE_APAGA_SEM_QUERER") <
      r.indexOf("CREATE OR REPLACE FUNCTION"),
  );
  assert.ok(
    r.includes(
      "DROP VIEW public.v_store_config; CREATE VIEW public.v_store_config WITH (security_invoker=on) AS",
    ),
  );
  assert.ok(
    r.includes(
      "GRANT ALL ON TABLE public.v_store_config TO anon, authenticated, service_role;",
    ),
  );
  assert.equal(
    r.includes("CREATE OR REPLACE VIEW"),
    false,
    "OR REPLACE nao encolhe lista de colunas",
  );
  const iFn = r.indexOf("CREATE OR REPLACE FUNCTION");
  const iView = r.indexOf("DROP VIEW public.v_store_config");
  const iCols = r.indexOf("DROP COLUMN IF EXISTS store_support_email");
  assert.ok(
    iFn < iView && iView < iCols,
    "RPC, depois a view, por ultimo as colunas",
  );
  for (const c of [
    "store_legal_name",
    "store_legal_document",
    "store_support_email",
  ]) {
    assert.ok(r.includes(`DROP COLUMN IF EXISTS ${c}`));
  }
  // a view do rollback e' a de 42 colunas: nenhuma das tres aparece dentro dela
  const viewDoRollback = r.slice(iView, r.indexOf("WHERE id = 1;", iView));
  assert.equal(/store_legal|store_support/.test(viewDoRollback), false);
});

// ---------------------------------------------------------------------------
// A entrada VERIFICACOES provada por SABOTAGEM: a MESMA checagem que o db-apply roda contra o banco e' exercitada
// contra o corpo SEM os CASE (deve FALHAR) e contra o corpo novo (deve VERIFICAR).
// ---------------------------------------------------------------------------
// Busca pela lista de pares (sem indexar o objeto por uma chave que vem de variavel).
function entradaDaVerificacao() {
  return Object.entries(VERIFICACOES).find(([nome]) => nome === NOME)?.[1];
}

Deno.test("VERIFICACOES tem entrada para a 20261239000000, e ela reprova o corpo da 99 e verifica o corpo novo", () => {
  const entrada = entradaDaVerificacao();
  assert.ok(
    entrada !== undefined,
    "sem entrada em VERIFICACOES para a migration",
  );
  assert.equal(entrada.length, 1);
  assert.equal(entrada[0].funcao, "upsert_store_config");
  // o corpo da 99 NAO tem os marcadores: a checagem tem de FALHAR (entrada que nao reprova e' pior que ausente)
  assert.equal(avaliarChecagem(CORPO_99, entrada[0]).situacao, "falhou");
  // o corpo novo, como o pg_get_functiondef o devolve (aqui, o proprio texto), VERIFICA
  assert.equal(avaliarChecagem(CORPO_NOVO, entrada[0]).situacao, "verificada");
});

Deno.test("SABOTAGEM: cada marcador sozinho derruba a checagem (tirar um dos tres CASE, ou a guarda de admin atual)", () => {
  const checagem = entradaDaVerificacao()?.[0];
  assert.ok(checagem !== undefined, "sem entrada em VERIFICACOES");
  for (const chave of [
    "store_legal_name",
    "store_legal_document",
    "store_support_email",
  ]) {
    const semOCase = CORPO_NOVO.replace(
      `${chave} = CASE WHEN config_json ? '${chave}'\n      THEN config_json->>'${chave}'\n      ELSE store_config.${chave} END,`,
      `${chave} = config_json->>'${chave}',`,
    );
    assert.notEqual(semOCase, CORPO_NOVO);
    assert.equal(
      avaliarChecagem(semOCase, checagem).situacao,
      "falhou",
      `${chave}: sem o CASE a checagem reprova`,
    );
  }
  // sem a guarda de admin atual
  const semGuarda = CORPO_NOVO.replace(
    "IF NOT public.is_admin_atual() THEN",
    "IF false THEN",
  );
  assert.notEqual(semGuarda, CORPO_NOVO);
  assert.equal(avaliarChecagem(semGuarda, checagem).situacao, "falhou");
});
