/**
 * A porta de autenticação do `send-order-confirmation` (reenvio do comprovante
 * do pedido por e-mail) tem de FECHAR em toda falha, nunca "abrir por engano":
 *
 *  - o Auth devolve erro (mesmo trazendo um usuário junto): 401, nada enviado;
 *  - a consulta ao Auth LANÇA (queda de rede): 401 — não 200, não 500 — e nada
 *    enviado. Um catch que devolvesse 200 diria ao front "comprovante enviado"
 *    sem ninguém ter provado quem chamou.
 *
 * A suíte vizinha prova o texto do comprovante; estes ramos de erro ficavam sem
 * asserção de status (trocar o 401 por 200 não derrubava nada). Dublês locais,
 * nenhum SMTP nem banco reais; ids inventados.
 */
import { assertEquals } from "https://deno.land/std@0.177.0/testing/asserts.ts";
import { handler } from "./index.ts";

const PEDIDO = "d77c6616-c389-4caa-b5c1-9a8d7af77f72";
const DONO = "c1111111-1111-4111-8111-111111111111";

function pedido() {
  return new Request("http://local/send-order-confirmation", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer jwt-de-teste" },
    body: JSON.stringify({ orderId: PEDIDO }),
  });
}

function cenario(getUser: () => Promise<unknown>) {
  const chamadas = { enviados: 0, leituras: 0 };
  const supabase = {
    auth: { getUser },
    from() {
      chamadas.leituras++;
      const c = {
        select: () => c,
        eq: () => c,
        maybeSingle: () => Promise.resolve({ data: { user_id: DONO }, error: null }),
      };
      return c;
    },
  };
  return {
    chamadas,
    deps: {
      supabase,
      adminAtual: () => Promise.resolve(null),
      enviarComprovante: () => {
        chamadas.enviados++;
        return Promise.resolve({ ok: true });
      },
    } as never,
  };
}

Deno.test("Auth devolve ERRO junto com um usuário: 401 e nenhum comprovante enviado", async () => {
  const c = cenario(() => Promise.resolve({ data: { user: { id: DONO } }, error: { message: "jwt expired" } }));
  const r = await handler(pedido(), c.deps);
  assertEquals(r.status, 401);
  assertEquals((await r.json()).motivo, "nao_autorizado");
  assertEquals(c.chamadas.enviados, 0);
  assertEquals(c.chamadas.leituras, 0, "nem leu o pedido");
});

Deno.test("a consulta ao Auth LANÇA (queda de rede): 401 'nao_autorizado', nenhum comprovante enviado", async () => {
  const c = cenario(() => Promise.reject(new Error("queda de rede")));
  const r = await handler(pedido(), c.deps);
  assertEquals(r.status, 401);
  assertEquals((await r.json()).motivo, "nao_autorizado");
  assertEquals(c.chamadas.enviados, 0);
});

Deno.test("CONTROLE: Auth devolve o dono do pedido sem erro: o comprovante é enviado", async () => {
  const c = cenario(() => Promise.resolve({ data: { user: { id: DONO } }, error: null }));
  const r = await handler(pedido(), c.deps);
  assertEquals(r.status, 200);
  assertEquals(c.chamadas.enviados, 1);
});
