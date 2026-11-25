// @ts-nocheck
/**
 * send-order-confirmation — o CORS completo em TODA resposta (caça por mutação
 * de 25/11/2026).
 *
 * A suíte já cobria `Access-Control-Allow-Origin`, mas nenhum teste lia a
 * LISTA de `Access-Control-Allow-Headers`: reduzir
 * "authorization, x-client-info, apikey, content-type" a "authorization"
 * continuava com tudo verde. O navegador manda os quatro no pré-voo (o
 * supabase-js coloca `apikey`, `x-client-info` e `content-type`), então com a
 * lista curta o comprovante do pedido nunca sai do navegador — e e-mail que não
 * chega não reclama. Aqui a lista é conferida item a item no pré-voo, na recusa
 * de formato (400), na recusa de sessão (401/403) e no sucesso (200).
 */
import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.177.0/testing/asserts.ts";
import { handler } from "./index.ts";

const UUID = "3f2a1b8c-4d5e-4f60-9a7b-1c2d3e4f5a6b";
const CABECALHOS_DO_NAVEGADOR = ["authorization", "x-client-info", "apikey", "content-type"];

function exigirCorsCompleto(r: Response, rotulo: string) {
  assertEquals(r.headers.get("Access-Control-Allow-Origin"), "*", rotulo);
  const permitidos = (r.headers.get("Access-Control-Allow-Headers") ?? "")
    .split(",")
    .map((c) => c.trim().toLowerCase());
  for (const cabecalho of CABECALHOS_DO_NAVEGADOR) {
    assert(permitidos.includes(cabecalho), `${rotulo}: falta ${cabecalho} (permitidos: ${permitidos})`);
  }
}

function requisicao(opcoes: { metodo?: string; corpo?: unknown; autorizacao?: string } = {}) {
  const metodo = opcoes.metodo ?? "POST";
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (opcoes.autorizacao) headers.Authorization = opcoes.autorizacao;
  return new Request("http://local/send-order-confirmation", {
    method: metodo,
    headers,
    body: metodo === "POST" ? JSON.stringify(opcoes.corpo ?? { orderId: UUID }) : undefined,
  });
}

function banco(opcoes: { userId?: string; donoDoPedido?: string | null } = {}) {
  return {
    auth: {
      getUser: () => Promise.resolve({ data: { user: { id: opcoes.userId ?? "u-dono" } }, error: null }),
    },
    from: () => {
      const b: any = {
        select: () => b,
        eq: () => b,
        maybeSingle: () =>
          Promise.resolve({
            data: opcoes.donoDoPedido === null ? null : { user_id: opcoes.donoDoPedido ?? "u-dono" },
            error: null,
          }),
      };
      return b;
    },
  };
}

Deno.test("CORS completo: pré-voo, 400 de formato, 401 sem sessão, 403 de pedido alheio e 200 de envio", async () => {
  const enviarComprovante = () => Promise.resolve({ ok: true });
  const adminNinguem = () => Promise.resolve(null);

  exigirCorsCompleto(await handler(requisicao({ metodo: "OPTIONS" }), {}), "pré-voo");

  const formato = await handler(requisicao({ corpo: { orderId: "nao-e-uuid" } }), { supabase: banco() });
  assertEquals(formato.status, 400);
  exigirCorsCompleto(formato, "400 de formato");

  const semSessao = await handler(requisicao(), { supabase: banco() });
  assertEquals(semSessao.status, 401);
  exigirCorsCompleto(semSessao, "401 sem sessão");

  const alheio = await handler(requisicao({ autorizacao: "Bearer token-ficticio" }), {
    supabase: banco({ userId: "u-outro", donoDoPedido: "u-dono" }),
    adminAtual: adminNinguem,
    enviarComprovante,
  });
  assertEquals(alheio.status, 403);
  exigirCorsCompleto(alheio, "403 de pedido alheio");

  const ok = await handler(requisicao({ autorizacao: "Bearer token-ficticio" }), {
    supabase: banco(),
    adminAtual: adminNinguem,
    enviarComprovante,
  });
  assertEquals(ok.status, 200);
  exigirCorsCompleto(ok, "200 de envio");
});
