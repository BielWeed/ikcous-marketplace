// @ts-nocheck
// Texto do par 20261249; comportamento, papéis reais e mutantes em
// tests/banco/pdv-motivo-privado-viva.cjs. Não substitui a prova PG17.
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { createHash } = require("node:crypto");
const {
  detectarTransacaoExplicita,
  removerRuido,
} = require("../scripts/db-prove-rollback.cjs");
const NOME =
  "20261249000000_o_motivo_do_desconto_do_balcao_nao_chega_a_cliente.sql";
const BASE =
  "20261235000000_a_venda_repetida_do_balcao_devolve_a_venda_feita.sql";
const ler = (n) =>
  Deno.readTextFileSync(
    new URL(`../supabase/migrations/${n}`, import.meta.url),
  ).replace(/\r/g, "");
const migration = ler(NOME);
const rollback = ler(`rollback-manual-${NOME}`);
const md5 = (s) => createHash("md5").update(s).digest("hex");
const funcao = (sql) => {
  const blocos = [
    ...sql.matchAll(
      /^CREATE OR REPLACE FUNCTION public\.registrar_venda_presencial\([\s\S]*?\n\$\$;/gm,
    ),
  ];
  assert.equal(blocos.length, 1);
  return blocos[0][0];
};
const corpo = (sql) => {
  const f = funcao(sql);
  return f.slice(f.indexOf("AS $$") + 5, -3);
};
const antiga = funcao(ler(BASE));
const nova = funcao(migration);
const HASH_BASE = "996caf02505ac16a8bded73bcf8900aa";
const HASH_NOVO = md5(corpo(migration));
const tirarComentarios = (s) =>
  s
    .split("\n")
    .filter((l) => !l.trim().startsWith("--"))
    .join("\n");
const blocosDo = (s) =>
  [...s.matchAll(/DO \$(\w+)\$([\s\S]*?)END \$\1\$;/g)].map((m) => m[2]);

Deno.test("249: corpo novo = corpo vivo da 235 + SOMENTE as cinco mudanças declaradas", () => {
  assert.equal(md5(corpo(ler(BASE))), HASH_BASE);
  const trocas = [
    [
      "    v_customer_name text;",
      "    v_customer_name text;\n    v_motivo text;",
    ],
    [
      "        -- D4: desconto no balcão SEM motivo escrito é dinheiro que some sem\n        -- rastro. O motivo vira `notes` do pedido, que o painel já mostra.\n        IF v_desconto > 0 AND NULLIF(btrim(COALESCE(p_observacao,'')),'') IS NULL THEN",
      "        -- D4: desconto no balcão SEM motivo escrito é dinheiro que some sem\n        -- rastro. O motivo fica na anotação privada, só para a loja.\n        IF p_observacao ~ '[^[:space:]]' THEN\n            v_motivo := btrim(p_observacao);\n        ELSE\n            v_motivo := NULL;\n        END IF;\n        IF v_desconto > 0 AND v_motivo IS NULL THEN",
    ],
    [
      "            RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='Informe o motivo do desconto.';\n        END IF;",
      "            RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='Informe o motivo do desconto.';\n        END IF;\n        IF v_motivo IS NOT NULL AND length(v_motivo) > 2000 THEN\n            RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='O motivo do desconto pode ter até 2000 caracteres.';\n        END IF;",
    ],
    [
      "                NULLIF(btrim(COALESCE(p_observacao,'')),''),",
      "                NULL,",
    ],
    [
      "            ) RETURNING id INTO v_order_id;",
      "            ) RETURNING id INTO v_order_id;\n\n            IF v_motivo IS NOT NULL THEN\n                INSERT INTO public.marketplace_order_internal_notes (order_id, note)\n                VALUES (v_order_id, v_motivo);\n            END IF;",
    ],
  ];
  let esperado = antiga;
  for (const [antes, depois] of trocas) {
    assert.equal(
      esperado.split(antes).length - 1,
      1,
      `âncora não é única: ${antes}`,
    );
    esperado = esperado.replace(antes, () => depois);
  }
  // A igualdade cobre assinatura, comentários, espaços, retorno, históricos e estoque.
  assert.equal(nova, esperado);
  assert.equal(
    funcao(rollback),
    antiga,
    "rollback deve devolver a 235 byte a byte",
  );
});

Deno.test("249: base é a última definição anterior; sem redefinição intermediária ignorada", () => {
  const anteriores = [
    ...Deno.readDirSync(new URL("../supabase/migrations/", import.meta.url)),
  ]
    .filter((e) => e.isFile && /^\d{14}_.*\.sql$/.test(e.name) && e.name < NOME)
    .map((e) => e.name)
    .sort()
    .filter((n) =>
      /^CREATE (OR REPLACE )?FUNCTION (public\.|"public"\.")registrar_venda_presencial"?\(/m.test(
        ler(n),
      ),
    );
  assert.equal(anteriores.at(-1), BASE);
});

Deno.test("249: hashes reais obrigatórios; placeholder impede promoção", () => {
  for (const s of [migration, rollback]) {
    assert(
      !s.includes("__HASH_DESTA_A_PREENCHER__"),
      "orquestrador deve medir o md5 real no Postgres e substituir o placeholder",
    );
    const [pre, fim] = blocosDo(s);
    assert(pre.includes(`'${HASH_BASE}', '${HASH_NOVO}'`));
    assert(
      fim.includes(
        `IS DISTINCT FROM '${s === migration ? HASH_NOVO : HASH_BASE}'`,
      ),
    );
  }
  assert.notEqual(HASH_NOVO, HASH_BASE);
});

Deno.test("249: aditiva, uma função, pré-voo antes da escrita e sem transação de nível superior", () => {
  for (const s of [migration, rollback]) {
    assert.deepEqual(detectarTransacaoExplicita(removerRuido(s)).achados, []);
    assert.equal(
      (tirarComentarios(s).match(/^CREATE OR REPLACE FUNCTION /gm) || [])
        .length,
      1,
    );
    const semFuncao = tirarComentarios(s.replace(funcao(s), ""));
    assert(
      !/^\s*(INSERT|UPDATE|DELETE|TRUNCATE|ALTER|DROP|GRANT|REVOKE|COMMENT|CREATE)\b/im.test(
        semFuncao,
      ),
    );
    assert(
      s.indexOf("END $preflight_") < s.indexOf("\nCREATE OR REPLACE FUNCTION"),
    );
    assert(s.lastIndexOf("DO $conferencia_") > s.indexOf("\n$$;"));
    assert.equal(blocosDo(s).length, 2);
  }
});

Deno.test("249: pré-voo e conferência preservam atributos, ACL fechada, sobrecarga e índice", () => {
  for (const s of [migration, rollback]) {
    for (const b of blocosDo(s)) {
      for (const trecho of [
        "l.lanname = 'plpgsql'",
        "p.prosecdef",
        "p.provolatile = 'v'",
        "NOT p.proisstrict",
        "NOT p.proretset",
        "p.proconfig = ARRAY['search_path=pg_catalog, pg_temp']::text[]",
        "pg_get_function_result(p.oid) = 'jsonb'",
        "p.pronargs = 8",
        "has_function_privilege('authenticated', v_oid, 'EXECUTE')",
        "has_function_privilege('anon', v_oid, 'EXECUTE')",
        "has_function_privilege('service_role', v_oid, 'EXECUTE')",
        "g.grantee = 0",
        "g.grantee <> p.proowner",
        "g.is_grantable",
        "p.proname = 'registrar_venda_presencial'",
        "marketplace_orders_chave_da_compra_unica",
        "i.indisunique AND i.indisvalid",
      ])
        assert(b.includes(trecho), trecho);
      assert(b.includes("B1_BASELINE_DIVERGENT") || b.includes("conferencia"));
    }
  }
});

Deno.test("249: tabela privada operacional nos dois estados; expressões da conferência da 247 preservadas", () => {
  const referencia = blocosDo(
    ler("20261247000000_a_nota_interna_do_pedido_nao_chega_a_cliente.sql"),
  )[1];
  const inicio = referencia.indexOf(
    "    IF NOT COALESCE((SELECT relkind = 'r' FROM pg_class WHERE oid = v_t)",
  );
  const fim = referencia.indexOf("    END IF;", inicio) + "    END IF;".length;
  const tabela = referencia.slice(inicio, fim);
  assert(inicio > 0 && fim > inicio);
  for (const b of blocosDo(migration)) {
    assert(
      b.includes(tabela),
      "forma, CHECK, defaults, gatilho, RLS, política, ACL e publicação devem usar as expressões já provadas da 247",
    );
    assert(b.includes("IF v_t IS NULL THEN"), "não aceita tabela ausente");
    assert(
      b.includes(
        "IF to_regprocedure('public.carimba_nota_interna_do_pedido()') IS NULL OR NOT COALESCE",
      ),
      "não aceita helper ausente",
    );
    assert(
      !b.includes("OR (NOT EXISTS (SELECT 1 FROM pg_policy"),
      "estado fechado do rollback da 247 não é operacional",
    );
  }
});

Deno.test("249: limites e provas são declarados, sem apagar notas antigas nem privadas", () => {
  assert(
    migration.includes("motivos antigos") &&
      migration.includes("continuam em notes"),
  );
  assert(migration.includes("painel/front antigos continuam funcionando"));
  assert(migration.includes("tests/banco/pdv-motivo-privado-viva.cjs"));
  assert(rollback.includes("COM ELE VOLTA O DEFEITO"));
  assert(rollback.includes("notas privadas já gravadas ficam"));
});
