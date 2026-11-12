import { assertEquals, assertStringIncludes } from "https://deno.land/std@0.177.0/testing/asserts.ts";
import * as webpush from "jsr:@negrel/webpush@0.3.0";
import { bytesParaBase64Url, handler } from "./index.ts";

// Aviso de STATUS DE PEDIDO ("Seu pedido #X agora está: ...") sem destinatário
// nunca pode ir para todos os aparelhos: vazaria o número e o status do pedido
// de UMA pessoa para a base inteira. Hoje a única defesa é o front (pedido de
// convidado/balcão não chama a edge); aqui a edge passa a recusar sozinha.
// Campanha do admin sem alvo (sem `data.type` de pedido) continua legítima.

/** Chaves efêmeras de um navegador fictício; nenhuma credencial real. */
async function inscricaoDeTeste(id: string, userId: string, endpoint: string) {
  const par = await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    true,
    ["deriveKey", "deriveBits"],
  );
  return {
    id,
    user_id: userId,
    endpoint,
    p256dh: bytesParaBase64Url(
      new Uint8Array(await crypto.subtle.exportKey("raw", par.publicKey)),
    ),
    auth: bytesParaBase64Url(crypto.getRandomValues(new Uint8Array(16))),
  };
}

type Resultado = {
  status: number;
  corpo: any;
  /** Consultas GET em push_subscriptions, com o filtro user_id de cada uma. */
  leituras: Array<string | null>;
  /** Caminhos que o push service local recebeu. */
  entregas: string[];
};

async function chamar(
  payload: Record<string, unknown>,
  montarTokens?: (base: string) => Promise<unknown[]>,
): Promise<Resultado> {
  const parVapid = await webpush.generateVapidKeys({ extractable: true });
  const vapid = await webpush.exportVapidKeys(parVapid);
  const entregas: string[] = [];
  const servidor = Deno.serve({ port: 0, onListen: () => {} }, async (req) => {
    await req.arrayBuffer();
    entregas.push(new URL(req.url).pathname);
    return new Response(null, { status: 201 });
  });
  const base = `http://localhost:${servidor.addr.port}`;
  const fetchAnterior = globalThis.fetch;
  const anteriores = [
    "SUPABASE_URL",
    "SUPABASE_PUBLISHABLE_KEYS",
    "SUPABASE_SECRET_KEYS",
    "VAPID_PUBLIC_KEY",
    "VAPID_PRIVATE_KEY",
  ].map((chave) => [chave, Deno.env.get(chave)] as const);

  try {
    const base_de_dados = [
      await inscricaoDeTeste("a", "cliente-a", `${base}/p/a`),
      await inscricaoDeTeste("b", "cliente-b", `${base}/p/b`),
    ];
    const leituras: Array<string | null> = [];

    Deno.env.set("SUPABASE_URL", "https://supa-fake.local");
    Deno.env.set("SUPABASE_PUBLISHABLE_KEYS", JSON.stringify({ default: "anon-de-teste" }));
    Deno.env.set("SUPABASE_SECRET_KEYS", JSON.stringify({ default: "service-role-de-teste" }));
    Deno.env.set("VAPID_PUBLIC_KEY", JSON.stringify(vapid.publicKey));
    Deno.env.set("VAPID_PRIVATE_KEY", JSON.stringify(vapid.privateKey));

    globalThis.fetch = async (entrada, opcoes) => {
      const url = new URL(entrada instanceof Request ? entrada.url : String(entrada));
      if (url.origin === base) return await fetchAnterior(entrada, opcoes);
      if (url.origin !== "https://supa-fake.local") {
        throw new Error("Requisição fora do roteiro do teste");
      }
      const json = (dados: unknown) =>
        new Response(JSON.stringify(dados), {
          headers: { "Content-Type": "application/json" },
        });
      if (url.pathname === "/auth/v1/user") {
        return json({
          id: "admin-de-teste",
          aud: "authenticated",
          role: "authenticated",
          app_metadata: { provider: "email", role: "admin" },
        });
      }
      if (url.pathname === "/rest/v1/profiles") {
        return json({ id: "admin-de-teste", role: "admin" });
      }
      if (url.pathname === "/rest/v1/push_subscriptions") {
        const metodo = opcoes?.method ?? (entrada instanceof Request ? entrada.method : "GET");
        if (metodo === "GET") {
          const filtro = url.searchParams.get("user_id");
          leituras.push(filtro);
          // O banco fictício honra o filtro: sem ele, devolve a base inteira.
          return json(
            filtro === null
              ? base_de_dados
              : base_de_dados.filter((linha) => filtro === `eq.${linha.user_id}`),
          );
        }
      }
      throw new Error("Operação fora do roteiro do banco");
    };

    const corpoDaChamada = montarTokens
      ? { ...payload, tokens: await montarTokens(base) }
      : payload;
    const resposta = await handler(
      new Request("http://local/send-push", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer jwt-de-teste",
        },
        body: JSON.stringify(corpoDaChamada),
      }),
    );
    return { status: resposta.status, corpo: await resposta.json(), leituras, entregas };
  } finally {
    globalThis.fetch = fetchAnterior;
    for (const [chave, valor] of anteriores) {
      if (valor === undefined) Deno.env.delete(chave);
      else Deno.env.set(chave, valor);
    }
    await servidor.shutdown();
  }
}

const aviso = {
  title: "Status do Pedido Atualizado",
  body: "Seu pedido #42 agora está: Saiu para entrega",
  url: "/pedido/42",
};

const semAlvo: Array<[string, Record<string, unknown>]> = [
  ["targetUserId ausente", {}],
  ["targetUserId null", { targetUserId: null }],
  ["targetUserId string vazia", { targetUserId: "" }],
];

for (const [rotulo, alvo] of semAlvo) {
  Deno.test(`handler: aviso de status de pedido com ${rotulo} é recusado sem ler inscrição nem enviar`, async () => {
    const r = await chamar({
      ...aviso,
      ...alvo,
      data: { orderId: "42", type: "order_status" },
    });
    assertEquals(r.status, 400);
    assertEquals(r.corpo.ok, false);
    assertStringIncludes(r.corpo.error, "destinat");
    assertEquals(r.leituras, [], "não pode nem consultar as inscrições");
    assertEquals(r.entregas, [], "não pode enviar nada a ninguém");
  });
}

Deno.test("handler: aviso de status de pedido COM targetUserId segue indo só para aquele cliente", async () => {
  const r = await chamar({
    ...aviso,
    targetUserId: "cliente-a",
    data: { orderId: "42", type: "order_status" },
  });
  assertEquals(r.status, 200);
  assertEquals(r.corpo.enviados, 1);
  assertEquals(r.leituras, ["eq.cliente-a"]);
  assertEquals(r.entregas, ["/p/a"]);
});

Deno.test("handler: campanha sem alvo e sem tipo de pedido segue indo para todos", async () => {
  for (const data of [undefined, null, { campanha: "natal" }, { type: "promo" }]) {
    const r = await chamar({ title: "Promoção", body: "Texto fictício", data });
    assertEquals(r.status, 200, `data=${JSON.stringify(data)}`);
    assertEquals(r.corpo.enviados, 2);
    assertEquals(r.leituras, [null]);
    assertEquals(r.entregas.sort(), ["/p/a", "/p/b"]);
  }
});

async function tokenAvulso(base: string) {
  const { endpoint, p256dh, auth } = await inscricaoDeTeste("avulso", "x", `${base}/p/avulso`);
  return [{ endpoint, keys: { p256dh, auth } }];
}

Deno.test("handler: campanha com tokens explícitos segue funcionando (sem consultar inscrições)", async () => {
  const r = await chamar({ title: "Promoção", body: "Texto fictício" }, tokenAvulso);
  assertEquals(r.status, 200);
  assertEquals(r.corpo.enviados, 1);
  assertEquals(r.leituras, []);
  assertEquals(r.entregas, ["/p/avulso"]);
});

Deno.test("handler: status de pedido com tokens explícitos e sem alvo vai só aos tokens (destinatário já escolhido)", async () => {
  const r = await chamar(
    { ...aviso, data: { orderId: "42", type: "order_status" } },
    tokenAvulso,
  );
  assertEquals(r.status, 200);
  assertEquals(r.corpo.enviados, 1);
  assertEquals(r.leituras, []);
  assertEquals(r.entregas, ["/p/avulso"]);
});
