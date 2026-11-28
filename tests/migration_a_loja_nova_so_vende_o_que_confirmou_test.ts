// A LOJA NOVA SO VENDE O QUE CONFIRMOU: prova offline do par 20261655000000 + rollback.
// O COMPORTAMENTO (pagar na entrega e entrega na cidade travados ate a lojista confirmar, a vitrine le dois booleanos,
// a trava das lojas que ja venderam, reaplicar e rollback) e' provado em
// tests/banco/a-loja-nova-so-vende-o-que-confirmou-viva.cjs, que so roda no Postgres efemero do CI. Aqui fica o que se
// prova so lendo o texto.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  avaliarFase0,
  detectarTransacaoExplicita,
  removerRuido,
} = require("../scripts/db-prove-rollback.cjs");

const nome = "20261655000000_a_loja_nova_so_vende_o_que_confirmou.sql";
const nome1174 = "20261174000000_formas_de_pagamento_por_loja.sql";
const ler = (rel: string) =>
  Deno.readTextFileSync(new URL(`../${rel}`, import.meta.url)).replace(
    /\r/g,
    "",
  );
const sql = ler(`supabase/migrations/${nome}`);
const rb = ler(`supabase/migrations/rollback-manual-${nome}`);
const sql1174 = ler(`supabase/migrations/${nome1174}`);
const md5 = (s: string) => createHash("md5").update(s).digest("hex");

const H_ACEITA_ANTES = "4f90cbc8b1c98be2fd1c6d862468376c";
const MARCA_ACEITA =
  "CREATE OR REPLACE FUNCTION public.forma_de_pagamento_aceita(p_metodo text)";
const MARCA_GATILHO =
  "CREATE OR REPLACE FUNCTION public.a_loja_so_entrega_na_cidade_o_que_confirmou()";
// As 48 colunas que a 20261310000000 deixou na leitura publica (md5 da lista na ordem) e as 50 desta.
const VISTA_ANTES = "b7ee2c31d91549a168a502de0ac4c5d2";
const VISTA_DESTA = "39fbabdd4cd002cb626ecaa7c5112cdb";

/** O corpo (entre os $function$) da UNICA definicao `marca` do arquivo. */
function corpo(arquivo: string, marca: string): string {
  assert.equal(
    arquivo.split(marca).length - 1,
    1,
    `uma definicao so: ${marca}`,
  );
  const i = arquivo.indexOf(marca);
  const a = arquivo.indexOf("AS $function$", i) + "AS $function$".length;
  return arquivo.slice(a, arquivo.indexOf("$function$;", a));
}
const H_ACEITA_DESTA = md5(corpo(sql, MARCA_ACEITA));

Deno.test("1655: fase 0 do db-prove-rollback aceita o par (nada de BEGIN/COMMIT de nivel superior)", () => {
  const r = avaliarFase0({
    sqlMigration: sql,
    sqlRollback: rb,
    temRollback: true,
  });
  assert.equal(r.recusado, false, JSON.stringify(r));
  assert.deepEqual(detectarTransacaoExplicita(removerRuido(sql)).achados, []);
  assert.deepEqual(detectarTransacaoExplicita(removerRuido(rb)).achados, []);
  assert.ok(sql.includes("SET LOCAL lock_timeout = '5s';"));
  assert.ok(rb.includes("SET LOCAL lock_timeout = '5s';"));
});

Deno.test("1655: a ultima migration que definiu forma_de_pagamento_aceita e' a 20261174000000; o rollback devolve o corpo DELA byte a byte", () => {
  const dir = new URL("../supabase/migrations/", import.meta.url);
  const definem = [...Deno.readDirSync(dir)]
    .map((e) => e.name)
    .filter((n) => /^\d{14}_.*\.sql$/.test(n))
    .filter((n) => ler(`supabase/migrations/${n}`).includes(MARCA_ACEITA))
    .sort();
  assert.deepEqual(definem, [nome1174, nome]);
  assert.equal(md5(corpo(sql1174, MARCA_ACEITA)), H_ACEITA_ANTES);
  assert.equal(md5(corpo(rb, MARCA_ACEITA)), H_ACEITA_ANTES);
  assert.notEqual(H_ACEITA_DESTA, H_ACEITA_ANTES);
  // Pre-voo da ida aceita o vigente OU o desta; o da volta, so o desta.
  assert.ok(
    sql.includes(`'${H_ACEITA_ANTES}'`) && sql.includes(`'${H_ACEITA_DESTA}'`),
  );
  assert.ok(rb.includes(`'${H_ACEITA_DESTA}'`));
});

Deno.test("1655: o corpo novo de forma_de_pagamento_aceita so acrescenta a trava do pagamento na entrega; 'online' nunca e' travado", () => {
  const antes = corpo(sql1174, MARCA_ACEITA);
  const novo = corpo(sql, MARCA_ACEITA);
  // O que muda: a coluna lida a mais e o IF antes do CASE. O resto e' o da 1174.
  const de =
    "  SELECT pagamento_online, formas_pagamento_entrega INTO v_config\n";
  const para =
    "  SELECT pagamento_online, formas_pagamento_entrega, pagamento_confirmado_em INTO v_config\n";
  assert.ok(antes.includes(de));
  const semTrava = novo
    .replace(para, de)
    .replace(/ {2}-- 20261655000000:[\s\S]*? {2}END IF;\n/, "");
  assert.equal(semTrava, antes, "o corpo novo mudou alem da trava");
  assert.match(
    novo,
    /IF p_metodo IN \('pix', 'card', 'cash'\) AND v_config\.pagamento_confirmado_em IS NULL THEN\n\s+RETURN false;/,
  );
  assert.ok(!/'online'[^\n]*pagamento_confirmado_em/.test(novo));
});

Deno.test("1655: o gatilho recusa so a entrega na cidade nao confirmada, com frase e codigo proprios; balcao e gemeo passam", () => {
  const g = corpo(sql, MARCA_GATILHO);
  assert.ok(
    g.includes(
      "btrim(COALESCE(NEW.customer_data->>'shipping_option_id', '')) = 'local-delivery'",
    ),
  );
  assert.ok(g.includes("entrega_confirmada_em IS NULL"));
  assert.ok(
    g.includes(
      "RAISE EXCEPTION 'Esta loja ainda está se preparando para entregar. Escolha outra entrega ou fale com a loja.'",
    ),
  );
  assert.ok(g.includes("DETAIL = 'entrega_local_nao_confirmada'"));
  assert.ok(g.includes("WHERE idempotency_key = NEW.idempotency_key"));
  assert.ok(
    sql.includes(
      "WHEN (NEW.canal IS DISTINCT FROM 'presencial')\n  EXECUTE FUNCTION public.a_loja_so_entrega_na_cidade_o_que_confirmou();",
    ),
  );
  assert.ok(
    sql.includes(
      "REVOKE ALL ON FUNCTION public.a_loja_so_entrega_na_cidade_o_que_confirmou() FROM PUBLIC, anon, authenticated, service_role;",
    ),
  );
});

Deno.test("1655: a vitrine ganha SO os dois booleanos no fim (nunca as datas); a trava da loja que ja vendeu vem antes de qualquer escrita", () => {
  const semRuido = removerRuido(sql);
  const iVista = semRuido.indexOf(
    "CREATE OR REPLACE VIEW public.v_store_config",
  );
  assert.ok(iVista > 0);
  const vista = semRuido.slice(iVista, semRuido.indexOf(";", iVista));
  assert.match(
    vista,
    /free_shipping_card_style,\s+\(entrega_confirmada_em IS NOT NULL\) AS entrega_local_liberada,\s+\(pagamento_confirmado_em IS NOT NULL\) AS pagamento_na_entrega_liberado\s+FROM store_config\s+WHERE id = 1$/,
  );
  assert.ok(
    !/entrega_confirmada_em,|pagamento_confirmado_em,/.test(vista),
    "data na vitrine",
  );
  assert.ok(
    sql.includes(`'${VISTA_ANTES}'`) && sql.includes(`'${VISTA_DESTA}'`),
  );
  // A trava: le pedido e confirmacao, recusa com codigo proprio e roda ANTES do primeiro CREATE.
  // (o texto cru: removerRuido apaga as strings, e a frase da trava mora numa)
  const iTrava = sql.indexOf(
    "RAISE EXCEPTION 'TRAVA_LOJA_EM_OPERACAO_SEM_CONFIRMACAO:",
  );
  assert.ok(iTrava > 0);
  assert.ok(iTrava < sql.indexOf("CREATE OR REPLACE FUNCTION"));
  const iLock = sql.indexOf(
    "LOCK TABLE public.marketplace_orders IN SHARE ROW EXCLUSIVE MODE;",
  );
  assert.ok(iLock > 0 && iLock < iTrava);
  assert.ok(
    sql.includes(
      "     AND EXISTS (SELECT 1 FROM public.marketplace_orders) THEN",
    ),
  );
  // Nenhuma escrita de dado.
  assert.ok(
    !/\bDELETE\s+FROM\b|\bUPDATE\s+public\.|\bINSERT\s+INTO\b|\bTRUNCATE\b/i.test(
      semRuido,
    ),
  );
});

Deno.test("1655: o rollback tira gatilho, funcao nova e os dois booleanos, sem apagar dado, e devolve o ACL da vitrine", () => {
  const semRuido = removerRuido(rb);
  assert.ok(
    semRuido.includes(
      "DROP TRIGGER IF EXISTS tr_a_loja_so_entrega_o_confirmado ON public.marketplace_orders;",
    ),
  );
  assert.ok(
    semRuido.includes(
      "DROP FUNCTION IF EXISTS public.a_loja_so_entrega_na_cidade_o_que_confirmou();",
    ),
  );
  assert.ok(semRuido.includes("DROP VIEW public.v_store_config;"));
  assert.ok(!/\bDROP\s+(TABLE|COLUMN|POLICY|INDEX)\b/i.test(semRuido));
  assert.ok(
    !/\bDELETE\s+FROM\b|\bUPDATE\s+public\.|\bTRUNCATE\b/i.test(semRuido),
  );
  assert.ok(rb.includes(`'${VISTA_DESTA}'`) && rb.includes(`'${VISTA_ANTES}'`));
  assert.ok(
    rb.includes("aclexplode"),
    "o ACL volta da fotografia, nao de um GRANT fixo",
  );
});

Deno.test("1655: as provas da 1652 tiram esta antes (a vitrine depende das duas colunas); ha posterior e prova viva no job do dinheiro", () => {
  const posterior = ler("tests/banco/a-loja-nova-so-vende-posterior.cjs");
  assert.ok(posterior.includes(nome));
  assert.ok(posterior.includes(`"${H_ACEITA_DESTA}"`));
  const p1652 = ler("tests/banco/a-loja-nova-confirma-posterior.cjs");
  const iChama = p1652.indexOf("desfazerSoVendeOConfirmadoNaTransacao(");
  assert.ok(
    iChama > 0 && iChama < p1652.indexOf("const vivo = await c.query("),
  );
  const viva1652 = ler(
    "tests/banco/a-loja-nova-confirma-entrega-e-pagamento-viva.cjs",
  );
  const emTx = viva1652.slice(viva1652.indexOf("async function emTransacao("));
  const iTira = emTx.indexOf("desfazerSoVendeOConfirmadoNaTransacao(");
  assert.ok(
    iTira > 0 && iTira < emTx.indexOf("await hashVivo()"),
    "a prova da 1652 tira esta antes",
  );
  const rpc = ler(".github/workflows/rpc-ci.yml");
  assert.ok(
    rpc.includes(
      "run: node tests/banco/rodar-isolado.cjs tests/banco/a-loja-nova-so-vende-o-que-confirmou-viva.cjs",
    ),
  );
  assert.ok(
    ler("tests/banco/LEIA-ME.md").includes(
      "a-loja-nova-so-vende-o-que-confirmou-viva.cjs",
    ),
  );
});

Deno.test("1655: as consultas que travam a lista da vitrine (60a, 60b, 47a, 40a) aceitam as 50 colunas desta como sucessora", () => {
  const consulta = (n: string) => ler(`scripts/publicacao/consultas/${n}.sql`);
  for (const n of [
    "60a-conferir-estilo-card-frete-aplicado",
    "60b-antes-estilo-card-frete-base-vigente",
    "47a-conferir-a-loja-escolhe-como-entrega-aplicado",
  ])
    assert.ok(consulta(n).includes(`'${VISTA_DESTA}'`), n);
  assert.ok(
    consulta("40a-conferir-identidade-legal-da-loja-aplicado").includes(
      ",entrega_local_liberada,pagamento_na_entrega_liberado",
    ),
  );
  const a = consulta(
    "211a-conferir-a-loja-nova-so-vende-o-que-confirmou-aplicado",
  );
  const b = consulta(
    "211b-antes-a-loja-nova-so-vende-o-que-confirmou-base-vigente",
  );
  assert.ok(
    a.includes(`'${H_ACEITA_DESTA} sim'`) && a.includes(`'${VISTA_DESTA}'`),
  );
  assert.ok(
    b.includes(`'${H_ACEITA_ANTES}'`) && b.includes(`'${VISTA_ANTES}'`),
  );
  for (const c of [a, b])
    assert.ok(
      !/\bFROM\s+public\.(store_config|marketplace_orders)\b/i.test(c),
      "so catalogo",
    );
});
