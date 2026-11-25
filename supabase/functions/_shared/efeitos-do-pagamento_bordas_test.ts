// @ts-nocheck
/**
 * Caça por mutação (24/11/2026) em `efeitos-do-pagamento.ts`: os casos que
 * sobreviveram à suíte de `efeitos-do-pagamento_test.ts`, do webhook e do cron.
 *
 *   * o teto de espera pelo e-mail é MAIOR que o orçamento do próprio envio
 *     (é o que o comentário do módulo promete: quem estoura de verdade é o SMTP);
 *   * o aviso de pagamento atrasado vai para o e-mail que o PEDIDO guardou; a
 *     conta só é consultada quando o pedido não tem e-mail — antes o cliente
 *     poderia receber o aviso em outro endereço, e sem e-mail nenhum a consulta
 *     nem pode acontecer com um id inventado;
 *   * a tolerância de relógio do comprovante de reentrega (5 min à frente) vale
 *     5 minutos, na fronteira exata, e não alguns milissegundos.
 *
 * Fixtures inventadas.
 */
import { assertEquals } from "https://deno.land/std@0.177.0/testing/asserts.ts";
import { ORCAMENTO_DO_ENVIO_MS } from "./comprovante.ts";
import {
  dispararAvisoDePagamentoAtrasadoReal,
  reenviarEmailPendenteDoPagamento,
  TETO_DO_EMAIL_MS,
} from "./efeitos-do-pagamento.ts";

const PEDIDO = "5c1d2e3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f";
const USUARIO = "11111111-2222-4333-8444-555555555555";
const REMETENTE = { origem: "painel", usuario: "painel@exemplo.test", senha: "x", motivo: null, reserva: null };

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

Deno.test("o teto de espera pelo e-mail fica 5 s ACIMA do orçamento do envio (o SMTP estoura antes de quem espera desistir)", () => {
  assertEquals(TETO_DO_EMAIL_MS - ORCAMENTO_DO_ENVIO_MS, 5000);
});

// ─── para quem vai o aviso de pagamento atrasado ─────────────────────────────

function bancoDoAviso(linha: Record<string, unknown>, emailDaConta: string | null) {
  const rpcs: string[] = [];
  const consultasAConta: string[] = [];
  return {
    rpcs,
    consultasAConta,
    rpc: async (nome: string) => {
      rpcs.push(nome);
      return { data: nome === "reivindicar_email_de_confirmacao" ? true : null, error: null };
    },
    from(tabela: string) {
      const resultado = tabela === "marketplace_orders"
        ? { data: { id: PEDIDO, ...linha }, error: null }
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
        getUserById: async (id: string) => {
          consultasAConta.push(id);
          return { data: { user: emailDaConta ? { email: emailDaConta } : null }, error: null };
        },
      },
    },
  };
}

async function avisar(banco: unknown) {
  const enviados: any[] = [];
  await emSilencio(() =>
    dispararAvisoDePagamentoAtrasadoReal({
      supabase: banco as never,
      orderId: PEDIDO,
      deps: { resolverRemetente: async () => REMETENTE, enviarEmail: async (...a: unknown[]) => void enviados.push(a) },
    })
  );
  return enviados;
}

Deno.test("aviso atrasado: pedido COM e-mail e COM conta vai para o e-mail do pedido, e a conta nem é consultada", async () => {
  const banco = bancoDoAviso({ user_id: USUARIO, customer_data: { email: "pedido@exemplo.test" } }, "conta@exemplo.test");
  const enviados = await avisar(banco);
  assertEquals(enviados.length, 1);
  assertEquals(enviados[0][0].para, "pedido@exemplo.test");
  assertEquals(banco.consultasAConta, []);
});

Deno.test("aviso atrasado: pedido SEM e-mail e SEM conta (convidado sem e-mail) não consulta conta nenhuma, não reserva e não envia", async () => {
  const banco = bancoDoAviso({ user_id: null, customer_data: {} }, "conta@exemplo.test");
  const enviados = await avisar(banco);
  assertEquals(enviados, []);
  assertEquals(banco.consultasAConta, []);
  assertEquals(banco.rpcs, []);
});

Deno.test("aviso atrasado: pedido sem e-mail mas COM conta usa o e-mail da conta (o controle)", async () => {
  const banco = bancoDoAviso({ user_id: USUARIO, customer_data: {} }, "conta@exemplo.test");
  const enviados = await avisar(banco);
  assertEquals(enviados.length, 1);
  assertEquals(enviados[0][0].para, "conta@exemplo.test");
  assertEquals(banco.consultasAConta, [USUARIO]);
});

// ─── a tolerância de relógio do comprovante de reentrega ─────────────────────

const AGORA_MS = Date.parse("2026-11-12T12:00:00.000Z");

function bancoDaReentrega(paidAt: string) {
  const linha = {
    payment_status: "pago",
    confirmation_email_sent_at: null,
    paid_at: paidAt,
    payment_method: "online",
    canal: "online",
  };
  return {
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: linha, error: null }) }) }),
    }),
  };
}

async function reentregaEnviou(paidAt: string): Promise<boolean> {
  let enviou = false;
  await emSilencio(() =>
    reenviarEmailPendenteDoPagamento({
      supabase: bancoDaReentrega(paidAt) as never,
      orderId: PEDIDO,
      enviarComprovante: async () => {
        enviou = true;
      },
      enviarAvisoAtrasado: async () => {
        throw new Error("o aviso atrasado nunca é desta chamada");
      },
      agoraMs: AGORA_MS,
    })
  );
  return enviou;
}

Deno.test("comprovante de reentrega: paid_at até 5 min À FRENTE do relógio (relógios diferentes) ainda envia; 5 min e 1 ms não", async () => {
  assertEquals(await reentregaEnviou("2026-11-12T12:01:00.000Z"), true, "1 min à frente");
  assertEquals(await reentregaEnviou("2026-11-12T12:04:00.000Z"), true, "4 min à frente");
  assertEquals(await reentregaEnviou("2026-11-12T12:05:00.000Z"), true, "exatamente 5 min à frente");
  assertEquals(await reentregaEnviou("2026-11-12T12:05:00.001Z"), false, "5 min e 1 ms à frente");
});
