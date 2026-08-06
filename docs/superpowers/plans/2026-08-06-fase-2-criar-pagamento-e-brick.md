# Fase 2 — criar o pagamento, mostrar o Brick e armar a expiração

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Data:** 06/08/2026 · **Issues:** `CHECKOUT-010` #109, `CHECKOUT-040` #110, `CHECKOUT-050` #111
**Spec:** [`2026-08-06-gateway-mercadopago-design.md`](../specs/2026-08-06-gateway-mercadopago-design.md)
**Fase anterior:** [`2026-08-06-fase-1-reserva-e-expiracao.md`](2026-08-06-fase-1-reserva-e-expiracao.md) — aplicada em produção, `develop` @ `5fc134f`

**Goal:** o cliente escolhe pagar online, o site gera a cobrança no Mercado Pago (PIX
com QR code e copia-e-cola, ou cartão tokenizado no navegador) e o pedido nasce com
prazo de 30 minutos — **atrás de uma flag desligada em produção**, porque nada
confirma pagamento até a Fase 3.

**Architecture:** o front chama a RPC que já existe, recebe o `order_id`, e então chama
uma edge function nova (`criar-pagamento`) que lê o pedido com service role, fala com a
API do Mercado Pago e grava `gateway_payment_id`. O `MP_ACCESS_TOKEN` vive só no
ambiente da function; o navegador só vê a *public key*, que é pública por desenho. O
Brick renderiza dentro de um componente próprio, fora do `CheckoutView` de 1.177 linhas.

**Tech Stack:** Deno (edge functions), MercadoPago.js v2 via CDN, React 18 + Vite,
Supabase JS v2, testes em `deno test` e `vitest`.

---

## Duas correções ao desenho, decididas antes de escrever este plano

Nenhuma das duas estava na spec, e as duas mudam o que a Fase 2 entrega. Estão aqui no
topo porque quem executar tarefa por tarefa precisa saber disso antes da Task 1.

### 1. A Fase 2 NÃO pode ligar a expiração para o cliente real

A spec diz *"e a troca da RPC para a v24, que é o que arma a reserva com prazo"*. Se
isso for para produção como caminho padrão, **todo pedido pago expira em 30 minutos**,
porque quem escreve `payment_status = 'pago'` é o webhook — e o webhook é a Fase 3. O
resultado seria pior que hoje: o cliente paga, o `pg_cron` cancela o pedido em até 5
minutos depois do prazo e devolve o estoque.

É o mesmo erro que a Fase 1 evitou no último momento, pelo mesmo motivo, e está escrito
na spec: *"prazo de pagamento só faz sentido junto do meio de pagar"*. A Fase 2 traz o
meio de pagar, mas não traz a confirmação.

**Decisão:** todo o caminho novo fica atrás da flag de build `VITE_PAGAMENTO_ONLINE`,
que **falha fechada** — qualquer valor diferente da string `"true"`, inclusive ausente,
mantém o checkout de hoje (os três botões "na entrega" e a `create_marketplace_order_v23`,
sem prazo). A flag fica ligada só no ambiente de Preview da Vercel, onde o teste
acontece com credenciais de teste do MP. **Quem liga em produção é a Fase 3**, e ligar é
mudar uma variável de ambiente, não fazer deploy de código.

Consequência a dizer com todas as letras: **no fim da Fase 2 a loja em produção continua
exatamente como hoje.** O que muda é que existe um caminho pronto, exercitável no
Preview, esperando o webhook.

### 2. A CSP de `vercel.json` bloqueia o Brick hoje

Medido em `vercel.json:36`. A política atual é `script-src 'self' …` sem
`sdk.mercadopago.com`, `connect-src` sem `api.mercadopago.com`, e **sem diretiva
`frame-src`** — o que faz os iframes do Brick caírem no `default-src 'self'` e serem
recusados. Sem mexer nisso, o Brick não renderiza nem no Preview, e a falha aparece como
container vazio, não como erro claro.

A Task 4 trata disso, e a verificação dela é olhar o console do navegador — não basta o
build passar.

---

## Global Constraints

Valem para todas as tarefas, implicitamente.

- **`MP_ACCESS_TOKEN` nunca chega ao front.** Nada de `VITE_MP_ACCESS_TOKEN`, nada de
  ler o token em código sob `src/`. O que vai ao navegador é `VITE_MP_PUBLIC_KEY`, que é
  a chave pública do MP, feita para o bundle.
- **Só credenciais de TESTE nesta fase.** A public key de teste começa com `TEST-`. Se o
  valor em mãos não começar com `TEST-`, pare e pergunte — produção é decisão da Fase 3.
- **Deploy de edge function sempre com o nome da função:**
  `supabase functions deploy criar-pagamento`. Sem o nome, publica todas as do diretório.
- **`criar-pagamento` usa o `verify_jwt` padrão (`true`) — deploy SEM `--no-verify-jwt`.**
  A flag `--no-verify-jwt` é da `webhook-mercadopago`, que é Fase 3. Trocar isso derruba
  a proteção; foi assim que o OTP caiu uma vez (#162).
- **Nenhuma migration nesta fase.** A Fase 1 já criou colunas, funções, índices e o
  agendamento. Se alguma tarefa parecer precisar de migration, o plano está errado —
  pare e devolva para o Gabriel.
- **Nunca rodar `supabase db push`** neste repositório (42 arquivos locais nunca
  aplicados, 28 versões no ledger sem arquivo).
- **Terminal do Gabriel é PowerShell 5.1:** comandos entregues a ele não usam `&&`, `rm -rf`,
  `mkdir -p` nem caminho `/tmp`.
- **Testes de edge function não tocam rede.** O padrão do repositório é exportar as
  funções puras de `index.ts` e testá-las direto, como em
  `supabase/functions/notify-new-order/index_test.ts`.
- **Commit por tarefa**, mensagem em português no padrão do repositório
  (`feat(edge): …`, `feat(checkout): …`), validada pelo `scripts/commitlint-mensagem.mjs`.

---

## File Structure

| arquivo | responsabilidade |
| --- | --- |
| `supabase/functions/_shared/mercadopago.ts` | **criar** — cliente da API do MP: monta o corpo, chama, classifica erro, mapeia status. Sem `serve()`, sem estado global. Padrão de `_shared/webpush.ts`. |
| `supabase/functions/_shared/mercadopago_test.ts` | **criar** — testes do cliente, com `fetch` injetado. |
| `supabase/functions/criar-pagamento/index.ts` | **criar** — a function: valida entrada, autoriza, lê o pedido com service role, chama o cliente, grava `gateway_payment_id`, devolve ao front só o que o Brick precisa. |
| `supabase/functions/criar-pagamento/index_test.ts` | **criar** — testes das funções puras da function. |
| `src/types/index.ts` | **modificar** — `PaymentStatus` novo; `PaymentMethod` ganha `"online"`. |
| `src/types/database.types.ts` | **modificar** — as três colunas da Fase 1, que os tipos gerados ainda não têm (`grep -c payment_status` = 0). |
| `src/hooks/useOrders.ts:885-940` | **modificar** — `createOrder` escolhe v23 ou v24; `criarPagamento` novo. |
| `src/components/checkout/PagamentoOnline.tsx` | **criar** — carrega o SDK, renderiza o Brick, devolve o resultado ao pai. Isolado de propósito: o `CheckoutView` tem 1.177 linhas. |
| `tests/front/pagamento-online.test.tsx` | **criar** — testes do componente com o SDK stubado. |
| `src/views/customer/CheckoutView.tsx` | **modificar** — sob a flag, troca os três botões pelo componente e mostra a tela de "aguardando pagamento". |
| `vercel.json:36` | **modificar** — CSP libera os domínios do Mercado Pago. |
| `.env.example` | **modificar** — documenta `VITE_MP_PUBLIC_KEY` e `VITE_PAGAMENTO_ONLINE`. |

---

## Task 0 — Portão: o que o Gabriel confirma antes de existir código

**Esta tarefa não é de subagente e não tem commit.** É o primeiro passo que a própria
spec manda dar: *"se faltar, o cronograma muda antes de qualquer código"*.

- [ ] **Passo 1: a conta do Mercado Pago pode cobrar PIX via API?**

Ter conta não é ter o escopo. No painel do MP, em *Seu negócio → Configurações → Chave
PIX*, precisa existir chave cadastrada e a conta precisa estar habilitada para receber
PIX. Sem isso, `POST /v1/payments` com `payment_method_id: "pix"` responde 400 e a fase
inteira muda de forma.

- [ ] **Passo 2: onde o dinheiro passa a cair?**

Com Mercado Pago o valor entra no **saldo do MP**, não direto na conta bancária. Se hoje
o PIX cai direto no banco, isso é uma mudança operacional real: saque vira um passo, com
prazo e possível taxa. Confirmar que está aceito.

- [ ] **Passo 3: pegar as credenciais de TESTE**

Painel do MP → *Suas integrações* → a aplicação → *Credenciais de teste*. Anotar as duas:

| credencial | onde vive | formato |
| --- | --- | --- |
| Access token de teste | segredo da edge function | `TEST-…` |
| Public key de teste | `VITE_MP_PUBLIC_KEY` no Preview da Vercel | `TEST-…` |

- [ ] **Passo 4: gravar o segredo no Supabase**

```bash
supabase secrets set MP_ACCESS_TOKEN=TEST-cole-o-token-aqui --project-ref cafkrminfnokvgjqtkle
```

- [ ] **Passo 5: confirmar que o segredo entrou**

```bash
supabase secrets list --project-ref cafkrminfnokvgjqtkle
```

Esperado: `MP_ACCESS_TOKEN` na lista, com digest. O valor não é exibido — é isso mesmo.

**Se o Passo 1 falhar, pare o plano aqui** e devolva ao Gabriel: sem PIX via API, a
decisão 2 da spec (PIX + cartão) precisa ser revista antes de qualquer código.

---

## Task 1: cliente da API do Mercado Pago

**Files:**
- Create: `supabase/functions/_shared/mercadopago.ts`
- Test: `supabase/functions/_shared/mercadopago_test.ts`

**Interfaces:**
- Consumes: nada de tarefas anteriores; só o `MP_ACCESS_TOKEN` do ambiente, e mesmo esse
  é recebido por parâmetro, não lido aqui dentro.
- Produces:
  - `mapearStatus(status: string): string | null` — as saídas possíveis são
    `"pago" | "recusado" | "aguardando" | "estornado" | null`, mas o parâmetro é
    `string` solto de propósito: o valor da função é aceitar o que o MP inventar
    amanhã e devolver `null`. Não existe `MpStatus` — tipar a entrada como união de
    literais tornaria impossível escrever o teste do status desconhecido, e nada
    neste repositório tipa edge function (`@ts-nocheck` + `--no-check` + o
    `tsconfig.app.json` que só inclui `src` e `tests/front`). O guarda real é o
    `CHECK` `marketplace_orders_payment_status_check`.
  - `montarCorpoPix(args: { orderId: string; valor: number; descricao: string; email: string; expiraEm: string }): Record<string, unknown>`
  - `montarCorpoCartao(args: { orderId: string; valor: number; descricao: string; email: string; token: string; parcelas: number; metodo: string; emissor?: string; documento?: { type: string; number: string } }): Record<string, unknown>`

> **`orderId` vira `external_reference` no corpo enviado ao MP.** Não estava no
> desenho original e entrou na revisão da Task 1: sem ele o Mercado Pago não guarda
> ponteiro de volta para o pedido, e a reconciliação da Fase 3 — que este plano
> promete como rede para cobrança órfã — seria casamento manual por valor + e-mail +
> horário. **Quem chama tem de passar**, e nada no repositório avisa se esquecer:
> `JSON.stringify` simplesmente descarta a chave `undefined`.
  - `formatarExpiracao(iso: string): string` — ISO com offset, que é o que o MP exige
  - `criarPagamento(args: { token: string; corpo: Record<string, unknown>; chaveIdempotencia: string; fetchImpl?: typeof fetch; baseUrl?: string }): Promise<{ ok: true; id: string; status: string; qrCode?: string; qrCodeBase64?: string; ticketUrl?: string } | { ok: false; erro: string; status: number }>`

- [ ] **Step 1: escrever os testes que falham**

Crie `supabase/functions/_shared/mercadopago_test.ts`:

```ts
// @ts-nocheck
/**
 * Testes do cliente do Mercado Pago (CHECKOUT-010, #109).
 *
 * Nada aqui toca a rede: `criarPagamento` recebe o `fetch` por parâmetro, e os
 * testes passam um stub. O que se prova é o que erra caro — corpo com valor
 * errado cobra o cliente errado, e status mal mapeado marca como pago um
 * pedido recusado.
 */
import {
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.177.0/testing/asserts.ts";
import {
  criarPagamento,
  formatarExpiracao,
  mapearStatus,
  montarCorpoCartao,
  montarCorpoPix,
} from "./mercadopago.ts";

Deno.test("mapearStatus traduz o que o MP devolve", () => {
  assertEquals(mapearStatus("approved"), "pago");
  assertEquals(mapearStatus("rejected"), "recusado");
  assertEquals(mapearStatus("cancelled"), "recusado");
  assertEquals(mapearStatus("pending"), "aguardando");
  assertEquals(mapearStatus("in_process"), "aguardando");
  assertEquals(mapearStatus("authorized"), "aguardando");
  assertEquals(mapearStatus("refunded"), "estornado");
  assertEquals(mapearStatus("charged_back"), "estornado");
});

Deno.test("mapearStatus devolve null para o que não conhece", () => {
  // Vale mais que um default otimista: status novo do MP não pode virar
  // 'pago' por engano. Quem chama decide o que fazer com o desconhecido.
  for (const desconhecido of ["", "qualquer_coisa", "APPROVED", null, undefined]) {
    assertEquals(mapearStatus(desconhecido as string), null);
  }
});

Deno.test("montarCorpoPix leva valor, e-mail e validade", () => {
  const corpo = montarCorpoPix({
    valor: 149.9,
    descricao: "Pedido 3f2a1b8c",
    email: "cliente@exemplo.com",
    expiraEm: "2026-08-06T15:30:00.000-03:00",
  });

  assertEquals(corpo.transaction_amount, 149.9);
  assertEquals(corpo.payment_method_id, "pix");
  assertEquals((corpo.payer as Record<string, unknown>).email, "cliente@exemplo.com");
  assertEquals(corpo.date_of_expiration, "2026-08-06T15:30:00.000-03:00");
});

Deno.test("montarCorpoCartao leva o token e NUNCA dados do cartão", () => {
  const corpo = montarCorpoCartao({
    valor: 149.9,
    descricao: "Pedido 3f2a1b8c",
    email: "cliente@exemplo.com",
    token: "tok_teste_123",
    parcelas: 3,
    metodo: "visa",
    emissor: "310",
    documento: { type: "CPF", number: "12345678909" },
  });

  assertEquals(corpo.token, "tok_teste_123");
  assertEquals(corpo.installments, 3);
  assertEquals(corpo.payment_method_id, "visa");
  assertEquals(corpo.issuer_id, "310");

  // O número do cartão é tokenizado NO NAVEGADOR e não passa por aqui. Se
  // algum dia passar, este teste é o que avisa.
  const serializado = JSON.stringify(corpo);
  assertEquals(serializado.includes("card_number"), false);
  assertEquals(serializado.includes("security_code"), false);
});

Deno.test("formatarExpiracao devolve ISO com offset, que é o que o MP aceita", () => {
  const saida = formatarExpiracao("2026-08-06T18:30:00.000Z");
  // O MP recusa 'Z' e exige offset explícito.
  assertEquals(saida.endsWith("Z"), false);
  assertStringIncludes(saida, "2026-08-06T");
  assertEquals(/[+-]\d{2}:\d{2}$/.test(saida), true);
});

Deno.test("criarPagamento manda o token e a chave de idempotência", async () => {
  let capturada: { url: string; init: RequestInit } | null = null;

  const fetchStub = ((url: string, init: RequestInit) => {
    capturada = { url, init };
    return Promise.resolve(
      new Response(
        JSON.stringify({
          id: 1234567890,
          status: "pending",
          point_of_interaction: {
            transaction_data: {
              qr_code: "00020126…",
              qr_code_base64: "iVBORw0KGgo=",
              ticket_url: "https://www.mercadopago.com.br/payments/123/ticket",
            },
          },
        }),
        { status: 201 },
      ),
    );
  }) as unknown as typeof fetch;

  const r = await criarPagamento({
    token: "TEST-token",
    corpo: { transaction_amount: 10 },
    chaveIdempotencia: "3f2a1b8c-4d5e-4f60-9a7b-1c2d3e4f5a6b",
    fetchImpl: fetchStub,
  });

  assertEquals(r.ok, true);
  if (r.ok) {
    // id vira string: o MP devolve número, e a coluna é text.
    assertEquals(r.id, "1234567890");
    assertEquals(r.status, "pending");
    assertEquals(r.qrCode, "00020126…");
  }

  const headers = capturada!.init.headers as Record<string, string>;
  assertEquals(headers.Authorization, "Bearer TEST-token");
  assertEquals(headers["X-Idempotency-Key"], "3f2a1b8c-4d5e-4f60-9a7b-1c2d3e4f5a6b");
  assertStringIncludes(capturada!.url, "/v1/payments");
});

Deno.test("criarPagamento não vaza o corpo do erro do MP para quem chamou", async () => {
  const fetchStub = (() =>
    Promise.resolve(
      new Response(
        JSON.stringify({ message: "invalid access token", cause: [{ code: 2001 }] }),
        { status: 401 },
      ),
    )) as unknown as typeof fetch;

  const r = await criarPagamento({
    token: "TEST-errado",
    corpo: {},
    chaveIdempotencia: "id-1",
    fetchImpl: fetchStub,
  });

  assertEquals(r.ok, false);
  if (!r.ok) {
    assertEquals(r.status, 401);
    // Mensagem genérica: o detalhe do gateway vai para o log da função, não
    // para o navegador do cliente.
    assertEquals(r.erro.includes("access token"), false);
  }
});

Deno.test("criarPagamento trata rede caída sem estourar", async () => {
  const fetchStub = (() =>
    Promise.reject(new Error("connection refused"))) as unknown as typeof fetch;

  const r = await criarPagamento({
    token: "TEST-token",
    corpo: {},
    chaveIdempotencia: "id-2",
    fetchImpl: fetchStub,
  });

  assertEquals(r.ok, false);
  if (!r.ok) assertEquals(r.status, 0);
});
```

- [ ] **Step 2: rodar e ver falhar**

```bash
deno test --allow-all --no-check supabase/functions/_shared/mercadopago_test.ts
```

Esperado: FAIL — `Module not found "./mercadopago.ts"`.

- [ ] **Step 3: escrever o cliente**

Crie `supabase/functions/_shared/mercadopago.ts`:

```ts
// @ts-nocheck
/**
 * Cliente da API do Mercado Pago, compartilhado entre as edge functions.
 *
 * POR QUE ELE EXISTE SEPARADO DA FUNCTION
 *
 * A `criar-pagamento` (Fase 2) e a `webhook-mercadopago` (Fase 3) falam com a
 * mesma API e precisam do MESMO mapa de status. Duplicar esse mapa é como este
 * repositório chegou a ter a regra de frete grátis escrita em sete lugares
 * (#53) — e aqui a divergência silenciosa marcaria pedido como pago quando o
 * MP disse outra coisa. Mesmo motivo do `_shared/webpush.ts`.
 *
 * `fetch` entra por parâmetro para o teste não tocar rede.
 */

const BASE_URL_PADRAO = "https://api.mercadopago.com";

/**
 * Traduz o status do MP para o `payment_status` deste banco.
 *
 * Devolve `null` para o que não conhece, DE PROPÓSITO: um status novo do MP
 * não pode virar 'pago' por default otimista. Quem chama decide — e o que a
 * `criar-pagamento` faz é registrar e deixar o pedido em 'aguardando', que é o
 * estado que a expiração já sabe tratar.
 */
export function mapearStatus(status: string): string | null {
  switch (status) {
    case "approved":
      return "pago";
    case "rejected":
    case "cancelled":
      return "recusado";
    case "pending":
    case "in_process":
    case "authorized":
      return "aguardando";
    case "refunded":
    case "charged_back":
      return "estornado";
    default:
      return null;
  }
}

/**
 * O MP recusa `date_of_expiration` terminado em 'Z' — exige offset explícito.
 * A loja é de Monte Carmelo/MG, então o offset é o de São Paulo (-03:00), que
 * não tem horário de verão desde 2019.
 */
export function formatarExpiracao(iso: string): string {
  const d = new Date(iso);
  const deslocado = new Date(d.getTime() - 3 * 60 * 60 * 1000);
  return `${deslocado.toISOString().replace("Z", "")}-03:00`;
}

export function montarCorpoPix(args: {
  valor: number;
  descricao: string;
  email: string;
  expiraEm: string;
}): Record<string, unknown> {
  return {
    transaction_amount: args.valor,
    description: args.descricao,
    payment_method_id: "pix",
    date_of_expiration: args.expiraEm,
    payer: { email: args.email },
  };
}

export function montarCorpoCartao(args: {
  valor: number;
  descricao: string;
  email: string;
  token: string;
  parcelas: number;
  metodo: string;
  emissor?: string;
  documento?: { type: string; number: string };
}): Record<string, unknown> {
  const payer: Record<string, unknown> = { email: args.email };
  if (args.documento) payer.identification = args.documento;

  const corpo: Record<string, unknown> = {
    transaction_amount: args.valor,
    description: args.descricao,
    token: args.token,
    installments: args.parcelas,
    payment_method_id: args.metodo,
    payer,
  };
  if (args.emissor) corpo.issuer_id = args.emissor;
  return corpo;
}

export async function criarPagamento(args: {
  token: string;
  corpo: Record<string, unknown>;
  chaveIdempotencia: string;
  fetchImpl?: typeof fetch;
  baseUrl?: string;
}): Promise<
  | {
      ok: true;
      id: string;
      status: string;
      qrCode?: string;
      qrCodeBase64?: string;
      ticketUrl?: string;
    }
  | { ok: false; erro: string; status: number }
> {
  const f = args.fetchImpl ?? fetch;
  const base = args.baseUrl ?? BASE_URL_PADRAO;

  let resposta: Response;
  try {
    resposta = await f(`${base}/v1/payments`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${args.token}`,
        "Content-Type": "application/json",
        // Sem isso, um retry do nosso lado cobra o cliente duas vezes.
        "X-Idempotency-Key": args.chaveIdempotencia,
      },
      body: JSON.stringify(args.corpo),
    });
  } catch (_err) {
    // status 0 = nem chegou a haver resposta HTTP.
    return { ok: false, erro: "Falha ao falar com o gateway.", status: 0 };
  }

  if (!resposta.ok) {
    // O corpo do erro do MP vai para o log da função, NUNCA para o cliente:
    // ele carrega detalhe de credencial e de conta.
    const detalhe = await resposta.text().catch(() => "");
    console.error("mercadopago: recusou", resposta.status, detalhe);
    return {
      ok: false,
      erro: "Não foi possível gerar a cobrança.",
      status: resposta.status,
    };
  }

  const json = await resposta.json();
  const dados = json?.point_of_interaction?.transaction_data ?? {};

  return {
    ok: true,
    // A coluna gateway_payment_id é text e o MP devolve número.
    id: String(json.id),
    status: String(json.status),
    qrCode: dados.qr_code,
    qrCodeBase64: dados.qr_code_base64,
    ticketUrl: dados.ticket_url,
  };
}
```

- [ ] **Step 4: rodar e ver passar**

```bash
deno test --allow-all --no-check supabase/functions/_shared/mercadopago_test.ts
```

Esperado: 8 passed.

- [ ] **Step 5: rodar a suíte inteira de edge, para não ter quebrado vizinho**

```bash
npm run test:edge
```

Esperado: os testes que já existiam continuam passando, mais os 8 novos.

- [ ] **Step 6: commit**

```bash
git add supabase/functions/_shared/mercadopago.ts supabase/functions/_shared/mercadopago_test.ts
```

```bash
git commit -m "feat(edge): cliente da API do Mercado Pago, com fetch injetavel"
```

---

## Task 2: edge function `criar-pagamento`

**Files:**
- Create: `supabase/functions/criar-pagamento/index.ts`
- Test: `supabase/functions/criar-pagamento/index_test.ts`

**Interfaces:**
- Consumes: de `../_shared/mercadopago.ts` — `criarPagamento`, `formatarExpiracao`,
  `montarCorpoPix`, `montarCorpoCartao`, `mapearStatus`.
- Produces (exportadas para o teste, no padrão da `notify-new-order`):
  - `pareceUuid(v: unknown): boolean`
  - `podeCobrar(pedido: { payment_status: string | null; expires_at: string | null; gateway_payment_id: string | null }, agora: Date): { ok: true } | { ok: false; motivo: string }`
  - `donoConfere(pedido: { user_id: string | null }, sub: string | null): boolean`
  - `descricaoDoPedido(orderId: string): string`
- Produces (contrato HTTP, que a Task 3 consome):
  - `POST` com `{ orderId: string, metodo: "pix" }`
    ou `{ orderId: string, metodo: "cartao", token: string, parcelas: number, paymentMethodId: string, issuerId?: string, email: string, documento?: {type,number} }`
  - `200` → `{ paymentId: string, status: string, expiraEm: string, qrCode?: string, qrCodeBase64?: string, ticketUrl?: string }`
  - `4xx` → `{ error: string }`

> **`expiraEm` vem daqui e de mais lugar nenhum.** A RPC de criação devolve só o
> `uuid` do pedido — o front **não** sabe o prazo depois de criar. Deixar a tela
> calcular `agora + 30min` por conta própria produziria um relógio que discorda do
> banco, e o cliente veria "vence às 15:31" num pedido que o `pg_cron` mata às 15:30.
> Quem tem o valor verdadeiro é esta function, que leu a linha.

- [ ] **Step 1: escrever os testes que falham**

Crie `supabase/functions/criar-pagamento/index_test.ts`:

```ts
// @ts-nocheck
/**
 * Testes da criar-pagamento (CHECKOUT-010, #109).
 *
 * Prova a parte que decide SE pode cobrar e DE QUEM — que é onde erro custa
 * caro: cobrar duas vezes o mesmo pedido, cobrar pedido já expirado, ou deixar
 * um estranho disparar cobrança do pedido de outra pessoa.
 *
 * A chamada ao MP em si já é coberta pelos testes de _shared/mercadopago.ts.
 */
import { assertEquals } from "https://deno.land/std@0.177.0/testing/asserts.ts";
import {
  descricaoDoPedido,
  donoConfere,
  pareceUuid,
  podeCobrar,
} from "./index.ts";

const UUID = "3f2a1b8c-4d5e-4f60-9a7b-1c2d3e4f5a6b";
const AGORA = new Date("2026-08-06T12:00:00.000Z");

Deno.test("aceita UUID e recusa o que não é", () => {
  assertEquals(pareceUuid(UUID), true);
  assertEquals(pareceUuid(UUID.toUpperCase()), true);
  for (const ruim of ["", null, undefined, 42, "1; DROP TABLE marketplace_orders", `${UUID} `]) {
    assertEquals(pareceUuid(ruim), false, `deveria recusar: ${String(ruim)}`);
  }
});

Deno.test("podeCobrar aceita pedido aguardando e dentro do prazo", () => {
  const r = podeCobrar(
    {
      payment_status: "aguardando",
      expires_at: "2026-08-06T12:20:00.000Z",
      gateway_payment_id: null,
    },
    AGORA,
  );
  assertEquals(r.ok, true);
});

Deno.test("podeCobrar recusa pedido que já tem cobrança", () => {
  // Sem isto, um duplo clique gera dois PIX para o mesmo pedido e o cliente
  // pode pagar os dois.
  const r = podeCobrar(
    {
      payment_status: "aguardando",
      expires_at: "2026-08-06T12:20:00.000Z",
      gateway_payment_id: "1234567890",
    },
    AGORA,
  );
  assertEquals(r.ok, false);
});

Deno.test("podeCobrar recusa pedido fora do prazo", () => {
  const r = podeCobrar(
    {
      payment_status: "aguardando",
      expires_at: "2026-08-06T11:59:00.000Z",
      gateway_payment_id: null,
    },
    AGORA,
  );
  assertEquals(r.ok, false);
});

Deno.test("podeCobrar recusa qualquer payment_status que não seja aguardando", () => {
  for (const st of ["pago", "recusado", "expirado", "estornado", "pago_apos_expirar", null]) {
    const r = podeCobrar(
      { payment_status: st, expires_at: "2026-08-06T12:20:00.000Z", gateway_payment_id: null },
      AGORA,
    );
    assertEquals(r.ok, false, `deveria recusar payment_status=${String(st)}`);
  }
});

Deno.test("podeCobrar recusa pedido sem prazo carimbado", () => {
  // Pedido criado pela v23 (flag desligada) não tem expires_at. Cobrar um
  // desses criaria cobrança que a expiração nunca varre.
  const r = podeCobrar(
    { payment_status: "aguardando", expires_at: null, gateway_payment_id: null },
    AGORA,
  );
  assertEquals(r.ok, false);
});

Deno.test("donoConfere: pedido de usuário logado exige o mesmo usuário", () => {
  assertEquals(donoConfere({ user_id: UUID }, UUID), true);
  assertEquals(donoConfere({ user_id: UUID }, "outro-sub"), false);
  assertEquals(donoConfere({ user_id: UUID }, null), false);
});

Deno.test("donoConfere: pedido de convidado passa sem sessão", () => {
  // Checkout de convidado é suportado (v24 grava user_id NULL). A proteção
  // dele não é a sessão — é a janela de 30 min do expires_at, checada em
  // podeCobrar.
  assertEquals(donoConfere({ user_id: null }, null), true);
  assertEquals(donoConfere({ user_id: null }, UUID), true);
});

Deno.test("descricaoDoPedido não vaza o id inteiro", () => {
  const d = descricaoDoPedido(UUID);
  assertEquals(d.includes(UUID), false);
  assertEquals(d.includes("3f2a1b8c"), true);
});
```

- [ ] **Step 2: rodar e ver falhar**

```bash
deno test --allow-all --no-check supabase/functions/criar-pagamento/index_test.ts
```

Esperado: FAIL — `Module not found "./index.ts"`.

- [ ] **Step 3: escrever a function**

Crie `supabase/functions/criar-pagamento/index.ts`:

```ts
// @ts-nocheck
/**
 * criar-pagamento — cria a cobrança no Mercado Pago para um pedido já criado
 * (CHECKOUT-010 #109, CHECKOUT-050 #111).
 *
 * O QUE PROTEGE ESTA FUNÇÃO
 *
 * Ela roda com `verify_jwt` PADRÃO (true), então o Supabase já recusa quem não
 * manda um JWT válido do projeto. Atenção: a chave anon É um JWT válido — o
 * checkout de convidado passa por aqui, e é assim que tem que ser. Ou seja,
 * `verify_jwt` filtra tráfego de fora do projeto, e NÃO identifica o cliente.
 *
 * Quem identifica são as três checagens abaixo, nesta ordem:
 *
 * 1. `pareceUuid` — corta varredura antes de tocar o banco.
 * 2. `donoConfere` — pedido com `user_id` só é cobrado pelo próprio dono, lido
 *    do JWT. Pedido de convidado (`user_id` NULL) não tem dono a conferir.
 * 3. `podeCobrar` — o pedido precisa estar 'aguardando', dentro do prazo e SEM
 *    cobrança anterior. É o que impede duplo clique virar dois PIX, e o que
 *    limita a exposição de um pedido de convidado à janela de 30 minutos.
 *
 * O QUE ELA NÃO FAZ
 *
 * Não confirma pagamento. Nunca. Quem escreve 'pago' é o webhook (Fase 3), e é
 * por isso que esta função grava só `gateway_payment_id` e devolve o que o
 * Brick precisa desenhar.
 */
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  criarPagamento,
  formatarExpiracao,
  montarCorpoCartao,
  montarCorpoPix,
} from "../_shared/mercadopago.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

export function pareceUuid(v: unknown): boolean {
  return (
    typeof v === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)
  );
}

export function descricaoDoPedido(orderId: string): string {
  // Mesmo formato que o painel usa para falar de pedido com o lojista.
  return `Pedido ${orderId.slice(0, 8)}`;
}

export function donoConfere(
  pedido: { user_id: string | null },
  sub: string | null,
): boolean {
  if (pedido.user_id === null) return true;
  return pedido.user_id === sub;
}

export function podeCobrar(
  pedido: {
    payment_status: string | null;
    expires_at: string | null;
    gateway_payment_id: string | null;
  },
  agora: Date,
): { ok: true } | { ok: false; motivo: string } {
  if (pedido.payment_status !== "aguardando") {
    return { ok: false, motivo: "Este pedido não está aguardando pagamento." };
  }
  if (pedido.gateway_payment_id !== null) {
    return { ok: false, motivo: "Este pedido já tem uma cobrança gerada." };
  }
  if (pedido.expires_at === null) {
    return { ok: false, motivo: "Este pedido não tem prazo de pagamento." };
  }
  if (new Date(pedido.expires_at) <= agora) {
    return { ok: false, motivo: "O prazo para pagar este pedido acabou." };
  }
  return { ok: true };
}

function subDoToken(authorization: string | null): string | null {
  // Lê o `sub` sem validar assinatura DE PROPÓSITO: o gateway do Supabase já
  // validou (verify_jwt = true). Aqui só se extrai a identidade. Com a chave
  // anon não há `sub`, e o resultado é null — que é o caso do convidado.
  try {
    const token = (authorization ?? "").replace(/^Bearer\s+/i, "");
    const payload = JSON.parse(atob(token.split(".")[1]));
    return typeof payload.sub === "string" ? payload.sub : null;
  } catch {
    return null;
  }
}

async function handler(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const json = (corpo: unknown, status: number) =>
    new Response(JSON.stringify(corpo), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Corpo inválido." }, 400);
  }

  if (!pareceUuid(body.orderId)) return json({ error: "Pedido inválido." }, 400);
  if (body.metodo !== "pix" && body.metodo !== "cartao") {
    return json({ error: "Meio de pagamento inválido." }, 400);
  }

  const mpToken = Deno.env.get("MP_ACCESS_TOKEN");
  if (!mpToken) {
    console.error("criar-pagamento: MP_ACCESS_TOKEN ausente no ambiente");
    return json({ error: "Pagamento indisponível." }, 503);
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const { data: pedido, error } = await supabase
    .from("marketplace_orders")
    .select("id, user_id, total, payment_status, expires_at, gateway_payment_id, customer_data")
    .eq("id", body.orderId)
    .maybeSingle();

  // Mensagem igual para "não existe" e "não é seu": responder diferente
  // transformaria esta função em oráculo de quais ids existem.
  if (error || !pedido) return json({ error: "Pedido não encontrado." }, 404);

  const sub = subDoToken(req.headers.get("Authorization"));
  if (!donoConfere(pedido, sub)) return json({ error: "Pedido não encontrado." }, 404);

  const permitido = podeCobrar(pedido, new Date());
  if (!permitido.ok) return json({ error: permitido.motivo }, 409);

  const email =
    (body.email as string) ??
    (pedido.customer_data as Record<string, unknown>)?.email ??
    "sem-email@ikcous.com.br";

  const corpo =
    body.metodo === "pix"
      ? montarCorpoPix({
          orderId: pedido.id,
          valor: Number(pedido.total),
          descricao: descricaoDoPedido(pedido.id),
          email: String(email),
          expiraEm: formatarExpiracao(pedido.expires_at),
        })
      : montarCorpoCartao({
          orderId: pedido.id,
          valor: Number(pedido.total),
          descricao: descricaoDoPedido(pedido.id),
          email: String(email),
          token: String(body.token),
          parcelas: Number(body.parcelas ?? 1),
          metodo: String(body.paymentMethodId),
          emissor: body.issuerId ? String(body.issuerId) : undefined,
          documento: body.documento as { type: string; number: string } | undefined,
        });

  const r = await criarPagamento({
    token: mpToken,
    corpo,
    // O id do pedido como chave: um retry do front sobre o MESMO pedido não
    // cria uma segunda cobrança no MP.
    chaveIdempotencia: String(pedido.id),
  });

  if (!r.ok) return json({ error: r.erro }, 502);

  // Grava a cobrança. O WHERE repete a condição de podeCobrar porque entre a
  // leitura e agora o pg_cron pode ter expirado o pedido: se expirou, o
  // update não acha linha e a cobrança fica órfã no MP — que é o caso que a
  // reconciliação da Fase 3 resolve. Sobrescrever seria pior.
  const { data: gravado, error: erroUpdate } = await supabase
    .from("marketplace_orders")
    .update({ gateway_payment_id: r.id, updated_at: new Date().toISOString() })
    .eq("id", pedido.id)
    .eq("payment_status", "aguardando")
    .is("gateway_payment_id", null)
    .select("id")
    .maybeSingle();

  if (erroUpdate || !gravado) {
    console.error("criar-pagamento: cobrança criada mas não gravada", r.id, erroUpdate);
    return json({ error: "O prazo para pagar este pedido acabou." }, 409);
  }

  return json(
    {
      paymentId: r.id,
      status: r.status,
      // O prazo sai da LINHA DO BANCO, não de um cálculo no navegador: é o
      // mesmo instante que o pg_cron vai usar para cancelar.
      expiraEm: pedido.expires_at,
      qrCode: r.qrCode,
      qrCodeBase64: r.qrCodeBase64,
      ticketUrl: r.ticketUrl,
    },
    200,
  );
}

// O guard do runner de teste é COPIADO da notify-new-order (`:138-143`), e tem
// que ser esse mesmo: sem ele, `npm run test:edge` importa este módulo e sobe
// um servidor HTTP no meio da suíte. Não invente variável de ambiente — o
// repositório decide isso por `Deno.mainModule`.
const emTeste =
  Deno.mainModule.endsWith("_test.ts") ||
  Deno.mainModule.endsWith("_test.js") ||
  Deno.mainModule.includes("index_test");

if (!emTeste) serve(handler);

export { handler };
```

- [ ] **Step 4: rodar e ver passar**

```bash
deno test --allow-all --no-check supabase/functions/criar-pagamento/index_test.ts
```

Esperado: 9 passed. **Se o comando ficar pendurado sem terminar, o guard do
`Deno.mainModule` está errado** — a suíte subiu o servidor HTTP em vez de só importar.

- [ ] **Step 5: rodar a suíte de edge inteira**

```bash
npm run test:edge
```

Esperado: tudo verde, incluindo os testes que já existiam.

- [ ] **Step 6: publicar a function no projeto principal**

```bash
supabase functions deploy criar-pagamento --project-ref cafkrminfnokvgjqtkle
```

**Sem `--no-verify-jwt`.** Se a saída mencionar mais de uma função, você esqueceu o nome
— pare e confira.

- [ ] **Step 7: provar que está de pé e recusando o que deve recusar**

```bash
curl -i -X POST "https://cafkrminfnokvgjqtkle.functions.supabase.co/criar-pagamento" -H "Content-Type: application/json" -d "{\"orderId\":\"nao-e-uuid\",\"metodo\":\"pix\"}"
```

Esperado: `401` (sem JWT o gateway do Supabase corta antes da função). Isso **prova o
`verify_jwt`**. Depois, com a anon key:

```bash
curl -i -X POST "https://cafkrminfnokvgjqtkle.functions.supabase.co/criar-pagamento" -H "Content-Type: application/json" -H "Authorization: Bearer COLE_A_ANON_KEY" -d "{\"orderId\":\"nao-e-uuid\",\"metodo\":\"pix\"}"
```

Esperado: `400 {"error":"Pedido inválido."}`.

- [ ] **Step 8: commit**

```bash
git add supabase/functions/criar-pagamento/
```

```bash
git commit -m "feat(edge): criar-pagamento gera a cobranca do pedido no Mercado Pago"
```

---

## Task 3: tipos e camada de dados no front

**Files:**
- Modify: `src/types/index.ts:116`
- Modify: `src/types/database.types.ts` (bloco `marketplace_orders`, a partir de `:496`)
- Modify: `src/hooks/useOrders.ts:885-940`
- Modify: `.env.example`
- Test: `tests/front/pagamento-online.test.tsx` (o arquivo nasce aqui, cresce na Task 4)

**Interfaces:**
- Consumes: o contrato HTTP da Task 2.
- Produces:
  - `type PaymentStatus = "aguardando" | "pago" | "recusado" | "expirado" | "estornado" | "pago_apos_expirar"`
  - `PAGAMENTO_ONLINE_LIGADO: boolean` — exportado de `src/lib/flags.ts`
  - `createOrder(orderData, opts?: { comPagamentoOnline?: boolean })` — escolhe v23 ou v24
  - `criarPagamento(args: { orderId: string; metodo: "pix" | "cartao"; … }): Promise<RespostaPagamento>`

- [ ] **Step 1: escrever o teste da flag, que é o que falha fechado**

Crie `tests/front/pagamento-online.test.tsx`:

```tsx
import { describe, expect, it } from "vitest";
import { lerFlagPagamentoOnline } from "@/lib/flags";

describe("flag de pagamento online", () => {
  it("liga apenas com a string exata 'true'", () => {
    expect(lerFlagPagamentoOnline("true")).toBe(true);
  });

  it("fica desligada para tudo o mais — inclusive ausente", () => {
    // Falha fechada de propósito: enquanto o webhook não existe (Fase 3),
    // ligar por engano faz TODO pedido pago expirar em 30 minutos.
    for (const v of [undefined, "", "false", "TRUE", "1", "yes", " true"]) {
      expect(lerFlagPagamentoOnline(v)).toBe(false);
    }
  });
});
```

- [ ] **Step 2: rodar e ver falhar**

```bash
npx vitest run tests/front/pagamento-online.test.tsx
```

Esperado: FAIL — não existe `@/lib/flags`.

- [ ] **Step 3: criar a flag**

Crie `src/lib/flags.ts`:

```ts
/**
 * Flags de build do front.
 *
 * VITE_PAGAMENTO_ONLINE existe porque a Fase 2 entrega o caminho de cobrança
 * SEM a confirmação, que é a Fase 3. Se este caminho virar padrão antes do
 * webhook, todo pedido pago expira em 30 minutos e o pg_cron devolve o
 * estoque — pior que o problema que a Fase 1 consertou.
 *
 * Por isso ela falha fechada: só a string exata "true" liga.
 */
export function lerFlagPagamentoOnline(valor: string | undefined): boolean {
  return valor === "true";
}

export const PAGAMENTO_ONLINE_LIGADO = lerFlagPagamentoOnline(
  import.meta.env.VITE_PAGAMENTO_ONLINE,
);
```

- [ ] **Step 4: rodar e ver passar**

```bash
npx vitest run tests/front/pagamento-online.test.tsx
```

Esperado: 2 passed.

- [ ] **Step 5: acrescentar os tipos que a Fase 1 criou no banco e o front não conhece**

Em `src/types/index.ts`, depois da linha 116:

```ts
export type PaymentMethod = "pix" | "card" | "cash" | "online";

/**
 * Espelha a CHECK constraint marketplace_orders_payment_status_check, criada
 * na migration 20260807000000. Mudar aqui sem mudar lá (ou o contrário) é como
 * o pedido fica com estado que o banco recusa.
 */
export type PaymentStatus =
  | "aguardando"
  | "pago"
  | "recusado"
  | "expirado"
  | "estornado"
  | "pago_apos_expirar";
```

Em `src/types/database.types.ts`, no bloco `marketplace_orders` (`Row`, `Insert` e
`Update`), acrescente as três colunas — hoje `grep -c payment_status` devolve **0**,
porque os tipos não foram regerados depois da Fase 1:

```ts
          payment_status: string | null
          expires_at: string | null
          gateway_payment_id: string | null
```

- [ ] **Step 6: `createOrder` passa a escolher a RPC**

Em `src/hooks/useOrders.ts:885`, troque a assinatura e a chamada:

```ts
  const createOrder = useCallback(
    async (orderData: any, opts?: { comPagamentoOnline?: boolean }) => {
      // A v24 é idêntica à v23 no caminho do dinheiro — validação de preço,
      // estoque, frete e cupom são o mesmo corpo. A ÚNICA diferença é que ela
      // carimba payment_status='aguardando' e expires_at = now() + 30min.
      //
      // Por isso a escolha é do chamador e não uma troca global: pedido "na
      // entrega" não pode ganhar prazo, senão o pg_cron cancela venda legítima
      // — foi essa a correção que tirou a troca da Fase 1.
      const rpc = opts?.comPagamentoOnline
        ? "create_marketplace_order_v24"
        : "create_marketplace_order_v23";

      try {
        const { data, error } = await (supabase as any).rpc(rpc, {
```

O resto do corpo (o objeto de parâmetros, o `throw`, o `avisarLojista`, o `return`) fica
**idêntico** — as duas RPCs têm exatamente a mesma assinatura de 12 parâmetros.

- [ ] **Step 7: acrescentar `criarPagamento` ao hook**

Logo depois de `createOrder`, ainda em `src/hooks/useOrders.ts`:

```ts
  /**
   * Pede à edge function que crie a cobrança no Mercado Pago.
   *
   * Diferente do avisarLojista (PEDIDO-020), aqui o cliente ESPERA: sem a
   * resposta não há QR code para mostrar. Erro aqui não perde o pedido — ele
   * já está criado e expira sozinho em 30 minutos, que é a rede descrita na
   * spec.
   */
  const criarPagamento = useCallback(
    async (args: {
      orderId: string;
      metodo: "pix" | "cartao";
      token?: string;
      parcelas?: number;
      paymentMethodId?: string;
      issuerId?: string;
      email?: string;
      documento?: { type: string; number: string };
    }) => {
      const { data, error } = await (supabase as any).functions.invoke(
        "criar-pagamento",
        { body: args },
      );
      if (error) throw new Error("Não foi possível gerar a cobrança.");
      if (data?.error) throw new Error(data.error);
      return data as {
        paymentId: string;
        status: string;
        expiraEm: string;
        qrCode?: string;
        qrCodeBase64?: string;
        ticketUrl?: string;
      };
    },
    [],
  );
```

E acrescente `criarPagamento` ao objeto de retorno do hook, junto de `createOrder`.

- [ ] **Step 8: documentar as variáveis novas**

Em `.env.example`:

```bash
# Pagamento online (Fase 2 do CHECKOUT-010). Falha fechada: só "true" liga.
# Em produção fica DESLIGADA até a Fase 3 existir — sem o webhook, pedido pago
# expira em 30 min.
VITE_PAGAMENTO_ONLINE=false
# Chave PUBLICA do Mercado Pago. Vai para o bundle de propósito: é o que o
# Brick usa para tokenizar cartão no navegador. Na Fase 2, sempre a de TESTE
# (prefixo TEST-). O ACCESS TOKEN nunca mora aqui — ele é segredo da edge
# function.
VITE_MP_PUBLIC_KEY=TEST-000000-0000-0000-0000-000000000000
```

- [ ] **Step 9: verificar tipos e testes**

```bash
npm run typecheck
```

```bash
npm run test:front
```

Esperado: os dois verdes.

- [ ] **Step 10: commit**

```bash
git add src/lib/flags.ts src/types/index.ts src/types/database.types.ts src/hooks/useOrders.ts .env.example tests/front/pagamento-online.test.tsx
```

```bash
git commit -m "feat(checkout): flag de pagamento online e escolha entre v23 e v24"
```

---

## Task 4: o componente do Brick e a CSP

**Files:**
- Create: `src/components/checkout/PagamentoOnline.tsx`
- Modify: `vercel.json:36`
- Test: `tests/front/pagamento-online.test.tsx` (acrescenta ao arquivo da Task 3)

**Interfaces:**
- Consumes: `criarPagamento` do `useOrders` (Task 3), `PAGAMENTO_ONLINE_LIGADO` (Task 3).
- Produces:
  - `<PagamentoOnline orderId={string} valor={number} onErro={(msg: string) => void} />`
  - `carregarSdkMercadoPago(): Promise<void>` — exportada para teste

> **Não existe `onPago`.** Seria a assinatura natural, e é justamente a que não pode
> existir nesta fase: quem declara pagamento é o webhook (Fase 3), e um callback com
> esse nome convidaria a próxima pessoa a chamá-lo do navegador. A invariante da spec
> é literal — *"o front nunca confirma pagamento"*.

- [ ] **Step 1: liberar os domínios do MP na CSP**

Em `vercel.json:36`, a política precisa ganhar, **nesta ordem de diretiva**:

| diretiva | acrescentar | por quê |
| --- | --- | --- |
| `script-src` | `https://sdk.mercadopago.com https://*.mlstatic.com` | o SDK v2 e os bundles que ele puxa |
| `connect-src` | `https://api.mercadopago.com https://api.mercadolibre.com https://events.mercadopago.com` | tokenização e telemetria do Brick |
| `frame-src` | **criar a diretiva** com `https://sdk.mercadopago.com https://*.mercadopago.com https://*.mercadolibre.com` | hoje ela não existe e cai no `default-src 'self'`, que recusa o iframe do cartão |
| `img-src` | `https://*.mlstatic.com` | bandeiras de cartão |
| `style-src` | `https://*.mlstatic.com` | folha do Brick |

- [ ] **Step 2: escrever o teste do carregamento do SDK**

Acrescente a `tests/front/pagamento-online.test.tsx`:

```tsx
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `carregarSdkMercadoPago` guarda a promessa em variável de MÓDULO — é isso que
 * impede o StrictMode de injetar duas tags. O efeito colateral é que o segundo
 * teste herdaria a promessa já resolvida do primeiro e nunca injetaria script
 * nenhum. Por isso cada teste reimporta o módulo do zero.
 */
async function importarLimpo() {
  vi.resetModules();
  return await import("@/components/checkout/PagamentoOnline");
}

beforeEach(() => {
  document.head.innerHTML = "";
});

afterEach(() => {
  document.querySelectorAll("script[data-mp-sdk]").forEach((s) => s.remove());
  // @ts-expect-error limpando o global entre testes
  delete globalThis.MercadoPago;
  vi.restoreAllMocks();
});

describe("carregarSdkMercadoPago", () => {
  it("injeta a tag uma vez só, mesmo com duas chamadas", async () => {
    const { carregarSdkMercadoPago } = await importarLimpo();
    const p1 = carregarSdkMercadoPago();
    const p2 = carregarSdkMercadoPago();

    const tags = document.querySelectorAll("script[data-mp-sdk]");
    expect(tags.length).toBe(1);

    // @ts-expect-error simulando o SDK ficando pronto
    globalThis.MercadoPago = function () {};
    tags[0].dispatchEvent(new Event("load"));

    await expect(p1).resolves.toBeUndefined();
    await expect(p2).resolves.toBeUndefined();
  });

  it("rejeita quando o script não carrega", async () => {
    const { carregarSdkMercadoPago } = await importarLimpo();
    const p = carregarSdkMercadoPago();
    const tag = document.querySelector("script[data-mp-sdk]")!;
    tag.dispatchEvent(new Event("error"));
    await expect(p).rejects.toThrow();
  });
});
```

- [ ] **Step 3: rodar e ver falhar**

```bash
npx vitest run tests/front/pagamento-online.test.tsx
```

Esperado: FAIL — não existe `@/components/checkout/PagamentoOnline`.

- [ ] **Step 4: escrever o componente**

Crie `src/components/checkout/PagamentoOnline.tsx`:

```tsx
import { useEffect, useRef, useState } from "react";
import { useOrders } from "@/hooks/useOrders";

const SDK_URL = "https://sdk.mercadopago.com/js/v2";

let promessaSdk: Promise<void> | null = null;

/**
 * Carrega o SDK do Mercado Pago uma vez por sessão.
 *
 * O `promessaSdk` em módulo evita a corrida do StrictMode do React 18, que
 * monta o componente duas vezes em desenvolvimento: sem ele, duas tags de
 * script entram na página e o Brick tenta renderizar duas vezes no mesmo
 * container.
 */
export function carregarSdkMercadoPago(): Promise<void> {
  if (promessaSdk) return promessaSdk;

  promessaSdk = new Promise<void>((resolve, reject) => {
    const existente = document.querySelector<HTMLScriptElement>("script[data-mp-sdk]");
    const tag = existente ?? document.createElement("script");

    if (!existente) {
      tag.src = SDK_URL;
      tag.async = true;
      tag.dataset.mpSdk = "1";
    }

    tag.addEventListener("load", () => resolve());
    tag.addEventListener("error", () => {
      // Zera para uma tentativa futura poder recomeçar — senão a página inteira
      // fica presa num erro de rede momentâneo.
      promessaSdk = null;
      reject(new Error("Não foi possível carregar o pagamento."));
    });

    if (!existente) document.head.appendChild(tag);
  });

  return promessaSdk;
}

export function PagamentoOnline({
  orderId,
  valor,
  onErro,
}: {
  orderId: string;
  valor: number;
  onErro: (msg: string) => void;
}) {
  const { criarPagamento } = useOrders(false, true);
  const container = useRef<HTMLDivElement>(null);
  const jaMontou = useRef(false);
  // `expiraEm` vem junto do PIX, da resposta da edge function — é o prazo que
  // está gravado na linha do pedido, o mesmo que o pg_cron vai ler.
  const [pix, setPix] = useState<
    { qrCodeBase64?: string; qrCode?: string; expiraEm: string } | null
  >(null);

  useEffect(() => {
    // Guarda contra o duplo mount do StrictMode: sem ela o Brick renderiza
    // duas vezes e a segunda sobrescreve o container vazio.
    if (jaMontou.current) return;
    jaMontou.current = true;

    let cancelado = false;

    (async () => {
      try {
        await carregarSdkMercadoPago();
        if (cancelado) return;

        const publicKey = import.meta.env.VITE_MP_PUBLIC_KEY;
        if (!publicKey) throw new Error("Pagamento indisponível.");

        // @ts-expect-error o SDK entra pelo global
        const mp = new globalThis.MercadoPago(publicKey, { locale: "pt-BR" });

        await mp.bricks().create("payment", "mp-container", {
          initialization: { amount: valor },
          customization: {
            paymentMethods: { bankTransfer: "all", creditCard: "all" },
          },
          callbacks: {
            onReady: () => {},
            onError: (erro: unknown) => {
              console.error("brick:", erro);
              onErro("Não foi possível carregar o pagamento.");
            },
            onSubmit: async ({ formData }: { formData: Record<string, any> }) => {
              // PIX volta sem token; cartão volta tokenizado NO NAVEGADOR — o
              // número do cartão não passa pelo nosso servidor.
              const ehPix = !formData.token;
              const r = await criarPagamento({
                orderId,
                metodo: ehPix ? "pix" : "cartao",
                token: formData.token,
                parcelas: formData.installments,
                paymentMethodId: formData.payment_method_id,
                issuerId: formData.issuer_id,
                email: formData.payer?.email,
                documento: formData.payer?.identification,
              });
              if (ehPix) {
                setPix({
                  qrCodeBase64: r.qrCodeBase64,
                  qrCode: r.qrCode,
                  expiraEm: r.expiraEm,
                });
              }
            },
          },
        });
      } catch (err: any) {
        if (!cancelado) onErro(err?.message ?? "Não foi possível carregar o pagamento.");
      }
    })();

    return () => {
      cancelado = true;
    };
  }, [orderId, valor, criarPagamento, onErro]);

  if (pix) {
    return (
      <div className="space-y-4 rounded-2xl border border-zinc-100 bg-white p-4">
        {pix.qrCodeBase64 && (
          <img
            src={`data:image/png;base64,${pix.qrCodeBase64}`}
            alt="QR code do PIX"
            className="mx-auto size-56"
          />
        )}
        <button
          type="button"
          onClick={() => navigator.clipboard.writeText(pix.qrCode ?? "")}
          className="w-full rounded-xl bg-zinc-900 px-4 py-3 text-xs font-bold uppercase tracking-wider text-white"
        >
          Copiar código PIX
        </button>
        <p className="text-center text-xs text-zinc-500">
          Vence às{" "}
          {new Date(pix.expiraEm).toLocaleTimeString("pt-BR", {
            hour: "2-digit",
            minute: "2-digit",
          })}
        </p>
      </div>
    );
  }

  return <div id="mp-container" ref={container} />;
}
```

- [ ] **Step 5: rodar e ver passar**

```bash
npx vitest run tests/front/pagamento-online.test.tsx
```

Esperado: 4 passed (2 da flag + 2 do SDK).

- [ ] **Step 6: typecheck e lint**

```bash
npm run typecheck
```

```bash
npm run lint:ratchet
```

Esperado: os dois verdes — a catraca de lint não pode subir.

- [ ] **Step 7: commit**

```bash
git add src/components/checkout/PagamentoOnline.tsx vercel.json tests/front/pagamento-online.test.tsx
```

```bash
git commit -m "feat(checkout): componente do Brick do Mercado Pago e CSP que o permite"
```

---

## Task 5: ligar no `CheckoutView`, sob a flag

**Files:**
- Modify: `src/views/customer/CheckoutView.tsx:413-473` (montagem do pedido e sucesso)
- Modify: `src/views/customer/CheckoutView.tsx:863-925` (os três botões)

**Interfaces:**
- Consumes: `PAGAMENTO_ONLINE_LIGADO` (Task 3), `createOrder(orderData, opts)` (Task 3),
  `<PagamentoOnline />` (Task 4).
- Produces: nada para tarefas seguintes — é a ponta.

- [ ] **Step 1: acrescentar a opção "Pagar agora" à lista de métodos**

Em `CheckoutView.tsx:874`, a lista literal passa a ser condicional:

```tsx
            {[
              ...(PAGAMENTO_ONLINE_LIGADO
                ? [
                    {
                      value: "online" as PaymentMethod,
                      label: "Pagar agora (PIX ou cartão)",
                      icon: CreditCard,
                      color: "text-violet-500 bg-violet-50",
                    },
                  ]
                : []),
              {
                value: "pix" as PaymentMethod,
                label: "Pix na Entrega",
```

O resto da lista (`pix`, `card`, `cash`) fica **exatamente como está**. Com a flag
desligada, a tela é byte a byte a de hoje.

- [ ] **Step 2: o pedido nasce com prazo só quando for online**

Em `CheckoutView.tsx:446`:

```tsx
      const ehOnline = paymentMethod === "online";
      const order = await createOrder(orderData, { comPagamentoOnline: ehOnline });
      setOrderId(order.id);
      onClearCart();

      if (ehOnline) {
        // NÃO mostra sucesso e NÃO solta confete: o pedido só está reservado,
        // e quem confirma pagamento é o webhook (Fase 3). Chamar isso de
        // sucesso aqui é a mentira que a tela de hoje conta.
        setAguardandoPagamento(true);
        return;
      }

      setShowSuccess(true);
      confetti({
```

- [ ] **Step 3: a tela de aguardando pagamento**

Logo antes do `if (showSuccess)` em `:475`:

```tsx
  if (aguardandoPagamento && orderId) {
    return (
      <div className="min-h-dvh space-y-4 bg-gray-50/10 px-3.5 pt-4">
        <h1 className="text-lg font-bold text-zinc-900">Finalize o pagamento</h1>
        <p className="text-xs text-zinc-500">
          Seu pedido está reservado. Se o pagamento não sair em 30 minutos, os
          itens voltam para o estoque e o pedido é cancelado.
        </p>
        <PagamentoOnline
          orderId={orderId}
          valor={finalTotal}
          onErro={(msg) => toast.error(msg)}
        />
      </div>
    );
  }
```

Com o estado novo junto dos outros `useState` do componente (o prazo NÃO é estado
daqui — ele chega do banco pela resposta da edge function, dentro do `PagamentoOnline`):

```tsx
  const [aguardandoPagamento, setAguardandoPagamento] = useState(false);
```

E os dois imports, no topo do arquivo:

```tsx
import { PagamentoOnline } from "@/components/checkout/PagamentoOnline";
import { PAGAMENTO_ONLINE_LIGADO } from "@/lib/flags";
```

- [ ] **Step 4: verificação completa, do jeito que o CI mede**

```bash
npm run typecheck
```

```bash
npm test
```

```bash
npm run build
```

Esperado: os três verdes. O `build` importa porque a flag é de build — se o `import.meta.env`
estiver mal escrito, é aqui que aparece.

- [ ] **Step 5: provar que com a flag DESLIGADA nada mudou**

```bash
npm run dev
```

⚠️ `npm run dev` aponta para o **Supabase de produção** e já entra logado como admin.
**Não finalize pedido nesta verificação** — olhe a tela de checkout e confirme que os
três botões são os mesmos de sempre e que não existe a opção "Pagar agora".

- [ ] **Step 6: commit**

```bash
git add src/views/customer/CheckoutView.tsx
```

```bash
git commit -m "feat(checkout): opcao de pagar agora no checkout, atras da flag"
```

---

## Verificação final da fase (antes do PR)

Não é tarefa de subagente — é o portão do Gabriel.

- [ ] **1. Abrir o PR contra `develop` e esperar o Preview da Vercel.**
- [ ] **2. Ligar a flag no Preview:** no painel da Vercel, ambiente *Preview*,
      `VITE_PAGAMENTO_ONLINE=true` e `VITE_MP_PUBLIC_KEY=TEST-…`. **Não tocar em
      Production.** Redeploy do preview para as variáveis valerem.
- [ ] **3. No Preview, fazer um pedido de teste** e confirmar, no console do navegador,
      **zero erro de CSP**. Container vazio sem erro visível é justamente o sintoma de
      `frame-src` faltando.
- [ ] **4. PIX:** o QR code aparece e o "copiar código" devolve string começando com
      `00020126`.
- [ ] **5. Cartão de teste do MP:** o formulário aceita e a resposta volta sem erro.
      (Aprovado/recusado não importa aqui — nada confirma nada até a Fase 3.)
- [ ] **6. No banco, conferir o pedido de teste:**

```sql
SELECT id, payment_status, expires_at, gateway_payment_id
FROM public.marketplace_orders
ORDER BY created_at DESC LIMIT 3;
```

Esperado: `aguardando`, `expires_at` ~30 min à frente, `gateway_payment_id` preenchido.

- [ ] **7. Esperar 35 minutos e conferir de novo.** Esperado: `expirado`, `status`
      `cancelled`, estoque devolvido. **É a primeira vez que o `pg_cron` da Fase 1 faz
      alguma coisa** — até aqui ele varre e não encontra nada.
- [ ] **8. Confirmar que Production continua com a flag desligada:**

```bash
vercel env ls
```

Esperado: `VITE_PAGAMENTO_ONLINE` **não** existe em Production, ou existe com valor
diferente de `true`.

---

## O que esta fase NÃO entrega

Dito aqui para ninguém confundir "Fase 2 pronta" com "loja cobrando".

- **Confirmação de pagamento.** Nenhum pedido vira `pago` nesta fase. É a Fase 3.
- **A loja em produção cobrando.** A flag fica desligada lá. Ligar é decisão da Fase 3.
- **Painel com status de pagamento.** É a Fase 4 (#110).
- **`supabase/config.toml` com `verify_jwt` versionado** (#162). A `criar-pagamento` usa
  o padrão e não precisa; a `webhook-mercadopago` da Fase 3 precisa, e **começa por aí**.
- **Reconciliação** (`reconciliar_pagamentos()`). Fase 3.
- **E-mail de confirmação** (#106) e **status na tabela `notificacoes`** (#107).
