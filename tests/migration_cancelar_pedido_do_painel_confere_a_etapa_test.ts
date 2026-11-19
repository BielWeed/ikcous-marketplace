import assert from "node:assert/strict";

const pasta = new URL("../supabase/migrations/", import.meta.url);
const base = "20261405600000_cancelar_retirada_pronta.sql";
const nova = "20261405700000_cancelar_pedido_do_painel_confere_a_etapa.sql";
const ler = (nome: string) =>
  Deno.readTextFileSync(new URL(nome, pasta)).replaceAll("\r", "");
function definicao(sql: string, fn: string) {
  const ini = sql.indexOf(`CREATE OR REPLACE FUNCTION public.${fn}(`);
  const fim = sql.indexOf("$$;", ini);
  return ini >= 0 && fim > ini ? sql.slice(ini, fim + 3) : "";
}

Deno.test("5700: compara a etapa só depois de autenticar e travar estornos e pedido; antes dos efeitos", () => {
  let sql: string;
  try {
    sql = ler(nova);
  } catch (erro) {
    if (!(erro instanceof Deno.errors.NotFound)) throw erro;
    sql = ler(base);
  }
  const rotina = definicao(sql, "pedido__mudar_status_com_etapa") ||
    definicao(sql, "pedido__mudar_status");
  const banco = rotina.indexOf(
    "v_old_status IS DISTINCT FROM p_status_esperado",
  );
  assert.ok(banco > 0, "a etapa ainda não é conferida sob a trava");
  const ordem = [
    "FROM public.order_refunds",
    "FROM public.marketplace_orders",
    "IF v_user_id IS DISTINCT FROM v_caller_id AND NOT v_is_admin",
    "v_old_status IS DISTINCT FROM p_status_esperado",
    "SET cancelled_after_shipping = true",
    "INSERT INTO public.order_refunds",
    "PERFORM public.devolver_estoque",
    "INSERT INTO public.marketplace_order_history",
  ].map((trecho) => rotina.indexOf(trecho));
  assert.ok(ordem.every((n, i) => n >= 0 && (i === 0 || n > ordem[i - 1])));
  assert.match(rotina, /pedido_status_mudou: O pedido mudou de situação/);
  const porta = definicao(sql, "cancelar_pedido_do_painel");
  assert.match(porta, /p_status_esperado text,/);
  assert.ok(
    porta.indexOf("NOT public.is_admin_atual()") <
      porta.indexOf("p_status_esperado IS NULL"),
  );
  assert.match(porta, /p_status_esperado IS NULL/);
  assert.match(
    porta,
    /'cancelled', p_notes, auth.uid\(\), true, false, p_status_esperado/,
  );
});

Deno.test("5700: a lista reconhece só a porta autenticada do painel, não a rotina privada", () => {
  const lista = JSON.parse(
    Deno.readTextFileSync(
      new URL("./banco/portas-do-visitante-permitidas.json", import.meta.url),
    ),
  ) as {
    funcoes: {
      funcao: string;
      executa: string[];
      tipo: string;
      secdef: boolean;
    }[];
  };
  const nomes = [
    "public.cancelar_pedido_do_painel(",
    "public.pedido__mudar_status_com_etapa(",
  ];
  const portas = lista.funcoes.filter(({ funcao }) =>
    nomes.some((nome) => funcao.startsWith(nome))
  ).map(({ funcao, executa, tipo, secdef }) => ({
    funcao,
    executa,
    tipo,
    secdef,
  }));
  assert.deepEqual(portas, [{
    funcao:
      "public.cancelar_pedido_do_painel(p_order_id uuid, p_status_esperado text, p_notes text)",
    executa: ["authenticated"],
    tipo: "volatil",
    secdef: true,
  }]);
});

Deno.test("5700: BC do app antigo permanece e rollback restaura o corpo da 5600 byte a byte", () => {
  const sql = ler(nova);
  const nome = "pedido__mudar_status";
  assert.equal(
    definicao(ler(`rollback-manual-${nova}`), nome),
    definicao(ler(base), nome),
  );
  assert.match(definicao(sql, nome), /p_pela_edge, NULL::text/);
  assert.doesNotMatch(
    sql,
    /^CREATE OR REPLACE FUNCTION public\.(?:cancelar_pedido_com_cobranca|update_order_status_atomic)\(/m,
  );
  assert.doesNotMatch(sql, /^(BEGIN|COMMIT);/im);
});
