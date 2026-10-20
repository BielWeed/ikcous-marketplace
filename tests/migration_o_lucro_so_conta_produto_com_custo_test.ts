// @ts-nocheck
// O LUCRO SÓ CONTA PRODUTO COM CUSTO — prova offline do par 20261234000000 +
// rollback (caçada de 14/10/2026). O COMPORTAMENTO (lucro por dia e ranking só
// de produto com custo, custo 0 que conta, a receita intacta, o fuso, o pedido
// que não conta, o corpo antigo dando o número inflado) é provado em
// tests/banco/lucro-so-com-custo-viva.cjs; aqui fica o que se prova só lendo o
// texto, no `npm run test:unit`.
//
// Riscos amarrados: corpo que não é o vigente (o da 20261214000000, com a
// guarda do admin atual e o estoque que só conta custo) apaga uma das duas em
// silêncio; trocar mais do que as quatro mudanças declaradas muda outro número
// do painel (receita, estoque, hoje, mês); chave do JSON renomeada ou tirada
// quebra o front; hash de preflight que não é o md5 real; rollback que não
// volta byte a byte; GRANT/REVOKE escondido; ACL aberta que passa.
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
const NOME = "20261234000000_o_lucro_so_conta_produto_com_custo.sql";
const CATORZE =
  "20261214000000_o_lucro_do_estoque_so_conta_produto_com_custo.sql";
const HASH_VIGENTE = "0a5f8c75bbeeda3777a6a7326a0e281c";
const ASSINATURA = "public.get_admin_analytics_v2(integer)";

const lerArquivo = (rel) =>
  Deno.readTextFileSync(new URL(rel, DIR)).replace(/\r\n/g, "\n");
const ler = (n) => lerArquivo(`supabase/migrations/${n}`);
const migration = ler(NOME);
const rollback = ler(`rollback-manual-${NOME}`);

const md5 = (s) => createHash("md5").update(s).digest("hex");
const semComentarios = (s) =>
  s
    .split("\n")
    .map((l) => l.replace(/--.*$/, ""))
    .join("\n");

/** Texto da função num arquivo, do CREATE até o `$$;`. */
const funcao = (sql, nome) => {
  const marcador = `\nCREATE OR REPLACE FUNCTION public.${nome}(`;
  const i = sql.indexOf(marcador);
  assert.ok(i >= 0, `${nome} não encontrada`);
  assert.equal(sql.indexOf(marcador, i + 1), -1, `${nome} aparece 2x`);
  const resto = sql.slice(i + 1);
  return resto.slice(0, resto.indexOf("\n$$;") + "\n$$;".length);
};
/** O que o Postgres grava em prosrc: entre `AS $$` e `$$;`. */
const corpo = (texto) =>
  texto.slice(
    texto.indexOf("AS $$") + "AS $$".length,
    texto.length - "$$;".length,
  );
const cabecalho = (texto) => texto.slice(0, texto.indexOf("AS $$"));

const RE_CRIA_O_ANALYTICS =
  /^CREATE (OR REPLACE )?FUNCTION (public\.|"public"\.")get_admin_analytics_v2"?\(/gm;

const antes = corpo(funcao(ler(CATORZE), "get_admin_analytics_v2"));
const depois = funcao(migration, "get_admin_analytics_v2");
const desfeito = funcao(rollback, "get_admin_analytics_v2");

/** As QUATRO mudanças declaradas no cabeçalho (item 3), cada uma aplicada UMA vez ao corpo da 14. */
const MUDANCAS = [
  // a. DECLARE: a variável nova.
  [
    "    paid_on_cancelled bigint;\nBEGIN\n",
    "    paid_on_cancelled bigint;\n\n    -- produtos vendidos SEM custo cadastrado: ficam fora do lucro e do top 5 (20261234000000)\n    products_without_cost bigint;\nBEGIN\n",
  ],
  // b. lucro por dia: só o item cujo produto TEM custo.
  [
    "                COALESCE(SUM(oi.quantity * (oi.price - COALESCE(p.custo, 0))), 0) AS profit,\n",
    "                -- Lucro só dos itens cujo produto TEM custo (custo IS NOT NULL; custo 0 é zero medido e conta): sem custo, a venda inteira virava lucro (20261234000000).\n                COALESCE(SUM(oi.quantity * (oi.price - p.custo)) FILTER (WHERE p.custo IS NOT NULL), 0) AS profit,\n",
  ],
  // c. top 5: só produto COM custo.
  [
    "        AND p.deleted_at IS NULL\n        GROUP BY p.id, p.nome, p.imagem_url\n",
    "        AND p.deleted_at IS NULL\n        -- Só produto COM custo informado: sem custo o ranking de LUCRO empatava com a receita (20261234000000).\n        AND p.custo IS NOT NULL\n        GROUP BY p.id, p.nome, p.imagem_url\n",
  ],
  // d1. a contagem do campo novo (mesma regra de venda do top 5).
  [
    "    -- 6. Dinheiro reconhecido fora da regra de status (achados 2 e 3)\n",
    "    -- 5b. Produtos vendidos (mesma regra de venda do top 5) que ficaram FORA do lucro por não terem custo (20261234000000).\n    SELECT COUNT(DISTINCT p.id)\n    INTO products_without_cost\n    FROM public.produtos p\n    JOIN public.marketplace_order_items oi ON p.id = oi.product_id\n    JOIN public.marketplace_orders o ON oi.order_id = o.id\n    WHERE o.status NOT IN ('cancelled', 'returned')\n    AND (o.payment_status IN ('pago', 'pago_apos_expirar', 'recebido_na_entrega'))\n    AND p.deleted_at IS NULL\n    AND p.custo IS NULL;\n\n    -- 6. Dinheiro reconhecido fora da regra de status (achados 2 e 3)\n",
  ],
  // d2. a chave no JSON final.
  [
    "        'paidOnCancelled', paid_on_cancelled\n    );\n",
    "        'paidOnCancelled', paid_on_cancelled,\n        'productsWithoutCost', products_without_cost\n    );\n",
  ],
];

/** As chaves do json_build_object final, na ordem. */
const chavesDoJson = (c) => {
  const final = c.slice(c.indexOf("result := json_build_object("));
  return [...final.matchAll(/^\s*'([A-Za-z]+)',/gm)].map((m) => m[1]);
};

Deno.test("avaliarFase0 não recusa o par migration+rollback", () => {
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
});

Deno.test("nenhum arquivo do par abre ou fecha transação de nível superior", () => {
  assert.deepEqual(
    detectarTransacaoExplicita(removerRuido(migration)).achados,
    [],
  );
  assert.deepEqual(
    detectarTransacaoExplicita(removerRuido(rollback)).achados,
    [],
  );
});

Deno.test("só get_admin_analytics_v2 é redefinida, nos dois arquivos", () => {
  for (const sql of [migration, rollback]) {
    const nomes = [
      ...semComentarios(sql).matchAll(
        /^CREATE OR REPLACE FUNCTION public\.([a-z_0-9]+)\(/gm,
      ),
    ].map((m) => m[1]);
    assert.deepEqual(nomes, ["get_admin_analytics_v2"]);
  }
});

Deno.test("o ponto de partida é a ÚLTIMA definição antes desta migration (a 20261214000000), com o md5 citado nas notas", () => {
  const nomes = [...Deno.readDirSync(new URL("supabase/migrations/", DIR))]
    .filter((e) => e.isFile && /^\d{14}_.*\.sql$/.test(e.name))
    .map((e) => e.name)
    .filter((n) => n < NOME)
    .sort();
  const re = RE_CRIA_O_ANALYTICS;
  const com = nomes.filter((n) => {
    re.lastIndex = 0;
    return re.test(ler(n));
  });
  assert.equal(com.at(-1), CATORZE);
  assert.equal(md5(antes), HASH_VIGENTE);
});

Deno.test("o corpo novo é o da 20261214000000 byte a byte, com SÓ as cinco trocas declaradas (cada uma acha o alvo UMA vez)", () => {
  let esperado = antes;
  for (const [de, para] of MUDANCAS) {
    assert.equal(
      esperado.split(de).length - 1,
      1,
      `o alvo tem de aparecer 1x no corpo da 14: ${de.slice(0, 60)}`,
    );
    esperado = esperado.replace(de, para);
  }
  const c = corpo(depois);
  assert.equal(c, esperado);
  assert.equal(
    cabecalho(depois),
    cabecalho(funcao(ler(CATORZE), "get_admin_analytics_v2")),
    "assinatura, RETURNS, SECURITY DEFINER e search_path iguais (sem STABLE)",
  );
  assert.ok(!cabecalho(depois).includes("STABLE"));
  assert.ok(!c.includes("$$"), "$$ dentro do corpo");
});

Deno.test("a regra do 'tem custo' é a MESMA da 20261024/20261214 (custo IS NOT NULL; custo 0 conta) e nada usa `> 0`", () => {
  const c = corpo(depois);
  assert.ok(
    c.includes("FILTER (WHERE p.custo IS NOT NULL), 0) AS profit"),
    "o lucro por dia filtra por custo IS NOT NULL",
  );
  assert.ok(c.includes("AND p.custo IS NOT NULL\n        GROUP BY p.id"));
  assert.ok(c.includes("AND p.custo IS NULL;"));
  assert.ok(!/custo\s*(>|>=)\s*0/.test(c), "custo 0 é zero medido e conta");
  assert.ok(
    c.includes(
      "COALESCE(SUM(oi.quantity * COALESCE(p.custo, 0)), 0) AS cost_sold",
    ),
    "cost_sold não muda",
  );
  // A receita do dia continua vindo de o.total (daily_orders), sem olhar custo.
  const receita = c.slice(
    c.indexOf("daily_orders AS ("),
    c.indexOf("daily_items AS ("),
  );
  assert.ok(
    !/custo/.test(receita),
    "a receita do dia não pode depender de custo",
  );
});

Deno.test("só UMA chave nova no JSON (productsWithoutCost, no fim); nenhuma muda ou some; a guarda do admin atual e o estoque ficam", () => {
  const c = corpo(depois);
  assert.deepEqual(chavesDoJson(c), [
    ...chavesDoJson(antes),
    "productsWithoutCost",
  ]);
  for (const fica of [
    "COUNT(*) FILTER (WHERE estoque <= COALESCE(estoque_minimo, 5)),",
    "COALESCE(SUM(preco_venda * estoque) FILTER (WHERE custo IS NOT NULL), 0)",
    "INTO low_stock_count, inv_cost_total, inv_value_total",
    "'inventoryAlerts', low_stock_count,",
  ]) {
    assert.ok(c.includes(fica), fica);
  }
  assert.equal(c.split("public.is_admin_atual()").length - 1, 1);
  assert.equal(c.split("public.is_admin()").length - 1, 1);
});

Deno.test("o rollback devolve o corpo da 20261214000000 byte a byte (md5 vigente), com o mesmo cabeçalho", () => {
  assert.equal(corpo(desfeito), antes);
  assert.equal(md5(corpo(desfeito)), HASH_VIGENTE);
  assert.equal(cabecalho(desfeito), cabecalho(depois));
});

Deno.test("os preflights e as conferências citam o md5 REAL dos dois corpos e recusam com B1_BASELINE_DIVERGENT", () => {
  const novo = md5(corpo(depois));
  assert.notEqual(novo, HASH_VIGENTE);
  const preflight = migration.slice(
    0,
    migration.indexOf("END $preflight_20261234$"),
  );
  const preflightRb = rollback.slice(
    0,
    rollback.indexOf("END $preflight_rollback_20261234$"),
  );
  assert.ok(
    preflight.includes(`('${ASSINATURA}', '${HASH_VIGENTE}', '${novo}')`),
    "preflight da migration",
  );
  assert.ok(
    preflightRb.includes(`('${ASSINATURA}', '${HASH_VIGENTE}', '${novo}')`),
    "preflight do rollback",
  );
  for (const sql of [preflight, preflightRb]) {
    assert.ok(sql.includes("md5(replace(prosrc, E'\\r', ''))"));
    assert.ok(sql.includes("RAISE EXCEPTION 'B1_BASELINE_DIVERGENT:"));
    assert.ok(!/RAISE\s+(NOTICE|WARNING|INFO|LOG|DEBUG)/i.test(sql));
  }
  // A conferência final da migration aponta o corpo novo; a do rollback, o vigente.
  const conferencia = migration.slice(
    migration.indexOf("DO $conferencia_20261234$"),
  );
  assert.ok(conferencia.includes(`IS DISTINCT FROM '${novo}'`));
  const conferenciaRb = rollback.slice(
    rollback.indexOf("DO $conferencia_rollback_20261234$"),
  );
  assert.ok(conferenciaRb.includes(`IS DISTINCT FROM '${HASH_VIGENTE}'`));
  // Nenhum hash em lugar nenhum que não seja um dos dois.
  for (const sql of [migration, rollback]) {
    const hashes = new Set(
      [...sql.matchAll(/'([0-9a-f]{32})'/g)].map((m) => m[1]),
    );
    for (const h of hashes)
      assert.ok([HASH_VIGENTE, novo].includes(h), `hash estranho ${h}`);
  }
  // O hash da ficha de verificação é o do corpo novo.
  assert.ok(migration.includes(`-- esperado: ${novo}.`));
});

Deno.test("o pré-voo e a conferência olham atributos e ACL (PUBLIC/anon sem EXECUTE, authenticated com), a sobrecarga e a existência", () => {
  for (const sql of [
    migration.slice(0, migration.indexOf("END $preflight_20261234$")),
    migration.slice(migration.indexOf("DO $conferencia_20261234$")),
    rollback.slice(0, rollback.indexOf("END $preflight_rollback_20261234$")),
    rollback.slice(rollback.indexOf("DO $conferencia_rollback_20261234$")),
  ]) {
    assert.ok(
      sql.includes(
        "aclexplode(coalesce(p.proacl, acldefault('f', p.proowner)))",
      ),
    );
    assert.ok(sql.includes("has_function_privilege('anon', v_oid, 'EXECUTE')"));
    assert.ok(
      sql.includes("has_function_privilege('authenticated', v_oid, 'EXECUTE')"),
    );
    assert.ok(
      sql.includes("p.proconfig = ARRAY['search_path=public']::text[]"),
    );
    assert.ok(sql.includes("p.prosecdef"));
    assert.ok(
      sql.includes(
        "pg_get_function_arguments(p.oid) = 'p_limit_days integer DEFAULT 90'",
      ),
    );
  }
  assert.ok(migration.includes("tem sobrecarga em public"));
  assert.ok(rollback.includes("tem sobrecarga em public"));
});

Deno.test("os preflights vêm ANTES de qualquer escrita; nenhum GRANT/REVOKE/DROP/ALTER/gatilho no par", () => {
  for (const [sql, bloco] of [
    [migration, "DO $preflight_20261234$"],
    [rollback, "DO $preflight_rollback_20261234$"],
  ]) {
    const i = sql.indexOf(bloco);
    assert.ok(i >= 0 && sql.indexOf("END $preflight") > i);
    const antesDoBloco = semComentarios(sql.slice(0, i));
    for (const escrita of [
      /CREATE\s/i,
      /REVOKE\s/i,
      /GRANT\s/i,
      /ALTER\s/i,
      /DROP\s/i,
    ]) {
      assert.ok(!escrita.test(antesDoBloco), `${escrita} antes do preflight`);
    }
    const c = semComentarios(sql);
    for (const proibido of [
      /^\s*GRANT\b/im,
      /^\s*REVOKE\b/im,
      /\bDROP\s+(FUNCTION|TABLE|TRIGGER|POLICY|COLUMN)\b/i,
      /^\s*ALTER\s/im,
      /^\s*CREATE\s+TRIGGER\b/im,
      /^\s*(INSERT|UPDATE|DELETE|TRUNCATE)\b/im,
    ]) {
      assert.ok(!proibido.test(c), `${proibido} no arquivo`);
    }
  }
});

Deno.test("os cabeçalhos dizem a ordem do rollback (ANTES do da 20261214000000) e apontam a prova viva e o portão", () => {
  assert.match(migration, /ANTES do rollback da 20261214000000/);
  assert.match(rollback, /ANTES do rollback da 20261214000000/);
  assert.ok(migration.includes("tests/banco/lucro-so-com-custo-viva.cjs"));
  assert.ok(migration.includes("consultas 35a e 35b"));
  assert.ok(migration.includes(`rollback-manual-${NOME}`));
  // A decisão que ela cumpre e a definição de "tem custo" estão escritas.
  assert.ok(migration.includes("custo ausente NÃO pode virar margem 100%"));
  assert.ok(migration.includes("`produtos.custo IS NOT NULL`"));
});

Deno.test("as consultas 35a/35b e as listas dos lotes anteriores citam os md5 REAIS dos dois corpos", () => {
  const md5Depois = md5(depois_corpoCompleto());
  const c35a = lerArquivo(
    "scripts/publicacao/consultas/35a-conferir-lucro-so-com-custo-aplicado.sql",
  );
  const c35b = lerArquivo(
    "scripts/publicacao/consultas/35b-antes-lucro-so-com-custo-corpo-vigente.sql",
  );
  assert.ok(
    c35a.includes(md5Depois),
    "35a tem de citar o md5 do corpo desta migration",
  );
  assert.ok(!c35a.includes(HASH_VIGENTE), "35a não cita o corpo antigo");
  assert.ok(
    c35b.includes(HASH_VIGENTE),
    "35b tem de citar o md5 do corpo da 20261214000000",
  );
  assert.ok(!c35b.includes(md5Depois), "35b não cita o corpo novo");
  // a 8e (rol de sucessoras) e a 17a aceitam o corpo novo como sucessor do analytics
  const c8e = lerArquivo(
    "scripts/publicacao/consultas/8e-conferir-92-a-202-aplicado.sql",
  );
  assert.ok(
    c8e.includes(
      `('get_admin_analytics_v2', '${md5Depois}', '20261234000000')`,
    ),
    "a 8e tem de aceitar o corpo novo como sucessora",
  );
  assert.ok(
    c8e.includes(HASH_VIGENTE),
    "a 8e continua aceitando o corpo da 20261214000000 (elo anterior da cadeia)",
  );
});

function depois_corpoCompleto() {
  // md5 sobre o prosrc: o texto ENTRE os $$ do CREATE OR REPLACE, sem CR
  const m = /AS \$\$([\s\S]*?)\$\$;/.exec(
    migration.slice(migration.indexOf("CREATE OR REPLACE FUNCTION")),
  );
  assert.ok(m, "corpo entre $$");
  return m[1].replace(/\r/g, "");
}
