import assert from "node:assert/strict";
import { createHash } from "node:crypto";

const pasta = new URL("../supabase/migrations/", import.meta.url);
const base = "20261198000000_cancelar_pedido_anula_a_cobranca.sql";
const nova = "20261405600000_cancelar_retirada_pronta.sql";
const assinatura = "CREATE OR REPLACE FUNCTION public.pedido__mudar_status(";
const ler = (nome: string) =>
  Deno.readTextFileSync(new URL(nome, pasta)).replaceAll("\r", "");
const definicao = (sql: string) => {
  const inicio = sql.indexOf(assinatura);
  assert.ok(inicio >= 0, "definição da rotina de status");
  const abertura = sql.indexOf("AS $$", inicio);
  const fim = sql.indexOf("$$;", abertura);
  assert.ok(fim > abertura);
  return sql.slice(inicio, fim + 3);
};
const corpo = (sql: string) => definicao(sql).split("$$")[1];
const hash = (texto: string) => createHash("md5").update(texto).digest("hex");

Deno.test("5600: só o admin ganha os três efeitos da retirada pronta", () => {
  let sql: string;
  try {
    sql = ler(nova);
  } catch (erro) {
    if (!(erro instanceof Deno.errors.NotFound)) throw erro;
    sql = ler(base);
  }
  const rotina = corpo(sql);
  assert.match(
    rotina,
    /COALESCE\(customer_data ->> 'shipping_option_id', ''\) = 'store-pickup'/,
    "somente a modalidade exata de retirada conta (ausente é entrega)",
  );
  assert.match(
    rotina,
    /\(v_old_status = 'shipping' AND NOT \(v_retirada AND v_is_admin\)\)\s+OR \(v_old_status = 'delivered' AND v_canal IS DISTINCT FROM 'presencial'\)/,
    "não carimba retirada pronta, preserva a saída nas outras modalidades",
  );
  assert.match(
    rotina,
    /v_old_status IN \('pending', 'processing'\) OR \(v_old_status = 'shipping' AND v_retirada AND v_is_admin\)\)[\s\S]*?AND NOT v_cancelled_after_shipping/,
    "estorno automático só antes de sair, preservando o veto histórico",
  );
  assert.match(
    rotina,
    /\(v_old_status IS DISTINCT FROM 'shipping' OR \(v_retirada AND v_is_admin\)\)\s+AND \(v_old_status IS DISTINCT FROM 'delivered' OR v_canal = 'presencial'\)\s+AND NOT v_cancelled_after_shipping/,
    "estoque da retirada pronta volta, salvo saída histórica; balcão intacto",
  );
  assert.equal(
    rotina.match(/PERFORM public\.devolver_estoque\(p_order_id\)/g)?.length,
    1,
  );
});

Deno.test("5600: o rollback reproduz a definição vigente e a migration não muda a assinatura", () => {
  const origem = ler(base);
  const sql = ler(nova);
  const rollback = ler(`rollback-manual-${nova}`);
  assert.equal(hash(corpo(origem)), "4623b27a07468553d6ac00a888e04db4");
  assert.equal(definicao(rollback), definicao(origem));
  assert.equal(definicao(sql).split("$$")[0], definicao(origem).split("$$")[0]);
  for (const texto of [sql, rollback]) {
    assert.doesNotMatch(texto, /^(?:BEGIN|COMMIT);/im);
    assert.equal(texto.match(/^CREATE OR REPLACE FUNCTION /gm)?.length, 1);
  }
});
