import {
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.177.0/testing/asserts.ts";
import { enviarComprovantePedido } from "./comprovante.ts";

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
  itens?: Array<Record<string, unknown>>;
  storeConfig?: Record<string, unknown> | null;
  endereco?: Record<string, unknown> | null;
  reservou?: boolean;
  erroReserva?: unknown;
  chamadas?: Chamada[];
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
        return { data: opts.itens ?? [], error: null };
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
        select(_colunas: string) {
          return {
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
    deps: { remetenteConfigurado: () => false },
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
    deps: { remetenteConfigurado: () => true },
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
    deps: { remetenteConfigurado: () => true },
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
    deps: { remetenteConfigurado: () => true },
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
    deps: { remetenteConfigurado: () => true },
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
      remetenteConfigurado: () => true,
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
    deps: { remetenteConfigurado: () => true, enviarEmail: async () => {} },
  });

  assertEquals(desfecho, { ok: true });
  const chamadaReserva = chamadas.find(
    (c) => c.tipo === "rpc" && c.nome === "reivindicar_email_de_confirmacao",
  ) as { args: Record<string, unknown> } | undefined;
  assertEquals(chamadaReserva?.args.p_order_id, UUID_PEDIDO);
});

// --- sucesso: envia e devolve ok:true ----------------------------------------

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
      remetenteConfigurado: () => true,
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
      remetenteConfigurado: () => true,
      enviarEmail: async (args) => {
        chamadasEnvio.push(args);
      },
    },
  });

  assertEquals(desfecho, { ok: true });
  assertEquals(chamadasEnvio.length, 1);
  assertStringIncludes(
    chamadasEnvio[0].html,
    "Recebemos seu pedido. Guarde este e-mail: ele e o resumo do que voce comprou.",
  );
  assertEquals(
    chamadasEnvio[0].html.includes("esta aguardando a confirmacao do pagamento"),
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
      remetenteConfigurado: () => true,
      enviarEmail: async (args) => {
        chamadasEnvio.push(args);
      },
    },
  });

  assertEquals(desfecho, { ok: true });
  assertEquals(chamadasEnvio.length, 1);
  assertStringIncludes(
    chamadasEnvio[0].html,
    "Recebemos seu pedido e ele esta aguardando a confirmacao do pagamento. Assim que o PIX for confirmado, ele entra na fila de separacao.",
  );
  assertEquals(
    chamadasEnvio[0].html.includes("Guarde este e-mail: ele e o resumo do que voce comprou"),
    false,
    "pedido online AINDA aguardando pagamento não pode dizer que está confirmado",
  );
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
      remetenteConfigurado: () => true,
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
