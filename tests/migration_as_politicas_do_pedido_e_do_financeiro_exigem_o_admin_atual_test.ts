// @ts-nocheck
/* eslint-disable security/detect-object-injection, security/detect-non-literal-regexp, security/detect-unsafe-regex --
 * Toda chave indexada e todo RegExp montado aqui vêm de constante do próprio
 * teste (POLITICAS) ou do texto das migrations do repositório; nunca de
 * entrada de rede nem de payload de terceiro. */
// AS POLÍTICAS DE RLS DO PEDIDO, DA DEVOLUÇÃO E DO FINANCEIRO EXIGEM O ADMIN DE
// AGORA — prova offline do par 20261202000000 + rollback (04/10/2026). O
// COMPORTAMENTO (ex-admin com JWT velho lê 0 e não escreve nas 14 políticas;
// controle na política antiga; admin, dono e terceiro; rollback e preflights) é
// provado em tests/banco/admin-atual-rls-viva.cjs, no rpc-ci; aqui fica o que
// se prova só lendo o texto, no `npm run test:unit`.
//
// Cada asserção está amarrada a um risco: política trocada que não é a vigente
// apaga em silêncio a correção de outra migration; ramo do dono que muda
// esconde do cliente o que é dele (ou mostra a um terceiro); GRANT/REVOKE/DROP/
// CREATE escondido muda ACL ou papel; hash de preflight que não é o md5 real
// recusa num banco correto (ou aceita corpo errado); rollback que não devolve
// só a porta deixa a regra presa depois de "revertida".
import { createRequire } from "node:module";
import { fromFileUrl } from "https://deno.land/std@0.177.0/path/mod.ts";
import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.177.0/testing/asserts.ts";

const require = createRequire(import.meta.url);
const {
  avaliarFase0,
  detectarTransacaoExplicita,
  removerRuido,
} = require("../scripts/db-prove-rollback.cjs");
const { createHash } = require("node:crypto");

const DIR = fromFileUrl(new URL(".", import.meta.url));
const NOME =
  "20261202000000_as_politicas_do_pedido_e_do_financeiro_exigem_o_admin_atual.sql";

const lerArquivo = (rel) =>
  Deno.readTextFileSync(`${DIR}../${rel}`).replace(/\r\n/g, "\n");
const ler = (n) => lerArquivo(`supabase/migrations/${n}`);
const migration = ler(NOME);
const rollback = ler(`rollback-manual-${NOME}`);

const md5 = (s) => createHash("md5").update(s).digest("hex");
const semComentarios = (s) =>
  s
    .split("\n")
    .map((l) => l.replace(/--.*$/, ""))
    .join("\n");

// As 14 políticas: [tabela, nome, comando, papéis, migration que a definiu por último].
const POLITICAS = [
  [
    "marketplace_order_items",
    "order_items_all_policy",
    "*",
    "authenticated",
    "20260806000000_baseline_do_schema_vivo.sql",
  ],
  [
    "marketplace_order_history",
    "order_history_all_policy",
    "*",
    "authenticated",
    "20260806000000_baseline_do_schema_vivo.sql",
  ],
  [
    "order_shipping_events",
    "order_shipping_events_select_policy",
    "r",
    "authenticated",
    "20261080000000_a_etiqueta_do_envio_nasce_da_api.sql",
  ],
  [
    "order_shipping_events",
    "order_shipping_events_admin_insert_policy",
    "a",
    "authenticated",
    "20261080000000_a_etiqueta_do_envio_nasce_da_api.sql",
  ],
  [
    "order_shipping_events",
    "order_shipping_events_admin_update_policy",
    "w",
    "authenticated",
    "20261080000000_a_etiqueta_do_envio_nasce_da_api.sql",
  ],
  [
    "order_shipping_events",
    "order_shipping_events_admin_delete_policy",
    "d",
    "authenticated",
    "20261080000000_a_etiqueta_do_envio_nasce_da_api.sql",
  ],
  [
    "marketplace_order_payment_history",
    "mkt_order_payment_history_select",
    "r",
    "public",
    "20261020000000_lojista_registra_pagamento_recebido.sql",
  ],
  [
    "devolucoes",
    "devolucoes_dono_ou_admin_select_policy",
    "r",
    "authenticated",
    "20261175000000_a_devolucao_nasce_no_pedido.sql",
  ],
  [
    "devolucao_itens",
    "devolucao_itens_dono_ou_admin_select_policy",
    "r",
    "authenticated",
    "20261175000000_a_devolucao_nasce_no_pedido.sql",
  ],
  [
    "devolucao_eventos",
    "devolucao_eventos_dono_ou_admin_select_policy",
    "r",
    "authenticated",
    "20261175000000_a_devolucao_nasce_no_pedido.sql",
  ],
  [
    "fin_contas",
    "fin_contas_admin_select_policy",
    "r",
    "authenticated",
    "20261177000000_o_financeiro_da_loja_nasce.sql",
  ],
  [
    "fin_categorias",
    "fin_categorias_admin_select_policy",
    "r",
    "authenticated",
    "20261177000000_o_financeiro_da_loja_nasce.sql",
  ],
  [
    "fin_caixa_sessoes",
    "fin_caixa_sessoes_admin_select_policy",
    "r",
    "authenticated",
    "20261177000000_o_financeiro_da_loja_nasce.sql",
  ],
  [
    "fin_lancamentos",
    "fin_lancamentos_admin_select_policy",
    "r",
    "authenticated",
    "20261177000000_o_financeiro_da_loja_nasce.sql",
  ],
];

const VELHO = "(SELECT public.is_admin())";
const NOVO = "(SELECT public.rls_admin_atual())";

/** Os `ALTER POLICY nome ON tabela ...;` de um arquivo (texto sem comentários). */
const alteres = (sql) => {
  const out = {};
  for (const m of semComentarios(sql).matchAll(
    /ALTER POLICY (\w+) ON (public\.\w+)\n([\s\S]*?);\n/g,
  )) {
    assert(!out[m[1]], `${m[1]} alterada 2x`);
    out[m[1]] = { tabela: m[2], corpo: m[3] };
  }
  return out;
};
const novos = alteres(migration);
const velhos = alteres(rollback);

Deno.test("avaliarFase0 não recusa o par migration+rollback", () => {
  const res = avaliarFase0({
    sqlMigration: migration,
    sqlRollback: rollback,
    temRollback: true,
  });
  assertEquals(
    res.recusado,
    false,
    `motivos: ${(res.motivos || []).join("; ")}`,
  );
});

Deno.test("nenhum arquivo do par abre ou fecha transação de nível superior", () => {
  assertEquals(detectarTransacaoExplicita(removerRuido(migration)).achados, []);
  assertEquals(detectarTransacaoExplicita(removerRuido(rollback)).achados, []);
});

Deno.test("as 14 políticas (e só elas) são alteradas, nos dois arquivos, cada uma na sua tabela", () => {
  const esperado = POLITICAS.map(([, n]) => n).sort();
  assertEquals(Object.keys(novos).sort(), esperado);
  assertEquals(Object.keys(velhos).sort(), esperado);
  for (const [tabela, nome] of POLITICAS) {
    assertEquals(novos[nome].tabela, `public.${tabela}`, nome);
    assertEquals(velhos[nome].tabela, `public.${tabela}`, nome);
  }
});

Deno.test("só `ALTER POLICY`: nenhum GRANT/REVOKE/DROP/CREATE/ALTER TABLE/função/gatilho no par", () => {
  for (const sql of [migration, rollback]) {
    const c = semComentarios(sql);
    // Fora do bloco DO do preflight, só ALTER POLICY.
    const fora = c.replace(
      /DO \$preflight[\s\S]*?END \$preflight[a-z_0-9]*\$;/,
      "",
    );
    const comandos = [...fora.matchAll(/^\s*([A-Z]+(?: [A-Z]+)?)\b/gm)].map(
      (m) => m[1],
    );
    for (const k of comandos) {
      assert(
        ["ALTER POLICY", "USING", "WITH CHECK", "SELECT", "OR", "AND"].some(
          (p) => k.startsWith(p),
        ) || /^(WHERE|FROM)\b/.test(k),
        `comando inesperado fora do preflight: ${k}`,
      );
    }
    for (const proibido of [
      /\bGRANT\b/i,
      /\bREVOKE\b/i,
      /\bDROP\s/i,
      /\bCREATE\s/i,
      /\bALTER\s+(TABLE|FUNCTION|ROLE|DEFAULT)/i,
      /\bENABLE ROW LEVEL SECURITY\b/i,
      /\bDISABLE ROW LEVEL SECURITY\b/i,
    ]) {
      assert(!proibido.test(c), `${proibido} no arquivo`);
    }
    // Nenhum ALTER POLICY troca papel (TO ...) nem renomeia.
    assert(
      !/ALTER POLICY[^;]*\bTO\b/.test(c),
      "ALTER POLICY ... TO muda o papel",
    );
    assert(!/RENAME TO/i.test(c), "RENAME");
  }
});

Deno.test("cada política: SÓ a porta de admin troca — o resto da expressão (ramo do dono) é byte a byte o do rollback", () => {
  for (const [, nome] of POLITICAS) {
    const n = novos[nome].corpo;
    const v = velhos[nome].corpo;
    const portaVelha =
      nome === "mkt_order_payment_history_select" ? "public.is_admin()" : VELHO;
    assert(
      !/is_admin\(\)/.test(n),
      `${nome}: a migration ainda usa is_admin()`,
    );
    assert(
      !/rls_admin_atual/.test(v),
      `${nome}: o rollback ficou com a porta nova`,
    );
    // Mesma cláusula USING e/ou WITH CHECK nos dois lados (mesmo número de portas).
    const porNova = n.split(NOVO).length - 1;
    const porVelha = v.split(portaVelha).length - 1;
    assert(
      porNova >= 1 && porNova === porVelha,
      `${nome}: ${porNova} portas novas x ${porVelha} velhas`,
    );
    assertEquals(n.split(NOVO).join(portaVelha), v, nome);
  }
});

Deno.test("as políticas de escrita mantêm USING/WITH CHECK como antes (ALL: os dois; insert: só CHECK; update: os dois; delete e selects: só USING)", () => {
  const forma = {
    "*": ["USING", "WITH CHECK"],
    a: ["WITH CHECK"],
    w: ["USING", "WITH CHECK"],
    d: ["USING"],
    r: ["USING"],
  };
  for (const [, nome, cmd] of POLITICAS) {
    const c = novos[nome].corpo;
    const tem = ["USING", "WITH CHECK"].filter((k) =>
      new RegExp(`^  ${k} \\(`, "m").test(c),
    );
    assertEquals(tem, forma[cmd], `${nome} (${cmd})`);
  }
});

Deno.test("o ponto de partida de cada política é a ÚLTIMA definição dela antes desta migration (nenhuma outra a redefine)", () => {
  const nomes = [...Deno.readDirSync(`${DIR}../supabase/migrations`)]
    .filter((e) => e.isFile && /^\d+_.*\.sql$/.test(e.name))
    .map((e) => e.name)
    .filter((n) => n < NOME)
    .sort();
  for (const [tabela, nome, , , fonte] of POLITICAS) {
    const re = new RegExp(
      `(CREATE|ALTER|DROP) POLICY (IF EXISTS )?"?${nome}"?\\s+ON (public\\.)?"?${tabela}"?\\b`,
    );
    const com = nomes.filter((n) => re.test(semComentarios(ler(n))));
    assertEquals(com.at(-1), fonte, nome);
  }
});

Deno.test("os preflights listam as mesmas 14 políticas, com comando e papel, e o hash REAL das portas da 97", () => {
  const preflight = migration.slice(
    0,
    migration.indexOf("END $preflight_20261202$"),
  );
  const preflightRb = rollback.slice(
    0,
    rollback.indexOf("END $preflight_rollback_20261202$"),
  );
  for (const [tabela, nome, cmd, papeis] of POLITICAS) {
    for (const sql of [preflight, preflightRb]) {
      assertStringIncludes(
        sql,
        `('public.${tabela}', '${nome}', '${cmd}', '${papeis}',`,
      );
    }
  }
  // As portas: o md5 do corpo que a 97 cria.
  const da97 = ler("20261197000000_dinheiro_exige_admin_atual.sql");
  const corpoDe = (nome) => {
    const i = da97.indexOf(`\nCREATE OR REPLACE FUNCTION public.${nome}()`);
    assert(i >= 0, nome);
    const resto = da97.slice(i + 1);
    const f = resto.slice(0, resto.indexOf("\n$$;") + "\n$$;".length);
    return f.slice(
      f.indexOf("AS $$") + "AS $$".length,
      f.length - "$$;".length,
    );
  };
  for (const [fn, sql] of [
    ["is_admin_atual", preflight],
    ["is_admin_atual", preflightRb],
    ["rls_admin_atual", preflight],
    ["rls_admin_atual", preflightRb],
  ]) {
    assertStringIncludes(sql, `('public.${fn}()', '${md5(corpoDe(fn))}')`);
  }
  for (const sql of [preflight, preflightRb]) {
    assertStringIncludes(sql, "md5(replace(prosrc, E'\\r', ''))");
    assertStringIncludes(sql, "RAISE EXCEPTION 'B1_BASELINE_DIVERGENT:");
    assertStringIncludes(sql, "pg_get_expr(p.polqual, p.polrelid)");
    assertStringIncludes(sql, "pg_get_expr(p.polwithcheck, p.polrelid)");
    assertStringIncludes(sql, "set_config('search_path', 'pg_catalog', true)");
    assert(
      !/RAISE\s+(NOTICE|WARNING|INFO|LOG|DEBUG)/i.test(sql),
      "preflight que só avisa não recusa",
    );
  }
});

Deno.test("as expressões 'desta' do preflight são as 'vigentes' com SÓ a porta trocada (nenhuma outra letra do ramo do dono muda)", () => {
  const preflight = migration.slice(
    migration.indexOf("FROM (VALUES"),
    migration.indexOf("END $preflight_20261202$"),
  );
  const linhas = [
    ...preflight.matchAll(
      /\('public\.(\w+)', '(\w+)', '(.)', '(\w+)',\n\s+(E'[^']*'|NULL::text), (E'[^']*'|NULL::text),\n\s+(E'[^']*'|NULL::text), (E'[^']*'|NULL::text)\)/g,
    ),
  ];
  assertEquals(linhas.length, 14);
  const D_VELHA = "( SELECT public.is_admin() AS is_admin)";
  const D_NOVA = "( SELECT public.rls_admin_atual() AS rls_admin_atual)";
  for (const [, , nome, , , qv, cv, qn, cn] of linhas) {
    const troca = (s) =>
      s === "NULL::text"
        ? s
        : nome === "mkt_order_payment_history_select"
          ? s.replace("E'public.is_admin()'", `E'${D_NOVA}'`)
          : s.split(D_VELHA).join(D_NOVA);
    assertEquals(troca(qv), qn, `${nome}: USING`);
    assertEquals(troca(cv), cn, `${nome}: WITH CHECK`);
    // `is_admin()` some do lado novo; o lado velho sempre o tem.
    assert(qv !== "NULL::text" || cv !== "NULL::text");
    assert(!/is_admin\(\)/.test(qn + cn), `${nome}: lado novo com is_admin()`);
  }
});

Deno.test("os preflights vêm ANTES de qualquer escrita", () => {
  for (const [sql, bloco] of [
    [migration, "DO $preflight_20261202$"],
    [rollback, "DO $preflight_rollback_20261202$"],
  ]) {
    const i = sql.indexOf(bloco);
    assert(i >= 0 && sql.indexOf("END $preflight") > i);
    const antesDoBloco = semComentarios(sql.slice(0, i));
    for (const escrita of [
      /CREATE\s/i,
      /REVOKE\s/i,
      /GRANT\s/i,
      /ALTER\s/i,
      /DROP\s/i,
    ]) {
      assert(!escrita.test(antesDoBloco), `${escrita} antes do preflight`);
    }
    // Todo ALTER POLICY vem depois do preflight.
    assert(sql.indexOf("ALTER POLICY", sql.indexOf("END $preflight")) > 0);
    assertEquals(
      semComentarios(sql.slice(0, sql.indexOf("END $preflight"))).includes(
        "ALTER POLICY",
      ),
      false,
    );
  }
});

Deno.test("o cabeçalho declara o que acontece com os dados existentes, a ordem do rollback e o caso do anon", () => {
  assertStringIncludes(
    migration,
    "DADOS EXISTENTES: nenhuma linha é lida ou reescrita",
  );
  assertStringIncludes(migration, "IDEMPOTÊNCIA:");
  assertStringIncludes(migration, "ORDEM: depois da 20261197000000");
  assertStringIncludes(migration, "O ANON em mkt_order_payment_history_select");
});

Deno.test("a prova viva roda no rpc-ci, no job do dinheiro", () => {
  const ci = lerArquivo(".github/workflows/rpc-ci.yml");
  assertStringIncludes(
    ci,
    "node tests/banco/rodar-isolado.cjs tests/banco/admin-atual-rls-viva.cjs",
  );
});
