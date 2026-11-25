// @ts-nocheck
/**
 * Caça por mutação (25/11/2026) em `aviso-ao-lojista.ts` (o push que avisa o
 * lojista de pagamento, estorno, contestação). `avisarAdminUmaVez` já era
 * segurado pela suíte de `efeitos-do-pagamento_test.ts` (15 mutantes, 12 mortos
 * e 3 equivalentes: só mudam o log). Em `dispararPushContadoReal` sobreviviam:
 *
 *   * "sem admin" e "admin sem inscrição" devolvem 0 (e, sem admin, a tabela de
 *     inscrições nem é lida — nunca "todas as inscrições");
 *   * uma exceção no banco devolve 0 e NÃO sobe: o pedido já está pago quando
 *     o aviso roda, e um push fora do ar não pode mudar a resposta de quem
 *     confirmou o pagamento;
 *   * sem `VAPID_SUBJECT` o contato do servidor de push é
 *     `mailto:admin@example.org` (o Apple recusa token VAPID sem `sub`), e com a
 *     variável ela é usada.
 */
import { assertEquals } from "https://deno.land/std@0.177.0/testing/asserts.ts";
import * as webpush from "jsr:@negrel/webpush@0.3.0";
import { dispararPushContadoReal } from "./aviso-ao-lojista.ts";
import { inscricaoDeTeste, parVapidDeTeste, pushServiceFalso } from "./webpush_fixtures.ts";

const AVISO = { title: "Pedido pago", body: "#ABC123 · R$ 50,00", url: "/admin-orders" };

function supabaseFalso(admins: unknown[], inscricoes: unknown[], lidas: string[]) {
  return {
    from(tabela: string) {
      lidas.push(tabela);
      if (tabela === "profiles") {
        return {
          select: () => ({ eq: () => Promise.resolve({ data: admins, error: null }) }),
        };
      }
      return {
        select: () => ({ in: () => Promise.resolve({ data: inscricoes, error: null }) }),
        delete: () => ({ eq: () => Promise.resolve({ error: null }) }),
      };
    },
  };
}

/** Roda `fn` com um par VAPID novo (e `VAPID_SUBJECT` como pedido) e restaura o ambiente. */
async function comVapid(subject: string | undefined, fn: () => Promise<void>) {
  const par = await parVapidDeTeste();
  const nomes = ["VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY", "VAPID_SUBJECT"];
  const anteriores = nomes.map((n) => [n, Deno.env.get(n)]);
  Deno.env.set("VAPID_PUBLIC_KEY", par.publica);
  Deno.env.set("VAPID_PRIVATE_KEY", par.privada);
  if (subject === undefined) Deno.env.delete("VAPID_SUBJECT");
  else Deno.env.set("VAPID_SUBJECT", subject);
  try {
    await fn();
  } finally {
    for (const [nome, valor] of anteriores) {
      if (valor === undefined) Deno.env.delete(nome);
      else Deno.env.set(nome, valor);
    }
  }
}

/** Silencia o log do módulo durante `fn` (o catch e os avisos usam console). */
async function semLog<T>(fn: () => Promise<T>) {
  const originais = [console.log, console.warn, console.error];
  console.log = console.warn = console.error = () => {};
  try {
    return await fn();
  } finally {
    [console.log, console.warn, console.error] = originais;
  }
}

Deno.test("sem nenhum admin: devolve 0 e a tabela de inscrições nem é lida", async () => {
  const lidas: string[] = [];
  const entregues = await semLog(() =>
    dispararPushContadoReal({
      supabase: supabaseFalso([], [{ endpoint: "https://x.invalid/p" }], lidas),
      aviso: AVISO,
      rotulo: "teste",
    })
  );
  assertEquals(entregues, 0);
  assertEquals(lidas, ["profiles"]);
});

Deno.test("admin sem nenhuma inscrição de push: devolve 0", async () => {
  const lidas: string[] = [];
  for (const inscricoes of [[], null]) {
    const entregues = await semLog(() =>
      dispararPushContadoReal({
        supabase: supabaseFalso([{ id: "admin-1" }], inscricoes, lidas),
        aviso: AVISO,
        rotulo: "teste",
      })
    );
    assertEquals(entregues, 0);
  }
});

Deno.test("exceção do banco: devolve 0 e NÃO sobe", async () => {
  const supabase = {
    from() {
      throw new Error("banco fora do ar");
    },
  };
  const entregues = await semLog(() =>
    dispararPushContadoReal({ supabase, aviso: AVISO, rotulo: "teste" })
  );
  assertEquals(entregues, 0);
});

Deno.test("contato do servidor de push: o padrão sem VAPID_SUBJECT, e o da variável quando existe", async () => {
  const novoOriginal = webpush.ApplicationServer.new;
  const contatos: unknown[] = [];
  webpush.ApplicationServer.new = (opcoes) => {
    contatos.push(opcoes.contactInformation);
    return novoOriginal.call(webpush.ApplicationServer, opcoes);
  };
  const service = pushServiceFalso({ "/p/ok": 201 });
  try {
    for (const subject of [undefined, "mailto:loja@example.org"]) {
      await comVapid(subject, async () => {
        const entregues = await semLog(async () =>
          dispararPushContadoReal({
            supabase: supabaseFalso([{ id: "admin-1" }], [await inscricaoDeTeste(`${service.base}/p/ok`)], []),
            aviso: AVISO,
            rotulo: "teste",
          })
        );
        assertEquals(entregues, 1);
      });
    }
    assertEquals(contatos, ["mailto:admin@example.org", "mailto:loja@example.org"]);
  } finally {
    webpush.ApplicationServer.new = novoOriginal;
    await service.encerrar();
  }
});
