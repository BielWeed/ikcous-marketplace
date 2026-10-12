// @ts-nocheck
/**
 * Testes da send-order-whatsapp.
 *
 * 1. A mensagem que o cliente recebe no WhatsApp: o número do pedido é o MESMO
 *    que ele vê no app ("#3884BE": 6 últimos caracteres do id, em maiúsculas) e
 *    a forma de pagamento sai pelo rótulo comum de `_shared/pedido.ts`.
 * 2. A porta: só o chamador de SERVIDOR passa; o corpo só vale pelo `order_id`;
 *    falha da Evolution é falha de verdade; o log nunca traz telefone.
 *
 * Nada aqui toca rede nem banco: a Evolution e o banco são dublês (o dublê da
 * Evolution registra rota, método e headers de cada chamada). A prova de que
 * as consultas executam no schema REAL está em
 * `tests/banco/whatsapp-edge-consultas-viva.cjs` (Postgres efêmero do CI).
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

Deno.test("o resto da mensagem continua igual (nome, resumo, total)", () => {
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
});

// O pedido online diz a forma de verdade em `metodo_online`. Antes, tudo que
// não era pix/card virava "Dinheiro" — um cliente que pagou no cartão de
// crédito pelo site recebia "Pagamento: Dinheiro".
const ROTULOS_DO_ONLINE: Array<[string, string]> = [
  ["credito", "Cartao de credito pelo site"],
  ["debito", "Cartao de debito pelo site"],
  ["pix", "PIX pelo site"],
];

for (const [metodoOnline, rotulo] of ROTULOS_DO_ONLINE) {
  Deno.test(`pagamento online (${metodoOnline}): a mensagem diz "${rotulo}", nunca "Dinheiro"`, () => {
    const texto = montarMensagem({
      orderId: ID_DO_PEDIDO,
      customerName: "Maria",
      itemsList: "- Sanduíche (2x)",
      totalPrice: 24.9,
      paymentMethod: "online",
      metodoOnline,
    });

    assertStringIncludes(texto, `*Pagamento:* ${rotulo}`);
    assertEquals(texto.includes("Dinheiro"), false);
  });
}

Deno.test("pagamento na entrega mantém o rótulo comum (cartão e dinheiro)", () => {
  const base = {
    orderId: ID_DO_PEDIDO,
    customerName: "Maria",
    itemsList: "- Sanduíche (2x)",
    totalPrice: 24.9,
  };
  assertStringIncludes(
    montarMensagem({ ...base, paymentMethod: "card" }),
    "*Pagamento:* Cartao na entrega",
  );
  assertStringIncludes(
    montarMensagem({ ...base, paymentMethod: "cash" }),
    "*Pagamento:* Dinheiro na entrega",
  );
});

Deno.test("forma desconhecida ou ausente sai como 'Não informado', nunca como um rótulo falso", () => {
  const base = {
    orderId: ID_DO_PEDIDO,
    customerName: "Maria",
    itemsList: "- Sanduíche (2x)",
    totalPrice: 24.9,
  };
  for (const paymentMethod of ["cripto", "", null, undefined]) {
    const texto = montarMensagem({ ...base, paymentMethod });
    assertStringIncludes(texto, "*Pagamento:* Não informado");
    assertEquals(texto.includes("Dinheiro"), false);
  }
});

Deno.test("pedido online antigo (sem metodo_online) continua 'PIX pelo site', como no resto da casa", () => {
  const texto = montarMensagem({
    orderId: ID_DO_PEDIDO,
    customerName: "Maria",
    itemsList: "- Sanduíche (2x)",
    totalPrice: 24.9,
    paymentMethod: "online",
    metodoOnline: null,
  });
  assertStringIncludes(texto, "*Pagamento:* PIX pelo site");
});

// ---------------------------------------------------------------------------
// Autorização do chamador e pedido canônico (04/10/2026)
//
// A função manda mensagem ao CLIENTE por um gateway de WhatsApp. O `verify_jwt`
// padrão deixa passar até a chave pública (anon), então a porta tem de ser o
// handler: só o chamador de SERVIDOR (o gatilho do banco que a chamava, com a
// chave de serviço no Authorization) é aceito, e o destinatário, o nome e o
// valor saem do BANCO pelo id — nunca do corpo.
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
  payment_method: "online",
  metodo_online: "credito",
};

// Nenhuma tabela do schema atual guarda a configuração da Evolution (as
// colunas `store_config.whatsapp_api_*` foram removidas em 01/06/2026): nos
// testes a configuração entra por injeção.
const CONFIG_DA_EVOLUTION = {
  url: URL_DA_EVOLUTION,
  chave: CHAVE_DA_EVOLUTION,
  instancia: INSTANCIA,
};
const configInjetada = () => Promise.resolve(CONFIG_DA_EVOLUTION);

function bancoFalso(pedido: Record<string, unknown> = PEDIDO_DO_BANCO) {
  const consultas: string[] = [];
  const dados = new Map<string, unknown>(Object.entries({
    marketplace_orders: pedido,
    marketplace_order_items: [{ product_name: "Sanduíche", quantity: 2 }],
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

function evolutionFalsa(
  status = 201,
  corpo: unknown = { key: { id: "msg-1" } },
) {
  const chamadas: ChamadaDaEvolution[] = [];
  const fetchImpl = (entrada: string | URL | Request, init?: RequestInit) => {
    chamadas.push({ url: String(entrada), init: init ?? {} });
    return Promise.resolve(new Response(JSON.stringify(corpo), { status }));
  };
  return { chamadas, fetchImpl: fetchImpl as typeof fetch };
}

function requisicao(
  autorizacao: string | null,
  corpo: unknown,
  metodo = "POST",
) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (autorizacao !== null) headers.Authorization = autorizacao;
  return new Request("https://funcao.exemplo.test/send-order-whatsapp", {
    method: metodo,
    headers,
    body: metodo === "GET" || metodo === "HEAD"
      ? undefined
      : typeof corpo === "string"
      ? corpo
      : JSON.stringify(corpo),
  });
}

async function rodar(
  autorizacao: string | null,
  corpo: unknown,
  evolution = evolutionFalsa(),
) {
  const banco = bancoFalso();
  const resposta = await processar(requisicao(autorizacao, corpo), {
    supabase: banco,
    fetchImpl: evolution.fetchImpl,
    chavesDeServico: [CHAVE_DE_SERVICO],
    configDaEvolution: configInjetada,
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

Deno.test("a autorização vem ANTES de ler o corpo: corpo inválido sem credencial dá 401, não 400", async () => {
  for (const corpoInvalido of ["{isto não é json", "", "null", "[]"]) {
    for (const autorizacao of [null, `Bearer ${CHAVE_PUBLICA}`]) {
      const { resposta, banco, evolution } = await rodar(
        autorizacao,
        corpoInvalido,
      );
      assertEquals(
        resposta.status,
        401,
        `corpo=${JSON.stringify(corpoInvalido)}`,
      );
      assertEquals(banco.consultas.length, 0);
      assertEquals(evolution.chamadas.length, 0);
    }
  }
});

Deno.test("com credencial de servidor, o mesmo corpo inválido aí sim dá 400", async () => {
  const { resposta, evolution } = await rodar(
    `Bearer ${CHAVE_DE_SERVICO}`,
    "{isto não é json",
  );
  assertEquals(resposta.status, 400);
  assertEquals(evolution.chamadas.length, 0);
});

Deno.test("só o método POST passa: outro método, mesmo com credencial de servidor, é recusado", async () => {
  for (const metodo of ["GET", "PUT", "DELETE"]) {
    const banco = bancoFalso();
    const evolution = evolutionFalsa();
    const resposta = await processar(
      requisicao(`Bearer ${CHAVE_DE_SERVICO}`, { order_id: ID_REAL }, metodo),
      {
        supabase: banco,
        fetchImpl: evolution.fetchImpl,
        chavesDeServico: [CHAVE_DE_SERVICO],
        configDaEvolution: configInjetada,
      },
    );
    assertEquals(resposta.status, 405, metodo);
    assertEquals(banco.consultas.length, 0);
    assertEquals(evolution.chamadas.length, 0);
  }
});

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

Deno.test("servidor legítimo: a mensagem sai com telefone, nome, total e forma DO BANCO, ignorando o corpo", async () => {
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
  assertStringIncludes(corpo.text, "*Pagamento:* Cartao de credito pelo site");
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
        configDaEvolution: configInjetada,
      },
    );
    assertEquals(resposta.status, 401);
  }
  assertEquals(evolution.chamadas.length, 0);
});

// ---------------------------------------------------------------------------
// Falha da Evolution é falha de verdade
// ---------------------------------------------------------------------------

// A Evolution costuma ecoar o número e, em erro de autenticação, o apikey.
const ECO_DA_EVOLUTION = {
  status: 400,
  error: "Bad Request",
  message: [`number 55${TELEFONE_DO_BANCO} is not valid`],
  apikey: CHAVE_DA_EVOLUTION,
};

for (const status of [400, 401, 404, 500, 503]) {
  Deno.test(`Evolution responde HTTP ${status}: falha real (502, success=false), sem ecoar a resposta, o telefone nem a chave`, async () => {
    const { resposta, evolution } = await rodar(
      `Bearer ${CHAVE_DE_SERVICO}`,
      { order_id: ID_REAL },
      evolutionFalsa(status, ECO_DA_EVOLUTION),
    );

    assertEquals(evolution.chamadas.length, 1);
    assertEquals(resposta.status, 502);
    const texto = await resposta.text();
    const corpo = JSON.parse(texto);
    assertEquals(corpo.success, false);
    assertEquals(texto.includes(TELEFONE_DO_BANCO), false, texto);
    assertEquals(texto.includes(CHAVE_DA_EVOLUTION), false, texto);
    assertEquals(texto.includes("Bad Request"), false, texto);
  });
}

Deno.test("Evolution fora do ar (a chamada lança): 500, success=false, sem vazar o erro", async () => {
  const banco = bancoFalso();
  const resposta = await processar(
    requisicao(`Bearer ${CHAVE_DE_SERVICO}`, { order_id: ID_REAL }),
    {
      supabase: banco,
      fetchImpl: (() =>
        Promise.reject(
          new Error(
            `connect ECONNREFUSED ${CHAVE_DA_EVOLUTION} 55${TELEFONE_DO_BANCO}`,
          ),
        )) as typeof fetch,
      chavesDeServico: [CHAVE_DE_SERVICO],
      configDaEvolution: configInjetada,
    },
  );
  assertEquals(resposta.status, 500);
  const texto = await resposta.text();
  assertEquals(JSON.parse(texto).success, false);
  assertEquals(texto.includes(TELEFONE_DO_BANCO), false, texto);
  assertEquals(texto.includes(CHAVE_DA_EVOLUTION), false, texto);
});

Deno.test("sem configuração da Evolution no schema: falha honesta 'não configurada', e nada é enviado", async () => {
  const banco = bancoFalso();
  const evolution = evolutionFalsa();
  const resposta = await processar(
    requisicao(`Bearer ${CHAVE_DE_SERVICO}`, { order_id: ID_REAL }),
    {
      supabase: banco,
      fetchImpl: evolution.fetchImpl,
      chavesDeServico: [CHAVE_DE_SERVICO],
      // sem `configDaEvolution`: é o que roda em produção hoje.
    },
  );
  assertEquals(resposta.status, 503);
  const corpo = await resposta.json();
  assertEquals(corpo.success, false);
  assertStringIncludes(corpo.error, "não configurado");
  assertEquals(evolution.chamadas.length, 0);
});

// ---------------------------------------------------------------------------
// Log
// ---------------------------------------------------------------------------

Deno.test("o log não traz telefone, nome, chave nem o retorno da Evolution, em nenhum caminho", async () => {
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
  const deps = (extra: Record<string, unknown> = {}) => ({
    supabase: bancoFalso(),
    fetchImpl: evolutionFalsa().fetchImpl,
    chavesDeServico: [CHAVE_DE_SERVICO],
    configDaEvolution: configInjetada,
    ...extra,
  });
  const servidor = (corpo: unknown = { order_id: ID_REAL }) =>
    requisicao(`Bearer ${CHAVE_DE_SERVICO}`, corpo);
  try {
    // caminho feliz
    await processar(servidor(), deps());
    // recusado
    await processar(
      requisicao(`Bearer ${CHAVE_PUBLICA}`, REGISTRO_FORJADO),
      deps(),
    );
    // pedido sem número de WhatsApp
    await processar(
      servidor(),
      deps({ supabase: bancoFalso({ ...PEDIDO_DO_BANCO, customer_data: {} }) }),
    );
    // Evolution recusando, com eco do telefone e da chave
    for (const status of [400, 500]) {
      await processar(
        servidor(),
        deps({ fetchImpl: evolutionFalsa(status, ECO_DA_EVOLUTION).fetchImpl }),
      );
    }
    // Evolution fora do ar
    await processar(
      servidor(),
      deps({
        fetchImpl: (() =>
          Promise.reject(
            new Error(
              `ECONNREFUSED 55${TELEFONE_DO_BANCO} ${CHAVE_DA_EVOLUTION}`,
            ),
          )) as typeof fetch,
      }),
    );
    // não configurada
    await processar(servidor(), deps({ configDaEvolution: undefined }));
    // banco falhando, com o erro carregando o telefone do cliente
    await processar(
      servidor(),
      deps({
        supabase: {
          from: () => {
            throw new Error(`falha lendo o cliente ${TELEFONE_DO_BANCO}`);
          },
        },
      }),
    );
  } finally {
    Object.assign(console, originais);
  }

  const tudo = linhas.join("\n");
  assertEquals(linhas.length > 0, true, "o teste precisa ter capturado log");
  assertEquals(tudo.includes(TELEFONE_DO_BANCO), false, tudo);
  assertEquals(tudo.includes(TELEFONE_DE_OUTRA_PESSOA), false, tudo);
  assertEquals(tudo.includes("Maria do Banco"), false, tudo);
  assertEquals(tudo.includes(CHAVE_DE_SERVICO), false, tudo);
  assertEquals(tudo.includes(CHAVE_DA_EVOLUTION), false, tudo);
  assertEquals(tudo.includes("Bad Request"), false, tudo);
});
