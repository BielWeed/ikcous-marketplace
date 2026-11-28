/**
 * send-order-confirmation — a porta da VISITANTE (lote 579, 28/11/2026).
 *
 * Quem compra sem conta não tem sessão: a porta de sempre (sessão do dono ou
 * do admin) devolve 401 para ela. A tela "Pedido recebido!" da visitante grava
 * o e-mail pela RPC `informar_email_da_visitante` e chama esta edge com
 * `comoVisitante: true` e o id COMPLETO do pedido — que só existe no navegador
 * de quem comprou. A porta da visitante:
 *
 *  - NÃO consulta o Auth (a visitante não tem sessão a validar);
 *  - só serve pedido de visitante: sem conta (user_id nulo), da loja online
 *    (o balcão também nasce sem conta) e não pago pelo app. Ausente e alheio
 *    têm a MESMA resposta (403), que não revela se o UUID existe;
 *  - reserva pela `reivindicar_comprovante_da_visitante`, que respeita o teto
 *    diário de e-mails MESMO com o pedido pago (a de sempre deixa o pago
 *    passar). O destinatário continua sendo lido do banco, no miolo;
 *  - só `comoVisitante === true` abre esta porta: qualquer outro valor segue a
 *    porta de sempre, sem mudar nada para quem tem conta, o admin e o balcão.
 *
 * Dublês locais, sem SMTP nem banco; ids inventados.
 */
import { assertEquals } from "https://deno.land/std@0.177.0/testing/asserts.ts";
import { handler } from "./index.ts";

const PEDIDO = "5a1f0c2b-9e11-4c4e-8f3a-0b7c1c399d8e";
const DONO = "c1111111-1111-4111-8111-111111111111";
const DA_VISITANTE = { user_id: null, canal: "online", payment_method: "cash" };

function requisicao(
  corpo: unknown,
  authorization: string | null = "Bearer chave-publica-de-teste",
) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (authorization !== null) headers.Authorization = authorization;
  return new Request("http://local/send-order-confirmation", {
    method: "POST",
    headers,
    body: JSON.stringify(corpo),
  });
}

function cenario(opts: {
  pedido?: unknown;
  erroDoPedido?: unknown;
  desfecho?: unknown;
} = {}) {
  const chamadas = {
    getUser: [] as unknown[],
    leituras: [] as Array<{ colunas: string; filtros: unknown[][] }>,
    enviados: [] as Array<Record<string, unknown>>,
  };
  const supabase = {
    auth: {
      getUser: (token: unknown) => {
        chamadas.getUser.push(token);
        return Promise.resolve({ data: { user: { id: DONO } }, error: null });
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
            data: "pedido" in opts ? opts.pedido : DA_VISITANTE,
            error: opts.erroDoPedido ?? null,
          }),
      };
      return c;
    },
  };
  return {
    chamadas,
    supabase,
    deps: {
      supabase,
      adminAtual: () => Promise.resolve(null),
      enviarComprovante: (args: Record<string, unknown>) => {
        chamadas.enviados.push(args);
        return Promise.resolve(opts.desfecho ?? { ok: true });
      },
    } as never,
  };
}

Deno.test("visitante: pedido sem conta da loja online — envia pela reserva da visitante, sem consultar o Auth", async () => {
  const c = cenario();
  const r = await handler(
    requisicao({ orderId: PEDIDO, comoVisitante: true }),
    c.deps,
  );
  assertEquals(r.status, 200);
  assertEquals(await r.json(), { ok: true });
  assertEquals(c.chamadas.getUser, [], "a visitante não tem sessão a validar");
  assertEquals(c.chamadas.leituras.length, 1);
  assertEquals(c.chamadas.leituras[0].colunas, "user_id, canal, payment_method");
  assertEquals(c.chamadas.leituras[0].filtros, [["id", PEDIDO]]);
  assertEquals(c.chamadas.enviados.length, 1);
  assertEquals(c.chamadas.enviados[0].orderId, PEDIDO);
  assertEquals(c.chamadas.enviados[0].supabase, c.supabase);
  assertEquals(
    c.chamadas.enviados[0].reivindicacao,
    "reivindicar_comprovante_da_visitante",
  );
});

Deno.test("visitante: sem cabeçalho de sessão também serve (o gateway já confere a chave pública)", async () => {
  const c = cenario();
  const r = await handler(
    requisicao({ orderId: PEDIDO, comoVisitante: true }, null),
    c.deps,
  );
  assertEquals(r.status, 200);
  assertEquals(c.chamadas.enviados.length, 1);
});

Deno.test("visitante: o teto barrou — 200 com motivo teto_diario (a tela diz que NÃO enviou)", async () => {
  const c = cenario({ desfecho: { ok: false, motivo: "teto_diario" } });
  const r = await handler(
    requisicao({ orderId: PEDIDO, comoVisitante: true }),
    c.deps,
  );
  assertEquals(r.status, 200);
  assertEquals(await r.json(), { ok: false, motivo: "teto_diario" });
});

Deno.test("visitante: pedido de CONTA, do BALCÃO, pago pelo APP ou que não existe — 403 igual para todos, nada é enviado", async () => {
  for (const pedido of [
    { user_id: DONO, canal: "online", payment_method: "cash" },
    { user_id: null, canal: "presencial", payment_method: "cash" },
    { user_id: null, canal: "online", payment_method: "online" },
    { user_id: null, canal: null, payment_method: "cash" },
    null,
  ]) {
    const c = cenario({ pedido });
    const r = await handler(
      requisicao({ orderId: PEDIDO, comoVisitante: true }),
      c.deps,
    );
    assertEquals(r.status, 403, JSON.stringify(pedido));
    assertEquals(await r.json(), { ok: false, motivo: "nao_autorizado" });
    assertEquals(c.chamadas.enviados.length, 0, JSON.stringify(pedido));
    assertEquals(c.chamadas.getUser, []);
  }
});

Deno.test("visitante: erro ao ler o pedido — 502 envio_falhou (não 403, que diria que o pedido não é dela)", async () => {
  const c = cenario({ erroDoPedido: { message: "conexao" } });
  const r = await handler(
    requisicao({ orderId: PEDIDO, comoVisitante: true }),
    c.deps,
  );
  assertEquals(r.status, 502);
  assertEquals((await r.json()).motivo, "envio_falhou");
  assertEquals(c.chamadas.enviados.length, 0);
});

Deno.test("visitante: o orderId continua tendo de ser um UUID inteiro", async () => {
  const c = cenario();
  const r = await handler(
    requisicao({ orderId: "5a1f0c", comoVisitante: true }),
    c.deps,
  );
  assertEquals(r.status, 400);
  assertEquals(c.chamadas.leituras.length, 0);
  assertEquals(c.chamadas.enviados.length, 0);
});

Deno.test("só comoVisitante === true abre a porta: 'true', 1 e ausente seguem a porta de sempre (sessão), sem a reserva da visitante", async () => {
  for (const marca of ["true", 1, undefined, false]) {
    // Sem sessão: a porta de sempre recusa antes de ler o pedido.
    const semSessao = cenario();
    const r1 = await handler(
      requisicao({ orderId: PEDIDO, comoVisitante: marca }, null),
      semSessao.deps,
    );
    assertEquals(r1.status, 401, String(marca));
    assertEquals(semSessao.chamadas.enviados.length, 0);
    // Com a sessão do dono: envia pela reserva de SEMPRE (sem `reivindicacao`).
    const dono = cenario({ pedido: { user_id: DONO } });
    const r2 = await handler(
      requisicao({ orderId: PEDIDO, comoVisitante: marca }, "Bearer jwt-do-dono"),
      dono.deps,
    );
    assertEquals(r2.status, 200, String(marca));
    assertEquals(dono.chamadas.getUser, ["jwt-do-dono"]);
    assertEquals(dono.chamadas.enviados.length, 1);
    assertEquals(
      Object.keys(dono.chamadas.enviados[0]).sort(),
      ["orderId", "supabase"],
      "a porta de sempre não muda o contrato do miolo",
    );
  }
});
