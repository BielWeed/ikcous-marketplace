// @ts-nocheck
/**
 * Testes da send-order-whatsapp: o número do pedido na mensagem que o cliente
 * recebe no WhatsApp é o MESMO que ele vê no app ("#3884BE": 6 últimos
 * caracteres do id, em maiúsculas). Antes saía "#3884be" — o cliente via duas
 * grafias do mesmo pedido.
 *
 * Nada aqui toca rede nem banco: só a montagem do texto.
 */
import {
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.177.0/testing/asserts.ts";
import { montarMensagem, processar } from "./index.ts";

const ID_DO_PEDIDO = "c35ce4dd-7a1b-4c2d-9e8f-0a1b2c3884be";

Deno.test("o número do pedido na mensagem sai em maiúsculas, como no app", () => {
  const texto = montarMensagem({
    orderId: ID_DO_PEDIDO,
    customerName: "Maria",
    itemsList: "- Sanduíche (2x)",
    totalPrice: 24.9,
    paymentMethod: "pix",
  });

  assertStringIncludes(texto, "*#3884BE*");
  assertEquals(texto.includes("#3884be"), false);
});

Deno.test("o resto da mensagem continua igual (nome, resumo, total, pagamento)", () => {
  const texto = montarMensagem({
    orderId: ID_DO_PEDIDO,
    customerName: "Maria",
    itemsList: "- Sanduíche (2x)",
    totalPrice: 24.9,
    paymentMethod: "card",
  });

  assertStringIncludes(texto, "Olá *Maria*");
  assertStringIncludes(texto, "- Sanduíche (2x)");
  assertStringIncludes(texto, "*Total:* R$ 24,90");
  assertStringIncludes(texto, "*Pagamento:* Cartão");
});

// ---------------------------------------------------------------------------
// Autorização do chamador e pedido canônico (04/10/2026)
//
// A função manda mensagem ao CLIENTE por um gateway de WhatsApp. O `verify_jwt`
// padrão deixa passar até a chave pública (anon), então a porta tem de ser o
// handler: só o chamador de SERVIDOR (o gatilho do banco que a chamava, com a
// chave de serviço no Authorization) é aceito, e o destinatário, o nome e o
// valor saem do BANCO pelo id — nunca do corpo. Nada aqui toca rede: a
// Evolution e o banco são dublês, e o dublê da Evolution registra rota, método
// e headers de cada chamada.
// ---------------------------------------------------------------------------

const CHAVE_DE_SERVICO = "chave-de-servico-so-do-servidor";
const CHAVE_PUBLICA = "chave-publica-anon-que-todo-mundo-tem";
const JWT_DO_COMPRADOR = "jwt-de-comprador-logado";
const URL_DA_EVOLUTION = "https://evolution.exemplo.test";
const INSTANCIA = "loja-1";
const CHAVE_DA_EVOLUTION = "apikey-da-evolution";

const TELEFONE_DO_BANCO = "34988776655";
const TELEFONE_DE_OUTRA_PESSOA = "11977665544";
const ID_REAL = "c35ce4dd-7a1b-4c2d-9e8f-0a1b2c3884be";
const ID_INEXISTENTE = "00000000-0000-4000-8000-000000000000";

const PEDIDO_DO_BANCO = {
  id: ID_REAL,
  customer_name: "Maria do Banco",
  customer_data: { whatsapp: TELEFONE_DO_BANCO },
  total: 24.9,
  payment_method: "pix",
};

function bancoFalso(pedido: Record<string, unknown> = PEDIDO_DO_BANCO) {
  const consultas: string[] = [];
  const dados = new Map<string, unknown>(Object.entries({
    marketplace_orders: pedido,
    marketplace_order_items: [{ product_name: "Sanduíche", quantity: 2 }],
    store_config: {
      whatsapp_api_url: URL_DA_EVOLUTION,
      whatsapp_api_key: CHAVE_DA_EVOLUTION,
      whatsapp_api_instance: INSTANCIA,
    },
  }));
  return {
    consultas,
    from(tabela: string) {
      consultas.push(tabela);
      let filtroDeId: string | null = null;
      const resolver = () => {
        if (tabela === "marketplace_orders" && filtroDeId !== ID_REAL) {
          return Promise.resolve({ data: null, error: null });
        }
        return Promise.resolve({ data: dados.get(tabela), error: null });
      };
      const construtor = {
        select: () => construtor,
        limit: () => construtor,
        eq: (coluna: string, valor: string) => {
          if (coluna === "id") filtroDeId = valor;
          return construtor;
        },
        maybeSingle: () => resolver(),
        single: () => resolver(),
        then: (ok: (v: unknown) => unknown, erro?: (e: unknown) => unknown) =>
          resolver().then(ok, erro),
      };
      return construtor;
    },
  };
}

type ChamadaDaEvolution = { url: string; init: RequestInit };

function evolutionFalsa() {
  const chamadas: ChamadaDaEvolution[] = [];
  const fetchImpl = (entrada: string | URL | Request, init?: RequestInit) => {
    chamadas.push({ url: String(entrada), init: init ?? {} });
    return Promise.resolve(
      new Response(JSON.stringify({ key: { id: "msg-1" } }), { status: 201 }),
    );
  };
  return { chamadas, fetchImpl: fetchImpl as typeof fetch };
}

function requisicao(autorizacao: string | null, corpo: unknown) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (autorizacao !== null) headers.Authorization = autorizacao;
  return new Request("https://funcao.exemplo.test/send-order-whatsapp", {
    method: "POST",
    headers,
    body: JSON.stringify(corpo),
  });
}

async function rodar(autorizacao: string | null, corpo: unknown) {
  const banco = bancoFalso();
  const evolution = evolutionFalsa();
  const resposta = await processar(requisicao(autorizacao, corpo), {
    supabase: banco,
    fetchImpl: evolution.fetchImpl,
    chavesDeServico: [CHAVE_DE_SERVICO],
  });
  return { resposta, banco, evolution };
}

const REGISTRO_FORJADO = {
  type: "INSERT",
  table: "marketplace_orders",
  record: {
    id: ID_REAL,
    customer_name: "Vítima",
    customer_data: { whatsapp: TELEFONE_DE_OUTRA_PESSOA },
    total: 1,
  },
};

const RECUSADOS: Array<[string, string | null]> = [
  ["anon (chave pública)", `Bearer ${CHAVE_PUBLICA}`],
  ["comprador autenticado", `Bearer ${JWT_DO_COMPRADOR}`],
  ["terceiro qualquer", "Bearer qualquer-coisa"],
  ["sem cabeçalho de autorização", null],
  ["autorização sem Bearer", CHAVE_DE_SERVICO],
];

for (const [quem, autorizacao] of RECUSADOS) {
  Deno.test(`recusa antes de qualquer envio: ${quem}`, async () => {
    const { resposta, banco, evolution } = await rodar(autorizacao, {
      order_id: ID_REAL,
    });
    assertEquals(resposta.status, 401);
    assertEquals(evolution.chamadas.length, 0);
    assertEquals(banco.consultas.length, 0, "nem o banco é consultado");
  });
}

Deno.test("record forjado com telefone de outra pessoa: recusado para quem não é servidor", async () => {
  const { resposta, evolution } = await rodar(
    `Bearer ${CHAVE_PUBLICA}`,
    REGISTRO_FORJADO,
  );
  assertEquals(resposta.status, 401);
  assertEquals(evolution.chamadas.length, 0);
});

Deno.test("servidor legítimo, mas só com `record` e sem order_id: nada sai", async () => {
  const { resposta, evolution } = await rodar(
    `Bearer ${CHAVE_DE_SERVICO}`,
    REGISTRO_FORJADO,
  );
  assertEquals(resposta.status, 400);
  assertEquals(evolution.chamadas.length, 0);
});

Deno.test("order_id que não parece UUID é recusado antes do banco", async () => {
  const { resposta, banco, evolution } = await rodar(
    `Bearer ${CHAVE_DE_SERVICO}`,
    { order_id: "1; DROP TABLE marketplace_orders" },
  );
  assertEquals(resposta.status, 400);
  assertEquals(banco.consultas.length, 0);
  assertEquals(evolution.chamadas.length, 0);
});

Deno.test("order_id inexistente: 404 e a Evolution recebe 0 chamadas", async () => {
  const { resposta, evolution } = await rodar(`Bearer ${CHAVE_DE_SERVICO}`, {
    order_id: ID_INEXISTENTE,
  });
  assertEquals(resposta.status, 404);
  assertEquals(evolution.chamadas.length, 0);
});

Deno.test("servidor legítimo: a mensagem sai com telefone, nome e total DO BANCO, ignorando o corpo", async () => {
  const { resposta, evolution } = await rodar(`Bearer ${CHAVE_DE_SERVICO}`, {
    order_id: ID_REAL,
    // Tudo isto é ruído: o corpo não decide nada.
    record: REGISTRO_FORJADO.record,
    customer_data: { whatsapp: TELEFONE_DE_OUTRA_PESSOA },
  });

  assertEquals(resposta.status, 200);
  assertEquals(evolution.chamadas.length, 1);

  const [chamada] = evolution.chamadas;
  assertEquals(
    chamada.url,
    `${URL_DA_EVOLUTION}/message/sendText/${INSTANCIA}`,
  );
  assertEquals(chamada.init.method, "POST");
  const headers = new Headers(chamada.init.headers);
  assertEquals(headers.get("apikey"), CHAVE_DA_EVOLUTION);
  assertEquals(headers.get("Content-Type"), "application/json");

  const corpoEnviado = String(chamada.init.body);
  const corpo = JSON.parse(corpoEnviado);
  assertEquals(corpo.number, `55${TELEFONE_DO_BANCO}`);
  assertStringIncludes(corpo.text, "Olá *Maria do Banco*");
  assertStringIncludes(corpo.text, "*#3884BE*");
  assertStringIncludes(corpo.text, "*Total:* R$ 24,90");
  assertEquals(corpoEnviado.includes("Vítima"), false);
  assertEquals(corpoEnviado.includes(TELEFONE_DE_OUTRA_PESSOA), false);
});

Deno.test("a resposta ao chamador não devolve o retorno da Evolution (que pode ecoar o telefone)", async () => {
  const { resposta } = await rodar(`Bearer ${CHAVE_DE_SERVICO}`, {
    order_id: ID_REAL,
  });
  assertEquals(await resposta.json(), { success: true });
});

Deno.test("chave de serviço ausente no ambiente: ninguém passa, nem com Bearer vazio", async () => {
  const banco = bancoFalso();
  const evolution = evolutionFalsa();
  for (
    const autorizacao of ["Bearer ", "Bearer", `Bearer ${CHAVE_DE_SERVICO}`]
  ) {
    const resposta = await processar(
      requisicao(autorizacao, { order_id: ID_REAL }),
      {
        supabase: banco,
        fetchImpl: evolution.fetchImpl,
        chavesDeServico: [""],
      },
    );
    assertEquals(resposta.status, 401);
  }
  assertEquals(evolution.chamadas.length, 0);
});

Deno.test("o log não traz telefone nem dados pessoais, em nenhum caminho", async () => {
  const linhas: string[] = [];
  const originais = {
    log: console.log,
    info: console.info,
    warn: console.warn,
    error: console.error,
  };
  const capturar = (...args: unknown[]) => {
    linhas.push(
      args
        .map((
          a,
        ) => (a instanceof Error
          ? a.message
          : typeof a === "string"
          ? a
          : JSON.stringify(a))
        )
        .join(" "),
    );
  };
  console.log =
    console.info =
    console.warn =
    console.error =
      capturar;
  try {
    // caminho feliz
    await rodar(`Bearer ${CHAVE_DE_SERVICO}`, { order_id: ID_REAL });
    // recusado
    await rodar(`Bearer ${CHAVE_PUBLICA}`, REGISTRO_FORJADO);
    // pedido sem número de WhatsApp
    await processar(
      requisicao(`Bearer ${CHAVE_DE_SERVICO}`, { order_id: ID_REAL }),
      {
        supabase: bancoFalso({ ...PEDIDO_DO_BANCO, customer_data: {} }),
        fetchImpl: evolutionFalsa().fetchImpl,
        chavesDeServico: [CHAVE_DE_SERVICO],
      },
    );
    // banco falhando, com o erro carregando o telefone do cliente
    await processar(
      requisicao(`Bearer ${CHAVE_DE_SERVICO}`, { order_id: ID_REAL }),
      {
        supabase: {
          from: () => {
            throw new Error(`falha lendo o cliente ${TELEFONE_DO_BANCO}`);
          },
        },
        fetchImpl: evolutionFalsa().fetchImpl,
        chavesDeServico: [CHAVE_DE_SERVICO],
      },
    );
  } finally {
    Object.assign(console, originais);
  }

  const tudo = linhas.join("\n");
  assertEquals(tudo.includes(TELEFONE_DO_BANCO), false, tudo);
  assertEquals(tudo.includes(TELEFONE_DE_OUTRA_PESSOA), false, tudo);
  assertEquals(tudo.includes("Maria do Banco"), false, tudo);
  assertEquals(tudo.includes(CHAVE_DE_SERVICO), false, tudo);
});
