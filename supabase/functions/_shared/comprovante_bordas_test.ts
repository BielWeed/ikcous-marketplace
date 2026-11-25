// @ts-nocheck
/**
 * Caça por mutação (24/11/2026) em `comprovante.ts` — o e-mail que diz ao
 * cliente QUANTO ele pagou e por quê. 56 mutantes sobreviviam às quatro suítes
 * do comprovante; metade era `??`/`||` sem efeito (texto que já é texto). Os
 * que mudavam o que o cliente LÊ ou o que o sistema AFIRMA viram os casos
 * abaixo:
 *
 *   * a linha de cada item é quantidade x preço unitário (3 x 10,50 = 31,50), e
 *     quantidade/preço ilegíveis valem zero (nunca "NaN");
 *   * só o Desconto leva o sinal de menos; Subtotal, Entrega e Total nunca
 *     (um Subtotal "− R$ 100,00" seria o app dizendo que o cliente ganhou
 *     dinheiro) — e só o Total é negrito;
 *   * frete gravado como ZERO não "vira" o custo de frete de outra coluna;
 *   * o e-mail do cliente vai ao log MASCARADO: nome curto some inteiro, nome
 *     de 3+ letras mostra só a primeira e a última, e texto que não é um
 *     endereço único vira `***`;
 *   * valor de dinheiro que não é número ("abc") some em vez de virar "NaN";
 *   * a variação "Tamanho: M" só existe com valor (nome sem valor não vira
 *     "Tamanho: "), e a variação gravada na compra só vale com o NOME gravado —
 *     sem ele o item cai na variação atual do produto;
 *   * se a releitura da marca de envio FALHA ou LANÇA, o comprovante não afirma
 *     "enviado" nem "teto": responde `envio_falhou` e não envia nada.
 *
 * Fixtures inventadas; nenhum SMTP, nenhuma rede.
 */
import { assert, assertEquals } from "https://deno.land/std@0.177.0/testing/asserts.ts";
import {
  enviarComprovantePedido,
  htmlDoPedido,
  linhasDosItens,
  mascarar,
  variacoesDosItens,
} from "./comprovante.ts";

const UUID_PEDIDO = "d77c6616-c389-4caa-b5c1-9a8d7af77f72";
const REMETENTE = { origem: "ambiente", usuario: "loja@exemplo.invalid", senha: "senha-de-teste", motivo: null, reserva: null };

/** O `<tr>` que contém o rótulo (ou "" se a linha não existe). */
function linhaDe(html: string, rotulo: string): string {
  const trecho = html.split("</tr>").find((l) => l.includes(`>${rotulo}</td>`)) ?? "";
  return trecho === "" ? "" : trecho.slice(trecho.lastIndexOf("<tr>"));
}

function html(pedido: Record<string, unknown>, itens: Array<Record<string, unknown>> = []) {
  return htmlDoPedido({ pedido: { id: UUID_PEDIDO, ...pedido }, itens, endereco: "", nomeDaLoja: "Loja", aguardandoPagamento: false });
}

// ─── os itens ────────────────────────────────────────────────────────────────

Deno.test("linha do item: total = quantidade x preço unitário (3 x 10,50 = 31,50; 2 x 19,99 = 39,98)", () => {
  const t = linhasDosItens([
    { product_name: "Blusa", quantity: 3, price: 10.5 },
    { product_name: "Calça", quantity: 2, price: "19.99" },
  ]);
  assert(t.includes("3× Blusa"));
  assert(t.includes("31,50"), t);
  assert(t.includes("2× Calça"));
  assert(t.includes("39,98"), t);
  assert(!t.includes("10,50"), "o unitário não pode aparecer no lugar do total do item");
});

Deno.test("linha do item: quantidade ou preço ilegíveis valem zero (nunca NaN) e o nome ausente vira 'Produto'", () => {
  for (const ruim of ["abc", null, undefined, {}, NaN]) {
    const a = linhasDosItens([{ product_name: "Blusa", quantity: 2, price: ruim }]);
    assert(!a.includes("NaN"), `preço ${String(ruim)}`);
    assert(a.includes("0,00"), `preço ${String(ruim)}: ${a}`);
    const b = linhasDosItens([{ product_name: "Blusa", quantity: ruim, price: 10 }]);
    assert(!b.includes("NaN"), `quantidade ${String(ruim)}`);
    assert(b.includes("0× Blusa"), `quantidade ${String(ruim)}`);
  }
  assert(linhasDosItens([{ quantity: 1, price: 5 }]).includes("1× Produto"));
});

// ─── as linhas de valor ──────────────────────────────────────────────────────

Deno.test("só o Desconto leva o sinal de menos; Subtotal, Entrega e Total não; só o Total é negrito", () => {
  const h = html({ subtotal: 100, shipping: 15, discount: 30, total: 85 });
  const sub = linhaDe(h, "Subtotal");
  const ent = linhaDe(h, "Entrega");
  const des = linhaDe(h, "Desconto");
  const tot = linhaDe(h, "Total");
  for (const [nome, l] of [["Subtotal", sub], ["Entrega", ent], ["Desconto", des], ["Total", tot]]) {
    assert(l !== "", `linha ${nome} ausente`);
  }
  assert(sub.includes("100,00") && !sub.includes("−"), sub);
  assert(ent.includes("15,00") && !ent.includes("−"), ent);
  assert(des.includes("30,00") && des.includes("−"), des);
  assert(tot.includes("85,00") && !tot.includes("−"), tot);
  assert(tot.includes("font-weight: 700"), tot);
  for (const l of [sub, ent, des]) assert(l.includes("font-weight: 400") && !l.includes("font-weight: 700"), l);
});

Deno.test("desconto gravado NEGATIVO mostra o módulo (nunca '− −')", () => {
  const des = linhaDe(html({ subtotal: 100, discount: -30, total: 70 }), "Desconto");
  assert(des.includes("30,00") && des.includes("−") && !des.includes("−−") && !des.includes("− −"), des);
  assert(!des.includes("-30"), des);
});

Deno.test("frete gravado como ZERO não é trocado pelo custo de frete de outra coluna; ausente usa a outra coluna", () => {
  const zero = html({ subtotal: 100, shipping: 0, shipping_cost: 15, total: 100 });
  assertEquals(linhaDe(zero, "Entrega"), "", "shipping 0 gravado: sem linha de entrega");
  const ausente = html({ subtotal: 100, shipping_cost: 15, total: 115 });
  assert(linhaDe(ausente, "Entrega").includes("15,00"));
});

Deno.test("total ZERO gravado (cupom de 100%) aparece como R$ 0,00 e não é trocado pelo total_amount", () => {
  const h = html({ subtotal: 100, discount: 100, total: 0, total_amount: 99 });
  const tot = linhaDe(h, "Total");
  assert(tot.includes("0,00") && !tot.includes("99,00"), tot);
});

// ─── o e-mail no log ─────────────────────────────────────────────────────────

Deno.test("mascarar: nome de 3+ letras mostra primeira e última; nome curto some; texto que não é um endereço único vira ***", () => {
  assertEquals(mascarar("abc@exemplo.invalid"), "a***c@exemplo.invalid");
  assertEquals(mascarar("maria@exemplo.invalid"), "m***a@exemplo.invalid");
  assertEquals(mascarar("ab@exemplo.invalid"), "***@exemplo.invalid");
  assertEquals(mascarar("a@exemplo.invalid"), "***@exemplo.invalid");
  assertEquals(mascarar("sem-arroba"), "***");
  assertEquals(mascarar("a@b@c"), "***");
  assertEquals(mascarar(""), "***");
  assertEquals(mascarar(null), "***");
  assertEquals(mascarar(undefined), "***");
});

// ─── a releitura da marca de envio ───────────────────────────────────────────

/** Banco dublê: a reserva é NEGADA; a releitura da marca devolve o que o teste mandar. */
function bancoComReservaNegada(releitura: () => unknown) {
  let leiturasDaMarca = 0;
  const pedido = { id: UUID_PEDIDO, customer_data: { email: "cliente@exemplo.invalid" } };
  return {
    leituras: () => leiturasDaMarca,
    rpc: async () => ({ data: false, error: null }),
    from() {
      return {
        select(colunas: string) {
          return {
            eq() {
              const eNaMarca = colunas === "confirmation_email_sent_at";
              if (eNaMarca) leiturasDaMarca++;
              return {
                maybeSingle: () => (eNaMarca ? releitura() : Promise.resolve({ data: pedido, error: null })),
              };
            },
          };
        },
      };
    },
  };
}

async function reenviarComReservaNegada(releitura: () => unknown) {
  const banco = bancoComReservaNegada(releitura);
  let envios = 0;
  const [e, w, l] = [console.error, console.warn, console.log];
  console.error = () => {};
  console.warn = () => {};
  console.log = () => {};
  try {
    const desfecho = await enviarComprovantePedido({
      supabase: banco as never,
      orderId: UUID_PEDIDO,
      deps: {
        resolverRemetente: () => Promise.resolve(REMETENTE),
        enviarEmail: () => {
          envios++;
          return Promise.resolve();
        },
      },
    });
    return { desfecho, envios, leituras: banco.leituras() };
  } finally {
    [console.error, console.warn, console.log] = [e, w, l];
  }
}

Deno.test("releitura da marca que LANÇA: envio_falhou — não afirma 'enviado' nem 'teto', e nada é enviado", async () => {
  const r = await reenviarComReservaNegada(() => {
    throw new Error("conexão caiu");
  });
  assertEquals(r.desfecho, { ok: false, motivo: "envio_falhou" });
  assertEquals(r.envios, 0);
  assertEquals(r.leituras, 1);
});

Deno.test("releitura da marca que REJEITA (promessa): envio_falhou", async () => {
  const r = await reenviarComReservaNegada(() => Promise.reject(new Error("timeout")));
  assertEquals(r.desfecho, { ok: false, motivo: "envio_falhou" });
  assertEquals(r.envios, 0);
});

Deno.test("releitura com ERRO mesmo trazendo uma marca: envio_falhou — uma resposta com erro não vale como 'já enviado'", async () => {
  const r = await reenviarComReservaNegada(() =>
    Promise.resolve({ data: { confirmation_email_sent_at: "2026-11-24T10:00:00Z" }, error: { message: "boom" } })
  );
  assertEquals(r.desfecho, { ok: false, motivo: "envio_falhou" });
  assertEquals(r.envios, 0);
});

Deno.test("releitura da marca: sem erro e com marca = ja_enviado; sem marca = teto_diario; sem linha = envio_falhou", async () => {
  assertEquals(
    (await reenviarComReservaNegada(() => Promise.resolve({ data: { confirmation_email_sent_at: "2026-11-24T10:00:00Z" }, error: null }))).desfecho,
    { ok: false, motivo: "ja_enviado" },
  );
  assertEquals(
    (await reenviarComReservaNegada(() => Promise.resolve({ data: { confirmation_email_sent_at: null }, error: null }))).desfecho,
    { ok: false, motivo: "teto_diario" },
  );
  assertEquals(
    (await reenviarComReservaNegada(() => Promise.resolve({ data: null, error: null }))).desfecho,
    { ok: false, motivo: "envio_falhou" },
  );
});

// ─── valor que não é número ──────────────────────────────────────────────────

Deno.test("valor de dinheiro que não é número ('abc') some do e-mail: nunca 'R$ NaN'", () => {
  const h = html({ subtotal: "abc", shipping: "x", discount: {}, total: 50 });
  assert(!h.includes("NaN"));
  assertEquals(linhaDe(h, "Subtotal"), "");
  assertEquals(linhaDe(h, "Entrega"), "");
  assertEquals(linhaDe(h, "Desconto"), "");
  assert(linhaDe(h, "Total").includes("50,00"));
});

// ─── a variação do item ──────────────────────────────────────────────────────

function bancoDeVariantes(variantes: Array<Record<string, unknown>>) {
  const consultas: unknown[][] = [];
  return {
    consultas,
    from: () => ({
      select: () => ({
        in: (_c: string, ids: unknown[]) => {
          consultas.push(ids);
          return Promise.resolve({ data: variantes, error: null });
        },
      }),
    }),
  };
}

Deno.test("variação atual do produto: 'Tamanho: M' com valor; nome SEM valor não vira 'Tamanho: '; valor sem nome fica só o valor", async () => {
  const banco = bancoDeVariantes([
    { id: "V1", name: "Tamanho", value: "M" },
    { id: "V2", name: "Tamanho", value: "" },
    { id: "V3", name: "", value: "Azul" },
    { id: "V4", name: "  ", value: "  " },
  ]);
  const itens = ["V1", "V2", "V3", "V4"].map((v) => ({ variant_id: v }));
  const mapa = await variacoesDosItens(banco as never, itens);
  assertEquals(mapa.get("V1"), "Tamanho: M");
  assertEquals(mapa.has("V2"), false);
  assertEquals(mapa.get("V3"), "Azul");
  assertEquals(mapa.has("V4"), false);
});

Deno.test("variação gravada na compra só vale com o NOME gravado: sem ele o item é consultado na variação atual", async () => {
  const banco = bancoDeVariantes([{ id: "V1", name: "Tamanho", value: "G" }]);
  const itens = [
    { variant_id: "V1", variacao_nome_na_compra: null, variacao_valor_na_compra: "M" },
    { variant_id: "V9", variacao_nome_na_compra: "Cor", variacao_valor_na_compra: "Azul" },
  ];
  const mapa = await variacoesDosItens(banco as never, itens);
  assertEquals(banco.consultas, [["V1"]], "só o item sem nome gravado vai à consulta");
  assertEquals(mapa.get("V1"), "Tamanho: G");
  assertEquals(mapa.has("V9"), false, "o item com variação gravada nem é consultado");
});
