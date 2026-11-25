// @ts-nocheck
/**
 * send-order-confirmation — o que sai do handler DEPOIS que a porta de sessão
 * deixou passar (caça por mutação de 25/11/2026).
 *
 * Todos os testes de handler antigos devolviam `{ ok: true }` no
 * `enviarComprovante` dublê. Trocar o retorno final do handler por um
 * `{ ok: true }` cravado (ou seja: a loja falhou ao mandar o e-mail e a tela
 * continuaria achando que o comprovante saiu) não quebrava nenhum teste. Aqui
 * cada desfecho do miolo vira o status e o corpo certos, e o `console.error` da
 * falha de infraestrutura ao montar o client leva o nome da função (é por ele
 * que a falha se acha no painel de logs).
 *
 * MUTANTE EQUIVALENTE (anotado, não vira teste): `pedido.user_id !== user.id`
 * com `&& pedido.user_id !== null` — pedido de convidado tem `user_id` nulo, e
 * `null !== user.id` já era verdadeiro.
 */
import { assert, assertEquals } from "https://deno.land/std@0.177.0/testing/asserts.ts";
import { handler } from "./index.ts";

const ID = "3f2a1b8c-4d5e-4f60-9a7b-1c2d3e4f5a6b";

function bancoDoDono() {
  return {
    auth: { getUser: async () => ({ data: { user: { id: "dono" } }, error: null }) },
    from: () => {
      const b: any = {
        select: () => b,
        eq: () => b,
        maybeSingle: async () => ({ data: { user_id: "dono" }, error: null }),
      };
      return b;
    },
  };
}

function pedir() {
  return new Request("http://localhost/send-order-confirmation", {
    method: "POST",
    headers: { Authorization: "Bearer sessao-de-teste", "Content-Type": "application/json" },
    body: JSON.stringify({ orderId: ID }),
  });
}

for (
  const [desfecho, status] of [
    [{ ok: true }, 200],
    [{ ok: false, motivo: "ja_enviado" }, 200],
    [{ ok: false, motivo: "sem_destinatario" }, 200],
    [{ ok: false, motivo: "pedido_invalido" }, 400],
    [{ ok: false, motivo: "envio_falhou" }, 502],
    [{ ok: false, motivo: "sem_remetente" }, 502],
  ] as Array<[Record<string, unknown>, number]>
) {
  Deno.test(`o desfecho do comprovante ${JSON.stringify(desfecho)} chega à tela como HTTP ${status} com o mesmo corpo`, async () => {
    const supabase = bancoDoDono();
    let recebido: any = null;
    const r = await handler(pedir(), {
      supabase,
      adminAtual: async () => null,
      enviarComprovante: async (args: unknown) => {
        recebido = args;
        return desfecho;
      },
    });
    assertEquals(r.status, status);
    assertEquals(await r.json(), desfecho);
    assertEquals(recebido.orderId, ID);
    assert(recebido.supabase === supabase, "o miolo recebe o MESMO client que o handler usou");
  });
}

Deno.test("sem chave de serviço no ambiente: 502 envio_falhou e a falha de infraestrutura vai para o log com o nome da função", async () => {
  const nomes = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_SECRET_KEYS"];
  const anteriores = nomes.map((n) => [n, Deno.env.get(n)] as const);
  Deno.env.set("SUPABASE_URL", "https://xyz.supabase.co");
  Deno.env.delete("SUPABASE_SERVICE_ROLE_KEY");
  Deno.env.delete("SUPABASE_SECRET_KEYS");
  const saiu: string[] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => {
    saiu.push(args.map((a) => (a instanceof Error ? a.message : String(a))).join(" "));
  };
  try {
    const r = await handler(pedir(), {});
    assertEquals(r.status, 502);
    assertEquals(await r.json(), { ok: false, motivo: "envio_falhou" });
    assert(
      saiu.some((l) => l.startsWith("send-order-confirmation: falha ao criar o client do Supabase")),
      `o log precisa nomear a função: ${saiu.join(" | ")}`,
    );
  } finally {
    console.error = original;
    for (const [nome, valor] of anteriores) {
      if (valor === undefined) Deno.env.delete(nome);
      else Deno.env.set(nome, valor);
    }
  }
});
