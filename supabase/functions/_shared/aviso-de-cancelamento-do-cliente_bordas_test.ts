// @ts-nocheck
/**
 * Caça por mutação (25/11/2026) em `aviso-de-cancelamento-do-cliente.ts` — o
 * aviso ao lojista de que o CLIENTE cancelou o pedido (e, se já pagou, o
 * dinheiro volta sozinho). Dos 41 mutantes plantados, 7 sobreviviam à suíte de
 * `aviso-de-cancelamento-do-cliente_test.ts`: 3 são equivalentes (o `Set` que
 * tira id repetido do `in(...)`, o teto de 10 s que só a rotina usa e o ramo
 * "sem pagamento" com produto já saído, que `avisarCancelamentosDoCliente`
 * nunca deixa chegar à frase); os 4 que mudam o comportamento viram os casos
 * abaixo:
 *
 *   * a leitura dos PEDIDOS que falha lança (como a do histórico e a dos
 *     perfis): engolir o erro deixaria todo cancelamento "ignorado" em
 *     silêncio, e passadas 24 h o lojista nunca saberia;
 *   * admin é só quem tem papel `admin`: perfil com outro papel (ou sem papel)
 *     que cancela o PRÓPRIO pedido é cliente e avisa;
 *   * a rodada lê no máximo 100 linhas do histórico (o teto vai na consulta);
 *   * com `total` E `total_amount` preenchidos, o valor do aviso é o `total`.
 */
import {
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.177.0/testing/asserts.ts";
import {
  avisarCancelamentosDoCliente,
  LIMITE_POR_RODADA,
  montarAvisoDeCancelamento,
} from "./aviso-de-cancelamento-do-cliente.ts";

const AGORA = Date.parse("2026-10-14T12:00:00.000Z");
const CLIENTE = "c1111111-1111-4111-8111-111111111111";
const PEDIDO = "3f2a1b8c-4d5e-4f60-9a7b-1c2d3e4f5a6b";

type Resposta = { data?: unknown; error?: unknown };

/** Dublê mínimo: cada tabela devolve o que o cenário manda e registra os filtros. */
function bancoFalso(tabelas: Record<string, Resposta>) {
  const consultas: Array<{ tabela: string; limite?: number }> = [];
  return {
    consultas,
    from(tabela: string) {
      const consulta: { tabela: string; limite?: number } = { tabela };
      consultas.push(consulta);
      const q = {
        select: () => q,
        eq: () => q,
        not: () => q,
        gte: () => q,
        in: () => q,
        order: () => q,
        limit: (n: number) => {
          consulta.limite = n;
          return q;
        },
        then: (res: (v: unknown) => void, rej?: (e: unknown) => void) => {
          const r = Reflect.get(tabelas, tabela) as Resposta;
          return Promise.resolve({ data: r.data ?? null, error: r.error ?? null })
            .then(res, rej);
        },
      };
      return q;
    },
  };
}

const historico = (id: string, extra = {}) => ({
  id,
  order_id: PEDIDO,
  old_status: "pending",
  new_status: "cancelled",
  created_by: CLIENTE,
  created_at: "2026-10-14T11:57:00.000Z",
  ...extra,
});
const pedido = (extra = {}) => ({
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

async function rodar(tabelas: Record<string, Resposta>) {
  const banco = bancoFalso(tabelas);
  const avisos: Array<{ chave: string; aviso: unknown }> = [];
  const original = console.error;
  console.error = () => {};
  try {
    const resumo = await avisarCancelamentosDoCliente({
      supabase: banco,
      avisar: (chave: string, aviso: unknown) => {
        avisos.push({ chave, aviso });
        return Promise.resolve();
      },
      agora: () => AGORA,
      rotulo: "teste",
    });
    return { banco, avisos, resumo };
  } finally {
    console.error = original;
  }
}

Deno.test("leitura dos PEDIDOS falha -> lança e NÃO avisa ninguém (a rotina tenta de novo na próxima rodada)", async () => {
  let lancou = false;
  const avisos: unknown[] = [];
  const banco = bancoFalso({
    marketplace_order_history: { data: [historico("h1")] },
    marketplace_orders: { error: { message: "marketplace_orders fora do ar" } },
    profiles: { data: [] },
  });
  try {
    await avisarCancelamentosDoCliente({
      supabase: banco,
      avisar: (...a: unknown[]) => {
        avisos.push(a);
        return Promise.resolve();
      },
      agora: () => AGORA,
      rotulo: "teste",
    });
  } catch {
    lancou = true;
  }
  assertEquals(lancou, true);
  assertEquals(avisos.length, 0);
});

Deno.test("perfil que NÃO é admin (outro papel ou sem papel) cancelando o próprio pedido avisa como cliente", async () => {
  for (const papel of ["staff", null, "customer"]) {
    const r = await rodar({
      marketplace_order_history: { data: [historico("h1")] },
      marketplace_orders: { data: [pedido()] },
      profiles: { data: [{ id: CLIENTE, role: papel }] },
    });
    assertEquals(r.avisos.length, 1, String(papel));
    assertEquals(r.resumo.avisados, 1, String(papel));
  }
});

Deno.test("perfil admin cancelando o próprio pedido NÃO avisa (contraprova do caso acima)", async () => {
  const r = await rodar({
    marketplace_order_history: { data: [historico("h1")] },
    marketplace_orders: { data: [pedido()] },
    profiles: { data: [{ id: CLIENTE, role: "admin" }] },
  });
  assertEquals(r.avisos.length, 0);
  assertEquals(r.resumo, { candidatos: 1, avisados: 0, ignorados: 1, falhas: 0 });
});

Deno.test("a rodada lê no máximo 100 linhas do histórico (o teto vai na consulta)", async () => {
  assertEquals(LIMITE_POR_RODADA, 100);
  const r = await rodar({
    marketplace_order_history: { data: [] },
    marketplace_orders: { data: [] },
    profiles: { data: [] },
  });
  const consultaDoHistorico = r.banco.consultas.find((c) =>
    c.tabela === "marketplace_order_history"
  );
  assertEquals(consultaDoHistorico?.limite, 100);
});

Deno.test("valor do aviso: com `total` e `total_amount` preenchidos, vale o `total`", () => {
  const aviso = montarAvisoDeCancelamento(
    { id: PEDIDO, customer_name: "Maria", total: 149.9, total_amount: 20, payment_status: "pago" },
    { old_status: "pending" },
  );
  assertStringIncludes(aviso.body, "R$ 149,90");
  assertEquals(aviso.body.includes("R$ 20,00"), false);
});
