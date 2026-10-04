// @ts-nocheck
// CANCELAR PEDIDO ANULA A COBRANÇA — prova offline do par 20261198000000 +
// rollback (dinheiro, 04/10/2026). A prova VIVA (as funções de verdade, no
// Postgres efêmero, com CAS, corrida, rollback e controle) mora em
// tests/banco/cancelar-pedido-viva.cjs; aqui fica o que se prova só lendo o
// texto.
//
// Cada asserção está amarrada a um risco: o código copiado da 80 que difere
// em MAIS do que as mudanças prometidas ressuscita ou apaga regra de dinheiro
// sem ninguém pedir; hash do preflight que não é o md5 real do corpo recusa a
// migration num banco correto (ou aceita um corpo errado); rollback que não
// devolve o corpo da 80 byte a byte deixa o defeito preso depois de
// "revertido"; casca sem o literal `verificando:` desliga a guarda de ordem
// do rollback da 75; função interna com EXECUTE para authenticated abre o
// bypass por outra porta; e uma redefinição POSTERIOR faria esta migration
// ressuscitar corpo velho.
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
const PASTA = `${DIR}../supabase/migrations`;
const NOME = "20261198000000_cancelar_pedido_anula_a_cobranca.sql";
const NOME_80 = "20261180000000_cliente_nao_cancela_com_cartao_vivo.sql";
const NOME_97 = "20261197000000_dinheiro_exige_admin_atual.sql";

const ler = (n) =>
  Deno.readTextFileSync(`${PASTA}/${n}`).replace(/\r\n/g, "\n");
const migration = ler(NOME);
const rollback = ler(`rollback-manual-${NOME}`);
const migration80 = ler(NOME_80);
const migration97 = ler(NOME_97);

const norm = (s) => s.replace(/\s+/g, " ").trim();
const md5 = (s) => createHash("md5").update(s).digest("hex");
const semComentarios = (s) =>
  s
    .split("\n")
    .filter((l) => !/^\s*--/.test(l))
    .map((l) => l.replace(/\s+--\s.*$/, ""))
    .join("\n");

/** O texto da função inteira: do CREATE até o `$$;` de fechamento. */
function funcao(sql, nome) {
  const marcador = `CREATE OR REPLACE FUNCTION public.${nome}(`;
  const i = sql.indexOf(marcador);
  assert(i >= 0, `${nome} não encontrada`);
  const f = sql.indexOf("\n$$;", i);
  assert(f >= 0, `fechamento de ${nome} não encontrado`);
  return sql.slice(i, f + 4);
}

/** prosrc: entre `AS $$` e o `$$;`, com as quebras de linha das pontas. */
function corpo(sql, nome) {
  const texto = funcao(sql, nome);
  const a = texto.indexOf("AS $$") + "AS $$".length;
  return texto.slice(a, texto.length - "$$;".length);
}

const HASH_80 = "ed2f7fd3e0177c027720049b2fe55d3b";
// Corpos que a 20261197000000 deixa (o preflight da 98 exige os dois).
const HASH_97_REEMITIR = "7a5ce4978a989e1bebb3d048d347c0c6";
const HASH_97_ADMIN_ATUAL = "519842163e48cc377ac1337ffb9db936";
const NOVAS = [
  "pedido__saldo_a_estornar",
  "pedido__mudar_status",
  "cancelar_pedido_com_cobranca",
];

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

Deno.test("o preflight cita o md5 REAL de cada corpo que esta migration deixa (e o da 80)", () => {
  assertEquals(md5(corpo(migration80, "update_order_status_atomic")), HASH_80);
  const preflight = migration.slice(
    migration.indexOf("DO $preflight_20261198$"),
    migration.indexOf("END $preflight_20261198$;"),
  );
  assertStringIncludes(preflight, `'${HASH_80}'`);
  assertEquals(
    md5(corpo(migration97, "admin_devolucao_reemitir_reembolso")),
    HASH_97_REEMITIR,
  );
  assertEquals(md5(corpo(migration97, "is_admin_atual")), HASH_97_ADMIN_ATUAL);
  assertStringIncludes(preflight, `'${HASH_97_REEMITIR}'`);
  assertStringIncludes(preflight, `'${HASH_97_ADMIN_ATUAL}'`);
  for (const nome of [
    "update_order_status_atomic",
    "admin_devolucao_reemitir_reembolso",
    ...NOVAS,
  ]) {
    assertStringIncludes(
      preflight,
      `'${md5(corpo(migration, nome))}'`,
      `hash de ${nome} no preflight não é o do corpo`,
    );
  }
});

Deno.test("o rollback devolve update_order_status_atomic da 80 e admin_devolucao_reemitir_reembolso da 97 BYTE A BYTE e apaga as três funções novas", () => {
  assertEquals(
    funcao(rollback, "update_order_status_atomic"),
    funcao(migration80, "update_order_status_atomic"),
  );
  assertEquals(
    funcao(rollback, "admin_devolucao_reemitir_reembolso"),
    funcao(migration97, "admin_devolucao_reemitir_reembolso"),
  );
  for (const assinatura of [
    "public.cancelar_pedido_com_cobranca(uuid, uuid, text, text, text)",
    "public.pedido__mudar_status(uuid, text, text, uuid, boolean, boolean)",
    "public.pedido__saldo_a_estornar(uuid)",
  ]) {
    assertStringIncludes(rollback, `DROP FUNCTION IF EXISTS ${assinatura};`);
  }
  // A guarda de ordem do rollback aceita só o corpo desta migration ou o da 80.
  const guarda = rollback.slice(
    rollback.indexOf("DO $guarda_rollback_20261198$"),
    rollback.indexOf("END $guarda_rollback_20261198$;"),
  );
  assertStringIncludes(
    guarda,
    `'${md5(corpo(migration, "update_order_status_atomic"))}'`,
  );
  assertStringIncludes(guarda, `'${HASH_80}'`);
  assertStringIncludes(
    guarda,
    `'${md5(corpo(migration, "admin_devolucao_reemitir_reembolso"))}'`,
  );
  assertStringIncludes(guarda, `'${HASH_97_REEMITIR}'`);
  assert(
    rollback.indexOf("DO $guarda_rollback_20261198$") <
      rollback.indexOf(
        "CREATE OR REPLACE FUNCTION public.update_order_status_atomic(",
      ),
    "a guarda roda antes do CREATE",
  );
});

Deno.test("a casca update_order_status_atomic: mesma assinatura, ator da sessão, admin ATUAL pela is_admin_atual() da 97 (nunca is_admin() do JWT), nunca a edge, e mantém o literal verificando:", () => {
  const casca = funcao(migration, "update_order_status_atomic");
  assertStringIncludes(
    norm(casca),
    "CREATE OR REPLACE FUNCTION public.update_order_status_atomic( p_order_id uuid, p_new_status text, p_notes text DEFAULT NULL, p_silent boolean DEFAULT FALSE ) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$",
  );
  const limpa = norm(semComentarios(casca));
  assertStringIncludes(
    limpa,
    "RETURN public.pedido__mudar_status( p_order_id, p_new_status, p_notes, auth.uid(), public.is_admin_atual(), false );",
  );
  // S1 (achado do coordenador, 04/10): o is_admin() antigo confia no
  // app_metadata do JWT — admin rebaixado com token velho passaria.
  assert(
    !limpa.includes(" public.is_admin()"),
    "a casca não pode usar is_admin()",
  );
  assert(
    !limpa.includes("(public.is_admin()"),
    "a casca não pode usar is_admin()",
  );
  // rollback-manual-20261175000000 procura este literal no corpo VIVO para
  // recusar reverter a 75 por baixo da guarda do cartão vivo.
  assertStringIncludes(
    corpo(migration, "update_order_status_atomic"),
    "verificando:",
  );
});

// O código da 80 (sem comentários) com SÓ as mudanças prometidas tem de ser o
// código de pedido__mudar_status. Cada trecho "antes" existe uma vez na 80.
const MUDANCAS: [string, string][] = [
  [
    "CREATE OR REPLACE FUNCTION public.update_order_status_atomic( p_order_id uuid, p_new_status text, p_notes text DEFAULT NULL, p_silent boolean DEFAULT FALSE )",
    "CREATE OR REPLACE FUNCTION public.pedido__mudar_status( p_order_id uuid, p_new_status text, p_notes text, p_ator uuid, p_ator_admin boolean, p_pela_edge boolean )",
  ],
  [
    "v_caller_id UUID := auth.uid(); v_is_admin BOOLEAN := public.is_admin();",
    "v_caller_id UUID := p_ator; v_is_admin BOOLEAN := COALESCE(p_ator_admin, false);",
  ],
  [
    "estar autenticado para alterar um pedido.'; END IF; SELECT status, user_id,",
    "estar autenticado para alterar um pedido.'; END IF; IF p_new_status = 'cancelled' THEN PERFORM 1 FROM public.order_refunds r WHERE r.order_id = p_order_id ORDER BY r.id FOR UPDATE; END IF; SELECT status, user_id,",
  ],
  [
    "v_gateway_payment_id TEXT; v_total NUMERIC; v_ja_manual NUMERIC;",
    "v_gateway_payment_id TEXT; v_canal TEXT; v_total NUMERIC; v_saldo NUMERIC;",
  ],
  [
    "metodo_online, gateway_payment_id INTO v_old_status, v_user_id, v_cancelled_after_shipping, v_payment_status, v_paid_at, v_total, v_metodo_online, v_gateway_payment_id FROM",
    "metodo_online, gateway_payment_id, canal INTO v_old_status, v_user_id, v_cancelled_after_shipping, v_payment_status, v_paid_at, v_total, v_metodo_online, v_gateway_payment_id, v_canal FROM",
  ],
  [
    "OR v_gateway_payment_id LIKE 'verificando:%' ) THEN",
    "OR v_gateway_payment_id LIKE 'verificando:%' ) AND NOT p_pela_edge THEN",
  ],
  [
    "antes de cancelar.'; END IF; END IF; IF p_new_status = 'cancelled' AND v_old_status = 'shipping' THEN",
    "antes de cancelar.'; END IF; END IF; IF p_new_status = 'cancelled' AND v_old_status IS DISTINCT FROM 'cancelled' AND (v_payment_status IS NULL OR v_payment_status = 'aguardando') AND v_gateway_payment_id IS NOT NULL AND NOT p_pela_edge THEN RAISE EXCEPTION 'Este pedido tem uma cobrança aberta no Mercado Pago e não pode ser cancelado por aqui. Use o botão Cancelar do pedido: ele anula a cobrança antes de cancelar.'; END IF; IF p_new_status = 'cancelled' AND ( v_old_status = 'shipping' OR (v_old_status = 'delivered' AND v_canal IS DISTINCT FROM 'presencial') ) THEN",
  ],
  [
    "AND NOT v_cancelled_after_shipping AND NOT EXISTS ( SELECT 1 FROM public.order_refunds WHERE order_id = p_order_id AND status IN ('solicitado', 'em_processamento', 'concluido')) THEN SELECT COALESCE(sum(d.valor_reembolso), 0) INTO v_ja_manual FROM public.devolucoes d WHERE d.order_id = p_order_id AND d.status = 'concluida' AND d.reembolso_manual; IF v_total - v_ja_manual > 0 THEN INSERT INTO public.order_refunds (order_id, amount, motivo, solicitado_por) VALUES (p_order_id, v_total - v_ja_manual,",
    "AND NOT v_cancelled_after_shipping THEN v_saldo := public.pedido__saldo_a_estornar(p_order_id); IF v_saldo > 0 THEN INSERT INTO public.order_refunds (order_id, amount, motivo, solicitado_por) VALUES (p_order_id, v_saldo,",
  ],
  [
    "AND v_old_status IS DISTINCT FROM 'shipping' AND NOT v_cancelled_after_shipping THEN",
    "AND v_old_status IS DISTINCT FROM 'shipping' AND (v_old_status IS DISTINCT FROM 'delivered' OR v_canal = 'presencial') AND NOT v_cancelled_after_shipping THEN",
  ],
];

Deno.test("pedido__mudar_status é o código da 80 com SÓ as mudanças prometidas (ator, edge, bypass, R11, entregue)", () => {
  let esperado = norm(
    semComentarios(funcao(migration80, "update_order_status_atomic")),
  );
  for (const [antes, depois] of MUDANCAS) {
    assertEquals(
      esperado.split(antes).length,
      2,
      `trecho da 80 tem de existir UMA vez: ${antes.slice(0, 80)}`,
    );
    esperado = esperado.replace(antes, depois);
  }
  assertEquals(
    norm(semComentarios(funcao(migration, "pedido__mudar_status"))),
    esperado,
  );
});

Deno.test("pedido__saldo_a_estornar é a conta de solicitar_estorno: total − confirmado − em voo − manual", () => {
  const c = norm(semComentarios(funcao(migration, "pedido__saldo_a_estornar")));
  for (const trecho of [
    "SELECT o.total - COALESCE(o.valor_estornado, 0)",
    "r.status IN ('solicitado', 'em_processamento')",
    "d.status = 'concluida' AND d.reembolso_manual",
  ]) {
    assertStringIncludes(c, trecho);
  }
});

Deno.test("ACL: as internas não são de ninguém de fora; a porta da edge é só do service_role", () => {
  const limpo = norm(semComentarios(migration));
  assertStringIncludes(
    limpo,
    "REVOKE ALL ON FUNCTION public.pedido__saldo_a_estornar(uuid) FROM PUBLIC, anon, authenticated, service_role;",
  );
  assertStringIncludes(
    limpo,
    "REVOKE ALL ON FUNCTION public.pedido__mudar_status(uuid, text, text, uuid, boolean, boolean) FROM PUBLIC, anon, authenticated, service_role;",
  );
  assertStringIncludes(
    limpo,
    "REVOKE ALL ON FUNCTION public.cancelar_pedido_com_cobranca(uuid, uuid, text, text, text) FROM PUBLIC, anon, authenticated;",
  );
  const grants = [...limpo.matchAll(/GRANT [^;]+;/g)].map((m) => m[0]);
  assertEquals(grants, [
    "GRANT EXECUTE ON FUNCTION public.cancelar_pedido_com_cobranca(uuid, uuid, text, text, text) TO service_role;",
  ]);
  // A ACL de update_order_status_atomic é herdada (CREATE OR REPLACE).
  assert(!/ON FUNCTION public\.update_order_status_atomic/.test(limpo));
});

Deno.test("a porta da edge confere service role, dono/admin ATUAL nas duas fontes e o CAS da vaga E do pagamento", () => {
  const c = norm(
    semComentarios(funcao(migration, "cancelar_pedido_com_cobranca")),
  );
  for (const trecho of [
    "IF COALESCE(current_setting('role', true), '') NOT IN ('postgres', 'service_role') THEN",
    "PERFORM 1 FROM public.order_refunds r WHERE r.order_id = p_order_id ORDER BY r.id FOR UPDATE; SELECT id, status, user_id, payment_status, gateway_payment_id, updated_at INTO v_pedido FROM public.marketplace_orders WHERE id = p_order_id FOR UPDATE;",
    "(u.raw_app_meta_data ->> 'role') = 'admin'",
    "p.role = 'admin'",
    "IF v_pedido.gateway_payment_id IS DISTINCT FROM p_vaga_esperada OR v_pedido.payment_status IS DISTINCT FROM p_pagamento_esperado THEN",
    "IF NOT v_ator_admin AND p_vaga_esperada LIKE 'verificando:%' THEN",
    "v_pedido.updated_at > now() - interval '2 minutes'",
    "public.pedido__mudar_status( p_order_id, 'cancelled', p_notes, p_ator, v_ator_admin, true );",
  ]) {
    assertStringIncludes(c, trecho);
  }
  // O CAS vem ANTES de qualquer efeito.
  assert(
    c.indexOf("p_vaga_esperada OR") < c.indexOf("public.pedido__mudar_status("),
  );
});

Deno.test("admin_devolucao_reemitir_reembolso é o corpo da 97 com SÓ a trava das linhas ANTES do pedido (ordem global)", () => {
  const trava = `  -- 20261198000000 (ORDEM GLOBAL DE TRAVAS): as linhas de order_refunds do
  -- pedido, por id, ANTES do pedido — a ordem de concluir_estorno,
  -- registrar_estorno_manual e do cancelamento. A 97 travava o pedido e só
  -- depois a linha recusada (abaixo): deadlock com quem trava na ordem certa.
  PERFORM 1
     FROM public.order_refunds r
    WHERE r.order_id = v_d.order_id
    ORDER BY r.id
      FOR UPDATE;

`;
  const ancora =
    "  SELECT * INTO v_o FROM public.marketplace_orders WHERE id = v_d.order_id FOR UPDATE;\n";
  const de97 = funcao(migration97, "admin_devolucao_reemitir_reembolso");
  assertEquals(de97.split(ancora).length, 2);
  assertEquals(
    funcao(migration, "admin_devolucao_reemitir_reembolso"),
    de97.replace(ancora, trava + ancora),
  );
  // A guarda da 97 continua lá.
  assertStringIncludes(
    funcao(migration, "admin_devolucao_reemitir_reembolso"),
    "IF NOT public.is_admin_atual() THEN",
  );
});

Deno.test("nenhuma migration POSTERIOR redefine as funções desta (esta não ressuscita corpo velho)", () => {
  const definem = (nomeDaFuncao) =>
    [...Deno.readDirSync(PASTA)]
      .map((e) => e.name)
      .filter((n) => /^\d+_.*\.sql$/.test(n) && !n.startsWith("rollback-"))
      .filter((n) => {
        const texto = norm(semComentarios(ler(n))).toLowerCase();
        return (
          texto.includes(`function public.${nomeDaFuncao}(`) ||
          texto.includes(`function ${nomeDaFuncao}(`)
        );
      })
      .sort();
  const definidoras = definem("update_order_status_atomic");
  assertEquals(definidoras[definidoras.length - 1], NOME);
  assert(definidoras.includes(NOME_80));
  for (const nome of NOVAS) assertEquals(definem(nome), [NOME]);
  const reemitir = definem("admin_devolucao_reemitir_reembolso");
  assertEquals(reemitir[reemitir.length - 1], NOME);
  assert(reemitir.includes(NOME_97));
});
