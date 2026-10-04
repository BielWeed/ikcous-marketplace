// @ts-nocheck
// AS PORTAS DO PAINEL EXIGEM O ADMIN DE AGORA — prova offline do par
// 20261199000000 + rollback (permissão + dado de cliente + dinheiro,
// 04/10/2026). O COMPORTAMENTO (autopromoção barrada; ex-admin com JWT velho
// recusado nas 39 RPCs do painel; admin, dono, service_role e postgres como
// antes; controles sem a correção; rollback e preflights) é provado em
// tests/banco/admin-atual-portas-viva.cjs, no rpc-ci; aqui fica o que se
// prova só lendo o texto, no `npm run test:unit`.
//
// Cada asserção está amarrada a um risco: corpo que não é o vigente + a
// guarda apaga em silêncio a correção de outra migration; guarda com outra
// mensagem/SQLSTATE muda o que o painel mostra; guarda depois de trava ou
// escrita grava pela metade ou espera lock à toa; guarda que tira o atalho do
// DONO esconde do cliente a própria devolução; rollback que não volta byte a
// byte deixa a regra presa depois de "revertida"; hash de preflight que não é
// o md5 real recusa num banco correto (ou aceita corpo errado); GRANT/REVOKE
// ou DROP escondido muda ACL; e função de outra frente redefinida aqui apaga
// o trabalho dela.
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
const NOME = "20261199000000_portas_do_painel_exigem_admin_atual.sql";

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

/** Texto da função num arquivo desta migration, do CREATE até o `$$;`. */
const funcao = (sql, nome) => {
  const marcador = `\nCREATE OR REPLACE FUNCTION public.${nome}(`;
  const i = sql.indexOf(marcador);
  assert(i >= 0, `${nome} não encontrada`);
  assertEquals(sql.indexOf(marcador, i + 1), -1, `${nome} aparece 2x`);
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

const reCriacao = (nome) =>
  new RegExp(
    `^CREATE (OR REPLACE )?FUNCTION (public\\.|"public"\\.")${nome}"?\\(`,
    "gm",
  );

/** O corpo (prosrc) da ÚLTIMA definição da função num arquivo de migration. */
const corpoNaFonte = (arquivo, nome) => {
  const t = ler(arquivo);
  const re = reCriacao(nome);
  let m;
  let ultimo = -1;
  while ((m = re.exec(t))) ultimo = m.index;
  assert(ultimo >= 0, `${nome} não está em ${arquivo}`);
  const resto = t.slice(ultimo);
  const tag = /\bAS\s+(\$[A-Za-z0-9_]*\$)/.exec(resto);
  const ini = tag.index + tag[0].length;
  return resto.slice(ini, resto.indexOf(tag[1], ini));
};

const COMENTARIO =
  "-- Papel ATUAL (auth.users E profiles), não o do JWT: admin rebaixado para aqui (20261199000000).";

// As 39 RPCs do painel e de onde vem o corpo vigente de cada uma.
const RPCS = [
  [
    "get_admin_orders_paged",
    "20261163000000_a_lista_de_pedidos_filtra_por_canal.sql",
  ],
  [
    "get_admin_orders_cancelados_recentes",
    "20261175000000_a_devolucao_nasce_no_pedido.sql",
  ],
  ["get_admin_user_detail", "20260806000000_baseline_do_schema_vivo.sql"],
  [
    "get_admin_customers_paged",
    "20261021000000_receita_conta_so_dinheiro_que_entrou.sql",
  ],
  ["crm_clientes", "20261183000000_o_crm_ve_todo_mundo.sql"],
  ["admin_devolucoes_listar", "20261175000000_a_devolucao_nasce_no_pedido.sql"],
  ["devolucao_detalhe", "20261175000000_a_devolucao_nasce_no_pedido.sql"],
  ["devolucao_elegibilidade", "20261175000000_a_devolucao_nasce_no_pedido.sql"],
  ["devolucoes_do_pedido", "20261175000000_a_devolucao_nasce_no_pedido.sql"],
  [
    "get_segmented_push_targets",
    "20261021000000_receita_conta_so_dinheiro_que_entrou.sql",
  ],
  ["crm_visao", "20261183000000_o_crm_ve_todo_mundo.sql"],
  ["painel_inicio", "20261178000000_o_crm_e_o_inicio_leem_a_loja.sql"],
  [
    "get_admin_analytics_v2",
    "20261062000000_o_hoje_do_painel_e_o_dia_do_lojista.sql",
  ],
  [
    "get_category_analytics",
    "20261063000000_o_donut_soma_o_dinheiro_do_kpi.sql",
  ],
  ["get_coupon_stats", "20260806000000_baseline_do_schema_vivo.sql"],
  ["get_retention_rate", "20260806000000_baseline_do_schema_vivo.sql"],
  [
    "get_segmented_push_count",
    "20261023000000_push_conta_sem_baixar_credencial.sql",
  ],
  ["fin_contas_listar", "20261177000000_o_financeiro_da_loja_nasce.sql"],
  ["fin_categorias_listar", "20261177000000_o_financeiro_da_loja_nasce.sql"],
  ["fin_extrato", "20261177000000_o_financeiro_da_loja_nasce.sql"],
  ["fin_previstos", "20261177000000_o_financeiro_da_loja_nasce.sql"],
  ["fin_resumo", "20261177000000_o_financeiro_da_loja_nasce.sql"],
  ["fin_dre", "20261177000000_o_financeiro_da_loja_nasce.sql"],
  ["fin_caixa_atual", "20261177000000_o_financeiro_da_loja_nasce.sql"],
  ["fin_caixa_historico", "20261177000000_o_financeiro_da_loja_nasce.sql"],
  [
    "confirmar_retorno_do_produto",
    "20260970000000_cancelamento_respeita_o_envio.sql",
  ],
  [
    "registrar_venda_presencial",
    "20261162000000_a_venda_no_balcao_nasce_inteira.sql",
  ],
  ["fin_caixa_abrir", "20261177000000_o_financeiro_da_loja_nasce.sql"],
  ["fin_caixa_movimentar", "20261177000000_o_financeiro_da_loja_nasce.sql"],
  ["fin_caixa_fechar", "20261177000000_o_financeiro_da_loja_nasce.sql"],
  ["fin_lancamento_salvar", "20261177000000_o_financeiro_da_loja_nasce.sql"],
  ["fin_lancamento_baixar", "20261177000000_o_financeiro_da_loja_nasce.sql"],
  ["fin_lancamento_cancelar", "20261177000000_o_financeiro_da_loja_nasce.sql"],
  ["fin_conta_salvar", "20261177000000_o_financeiro_da_loja_nasce.sql"],
  ["fin_categoria_salvar", "20261177000000_o_financeiro_da_loja_nasce.sql"],
  [
    "salvar_config_pagamento_cartao",
    "20261176000000_o_cartao_online_nasce.sql",
  ],
  [
    "salvar_politica_de_devolucao",
    "20261175000000_a_devolucao_nasce_no_pedido.sql",
  ],
  ["upsert_store_config", "20261174000000_formas_de_pagamento_por_loja.sql"],
  [
    "save_store_identity",
    "20261122000000_gravacao_concorrente_da_identidade.sql",
  ],
];
// As três dos gatilhos de papel em profiles (todas da baseline).
const PAPEL = [
  "handle_profile_role_sync_to_auth",
  "ensure_role_protection",
  "prevent_role_change",
];
const BASELINE = "20260806000000_baseline_do_schema_vivo.sql";
const TODAS = [...PAPEL.map((n) => [n, BASELINE]), ...RPCS];

/** A regra da guarda: copia o bloco do is_admin() com is_admin_atual(), logo depois dele. */
const comGuarda = (nome, src) => {
  const alvo = "public.is_admin()";
  assertEquals(
    src.split(alvo).length - 1,
    1,
    `${nome}: is_admin() tem de aparecer uma vez`,
  );
  const i = src.indexOf(alvo);
  const iniLinha = src.lastIndexOf("\n", i) + 1;
  const s = /^[ \t]*/.exec(src.slice(iniLinha))[0];
  const fecho = `\n${s}END IF;\n`;
  const fim = src.indexOf(fecho, i) + fecho.length;
  const bloco = src.slice(iniLinha, fim);
  assert(/^[ \t]*IF /.test(bloco), `${nome}: o is_admin() não abre um IF`);
  const guarda = bloco.replace(alvo, "public.is_admin_atual()");
  return `${src.slice(0, fim)}${s}${COMENTARIO}\n${guarda}${src.slice(fim)}`;
};

const antes = {};
const depois = {};
const desfeito = {};
for (const [nome, fonte] of TODAS) {
  antes[nome] = corpoNaFonte(fonte, nome);
  depois[nome] = funcao(migration, nome);
  desfeito[nome] = funcao(rollback, nome);
}

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

Deno.test("as 42 funções (e só elas) são redefinidas, nos dois arquivos", () => {
  for (const sql of [migration, rollback]) {
    const nomes = [
      ...semComentarios(sql).matchAll(
        /^CREATE OR REPLACE FUNCTION public\.([a-z_0-9]+)\(/gm,
      ),
    ].map((m) => m[1]);
    assertEquals(nomes.sort(), TODAS.map(([n]) => n).sort());
  }
  // Fronteira: nada das frentes em voo (96/98) nem as seis da 97.
  for (const fora of [
    "update_order_status_atomic",
    "cancelar_pedido_com_cobranca",
    "pedido__mudar_status",
    "pedido__saldo_a_estornar",
    "autorizar_post_do_estorno",
    "registrar_contestacao_no_ledger",
    "registrar_estorno_externo_do_mp",
    "confirmar_pagamento",
    "solicitar_estorno",
    "registrar_estorno_manual",
    "admin_devolucao_concluir",
    "admin_devolucao_reemitir_reembolso",
    "admin_devolucao_liberar_vinculo_reverso",
    "registrar_pagamento_recebido",
    "is_admin",
    "is_admin_atual",
    "rls_admin_atual",
  ]) {
    assert(
      !semComentarios(migration).includes(`FUNCTION public.${fora}(`),
      `${fora} redefinida`,
    );
  }
});

Deno.test("o ponto de partida de cada função é a ÚLTIMA definição dela antes desta migration", () => {
  const nomes = [...Deno.readDirSync(`${DIR}../supabase/migrations`)]
    .filter((e) => e.isFile && /^\d+_.*\.sql$/.test(e.name))
    .map((e) => e.name)
    .filter((n) => n < NOME)
    .sort();
  for (const [nome, fonte] of TODAS) {
    const re = reCriacao(nome);
    const com = nomes.filter((n) => {
      re.lastIndex = 0;
      return re.test(ler(n));
    });
    assertEquals(com.at(-1), fonte, nome);
  }
});

Deno.test("cada RPC é o corpo vigente byte a byte + UMA guarda, cópia do bloco do is_admin() com is_admin_atual()", () => {
  for (const [nome] of RPCS) {
    assertEquals(corpo(depois[nome]), comGuarda(nome, antes[nome]), nome);
    assertEquals(
      depois[nome].split("public.is_admin_atual()").length - 1,
      1,
      `${nome}: a guarda entra uma vez só`,
    );
    assertEquals(
      depois[nome].split("public.is_admin()").length - 1,
      1,
      `${nome}: o bloco do is_admin() continua`,
    );
  }
});

Deno.test("a guarda recusa com a MESMA mensagem e o MESMO SQLSTATE (ou o mesmo '[]') do 'não é admin' de cada função", () => {
  for (const [nome] of RPCS) {
    const c = corpo(depois[nome]);
    const i = c.indexOf("public.is_admin()");
    const j = c.indexOf("public.is_admin_atual()");
    const saida = (k) =>
      c.slice(c.indexOf("THEN\n", k), c.indexOf("END IF;", k));
    assertEquals(saida(j), saida(i), nome);
  }
});

Deno.test("nas três 'dono OU admin' o dono continua passando (a guarda só troca o atalho de admin)", () => {
  for (const [nome, dono] of [
    [
      "devolucao_detalhe",
      "v_d.user_id IS DISTINCT FROM auth.uid() AND NOT public.is_admin_atual()",
    ],
    [
      "devolucao_elegibilidade",
      "v_o.user_id IS DISTINCT FROM v_uid AND NOT public.is_admin_atual()",
    ],
    [
      "devolucoes_do_pedido",
      "IF NOT public.is_admin_atual() AND NOT EXISTS (\n    SELECT 1 FROM public.marketplace_orders o WHERE o.id = p_order_id AND o.user_id = auth.uid()",
    ],
  ]) {
    assertStringIncludes(depois[nome], dono);
  }
});

Deno.test("a guarda vem ANTES de qualquer trava ou escrita", () => {
  for (const [nome] of RPCS) {
    const c = semComentarios(corpo(depois[nome]));
    const iGuarda = c.indexOf("public.is_admin_atual()");
    for (const efeito of [
      /\bFOR UPDATE\b/,
      /\bUPDATE public\./,
      /\bINSERT INTO\b/,
      /\bDELETE FROM\b/,
      /\bLOCK TABLE\b/,
      /\bPERFORM\b/,
    ]) {
      const m = efeito.exec(c);
      assert(
        m === null || m.index > iGuarda,
        `${nome}: ${efeito} antes da guarda`,
      );
    }
  }
});

Deno.test("R1: a sincronia de papel só age quando o papel MUDA (UPDATE); o INSERT continua", () => {
  const n = "handle_profile_role_sync_to_auth";
  const bloco =
    "    IF TG_OP = 'UPDATE' AND NEW.role IS NOT DISTINCT FROM OLD.role THEN\n        RETURN NEW;\n    END IF;\n";
  const c = corpo(depois[n]);
  assertStringIncludes(c, bloco);
  // Fora o bloco (e o comentário dele), o corpo é o da baseline.
  const semBloco = c.replace(
    / {4}-- Só quando o papel MUDA[\s\S]*? {4}END IF;\n/,
    "",
  );
  assertEquals(semBloco, antes[n]);
  assert(
    c.indexOf(bloco) < c.indexOf("UPDATE auth.users"),
    "a saída vem antes da cópia",
  );
});

Deno.test("R1: ensure_role_protection e prevent_role_change decidem pelo admin ATUAL", () => {
  const e = corpo(depois.ensure_role_protection);
  const guardaE =
    "        IF NOT public.is_admin_atual() THEN\n            NEW.role := OLD.role;\n        END IF;\n";
  assertStringIncludes(e, guardaE);
  // Dentro do IF de "papel mudou, quem muda é usuário logado"; o resto igual.
  assertEquals(
    e.replace(/ {8}-- Papel ATUAL[^\n]*\n/, "").replace(guardaE, ""),
    antes.ensure_role_protection,
  );
  const p = corpo(depois.prevent_role_change);
  assertStringIncludes(
    p,
    "    IF public.is_admin() AND public.is_admin_atual() THEN\n        RETURN NEW;",
  );
  assertEquals(
    p
      .replace(/ {4}-- Papel ATUAL[^\n]*\n/, "")
      .replace(
        "public.is_admin() AND public.is_admin_atual()",
        "public.is_admin()",
      ),
    antes.prevent_role_change,
  );
});

Deno.test("o rollback restaura o TEXTO de cada uma das 42 byte a byte, com o mesmo cabeçalho", () => {
  for (const [nome] of TODAS) {
    assertEquals(corpo(desfeito[nome]), antes[nome], nome);
    assert(
      !desfeito[nome].includes("is_admin_atual"),
      `${nome}: guarda no rollback`,
    );
    assertEquals(
      cabecalho(desfeito[nome]),
      cabecalho(depois[nome]),
      `${nome}: cabeçalho`,
    );
    assert(!corpo(depois[nome]).includes("$$"), `${nome}: $$ dentro do corpo`);
  }
});

Deno.test("os preflights citam o md5 REAL de cada corpo (vigente e desta), o is_admin() da baseline e o is_admin_atual() da 97", () => {
  const preflight = migration.slice(
    0,
    migration.indexOf("END $preflight_20261199$"),
  );
  const preflightRb = rollback.slice(
    0,
    rollback.indexOf("END $preflight_rollback_20261199$"),
  );
  for (const [nome] of TODAS) {
    const velho = md5(antes[nome]);
    const novo = md5(corpo(depois[nome]));
    assert(velho !== novo, nome);
    assert(
      new RegExp(
        `\\('public\\.${nome}\\([^)]*\\)', '${velho}', '${novo}'\\)`,
      ).test(preflight),
      `${nome}: preflight`,
    );
    assert(
      new RegExp(`\\('public\\.${nome}\\([^)]*\\)', '${novo}'\\)`).test(
        preflightRb,
      ),
      `${nome}: preflight do rollback`,
    );
    assert(
      !preflightRb.includes(`'${velho}'`),
      `${nome}: o rollback só desfaz o corpo NOVO`,
    );
  }
  const baseline = ler(BASELINE);
  const i = baseline.indexOf(
    "CREATE FUNCTION public.is_admin() RETURNS boolean",
  );
  const isAdmin = baseline.slice(
    i,
    baseline.indexOf("\n$$;", i) + "\n$$;".length,
  );
  assertStringIncludes(preflight, `IS DISTINCT FROM '${md5(corpo(isAdmin))}'`);
  const da97 = ler("20261197000000_dinheiro_exige_admin_atual.sql");
  const atual = funcao(da97, "is_admin_atual");
  assertStringIncludes(preflight, `IS DISTINCT FROM '${md5(corpo(atual))}'`);
  assertStringIncludes(
    preflight,
    "has_function_privilege(v_dono, 'public.is_admin_atual()', 'EXECUTE')",
  );
  for (const sql of [preflight, preflightRb]) {
    assertStringIncludes(sql, "md5(replace(prosrc, E'\\r', ''))");
    assertStringIncludes(sql, "RAISE EXCEPTION 'B1_BASELINE_DIVERGENT:");
    assert(
      !/RAISE\s+(NOTICE|WARNING|INFO|LOG|DEBUG)/i.test(sql),
      "preflight que só avisa não recusa",
    );
  }
});

Deno.test("o preflight confere os três gatilhos de papel exatamente como a baseline os cria", () => {
  const baseline = ler(BASELINE);
  for (const g of [
    "tr_ensure_role_protection",
    "tr_prevent_role_change",
    "tr_sync_profile_role_to_auth",
  ]) {
    const m = new RegExp(`^CREATE TRIGGER "${g}" [^\\n]*;$`, "m").exec(
      baseline,
    );
    assert(m, g);
    const def = m[0].replace(/"/g, "").replace(/\(\);$/, "()");
    assertStringIncludes(migration, `('${g}', '${def}')`);
  }
  assertStringIncludes(migration, "v_ligado IS DISTINCT FROM 'O'");
});

Deno.test("os preflights vêm ANTES de qualquer escrita; nenhum GRANT/REVOKE/DROP/ALTER/gatilho no par", () => {
  for (const [sql, bloco] of [
    [migration, "DO $preflight_20261199$"],
    [rollback, "DO $preflight_rollback_20261199$"],
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
    const c = semComentarios(sql);
    for (const proibido of [
      /^\s*GRANT\b/im,
      /^\s*REVOKE\b/im,
      /\bDROP\s+(FUNCTION|TABLE|TRIGGER|POLICY|COLUMN)\b/i,
      /^\s*ALTER\s/im,
      /^\s*CREATE\s+TRIGGER\b/im,
    ]) {
      assert(!proibido.test(c), `${proibido} no arquivo`);
    }
  }
});

Deno.test("a prova viva roda no rpc-ci", () => {
  const ci = lerArquivo(".github/workflows/rpc-ci.yml");
  assertStringIncludes(
    ci,
    "node tests/banco/rodar-isolado.cjs tests/banco/admin-atual-portas-viva.cjs",
  );
});
