// @ts-nocheck
import { assertEquals } from "https://deno.land/std@0.177.0/testing/asserts.ts";
import {
  calculateSmartFallback,
  flatFeeConfigurada,
  getCartHash,
  handler,
  isLocalCep,
  precoDeContingenciaDoTopo,
  precoResolvidoSemCache,
  validarOrigemEFrete,
} from "./index.ts";

Deno.test("calculateSmartFallback - same region", () => {
  // Test same region: starts with same character
  const fee = calculateSmartFallback("38500000", "35000000", 10);
  assertEquals(fee, 15); // max of 15 and baseFee (10)
});

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

// --- Origem e taxa fixa: falhar fechado, nunca assumir Monte Carmelo -------
//
// Mesmo defeito que a 1.4.0 corrigiu na contingência do topo, um andar
// acima: até 18/08/2026, `storeConfig.origin_cep || '38500-000'` e
// `Number(storeConfig.shipping_fee || 15)` calculavam frete a partir de
// Monte Carmelo e de R$ 15 sempre que a loja nunca configurou nada.
// `Number(null)` é `0` e `null || 15` é `15`: os dois caminhos estavam
// errados. `validarOrigemEFrete` é a decisão isolada — string de erro
// quando falta o que é preciso para cotar honestamente, `null` quando pode
// seguir.

Deno.test("sem CEP de origem configurado, nao devolve opcao de frete", () => {
  const erro = validarOrigemEFrete(null, 15, "flat_fee");
  assertEquals(typeof erro, "string");
});

Deno.test("CEP de origem vazio conta como ausente, nao so' null", () => {
  const erro = validarOrigemEFrete("", 15, "flat_fee");
  assertEquals(typeof erro, "string");
});

Deno.test("sem taxa configurada, nao inventa R$ 15 (provedor flat_fee)", () => {
  const erro = validarOrigemEFrete("38500-000", null, "flat_fee");
  assertEquals(typeof erro, "string");
});

Deno.test("com CEP de origem e taxa configurados, permite cotar", () => {
  const erro = validarOrigemEFrete("38500-000", 15, "flat_fee");
  assertEquals(erro, null);
});

Deno.test("sem taxa configurada mas provedor nao e flat_fee, ainda permite cotar", () => {
  // Quem decide o preco e' a API do transportador; o piso fixo da loja nao
  // entra nessa conta.
  const erro = validarOrigemEFrete("38500-000", null, "melhor_envio");
  assertEquals(erro, null);
});

// --- flatFeeConfigurada: o zero de ausencia nao pode virar frete gratis ----
//
// `validarOrigemEFrete` so exige `shipping_fee` quando `provider ===
// 'flat_fee'` -- de proposito, porque nos demais provedores quem cota e a
// API do transportador. Mas `getFlatFeeResponse` (dentro do handler HTTP)
// cai na taxa fixa mesmo assim quando faltam credenciais do transportador,
// e ate 18/08/2026 isso usava `Number(storeConfig.shipping_fee || 15)`,
// depois trocado para `Number(storeConfig.shipping_fee)` pela Tarefa 7.
// `Number(null)` e `0`: loja com Melhor Envio ou Frenet sem credencial
// cadastrada E sem taxa configurada cotava frete GRATIS para o Brasil
// inteiro em vez de recusar -- pior que o R$ 15 inventado que existia antes.
// `flatFeeConfigurada` e a checagem isolada que fecha esse buraco.

Deno.test("flatFeeConfigurada - taxa nula (nunca configurada) nao e utilizavel", () => {
  assertEquals(flatFeeConfigurada(null), false);
});

Deno.test("flatFeeConfigurada - taxa indefinida nao e utilizavel", () => {
  assertEquals(flatFeeConfigurada(undefined), false);
});

Deno.test("flatFeeConfigurada - taxa nao numerica (NaN) nao e utilizavel", () => {
  assertEquals(flatFeeConfigurada(Number("abc")), false);
});

Deno.test("flatFeeConfigurada - zero CONFIGURADO pela loja e utilizavel (frete gratis de verdade)", () => {
  // Loja pode legitimamente escolher taxa fixa R$ 0. Isso e diferente do
  // zero que nasce de `Number(null)` -- e por isso a checagem olha o valor
  // original, nao o numero ja convertido.
  assertEquals(flatFeeConfigurada(0), true);
});

Deno.test("flatFeeConfigurada - taxa positiva e utilizavel", () => {
  assertEquals(flatFeeConfigurada(15), true);
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
}) {
  const { registro } = opts;
  const config = opts.config ?? CONFIG_DA_LOJA;

  const leitura = (tabela: string) => {
    const resolver = () => {
      switch (tabela) {
        case "store_config":
          return Promise.resolve({ data: config, error: null });
        case "produtos":
          return Promise.resolve({ data: [], error: null });
        case "shipping_quotes_cache":
          // Cache miss: é o caminho que cota na transportadora e grava.
          return Promise.resolve({ data: null, error: null });
        case "store_shipping_credentials":
          return Promise.resolve({
            data: { credentials: { token: "token-de-teste" } },
            error: null,
          });
        default:
          return Promise.resolve({ data: null, error: null });
      }
    };
    // Encadeamento do PostgrestBuilder: todo filtro devolve o próprio
    // construtor; `single`/`maybeSingle`/`then` resolvem a consulta.
    const construtor: any = {
      select: () => construtor,
      eq: () => construtor,
      gt: () => construtor,
      lt: () => construtor,
      in: () => construtor,
      order: () => construtor,
      limit: () => construtor,
      single: resolver,
      maybeSingle: resolver,
      then: (ok: any, falha: any) => resolver().then(ok, falha),
    };
    return construtor;
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
      select: () => leitura(tabela),
      insert: (linha: any) => escrita(tabela, linha),
    }),
  };
}

function requisicaoDeCotacao(): Request {
  return new Request("http://localhost/calculate-shipping", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ cep: "01001-000", cart: CARRINHO_DE_TESTE }),
  });
}

/** Roda o handler com a transportadora devolvendo UMA opção de R$ 25,50. */
async function cotar(
  cacheInsert: () => Promise<any>,
  config?: typeof CONFIG_DA_LOJA,
  logInsert?: () => Promise<any>,
) {
  const registro = {
    inserts: [] as Array<{ tabela: string; linha: any }>,
    execucoes: [] as Array<{ tabela: string; linha: any }>,
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
      supabase: clienteFalso({ registro, cacheInsert, logInsert, config }),
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

Deno.test("cotação gravada com sucesso devolve o preço normalmente", async () => {
  // Controle positivo: sem ele, "o teste passa" e "o teste não exercita nada"
  // dão a mesma saída.
  const { resposta, corpo, registro } = await cotar(() => Promise.resolve({ error: null }));

  assertEquals(resposta.status, 200);
  assertEquals(corpo.options.length, 1);
  assertEquals(corpo.options[0].price, 25.5);

  const gravacao = registro.inserts.find((i) => i.tabela === "shipping_quotes_cache");
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
// pagamento online; a escolha está em `useOrders.ts:1060`). A definição viva
// das duas é `supabase/migrations/20260821000200_cupom_sem_limite_e_ilimitado.sql`,
// v23 a partir de :138 e v24 a partir de :383, e os dois ramos são hoje
// idênticos. Neles: `local-delivery` sai de `store_config.local_delivery_fee`
// e `flat-fee-%` sai de `store_config.shipping_fee` — nenhum dos dois consulta
// `shipping_quotes_cache`. Só a cotação de transportadora
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
  // Resolvidos pela config, sem tocar em shipping_quotes_cache:
  assertEquals(precoResolvidoSemCache("local-delivery"), true);
  assertEquals(precoResolvidoSemCache("flat-fee-contingency"), true);
  assertEquals(precoResolvidoSemCache("flat-fee-standard"), true);
  // Precisam da linha gravada:
  assertEquals(precoResolvidoSemCache("melhor-envio-1"), false);
  assertEquals(precoResolvidoSemCache("frenet-04014"), false);
  // Nada de casar por parecença: o lado seguro é exigir o cache.
  assertEquals(precoResolvidoSemCache("local-delivery-expressa"), false);
  assertEquals(precoResolvidoSemCache("flatfee-x"), false);
  assertEquals(precoResolvidoSemCache(""), false);
  assertEquals(precoResolvidoSemCache(undefined), false);
});

Deno.test("gravação falha mas existe entrega local -> 200 só com a opção que dispensa o cache", async () => {
  const { resposta, texto, corpo } = await cotar(
    () => Promise.resolve({ error: { message: "permission denied", code: "42501" } }),
    CONFIG_COM_ENTREGA_LOCAL,
  );

  assertEquals(resposta.status, 200);
  assertEquals(corpo.options.length, 1);
  assertEquals(corpo.options[0].id, "local-delivery");
  assertEquals(corpo.options[0].price, 10);
  // A opção da transportadora dependia da linha que não foi gravada: se ela
  // saísse daqui, o checkout recusaria o pedido no último clique.
  assertEquals(texto.includes("melhor-envio"), false);
  assertEquals(texto.includes("25.5"), false);
  // E a resposta AVISA que a lista está incompleta. Sem este campo, a lista
  // curta se apresenta como se fosse a lista inteira, e a cliente decide a
  // compra achando que a loja não entrega por transportadora.
  assertEquals(corpo.cotacaoIncompleta, true);
});

Deno.test("gravação falha mas NADA dependia do cache -> lista inteira e cotacaoIncompleta false", async () => {
  // A transportadora só devolve "PAC", e a loja só habilitou "sedex": sobra
  // apenas a entrega local, que não precisa do cache. Nada foi removido —
  // então a lista está completa, mesmo tendo havido erro de gravação.
  // É este caso que separa `cotacaoIncompleta` de um simples "houve erro".
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

Deno.test("gravação OK com entrega local -> as DUAS opções saem (controle do filtro)", async () => {
  // Controle positivo do filtro: sem ele, um filtro que rodasse SEMPRE daria
  // a mesma saída verde no teste acima.
  const { resposta, corpo } = await cotar(
    () => Promise.resolve({ error: null }),
    CONFIG_COM_ENTREGA_LOCAL,
  );

  assertEquals(resposta.status, 200);
  assertEquals(corpo.options.length, 2);
  assertEquals(corpo.options.map((o: any) => o.id), ["local-delivery", "melhor-envio-1"]);
  // O outro lado do campo: cravado como constante, ele acertaria metade das
  // vezes. Só assertando os DOIS valores é que ele prova depender do estado.
  assertEquals(corpo.cotacaoIncompleta, false);
});

// --- O campo viaja nas rotas que respondem ANTES da cotação ----------------
//
// `cotacaoIncompleta` nasceu no `return` final — o caminho que fala com a
// transportadora. Mas a maioria das respostas 200 sai antes dele: taxa fixa,
// cobertura só-local, frete grátis, acerto de cache e credencial ausente. A
// loja em `flat_fee` responde SEMPRE por uma dessas, então o campo nunca
// apareceria em nenhuma resposta real, e quem consome concluiria que ele não
// existe — valor ausente é falso em JavaScript e a tela "funciona".
//
// Estas rotas estão completas por construção: nada foi removido delas. Por
// isso o valor é `false`, e ele precisa estar ESCRITO — é a diferença entre
// "esta lista está inteira" e "esta é uma versão da função que não sabia
// responder isso".

Deno.test("taxa fixa responde antes da cotação e mesmo assim declara a lista completa", async () => {
  const { resposta, corpo } = await cotar(
    () => Promise.resolve({ error: null }),
    { ...CONFIG_DA_LOJA, shipping_provider: "flat_fee" },
  );

  assertEquals(resposta.status, 200);
  // Confirma que a resposta veio mesmo pela saída antecipada da taxa fixa, e
  // não pelo `return` final que já carregava o campo.
  assertEquals(corpo.options.map((o: any) => o.id), ["flat-fee-standard"]);
  assertEquals(corpo.cotacaoIncompleta, false);
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
