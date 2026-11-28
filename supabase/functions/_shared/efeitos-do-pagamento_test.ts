// @ts-nocheck
/**
 * Testes de `_shared/efeitos-do-pagamento.ts` — a RPC da confirmação imediata
 * e os efeitos que ela dispara.
 *
 * O que erra caro: efeito em DOBRO (o webhook já avisou, e esta rota avisa de
 * novo), efeito SEM transição ('ja_pago' disparando push), o comprovante
 * padrão num 'pago_apos_expirar' (mentiria "entra na fila de separação"), e
 * texto que diverge do webhook (o lojista recebe dois formatos para o mesmo
 * fato). A paridade do E-MAIL é provada aqui contra as exportações do
 * webhook; a do PUSH, rodando o handler do webhook de verdade, em
 * `criar-pagamento/index_test.ts`.
 */
import { assertEquals } from "https://deno.land/std@0.177.0/testing/asserts.ts";
import { FakeTime } from "jsr:@std/testing@1.0.21/time";
import {
  aplicarEfeitosDoPagamentoConfirmado,
  assuntoDoAvisoDePagamentoAtrasado,
  avisoAoLojista,
  confirmarPagamentoProvado,
  dispararAvisoDePagamentoAtrasadoReal,
  htmlDoAvisoDePagamentoAtrasado,
  reavisarLojistaNaReentrega,
  reenviarEmailPendenteDoPagamento,
} from "./efeitos-do-pagamento.ts";
import { ORCAMENTO_DO_ENVIO_MS } from "./comprovante.ts";
import { formatarBRL, numeroDoPedido } from "./pedido.ts";
import {
  assuntoDoAvisoDePagamentoAtrasado as assuntoDoWebhook,
  formatarBRL as formatarBRLDoWebhook,
  htmlDoAvisoDePagamentoAtrasado as htmlDoWebhook,
  numeroDoPedido as numeroDoWebhook,
} from "../webhook-mercadopago/index.ts";

const PEDIDO = "3f2a1b8c-4d5e-4f60-9a7b-1c2d3e4f5a6b";
const VAGA = "ORDTST01VAGADOPEDIDO000000000";

async function emSilencio<T>(f: () => Promise<T>): Promise<T> {
  const [e, w, l] = [console.error, console.warn, console.log];
  console.error = () => {};
  console.warn = () => {};
  console.log = () => {};
  try {
    return await f();
  } finally {
    [console.error, console.warn, console.log] = [e, w, l];
  }
}

function bancoDoRpc(resposta: () => Promise<unknown> | unknown) {
  const chamadas: Array<{ nome: string; args: Record<string, unknown> }> = [];
  return {
    chamadas,
    rpc: async (nome: string, args: Record<string, unknown>) => {
      chamadas.push({ nome, args });
      return await resposta();
    },
  };
}

// ── confirmarPagamentoProvado ─────────────────────────────────────────────

Deno.test("confirmarPagamentoProvado: chama confirmar_pagamento UMA vez com os argumentos EXATOS e devolve o desfecho da RPC", async () => {
  for (const desfecho of ["pago", "pago_apos_expirar", "ja_pago", "divergente", "inexistente", "ignorado"]) {
    const db = bancoDoRpc(() => ({ data: desfecho, error: null }));
    const r = await confirmarPagamentoProvado({ supabase: db as never, pedidoId: PEDIDO, vaga: VAGA });
    assertEquals(r, { ok: true, resultado: desfecho });
    assertEquals(db.chamadas, [{
      nome: "confirmar_pagamento",
      args: { p_order_id: PEDIDO, p_payment_id: VAGA, p_status: "pago" },
    }]);
  }
});

for (
  const caso of [
    { nome: "{ error }", resposta: () => ({ data: null, error: { code: "57014", message: "statement timeout" } }) },
    { nome: "exceção", resposta: () => Promise.reject(new Error("rede caiu")) },
    { nome: "data ilegível (null)", resposta: () => ({ data: null, error: null }) },
  ]
) {
  Deno.test(`confirmarPagamentoProvado: ${caso.nome} -> { ok: false }, sem lançar`, async () => {
    const db = bancoDoRpc(caso.resposta);
    const r = await emSilencio(() => confirmarPagamentoProvado({ supabase: db as never, pedidoId: PEDIDO, vaga: VAGA }));
    assertEquals(r, { ok: false });
    assertEquals(db.chamadas.length, 1);
  });
}

// ── aplicarEfeitosDoPagamentoConfirmado ───────────────────────────────────

function bancoDoPedido(opts: { falha?: boolean; erro?: boolean; linha?: Record<string, unknown> } = {}) {
  const leituras: string[] = [];
  return {
    leituras,
    from(tabela: string) {
      return {
        select(colunas: string) {
          leituras.push(`${tabela}:${colunas}`);
          return {
            eq: () => ({
              maybeSingle: async () => {
                if (opts.falha) throw new Error("banco caiu");
                if (opts.erro) return { data: opts.linha ?? null, error: { code: "57014" } };
                return { data: opts.linha ?? { id: PEDIDO, customer_name: "Fulana", total: 100 }, error: null };
              },
            }),
          };
        },
      };
    },
    rpc: () => {
      throw new Error("os efeitos nunca chamam RPC direto quando injetados");
    },
  };
}

function coletores() {
  const pushes: unknown[] = [];
  const comprovantes: unknown[] = [];
  const atrasados: unknown[] = [];
  return {
    pushes,
    comprovantes,
    atrasados,
    deps: {
      enviarPush: async (a: { aviso: unknown }) => {
        pushes.push(a.aviso);
      },
      enviarComprovante: async (a: { orderId: string }) => {
        comprovantes.push(a.orderId);
      },
      enviarAvisoAtrasado: async (a: { orderId: string }) => {
        atrasados.push(a.orderId);
      },
    },
  };
}

Deno.test("efeitos 'pago': push 'Pedido pago' com número e valor + comprovante ao cliente, UMA vez cada; nenhum aviso atrasado", async () => {
  const db = bancoDoPedido();
  const c = coletores();
  await aplicarEfeitosDoPagamentoConfirmado({ supabase: db as never, orderId: PEDIDO, resultado: "pago", ...c.deps });
  assertEquals(c.pushes, [{ title: "Pedido pago", body: "#4F5A6B · R$ 100,00", url: `/admin-orders?id=${PEDIDO}` }]);
  assertEquals(c.comprovantes, [PEDIDO]);
  assertEquals(c.atrasados, []);
  assertEquals(db.leituras, ["marketplace_orders:id, customer_name, total, total_amount"]);
});

Deno.test("efeitos 'pago_apos_expirar': push 'Pagamento fora do fluxo' + aviso ATRASADO; NUNCA o comprovante padrão", async () => {
  const db = bancoDoPedido();
  const c = coletores();
  await aplicarEfeitosDoPagamentoConfirmado({
    supabase: db as never,
    orderId: PEDIDO,
    resultado: "pago_apos_expirar",
    ...c.deps,
  });
  assertEquals(c.pushes, [{
    title: "Pagamento fora do fluxo",
    body: "#4F5A6B · R$ 100,00 · estoque já devolvido",
    url: `/admin-orders?id=${PEDIDO}`,
  }]);
  assertEquals(c.comprovantes, []);
  assertEquals(c.atrasados, [PEDIDO]);
});

for (const resultado of ["ja_pago", "divergente", "inexistente", "ignorado", "estornado", "recusado", null, undefined]) {
  Deno.test(`efeitos '${String(resultado)}': NENHUM efeito — nem push, nem e-mail, nem a leitura do pedido`, async () => {
    const db = bancoDoPedido();
    const c = coletores();
    await aplicarEfeitosDoPagamentoConfirmado({ supabase: db as never, orderId: PEDIDO, resultado, ...c.deps });
    assertEquals(c.pushes, []);
    assertEquals(c.comprovantes, []);
    assertEquals(c.atrasados, []);
    assertEquals(db.leituras, []);
  });
}

Deno.test("efeitos: o push LANÇA -> o comprovante sai assim mesmo, e nada sobe para quem chama", async () => {
  const db = bancoDoPedido();
  const c = coletores();
  await emSilencio(() =>
    aplicarEfeitosDoPagamentoConfirmado({
      supabase: db as never,
      orderId: PEDIDO,
      resultado: "pago",
      ...c.deps,
      enviarPush: () => Promise.reject(new Error("push service fora")),
    })
  );
  assertEquals(c.comprovantes, [PEDIDO]);
});

Deno.test("efeitos: o comprovante LANÇA -> nada sobe para quem chama", async () => {
  const db = bancoDoPedido();
  const c = coletores();
  await emSilencio(() =>
    aplicarEfeitosDoPagamentoConfirmado({
      supabase: db as never,
      orderId: PEDIDO,
      resultado: "pago",
      ...c.deps,
      enviarComprovante: () => Promise.reject(new Error("smtp fora")),
    })
  );
  assertEquals(c.pushes.length, 1);
});

Deno.test("efeitos: a leitura do valor FALHA -> o push sai assim mesmo (sem o valor, como o webhook)", async () => {
  const db = bancoDoPedido({ falha: true });
  const c = coletores();
  await emSilencio(() =>
    aplicarEfeitosDoPagamentoConfirmado({ supabase: db as never, orderId: PEDIDO, resultado: "pago", ...c.deps })
  );
  assertEquals(c.pushes, [{ title: "Pedido pago", body: "#4F5A6B", url: `/admin-orders?id=${PEDIDO}` }]);
  assertEquals(c.comprovantes, [PEDIDO]);
});

Deno.test("efeitos: valor cai em total_amount quando total não vem (mesma ordem do webhook)", async () => {
  const db = bancoDoPedido({ linha: { id: PEDIDO, total_amount: 1234.5 } });
  const c = coletores();
  await aplicarEfeitosDoPagamentoConfirmado({ supabase: db as never, orderId: PEDIDO, resultado: "pago", ...c.deps });
  assertEquals(c.pushes, [{ title: "Pedido pago", body: "#4F5A6B · R$ 1.234,50", url: `/admin-orders?id=${PEDIDO}` }]);
});

for (const resultado of ["pago", "pago_apos_expirar"]) {
  for (const caso of [
    { nome: "error sem data", opts: { erro: true } },
    { nome: "error mesmo com data", opts: { erro: true, linha: { total: 150 } } },
    { nome: "exceção", opts: { falha: true } },
    ...[undefined, null, "", "ilegível", Number.NaN, Infinity].map((total) => ({
      nome: `total ilegível: ${String(total)}`,
      opts: { linha: { total } },
    })),
  ]) {
    Deno.test(`push sem valor: ${resultado}, ${caso.nome} -> não inventa R$ 0,00`, async () => {
      const db = bancoDoPedido(caso.opts);
      const c = coletores();
      await emSilencio(() =>
        aplicarEfeitosDoPagamentoConfirmado({ supabase: db as never, orderId: PEDIDO, resultado, ...c.deps })
      );
      assertEquals(c.pushes, [{
        title: resultado === "pago" ? "Pedido pago" : "Pagamento fora do fluxo",
        body: resultado === "pago" ? "#4F5A6B" : "#4F5A6B · estoque já devolvido",
        url: `/admin-orders?id=${PEDIDO}`,
      }]);
      assertEquals(c.comprovantes, resultado === "pago" ? [PEDIDO] : []);
      assertEquals(c.atrasados, resultado === "pago_apos_expirar" ? [PEDIDO] : []);
    });
  }

  for (const [total, valor] of [[150, "R$ 150,00"], [0, "R$ 0,00"], ["150.00", "R$ 150,00"]] as const) {
    Deno.test(`push com valor: ${resultado}, total ${total} preserva o valor lido`, async () => {
      const c = coletores();
      await aplicarEfeitosDoPagamentoConfirmado({
        supabase: bancoDoPedido({ linha: { total } }) as never,
        orderId: PEDIDO,
        resultado,
        ...c.deps,
      });
      assertEquals(c.pushes, [{
        title: resultado === "pago" ? "Pedido pago" : "Pagamento fora do fluxo",
        body: resultado === "pago" ? `#4F5A6B · ${valor}` : `#4F5A6B · ${valor} · estoque já devolvido`,
        url: `/admin-orders?id=${PEDIDO}`,
      }]);
    });
  }
}

// ── Paridade com o webhook ────────────────────────────────────────────────

Deno.test("paridade: numeroDoPedido e formatarBRL de _shared/pedido.ts dão o MESMO texto que os do webhook", () => {
  for (const id of [PEDIDO, "00000000-0000-0000-0000-00000000abcd"]) {
    assertEquals(numeroDoPedido(id), numeroDoWebhook(id));
  }
  for (const valor of [0, 100, 1234.5, 99.999, "50.00", null, undefined, Number.NaN]) {
    assertEquals(formatarBRL(valor), formatarBRLDoWebhook(valor), String(valor));
  }
});

Deno.test("paridade: o e-mail de pagamento atrasado (assunto e HTML) é BYTE A BYTE o do webhook — com e sem nome de loja, com HTML no nome", () => {
  for (const nomeDaLoja of ["", "Loja da Ana", "  <b>Loja & Cia</b>  "]) {
    assertEquals(htmlDoAvisoDePagamentoAtrasado({ orderId: PEDIDO, nomeDaLoja }), htmlDoWebhook({ orderId: PEDIDO, nomeDaLoja }));
    assertEquals(assuntoDoAvisoDePagamentoAtrasado(PEDIDO, nomeDaLoja), assuntoDoWebhook(PEDIDO, nomeDaLoja));
  }
});

// Literais independentes: o webhook reexporta a mesma função, então paridade não basta.
for (const [caso, orderId, nomeDaLoja, esperado] of [
  ["com loja", PEDIDO, "Loja da Ana", "Pedido #4F5A6B · Loja da Ana"],
  ["sem loja", PEDIDO, "", "Pedido #4F5A6B"],
  ["loja só com espaços", PEDIDO, "   ", "Pedido #4F5A6B"],
  ["loja com HTML e espaços", PEDIDO, "  <b>Loja & Cia</b>  ", "Pedido #4F5A6B · <b>Loja & Cia</b>"],
  ["pedido vazio com loja", "", "Loja da Ana", "Pedido # · Loja da Ana"],
  ["pedido vazio sem loja", "", "", "Pedido #"],
] as const) {
  Deno.test(`aviso atrasado: assunto literal — ${caso}`, () => {
    assertEquals(assuntoDoAvisoDePagamentoAtrasado(orderId, nomeDaLoja), esperado);
    assertEquals(assuntoDoWebhook(orderId, nomeDaLoja), esperado);
  });
}

Deno.test("aviso atrasado: escapa o nome da loja e o número do pedido; sem nome, omite o parágrafo da loja", () => {
  const nomeDaLoja = "  <b>Loja & Cia</b>  ";
  const html = htmlDoAvisoDePagamentoAtrasado({ orderId: PEDIDO, nomeDaLoja });
  const paragrafoDaLoja = '<p style="margin: 0 0 20px; font-size: 18px; font-weight: 800;">';
  assertEquals(html.includes("<b>Loja"), false);
  assertEquals(html.includes(`${paragrafoDaLoja}&lt;b&gt;Loja &amp; Cia&lt;/b&gt;</p>`), true);
  assertEquals(html.includes("Pedido #4F5A6B"), true);

  const htmlComPedidoEstranho = htmlDoAvisoDePagamentoAtrasado({ orderId: "pedido<&abcd", nomeDaLoja });
  assertEquals(htmlComPedidoEstranho.includes("Pedido #&lt;&amp;ABCD"), true);
  assertEquals(htmlComPedidoEstranho.includes("Pedido #<&ABCD"), false);

  for (const nomeDaLoja of ["", "   "]) {
    const semLoja = htmlDoAvisoDePagamentoAtrasado({ orderId: PEDIDO, nomeDaLoja });
    assertEquals(semLoja.includes(paragrafoDaLoja), false);
    assertEquals(semLoja.includes("Pedido #4F5A6B"), true);
  }
});

Deno.test("avisoAoLojista: só 'pago' e 'pago_apos_expirar' têm aviso", () => {
  assertEquals(avisoAoLojista(PEDIDO, "ja_pago", 10), null);
  assertEquals(avisoAoLojista(PEDIDO, "divergente", 10), null);
});

// --- o remetente resolvido no aviso de pagamento atrasado (14/10/2026) ------

function supabaseDoAviso(chamadas: string[]) {
  return {
    rpc: async (nome: string) => {
      chamadas.push(`rpc:${nome}`);
      return { data: nome === "reivindicar_email_de_confirmacao" ? true : null, error: null };
    },
    from(tabela: string) {
      chamadas.push(`from:${tabela}`);
      const resultado = tabela === "marketplace_orders"
        ? { data: { id: PEDIDO, user_id: null, customer_data: { email: "cliente@exemplo.com" } }, error: null }
        : { data: { store_name: "Loja Teste" }, error: null };
      return {
        select: () => ({
          eq: () => ({ maybeSingle: async () => resultado }),
          limit: () => ({ maybeSingle: async () => resultado }),
        }),
      };
    },
    auth: { admin: { getUserById: async () => ({ data: { user: null } }) } },
  };
}

Deno.test("aviso atrasado: remetente 'nenhum' PARA antes de ler o pedido ou reservar o aviso (nada gasto)", async () => {
  const chamadas: string[] = [];
  const enviados: unknown[] = [];
  await emSilencio(() =>
    dispararAvisoDePagamentoAtrasadoReal({
      supabase: supabaseDoAviso(chamadas) as never,
      orderId: PEDIDO,
      deps: {
        resolverRemetente: async () => ({ origem: "nenhum", usuario: null, senha: null, motivo: "sem_registro", reserva: null }),
        enviarEmail: async (...args: unknown[]) => void enviados.push(args),
      },
    })
  );
  assertEquals(chamadas, []);
  assertEquals(enviados, []);
});

Deno.test("aviso atrasado: com remetente, reserva UMA vez e o envio recebe o MESMO remetente resolvido", async () => {
  const chamadas: string[] = [];
  const enviados: any[] = [];
  const remetente = { origem: "painel", usuario: "painel@gmail.com", senha: "x", motivo: null, reserva: null };
  await emSilencio(() =>
    dispararAvisoDePagamentoAtrasadoReal({
      supabase: supabaseDoAviso(chamadas) as never,
      orderId: PEDIDO,
      deps: {
        resolverRemetente: async () => remetente,
        enviarEmail: async (...args: unknown[]) => void enviados.push(args),
      },
    })
  );
  assertEquals(chamadas.filter((c) => c === "rpc:reivindicar_email_de_confirmacao").length, 1);
  assertEquals(enviados.length, 1);
  assertEquals(enviados[0][0].para, "cliente@exemplo.com");
  assertEquals(enviados[0][1], remetente);
});

// --- EST-EDGE-DIN-3 (16/10/2026): o aviso de pagamento atrasado que não saiu --
// O pedido vira 'pago_apos_expirar'; o SMTP falha; a reserva do e-mail é
// devolvida; o webhook responde 200. A reentrega do MP recebe 'ja_pago' e
// PULAVA tudo, e o cron exclui pedido com paid_at: o cliente que pagou depois
// do cancelamento nunca era avisado. O caso que dói é a ORDEM: o que a
// reentrega faz depende de a reserva estar livre, e a reserva é a mesma do
// comprovante.

/** Banco com ESTADO: a reserva do e-mail é `confirmation_email_sent_at`, atômica como a RPC. */
function bancoComReserva(
  inicial: { payment_status: string; reservado: boolean; leituraFalha?: boolean; extras?: Record<string, unknown> },
) {
  const estado = { payment_status: inicial.payment_status, reservado: inicial.reservado };
  const rpcs: string[] = [];
  const liberarComErro = { restantes: 0 };
  return {
    estado,
    rpcs,
    liberarComErro,
    from(tabela: string) {
      return {
        select: (colunas: string) => {
          const consulta = {
            eq: () => consulta,
            limit: () => consulta,
            maybeSingle: async () => {
              if (inicial.leituraFalha) throw new Error("banco caiu");
              if (tabela === "store_config") return { data: { store_name: "Loja" }, error: null };
              if (colunas.includes("confirmation_email_sent_at")) {
                return {
                  data: {
                    payment_status: estado.payment_status,
                    confirmation_email_sent_at: estado.reservado ? "2026-10-16T10:00:00Z" : null,
                    ...(inicial.extras ?? {}),
                  },
                  error: null,
                };
              }
              return { data: { id: PEDIDO, user_id: null, customer_data: { email: "cliente@exemplo.com" } }, error: null };
            },
          };
          return consulta;
        },
      };
    },
    rpc: async (nome: string) => {
      rpcs.push(nome);
      if (nome === "reivindicar_email_de_confirmacao") {
        if (estado.reservado) return { data: false, error: null };
        estado.reservado = true;
        return { data: true, error: null };
      }
      if (nome === "liberar_email_de_confirmacao") {
        if (liberarComErro.restantes > 0) {
          liberarComErro.restantes--;
          return { data: null, error: { message: "banco indisponivel" } };
        }
        estado.reservado = false;
        return { data: null, error: null };
      }
      return { data: null, error: null };
    },
    auth: { admin: { getUserById: async () => ({ data: { user: null } }) } },
  };
}

const REMETENTE_OK = { origem: "painel", usuario: "painel@gmail.com", senha: "x", motivo: null, reserva: null };

function avisoRealComSmtp(enviarEmail: (...a: unknown[]) => Promise<void>) {
  return (a: { supabase: never; orderId: string }) =>
    dispararAvisoDePagamentoAtrasadoReal({
      ...a,
      deps: { resolverRemetente: async () => REMETENTE_OK, enviarEmail },
    });
}

Deno.test("EST-EDGE-DIN-3 - SMTP falha na confirmação; a reentrega 'ja_pago' reenvia o aviso UMA vez e a seguinte já não manda mais", async () => {
  const banco = bancoComReserva({ payment_status: "pago_apos_expirar", reservado: false });
  let smtpNoAr = false;
  const enviados: unknown[] = [];
  const smtp = async (...a: unknown[]) => {
    if (!smtpNoAr) throw new Error("SMTP fora do ar");
    enviados.push(a);
  };
  // 1) a transição: o SMTP recusa, a reserva volta.
  await emSilencio(() =>
    aplicarEfeitosDoPagamentoConfirmado({
      supabase: banco as never,
      orderId: PEDIDO,
      resultado: "pago_apos_expirar",
      enviarPush: async () => {},
      enviarAvisoAtrasado: avisoRealComSmtp(smtp) as never,
    })
  );
  assertEquals(banco.estado.reservado, false);
  assertEquals(enviados.length, 0);
  // 2) a reentrega 'ja_pago' com o SMTP de volta: manda o aviso pendente.
  smtpNoAr = true;
  await emSilencio(() =>
    reenviarEmailPendenteDoPagamento({
      supabase: banco as never,
      orderId: PEDIDO,
      enviarAvisoAtrasado: avisoRealComSmtp(smtp) as never,
    })
  );
  assertEquals(enviados.length, 1);
  assertEquals(banco.estado.reservado, true);
  // 3) outra reentrega: a reserva está presa, nada mais sai.
  await emSilencio(() =>
    reenviarEmailPendenteDoPagamento({
      supabase: banco as never,
      orderId: PEDIDO,
      enviarAvisoAtrasado: avisoRealComSmtp(smtp) as never,
    })
  );
  assertEquals(enviados.length, 1);
});

Deno.test("EST-EDGE-DIN-3 - três reentregas 'ja_pago' CONCORRENTES com a reserva livre mandam UM e-mail só", async () => {
  const banco = bancoComReserva({ payment_status: "pago_apos_expirar", reservado: false });
  const enviados: unknown[] = [];
  const smtp = async (...a: unknown[]) => {
    await new Promise((r) => setTimeout(r, 5));
    enviados.push(a);
  };
  await emSilencio(() =>
    Promise.all([1, 2, 3].map(() =>
      reenviarEmailPendenteDoPagamento({
        supabase: banco as never,
        orderId: PEDIDO,
        enviarAvisoAtrasado: avisoRealComSmtp(smtp) as never,
      })
    ))
  );
  assertEquals(enviados.length, 1);
});

Deno.test("EST-EDGE-DIN-3 - reentrega 'ja_pago' NÃO envia nada quando já saiu, quando o 'pago' não traz os dados do online recente, ou quando a leitura falha", async () => {
  const casos: Array<[string, Parameters<typeof bancoComReserva>[0]]> = [
    ["reserva presa (e-mail já saiu)", { payment_status: "pago_apos_expirar", reservado: true }],
    ["pedido 'pago' sem os dados do pagamento online recente (falha fechada; o caso que envia está nos testes r200-a)", { payment_status: "pago", reservado: false }],
    ["pedido estornado", { payment_status: "estornado", reservado: false }],
    ["leitura do pedido falha", { payment_status: "pago_apos_expirar", reservado: false, leituraFalha: true }],
  ];
  for (const [rotulo, inicial] of casos) {
    const banco = bancoComReserva(inicial);
    const enviados: unknown[] = [];
    await emSilencio(() =>
      reenviarEmailPendenteDoPagamento({
        supabase: banco as never,
        orderId: PEDIDO,
        enviarAvisoAtrasado: async (a) => void enviados.push(a),
      })
    );
    assertEquals(enviados.length, 0, rotulo);
    assertEquals(banco.rpcs.length, 0, rotulo);
  }
});

Deno.test("EST-EDGE-DIN-3 - reentrega: coluna da reserva AUSENTE na leitura é 'não sei' e não envia (só o null explícito do banco libera)", async () => {
  const enviados: unknown[] = [];
  await emSilencio(() =>
    reenviarEmailPendenteDoPagamento({
      supabase: bancoDoPedido({ linha: { payment_status: "pago_apos_expirar" } }) as never,
      orderId: PEDIDO,
      enviarAvisoAtrasado: async (a) => void enviados.push(a),
    })
  );
  assertEquals(enviados.length, 0);
});

Deno.test("EST-EDGE-DIN-3 - reentrega: o envio que LANÇA não sobe para quem chama (o webhook segue com 200)", async () => {
  const banco = bancoComReserva({ payment_status: "pago_apos_expirar", reservado: false });
  await emSilencio(() =>
    reenviarEmailPendenteDoPagamento({
      supabase: banco as never,
      orderId: PEDIDO,
      enviarAvisoAtrasado: async () => {
        throw new Error("explodiu");
      },
    })
  );
});

Deno.test("EST-EDGE-DIN-3 - liberar_email_de_confirmacao devolvendo { error }: tenta DE NOVO e registra (antes o erro era ignorado e a reserva ficava presa)", async () => {
  const banco = bancoComReserva({ payment_status: "pago_apos_expirar", reservado: false });
  banco.liberarComErro.restantes = 1; // a 1ª tentativa de devolver a reserva falha
  const erros: string[] = [];
  const original = console.error;
  console.error = (...a: unknown[]) => void erros.push(a.map(String).join(" "));
  const [w, l] = [console.warn, console.log];
  console.warn = () => {};
  console.log = () => {};
  try {
    await dispararAvisoDePagamentoAtrasadoReal({
      supabase: banco as never,
      orderId: PEDIDO,
      deps: {
        resolverRemetente: async () => REMETENTE_OK,
        enviarEmail: async () => {
          throw new Error("SMTP fora do ar");
        },
      },
    });
  } finally {
    console.error = original;
    [console.warn, console.log] = [w, l];
  }
  assertEquals(banco.rpcs.filter((n) => n === "liberar_email_de_confirmacao").length, 2);
  // a 2ª tentativa funcionou: a reserva voltou a ficar livre para a reentrega.
  assertEquals(banco.estado.reservado, false);
  assertEquals(erros.some((e) => e.includes("liberar reserva falhou")), true, erros.join(" | "));
});

// --- r59-f: o e-mail do pagamento nunca prende quem espera, nem derruba o resto ---------
//
// Tres buracos no mesmo lugar: (1) o aviso de pagamento atrasado ia ao SMTP sem
// prazo e a reserva (gravada ANTES) so voltava no `catch`; (2) `getUserById` sem
// tratamento: erro passageiro virava o aviso FALSO "sem e-mail de cliente";
// (3) quem espera os efeitos (webhook do Mercado Pago, laco do cron) esperava o
// e-mail sem teto algum.

/** SMTP falso que respeita o prazo, como o real: sem prazo "demora" e termina bem. */
function smtpQueEstouraNoPrazo(registro: { semPrazo: boolean }) {
  return async (_m: unknown, _r: unknown, deps?: { prazoFinalMs?: number }) => {
    if (deps?.prazoFinalMs === undefined) {
      registro.semPrazo = true;
      await new Promise((r) => setTimeout(r, 400));
      return;
    }
    await new Promise((r) => setTimeout(r, Math.max(0, deps.prazoFinalMs! - performance.now())));
    throw Object.assign(new Error("SMTP: envio recusado (ETIMEDOUT)"), { code: "ETIMEDOUT" });
  };
}

Deno.test("r59-f aviso atrasado: o envio leva um prazo TOTAL (prazoFinalMs) dentro do orçamento", async () => {
  const enviados: any[] = [];
  const antes = performance.now();
  await emSilencio(() =>
    dispararAvisoDePagamentoAtrasadoReal({
      supabase: supabaseDoAviso([]) as never,
      orderId: PEDIDO,
      deps: { resolverRemetente: async () => REMETENTE_OK, enviarEmail: async (...a: unknown[]) => void enviados.push(a) },
    })
  );
  assertEquals(enviados.length, 1);
  const prazo = enviados[0][2]?.prazoFinalMs;
  assertEquals(typeof prazo, "number", "sem prazoFinalMs o nodemailer espera até 10 min");
  assertEquals(prazo > antes && prazo <= performance.now() + ORCAMENTO_DO_ENVIO_MS, true);
});

Deno.test("r59-f aviso atrasado: SMTP que trava estoura no prazo, a reserva VOLTA e a reentrega manda UM aviso", async () => {
  const banco = bancoComReserva({ payment_status: "pago_apos_expirar", reservado: false });
  const travado = { semPrazo: false };
  const inicio = performance.now();
  await emSilencio(() =>
    dispararAvisoDePagamentoAtrasadoReal({
      supabase: banco as never,
      orderId: PEDIDO,
      deps: { resolverRemetente: async () => REMETENTE_OK, enviarEmail: smtpQueEstouraNoPrazo(travado), orcamentoDoEnvioMs: 40 },
    })
  );
  assertEquals(travado.semPrazo, false, "o envio foi chamado sem prazo");
  assertEquals(performance.now() - inicio < 300, true, "o envio não pode esperar além do orçamento");
  assertEquals(banco.estado.reservado, false, "reserva presa = o cliente que pagou atrasado nunca é avisado");
  const enviados: unknown[] = [];
  const reentregar = () =>
    emSilencio(() =>
      reenviarEmailPendenteDoPagamento({
        supabase: banco as never,
        orderId: PEDIDO,
        enviarAvisoAtrasado: avisoRealComSmtp(async (...a: unknown[]) => void enviados.push(a)) as never,
      })
    );
  await reentregar();
  assertEquals(enviados.length, 1);
  await reentregar();
  assertEquals(enviados.length, 1, "o aviso saiu duas vezes");
});

/** Pedido de quem tem conta (sem e-mail dentro dele): o e-mail mora em `getUserById`. */
function bancoDeQuemTemConta(getUserById: () => Promise<{ data: unknown; error?: unknown }>) {
  const rpcs: string[] = [];
  const consultas = { n: 0 };
  return {
    rpcs,
    consultas,
    rpc: async (nome: string) => {
      rpcs.push(nome);
      return { data: nome === "reivindicar_email_de_confirmacao" ? true : null, error: null };
    },
    from(tabela: string) {
      const resultado = tabela === "marketplace_orders"
        ? { data: { id: PEDIDO, user_id: "11111111-2222-4333-8444-555555555555", customer_data: {} }, error: null }
        : { data: { store_name: "Loja Teste" }, error: null };
      return {
        select: () => ({
          eq: () => ({ maybeSingle: async () => resultado }),
          limit: () => ({ maybeSingle: async () => resultado }),
        }),
      };
    },
    auth: {
      admin: {
        getUserById: () => {
          consultas.n++;
          return getUserById();
        },
      },
    },
  };
}

async function avisoDeQuemTemConta(getUserById: () => Promise<{ data: unknown; error?: unknown }>) {
  const banco = bancoDeQuemTemConta(getUserById);
  const enviados: any[] = [];
  const erros: string[] = [];
  const avisos: string[] = [];
  const [e, w, l] = [console.error, console.warn, console.log];
  console.error = (...a: unknown[]) => void erros.push(a.map(String).join(" "));
  console.warn = (...a: unknown[]) => void avisos.push(a.map(String).join(" "));
  console.log = () => {};
  try {
    await dispararAvisoDePagamentoAtrasadoReal({
      supabase: banco as never,
      orderId: PEDIDO,
      deps: { resolverRemetente: async () => REMETENTE_OK, enviarEmail: async (...a: unknown[]) => void enviados.push(a) },
    });
  } finally {
    [console.error, console.warn, console.log] = [e, w, l];
  }
  return { banco, enviados, erros, avisos };
}

Deno.test("r59-f aviso atrasado: a consulta da conta falha (500) nas duas tentativas -> não reserva, não envia e NÃO diz 'sem e-mail'", async () => {
  const r = await avisoDeQuemTemConta(async () => ({ data: { user: null }, error: { status: 500 } }));
  assertEquals(r.banco.consultas.n, 2);
  assertEquals(r.banco.rpcs.includes("reivindicar_email_de_confirmacao"), false, "a reserva continua livre para a reentrega");
  assertEquals(r.enviados.length, 0);
  assertEquals(r.avisos.some((l) => l.includes("sem e-mail")), false, "o aviso falso 'sem e-mail de cliente' não pode sair");
  assertEquals(r.erros.some((l) => l.includes("500")), true, "o log diz o status, sem dado pessoal");
});

Deno.test("r59-f aviso atrasado: a consulta da conta LANÇA nas duas tentativas -> nada sobe, nada é enviado", async () => {
  const r = await avisoDeQuemTemConta(async () => {
    throw new Error("fetch failed");
  });
  assertEquals(r.banco.consultas.n, 2);
  assertEquals(r.banco.rpcs.length, 0);
  assertEquals(r.enviados.length, 0);
  assertEquals(r.avisos.some((l) => l.includes("sem e-mail")), false);
});

Deno.test("r59-f aviso atrasado: falha na 1a tentativa e acerto na 2a -> o aviso sai UMA vez, para o e-mail da conta", async () => {
  let n = 0;
  const r = await avisoDeQuemTemConta(async () => {
    n++;
    return n === 1
      ? { data: { user: null }, error: { status: 503 } }
      : { data: { user: { email: "dona@exemplo.com" } }, error: null };
  });
  assertEquals(r.banco.consultas.n, 2);
  assertEquals(r.enviados.length, 1);
  assertEquals(r.enviados[0][0].para, "dona@exemplo.com");
  assertEquals(r.banco.rpcs.filter((x) => x === "reivindicar_email_de_confirmacao").length, 1);
});

Deno.test("r59-f aviso atrasado: conta que NÃO existe (404) segue como 'sem e-mail', sem repetir a consulta e sem gastar a reserva", async () => {
  const r = await avisoDeQuemTemConta(async () => ({ data: { user: null }, error: { status: 404 } }));
  assertEquals(r.banco.consultas.n, 1);
  assertEquals(r.banco.rpcs.length, 0);
  assertEquals(r.enviados.length, 0);
  assertEquals(r.avisos.some((l) => l.includes("sem e-mail")), true);
});

async function provarTetoDoEnvio<T>(
  valorDoEnvio: T,
  executar: (enviar: () => Promise<T>) => Promise<void>,
) {
  using relogio = new FakeTime();
  const envio = Promise.withResolvers<T>();
  let iniciou = false;
  let terminou = false;
  const andamento = executar(() => {
    iniciou = true;
    return envio.promise;
  }).then(() => {
    terminou = true;
  });
  try {
    await relogio.runMicrotasks();
    assertEquals(iniciou, true, "o envio tem de começar");
    assertEquals(terminou, false, "a operação saiu antes de esperar pelo envio");
    await relogio.tickAsync(30);
    await relogio.runMicrotasks();
    assertEquals(terminou, true, "a operação esperou o envio sem teto");
  } finally {
    // Libera o envio inclusive se a asserção falhar no mutante que espera por ele.
    envio.resolve(valorDoEnvio);
    await andamento;
  }
}

for (const resultado of ["pago", "pago_apos_expirar"]) {
  Deno.test(`r59-f efeitos '${resultado}': e-mail que não responde NÃO prende quem espera (o push já saiu) e nada sobe`, async () => {
    const db = bancoDoPedido();
    const c = coletores();
    await provarTetoDoEnvio(
      undefined,
      (demorado) =>
        emSilencio(() =>
          aplicarEfeitosDoPagamentoConfirmado({
            supabase: db as never,
            orderId: PEDIDO,
            resultado,
            ...c.deps,
            enviarComprovante: demorado,
            enviarAvisoAtrasado: demorado,
            tetoDoEmailMs: 30,
          })
        ),
    );
    assertEquals(c.pushes.length, 1);
  });
}

// ── O toque no aviso abre o PEDIDO do aviso (07/11/2026) ──────────────────

Deno.test("avisoAoLojista: os dois avisos levam o id do pedido na url, codificado (nunca o id cru numa query)", () => {
  const idEstranho = "a b&id=outro#x";
  for (const resultado of ["pago", "pago_apos_expirar"]) {
    const aviso = avisoAoLojista(idEstranho, resultado, 10);
    assertEquals(aviso?.url, "/admin-orders?id=a%20b%26id%3Doutro%23x");
  }
  assertEquals(avisoAoLojista(PEDIDO, "pago", 10)?.url, `/admin-orders?id=${PEDIDO}`);
});

// --- r200-a: o comprovante do pedido 'pago' que não saiu --------------------
// O SMTP cai uma vez na confirmação, a reserva do e-mail volta, o webhook
// responde 200. A notificação seguinte do MP recebe 'ja_pago' e (pela regra
// "efeito só para quem fez a transição") não fazia NADA; o cron exclui pedido
// com `paid_at`. A cliente que JÁ PAGOU ficava sem comprovante. O caso que dói
// é o inverso: o reenvio nunca pode mandar e-mail em dobro, nem para pedido
// antigo/presencial, nem quando a leitura deixa dúvida.

const AGORA_MS = Date.parse("2026-11-12T12:00:00Z");
/** O pedido que o webhook enxerga logo depois de um pagamento online confirmado há 10 min. */
const ONLINE_RECENTE = { paid_at: "2026-11-12T11:50:00Z", payment_method: "online", canal: "online" };

/** O `enviarComprovante` com o contrato do real: reserva atômica ANTES, devolve a reserva se o SMTP falhar. */
function comprovanteComReserva(smtp: () => Promise<void>) {
  return async (a: { supabase: any; orderId: string }) => {
    const { data } = await a.supabase.rpc("reivindicar_email_de_confirmacao", { p_order_id: a.orderId });
    if (data !== true) return;
    try {
      await smtp();
    } catch (erro) {
      await a.supabase.rpc("liberar_email_de_confirmacao", { p_order_id: a.orderId });
      throw erro;
    }
  };
}

function reenviarPago(banco: unknown, enviarComprovante: (a: any) => Promise<void>, extra: Record<string, unknown> = {}) {
  return emSilencio(() =>
    reenviarEmailPendenteDoPagamento({
      supabase: banco as never,
      orderId: PEDIDO,
      enviarComprovante: enviarComprovante as never,
      enviarAvisoAtrasado: async () => {
        throw new Error("o aviso atrasado nunca é desta chamada");
      },
      agoraMs: AGORA_MS,
      ...extra,
    })
  );
}

Deno.test("r200-a - SMTP cai na confirmação do 'pago'; a reentrega 'ja_pago' manda o comprovante UMA vez e a seguinte já não manda mais", async () => {
  const banco = bancoComReserva({ payment_status: "pago", reservado: false, extras: ONLINE_RECENTE });
  let smtpNoAr = false;
  const enviados: unknown[] = [];
  const smtp = async () => {
    if (!smtpNoAr) throw new Error("SMTP fora do ar");
    enviados.push(1);
  };
  // 1) a transição: o SMTP recusa, a reserva volta.
  await emSilencio(() =>
    aplicarEfeitosDoPagamentoConfirmado({
      supabase: banco as never,
      orderId: PEDIDO,
      resultado: "pago",
      enviarPush: async () => {},
      enviarComprovante: comprovanteComReserva(smtp) as never,
    })
  );
  assertEquals(banco.estado.reservado, false);
  assertEquals(enviados.length, 0);
  // 2) reentrega 'ja_pago' com o SMTP de volta: o comprovante pendente sai.
  smtpNoAr = true;
  await reenviarPago(banco, comprovanteComReserva(smtp));
  assertEquals(enviados.length, 1);
  assertEquals(banco.estado.reservado, true);
  // 3) outra reentrega: a reserva está presa, nada mais sai.
  await reenviarPago(banco, comprovanteComReserva(smtp));
  assertEquals(enviados.length, 1);
});

Deno.test("r200-a - três reentregas 'ja_pago' CONCORRENTES do 'pago' com a reserva livre mandam UM comprovante só", async () => {
  const banco = bancoComReserva({ payment_status: "pago", reservado: false, extras: ONLINE_RECENTE });
  const enviados: unknown[] = [];
  const smtp = async () => {
    await new Promise((r) => setTimeout(r, 5));
    enviados.push(1);
  };
  await Promise.all([1, 2, 3].map(() => reenviarPago(banco, comprovanteComReserva(smtp))));
  assertEquals(enviados.length, 1);
});

Deno.test("r200-a - 'pago' com a reserva OCUPADA (e-mail já saiu ou está saindo) não envia e nem chama RPC", async () => {
  const banco = bancoComReserva({ payment_status: "pago", reservado: true, extras: ONLINE_RECENTE });
  const enviados: unknown[] = [];
  await reenviarPago(banco, async (a) => void enviados.push(a));
  assertEquals(enviados.length, 0);
  assertEquals(banco.rpcs.length, 0);
});

Deno.test("r200-a - falha FECHADA: campo AUSENTE na leitura (undefined = 'não sei') nunca libera o comprovante", async () => {
  const completo = { payment_status: "pago", confirmation_email_sent_at: null, ...ONLINE_RECENTE };
  const controle: unknown[] = [];
  await reenviarPago(bancoDoPedido({ linha: completo }), async (a) => void controle.push(a));
  assertEquals(controle.length, 1, "controle: a linha completa envia (senão o teste abaixo não prova nada)");
  for (const campo of ["confirmation_email_sent_at", "paid_at", "payment_method", "canal"]) {
    const linha: Record<string, unknown> = { ...completo };
    Reflect.deleteProperty(linha, campo);
    const enviados: unknown[] = [];
    await reenviarPago(bancoDoPedido({ linha }), async (a) => void enviados.push(a));
    assertEquals(enviados.length, 0, `sem ${campo} na resposta`);
  }
});

Deno.test("r200-a - guarda do pedido: legado, antigo, presencial, não-online, data ilegível ou do futuro NÃO recebem comprovante de reentrega", async () => {
  const casos: Array<[string, Record<string, unknown>]> = [
    ["legado sem paid_at (null)", { paid_at: null }],
    ["pago há 2 dias (fora da janela)", { paid_at: "2026-11-10T11:50:00Z" }],
    ["pago há 25 h (logo fora da janela)", { paid_at: "2026-11-11T10:50:00Z" }],
    ["paid_at ilegível", { paid_at: "ontem à tarde" }],
    ["paid_at 1 h NO FUTURO", { paid_at: "2026-11-12T13:00:00Z" }],
    ["venda de balcão (canal presencial)", { canal: "presencial" }],
    ["pagamento na entrega", { payment_method: "entrega" }],
    ["método nulo", { payment_method: null }],
  ];
  for (const [rotulo, extras] of casos) {
    const banco = bancoComReserva({ payment_status: "pago", reservado: false, extras: { ...ONLINE_RECENTE, ...extras } });
    const enviados: unknown[] = [];
    await reenviarPago(banco, async (a) => void enviados.push(a));
    assertEquals(enviados.length, 0, rotulo);
    assertEquals(banco.rpcs.length, 0, rotulo);
  }
});

Deno.test("r200-a - guarda do pedido: dentro da janela (23 h) e online ENVIA — o limite da janela é 24 h", async () => {
  const banco = bancoComReserva({
    payment_status: "pago",
    reservado: false,
    extras: { ...ONLINE_RECENTE, paid_at: "2026-11-11T13:00:00Z" },
  });
  const enviados: unknown[] = [];
  await reenviarPago(banco, async (a) => void enviados.push(a));
  assertEquals(enviados.length, 1);
});

Deno.test("r200-a - fronteira da janela: exatamente 24 h envia UM comprovante", async () => {
  const banco = bancoComReserva({
    payment_status: "pago",
    reservado: false,
    extras: { ...ONLINE_RECENTE, paid_at: "2026-11-11T12:00:00.000Z" },
  });
  const enviados: unknown[] = [];
  await reenviarPago(banco, comprovanteComReserva(async () => { enviados.push(1); }));
  assertEquals(enviados.length, 1);
  assertEquals(banco.estado.reservado, true);
});

Deno.test("r200-a - fronteira da janela: 24 h mais 1 ms não envia comprovante", async () => {
  const banco = bancoComReserva({
    payment_status: "pago",
    reservado: false,
    extras: { ...ONLINE_RECENTE, paid_at: "2026-11-11T11:59:59.999Z" },
  });
  const enviados: unknown[] = [];
  await reenviarPago(banco, comprovanteComReserva(async () => { enviados.push(1); }));
  assertEquals(enviados.length, 0);
  assertEquals(banco.estado.reservado, false);
  assertEquals(banco.rpcs.length, 0);
});

Deno.test("r200-a - só 'pago' ganha o ramo novo: aguardando/recusado/expirado/estornado/cancelado/nulo não enviam NADA", async () => {
  for (const status of ["aguardando", "recusado", "expirado", "estornado", "cancelado", "cancelled", "", "recebido_na_entrega"]) {
    const banco = bancoComReserva({ payment_status: status, reservado: false, extras: ONLINE_RECENTE });
    const comprovantes: unknown[] = [];
    const atrasados: unknown[] = [];
    await emSilencio(() =>
      reenviarEmailPendenteDoPagamento({
        supabase: banco as never,
        orderId: PEDIDO,
        enviarComprovante: async (a) => void comprovantes.push(a),
        enviarAvisoAtrasado: async (a) => void atrasados.push(a),
        agoraMs: AGORA_MS,
      })
    );
    assertEquals([comprovantes.length, atrasados.length, banco.rpcs.length], [0, 0, 0], status);
  }
});

Deno.test("r200-a - 'pago_apos_expirar' segue igual: manda o AVISO atrasado e nunca o comprovante", async () => {
  const banco = bancoComReserva({ payment_status: "pago_apos_expirar", reservado: false, extras: ONLINE_RECENTE });
  const comprovantes: unknown[] = [];
  const atrasados: unknown[] = [];
  await emSilencio(() =>
    reenviarEmailPendenteDoPagamento({
      supabase: banco as never,
      orderId: PEDIDO,
      enviarComprovante: async (a) => void comprovantes.push(a),
      enviarAvisoAtrasado: async (a) => void atrasados.push(a),
      agoraMs: AGORA_MS,
    })
  );
  assertEquals([comprovantes.length, atrasados.length], [0, 1]);
});

Deno.test("r200-a - o comprovante da reentrega que LANÇA não sobe, e o teto de espera vale como no aviso", async () => {
  const banco = bancoComReserva({ payment_status: "pago", reservado: false, extras: ONLINE_RECENTE });
  await reenviarPago(banco, async () => {
    throw new Error("explodiu");
  });
  await provarTetoDoEnvio(
    undefined,
    (demorado) => reenviarPago(banco, demorado, { tetoDoEmailMs: 30 }),
  );
});

Deno.test("r200-a - o e-mail de pagamento atrasado NÃO afirma que a loja 'já foi avisada' (o push pode ter entregue 0), mas segue dizendo que a loja entra em contato", () => {
  for (const nomeDaLoja of ["", "Loja da Ana"]) {
    const html = htmlDoAvisoDePagamentoAtrasado({ orderId: PEDIDO, nomeDaLoja });
    assertEquals(/j[áa] foi avisada/i.test(html), false, "afirma um aviso que pode não ter acontecido");
    assertEquals(/avisad/i.test(html), false);
    assertEquals(html.includes("A loja vai entrar em contato para resolver"), true);
    assertEquals(html.includes("reenvio, se ainda houver estoque, ou devolução do valor pago"), true);
  }
});

// ── r210-h: o aviso "Pagamento fora do fluxo" era de tiro ÚNICO — não é mais ──
// Antes: 'pago_apos_expirar' usava o envio simples e IGNORAVA a contagem de
// entregas. Sem admin inscrito (iOS sem o app) ou com a chave VAPID falhando, o
// push entregava a 0, ia só ao log, e a reentrega do MP ('ja_pago') não avisava
// de novo: dinheiro do cliente parado no lojista sem alerta. Agora o ramo usa
// `avisarAdminUmaVez` (reserva com prazo, como `valor_divergente`): libera a
// reserva quando a entrega foi 0 e a reentrega 'ja_pago' tenta de novo; depois
// de entregue, NUNCA repete.

const CHAVE_FORA_DO_FLUXO = `pago_fora_do_fluxo:${PEDIDO}`;
const AVISO_FORA_DO_FLUXO = {
  title: "Pagamento fora do fluxo",
  body: "#4F5A6B · R$ 100,00 · estoque já devolvido",
  url: `/admin-orders?id=${PEDIDO}`,
};

/** O banco do aviso: a leitura do pedido + as três RPCs da reserva (espelho SEM o
 * prazo de 2 minutos, que é SQL e foi provado em Postgres de verdade à parte). */
function bancoDoAvisoFora(opts: {
  linha?: Record<string, unknown> | null;
  avisos?: Map<string, { enviado: boolean }>;
  reservaFalha?: boolean;
  leituraLanca?: boolean;
} = {}) {
  const avisos = opts.avisos ?? new Map<string, { enviado: boolean }>();
  const rpcs: Array<{ nome: string; chave: unknown }> = [];
  const leituras: string[] = [];
  return {
    avisos,
    rpcs,
    leituras,
    from(tabela: string) {
      return {
        select(colunas: string) {
          leituras.push(`${tabela}:${colunas}`);
          return {
            eq: () => ({
              maybeSingle: async () => {
                if (opts.leituraLanca) throw new Error("banco caiu");
                return {
                  data: opts.linha === undefined
                    ? { id: PEDIDO, customer_name: "Fulana", total: 100, payment_status: "pago_apos_expirar" }
                    : opts.linha,
                  error: null,
                };
              },
            }),
          };
        },
      };
    },
    rpc: async (nome: string, args: Record<string, unknown>) => {
      rpcs.push({ nome, chave: args.p_chave });
      const chave = String(args.p_chave);
      if (nome === "reservar_aviso_ao_lojista") {
        if (opts.reservaFalha) return { data: null, error: { message: "statement timeout" } };
        const linha = avisos.get(chave);
        if (linha) return { data: linha.enviado ? "enviado" : "em_envio", error: null };
        avisos.set(chave, { enviado: false });
        return { data: "reservado", error: null };
      }
      if (nome === "confirmar_aviso_ao_lojista") {
        const linha = avisos.get(chave);
        if (linha) linha.enviado = true;
        return { data: Boolean(linha), error: null };
      }
      if (nome === "liberar_aviso_ao_lojista") {
        const apaga = Boolean(avisos.get(chave) && !avisos.get(chave)!.enviado);
        if (apaga) avisos.delete(chave);
        return { data: apaga, error: null };
      }
      throw new Error(`rpc inesperada: ${nome}`);
    },
  };
}

/** Um push que entrega a `quantos` inscrições e anota o aviso recebido. */
function pushContado(quantos: number) {
  const avisos: unknown[] = [];
  return {
    avisos,
    enviarPushContado: async (a: { aviso: unknown }) => {
      avisos.push(a.aviso);
      return quantos;
    },
  };
}

function transicaoAposExpirar(banco: unknown, push: { enviarPushContado: unknown }, extras: Record<string, unknown> = {}) {
  return emSilencio(() =>
    aplicarEfeitosDoPagamentoConfirmado({
      supabase: banco as never,
      orderId: PEDIDO,
      resultado: "pago_apos_expirar",
      enviarPushContado: push.enviarPushContado,
      enviarAvisoAtrasado: async () => {},
      ...extras,
    })
  );
}

function reentregaJaPago(banco: unknown, push: { enviarPushContado: unknown }, extras: Record<string, unknown> = {}) {
  return emSilencio(() =>
    reavisarLojistaNaReentrega({
      supabase: banco as never,
      orderId: PEDIDO,
      enviarPushContado: push.enviarPushContado,
      ...extras,
    })
  );
}

Deno.test("r210-h - 'pago_apos_expirar' entregue a 1+ inscrição: reserva e CONFIRMA a chave pago_fora_do_fluxo:<pedido>, com o texto de sempre", async () => {
  const banco = bancoDoAvisoFora();
  const push = pushContado(2);
  await transicaoAposExpirar(banco, push);
  assertEquals(push.avisos, [AVISO_FORA_DO_FLUXO]);
  assertEquals(banco.rpcs, [
    { nome: "reservar_aviso_ao_lojista", chave: CHAVE_FORA_DO_FLUXO },
    { nome: "confirmar_aviso_ao_lojista", chave: CHAVE_FORA_DO_FLUXO },
  ]);
  assertEquals(banco.avisos.get(CHAVE_FORA_DO_FLUXO), { enviado: true });
});

Deno.test("r210-h - 'pago_apos_expirar' com entrega ZERO (ninguém inscrito, VAPID falhou): LIBERA a reserva, para a reentrega poder tentar de novo", async () => {
  const banco = bancoDoAvisoFora();
  const push = pushContado(0);
  await transicaoAposExpirar(banco, push);
  assertEquals(banco.rpcs.map((r) => r.nome), ["reservar_aviso_ao_lojista", "liberar_aviso_ao_lojista"]);
  assertEquals(banco.avisos.size, 0, "reserva presa: a reentrega não conseguiria tentar de novo");
});

Deno.test("r210-h - o push que LANÇA conta como entrega zero: libera a reserva e nada sobe; o aviso ao cliente sai assim mesmo", async () => {
  const banco = bancoDoAvisoFora();
  const atrasados: unknown[] = [];
  await emSilencio(() =>
    aplicarEfeitosDoPagamentoConfirmado({
      supabase: banco as never,
      orderId: PEDIDO,
      resultado: "pago_apos_expirar",
      enviarPushContado: () => Promise.reject(new Error("push service fora")),
      enviarAvisoAtrasado: async (a) => void atrasados.push(a.orderId),
    })
  );
  assertEquals(banco.rpcs.map((r) => r.nome), ["reservar_aviso_ao_lojista", "liberar_aviso_ao_lojista"]);
  assertEquals(atrasados, [PEDIDO]);
});

Deno.test("r210-h - a CADEIA inteira: entrega 0 na transição -> a 1ª reentrega 'ja_pago' avisa -> a 2ª e a 3ª NÃO repetem (sem spam)", async () => {
  const banco = bancoDoAvisoFora();
  const semInscrito = pushContado(0);
  await transicaoAposExpirar(banco, semInscrito);
  assertEquals(semInscrito.avisos.length, 1);

  const depois = pushContado(1);
  await reentregaJaPago(banco, depois);
  assertEquals(depois.avisos, [AVISO_FORA_DO_FLUXO], "a reentrega não tentou de novo");
  assertEquals(banco.avisos.get(CHAVE_FORA_DO_FLUXO), { enviado: true });

  const spam = pushContado(1);
  await reentregaJaPago(banco, spam);
  await reentregaJaPago(banco, spam);
  assertEquals(spam.avisos, [], "avisou DE NOVO depois de entregue");
});

Deno.test("r210-h - a reentrega que também entrega ZERO segue tentando na próxima (a reserva volta)", async () => {
  const banco = bancoDoAvisoFora();
  const push = pushContado(0);
  await reentregaJaPago(banco, push);
  await reentregaJaPago(banco, push);
  assertEquals(push.avisos.length, 2);
  assertEquals(banco.avisos.size, 0);
});

Deno.test("r210-h - transição entregue + reentrega 'ja_pago': a reentrega NÃO repete o aviso que já chegou", async () => {
  const banco = bancoDoAvisoFora();
  await transicaoAposExpirar(banco, pushContado(1));
  const reentrega = pushContado(1);
  await reentregaJaPago(banco, reentrega);
  assertEquals(reentrega.avisos, []);
});

Deno.test("r210-h - reentrega 'ja_pago' só vale para 'pago_apos_expirar' e 'pago' (lote-582): nos outros estados não reserva nem avisa", async () => {
  for (const payment_status of ["aguardando", "recusado", "estornado", "expirado", "pago_parcial", null, undefined]) {
    const banco = bancoDoAvisoFora({ linha: { id: PEDIDO, total: 100, payment_status } });
    const push = pushContado(1);
    await reentregaJaPago(banco, push);
    assertEquals(push.avisos, [], String(payment_status));
    assertEquals(banco.rpcs, [], String(payment_status));
  }
});

Deno.test("r210-h - reentrega 'ja_pago': pedido sumido, leitura com erro ou leitura que LANÇA -> nada é avisado e nada sobe", async () => {
  for (const opts of [{ linha: null }, { leituraLanca: true }]) {
    const banco = bancoDoAvisoFora(opts);
    const push = pushContado(1);
    await reentregaJaPago(banco, push);
    assertEquals(push.avisos, []);
    assertEquals(banco.rpcs, []);
  }
  const comErro = {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: { payment_status: "pago_apos_expirar" }, error: { code: "57014" } }),
        }),
      }),
    }),
    rpc: async () => {
      throw new Error("não devia chegar à reserva");
    },
  };
  const push = pushContado(1);
  await reentregaJaPago(comErro, push);
  assertEquals(push.avisos, []);
});

Deno.test("r210-h - outra entrega está enviando ('em_envio'): quem chega junto NÃO avisa", async () => {
  const avisos = new Map([[CHAVE_FORA_DO_FLUXO, { enviado: false }]]);
  const banco = bancoDoAvisoFora({ avisos });
  const push = pushContado(1);
  await transicaoAposExpirar(banco, push);
  await reentregaJaPago(banco, push);
  assertEquals(push.avisos, []);
  assertEquals(banco.rpcs.map((r) => r.nome), ["reservar_aviso_ao_lojista", "reservar_aviso_ao_lojista"]);
});

Deno.test("r210-h - transição e reentregas CONCORRENTES do mesmo pedido: UM push só", async () => {
  const banco = bancoDoAvisoFora();
  const push = pushContado(1);
  await Promise.all([transicaoAposExpirar(banco, push), reentregaJaPago(banco, push), reentregaJaPago(banco, push)]);
  assertEquals(push.avisos.length, 1);
});

Deno.test("r210-h - a RESERVA falha (RPC fora do ar): avisa mesmo assim (falha aberta), sem confirmar nem liberar", async () => {
  const banco = bancoDoAvisoFora({ reservaFalha: true });
  const push = pushContado(1);
  await transicaoAposExpirar(banco, push);
  assertEquals(push.avisos, [AVISO_FORA_DO_FLUXO]);
  assertEquals(banco.rpcs.map((r) => r.nome), ["reservar_aviso_ao_lojista"]);
});

Deno.test("r210-h - o seam antigo `enviarPush` (sem contagem) segue valendo para 'pago_apos_expirar': o aviso sai com o MESMO texto", async () => {
  const banco = bancoDoAvisoFora();
  const c = coletores();
  await emSilencio(() =>
    aplicarEfeitosDoPagamentoConfirmado({ supabase: banco as never, orderId: PEDIDO, resultado: "pago_apos_expirar", ...c.deps })
  );
  assertEquals(c.pushes, [AVISO_FORA_DO_FLUXO]);
  assertEquals(c.atrasados, [PEDIDO]);
});

Deno.test("lote-582 - o seam antigo `enviarPush` (sem contagem) segue valendo para 'pago': o aviso sai UMA vez e a chave fecha", async () => {
  const banco = bancoDoAvisoFora({ linha: pagoHaDezMinutos() });
  const c = coletores();
  await emSilencio(() =>
    aplicarEfeitosDoPagamentoConfirmado({ supabase: banco as never, orderId: PEDIDO, resultado: "pago", ...c.deps })
  );
  assertEquals(c.pushes, [AVISO_PEDIDO_PAGO]);
  assertEquals(c.comprovantes, [PEDIDO]);
  assertEquals(banco.avisos.get(CHAVE_PEDIDO_PAGO), { enviado: true });
});

// ── lote-582: o aviso "Pedido pago" era de tiro ÚNICO — não é mais ──────────
// Antes: 'pago' usava o envio simples. Push service fora (5xx, mais de 10 s), VAPID
// falhando ou a inscrição trocada entregavam a 0, e a reentrega do MP chegava como
// 'ja_pago' e não avisava de novo: venda paga sem alerta na Black Friday. Agora o
// 'pago' usa a MESMA reserva do 'pago_apos_expirar', com a chave
// `pedido_pago:<pedido>`: entrega 0 libera, a reentrega tenta de novo; entregue,
// nunca repete.

const CHAVE_PEDIDO_PAGO = `pedido_pago:${PEDIDO}`;
const AVISO_PEDIDO_PAGO = { title: "Pedido pago", body: "#4F5A6B · R$ 100,00", url: `/admin-orders?id=${PEDIDO}` };
const AGORA_582 = Date.parse("2026-11-28T12:00:00.000Z");
function pagoHaDezMinutos(extras: Record<string, unknown> = {}) {
  return {
    id: PEDIDO,
    customer_name: "Fulana",
    total: 100,
    payment_status: "pago",
    paid_at: new Date(AGORA_582 - 10 * 60 * 1000).toISOString(),
    ...extras,
  };
}

function transicaoPago(banco: unknown, push: { enviarPushContado: unknown }, extras: Record<string, unknown> = {}) {
  return emSilencio(() =>
    aplicarEfeitosDoPagamentoConfirmado({
      supabase: banco as never,
      orderId: PEDIDO,
      resultado: "pago",
      enviarPushContado: push.enviarPushContado,
      enviarComprovante: async () => {},
      ...extras,
    })
  );
}

function reentregaDoPago(banco: unknown, push: { enviarPushContado: unknown }, extras: Record<string, unknown> = {}) {
  return reentregaJaPago(banco, push, { agoraMs: AGORA_582, ...extras });
}

Deno.test("lote-582 - 'pago' entregue a 1+ inscrição: reserva e CONFIRMA a chave pedido_pago:<pedido>, com o texto de sempre", async () => {
  const banco = bancoDoAvisoFora({ linha: pagoHaDezMinutos() });
  const push = pushContado(2);
  await transicaoPago(banco, push);
  assertEquals(push.avisos, [AVISO_PEDIDO_PAGO]);
  assertEquals(banco.rpcs, [
    { nome: "reservar_aviso_ao_lojista", chave: CHAVE_PEDIDO_PAGO },
    { nome: "confirmar_aviso_ao_lojista", chave: CHAVE_PEDIDO_PAGO },
  ]);
});

Deno.test("lote-582 - a CADEIA do 'pago': entrega 0 na transição LIBERA -> a 1ª reentrega 'ja_pago' REENVIA -> a 2ª e a 3ª NÃO repetem", async () => {
  const banco = bancoDoAvisoFora({ linha: pagoHaDezMinutos() });
  const semEntrega = pushContado(0);
  await transicaoPago(banco, semEntrega);
  assertEquals(semEntrega.avisos.length, 1);
  assertEquals(banco.avisos.size, 0, "reserva presa: a reentrega não conseguiria tentar de novo");

  const depois = pushContado(1);
  await reentregaDoPago(banco, depois);
  assertEquals(depois.avisos, [AVISO_PEDIDO_PAGO], "a reentrega 'ja_pago' do 'pago' não tentou de novo");
  assertEquals(banco.avisos.get(CHAVE_PEDIDO_PAGO), { enviado: true });

  const spam = pushContado(1);
  await reentregaDoPago(banco, spam);
  await reentregaDoPago(banco, spam);
  assertEquals(spam.avisos, [], "avisou DE NOVO depois de entregue");
});

Deno.test("lote-582 - 'pago' entregue na transição + reentrega 'ja_pago': NÃO reenvia o que já chegou", async () => {
  const banco = bancoDoAvisoFora({ linha: pagoHaDezMinutos() });
  await transicaoPago(banco, pushContado(1));
  const reentrega = pushContado(1);
  await reentregaDoPago(banco, reentrega);
  assertEquals(reentrega.avisos, []);
  assertEquals(banco.rpcs.map((r) => r.nome), [
    "reservar_aviso_ao_lojista",
    "confirmar_aviso_ao_lojista",
    "reservar_aviso_ao_lojista",
  ]);
});

Deno.test("lote-582 - transição 'pago' e duas reentregas AO MESMO TEMPO: UM push só", async () => {
  const banco = bancoDoAvisoFora({ linha: pagoHaDezMinutos() });
  const push = pushContado(1);
  await Promise.all([transicaoPago(banco, push), reentregaDoPago(banco, push), reentregaDoPago(banco, push)]);
  assertEquals(push.avisos.length, 1);
  assertEquals(banco.avisos.get(CHAVE_PEDIDO_PAGO), { enviado: true });
});

Deno.test("lote-582 - outra entrega está enviando o 'Pedido pago' ('em_envio'): a reentrega NÃO avisa", async () => {
  const avisos = new Map([[CHAVE_PEDIDO_PAGO, { enviado: false }]]);
  const banco = bancoDoAvisoFora({ linha: pagoHaDezMinutos(), avisos });
  const push = pushContado(1);
  await reentregaDoPago(banco, push);
  assertEquals(push.avisos, []);
});

Deno.test("lote-582 - o push do 'pago' que LANÇA conta como entrega zero: libera a reserva; o comprovante sai assim mesmo", async () => {
  const banco = bancoDoAvisoFora({ linha: pagoHaDezMinutos() });
  const comprovantes: unknown[] = [];
  await transicaoPago(banco, { enviarPushContado: () => Promise.reject(new Error("push service 503")) }, {
    enviarComprovante: async (a: { orderId: string }) => void comprovantes.push(a.orderId),
  });
  assertEquals(banco.rpcs.map((r) => r.nome), ["reservar_aviso_ao_lojista", "liberar_aviso_ao_lojista"]);
  assertEquals(comprovantes, [PEDIDO]);
});

Deno.test("lote-582 - as duas chaves não se cruzam: 'Pedido pago' entregue não cala 'Pagamento fora do fluxo' do mesmo pedido", async () => {
  const avisos = new Map([[CHAVE_PEDIDO_PAGO, { enviado: true }]]);
  const banco = bancoDoAvisoFora({ avisos });
  const push = pushContado(1);
  await transicaoAposExpirar(banco, push);
  assertEquals(push.avisos, [AVISO_FORA_DO_FLUXO]);
});

Deno.test("lote-582 - reentrega do 'pago' só dentro de 24 h do paid_at (falha FECHADA): antigo, sem data, data ilegível ou do futuro não reservam nem avisam", async () => {
  const casos: Array<[string, Record<string, unknown>]> = [
    ["pago há 24 h e 1 ms", { paid_at: new Date(AGORA_582 - 24 * 3600 * 1000 - 1).toISOString() }],
    ["pago há 3 dias", { paid_at: new Date(AGORA_582 - 3 * 24 * 3600 * 1000).toISOString() }],
    ["sem paid_at na leitura", { paid_at: undefined }],
    ["paid_at nulo", { paid_at: null }],
    ["paid_at ilegível", { paid_at: "ontem" }],
    ["paid_at 1 h no futuro", { paid_at: new Date(AGORA_582 + 3600 * 1000).toISOString() }],
  ];
  for (const [rotulo, extras] of casos) {
    const banco = bancoDoAvisoFora({ linha: pagoHaDezMinutos(extras) });
    const push = pushContado(1);
    await reentregaDoPago(banco, push);
    assertEquals(push.avisos, [], rotulo);
    assertEquals(banco.rpcs, [], rotulo);
  }
});

Deno.test("lote-582 - fronteira da janela: pago há EXATAMENTE 24 h ainda reavisa", async () => {
  const banco = bancoDoAvisoFora({ linha: pagoHaDezMinutos({ paid_at: new Date(AGORA_582 - 24 * 3600 * 1000).toISOString() }) });
  const push = pushContado(1);
  await reentregaDoPago(banco, push);
  assertEquals(push.avisos, [AVISO_PEDIDO_PAGO]);
});

Deno.test("lote-582 - pedido 'pago' de ANTES desta versão (sem linha de reserva), dentro da janela: a 1ª reentrega avisa UMA vez a mais e fecha a chave", async () => {
  const banco = bancoDoAvisoFora({ linha: pagoHaDezMinutos() });
  const push = pushContado(1);
  await reentregaDoPago(banco, push);
  await reentregaDoPago(banco, push);
  assertEquals(push.avisos, [AVISO_PEDIDO_PAGO]);
  assertEquals(banco.avisos.get(CHAVE_PEDIDO_PAGO), { enviado: true });
});

Deno.test("r210-h - o teto do push (cron) vale também para o aviso com reserva: um push lento não prende o laço", async () => {
  const banco = bancoDoAvisoFora();
  await provarTetoDoEnvio(
    1,
    (enviarPushContado) =>
      transicaoAposExpirar(banco, { enviarPushContado }, { tetoDoPushMs: 30 }),
  );
});
