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

// ---------------------------------------------------------------------------
// O PORTAO da release deste lote (lote 40): as consultas 40a (DEPOIS), 40b (ANTES) e a medicao 40m. A prova VIVA da
// decisao delas e' tests/banco/loja-declara-quem-e-portao-viva.cjs (Postgres de verdade); aqui fica o que se prova
// so lendo o texto: os md5, as listas de colunas, o formato, o ACL da view que o rollback devolve e os fios do CI.
// ---------------------------------------------------------------------------
const {
  contarStatements,
  ROL_DA_40A,
  ROL_DA_40B,
} = require("../scripts/publicacao/conferir-banco.cjs");
const CONSULTA_40A = "40a-conferir-identidade-legal-da-loja-aplicado";
const CONSULTA_40B = "40b-antes-identidade-legal-da-loja-base-vigente";
const CONSULTA_40M = "40m-medir-identidade-legal-da-loja";
const lerConsulta = (nome) =>
  Deno.readTextFileSync(
    new URL(`scripts/publicacao/consultas/${nome}.sql`, DIR),
  ).replace(/\r\n/g, "\n");
const c40a = lerConsulta(CONSULTA_40A);
const c40b = lerConsulta(CONSULTA_40B);
const c40m = lerConsulta(CONSULTA_40M);
const PALAVRAS_DE_ESCRITA =
  /\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|TRUNCATE|GRANT|REVOKE|COPY|CALL|DO|SET|BEGIN|COMMIT)\b/i;

Deno.test("40a/40b citam os md5 REAIS dos dois corpos: o da 20261239 so na 40a, o da 20261199 so na 40b", () => {
  assert.ok(c40a.includes(`'${H_NOVO}'`), "40a cita o md5 do corpo novo");
  assert.ok(!c40a.includes(H_99), "40a nao cita o corpo antigo");
  assert.ok(c40b.includes(`'${H_99}'`), "40b cita o md5 do corpo da 99");
  assert.ok(!c40b.includes(H_NOVO), "40b nao cita o corpo novo");
});

Deno.test("40a/40b: as listas de colunas da view sao EXATAMENTE as duas do preflight da migration (45 na 40a, 42 na 40b)", () => {
  const listas = [
    ...migration.matchAll(
      /'(id,free_shipping_min,[^']*formas_pagamento_entrega[^']*)'/g,
    ),
  ].map((m) => m[1]);
  assert.equal(listas.length, 2, "o preflight tem as duas listas");
  const [l42, l45] = listas;
  assert.equal(l42.split(",").length, 42);
  assert.equal(l45.split(",").length, 45);
  assert.equal(
    l45,
    `${l42},store_legal_name,store_legal_document,store_support_email`,
  );
  assert.ok(c40a.includes(`'${l45}'`), "40a espera as 45 colunas");
  assert.ok(c40b.includes(`'${l42}'`), "40b espera as 42 colunas");
  assert.ok(!c40a.includes(`'${l42}'`), "40a nao aceita a lista de 42");
  assert.ok(!c40b.includes(`'${l45}'`), "40b nao aceita a lista de 45");
});

Deno.test("40a/40b/40m: UM statement, so leitura (nenhuma palavra de escrita fora de comentario e de texto)", () => {
  for (const [nome, sql] of [
    [CONSULTA_40A, c40a],
    [CONSULTA_40B, c40b],
    [CONSULTA_40M, c40m],
  ]) {
    assert.equal(contarStatements(sql), 1, `${nome}: exatamente 1 statement`);
    assert.ok(
      /^\s*(WITH|SELECT)\b/i.test(limpo(sql)),
      `${nome}: comeca em WITH/SELECT`,
    );
    assert.equal(
      PALAVRAS_DE_ESCRITA.test(limpo(sql)),
      false,
      `${nome}: palavra de escrita`,
    );
  }
});

Deno.test("40a/40b: rol FECHADO — um SELECT final item/esperado/vivo/ok, ordenado com ok=false primeiro, e os itens sao EXATAMENTE os do rol do conferir-banco", () => {
  for (const [nome, sql, rol] of [
    [CONSULTA_40A, c40a, ROL_DA_40A],
    [CONSULTA_40B, c40b, ROL_DA_40B],
  ]) {
    const sem = limpo(sql).trim();
    assert.ok(
      /SELECT item, esperado, vivo, COALESCE\(vivo = esperado, false\) AS ok FROM itens ORDER BY ok, item;?$/.test(
        sem,
      ),
      `${nome}: o SELECT final do rol fechado`,
    );
    assert.equal(new Set(rol).size, rol.length, `${nome}: itens distintos`);
    for (const item of rol)
      assert.equal(
        sql.split(`'${item}'`).length - 1,
        1,
        `${nome}: o item "${item}" aparece UMA vez`,
      );
    // um UNION ALL entre cada par de itens (e nenhum outro fora dos itens)
    assert.equal(
      sem.split("UNION ALL").length - 1,
      rol.length - 1,
      `${nome}: um UNION ALL entre cada par de itens`,
    );
  }
  assert.equal(ROL_DA_40A.length, 11);
  assert.equal(ROL_DA_40B.length, 10);
});

Deno.test("40a/40b medem o ACL da view que o rollback devolve (dono postgres, os tres papeis com ALL, PUBLIC sem nada, nenhum outro, nenhum GRANT OPTION), e o rollback faz DROP VIEW + CREATE VIEW + GRANT ALL", () => {
  const ACL =
    "dono=postgres anon=ALL authenticated=ALL service_role=ALL PUBLIC=nao outros=0 concede=0";
  assert.ok(c40a.includes(`'${ACL}'`), "40a mede o ACL da view");
  assert.ok(
    c40b.includes(`'${ACL}'`),
    "40b mede o ACL da view (a fotografia do vivo antes do apply)",
  );
  for (const sql of [c40a, c40b])
    assert.ok(sql.includes("'security_invoker=on'"), "as opcoes da view");
  const r = norm(rollback);
  assert.ok(r.includes("DROP VIEW public.v_store_config;"));
  assert.ok(
    r.includes(
      "GRANT ALL ON TABLE public.v_store_config TO anon, authenticated, service_role;",
    ),
    "o rollback devolve o ACL com GRANT ALL aos tres papeis",
  );
  assert.ok(
    r.includes(
      "CREATE VIEW public.v_store_config WITH (security_invoker=on) AS",
    ),
    "o rollback recria a view com as mesmas opcoes",
  );
});

Deno.test("40m: rol ABERTO (sem coluna ok, nao e portao), so catalogo e contagens, nenhum valor das colunas novas e nenhuma linha lida de store_config alem do count", () => {
  const sem = limpo(c40m);
  assert.equal(/\bok\b/i.test(sem), false, "40m nao tem a coluna ok");
  assert.equal(/store_legal|store_support/.test(sem), false);
  // a unica leitura de store_config e a contagem
  assert.equal([...sem.matchAll(/FROM public\.store_config/g)].length, 1);
  assert.ok(/count\(\*\) FROM public\.store_config/.test(sem), "so count(*)");
  // mostra o que o rollback recria e o que faria o DROP VIEW recusar
  for (const trecho of [
    "relacl",
    "reloptions",
    "pg_depend",
    "pg_rewrite",
    "to_regprocedure",
  ])
    assert.ok(c40m.includes(trecho), trecho);
});

Deno.test("rpc-ci.yml: as tres consultas nos DOIS blocos de paths e os passos da prova viva e do portao rodam as provas certas", () => {
  const wf = Deno.readTextFileSync(
    new URL(".github/workflows/rpc-ci.yml", DIR),
  );
  for (const nome of [CONSULTA_40A, CONSULTA_40B, CONSULTA_40M])
    assert.equal(
      wf.split(`"scripts/publicacao/consultas/${nome}.sql"`).length - 1,
      2,
      `${nome}: nos dois blocos (push e pull_request)`,
    );
  for (const prova of [
    "loja-declara-quem-e-viva.cjs",
    "loja-declara-quem-e-portao-viva.cjs",
  ])
    assert.ok(
      wf.includes(
        `run: node tests/banco/rodar-isolado.cjs tests/banco/${prova}`,
      ),
      prova,
    );
});

Deno.test("8e e 9a: o corpo novo da upsert_store_config e' a sucessora na 8e (o final segue o da 99) e o corpo final da 9a", () => {
  const sql8e = lerConsulta("8e-conferir-92-a-202-aplicado");
  const sql9a = lerConsulta("9a-conferir-60-a-66-aplicado");
  assert.ok(
    sql8e.includes(`('upsert_store_config', '${H_99}')`),
    "8e: o final segue o da 99",
  );
  assert.ok(
    sql8e.includes(`('upsert_store_config', '${H_NOVO}', '20261239000000')`),
    "8e: a sucessora",
  );
  // A 9a prova o corpo MAIS NOVO da função: depois da 20261310000000 (estilo do card de frete) é o dela.
  assert.ok(
    sql9a.includes(
      "('upsert_store_config', 'aa4ed730ac6ad3d3c2644b4285ff39a9')",
    ),
    "9a: o corpo final e o da sucessora (20261310000000)",
  );
  assert.ok(
    !sql9a.includes(H_NOVO),
    "9a nao cita mais o corpo desta migration",
  );
  assert.ok(!sql9a.includes(H_99), "9a nao cita mais o corpo da 99");
});
