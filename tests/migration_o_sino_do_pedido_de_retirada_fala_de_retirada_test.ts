// @ts-nocheck
// O SINO DO PEDIDO DE RETIRADA FALA DE RETIRADA — prova offline do par 20261233000000 + rollback (a função de gatilho
// notifica_cliente_de_mudanca_de_status; ordem da caçada de 14/10/2026). O COMPORTAMENTO (entrega x retirada, bordas
// do customer_data, idempotência, convidado, várias linhas, o aviso antigo que fica, ACL, rollback, pré-voo) é provado
// em tests/banco/o-sino-do-pedido-de-retirada-viva.cjs e o portão da release em
// tests/banco/o-sino-do-pedido-de-retirada-portao-viva.cjs. Aqui fica o que se prova só lendo o texto.
//
// Riscos: o corpo novo tem de ser o da 20261026000000 com SÓ a troca declarada (o ramo da retirada em shipping e em
// delivered); o corpo do rollback tem de ser o da 20261026000000 BYTE A BYTE; os atributos (SECURITY DEFINER, VOLATILE,
// search_path, retorno trigger), a trigger e a ACL não podem mudar (nenhum GRANT/REVOKE/CREATE TRIGGER); o pré-voo vem
// antes da troca e a conferência depois; sem BEGIN/COMMIT de nível superior.
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
const NOME = "20261233000000_o_sino_do_pedido_de_retirada_fala_de_retirada.sql";
const VIGENTE = "20261026000000_o_pedido_avisa_o_cliente.sql";
const ler = (n) =>
  Deno.readTextFileSync(new URL(`supabase/migrations/${n}`, DIR)).replace(
    /\r\n/g,
    "\n",
  );
const migration = ler(NOME);
const rollback = ler(`rollback-manual-${NOME}`);
const migrationVigente = ler(VIGENTE);
const limpo = (s) => removerRuido(s).replace(/\s+/g, " ");
const md5 = (s) => createHash("md5").update(s).digest("hex");

const H_VIGENTE = "7ace411aa5e184677d21d3b15ae94bf2";
const H_NOVO = "fc8fd54a2fa1533f0d926744aab8ff58";
const ASSINATURA = "public.notifica_cliente_de_mudanca_de_status()";

/** O corpo (entre as aspas de dólar) do UM `CREATE OR REPLACE FUNCTION public.notifica_cliente_de_mudanca_de_status(` do arquivo. */
function corpoDe(sql) {
  const marca =
    "CREATE OR REPLACE FUNCTION public.notifica_cliente_de_mudanca_de_status(";
  assert.equal(sql.split(marca).length - 1, 1, "uma definicao da funcao");
  const ini = sql.indexOf(marca);
  const m = /\bAS (\$\w*\$)/.exec(sql.slice(ini));
  const abre = ini + m.index + m[0].length;
  return sql.slice(abre, sql.indexOf(m[1], abre));
}
const CORPO_VIGENTE = corpoDe(migrationVigente);
const CORPO_NOVO = corpoDe(migration);

// As trocas (quatro, todas do ramo da retirada): a variável, o cálculo dela e os dois status que ganham o IF.
const TROCAS = [
  [
    "\nBEGIN\n    -- Convidado",
    "\nDECLARE\n    v_retirada boolean := false;\nBEGIN\n    -- Convidado",
  ],
  [
    "    BEGIN\n        CASE NEW.status\n",
    "    BEGIN\n" +
      "        -- Retirada na loja: o id da opção de entrega gravado na compra é o contrato\n" +
      "        -- (comparação exata). Sem customer_data ou sem a chave, não é retirada.\n" +
      "        v_retirada := COALESCE(NEW.customer_data ->> 'shipping_option_id', '') = 'store-pickup';\n" +
      "\n" +
      "        CASE NEW.status\n",
  ],
  [
    "            WHEN 'shipping' THEN\n" +
      "                INSERT INTO public.notificacoes (usuario_id, tipo, titulo, mensagem, dados)\n" +
      "                VALUES (NEW.user_id, 'info', 'Pedido a caminho',\n" +
      "                        'Seu pedido saiu para entrega!',\n" +
      "                        jsonb_build_object('order_id', NEW.id));\n",
    "            WHEN 'shipping' THEN\n" +
      "                IF v_retirada THEN\n" +
      "                    INSERT INTO public.notificacoes (usuario_id, tipo, titulo, mensagem, dados)\n" +
      "                    VALUES (NEW.user_id, 'info', 'Pedido pronto para retirar',\n" +
      "                            'Seu pedido está pronto! Venha retirar na loja.',\n" +
      "                            jsonb_build_object('order_id', NEW.id));\n" +
      "                ELSE\n" +
      "                    INSERT INTO public.notificacoes (usuario_id, tipo, titulo, mensagem, dados)\n" +
      "                    VALUES (NEW.user_id, 'info', 'Pedido a caminho',\n" +
      "                            'Seu pedido saiu para entrega!',\n" +
      "                            jsonb_build_object('order_id', NEW.id));\n" +
      "                END IF;\n",
  ],
  [
    "            WHEN 'delivered' THEN\n" +
      "                INSERT INTO public.notificacoes (usuario_id, tipo, titulo, mensagem, dados)\n" +
      "                VALUES (NEW.user_id, 'success', 'Pedido entregue',\n" +
      "                        'Seu pedido foi entregue. Obrigado por comprar com a gente!',\n" +
      "                        jsonb_build_object('order_id', NEW.id));\n",
    "            WHEN 'delivered' THEN\n" +
      "                IF v_retirada THEN\n" +
      "                    INSERT INTO public.notificacoes (usuario_id, tipo, titulo, mensagem, dados)\n" +
      "                    VALUES (NEW.user_id, 'success', 'Pedido retirado',\n" +
      "                            'Seu pedido foi retirado na loja. Obrigado por comprar com a gente!',\n" +
      "                            jsonb_build_object('order_id', NEW.id));\n" +
      "                ELSE\n" +
      "                    INSERT INTO public.notificacoes (usuario_id, tipo, titulo, mensagem, dados)\n" +
      "                    VALUES (NEW.user_id, 'success', 'Pedido entregue',\n" +
      "                            'Seu pedido foi entregue. Obrigado por comprar com a gente!',\n" +
      "                            jsonb_build_object('order_id', NEW.id));\n" +
      "                END IF;\n",
  ],
];

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

Deno.test("o corpo vigente e' o da 20261026000000 (md5 conhecido) e o corpo novo e' ele com SO as trocas declaradas, md5 dos dois conhecido; desfazer as trocas devolve o vigente byte a byte", () => {
  assert.equal(md5(CORPO_VIGENTE), H_VIGENTE);
  let esperado = CORPO_VIGENTE;
  for (const [de, para] of TROCAS) {
    assert.equal(
      esperado.split(de).length - 1,
      1,
      `o trecho antigo existe UMA vez: ${de.slice(0, 50)}`,
    );
    esperado = esperado.replace(de, () => para);
  }
  assert.equal(CORPO_NOVO, esperado, "corpo novo = vigente + as trocas");
  assert.equal(md5(CORPO_NOVO), H_NOVO);
  assert.notEqual(H_NOVO, H_VIGENTE);
  let volta = CORPO_NOVO;
  for (const [de, para] of [...TROCAS].reverse())
    volta = volta.replace(para, () => de);
  assert.equal(volta, CORPO_VIGENTE, "desfazer as trocas devolve o vigente");
});

Deno.test("o que NAO pode ter mudado: as guardas, o processing, o cancelled, o ELSE sem aviso e o bloco best-effort ficam iguais ao vigente", () => {
  for (const trecho of [
    "IF NEW.user_id IS NULL THEN",
    "IF OLD.status IS NOT DISTINCT FROM NEW.status THEN",
    "'Pedido em preparo',",
    "'Seu pedido já está em preparo pela loja.',",
    "'Pedido cancelado',",
    "'Seu pedido foi cancelado. Se tiver dúvidas, fale com a loja.',",
    "EXCEPTION WHEN OTHERS THEN",
    "RAISE WARNING",
    "'notifica_cliente_de_mudanca_de_status: aviso do pedido % nao nasceu (%).',",
    "NEW.id, SQLERRM;",
    "NULL;\n        END CASE;",
    "RETURN NEW;",
    "'Pedido a caminho',",
    "'Seu pedido saiu para entrega!',",
    "'Pedido entregue',",
    "'Seu pedido foi entregue. Obrigado por comprar com a gente!',",
  ])
    assert.equal(
      CORPO_NOVO.split(trecho).length,
      CORPO_VIGENTE.split(trecho).length,
      `o trecho ${trecho} mudou de numero de ocorrencias`,
    );
  // cada texto da entrega continua UMA vez (a troca so soma o ramo da retirada), e cada texto novo tambem
  for (const t of [
    "Pedido a caminho",
    "Pedido entregue",
    "Pedido pronto para retirar",
    "Pedido retirado",
    "Seu pedido está pronto! Venha retirar na loja.",
    "Seu pedido foi retirado na loja. Obrigado por comprar com a gente!",
  ])
    assert.equal(CORPO_NOVO.split(t).length - 1, 1, t);
  // quatro INSERTs na vigente; seis na nova (shipping e delivered ganham um a mais cada)
  assert.equal(
    CORPO_VIGENTE.split("INSERT INTO public.notificacoes").length - 1,
    4,
  );
  assert.equal(
    CORPO_NOVO.split("INSERT INTO public.notificacoes").length - 1,
    6,
  );
  assert.equal(
    CORPO_NOVO.split("jsonb_build_object('order_id', NEW.id)").length - 1,
    6,
  );
  assert.equal(CORPO_NOVO.split("VALUES (NEW.user_id,").length - 1, 6);
});

Deno.test("a regra nova: o contrato e' o id da opcao de entrega, comparado EXATO (sem trim, sem caixa, sem prefixo), com COALESCE (NULL nunca e' retirada); o endereco da loja nao decide", () => {
  assert.ok(
    CORPO_NOVO.includes(
      "v_retirada := COALESCE(NEW.customer_data ->> 'shipping_option_id', '') = 'store-pickup';",
    ),
  );
  const limpoNovo = removerRuido(CORPO_NOVO);
  assert.doesNotMatch(
    limpoNovo,
    /\b(lower|upper|btrim|trim|ILIKE|LIKE|position|strpos)\b/i,
  );
  assert.doesNotMatch(limpoNovo, /pickup_address/);
  assert.equal(
    CORPO_NOVO.split("store-pickup").length - 1,
    1,
    "o literal do contrato aparece UMA vez",
  );
  // o mesmo literal que o front, a edge e a RPC do pedido usam
  const guarda = Deno.readTextFileSync(
    new URL("src/lib/guarda-de-frete.ts", DIR),
  );
  assert.match(guarda, /ID_RETIRADA_NA_LOJA = "store-pickup"/);
  const edge = Deno.readTextFileSync(
    new URL("supabase/functions/_shared/retirada-na-loja.ts", DIR),
  );
  assert.match(edge, /ID_RETIRADA_NA_LOJA = "store-pickup"/);
  const rpc = ler("20261229000000_o_endereco_da_compra_fica_no_pedido.sql");
  assert.ok(rpc.includes("'shipping_option_id', p_shipping_option_id,"));
  assert.ok(rpc.includes("WHEN p_shipping_option_id = 'store-pickup'"));
});

Deno.test("o vocabulario e' o do app: o 'pronto para retirar' da tela do pedido e do painel", () => {
  const tela = Deno.readTextFileSync(
    new URL("src/views/customer/OrderDetailsView.tsx", DIR),
  );
  assert.ok(
    tela.includes(
      'description: "Seu pedido está pronto! Venha retirar na loja.",',
    ),
  );
  assert.ok(tela.includes('return "Pedido retirado na loja.";'));
  const painel = Deno.readTextFileSync(
    new URL("src/components/admin/orders/OrderStatusBadge.tsx", DIR),
  );
  assert.ok(
    painel.includes(
      'export const ROTULO_PRONTO_PARA_RETIRAR = "Pronto para retirar";',
    ),
  );
});

Deno.test("scripts/db-apply.cjs tem entrada NOVA para a 20261233000000 (sem ela a migration sai PULADA, codigo 2), cada marcador com a contagem exata 1", () => {
  const src = Deno.readTextFileSync(
    new URL("scripts/db-apply.cjs", DIR),
  ).replace(/\r\n/g, "\n");
  const i = src.indexOf(`"${NOME}": [`);
  assert.ok(i > 0, "sem entrada em VERIFICACOES");
  const entrada = src.slice(i, src.indexOf("\n  ],", i));
  assert.ok(
    entrada.includes('funcao: "notifica_cliente_de_mudanca_de_status"'),
  );
  assert.ok(!/vezes:\s*[02-9]/.test(entrada), "todas as contagens sao 1");
  for (const trecho of [
    "Pedido pronto para retirar",
    "Pedido retirado",
    "COALESCE(NEW.customer_data ->> 'shipping_option_id', '') = 'store-pickup'",
    "Pedido em preparo",
    "Pedido a caminho",
    "Pedido entregue",
    "Pedido cancelado",
    "NEW.user_id IS NULL",
    "OLD.status IS NOT DISTINCT FROM NEW.status",
  ]) {
    assert.ok(entrada.includes(trecho), trecho);
    assert.equal(CORPO_NOVO.split(trecho).length - 1, 1, trecho);
  }
  // a entrada ANTIGA (20261026000000) segue valendo com o corpo novo: cada marcador dela continua UMA vez
  const j = src.indexOf('"20261026000000_o_pedido_avisa_o_cliente.sql": [');
  assert.ok(j > 0);
  const antiga = src.slice(j, src.indexOf("\n  ],", j));
  for (const m of [...antiga.matchAll(/texto: "([^"]+)",\s*vezes: (\d+)/g)])
    assert.equal(
      CORPO_NOVO.split(m[1]).length - 1,
      Number(m[2]),
      `entrada antiga: ${m[1]}`,
    );
});

Deno.test("o rollback recria o corpo VIGENTE byte a byte, com o mesmo md5 que o pre-voo e a conferencia declaram", () => {
  assert.equal(corpoDe(rollback), CORPO_VIGENTE);
  assert.equal(md5(corpoDe(rollback)), H_VIGENTE);
  for (const sql of [migration, rollback])
    for (const h of [H_VIGENTE, H_NOVO]) assert.ok(sql.includes(`'${h}'`), h);
  assert.ok(!corpoDe(rollback).includes("v_retirada"));
});

Deno.test("so um CREATE OR REPLACE FUNCTION em cada arquivo, com a MESMA assinatura e os MESMOS atributos (SECURITY DEFINER, plpgsql, search_path=public, retorna trigger); nada de GRANT, REVOKE, DROP, ALTER, DML, trigger nem tabela nova fora do corpo", () => {
  const cabecalho =
    "CREATE OR REPLACE FUNCTION public.notifica_cliente_de_mudanca_de_status()\n" +
    "RETURNS trigger\n" +
    "LANGUAGE plpgsql\n" +
    "SECURITY DEFINER\n" +
    "SET search_path = public\n" +
    "AS $$";
  for (const sql of [migration, rollback]) {
    assert.equal(
      sql.split("\nCREATE OR REPLACE FUNCTION").length - 1,
      1,
      "uma funcao por arquivo",
    );
    assert.ok(sql.includes(cabecalho), "assinatura e atributos de sempre");
    const fora = limpo(sql.replace(corpoDe(sql), ""));
    assert.doesNotMatch(fora, /\b(GRANT|REVOKE)\b/i);
    assert.doesNotMatch(
      fora,
      /\b(DROP|ALTER|INSERT|UPDATE|DELETE|TRUNCATE)\b/i,
    );
    assert.doesNotMatch(
      fora,
      /\bCREATE\s+(TABLE|POLICY|INDEX|TRIGGER|VIEW)\b/i,
    );
    assert.doesNotMatch(fora, /\b(STABLE|IMMUTABLE|SECURITY INVOKER)\b/i);
  }
  // a assinatura original e' a da 20261026000000
  assert.ok(migrationVigente.includes(cabecalho));
});

Deno.test("o pre-voo vem antes da troca do corpo, aceita SO os dois corpos, a ACL de hoje, confere atributos, a trigger, as colunas; a conferencia vem depois e recusa o resto", () => {
  const iPre = migration.indexOf("DO $preflight_20261233$");
  const fimPre = migration.indexOf("END $preflight_20261233$;");
  const iCria = migration.indexOf("\nCREATE OR REPLACE FUNCTION");
  const iConf = migration.indexOf("DO $conferencia_20261233$");
  assert.ok(iPre >= 0 && fimPre > iPre && fimPre < iCria && iCria < iConf);
  const pre = migration.slice(iPre, fimPre);
  for (const trecho of [
    `to_regprocedure('${ASSINATURA}')`,
    "md5(replace(prosrc, E'\\r', ''))",
    `('${ASSINATURA}', '${H_VIGENTE}', '${H_NOVO}')`,
    "v_hash NOT IN (r.hash_vigente, r.hash_desta)",
    "p.prosecdef",
    "p.provolatile = 'v'",
    "NOT p.proretset",
    "p.proconfig = ARRAY['search_path=public']::text[]",
    "pg_get_function_arguments(p.oid) = ''",
    "pg_get_function_result(p.oid) = 'trigger'",
    "<> 1",
    "t.tgname = 'tr_pedido_avisa_o_cliente'",
    "t.tgfoid = v_oid",
    "t.tgtype = 17",
    "t.tgattr::text =",
    "('marketplace_orders', 'customer_data')",
    "('notificacoes', 'mensagem')",
    "a.atttypid = 'jsonb'::regtype",
    "aclexplode(coalesce(p.proacl, acldefault('f', p.proowner)))",
    "g.grantee = 0",
    "IF NOT v_public THEN",
    "RAISE EXCEPTION 'B1_BASELINE_DIVERGENT:",
  ])
    assert.ok(pre.includes(trecho), trecho);
  const conf = migration.slice(iConf);
  for (const trecho of [
    `v_hash IS DISTINCT FROM '${H_NOVO}'`,
    "p.prosecdef",
    "p.provolatile = 'v'",
    "t.tgtype = 17",
    "aclexplode(coalesce(p.proacl, acldefault('f', p.proowner)))",
    "g.privilege_type = 'EXECUTE' AND g.grantee = 0",
    "RAISE EXCEPTION 'conferencia 20261233:",
  ])
    assert.ok(conf.includes(trecho), trecho);
});

Deno.test("o rollback tem pre-voo (aceita o corpo desta migration ou o vigente, atributos, ACL) e conferencia (o corpo volta ao vigente, a trigger no lugar, a ACL a de hoje); nunca da EXECUTE a ninguem", () => {
  const iPre = rollback.indexOf("DO $preflight_rollback_20261233$");
  const iCria = rollback.indexOf("\nCREATE OR REPLACE FUNCTION");
  const iConf = rollback.indexOf("DO $conferencia_rollback_20261233$");
  assert.ok(iPre >= 0 && iPre < iCria && iCria < iConf);
  const pre = rollback.slice(iPre, iCria);
  assert.ok(pre.includes(`('${ASSINATURA}', '${H_VIGENTE}', '${H_NOVO}')`));
  assert.ok(pre.includes("v_hash NOT IN (r.hash_vigente, r.hash_desta)"));
  assert.ok(pre.includes("RAISE EXCEPTION 'B1_BASELINE_DIVERGENT:"));
  const conf = rollback.slice(iConf);
  assert.ok(conf.includes(`v_hash IS DISTINCT FROM '${H_VIGENTE}'`));
  assert.ok(conf.includes("t.tgtype = 17"), "a trigger continua no lugar");
  assert.ok(
    conf.includes("g.grantee = 0"),
    "a ACL de hoje (aberta por heranca do PUBLIC) continua",
  );
  assert.doesNotMatch(
    limpo(rollback.replace(corpoDe(rollback), "")),
    /GRANT|REVOKE/i,
  );
});

Deno.test("o cabecalho declara o que acontece com o dado que ja existe, a ordem de desfazer e o custo zero de dado; a lista de portas permitidas e a ACL de hoje nao mudam", () => {
  for (const trecho of [
    "DADOS EXISTENTES",
    "FICAM como estão",
    "ROLLBACK MANUAL",
    "IDEMPOTÊNCIA E TRANSAÇÃO",
    "NÃO apaga nenhuma notificação",
    "Sem BEGIN/COMMIT de nível superior",
  ])
    assert.ok(migration.includes(trecho), trecho);
  const portas = JSON.parse(
    Deno.readTextFileSync(
      new URL("tests/banco/portas-do-visitante-permitidas.json", DIR),
    ),
  );
  const lista = JSON.stringify(portas);
  assert.ok(lista.includes("public.notifica_cliente_de_mudanca_de_status()"));
});

Deno.test("so a 20261026000000 e este par definem a funcao; depois da 20261026000000 ninguem mais a redefine alem deste par", () => {
  const todas = [...Deno.readDirSync(new URL("supabase/migrations/", DIR))]
    .map((e) => e.name)
    .filter((n) => n.endsWith(".sql") && !n.startsWith("_"));
  const definem = [];
  for (const n of todas)
    if (
      /create (?:or replace )?function public\.notifica_cliente_de_mudanca_de_status\b/.test(
        limpo(ler(n)).toLowerCase(),
      )
    )
      definem.push(n);
  assert.deepEqual(
    definem.sort(),
    [VIGENTE, NOME, `rollback-manual-${NOME}`].sort(),
  );
});

// ---------------------------------------------------------------------------
// A entrada VERIFICACOES provada por SABOTAGEM: uma entrada que nunca reprova e' pior que entrada ausente — aqui a
// MESMA checagem que o db-apply roda contra o banco e' exercitada contra o corpo VELHO (deve FALHAR), o NOVO (deve
// VERIFICAR) e mutantes do novo (devem FALHAR); e a entrada da 20261026000000 segue valendo com o corpo novo.
// ---------------------------------------------------------------------------
const { avaliarChecagem, VERIFICACOES } = require("../scripts/db-apply.cjs");

Deno.test("SABOTAGEM: com o corpo velho (sem a retirada), a entrada VERIFICACOES da 20261233000000 reprova; com o corpo novo, verifica; sem um dos textos novos, reprova", () => {
  // eslint-disable-next-line security/detect-object-injection -- NOME e' constante deste arquivo, nao entrada de usuario
  const entrada = VERIFICACOES[NOME];
  assert.ok(
    entrada !== undefined,
    "sem entrada em VERIFICACOES para a migration",
  );
  assert.equal(entrada.length, 1);
  assert.equal(entrada[0].funcao, "notifica_cliente_de_mudanca_de_status");
  assert.equal(avaliarChecagem(CORPO_VIGENTE, entrada[0]).situacao, "falhou");
  assert.equal(avaliarChecagem(CORPO_NOVO, entrada[0]).situacao, "verificada");
  for (const [de, para] of [
    ["Pedido pronto para retirar", "Pedido pronto para retirax"],
    ["'Pedido retirado'", "'Pedido retirax'"],
    ["= 'store-pickup'", "= 'store-pickux'"],
    ["Pedido a caminho", "Pedido a caminhx"],
    ["IF NEW.user_id IS NULL THEN", "IF false THEN"],
    ["IF OLD.status IS NOT DISTINCT FROM NEW.status THEN", "IF false THEN"],
  ])
    assert.equal(
      avaliarChecagem(
        CORPO_NOVO.replace(de, () => para),
        entrada[0],
      ).situacao,
      "falhou",
      `mutante: ${de}`,
    );
  // repetir um literal contado (inclusive em comentario) tambem reprova: a contagem e' exata
  assert.equal(
    avaliarChecagem(`${CORPO_NOVO}\n-- Pedido retirado\n`, entrada[0]).situacao,
    "falhou",
  );
});

Deno.test("a entrada ANTIGA da 20261026000000 segue verificando com o corpo NOVO (a troca so soma o ramo da retirada)", () => {
  // eslint-disable-next-line security/detect-object-injection -- VIGENTE e' constante deste arquivo, nao entrada de usuario
  const antiga = VERIFICACOES[VIGENTE];
  assert.ok(antiga !== undefined);
  for (const checagem of antiga) {
    assert.equal(
      avaliarChecagem(CORPO_VIGENTE, checagem).situacao,
      "verificada",
    );
    assert.equal(avaliarChecagem(CORPO_NOVO, checagem).situacao, "verificada");
  }
});
