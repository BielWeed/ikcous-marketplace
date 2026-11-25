// @ts-nocheck
/**
 * notify-new-order — os limites que o teste principal deixava passar
 * (caça por mutação "só testes", 25/11/2026).
 *
 * Nada aqui toca rede nem banco. Cada teste existe porque uma alteração
 * pequena no `index.ts` continuava com a suíte verde:
 *
 *  - a janela é de 15 minutos EM NÚMERO, não "a constante que o teste importa"
 *    (trocar 15 por 16 ou por 14 não quebrava nada, porque o teste medira a
 *    borda pela própria constante);
 *  - a tolerância de relógio adiantado é de 1 minuto, nem mais;
 *  - UUID de verdade, do começo ao fim e do tipo string (um array com um UUID
 *    dentro vira texto e passava);
 *  - pedido de R$ 0,00 (cupom de 100%) mostra R$ 0,00, não o `total_amount`;
 *  - a leitura do banco pede as colunas que o resto da função usa (sem
 *    `created_at` o pedido NUNCA entra na janela e o lojista nunca é avisado);
 *  - pré-voo CORS, corpo que não é JSON e erro com `code` E `name`.
 */
import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.177.0/testing/asserts.ts";
import {
  dentroDaJanela,
  handler,
  montarAviso,
  pareceUuid,
} from "./index.ts";

const UUID_VALIDO = "3f2a1b8c-4d5e-4f60-9a7b-1c2d3e4f5a6b";
const AGORA = Date.parse("2026-11-25T12:00:00.000Z");

const MIN = 60_000;
const SEG = 1_000;

// ---------------------------------------------------------------------------
// Janela: os números, não a constante
// ---------------------------------------------------------------------------

Deno.test("janela: vale até 15 minutos EXATOS e não 1 segundo além (número fixo, não a constante)", () => {
  const criadoHa = (ms: number) => new Date(AGORA - ms).toISOString();
  assert(dentroDaJanela(criadoHa(14 * MIN + 59 * SEG), AGORA), "14min59s ainda vale");
  assert(dentroDaJanela(criadoHa(15 * MIN), AGORA), "15min exatos ainda vale");
  assertEquals(
    dentroDaJanela(criadoHa(15 * MIN + 1 * SEG), AGORA),
    false,
    "15min01s já passou: id velho não avisa o lojista",
  );
});

Deno.test("janela: relógio adiantado só até 1 minuto — 1min01s no futuro é recusado", () => {
  const emFuturo = (ms: number) => new Date(AGORA + ms).toISOString();
  assert(dentroDaJanela(emFuturo(1 * MIN), AGORA), "1 min no futuro é desvio de relógio");
  assertEquals(
    dentroDaJanela(emFuturo(1 * MIN + 1 * SEG), AGORA),
    false,
    "1min01s no futuro já não é desvio de relógio",
  );
  assertEquals(dentroDaJanela(emFuturo(2 * MIN), AGORA), false, "2 min no futuro");
});

// ---------------------------------------------------------------------------
// UUID: começo, fim e tipo
// ---------------------------------------------------------------------------

Deno.test("UUID: lixo antes do id, array com um UUID e objeto que vira texto não passam", () => {
  assertEquals(pareceUuid(`x${UUID_VALIDO}`), false, "lixo ANTES do UUID");
  assertEquals(pareceUuid(`${UUID_VALIDO}x`), false, "lixo DEPOIS do UUID");
  assertEquals(pareceUuid([UUID_VALIDO]), false, "array com um UUID vira texto igual ao UUID");
  assertEquals(
    pareceUuid({ toString: () => UUID_VALIDO }),
    false,
    "objeto cujo texto é um UUID",
  );
});

// ---------------------------------------------------------------------------
// Dublê enxuto do banco: devolve SÓ as colunas pedidas no select()
// ---------------------------------------------------------------------------

function bancoQueProjeta(pedido: Record<string, unknown> | null) {
  const colunasPedidas: string[][] = [];
  const rpcs: string[] = [];
  const cliente = {
    from: (_tabela: string) => {
      let colunas: string[] = [];
      const b: any = {
        select: (lista: string) => {
          colunas = String(lista).split(",").map((c) => c.trim());
          colunasPedidas.push(colunas);
          return b;
        },
        eq: () => b,
        maybeSingle: () => {
          if (!pedido) return Promise.resolve({ data: null, error: null });
          const linha = Object.fromEntries(colunas.map((c) => [c, Reflect.get(pedido, c)]));
          return Promise.resolve({ data: linha, error: null });
        },
      };
      return b;
    },
    rpc: (nome: string) => {
      rpcs.push(nome);
      return Promise.resolve({
        data: nome === "reservar_aviso_ao_lojista" ? "reservado" : true,
        error: null,
      });
    },
  };
  return { cliente, colunasPedidas, rpcs };
}

function pedirAviso(corpo: BodyInit | null, metodo = "POST") {
  return new Request("http://local/notify-new-order", {
    method: metodo,
    headers: { "Content-Type": "application/json" },
    body: metodo === "POST" ? corpo : undefined,
  });
}

async function chamar(banco: ReturnType<typeof bancoQueProjeta>, req: Request) {
  const enviados: any[] = [];
  const resposta = await handler(req, {
    supabase: banco.cliente,
    enviarPushContado: (a: { aviso: any }) => {
      enviados.push(a.aviso);
      return Promise.resolve(1);
    },
    agora: () => AGORA,
  });
  return { resposta, enviados };
}

const pedidoCompleto = {
  id: UUID_VALIDO,
  customer_name: "Maria Silva",
  total: 99.9,
  total_amount: 1,
  created_at: new Date(AGORA - 2 * MIN).toISOString(),
  // coluna que a função NÃO pede e que o dublê, portanto, não devolve
  telefone: "5511999990000",
};

Deno.test("leitura do pedido: pede id, nome, total e data — sem elas o aviso sai errado ou não sai", async () => {
  const banco = bancoQueProjeta(pedidoCompleto);
  const { resposta, enviados } = await chamar(banco, pedirAviso(JSON.stringify({ orderId: UUID_VALIDO })));
  assertEquals(resposta.status, 200);
  assertEquals(enviados.length, 1, "sem created_at no select a janela recusaria e o lojista nunca saberia");
  assertEquals(enviados[0], {
    title: "Pedido novo",
    body: "#4F5A6B · R$ 99,90 · Maria Silva",
    url: `/admin-orders?id=${UUID_VALIDO}`,
  });
  for (const coluna of ["id", "customer_name", "total", "total_amount", "created_at"]) {
    assert(banco.colunasPedidas[0].includes(coluna), `o select tem de pedir ${coluna}`);
  }
});

Deno.test("leitura do pedido: total nulo cai para total_amount lido DO BANCO", async () => {
  const banco = bancoQueProjeta({ ...pedidoCompleto, total: null, total_amount: 42.5 });
  const { enviados } = await chamar(banco, pedirAviso(JSON.stringify({ orderId: UUID_VALIDO })));
  assertEquals(enviados.length, 1);
  assertEquals(enviados[0].body, "#4F5A6B · R$ 42,50 · Maria Silva");
});

// ---------------------------------------------------------------------------
// Dinheiro do aviso: R$ 0,00 é um valor, não "ausente"
// ---------------------------------------------------------------------------

Deno.test("pedido de R$ 0,00 (cupom de 100%) mostra R$ 0,00 e não o total_amount", () => {
  const aviso = montarAviso({
    id: UUID_VALIDO,
    customer_name: "Maria",
    total: 0,
    total_amount: 50,
    created_at: new Date(AGORA).toISOString(),
  });
  assertEquals(aviso.body, "#4F5A6B · R$ 0,00 · Maria");
});

// ---------------------------------------------------------------------------
// Handler: pré-voo, corpo ruim e orderId que não é texto
// ---------------------------------------------------------------------------

Deno.test("pré-voo CORS (OPTIONS) responde ok sem ler corpo, sem tocar o banco e sem push", async () => {
  const banco = bancoQueProjeta(pedidoCompleto);
  const { resposta, enviados } = await chamar(banco, pedirAviso(null, "OPTIONS"));
  assertEquals(resposta.status, 200);
  assertEquals(await resposta.text(), "ok");
  assert(resposta.headers.get("Access-Control-Allow-Origin"), "o navegador precisa do cabeçalho CORS");
  assertEquals(banco.colunasPedidas.length, 0);
  assertEquals(banco.rpcs.length, 0);
  assertEquals(enviados.length, 0);
});

Deno.test("corpo que não é JSON -> 400 do formato do id, e não a falha genérica", async () => {
  for (const corpo of ["isto nao e json", "", "{orderId:"]) {
    const banco = bancoQueProjeta(pedidoCompleto);
    const { resposta, enviados } = await chamar(banco, pedirAviso(corpo));
    assertEquals(resposta.status, 400, `corpo ${JSON.stringify(corpo)}`);
    assertEquals(await resposta.json(), {
      ok: false,
      erro: "orderId ausente ou fora do formato UUID",
    });
    assertEquals(banco.colunasPedidas.length, 0);
    assertEquals(enviados.length, 0);
  }
});

Deno.test("orderId em array com um UUID -> 400 sem ler o pedido e sem push", async () => {
  const banco = bancoQueProjeta(pedidoCompleto);
  const { resposta, enviados } = await chamar(banco, pedirAviso(JSON.stringify({ orderId: [UUID_VALIDO] })));
  assertEquals(resposta.status, 400);
  assertEquals(banco.colunasPedidas.length, 0);
  assertEquals(banco.rpcs.length, 0);
  assertEquals(enviados.length, 0);
});

Deno.test("erro com code E name (como o do PostgREST): o log leva o code, que é o que ajuda a achar a causa", async () => {
  const banco = bancoQueProjeta(pedidoCompleto);
  banco.cliente.from = () => {
    const erro: any = new Error("detalhe interno que não pode vazar");
    erro.name = "PostgrestError";
    erro.code = "42P01";
    throw erro;
  };
  const logs: string[] = [];
  const original = console.error;
  console.error = (...a: unknown[]) => {
    logs.push(a.map((x) => String(x)).join(" "));
  };
  let resposta: Response;
  try {
    ({ resposta } = await chamar(banco, pedirAviso(JSON.stringify({ orderId: UUID_VALIDO }))));
  } finally {
    console.error = original;
  }
  assertEquals(resposta.status, 400);
  assertEquals(logs.length, 1);
  assert(logs[0].includes("42P01"), `o log deve ter o code: ${logs[0]}`);
  assertEquals(logs[0].includes("PostgrestError"), false, "o code vem antes do name");
  assertEquals(logs[0].includes("detalhe interno"), false);
});
