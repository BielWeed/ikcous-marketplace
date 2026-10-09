// @ts-nocheck
// A VENDA DO BALCAO SE ANULA NO MESMO DIA — prova offline do par
// 20261204000000 + rollback (dinheiro + estoque + permissao, 08/10/2026). A prova
// VIVA (permissao, escopo, mesmo dia, devolucao/estorno, motivo, idempotencia,
// concorrencia, Financeiro e caixa, rollback aplicado, mutantes) mora em
// tests/banco/anular-venda-viva.cjs; aqui fica o que se prova so lendo o texto, e
// que o CI sem banco tambem cobra.
//
// Cada assercao esta amarrada a um risco: migration com BEGIN/COMMIT grava
// metade em producao; hash do preflight/rollback que nao e o real do corpo recusa
// a migration num banco CORRETO (ou aceita um corpo errado); md5 de dependencia
// desatualizado quebra a migration quando ela for aplicada; guarda fora de ordem
// (ler antes de checar o admin, checar o estado antes da trava) vaza a existencia
// da venda ou abre janela de corrida; GRANT para anon/PUBLIC/service_role abre a
// anulacao a quem nao e da loja; escrita fora da funcao faz a migration mexer em
// dado ao aplicar.
import { createRequire } from "node:module";
import { fromFileUrl } from "https://deno.land/std@0.177.0/path/mod.ts";
import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.177.0/testing/asserts.ts";

const require = createRequire(import.meta.url);
const {
  detectarTransacaoExplicita,
  removerRuido,
} = require("../scripts/db-prove-rollback.cjs");
const { createHash } = require("node:crypto");

const DIR = fromFileUrl(new URL(".", import.meta.url));
const PASTA = `${DIR}../supabase/migrations`;
const NOME = "20261204000000_a_venda_do_balcao_se_anula_no_mesmo_dia.sql";

const ler = (n) =>
  Deno.readTextFileSync(`${PASTA}/${n}`).replace(/\r\n/g, "\n");
const migration = ler(NOME);
const rollback = ler(`rollback-manual-${NOME}`);

const sha256 = (s) => createHash("sha256").update(s, "utf8").digest("hex");
const md5 = (s) => createHash("md5").update(s, "utf8").digest("hex");
const crlf = (s) => s.replace(/\n/g, "\r\n");
const semComentarios = (s) =>
  s
    .split("\n")
    .filter((l) => !/^\s*--/.test(l))
    .join("\n");

const CABECALHO =
  "CREATE OR REPLACE FUNCTION public.anular_venda_presencial(p_order_id uuid, p_motivo text)";
const iniFn = migration.indexOf(CABECALHO);
assert(iniFn > 0, "nao achei a funcao na migration");
const abre = migration.indexOf("AS $function$", iniFn) + "AS $function$".length;
const fecha = migration.indexOf("$function$;", abre);
const corpo = migration.slice(abre, fecha);
const foraDoCorpo = migration.slice(0, abre) + migration.slice(fecha);

// O corpo de uma funcao dentro de uma migration, entre `AS $tag$` e `$tag$`.
function corpoDe(texto, assinatura) {
  const ini = texto.indexOf(assinatura);
  assert(ini >= 0, `nao achei ${assinatura}`);
  const m = /AS (\$[a-z_]*\$)/.exec(texto.slice(ini));
  assert(m, `sem AS $...$ depois de ${assinatura}`);
  const a = ini + m.index + m[0].length;
  return texto.slice(a, texto.indexOf(m[1], a));
}
// A ULTIMA migration (por nome) que define a funcao: e' o corpo vivo numa arvore limpa.
function ultimaDefinicao(assinatura) {
  const arquivos = [...Deno.readDirSync(PASTA)]
    .map((e) => e.name)
    .filter((n) => n.endsWith(".sql") && !n.startsWith("rollback-"))
    .sort();
  let ultimo = null;
  for (const n of arquivos)
    if (ler(n).includes(assinatura)) ultimo = n;
  assert(ultimo, `nenhuma migration define ${assinatura}`);
  return { nome: ultimo, texto: ler(ultimo) };
}

Deno.test("204: sem BEGIN/COMMIT de nivel superior (migration e rollback)", () => {
  assertEquals(detectarTransacaoExplicita(removerRuido(migration)).achados, []);
  assertEquals(detectarTransacaoExplicita(removerRuido(rollback)).achados, []);
});

Deno.test("204: o md5 do preflight e o do corpo desta migration (sem CR)", () => {
  const h = md5(corpo.replace(/\r/g, ""));
  assertStringIncludes(migration, `v_hash <> '${h}'`);
  // e nao aceita outro hash para "ja existe": so este.
  assertEquals([...migration.matchAll(/v_hash <> '([0-9a-f]{32})'/g)].length, 1);
});

Deno.test("204: os hashes do rollback sao o sha256 real do corpo (LF e CRLF) e so eles", () => {
  const lit = [...semComentarios(rollback).matchAll(/'([0-9a-f]{64})'/g)].map(
    (m) => m[1],
  );
  assertEquals(lit, [sha256(corpo), sha256(crlf(corpo))]);
});

Deno.test("204: o md5 das duas dependencias do preflight e o do corpo da ULTIMA migration que as define", () => {
  const casos = [
    ["public.is_admin_atual()", "FUNCTION public.is_admin_atual()"],
    [
      "public.pedido__mudar_status(uuid, text, text, uuid, boolean, boolean)",
      "FUNCTION public.pedido__mudar_status(",
    ],
  ];
  for (const [assinaturaNoPreflight, trecho] of casos) {
    const { nome, texto } = ultimaDefinicao(trecho);
    const h = md5(corpoDe(texto, trecho).replace(/\r/g, ""));
    assertStringIncludes(
      migration,
      `('${assinaturaNoPreflight}', '${h}')`,
      `o preflight nao tem o md5 do corpo de ${assinaturaNoPreflight} (ultima definicao: ${nome})`,
    );
  }
});

Deno.test("204: a funcao e SECURITY DEFINER com search_path fixo, e o EXECUTE e so do authenticated", () => {
  const m = semComentarios(foraDoCorpo);
  assert(
    /RETURNS jsonb\n LANGUAGE plpgsql\n SECURITY DEFINER\n SET search_path = public\nAS \$function\$/.test(
      migration,
    ),
  );
  assertStringIncludes(
    m,
    "REVOKE ALL ON FUNCTION public.anular_venda_presencial(uuid, text) FROM PUBLIC, anon, authenticated, service_role;",
  );
  assertStringIncludes(
    m,
    "GRANT EXECUTE ON FUNCTION public.anular_venda_presencial(uuid, text) TO authenticated;",
  );
  const grants = [...m.matchAll(/\bGRANT\b[^;]*;/g)].map((x) => x[0]);
  assertEquals(grants.length, 1);
  assert(!/\b(anon|PUBLIC|service_role)\b/.test(grants[0]));
  // o REVOKE vem antes do GRANT (na ordem inversa o GRANT seria desfeito)
  assert(m.indexOf("REVOKE ALL ON FUNCTION") < m.indexOf("GRANT EXECUTE ON FUNCTION"));
});

Deno.test("204: as guardas vem NESTA ordem — admin, admin de agora, sessao, motivo, trava do ledger, trava do pedido, canal, ja anulada, estado, dia, devolucao, ledger, so ENTAO escreve", () => {
  const c = semComentarios(corpo);
  const ordem = [
    "public.is_admin() IS DISTINCT FROM true",
    "public.is_admin_atual() IS DISTINCT FROM true",
    "v_usuario := auth.uid();",
    "v_motivo := NULLIF(btrim(",
    "char_length(v_motivo) > 500",
    "FROM public.order_refunds r\n      WHERE r.order_id = p_order_id\n      ORDER BY r.id\n        FOR UPDATE;",
    "FROM public.marketplace_orders o\n     WHERE o.id = p_order_id\n       FOR UPDATE;",
    "v_pedido.canal IS DISTINCT FROM 'presencial'",
    "v_pedido.status = 'cancelled' AND v_pedido.payment_status = 'estornado'",
    "v_pedido.status IS DISTINCT FROM 'delivered'",
    "public.fin__dia(v_pedido.pagamento_recebido_em) IS DISTINCT FROM public.fin__hoje()",
    "FROM public.devolucoes d",
    "r.status IN ('solicitado', 'em_processamento', 'concluido')",
    "PERFORM public.pedido__mudar_status(",
    "SET payment_status = 'estornado'",
    "INSERT INTO public.marketplace_order_payment_history",
  ];
  let ant = -1;
  for (const trecho of ordem) {
    const i = c.indexOf(trecho);
    assert(i > ant, `fora de ordem (ou ausente): ${trecho}`);
    ant = i;
  }
  // Nenhuma ESCRITA antes da ultima guarda (o que vem antes do PERFORM so le).
  const antesDeEscrever = c.slice(0, c.indexOf("PERFORM public.pedido__mudar_status("));
  assert(!/\b(UPDATE|DELETE|INSERT)\b/.test(antesDeEscrever.replace(/\bFOR UPDATE\b/g, "")));
});

Deno.test("204: o motivo tira espaco, tab, quebra de linha e NBSP; recusa vazio e acima de 500", () => {
  const c = semComentarios(corpo);
  assertStringIncludes(c, "btrim(COALESCE(p_motivo, ''), E' \\t\\r\\n\\f\\x0b\\u00a0')");
  assertStringIncludes(c, "ERRCODE='22023', MESSAGE='Informe o motivo para anular a venda.'");
  assertStringIncludes(c, "char_length(v_motivo) > 500");
});

Deno.test("204: o cancelamento e o do app (pedido__mudar_status) com o ator da sessao e o admin DE AGORA, sem reabrir estorno", () => {
  const c = semComentarios(corpo);
  assert(
    /PERFORM public\.pedido__mudar_status\(\s*p_order_id, 'cancelled', 'Venda do balcão anulada: ' \|\| v_motivo,\s*v_usuario, public\.is_admin_atual\(\), false\s*\);/.test(
      c,
    ),
  );
  // a unica escrita direta no pedido marca o estorno, nunca zera o pagamento recebido nem mexe no total
  const updates = [...c.matchAll(/UPDATE public\.marketplace_orders[\s\S]*?WHERE id = p_order_id;/g)].map((m) => m[0]);
  assertEquals(updates.length, 1);
  assert(!/pagamento_recebido_em\s*=|valor_estornado\s*=|\btotal\s*=/.test(updates[0]));
  assertStringIncludes(updates[0], "estorno_manual_registrado_em = COALESCE(estorno_manual_registrado_em, now())");
});

Deno.test("204: aditiva — fora do corpo da funcao a migration nao escreve dado, nao apaga nada e nao mexe em tabela", () => {
  const m = semComentarios(foraDoCorpo);
  assert(
    !/\bDROP\s+(TABLE|COLUMN|TRIGGER|FUNCTION|VIEW|INDEX|POLICY|SCHEMA)\b/i.test(m),
    "migration tem DROP",
  );
  assert(!/\bALTER\s+(TABLE|POLICY)\b/i.test(m), "migration altera tabela/politica");
  assert(!/\bDELETE\b|\bTRUNCATE\b/i.test(m), "migration apaga dado");
  // INSERT/UPDATE so existem dentro do corpo da funcao (o preflight so le)
  assert(!/\bINSERT\s+INTO\b|\bUPDATE\s+public\b/i.test(m), "migration escreve dado fora da funcao");
  // o preflight roda ANTES de a funcao ser criada
  assert(migration.indexOf("$preflight_20261204$") < migration.indexOf(CABECALHO));
});

Deno.test("204: o rollback so derruba a funcao, com guarda de hash, sem CASCADE e sem tocar grant nem dado", () => {
  const r = semComentarios(rollback);
  assert(/DROP FUNCTION IF EXISTS public\.anular_venda_presencial\(uuid, text\);/.test(r));
  assertEquals([...r.matchAll(/\bDROP\b/gi)].length, 1);
  assert(!/CASCADE/i.test(r), "rollback com CASCADE");
  assert(!/\bGRANT\b|\bREVOKE\b|\bUPDATE\b|\bDELETE\b|\bINSERT\b/i.test(r));
  // a guarda vem antes do DROP
  assert(r.indexOf("RAISE EXCEPTION") < r.indexOf("DROP FUNCTION"));
});

Deno.test("204: a mensagem de dia passado e a frase que a tela reconhece", () => {
  assertStringIncludes(
    corpo,
    "Só dá para anular no mesmo dia da venda. Para outro dia, registre uma devolução.",
  );
  assertStringIncludes(corpo, "Esta venda não pode ser anulada aqui.");
});
