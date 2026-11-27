// @ts-nocheck
/**
 * O lojista fica sabendo quando o CLIENTE cancela o pedido (14/10/2026).
 *
 * O banco é um dublê EM MEMÓRIA com os filtros de verdade (`eq`, `not`,
 * `gte`, `in`, `order`, `limit`) e projeção das colunas pedidas: um dublê que
 * devolvesse tudo, sempre, deixaria o teste verde mesmo sem o filtro de
 * `new_status = 'cancelled'` ou sem a janela de 24 h. Cada filtro tem um caso
 * que SÓ ele segura.
 */
import { assertEquals, assertStringIncludes } from "https://deno.land/std@0.177.0/testing/asserts.ts";
import {
  avisarCancelamentosDoCliente,
  JANELA_HORAS,
  montarAvisoDeCancelamento,
} from "./aviso-de-cancelamento-do-cliente.ts";

const AGORA = Date.parse("2026-10-14T12:00:00.000Z");
const CLIENTE = "c1111111-1111-4111-8111-111111111111";
const OUTRO_CLIENTE = "c2222222-2222-4222-8222-222222222222";
const ADMIN = "a1111111-1111-4111-8111-111111111111";
const PEDIDO = "3f2a1b8c-4d5e-4f60-9a7b-1c2d3e4f5a6b";
const PEDIDO_B = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

const minutosAtras = (m: number) => new Date(AGORA - m * 60000).toISOString();

type Linha = Record<string, unknown>;
// Leitura por nome de coluna sem indexacao dinamica (security/detect-object-injection).
const campo = (linha: Linha, coluna: string) => Reflect.get(linha, coluna);

/** Dublê de banco: tabelas em memória + filtros reais + projeção. */
function bancoFalso(tabelas: Record<string, Linha[]>, opts: { falharEm?: string } = {}) {
  const leituras: Array<{ tabela: string; filtros: string[] }> = [];
  return {
    leituras,
    from(tabela: string) {
      if (!(tabela in tabelas)) throw new Error(`from inesperado no dublê: ${tabela}`);
      let linhas = [...(Reflect.get(tabelas, tabela) as Linha[])];
      let colunas: string[] | null = null;
      const filtros: string[] = [];
      leituras.push({ tabela, filtros });
      const q = {
        select: (c: string) => {
          colunas = c.split(",").map((x) => x.trim());
          return q;
        },
        eq: (col: string, v: unknown) => {
          filtros.push(`eq:${col}`);
          linhas = linhas.filter((l) => campo(l, col) === v);
          return q;
        },
        not: (col: string, op: string, v: unknown) => {
          filtros.push(`not:${col}:${op}`);
          if (op === "is" && v === null) linhas = linhas.filter((l) => campo(l, col) !== null && campo(l, col) !== undefined);
          return q;
        },
        gte: (col: string, v: string) => {
          filtros.push(`gte:${col}`);
          linhas = linhas.filter((l) => String(campo(l, col)) >= v);
          return q;
        },
        in: (col: string, vs: unknown[]) => {
          filtros.push(`in:${col}`);
          linhas = linhas.filter((l) => vs.includes(campo(l, col)));
          return q;
        },
        order: (col: string, o: { ascending: boolean }) => {
          filtros.push(`order:${col}`);
          linhas.sort((a, b) => (String(campo(a, col)) < String(campo(b, col)) ? -1 : 1) * (o?.ascending === false ? -1 : 1));
          return q;
        },
        limit: (n: number) => {
          filtros.push(`limit:${n}`);
          linhas = linhas.slice(0, n);
          return q;
        },
        then: (res: (v: unknown) => void, rej?: (e: unknown) => void) => {
          if (opts.falharEm === tabela) {
            return Promise.resolve({ data: null, error: { message: `${tabela} fora do ar` } }).then(res, rej);
          }
          const saida = colunas
            ? linhas.map((l) =>
              Object.fromEntries(colunas!.map((c) => {
                if (c === "customer_data->>pickup_address") {
                  const dados = campo(l, "customer_data") as
                    | { pickup_address?: string }
                    | undefined;
                  return ["pickup_address", dados?.pickup_address ?? null];
                }
                return [c, campo(l, c)];
              }))
            )
            : linhas;
          return Promise.resolve({ data: saida, error: null }).then(res, rej);
        },
      };
      return q;
    },
  };
}

function cenario(sobre: {
  historico?: Linha[];
  pedidos?: Linha[];
  perfis?: Linha[];
  falharEm?: string;
}) {
  const banco = bancoFalso(
    {
      marketplace_order_history: sobre.historico ?? [],
      marketplace_orders: sobre.pedidos ?? [],
      profiles: sobre.perfis ?? [],
    },
    { falharEm: sobre.falharEm },
  );
  const avisos: Array<{ chave: string; aviso: { title: string; body: string; url: string } }> = [];
  const avisar = (chave: string, aviso: { title: string; body: string; url: string }) => {
    avisos.push({ chave, aviso });
    return Promise.resolve();
  };
  return { banco, avisos, avisar };
}

const hist = (id: string, extra: Linha = {}) => ({
  id,
  order_id: PEDIDO,
  old_status: "pending",
  new_status: "cancelled",
  created_by: CLIENTE,
  created_at: minutosAtras(3),
  ...extra,
});
const pedido = (extra: Linha = {}) => ({
  id: PEDIDO,
  user_id: CLIENTE,
  customer_name: "Maria Silva",
  total: 149.9,
  total_amount: null,
  payment_status: "pago",
  status: "cancelled",
  cancelled_after_shipping: false,
  ...extra,
});
const perfis = [
  { id: CLIENTE, role: "customer" },
  { id: OUTRO_CLIENTE, role: "customer" },
  { id: ADMIN, role: "admin" },
];

async function rodar(sobre: Parameters<typeof cenario>[0]) {
  const c = cenario(sobre);
  const erros: string[] = [];
  const original = console.error;
  console.error = (...a: unknown[]) => erros.push(a.map(String).join(" "));
  try {
    const resumo = await avisarCancelamentosDoCliente({
      supabase: c.banco,
      avisar: c.avisar,
      agora: () => AGORA,
      rotulo: "teste",
    });
    return { ...c, resumo, erros };
  } finally {
    console.error = original;
  }
}

Deno.test("cliente cancelou pedido PAGO e NAO enviado -> 1 aviso, chave por evento, texto do reembolso automatico", async () => {
  const r = await rodar({ historico: [hist("h1")], pedidos: [pedido()], perfis });
  assertEquals(r.avisos.length, 1);
  assertEquals(r.avisos[0].chave, "cancelado_pelo_cliente:h1");
  assertEquals(r.avisos[0].aviso, {
    title: "Cliente cancelou o pedido",
    body: "#4F5A6B · R$ 149,90 · Maria Silva — pago, o reembolso é automático",
    url: `/admin-orders?id=${PEDIDO}`,
  });
  assertEquals(r.resumo, { candidatos: 1, avisados: 1, ignorados: 0, falhas: 0 });
});

Deno.test("cliente cancelou uma RETIRADA PRONTA já paga -> aviso orienta conferir o produto na loja", async () => {
  const enderecoDaLoja = "Rua de Teste, 42";
  const r = await rodar({
    historico: [hist("h1", { old_status: "shipping" })],
    pedidos: [
      pedido({
        cancelled_after_shipping: true,
        customer_data: { pickup_address: enderecoDaLoja },
      }),
    ],
    perfis,
  });
  assertEquals(r.avisos.length, 1);
  const { body } = r.avisos[0].aviso;
  assertStringIncludes(body, "pronto para retirada");
  assertStringIncludes(body, "confirme que o produto está na loja");
  assertStringIncludes(body, '"O produto voltou"');
  for (const proibido of ["transporte", "automático", enderecoDaLoja]) {
    assertEquals(body.includes(proibido), false, proibido);
  }
});

Deno.test("cliente cancelou pedido JA ENVIADO (estava em shipping) -> aviso diz que o produto ja saiu", async () => {
  const r = await rodar({
    historico: [hist("h1", { old_status: "shipping" })],
    pedidos: [
      pedido({
        cancelled_after_shipping: true,
        customer_data: { pickup_address: "  " },
      }),
    ],
    perfis,
  });
  assertEquals(r.avisos.length, 1);
  assertStringIncludes(r.avisos[0].aviso.body, "o produto já saiu: avise o transporte");
  assertEquals(r.avisos[0].aviso.body.includes("automático"), false);
});

Deno.test("retirada paga cancelada em processing sem histórico de saída mantém o aviso de reembolso", async () => {
  const r = await rodar({
    historico: [hist("h1", { old_status: "processing" })],
    pedidos: [pedido({ customer_data: { pickup_address: "Rua de Teste, 42" } })],
    perfis,
  });
  assertEquals(r.avisos.length, 1);
  assertEquals(
    r.avisos[0].aviso.body,
    "#4F5A6B · R$ 149,90 · Maria Silva — pago, o reembolso é automático",
  );
});

Deno.test("retirada reativada para processing não vira aviso de transporte nem de retirada pronta", async () => {
  const r = await rodar({
    historico: [hist("h1", { old_status: "processing" })],
    pedidos: [
      pedido({
        cancelled_after_shipping: true,
        customer_data: { pickup_address: "Rua de Teste, 42" },
      }),
    ],
    perfis,
  });
  assertEquals(r.avisos.length, 1);
  const { body } = r.avisos[0].aviso;
  assertStringIncludes(body, "pedido de retirada na loja");
  assertStringIncludes(body, '"O produto voltou"');
  for (const proibido of ["transporte", "pronto para retirada", "automático"]) {
    assertEquals(body.includes(proibido), false, proibido);
  }
});

Deno.test("retirada pronta com retorno já confirmado avisa do cancelamento sem pedir outro clique", async () => {
  const r = await rodar({
    historico: [hist("h1", { old_status: "shipping" })],
    pedidos: [
      pedido({
        cancelled_after_shipping: true,
        returned_to_seller_at: minutosAtras(1),
        customer_data: { pickup_address: "Rua de Teste, 42" },
      }),
    ],
    perfis,
  });
  assertEquals(r.avisos.length, 1);
  const { body } = r.avisos[0].aviso;
  assertStringIncludes(body, "pronto para retirada");
  assertStringIncludes(body, "retorno do produto já foi confirmado");
  assertEquals(body.includes("O produto voltou"), false);
});

Deno.test("flag de envio sozinha prova que o produto já saiu, mesmo com histórico em processing", () => {
  const aviso = montarAvisoDeCancelamento(
    pedido({ payment_status: "pago", cancelled_after_shipping: true }),
    { old_status: "processing" },
  );
  assertStringIncludes(aviso.body, "o produto já saiu");
  assertEquals(aviso.body.includes("automático"), false);
});

Deno.test("histórico em shipping sozinho prova que o produto já saiu, mesmo com flag falsa", () => {
  const aviso = montarAvisoDeCancelamento(
    pedido({ payment_status: "pago", cancelled_after_shipping: false }),
    { old_status: "shipping" },
  );
  assertStringIncludes(aviso.body, "o produto já saiu");
  assertEquals(aviso.body.includes("automático"), false);
});

Deno.test("pagamento que entrou DEPOIS do cancelamento (pago_apos_expirar) -> aviso sem prometer reembolso automatico", async () => {
  const r = await rodar({
    historico: [hist("h1")],
    pedidos: [pedido({ payment_status: "pago_apos_expirar" })],
    perfis,
  });
  assertEquals(r.avisos.length, 1);
  assertStringIncludes(r.avisos[0].aviso.body, "pago depois do cancelamento");
  assertEquals(r.avisos[0].aviso.body.includes("automático"), false);
});

Deno.test("pagamento recebido na entrega cancelado pela cliente -> push orienta combinar a devolução", async () => {
  const r = await rodar({
    historico: [hist("h1")],
    pedidos: [pedido({ payment_status: "recebido_na_entrega" })],
    perfis,
  });
  assertEquals(r.avisos.length, 1);
  assertEquals(r.avisos[0].chave, "cancelado_pelo_cliente:h1");
  assertStringIncludes(r.avisos[0].aviso.body, "devolução combinada com a cliente");
  assertEquals(r.avisos[0].aviso.body.includes("automático"), false);
});

Deno.test("pagamento recebido na entrega após saída -> push mantém a orientação de transporte", async () => {
  const r = await rodar({
    historico: [hist("h1", { old_status: "shipping" })],
    pedidos: [pedido({ payment_status: "recebido_na_entrega" })],
    perfis,
  });
  assertEquals(r.avisos.length, 1);
  assertStringIncludes(r.avisos[0].aviso.body, "avise o transporte");
  assertStringIncludes(r.avisos[0].aviso.body, "devolução combinada com a cliente");
});

Deno.test("pedido ja estornado pelo cron antes do aviso (estornado) ainda avisa: foi o cliente quem cancelou", async () => {
  const r = await rodar({
    historico: [hist("h1")],
    pedidos: [pedido({ payment_status: "estornado" })],
    perfis,
  });
  assertEquals(r.avisos.length, 1);
});

Deno.test("ADMIN cancelando o pedido de um cliente -> nenhum aviso", async () => {
  const r = await rodar({
    historico: [hist("h1", { created_by: ADMIN })],
    pedidos: [pedido()],
    perfis,
  });
  assertEquals(r.avisos.length, 0);
  assertEquals(r.resumo.ignorados, 1);
});

Deno.test("admin que e DONO do pedido e cancela o proprio -> nenhum aviso", async () => {
  const r = await rodar({
    historico: [hist("h1", { created_by: ADMIN })],
    pedidos: [pedido({ user_id: ADMIN })],
    perfis,
  });
  assertEquals(r.avisos.length, 0);
});

Deno.test("cancelamento sem autor (expiracao do PIX, rotina do servidor) -> nenhum aviso", async () => {
  const r = await rodar({
    historico: [hist("h1", { created_by: null })],
    pedidos: [pedido({ payment_status: "aguardando" })],
    perfis,
  });
  assertEquals(r.avisos.length, 0);
  assertEquals(r.resumo.candidatos, 0);
});

Deno.test("quem cancelou NAO e o dono do pedido (outra pessoa) -> nenhum aviso", async () => {
  const r = await rodar({
    historico: [hist("h1", { created_by: OUTRO_CLIENTE })],
    pedidos: [pedido()],
    perfis,
  });
  assertEquals(r.avisos.length, 0);
});

Deno.test("pedido com pagamento online NAO pago (aguardando, recusado, expirado) -> nenhum aviso", async () => {
  for (const payment_status of ["aguardando", "recusado", "expirado"]) {
    const r = await rodar({
      historico: [hist("h1")],
      pedidos: [pedido({ payment_status })],
      perfis,
    });
    assertEquals(r.avisos.length, 0, String(payment_status));
  }
});

Deno.test("pagar na entrega (pagamento nulo ou vazio) cancelado pela cliente ANTES de sair -> 1 aviso sem falar de dinheiro devolvido", async () => {
  for (const payment_status of [null, ""]) {
    for (const old_status of ["pending", "processing"]) {
      const r = await rodar({
        historico: [hist("h1", { old_status })],
        pedidos: [pedido({ payment_status })],
        perfis,
      });
      assertEquals(r.avisos.length, 1, `${String(payment_status)}/${old_status}`);
      assertEquals(r.avisos[0].chave, "cancelado_pelo_cliente:h1");
      assertEquals(r.avisos[0].aviso.body, "#4F5A6B · R$ 149,90 · Maria Silva — sem pagamento pelo app: não separe nem envie");
      for (const proibido of ["pago,", "reembolso", "estorn"]) assertEquals(r.avisos[0].aviso.body.includes(proibido), false, proibido);
    }
  }
});

Deno.test("pagar na entrega cancelado DEPOIS de sair (shipping) -> nenhum aviso (e' assunto do transporte; igual ao sino)", async () => {
  const a = await rodar({ historico: [hist("h1", { old_status: "shipping" })], pedidos: [pedido({ payment_status: null })], perfis });
  assertEquals(a.avisos.length, 0);
  const b = await rodar({ historico: [hist("h1")], pedidos: [pedido({ payment_status: null, cancelled_after_shipping: true })], perfis });
  assertEquals(b.avisos.length, 0);
});

Deno.test("pagar na entrega cancelado pelo ADMIN ou por outra pessoa -> nenhum aviso", async () => {
  const a = await rodar({ historico: [hist("h1", { created_by: ADMIN })], pedidos: [pedido({ payment_status: null })], perfis });
  assertEquals(a.avisos.length, 0);
  const b = await rodar({ historico: [hist("h1", { created_by: OUTRO_CLIENTE })], pedidos: [pedido({ payment_status: null })], perfis });
  assertEquals(b.avisos.length, 0);
});

Deno.test("pagar na entrega que ja estava cancelado (re-cancelamento) -> nenhum aviso", async () => {
  const r = await rodar({ historico: [hist("h1", { old_status: "cancelled" })], pedidos: [pedido({ payment_status: null })], perfis });
  assertEquals(r.avisos.length, 0);
});

Deno.test("pedido que a loja REATIVOU depois do cancelamento (nao esta mais cancelado) -> nenhum aviso", async () => {
  const r = await rodar({
    historico: [hist("h1")],
    pedidos: [pedido({ status: "processing" })],
    perfis,
  });
  assertEquals(r.avisos.length, 0);
});

Deno.test("linha de historico que NAO e cancelamento (virou 'shipping') -> nunca vira aviso", async () => {
  const r = await rodar({
    historico: [hist("h1", { new_status: "shipping" })],
    pedidos: [pedido()],
    perfis,
  });
  assertEquals(r.avisos.length, 0);
  assertEquals(r.resumo.candidatos, 0);
});

Deno.test("cancelamento FORA da janela de 24 h -> nenhum aviso (e a janela existe, senao a rotina insistiria para sempre)", async () => {
  assertEquals(JANELA_HORAS, 24);
  const r = await rodar({
    historico: [hist("h1", { created_at: minutosAtras(24 * 60 + 1) }), hist("h2", { created_at: minutosAtras(24 * 60 - 1) })],
    pedidos: [pedido()],
    perfis,
  });
  assertEquals(r.avisos.map((a) => a.chave), ["cancelado_pelo_cliente:h2"]);
});

Deno.test("re-cancelamento (ja estava cancelado) nao e evento novo -> nenhum aviso", async () => {
  const r = await rodar({
    historico: [hist("h1", { old_status: "cancelled" })],
    pedidos: [pedido()],
    perfis,
  });
  assertEquals(r.avisos.length, 0);
});

Deno.test("segundo cancelamento (reativou e cancelou de novo) = EVENTO NOVO = chave nova = novo aviso", async () => {
  const r = await rodar({
    historico: [hist("h1", { created_at: minutosAtras(120) }), hist("h2", { created_at: minutosAtras(3) })],
    pedidos: [pedido()],
    perfis,
  });
  assertEquals(r.avisos.map((a) => a.chave).sort(), ["cancelado_pelo_cliente:h1", "cancelado_pelo_cliente:h2"]);
});

Deno.test("reentrada: rodar a rotina duas vezes pede a MESMA chave (a reserva do banco e quem segura o duplicado)", async () => {
  const sobre = { historico: [hist("h1")], pedidos: [pedido()], perfis };
  const a = await rodar(sobre);
  const b = await rodar(sobre);
  assertEquals(a.avisos.map((x) => x.chave), b.avisos.map((x) => x.chave));
});

Deno.test("o aviso carrega SO numero, valor e nome - nada de CPF, endereco, telefone ou e-mail", async () => {
  const r = await rodar({
    historico: [hist("h1")],
    pedidos: [pedido({ customer_cpf: "123.456.789-00", shipping_address: "Rua X, 10", customer_phone: "11999999999", customer_email: "m@x.com" })],
    perfis,
  });
  const texto = JSON.stringify(r.avisos[0].aviso);
  for (const proibido of ["123.456", "Rua X", "11999", "m@x.com"]) assertEquals(texto.includes(proibido), false, proibido);
});

Deno.test("valor vem de total_amount quando total e nulo; nome vazio vira 'cliente sem nome'", () => {
  const aviso = montarAvisoDeCancelamento(
    { id: PEDIDO, customer_name: "   ", total: null, total_amount: 20, payment_status: "pago" },
    { old_status: "pending" },
  );
  assertEquals(aviso.body, "#4F5A6B · R$ 20,00 · cliente sem nome — pago, o reembolso é automático");
});

Deno.test("leitura do historico FALHA -> lanca (o chamador registra e a rotina segue)", async () => {
  let lancou = false;
  try {
    await rodar({ historico: [hist("h1")], pedidos: [pedido()], perfis, falharEm: "marketplace_order_history" });
  } catch {
    lancou = true;
  }
  assertEquals(lancou, true);
});

Deno.test("leitura dos PERFIS falha -> lanca e NAO avisa ninguem (sem saber quem e admin, nao ha como excluir o admin)", async () => {
  const c = cenario({ historico: [hist("h1", { created_by: ADMIN })], pedidos: [pedido()], perfis, falharEm: "profiles" });
  let lancou = false;
  try {
    await avisarCancelamentosDoCliente({ supabase: c.banco, avisar: c.avisar, agora: () => AGORA, rotulo: "t" });
  } catch {
    lancou = true;
  }
  assertEquals(lancou, true);
  assertEquals(c.avisos.length, 0);
});

Deno.test("um aviso que LANCA nao impede o seguinte e conta como falha", async () => {
  const c = cenario({
    historico: [hist("h1"), hist("h2", { order_id: PEDIDO_B })],
    pedidos: [pedido(), pedido({ id: PEDIDO_B })],
    perfis,
  });
  const chamadas: string[] = [];
  const erros: string[] = [];
  const original = console.error;
  console.error = (...a: unknown[]) => erros.push(a.map(String).join(" "));
  let resumo;
  try {
    resumo = await avisarCancelamentosDoCliente({
      supabase: c.banco,
      avisar: (chave) => {
        chamadas.push(chave);
        return chave.endsWith("h1") ? Promise.reject(new Error("push fora do ar")) : Promise.resolve();
      },
      agora: () => AGORA,
      rotulo: "t",
    });
  } finally {
    console.error = original;
  }
  assertEquals(chamadas.sort(), ["cancelado_pelo_cliente:h1", "cancelado_pelo_cliente:h2"]);
  assertEquals([resumo.avisados, resumo.falhas], [1, 1]);
});

Deno.test("sem candidatos: nao toca nas outras tabelas", async () => {
  const r = await rodar({ historico: [], pedidos: [pedido()], perfis });
  assertEquals(r.banco.leituras.map((l) => l.tabela), ["marketplace_order_history"]);
  assertEquals(r.resumo, { candidatos: 0, avisados: 0, ignorados: 0, falhas: 0 });
});

Deno.test("aviso de cancelamento: o toque leva ao pedido do aviso — id na url, codificado, em todas as frases", () => {
  const casos = [
    [{ payment_status: "pago" }, { old_status: "pending" }],
    [{ payment_status: "pago", cancelled_after_shipping: true }, { old_status: "shipping" }],
    [{ payment_status: "pago_apos_expirar" }, { old_status: "pending" }],
    [{ payment_status: null }, { old_status: "pending" }],
  ] as const;
  for (const [extra, historico] of casos) {
    assertEquals(
      montarAvisoDeCancelamento({ id: "a b&id=outro", ...extra }, historico).url,
      "/admin-orders?id=a%20b%26id%3Doutro",
    );
    assertEquals(montarAvisoDeCancelamento({ id: PEDIDO, ...extra }, historico).url, `/admin-orders?id=${PEDIDO}`);
  }
});

// 27/11/2026 (caça): a cliente pode cancelar pedido em `processing` que JÁ TEM
// etiqueta paga no Melhor Envio. O banco devolve o estoque e abre o reembolso,
// mas cancelar o pedido NÃO cancela a etiqueta: o saldo segue gasto e o pacote
// pode até já estar no correio. O aviso dizia só "pago, o reembolso é
// automático". A frase da etiqueta é a mesma do sino do painel
// (`src/utils/avisos-do-lojista.ts`).
const FRASE_DA_ETIQUETA =
  "Esse pedido já tinha etiqueta de envio: se ainda não postou, cancele a etiqueta no Melhor Envio para recuperar o valor; se já postou, fale com a cliente.";

Deno.test("cliente cancelou pedido PAGO em processing com ETIQUETA paga -> aviso fala da etiqueta (lida do banco)", async () => {
  const r = await rodar({
    historico: [hist("h1", { old_status: "processing" })],
    pedidos: [pedido({ shipping_label_id: "label-123" })],
    perfis,
  });
  assertEquals(r.avisos.length, 1);
  assertEquals(
    r.avisos[0].aviso.body,
    `#4F5A6B · R$ 149,90 · Maria Silva — pago, o reembolso é automático. ${FRASE_DA_ETIQUETA}`,
  );
});

Deno.test("etiqueta paga em pedido SEM pagamento online e ainda não saído -> aviso também fala da etiqueta", () => {
  const aviso = montarAvisoDeCancelamento(
    pedido({ payment_status: null, shipping_label_id: "label-123" }),
    { old_status: "processing" },
  );
  assertEquals(
    aviso.body,
    `#4F5A6B · R$ 149,90 · Maria Silva — sem pagamento pelo app: não separe nem envie. ${FRASE_DA_ETIQUETA}`,
  );
});

Deno.test("etiqueta paga em pedido que JÁ SAIU -> sem a frase da etiqueta (ela já foi usada)", () => {
  for (const [extra, historico] of [
    [{ cancelled_after_shipping: true }, { old_status: "processing" }],
    [{ cancelled_after_shipping: false }, { old_status: "shipping" }],
  ] as const) {
    const aviso = montarAvisoDeCancelamento(
      pedido({ shipping_label_id: "label-123", ...extra }),
      historico,
    );
    assertStringIncludes(aviso.body, "o produto já saiu");
    assertEquals(aviso.body.includes("etiqueta"), false, JSON.stringify(extra));
  }
});

Deno.test("sem etiqueta (nula, vazia ou só espaços) -> texto de sempre, sem falar de etiqueta", () => {
  for (const shipping_label_id of [null, undefined, "", "   "]) {
    const aviso = montarAvisoDeCancelamento(
      pedido({ shipping_label_id }),
      { old_status: "processing" },
    );
    assertEquals(
      aviso.body,
      "#4F5A6B · R$ 149,90 · Maria Silva — pago, o reembolso é automático",
      String(shipping_label_id),
    );
  }
});
