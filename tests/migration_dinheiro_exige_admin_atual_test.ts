// @ts-nocheck
// O DINHEIRO EXIGE O ADMIN DE AGORA — prova offline do par 20261197000000 +
// rollback (permissão + dinheiro, 04/10/2026). O COMPORTAMENTO (admin
// rebaixado com JWT velho -> recusa sem escrita nas seis RPCs, nas duas
// direções da contradição auth.users × profiles; RLS de marketplace_orders e
// order_refunds sem vazamento; rollback byte a byte; preflights recusando sem
// escrita) é provado em tests/banco/admin-atual-viva.cjs, no rpc-ci (Postgres
// efêmero, migrations do zero); aqui fica o que se prova só lendo o texto, no
// `npm run test:unit`.
//
// Cada asserção está amarrada a um risco: corpo que não é o vigente + a
// guarda apaga em silêncio a correção de outra migration (89/94/95/79/75);
// guarda depois de alguma trava ou escrita grava pela metade ou espera lock
// à toa; guarda com outra mensagem/SQLSTATE muda o que o painel mostra;
// is_admin_atual() com EXECUTE para authenticated vira oráculo público;
// rls_admin_atual() SEM EXECUTE para authenticated quebra o SELECT de pedidos
// de TODO cliente (política roda como o usuário); política que perde o
// `auth.uid() = user_id` esconde do cliente o próprio pedido; rollback que não
// volta byte a byte deixa a regra presa depois de "revertida"; hash de
// preflight que não é o md5 real recusa num banco correto (ou aceita corpo
// errado); DROP da função antes de restaurar a política falha no meio; e a
// edge estornar-pagamento com regra diferente da função deixa uma porta
// aberta pela outra.
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
const NOME = "20261197000000_dinheiro_exige_admin_atual.sql";

const lerArquivo = (rel) =>
  Deno.readTextFileSync(`${DIR}../${rel}`).replace(/\r\n/g, "\n");
const ler = (n) => lerArquivo(`supabase/migrations/${n}`);
const migration = ler(NOME);
const rollback = ler(`rollback-manual-${NOME}`);

const md5 = (s) => createHash("md5").update(s).digest("hex");
const norm = (s) => s.replace(/\s+/g, " ").trim();
const semComentarios = (s) =>
  s
    .split("\n")
    .map((l) => l.replace(/--.*$/, ""))
    .join("\n");

/** Texto da função, da assinatura até o `$$;` que a fecha. */
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

const COMENTARIO =
  "-- Papel ATUAL (auth.users E profiles), não o do JWT: admin rebaixado para aqui (20261197000000).";

// As seis RPCs: de onde vem o corpo vigente, a abertura do bloco do
// is_admin() que a guarda segue, e a indentação do corpo.
const RPCS = [
  {
    nome: "solicitar_estorno",
    assinatura: "public.solicitar_estorno(uuid, numeric, text)",
    fonte: "20261175000000_a_devolucao_nasce_no_pedido.sql",
    abertura: "    IF NOT public.is_admin() THEN\n",
    ind: 4,
  },
  {
    nome: "registrar_estorno_manual",
    assinatura: "public.registrar_estorno_manual(uuid)",
    fonte: "20261194000000_ja_estornei_so_em_pedido_pago.sql",
    abertura: "    IF NOT public.is_admin() THEN\n",
    ind: 4,
  },
  {
    nome: "admin_devolucao_concluir",
    assinatura:
      "public.admin_devolucao_concluir(uuid, text, jsonb, numeric, text)",
    fonte: "20261175000000_a_devolucao_nasce_no_pedido.sql",
    abertura: "  IF NOT public.is_admin() THEN\n",
    ind: 2,
  },
  {
    nome: "admin_devolucao_reemitir_reembolso",
    assinatura: "public.admin_devolucao_reemitir_reembolso(uuid, boolean)",
    fonte: "20261175000000_a_devolucao_nasce_no_pedido.sql",
    abertura: "  IF NOT public.is_admin() THEN\n",
    ind: 2,
  },
  {
    nome: "admin_devolucao_liberar_vinculo_reverso",
    assinatura: "public.admin_devolucao_liberar_vinculo_reverso(uuid, boolean)",
    fonte: "20261179000000_cancelar_devolucao_barra_compra_em_voo.sql",
    abertura: "  IF NOT public.is_admin() OR auth.uid() IS NULL THEN\n",
    ind: 2,
  },
  {
    nome: "registrar_pagamento_recebido",
    assinatura: "public.registrar_pagamento_recebido(uuid, boolean)",
    fonte: "20261195000000_recusado_e_recebido_recusam_nulo.sql",
    abertura: "    IF NOT public.is_admin() THEN\n",
    ind: 4,
  },
];

/** A recusa de não-admin que a função JÁ tinha (o RAISE do bloco do is_admin). */
const recusaDoIsAdmin = (texto, abertura) => {
  const i = texto.indexOf(abertura) + abertura.length;
  return norm(texto.slice(i, texto.indexOf("END IF;", i)));
};

/** A guarda, montada a partir da recusa que a função já usa. */
const guardaPara = (rpc, fonte) => {
  const s = " ".repeat(rpc.ind);
  const i = fonte.indexOf(rpc.abertura) + rpc.abertura.length;
  // As linhas do RAISE do is_admin(), byte a byte, com a indentação dele.
  const raise = fonte.slice(i, fonte.indexOf(`${s}END IF;\n`, i));
  const bloco = `${s}${COMENTARIO}\n${s}IF NOT public.is_admin_atual() THEN\n${raise}${s}END IF;\n`;
  return rpc.ind === 4 ? `\n${bloco}` : bloco;
};
const comGuarda = (rpc, fonte) => {
  const s = " ".repeat(rpc.ind);
  const i = fonte.indexOf(rpc.abertura);
  const j = fonte.indexOf(`${s}END IF;\n`, i) + `${s}END IF;\n`.length;
  return fonte.slice(0, j) + guardaPara(rpc, fonte) + fonte.slice(j);
};

for (const rpc of RPCS) {
  rpc.antes = funcao(ler(rpc.fonte), rpc.nome);
  rpc.depois = funcao(migration, rpc.nome);
  rpc.rollback = funcao(rollback, rpc.nome);
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

Deno.test("o ponto de partida de cada RPC é a ÚLTIMA definição dela antes desta migration", () => {
  const nomes = [...Deno.readDirSync(`${DIR}../supabase/migrations`)]
    .filter((e) => e.isFile && /^\d+_.*\.sql$/.test(e.name))
    .map((e) => e.name)
    .filter((n) => n < NOME)
    .sort();
  for (const rpc of RPCS) {
    const ultimas = nomes.filter((n) =>
      ler(n).includes(`FUNCTION public.${rpc.nome}(`),
    );
    assertEquals(ultimas.at(-1), rpc.fonte, rpc.nome);
  }
});

Deno.test("cada RPC é o corpo vigente byte a byte + UMA guarda logo depois do is_admin()", () => {
  for (const rpc of RPCS) {
    assertEquals(rpc.depois, comGuarda(rpc, rpc.antes), rpc.nome);
    assertEquals(
      rpc.depois.split("IF NOT public.is_admin_atual() THEN").length - 1,
      1,
      `${rpc.nome}: a guarda entra uma vez só`,
    );
    // O bloco do is_admin() continua intacto (o mapa do db-apply da
    // 20261072000000 conta `IF NOT public.is_admin() THEN` na 89/94).
    assertStringIncludes(rpc.depois, rpc.abertura);
  }
});

Deno.test("a guarda recusa com a MESMA mensagem e o MESMO SQLSTATE do 'não é admin' de cada função", () => {
  for (const rpc of RPCS) {
    const iGuarda =
      rpc.depois.indexOf("IF NOT public.is_admin_atual() THEN\n") +
      "IF NOT public.is_admin_atual() THEN\n".length;
    const raiseGuarda = norm(
      rpc.depois.slice(iGuarda, rpc.depois.indexOf("END IF;", iGuarda)),
    );
    assertEquals(
      raiseGuarda,
      recusaDoIsAdmin(rpc.antes, rpc.abertura),
      rpc.nome,
    );
  }
  // Cinco usam 42501; registrar_pagamento_recebido nunca teve ERRCODE (P0001).
  for (const rpc of RPCS.filter(
    (r) => r.nome !== "registrar_pagamento_recebido",
  )) {
    assertStringIncludes(
      recusaDoIsAdmin(rpc.antes, rpc.abertura),
      "USING ERRCODE = '42501'",
    );
  }
  assertEquals(
    recusaDoIsAdmin(RPCS.at(-1).antes, RPCS.at(-1).abertura),
    "RAISE EXCEPTION 'Não autorizado: só a loja registra pagamento recebido.';",
  );
});

Deno.test("a guarda vem ANTES de qualquer leitura de tabela, trava ou escrita", () => {
  for (const rpc of RPCS) {
    const c = semComentarios(rpc.depois);
    const corpoExec = c.slice(c.indexOf("BEGIN"));
    const iGuarda = corpoExec.indexOf("IF NOT public.is_admin_atual() THEN");
    for (const efeito of [
      /\bFOR UPDATE\b/,
      /\bUPDATE public\./,
      /\bINSERT INTO\b/,
      /\bFROM public\./,
    ]) {
      const m = efeito.exec(corpoExec);
      assert(
        m === null || m.index > iGuarda,
        `${rpc.nome}: ${efeito} antes da guarda`,
      );
    }
  }
});

Deno.test("assinatura, RETURNS, SECURITY DEFINER e search_path de cada RPC iguais aos vigentes; nenhum GRANT/REVOKE nas RPCs", () => {
  const cabecalho = (t) => norm(t.slice(0, t.indexOf("AS $$")));
  for (const rpc of RPCS) {
    assertEquals(cabecalho(rpc.depois), cabecalho(rpc.antes), rpc.nome);
    assertEquals(cabecalho(rpc.rollback), cabecalho(rpc.antes), rpc.nome);
    for (const sql of [migration, rollback]) {
      const repetido = semComentarios(sql)
        .split(";")
        .some(
          (st) =>
            /^\s*(GRANT|REVOKE)\b/.test(st) &&
            st.includes(`FUNCTION public.${rpc.nome}(`),
        );
      assert(!repetido, `${rpc.nome}: GRANT/REVOKE repetido`);
    }
  }
});

Deno.test("o rollback restaura o TEXTO de cada RPC byte a byte", () => {
  for (const rpc of RPCS) {
    assertEquals(rpc.rollback, rpc.antes, rpc.nome);
    assertEquals(md5(corpo(rpc.rollback)), md5(corpo(rpc.antes)));
    assert(
      !rpc.rollback.includes("is_admin_atual"),
      `${rpc.nome}: guarda no rollback`,
    );
  }
});

const HELPER = funcao(migration, "is_admin_atual");
const RLS = funcao(migration, "rls_admin_atual");

Deno.test("os preflights citam o md5 REAL de cada corpo (vigente e desta) e o da is_admin() da baseline", () => {
  const preflight = migration.slice(
    0,
    migration.indexOf("\nCREATE OR REPLACE FUNCTION"),
  );
  const preflightRb = rollback.slice(
    0,
    rollback.indexOf("\nCREATE OR REPLACE FUNCTION"),
  );
  for (const rpc of RPCS) {
    const antigo = md5(corpo(rpc.antes));
    const novo = md5(corpo(rpc.depois));
    assert(antigo !== novo, rpc.nome);
    assertStringIncludes(
      preflight,
      `('${rpc.assinatura}', '${antigo}', '${novo}')`,
    );
    assertStringIncludes(preflightRb, `('${rpc.assinatura}', '${novo}')`);
    assert(
      !preflightRb.includes(`'${antigo}'`),
      `${rpc.nome}: o rollback só desfaz o corpo NOVO`,
    );
  }
  // O corpo que a 95 deixa em registrar_pagamento_recebido (combinado com a 29dd).
  assertEquals(
    md5(corpo(RPCS.at(-1).antes)),
    "0a594768d4836bcc6d5064ce537b47dc",
  );
  // O da 94 em registrar_estorno_manual (o que a própria 94 declara).
  assertEquals(md5(corpo(RPCS[1].antes)), "18ea2e76d075634b57189592fb91ac0d");
  for (const [assinatura, texto] of [
    ["public.is_admin_atual()", HELPER],
    ["public.rls_admin_atual()", RLS],
  ]) {
    assertStringIncludes(
      preflight,
      `('${assinatura}', '${md5(corpo(texto))}')`,
    );
    assertStringIncludes(
      preflightRb,
      `('${assinatura}', '${md5(corpo(texto))}')`,
    );
  }
  const baseline = ler("20260806000000_baseline_do_schema_vivo.sql");
  const i = baseline.indexOf(
    "CREATE FUNCTION public.is_admin() RETURNS boolean",
  );
  const isAdmin = baseline.slice(
    i,
    baseline.indexOf("\n$$;", i) + "\n$$;".length,
  );
  assertStringIncludes(preflight, `IS DISTINCT FROM '${md5(corpo(isAdmin))}'`);
  for (const sql of [preflight, preflightRb]) {
    assertStringIncludes(sql, "md5(replace(prosrc, E'\\r', ''))");
    assertStringIncludes(sql, "RAISE EXCEPTION 'B1_BASELINE_DIVERGENT:");
    assert(
      !/RAISE\s+(NOTICE|WARNING|INFO|LOG|DEBUG)/i.test(sql),
      "preflight que só avisa não recusa",
    );
  }
});

Deno.test("os preflights vêm ANTES de qualquer escrita (CREATE, REVOKE, GRANT, ALTER POLICY, DROP)", () => {
  for (const [sql, bloco] of [
    [migration, "DO $preflight_20261197$"],
    [rollback, "DO $preflight_rollback_20261197$"],
  ]) {
    const fim = sql.indexOf("END $preflight");
    assert(sql.indexOf(bloco) >= 0 && fim > sql.indexOf(bloco));
    const antes = semComentarios(sql.slice(0, sql.indexOf(bloco)));
    for (const escrita of [
      /CREATE\s/i,
      /REVOKE\s/i,
      /GRANT\s/i,
      /ALTER\s+POLICY/i,
      /DROP\s/i,
    ]) {
      assert(!escrita.test(antes), `${escrita} antes do preflight`);
    }
  }
});

Deno.test("is_admin_atual(): STABLE, SECURITY DEFINER, search_path fixo; service_role explícito OU (login E admin em auth.users E em profiles); sem JWT", () => {
  const cab = norm(HELPER.slice(0, HELPER.indexOf("AS $$")));
  assertEquals(
    cab,
    "CREATE OR REPLACE FUNCTION public.is_admin_atual() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public",
  );
  const c = norm(semComentarios(corpo(HELPER)));
  assertEquals(
    c,
    "SELECT COALESCE(current_setting('role', true), '') IN ('postgres', 'service_role') " +
      "OR ( auth.uid() IS NOT NULL " +
      "AND EXISTS ( SELECT 1 FROM auth.users u WHERE u.id = auth.uid() AND (u.raw_app_meta_data ->> 'role') = 'admin' ) " +
      "AND EXISTS ( SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin' ) );",
  );
  assert(!c.includes("request.jwt"), "a guarda não pode ler o JWT");
});

Deno.test("rls_admin_atual(): embrulho do dono para as políticas, só devolve o boolean de is_admin_atual()", () => {
  assertEquals(
    norm(RLS.slice(0, RLS.indexOf("AS $$"))),
    "CREATE OR REPLACE FUNCTION public.rls_admin_atual() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public",
  );
  assertEquals(
    norm(semComentarios(corpo(RLS))),
    "SELECT public.is_admin_atual();",
  );
});

Deno.test("grants: is_admin_atual sem EXECUTE para PUBLIC/anon/authenticated; rls_admin_atual só para authenticated", () => {
  const c = semComentarios(migration);
  assertStringIncludes(
    c,
    "REVOKE ALL ON FUNCTION public.is_admin_atual() FROM PUBLIC, anon, authenticated;",
  );
  assertStringIncludes(
    c,
    "REVOKE ALL ON FUNCTION public.rls_admin_atual() FROM PUBLIC, anon;",
  );
  assertStringIncludes(
    c,
    "GRANT EXECUTE ON FUNCTION public.rls_admin_atual() TO authenticated;",
  );
  const grants = c.match(/^GRANT [^;]*;/gm) || [];
  assertEquals(grants, [
    "GRANT EXECUTE ON FUNCTION public.rls_admin_atual() TO authenticated;",
  ]);
  // O REVOKE vem depois do CREATE de cada uma (senão o default privileges
  // dá EXECUTE de novo no CREATE).
  for (const fn of ["is_admin_atual", "rls_admin_atual"]) {
    assert(
      c.indexOf(`REVOKE ALL ON FUNCTION public.${fn}()`) >
        c.indexOf(`CREATE OR REPLACE FUNCTION public.${fn}()`),
      fn,
    );
  }
});

// As cinco políticas: o que a migration grava e o que o rollback devolve.
const POLITICAS = [
  [
    "marketplace_orders_select_policy ON public.marketplace_orders USING (((SELECT auth.uid()) = user_id) OR (SELECT public.rls_admin_atual()));",
    "marketplace_orders_select_policy ON public.marketplace_orders USING (((SELECT auth.uid()) = user_id) OR (SELECT public.is_admin()));",
  ],
  [
    "marketplace_orders_admin_update_policy ON public.marketplace_orders USING ((SELECT public.rls_admin_atual())) WITH CHECK ((SELECT public.rls_admin_atual()));",
    "marketplace_orders_admin_update_policy ON public.marketplace_orders USING ((SELECT public.is_admin())) WITH CHECK ((SELECT public.is_admin()));",
  ],
  [
    "marketplace_orders_admin_insert_policy ON public.marketplace_orders WITH CHECK ((SELECT public.rls_admin_atual()));",
    "marketplace_orders_admin_insert_policy ON public.marketplace_orders WITH CHECK ((SELECT public.is_admin()));",
  ],
  [
    "marketplace_orders_admin_delete_policy ON public.marketplace_orders USING ((SELECT public.rls_admin_atual()));",
    "marketplace_orders_admin_delete_policy ON public.marketplace_orders USING ((SELECT public.is_admin()));",
  ],
  [
    "order_refunds_admin_all ON public.order_refunds USING ((SELECT public.rls_admin_atual())) WITH CHECK ((SELECT public.rls_admin_atual()));",
    "order_refunds_admin_all ON public.order_refunds USING (public.is_admin()) WITH CHECK (public.is_admin());",
  ],
];

Deno.test("políticas: a migration troca SÓ a porta de admin das cinco (dono preservado); o rollback devolve a expressão de antes", () => {
  const alters = (sql) =>
    (norm(semComentarios(sql)).match(/ALTER POLICY [^;]*;/g) || []).map((a) =>
      a.replace(/^ALTER POLICY /, ""),
    );
  assertEquals(
    alters(migration),
    POLITICAS.map(([nova]) => nova),
  );
  assertEquals(
    alters(rollback),
    POLITICAS.map(([, antiga]) => antiga),
  );
  // A política do dono no ledger não é tocada.
  assert(!semComentarios(migration).includes("order_refunds_cliente_le ON"));
  // A expressão de antes é a das migrations que criaram as políticas.
  const doLedger = norm(ler("2026110000000_o_estorno_nasce_no_ledger.sql"));
  assertStringIncludes(
    doLedger,
    "CREATE POLICY order_refunds_admin_all ON public.order_refunds FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());",
  );
  const baseline = ler("20260806000000_baseline_do_schema_vivo.sql");
  assertStringIncludes(
    baseline,
    'CREATE POLICY marketplace_orders_select_policy ON public.marketplace_orders FOR SELECT TO "authenticated" USING (((( SELECT "auth"."uid"() AS "uid") = "user_id") OR ( SELECT "public"."is_admin"() AS "is_admin")));',
  );
});

Deno.test("o rollback apaga as duas funções novas SÓ DEPOIS de restaurar corpos e políticas", () => {
  const c = semComentarios(rollback);
  const iDropRls = c.indexOf(
    "DROP FUNCTION IF EXISTS public.rls_admin_atual();",
  );
  const iDropHelper = c.indexOf(
    "DROP FUNCTION IF EXISTS public.is_admin_atual();",
  );
  const ultimaEscrita = Math.max(
    c.lastIndexOf("ALTER POLICY"),
    c.lastIndexOf("CREATE OR REPLACE FUNCTION"),
  );
  assert(
    iDropRls > ultimaEscrita && iDropHelper > iDropRls,
    `ordem: ${[ultimaEscrita, iDropRls, iDropHelper]}`,
  );
  // E a migration não apaga nada.
  assert(!/\bDROP\b/i.test(semComentarios(migration)), "DROP na migration");
});

Deno.test("contrato com a edge estornar-pagamento: a MESMA autoridade atual (app_metadata do Auth E profiles)", () => {
  // 20261198000000 (04/10/2026): a regra saiu da estornar-pagamento para
  // _shared/admin-atual.ts — UMA conferência, usada também pela ação
  // `cancelar` da criar-pagamento. O contrato continua o mesmo, agora no
  // módulo compartilhado, e a edge tem de chamá-lo.
  const edge = norm(
    lerArquivo("supabase/functions/estornar-pagamento/index.ts"),
  );
  assertStringIncludes(
    edge,
    'import { adminAtualDaSessao } from "../_shared/admin-atual.ts"',
  );
  assertStringIncludes(
    edge,
    "const adminId = await adminAtualDaSessao(authHeader, {",
  );
  assertStringIncludes(edge, "return adminId !== null");
  const regra = norm(lerArquivo("supabase/functions/_shared/admin-atual.ts"));
  assertStringIncludes(
    regra,
    'return perfil.role === "admin" && user.app_metadata?.role === "admin" ? user.id : null;',
  );
  // O papel vem do getUser() (Auth carrega do banco), nunca de um decode do JWT.
  assertStringIncludes(regra, "await doUsuario.auth.getUser()");
  for (const texto of [edge, regra]) {
    assert(
      !/atob\(|jwtDecode|decodeJwt/.test(texto),
      "a edge não pode decidir pelo JWT decodificado",
    );
  }
});

Deno.test("o rollback da 97 RECUSA (antes de escrever) enquanto função ou política FORA da 97 ainda usa is_admin_atual()/rls_admin_atual() — o conjunto 'da 97' é o que ela mesma define", () => {
  const preflight = rollback.slice(
    0,
    rollback.indexOf("END $preflight_rollback_20261197$"),
  );
  // As funções da própria 97: tudo o que ela cria ou redefine.
  const proprias = [
    ...semComentarios(migration).matchAll(
      /^CREATE OR REPLACE FUNCTION public\.(\w+)\(([^)]*)\)/gm,
    ),
  ].map((m) => m[1]);
  assertEquals(proprias.length, 8, "a 97 define 8 funções");
  const listadas = [
    ...preflight
      .slice(preflight.indexOf("unnest(ARRAY["))
      .matchAll(/'public\.(\w+)\(/g),
  ].map((m) => m[1]);
  assertEquals(listadas.sort(), proprias.sort());
  // As cinco políticas da 97: as ALTER POLICY dela.
  const politicas = [
    ...semComentarios(migration).matchAll(
      /^ALTER POLICY (\w+) ON (public\.\w+)/gm,
    ),
  ].map((m) => `('${m[2]}', '${m[1]}')`);
  assertEquals(politicas.length, 5);
  const bloco = preflight.slice(preflight.indexOf("NOT IN ("));
  for (const par of politicas) assertStringIncludes(bloco, par);
  // Recusa nomeando o quê, sem escrever (o bloco vem antes de qualquer CREATE/DROP).
  assertStringIncludes(preflight, "p.prosrc ~* '(is|rls)_admin_atual'");
  assertStringIncludes(
    preflight,
    "pg_get_expr(pol.polqual, pol.polrelid) ~* '(is|rls)_admin_atual'",
  );
  assertStringIncludes(preflight, "funções fora da 20261197000000 ainda usam");
  assertStringIncludes(
    preflight,
    "políticas fora da 20261197000000 ainda usam",
  );
  // Quatro recusas: corpo vivo, política viva, função dependente, política dependente.
  assertEquals(
    (preflight.match(/RAISE EXCEPTION 'B1_BASELINE_DIVERGENT/g) || []).length,
    4,
  );
  // O cabeçalho do rollback declara a ordem.
  assertStringIncludes(
    rollback,
    "DEPOIS dos que usam as funções que ele apaga",
  );
});
