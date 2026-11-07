// O SINO DO PEDIDO VENCIDO FALA DO VENCIMENTO — prova offline do par 20261399920000 + rollback (a funcao da trigger que acende o sino da cliente; lote 43 do
// modo autonomo). O COMPORTAMENTO (a varredura real, o UPDATE direto, o cancelamento comum, os outros status, o convidado, a falha do aviso, o dado
// existente, rollback, pre/pos-voo, consultas 127a/127b) e' provado em tests/banco/o-sino-do-pedido-vencido-fala-do-vencimento-viva.cjs, que so roda no
// Postgres efemero do CI. Aqui fica o que se prova so lendo o texto.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const nome = "20261399920000_o_sino_do_pedido_vencido_fala_do_vencimento.sql";
const nome233 =
  "20261233000000_o_sino_do_pedido_de_retirada_fala_de_retirada.sql";
const dir = new URL("../supabase/migrations/", import.meta.url);
const ler = (rel: string) =>
  Deno.readTextFileSync(new URL(`../${rel}`, import.meta.url)).replace(
    /\r/g,
    "",
  );
const DELIM = "$$";
const FN = "notifica_cliente_de_mudanca_de_status";
const V = "20261399920000";
const definicao = (sql: string) => {
  const ini = sql.indexOf(`CREATE OR REPLACE FUNCTION public.${FN}(`);
  if (ini < 0) return "";
  const ab = sql.indexOf(DELIM, ini);
  const fim = sql.indexOf(DELIM, ab + DELIM.length);
  return sql.slice(ini, fim + DELIM.length);
};
const corpo = (sql: string) => {
  const d = definicao(sql);
  const ab = d.indexOf(DELIM);
  return d.slice(ab + DELIM.length, d.length - DELIM.length);
};
const md5 = (s: string) => createHash("md5").update(s).digest("hex");

// O corpo vigente (o da 20261233000000), o que esta migration deixa, e o da 20261026000000 que ela RECUSA (a 20261233000000 vem antes).
const H_ANTES = "fc8fd54a2fa1533f0d926744aab8ff58";
const H_DEPOIS = "dd76f4442bcb0a3b05bcede6d80fc406";
const H_026 = "7ace411aa5e184677d21d3b15ae94bf2";

const RAMO_VELHO =
  "            WHEN 'cancelled' THEN\n" +
  "                INSERT INTO public.notificacoes (usuario_id, tipo, titulo, mensagem, dados)\n" +
  "                VALUES (NEW.user_id, 'warning', 'Pedido cancelado',\n" +
  "                        'Seu pedido foi cancelado. Se tiver dúvidas, fale com a loja.',\n" +
  "                        jsonb_build_object('order_id', NEW.id));\n";
const FRASE_VENCIDO =
  "O prazo do pagamento terminou e o pedido foi cancelado. Se você já pagou, aguarde alguns minutos antes de comprar de novo. Se não pagou, é só comprar de novo.";

const anterior = ler(`supabase/migrations/${nome233}`);
const sql = ler(`supabase/migrations/${nome}`);
const rb = ler(`supabase/migrations/rollback-manual-${nome}`);

Deno.test("3999200: o corpo anterior e' o da 20261233000000; esta migration troca SO o ramo cancelled; o rollback devolve o corpo byte a byte", () => {
  assert.equal(md5(corpo(anterior)), H_ANTES);
  assert.equal(md5(corpo(sql)), H_DEPOIS);
  assert.equal(md5(corpo(rb)), H_ANTES);
  assert.equal(corpo(rb), corpo(anterior));
  assert.equal(definicao(rb), definicao(anterior));
  // O cabecalho (assinatura, SECURITY DEFINER, search_path, retorno trigger) e' o mesmo.
  assert.equal(
    definicao(sql).split(DELIM)[0],
    definicao(anterior).split(DELIM)[0],
  );
  // O ramo velho existe uma vez no corpo anterior e nenhuma vez, inteiro, no novo (o INSERT de antes vira o ELSE, com mais indentacao).
  assert.equal(corpo(anterior).split(RAMO_VELHO).length - 1, 1);
  assert.equal(corpo(sql).includes(RAMO_VELHO), false);
  // Tudo ANTES e DEPOIS do ramo cancelled e' identico, byte a byte.
  const i0 = corpo(anterior).indexOf(RAMO_VELHO);
  const antes = corpo(anterior).slice(0, i0);
  const depois = corpo(anterior).slice(i0 + RAMO_VELHO.length);
  assert.ok(corpo(sql).startsWith(antes));
  assert.ok(corpo(sql).endsWith(depois));
  assert.equal(sql.match(/CREATE OR REPLACE FUNCTION/g)?.length, 1);
  assert.equal(rb.match(/CREATE OR REPLACE FUNCTION/g)?.length, 1);
});

Deno.test("3999200: a regra — so payment_status 'expirado' (IS NOT DISTINCT FROM, NULL nunca e vencido) fala do vencimento, com a frase da tela do pedido; o ELSE e' a frase de hoje", () => {
  const c = corpo(sql);
  assert.equal(
    c.split("IF NEW.payment_status IS NOT DISTINCT FROM 'expirado' THEN")
      .length - 1,
    1,
  );
  assert.equal(c.split(FRASE_VENCIDO).length - 1, 1);
  assert.equal(
    c.split("Seu pedido foi cancelado. Se tiver dúvidas, fale com a loja.")
      .length - 1,
    1,
  );
  assert.equal(c.split("Pedido cancelado").length - 1, 1);
  assert.equal(c.split("Prazo do pagamento terminou").length - 1, 1);
  // A frase e' a mesma que a tela do pedido mostra (OrderDetailsView): quem muda uma muda a outra.
  const tela = ler("src/views/customer/OrderDetailsView.tsx");
  assert.ok(
    tela.includes(`return "${FRASE_VENCIDO}";`),
    "a frase do sino saiu da frase da tela do pedido",
  );
  // O ELSE traz o mesmo INSERT de antes (so a indentacao muda).
  const velho = RAMO_VELHO.split("\n")
    .slice(1)
    .filter((l) => l)
    .map((l) => `    ${l}`)
    .join("\n");
  assert.ok(
    c.includes(`                ELSE\n${velho}\n                END IF;`),
  );
  // As outras frases (20261026000000 e 20261233000000) seguem uma vez cada, e as duas guardas tambem.
  for (const frase of [
    "Pedido em preparo",
    "Pedido a caminho",
    "Pedido entregue",
    "Pedido pronto para retirar",
    "Pedido retirado",
    "store-pickup",
    "NEW.user_id IS NULL",
    "OLD.status IS NOT DISTINCT FROM NEW.status",
  ])
    assert.equal(c.split(frase).length - 1, 1, frase);
  assert.equal(c.split("INSERT INTO public.notificacoes").length - 1, 7);
  assert.equal(c.split("jsonb_build_object('order_id', NEW.id)").length - 1, 7);
  assert.equal(c.split("EXCEPTION WHEN OTHERS THEN").length - 1, 1);
  assert.equal(c.split("RAISE WARNING").length - 1, 1);
});

Deno.test("3999200: sem BEGIN/COMMIT, pre-voo antes do CREATE (corpo, atributos, trigger, colunas, ACL), hashes e fotografia dos atributos amarrados; nada de ACL, tabela ou dado; tudo em LF", () => {
  for (const texto of [sql, rb]) {
    assert.equal(
      require("../scripts/db-prove-rollback.cjs").avaliarFase0({
        sqlMigration: texto,
        sqlRollback: rb,
        temRollback: true,
      }).recusado,
      false,
    );
    const externo = texto
      .replace(definicao(texto), "")
      .replace(/--[^\n]*/g, "")
      // "AFTER UPDATE OF status" so aparece dentro de mensagens de RAISE (texto), nunca como comando.
      .replaceAll("AFTER UPDATE OF status", "");
    assert.doesNotMatch(
      externo,
      /\b(?:BEGIN;|COMMIT|GRANT|REVOKE|INSERT|UPDATE|DELETE|DROP|TRUNCATE|ALTER)\b/i,
    );
    assert.ok(
      externo.indexOf("B1_BASELINE_DIVERGENT") <
        texto.indexOf("CREATE OR REPLACE FUNCTION"),
    );
    assert.ok(
      texto.includes(
        "p.proname = 'notifica_cliente_de_mudanca_de_status') <> 1",
      ),
    );
    assert.ok(texto.includes("AND p.prosecdef"));
    assert.ok(texto.includes("AND p.provolatile = 'v'"));
    assert.ok(texto.includes("AND pg_get_function_result(p.oid) = 'trigger'"));
    assert.ok(
      texto.includes("AND p.proconfig = ARRAY['search_path=public']::text[]"),
    );
    assert.ok(texto.includes("t.tgname = 'tr_pedido_avisa_o_cliente'"));
    assert.ok(texto.includes("t.tgtype = 17"));
    // A ACL e' a de hoje: aberta por heranca do PUBLIC (como declara tests/banco/portas-do-visitante-permitidas.json).
    assert.ok(texto.includes("g.privilege_type = 'EXECUTE' AND g.grantee = 0"));
    assert.ok(!texto.includes("\r"));
  }
  assert.ok(sql.includes(H_ANTES) && sql.includes(H_DEPOIS));
  // O pre-voo aceita o corpo vigente OU o desta migration (reaplicar e' no-op) e RECUSA o da 20261026000000; o rollback so aceita o desta.
  assert.ok(sql.includes("v_hash NOT IN (v_vigente, v_desta)"));
  assert.ok(sql.includes(`'${H_ANTES}', '${H_DEPOIS}')`));
  assert.equal(sql.includes(H_026), false);
  assert.ok(rb.includes(`IF v_hash IS DISTINCT FROM '${H_DEPOIS}' THEN`));
  assert.ok(sql.includes("('marketplace_orders', 'payment_status')"));
  assert.ok(
    sql.includes(
      "a.attname = 'payment_status' AND a.atttypid = 'text'::regtype",
    ),
  );
  assert.ok(
    sql.indexOf("('marketplace_orders', 'payment_status')") <
      sql.indexOf("CREATE OR REPLACE FUNCTION"),
  );
  assert.ok(
    sql.includes("current_setting('ikcous.sino3999_atributos')::jsonb"),
  );
  assert.ok(
    rb.includes("current_setting('ikcous.sino3999_rb_atributos')::jsonb"),
  );
  assert.ok(
    sql.includes("a troca desta migration não aparece exatamente uma vez"),
  );
  assert.ok(sql.includes("SET LOCAL lock_timeout = '5s';"));
  assert.ok(rb.includes("SET LOCAL lock_timeout = '5s';"));
  for (const arquivo of [nome, `rollback-manual-${nome}`]) {
    const bruto = Deno.readTextFileSync(
      new URL(`../supabase/migrations/${arquivo}`, import.meta.url),
    );
    assert.ok(!bruto.includes("\r"), `${arquivo} em disco tem CR`);
  }
});

Deno.test("3999200: e' a ULTIMA redefinicao de notifica_cliente_de_mudanca_de_status da arvore (depois da 20261233000000); db-apply exige as guardas", () => {
  const fontes = [...Deno.readDirSync(dir)]
    .map((e) => e.name)
    .filter((n) => /^\d{14}_.*\.sql$/.test(n))
    .sort()
    .filter((n) => definicao(ler(`supabase/migrations/${n}`)));
  assert.equal(
    fontes.at(-1),
    nome,
    "outra migration redefine notifica_cliente_de_mudanca_de_status depois desta",
  );
  assert.equal(fontes.at(-2), nome233);
  const { VERIFICACOES, avaliarChecagem } = require("../scripts/db-apply.cjs");
  // eslint-disable-next-line security/detect-object-injection -- Nome literal desta migration, nunca entrada externa.
  const checagens = VERIFICACOES[nome];
  assert.equal(checagens?.length, 1);
  assert.equal(checagens[0].funcao, FN);
  assert.equal(
    avaliarChecagem(corpo(sql), checagens[0]).situacao,
    "verificada",
  );
  // Sem a troca (o corpo anterior) a verificacao falha; cada marcador tira a verificacao do ar quando some.
  assert.equal(
    avaliarChecagem(corpo(anterior), checagens[0]).situacao,
    "falhou",
  );
  for (const m of checagens[0].esperado as Array<{ texto: string }>)
    assert.equal(
      avaliarChecagem(corpo(sql).replace(m.texto, "XX"), checagens[0]).situacao,
      "falhou",
      `o marcador "${m.texto.slice(0, 40)}" nao pega a regressao`,
    );
  // A verificacao da 20261233000000 segue de pe com o corpo novo: nada do que ela cobra foi tirado.
  // eslint-disable-next-line security/detect-object-injection -- Nome literal da migration anterior, nunca entrada externa.
  const da233 = VERIFICACOES[nome233];
  assert.equal(
    avaliarChecagem(corpo(sql), da233[0]).situacao,
    "verificada",
    "o corpo novo perdeu algo que a verificacao da 20261233000000 cobra",
  );
});

Deno.test("3999200: as consultas 34a, 127a e 127b aceitam o corpo certo; 127a/127b sao so de catalogo, quatro linhas fechadas, e estao registradas", async () => {
  // A 34a aceita o corpo desta como sucessor do da 233 e normaliza ao esperado historico.
  const a34 = ler(
    "scripts/publicacao/consultas/34a-conferir-sino-da-retirada-aplicado.sql",
  );
  assert.ok(a34.includes(`f.m IN ('${H_ANTES}', '${H_DEPOIS}')`));
  assert.ok(a34.includes(`THEN '${H_ANTES}' ELSE f.m END`));
  const { contarStatements, ROL_FECHADO_POR_CONSULTA, estruturaDoRolFechado } =
    require("../scripts/publicacao/conferir-banco.cjs");
  const { CONSULTAS_DE_ROL_FECHADO } = await import(
    "../scripts/frota/publicar-release.mjs"
  );
  const A =
    "127a-conferir-o-sino-do-pedido-vencido-fala-do-vencimento-aplicado";
  const B =
    "127b-antes-o-sino-do-pedido-vencido-fala-do-vencimento-base-vigente";
  for (const [nomeConsulta, hash] of [
    [A, H_DEPOIS],
    [B, H_ANTES],
  ]) {
    const consulta = ler(`scripts/publicacao/consultas/${nomeConsulta}.sql`);
    assert.equal(contarStatements(consulta), 1);
    assert.ok(consulta.includes(`'${hash}'`));
    // So catalogo: nenhuma tabela de dado e' lida e a trigger nao e' disparada.
    assert.doesNotMatch(
      consulta,
      /FROM public\.(?:marketplace_|produtos|profiles|coupons|store_config|notificacoes|devolucoes|product_variants)/,
    );
    const itens = [...consulta.matchAll(/SELECT '([^']+)'/g)].map((m) => m[1]);
    // eslint-disable-next-line security/detect-object-injection -- Nome vem da dupla fechada de consultas acima.
    const rol = ROL_FECHADO_POR_CONSULTA[nomeConsulta];
    assert.deepEqual(itens, rol);
    assert.equal(rol.length, 4);
    assert.ok(CONSULTAS_DE_ROL_FECHADO.has(nomeConsulta));
    const linhas = rol.map((item: string) => ({
      item,
      esperado: "sim",
      vivo: "sim",
      ok: true,
    }));
    assert.equal(estruturaDoRolFechado(linhas, rol), null);
    assert.notEqual(estruturaDoRolFechado(linhas.slice(1), rol), null);
    assert.notEqual(estruturaDoRolFechado([...linhas, linhas[0]], rol), null);
    assert.equal(
      ler(".github/workflows/rpc-ci.yml").split(
        `"scripts/publicacao/consultas/${nomeConsulta}.sql"`,
      ).length - 1,
      2,
    );
    assert.ok(
      ler(".github/workflows/conferir-banco-da-loja.yml").includes(
        `- ${nomeConsulta}\n`,
      ),
    );
  }
  const entrada = JSON.parse(
    ler("scripts/frota/canais-de-backend.json"),
  ).provasDeObjetos.find((p: { versoes: string[] }) => p.versoes.includes(V));
  assert.equal(entrada.consulta, A);
  assert.equal(entrada.ausenciaConfirmadaPor, B);
  assert.deepEqual(entrada.versoes, [V]);
  assert.ok(/^[\x20-\x7e]*$/.test(String(entrada._comentario)));
  for (const campo of [
    "backfillLedger",
    "nuncaAplicar",
    "soNosRefs",
    "conferenciasAntesDoApply",
  ])
    assert.equal(
      Object.entries(entrada).find(([chave]) => chave === campo)?.[1],
      undefined,
      campo,
    );
  assert.ok(
    ler(".github/workflows/rpc-ci.yml").includes(
      "rodar-isolado.cjs tests/banco/o-sino-do-pedido-vencido-fala-do-vencimento-viva.cjs",
    ),
  );
  assert.ok(
    ler("tests/banco/LEIA-ME.md").includes(
      "o-sino-do-pedido-vencido-fala-do-vencimento-viva.cjs",
    ),
  );
  // As provas que medem a 20261233000000 sobre a arvore migrada desfazem esta ANTES, pelo helper.
  const posterior = ler("tests/banco/o-sino-do-pedido-vencido-posterior.cjs");
  assert.ok(posterior.includes(`"${H_DEPOIS}"`));
  assert.ok(posterior.includes(`"${H_ANTES}"`));
  assert.ok(posterior.includes(nome));
  assert.ok(posterior.includes("`rollback-manual-${"));
  for (const prova of [
    "tests/banco/o-sino-do-pedido-de-retirada-viva.cjs",
    "tests/banco/o-sino-do-pedido-de-retirada-portao-viva.cjs",
  ])
    assert.ok(
      ler(prova).includes("o-sino-do-pedido-vencido-posterior.cjs"),
      `${prova} nao desfaz a 20261399920000 antes`,
    );
});
