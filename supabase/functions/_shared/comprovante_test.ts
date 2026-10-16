import {
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.177.0/testing/asserts.ts";
import {
  enviarComprovantePedido,
  fonteDoEnderecoDoComprovante,
} from "./comprovante.ts";

/**
 * O miolo (`enviarComprovantePedido`) e' o que `send-order-confirmation`
 * (HTTP, chamado pelo navegador) e `webhook-mercadopago` (import direto)
 * dividem agora. Os testes de HTML/texto continuam em
 * `send-order-confirmation/index_test.ts` (a função é reexportada de lá);
 * esta suíte prova o FLUXO: reserva, leitura, envio e liberação em falha —
 * o que só existe uma vez chamando de verdade, com um `supabase` falso.
 *
 * PROVA: a ordem (falha fechada ANTES de reservar), a trava anti-duplicata
 * (reserva por RPC), a liberação da reserva quando o envio falha, e que o
 * caminho de sucesso não depende de nenhuma leitura de header/chave — só do
 * `supabase` que foi passado.
 *
 * NÃO PROVA: que o e-mail sai de verdade (SMTP real) — mesma ressalva do
 * `_shared/smtp_test.ts`. Por isso o caminho "envia com sucesso" injeta um
 * `enviarEmail` falso via `deps`; sem essa injeção, testar o sucesso
 * exigiria tocar a rede de verdade, o que esta suíte nunca faz.
 */

const UUID_PEDIDO = "d77c6616-c389-4caa-b5c1-9a8d7af77f72";

// O remetente que `resolverRemetente` devolve (14/10/2026): o resolvedor real
// e testado em `email-da-loja_test.ts`; aqui ele entra como dubla.
const REMETENTE_DE_TESTE = {
  origem: "ambiente",
  usuario: "loja@exemplo.com",
  senha: "senha-de-teste",
  motivo: null,
  reserva: null,
};
const REMETENTE_NENHUM = {
  origem: "nenhum",
  usuario: null,
  senha: null,
  motivo: "sem_registro",
  reserva: null,
};

type Chamada = { tipo: "rpc" | "from"; nome: string; args?: unknown };

/**
 * Um único fake, configurável por tabela. `.eq(...)` devolve um objeto que é
 * AO MESMO TEMPO "thenable" (para o caminho de `marketplace_order_items`,
 * que o código de produção nunca fecha com `.maybeSingle()`) e portador de
 * `.maybeSingle()` (para `marketplace_orders`/`user_addresses`). `.limit(n)`
 * cobre `store_config`, que fecha com `.limit(1).maybeSingle()`.
 */
function clienteFalso(opts: {
  pedido?: Record<string, unknown> | null;
  erroLeituraPedido?: unknown;
  erroLeituraItens?: unknown;
  itens?: Array<Record<string, unknown>>;
  storeConfig?: Record<string, unknown> | null;
  endereco?: Record<string, unknown> | null;
  reservou?: boolean;
  erroReserva?: unknown;
  chamadas?: Chamada[];
  // Variações (product_variants) que a busca em lote devolve, e como ela
  // pode FALHAR: resultado com `error`, exceção síncrona ou promessa rejeitada.
  variantes?: Array<Record<string, unknown>>;
  falhaVariantes?: "erro" | "lanca" | "rejeita";
  consultasDeVariantes?: Array<{ colunas: string; coluna: string; ids: unknown[] }>;
}) {
  const chamadas = opts.chamadas ?? [];

  const resultadoPara = (tabela: string): { data: unknown; error: unknown } => {
    chamadas.push({ tipo: "from", nome: tabela });
    switch (tabela) {
      case "marketplace_orders":
        return opts.erroLeituraPedido
          ? { data: null, error: opts.erroLeituraPedido }
          : { data: opts.pedido ?? null, error: null };
      case "marketplace_order_items":
        return opts.erroLeituraItens
          ? { data: null, error: opts.erroLeituraItens }
          : { data: opts.itens ?? [], error: null };
      case "user_addresses":
        return { data: opts.endereco ?? null, error: null };
      case "store_config":
        return { data: opts.storeConfig ?? null, error: null };
      default:
        return { data: null, error: null };
    }
  };

  return {
    rpc: async (nome: string, args: Record<string, unknown>) => {
      chamadas.push({ tipo: "rpc", nome, args });
      if (nome === "reivindicar_email_de_confirmacao") {
        if (opts.erroReserva) return { data: null, error: opts.erroReserva };
        return { data: opts.reservou ?? true, error: null };
      }
      return { data: null, error: null };
    },
    from(tabela: string) {
      return {
        select(colunas: string) {
          return {
            // Busca em LOTE de variações: `.in("id", [...])`. O fake só
            // aceita isto para `product_variants` — qualquer outra tabela
            // com `.in` é um erro do teste, não do código.
            in(coluna: string, ids: unknown[]) {
              if (tabela !== "product_variants") {
                throw new Error(`fake: .in() inesperado em ${tabela}`);
              }
              opts.consultasDeVariantes?.push({ colunas, coluna, ids });
              chamadas.push({ tipo: "from", nome: tabela });
              if (opts.falhaVariantes === "lanca") {
                throw new Error("fake: product_variants explodiu");
              }
              if (opts.falhaVariantes === "rejeita") {
                return Promise.reject(new Error("fake: product_variants rejeitou"));
              }
              const resultado =
                opts.falhaVariantes === "erro"
                  ? { data: null, error: { message: "permission denied" } }
                  : { data: opts.variantes ?? [], error: null };
              return Promise.resolve(resultado);
            },
            eq(_coluna: string, _valor: unknown) {
              const resultado = resultadoPara(tabela);
              return {
                maybeSingle: async () => resultado,
                then: (resolve: (v: unknown) => void) => resolve(resultado),
              };
            },
            limit(_n: number) {
              const resultado = resultadoPara(tabela);
              return { maybeSingle: async () => resultado };
            },
          };
        },
      };
    },
    auth: {
      admin: {
        getUserById: async (_id: string) => ({ data: { user: null }, error: null }),
      },
    },
  };
}

// --- falha fechada: SMTP não configurado -----------------------------------

Deno.test("SMTP não configurado -> sem_remetente, e NADA é lido nem reservado (falha fechada ANTES de reservar)", async () => {
  const chamadas: Chamada[] = [];
  const supabase = clienteFalso({ chamadas });

  const desfecho = await enviarComprovantePedido({
    supabase: supabase as never,
    orderId: UUID_PEDIDO,
    deps: { resolverRemetente: async () => REMETENTE_NENHUM },
  });

  assertEquals(desfecho, { ok: false, motivo: "sem_remetente" });
  assertEquals(chamadas.length, 0, "nada deveria ter sido lido nem reservado antes de saber que pode enviar");
});

// --- pedido não encontrado --------------------------------------------------

Deno.test("pedido inexistente -> sem_pedido, reserva NÃO chamada", async () => {
  const chamadas: Chamada[] = [];
  const supabase = clienteFalso({ pedido: null, chamadas });

  const desfecho = await enviarComprovantePedido({
    supabase: supabase as never,
    orderId: UUID_PEDIDO,
    deps: { resolverRemetente: async () => REMETENTE_DE_TESTE },
  });

  assertEquals(desfecho, { ok: false, motivo: "sem_pedido" });
  assertEquals(chamadas.some((c) => c.tipo === "rpc"), false);
});

// --- leitura do pedido falha -------------------------------------------------

Deno.test("leitura do pedido falha -> envio_falhou", async () => {
  const supabase = clienteFalso({ erroLeituraPedido: { message: "connection reset" } });

  const desfecho = await enviarComprovantePedido({
    supabase: supabase as never,
    orderId: UUID_PEDIDO,
    deps: { resolverRemetente: async () => REMETENTE_DE_TESTE },
  });

  assertEquals(desfecho, { ok: false, motivo: "envio_falhou" });
});

// --- sem destinatário --------------------------------------------------------

Deno.test("pedido sem e-mail em lugar nenhum -> sem_destinatario, reserva NÃO é gasta", async () => {
  const chamadas: Chamada[] = [];
  const pedido = { id: UUID_PEDIDO, customer_data: {}, user_id: null };
  const supabase = clienteFalso({ pedido, chamadas });

  const desfecho = await enviarComprovantePedido({
    supabase: supabase as never,
    orderId: UUID_PEDIDO,
    deps: { resolverRemetente: async () => REMETENTE_DE_TESTE },
  });

  assertEquals(desfecho, { ok: false, motivo: "sem_destinatario" });
  assertEquals(
    chamadas.some((c) => c.tipo === "rpc" && c.nome === "reivindicar_email_de_confirmacao"),
    false,
    "sem para onde mandar, a reserva não pode ser gasta — fica disponível para o dia em que o dado aparecer",
  );
});

// --- a trava anti-duplicata: reserva -----------------------------------------

Deno.test("reserva falha (erro de banco) -> envio_falhou", async () => {
  const pedido = { id: UUID_PEDIDO, customer_data: { email: "cliente@exemplo.com" } };
  const supabase = clienteFalso({ pedido, erroReserva: { message: "connection reset" } });

  const desfecho = await enviarComprovantePedido({
    supabase: supabase as never,
    orderId: UUID_PEDIDO,
    deps: { resolverRemetente: async () => REMETENTE_DE_TESTE },
  });

  assertEquals(desfecho, { ok: false, motivo: "envio_falhou" });
});

Deno.test("reserva devolve false ('já enviado') -> ja_enviado, e o e-mail NUNCA é tentado", async () => {
  const pedido = { id: UUID_PEDIDO, customer_data: { email: "cliente@exemplo.com" } };
  const supabase = clienteFalso({ pedido, reservou: false });
  let enviarEmailChamado = false;

  const desfecho = await enviarComprovantePedido({
    supabase: supabase as never,
    orderId: UUID_PEDIDO,
    deps: {
      resolverRemetente: async () => REMETENTE_DE_TESTE,
      enviarEmail: async () => {
        enviarEmailChamado = true;
      },
    },
  });

  assertEquals(desfecho, { ok: false, motivo: "ja_enviado" });
  assertEquals(enviarEmailChamado, false, "a trava é a reserva, e ela venceu ANTES de qualquer tentativa de envio");
});

Deno.test("reserva concedida -> a RPC 'reivindicar_email_de_confirmacao' é chamada com p_order_id certo, e o desfecho é ok:true", async () => {
  const pedido = { id: UUID_PEDIDO, customer_data: { email: "cliente@exemplo.com" } };
  const chamadas: Chamada[] = [];
  const supabase = clienteFalso({ pedido, reservou: true, chamadas });

  const desfecho = await enviarComprovantePedido({
    supabase: supabase as never,
    orderId: UUID_PEDIDO,
    deps: { resolverRemetente: async () => REMETENTE_DE_TESTE, enviarEmail: async () => {} },
  });

  assertEquals(desfecho, { ok: true });
  const chamadaReserva = chamadas.find(
    (c) => c.tipo === "rpc" && c.nome === "reivindicar_email_de_confirmacao",
  ) as { args: Record<string, unknown> } | undefined;
  assertEquals(chamadaReserva?.args.p_order_id, UUID_PEDIDO);
});

// --- sucesso: envia e devolve ok:true ----------------------------------------

Deno.test("leitura dos itens falha depois de reservar -> não envia, libera a reserva e permite tentar de novo", async () => {
  const chamadas: Chamada[] = [];
  const opcoes = {
    pedido: { id: UUID_PEDIDO, customer_data: { email: "cliente@exemplo.com" } },
    erroLeituraItens: { message: "connection reset" } as unknown,
    itens: [{ product_name: "Produto", quantity: 1, price: 10 }],
    chamadas,
  };
  const cliente = clienteFalso(opcoes);
  let reservado = false;
  let envios = 0;
  const supabase = {
    ...cliente,
    rpc: async (nome: string, args: Record<string, unknown>) => {
      const resultado = await cliente.rpc(nome, args);
      if (nome === "reivindicar_email_de_confirmacao") {
        const ganhou = !reservado;
        reservado = true;
        return { data: ganhou, error: null };
      }
      if (nome === "liberar_email_de_confirmacao") reservado = false;
      return resultado;
    },
  };
  const enviar = () => enviarComprovantePedido({
    supabase: supabase as never,
    orderId: UUID_PEDIDO,
    deps: {
      resolverRemetente: async () => REMETENTE_DE_TESTE,
      enviarEmail: async () => { envios++; },
    },
  });

  assertEquals(await enviar(), { ok: false, motivo: "envio_falhou" });
  assertEquals(envios, 0);
  assertEquals(reservado, false);
  assertEquals(chamadas.at(-1), {
    tipo: "rpc", nome: "liberar_email_de_confirmacao", args: { p_order_id: UUID_PEDIDO },
  });
  opcoes.erroLeituraItens = null;
  assertEquals(await enviar(), { ok: true });
  assertEquals(envios, 1);
});

Deno.test("reserva concedida + SMTP configurado -> envia com o texto certo e devolve ok:true", async () => {
  const pedido = {
    id: UUID_PEDIDO,
    customer_data: { email: "cliente@exemplo.com" },
    subtotal: 100,
    total: 100,
    payment_method: "pix",
    payment_status: "aguardando",
  };
  const itens = [{ product_name: "Blusa", quantity: 1, price: 100 }];
  const chamadasEnvio: Array<{ para: string; assunto: string; html: string }> = [];
  const supabase = clienteFalso({
    pedido,
    itens,
    storeConfig: { store_name: "Loja Teste" },
    reservou: true,
  });

  const desfecho = await enviarComprovantePedido({
    supabase: supabase as never,
    orderId: UUID_PEDIDO,
    deps: {
      resolverRemetente: async () => REMETENTE_DE_TESTE,
      enviarEmail: async (args) => {
        chamadasEnvio.push(args);
      },
    },
  });

  assertEquals(desfecho, { ok: true });
  assertEquals(chamadasEnvio.length, 1);
  assertEquals(chamadasEnvio[0].para, "cliente@exemplo.com");
  assertStringIncludes(chamadasEnvio[0].assunto, "Loja Teste");
  assertStringIncludes(chamadasEnvio[0].html, "Blusa");
});

// --- RETIRADA NA LOJA (release 1.5.3): o e-mail diz ONDE retirar ------------
//
// O pedido de retirada nasce (migration 20261169000000) com
// customer_data.shipping_option_id = 'store-pickup' e o RETRATO do endereço
// da loja em customer_data.pickup_address. O comprovante tem de mostrar
// "Retirada na loja" + esse endereço + o aviso neutro de esperar a loja (sem
// prazo inventado), e o endereço da CLIENTE continua lá, rotulado como dela
// — nunca "Entrega em", que prometeria uma entrega que não existe.

async function htmlDoPedidoEnviado(
  customerData: Record<string, unknown>,
): Promise<string> {
  const chamadasEnvio: Array<{ para: string; assunto: string; html: string }> = [];
  const supabase = clienteFalso({
    pedido: {
      id: UUID_PEDIDO,
      customer_data: { email: "cliente@exemplo.com", ...customerData },
      subtotal: 100,
      shipping: 0,
      total: 100,
      payment_method: "cash",
      payment_status: null,
    },
    itens: [{ product_name: "Blusa", quantity: 1, price: 100 }],
    storeConfig: { store_name: "Loja Teste" },
    reservou: true,
  });
  const desfecho = await enviarComprovantePedido({
    supabase: supabase as never,
    orderId: UUID_PEDIDO,
    deps: {
      resolverRemetente: async () => REMETENTE_DE_TESTE,
      enviarEmail: async (args) => {
        chamadasEnvio.push(args);
      },
    },
  });
  assertEquals(desfecho, { ok: true });
  return chamadasEnvio[0].html;
}

Deno.test("retirada na loja -> e-mail mostra 'Retirada na loja' + endereço da loja + aviso neutro; o da cliente fica rotulado como dela", async () => {
  const html = await htmlDoPedidoEnviado({
    shipping_option_id: "store-pickup",
    pickup_address: "Rua Ficticia da Loja, 100 - Centro",
    street: "Rua da Cliente",
    number: "7",
    city: "Cidade Teste",
    state: "MG",
    cep: "38500-000",
  });
  assertStringIncludes(html, "Retirada na loja");
  assertStringIncludes(html, "Rua Ficticia da Loja, 100 - Centro");
  assertStringIncludes(html, "Aguarde a confirmação da loja para retirar");
  assertStringIncludes(html, "Endereço do cliente");
  assertStringIncludes(html, "Rua da Cliente");
  assertEquals(html.includes("Entrega em"), false);
});

Deno.test("entrega local (controle) -> e-mail segue com 'Entrega em' e SEM bloco de retirada", async () => {
  const html = await htmlDoPedidoEnviado({
    shipping_option_id: "local-delivery",
    street: "Rua da Cliente",
    number: "7",
  });
  assertStringIncludes(html, "Entrega em");
  assertEquals(html.includes("Retirada na loja"), false);
  assertEquals(html.includes("Aguarde a confirmação da loja"), false);
});

Deno.test("id de retirada SEM o retrato do endereço (pedido forjado/antigo) -> não inventa endereço de retirada", async () => {
  const html = await htmlDoPedidoEnviado({
    shipping_option_id: "store-pickup",
    street: "Rua da Cliente",
    number: "7",
  });
  assertStringIncludes(html, "Retirada na loja");
  assertStringIncludes(html, "Aguarde a confirmação da loja para retirar");
  assertStringIncludes(html, "Endereço do cliente");
});

// --- canal presencial: o canal sai do BANCO e chega ao e-mail ----------------
//
// Os testes de htmlDoPedido passam o canal na mão; este prova a única linha
// que liga as duas pontas (a coluna `canal` no select e o
// `canal: String(pedido.canal ?? "online")` do montador) — ressalva da
// revisão de C4.3.

Deno.test("pedido com canal 'presencial' no banco -> o e-mail abre com 'Compra na loja'; sem canal, não", async () => {
  async function htmlEnviadoPara(canal: string | undefined): Promise<string> {
    const pedido: Record<string, unknown> = {
      id: UUID_PEDIDO,
      customer_data: { email: "cliente@exemplo.com" },
      subtotal: 100,
      total: 100,
      payment_method: "cash",
      payment_status: "recebido_na_entrega",
    };
    if (canal !== undefined) pedido.canal = canal;
    const chamadasEnvio: Array<{ para: string; assunto: string; html: string }> = [];
    const supabase = clienteFalso({
      pedido,
      itens: [{ product_name: "Blusa", quantity: 1, price: 100 }],
      storeConfig: { store_name: "Loja Teste" },
      reservou: true,
    });
    const desfecho = await enviarComprovantePedido({
      supabase: supabase as never,
      orderId: UUID_PEDIDO,
      deps: {
        resolverRemetente: async () => REMETENTE_DE_TESTE,
        enviarEmail: async (args) => {
          chamadasEnvio.push(args);
        },
      },
    });
    assertEquals(desfecho, { ok: true });
    assertEquals(chamadasEnvio.length, 1);
    return chamadasEnvio[0].html;
  }

  assertStringIncludes(await htmlEnviadoPara("presencial"), "Compra na loja");
  assertEquals((await htmlEnviadoPara(undefined)).includes("Compra na loja"), false);
});

// --- D3: a forma de pagamento do e-mail do BALCÃO não fala de entrega --------
//
// Defeito medido (spec do balcão, 28/09): venda de balcão pelo caminho real
// (`enviarComprovantePedido`, canal lido do banco) saía com "Dinheiro na
// entrega" / "PIX na entrega" / "Cartão na entrega". Aqui a ponta inteira:
// coluna `canal` -> montador -> `htmlDoPedido` -> rótulo no HTML enviado.

async function htmlDoComprovante(
  paymentMethod: string,
  canal: string | undefined,
  valores: Record<string, unknown> = {},
): Promise<string> {
  const pedido: Record<string, unknown> = {
    id: UUID_PEDIDO,
    customer_data: { email: "cliente@exemplo.com" },
    subtotal: 100,
    total: 100,
    payment_method: paymentMethod,
    payment_status: "recebido_na_entrega",
    ...valores,
  };
  if (canal !== undefined) pedido.canal = canal;
  const enviados: Array<{ para: string; assunto: string; html: string }> = [];
  const supabase = clienteFalso({
    pedido,
    itens: [{ product_name: "Blusa", quantity: 1, price: 100 }],
    storeConfig: { store_name: "Loja Teste" },
    reservou: true,
  });
  const desfecho = await enviarComprovantePedido({
    supabase: supabase as never,
    orderId: UUID_PEDIDO,
    deps: {
      resolverRemetente: async () => REMETENTE_DE_TESTE,
      enviarEmail: async (args) => {
        enviados.push(args);
      },
    },
  });
  assertEquals(desfecho, { ok: true });
  assertEquals(enviados.length, 1);
  return enviados[0].html;
}

Deno.test("e-mail do BALCÃO diz a forma real paga na loja e nunca 'na entrega'", async () => {
  const dinheiro = await htmlDoComprovante("cash", "presencial");
  assertStringIncludes(dinheiro, "Forma de pagamento");
  assertStringIncludes(dinheiro, ">Dinheiro<");
  const pix = await htmlDoComprovante("pix", "presencial");
  assertStringIncludes(pix, ">PIX<");
  const cartao = await htmlDoComprovante("card", "presencial");
  assertStringIncludes(cartao, "Cartão na maquininha");
  for (const html of [dinheiro, pix, cartao]) {
    assertEquals(html.toLowerCase().includes("na entrega"), false);
  }
});

Deno.test("e-mail do SITE (não presencial) segue com o texto de sempre: 'na entrega' (não-regressão do D3)", async () => {
  assertStringIncludes(await htmlDoComprovante("cash", undefined), "Dinheiro na entrega");
  assertStringIncludes(await htmlDoComprovante("cash", "online"), "Dinheiro na entrega");
  assertStringIncludes(await htmlDoComprovante("pix", "online"), "PIX na entrega");
  assertStringIncludes(await htmlDoComprovante("card", "online"), "Cartão na entrega");
});

// --- Cupom de 100%: pedido de R$ 0,00 diz "Sem valor a pagar" (15/10/2026) ----
//
// Mesma regra das telas. O pedido segue gravado como "pagar na entrega"; só o
// TEXTO do comprovante muda.

Deno.test("e-mail de pedido de R$ 0,00 (cupom de 100%) diz 'Sem valor a pagar', nunca 'Dinheiro na entrega'", async () => {
  const zerado = { subtotal: 100, discount: 100, shipping: 0, total: 0 };
  for (const [metodo, canal] of [
    ["cash", undefined],
    ["pix", undefined],
    ["card", "online"],
    ["online", undefined],
    ["cash", "presencial"],
  ] as const) {
    const html = await htmlDoComprovante(metodo, canal, zerado);
    assertStringIncludes(html, "Forma de pagamento");
    assertStringIncludes(html, ">Sem valor a pagar<");
    assertEquals(html.toLowerCase().includes("na entrega"), false);
    assertEquals(html.includes("Dinheiro"), false);
  }
});

Deno.test("CONTROLE do e-mail: o mesmo pedido com total 10 e 100 mantém o texto de antes", async () => {
  assertStringIncludes(
    await htmlDoComprovante("cash", undefined, { subtotal: 10, total: 10 }),
    "Dinheiro na entrega",
  );
  assertStringIncludes(
    await htmlDoComprovante("cash", undefined, {}),
    "Dinheiro na entrega",
  );
  assertEquals(
    (await htmlDoComprovante("cash", undefined, { subtotal: 10, total: 10 })).includes("Sem valor a pagar"),
    false,
  );
  // Linha com total 0 mas a conta não fecha (150 - 0 + 20): NÃO é sem valor.
  assertStringIncludes(
    await htmlDoComprovante("cash", undefined, { subtotal: 150, discount: 0, shipping: 20, total: 0 }),
    "Dinheiro na entrega",
  );
});

// --- PIX pelo site: a abertura do e-mail depende do STATUS, não só do MÉTODO
//
// Achado de revisão de contexto limpo, 25/08/2026: mutar `comprovante.ts:331-
// 333` para `String(pedido.payment_method ?? "") === "online"` — removendo a
// checagem de `payment_status` — passava pelos 339 testes existentes. Nenhum
// deles chegava ao ramo `"online"`: o único teste de sucesso usa
// `payment_method: "pix"`. O par abaixo força os dois lados de
// `aguardandoPagamento` a se distinguirem por TEXTO real, não por selo — se o
// mutante voltar, um dos dois asserts abaixo cai.

Deno.test("PIX pelo site JÁ PAGO -> abertura de CONFIRMADO, nunca a de 'aguardando'", async () => {
  const pedido = {
    id: UUID_PEDIDO,
    customer_data: { email: "cliente@exemplo.com" },
    subtotal: 100,
    total: 100,
    payment_method: "online",
    payment_status: "pago",
  };
  const itens = [{ product_name: "Blusa", quantity: 1, price: 100 }];
  const chamadasEnvio: Array<{ para: string; assunto: string; html: string }> = [];
  const supabase = clienteFalso({
    pedido,
    itens,
    storeConfig: { store_name: "Loja Teste" },
    reservou: true,
  });

  const desfecho = await enviarComprovantePedido({
    supabase: supabase as never,
    orderId: UUID_PEDIDO,
    deps: {
      resolverRemetente: async () => REMETENTE_DE_TESTE,
      enviarEmail: async (args) => {
        chamadasEnvio.push(args);
      },
    },
  });

  assertEquals(desfecho, { ok: true });
  assertEquals(chamadasEnvio.length, 1);
  assertStringIncludes(
    chamadasEnvio[0].html,
    "Recebemos seu pedido. Guarde este e-mail: ele é o resumo do que você comprou.",
  );
  assertEquals(
    chamadasEnvio[0].html.includes("está aguardando a confirmação do pagamento"),
    false,
    "pedido online JÁ PAGO não pode dizer que está aguardando confirmação",
  );
});

Deno.test("PIX pelo site AINDA aguardando pagamento -> abertura de 'aguardando', nunca a de confirmado", async () => {
  const pedido = {
    id: UUID_PEDIDO,
    customer_data: { email: "cliente@exemplo.com" },
    subtotal: 100,
    total: 100,
    payment_method: "online",
    payment_status: "aguardando",
  };
  const itens = [{ product_name: "Blusa", quantity: 1, price: 100 }];
  const chamadasEnvio: Array<{ para: string; assunto: string; html: string }> = [];
  const supabase = clienteFalso({
    pedido,
    itens,
    storeConfig: { store_name: "Loja Teste" },
    reservou: true,
  });

  const desfecho = await enviarComprovantePedido({
    supabase: supabase as never,
    orderId: UUID_PEDIDO,
    deps: {
      resolverRemetente: async () => REMETENTE_DE_TESTE,
      enviarEmail: async (args) => {
        chamadasEnvio.push(args);
      },
    },
  });

  assertEquals(desfecho, { ok: true });
  assertEquals(chamadasEnvio.length, 1);
  assertStringIncludes(
    chamadasEnvio[0].html,
    "Recebemos seu pedido e ele está aguardando a confirmação do pagamento. Assim que o pagamento for confirmado, ele entra na fila de separação.",
  );
  assertEquals(
    chamadasEnvio[0].html.includes("Guarde este e-mail: ele é o resumo do que você comprou"),
    false,
    "pedido online AINDA aguardando pagamento não pode dizer que está confirmado",
  );
});

// --- VARIAÇÃO (tamanho/cor) no e-mail do pedido -------------------------------
//
// Defeito medido (caçada de 14/10/2026): o banco grava como nome do item só o
// nome do PRODUTO; quem comprava o mesmo vestido em P e em G recebia duas
// linhas idênticas. A variação mora em `product_variants` (name = "Tamanho",
// value = "M") e o item do pedido a aponta por `variant_id`. A busca é UMA por
// pedido (em lote) e NUNCA derruba o envio: falhou, o e-mail sai com o nome
// simples, como sempre saiu.

const VARIANTE_P = "aaaaaaaa-0000-4000-8000-000000000001";
const VARIANTE_G = "aaaaaaaa-0000-4000-8000-000000000002";
const VARIANTE_APAGADA = "aaaaaaaa-0000-4000-8000-0000000000ff";

async function enviarComItens(
  itens: Array<Record<string, unknown>>,
  extras: {
    variantes?: Array<Record<string, unknown>>;
    falhaVariantes?: "erro" | "lanca" | "rejeita";
  } = {},
) {
  const consultasDeVariantes: Array<{ colunas: string; coluna: string; ids: unknown[] }> = [];
  const chamadas: Chamada[] = [];
  const enviados: Array<{ para: string; assunto: string; html: string }> = [];
  const supabase = clienteFalso({
    pedido: {
      id: UUID_PEDIDO,
      customer_data: { email: "cliente@exemplo.com" },
      subtotal: 200,
      total: 200,
      payment_method: "pix",
      payment_status: "aguardando",
    },
    itens,
    storeConfig: { store_name: "Loja Teste" },
    reservou: true,
    chamadas,
    consultasDeVariantes,
    ...extras,
  });
  const desfecho = await enviarComprovantePedido({
    supabase: supabase as never,
    orderId: UUID_PEDIDO,
    deps: {
      resolverRemetente: async () => REMETENTE_DE_TESTE,
      enviarEmail: async (args) => {
        enviados.push(args);
      },
    },
  });
  return { desfecho, enviados, consultasDeVariantes, chamadas };
}

const DOIS_TAMANHOS = [
  { product_name: "Vestido Midi Linho", quantity: 1, price: 100, variant_id: VARIANTE_P },
  { product_name: "Vestido Midi Linho", quantity: 1, price: 100, variant_id: VARIANTE_G },
];
const VARIANTES_P_E_G = [
  { id: VARIANTE_P, name: "Tamanho", value: "P" },
  { id: VARIANTE_G, name: "Tamanho", value: "G" },
];

Deno.test("mesmo vestido em P e em G -> o e-mail mostra os DOIS tamanhos, em linhas distintas", async () => {
  const { desfecho, enviados } = await enviarComItens(DOIS_TAMANHOS, {
    variantes: VARIANTES_P_E_G,
  });
  assertEquals(desfecho, { ok: true });
  assertEquals(enviados.length, 1);
  assertStringIncludes(enviados[0].html, "1× Vestido Midi Linho – Tamanho: P");
  assertStringIncludes(enviados[0].html, "1× Vestido Midi Linho – Tamanho: G");
});

Deno.test("a busca de variação é UMA por pedido (em lote, ids sem repetição) e só na tabela product_variants", async () => {
  const itens = [
    ...DOIS_TAMANHOS,
    // O mesmo tamanho P comprado em outra linha: o id não pode ir duas vezes.
    { product_name: "Blusa", quantity: 1, price: 50, variant_id: VARIANTE_P },
    // Item sem variação não entra na lista de ids.
    { product_name: "Cinto", quantity: 1, price: 30, variant_id: null },
  ];
  const { enviados, consultasDeVariantes } = await enviarComItens(itens, {
    variantes: VARIANTES_P_E_G,
  });
  assertEquals(enviados.length, 1);
  assertEquals(consultasDeVariantes.length, 1, "uma consulta por pedido, nunca uma por item");
  assertEquals(consultasDeVariantes[0].coluna, "id");
  assertEquals(consultasDeVariantes[0].colunas, "id, name, value");
  assertEquals(consultasDeVariantes[0].ids, [VARIANTE_P, VARIANTE_G]);
  // O item sem variação segue com o nome simples.
  assertStringIncludes(enviados[0].html, "1× Cinto");
  assertEquals(enviados[0].html.includes("Cinto –"), false);
});

for (const falha of ["erro", "lanca", "rejeita"] as const) {
  Deno.test(`busca de variação FALHA (${falha}) -> o e-mail SAI igual, com o nome simples, e o desfecho é ok:true`, async () => {
    const { desfecho, enviados, chamadas } = await enviarComItens(DOIS_TAMANHOS, {
      variantes: VARIANTES_P_E_G,
      falhaVariantes: falha,
    });
    assertEquals(desfecho, { ok: true });
    assertEquals(enviados.length, 1, "a falha da busca extra nunca pode derrubar o envio");
    assertEquals(enviados[0].html.includes("Tamanho"), false);
    assertStringIncludes(enviados[0].html, "1× Vestido Midi Linho");
    // A reserva NÃO foi devolvida: o e-mail saiu, o pedido está avisado.
    assertEquals(
      chamadas.some((c) => c.tipo === "rpc" && c.nome === "liberar_email_de_confirmacao"),
      false,
    );
  });
}

Deno.test("variação apagada/ausente da resposta -> só aquele item cai no nome simples; os demais mantêm o tamanho", async () => {
  const itens = [
    { product_name: "Vestido Midi Linho", quantity: 1, price: 100, variant_id: VARIANTE_P },
    { product_name: "Saia Antiga", quantity: 1, price: 80, variant_id: VARIANTE_APAGADA },
  ];
  const { desfecho, enviados } = await enviarComItens(itens, {
    variantes: [VARIANTES_P_E_G[0]],
  });
  assertEquals(desfecho, { ok: true });
  assertStringIncludes(enviados[0].html, "1× Vestido Midi Linho – Tamanho: P");
  assertStringIncludes(enviados[0].html, "1× Saia Antiga");
  assertEquals(enviados[0].html.includes("Saia Antiga –"), false);
});

Deno.test("pedido SEM variação (itens sem variant_id) -> nenhuma consulta extra e o texto dos itens é o de sempre", async () => {
  const { desfecho, enviados, consultasDeVariantes, chamadas } = await enviarComItens([
    { product_name: "Blusa", quantity: 2, price: 100 },
    { product_name: "Cinto", quantity: 1, price: 30, variant_id: null },
  ]);
  assertEquals(desfecho, { ok: true });
  assertEquals(consultasDeVariantes.length, 0);
  assertEquals(chamadas.some((c) => c.nome === "product_variants"), false);
  assertStringIncludes(enviados[0].html, "2× Blusa");
  assertStringIncludes(enviados[0].html, "1× Cinto");
  assertEquals(enviados[0].html.includes(" – "), false);
});

Deno.test("nome e valor da variação são texto digitado: entram ESCAPADOS no e-mail", async () => {
  const { enviados } = await enviarComItens(
    [{ product_name: "Blusa", quantity: 1, price: 100, variant_id: VARIANTE_P }],
    { variantes: [{ id: VARIANTE_P, name: "Cor", value: "<b>Azul</b> & Cia" }] },
  );
  assertEquals(enviados[0].html.includes("<b>Azul</b>"), false);
  assertStringIncludes(enviados[0].html, "Cor: &lt;b&gt;Azul&lt;/b&gt; &amp; Cia");
});

// --- falha no envio: libera a reserva ----------------------------------------

Deno.test("envio de e-mail falha -> libera a reserva (RPC 'liberar_email_de_confirmacao'), devolve envio_falhou", async () => {
  const pedido = {
    id: UUID_PEDIDO,
    customer_data: { email: "cliente@exemplo.com" },
    payment_method: "pix",
  };
  const chamadas: Chamada[] = [];
  const supabase = clienteFalso({
    pedido,
    itens: [],
    storeConfig: { store_name: "Loja Teste" },
    reservou: true,
    chamadas,
  });

  const desfecho = await enviarComprovantePedido({
    supabase: supabase as never,
    orderId: UUID_PEDIDO,
    deps: {
      resolverRemetente: async () => REMETENTE_DE_TESTE,
      enviarEmail: async () => {
        throw new Error("SMTP: envio recusado");
      },
    },
  });

  assertEquals(desfecho, { ok: false, motivo: "envio_falhou" });
  const chamadaLiberacao = chamadas.find(
    (c) => c.tipo === "rpc" && c.nome === "liberar_email_de_confirmacao",
  ) as { args: Record<string, unknown> } | undefined;
  assertEquals(
    chamadaLiberacao?.args.p_order_id,
    UUID_PEDIDO,
    "sem liberar, o pedido ficaria marcado 'já avisado' para sempre e o cliente sem comprovante nenhum",
  );
});

// 26/09/2026 — cartão pelo app: o comprovante diz a forma que o cliente usou
// de fato (metodo_online), não "PIX pelo site" para todo pedido online.
Deno.test("cartão de crédito pelo app -> o comprovante diz cartão, nunca PIX", async () => {
  const pedido = {
    id: UUID_PEDIDO,
    customer_data: { email: "cliente@exemplo.com" },
    subtotal: 100,
    total: 100,
    payment_method: "online",
    metodo_online: "credito",
    payment_status: "pago",
  };
  const chamadasEnvio: Array<{ para: string; assunto: string; html: string }> = [];
  const supabase = clienteFalso({
    pedido,
    itens: [{ product_name: "Blusa", quantity: 1, price: 100 }],
    storeConfig: { store_name: "Loja Teste" },
    reservou: true,
  });
  const desfecho = await enviarComprovantePedido({
    supabase: supabase as never,
    orderId: UUID_PEDIDO,
    deps: {
      resolverRemetente: async () => REMETENTE_DE_TESTE,
      enviarEmail: async (args) => {
        chamadasEnvio.push(args);
      },
    },
  });
  assertEquals(desfecho, { ok: true });
  assertStringIncludes(chamadasEnvio[0].html, "Cartão de crédito pelo site");
  assertEquals(chamadasEnvio[0].html.includes("PIX pelo site"), false);
});

// --- o remetente resolvido (e-mail da loja no painel, 14/10/2026) -----------

Deno.test("o remetente resolvido sai da `resolverRemetente` com o MESMO supabase, e e' ELE que chega ao envio", async () => {
  const supabase = clienteFalso({
    pedido: {
      id: UUID_PEDIDO,
      customer_data: { email: "cliente@exemplo.com" },
      subtotal: 100,
      total: 100,
      payment_method: "pix",
      payment_status: "aguardando",
    },
    itens: [{ product_name: "Blusa", quantity: 1, price: 100 }],
    reservou: true,
  });
  const doPainel = { ...REMETENTE_DE_TESTE, origem: "painel", usuario: "painel@gmail.com" };
  const recebidoPeloResolvedor: unknown[] = [];
  const recebidoPeloEnvio: unknown[] = [];

  const desfecho = await enviarComprovantePedido({
    supabase: supabase as never,
    orderId: UUID_PEDIDO,
    deps: {
      resolverRemetente: async (cliente: unknown) => {
        recebidoPeloResolvedor.push(cliente);
        return doPainel;
      },
      enviarEmail: async (_mensagem: unknown, remetente: unknown) => {
        recebidoPeloEnvio.push(remetente);
      },
    },
  });

  assertEquals(desfecho, { ok: true });
  assertEquals(recebidoPeloResolvedor, [supabase]);
  assertEquals(recebidoPeloEnvio, [doPainel]);
});

Deno.test("resolvedor REAL sem remetente nenhum (sem cofre e sem SMTP no ambiente) -> sem_remetente, e NADA e' lido nem reservado", async () => {
  const guardados = ["SMTP_USER", "SMTP_PASSWORD", "MP_CHAVES_ENCRYPTION_KEY"].map(
    (nome) => [nome, Deno.env.get(nome)] as const,
  );
  for (const [nome] of guardados) Deno.env.delete(nome);
  try {
    const chamadas: Chamada[] = [];
    const desfecho = await enviarComprovantePedido({
      supabase: clienteFalso({ chamadas }) as never,
      orderId: UUID_PEDIDO,
    });
    assertEquals(desfecho, { ok: false, motivo: "sem_remetente" });
    assertEquals(chamadas.length, 0);
  } finally {
    for (const [nome, valor] of guardados) {
      if (valor === undefined) Deno.env.delete(nome);
      else Deno.env.set(nome, valor);
    }
  }
});

// --- O ENDEREÇO DA COMPRA (migration 20261229): o e-mail mostra o da COMPRA ---
//
// Antes da migration 20261229 o pedido de quem tem conta só guardava o ponteiro
// (`address_id`); a migration passou a gravar também uma CÓPIA em
// `customer_data.address` (objeto, 8 chaves). O comprovante lia a linha ATUAL de
// `user_addresses` e, se ela tinha sido apagada, caía na raiz de `customer_data`,
// onde `pegar("street", "address")` transformava o OBJETO da cópia em texto:
// "[object Object] · 38500100". Agora ele PREFERE a cópia (como o mapper do
// front, a etiqueta e o antifraude), depois a linha da conta, depois o formato
// antigo — e nunca converte objeto em texto.

const COPIA_DA_COMPRA = {
  cep: "38600-123",
  street: "Rua das Acácias",
  number: "120",
  complement: "Apto 301",
  neighborhood: "Jardim Primavera",
  city: "Paracatu",
  state: "MG",
};
const LINHA_EDITADA_DEPOIS = {
  street: "Avenida Nova Demais",
  number: "999",
  complement: null,
  neighborhood: "Bairro Que Nao Existia",
  city: "Outra Cidade",
  state: "SP",
  cep: "01310-100",
};

async function htmlComEndereco(args: {
  customerData: Record<string, unknown>;
  addressId?: string | null;
  linhaDaConta?: Record<string, unknown> | null;
  chamadas?: Chamada[];
}): Promise<string> {
  const chamadasEnvio: Array<{ para: string; assunto: string; html: string }> = [];
  const supabase = clienteFalso({
    pedido: {
      id: UUID_PEDIDO,
      customer_data: { email: "cliente@exemplo.com", ...args.customerData },
      address_id: args.addressId ?? null,
      subtotal: 100,
      shipping: 0,
      total: 100,
      payment_method: "cash",
      payment_status: null,
    },
    itens: [{ product_name: "Blusa", quantity: 1, price: 100 }],
    storeConfig: { store_name: "Loja Teste" },
    endereco: args.linhaDaConta ?? null,
    chamadas: args.chamadas,
    reservou: true,
  });
  const desfecho = await enviarComprovantePedido({
    supabase: supabase as never,
    orderId: UUID_PEDIDO,
    deps: {
      resolverRemetente: async () => REMETENTE_DE_TESTE,
      enviarEmail: async (args) => {
        chamadasEnvio.push(args);
      },
    },
  });
  assertEquals(desfecho, { ok: true });
  return chamadasEnvio[0].html;
}

Deno.test("endereço da conta APAGADO depois da compra + cópia no pedido -> o e-mail mostra rua, número e bairro certos (nunca '[object Object]')", async () => {
  const html = await htmlComEndereco({
    customerData: { address: COPIA_DA_COMPRA, destination_cep: "38600123" },
    addressId: "addr-apagado",
    linhaDaConta: null, // ON DELETE SET NULL no pedido, ou a linha some do select
  });
  assertStringIncludes(html, "Rua das Acácias, 120");
  assertStringIncludes(html, "Apto 301");
  assertStringIncludes(html, "Jardim Primavera");
  assertStringIncludes(html, "Paracatu - MG");
  assertStringIncludes(html, "38600-123");
  assertEquals(html.includes("[object Object]"), false);
});

Deno.test("endereço da conta EDITADO depois da compra -> o e-mail mostra o da COMPRA (a cópia), não o da linha atual", async () => {
  const html = await htmlComEndereco({
    customerData: { address: COPIA_DA_COMPRA },
    addressId: "addr-1",
    linhaDaConta: LINHA_EDITADA_DEPOIS,
  });
  assertStringIncludes(html, "Rua das Acácias, 120");
  assertEquals(html.includes("Avenida Nova Demais"), false);
  assertEquals(html.includes("Bairro Que Nao Existia"), false);
  assertEquals(html.includes("[object Object]"), false);
});

Deno.test("pedido ANTIGO (sem cópia) de quem tem conta -> segue lendo a linha atual de user_addresses, igual a antes", async () => {
  const chamadas: Chamada[] = [];
  const html = await htmlComEndereco({
    customerData: { address: null },
    addressId: "addr-1",
    linhaDaConta: LINHA_EDITADA_DEPOIS,
    chamadas,
  });
  assertStringIncludes(html, "Avenida Nova Demais, 999");
  assertStringIncludes(html, "Outra Cidade - SP");
  assertEquals(html.includes("[object Object]"), false);
  assertEquals(
    chamadas.some((c) => c.tipo === "from" && c.nome === "user_addresses"),
    true,
    "sem cópia, a linha da conta é consultada",
  );
});

Deno.test("pedido ANTIGO (sem cópia) com a linha da conta apagada -> cai no formato antigo da raiz de customer_data, igual a antes", async () => {
  const html = await htmlComEndereco({
    customerData: {
      address: "Rua Antiga do Convidado",
      number: "55",
      neighborhood: "Centro Velho",
      destination_cep: "38500100",
    },
    addressId: "addr-apagado",
    linhaDaConta: null,
  });
  assertStringIncludes(html, "Rua Antiga do Convidado, 55");
  assertStringIncludes(html, "Centro Velho");
  assertStringIncludes(html, "38500100");
  assertEquals(html.includes("[object Object]"), false);
});

Deno.test("CONVIDADO (cópia em customer_data.address, sem address_id) -> o e-mail mostra a rua em vez de '[object Object]'", async () => {
  const chamadas: Chamada[] = [];
  const html = await htmlComEndereco({
    customerData: { address: COPIA_DA_COMPRA, destination_cep: "38600123" },
    addressId: null,
    chamadas,
  });
  assertStringIncludes(html, "Rua das Acácias, 120");
  assertStringIncludes(html, "Jardim Primavera");
  assertEquals(html.includes("[object Object]"), false);
  assertEquals(
    chamadas.some((c) => c.tipo === "from" && c.nome === "user_addresses"),
    false,
    "sem address_id nenhuma linha de conta é lida",
  );
});

Deno.test("objeto em customer_data.address que NÃO serve (vazio, sem nenhuma chave de endereço) + nada mais -> sem endereço, e NUNCA vira texto", async () => {
  const html = await htmlComEndereco({
    customerData: { address: {}, destination_cep: "38500100" },
    addressId: null,
  });
  assertEquals(html.includes("[object Object]"), false);
  assertStringIncludes(html, "38500100");
  const html2 = await htmlComEndereco({
    customerData: { address: { foo: { bar: 1 } } },
    addressId: "addr-apagado",
    linhaDaConta: null,
  });
  assertEquals(html2.includes("[object Object]"), false);
});

Deno.test("cópia inutilizável + linha da conta existente -> a linha da conta ainda socorre (a cópia só vale quando tem endereço)", async () => {
  const html = await htmlComEndereco({
    customerData: { address: {} },
    addressId: "addr-1",
    linhaDaConta: LINHA_EDITADA_DEPOIS,
  });
  assertStringIncludes(html, "Avenida Nova Demais, 999");
});

Deno.test("fonteDoEnderecoDoComprovante: preferência cópia > linha da conta > raiz; da raiz só entram valores simples (texto/número)", () => {
  assertEquals(
    fonteDoEnderecoDoComprovante({ address: COPIA_DA_COMPRA }, LINHA_EDITADA_DEPOIS),
    COPIA_DA_COMPRA,
  );
  assertEquals(
    fonteDoEnderecoDoComprovante({ address: null }, LINHA_EDITADA_DEPOIS),
    LINHA_EDITADA_DEPOIS,
  );
  assertEquals(
    fonteDoEnderecoDoComprovante(
      { address: ["lista", "nao", "e", "copia"], number: "5", ok: true, nested: { a: 1 } },
      null,
    ),
    { number: "5" },
  );
  assertEquals(fonteDoEnderecoDoComprovante(null, null), null);
  assertEquals(fonteDoEnderecoDoComprovante({}, null), null);
});
