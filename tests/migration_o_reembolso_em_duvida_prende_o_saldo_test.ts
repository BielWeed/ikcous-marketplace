// @ts-nocheck
// O REEMBOLSO EM DUVIDA PRENDE O SALDO — prova offline do par 20261241000000 + rollback (dinheiro; lote R1 do plano
// reembolso-ab de 15/10/2026). O COMPORTAMENTO (saldo igual em pedido sem linha em duvida, a falhou legada prende, a
// substituida solta, a espera dos 7 dias antes/depois/com a marca, o autorizar recusa a linha liberada por fora,
// corrida de duas conexoes, ACL, aplicar 2x, rollback, mutantes) e' provado em tests/banco/reembolso-em-duvida-viva.cjs
// e o portao da release (consultas 43a/43b) em tests/banco/reembolso-em-duvida-portao-viva.cjs. Aqui fica o que se
// prova so lendo o texto: hashes, nenhum BEGIN/COMMIT, so objetos novos ou CREATE OR REPLACE de corpo conhecido, o
// rollback devolve os corpos VIGENTES, a regra unica e a espera unica, e o contrato do painel.
/* eslint-disable security/detect-non-literal-regexp, security/detect-object-injection --
 * As RegExp e as chaves vêm de constantes FIXAS deste arquivo (nomes de função e md5 conhecidos), nunca de entrada externa. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  avaliarFase0,
  detectarTransacaoExplicita,
  removerRuido,
} = require("../scripts/db-prove-rollback.cjs");

const DIR = new URL("../", import.meta.url);
const NOME = "20261241000000_o_reembolso_em_duvida_prende_o_saldo.sql";
const ler = (n) =>
  Deno.readTextFileSync(new URL(`supabase/migrations/${n}`, DIR)).replace(
    /\r\n/g,
    "\n",
  );
const migration = ler(NOME);
const rollback = ler(`rollback-manual-${NOME}`);
const md5 = (s) => createHash("md5").update(s).digest("hex");

/** O corpo (prosrc) de `public.<nome>(` no texto: entre `AS $tag$` e o `$tag$;` seguinte. */
function corpoDe(sql, nome) {
  const i = sql.indexOf(`CREATE OR REPLACE FUNCTION public.${nome}(`);
  assert.ok(i >= 0, `sem CREATE OR REPLACE FUNCTION public.${nome}(`);
  const m = /\nAS (\$[a-z_]*\$)/.exec(sql.slice(i));
  assert.ok(m, `sem AS $tag$ em ${nome}`);
  const a = i + m.index + m[0].length;
  const b = sql.indexOf(`${m[1]};`, a);
  assert.ok(b > a, `sem o fecho ${m[1]}; em ${nome}`);
  return sql.slice(a, b);
}

// As doze funcoes que a migration deixa (cinco novas, sete redefinidas), com o md5 da CONFERENCIA FINAL.
const DESTA = {
  order_refund__pode_ter_saido: "bdbb28b3d91588c8b10283d57bfb73d6",
  order_refund__liberavel_apos_espera: "cb37f24646fda24e1a51c8f01983e083",
  pedido__saldo_a_estornar: "99741b4cdbf1e8d8340f80440e6da094",
  solicitar_estorno: "840de50f44958fe43b55f5222691df9b",
  admin_devolucao_concluir: "ebb901efff59a53082836a13e053cd1a",
  autorizar_post_do_estorno: "c73e48294c08f34240abc3843aa7d1f1",
  reemitir_reembolso_da_devolucao: "fd5d79042efa68f9a17298fff1e950bd",
  admin_devolucao_reembolso_por_fora: "76eaffb4f9438f7fe557961e1bdaad81",
  devolucao_avisa_o_cliente: "56502b960dcf3e136c1d0d5c41091c20",
  admin_devolucao_reembolso_por_fora_apos_espera:
    "92dd1608d02ef5e9fd9fe34e0bd7c49f",
  registrar_estorno_manual_apos_espera: "7b1403e418b2d80d02db287444f8a0ef",
  pedido_reembolsos_e_saldo: "86dd0eaaaa571a4d5e85622e90442bc0",
};
// Os sete corpos VIGENTES (o que esta no ar antes dela) — o rollback os devolve byte a byte.
const VIGENTE = {
  pedido__saldo_a_estornar: "9579d2b56b57cf948659936a928dd7dc",
  solicitar_estorno: "069c3d12a470cc4708099d909c57ca02",
  admin_devolucao_concluir: "26080db4aeb82bdfb9fcd0c6f7169ebb",
  autorizar_post_do_estorno: "e128f7ad54ebc82c97b97af4aa7baa08",
  reemitir_reembolso_da_devolucao: "872fcb1d2bac9816e2d2b1c7c2e868c0",
  admin_devolucao_reembolso_por_fora: "0a7e06d7004c3fb70897e87c4dfa8cf9",
  devolucao_avisa_o_cliente: "2cd21f47021cafc15cae4ccd0c8c67e5",
};
const NOVAS = Object.keys(DESTA).filter((n) => !(n in VIGENTE));

Deno.test("avaliarFase0 nao recusa o par migration+rollback", () => {
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

Deno.test("nenhum arquivo do par abre ou fecha transacao de nivel superior (regra da casa: o aplicador abre a transacao)", () => {
  assert.deepEqual(
    detectarTransacaoExplicita(removerRuido(migration)).achados,
    [],
  );
  assert.deepEqual(
    detectarTransacaoExplicita(removerRuido(rollback)).achados,
    [],
  );
});

Deno.test("as doze funcoes: o corpo no texto tem o md5 da conferencia final (cinco novas, sete redefinidas)", () => {
  assert.equal(NOVAS.length, 5);
  for (const [nome, h] of Object.entries(DESTA)) {
    assert.equal(md5(corpoDe(migration, nome)), h, nome);
    assert.ok(
      new RegExp(
        `\\('public\\.${nome}\\([a-z,]*\\)', '[a-z]+', '[a-z]', '${h}'\\)`,
      ).test(migration),
      `${nome}: a conferencia final declara ${h}`,
    );
  }
  assert.equal(
    new Set(Object.values(DESTA)).size,
    12,
    "doze corpos diferentes",
  );
});

Deno.test("o pre-voo exige cada corpo VIGENTE (ou o DESTA, reaplicar) e o rollback devolve os sete corpos vigentes byte a byte", () => {
  for (const [nome, h] of Object.entries(VIGENTE)) {
    assert.ok(
      migration.includes(`', '${h}', '${DESTA[nome]}'),`) ||
        migration.includes(`', '${h}', '${DESTA[nome]}')`),
      `${nome}: o par (vigente, desta) no pre-voo`,
    );
    assert.equal(
      md5(corpoDe(rollback, nome)),
      h,
      `${nome}: o rollback devolve o vigente`,
    );
    assert.notEqual(h, DESTA[nome], `${nome}: a migration muda o corpo`);
  }
  // o rollback nao recria nenhuma das cinco novas: so as apaga
  for (const nome of NOVAS) {
    assert.ok(
      !rollback.includes(`CREATE OR REPLACE FUNCTION public.${nome}(`),
      `o rollback recria ${nome}`,
    );
    assert.ok(
      new RegExp(`DROP FUNCTION IF EXISTS public\\.${nome}\\(`).test(rollback),
      `o rollback apaga ${nome}`,
    );
  }
  assert.ok(
    rollback.includes("DROP TABLE IF EXISTS public.order_refund_prova"),
  );
  assert.ok(
    rollback.includes("MARCA_DE_REEMBOLSO_NAO_SE_APAGA_SEM_QUERER"),
    "o rollback recusa apagar marca de reembolso",
  );
});

Deno.test("so ADITIVA: uma tabela nova, doze CREATE OR REPLACE FUNCTION de nome conhecido, nenhum DROP, nenhum DML fora dos corpos", () => {
  let fora = migration;
  for (const nome of Object.keys(DESTA))
    fora = fora.replace(corpoDe(migration, nome), "");
  const limpo = removerRuido(fora).replace(/\s+/g, " ");
  const criadas = [
    ...limpo.matchAll(/CREATE OR REPLACE FUNCTION public\.([a-z_0-9]+)\(/g),
  ].map((m) => m[1]);
  assert.deepEqual(criadas.sort(), Object.keys(DESTA).sort());
  assert.deepEqual(
    [...limpo.matchAll(/CREATE TABLE (?:IF NOT EXISTS )?([a-z_.]+)/g)].map(
      (m) => m[1],
    ),
    ["public.order_refund_prova"],
  );
  assert.ok(!/\bDROP\b/.test(limpo), "a migration nao apaga nada");
  assert.ok(!/\bTRUNCATE\b/.test(limpo));
  // DML so dentro dos blocos DO (pre-voo e conferencia so leem) — fora deles e dos corpos, nada.
  const semDo = limpo.replace(/DO \$([a-z_0-9]+)\$.*?\$\1\$;/g, "");
  assert.ok(
    !/\b(INSERT INTO|UPDATE public\.|DELETE FROM)\b/.test(semDo),
    "DML fora dos corpos",
  );
  assert.ok(
    !/ALTER TABLE public\.(?!order_refund_prova )/.test(limpo),
    "ALTER de tabela existente",
  );
});

Deno.test("ACL: a tabela e as duas regras do servidor fechadas a todo papel; as tres portas do lojista so do logado; a porta antiga fecha ao logado", () => {
  assert.ok(
    migration.includes(
      "REVOKE ALL ON TABLE public.order_refund_prova FROM PUBLIC, anon, authenticated, service_role;",
    ),
  );
  assert.ok(
    migration.includes(
      "ALTER TABLE public.order_refund_prova ENABLE ROW LEVEL SECURITY;",
    ),
  );
  assert.ok(!/CREATE POLICY/.test(removerRuido(migration)));
  for (const sig of [
    "order_refund__pode_ter_saido(uuid)",
    "order_refund__liberavel_apos_espera(uuid)",
  ]) {
    assert.ok(
      migration.includes(
        `REVOKE ALL ON FUNCTION public.${sig} FROM PUBLIC, anon, authenticated, service_role;`,
      ),
      sig,
    );
    assert.ok(
      !new RegExp(
        `GRANT [A-Z ,]+ ON FUNCTION public\\.${sig.replace(/[()]/g, "\\$&")}`,
      ).test(migration),
      sig,
    );
  }
  for (const sig of [
    "admin_devolucao_reembolso_por_fora_apos_espera(uuid, uuid, text)",
    "registrar_estorno_manual_apos_espera(uuid, uuid, text)",
    "pedido_reembolsos_e_saldo(uuid)",
  ]) {
    assert.ok(
      migration.includes(
        `REVOKE ALL ON FUNCTION public.${sig} FROM PUBLIC, anon;`,
      ),
      sig,
    );
    assert.ok(
      migration.includes(
        `GRANT EXECUTE ON FUNCTION public.${sig} TO authenticated;`,
      ),
      sig,
    );
  }
  assert.ok(
    migration.includes(
      "REVOKE ALL ON FUNCTION public.admin_devolucao_reemitir_reembolso(uuid, boolean) FROM PUBLIC, anon, authenticated;",
    ),
  );
  // e o rollback devolve o EXECUTE do logado na porta antiga (o estado de antes)
  assert.ok(
    /GRANT EXECUTE ON FUNCTION public\.admin_devolucao_reemitir_reembolso\(uuid, boolean\) TO authenticated/.test(
      rollback,
    ),
  );
});

Deno.test("a regra UNICA (pode_ter_saido): o MP deu id -> true; substituida -> false; LEGADO marcado 2x -> true ANTES das regras do 'nada saiu'; o resto e' o lado seguro", () => {
  const c = corpoDe(migration, "order_refund__pode_ter_saido");
  const ordem = [
    "WHEN r.mp_refund_id IS NOT NULL THEN true",
    "WHEN pv.substituida_por_manual_em IS NOT NULL THEN false",
    "WHEN r.criada_sob_autorizacao IS NOT TRUE AND r.tentativas > 1 THEN true",
    "WHEN r.status = 'recusado' AND r.post_autorizado_em IS NULL THEN false",
    "WHEN r.status = 'falhou'",
    "ELSE true",
  ].map((t) => {
    const i = c.indexOf(t);
    assert.ok(i >= 0, t);
    return i;
  });
  assert.deepEqual(
    [...ordem].sort((a, b) => a - b),
    ordem,
    "a ordem dos passos",
  );
  assert.ok(
    c.includes(
      "dg.mp_codigo IN ('insufficient_money_for_refund', 'order_payment_not_yet_enabled_for_refund')",
    ),
  );
  // o saldo e o painel perguntam a ELA (nenhuma copia da regra)
  for (const nome of [
    "pedido__saldo_a_estornar",
    "pedido_reembolsos_e_saldo",
    "order_refund__liberavel_apos_espera",
  ]) {
    const corpo = corpoDe(migration, nome);
    assert.ok(
      corpo.includes("public.order_refund__pode_ter_saido(r.id)"),
      nome,
    );
    assert.ok(
      !corpo.includes("insufficient_money_for_refund"),
      `${nome} copia a lista do 'nada saiu'`,
    );
  }
  // solicitar e concluir descontam pela funcao do saldo
  for (const nome of ["solicitar_estorno", "admin_devolucao_concluir"])
    assert.ok(
      corpoDe(migration, nome).includes("public.pedido__saldo_a_estornar("),
      nome,
    );
});

Deno.test("a espera UNICA dos 7 dias (liberavel_apos_espera): 7 dias pelo now() do banco, sem a marca, nao substituida; as duas saidas e o painel leem ELA", () => {
  const c = corpoDe(migration, "order_refund__liberavel_apos_espera");
  for (const t of [
    "now() - COALESCE(r.post_autorizado_em, r.created_at) >= interval '7 days'",
    "AND pv.substituida_por_manual_em IS NULL",
    "AND pv.por_fora_liberado_em IS NULL",
    "r.status = 'em_processamento'",
    "(r.status = 'falhou' AND public.order_refund__pode_ter_saido(r.id))",
    "), false);",
  ])
    assert.ok(c.includes(t), t);
  assert.ok(
    !/clock_timestamp|statement_timestamp|current_date|localtimestamp/.test(c),
    "relogio que nao e' o now()",
  );
  for (const nome of [
    "admin_devolucao_reembolso_por_fora_apos_espera",
    "registrar_estorno_manual_apos_espera",
  ]) {
    const corpo = corpoDe(migration, nome);
    assert.ok(
      corpo.includes(
        "IF NOT public.order_refund__liberavel_apos_espera(v_r.id) THEN",
      ),
      nome,
    );
    assert.ok(
      !/>=\s*interval '7 days'/.test(corpo),
      `${nome} tem uma conta de 7 dias propria`,
    );
    assert.ok(corpo.includes("por_fora_liberado_em"), `${nome} grava a marca`);
    assert.ok(
      /upper\(/i.test(corpo) && corpo.includes("'DEVOLVI POR FORA'"),
      `${nome}: a frase de confirmacao`,
    );
    assert.ok(
      corpo.includes("public.is_admin_atual()"),
      `${nome}: so o admin atual`,
    );
  }
  assert.ok(
    corpoDe(migration, "pedido_reembolsos_e_saldo").includes(
      "'por_fora_apos_espera_liberado', public.order_refund__liberavel_apos_espera(r.id),",
    ),
  );
  // o autorizar recusa a linha liberada por fora
  assert.ok(
    corpoDe(migration, "autorizar_post_do_estorno").includes(
      "pv.por_fora_liberado_em IS NOT NULL",
    ),
  );
});

Deno.test("a saida dos 7 dias do pedido cancelado: re-trava as linhas depois do pedido; so a linha que cobre TODO o saldo estorna o pedido; a parcial so marca por fora e o saldo a conta como por fora", () => {
  const c = corpoDe(migration, "registrar_estorno_manual_apos_espera");
  const iPedido = c.indexOf(
    "SELECT * INTO v_o FROM public.marketplace_orders WHERE id = p_order_id FOR UPDATE;",
  );
  const iRelock = c.indexOf(
    "PERFORM 1 FROM public.order_refunds releitura WHERE releitura.order_id = p_order_id ORDER BY releitura.id FOR UPDATE;",
  );
  const iLinha = c.indexOf(
    "SELECT * INTO v_r FROM public.order_refunds WHERE id = p_refund_esperado;",
  );
  assert.ok(
    iPedido > 0 && iRelock > iPedido && iLinha > iRelock,
    "linhas -> pedido -> linhas de novo, antes de ler a linha",
  );
  const iParcial = c.indexOf(
    "IF round(v_r.amount, 2) < round(v_resta, 2) THEN",
  );
  const iEstornado = c.indexOf("SET payment_status = 'estornado'");
  const iRecusa = c.indexOf("SET status = 'recusado'");
  assert.ok(iParcial > 0, "a decisao parcial x total");
  assert.ok(
    iEstornado > iParcial && iRecusa > iParcial,
    "estornar e recusar as solicitadas so depois da decisao (so no total)",
  );
  const parcial = c.slice(iParcial, c.indexOf("END IF;", iParcial));
  assert.ok(parcial.includes("'detalhe', 'parcial'"));
  assert.ok(parcial.includes("'risco_de_dobro', true"));
  assert.ok(
    !parcial.includes("substituida_por_manual_em"),
    "a parcial nao marca substituida (o valor tem de seguir no saldo)",
  );
  assert.ok(!parcial.includes("estornado"), "a parcial nao estorna o pedido");
  // o que ja saiu por fora inclui a parcial anterior (a mesma parcela do saldo)
  assert.ok(
    c.includes(
      "AND pf.por_fora_liberado_em IS NOT NULL\n                                            AND pf.substituida_por_manual_em IS NULL), 0);",
    ),
  );
  const saldo = corpoDe(migration, "pedido__saldo_a_estornar");
  assert.ok(
    saldo.includes(
      "JOIN public.order_refund_prova pf ON pf.refund_id = r.id\n                      WHERE r.order_id = o.id\n                        AND pf.por_fora_liberado_em IS NOT NULL\n                        AND pf.substituida_por_manual_em IS NULL), 0)",
    ),
    "o saldo desconta o por fora parcial em qualquer status",
  );
});

Deno.test("o contrato do painel (pedido_reembolsos_e_saldo): os NOMES que o front le, nada de codigo do MP", () => {
  const c = corpoDe(migration, "pedido_reembolsos_e_saldo");
  const linha = c.slice(
    c.indexOf("jsonb_agg(jsonb_build_object("),
    c.indexOf(") ORDER BY r.created_at, r.id)"),
  );
  assert.deepEqual(
    [...linha.matchAll(/'([a-z_]+)', /g)].map((m) => m[1]),
    [
      "id",
      "status",
      "amount",
      "pode_ter_saido",
      "por_fora_liberado_em",
      "por_fora_apos_espera_liberado",
      "substituida_por_manual",
      "eh_pix",
    ],
  );
  assert.ok(
    linha.includes(
      "'substituida_por_manual', pv.substituida_por_manual_em IS NOT NULL,",
    ),
    "a linha diz se foi substituida por manual",
  );
  const topo = c.slice(c.indexOf("RETURN jsonb_build_object("));
  assert.deepEqual(
    [...topo.matchAll(/'([a-z_]+)', /g)].map((m) => m[1]),
    [
      "total",
      "valor_estornado",
      "em_voo",
      "em_duvida",
      "manual",
      "disponivel",
      "reservado_por_fora",
      "linhas",
    ],
  );
  // o reservado: linha resolvida por fora ainda viva no MP (os status de em voo)
  assert.ok(
    c.includes("JOIN public.order_refund_prova pr ON pr.refund_id = r.id"),
  );
  assert.ok(c.includes("AND pr.por_fora_liberado_em IS NOT NULL"));
  // o em duvida do painel nao conta a linha por fora (ela ja conta como por fora no manual)
  assert.ok(
    c.includes(
      "     AND NOT EXISTS (SELECT 1\n                       FROM public.order_refund_prova pf\n                      WHERE pf.refund_id = r.id\n                        AND pf.por_fora_liberado_em IS NOT NULL)\n",
    ),
  );
  assert.ok(
    topo.includes(
      "'disponivel', GREATEST(public.pedido__saldo_a_estornar(p_order_id), 0)",
    ),
    "o disponivel E' o saldo, nunca negativo",
  );
  assert.ok(
    !/mp_codigo|order_refund_diagnostico|ultimo_erro|mp_refund_id/.test(c),
    "o painel le codigo do MP",
  );
  assert.ok(
    c.includes("IF auth.uid() IS NULL OR NOT public.is_admin_atual() THEN"),
  );
});

Deno.test("a sucessora 343 restaura a 241 antes de desfazer a cadeia e preserva a chamada unica", () => {
  const m = ler("20261343000000_o_reembolso_manual_respeita_a_reserva.sql");
  const rb = ler("rollback-manual-20261343000000_o_reembolso_manual_respeita_a_reserva.sql");
  assert.equal(corpoDe(rb, "admin_devolucao_concluir"), corpoDe(migration, "admin_devolucao_concluir"));
  assert.equal(corpoDe(m, "admin_devolucao_concluir").split("public.pedido__saldo_a_estornar(v_o.id)").length - 1, 1);
  const helper = Deno.readTextFileSync(new URL("tests/banco/reembolso-em-duvida-posterior.cjs", DIR));
  assert.ok(helper.indexOf("desfazerReembolsoManualReservaNaTransacao") < helper.indexOf("cliente.query(REEMBOLSO_EM_DUVIDA.noAr)"));
});

Deno.test("os tipos do front (database.types.ts) declaram a tabela e as funcoes novas", () => {
  const tipos = Deno.readTextFileSync(
    new URL("src/types/database.types.ts", DIR),
  );
  for (const t of ["order_refund_prova:", ...NOVAS.map((n) => `${n}:`)])
    assert.ok(tipos.includes(t), t);
});
