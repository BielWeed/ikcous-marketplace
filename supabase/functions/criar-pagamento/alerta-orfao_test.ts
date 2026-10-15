// @ts-nocheck
/**
 * O aviso de cartão órfão (cobrança no Mercado Pago sem NENHUMA linha no banco)
 * é o ÚNICO sinal que o lojista recebe desse dinheiro — não há pedido para
 * aparecer no painel. Ele tem de sair com `Urgency: high` (RFC 8030), senão um
 * Android em economia de bateria segura o aviso por horas.
 *
 * O TTL NÃO muda aqui (continua o padrão da biblioteca, 28 dias): perder esse
 * aviso por aparelho desligado é pior que recebê-lo tarde, porque nada mais o
 * repete. Só a urgência sobe — a mesma regra de todo aviso ao lojista
 * (`OPCOES_DE_AVISO_AO_LOJISTA`).
 */
import { assertEquals } from "https://deno.land/std@0.177.0/testing/asserts.ts";
import { inscricaoDeTeste, parVapidDeTeste, pushServiceFalso } from "../_shared/webpush_fixtures.ts";
import { alertarAdminCartaoOrfaoReal } from "./index.ts";

function supabaseFalso(inscricoes: unknown[]) {
  return {
    from(tabela: string) {
      if (tabela === "profiles") {
        return {
          select: () => ({
            eq: () => Promise.resolve({ data: [{ id: "admin-1" }], error: null }),
          }),
        };
      }
      return {
        select: () => ({ in: () => Promise.resolve({ data: inscricoes, error: null }) }),
        delete: () => ({ eq: () => Promise.resolve({ error: null }) }),
      };
    },
  };
}

Deno.test("aviso de cartão órfão sai com Urgency: high e mantém o TTL padrão de 28 dias", async () => {
  const service = pushServiceFalso({ "/p/ok": 201 });
  const par = await parVapidDeTeste();
  const anteriores = ["VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY"].map((n) => [n, Deno.env.get(n)]);
  Deno.env.set("VAPID_PUBLIC_KEY", par.publica);
  Deno.env.set("VAPID_PRIVATE_KEY", par.privada);
  try {
    await alertarAdminCartaoOrfaoReal({
      supabase: supabaseFalso([await inscricaoDeTeste(`${service.base}/p/ok`)]),
      orderId: "5a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d",
      idOrderOrfa: "ORD01JABCDEFGHJKMNPQRSTVWXYZ",
    });

    assertEquals(service.recebidas.length, 1);
    const cabecalhos = service.recebidas[0].headers;
    assertEquals(cabecalhos.get("urgency"), "high");
    assertEquals(cabecalhos.get("ttl"), "2419200");
  } finally {
    for (const [nome, valor] of anteriores) {
      if (valor === undefined) Deno.env.delete(nome);
      else Deno.env.set(nome, valor);
    }
    await service.encerrar();
  }
});
