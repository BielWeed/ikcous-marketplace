// @ts-nocheck
import { assertEquals } from "https://deno.land/std@0.177.0/testing/asserts.ts";
import {
  buscarComTempo,
  calculateSmartFallback,
  chavesDeTransportadora,
  emailDeContatoValido,
  erroDeTransportadoraEhCepInvalido,
  getCartHash,
  handler,
  isLocalCep,
  opcaoDeRetirada,
  precoDeContingenciaDoTopo,
  precoResolvidoSemCache,
  servicoCasaChave,
  validarOrigemEFrete,
} from "./index.ts";
import * as edge from "./index.ts";

Deno.test("calculateSmartFallback - same region", () => {
  // Test same region: starts with same character
  const fee = calculateSmartFallback("38500000", "35000000", 10);
  assertEquals(fee, 15); // max of 15 and baseFee (10)
});

for (const mensagem of [
  'Melhor Envio API retornou 422: {"errors":{"postal_code":["O campo cep_destino está invalido"]}}',
  "Melhor Envio API retornou 422: O campo cep_destino está invalido",
]) {
  Deno.test(`CEP inexistente - classifica ${mensagem}`, () => {
    assertEquals(erroDeTransportadoraEhCepInvalido(mensagem), true);
  });
}

for (const mensagem of [
  'Melhor Envio API retornou 422: {"errors":{"postal_code":["inválido"]}}',
  'Melhor Envio API retornou 422: {"errors":{"postal_code":["O campo cep_origem está invalido"]}}',
  "Melhor Envio API retornou 500: erro interno ao cotar 04220-000 (422 registros)",
  "Melhor Envio API retornou 401: token expirado para o pedido com cep_destino 04220-000",
  "Melhor Envio API retornou 500: erro interno ao cotar cep_destino 04220-000 (422 registros)",
  "Melhor Envio API retornou 500: postal_code cep_destino",
  "Melhor Envio API retornou 401: postal_code cep_destino",
  "timeout",
  "Melhor Envio API retornou 422: peso inválido",
  "postal_code cep_destino",
  null,
  undefined,
  "",
]) {
  Deno.test(`CEP inexistente - não confunde outra falha: ${mensagem}`, () => {
    assertEquals(erroDeTransportadoraEhCepInvalido(mensagem), false);
  });
}

Deno.test("calculateSmartFallback - neighboring region group", () => {
  // Test neighboring region group (e.g., 2 and 3)
  const fee = calculateSmartFallback("20000000", "30000000", 10);
  assertEquals(fee, 22); // max of 22 and baseFee + 7 (17)
});

Deno.test("calculateSmartFallback - remote regions", () => {
  // Test remote regions (e.g., 0 and 8)
  const fee = calculateSmartFallback("01000000", "80000000", 10);
  assertEquals(fee, 38); // max of 38 and baseFee + 20 (30)
});

Deno.test("getCartHash - empty cart", () => {
  assertEquals(getCartHash([]), "");
});

Deno.test("getCartHash - null or invalid cart", () => {
  assertEquals(getCartHash(null as any), "empty");
  assertEquals(getCartHash(undefined as any), "empty");
});

Deno.test("getCartHash - stable sorting and hashing", () => {
  const cart1 = [
    { product: { id: "prod-a" }, quantity: 2, variantId: "v1" },
    { product: { id: "prod-b" }, quantity: 1, variantId: "v2" },
  ];
  const cart2 = [
    { product: { id: "prod-b" }, quantity: 1, variantId: "v2" },
    { product: { id: "prod-a" }, quantity: 2, variantId: "v1" },
  ];
  assertEquals(getCartHash(cart1), getCartHash(cart2));
  assertEquals(getCartHash(cart1), "prod-a:v1:2,prod-b:v2:1");
});

Deno.test("isLocalCep - default fallback", () => {
  // Same first 5 digits
  assertEquals(isLocalCep("38500-000", "38500-120"), true);
  // Different first 5 digits
  assertEquals(isLocalCep("38500-000", "38400-000"), false);
});

Deno.test("isLocalCep - custom prefix list", () => {
  // Custom prefix list
  assertEquals(isLocalCep("38500-000", "38400-123", "38500, 38400"), true);
  assertEquals(isLocalCep("38500-000", "38200-123", "38500, 38400"), false);
});

Deno.test("isLocalCep - custom range", () => {
  // Custom range
  assertEquals(isLocalCep("38500-000", "38502000", "38500000-38505000"), true);
  assertEquals(isLocalCep("38500-000", "38506000", "38500000-38505000"), false);
});

Deno.test("isLocalCep - formato do placeholder do admin (dois CEPs formatados)", () => {
  // O placeholder do AdminShippingView ensina "Ex: 38500-000, 38500-999".
  // Antes, o hífen do CEP era lido como separador de faixa e nada casava.
  const range = "38500-000, 38500-999";
  assertEquals(isLocalCep("38500-000", "38500-123", range), true);
  assertEquals(isLocalCep("38500-000", "38500-000", range), true);
  assertEquals(isLocalCep("38500-000", "38500-999", range), true);
  // Fora da faixa
  assertEquals(isLocalCep("38500-000", "38501-000", range), false);
  assertEquals(isLocalCep("38500-000", "38400-123", range), false);
});

Deno.test("isLocalCep - CEP completo isolado casa exato, prefixo curto casa por início", () => {
  assertEquals(isLocalCep("38500-000", "38500-123", "38500-123"), true);
  assertEquals(isLocalCep("38500-000", "38500-124", "38500-123"), false);
  // Três ou mais itens continuam valendo como lista, não como faixa
  assertEquals(isLocalCep("38500-000", "38400-123", "38500, 38400, 38300"), true);
  assertEquals(isLocalCep("38500-000", "38100-123", "38500, 38400, 38300"), false);
});

Deno.test("isLocalCep - faixa invertida e espaços extras", () => {
  // Lojista digita o maior primeiro: deve continuar funcionando
  assertEquals(isLocalCep("38500-000", "38500-500", "38500-999 ,  38500-000"), true);
  // Campo vazio ou só pontuação cai no fallback dos 5 primeiros dígitos
  assertEquals(isLocalCep("38500-000", "38500-120", "   "), true);
  assertEquals(isLocalCep("38500-000", "38400-120", "   "), false);
});

// --- Contingência do topo: o R$ 15 fixo que a lojista pagava ---------------
//
// Até 18/08/2026, quando a função inteira estourava (erro antes ou depois da
// cotação), o `catch` de topo devolvia `price: 15` cravado no código — para
// qualquer destino do Brasil. A escada por região (15 / 22 / 38) já existia
// logo acima, em `calculateSmartFallback`, e essa contingência não a usava:
// uma blusa de Monte Carmelo (38xxx) para Manaus (69xxx) saía por R$ 15 e a
// diferença ficava com a lojista, sem aparecer em lugar nenhum.
//
// `precoDeContingenciaDoTopo` é a decisão de preço desse `catch`, isolada para
// poder ser medida. Devolver `null` significa "não dá para cotar honestamente"
// — e aí a função responde erro em vez de inventar preço barato.

Deno.test("contingência do topo - mesma região usa o piso de 15, não o 15 cravado", () => {
  assertEquals(precoDeContingenciaDoTopo("38500000", "35000000", 10), 15);
});

Deno.test("contingência do topo - região vizinha cobra 22, não 15", () => {
  assertEquals(precoDeContingenciaDoTopo("20000000", "30000000", 10), 22);
});

Deno.test("contingência do topo - Monte Carmelo para Manaus cobra 38, não 15", () => {
  // 38xxx (MG) -> 69xxx (AM): regiões remotas. É o caso que custava dinheiro
  // da lojista a cada cotação falha.
  assertEquals(precoDeContingenciaDoTopo("38500000", "69000000", 10), 38);
});

Deno.test("contingência do topo - respeita a taxa da loja quando ela é maior que o piso", () => {
  // A escada é PISO, não teto: quem configurou frete de R$ 50 não passa a
  // cobrar 38 por causa de uma falha nossa.
  assertEquals(precoDeContingenciaDoTopo("38500000", "69000000", 50), 70);
});

Deno.test("contingência do topo - sem CEP de destino não inventa preço", () => {
  // Erro antes de ler o corpo do pedido: não se sabe para onde vai. Preço
  // nenhum é honesto aqui, e o barato é o pior de todos.
  assertEquals(precoDeContingenciaDoTopo("38500000", "", 10), null);
  assertEquals(precoDeContingenciaDoTopo("", "69000000", 10), null);
  assertEquals(precoDeContingenciaDoTopo(undefined, undefined, undefined), null);
});

Deno.test("contingência do topo - sem taxa da loja conhecida, a escada ainda vale", () => {
  // `flatFee` só existe depois de ler store_config. Se o erro veio antes
  // disso, a escada continua aplicável: ela só precisa dos dois CEPs.
  assertEquals(precoDeContingenciaDoTopo("38500000", "69000000", undefined), 38);
});

// --- Origem: falhar fechado, nunca assumir Monte Carmelo -------------------
//
// Mesmo defeito que a 1.4.0 corrigiu na contingência do topo, um andar
// acima: até 18/08/2026, `storeConfig.origin_cep || '38500-000'` e
// `Number(storeConfig.shipping_fee || 15)` calculavam frete a partir de
// Monte Carmelo e de R$ 15 sempre que a loja nunca configurou nada.
// `Number(null)` é `0` e `null || 15` é `15`: os dois caminhos estavam
// errados. `validarOrigemEFrete` é a decisão isolada — string de erro
// quando falta o que é preciso para cotar honestamente, `null` quando pode
// seguir.
//
// FRETE V2 (03/09/2026): a exigência de taxa fixa que vivia aqui (quando o
// provedor era `flat_fee`) saiu junto com o caminho de taxa fixa — fora da
// cidade é SÓ cotação real de transportadora, e a origem é o único pré-
// requisito que falta para pedi-la.

Deno.test("sem CEP de origem configurado, nao devolve opcao de frete", () => {
  const erro = validarOrigemEFrete(null);
  assertEquals(typeof erro, "string");
});

Deno.test("CEP de origem vazio conta como ausente, nao so' null", () => {
  const erro = validarOrigemEFrete("");
  assertEquals(typeof erro, "string");
});

Deno.test("com CEP de origem, permite cotar — a taxa fixa não é mais exigida (nem usada)", () => {
  // O fim do flat_fee levou embora a checagem de taxa que vivia aqui: quem
  // decide o preço de fora da cidade é a API da transportadora. Loja com
  // `shipping_fee` nulo e origem configurada pode cotar (pela
  // transportadora), e loja COM taxa configurada também não cota mais por
  // ela — o valor ficou órfão no banco de propósito.
  assertEquals(validarOrigemEFrete("38500-000"), null);
});

// --- A cotação só sai depois de GRAVADA -------------------------------------
//
// Até 22/08/2026 a gravação em `shipping_quotes_cache` era disparada por
// `fireAndForget` — sem `await` — e a função respondia o preço com a escrita
// ainda em voo. A doc do Supabase é explícita: promessa não aguardada pode
// morrer no encerramento da instância (`EarlyDrop`). Resultado: a loja mostra
// um preço que o banco não tem, e a validação do pedido — que vai exigir essa
// linha — recusa a compra no último clique, com endereço e pagamento já
// preenchidos.
//
// A decisão: falha cedo. Se a gravação falhar, a resposta é ERRO, e o preço
// NÃO vai junto. Perder um clique na cotação é barato; perder a compra
// inteira no fim do checkout não é.
//
// Estes testes exercitam o handler HTTP de verdade, com um cliente Supabase
// falso (`deps.supabase`) e o `fetch` da transportadora substituído — a mesma
// costura de `reconciliar-pagamentos` e `webhook-mercadopago`. Antes deles,
// nada neste arquivo tocava o handler: só as funções puras do topo.

const CARRINHO_DE_TESTE = [{ product: { id: "p1", price: 100 }, quantity: 1 }];
/** O produto do carrinho de teste no BANCO (1.5.7: o valor vem daqui, nunca do navegador). */
const PRODUTO_PADRAO_DO_TESTE = { id: "p1", preco_venda: 100 };

// ── Nomes de serviço (release 1.5.7, contrato §2 + R1-7) ──────────────────
//
// REESCRITO CONSCIENTEMENTE na 1.5.7. Até a 1.5.6, `nomeAmigavelDoServico`
// decidia o nome por PEDAÇO de texto do serviço: ".Package" e "Loggi .Com"
// viravam "Entrega econômica"/"Entrega expressa" — com vários provedores na
// mesma lista, o nome passava a sugerir ranking ("expressa" ao lado de algo
// que não é o mais rápido) e escondia a transportadora. Agora `nomeDaOpcao`
// só dá "Entrega econômica" ao PAC dos Correios e "Entrega expressa" ao SEDEX
// dos Correios (transportadora E serviço); todo o resto é
// "<Transportadora> — <Serviço>".

Deno.test("nomeDaOpcao - .Package da Jadlog NÃO vira mais 'Entrega econômica'", () => {
  assertEquals(edge.nomeDaOpcao("Jadlog", ".Package"), "Jadlog — .Package");
  assertEquals(edge.nomeDaOpcao("Jadlog", ".Package Centralizado"), "Jadlog — .Package Centralizado");
});

Deno.test("nomeDaOpcao - SEDEX dos Correios é 'Entrega expressa'; SEDEX 10 mostra o nome real", () => {
  assertEquals(edge.nomeDaOpcao("Correios", "SEDEX"), "Entrega expressa");
  assertEquals(edge.nomeDaOpcao("Correios", "SEDEX 10"), "Correios — SEDEX 10");
});

Deno.test("nomeDaOpcao - PAC dos Correios é 'Entrega econômica'; '.package' e PAC de outra transportadora não", () => {
  assertEquals(edge.nomeDaOpcao("Correios", "PAC"), "Entrega econômica");
  assertEquals(edge.nomeDaOpcao("Correios", ".package falso"), "Correios — .package falso");
  assertEquals(edge.nomeDaOpcao("Outra", "PAC"), "Outra — PAC");
});

Deno.test("nomeDaOpcao - Loggi .Com/Express mostra a transportadora (não vira 'expressa')", () => {
  assertEquals(edge.nomeDaOpcao("Loggi", ".Com"), "Loggi — .Com");
  assertEquals(edge.nomeDaOpcao("Loggi", "Express"), "Loggi — Express");
});

Deno.test("nomeDaOpcao - sem transportadora volta o serviço LIMPO; nada = vazio", () => {
  assertEquals(edge.nomeDaOpcao("", "Transporta Já Turbo"), "Transporta Já Turbo");
  assertEquals(edge.nomeDaOpcao(undefined, undefined), "");
});

// ── Filtro de métodos habilitados casa por SERVIÇO, não por substring ──────
//
// A tela do lojista oferece três chaves fixas ("sedex", "pac", "jadlog" —
// TransportadorasCard.tsx:95). O filtro antigo comparava a chave com
// `includes` cru sobre o nome comercial: ".package".includes("pac") é TRUE
// (liga a Jadlog achando que é PAC dos Correios) e ".package".includes(
// "jadlog") é FALSE (desliga a Jadlog mesmo com a chave marcada) — a MESMA
// armadilha do `\bpac\b`, que o filtro antigo não usava.

Deno.test("servicoCasaChave - chave 'pac' NÃO casa '.Package' (não liga a Jadlog)", () => {
  assertEquals(servicoCasaChave(".Package", "pac"), false);
  assertEquals(servicoCasaChave(".Package Centralizado", "pac"), false);
});

Deno.test("servicoCasaChave - chave 'pac' casa o PAC de verdade (fronteira de palavra)", () => {
  assertEquals(servicoCasaChave("PAC", "pac"), true);
  assertEquals(servicoCasaChave("PAC Mini", "pac"), true);
});

Deno.test("servicoCasaChave - chave 'jadlog' casa '.Package' (não desliga tudo)", () => {
  assertEquals(servicoCasaChave(".Package", "jadlog"), true);
  assertEquals(servicoCasaChave(".Package Centralizado", "jadlog"), true);
});

Deno.test("servicoCasaChave - chave 'jadlog' NÃO casa PAC nem SEDEX", () => {
  assertEquals(servicoCasaChave("PAC", "jadlog"), false);
  assertEquals(servicoCasaChave("SEDEX", "jadlog"), false);
});

Deno.test("servicoCasaChave - chave 'sedex' casa SEDEX e não casa .Package", () => {
  assertEquals(servicoCasaChave("SEDEX", "sedex"), true);
  assertEquals(servicoCasaChave(".Package", "sedex"), false);
});

Deno.test("servicoCasaChave - nome ausente/nulo não estoura (anotado vizinho)", () => {
  assertEquals(servicoCasaChave(undefined, "pac"), false);
  assertEquals(servicoCasaChave(null as any, "jadlog"), false);
});

Deno.test("filtro de métodos habilitados com CEP FORA: PAC devolvido x só sedex habilitado -> só a expressa sai (R2 da revisão)", async () => {
  // R2 da revisão do commit 3f90033: os testes de filtro antigos caíam no
  // retorno cedo do cliente local (que passa antes do filtro) e o filtro
  // ficou sem cobertura nenhuma. Este teste exercita o filtro com CEP FORA,
  // pelo caminho completo: a transportadora devolve PAC e SEDEX, a loja só
  // habilita "sedex", e a resposta traz SOMENTE a SEDEX — já traduzida.
  const fetchOriginal = globalThis.fetch;
  globalThis.fetch = (() =>
    Promise.resolve(
      new Response(
        // 1.5.7: com a transportadora (`company`), como a API real manda —
        // é ela que faz o SEDEX dos Correios virar "Entrega expressa".
        JSON.stringify([
          { id: 1, name: "PAC", price: "26.41", delivery_time: 8, company: { name: "Correios" } },
          { id: 2, name: "SEDEX", price: "54.88", delivery_time: 4, company: { name: "Correios" } },
        ]),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    )) as any;
  try {
    const registro = {
      inserts: [] as Array<{ tabela: string; linha: any }>,
      execucoes: [] as Array<{ tabela: string; linha: any }>,
    upserts: [] as Array<{ tabela: string; linha: any; onConflict: string | null }>,
      cacheConcluido: false,
      logConcluido: false,
    };
    const resposta = await handler(requisicaoDeCotacao(), {
      supabase: clienteFalso({
        registro,
        cacheInsert: () => Promise.resolve({ error: null }),
        config: { ...CONFIG_DA_LOJA, enabled_shipping_methods: ["sedex"] },
      }),
    });
    const corpo = await resposta.json();
    assertEquals(resposta.status, 200);
    assertEquals(corpo.options.length, 1);
    assertEquals(corpo.options[0].id, "melhor-envio-2");
    assertEquals(corpo.options[0].name, "Entrega expressa");
  } finally {
    globalThis.fetch = fetchOriginal;
  }
});

Deno.test("filtro de métodos habilitados: chave 'pac' NÃO liga a Jadlog '.Package' (fim a fim)", async () => {
  // Reprodução do achado index-1019: loja marca só "pac" e a transportadora
  // devolve a Jadlog como ".Package". Com o filtro por substring cru,
  // ".package".includes("pac") era true e a Jadlog vazava como se fosse PAC.
  // Corrigido o casamento, a ÚNICA opção devolvida (Jadlog) fica de fora do
  // filtro — sobra zero opção válida, e o ramo de "nenhum método habilitado
  // sobrou" (index.ts:1163, já existente e coberto acima em "gravação falha
  // e NENHUMA opção dispensa o cache") responde 503 sem `options`, não 200
  // com array vazio.
  const fetchOriginal = globalThis.fetch;
  globalThis.fetch = (() =>
    Promise.resolve(
      new Response(
        JSON.stringify([{ id: 1, name: ".Package", price: "31.20", delivery_time: 6 }]),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    )) as any;
  try {
    const registro = {
      inserts: [] as Array<{ tabela: string; linha: any }>,
      execucoes: [] as Array<{ tabela: string; linha: any }>,
    upserts: [] as Array<{ tabela: string; linha: any; onConflict: string | null }>,
      cacheConcluido: false,
      logConcluido: false,
    };
    const resposta = await handler(requisicaoDeCotacao(), {
      supabase: clienteFalso({
        registro,
        cacheInsert: () => Promise.resolve({ error: null }),
        config: { ...CONFIG_DA_LOJA, enabled_shipping_methods: ["pac"] },
      }),
    });
    const corpo = await resposta.json();
    assertEquals(resposta.status, 503);
    assertEquals(corpo.options, undefined);
    assertEquals(typeof corpo.error, "string");
  } finally {
    globalThis.fetch = fetchOriginal;
  }
});

Deno.test("filtro de métodos habilitados: chave 'jadlog' NÃO desliga tudo — '.Package' sai normalmente (fim a fim)", async () => {
  // Reprodução do achado index-1019, sentido inverso: loja desmarca tudo
  // menos "jadlog". ".package".includes("jadlog") era false, então a única
  // opção (a Jadlog) caía, shippingOptions ficava vazio e o cliente via 503.
  const fetchOriginal = globalThis.fetch;
  globalThis.fetch = (() =>
    Promise.resolve(
      new Response(
        JSON.stringify([{ id: 7, name: ".Package", price: "31.20", delivery_time: 6 }]),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    )) as any;
  try {
    const registro = {
      inserts: [] as Array<{ tabela: string; linha: any }>,
      execucoes: [] as Array<{ tabela: string; linha: any }>,
    upserts: [] as Array<{ tabela: string; linha: any; onConflict: string | null }>,
      cacheConcluido: false,
      logConcluido: false,
    };
    const resposta = await handler(requisicaoDeCotacao(), {
      supabase: clienteFalso({
        registro,
        cacheInsert: () => Promise.resolve({ error: null }),
        config: { ...CONFIG_DA_LOJA, enabled_shipping_methods: ["jadlog"] },
      }),
    });
    const corpo = await resposta.json();
    assertEquals(resposta.status, 200);
    assertEquals(corpo.options.length, 1);
    assertEquals(corpo.options[0].id, "melhor-envio-7");
  } finally {
    globalThis.fetch = fetchOriginal;
  }
});

Deno.test("CEP de fora recebe o nome JÁ pronto na resposta da cotação (fim a fim) — 1.5.7: só PAC/SEDEX dos Correios viram econômica/expressa", async () => {
  // O fetch falso devolve os nomes reais da foto do Gabriel. REESCRITO na
  // 1.5.7 (contrato §2 + R1-7): ".Package" deixou de virar "Entrega
  // econômica" — com vários provedores o nome não pode sugerir ranking nem
  // esconder a transportadora; vira "Jadlog — .Package".
  const fetchOriginal = globalThis.fetch;
  globalThis.fetch = (() =>
    Promise.resolve(
      new Response(
        JSON.stringify([
          { id: 1, name: "SEDEX", price: "12.68", delivery_time: 2, company: { name: "Correios" } },
          { id: 2, name: ".Package", price: "16.84", delivery_time: 7, company: { name: "Jadlog" } },
          { id: 3, name: ".Package Centralizado", price: "23.99", delivery_time: 9, company: { name: "Jadlog" } },
        ]),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    )) as any;
  try {
    const registro = {
      inserts: [] as Array<{ tabela: string; linha: any }>,
      execucoes: [] as Array<{ tabela: string; linha: any }>,
    upserts: [] as Array<{ tabela: string; linha: any; onConflict: string | null }>,
      cacheConcluido: false,
      logConcluido: false,
    };
    const resposta = await handler(requisicaoDeCotacao(), {
      supabase: clienteFalso({ registro, cacheInsert: () => Promise.resolve({ error: null }) }),
    });
    const corpo = await resposta.json();
    assertEquals(resposta.status, 200);
    assertEquals(corpo.options.map((o: any) => o.name), [
      "Entrega expressa",
      "Jadlog — .Package",
      "Jadlog — .Package Centralizado",
    ]);
    // Os ids ficam intactos: é por eles que a RPC do pedido valida o preço.
    assertEquals(corpo.options.map((o: any) => o.id), [
      "melhor-envio-1",
      "melhor-envio-2",
      "melhor-envio-3",
    ]);
  } finally {
    globalThis.fetch = fetchOriginal;
  }
});

const CONFIG_DA_LOJA = {
  origin_cep: "38500-000",
  shipping_provider: "melhor_envio",
  shipping_fee: 15,
  enabled_shipping_methods: [],
  shipping_coverage: "national",
  local_delivery_fee: 10,
  local_cep_range: "",
};

/**
 * Cliente Supabase falso. Distingue as tabelas pelo nome em `from(...)`:
 * leitura devolve o que o teste configurou, escrita registra a linha em
 * `registro.inserts` e resolve pelo que o teste mandar.
 *
 * `cacheInsert` é uma FUNÇÃO que devolve a promessa da gravação — é por ela
 * que cada teste escolhe entre gravar com sucesso, devolver `{ error }` (o
 * jeito do PostgREST, que não rejeita) ou rejeitar.
 */
function clienteFalso(opts: {
  registro: {
    inserts: Array<{ tabela: string; linha: any }>;
    execucoes: Array<{ tabela: string; linha: any }>;
    cacheConcluido: boolean;
    logConcluido: boolean;
  };
  cacheInsert: () => Promise<any>;
  logInsert?: () => Promise<any>;
  config?: typeof CONFIG_DA_LOJA;
  /**
   * Simula uma exceção inesperada (não um `{ error }` do PostgREST) ao ler
   * `store_shipping_credentials` — usado para exercitar o `catch` de TOPO da
   * função (o que roda quando algo estoura DEPOIS de `store_config` já ter
   * sido lida), sem depender do caminho de falha da transportadora.
   */
  falhaAoLerCredenciais?: boolean;
  /**
   * Loja SEM linha em `store_shipping_credentials` para o provedor — o caso
   * real da transportadora não conectada. FRETE V2: a resposta tem que ser
   * "sem opções" com o motivo no histórico (a taxa fixa que servia de plano
   * B aqui foi removida).
   */
  semCredencial?: boolean;
  /**
   * Linhas de `produtos` devolvidas pela leitura `.in('id', …)` — é por aqui
   * que a marcação `frete_gratis` chega à edge (revisão A1: ela só vale no
   * preset por_produto).
   */
  produtos?: any[];
  /**
   * Linhas que a leitura de `shipping_quotes_cache` encontra para a chave
   * (origin_cep, destination_cep, cart_hash), NA ORDEM que `created_at desc`
   * devolveria — índice 0 é a mais recente. Default `[]` (miss, o caminho
   * que cota na transportadora e grava). A leitura tolerante segue valendo
   * como defesa: a UNIQUE da 20261166000000 impede duplicata NOVA, mas a
   * leitura não pode voltar a estourar se uma sobrar de antes do dedup.
   */
  cacheLookup?: Array<{ options: unknown }>;
  /**
   * RETIRADA NA LOJA (20261169000000): o endereço físico (`store_address`)
   * é lido numa consulta SEPARADA e tolerante de `store_config` — é pelas
   * colunas pedidas no `select` que o dublê distingue essa leitura da
   * leitura principal. `falhaAoLerEndereco`: "erro" = `{ error }` do
   * PostgREST (banco sem a coluna da 20261167), "excecao" = a promessa
   * rejeita.
   */
  enderecoDaLoja?: string | null;
  falhaAoLerEndereco?: "erro" | "excecao";
  /**
   * SUPERFRETE (1.5.4): credenciais POR PROVEDOR, resolvidas pelo filtro
   * `.eq('provider', x)` que o handler aplicar — é assim que o teste prova
   * que a edge lê SÓ a linha do provedor ativo (e o token certo). Provedor
   * sem entrada = sem linha (`data: null`). Ausente = o comportamento de
   * sempre (`token-de-teste` para qualquer provedor).
   */
  credenciaisPorProvedor?: Record<string, unknown>;
  /**
   * SUPERFRETE (1.5.5, `save_credentials`): o upsert em
   * `store_shipping_credentials` devolve este `{ error }` (o jeito do
   * PostgREST) — usado para provar que a falha de gravação não vaza o token.
   */
  erroAoGravarCredencial?: { message: string };
  /** 1.5.7: o uuid da linha `_revisao` (ausente = loja sem revisão, como a 1.5.6). */
  revisao?: string;
}) {
  const { registro } = opts;
  const config = opts.config ?? CONFIG_DA_LOJA;

  const leitura = (tabela: string, colunas = "") => {
    let usouSingleOuMaybeSingle = false;
    let limiteRequisitado: number | null = null;
    const filtros: Array<[string, unknown]> = [];
    const resolver = () => {
      switch (tabela) {
        case "store_config":
          if (String(colunas).includes("store_address")) {
            registro.leiturasDeEndereco = (registro.leiturasDeEndereco ?? 0) + 1;
            if (opts.falhaAoLerEndereco === "excecao") {
              return Promise.reject(new Error("conexão perdida ao ler o endereço"));
            }
            if (opts.falhaAoLerEndereco === "erro") {
              return Promise.resolve({
                data: null,
                error: { message: "column store_config.store_address does not exist", code: "42703" },
              });
            }
            return Promise.resolve({
              data: { store_address: opts.enderecoDaLoja ?? null },
              error: null,
            });
          }
          return Promise.resolve({ data: config, error: null });
        case "produtos":
          // RELEASE 1.5.7: o valor declarado/segurado vem do BANCO
          // (COALESCE da RPC); sem preço no banco o ME (com seguro) e a
          // Frenet falham fechado. O produto padrão do carrinho de teste
          // tem o preço que o navegador mandava (100) — o mesmo número de
          // antes, agora pela fonte certa.
          return Promise.resolve({ data: opts.produtos ?? [PRODUTO_PADRAO_DO_TESTE], error: null });
        case "shipping_quotes_cache": {
          const linhas = opts.cacheLookup ?? [];
          if (usouSingleOuMaybeSingle) {
            // `.maybeSingle()`/`.single()` de verdade ESTOURAM quando mais
            // de uma linha bate no filtro — é a trava do index-880: sem
            // UNIQUE em (origin_cep, destination_cep, cart_hash), duas
            // cotações concorrentes da mesma chave inserem duas linhas e
            // toda leitura seguinte passa a cair aqui.
            if (linhas.length > 1) {
              return Promise.resolve({
                data: null,
                error: {
                  message: "JSON object requested, multiple (or no) rows returned",
                  code: "PGRST116",
                },
              });
            }
            return Promise.resolve({ data: linhas[0] ?? null, error: null });
          }
          // Sem `.single()`/`.maybeSingle()` o formato do supabase-js é um
          // ARRAY — é dele que a leitura tolerante (`order` + `limit`) do
          // index-880 depende para nunca estourar com duplicata.
          const linhasLimitadas = limiteRequisitado != null ? linhas.slice(0, limiteRequisitado) : linhas;
          return Promise.resolve({ data: linhasLimitadas, error: null });
        }
        case "store_shipping_credentials": {
          // RELEASE 1.5.7: a cotação lê `_revisao` (maybeSingle com
          // `.eq('provider','_revisao')`) ANTES da config e depois TODAS as
          // linhas numa consulta só (`select('provider, credentials,
          // updated_at')`, sem filtro, array). As ações de admin também leem
          // todas as linhas. O dublê responde às duas formas.
          const filtroDoProvedor = filtros.find(([coluna]) => coluna === "provider");
          if (filtroDoProvedor && String(filtroDoProvedor[1]) === "_revisao") {
            registro.leiturasDeRevisao = (registro.leiturasDeRevisao ?? 0) + 1;
            return Promise.resolve({ data: opts.revisao ? { credentials: { revisao: opts.revisao } } : null, error: null });
          }
          if (opts.falhaAoLerCredenciais) {
            return Promise.reject(new Error("conexão perdida ao buscar credenciais"));
          }
          registro.leiturasDeCredencial = registro.leiturasDeCredencial ?? [];
          registro.leiturasDeCredencial.push({ colunas, filtros: [...filtros] });
          const porProvedor: Record<string, unknown> = opts.semCredencial
            ? {}
            : opts.credenciaisPorProvedor ?? {
              melhor_envio: { token: "token-de-teste" },
              superfrete: { token: "token-de-teste" },
              frenet: { token: "token-de-teste" },
            };
          const linhas = Object.entries(porProvedor)
            .filter(([, credenciais]) => credenciais !== undefined)
            .map(([provider, credentials]) => ({ provider, credentials, updated_at: "2026-09-01T00:00:00.000Z" }));
          if (filtroDoProvedor) {
            const linha = linhas.find((l) => l.provider === String(filtroDoProvedor[1]));
            return Promise.resolve({ data: linha ? { credentials: linha.credentials } : null, error: null });
          }
          return Promise.resolve({ data: linhas, error: null });
        }
        default:
          return Promise.resolve({ data: null, error: null });
      }
    };
    // Encadeamento do PostgrestBuilder: todo filtro devolve o próprio
    // construtor; `single`/`maybeSingle`/`then` resolvem a consulta.
    const construtor: any = {
      select: () => construtor,
      eq: (coluna: string, valor: unknown) => {
        filtros.push([coluna, valor]);
        return construtor;
      },
      gt: () => construtor,
      lt: () => construtor,
      in: () => construtor,
      order: () => construtor,
      limit: (n: number) => {
        limiteRequisitado = n;
        return construtor;
      },
      single: () => {
        usouSingleOuMaybeSingle = true;
        return resolver();
      },
      maybeSingle: () => {
        usouSingleOuMaybeSingle = true;
        return resolver();
      },
      then: (ok: any, falha: any) => resolver().then(ok, falha),
    };
    return construtor;
  };

  /**
   * `.upsert(...)` do cache — o caminho ÚNICO de gravação desde a
   * 20261166000000 (a UNIQUE (origin_cep, destination_cep, cart_hash) é o
   * alvo do `onConflict`). Registra em `registro.upserts` com o alvo
   * declarado, para o teste afirmar EM QUE chave a gravação conflita.
   */
  const upsert = (tabela: string, linha: any, opcoesUpsert?: { onConflict?: string }) => {
    registro.upserts = registro.upserts ?? [];
    registro.upserts.push({
      tabela,
      linha,
      onConflict: opcoesUpsert?.onConflict ?? null,
    });
    // Mesma resolução do insert de antes: `cacheInsert` decide sucesso/erro
    // e o marcador `cacheConcluido` só liga quando a promessa termina.
    const resolver = () => {
      if (tabela === "shipping_quotes_cache") {
        return opts.cacheInsert().then(
          (r: unknown) => {
            registro.cacheConcluido = true;
            return r;
          },
          (e: unknown) => {
            registro.cacheConcluido = true;
            throw e;
          },
        );
      }
      if (tabela === "store_shipping_credentials" && opts.erroAoGravarCredencial) {
        return Promise.resolve({ error: opts.erroAoGravarCredencial });
      }
      return Promise.resolve({ error: null });
    };
    return { then: (ok: any, falha: any) => resolver().then(ok, falha) };
  };

  const escrita = (tabela: string, linha: any) => {
    registro.inserts.push({ tabela, linha });
    // `cacheConcluido` só liga quando a promessa da gravação REALMENTE
    // termina — e o marcador entra ANTES do `then` de quem chamou, então
    // quem aguardou a gravação enxerga `true`; quem não aguardou, não.
    // `logConcluido` é o mesmo marcador aplicado ao log: ele separa "o log
    // foi disparado" (o `insert` empilha em `registro.inserts` de forma
    // síncrona, dos dois jeitos) de "o log foi concluído antes de a resposta
    // sair", que é a única coisa que a lojista realmente recebe.
    //
    // `execucoes` é um TERCEIRO marcador, e ele mede outra coisa: quantas
    // vezes a consulta RODOU. `registro.inserts` acima empilha no momento em
    // que `.insert(...)` é chamado — ou seja, conta CONSTRUÇÕES. O builder do
    // supabase-js é lazy e dispara a consulta a cada `.then`, então o mesmo
    // builder consumido duas vezes grava DUAS linhas construindo UMA só: para
    // `registro.inserts` isso é indistinguível do caminho certo. Por isso a
    // contagem que prova o "uma linha por cotação" tem de ser feita aqui
    // dentro do `resolver`, que é o que o `.then` chama.
    const resolver = () => {
      registro.execucoes.push({ tabela, linha });
      if (tabela === "shipping_quotes_cache") {
        return opts.cacheInsert().then(
          (r: unknown) => {
            registro.cacheConcluido = true;
            return r;
          },
          (e: unknown) => {
            registro.cacheConcluido = true;
            throw e;
          },
        );
      }
      if (tabela === "shipping_calculation_logs") {
        const gravar = opts.logInsert ?? (() => Promise.resolve({ error: null }));
        return gravar().then(
          (r: unknown) => {
            registro.logConcluido = true;
            return r;
          },
          (e: unknown) => {
            registro.logConcluido = true;
            throw e;
          },
        );
      }
      return Promise.resolve({ error: null });
    };
    // O PostgrestBuilder real é `PromiseLike`: tem `then`, não tem `catch`.
    return { then: (ok: any, falha: any) => resolver().then(ok, falha) };
  };

  return {
    from: (tabela: string) => ({
      select: (colunas?: string) => leitura(tabela, colunas),
      insert: (linha: any) => escrita(tabela, linha),
      upsert: (linha: any, opcoesUpsert?: { onConflict?: string }) =>
        upsert(tabela, linha, opcoesUpsert),
      // 1.5.7 (R2-2): salvar configuração apaga `shipping_quotes_cache`
      // (`.delete().not('id','is',null)`). O dublê conta e responde sucesso.
      delete: () => {
        registro.deletes = [...(registro.deletes ?? []), tabela];
        const construtor: any = {
          not: () => construtor,
          then: (ok: any, falha: any) => Promise.resolve({ error: null }).then(ok, falha),
        };
        return construtor;
      },
    }),
  };
}

function requisicaoDeCotacao(extra: Record<string, unknown> = {}): Request {
  return new Request("http://localhost/calculate-shipping", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ cep: "01001-000", cart: CARRINHO_DE_TESTE, ...extra }),
  });
}

/** Roda o handler com a transportadora devolvendo UMA opção de R$ 25,50. */
async function cotar(
  cacheInsert: () => Promise<any>,
  config?: typeof CONFIG_DA_LOJA,
  logInsert?: () => Promise<any>,
  semCredencial = false,
  produtos?: any[],
) {
  const registro = {
    inserts: [] as Array<{ tabela: string; linha: any }>,
    execucoes: [] as Array<{ tabela: string; linha: any }>,
    upserts: [] as Array<{ tabela: string; linha: any; onConflict: string | null }>,
    cacheConcluido: false,
    logConcluido: false,
  };
  const fetchOriginal = globalThis.fetch;
  globalThis.fetch = (() =>
    Promise.resolve(
      new Response(
        JSON.stringify([{ id: 1, name: "PAC", price: "25.50", delivery_time: 5 }]),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    )) as any;
  try {
    const resposta = await handler(requisicaoDeCotacao(), {
      supabase: clienteFalso({ registro, cacheInsert, logInsert, config, semCredencial, produtos }),
    });
    // Instantâneo tirado no momento EXATO em que o handler respondeu. Depois
    // do `finally` abaixo (que drena o que ficou em voo) essa medida já não
    // vale nada — era assim que o teste passava sem provar coisa alguma.
    const gravadoAoResponder = registro.cacheConcluido;
    const logGravadoAoResponder = registro.logConcluido;
    const texto = await resposta.text();
    return {
      resposta,
      texto,
      corpo: JSON.parse(texto),
      registro,
      gravadoAoResponder,
      logGravadoAoResponder,
    };
  } finally {
    globalThis.fetch = fetchOriginal;
    // Drena gravação ainda em voo (que é exatamente o defeito em teste), para
    // o teste não terminar com timer pendente.
    await new Promise((r) => setTimeout(r, 30));
  }
}

// --- index-880: corrida de dois misses simultâneos derrubando o cache -----
//
// Desde a 20261166000000 a tabela tem UNIQUE (origin_cep, destination_cep,
// cart_hash) e a gravação é um `.upsert` de verdade: dois misses do MESMO
// carrinho disputam a constraint e um vira UPDATE do outro — nunca mais
// INSERT duplicado. A LEITURA tolerante abaixo segue valendo como defesa:
// duplicata que nasceu antes do dedup não pode voltar a DERRUBAR o cache.

Deno.test("cache com DUAS linhas da mesma chave (corrida de dois misses) não estoura — pega a mais recente", async () => {
  const assinatura = await assinaturaEsperada({
    config: CONFIG_DA_LOJA,
    credenciais: { melhor_envio: { token: "token-de-teste" }, superfrete: { token: "token-de-teste" }, frenet: { token: "token-de-teste" } },
  });
  const registro = {
    inserts: [] as Array<{ tabela: string; linha: any }>,
    execucoes: [] as Array<{ tabela: string; linha: any }>,
    upserts: [] as Array<{ tabela: string; linha: any; onConflict: string | null }>,
    cacheConcluido: false,
    logConcluido: false,
  };
  const fetchOriginal = globalThis.fetch;
  let transportadoraChamada = false;
  globalThis.fetch = (() => {
    transportadoraChamada = true;
    return Promise.resolve(
      new Response(
        JSON.stringify([{ id: 1, name: "PAC", price: "25.50", delivery_time: 5 }]),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
  }) as any;

  try {
    const resposta = await handler(requisicaoDeCotacao(), {
      supabase: clienteFalso({
        registro,
        cacheInsert: () => Promise.resolve({ error: null }),
        // Duas linhas da MESMA chave, na ordem que `created_at desc`
        // devolveria — índice 0 é a mais recente.
        // 1.5.7: as duas assinadas nesta configuração (senão seriam falta
        // pela assinatura, e o teste não provaria a leitura tolerante).
        cacheLookup: [
          { options: assinar([{ id: "melhor-envio-1", name: "PAC", price: 40, deliveryDays: 5, provider: "melhor_envio" }], assinatura) },
          { options: assinar([{ id: "melhor-envio-2", name: "PAC", price: 55, deliveryDays: 5, provider: "melhor_envio" }], assinatura) },
        ],
      }),
    });
    const texto = await resposta.text();
    const corpo = JSON.parse(texto);

    // Com `.maybeSingle()` a consulta ESTOURA (mais de uma linha bate no
    // filtro), o cache vira miss por erro, a transportadora é chamada de
    // novo e MAIS uma linha é inserida — o loop de 2h do index-880. Com a
    // leitura tolerante, é um HIT normal com a linha mais recente.
    assertEquals(resposta.status, 200);
    assertEquals(corpo.options[0].price, 40);
    assertEquals(transportadoraChamada, false);
  } finally {
    globalThis.fetch = fetchOriginal;
    await new Promise((r) => setTimeout(r, 30));
  }
});

Deno.test("gravação da cotação é UM .upsert com onConflict na chave tripla (20261166000000)", async () => {
  const registro = {
    inserts: [] as Array<{ tabela: string; linha: any }>,
    execucoes: [] as Array<{ tabela: string; linha: any }>,
    upserts: [] as Array<{ tabela: string; linha: any; onConflict: string | null }>,
    cacheConcluido: false,
    logConcluido: false,
  };
  const fetchOriginal = globalThis.fetch;
  globalThis.fetch = (() =>
    Promise.resolve(
      new Response(
        JSON.stringify([{ id: 1, name: "PAC", price: "25.50", delivery_time: 5 }]),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    )) as any;

  try {
    const resposta = await handler(requisicaoDeCotacao(), {
      supabase: clienteFalso({
        registro,
        cacheInsert: () => Promise.resolve({ error: null }),
      }),
    });
    await resposta.text();

    assertEquals(resposta.status, 200);
    // Um upsert, e NENHUM insert/update separado: o alvo do conflito é a
    // UNIQUE da 20261166000000 — sem ela (edge publicado antes da
    // migration), o onConflict não conflita nada e volta a ser insert
    // duplicado, exatamente o bug index-880.
    const upsertsDoCache = registro.upserts?.filter(
      (u: { tabela: string }) => u.tabela === "shipping_quotes_cache",
    ) ?? [];
    assertEquals(upsertsDoCache.length, 1);
    assertEquals(
      upsertsDoCache[0].onConflict,
      "origin_cep,destination_cep,cart_hash",
      "o onConflict tem de mirar a chave tripla da UNIQUE",
    );
    assertEquals(
      registro.inserts.some((i) => i.tabela === "shipping_quotes_cache"),
      false,
      "a gravação do cache não pode mais passar por .insert direto",
    );
  } finally {
    globalThis.fetch = fetchOriginal;
    await new Promise((r) => setTimeout(r, 30));
  }
});

Deno.test("cotação gravada com sucesso devolve o preço normalmente", async () => {
  // Controle positivo: sem ele, "o teste passa" e "o teste não exercita nada"
  // dão a mesma saída.
  const { resposta, corpo, registro } = await cotar(() => Promise.resolve({ error: null }));

  assertEquals(resposta.status, 200);
  assertEquals(corpo.options.length, 1);
  assertEquals(corpo.options[0].price, 25.5);

  const gravacao = registro.upserts?.find(
    (u: { tabela: string }) => u.tabela === "shipping_quotes_cache",
  );
  assertEquals(gravacao?.linha.destination_cep, "01001000");
  assertEquals(gravacao?.linha.origin_cep, "38500000");
  assertEquals(gravacao?.linha.options[0].price, 25.5);
});

Deno.test("a resposta só sai DEPOIS que a gravação terminou", async () => {
  // A gravação demora 5ms. Com `fireAndForget` o handler responde antes disso
  // e `gravadoAoResponder` sai `false` — que é exatamente o preço saindo com a
  // escrita ainda em voo.
  const { resposta, gravadoAoResponder } = await cotar(
    () => new Promise((resolve) => setTimeout(() => resolve({ error: null }), 5)),
  );

  assertEquals(resposta.status, 200);
  assertEquals(gravadoAoResponder, true);
});

Deno.test("gravação falha (erro do PostgREST) -> resposta é erro e NÃO leva preço", async () => {
  const { resposta, texto, corpo } = await cotar(() =>
    Promise.resolve({
      error: { message: "permission denied for table shipping_quotes_cache", code: "42501" },
    })
  );

  // Erro de verdade, não 200 disfarçado.
  assertEquals(resposta.status >= 400, true);
  assertEquals(typeof corpo.error, "string");
  // O preço não pode vazar por caminho nenhum do corpo.
  assertEquals(corpo.options, undefined);
  assertEquals(texto.includes("25.5"), false);
  // E não pode ter virado preço de contingência do `catch` de topo.
  assertEquals(corpo.fallback, undefined);
  // Sem detalhe interno de banco na mensagem que o cliente lê.
  assertEquals(texto.includes("permission denied"), false);
  assertEquals(texto.includes("42501"), false);
});

Deno.test("gravação rejeita (exceção) -> erro, e não vira preço de contingência", async () => {
  // Caminho diferente do `{ error }`: aqui a promessa REJEITA. Se a exceção
  // subir até o `catch` de topo, ele responde 200 com preço de contingência —
  // o mesmo defeito com cara nova.
  const { resposta, texto, corpo } = await cotar(() =>
    Promise.reject(new Error("connection reset by peer"))
  );

  assertEquals(resposta.status >= 400, true);
  assertEquals(typeof corpo.error, "string");
  assertEquals(corpo.options, undefined);
  assertEquals(corpo.fallback, undefined);
  assertEquals(texto.includes("25.5"), false);
  assertEquals(texto.includes("connection reset"), false);
});

// --- O log não pode pintar de verde uma cotação recusada -------------------
//
// `shipping_calculation_logs` é a ÚNICA janela da lojista para o frete
// (AdminShippingView pinta `status === 'success'` de verde "Sucesso"). Enquanto
// a resposta era 200 com preço, gravar 'success' aqui era verdade. Com a
// recusa acima, deixou de ser: numa loja em que a gravação da cotação esteja
// falhando, ninguém compra e o único lugar onde ela veria a quebra afirmava
// que estava tudo bem.

/** A linha que o handler mandou para `shipping_calculation_logs`, se mandou. */
function logDaCotacao(registro: { inserts: Array<{ tabela: string; linha: any }> }) {
  return registro.inserts.find((i) => i.tabela === "shipping_calculation_logs")?.linha;
}

for (const statusDaTransportadora of [422, 500]) {
  Deno.test(`CEP inexistente - transportadora ${statusDaTransportadora} responde ${statusDaTransportadora === 422 ? 400 : 503} e preserva o log`, async () => {
    const corpoDaTransportadora = JSON.stringify({
      errors: { postal_code: ["O campo cep_destino está invalido"] },
    });
    const registro = {
      inserts: [] as Array<{ tabela: string; linha: any }>,
      execucoes: [] as Array<{ tabela: string; linha: any }>,
    upserts: [] as Array<{ tabela: string; linha: any; onConflict: string | null }>,
      cacheConcluido: false,
      logConcluido: false,
    };
    const fetchOriginal = globalThis.fetch;
    globalThis.fetch = (() =>
      Promise.resolve(new Response(corpoDaTransportadora, { status: statusDaTransportadora }))) as any;
    try {
      const req = new Request("http://localhost/calculate-shipping", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cep: "19999-999", cart: CARRINHO_DE_TESTE }),
      });
      const resposta = await handler(req, {
        supabase: clienteFalso({
          registro,
          cacheInsert: () => Promise.resolve({ error: null }),
          logInsert: () => new Promise((resolve) => setTimeout(() => resolve({ error: null }), 5)),
        }),
      });
      assertEquals(registro.logConcluido, true);
      assertEquals(resposta.status, statusDaTransportadora === 422 ? 400 : 503);
      assertEquals(await resposta.json(), statusDaTransportadora === 422
        ? { error: "CEP não encontrado. Confira o número e tente de novo.", codigo: "cep_invalido" }
        : { error: "Não foi possível calcular o frete agora. Tente novamente em instantes." });
      assertEquals(resposta.headers.get("Access-Control-Allow-Origin"), "*");
      assertEquals(resposta.headers.get("Content-Type"), "application/json");
      assertEquals(logDaCotacao(registro).status, "error");
      assertEquals(logDaCotacao(registro).destination_cep, "19999999");
      assertEquals(logDaCotacao(registro).error_message,
        `Melhor Envio API retornou ${statusDaTransportadora}: ${corpoDaTransportadora}`);
      assertEquals(execucoesDoLog(registro), 1);
      assertEquals(registro.inserts.some((i) => i.tabela === "shipping_quotes_cache"), false);
    } finally {
      globalThis.fetch = fetchOriginal;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  });
}

Deno.test("gravação falha -> o log registra ERRO, e não 'Sucesso' verde", async () => {
  const { registro } = await cotar(() =>
    Promise.resolve({ error: { message: "permission denied", code: "42501" } })
  );

  const log = logDaCotacao(registro);
  assertEquals(typeof log, "object");
  // Qualquer coisa diferente de 'success'/'contingency' o painel já pinta de
  // vermelho; o que não pode é continuar 'success'.
  assertEquals(log.status, "error");
  assertEquals(typeof log.error_message, "string");
  assertEquals(log.error_message.length > 0, true);
});

Deno.test("gravação rejeita (exceção) -> o log também registra ERRO", async () => {
  const { registro } = await cotar(() => Promise.reject(new Error("connection reset by peer")));

  const log = logDaCotacao(registro);
  assertEquals(log.status, "error");
  assertEquals(typeof log.error_message, "string");
});

Deno.test("gravação OK -> o log continua registrando sucesso (controle)", async () => {
  const { registro } = await cotar(() => Promise.resolve({ error: null }));

  const log = logDaCotacao(registro);
  assertEquals(log.status, "success");
  assertEquals(log.error_message, null);
});

// --- Falha de cache não pode matar a opção que dispensa o cache ------------
//
// Verificado no ramo de frete das DUAS RPCs que o checkout chama —
// `create_marketplace_order_v23` e `create_marketplace_order_v24` (a v24 no
// pagamento online; a escolha está em `useOrders.ts:1060`). A definição das
// duas é a `supabase/migrations/20261081000000_a_regra_do_frete_gratis_mora_
// no_servidor.sql` (corpos verbatim da 20261040000000) e os dois ramos são
// idênticos. EMENDA FRETE V2 (03/09, "entrega fixa não faz sentido existir"):
// a ÚNICA opção resolvida sem cache é a ENTREGA LOCAL
// (`store_config.local_delivery_fee`). `flat-fee-%`, pedido sem opção e id
// não reconhecido viraram RAISE EXCEPTION no servidor — nunca mais
// `COALESCE(shipping_fee, 0)`. Só a cotação de transportadora
// (`melhor-envio-*`, `frenet-*`) cai no SELECT do cache e é recusada sem ele.
//
// Loja nacional com faixa local configurada devolve `local-delivery` JUNTO das
// opções da transportadora. Recusar o conjunto inteiro por causa do cache
// tirava da cliente uma opção que o checkout aceitaria — venda perdida sem
// motivo.

const CONFIG_COM_ENTREGA_LOCAL = {
  ...CONFIG_DA_LOJA,
  // "01001" é prefixo do CEP de destino usado em `requisicaoDeCotacao`.
  local_cep_range: "01001",
};

Deno.test("precoResolvidoSemCache espelha, um a um, os ramos da RPC", () => {
  // Resolvida pela config, sem tocar em shipping_quotes_cache:
  assertEquals(precoResolvidoSemCache("local-delivery"), true);
  // EMENDA 03/09: `flat-fee-%` deixou de ser resolvido pela loja — a RPC o
  // RECUSA com exception (era este classificador que o mantinha "vendável"
  // numa resposta de falha de cache, para o pedido morrer no último clique).
  assertEquals(precoResolvidoSemCache("flat-fee-contingency"), false);
  assertEquals(precoResolvidoSemCache("flat-fee-standard"), false);
  // Precisam da linha gravada:
  assertEquals(precoResolvidoSemCache("melhor-envio-1"), false);
  assertEquals(precoResolvidoSemCache("frenet-04014"), false);
  // Nada de casar por parecença: o lado seguro é exigir o cache.
  assertEquals(precoResolvidoSemCache("local-delivery-expressa"), false);
  assertEquals(precoResolvidoSemCache("flatfee-x"), false);
  assertEquals(precoResolvidoSemCache(""), false);
  assertEquals(precoResolvidoSemCache(undefined), false);
});

Deno.test("cliente local com loja national -> 200 só com a Entrega Local, SEM consultar transportadora nem gravar cache", async () => {
  // Pedido do Gabriel (02/09): na foto do carrinho, um CEP da própria cidade
  // listava SEDEX e .Package ao lado da Entrega Local. A regra nova: quem é
  // da cidade não vê transportadora nacional — o retorno cedo de `isLocal`
  // acontece ANTES da leitura de credenciais, do cache e da API, e por isso
  // a resposta sai com `cotacaoIncompleta: false` (a lista tem UM item e é
  // a lista INTEIRA).
  const { resposta, texto, corpo, registro } = await cotar(
    () => Promise.resolve({ error: null }),
    CONFIG_COM_ENTREGA_LOCAL,
  );

  assertEquals(resposta.status, 200);
  assertEquals(corpo.options.length, 1);
  assertEquals(corpo.options[0].id, "local-delivery");
  assertEquals(corpo.options[0].price, 10);
  // A transportadora nem entrou na conta: nenhuma cotação gravada, nenhum
  // resíduo de "melhor-envio" na resposta.
  assertEquals(
    registro.inserts.filter((i) => i.tabela === "shipping_quotes_cache").length,
    0,
  );
  assertEquals(texto.includes("melhor-envio"), false);
  assertEquals(texto.includes("25.5"), false);
  assertEquals(corpo.cotacaoIncompleta, false);
  // R3 da revisão: a cotação local continua indo para o "Histórico de
  // Cotações" do painel — era a única janela que a lojista tinha das
  // cotações locais no caminho antigo (national+isLocal até o fim).
  const logLocal = registro.inserts.find(
    (i) => i.tabela === "shipping_calculation_logs",
  );
  assertEquals(logLocal !== undefined, true);
  assertEquals((logLocal as any).linha.provider, "local");
  assertEquals((logLocal as any).linha.status, "success");
  assertEquals((logLocal as any).linha.destination_cep, "01001000");
});

Deno.test("gravação falha mas NADA dependia do cache -> lista inteira e cotacaoIncompleta false", async () => {
  // Variação do retorno cedo do cliente local, agora com a gravação do cache
  // SABOTADA e métodos habilitados: nada muda para quem é da cidade — a
  // transportadora nem é consultada, então a falha de gravação não tem com
  // o que ver. (Antes do retorno cedo de 02/09 este teste exercitava o
  // filtro de métodos: transportadora devolvia "PAC", loja habilitava só
  // "sedex", sobrava a entrega local. Hoje o cliente local nem chega lá.)
  const { resposta, corpo } = await cotar(
    () => Promise.resolve({ error: { message: "permission denied", code: "42501" } }),
    { ...CONFIG_COM_ENTREGA_LOCAL, enabled_shipping_methods: ["sedex"] },
  );

  assertEquals(resposta.status, 200);
  assertEquals(corpo.options.map((o: any) => o.id), ["local-delivery"]);
  assertEquals(corpo.cotacaoIncompleta, false);
});

Deno.test("gravação falha e NENHUMA opção dispensa o cache -> 503 sem preço", async () => {
  // Mesma loja, sem faixa local: sobra só a transportadora, que a RPC recusa
  // sem a cotação gravada. Aqui a recusa é a resposta certa.
  const { resposta, corpo } = await cotar(() =>
    Promise.resolve({ error: { message: "permission denied", code: "42501" } })
  );

  assertEquals(resposta.status, 503);
  assertEquals(corpo.options, undefined);
  assertEquals(typeof corpo.error, "string");
});

Deno.test("o 503 só sai DEPOIS que o log de erro terminou de gravar", async () => {
  // O log demora 5ms. Com `fireAndForget` o handler responde o 503 antes
  // disso e `logGravadoAoResponder` sai `false` — a linha vermelha fica em
  // voo numa instância que pode encerrar em seguida (`EarlyDrop`), o mesmo
  // motivo pelo qual a gravação da cotação virou `await`.
  //
  // Aqui isso custa mais do que parece: `shipping_calculation_logs` é a ÚNICA
  // janela da lojista para o frete, e a falha é CORRELACIONADA — a mesma
  // causa que derruba o insert do cache (permissão, rede, banco fora) derruba
  // o insert do log. Perdida a linha, ela fica com "ninguém compra" e NENHUMA
  // linha no painel, nem verde nem vermelha.
  //
  // Custo zero: neste ramo não há preço para entregar, então esperar não tira
  // nada de ninguém.
  const { resposta, logGravadoAoResponder } = await cotar(
    () => Promise.resolve({ error: { message: "permission denied", code: "42501" } }),
    undefined,
    () => new Promise((resolve) => setTimeout(() => resolve({ error: null }), 5)),
  );

  assertEquals(resposta.status, 503);
  assertEquals(logGravadoAoResponder, true);
});

Deno.test("log de erro que REJEITA continua dando 503, e não 200 com preço", async () => {
  // O caso que a espera acima cria: a falha é CORRELACIONADA — a mesma
  // permissão que derruba o insert do cache derruba o do log —, então o log
  // que este ramo aguarda é justamente o que tem mais chance de rejeitar.
  // Sem o `.catch()`, a rejeição sobe ao `catch` de topo, que responde 200
  // com preço de contingência: o defeito exato que esta recusa existe para
  // impedir, voltando pela porta que a correção abriu.
  const { resposta, texto, corpo } = await cotar(
    () => Promise.resolve({ error: { message: "permission denied", code: "42501" } }),
    undefined,
    () => Promise.reject(new Error("permission denied for table shipping_calculation_logs")),
  );

  assertEquals(resposta.status, 503);
  assertEquals(corpo.options, undefined);
  assertEquals(corpo.fallback, undefined);
  assertEquals(texto.includes("25.5"), false);
});

Deno.test("na resposta COM preço o log continua sem segurar a resposta (controle)", async () => {
  // O outro lado da espera acima: quem espera SEMPRE atrasa o preço de toda
  // cotação bem-sucedida por causa de uma linha de auditoria. A espera é do
  // ramo de erro e só dele — sem este controle, awaitar o log em todo lugar
  // daria a mesma saída verde no teste anterior.
  const { resposta, logGravadoAoResponder } = await cotar(
    () => Promise.resolve({ error: null }),
    undefined,
    () => new Promise((resolve) => setTimeout(() => resolve({ error: null }), 5)),
  );

  assertEquals(resposta.status, 200);
  assertEquals(logGravadoAoResponder, false);
});

// --- Uma cotação, UMA linha no log ----------------------------------------
//
// O log tem DOIS consumidores: o `fireAndForget` (sempre) e o `await` do ramo
// que responde 503. O builder do supabase-js é lazy — ele dispara a consulta a
// cada `.then` —, então quem for compartilhado entre os dois decide se a
// lojista vê uma linha ou duas. Hoje o handler compartilha a Promise já
// MATERIALIZADA (`Promise.resolve(builder)`), que executa uma vez e é adotada
// pelos dois; compartilhar o BUILDER seria a "simplificação" natural, gravaria
// duas linhas e não quebraria nenhum outro teste deste arquivo.
//
// Até aqui só um comentário no `index.ts` segurava isso, e comentário não é
// teste. O que estes dois testes assertam é a CONTAGEM: presença nunca detecta
// duplicata, e `registro.inserts` também não — ele conta construções, e a
// duplicata acontece na EXECUÇÃO. Ver `execucoes` no cliente falso.

/** Quantas vezes a consulta do log RODOU (não quantas vezes foi construída). */
function execucoesDoLog(registro: { execucoes: Array<{ tabela: string; linha: any }> }) {
  return registro.execucoes.filter((e) => e.tabela === "shipping_calculation_logs").length;
}

Deno.test("resposta 200: a cotação vira UMA linha de log, não duas", async () => {
  const { resposta, registro } = await cotar(() => Promise.resolve({ error: null }));

  assertEquals(resposta.status, 200);
  assertEquals(execucoesDoLog(registro), 1);
});

Deno.test("resposta 503: o log de erro é gravado UMA vez, mesmo com dois consumidores", async () => {
  // Este é o ramo onde a duplicata mora: aqui o log é consumido DUAS vezes —
  // pelo `fireAndForget` e pelo `await` que segura o 503.
  const { resposta, registro } = await cotar(() =>
    Promise.resolve({ error: { message: "permission denied", code: "42501" } })
  );

  assertEquals(resposta.status, 503);
  // Controle, e ele vem ANTES de propósito: o log é CONSTRUÍDO uma vez tanto
  // no caminho certo quanto na duplicata, então esta asserção fica verde nos
  // dois. É ela que mostra que contar `inserts` — presença ou quantidade — não
  // protegeria nada aqui; quando a sabotagem entra, quem cai é só a linha
  // abaixo, e o fato de a queda acontecer DEPOIS desta prova que a construção
  // continuou em 1 enquanto a execução foi a 2.
  assertEquals(registro.inserts.filter((i) => i.tabela === "shipping_calculation_logs").length, 1);
  assertEquals(execucoesDoLog(registro), 1);
});

Deno.test("cliente local com gravação OK: ainda SÓ a Entrega Local (decisão de 02/09, foi DUAS até ontem)", async () => {
  // Controle da decisão do Gabriel de 02/09: até então, o cliente local
  // recebia a Entrega Local JUNTO das cotações da transportadora
  // (["local-delivery", "melhor-envio-1"]) — o prepend no fim do handler.
  // Agora o retorno cedo vence antes: uma opção só, com a gravação saudável
  // ou não (a gravação nem é alcançada — ver o teste irmão acima).
  const { resposta, corpo, registro } = await cotar(
    () => Promise.resolve({ error: null }),
    CONFIG_COM_ENTREGA_LOCAL,
  );

  assertEquals(resposta.status, 200);
  assertEquals(corpo.options.length, 1);
  assertEquals(corpo.options.map((o: any) => o.id), ["local-delivery"]);
  assertEquals(corpo.cotacaoIncompleta, false);
  assertEquals(
    registro.inserts.filter((i) => i.tabela === "shipping_quotes_cache").length,
    0,
  );
});

// --- FRETE V2: o fim do flat_fee -------------------------------------------
//
// Ordem do dono (03/09/2026): "entrega fixa não faz sentido existir, parece
// opção duplicada". O caminho de taxa fixa da edge (`getFlatFeeResponse`,
// opção "Entrega Padrão" com `store_config.shipping_fee`) foi REMOVIDO. A
// verdade nova: fora da cidade o preço vem SÓ de cotação real de
// transportadora (melhor_envio/frenet com credencial). Sem transportadora —
// por provedor `flat_fee` remanescente no config de loja antiga ou por
// credencial ausente — a resposta é a lista vazia e honesta, com o motivo no
// histórico (`shipping_calculation_logs`, status 'error') para a lojista
// entender que precisa conectar. NENHUM preço inventado em caminho nenhum.
//
// A ENTREGA LOCAL (R$ 10 etc.) fica INTACTA — provada logo abaixo.

Deno.test("provedor flat_fee remanescente (loja antiga) -> 200 SEM opções de fora, sem chamar transportadora, com log explicando", async () => {
  // O fetch falso REJEITA: se o handler chegasse a chamar a transportadora,
  // a resposta não seria a lista vazia limpa — o teste prova que a decisão
  // sai antes dela, sem explodir.
  const fetchOriginal = globalThis.fetch;
  globalThis.fetch = (() =>
    Promise.reject(new Error("NÃO DEVE SER CHAMADO: sem transportadora não há cotação"))) as any;
  try {
    const registro = {
      inserts: [] as Array<{ tabela: string; linha: any }>,
      execucoes: [] as Array<{ tabela: string; linha: any }>,
    upserts: [] as Array<{ tabela: string; linha: any; onConflict: string | null }>,
      cacheConcluido: false,
      logConcluido: false,
    };
    const resposta = await handler(requisicaoDeCotacao(), {
      supabase: clienteFalso({
        registro,
        cacheInsert: () => Promise.resolve({ error: null }),
        config: { ...CONFIG_DA_LOJA, shipping_provider: "flat_fee" },
      }),
    });
    const corpo = await resposta.json();

    // Resposta honesta: lista vazia, completa por construção.
    assertEquals(resposta.status, 200);
    assertEquals(corpo.options, []);
    assertEquals(corpo.cotacaoIncompleta, false);
    // Nenhuma cotação gravada — não há cotação.
    assertEquals(
      registro.inserts.filter((i) => i.tabela === "shipping_quotes_cache").length,
      0,
    );
    // O motivo claro para a lojista vai para o histórico, como erro.
    const log = logDaCotacao(registro);
    assertEquals(typeof log, "object");
    assertEquals(log.status, "error");
    assertEquals(typeof log.error_message, "string");
    assertEquals(log.error_message.includes("transportadora"), true);
    assertEquals(log.provider, "flat_fee");
    // E a taxa fixa do config NÃO vaza por caminho nenhum.
    assertEquals(JSON.stringify(corpo).includes("15"), false);
  } finally {
    globalThis.fetch = fetchOriginal;
    await new Promise((r) => setTimeout(r, 30));
  }
});

Deno.test("provedor AUSENTE no config (default) -> mesmo tratamento do flat_fee remanescente", async () => {
  // `storeConfig.shipping_provider || 'flat_fee'` — loja sem provedor salvo
  // cai no mesmo caminho honesto, sem explodir.
  const fetchOriginal = globalThis.fetch;
  globalThis.fetch = (() => Promise.reject(new Error("NÃO DEVE SER CHAMADO"))) as any;
  try {
    const registro = {
      inserts: [] as Array<{ tabela: string; linha: any }>,
      execucoes: [] as Array<{ tabela: string; linha: any }>,
    upserts: [] as Array<{ tabela: string; linha: any; onConflict: string | null }>,
      cacheConcluido: false,
      logConcluido: false,
    };
    const resposta = await handler(requisicaoDeCotacao(), {
      supabase: clienteFalso({
        registro,
        cacheInsert: () => Promise.resolve({ error: null }),
        config: { ...CONFIG_DA_LOJA, shipping_provider: null as any },
      }),
    });
    const corpo = await resposta.json();

    assertEquals(resposta.status, 200);
    assertEquals(corpo.options, []);
    const log = logDaCotacao(registro);
    assertEquals(log.status, "error");
  } finally {
    globalThis.fetch = fetchOriginal;
    await new Promise((r) => setTimeout(r, 30));
  }
});

Deno.test("melhor_envio SEM credencial cadastrada -> 200 sem opções + log com o motivo (conectar transportadora)", async () => {
  // Até 03/09 este ramo devolvia a taxa fixa como "Entrega Padrão" (ou, sem
  // taxa configurada, uma lista vazia muda). Agora: lista vazia SEMPRE, com
  // o motivo no histórico — e nunca um preço que a transportadora não cotou.
  // O `cotar()` stuba o fetch devolvendo PAC: se o handler chegasse a chamar
  // a transportadora (defeito), a resposta viria COM opção e o teste cairia.
  const { resposta, corpo, registro } = await cotar(
    () => Promise.resolve({ error: null }),
    undefined,
    undefined,
    true,
  );

  assertEquals(resposta.status, 200);
  assertEquals(corpo.options, []);
  assertEquals(corpo.cotacaoIncompleta, false);
  assertEquals(
    registro.inserts.filter((i) => i.tabela === "shipping_quotes_cache").length,
    0,
  );
  const log = logDaCotacao(registro);
  assertEquals(typeof log, "object");
  assertEquals(log.status, "error");
  assertEquals(typeof log.error_message, "string");
  assertEquals(log.error_message.includes("credencial"), true);
});

Deno.test("carrinho vazio -> 200 sem opções, sem explodir e SEM log de erro (nada a consertar)", async () => {
  // O ramo antigo devolvia a taxa fixa para carrinho vazio de qualquer
  // provedor. Sem flat_fee, não há o que cotar — a transportadora cobra por
  // item. E não é erro da lojista: o histórico não pode ficar vermelho por
  // um carrinho vazio.
  for (const corpoDoPedido of [
    JSON.stringify({ cep: "01001-000", cart: [] }),
    JSON.stringify({ cep: "01001-000" }),
  ]) {
    const req = new Request("http://localhost/calculate-shipping", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: corpoDoPedido,
    });
    const registro = {
      inserts: [] as Array<{ tabela: string; linha: any }>,
      execucoes: [] as Array<{ tabela: string; linha: any }>,
    upserts: [] as Array<{ tabela: string; linha: any; onConflict: string | null }>,
      cacheConcluido: false,
      logConcluido: false,
    };
    const resposta = await handler(req, {
      supabase: clienteFalso({ registro, cacheInsert: () => Promise.resolve({ error: null }) }),
    });
    const corpo = await resposta.json();

    assertEquals(resposta.status, 200);
    assertEquals(corpo.options, []);
    assertEquals(corpo.cotacaoIncompleta, false);
    assertEquals(logDaCotacao(registro), undefined);
  }
});

Deno.test("ENTREGA LOCAL INTACTA: provedor flat_fee remanescente + CEP da cidade -> só a Entrega Local R$ 10", async () => {
  // A prova de que o fim do flat_fee não tocou a entrega local: mesmo na
  // loja antiga com provedor `flat_fee` salvo, quem é da cidade continua
  // recebendo a opção local com o valor configurado — a decisão de 02/09
  // (cliente local não vê transportadora) e o valor de
  // `local_delivery_fee` intocados.
  const { resposta, corpo, registro } = await cotar(
    () => Promise.resolve({ error: null }),
    { ...CONFIG_DA_LOJA, shipping_provider: "flat_fee", local_cep_range: "01001" },
  );

  assertEquals(resposta.status, 200);
  assertEquals(corpo.options.length, 1);
  assertEquals(corpo.options[0].id, "local-delivery");
  assertEquals(corpo.options[0].name, "Entrega Local");
  assertEquals(corpo.options[0].price, 10);
  assertEquals(corpo.options[0].provider, "local");
  assertEquals(corpo.cotacaoIncompleta, false);
  // A entrega local não grava cotação no cache (retorno cedo) e o registro
  // no histórico é de SUCESSO, provider 'local'.
  assertEquals(
    registro.inserts.filter((i) => i.tabela === "shipping_quotes_cache").length,
    0,
  );
  const logLocal = registro.inserts.find(
    (i) => i.tabela === "shipping_calculation_logs",
  );
  assertEquals((logLocal as any).linha.provider, "local");
  assertEquals((logLocal as any).linha.status, "success");
});

// --- Revisão A1 (frete v2, 03/09): a marcação só vale no por_produto -------
//
// A edge honrava `produtos.frete_gratis` INCONDICIONALMENTE: loja com o frete
// grátis DESLIGADO (free_shipping_min = 0) e item marcado recebia "Frete
// Grátis (Promoção)" R$ 0 — preço que a RPC do pedido NÃO honra (ela cobra a
// entrega local real no último clique). O modelo é EXCLUSIVO: a marcação vale
// SÓ no preset por_produto (free_shipping_min < 0), mesma regra da RPC
// (20261081000000) e do carrinho — fonte única em
// src/lib/presets-de-frete-gratis.ts.

/** Item do carrinho com a marcação `frete_gratis` gravada no BANCO. */
const PRODUTO_MARCADO = [{ id: "p1", nome: "Caneca", frete_gratis: true, preco_venda: 100 }];

Deno.test("preset DESLIGADO + item marcado, CEP da cidade -> Entrega Local R$ 10, NUNCA R$ 0", async () => {
  const { resposta, corpo } = await cotar(
    () => Promise.resolve({ error: null }),
    { ...CONFIG_DA_LOJA, free_shipping_min: 0, local_cep_range: "01001" },
    undefined,
    false,
    PRODUTO_MARCADO,
  );

  assertEquals(resposta.status, 200);
  assertEquals(corpo.options.map((o: any) => o.id), ["local-delivery"]);
  assertEquals(corpo.options[0].name, "Entrega Local");
  assertEquals(corpo.options[0].price, 10);
  assertEquals(JSON.stringify(corpo).includes("free-shipping-promo"), false);
  assertEquals(JSON.stringify(corpo).includes('"price":0'), false);
});

Deno.test("preset DESLIGADO + item marcado, fora da cidade -> cotação real, NUNCA free-shipping-promo R$ 0", async () => {
  const { resposta, corpo, texto } = await cotar(
    () => Promise.resolve({ error: null }),
    { ...CONFIG_DA_LOJA, free_shipping_min: 0 },
    undefined,
    false,
    PRODUTO_MARCADO,
  );

  assertEquals(resposta.status, 200);
  // A cotação REAL da transportadora (o PAC de R$ 25,50 do fetch falso), não
  // a opção de grátis inventada.
  assertEquals(corpo.options.map((o: any) => o.id), ["melhor-envio-1"]);
  assertEquals(corpo.options[0].price, 25.5);
  assertEquals(texto.includes("free-shipping-promo"), false);
  assertEquals(texto.includes("Frete Grátis (Promoção)"), false);
});

Deno.test("controle: preset por_produto (-1) + item marcado -> o grátis CONTINUA (fora vira free-shipping-promo)", async () => {
  // O conserto da A1 não pode desligar a estratégia: com a sentinela -1
  // gravada, a marcação volta a valer e o carrinho todo-grátis recebe a
  // promoção de R$ 0 como antes.
  const { resposta, corpo } = await cotar(
    () => Promise.resolve({ error: null }),
    { ...CONFIG_DA_LOJA, free_shipping_min: -1 },
    undefined,
    false,
    PRODUTO_MARCADO,
  );

  assertEquals(resposta.status, 200);
  assertEquals(corpo.options.map((o: any) => o.id), ["free-shipping-promo"]);
  assertEquals(corpo.options[0].price, 0);
});

// --- O campo viaja nas rotas que respondem ANTES da cotação ----------------
//
// `cotacaoIncompleta` nasceu no `return` final — o caminho que fala com a
// transportadora. Mas a maioria das respostas 200 sai antes dele: cobertura
// só-local, entrega local, frete grátis, carrinho vazio, sem transportadora,
// acerto de cache e carrinho todo-grátis. O campo precisa estar ESCRITO
// (`false`) em todas — é a diferença entre "esta lista está inteira" e
// "esta é uma versão da função que não sabia responder isso".

Deno.test("resposta sem cotação de fora (flat_fee remanescente) declara a lista completa", async () => {
  const fetchOriginal = globalThis.fetch;
  globalThis.fetch = (() => Promise.reject(new Error("NÃO DEVE SER CHAMADO"))) as any;
  try {
    const registro = {
      inserts: [] as Array<{ tabela: string; linha: any }>,
      execucoes: [] as Array<{ tabela: string; linha: any }>,
    upserts: [] as Array<{ tabela: string; linha: any; onConflict: string | null }>,
      cacheConcluido: false,
      logConcluido: false,
    };
    const resposta = await handler(requisicaoDeCotacao(), {
      supabase: clienteFalso({
        registro,
        cacheInsert: () => Promise.resolve({ error: null }),
        config: { ...CONFIG_DA_LOJA, shipping_provider: "flat_fee" },
      }),
    });
    const corpo = await resposta.json();
    assertEquals(resposta.status, 200);
    assertEquals(corpo.options, []);
    // Confirma que a resposta saiu com o campo escrito, e não por omissão.
    assertEquals(corpo.cotacaoIncompleta, false);
  } finally {
    globalThis.fetch = fetchOriginal;
    await new Promise((r) => setTimeout(r, 30));
  }
});

Deno.test("cobertura só-local responde antes da cotação e mesmo assim declara a lista completa", async () => {
  const { resposta, corpo } = await cotar(
    () => Promise.resolve({ error: null }),
    { ...CONFIG_DA_LOJA, shipping_coverage: "local", local_cep_range: "01001" },
  );

  assertEquals(resposta.status, 200);
  assertEquals(corpo.options.map((o: any) => o.id), ["local-delivery"]);
  assertEquals(corpo.cotacaoIncompleta, false);
});

// --- Transportadora fora do ar não pode virar preço inventado --------------
//
// Defeito medido em 25/08/2026: quando a chamada à transportadora falha, a
// função usava `calculateSmartFallback` (estimativa por REGIÃO de CEP) e
// devolvia essa estimativa com um id `flat-fee-*`. A RPC que valida o pedido
// (`create_marketplace_order_v23`/`v24`) ignora o preço mostrado para
// qualquer id `flat-fee-%` e cobra `COALESCE(store_config.shipping_fee, 0)`
// — ver `20260960000000_variacao_obrigatoria_no_servidor.sql:223-224`. Como
// a estimativa por região quase nunca bate com a taxa fixa configurada, a
// cliente preenchia tudo, clicava em Finalizar, e ouvia "os valores do
// pedido mudaram".
//
// A correção de 25/08 mostrava a taxa fixa da loja como plano B. FRETE V2
// (03/09/2026) matou o flat_fee — e com ele o plano B inteiro: fora da
// cidade só preço de transportadora REAL. Transportadora fora do ar = falha
// fechado (503), COM ou SEM taxa fixa no config.

/** Roda o handler com a transportadora FALHANDO (o `fetch` rejeita). */
async function cotarComTransportadoraFora(config?: typeof CONFIG_DA_LOJA) {
  const registro = {
    inserts: [] as Array<{ tabela: string; linha: any }>,
    execucoes: [] as Array<{ tabela: string; linha: any }>,
    upserts: [] as Array<{ tabela: string; linha: any; onConflict: string | null }>,
    cacheConcluido: false,
    logConcluido: false,
  };
  const fetchOriginal = globalThis.fetch;
  globalThis.fetch = (() =>
    Promise.reject(new Error("network error: carrier unreachable"))) as any;
  try {
    const resposta = await handler(requisicaoDeCotacao(), {
      supabase: clienteFalso({
        registro,
        cacheInsert: () => Promise.resolve({ error: null }),
        config,
      }),
    });
    const texto = await resposta.text();
    return { resposta, texto, corpo: JSON.parse(texto), registro };
  } finally {
    globalThis.fetch = fetchOriginal;
    await new Promise((r) => setTimeout(r, 30));
  }
}

// CONFIG_DA_LOJA.shipping_fee é 15 — valor que coincide com o PISO que
// `calculateSmartFallback` devolve para região remota com baseFee baixo. Este
// config usa um valor que não coincide com NENHUM piso da escada antiga
// (15/22/38) nem com o baseFee default dela (10). No teste abaixo ele prova o
// contrário do que provava antes de 03/09: a taxa NÃO é mais cotada em
// caminho nenhum — nem como plano B, nem como contingência.
const CONFIG_TAXA_NAO_TRIVIAL = { ...CONFIG_DA_LOJA, shipping_fee: 27.5 };

Deno.test("transportadora fora do ar, loja COM taxa fixa no config: falha fechado (503) — a taxa não é mais cotada", async () => {
  // Até 03/09 este cenário devolvia 200 com "Entrega Padrão" a R$ 27,50. O
  // flat_fee morreu: sem cotação real de transportadora não há preço honesto
  // para fora da cidade — erro, sem options, sem fallback.
  const { resposta, corpo, texto, registro } = await cotarComTransportadoraFora(CONFIG_TAXA_NAO_TRIVIAL);

  assertEquals(resposta.status, 503);
  assertEquals(corpo.options, undefined);
  assertEquals(corpo.fallback, undefined);
  assertEquals(typeof corpo.error, "string");
  // Nem o valor da taxa (27.5) nem preço nenhum vaza na resposta.
  assertEquals(texto.includes("27.5"), false);
  assertEquals(texto.includes('"price"'), false);
  // O log registra o ERRO (vermelho no painel), não um sucesso.
  const log = logDaCotacao(registro);
  assertEquals(typeof log, "object");
  assertEquals(log.status, "error");
});

Deno.test("transportadora fora do ar, loja SEM taxa fixa configurada: falha fechado, sem preço inventado", async () => {
  const configSemTaxa = { ...CONFIG_DA_LOJA, shipping_fee: null };
  const { resposta, corpo, texto, registro } = await cotarComTransportadoraFora(configSemTaxa as any);

  // Erro de verdade — nunca 200 com um preço que ninguém garantiu.
  assertEquals(resposta.status >= 400, true);
  assertEquals(corpo.options, undefined);
  assertEquals(corpo.fallback, undefined);
  assertEquals(typeof corpo.error, "string");
  // Nenhum preço da escada por região pode vazar (15/22/38, nem calculado a
  // partir de baseFee 0).
  assertEquals(texto.includes('"price"'), false);

  // Este ramo não entrega preço nenhum: a resposta é 503 e ninguém compra. O
  // painel (`AdminShippingView.tsx`) pinta 'contingency' de âmbar — reservado
  // a "deu certo pelo plano B" — e só 'error' de vermelho. Gravar
  // 'contingency' aqui faria a lojista ver a tela dizendo que está tudo bem
  // numa loja em que ninguém está conseguindo comprar.
  const log = logDaCotacao(registro);
  assertEquals(typeof log, "object");
  assertEquals(log.status, "error");
});

// --- O mesmo defeito, na OUTRA metade: o catch de topo da função -----------
//
// Quando a função inteira estoura DEPOIS de `store_config` já ter sido lida
// (não é falha de transportadora — é qualquer exceção inesperada no meio do
// caminho), o `catch` de topo responde. Até 25/08 ele devolvia a escada por
// região (`precoDeContingenciaDoTopo`); até 03/09 ele devolvia a taxa fixa
// da loja como `flat-fee-fallback`. FRETE V2: sem flat_fee não há plano B de
// preço nenhum — exceção inesperada é 500 falha fechado, SEMPRE.

Deno.test("catch de topo: erro inesperado após ler a config, loja COM taxa fixa -> 500 falha fechado (a taxa não é mais contingência)", async () => {
  // Mesmo cuidado do teste equivalente de baixo: `CONFIG_TAXA_NAO_TRIVIAL`
  // (27,5) não coincide com nenhum piso da escada antiga (15/22/38) nem com
  // o literal que este `catch` já cravou no passado. Se QUALQUER preço
  // inventado voltar a vazar aqui, o teste cai.
  const registro = {
    inserts: [] as Array<{ tabela: string; linha: any }>,
    execucoes: [] as Array<{ tabela: string; linha: any }>,
    upserts: [] as Array<{ tabela: string; linha: any; onConflict: string | null }>,
    cacheConcluido: false,
    logConcluido: false,
  };
  const resposta = await handler(requisicaoDeCotacao(), {
    supabase: clienteFalso({
      registro,
      cacheInsert: () => Promise.resolve({ error: null }),
      falhaAoLerCredenciais: true,
      config: CONFIG_TAXA_NAO_TRIVIAL,
    }),
  });
  const corpo = await resposta.json();

  assertEquals(resposta.status, 500);
  assertEquals(corpo.options, undefined);
  assertEquals(corpo.fallback, undefined);
  assertEquals(typeof corpo.error, "string");
  assertEquals(JSON.stringify(corpo).includes("27.5"), false);
});

Deno.test("catch de topo: erro inesperado após ler a config, loja SEM taxa fixa -> falha fechado", async () => {
  const registro = {
    inserts: [] as Array<{ tabela: string; linha: any }>,
    execucoes: [] as Array<{ tabela: string; linha: any }>,
    upserts: [] as Array<{ tabela: string; linha: any; onConflict: string | null }>,
    cacheConcluido: false,
    logConcluido: false,
  };
  const configSemTaxa = { ...CONFIG_DA_LOJA, shipping_fee: null };
  const resposta = await handler(requisicaoDeCotacao(), {
    supabase: clienteFalso({
      registro,
      cacheInsert: () => Promise.resolve({ error: null }),
      falhaAoLerCredenciais: true,
      config: configSemTaxa as any,
    }),
  });
  const corpo = await resposta.json();

  assertEquals(resposta.status, 500);
  assertEquals(corpo.options, undefined);
  assertEquals(corpo.fallback, undefined);
});

// --- A entrega local não depende de taxa fixa nem de transportadora --------
//
// Até 03/09 este cenário exigia cuidado com a guarda da contingência de taxa
// fixa (ver histórico no git). FRETE V2: com o retorno cedo de `isLocal`
// (decisão de 02/09 — o cliente da cidade não vê transportadora) e o fim do
// flat_fee, a prova ficou direta: loja SEM taxa fixa configurada
// (`shipping_fee` nulo, valor órfão no banco), SEM credencial que sirva de
// algo e com transportadora que não devolveria opção habilitada — quem é da
// cidade recebe a Entrega Local do mesmo jeito, com o preço que a lojista
// configurou. `shipping_fee` NÃO entra nessa conta.

Deno.test("loja SEM taxa fixa e SEM transportadora útil, CEP da cidade -> 200 com local-delivery, nunca 503", async () => {
  const configLocalSemTaxa = {
    ...CONFIG_COM_ENTREGA_LOCAL,
    shipping_fee: null,
    // Nenhum método habilitado casa com "PAC" (o que a transportadora falsa
    // devolve em `cotar()`) — a lista da transportadora ficaria vazia SE ela
    // fosse consultada. Não é: o retorno cedo do cliente local vence antes.
    enabled_shipping_methods: ["sedex"],
  };
  const { resposta, corpo } = await cotar(() => Promise.resolve({ error: null }), configLocalSemTaxa);

  assertEquals(resposta.status, 200);
  assertEquals(corpo.options.map((o: any) => o.id), ["local-delivery"]);
  assertEquals(corpo.options[0].price, configLocalSemTaxa.local_delivery_fee);
});

// FRETE V2 (03/09/2026): os testes de `montarLogDaCotacaoFlatFee` saíram
// junto com a função — o log da taxa fixa só existia para o ramo que morreu.
// O formato do log "sem cotação de fora" (status 'error' com motivo) é
// provado pelos testes de handler da seção FRETE V2, logo acima.

// LAUDO 31/08 (D2): o Melhor Envio/Frenet podia pendurar a cotação para
// sempre (sem timeout — o DNS do ME já caiu de verdade, #356) e o catch de
// topo devolvia `err.message` CRU ao navegador — texto de API de terceiros
// (e de banco) indo para o cliente.

Deno.test("buscarComTempo - fetch que demora demais é ABORTADO no tempo", async () => {
  let foiAbortado = false;
  const buscarLento = (_url: string, init?: RequestInit) =>
    new Promise<Response>((_ok, falhou) => {
      init?.signal?.addEventListener("abort", () => {
        foiAbortado = true;
        falhou(new DOMException("The operation was aborted.", "AbortError"));
      });
    });

  let saida: unknown = null;
  try {
    await buscarComTempo(buscarLento as any, "https://x", {}, 10);
  } catch (e) {
    saida = e;
  }
  assertEquals(foiAbortado, true);
  assertEquals((saida as Error)?.name, "AbortError");
});

Deno.test("buscarComTempo - fetch rápido passa e leva o sinal", async () => {
  let sinalRecebido: AbortSignal | null = null;
  const buscarBom = (_url: string, init?: RequestInit) => {
    sinalRecebido = init?.signal ?? null;
    return Promise.resolve(new Response("ok"));
  };
  const resposta = await buscarComTempo(buscarBom as any, "https://x", {}, 1000);
  assertEquals(await resposta.text(), "ok");
  assertEquals(sinalRecebido instanceof AbortSignal, true);
});

Deno.test("o catch de topo NÃO devolve o texto cru do erro ao navegador", async () => {
  const supabaseFurado = {
    from: () => {
      throw new Error(
        'password authentication failed for user "supabase_admin"',
      );
    },
  };
  const req = new Request("https://edge/calculate-shipping", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ cep: "01310100", cart: [{ id: "p1", quantity: 1 }] }),
  });
  const resposta = await handler(req, { supabase: supabaseFurado });
  const corpo = await resposta.json();
  assertEquals(resposta.status, 500);
  const texto = JSON.stringify(corpo);
  assertEquals(texto.includes("password authentication"), false);
  assertEquals(texto.includes("Não foi possível calcular o frete"), true);
});

// --- index-736: a regra do por_produto tem que ser a MESMA nos três lugares -
//
// A RPC do pedido (20261081000000:294-296, :315) usa `some`: BASTA um item
// marcado para `v_has_free_shipping_item` ligar e zerar o frete do PEDIDO
// INTEIRO. O front (CartContext.tsx:803) também usa `some`. Até aqui a edge
// usava `every` para o `allFree` e, quando ele não batia (carrinho MISTO),
// caía num segundo ramo (`nonFreeCart`) que cotava só os itens NÃO marcados —
// uma TERCEIRA resposta para a mesma pergunta. Este teste prende a
// convergência com a RPC: carrinho com um item marcado e um não marcado tem
// que virar a MESMA promoção de R$ 0 que a RPC cobraria, sem consultar
// transportadora nenhuma.

Deno.test("index-736: carrinho MISTO no preset por_produto — um item marcado zera o pedido INTEIRO (mesma regra `some` da RPC)", async () => {
  const carrinhoMisto = [
    { product: { id: "p1", price: 100 }, quantity: 1 },
    { product: { id: "p2", price: 50 }, quantity: 1 },
  ];
  const registro = {
    inserts: [] as Array<{ tabela: string; linha: any }>,
    execucoes: [] as Array<{ tabela: string; linha: any }>,
    upserts: [] as Array<{ tabela: string; linha: any; onConflict: string | null }>,
    cacheConcluido: false,
    logConcluido: false,
  };
  const fetchOriginal = globalThis.fetch;
  let transportadoraChamada = false;
  globalThis.fetch = (() => {
    transportadoraChamada = true;
    return Promise.reject(
      new Error(
        "NÃO DEVE SER CHAMADO: carrinho misto no por_produto é frete grátis do pedido inteiro, sem consultar transportadora",
      ),
    );
  }) as any;
  try {
    const req = new Request("http://localhost/calculate-shipping", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cep: "01001-000", cart: carrinhoMisto }),
    });
    const resposta = await handler(req, {
      supabase: clienteFalso({
        registro,
        cacheInsert: () => Promise.resolve({ error: null }),
        config: { ...CONFIG_DA_LOJA, free_shipping_min: -1 },
        produtos: [
          { id: "p1", nome: "Marcado", frete_gratis: true, preco_venda: 100 },
          { id: "p2", nome: "Não marcado", frete_gratis: false, preco_venda: 50 },
        ],
      }),
    });
    const corpo = await resposta.json();
    assertEquals(resposta.status, 200);
    assertEquals(corpo.options.map((o: any) => o.id), ["free-shipping-promo"]);
    assertEquals(corpo.options[0].price, 0);
    assertEquals(transportadoraChamada, false);
  } finally {
    globalThis.fetch = fetchOriginal;
    await new Promise((r) => setTimeout(r, 30));
  }
});

// --- RETIRADA NA LOJA (release 1.5.3, 22/09/2026) ---------------------------
//
// A opção "Retirar na loja" (id `store-pickup`, preço 0) só sai quando os
// TRÊS requisitos valem: a loja habilitou a chave `store-pickup` em
// `enabled_shipping_methods`, tem endereço físico (`store_address` não vazio)
// e o destino é LOCAL. A RPC do pedido (migration 20261169000000) revalida
// os três. O endereço é lido numa consulta SEPARADA e tolerante: banco sem a
// coluna (loja que ainda não recebeu a 20261167) ou leitura que falha NÃO
// derrubam a cotação — só não há retirada. Endereço de fixture é FICTÍCIO.

const ENDERECO_FICTICIO = "Rua Fictícia de Teste, 100 — Centro";
const OMITIR_SINAL = Symbol("sem aceitaRetirada no corpo");

async function cotarRetirada(opts: {
  config: any;
  /**
   * O sinal do app 1.5.3 (`aceitaRetirada: true`). Padrão: presente — os
   * testes da retirada falam do app NOVO; os do app 1.5.2 passam `omitir`.
   */
  aceitaRetirada?: unknown;
  enderecoDaLoja?: string | null;
  falhaAoLerEndereco?: "erro" | "excecao";
  servicos?: Array<{ id: number; name: string; price: string; delivery_time: number }>;
}) {
  const registro: any = {
    inserts: [],
    execucoes: [],
    upserts: [],
    cacheConcluido: false,
    logConcluido: false,
  };
  const fetchOriginal = globalThis.fetch;
  globalThis.fetch = (() =>
    Promise.resolve(
      new Response(
        JSON.stringify(
          opts.servicos ?? [
            { id: 1, name: "PAC", price: "26.41", delivery_time: 8 },
            { id: 2, name: "SEDEX", price: "54.88", delivery_time: 4 },
          ],
        ),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    )) as any;
  try {
    const sinal = "aceitaRetirada" in opts ? opts.aceitaRetirada : true;
    const resposta = await handler(
      requisicaoDeCotacao(sinal === OMITIR_SINAL ? {} : { aceitaRetirada: sinal }),
      {
      supabase: clienteFalso({
        registro,
        cacheInsert: () => Promise.resolve({ error: null }),
        config: opts.config,
        enderecoDaLoja: opts.enderecoDaLoja,
        falhaAoLerEndereco: opts.falhaAoLerEndereco,
      }),
      },
    );
    const corpo = await resposta.json();
    return { resposta, corpo, registro };
  } finally {
    globalThis.fetch = fetchOriginal;
    await new Promise((r) => setTimeout(r, 30));
  }
}

const LOJA_COM_RETIRADA = {
  ...CONFIG_COM_ENTREGA_LOCAL,
  enabled_shipping_methods: ["sedex", "pac", "store-pickup"],
};

Deno.test("retirada: contrato da opção — id store-pickup, grátis, sem prazo inventado, endereço aparado", () => {
  assertEquals(opcaoDeRetirada(`  ${ENDERECO_FICTICIO}  `), {
    id: "store-pickup",
    name: "Retirar na loja",
    price: 0,
    deliveryDays: 0,
    provider: "pickup",
    pickupAddress: ENDERECO_FICTICIO,
  });
  // Sem endereço físico, não existe retirada — nunca endereço inventado.
  assertEquals(opcaoDeRetirada(null), null);
  assertEquals(opcaoDeRetirada(undefined), null);
  assertEquals(opcaoDeRetirada(""), null);
  assertEquals(opcaoDeRetirada("   \n\t "), null);
  assertEquals(opcaoDeRetirada(42), null);
});

Deno.test("retirada: cliente local + chave + endereço -> [local-delivery, store-pickup], sem transportadora nem cache", async () => {
  const { resposta, corpo, registro } = await cotarRetirada({
    config: LOJA_COM_RETIRADA,
    enderecoDaLoja: `  ${ENDERECO_FICTICIO} `,
  });
  assertEquals(resposta.status, 200);
  assertEquals(corpo.options.map((o: any) => o.id), ["local-delivery", "store-pickup"]);
  // A entrega local fica exatamente como era.
  assertEquals(corpo.options[0].price, 10);
  assertEquals(corpo.options[0].provider, "local");
  const retirada = corpo.options[1];
  assertEquals(retirada.price, 0);
  assertEquals(retirada.pickupAddress, ENDERECO_FICTICIO);
  assertEquals(retirada.provider, "pickup");
  assertEquals(corpo.cotacaoIncompleta, false);
  assertEquals(registro.upserts.length, 0);
  assertEquals(registro.leiturasDeEndereco, 1);
});

Deno.test("retirada: cobertura só-local também oferece as duas", async () => {
  const { resposta, corpo } = await cotarRetirada({
    config: { ...LOJA_COM_RETIRADA, shipping_coverage: "local" },
    enderecoDaLoja: ENDERECO_FICTICIO,
  });
  assertEquals(resposta.status, 200);
  assertEquals(corpo.options.map((o: any) => o.id), ["local-delivery", "store-pickup"]);
});

Deno.test("retirada: SEM a chave store-pickup -> só a entrega local, e o endereço nem é lido", async () => {
  for (const metodos of [["sedex", "pac"], [], null]) {
    const { corpo, registro } = await cotarRetirada({
      config: { ...CONFIG_COM_ENTREGA_LOCAL, enabled_shipping_methods: metodos },
      enderecoDaLoja: ENDERECO_FICTICIO,
    });
    assertEquals(corpo.options.map((o: any) => o.id), ["local-delivery"], `métodos ${JSON.stringify(metodos)}`);
    assertEquals(registro.leiturasDeEndereco ?? 0, 0);
  }
});

Deno.test("retirada: chave ligada mas SEM endereço físico (null, vazio, só espaços) -> só a entrega local", async () => {
  for (const endereco of [null, "", "    "]) {
    const { corpo } = await cotarRetirada({
      config: LOJA_COM_RETIRADA,
      enderecoDaLoja: endereco,
    });
    assertEquals(corpo.options.map((o: any) => o.id), ["local-delivery"], `endereço ${JSON.stringify(endereco)}`);
  }
});

Deno.test("retirada: leitura do endereço FALHA (coluna ausente ou exceção) -> 200 só com a entrega local", async () => {
  for (const falha of ["erro", "excecao"] as const) {
    const { resposta, corpo } = await cotarRetirada({
      config: LOJA_COM_RETIRADA,
      falhaAoLerEndereco: falha,
    });
    assertEquals(resposta.status, 200, falha);
    assertEquals(corpo.options.map((o: any) => o.id), ["local-delivery"], falha);
  }
});

Deno.test("retirada: CEP FORA da área -> nenhuma retirada, só transportadora", async () => {
  const { resposta, corpo, registro } = await cotarRetirada({
    config: { ...CONFIG_DA_LOJA, enabled_shipping_methods: ["sedex", "pac", "store-pickup"] },
    enderecoDaLoja: ENDERECO_FICTICIO,
  });
  assertEquals(resposta.status, 200);
  assertEquals(corpo.options.some((o: any) => o.id === "store-pickup"), false);
  assertEquals(corpo.options.map((o: any) => o.id), ["melhor-envio-1", "melhor-envio-2"]);
  // A retirada nunca entra no cache de cotação (a RPC não a procura lá).
  assertEquals(JSON.stringify(registro.upserts).includes("store-pickup"), false);
});

Deno.test("chavesDeTransportadora: a chave da retirada NÃO conta como transportadora", () => {
  assertEquals(chavesDeTransportadora(["store-pickup"]), []);
  assertEquals(chavesDeTransportadora(["sedex", "store-pickup", "pac"]), ["sedex", "pac"]);
  assertEquals(chavesDeTransportadora([]), []);
  assertEquals(chavesDeTransportadora(null), []);
});

Deno.test("filtro: ['store-pickup'] SOZINHO mantém TODAS as transportadoras, como a lista vazia (fim a fim, CEP fora)", async () => {
  const soRetirada = await cotarRetirada({
    config: { ...CONFIG_DA_LOJA, enabled_shipping_methods: ["store-pickup"] },
  });
  const vazia = await cotarRetirada({
    config: { ...CONFIG_DA_LOJA, enabled_shipping_methods: [] },
  });
  assertEquals(soRetirada.resposta.status, 200);
  assertEquals(
    soRetirada.corpo.options.map((o: any) => o.id),
    vazia.corpo.options.map((o: any) => o.id),
  );
  assertEquals(soRetirada.corpo.options.map((o: any) => o.id), ["melhor-envio-1", "melhor-envio-2"]);
});

Deno.test("filtro: ['sedex','store-pickup'] -> SÓ a sedex (a chave da retirada não liga nem desliga serviço)", async () => {
  const { resposta, corpo } = await cotarRetirada({
    config: { ...CONFIG_DA_LOJA, enabled_shipping_methods: ["sedex", "store-pickup"] },
  });
  assertEquals(resposta.status, 200);
  assertEquals(corpo.options.map((o: any) => o.id), ["melhor-envio-2"]);
});

Deno.test("precoResolvidoSemCache: a retirada é resolvida pela RPC sem cache (id exato, sem parecença)", () => {
  assertEquals(precoResolvidoSemCache("store-pickup"), true);
  assertEquals(precoResolvidoSemCache(" store-pickup"), false);
  assertEquals(precoResolvidoSemCache("store-pickup-expressa"), false);
  assertEquals(precoResolvidoSemCache("STORE-PICKUP"), false);
});

// --- O SINAL DO APP NOVO (bloqueio da revisão, 22/09/2026) -----------------
//
// O PWA atualiza por "prompt": o app 1.5.2 continua no ar depois da edge
// nova. A auto-seleção do 1.5.2 escolhe a opção MAIS BARATA (empate: menor
// prazo) — com [local-delivery, store-pickup] na resposta, ele escolheria a
// retirada sozinho e fecharia pedido de retirada que a cliente não pediu.
// Por isso a retirada só sai para quem DIZ que a entende: corpo com
// `aceitaRetirada: true` EXATO. Qualquer outro valor = app antigo.

Deno.test("retirada: app ANTIGO (sem aceitaRetirada) -> só a entrega local, e o endereço nem é lido", async () => {
  const { resposta, corpo, registro } = await cotarRetirada({
    config: LOJA_COM_RETIRADA,
    enderecoDaLoja: ENDERECO_FICTICIO,
    aceitaRetirada: OMITIR_SINAL,
  });
  assertEquals(resposta.status, 200);
  assertEquals(corpo.options.map((o: any) => o.id), ["local-delivery"]);
  assertEquals(registro.leiturasDeEndereco ?? 0, 0);
});

Deno.test("retirada: sinal que NÃO é o booleano true não conta (\"true\", 1, false, null, {}, [])", async () => {
  for (const valor of ["true", 1, false, null, {}, [true]]) {
    const { corpo } = await cotarRetirada({
      config: LOJA_COM_RETIRADA,
      enderecoDaLoja: ENDERECO_FICTICIO,
      aceitaRetirada: valor,
    });
    assertEquals(
      corpo.options.map((o: any) => o.id),
      ["local-delivery"],
      `aceitaRetirada=${JSON.stringify(valor)} não pode oferecer retirada`,
    );
  }
});

Deno.test("retirada: COM o sinal os três requisitos continuam valendo (sem chave / sem endereço -> nada)", async () => {
  const semChave = await cotarRetirada({
    config: CONFIG_COM_ENTREGA_LOCAL,
    enderecoDaLoja: ENDERECO_FICTICIO,
  });
  assertEquals(semChave.corpo.options.map((o: any) => o.id), ["local-delivery"]);
  const semEndereco = await cotarRetirada({
    config: LOJA_COM_RETIRADA,
    enderecoDaLoja: "   ",
  });
  assertEquals(semEndereco.corpo.options.map((o: any) => o.id), ["local-delivery"]);
  const comTudo = await cotarRetirada({
    config: LOJA_COM_RETIRADA,
    enderecoDaLoja: ENDERECO_FICTICIO,
  });
  assertEquals(comTudo.corpo.options.map((o: any) => o.id), ["local-delivery", "store-pickup"]);
});

// ============================================================================
// SUPERFRETE (release 1.5.4) — provedor de COTAÇÃO.
//
// Contrato da doc oficial (superfrete.readme.io, lida em 22/09/2026; nenhuma
// chamada à API foi feita): POST {base}/api/v0/calculator; base de produção
// https://api.superfrete.com, sandbox https://sandbox.superfrete.com; headers
// Authorization Bearer, User-Agent "<App> <versão> (<email>)", accept e
// content-type JSON; corpo com from/to OBJETOS, services string, options e
// products. Resposta: ARRAY por serviço. Fixture abaixo = o exemplo 200
// OFICIAL da página de cotação, literal (só o espaçamento mudou).
// Tokens e e-mail das fixtures são FICTÍCIOS.
// ============================================================================

const pacoteSF = (price: number, discount: string, format: string, h: string, w: string, l: string, weight: string, insurance: number) => ({
  price, discount, format, dimensions: { height: h, width: w, length: l }, weight, insurance_value: insurance,
});
const CORREIOS_SF = {
  id: 1,
  name: "Correios",
  picture: "https://storage.googleapis.com/sandbox-api-superfrete.appspot.com/logos/correios.png",
};
const RESPOSTA_200_OFICIAL_SF = [
  {
    id: 1, name: "PAC", price: 18.61, discount: "5.59", currency: "R$", delivery_time: 5,
    delivery_range: { min: 5, max: 5 },
    packages: [pacoteSF(18.61, "5.59", "box", "1", "10", "15", "0.003", 0)],
    additional_services: { receipt: false, own_hand: false }, company: CORREIOS_SF, has_error: false,
  },
  {
    id: 2, name: "SEDEX", price: 10.77, discount: "13.43", currency: "R$", delivery_time: 1,
    delivery_range: { min: 1, max: 1 },
    packages: [pacoteSF(10.77, "13.43", "box", "1", "10", "15", "0.003", 0)],
    additional_services: { receipt: false, own_hand: false }, company: CORREIOS_SF, has_error: false,
  },
  {
    id: 17, name: "Mini Envios", price: 13, discount: "11.21", currency: "R$", delivery_time: 8,
    delivery_range: { min: 8, max: 8 },
    packages: [pacoteSF(13, "11.21", "box", "1", "10", "15", "0.003", 0)],
    additional_services: { receipt: false, own_hand: false }, company: CORREIOS_SF, has_error: false,
  },
  {
    id: 3, name: "JADLOG.PACKAGE", price: 14.4, discount: "7.2", currency: "R$", delivery_time: 2,
    delivery_range: { min: 2, max: 2 },
    packages: [pacoteSF(14.4, "7.2", "package", "1", "8", "14", "0.1", 100)],
    additional_services: { receipt: false, own_hand: false },
    company: { id: 2, name: "jadlog", picture: "" }, has_error: false,
  },
  {
    id: 31, name: "LOGGI Econômico", price: 9.76, discount: "4.88", currency: "R$", delivery_time: 3,
    delivery_range: { min: 3, max: 3 },
    packages: [pacoteSF(9.76, "4.88", "package", "1", "8", "14", "0.1", 100)],
    additional_services: { receipt: false, own_hand: false },
    company: { id: 14, name: "loggi", picture: "" }, has_error: false,
  },
];

const TOKEN_SF = "tok-sf-FICTICIO-9f8e7d6c5b4a";
const TOKEN_ME = "tok-me-FICTICIO-1a2b3c4d5e6f";
// Release 1.5.5: o e-mail de contato técnico é da LOJA (preenchido pela
// lojista em Ajustes > Transportadoras, salvo em `credentials.contact_email`)
// e o User-Agent é montado no servidor. Até a 1.5.4 ele vinha inteiro de uma
// variável de projeto — que SAIU, sem fallback.
const EMAIL_SF = "loja@ex.com";
const UA_SF = "IKCOUS Marketplace 1.5.7 (loja@ex.com)"; // 1.5.7: a versão da release que publica a edge
const CONFIG_SF = { ...CONFIG_DA_LOJA, shipping_provider: "superfrete", enabled_shipping_methods: [] as string[] };
const SEM_UA = Symbol("variável de projeto ausente");
// O nome da variável antiga, só para PROVAR que ela não é mais lida: os
// testes rodam com ela apagada por padrão e, nos casos marcados, DEFINIDA.
const VARIAVEL_ANTIGA = "SUPERFRETE_USER_AGENT";

/** Liga/desliga a variável ANTIGA só durante `fn` e devolve a original. */
async function comUserAgent<T>(valor: string | typeof SEM_UA, fn: () => Promise<T>): Promise<T> {
  const anterior = Deno.env.get(VARIAVEL_ANTIGA);
  if (valor === SEM_UA) Deno.env.delete(VARIAVEL_ANTIGA);
  else Deno.env.set(VARIAVEL_ANTIGA, valor);
  try {
    return await fn();
  } finally {
    if (anterior === undefined) Deno.env.delete(VARIAVEL_ANTIGA);
    else Deno.env.set(VARIAVEL_ANTIGA, anterior);
  }
}

/** Tudo que passou por console.* enquanto `fn` rodava, como texto. */
async function capturarConsole<T>(fn: () => Promise<T>): Promise<{ resultado: T; saida: string }> {
  const linhas: string[] = [];
  const originais = { error: console.error, warn: console.warn, log: console.log, info: console.info };
  const guardar = (...args: unknown[]) => {
    linhas.push(args.map((a) => {
      if (a instanceof Error) return `${a.name}: ${a.message}\n${a.stack ?? ""}`;
      if (typeof a === "string") return a;
      try {
        return JSON.stringify(a);
      } catch {
        return String(a);
      }
    }).join(" "));
  };
  console.error = guardar;
  console.warn = guardar;
  console.log = guardar;
  console.info = guardar;
  try {
    const resultado = await fn();
    return { resultado, saida: linhas.join("\n") };
  } finally {
    Object.assign(console, originais);
  }
}

type ChamadaDeFetch = { url: string; init: RequestInit };

async function cotarSuperFrete(opts: {
  config?: any;
  userAgent?: string | typeof SEM_UA;
  credenciais?: Record<string, unknown>;
  responder?: (chamada: ChamadaDeFetch) => Promise<Response> | Response;
  produtos?: any[];
  cart?: any[];
  cep?: string;
  cacheLookup?: Array<{ options: unknown }>;
}) {
  const registro: any = { inserts: [], execucoes: [], upserts: [], cacheConcluido: false, logConcluido: false };
  const chamadas: ChamadaDeFetch[] = [];
  const fetchOriginal = globalThis.fetch;
  globalThis.fetch = ((url: string, init: RequestInit = {}) => {
    const chamada = { url: String(url), init };
    chamadas.push(chamada);
    const responder = opts.responder ??
      (() => new Response(JSON.stringify(RESPOSTA_200_OFICIAL_SF), { status: 200, headers: { "Content-Type": "application/json" } }));
    return Promise.resolve(responder(chamada));
  }) as any;
  try {
    const { resultado, saida } = await capturarConsole(() =>
      // 1.5.5: por padrão a variável ANTIGA fica APAGADA — o caminho feliz
      // não pode depender dela. `userAgent` só a DEFINE nos testes que
      // provam que ela deixou de ser lida.
      comUserAgent(opts.userAgent ?? SEM_UA, async () => {
        const resposta = await handler(
          new Request("http://localhost/calculate-shipping", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ cep: opts.cep ?? "01001-000", cart: opts.cart ?? CARRINHO_DE_TESTE }),
          }),
          {
            supabase: clienteFalso({
              registro,
              cacheInsert: () => Promise.resolve({ error: null }),
              config: opts.config ?? CONFIG_SF,
              produtos: opts.produtos,
              cacheLookup: opts.cacheLookup,
              credenciaisPorProvedor: opts.credenciais ??
                {
                  superfrete: { token: TOKEN_SF, sandbox: false, contact_email: EMAIL_SF },
                  melhor_envio: { token: TOKEN_ME },
                },
            }),
          },
        );
        const texto = await resposta.text();
        // Drena o log disparado sem await (a resposta 200 não o segura).
        await new Promise((r) => setTimeout(r, 30));
        return { resposta, texto };
      })
    );
    const { resposta, texto } = resultado;
    let corpo: any = null;
    try {
      corpo = JSON.parse(texto);
    } catch {
      corpo = null;
    }
    const logs = registro.inserts.filter((i: any) => i.tabela === "shipping_calculation_logs").map((i: any) => i.linha);
    return { resposta, texto, corpo, registro, chamadas, saida, logs };
  } finally {
    globalThis.fetch = fetchOriginal;
  }
}

const cabecalho = (chamada: ChamadaDeFetch, nome: string) => new Headers(chamada.init.headers as HeadersInit).get(nome);

/** As credenciais que `cotarSuperFrete` põe no banco falso por padrão. */
const CREDENCIAIS_PADRAO_DO_TESTE_SF = {
  superfrete: { token: TOKEN_SF, sandbox: false, contact_email: EMAIL_SF },
  melhor_envio: { token: TOKEN_ME },
};

/**
 * 1.5.7: a `assinaturaCotacao` que a edge espera para este estado do banco
 * falso (mesma `updated_at` fixa do dublê, sem `_revisao`). É com ela que um
 * teste monta uma linha de cache que a edge SERVE.
 */
async function assinaturaEsperada(opts: {
  config: any;
  credenciais?: Record<string, unknown>;
  produtos?: any[];
  cart?: any[];
}): Promise<string> {
  const credenciais = opts.credenciais ?? CREDENCIAIS_PADRAO_DO_TESTE_SF;
  const linhas = new Map(
    Object.entries(credenciais).map(([provider, credentials]) => [
      provider,
      { provider, credentials, updated_at: "2026-09-01T00:00:00.000Z" },
    ]),
  );
  const revisao = await edge.calcularRevisaoConfig(opts.config, linhas, null);
  const produtos = opts.produtos ?? [PRODUTO_PADRAO_DO_TESTE];
  const { itens } = edge.montarInsumos(opts.cart ?? CARRINHO_DE_TESTE, new Map(produtos.map((p: any) => [p.id, p])), new Map());
  return await edge.assinaturaDaCotacao(revisao, itens);
}

/**
 * 1.5.7: a opção sem os carimbos do servidor (`assinaturaCotacao`, hash que
 * muda com a configuração, e `revisaoCredenciais`), para comparar por valor.
 */
const semCarimbo = (opcao: any) => {
  const resto = { ...opcao };
  delete resto.assinaturaCotacao;
  delete resto.revisaoCredenciais;
  return resto;
};

/** As opções carimbadas com a assinatura (como a edge grava no cache). */
const assinar = (opcoes: any[], assinatura: string) => opcoes.map((o) => ({ ...o, assinaturaCotacao: assinatura }));

Deno.test("superfrete: corpo enviado segue a doc (from/to objetos, services pelas chaves com o Mini junto do PAC, products do BANCO, SEM seguro — 1.5.6)", async () => {
  const { resposta, chamadas } = await cotarSuperFrete({
    config: { ...CONFIG_SF, enabled_shipping_methods: ["sedex", "pac", "store-pickup"] },
    produtos: [
      { id: "p1", nome: "Caneca", preco_venda: 49.9, peso_kg: 0.45, largura_cm: 12, altura_cm: 10, comprimento_cm: 20, frete_gratis: false },
    ],
    // O navegador manda preço/peso diferentes de propósito: quem vale é o BANCO.
    cart: [
      { product: { id: "p1", price: 1 }, quantity: 2 },
      { product: { id: "p-fora-do-banco", price: 999 }, quantity: 1 },
    ],
  });
  assertEquals(resposta.status, 200);
  assertEquals(chamadas.length, 1);
  const [chamada] = chamadas;
  assertEquals(chamada.url, "https://api.superfrete.com/api/v0/calculator");
  assertEquals(chamada.init.method, "POST");
  assertEquals(cabecalho(chamada, "Authorization"), `Bearer ${TOKEN_SF}`);
  assertEquals(cabecalho(chamada, "User-Agent"), UA_SF);
  assertEquals(cabecalho(chamada, "Accept"), "application/json");
  assertEquals(cabecalho(chamada, "Content-Type"), "application/json");
  assertEquals(JSON.parse(String(chamada.init.body)), {
    from: { postal_code: "38500000" },
    to: { postal_code: "01001000" },
    // store-pickup NÃO conta; pac=1 e 17 (Mini Envios, 1.5.6), sedex=2, em ordem crescente.
    services: "1,2,17",
    // 1.5.6 (escolha do dono): sem seguro, sem mão própria, sem aviso de
    // recebimento — explícitos, mesmo com o carrinho valendo R$ 99,80.
    options: { own_hand: false, receipt: false, insurance_value: 0, use_insurance_value: false },
    products: [
      { quantity: 2, weight: 0.45, height: 10, width: 12, length: 20 },
      // Produto que o banco não conhece: padrões do Melhor Envio.
      { quantity: 1, weight: 0.3, height: 15, width: 15, length: 15 },
    ],
  });
});

Deno.test("superfrete: services por chave — jadlog=3; lista vazia = todos os serviços da doc; chave sem serviço não inventa", async () => {
  const soJadlog = await cotarSuperFrete({ config: { ...CONFIG_SF, enabled_shipping_methods: ["jadlog"] } });
  assertEquals(JSON.parse(String(soJadlog.chamadas[0].init.body)).services, "3");
  const todas = await cotarSuperFrete({ config: { ...CONFIG_SF, enabled_shipping_methods: [] } });
  assertEquals(JSON.parse(String(todas.chamadas[0].init.body)).services, "1,2,3,17,31,33");
  const soRetirada = await cotarSuperFrete({ config: { ...CONFIG_SF, enabled_shipping_methods: ["store-pickup"] } });
  assertEquals(JSON.parse(String(soRetirada.chamadas[0].init.body)).services, "1,2,3,17,31,33");
  // Chave que não é serviço da SuperFrete: nada a pedir -> não chama, 503, motivo no log.
  const semServico = await cotarSuperFrete({ config: { ...CONFIG_SF, enabled_shipping_methods: ["transportadora-inexistente"] } });
  assertEquals(semServico.chamadas.length, 0);
  assertEquals(semServico.resposta.status, 503);
  assertEquals(semServico.logs.at(-1)?.status, "error");
});

Deno.test("superfrete: sandbox SÓ com credentials.sandbox === true (\"true\" em texto vai para produção)", async () => {
  // 1.5.5: `contact_email` entra na linha salva — sem ele a API nem é chamada.
  const sandbox = await cotarSuperFrete({ credenciais: { superfrete: { token: TOKEN_SF, sandbox: true, contact_email: EMAIL_SF } } });
  assertEquals(sandbox.chamadas[0].url, "https://sandbox.superfrete.com/api/v0/calculator");
  const texto = await cotarSuperFrete({ credenciais: { superfrete: { token: TOKEN_SF, sandbox: "true", contact_email: EMAIL_SF } } });
  assertEquals(texto.chamadas[0].url, "https://api.superfrete.com/api/v0/calculator");
});

Deno.test("superfrete: a resposta 200 OFICIAL vira opções superfrete-<id> com preço numérico, prazo, provider e transportadora — e é o que vai ao cache", async () => {
  const { resposta, corpo, registro } = await cotarSuperFrete({});
  assertEquals(resposta.status, 200);
  assertEquals(corpo.cotacaoIncompleta, false);
  // 1.5.7 (reescrito): SEM o agrupamento PAC×Mini da 1.5.6 — cada serviço é
  // uma oferta. "Entrega econômica"/"expressa" só para PAC/SEDEX dos
  // Correios; o resto mostra "<transportadora> — <serviço>" como a API manda.
  // Toda opção da SuperFrete continua com a marca `cotacaoSf` e ganha os
  // carimbos do servidor (assinatura e revisão).
  const sf = (id: number, name: string, price: number, deliveryDays: number, transportadora: string, servico: string) => ({
    id: `superfrete-${id}`, name, price, deliveryDays, provider: "superfrete", cotacaoSf: 2, transportadora, servico, provedorRotulo: "SuperFrete",
  });
  assertEquals(corpo.options.map(semCarimbo), [
    sf(1, "Entrega econômica", 18.61, 5, "Correios", "PAC"),
    sf(2, "Entrega expressa", 10.77, 1, "Correios", "SEDEX"),
    sf(17, "Correios — Mini Envios", 13, 8, "Correios", "Mini Envios"),
    sf(3, "jadlog — JADLOG.PACKAGE", 14.4, 2, "jadlog", "JADLOG.PACKAGE"),
    sf(31, "loggi — LOGGI Econômico", 9.76, 3, "loggi", "LOGGI Econômico"),
  ]);
  assertEquals(corpo.options.every((o: any) => /^[0-9a-f]{64}$/.test(o.assinaturaCotacao) && o.revisaoCredenciais === null), true);
  // O MESMO objeto vai ao cache (é dele que a RPC do pedido lê o preço por id exato).
  const gravado = registro.upserts.find((u: any) => u.tabela === "shipping_quotes_cache");
  assertEquals(gravado.linha.options, corpo.options);
});

Deno.test("superfrete: chaves ['sedex','pac'] -> só PAC, Mini e SEDEX, mesmo que a API devolva Loggi/Jadlog (a guarda é o ID pedido)", async () => {
  const { corpo } = await cotarSuperFrete({ config: { ...CONFIG_SF, enabled_shipping_methods: ["sedex", "pac"] } });
  // 1.5.7: PAC e Mini vão os dois (sem agrupamento); Loggi/Jadlog não foram pedidos.
  assertEquals(corpo.options.map((o: any) => o.id), ["superfrete-1", "superfrete-2", "superfrete-17"]);
  const jad = await cotarSuperFrete({ config: { ...CONFIG_SF, enabled_shipping_methods: ["jadlog"] } });
  assertEquals(jad.corpo.options.map((o: any) => o.id), ["superfrete-3"]);
});

Deno.test("superfrete: descarta has_error, error, preço não finito/<=0/booleano, prazo inválido e item sem id", async () => {
  const base = RESPOSTA_200_OFICIAL_SF[0];
  const itens = [
    { ...base, id: 1, has_error: true },
    { ...base, id: 1, error: "Serviço indisponível" },
    { ...base, id: 1, price: "abc" },
    { ...base, id: 1, price: 0 },
    { ...base, id: 1, price: -3 },
    { ...base, id: 1, price: null },
    { ...base, id: 1, price: true },
    { ...base, id: 1, price: "Infinity" },
    { ...base, id: 1, delivery_time: 0 },
    { ...base, id: 1, delivery_time: -2 },
    { ...base, id: 1, delivery_time: "x" },
    { ...base, id: 1, delivery_time: 2.5 },
    { ...base, id: 1, delivery_time: null },
    { ...base, id: undefined },
    { ...base, id: "abc" },
    null,
    "PAC",
    // O único válido: preço em texto numérico é aceito e arredondado ao centavo.
    { ...base, id: 2, name: "SEDEX", price: "21.456", delivery_time: 3 },
  ];
  const { resposta, corpo } = await cotarSuperFrete({
    responder: () => new Response(JSON.stringify(itens), { status: 200 }),
  });
  assertEquals(resposta.status, 200);
  assertEquals(corpo.options.map(semCarimbo), [
    {
      id: "superfrete-2", name: "Entrega expressa", price: 21.46, deliveryDays: 3, provider: "superfrete", cotacaoSf: 2,
      transportadora: "Correios", servico: "SEDEX", provedorRotulo: "SuperFrete",
    },
  ]);
});

Deno.test("superfrete: todos os itens inválidos -> 503 sem preço (nada de fictício)", async () => {
  const { resposta, corpo, texto } = await cotarSuperFrete({
    responder: () => new Response(JSON.stringify([{ ...RESPOSTA_200_OFICIAL_SF[0], has_error: true }]), { status: 200 }),
  });
  assertEquals(resposta.status, 503);
  assertEquals(corpo.options, undefined);
  assertEquals(texto.includes("18.61"), false);
});

for (const [nome, corpoDaResposta] of [
  ["objeto em vez de lista", JSON.stringify({ id: 1, price: 18.61 })],
  ["JSON inválido", "<html>erro</html>"],
  ["null", "null"],
  ["vazio", ""],
] as const) {
  Deno.test(`superfrete: resposta malformada (${nome}) -> 503, sem preço, motivo no log`, async () => {
    const { resposta, corpo, logs } = await cotarSuperFrete({
      responder: () => new Response(corpoDaResposta, { status: 200 }),
    });
    assertEquals(resposta.status, 503);
    assertEquals(corpo.options, undefined);
    assertEquals(logs.at(-1)?.status, "error");
    assertEquals(typeof logs.at(-1)?.error_message, "string");
    assertEquals(logs.at(-1)?.error_message.includes("SuperFrete"), true);
  });
}

for (const status of [400, 401, 403, 429, 500, 502]) {
  Deno.test(`superfrete: HTTP ${status} -> 503 sem preço fictício, e o log diz o status`, async () => {
    const { resposta, corpo, logs, registro } = await cotarSuperFrete({
      responder: () => new Response(JSON.stringify({ message: "falhou" }), { status }),
    });
    assertEquals(resposta.status, 503);
    assertEquals(corpo.options, undefined);
    assertEquals(logs.at(-1)?.error_message.includes(String(status)), true);
    assertEquals(registro.upserts.filter((u: any) => u.tabela === "shipping_quotes_cache").length, 0);
  });
}

Deno.test("superfrete: timeout (AbortError) e falha de rede -> 503 sem preço", async () => {
  for (const erro of [new DOMException("The signal has been aborted", "AbortError"), new TypeError("error sending request")]) {
    const { resposta, corpo } = await cotarSuperFrete({ responder: () => Promise.reject(erro) });
    assertEquals(resposta.status, 503);
    assertEquals(corpo.options, undefined);
  }
});

Deno.test("superfrete: falha da API NÃO afeta o cliente local — entrega local sai sem chamar a SuperFrete", async () => {
  const { resposta, corpo, chamadas } = await cotarSuperFrete({
    config: { ...CONFIG_SF, local_cep_range: "01001" },
    responder: () => new Response("", { status: 500 }),
  });
  assertEquals(resposta.status, 200);
  assertEquals(corpo.options.map((o: any) => o.id), ["local-delivery"]);
  assertEquals(chamadas.length, 0);
});

// 1.5.5 — o User-Agent vem do e-mail DA LOJA. Estes três substituem os
// testes da 1.5.4 que exigiam a variável de projeto (ausente/vazia/espaços ->
// motivo citando o nome dela): a variável saiu, e o motivo agora manda a
// lojista preencher o campo na tela — nunca cita variável de ambiente.

Deno.test("superfrete: o User-Agent EXATO é 'IKCOUS Marketplace 1.5.7 (<e-mail salvo da loja>)' (versão da release 1.5.7)", async () => {
  const { resposta, chamadas } = await cotarSuperFrete({});
  assertEquals(resposta.status, 200);
  assertEquals(chamadas.length, 1);
  assertEquals(cabecalho(chamadas[0], "User-Agent"), "IKCOUS Marketplace 1.5.7 (loja@ex.com)");
});

Deno.test("superfrete 1.5.5: SEM contact_email salvo -> NÃO chama a API, 503, e o motivo manda preencher na tela (sem citar variável)", async () => {
  const { resposta, chamadas, logs, corpo, texto } = await cotarSuperFrete({
    credenciais: { superfrete: { token: TOKEN_SF, sandbox: false } },
  });
  assertEquals(chamadas.length, 0);
  assertEquals(resposta.status, 503);
  assertEquals(corpo.options, undefined);
  assertEquals(logs.at(-1)?.status, "error");
  assertEquals(logs.at(-1)?.error_message.includes("preencha em Ajustes > Transportadoras"), true);
  assertEquals(logs.at(-1)?.error_message.includes("e-mail de contato técnico"), true);
  assertEquals(logs.at(-1)?.error_message.includes("SUPERFRETE_USER_AGENT"), false);
  assertEquals(texto.includes("SUPERFRETE_USER_AGENT"), false);
  assertEquals(JSON.stringify(logs).includes(TOKEN_SF), false);
});

for (
  const invalido of [
    "",
    "   ",
    "sem-arroba",
    "a@b",
    "a@b.com\r\nX: y",
    "a@b.com)",
    "a b@c.com",
    `${"x".repeat(250)}@b.com`,
    // D2 (crítico, medido no Deno 2.9.2): não-ASCII no header estoura
    // ("not a valid ByteString") ou sai como Latin-1 — a RLS deixa o admin
    // gravar isso direto, então a cotação REVALIDA o salvo.
    "ő@x.com",
    "joão@x.com",
    123,
    null,
    { email: EMAIL_SF },
  ]
) {
  Deno.test(`superfrete 1.5.5: contact_email salvo INVÁLIDO (${JSON.stringify(invalido).slice(0, 30)}) -> nenhum fetch`, async () => {
    const { resposta, chamadas, logs } = await cotarSuperFrete({
      credenciais: { superfrete: { token: TOKEN_SF, sandbox: false, contact_email: invalido } },
    });
    assertEquals(chamadas.length, 0);
    assertEquals(resposta.status, 503);
    assertEquals(logs.at(-1)?.error_message.includes("preencha em Ajustes > Transportadoras"), true);
  });
}

Deno.test("superfrete 1.5.5: a variável ANTIGA DEFINIDA e sem e-mail salvo -> ainda nenhum fetch (o fallback saiu)", async () => {
  const { resposta, chamadas, logs } = await cotarSuperFrete({
    userAgent: "App Antigo 1.0 (antigo@exemplo.invalid)",
    credenciais: { superfrete: { token: TOKEN_SF, sandbox: false } },
  });
  assertEquals(chamadas.length, 0);
  assertEquals(resposta.status, 503);
  assertEquals(logs.at(-1)?.error_message.includes("SUPERFRETE_USER_AGENT"), false);
});

Deno.test("superfrete 1.5.5: a variável ANTIGA DEFINIDA NÃO troca o UA quando há e-mail salvo (o e-mail da loja manda)", async () => {
  const { chamadas } = await cotarSuperFrete({ userAgent: "App Antigo 1.0 (antigo@exemplo.invalid)" });
  assertEquals(chamadas.length, 1);
  assertEquals(cabecalho(chamadas[0], "User-Agent"), UA_SF);
});

Deno.test("superfrete 1.5.5: o e-mail salvo com espaços nas pontas vai APARADO no UA", async () => {
  const { chamadas } = await cotarSuperFrete({
    credenciais: { superfrete: { token: TOKEN_SF, sandbox: false, contact_email: "  loja@ex.com  " } },
  });
  assertEquals(cabecalho(chamadas[0], "User-Agent"), UA_SF);
});

Deno.test("superfrete 1.5.5: o cache NÃO depende do e-mail — linha da SuperFrete em cache serve mesmo sem e-mail salvo", async () => {
  // 1.5.7: linha com a marca `cotacaoSf: 2` E a assinatura desta configuração
  // (o e-mail não entra na revisão; o acerto não chama a API).
  const credenciais = { superfrete: { token: TOKEN_SF, sandbox: false } };
  const assinatura = await assinaturaEsperada({ config: CONFIG_SF, credenciais });
  const { corpo, chamadas } = await cotarSuperFrete({
    cacheLookup: [{ options: assinar([{ id: "superfrete-1", name: "Entrega econômica", price: 18.61, deliveryDays: 5, provider: "superfrete", cotacaoSf: 2 }], assinatura) }],
    credenciais,
  });
  assertEquals(chamadas.length, 0);
  assertEquals(corpo.options.map((o: any) => o.id), ["superfrete-1"]);
});

Deno.test("superfrete: SEM linha de credencial -> 200 sem opções + motivo (mesmo tratamento do ME/Frenet)", async () => {
  const { resposta, corpo, chamadas, logs } = await cotarSuperFrete({ credenciais: { melhor_envio: { token: TOKEN_ME } } });
  assertEquals(resposta.status, 200);
  assertEquals(corpo.options, []);
  assertEquals(chamadas.length, 0);
  assertEquals(logs.at(-1)?.error_message.includes("credencial"), true);
});

Deno.test("superfrete: linha SEM token -> não chama a API, 503", async () => {
  const { resposta, chamadas } = await cotarSuperFrete({ credenciais: { superfrete: { sandbox: false } } });
  assertEquals(resposta.status, 503);
  assertEquals(chamadas.length, 0);
});

// REESCRITO na 1.5.7: a cotação lê TODAS as linhas de credencial numa
// consulta só (modo multi e revisão precisam delas) — mas cada provedor usa
// SÓ o token da PRÓPRIA linha. Antes a prova era "um filtro provider=superfrete";
// agora é "uma leitura, sem filtro, e o token da SF na chamada da SF".
Deno.test("superfrete: a SF usa SÓ o token da linha provider='superfrete' (nunca o de outro provedor), numa leitura única das credenciais", async () => {
  const { chamadas, registro } = await cotarSuperFrete({});
  assertEquals(chamadas.length, 1);
  assertEquals(cabecalho(chamadas[0], "Authorization"), `Bearer ${TOKEN_SF}`);
  assertEquals(String(chamadas[0].init.body).includes(TOKEN_ME), false);
  assertEquals(registro.leiturasDeCredencial.length, 1);
  assertEquals(registro.leiturasDeCredencial[0].colunas, "provider, credentials, updated_at");
  assertEquals(registro.leiturasDeCredencial[0].filtros, []);
  // A revisão (`_revisao`) é lida à parte, antes da configuração (R3-2).
  assertEquals(registro.leiturasDeRevisao >= 1, true);
});

Deno.test("superfrete: REDACTION — API devolve 401 ecoando o token: nada vaza em log, resposta ou console", async () => {
  const { resposta, texto, logs, saida } = await cotarSuperFrete({
    responder: (chamada) =>
      new Response(
        JSON.stringify({ error: "unauthenticated", message: `token inválido: ${TOKEN_SF}`, echo: cabecalho(chamada, "Authorization") }),
        { status: 401 },
      ),
  });
  assertEquals(resposta.status, 503);
  assertEquals(texto.includes(TOKEN_SF), false);
  const log = logs.at(-1);
  assertEquals(JSON.stringify(log).includes(TOKEN_SF), false);
  assertEquals(log.error_message.includes("[redacted]"), true);
  assertEquals(log.error_message.includes("401"), true);
  assertEquals(saida.includes(TOKEN_SF), false);
});

Deno.test("superfrete: REDACTION também corta o corpo cru em ~300 caracteres", async () => {
  const { logs } = await cotarSuperFrete({
    responder: () => new Response("x".repeat(5000), { status: 500 }),
  });
  assertEquals(logs.at(-1).error_message.length <= 400, true);
});

Deno.test("REDACTION no Melhor Envio: 500 ecoando o token não vaza no log nem no console", async () => {
  const { logs, saida, texto } = await cotarSuperFrete({
    config: { ...CONFIG_DA_LOJA },
    responder: () => new Response(`erro interno; Authorization: Bearer ${TOKEN_ME}`, { status: 500 }),
  });
  assertEquals(JSON.stringify(logs).includes(TOKEN_ME), false);
  assertEquals(saida.includes(TOKEN_ME), false);
  assertEquals(texto.includes(TOKEN_ME), false);
});

Deno.test("REDACTION na Frenet: 500 ecoando o token não vaza no log", async () => {
  const { logs, saida } = await cotarSuperFrete({
    config: { ...CONFIG_DA_LOJA, shipping_provider: "frenet" },
    credenciais: { frenet: { token: "tok-frenet-FICTICIO-777" } },
    responder: () => new Response("token tok-frenet-FICTICIO-777 recusado", { status: 500 }),
  });
  assertEquals(JSON.stringify(logs).includes("tok-frenet-FICTICIO-777"), false);
  assertEquals(saida.includes("tok-frenet-FICTICIO-777"), false);
});

// --- Cache do servidor separado por provedor -------------------------------

const OPCOES_ME_EM_CACHE = [{ id: "melhor-envio-1", name: "Entrega econômica", price: 40, deliveryDays: 5, provider: "melhor_envio" }];
// 1.5.6: linha da versão ATUAL da cotação da SuperFrete (`cotacaoSf: 2`). A
// linha antiga, sem a marca, tem os testes próprios na seção da 1.5.6.
const OPCOES_SF_EM_CACHE = [{ id: "superfrete-1", name: "Entrega econômica", price: 18.61, deliveryDays: 5, provider: "superfrete", cotacaoSf: 2 }];

// REESCRITOS CONSCIENTEMENTE na 1.5.7 (os antigos L2721 e L2731, que
// supunham UM provedor por loja). Até a 1.5.6 a guarda era "a opção é do
// provedor ATUAL" (`cotacaoDoCacheServeAoProvedor`). Com vários provedores ao
// mesmo tempo, uma linha com opções de dois provedores é NORMAL — a guarda
// passou a ser a ASSINATURA: trocar de provedor muda a `revisaoConfig`
// (espelho/ligados/credencial), e a linha assinada na configuração anterior
// vira falta. Para a prova continuar forte, a linha antiga aqui está
// ASSINADA — na configuração de antes.
Deno.test("cache: linha do Melhor Envio (assinada quando a loja era ME) NÃO serve à loja que agora é SuperFrete — recota e SOBRESCREVE a mesma chave", async () => {
  const assinaturaDoMe = await assinaturaEsperada({ config: { ...CONFIG_DA_LOJA } });
  const { resposta, corpo, chamadas, registro } = await cotarSuperFrete({ cacheLookup: [{ options: assinar(OPCOES_ME_EM_CACHE, assinaturaDoMe) }] });
  assertEquals(resposta.status, 200);
  assertEquals(chamadas.length, 1);
  assertEquals(corpo.options.every((o: any) => o.provider === "superfrete"), true);
  const gravacoes = registro.upserts.filter((u: any) => u.tabela === "shipping_quotes_cache");
  assertEquals(gravacoes.length, 1);
  assertEquals(gravacoes[0].onConflict, "origin_cep,destination_cep,cart_hash");
});

Deno.test("cache: linha da SuperFrete (assinada quando a loja era SF) NÃO serve à loja que voltou ao Melhor Envio (o outro sentido)", async () => {
  const assinaturaDaSf = await assinaturaEsperada({ config: CONFIG_SF });
  const { corpo, chamadas } = await cotarSuperFrete({
    config: { ...CONFIG_DA_LOJA },
    cacheLookup: [{ options: assinar(OPCOES_SF_EM_CACHE, assinaturaDaSf) }],
    responder: () => new Response(JSON.stringify([{ id: 1, name: "PAC", price: "25.50", delivery_time: 5 }]), { status: 200 }),
  });
  assertEquals(chamadas.length, 1);
  assertEquals(corpo.options.map((o: any) => o.id), ["melhor-envio-1"]);
});

Deno.test("cache: linha MISTA serve SÓ se TODA opção tem a assinatura atual — uma opção sem ela derruba a linha", async () => {
  // 1.5.7: mistura de provedores é normal no modo multi; o que decide é a assinatura de cada opção.
  const assinatura = await assinaturaEsperada({ config: CONFIG_SF });
  const umaSemAssinatura = await cotarSuperFrete({ cacheLookup: [{ options: [...assinar(OPCOES_SF_EM_CACHE, assinatura), ...OPCOES_ME_EM_CACHE] }] });
  assertEquals(umaSemAssinatura.chamadas.length, 1);
  const todasAssinadas = await cotarSuperFrete({ cacheLookup: [{ options: assinar([...OPCOES_SF_EM_CACHE, ...OPCOES_ME_EM_CACHE], assinatura) }] });
  assertEquals(todasAssinadas.chamadas.length, 0);
});

Deno.test("cache: linha assinada nesta MESMA configuração serve sem chamar a API (controle)", async () => {
  const linha = assinar(OPCOES_SF_EM_CACHE, await assinaturaEsperada({ config: CONFIG_SF }));
  const { corpo, chamadas } = await cotarSuperFrete({ cacheLookup: [{ options: linha }] });
  assertEquals(chamadas.length, 0);
  assertEquals(corpo.options, linha);
});

Deno.test("cache: a gravação renova created_at (senão o gatilho de 2 h apaga a linha recém-atualizada e a RPC diz 'expirou')", async () => {
  // Vale para TODO provedor (o gravador é um só) — o ME entra como controle
  // de que o defeito não era da SuperFrete.
  const meResponde = () => new Response(JSON.stringify([{ id: 1, name: "PAC", price: "25.50", delivery_time: 5 }]), { status: 200 });
  for (const caso of [{ config: { ...CONFIG_DA_LOJA }, responder: meResponde }, {}]) {
    const antes = Date.now();
    const { registro } = await cotarSuperFrete(caso);
    const depois = Date.now();
    const gravacao = registro.upserts.find((u: any) => u.tabela === "shipping_quotes_cache");
    assertEquals(typeof gravacao?.linha.created_at, "string");
    const instante = Date.parse(gravacao.linha.created_at);
    assertEquals(instante >= antes - 1000 && instante <= depois + 1000, true);
  }
});

// --- Teste de conexão (action test_credentials) ----------------------------

async function testarConexao(opts: {
  corpo: Record<string, unknown>;
  admin?: boolean;
  userAgent?: string | typeof SEM_UA;
  credenciais?: Record<string, unknown>;
  responder?: (chamada: ChamadaDeFetch) => Promise<Response> | Response;
}) {
  const registro: any = { inserts: [], execucoes: [], upserts: [], cacheConcluido: false, logConcluido: false };
  const chamadas: ChamadaDeFetch[] = [];
  const fetchOriginal = globalThis.fetch;
  globalThis.fetch = ((url: string, init: RequestInit = {}) => {
    const chamada = { url: String(url), init };
    chamadas.push(chamada);
    const responder = opts.responder ??
      (() => new Response(JSON.stringify(RESPOSTA_200_OFICIAL_SF), { status: 200 }));
    return Promise.resolve(responder(chamada));
  }) as any;
  try {
    const { resultado, saida } = await capturarConsole(() =>
      // 1.5.5: variável ANTIGA apagada por padrão (ver `cotarSuperFrete`).
      comUserAgent(opts.userAgent ?? SEM_UA, async () => {
        const resposta = await handler(
          new Request("http://localhost/calculate-shipping", {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: "Bearer jwt-de-admin-ficticio" },
            body: JSON.stringify({ action: "test_credentials", ...opts.corpo }),
          }),
          {
            supabase: clienteFalso({
              registro,
              cacheInsert: () => Promise.resolve({ error: null }),
              credenciaisPorProvedor: opts.credenciais ?? {},
            }),
            verificarAdmin: () => Promise.resolve(opts.admin ?? true),
          },
        );
        return { resposta, texto: await resposta.text() };
      })
    );
    return { ...resultado, corpo: JSON.parse(resultado.texto), chamadas, saida, registro };
  } finally {
    globalThis.fetch = fetchOriginal;
  }
}

Deno.test("teste de conexão SuperFrete: quem não é admin recebe 403 e a API nem é chamada", async () => {
  const { resposta, chamadas } = await testarConexao({
    admin: false,
    corpo: { provider: "superfrete", usarCredencialSalva: true },
    credenciais: { superfrete: { token: TOKEN_SF } },
  });
  assertEquals(resposta.status, 403);
  assertEquals(chamadas.length, 0);
});

Deno.test("teste de conexão SuperFrete com usarCredencialSalva: a edge lê o token SALVO e faz uma cotação mínima (sem compra)", async () => {
  // 1.5.5: "os dois salvos" — token e e-mail vêm da linha da loja.
  const { corpo, chamadas, registro, texto } = await testarConexao({
    corpo: { provider: "superfrete", usarCredencialSalva: true },
    credenciais: { superfrete: { token: TOKEN_SF, sandbox: true, contact_email: EMAIL_SF } },
  });
  assertEquals(corpo.success, true);
  assertEquals(chamadas.length, 1);
  assertEquals(chamadas[0].url, "https://sandbox.superfrete.com/api/v0/calculator");
  assertEquals(chamadas[0].init.method, "POST");
  assertEquals(cabecalho(chamadas[0], "Authorization"), `Bearer ${TOKEN_SF}`);
  assertEquals(cabecalho(chamadas[0], "User-Agent"), UA_SF);
  // 1.5.7 (R1-8): a MESMA cotação do checkout, da origem da LOJA para
  // 01015070, com o pacote de teste 0,1 kg 16×11×4 (antes: o exemplo da doc,
  // de São Paulo para o Rio, 16×11×2 e 0,3 kg).
  const pedido = JSON.parse(String(chamadas[0].init.body));
  assertEquals(pedido.from, { postal_code: "38500000" });
  assertEquals(pedido.to, { postal_code: "01015070" });
  assertEquals(pedido.products, [{ quantity: 1, weight: 0.1, height: 4, width: 11, length: 16 }]);
  assertEquals(pedido.options, { own_hand: false, receipt: false, insurance_value: 0, use_insurance_value: false });
  // As credenciais são lidas numa consulta só (o token nunca sai daqui).
  assertEquals(registro.leiturasDeCredencial[0].filtros, []);
  assertEquals(Array.isArray(corpo.servicosTestados), true);
  assertEquals(texto.includes(TOKEN_SF), false);
});

Deno.test("teste de conexão com usarCredencialSalva SEM chave salva -> erro claro, sem chamar a API", async () => {
  for (const credenciais of [{}, { superfrete: { sandbox: false } }, { superfrete: { token: "" } }]) {
    const { resposta, corpo, chamadas } = await testarConexao({
      corpo: { provider: "superfrete", usarCredencialSalva: true },
      credenciais,
    });
    // 1.5.7: recusa de validação é 200 {success:false, error} (contrato §4) —
    // com 4xx o `functions.invoke` entrega `data: null` e a frase não chega à tela.
    assertEquals(resposta.status, 200);
    assertEquals(corpo.success, false);
    assertEquals(chamadas.length, 0);
    assertEquals(/chave/i.test(corpo.error), true);
  }
});

// 1.5.5: substitui "sem SUPERFRETE_USER_AGENT -> erro citando a variável".
// Sem e-mail nenhum (nem digitado, nem salvo) o teste não sai — e a
// orientação manda preencher o campo, mesmo com a variável ANTIGA definida.
Deno.test("teste de conexão SuperFrete com usarCredencialSalva SEM e-mail nenhum -> sem fetch, com orientação de preencher o campo", async () => {
  const { corpo, chamadas, texto } = await testarConexao({
    userAgent: "App Antigo 1.0 (antigo@exemplo.invalid)",
    corpo: { provider: "superfrete", usarCredencialSalva: true },
    credenciais: { superfrete: { token: TOKEN_SF } },
  });
  assertEquals(corpo.success, false);
  assertEquals(chamadas.length, 0);
  assertEquals(corpo.error.includes("e-mail de contato técnico"), true);
  assertEquals(corpo.error.includes("SUPERFRETE_USER_AGENT"), false);
  assertEquals(texto.includes(TOKEN_SF), false);
});

Deno.test("teste de conexão SuperFrete: e-mail DIGITADO + token DIGITADO -> UA com o e-mail digitado", async () => {
  const { corpo, chamadas } = await testarConexao({
    corpo: {
      provider: "superfrete",
      credentials: { token: "tok-sf-digitado-FICTICIO", sandbox: false, contact_email: "digitado@ex.com" },
    },
  });
  assertEquals(corpo.success, true);
  assertEquals(chamadas.length, 1);
  assertEquals(cabecalho(chamadas[0], "User-Agent"), "IKCOUS Marketplace 1.5.7 (digitado@ex.com)");
  assertEquals(cabecalho(chamadas[0], "Authorization"), "Bearer tok-sf-digitado-FICTICIO");
});

Deno.test("teste de conexão SuperFrete: usarCredencialSalva + e-mail DIGITADO -> token SALVO com o UA do digitado (vence o salvo)", async () => {
  for (const salvas of [{ token: TOKEN_SF }, { token: TOKEN_SF, contact_email: "velho@ex.com" }]) {
    const { corpo, chamadas, texto } = await testarConexao({
      corpo: { provider: "superfrete", usarCredencialSalva: true, credentials: { contact_email: "novo@ex.com" } },
      credenciais: { superfrete: salvas },
    });
    assertEquals(corpo.success, true);
    assertEquals(chamadas.length, 1);
    assertEquals(cabecalho(chamadas[0], "Authorization"), `Bearer ${TOKEN_SF}`);
    assertEquals(cabecalho(chamadas[0], "User-Agent"), "IKCOUS Marketplace 1.5.7 (novo@ex.com)");
    assertEquals(texto.includes(TOKEN_SF), false);
  }
});

Deno.test("teste de conexão SuperFrete: e-mail digitado INVÁLIDO (injeção de header) -> sem fetch, mesmo com um e-mail salvo válido", async () => {
  for (const invalido of ["a@b.com\r\nX: y", "a@b.com)", "sem-arroba"]) {
    const { corpo, chamadas } = await testarConexao({
      corpo: { provider: "superfrete", usarCredencialSalva: true, credentials: { contact_email: invalido } },
      credenciais: { superfrete: { token: TOKEN_SF, contact_email: EMAIL_SF } },
    });
    assertEquals(corpo.success, false);
    assertEquals(chamadas.length, 0);
    assertEquals(corpo.error.includes("e-mail de contato técnico"), true);
  }
});

// Painel 1.5.4 ainda em cache contra a edge 1.5.5: ele não manda e-mail
// nenhum. Sem e-mail digitado, a edge usa o SALVO da loja (lido com a service
// role depois da checagem de admin) — nos dois jeitos de testar.
Deno.test("teste de conexão SuperFrete SEM e-mail digitado cai no e-mail SALVO (token salvo e token digitado)", async () => {
  const salvo = await testarConexao({
    corpo: { provider: "superfrete", usarCredencialSalva: true },
    credenciais: { superfrete: { token: TOKEN_SF, contact_email: EMAIL_SF } },
  });
  assertEquals(salvo.corpo.success, true);
  assertEquals(cabecalho(salvo.chamadas[0], "User-Agent"), UA_SF);

  for (const emailDigitado of [undefined, "", "   "]) {
    const digitado = await testarConexao({
      corpo: {
        provider: "superfrete",
        credentials: { token: "tok-sf-digitado-FICTICIO", sandbox: false, contact_email: emailDigitado },
      },
      credenciais: { superfrete: { token: TOKEN_SF, contact_email: EMAIL_SF } },
    });
    assertEquals(digitado.corpo.success, true);
    assertEquals(cabecalho(digitado.chamadas[0], "Authorization"), "Bearer tok-sf-digitado-FICTICIO");
    assertEquals(cabecalho(digitado.chamadas[0], "User-Agent"), UA_SF);
    assertEquals(digitado.texto.includes(TOKEN_SF), false);
  }
});

Deno.test("teste de conexão SuperFrete: e-mail SALVO não-ASCII -> sem fetch, orientação em português", async () => {
  for (const salvoRuim of ["ő@x.com", "joão@x.com"]) {
    const { corpo, chamadas } = await testarConexao({
      corpo: { provider: "superfrete", usarCredencialSalva: true },
      credenciais: { superfrete: { token: TOKEN_SF, contact_email: salvoRuim } },
    });
    assertEquals(corpo.success, false);
    assertEquals(chamadas.length, 0);
    assertEquals(corpo.error.includes("e-mail de contato técnico"), true);
  }
});

Deno.test("teste de conexão SuperFrete: token DIGITADO sem e-mail -> sem fetch (a variável antiga não socorre)", async () => {
  const { corpo, chamadas } = await testarConexao({
    userAgent: "App Antigo 1.0 (antigo@exemplo.invalid)",
    corpo: { provider: "superfrete", credentials: { token: "tok-sf-digitado-FICTICIO", sandbox: false } },
  });
  assertEquals(corpo.success, false);
  assertEquals(chamadas.length, 0);
});

Deno.test("teste de conexão SuperFrete: 401 ecoando o token -> falha SEM o token na resposta nem no console", async () => {
  const { corpo, texto, saida } = await testarConexao({
    corpo: { provider: "superfrete", usarCredencialSalva: true },
    credenciais: { superfrete: { token: TOKEN_SF, contact_email: EMAIL_SF } },
    responder: () => new Response(`{"message":"bad token ${TOKEN_SF}"}`, { status: 401 }),
  });
  assertEquals(corpo.success, false);
  assertEquals(texto.includes(TOKEN_SF), false);
  assertEquals(saida.includes(TOKEN_SF), false);
  // 1.5.7 (R1-8): 401 = `chave_recusada`, com o status no `detalhe` redigido.
  assertEquals(corpo.motivo, "chave_recusada");
  assertEquals(corpo.detalhe.includes("401"), true);
});

Deno.test("teste de conexão SuperFrete: resposta 200 que não é lista -> falha (não declara conectado)", async () => {
  const { corpo, chamadas } = await testarConexao({
    corpo: { provider: "superfrete", usarCredencialSalva: true },
    credenciais: { superfrete: { token: TOKEN_SF, contact_email: EMAIL_SF } },
    responder: () => new Response("{}", { status: 200 }),
  });
  assertEquals(corpo.success, false);
  // A falha é da RESPOSTA (a API foi chamada), não da falta de e-mail.
  assertEquals(chamadas.length, 1);
});

// REESCRITOS na 1.5.7 (R1-8): o teste do ME deixou de ser o GET /api/v2/me
// ("a chave existe") e passou a ser a MESMA cotação do checkout, com o pacote
// de teste — a chave pode existir e mesmo assim não cotar nada.
const COTACAO_ME_DE_TESTE = [{ id: 1, name: "PAC", price: "20.00", delivery_time: 5, company: { name: "Correios" } }];

Deno.test("teste de conexão Melhor Envio com usarCredencialSalva: usa o token salvo numa COTAÇÃO de teste (o painel não baixa mais o token)", async () => {
  const { corpo, chamadas, texto } = await testarConexao({
    corpo: { provider: "melhor_envio", usarCredencialSalva: true },
    credenciais: { melhor_envio: { token: TOKEN_ME, sandbox: false } },
    responder: () => new Response(JSON.stringify(COTACAO_ME_DE_TESTE), { status: 200 }),
  });
  assertEquals(corpo.success, true);
  assertEquals(corpo.servicosTestados, [{ codigo: "1", ok: true, preco: 20, prazo: 5 }]);
  assertEquals(chamadas[0].url, "https://melhorenvio.com.br/api/v2/me/shipment/calculate");
  assertEquals(cabecalho(chamadas[0], "Authorization"), `Bearer ${TOKEN_ME}`);
  // R3-7: credencial ME SEM contato = o User-Agent do recuo legado.
  assertEquals(cabecalho(chamadas[0], "User-Agent"), "IKCOUS-Marketplace-Integration (contato@ikcous.com.br)");
  assertEquals(texto.includes(TOKEN_ME), false);
});

Deno.test("teste de conexão Melhor Envio: com contact_email salvo, o User-Agent leva o contato DA LOJA (R3-7) — e o e-mail não volta na resposta", async () => {
  const { corpo, chamadas, texto } = await testarConexao({
    corpo: { provider: "melhor_envio", usarCredencialSalva: true },
    credenciais: { melhor_envio: { token: TOKEN_ME, contact_email: "contato-me@ex.com" }, superfrete: { token: TOKEN_SF, contact_email: EMAIL_SF } },
    responder: () => new Response(JSON.stringify(COTACAO_ME_DE_TESTE), { status: 200 }),
  });
  assertEquals(corpo.success, true);
  assertEquals(cabecalho(chamadas[0], "User-Agent"), "IKCOUS-Marketplace-Integration (contato-me@ex.com)");
  assertEquals(texto.includes("contato-me@ex.com"), false);
  // O e-mail da SF nunca vai para o ME.
  assertEquals(cabecalho(chamadas[0], "User-Agent")?.includes(EMAIL_SF), false);
});

Deno.test("teste de conexão Melhor Envio com token DIGITADO (antes de salvar) continua funcionando, e o erro sai sem o token", async () => {
  const ok = await testarConexao({
    corpo: { provider: "melhor_envio", credentials: { token: "tok-digitado-FICTICIO", sandbox: true } },
    responder: () => new Response(JSON.stringify(COTACAO_ME_DE_TESTE), { status: 200 }),
  });
  assertEquals(ok.corpo.success, true);
  assertEquals(ok.chamadas[0].url, "https://sandbox.melhorenvio.com.br/api/v2/me/shipment/calculate");
  const falha = await testarConexao({
    corpo: { provider: "melhor_envio", credentials: { token: "tok-digitado-FICTICIO" } },
    responder: () => new Response("Unauthenticated tok-digitado-FICTICIO", { status: 401 }),
  });
  assertEquals(falha.corpo.success, false);
  assertEquals(falha.corpo.motivo, "chave_recusada");
  assertEquals(falha.texto.includes("tok-digitado-FICTICIO"), false);
});

Deno.test("teste de conexão SuperFrete com token DIGITADO usa o token do corpo", async () => {
  const { corpo, chamadas } = await testarConexao({
    corpo: {
      provider: "superfrete",
      credentials: { token: "tok-sf-digitado-FICTICIO", sandbox: false, contact_email: EMAIL_SF },
    },
  });
  assertEquals(corpo.success, true);
  assertEquals(chamadas[0].url, "https://api.superfrete.com/api/v0/calculator");
  assertEquals(cabecalho(chamadas[0], "Authorization"), "Bearer tok-sf-digitado-FICTICIO");
});

// --- Salvar a SuperFrete pelo servidor (action save_credentials, 1.5.5) -----
//
// Pedido do dono: "Se precisa de email deve ter no app para eu colocar". O
// e-mail de contato técnico vira campo da tela; a chave + o e-mail + o modo de
// testes da SuperFrete são gravados PELA EDGE (service role, depois de
// conferir admin), por lista branca. Contrato de resposta (ajuste D4 do
// crítico): recusa de VALIDAÇÃO = 200 `{ success: false, error }` (o
// `functions.invoke` perde o corpo de um 400 e a frase não chegaria à tela);
// não-admin = 403. O token NUNCA volta na resposta.

async function salvarCredenciais(opts: {
  corpo: Record<string, unknown>;
  admin?: boolean;
  credenciais?: Record<string, unknown>;
  erroAoGravarCredencial?: { message: string };
}) {
  const registro: any = { inserts: [], execucoes: [], upserts: [], cacheConcluido: false, logConcluido: false };
  const chamadas: ChamadaDeFetch[] = [];
  const fetchOriginal = globalThis.fetch;
  globalThis.fetch = ((url: string, init: RequestInit = {}) => {
    chamadas.push({ url: String(url), init });
    return Promise.resolve(new Response("[]", { status: 200 }));
  }) as any;
  try {
    const { resultado, saida } = await capturarConsole(() =>
      comUserAgent(SEM_UA, async () => {
        const resposta = await handler(
          new Request("http://localhost/calculate-shipping", {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: "Bearer jwt-de-admin-ficticio" },
            body: JSON.stringify({ action: "save_credentials", ...opts.corpo }),
          }),
          {
            supabase: clienteFalso({
              registro,
              cacheInsert: () => Promise.resolve({ error: null }),
              credenciaisPorProvedor: opts.credenciais ?? {},
              erroAoGravarCredencial: opts.erroAoGravarCredencial,
            }),
            verificarAdmin: () => Promise.resolve(opts.admin ?? true),
          },
        );
        return { resposta, texto: await resposta.text() };
      })
    );
    const gravacoes = registro.upserts.filter((u: any) => u.tabela === "store_shipping_credentials");
    return { ...resultado, corpo: JSON.parse(resultado.texto), chamadas, saida, registro, gravacoes };
  } finally {
    globalThis.fetch = fetchOriginal;
  }
}

const TOKEN_SF_NOVO = "tok-sf-NOVO-FICTICIO-0a1b2c3d";
/** 1.5.7 (R3-1): o upsert grava VÁRIAS linhas numa instrução; esta é a do provedor. */
const linhaGravada = (gravacao: any, provider: string) =>
  (Array.isArray(gravacao.linha) ? gravacao.linha : [gravacao.linha]).find((l: any) => l.provider === provider);

Deno.test("emailDeContatoValido: ASCII estrito, aparado, <= 254, sem nada que quebre um header", () => {
  assertEquals(emailDeContatoValido("loja@ex.com"), "loja@ex.com");
  assertEquals(emailDeContatoValido("  Loja.Tec+sf@sub.exemplo.com.br "), "Loja.Tec+sf@sub.exemplo.com.br");
  const limite = `${"a".repeat(64)}@${"b".repeat(63)}.${"c".repeat(63)}.${"d".repeat(57)}.com`;
  assertEquals(limite.length, 254);
  assertEquals(emailDeContatoValido(limite), limite);
  for (
    const ruim of [
      "",
      "   ",
      "sem-arroba",
      "a@b",
      "@b.com",
      "a@.com",
      "a@b.c",
      "a b@c.com",
      "a@b.com\r\nX: y",
      "a@b.com\nX: y",
      "a@b.com)",
      "a(b)@c.com",
      "<a@b.com>",
      "a@b.com,c@d.com",
      "a@b.com;",
      "joão@x.com",
      "ő@x.com",
      "a@exemplo.cöm",
      `${limite}m`,
      undefined,
      null,
      123,
      {},
    ]
  ) {
    assertEquals(emailDeContatoValido(ruim), null, `deveria recusar ${JSON.stringify(ruim)}`);
  }
});

Deno.test("save_credentials: quem não é admin recebe 403 e NADA é gravado", async () => {
  const { resposta, gravacoes, texto } = await salvarCredenciais({
    admin: false,
    corpo: { provider: "superfrete", credentials: { token: TOKEN_SF_NOVO, sandbox: false, contact_email: EMAIL_SF } },
  });
  assertEquals(resposta.status, 403);
  assertEquals(gravacoes.length, 0);
  assertEquals(texto.includes(TOKEN_SF_NOVO), false);
});

// REESCRITO na 1.5.7 (contrato §4): `save_credentials` passou a valer para os
// TRÊS provedores (ME e Frenet saíram do upsert direto do navegador). Recusa
// continua para o que não é provedor: nome errado, `_ligados`, `_revisao`.
Deno.test("save_credentials: o que NÃO é provedor é recusado (inclusive as linhas especiais _ligados e _revisao)", async () => {
  for (const provider of ["flat_fee", undefined, "SUPERFRETE", "_ligados", "_revisao"]) {
    const { resposta, corpo, gravacoes } = await salvarCredenciais({
      corpo: { provider, credentials: { token: TOKEN_SF_NOVO, contact_email: EMAIL_SF } },
    });
    assertEquals(resposta.status, 200);
    assertEquals(corpo.success, false);
    assertEquals(typeof corpo.error, "string");
    assertEquals(gravacoes.length, 0);
  }
});

Deno.test("save_credentials: e-mail vazio, inválido, não-ASCII ou com injeção de header -> recusa em português, sem gravar", async () => {
  // 1.5.7: `undefined` saiu desta lista — com o MERGE (R1-3) o e-mail AUSENTE
  // mantém o salvo (ver o teste logo abaixo). Vazio continua recusado na SF.
  for (
    const email of [
      "",
      "   ",
      "sem-arroba",
      "a@b.com\r\nX: y",
      "a@b.com)",
      "a@b.com;",
      "a@b.com,c@d.com",
      "<a@b.com>",
      "joão@x.com",
      "ő@x.com",
      `${"x".repeat(250)}@b.com`,
    ]
  ) {
    const { resposta, corpo, gravacoes, texto } = await salvarCredenciais({
      corpo: { provider: "superfrete", credentials: { token: TOKEN_SF_NOVO, sandbox: false, contact_email: email } },
      credenciais: { superfrete: { token: TOKEN_SF, sandbox: false, contact_email: EMAIL_SF } },
    });
    assertEquals(resposta.status, 200, `e-mail ${JSON.stringify(email)}`);
    assertEquals(corpo.success, false);
    assertEquals(corpo.error.includes("e-mail"), true);
    assertEquals(gravacoes.length, 0);
    assertEquals(texto.includes(TOKEN_SF_NOVO), false);
    assertEquals(texto.includes(TOKEN_SF), false);
  }
});

Deno.test("save_credentials: e-mail AUSENTE mantém o salvo (merge); ausente SEM salvo continua recusado", async () => {
  const mantido = await salvarCredenciais({
    corpo: { provider: "superfrete", credentials: { token: TOKEN_SF_NOVO, sandbox: false } },
    credenciais: { superfrete: { token: TOKEN_SF, sandbox: false, contact_email: EMAIL_SF } },
  });
  assertEquals(mantido.corpo.success, true);
  assertEquals(linhaGravada(mantido.gravacoes[0], "superfrete").credentials.contact_email, EMAIL_SF);
  const semNada = await salvarCredenciais({ corpo: { provider: "superfrete", credentials: { token: TOKEN_SF_NOVO, sandbox: false } } });
  assertEquals(semNada.corpo.success, false);
  assertEquals(semNada.corpo.error.includes("e-mail"), true);
  assertEquals(semNada.gravacoes.length, 0);
});

Deno.test("save_credentials: token NOVO + e-mail -> UM upsert com a linha 'superfrete' e a '_revisao', e a resposta SEM token", async () => {
  const { resposta, corpo, gravacoes, texto, saida, chamadas } = await salvarCredenciais({
    corpo: { provider: "superfrete", credentials: { token: `  ${TOKEN_SF_NOVO} `, sandbox: true, contact_email: " loja@ex.com " } },
  });
  assertEquals(resposta.status, 200);
  assertEquals(gravacoes.length, 1);
  assertEquals(gravacoes[0].onConflict, "provider");
  // 1.5.7 (R3-1): a linha do provedor e a `_revisao` na MESMA instrução.
  assertEquals(gravacoes[0].linha.map((l: any) => l.provider).sort(), ["_revisao", "superfrete"]);
  const linha = linhaGravada(gravacoes[0], "superfrete");
  assertEquals(linha.credentials, { token: TOKEN_SF_NOVO, sandbox: true, contact_email: EMAIL_SF });
  assertEquals(typeof linha.updated_at, "string");
  assertEquals(corpo, { success: true, tem_chave: true, servicos: null, sandbox: true, contact_email: EMAIL_SF });
  assertEquals(texto.includes(TOKEN_SF_NOVO), false);
  assertEquals(saida.includes(TOKEN_SF_NOVO), false);
  // Salvar não chama a SuperFrete (quem prova a chave é o "Testar").
  assertEquals(chamadas.length, 0);
});

// REESCRITO na 1.5.7 (contrato §4 + R1-3). A 1.5.5 DESCARTAVA em silêncio o
// campo fora da lista branca e REESCREVIA a linha só com os 3 campos (um
// `{token}` apagaria `servicos`/`seguro` da 1.5.7). Agora: campo desconhecido
// no pedido = RECUSA (nada grava), e o que já estava na linha e o pedido não
// trouxe é PRESERVADO pelo merge.
Deno.test("save_credentials: LISTA BRANCA — campo desconhecido no pedido RECUSA; campo velho da linha é PRESERVADO (merge)", async () => {
  const recusado = await salvarCredenciais({
    corpo: {
      provider: "superfrete",
      credentials: { token: TOKEN_SF_NOVO, sandbox: false, contact_email: EMAIL_SF, hack: 1, token_de_outro: "x" },
    },
    credenciais: { superfrete: { token: TOKEN_SF, sandbox: false, contact_email: "velho@ex.com", lixo: "y" } },
  });
  assertEquals(recusado.corpo.success, false);
  assertEquals(recusado.gravacoes.length, 0);
  // Token vazio (mantém o salvo) + só campos permitidos: o `lixo` antigo fica.
  const mantido = await salvarCredenciais({
    corpo: { provider: "superfrete", credentials: { token: "", contact_email: EMAIL_SF } },
    credenciais: { superfrete: { token: TOKEN_SF, sandbox: false, contact_email: "velho@ex.com", lixo: "y" } },
  });
  assertEquals(linhaGravada(mantido.gravacoes[0], "superfrete").credentials, { token: TOKEN_SF, sandbox: false, contact_email: EMAIL_SF, lixo: "y" });
});

Deno.test("save_credentials: token VAZIO com token salvo -> mantém o token salvo (lido com a service role) e troca o e-mail", async () => {
  for (const token of [undefined, "", "   "]) {
    const { corpo, gravacoes, registro, texto } = await salvarCredenciais({
      corpo: { provider: "superfrete", credentials: { token, contact_email: "novo@ex.com" } },
      credenciais: { superfrete: { token: TOKEN_SF, sandbox: true, contact_email: "velho@ex.com" } },
    });
    assertEquals(corpo, { success: true, tem_chave: true, servicos: null, sandbox: true, contact_email: "novo@ex.com" });
    assertEquals(gravacoes.length, 1);
    assertEquals(linhaGravada(gravacoes[0], "superfrete").credentials, { token: TOKEN_SF, sandbox: true, contact_email: "novo@ex.com" });
    // 1.5.7: a linha salva é lida na leitura única das credenciais (service role, depois do admin).
    assertEquals(registro.leiturasDeCredencial[0].filtros, []);
    assertEquals(texto.includes(TOKEN_SF), false);
  }
});

Deno.test("save_credentials: token vazio SEM token salvo -> 'Cole a chave de acesso da SuperFrete.', sem gravar", async () => {
  for (const credenciais of [{}, { superfrete: { sandbox: false } }, { superfrete: { token: "" } }, { superfrete: { token: 42 } }]) {
    const { resposta, corpo, gravacoes } = await salvarCredenciais({
      corpo: { provider: "superfrete", credentials: { contact_email: EMAIL_SF } },
      credenciais,
    });
    assertEquals(resposta.status, 200);
    assertEquals(corpo, { success: false, error: "Cole a chave de acesso da SuperFrete." });
    assertEquals(gravacoes.length, 0);
  }
});

Deno.test("save_credentials: trocar o modo de testes SEM token novo é recusado; o mesmo modo passa", async () => {
  const trocou = await salvarCredenciais({
    corpo: { provider: "superfrete", credentials: { sandbox: true, contact_email: EMAIL_SF } },
    credenciais: { superfrete: { token: TOKEN_SF, sandbox: false, contact_email: EMAIL_SF } },
  });
  assertEquals(trocou.resposta.status, 200);
  assertEquals(trocou.corpo.success, false);
  assertEquals(/sandbox|modo de testes/i.test(trocou.corpo.error), true);
  assertEquals(trocou.gravacoes.length, 0);

  const mesmo = await salvarCredenciais({
    corpo: { provider: "superfrete", credentials: { sandbox: false, contact_email: EMAIL_SF } },
    credenciais: { superfrete: { token: TOKEN_SF, sandbox: false, contact_email: "velho@ex.com" } },
  });
  assertEquals(mesmo.corpo.success, true);
  assertEquals(linhaGravada(mesmo.gravacoes[0], "superfrete").credentials.sandbox, false);
});

Deno.test("save_credentials: falha do banco ao gravar -> erro em português, SEM o token (nem no console)", async () => {
  const { resposta, corpo, texto, saida } = await salvarCredenciais({
    corpo: { provider: "superfrete", credentials: { token: TOKEN_SF_NOVO, contact_email: EMAIL_SF } },
    erroAoGravarCredencial: { message: `violação ao gravar ${TOKEN_SF_NOVO}` },
  });
  assertEquals(corpo.success, false);
  assertEquals(resposta.status >= 500, true);
  assertEquals(typeof corpo.error, "string");
  assertEquals(texto.includes(TOKEN_SF_NOVO), false);
  assertEquals(saida.includes(TOKEN_SF_NOVO), false);
});

// ============================================================================
// RELEASE 1.5.6 — SuperFrete: "Entrega econômica" = PAC ou Mini Envios (o
// mais barato), sem seguro, medidas fiéis campo a campo, cache versionado e
// log estruturado.
//
// As fixtures abaixo são as respostas BRUTAS da API de produção gravadas na
// auditoria de 22/09/2026 (Temp/ikcous-superfrete-auditoria/
// cotacoes-reais-2-corpo-e-normalizacao.json), só com o espaçamento mudado:
//   B) tênis 10×10×6, 0,1 kg, sem seguro, services 1,2,17: PAC 25,31 (8 d) e
//      SEDEX 52,59 (4 d) — SEM o Mini (6 cm passa da altura máxima dele, 4).
//   D) controle 15×10×3, 0,1 kg: PAC 25,31, SEDEX 52,59 e Mini 19,01 (11 d).
//   C) o MESMO controle CRU 10×10×3 devolveu exatamente D: a própria API sobe
//      a caixa para 15×10×3 — por isso o app não normaliza medida.
// ============================================================================

const pacReal = (pkg: [string, string, string, string]) => ({
  id: 1, name: "PAC", price: 25.31, discount: "7.09", currency: "R$", delivery_time: 8,
  delivery_range: { min: 8, max: 8 },
  packages: [pacoteSF(25.31, "7.09", "box", ...pkg, 0)],
  additional_services: { receipt: false, own_hand: false }, company: CORREIOS_SF, has_error: false,
});
const sedexReal = (pkg: [string, string, string, string]) => ({
  id: 2, name: "SEDEX", price: 52.59, discount: "15.41", currency: "R$", delivery_time: 4,
  delivery_range: { min: 4, max: 4 },
  packages: [pacoteSF(52.59, "15.41", "box", ...pkg, 0)],
  additional_services: { receipt: false, own_hand: false }, company: CORREIOS_SF, has_error: false,
});
const miniReal = (pkg: [string, string, string, string]) => ({
  id: 17, name: "Mini Envios", price: 19.01, discount: "13.39", currency: "R$", delivery_time: 11,
  delivery_range: { min: 11, max: 11 },
  packages: [pacoteSF(19.01, "13.39", "box", ...pkg, 0)],
  additional_services: { receipt: false, own_hand: false }, company: CORREIOS_SF, has_error: false,
});
/** Cotação B (real): tênis de 6 cm — a API não devolve o Mini. */
const RESPOSTA_REAL_B_TENIS_6CM = [pacReal(["6", "16", "24", "0.3"]), sedexReal(["6", "16", "24", "0.3"])];
/** Cotação D (real): controle 15×10×3 — Mini a 19,01 em 11 dias. */
const RESPOSTA_REAL_D_CONTROLE = [
  pacReal(["3", "10", "15", "0.1"]),
  sedexReal(["3", "10", "15", "0.1"]),
  miniReal(["3", "10", "15", "0.1"]),
];

const CONFIG_SF_PAC_SEDEX = { ...CONFIG_SF, enabled_shipping_methods: ["sedex", "pac"] };
const responderCom = (dados: unknown) => () =>
  new Response(JSON.stringify(dados), { status: 200, headers: { "Content-Type": "application/json" } });


/** Uma opção da SuperFrete como a 1.5.7 devolve (Correios). */
const opcaoSf = (id: number, name: string, price: number, deliveryDays: number, servico: string) => ({
  id: `superfrete-${id}`, name, price, deliveryDays, provider: "superfrete", cotacaoSf: 2,
  transportadora: "Correios", servico, provedorRotulo: "SuperFrete",
});
const PAC_REAL = opcaoSf(1, "Entrega econômica", 25.31, 8, "PAC");
const MINI_REAL = opcaoSf(17, "Correios — Mini Envios", 19.01, 11, "Mini Envios");
const EXPRESSA_REAL = opcaoSf(2, "Entrega expressa", 52.59, 4, "SEDEX");

// --- 1.5.7: o servidor NÃO agrupa mais PAC×Mini -------------------------------
//
// REESCRITO CONSCIENTEMENTE (contrato 1.5.7 §2 + PLANO A3, ordem do dono "não
// eliminar PAC só porque Mini é mais barato"). Na 1.5.6 o servidor juntava PAC
// e Mini numa "Entrega econômica" só (a mais barata, com desempate por prazo
// e depois pelo PAC); os testes de desempate daquela regra SAÍRAM junto com
// ela. Agora as duas ofertas vão na lista, cada uma com o seu id e o seu
// preço (o id é o que a RPC do pedido casa), e agrupar é só visual (tela).

Deno.test("1.5.7 sem agrupamento: cotação real D -> PAC, SEDEX e Mini, cada um com o seu id, preço e prazo", async () => {
  const { resposta, corpo, registro } = await cotarSuperFrete({
    config: CONFIG_SF_PAC_SEDEX,
    responder: responderCom(RESPOSTA_REAL_D_CONTROLE),
  });
  assertEquals(resposta.status, 200);
  assertEquals(corpo.options.map(semCarimbo), [PAC_REAL, EXPRESSA_REAL, MINI_REAL]);
  // A MESMA lista vai ao cache que a RPC lê por id.
  const gravado = registro.upserts.find((u: any) => u.tabela === "shipping_quotes_cache");
  assertEquals(gravado.linha.options, corpo.options);
});

Deno.test("1.5.7 sem agrupamento: a ordem da resposta da API é preservada (quem ordena é a tela)", async () => {
  const [pac, sedex, mini] = RESPOSTA_REAL_D_CONTROLE;
  const { corpo } = await cotarSuperFrete({ config: CONFIG_SF_PAC_SEDEX, responder: responderCom([mini, sedex, pac]) });
  assertEquals(corpo.options.map(semCarimbo), [MINI_REAL, EXPRESSA_REAL, PAC_REAL]);
});

Deno.test("1.5.7: preço arredondado ao centavo (o MESMO número vai à tela e ao cache)", async () => {
  const pac = { ...pacReal(["3", "10", "15", "0.1"]), price: 20.004 };
  const { corpo } = await cotarSuperFrete({ config: CONFIG_SF_PAC_SEDEX, responder: responderCom([pac]) });
  assertEquals(corpo.options.map(semCarimbo), [{ ...PAC_REAL, price: 20 }]);
});

Deno.test("1.5.7: serviço 1 DUPLICADO na resposta vira UMA opção (id único na lista que a RPC lê) — vale a mais barata", async () => {
  const pac = pacReal(["3", "10", "15", "0.1"]);
  const { corpo } = await cotarSuperFrete({
    config: CONFIG_SF_PAC_SEDEX,
    responder: responderCom([{ ...pac, price: 27 }, sedexReal(["3", "10", "15", "0.1"]), pac]),
  });
  assertEquals(corpo.options.map((o: any) => [o.id, o.price]).sort(), [["superfrete-1", 25.31], ["superfrete-2", 52.59]]);
});

// --- Serviço faltando ou com problema ---------------------------------------

Deno.test("1.5.7: tênis 6 cm (cotação real B, Mini AUSENTE) -> PAC 25,31 + SEDEX 52,59", async () => {
  const { corpo } = await cotarSuperFrete({ config: CONFIG_SF_PAC_SEDEX, responder: responderCom(RESPOSTA_REAL_B_TENIS_6CM) });
  assertEquals(corpo.options.map(semCarimbo), [PAC_REAL, EXPRESSA_REAL]);
});

Deno.test("1.5.7: Mini com has_error, com error, sem preço ou com preço 0 -> só o Mini sai (preço 0 na SF continua descartado, R2-7)", async () => {
  const mini = miniReal(["3", "10", "15", "0.1"]);
  for (const miniRuim of [
    { ...mini, has_error: true, error: "Dimensões acima do permitido" },
    { ...mini, error: "Serviço indisponível" },
    { ...mini, price: undefined },
    { ...mini, price: null },
    { ...mini, price: 0 },
  ]) {
    const { corpo } = await cotarSuperFrete({
      config: CONFIG_SF_PAC_SEDEX,
      responder: responderCom([pacReal(["3", "10", "15", "0.1"]), sedexReal(["3", "10", "15", "0.1"]), miniRuim]),
    });
    assertEquals(corpo.options.map(semCarimbo), [PAC_REAL, EXPRESSA_REAL]);
  }
});

Deno.test("1.5.7: PAC com erro e Mini válido -> SEDEX e Mini", async () => {
  const { corpo } = await cotarSuperFrete({
    config: CONFIG_SF_PAC_SEDEX,
    responder: responderCom([
      { ...pacReal(["3", "10", "15", "0.1"]), has_error: true },
      sedexReal(["3", "10", "15", "0.1"]),
      miniReal(["3", "10", "15", "0.1"]),
    ]),
  });
  assertEquals(corpo.options.map(semCarimbo), [EXPRESSA_REAL, MINI_REAL]);
});

Deno.test("1.5.7: PAC e Mini ausentes -> o SEDEX sozinho", async () => {
  const { resposta, corpo } = await cotarSuperFrete({
    config: CONFIG_SF_PAC_SEDEX,
    responder: responderCom([sedexReal(["6", "16", "24", "0.3"])]),
  });
  assertEquals(resposta.status, 200);
  assertEquals(corpo.options.map(semCarimbo), [EXPRESSA_REAL]);
});

Deno.test("1.5.7: com SÓ a chave sedex, o 17 que a API devolva não entra (a guarda de ID pedido continua)", async () => {
  const { corpo } = await cotarSuperFrete({
    config: { ...CONFIG_SF, enabled_shipping_methods: ["sedex"] },
    responder: responderCom(RESPOSTA_REAL_D_CONTROLE),
  });
  assertEquals(corpo.options.map(semCarimbo), [EXPRESSA_REAL]);
});

Deno.test("1.5.7: para a SuperFrete a guarda é o ID, não o nome — serviço 1 com nome inesperado continua superfrete-1 (e o nome real aparece)", async () => {
  const { corpo } = await cotarSuperFrete({
    config: CONFIG_SF_PAC_SEDEX,
    responder: responderCom([{ ...pacReal(["3", "10", "15", "0.1"]), name: "Correios Econômico" }, sedexReal(["3", "10", "15", "0.1"])]),
  });
  assertEquals(corpo.options.map(semCarimbo), [
    { ...PAC_REAL, name: "Correios — Correios Econômico", servico: "Correios Econômico" },
    EXPRESSA_REAL,
  ]);
});

// --- Corpo enviado à API ------------------------------------------------------

Deno.test("1.5.6 corpo: services '1,2,17' para [sedex,pac]; '1,17' só com pac; jadlog continua '3'; vazio continua todas", async () => {
  const casos: Array<[string[], string]> = [
    [["sedex", "pac"], "1,2,17"],
    [["pac"], "1,17"],
    [["PAC", "store-pickup"], "1,17"],
    // Nome que existe no PROTÓTIPO de um objeto não vira serviço.
    [["constructor", "pac"], "1,17"],
    [["jadlog"], "3"],
    [["sedex"], "2"],
    [[], "1,2,3,17,31,33"],
  ];
  for (const [chaves, esperado] of casos) {
    const { chamadas } = await cotarSuperFrete({ config: { ...CONFIG_SF, enabled_shipping_methods: chaves } });
    assertEquals(JSON.parse(String(chamadas[0].init.body)).services, esperado);
  }
});

Deno.test("1.5.6 seguro: options SEM seguro (0/false), sem mão própria e sem AR — mesmo com o carrinho de R$ 59,90", async () => {
  const { chamadas } = await cotarSuperFrete({
    config: CONFIG_SF_PAC_SEDEX,
    produtos: [{ id: "p1", nome: "Tênis Fictício de Teste", preco_venda: 59.9, peso_kg: 0.1, largura_cm: 10, altura_cm: 6, comprimento_cm: 10, frete_gratis: false }],
    cart: [{ product: { id: "p1", price: 59.9 }, quantity: 1 }],
  });
  assertEquals(JSON.parse(String(chamadas[0].init.body)).options, {
    own_hand: false,
    receipt: false,
    insurance_value: 0,
    use_insurance_value: false,
  });
});

// REESCRITO CONSCIENTEMENTE na 1.5.7 ("ME sem mudança" deixou de ser
// verdade): o corpo do ME passou ao formato OFICIAL da doc (`products` com
// `id`, medidas, `weight` e `insurance_value` = valor do BANCO, que é o que a
// etiqueta já declara — antes a cotação saía SEM o custo do seguro que a
// etiqueta pagava) e o nome não vai mais: nome de produto não sai para a
// transportadora. O filtro de NOME continua igual no modo legado.
Deno.test("1.5.7 ME legado: corpo oficial (id, medidas, insurance_value do BANCO), SEM nome do produto, e a guarda de NOME ('Mini Envios' não passa pela chave pac)", async () => {
  const correios = { name: "Correios" };
  const { chamadas, corpo } = await cotarSuperFrete({
    config: { ...CONFIG_DA_LOJA, enabled_shipping_methods: ["sedex", "pac"] },
    produtos: [{ id: "p1", nome: "Caneca", preco_venda: 49.9, peso_kg: 0.45, largura_cm: 12, altura_cm: 10, comprimento_cm: 20, frete_gratis: false }],
    cart: [{ product: { id: "p1", price: 1 }, quantity: 2 }],
    responder: responderCom([
      { id: 1, name: "PAC", price: "26.41", delivery_time: 8, company: correios },
      { id: 2, name: "SEDEX", price: "54.88", delivery_time: 4, company: correios },
      { id: 17, name: "Mini Envios", price: "19.01", delivery_time: 11, company: correios },
    ]),
  });
  assertEquals(chamadas[0].url, "https://melhorenvio.com.br/api/v2/me/shipment/calculate");
  assertEquals(JSON.parse(String(chamadas[0].init.body)), {
    from: { postal_code: "38500000" },
    to: { postal_code: "01001000" },
    products: [{ id: "p1", width: 12, height: 10, length: 20, weight: 0.45, insurance_value: 49.9, quantity: 2 }],
  });
  assertEquals(String(chamadas[0].init.body).includes("Caneca"), false);
  const me = (id: number, name: string, price: number, deliveryDays: number, servico: string) => ({
    id: `melhor-envio-${id}`, name, price, deliveryDays, provider: "melhor_envio",
    transportadora: "Correios", servico, provedorRotulo: "Melhor Envio", seguroDeclarado: 99.8,
  });
  assertEquals(corpo.options.map(semCarimbo), [
    me(1, "Entrega econômica", 26.41, 8, "PAC"),
    me(2, "Entrega expressa", 54.88, 4, "SEDEX"),
  ]);
});

Deno.test("1.5.7 Frenet legado: corpo de sempre (valor da nota pelo BANCO) e a guarda de NOME", async () => {
  const { chamadas, corpo } = await cotarSuperFrete({
    config: { ...CONFIG_DA_LOJA, shipping_provider: "frenet", enabled_shipping_methods: ["sedex", "pac"] },
    credenciais: { frenet: { token: "tok-frenet-FICTICIO-777" } },
    produtos: [{ id: "p1", nome: "Caneca", preco_venda: 49.9, peso_kg: 0.45, largura_cm: 12, altura_cm: 10, comprimento_cm: 20, frete_gratis: false }],
    cart: [{ product: { id: "p1", price: 1 }, quantity: 2 }],
    responder: responderCom({
      ShippingSevicesArray: [
        { Carrier: "Correios", ServiceCode: "04510", ServiceDescription: "PAC", ShippingPrice: "26.41", DeliveryTime: "8", Error: false },
        { Carrier: "Correios", ServiceCode: "04014", ServiceDescription: "SEDEX", ShippingPrice: "54.88", DeliveryTime: "4", Error: false },
        { Carrier: "Correios", ServiceCode: "04227", ServiceDescription: "Mini Envios", ShippingPrice: "19.01", DeliveryTime: "11", Error: false },
      ],
    }),
  });
  assertEquals(JSON.parse(String(chamadas[0].init.body)), {
    SellerCEP: "38500000",
    RecipientCEP: "01001000",
    ShipmentInvoiceValue: 99.8,
    ShippingItemArray: [{ Weight: 0.45, Length: 20, Height: 10, Width: 12, Quantity: 2 }],
  });
  const fr = (codigo: string, name: string, price: number, deliveryDays: number, servico: string) => ({
    id: `frenet-${codigo}`, name, price, deliveryDays, provider: "frenet", transportadora: "Correios", servico, provedorRotulo: "Frenet",
  });
  assertEquals(corpo.options.map(semCarimbo), [
    fr("04510", "Entrega econômica", 26.41, 8, "PAC"),
    fr("04014", "Entrega expressa", 54.88, 4, "SEDEX"),
  ]);
});

// --- Medidas -----------------------------------------------------------------

const TENIS_FICTICIO = { id: "p-tenis", nome: "Tênis Fictício de Teste", preco_venda: 59.9, peso_kg: 0.1, largura_cm: 10, altura_cm: 6, comprimento_cm: 10, frete_gratis: false };

Deno.test("1.5.6 medidas: tênis 0,1 kg e 10×10×6 sai EXATAMENTE assim (nunca 0,3 kg nem 15×15×15)", async () => {
  const { chamadas } = await cotarSuperFrete({
    config: CONFIG_SF_PAC_SEDEX,
    produtos: [TENIS_FICTICIO],
    cart: [{ product: { id: "p-tenis", price: 59.9 }, quantity: 1 }],
    responder: responderCom(RESPOSTA_REAL_B_TENIS_6CM),
  });
  assertEquals(JSON.parse(String(chamadas[0].init.body)).products, [
    { quantity: 1, weight: 0.1, height: 6, width: 10, length: 10 },
  ]);
});

Deno.test("1.5.6 medidas: UM campo ruim (ausente, null, 0, negativo, NaN, texto, booleano) só troca AQUELE campo pelo padrão", async () => {
  // [coluna do banco, campo no corpo da API, padrão daquele campo]
  const CAMPOS: Array<[string, string, number]> = [
    ["peso_kg", "weight", 0.3],
    ["altura_cm", "height", 15],
    ["largura_cm", "width", 15],
    ["comprimento_cm", "length", 15],
  ];
  const ruins: Array<[string, unknown]> = [
    ["ausente", undefined], ["null", null], ["zero", 0], ["negativo", -2], ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY], ["texto", "abc"], ["vazio", ""], ["booleano", true],
  ];
  for (const [coluna, noCorpo, padrao] of CAMPOS) {
    for (const [rotulo, valor] of ruins) {
      const { [coluna]: _original, ...semOCampo } = TENIS_FICTICIO as Record<string, unknown>;
      const produto = rotulo === "ausente" ? semOCampo : { ...semOCampo, [coluna]: valor };
      const { chamadas } = await cotarSuperFrete({
        config: CONFIG_SF_PAC_SEDEX,
        produtos: [produto],
        cart: [{ product: { id: "p-tenis" }, quantity: 1 }],
        responder: responderCom(RESPOSTA_REAL_B_TENIS_6CM),
      });
      const esperado = { quantity: 1, weight: 0.1, height: 6, width: 10, length: 10, [noCorpo]: padrao };
      assertEquals(JSON.parse(String(chamadas[0].init.body)).products, [esperado], `${coluna} ${rotulo}`);
    }
  }
});

Deno.test("1.5.6 medidas: número em TEXTO vindo do banco ('6.5') vale como número; valor positivo pequeno não sobe", async () => {
  const { chamadas } = await cotarSuperFrete({
    config: CONFIG_SF_PAC_SEDEX,
    produtos: [{ ...TENIS_FICTICIO, altura_cm: "6.5", peso_kg: 0.001, largura_cm: 1 }],
    cart: [{ product: { id: "p-tenis" }, quantity: 1 }],
  });
  assertEquals(JSON.parse(String(chamadas[0].init.body)).products, [
    { quantity: 1, weight: 0.001, height: 6.5, width: 1, length: 10 },
  ]);
});

Deno.test("1.5.6 medidas: produto que o banco NÃO conhece -> todos os padrões (0,3 kg e 15 cm), como antes", async () => {
  const { chamadas } = await cotarSuperFrete({
    config: CONFIG_SF_PAC_SEDEX,
    produtos: [],
    cart: [{ product: { id: "p-sumiu", price: 10 }, quantity: 3 }],
  });
  assertEquals(JSON.parse(String(chamadas[0].init.body)).products, [
    { quantity: 3, weight: 0.3, height: 15, width: 15, length: 15 },
  ]);
});

// --- Cache do servidor -------------------------------------------------------
//
// REESCRITO CONSCIENTEMENTE na 1.5.7 (contrato §3 + R1-1). Até a 1.5.6 o cache
// servia por PROVEDOR (+ a marca `cotacaoSf` na SF). Agora serve só com a
// `assinaturaCotacao` ATUAL (hash de {contrato:3, revisaoConfig, insumos do
// banco}) em TODA opção nacional, nenhuma parcial, e a marca na SF. A linha da
// 1.5.6 (sem assinatura) é falta: uma recotação, que sobrescreve a mesma chave.

/** A linha que a 1.5.4/1.5.5 gravou: sem a marca, preço COM seguro, sem o Mini. */
const LINHA_SF_ANTIGA = [
  { id: "superfrete-1", name: "Entrega econômica", price: 25.7, deliveryDays: 8, provider: "superfrete" },
  { id: "superfrete-2", name: "Entrega expressa", price: 52.98, deliveryDays: 4, provider: "superfrete" },
];

Deno.test("1.5.7 cache: linha antiga da SuperFrete (sem assinatura) NÃO é servida — recota e o upsert SOBRESCREVE a mesma chave, com PAC e Mini", async () => {
  const { corpo, chamadas, registro } = await cotarSuperFrete({
    config: CONFIG_SF_PAC_SEDEX,
    cacheLookup: [{ options: LINHA_SF_ANTIGA }],
    responder: responderCom(RESPOSTA_REAL_D_CONTROLE),
  });
  assertEquals(chamadas.length, 1);
  assertEquals(corpo.options.map(semCarimbo), [PAC_REAL, EXPRESSA_REAL, MINI_REAL]);
  const gravacoes = registro.upserts.filter((u: any) => u.tabela === "shipping_quotes_cache");
  assertEquals(gravacoes.length, 1);
  assertEquals(gravacoes[0].onConflict, "origin_cep,destination_cep,cart_hash");
  // O cart_hash NÃO muda (a RPC o desmonta em produto:variante:qtd).
  assertEquals(gravacoes[0].linha.cart_hash, getCartHash(CARRINHO_DE_TESTE));
  // É ESTA lista que a RPC lê por `opt->>'id'`: cada id com o SEU preço.
  assertEquals(gravacoes[0].linha.options, corpo.options);
  assertEquals(gravacoes[0].linha.options.find((o: any) => o.id === "superfrete-17").price, 19.01);
  assertEquals(gravacoes[0].linha.options.find((o: any) => o.id === "superfrete-1").price, 25.31);
});

Deno.test("1.5.7 cache: assinatura certa mas marca SF ERRADA (1, '2', ausente numa das opções) também não serve", async () => {
  const assinatura = await assinaturaEsperada({ config: CONFIG_SF_PAC_SEDEX });
  for (const linha of [
    [{ ...PAC_REAL, cotacaoSf: 1 }],
    [{ ...PAC_REAL, cotacaoSf: "2" }],
    [PAC_REAL, { ...LINHA_SF_ANTIGA[1] }],
  ]) {
    const { chamadas } = await cotarSuperFrete({ config: CONFIG_SF_PAC_SEDEX, cacheLookup: [{ options: assinar(linha, assinatura) }] });
    assertEquals(chamadas.length, 1);
  }
});

Deno.test("1.5.7 cache: linha da SuperFrete com a assinatura ATUAL e a marca é servida sem chamar a API; assinatura de OUTRA configuração não", async () => {
  const assinatura = await assinaturaEsperada({ config: CONFIG_SF_PAC_SEDEX });
  const linha = assinar([PAC_REAL, EXPRESSA_REAL], assinatura);
  const servida = await cotarSuperFrete({ config: CONFIG_SF_PAC_SEDEX, cacheLookup: [{ options: linha }] });
  assertEquals(servida.chamadas.length, 0);
  assertEquals(servida.corpo.options, linha);
  // A mesma linha, com a loja tendo trocado os métodos: a revisão muda e a linha é falta.
  const outra = await cotarSuperFrete({ config: { ...CONFIG_SF_PAC_SEDEX, enabled_shipping_methods: ["sedex"] }, cacheLookup: [{ options: linha }] });
  assertEquals(outra.chamadas.length, 1);
});

Deno.test("1.5.7 cache: ME também precisa da assinatura; local/grátis/retirada continuam valendo; parcial nunca serve", async () => {
  const semAssinatura = await cotarSuperFrete({ config: { ...CONFIG_DA_LOJA }, cacheLookup: [{ options: OPCOES_ME_EM_CACHE }] });
  assertEquals(semAssinatura.chamadas.length, 1);
  const assinaturaMe = await assinaturaEsperada({ config: { ...CONFIG_DA_LOJA } });
  const me = await cotarSuperFrete({ config: { ...CONFIG_DA_LOJA }, cacheLookup: [{ options: assinar(OPCOES_ME_EM_CACHE, assinaturaMe) }] });
  assertEquals(me.chamadas.length, 0);
  const assinatura = "a".repeat(64);
  assertEquals(edge.cotacaoDoCacheServe(assinar([{ id: "frenet-04510", price: 26.41, deliveryDays: 8, provider: "frenet" }], assinatura), assinatura), true);
  assertEquals(edge.cotacaoDoCacheServe(assinar([{ id: "frenet-04510", price: 26.41, deliveryDays: 8, provider: "frenet", cotacaoParcial: true }], assinatura), assinatura), false);
  for (const dono of ["local", "free", "pickup"]) {
    const propria = [{ id: "x", name: "x", price: 0, deliveryDays: 0, provider: dono }];
    assertEquals(edge.cotacaoDoCacheServe(propria, assinatura), true, dono);
    // Opção da loja ao lado de uma SuperFrete assinada e marcada serve; ao lado de uma antiga, não.
    assertEquals(edge.cotacaoDoCacheServe([...propria, ...assinar([EXPRESSA_REAL], assinatura)], assinatura), true, dono);
    assertEquals(edge.cotacaoDoCacheServe([...propria, LINHA_SF_ANTIGA[1]], assinatura), false, dono);
  }
  assertEquals(edge.cotacaoDoCacheServe([], assinatura), false);
  assertEquals(edge.cotacaoDoCacheServe([{ id: "?", provider: "flat_fee" }], assinatura), false);
});

// --- Log estruturado ---------------------------------------------------------
//
// 1.5.7: o evento passou de `cotacao_superfrete` (uma linha, só a SF) para
// `cotacao_frete`, UMA linha POR PROVEDOR ligado — com o mesmo piso de
// privacidade: nunca token, e-mail, CEP, nome de produto, endereço nem o texto
// de erro da transportadora.

/** As linhas JSON do log estruturado da cotação. */
function linhasDoLogEstruturado(saida: string): any[] {
  return saida.split("\n").flatMap((linha) => {
    if (!linha.startsWith("{")) return [];
    try {
      const obj = JSON.parse(linha);
      return obj?.evento === "cotacao_frete" ? [obj] : [];
    } catch {
      return [];
    }
  });
}

const CEP_EM_QUALQUER_FORMATO = /\b\d{5}-?\d{3}\b/;

Deno.test("1.5.7 log: UMA linha JSON por provedor (miss) com serviços pedidos, retornados e opções finais", async () => {
  const { saida } = await cotarSuperFrete({
    config: CONFIG_SF_PAC_SEDEX,
    produtos: [TENIS_FICTICIO, { ...TENIS_FICTICIO, id: "p-sem-altura", altura_cm: null }],
    cart: [
      { product: { id: "p-tenis" }, quantity: 1 },
      { product: { id: "p-sem-altura" }, quantity: 1 },
      { product: { id: "p-fora-do-banco" }, quantity: 1 },
    ],
    responder: responderCom(RESPOSTA_REAL_D_CONTROLE),
  });
  const linhas = linhasDoLogEstruturado(saida);
  assertEquals(linhas.length, 1);
  assertEquals(linhas[0], {
    evento: "cotacao_frete",
    provedor: "superfrete",
    modo: "legado",
    resultado: "ok",
    ambiente: "producao",
    servicos_pedidos: ["1", "2", "17"],
    retornados: [
      { codigo: "1", preco: 25.31, preco_original: 25.31, prazo: 8, erro: false },
      { codigo: "2", preco: 52.59, preco_original: 52.59, prazo: 4, erro: false },
      { codigo: "17", preco: 19.01, preco_original: 19.01, prazo: 11, erro: false },
    ],
    opcoes_finais: [
      { id: "superfrete-1", preco: 25.31, prazo: 8 },
      { id: "superfrete-2", preco: 52.59, prazo: 4 },
      { id: "superfrete-17", preco: 19.01, prazo: 11 },
    ],
    precos_mudados_pela_regra: 0,
    cache: "miss",
    contrato: null,
    produtos_sem_cadastro: 1,
    campos_padrao: 1,
  });
});

Deno.test("1.5.7 log: serviço com erro aparece como erro:true; sandbox vira ambiente 'sandbox'", async () => {
  const { saida } = await cotarSuperFrete({
    config: CONFIG_SF_PAC_SEDEX,
    credenciais: { superfrete: { token: TOKEN_SF, sandbox: true, contact_email: EMAIL_SF } },
    responder: responderCom([...RESPOSTA_REAL_B_TENIS_6CM, { id: 17, name: "Mini Envios", has_error: true, error: "Altura acima do permitido" }]),
  });
  const [linha] = linhasDoLogEstruturado(saida);
  assertEquals(linha.ambiente, "sandbox");
  assertEquals(linha.retornados.at(-1), { codigo: "17", preco: null, preco_original: null, prazo: null, erro: true });
  assertEquals(linha.opcoes_finais, [{ id: "superfrete-1", preco: 25.31, prazo: 8 }, { id: "superfrete-2", preco: 52.59, prazo: 4 }]);
});

Deno.test("1.5.7 log: falha da API também deixa a linha (resultado 'falha', motivo classificado, sem opções), e o 503 continua", async () => {
  const { resposta, saida } = await cotarSuperFrete({
    config: CONFIG_SF_PAC_SEDEX,
    responder: () => new Response(JSON.stringify({ message: "falhou" }), { status: 500 }),
  });
  assertEquals(resposta.status, 503);
  const linhas = linhasDoLogEstruturado(saida);
  assertEquals(linhas.length, 1);
  assertEquals(linhas[0].resultado, "falha");
  assertEquals(linhas[0].motivo, "indisponivel");
  assertEquals(linhas[0].retornados, []);
  assertEquals(linhas[0].opcoes_finais, []);
  assertEquals(linhas[0].cache, "miss");
});

Deno.test("1.5.7 log: cache HIT também deixa a linha (cache 'hit', sem chamar a API)", async () => {
  const assinatura = await assinaturaEsperada({ config: CONFIG_SF_PAC_SEDEX });
  const { saida, chamadas } = await cotarSuperFrete({
    config: CONFIG_SF_PAC_SEDEX,
    cacheLookup: [{ options: assinar([PAC_REAL, EXPRESSA_REAL], assinatura) }],
  });
  assertEquals(chamadas.length, 0);
  const linhas = linhasDoLogEstruturado(saida);
  assertEquals(linhas.length, 1);
  assertEquals(linhas[0].cache, "hit");
  assertEquals(linhas[0].servicos_pedidos, ["1", "2", "17"]);
  assertEquals(linhas[0].retornados, []);
  assertEquals(linhas[0].opcoes_finais, [{ id: "superfrete-1", preco: 25.31, prazo: 8 }, { id: "superfrete-2", preco: 52.59, prazo: 4 }]);
});

Deno.test("1.5.7 log: NUNCA token, e-mail, CEP, nome de produto nem endereço — nem no miss, nem no hit, nem na falha", async () => {
  const produto = { ...TENIS_FICTICIO, nome: "Tênis Fictício Nome-Secreto-XYZ" };
  const cart = [{ product: { id: "p-tenis", nome: produto.nome }, quantity: 1 }];
  const assinatura = await assinaturaEsperada({ config: CONFIG_SF_PAC_SEDEX, produtos: [produto], cart });
  const cenarios = [
    { responder: responderCom(RESPOSTA_REAL_D_CONTROLE) },
    // A API ECOA o token e o e-mail: a linha estruturada não leva nada disso
    // (o texto de erro da API nunca entra nela, só o booleano), e o console
    // redige o token E o e-mail de contato (1.5.7).
    { responder: () => new Response(`erro ${TOKEN_SF} ${EMAIL_SF} 01001-000`, { status: 500 }) },
    { cacheLookup: [{ options: assinar([PAC_REAL, EXPRESSA_REAL], assinatura) }] },
  ];
  for (const cenario of cenarios as any[]) {
    const { saida } = await cotarSuperFrete({
      config: CONFIG_SF_PAC_SEDEX,
      produtos: [produto],
      cart,
      cep: "01001-000",
      ...cenario,
    });
    const linhas = linhasDoLogEstruturado(saida);
    assertEquals(linhas.length, 1);
    const texto = JSON.stringify(linhas[0]);
    for (const proibido of [TOKEN_SF, EMAIL_SF, "Nome-Secreto-XYZ", "Rua", "loja@"]) {
      assertEquals(texto.includes(proibido), false, proibido);
    }
    assertEquals(CEP_EM_QUALQUER_FORMATO.test(texto), false, texto);
    assertEquals(/token|email|e-mail|cep|endereco|nome/i.test(Object.keys(linhas[0]).join(",")), false);
    // O console INTEIRO também não leva token, e-mail nem o nome do produto.
    assertEquals(saida.includes(TOKEN_SF), false);
    assertEquals(saida.includes(EMAIL_SF), false);
    assertEquals(saida.includes("Nome-Secreto-XYZ"), false);
  }
});

Deno.test("1.5.7 log: o ME também ganha a SUA linha (uma por provedor, não só a SF)", async () => {
  const me = await cotarSuperFrete({
    config: { ...CONFIG_DA_LOJA },
    responder: responderCom([{ id: 1, name: "PAC", price: "25.50", delivery_time: 5, company: { name: "Correios" } }]),
  });
  const linhas = linhasDoLogEstruturado(me.saida);
  assertEquals(linhas.map((l) => [l.provedor, l.resultado, l.servicos_pedidos]), [["melhor_envio", "ok", "legado"]]);
});

// --- Versão ------------------------------------------------------------------

Deno.test("1.5.7 versão: VERSAO_DA_INTEGRACAO_SUPERFRETE é 1.5.7 e a marca do cache SF continua 2 (o corpo da SF não mudou; a assinatura invalida o resto)", () => {
  assertEquals(edge.VERSAO_DA_INTEGRACAO_SUPERFRETE, "1.5.7");
  assertEquals(edge.VERSAO_DA_COTACAO_SUPERFRETE, 2);
});
