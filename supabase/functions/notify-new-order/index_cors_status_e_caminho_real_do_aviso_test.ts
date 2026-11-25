// @ts-nocheck
/**
 * notify-new-order — o que a caça por mutação de 25/11/2026 achou depois dos
 * testes `index_limites_da_janela_uuid_e_colunas_test.ts`:
 *
 *  1. Pedido fora da janela responde 200 `{ ok:false, ignorado }`, não 400:
 *     para o front é "não há o que avisar", e 4xx entra no tratamento de erro
 *     dele. Só o status de "pedido não encontrado" estava preso.
 *  2. TODA resposta JSON (200, 400 de formato, 400 do `catch`) carrega CORS: o
 *     checkout é de outro domínio e sem o cabeçalho o navegador esconde a
 *     resposta. Só o pré-voo era conferido.
 *  3. O caminho REAL do aviso (sem `deps.enviarPushContado`) nunca rodava nos
 *     testes: trocar `{ ...a, rotulo }` por `{ rotulo }` (o push perde o
 *     `supabase` e NUNCA mais sai em produção) e apagar o `rotulo` repassado a
 *     `avisarAdminUmaVez` (os logs perdem o nome da função) passavam. Aqui o
 *     caminho real roda com um banco sem nenhum admin: nada é enviado, e os
 *     logs/RPCs provam que o `supabase`, a chave `pedido_novo:<id>` e o rótulo
 *     chegaram até o fim.
 *  4. O banco dos outros testes devolve a MESMA linha para qualquer pergunta,
 *     então apagar `.eq("id", orderId)`, trocar a coluna ou a tabela passava
 *     (em produção: o aviso sairia com o pedido de OUTRA cliente). O dublê
 *     `bancoQueAplicaOsFiltros` só devolve a linha se tabela e filtro baterem.
 *
 * MUTANTES EQUIVALENTES (anotados, não viram teste):
 *  - `Number.isNaN(t)` em `dentroDaJanela`: sem a guarda, `NaN` cai nas
 *    comparações `<=`/`>=`, que são falsas — o resultado é o mesmo `false`.
 *  - `montarAviso({ ...pedido, id: orderId })`: o banco filtra por `orderId`,
 *    então `pedido.id === orderId` sempre.
 */
import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.177.0/testing/asserts.ts";
import { handler } from "./index.ts";

const ID = "3f2a1b8c-4d5e-4f60-9a7b-1c2d3e4f5a6b";
const AGORA = Date.parse("2026-11-25T12:00:00.000Z");
const MIN = 60_000;
const CABECALHOS_DO_NAVEGADOR = ["authorization", "x-client-info", "apikey", "content-type"];

function exigirCorsCompleto(r: Response, rotulo: string) {
  assertEquals(r.headers.get("Access-Control-Allow-Origin"), "*", rotulo);
  const permitidos = (r.headers.get("Access-Control-Allow-Headers") ?? "")
    .split(",")
    .map((c) => c.trim().toLowerCase());
  for (const cabecalho of CABECALHOS_DO_NAVEGADOR) {
    assert(permitidos.includes(cabecalho), `${rotulo}: falta ${cabecalho}`);
  }
  assertEquals(r.headers.get("Content-Type"), "application/json", rotulo);
}

function pedirAviso(corpo: unknown) {
  return new Request("http://local/notify-new-order", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(corpo),
  });
}

function pedidoCriadoHa(minutos: number) {
  return {
    id: ID,
    customer_name: "Maria Silva",
    total: 99.9,
    total_amount: 99.9,
    created_at: new Date(AGORA - minutos * MIN).toISOString(),
  };
}

/** Banco sem NENHUM admin: o push real não tem para quem mandar e devolve 0. */
function bancoSemAdmin(opcoes: { pedido: unknown; erroDaReserva?: boolean }) {
  const rpcs: Array<{ nome: string; args: unknown }> = [];
  const tabelas: string[] = [];
  const cliente = {
    from: (tabela: string) => {
      tabelas.push(tabela);
      const resultado = tabela === "marketplace_orders"
        ? { data: opcoes.pedido, error: null }
        : { data: [], error: null };
      const b: any = {
        select: () => b,
        eq: () => b,
        in: () => b,
        maybeSingle: () => Promise.resolve(resultado),
        then: (resolve: (v: unknown) => unknown) => Promise.resolve(resultado).then(resolve),
      };
      return b;
    },
    rpc: (nome: string, args: unknown) => {
      rpcs.push({ nome, args });
      if (nome === "reservar_aviso_ao_lojista" && opcoes.erroDaReserva) {
        return Promise.resolve({ data: null, error: new Error("banco fora do ar") });
      }
      return Promise.resolve({ data: nome === "reservar_aviso_ao_lojista" ? "reservado" : true, error: null });
    },
  };
  return { cliente, rpcs, tabelas };
}

async function comLogs(corpo: () => Promise<unknown>) {
  const saiu: string[] = [];
  const originais = { error: console.error, warn: console.warn, log: console.log };
  const anota = (...args: unknown[]) => saiu.push(args.map((a) => String(a)).join(" "));
  console.error = anota;
  console.warn = anota;
  console.log = anota;
  try {
    await corpo();
  } finally {
    console.error = originais.error;
    console.warn = originais.warn;
    console.log = originais.log;
  }
  return saiu;
}

Deno.test("pedido fora da janela: 200 com ignorado (não 4xx), sem reserva e sem push", async () => {
  const banco = bancoSemAdmin({ pedido: pedidoCriadoHa(16) });
  let resposta!: Response;
  const logs = await comLogs(async () => {
    resposta = await handler(pedirAviso({ orderId: ID }), { supabase: banco.cliente, agora: () => AGORA });
  });
  assertEquals(resposta.status, 200);
  assertEquals(await resposta.json(), { ok: false, ignorado: "pedido fora da janela" });
  assertEquals(banco.rpcs, []);
  assert(logs.some((l) => l.includes("notify-new-order: #4F5A6B fora da janela de 15 min")), logs.join("\n"));
});

Deno.test("pedido que não existe: 200 com ignorado, sem reserva", async () => {
  const banco = bancoSemAdmin({ pedido: null });
  const resposta = await handler(pedirAviso({ orderId: ID }), { supabase: banco.cliente, agora: () => AGORA });
  assertEquals(resposta.status, 200);
  assertEquals(await resposta.json(), { ok: false, ignorado: "pedido não encontrado" });
  assertEquals(banco.rpcs, []);
});

Deno.test("CORS e JSON em toda resposta: 200 ok, 200 ignorado, 400 de formato e 400 de falha", async () => {
  const dentro = bancoSemAdmin({ pedido: pedidoCriadoHa(2) });
  await comLogs(async () => {
    exigirCorsCompleto(
      await handler(pedirAviso({ orderId: ID }), { supabase: dentro.cliente, agora: () => AGORA, enviarPushContado: () => Promise.resolve(1) }),
      "200 ok",
    );
    exigirCorsCompleto(
      await handler(pedirAviso({ orderId: ID }), { supabase: bancoSemAdmin({ pedido: pedidoCriadoHa(60) }).cliente, agora: () => AGORA }),
      "200 ignorado",
    );
    const formato = await handler(pedirAviso({ orderId: "nao-e-uuid" }), { supabase: dentro.cliente });
    assertEquals(formato.status, 400);
    exigirCorsCompleto(formato, "400 de formato");
    const quebrado = { from: () => { throw new Error("banco caiu"); } };
    const falha = await handler(pedirAviso({ orderId: ID }), { supabase: quebrado });
    assertEquals(falha.status, 400);
    assertEquals(await falha.clone().json(), { ok: false, erro: "Falha ao processar o aviso." });
    exigirCorsCompleto(falha, "400 de falha");
  });
});

Deno.test("caminho REAL do aviso (sem dublê de push): o banco, a chave pedido_novo:<id> e o rótulo chegam até o fim", async () => {
  const banco = bancoSemAdmin({ pedido: pedidoCriadoHa(2) });
  let resposta!: Response;
  const logs = await comLogs(async () => {
    resposta = await handler(pedirAviso({ orderId: ID }), { supabase: banco.cliente, agora: () => AGORA });
  });
  assertEquals(resposta.status, 200);
  assertEquals(await resposta.json(), { ok: true });
  // O push real leu os admins NO banco que o handler recebeu (se `supabase` se perdesse, cairia no `catch` do push).
  assert(banco.tabelas.includes("profiles"), `o push real não consultou os admins: ${banco.tabelas}`);
  assert(logs.some((l) => l.startsWith("notify-new-order: nenhum admin cadastrado")), logs.join("\n"));
  assertEquals(logs.some((l) => l.includes("falha ao disparar push")), false, logs.join("\n"));
  // Ninguém recebeu: a reserva é LIBERADA (a próxima chamada tenta de novo), sempre com a chave do pedido.
  assertEquals(banco.rpcs, [
    { nome: "reservar_aviso_ao_lojista", args: { p_chave: `pedido_novo:${ID}` } },
    { nome: "liberar_aviso_ao_lojista", args: { p_chave: `pedido_novo:${ID}` } },
  ]);
});

Deno.test("reserva fora do ar: o aviso sai mesmo assim (falha aberta) e o log leva o nome da função", async () => {
  const banco = bancoSemAdmin({ pedido: pedidoCriadoHa(2), erroDaReserva: true });
  let resposta!: Response;
  const logs = await comLogs(async () => {
    resposta = await handler(pedirAviso({ orderId: ID }), { supabase: banco.cliente, agora: () => AGORA });
  });
  assertEquals(resposta.status, 200);
  assertEquals(await resposta.json(), { ok: true });
  assert(
    logs.some((l) => l.startsWith("notify-new-order: reservar_aviso_ao_lojista falhou")),
    `o log precisa começar com o rótulo da função: ${logs.join("\n")}`,
  );
  assert(banco.tabelas.includes("profiles"), "mesmo sem a reserva o push é tentado");
  // Sem reserva ('reservado' nunca veio), não há o que confirmar nem liberar.
  assertEquals(banco.rpcs.map((r) => r.nome), ["reservar_aviso_ao_lojista"]);
});

// ── Dublê que APLICA o filtro: o pedido certo, e só ele ─────────────────────

function bancoQueAplicaOsFiltros(linhas: Array<Record<string, unknown>>) {
  const filtrosUsados: Array<[string, unknown]> = [];
  const cliente = {
    from: (tabela: string) => {
      let sobra = tabela === "marketplace_orders" ? [...linhas] : [];
      const b: any = {
        select: () => b,
        eq: (coluna: string, valor: unknown) => {
          filtrosUsados.push([coluna, valor]);
          sobra = sobra.filter((l) => Reflect.get(l, coluna) === valor);
          return b;
        },
        maybeSingle: () => {
          if (sobra.length > 1) return Promise.resolve({ data: null, error: { code: "PGRST116", message: "mais de uma linha" } });
          return Promise.resolve({ data: sobra[0] ?? null, error: null });
        },
      };
      return b;
    },
    rpc: (nome: string) => Promise.resolve({ data: nome === "reservar_aviso_ao_lojista" ? "reservado" : true, error: null }),
  };
  return { cliente, filtrosUsados };
}

Deno.test("o pedido avisado é o do orderId pedido (id = orderId), nunca outro pedido recente da loja", async () => {
  const OUTRO = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
  const banco = bancoQueAplicaOsFiltros([
    { ...pedidoCriadoHa(1), id: OUTRO, customer_name: "Outra Pessoa", total: 10 },
    { ...pedidoCriadoHa(2), id: ID, customer_name: "Maria Silva", total: 99.9 },
  ]);
  const avisos: any[] = [];
  const resposta = await handler(pedirAviso({ orderId: ID }), {
    supabase: banco.cliente,
    agora: () => AGORA,
    enviarPushContado: ({ aviso }: { aviso: unknown }) => {
      avisos.push(aviso);
      return Promise.resolve(1);
    },
  });
  assertEquals(resposta.status, 200);
  assertEquals(banco.filtrosUsados, [["id", ID]]);
  assertEquals(avisos.length, 1);
  assertEquals(avisos[0].body, "#4F5A6B · R$ 99,90 · Maria Silva");
  assertEquals(avisos[0].url, `/admin-orders?id=${ID}`);
});

Deno.test("orderId que não bate com nenhum pedido: ignorado, sem reserva e sem push (mesmo havendo pedidos recentes de outros clientes)", async () => {
  const banco = bancoQueAplicaOsFiltros([{ ...pedidoCriadoHa(1), id: "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d" }]);
  let envios = 0;
  const resposta = await handler(pedirAviso({ orderId: ID }), {
    supabase: banco.cliente,
    agora: () => AGORA,
    enviarPushContado: () => {
      envios++;
      return Promise.resolve(1);
    },
  });
  assertEquals(resposta.status, 200);
  assertEquals(await resposta.json(), { ok: false, ignorado: "pedido não encontrado" });
  assertEquals(envios, 0);
});
