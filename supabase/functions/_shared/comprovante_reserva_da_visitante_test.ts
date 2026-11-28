// @ts-nocheck
/**
 * O miolo do comprovante com a RESERVA DA VISITANTE (lote 579, migration
 * 20261656000000). A porta da visitante da `send-order-confirmation` pede
 * `reivindicacao: "reivindicar_comprovante_da_visitante"`: a reserva que
 * respeita o teto diário de e-mails MESMO com o pedido pago. O resto do fluxo
 * é o de sempre — o destinatário vem do pedido lido do banco, e sem vaga o
 * desfecho é `teto_diario`, sem envio.
 *
 *  - com a reserva da visitante, a RPC chamada é ELA (e só ela);
 *  - sem `reivindicacao`, ou com qualquer outro nome, é a de sempre
 *    (`reivindicar_email_de_confirmacao`): nenhum chamador escolhe uma RPC
 *    arbitrária pelo nome;
 *  - a reserva negada com a marca vazia é `teto_diario` e nada sai.
 *
 * Fixtures inventadas; nenhum SMTP, nenhuma rede.
 */
import { assertEquals } from "https://deno.land/std@0.177.0/testing/asserts.ts";
import { enviarComprovantePedido } from "./comprovante.ts";

const PEDIDO = "5a1f0c2b-9e11-4c4e-8f3a-0b7c1c399d8e";
const REMETENTE = {
  origem: "ambiente",
  usuario: "loja@exemplo.invalid",
  senha: "senha-de-teste",
  motivo: null,
  reserva: null,
};

function banco(reservou: boolean) {
  const rpcs: Array<{ nome: string; args: unknown }> = [];
  const pedido = {
    id: PEDIDO,
    user_id: null,
    customer_name: "Visitante Teste",
    customer_data: { email: "visitante@exemplo.invalid" },
    subtotal: 50,
    total: 50,
    payment_method: "cash",
    payment_status: "pago",
    canal: "online",
  };
  const resposta = (tabela: string, colunas: string) => {
    if (tabela === "marketplace_orders" && colunas === "confirmation_email_sent_at") {
      return { data: { confirmation_email_sent_at: null }, error: null };
    }
    if (tabela === "marketplace_orders") return { data: pedido, error: null };
    if (tabela === "marketplace_order_items") {
      return { data: [{ product_name: "Blusa", quantity: 1, price: 50 }], error: null };
    }
    return { data: null, error: null };
  };
  return {
    rpcs,
    supabase: {
      rpc: async (nome: string, args: unknown) => {
        rpcs.push({ nome, args });
        if (nome === "liberar_email_de_confirmacao") return { data: null, error: null };
        return { data: reservou, error: null };
      },
      from(tabela: string) {
        return {
          select(colunas: string) {
            const r = resposta(tabela, colunas);
            const fim = {
              maybeSingle: () => Promise.resolve(r),
              limit: () => fim,
              then: (ok: (v: unknown) => unknown, erro?: (e: unknown) => unknown) =>
                Promise.resolve(r).then(ok, erro),
            };
            return { eq: () => fim, in: () => Promise.resolve({ data: [], error: null }), limit: () => fim };
          },
        };
      },
    },
  };
}

async function enviar(reservou: boolean, reivindicacao?: string) {
  const b = banco(reservou);
  const destinatarios: string[] = [];
  const [e, w, l] = [console.error, console.warn, console.log];
  console.error = () => {};
  console.warn = () => {};
  console.log = () => {};
  try {
    const desfecho = await enviarComprovantePedido({
      supabase: b.supabase as never,
      orderId: PEDIDO,
      ...(reivindicacao === undefined ? {} : { reivindicacao }),
      deps: {
        resolverRemetente: () => Promise.resolve(REMETENTE),
        enviarEmail: (args: { para?: string; to?: string }) => {
          destinatarios.push(String(args?.para ?? args?.to ?? ""));
          return Promise.resolve();
        },
      },
    });
    return { desfecho, rpcs: b.rpcs.map((r) => r.nome), args: b.rpcs, destinatarios };
  } finally {
    [console.error, console.warn, console.log] = [e, w, l];
  }
}

Deno.test("reserva da visitante: a RPC chamada é reivindicar_comprovante_da_visitante, com o id do pedido, e o e-mail vai para o endereço do BANCO", async () => {
  const r = await enviar(true, "reivindicar_comprovante_da_visitante");
  assertEquals(r.desfecho, { ok: true });
  assertEquals(r.rpcs, ["reivindicar_comprovante_da_visitante"]);
  assertEquals(r.args[0].args, { p_order_id: PEDIDO });
  assertEquals(r.destinatarios, ["visitante@exemplo.invalid"]);
});

Deno.test("reserva da visitante negada (o teto barrou, mesmo com o pedido pago): teto_diario e nada sai", async () => {
  const r = await enviar(false, "reivindicar_comprovante_da_visitante");
  assertEquals(r.desfecho, { ok: false, motivo: "teto_diario" });
  assertEquals(r.rpcs, ["reivindicar_comprovante_da_visitante"]);
  assertEquals(r.destinatarios, []);
});

Deno.test("sem reivindicacao, ou com um nome qualquer, a reserva é a de SEMPRE (ninguém escolhe RPC pelo nome)", async () => {
  for (const nome of [undefined, "reivindicar_email_de_confirmacao", "apagar_tudo", ""]) {
    const r = await enviar(true, nome);
    assertEquals(r.desfecho, { ok: true }, String(nome));
    assertEquals(r.rpcs, ["reivindicar_email_de_confirmacao"], String(nome));
  }
});
