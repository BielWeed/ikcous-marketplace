// @ts-nocheck
/**
 * O aviso ao lojista tem de sair COM URGÊNCIA ALTA (RFC 8030, cabeçalho
 * `Urgency: high`).
 *
 * O defeito: `enviarParaInscritos` chamava `pushTextMessage(mensagem, {})`, e a
 * biblioteca assume `Urgency: normal` e `TTL: 2419200` (28 dias) quando as
 * opções vêm vazias. Num Android em economia de bateria (Doze), aviso normal
 * pode ficar parado até o aparelho "acordar" — o lojista via o pedido novo
 * horas depois. Com `high` o serviço de push pede entrega na hora.
 *
 * O TTL NÃO é encurtado, de propósito: vários avisos que passam por aqui são
 * o único sinal do caso (cartão duplicado, estorno sem registro, devolução,
 * contestação), e `avisarAdminUmaVez` os dá por entregues no 201 — com TTL
 * curto, um aparelho desligado os perderia para sempre. Os testes cravam o
 * padrão da biblioteca (28 dias = 2419200 s) no fio.
 *
 * Aqui nada é falso entre o código e o fio: VAPID real, inscrição real, e o
 * push service é um servidor HTTP local que guarda os cabeçalhos recebidos.
 * Só o banco é um dublê.
 */
import { assertEquals } from "https://deno.land/std@0.177.0/testing/asserts.ts";
import { dispararPushContadoReal } from "./aviso-ao-lojista.ts";
import { inscricaoDeTeste, parVapidDeTeste, pushServiceFalso } from "./webpush_fixtures.ts";

/** 28 dias em segundos — o TTL padrão da biblioteca, que o aviso NÃO sobrescreve. */
const TTL_PADRAO_DA_BIBLIOTECA = "2419200";

function supabaseFalso(inscricoes: unknown[], apagadas: string[]) {
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
        delete: () => ({
          eq: (_coluna: string, endpoint: string) => {
            apagadas.push(endpoint);
            return Promise.resolve({ error: null });
          },
        }),
      };
    },
  };
}

/** Roda `fn` com as variáveis VAPID de um par novo e restaura o ambiente. */
async function comVapidDeTeste(fn: () => Promise<void>) {
  const par = await parVapidDeTeste();
  const anteriores = ["VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY"].map((n) => [n, Deno.env.get(n)]);
  Deno.env.set("VAPID_PUBLIC_KEY", par.publica);
  Deno.env.set("VAPID_PRIVATE_KEY", par.privada);
  try {
    await fn();
  } finally {
    for (const [nome, valor] of anteriores) {
      if (valor === undefined) Deno.env.delete(nome);
      else Deno.env.set(nome, valor);
    }
  }
}

for (const [rotulo, aviso] of [
  ["pedido novo", { title: "Pedido novo", body: "#ABC123 · R$ 50,00 · Maria", url: "/admin-orders" }],
  ["pedido pago", { title: "Pedido pago", body: "#ABC123 · R$ 50,00", url: "/admin-orders" }],
] as const) {
  Deno.test(`aviso de ${rotulo} sai com Urgency: high e o TTL padrão (sem encurtar)`, async () => {
    const service = pushServiceFalso({ "/p/ok": 201 });
    try {
      await comVapidDeTeste(async () => {
        const entregues = await dispararPushContadoReal({
          supabase: supabaseFalso([await inscricaoDeTeste(`${service.base}/p/ok`)], []),
          aviso,
          rotulo: "teste",
        });

        assertEquals(entregues, 1);
        assertEquals(service.recebidas.length, 1);
        const cabecalhos = service.recebidas[0].headers;
        assertEquals(cabecalhos.get("urgency"), "high");
        assertEquals(cabecalhos.get("ttl"), TTL_PADRAO_DA_BIBLIOTECA);
      });
    } finally {
      await service.encerrar();
    }
  });
}

Deno.test("aviso ao lojista: inscrição morta (410) continua sendo apagada e o erro não sobe", async () => {
  const service = pushServiceFalso({ "/p/morta": 410 });
  const apagadas: string[] = [];
  try {
    await comVapidDeTeste(async () => {
      const inscricao = await inscricaoDeTeste(`${service.base}/p/morta`);
      const entregues = await dispararPushContadoReal({
        supabase: supabaseFalso([inscricao], apagadas),
        aviso: { title: "Pedido novo", body: "x", url: "/admin-orders" },
        rotulo: "teste",
      });

      assertEquals(entregues, 0);
      assertEquals(apagadas, [inscricao.endpoint]);
      // O envio foi tentado COM urgência alta mesmo na inscrição que morreu.
      assertEquals(service.recebidas[0].headers.get("urgency"), "high");
    });
  } finally {
    await service.encerrar();
  }
});
