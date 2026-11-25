/**
 * send-order-confirmation — as bordas da porta que decide QUEM recebe o
 * comprovante (caça por mutação "só testes", 25/11/2026).
 *
 * Cada teste existe porque uma alteração pequena no `index.ts` mantinha as
 * duas suítes vizinhas verdes:
 *
 *  - sem cabeçalho de sessão, ou com cabeçalho que só PARECE Bearer: 401 e o
 *    Auth nem é consultado;
 *  - Auth sem erro e sem usuário: 401 sem ler o pedido;
 *  - erro ao ler o pedido: 502 `envio_falhou` (e não 403, que diria ao dono
 *    que o pedido não é dele);
 *  - o admin que o resolvedor devolve tem de SER quem chamou;
 *  - o comprovante é pedido para o pedido certo, com o client certo;
 *  - o `orderId`: UUID inteiro, só texto;
 *  - recusas levam CORS e JSON; pré-voo OPTIONS; corpo que não é JSON.
 *
 * Dublês locais, sem SMTP nem banco; ids inventados.
 */
import { assert, assertEquals } from "https://deno.land/std@0.177.0/testing/asserts.ts";
import { handler, montarResposta, pareceUuid } from "./index.ts";

const PEDIDO = "d77c6616-c389-4caa-b5c1-9a8d7af77f72";
const DONO = "c1111111-1111-4111-8111-111111111111";
const OUTRO = "c2222222-2222-4222-8222-222222222222";

function requisicao(
  corpo: BodyInit | null = JSON.stringify({ orderId: PEDIDO }),
  authorization: string | null = "Bearer jwt-de-teste",
  metodo = "POST",
) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (authorization !== null) headers.Authorization = authorization;
  return new Request("http://local/send-order-confirmation", {
    method: metodo,
    headers,
    body: metodo === "POST" ? corpo : undefined,
  });
}

function cenario(opts: {
  usuario?: unknown;
  erroDoAuth?: unknown;
  pedido?: unknown;
  erroDoPedido?: unknown;
  admin?: string | null;
} = {}) {
  const chamadas = {
    getUser: [] as unknown[],
    leituras: [] as Array<{ colunas: string; filtros: unknown[][] }>,
    enviados: [] as unknown[],
    admins: [] as unknown[],
  };
  const supabase = {
    auth: {
      getUser: (token: unknown) => {
        chamadas.getUser.push(token);
        return Promise.resolve({
          data: { user: "usuario" in opts ? opts.usuario : { id: DONO } },
          error: opts.erroDoAuth ?? null,
        });
      },
    },
    from() {
      const leitura = { colunas: "", filtros: [] as unknown[][] };
      chamadas.leituras.push(leitura);
      const c = {
        select: (colunas: string) => {
          leitura.colunas = colunas;
          return c;
        },
        eq: (...args: unknown[]) => {
          leitura.filtros.push(args);
          return c;
        },
        maybeSingle: () =>
          Promise.resolve({
            data: "pedido" in opts ? opts.pedido : { user_id: DONO },
            error: opts.erroDoPedido ?? null,
          }),
      };
      return c;
    },
  };
  return {
    chamadas,
    deps: {
      supabase,
      adminAtual: (cabecalho: unknown) => {
        chamadas.admins.push(cabecalho);
        return Promise.resolve("admin" in opts ? opts.admin : null);
      },
      enviarComprovante: (args: unknown) => {
        chamadas.enviados.push(args);
        return Promise.resolve({ ok: true });
      },
    } as never,
  };
}

// ── Cabeçalho de sessão ───────────────────────────────────────────────────

Deno.test("sem cabeçalho Authorization: 401, o Auth nem é consultado e nada é lido ou enviado", async () => {
  const c = cenario();
  const r = await handler(requisicao(undefined, null), c.deps);
  assertEquals(r.status, 401);
  assertEquals((await r.json()).motivo, "nao_autorizado");
  assertEquals(c.chamadas.getUser, []);
  assertEquals(c.chamadas.leituras.length, 0);
  assertEquals(c.chamadas.enviados.length, 0);
});

Deno.test("cabeçalho que só PARECE Bearer (outro esquema, 'Bearer' colado ao token, vazio): 401 sem consultar o Auth", async () => {
  for (const cabecalho of ["Basic abc123", "Token Bearer abc123", "Bearerabc123", "Bearer", "Bearer   ", "abc123"]) {
    const c = cenario();
    const r = await handler(requisicao(undefined, cabecalho), c.deps);
    assertEquals(r.status, 401, `cabeçalho ${JSON.stringify(cabecalho)}`);
    assertEquals(c.chamadas.getUser, [], `cabeçalho ${JSON.stringify(cabecalho)}`);
    assertEquals(c.chamadas.enviados.length, 0);
  }
});

Deno.test("'bearer' em minúscula é aceito, e o Auth recebe o TOKEN (sem a palavra Bearer)", async () => {
  const c = cenario();
  const r = await handler(requisicao(undefined, "bearer meu.jwt.de-teste"), c.deps);
  assertEquals(r.status, 200);
  assertEquals(c.chamadas.getUser, ["meu.jwt.de-teste"]);
});

Deno.test("Auth sem erro mas SEM usuário: 401, o pedido não é lido e nada é enviado", async () => {
  for (const usuario of [null, undefined, {}, { id: "" }]) {
    const c = cenario({ usuario });
    const r = await handler(requisicao(), c.deps);
    assertEquals(r.status, 401, JSON.stringify(usuario));
    assertEquals(c.chamadas.leituras.length, 0, "nem leu o pedido");
    assertEquals(c.chamadas.enviados.length, 0);
  }
});

// ── Leitura do pedido e dono/admin ────────────────────────────────────────

Deno.test("erro ao ler o pedido: 502 envio_falhou (falha da loja), nunca 403 'não é seu' e nada é enviado", async () => {
  const c = cenario({ pedido: null, erroDoPedido: { message: "timeout" } });
  const r = await handler(requisicao(), c.deps);
  assertEquals(r.status, 502);
  assertEquals((await r.json()).motivo, "envio_falhou");
  assertEquals(c.chamadas.enviados.length, 0);
});

Deno.test("o pedido é lido pelo id certo e só com a coluna do dono", async () => {
  const c = cenario();
  await handler(requisicao(), c.deps);
  assertEquals(c.chamadas.leituras.length, 1);
  assertEquals(c.chamadas.leituras[0].colunas, "user_id");
  assertEquals(c.chamadas.leituras[0].filtros, [["id", PEDIDO]]);
});

Deno.test("pedido alheio: o admin que o resolvedor devolve tem de SER quem chamou — outro admin não vale", async () => {
  const outroAdmin = cenario({ pedido: { user_id: OUTRO }, admin: "admin-que-nao-e-o-chamador" });
  const r1 = await handler(requisicao(), outroAdmin.deps);
  assertEquals(r1.status, 403);
  assertEquals(outroAdmin.chamadas.enviados.length, 0);

  const proprioAdmin = cenario({ pedido: { user_id: OUTRO }, admin: DONO });
  const r2 = await handler(requisicao(), proprioAdmin.deps);
  assertEquals(r2.status, 200);
  assertEquals(proprioAdmin.chamadas.enviados.length, 1);
  // o resolvedor recebe o cabeçalho INTEIRO, não o token nem nulo
  assertEquals(proprioAdmin.chamadas.admins, ["Bearer jwt-de-teste"]);
});

Deno.test("o dono do pedido não passa pela conferência de admin", async () => {
  const c = cenario({ pedido: { user_id: DONO }, admin: null });
  const r = await handler(requisicao(), c.deps);
  assertEquals(r.status, 200);
  assertEquals(c.chamadas.admins, []);
});

Deno.test("o comprovante é pedido para o pedido da requisição, com o client da função", async () => {
  const c = cenario();
  await handler(requisicao(), c.deps);
  assertEquals(c.chamadas.enviados.length, 1);
  const args = c.chamadas.enviados[0] as { supabase: unknown; orderId: string };
  assertEquals(args.orderId, PEDIDO);
  assertEquals(args.supabase, (c.deps as { supabase: unknown }).supabase);
});

// ── Forma do orderId ──────────────────────────────────────────────────────

Deno.test("orderId: UUID inteiro e texto — lixo antes ou depois, array e objeto que vira texto são recusados com 400 sem tocar o Auth", async () => {
  assert(pareceUuid(PEDIDO.toUpperCase()), "maiúscula é UUID");
  for (const ruim of [`x${PEDIDO}`, `${PEDIDO}x`, [PEDIDO], { toString: () => PEDIDO }, 7, null]) {
    assertEquals(pareceUuid(ruim), false, JSON.stringify(ruim));
    const c = cenario();
    const r = await handler(requisicao(JSON.stringify({ orderId: ruim })), c.deps);
    assertEquals(r.status, 400, JSON.stringify(ruim));
    assertEquals(c.chamadas.getUser, []);
  }
});

// ── Resposta: CORS, JSON, pré-voo e corpo ruim ────────────────────────────

Deno.test("recusa de sessão leva CORS e JSON (a tela é de outro domínio)", async () => {
  const c = cenario();
  const r = await handler(requisicao(undefined, null), c.deps);
  assertEquals(r.headers.get("Content-Type"), "application/json");
  assertEquals(r.headers.get("Access-Control-Allow-Origin"), "*");
  assert(r.headers.get("Access-Control-Allow-Headers")?.includes("authorization"));
});

Deno.test("toda resposta de desfecho leva JSON e CORS", () => {
  for (const desfecho of [{ ok: true }, { ok: false, motivo: "envio_falhou" }, { ok: false, motivo: "pedido_invalido" }]) {
    const r = montarResposta(desfecho);
    assertEquals(r.headers.get("Content-Type"), "application/json");
    assertEquals(r.headers.get("Access-Control-Allow-Origin"), "*");
  }
});

Deno.test("pré-voo OPTIONS: ok com CORS, sem Auth, sem leitura e sem comprovante", async () => {
  const c = cenario();
  const r = await handler(requisicao(null, null, "OPTIONS"), c.deps);
  assertEquals(r.status, 200);
  assertEquals(await r.text(), "ok");
  assertEquals(r.headers.get("Access-Control-Allow-Origin"), "*");
  assertEquals(c.chamadas.getUser, []);
  assertEquals(c.chamadas.leituras.length, 0);
  assertEquals(c.chamadas.enviados.length, 0);
});

Deno.test("corpo que não é JSON: 400 pedido_invalido (e não uma queda), nada consultado", async () => {
  for (const corpo of ["isto nao e json", "", "{orderId:"]) {
    const c = cenario();
    const r = await handler(requisicao(corpo), c.deps);
    assertEquals(r.status, 400, JSON.stringify(corpo));
    assertEquals((await r.json()).motivo, "pedido_invalido");
    assertEquals(c.chamadas.getUser, []);
  }
});
