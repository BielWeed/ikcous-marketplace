import { createHash } from "node:crypto";
// @ts-nocheck
// A FOTO DA COBRANCA NO CANCELAMENTO -- prova offline do par 20261209000000 + rollback
// (cupom; peca 1 de 2 de "o cupom preso depois de cancelar com o PIX gerado volta em minutos";
// 09/10/2026). A prova VIVA (foto em todos os caminhos reais de cancelamento, recancelar,
// reativar, acesso de fora, cancelamentos simultaneos, envelope REPEATABLE READ de producao,
// ida e volta, mutantes) mora em tests/banco/cupom-pix-anulado-viva.cjs; aqui fica o que se
// prova so lendo o texto, e que o CI sem banco tambem cobra.
//
// Cada asserção esta amarrada a um risco: migration com BEGIN/COMMIT grava metade em producao;
// `LOCK` simples espera na fila e para o checkout inteiro atras da migration; DROP ou escrita de
// dado numa migration que so cria objetos novos; funcao do gatilho sem SECURITY DEFINER nao
// grava quando quem cancela nao tem privilegio na tabela; tabela sem RLS ou com privilegio para
// os papeis do Supabase vaza a foto; gatilho sem o WHEN regrava a foto a cada UPDATE de status;
// hash do corpo desencontrado do corpo faz a migration recusar a si mesma.
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

const DIR = fromFileUrl(new URL(".", import.meta.url));
const RAIZ = `${DIR}..`;
const PASTA = `${RAIZ}/supabase/migrations`;
const NOME = "20261209000000_a_foto_da_cobranca_no_cancelamento.sql";
const lerLF = (caminho) =>
  Deno.readTextFileSync(caminho).replace(/\r\n/g, "\n");
const ler = (n) => lerLF(`${PASTA}/${n}`);
const migration = ler(NOME);
const rollback = ler(`rollback-manual-${NOME}`);

const sha = (s) => createHash("sha256").update(s, "utf8").digest("hex");
const semComentarios = (s) =>
  s
    .split("\n")
    .filter((l) => !/^\s*--/.test(l))
    .join("\n");
const semLiterais = (s) => s.replace(/'(?:[^']|'')*'/g, "''");
const codigo = (s) => semLiterais(semComentarios(s));
const compacto = (s) => s.replace(/\s+/g, " ");
const ini = (t, s = migration) => {
  const i = s.indexOf(t);
  assert(i >= 0, `nao achei ${t}`);
  return i;
};

Deno.test("209: sem BEGIN/COMMIT de nivel superior, tudo em ASCII, e a Fase 0 da prova de rollback nao recusa o par", () => {
  assertEquals(detectarTransacaoExplicita(removerRuido(migration)).achados, []);
  assertEquals(detectarTransacaoExplicita(removerRuido(rollback)).achados, []);
  for (const t of [migration, rollback])
    assert(
      [...t].every((ch) => ch.charCodeAt(0) < 128),
      "caractere fora de ASCII",
    );
  const f0 = avaliarFase0({
    sqlMigration: migration,
    sqlRollback: rollback,
    temRollback: true,
  });
  assertEquals(f0.motivos, []);
  assertEquals(f0.recusado, false);
});

Deno.test("209: nome da versao: o rollback e o irmao e nenhuma outra migration usa a versao", () => {
  const nomes = [...Deno.readDirSync(PASTA)]
    .map((e) => e.name)
    .filter((n) => n.endsWith(".sql") && !n.startsWith("rollback-"));
  assertEquals(
    nomes.filter((n) => n.startsWith("20261209000000")),
    [NOME],
  );
  assert(
    [...Deno.readDirSync(PASTA)].some(
      (e) => e.name === `rollback-manual-${NOME}`,
    ),
  );
});

Deno.test("209: a ordem e trava de tempo -> pre-voo (com a trava primeiro) -> pecas -> pos-voo", () => {
  const c = semComentarios(migration);
  const ordem = [
    "SET LOCAL lock_timeout",
    "SET LOCAL statement_timeout",
    "DO $preflight_20261209$",
    "CREATE TABLE IF NOT EXISTS public.pedido_cobranca_ao_cancelar",
    "ENABLE ROW LEVEL SECURITY",
    "REVOKE ALL ON TABLE public.pedido_cobranca_ao_cancelar",
    "CREATE OR REPLACE FUNCTION public.pedido__foto_da_cobranca_ao_cancelar",
    "REVOKE ALL ON FUNCTION public.pedido__foto_da_cobranca_ao_cancelar",
    "CREATE OR REPLACE TRIGGER tr_pedido_foto_da_cobranca_ao_cancelar",
    "DO $posvoo_20261209$",
  ].map((t) => c.indexOf(t));
  assert(
    ordem.every((i) => i >= 0),
    JSON.stringify(ordem),
  );
  assertEquals(
    [...ordem].sort((a, b) => a - b),
    ordem,
  );
  // a trava vem antes de QUALQUER leitura do catalogo que decide (so a existencia da tabela a antecede)
  const pre = c.slice(
    c.indexOf("DO $preflight_20261209$"),
    c.indexOf("$preflight_20261209$;"),
  );
  const iLock = pre.indexOf("LOCK TABLE");
  assert(iLock > 0);
  for (const leitura of [
    "FROM pg_attribute",
    "FROM pg_constraint",
    "FROM pg_proc",
    "FROM pg_trigger",
    "FROM pg_policy",
  ])
    assert(pre.indexOf(leitura) > iLock, `${leitura} antes da trava`);
});

Deno.test("209: a trava e SHARE ROW EXCLUSIVE por NOWAIT em laco curto (4 s), nunca `LOCK` que espera na fila", () => {
  const c = semComentarios(migration);
  assertEquals(c.match(/\bLOCK TABLE\b/g).length, 1);
  assertStringIncludes(
    c,
    "LOCK TABLE public.marketplace_orders IN SHARE ROW EXCLUSIVE MODE NOWAIT;",
  );
  assert(
    !/ACCESS EXCLUSIVE/.test(c),
    "so o CREATE TRIGGER e a FK pedem a tabela; nada pede mais que SHARE ROW EXCLUSIVE",
  );
  const laco = compacto(c.slice(c.indexOf("  LOOP"), c.indexOf("  END LOOP;")));
  for (const t of [
    "EXCEPTION WHEN lock_not_available THEN",
    "v_tentativa := v_tentativa + 1;",
    "IF v_tentativa >= 40 THEN",
    "USING ERRCODE = 'lock_not_available'",
    "PERFORM pg_sleep(0.1);",
    "EXIT;",
  ])
    assertStringIncludes(laco, t);
  // 40 x 100 ms = 4 s, e e o que a mensagem diz
  assertStringIncludes(c, "ficou ocupada por mais de 4 s");
  for (const frase of [
    "NOWAIT",
    "SHARE ROW EXCLUSIVE",
    "55P03",
    "lock_timeout",
    "REPEATABLE READ",
    "40P01",
    "FORA DO HORARIO DE PICO",
  ])
    assertStringIncludes(migration, frase);
});

Deno.test("209: ADITIVA: so cria objetos novos (tabela, funcao, gatilho); nenhum DROP, nenhuma escrita de dado, nenhum GRANT", () => {
  const c = codigo(migration);
  assert(!/\bDROP\b/i.test(c), "migration aditiva nao apaga nada");
  // (as unicas ocorrencias de UPDATE/DELETE sao o DO UPDATE do upsert, o gatilho AFTER UPDATE OF
  // status e o ON DELETE CASCADE da FK: nenhuma e comando de escrita)
  const semFormas = c
    .replace(/ON CONFLICT[\s\S]*?DO UPDATE\s+SET/g, "")
    .replace(/AFTER UPDATE OF/g, "")
    .replace(/ON DELETE CASCADE/g, "");
  assert(
    !/\b(DELETE|TRUNCATE|UPDATE|GRANT)\b/i.test(semFormas),
    "so cria objeto novo",
  );
  assert(!/CREATE\s+POLICY/i.test(c), "a tabela nao tem politica");
  // o unico INSERT e o da funcao do gatilho, na tabela nova
  assertEquals(c.match(/\bINSERT\b/gi).length, 1);
  assertStringIncludes(c, "INSERT INTO public.pedido_cobranca_ao_cancelar");
  // o unico ALTER TABLE e o da tabela NOVA
  assertEquals(c.match(/\bALTER\b/gi).length, 1);
  assertStringIncludes(
    c,
    "ALTER TABLE public.pedido_cobranca_ao_cancelar ENABLE ROW LEVEL SECURITY;",
  );
  // so UMA funcao e criada e nenhuma outra e redefinida
  assertEquals(
    [...migration.matchAll(/CREATE OR REPLACE FUNCTION ([a-z_.]+)/g)].map(
      (m) => m[1],
    ),
    ["public.pedido__foto_da_cobranca_ao_cancelar"],
  );
  assert(
    !/create_marketplace_order_v2[34]|cancelar_pedido_com_cobranca|pedido__mudar_status|cupom__vaga_volta_em|devolver_cupons_de_pedidos_mortos/.test(
      c,
    ),
    "nao redefine nenhuma funcao existente",
  );
  // o pedido so e tocado por LOCK, pela FK da tabela nova e pelo gatilho
  const toques = [...c.matchAll(/public\.marketplace_orders/g)].length;
  assert(toques >= 3);
});

Deno.test("209: a tabela: forma exata, RLS ligada, sem politica, REVOKE dos quatro papeis; a funcao: SECURITY DEFINER, search_path, sem EXECUTE de fora, ON CONFLICT DO UPDATE e NAO engole erro", () => {
  const c = compacto(semComentarios(migration));
  assertStringIncludes(
    c,
    "CREATE TABLE IF NOT EXISTS public.pedido_cobranca_ao_cancelar ( order_id uuid PRIMARY KEY REFERENCES public.marketplace_orders (id) ON DELETE CASCADE, gateway_payment_id text, tentativas integer NOT NULL, metodo_online text, payment_status text, cancelado_em timestamptz NOT NULL DEFAULT now() );",
  );
  assertStringIncludes(
    c,
    "REVOKE ALL ON TABLE public.pedido_cobranca_ao_cancelar FROM PUBLIC, anon, authenticated, service_role;",
  );
  assertStringIncludes(
    c,
    "REVOKE ALL ON FUNCTION public.pedido__foto_da_cobranca_ao_cancelar() FROM PUBLIC, anon, authenticated, service_role;",
  );
  const fn = compacto(
    migration.slice(
      ini(
        "CREATE OR REPLACE FUNCTION public.pedido__foto_da_cobranca_ao_cancelar",
      ),
      ini("$foto_da_cobranca$;"),
    ),
  );
  assertStringIncludes(
    fn,
    "RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public",
  );
  assertStringIncludes(fn, "ON CONFLICT (order_id) DO UPDATE");
  for (const col of [
    "gateway_payment_id = EXCLUDED.gateway_payment_id",
    "tentativas = EXCLUDED.tentativas",
    "metodo_online = EXCLUDED.metodo_online",
    "payment_status = EXCLUDED.payment_status",
    "cancelado_em = EXCLUDED.cancelado_em",
  ])
    assertStringIncludes(fn, col);
  // valores do NEW (o estado DEPOIS do UPDATE), nunca do OLD
  assertStringIncludes(
    fn,
    "VALUES (NEW.id, NEW.gateway_payment_id, NEW.tentativas_de_pagamento, NEW.metodo_online, NEW.payment_status, now())",
  );
  assert(!/\bOLD\./.test(fn), "a foto e do NEW");
  // nao engole o erro: sem EXCEPTION no corpo
  assert(
    !/\bEXCEPTION\b/i.test(fn),
    "o gatilho nao pode engolir erro (foto velha em silencio)",
  );
});

Deno.test("209: o gatilho e AFTER UPDATE OF status, por linha, com o WHEN que so deixa passar a transicao para cancelled", () => {
  const c = compacto(semComentarios(migration));
  assertStringIncludes(
    c,
    "CREATE OR REPLACE TRIGGER tr_pedido_foto_da_cobranca_ao_cancelar AFTER UPDATE OF status ON public.marketplace_orders FOR EACH ROW WHEN (NEW.status = 'cancelled' AND OLD.status IS DISTINCT FROM 'cancelled') EXECUTE FUNCTION public.pedido__foto_da_cobranca_ao_cancelar();",
  );
});

Deno.test("209: o hash do corpo escrito na migration e no rollback e o sha256 do corpo real (LF e CRLF)", () => {
  const tag = "$foto_da_cobranca$";
  const a = ini(`AS ${tag}`) + `AS ${tag}`.length;
  const corpo = migration.slice(a, migration.indexOf(`${tag};`, a));
  const lf = sha(corpo);
  const crlf = sha(corpo.replace(/\n/g, "\r\n"));
  for (const [rot, texto] of [
    ["migration", migration],
    ["rollback", rollback],
  ]) {
    assertStringIncludes(texto, `'${lf}'`, `${rot}: hash LF`);
    assertStringIncludes(texto, `'${crlf}'`, `${rot}: hash CRLF`);
    assert(!texto.includes("@@HASH"), `${rot}: marcador de hash sobrou`);
  }
  // 2 usos na migration (pre-voo e pos-voo) e 1 no rollback
  assertEquals(migration.split(`'${lf}'`).length - 1, 2);
  assertEquals(rollback.split(`'${lf}'`).length - 1, 1);
});

Deno.test("209: o pre-voo recusa por cada condicao, com o NOME do motivo e dizendo que nada foi gravado", () => {
  const pre = migration.slice(
    ini("DO $preflight_20261209$"),
    ini("$preflight_20261209$;"),
  );
  for (const frase of [
    "PREFLIGHT_20261209: falta a tabela public.marketplace_orders",
    "PREFLIGHT_20261209: public.marketplace_orders ficou ocupada por mais de 4 s",
    "PREFLIGHT_20261209: public.marketplace_orders.% (%) ausente ou em outra forma",
    "PREFLIGHT_20261209: public.pedido_cobranca_ao_cancelar apareceu agora",
    "PREFLIGHT_20261209: ja existe public.pedido_cobranca_ao_cancelar com outra forma de colunas",
    "PREFLIGHT_20261209: public.pedido_cobranca_ao_cancelar nao tem a chave primaria em order_id",
    "PREFLIGHT_20261209: public.pedido_cobranca_ao_cancelar nao tem a chave estrangeira para marketplace_orders com ON DELETE CASCADE",
    "PREFLIGHT_20261209: public.pedido_cobranca_ao_cancelar tem politica de seguranca por linha",
    "PREFLIGHT_20261209: ja existe public.pedido__foto_da_cobranca_ao_cancelar com outra assinatura",
    "PREFLIGHT_20261209: public.pedido__foto_da_cobranca_ao_cancelar() tem corpo diferente do desta migration",
    "PREFLIGHT_20261209: ja existe o gatilho tr_pedido_foto_da_cobranca_ao_cancelar",
  ])
    assertEquals(pre.split(`RAISE EXCEPTION '${frase}`).length - 1, 1, frase);
  for (const m of pre.matchAll(/RAISE EXCEPTION '([^']*)'/g))
    if (!m[1].includes("falta a tabela"))
      assertStringIncludes(m[1], "nada foi gravado");
  assertEquals(
    migration.split("RAISE EXCEPTION 'POSVOO_20261209").length - 1,
    6,
  );
  // as colunas que o gatilho le sao as que o pre-voo confere
  const cols = compacto(pre);
  for (const t of [
    "('id', 'uuid')",
    "('status', 'text')",
    "('gateway_payment_id', 'text')",
    "('tentativas_de_pagamento', 'integer')",
    "('metodo_online', 'text')",
    "('payment_status', 'text')",
  ])
    assertStringIncludes(cols, t);
});

Deno.test("209: a forma da tabela conferida no pre-voo da migration e no rollback e a mesma do CREATE TABLE", () => {
  const forma =
    "order_id:uuid:true:,gateway_payment_id:text:false:,tentativas:integer:true:,metodo_online:text:false:,payment_status:text:false:,cancelado_em:timestamp with time zone:true:now()";
  assertEquals(migration.split(`'${forma}'`).length - 1, 1);
  assertEquals(rollback.split(`'${forma}'`).length - 1, 1);
  // e o gatilho esperado tem a mesma definicao no pre-voo e no pos-voo
  const quando =
    "new.status=''cancelled''::textandold.statusisdistinctfrom''cancelled''::text";
  assertEquals(migration.split(quando).length - 1, 2);
  assertEquals(migration.split("t.tgtype = 17").length - 1, 2);
});

Deno.test("209: o rollback so apaga os tres objetos da migration, sem CASCADE, com a trava NOWAIT, o retorno de quem ja foi desfeito e a conferencia final", () => {
  const c = semComentarios(rollback);
  const k = codigo(rollback);
  assertEquals(
    [...k.matchAll(/\bDROP (TRIGGER|FUNCTION|TABLE)\b/gi)].map((m) =>
      m[1].toUpperCase(),
    ),
    ["TRIGGER", "FUNCTION", "TABLE"],
  );
  assert(
    !/CASCADE/i.test(k),
    "CASCADE levaria o dependente que o pre-voo nao viu",
  );
  assert(
    !/\b(DELETE|TRUNCATE|UPDATE|INSERT|GRANT|CREATE)\b/i.test(k),
    "o rollback so apaga",
  );
  assertStringIncludes(
    c,
    "LOCK TABLE public.marketplace_orders IN ACCESS EXCLUSIVE MODE NOWAIT;",
  );
  assertEquals(c.match(/\bLOCK TABLE\b/g).length, 1);
  assertStringIncludes(
    c,
    "RETURN; -- ja desfeito: nada a conferir nem a apagar",
  );
  // o retorno do ja-desfeito vem ANTES da trava
  assert(c.indexOf("RETURN; -- ja desfeito") < c.indexOf("LOCK TABLE"));
  // ordem: preflight -> drops -> verificacao
  const ordem = [
    "DO $rollback_preflight_20261209$",
    "DROP TRIGGER IF EXISTS tr_pedido_foto_da_cobranca_ao_cancelar ON public.marketplace_orders;",
    "DROP FUNCTION IF EXISTS public.pedido__foto_da_cobranca_ao_cancelar();",
    "DROP TABLE IF EXISTS public.pedido_cobranca_ao_cancelar;",
    "DO $verifica_rollback_20261209$",
  ].map((t) => c.indexOf(t));
  assert(
    ordem.every((i) => i >= 0),
    JSON.stringify(ordem),
  );
  assertEquals(
    [...ordem].sort((a, b) => a - b),
    ordem,
  );
  for (const frase of [
    "ROLLBACK_20261209: public.marketplace_orders ficou ocupada por mais de 4 s",
    "ROLLBACK_20261209: public.pedido_cobranca_ao_cancelar tem outra forma de colunas",
    "ROLLBACK_20261209: public.pedido_cobranca_ao_cancelar nao tem a chave primaria",
    "ROLLBACK_20261209: existe public.pedido__foto_da_cobranca_ao_cancelar com outra assinatura",
    "ROLLBACK_20261209: public.pedido__foto_da_cobranca_ao_cancelar() tem corpo diferente",
    "ROLLBACK_20261209: o gatilho tr_pedido_foto_da_cobranca_ao_cancelar chama outra funcao",
    "ROLLBACK_20261209: % funcao(oes) citam pedido_cobranca_ao_cancelar",
    "ROLLBACK_20261209: algum objeto da 20261209000000 ainda existe",
  ])
    assertEquals(
      rollback.split(`RAISE EXCEPTION '${frase}`).length - 1,
      1,
      frase,
    );
  // o aviso de que as fotos se perdem e a ordem com a migration seguinte estao no cabecalho
  for (const frase of [
    "As fotos",
    "20261210000000",
    "desfaca ELA primeiro",
    "aplicar-migrations.yml",
  ])
    assert(
      rollback.includes(frase.replace("As fotos", "as fotos ja gravadas")) ||
        rollback.includes(frase),
      frase,
    );
});

Deno.test("209: o cabecalho diz o que acontece com os dados que ja existiam, a idempotencia e a ordem com o rollback", () => {
  const cab = migration.slice(
    0,
    migration.indexOf(
      "SET LOCAL lock_timeout = '5s';\nSET LOCAL statement_timeout",
    ),
  );
  for (const frase of [
    "DADOS QUE JA EXISTEM",
    "NAO ganha foto",
    "IDEMPOTENCIA",
    "TRANSACAO",
    "ROLLBACK MANUAL: supabase/migrations/rollback-manual-20261209000000_a_foto_da_cobranca_no_cancelamento.sql",
    "FRONT E EDGE ANTIGOS",
    "nao engole o erro",
  ])
    assertStringIncludes(cab, frase);
});

Deno.test("209 composicao: a prova viva esta no rpc-ci, na lista PROVAS_DO_DINHEIRO e no LEIA-ME; a migration nao usa is_admin_atual", () => {
  const ci = lerLF(`${RAIZ}/.github/workflows/rpc-ci.yml`);
  assertStringIncludes(
    ci,
    "run: node tests/banco/rodar-isolado.cjs tests/banco/cupom-pix-anulado-viva.cjs",
  );
  const lista = lerLF(
    `${RAIZ}/tests/migration_a_contestacao_decide_sob_a_trava_do_pedido_test.ts`,
  );
  assertStringIncludes(lista, '"tests/banco/cupom-pix-anulado-viva.cjs"');
  const leia = lerLF(`${RAIZ}/tests/banco/LEIA-ME.md`);
  assertStringIncludes(leia, "cupom-pix-anulado-viva.cjs");
  // nao usa o admin atual: nao entra no fim de POSTERIORES_A_97
  assert(!/is_admin_atual|rls_admin_atual|is_admin\(/.test(codigo(migration)));
});

Deno.test("209 tipos: src/types/database.types.ts descreve a tabela da foto como a migration a cria (coluna a coluna, nulos e FK)", () => {
  const tipos = lerLF(`${RAIZ}/src/types/database.types.ts`);
  const i = tipos.indexOf("      pedido_cobranca_ao_cancelar: {");
  assert(i >= 0, "a tabela nao esta nos tipos");
  const bloco = tipos.slice(i, tipos.indexOf("\n      };\n", i));
  const secao = (nome: string) => {
    const a = bloco.indexOf(`        ${nome}: {`);
    assert(a >= 0, `sem ${nome}`);
    return bloco.slice(a, bloco.indexOf("\n        };", a));
  };
  const campos = (s: string) =>
    [...s.matchAll(/^\s{10}(\w+)(\??): (.+);$/gm)].map((m) => [
      m[1],
      m[2] === "?",
      m[3],
    ]);
  // Row: tudo obrigatorio; nulo so onde a coluna aceita NULL
  assertEquals(campos(secao("Row")), [
    ["cancelado_em", false, "string"],
    ["gateway_payment_id", false, "string | null"],
    ["metodo_online", false, "string | null"],
    ["order_id", false, "string"],
    ["payment_status", false, "string | null"],
    ["tentativas", false, "number"],
  ]);
  // Insert: so order_id e tentativas sao obrigatorios (as outras aceitam NULL ou tem DEFAULT)
  assertEquals(
    campos(secao("Insert"))
      .filter((c) => !c[1])
      .map((c) => c[0]),
    ["order_id", "tentativas"],
  );
  assertEquals(
    campos(secao("Update")).every((c) => c[1]),
    true,
  );
  assertStringIncludes(
    bloco,
    'foreignKeyName: "pedido_cobranca_ao_cancelar_order_id_fkey"',
  );
  assertStringIncludes(bloco, "isOneToOne: true");
  assertStringIncludes(bloco, 'referencedRelation: "marketplace_orders"');
  // as colunas dos tipos sao as da migration
  const sqlCols = [
    ...migration
      .slice(
        ini("CREATE TABLE IF NOT EXISTS public.pedido_cobranca_ao_cancelar ("),
        ini("ALTER TABLE public.pedido_cobranca_ao_cancelar ENABLE"),
      )
      .matchAll(/^\s{2}(\w+) (?:uuid|text|integer|timestamptz)/gm),
  ]
    .map((m) => m[1])
    .sort();
  assertEquals(
    campos(secao("Row"))
      .map((c) => c[0])
      .sort(),
    sqlCols,
  );
});
