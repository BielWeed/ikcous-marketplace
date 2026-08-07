# Fase 3 da cobrança — o webhook e a reconciliação

> **Para quem executa:** SUB-SKILL OBRIGATÓRIA — use `superpowers:subagent-driven-development`
> (recomendado) ou `superpowers:executing-plans` para implementar tarefa a tarefa. Os passos
> usam checkbox (`- [ ]`) para acompanhamento.

**Data:** 07/08/2026 · **Spec:** [`2026-08-07-fase-3-webhook-design.md`](../specs/2026-08-07-fase-3-webhook-design.md)
**Issues:** `CHECKOUT-010` #109, `CHECKOUT-040` #110, `CHECKOUT-050` #111 · **Desbloqueia:** #162

**Objetivo:** fazer o pedido virar `pago` quando o PIX cair, com o webhook do Mercado Pago
confirmando contra a API do MP e uma reconciliação que pega o que o webhook perder.

**Arquitetura:** o webhook **não escreve no pedido** — ele valida a assinatura, pergunta o
status real ao MP e chama a RPC `confirmar_pagamento`, que pega a linha com `FOR UPDATE` e
**relê o estado** antes de decidir. É isso que mata a corrida com a varredura de expiração. A
reconciliação usa **a mesma RPC**, com outra origem: nunca existem dois códigos decidindo
sobre dinheiro.

**Tecnologias:** Deno (edge functions), Postgres/plpgsql, `pg_cron` + `pg_net`, React 19 +
Vite no front, Vitest e `deno test`.

---

## Restrições globais

Valem para **todas** as tarefas. Cada tarefa herda esta seção sem repetir.

- **Migration NÃO leva `BEGIN`/`COMMIT`.** O `scripts/db-apply.cjs` abre a transação. Com
  eles, o `ROLLBACK` do script de prova vira no-op e a mudança **fica gravada em produção**.
  Já aconteceu neste repositório em 05/08/2026.
- **Nunca rodar `supabase db push`.** Há 42 migrations locais nunca aplicadas e 28 versões no
  banco sem arquivo. Aplicação é só via `scripts/db-apply.cjs`.
- **Nunca `--no-verify` no commit.** O hook de `secretlint` é a única trava contra credencial
  vazada, e este repo já teve `service_role` e senha de banco no histórico.
- **Nenhum deploy de edge function neste plano.** Deploy é a etapa de rollout, atrás dos dois
  portões do Gabriel (`vercel env ls` e Task 0 do Mercado Pago). Se uma tarefa parecer pedir
  deploy, ela está mal lida.
- **`npm run dev` aponta para o Supabase de PRODUÇÃO** e já vem logado como admin. Não testar
  cadastro nem pedido pela tela.
- **Segredo nunca vai para o `.env` do front** (vira bundle). `MP_WEBHOOK_SECRET` e
  `RECONCILIACAO_SECRET` só no ambiente das functions.
- **Verificação:** `npm run typecheck`, `npm test`, `npm run build`, `npm run lint:links`,
  `npm run lint:ratchet`, `npm run size`. `eslint` tem 553 warnings pré-existentes e **0
  erro** — warning não reprova, **erro novo reprova**. O `lint:ratchet` acusa Biome acima do
  teto no Windows por causa de CRLF; **não é dívida**, o próprio script avisa que Biome só é
  cobrado no CI (Linux).
- **Comentário explica POR QUÊ, não O QUÊ.** É o padrão de todo arquivo deste repositório.
- **Sem `any` novo em código de front.** As edge functions usam `// @ts-nocheck` no topo, que
  é o padrão já estabelecido em `_shared/`.

---

## Estrutura de arquivos

| arquivo | responsabilidade | tarefa |
| --- | --- | --- |
| `supabase/config.toml` | **criar** — versiona `verify_jwt` das funções existentes (#162) | 1 |
| `supabase/migrations/20260808000000_confirmar_pagamento.sql` | **criar** — `paid_at` + `confirmar_pagamento` | 2 |
| `scripts/db-prove-checkout-060.cjs` | **criar** — prova da RPC, tudo em `ROLLBACK` | 2 |
| `supabase/functions/_shared/mercadopago.ts` | **modificar** — ganha `validarAssinatura` | 3 |
| `supabase/functions/webhook-mercadopago/index.ts` | **criar** — recebe a confirmação | 4 |
| `supabase/migrations/20260808000100_reconciliacao.sql` | **criar** — candidatos + `pg_net` + cron | 5 |
| `supabase/functions/reconciliar-pagamentos/index.ts` | **criar** — varre e chama a mesma RPC | 6 |
| `supabase/functions/criar-pagamento/index.ts` | **modificar** — `notification_url`, recusa cartão | 7 |
| `src/components/checkout/PagamentoOnline.tsx` | **modificar** — Brick só PIX | 8 |
| tela de pedidos do admin | **modificar** — filtro por `payment_status` | 9 |

**Ordem e paralelismo.** Independentes, podem ir juntas: **1, 2, 3, 7, 8, 9**. Depois: **4**
(precisa de 2 e 3) e **5** (precisa de 2). Por último: **6** (precisa de 5).

---

### Task 1: `supabase/config.toml` — versionar o `verify_jwt` (#162)

**Arquivos:**
- Criar: `supabase/config.toml`

**Interfaces:**
- Consome: nada.
- Produz: o arquivo que as tarefas 4 e 6 vão **acrescentar** a própria entrada.

**Por que esta tarefa é perigosa apesar de ser um arquivo de configuração.** Hoje só
`send-otp-email` e `notify-new-order` rodam sem JWT, e isso está documentado em
`DEPLOYMENT.md:52` e `:57` — não no repositório. **Função que ficar de fora do arquivo herda
o padrão `verify_jwt = true` no próximo deploy**, e é exatamente assim que o OTP já caiu neste
projeto. Omitir uma linha aqui custa mais que qualquer outra tarefa deste plano.

- [ ] **Passo 1: confirmar o comportamento do CLI na documentação**

Use `mcp__context7__query-docs` para a CLI do Supabase: como `[functions.<nome>]` e
`verify_jwt` se comportam no `config.toml`, e **o que acontece com uma função que não está
declarada**. Não escreva o arquivo antes disso — a premissa desta tarefa inteira é essa, e ela
não pode vir de memória.

Se a documentação disser que função não declarada **mantém** a configuração atual em vez de
herdar o padrão, **pare e reporte**: o desenho desta tarefa muda, e a decisão é da sessão
principal, não sua.

- [ ] **Passo 2: levantar o estado atual de cada função**

Leia `DEPLOYMENT.md` inteiro e liste as seis funções que existem hoje
(`supabase/functions/`, ignorando `_shared`) com o `verify_jwt` que cada uma tem. O que o
`DEPLOYMENT.md` afirma:

- `send-otp-email` → sem JWT (`DEPLOYMENT.md:52`)
- `notify-new-order` → sem JWT (`DEPLOYMENT.md:57`, PEDIDO-020 #89)
- `criar-pagamento` → padrão, com JWT (`criar-pagamento/index.ts:8`)

Para `calculate-shipping`, `send-order-whatsapp` e `send-push`, **leia o cabeçalho de cada
`index.ts`** e registre o que ele afirma. Se um deles não disser, escreva `true` (o padrão) e
**diga no relatório final que essa entrada não teve evidência** — a sessão principal confere
com o Gabriel contra o painel antes de qualquer deploy.

- [ ] **Passo 3: escrever o arquivo**

```toml
# Versiona o verify_jwt de cada edge function (#162).
#
# POR QUE ESTE ARQUIVO EXISTE
#
# Ate 07/08/2026 o verify_jwt vivia na linha de comando de quem deployava:
# `--no-verify-jwt` digitado a mao, documentado so no DEPLOYMENT.md. Um deploy
# sem a flag na funcao errada JA derrubou o OTP deste projeto. Aqui a
# configuracao passa a ser revisavel em PR como o resto.
#
# REGRA: nenhuma funcao pode ficar de fora. Funcao nao declarada herda o
# padrao (verify_jwt = true) no proximo deploy — que e' a queda do OTP de novo.

project_id = "cafkrminfnokvgjqtkle"

# Sem JWT de proposito: o link do e-mail e' aberto por quem ainda nao tem
# sessao. Ver DEPLOYMENT.md:52.
[functions.send-otp-email]
verify_jwt = false

# Sem JWT de proposito (PEDIDO-020 #89): o pedido de convidado nasce sem
# sessao. O que protege e' a propria funcao — corpo so aceita orderId, janela
# de 15 min, forma de UUID. Ver DEPLOYMENT.md:57.
[functions.notify-new-order]
verify_jwt = false

[functions.calculate-shipping]
verify_jwt = true

[functions.send-order-whatsapp]
verify_jwt = true

[functions.send-push]
verify_jwt = true

# Chamada pelo cliente logado ou convidado com sessao; o verify_jwt filtra
# trafego de fora do projeto e a funcao extrai a identidade do token.
[functions.criar-pagamento]
verify_jwt = true
```

O `project_id` acima **precisa ser conferido** contra o que o `DEPLOYMENT.md` usa nos comandos
de deploy (`--project-ref`). Se divergir, use o do `DEPLOYMENT.md` e diga no relatório.

- [ ] **Passo 4: provar que o arquivo é TOML válido e não quebra o CI**

```bash
npm run typecheck
```

```bash
npm run lint:links
```

Depois rode a verificação inteira:

```bash
npm test
```

Esperado: passa sem mudança de contagem. Este arquivo não entra em nenhuma suíte — o que se
prova aqui é que ele **não quebra** nada.

- [ ] **Passo 5: commit**

```bash
git add supabase/config.toml
```

```bash
git commit -m "chore(edge): versiona o verify_jwt das funcoes no config.toml (#162)"
```

---

### Task 2: migration — `paid_at` e `confirmar_pagamento`

**Arquivos:**
- Criar: `supabase/migrations/20260808000000_confirmar_pagamento.sql`
- Criar: `scripts/db-prove-checkout-060.cjs`

**Interfaces:**
- Consome: `public.devolver_estoque(uuid)` (Fase 1, migration `20260807000000`).
- Produz: `public.confirmar_pagamento(p_order_id uuid, p_payment_id text, p_status text)
  RETURNS text`. Retornos possíveis, exatos, consumidos pelas tarefas 4 e 6:
  `'pago'`, `'pago_apos_expirar'`, `'ja_pago'`, `'recusado'`, `'estornado'`,
  `'ja_estornado'`, `'divergente'`, `'inexistente'`, `'ignorado'`.

**A corrida que esta função existe para resolver.** O comentário da
`expirar_pedidos_vencidos` (migration `20260807000000`, linhas 87–95) já a descreve: se a
varredura pegar a trava primeiro, um `UPDATE` do webhook **espera, reavalia o `WHERE` por id —
que continua valendo — e sobrescreve**, produzindo pedido `pago` com `status = 'cancelled'` e
estoque já devolvido. Por isso aqui é `SELECT ... FOR UPDATE` **sem** `SKIP LOCKED` (esperar é
o ponto) seguido de **releitura** do `payment_status`.

- [ ] **Passo 1: escrever a migration**

```sql
-- Fase 3 da cobranca: a RPC que confirma pagamento sob trava.
-- SEM BEGIN/COMMIT: o db-apply.cjs abre a transacao.

-- 1. Carimbo de quando o dinheiro entrou -------------------------------
-- Sem ele, "quando entrou" so existe no Mercado Pago, e a fila de atencao do
-- admin nao tem como ordenar nem a reconciliacao como medir atraso.
ALTER TABLE public.marketplace_orders
  ADD COLUMN IF NOT EXISTS paid_at timestamptz;

-- 2. A decisao sob trava ------------------------------------------------
CREATE OR REPLACE FUNCTION public.confirmar_pagamento(
    p_order_id   uuid,
    p_payment_id text,
    p_status     text
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $confirmar$
DECLARE
    v_pedido RECORD;
BEGIN
    -- FOR UPDATE sem SKIP LOCKED: se a expirar_pedidos_vencidos esta com a
    -- linha, ESPERAR e' o comportamento correto. Pular deixaria o pagamento
    -- sem registro. Depois da espera, o payment_status lido aqui embaixo ja
    -- e' o que a varredura gravou — e' a releitura que decide, nao o WHERE.
    SELECT id, payment_status, gateway_payment_id
      INTO v_pedido
      FROM public.marketplace_orders
     WHERE id = p_order_id
     FOR UPDATE;

    IF NOT FOUND THEN
        RETURN 'inexistente';
    END IF;

    -- O pedido guarda o id da cobranca desde a criacao (Fase 2). Se o que
    -- chegou nao bate, alguem esta confirmando o pagamento de OUTRO pedido:
    -- nao escrever e deixar para uma pessoa olhar.
    IF v_pedido.gateway_payment_id IS DISTINCT FROM p_payment_id THEN
        RETURN 'divergente';
    END IF;

    -- Estorno vale a partir de QUALQUER estado, e NUNCA mexe em estoque: o
    -- dinheiro entrou e voltou, possivelmente com entrega feita. Repor
    -- estoque sozinho aqui e' chutar onde a mercadoria esta.
    IF p_status = 'estornado' THEN
        IF v_pedido.payment_status = 'estornado' THEN
            RETURN 'ja_estornado';
        END IF;
        UPDATE public.marketplace_orders
           SET payment_status = 'estornado',
               updated_at     = now()
         WHERE id = p_order_id;
        RETURN 'estornado';
    END IF;

    IF p_status = 'pago' THEN
        -- Idempotencia do webhook: o MP reenvia quando nao recebe 200 rapido.
        -- A segunda chamada cai aqui e nao dispara push de novo.
        IF v_pedido.payment_status IN ('pago', 'pago_apos_expirar') THEN
            RETURN 'ja_pago';
        END IF;

        -- A varredura ganhou a corrida: o estoque JA voltou. Nao mexer em
        -- estoque nem em status — so marcar e chamar uma pessoa.
        IF v_pedido.payment_status = 'expirado' THEN
            UPDATE public.marketplace_orders
               SET payment_status = 'pago_apos_expirar',
                   paid_at        = now(),
                   updated_at     = now()
             WHERE id = p_order_id;
            RETURN 'pago_apos_expirar';
        END IF;

        IF v_pedido.payment_status = 'aguardando' THEN
            UPDATE public.marketplace_orders
               SET payment_status = 'pago',
                   paid_at        = now(),
                   updated_at     = now()
             WHERE id = p_order_id;
            RETURN 'pago';
        END IF;

        -- 'recusado', NULL (os 64 pedidos historicos) ou qualquer outro:
        -- nao inventar transicao.
        RETURN 'ignorado';
    END IF;

    IF p_status = 'recusado' THEN
        -- devolver_estoque NAO e' idempotente (ver o COMMENT dela). So se
        -- chama a partir de 'aguardando', que e' a unica transicao que
        -- acontece uma vez, e de dentro desta trava.
        IF v_pedido.payment_status <> 'aguardando' THEN
            RETURN 'ignorado';
        END IF;

        PERFORM public.devolver_estoque(p_order_id);

        UPDATE public.marketplace_orders
           SET payment_status = 'recusado',
               status         = 'cancelled',
               updated_at     = now()
         WHERE id = p_order_id;
        RETURN 'recusado';
    END IF;

    -- 'aguardando' vindo do MP (pending/in_process) cai aqui: nada a fazer,
    -- o pedido ja esta nesse estado e a expiracao cuida do prazo.
    RETURN 'ignorado';
END;
$confirmar$;

REVOKE ALL ON FUNCTION public.confirmar_pagamento(uuid, text, text)
  FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.confirmar_pagamento(uuid, text, text) IS
  'Unico caminho que escreve payment_status a partir do gateway. O webhook e a '
  'reconciliacao chamam ESTA funcao — nao um UPDATE proprio — porque a decisao '
  'depende de reler o estado sob FOR UPDATE, e nao do WHERE da chamada.';
```

- [ ] **Passo 2: escrever o script de prova**

Crie `scripts/db-prove-checkout-060.cjs` copiando a estrutura de
`scripts/db-prove-checkout-010.cjs`: mesmo `lerDatabaseUrl()`, mesmo `conferir()`, `BEGIN` no
começo e **`ROLLBACK` no `finally`**. Leia aquele arquivo antes de escrever este.

Duas armadilhas que aquele script documenta e que valem aqui: `produtos.custo` é `NOT NULL`
sem default, e `marketplace_orders.customer_data` (jsonb) e `subtotal` são `NOT NULL` sem
default. Omitir qualquer um quebra o `INSERT`.

Os casos que o script tem de cobrir — **um por linha da tabela de decisão**:

| cenário montado | chamada | esperado |
| --- | --- | --- |
| `payment_status='aguardando'`, `gateway_payment_id='MP1'` | `('MP1','pago')` | `'pago'`, `paid_at` não nulo, estoque **intacto** |
| o mesmo pedido, chamando de novo | `('MP1','pago')` | `'ja_pago'`, `paid_at` **inalterado** |
| `payment_status='expirado'`, `gateway_payment_id='MP2'` | `('MP2','pago')` | `'pago_apos_expirar'`, `status` continua `'cancelled'`, estoque **inalterado** |
| `payment_status='aguardando'` com 3 unidades reservadas | `('MP3','recusado')` | `'recusado'`, estoque **+3**, `status='cancelled'` |
| pedido já `'recusado'` | `('MP3','recusado')` | `'ignorado'`, estoque **inalterado** (é a prova de que não credita duas vezes) |
| `payment_status='pago'` | `('MP1','estornado')` | `'estornado'`, estoque **inalterado** |
| `gateway_payment_id='MP1'` | `('OUTRO','pago')` | `'divergente'`, `payment_status` **inalterado** |
| id que não existe | `(uuid aleatório,'X','pago')` | `'inexistente'` |

Para o caso de `recusado`, monte o pedido com item de verdade em
`marketplace_order_items` (`product_id`, `quantity`) e meça `produtos.estoque` antes e depois
— é a única forma de provar que `devolver_estoque` foi chamada.

- [ ] **Passo 3: rodar a prova e verificar que FALHA**

```bash
node scripts/db-prove-checkout-060.cjs
```

Esperado: **FALHA** com erro de função inexistente (`confirmar_pagamento does not exist`), já
que a migration ainda não foi aplicada. Se passar aqui, o script não está provando nada.

- [ ] **Passo 4: aplicar a migration e rodar a prova**

```bash
node scripts/db-apply.cjs supabase/migrations/20260808000000_confirmar_pagamento.sql
```

```bash
node scripts/db-prove-checkout-060.cjs
```

Esperado: todos os `ok`, nenhum `FALHA`. **Cole a saída inteira no relatório final.**

- [ ] **Passo 5: prova por mutação — o teste tem dente?**

Comente a linha `IF v_pedido.gateway_payment_id IS DISTINCT FROM p_payment_id` e o `RETURN
'divergente'`, reaplique num `ROLLBACK` e rode a prova: o caso `divergente` **tem que
reprovar**. Depois desfaça. Faça o mesmo com o ramo `IN ('pago','pago_apos_expirar')` → o caso
`ja_pago` tem que reprovar.

Se algum caso continuar verde com o mecanismo removido, o teste é decorativo e precisa ser
reescrito antes de seguir.

- [ ] **Passo 6: commit**

```bash
git add supabase/migrations/20260808000000_confirmar_pagamento.sql scripts/db-prove-checkout-060.cjs
```

```bash
git commit -m "feat(checkout): confirmar_pagamento decide sob trava, com paid_at"
```

---

### Task 3: `validarAssinatura` no `_shared/mercadopago.ts`

**Arquivos:**
- Modificar: `supabase/functions/_shared/mercadopago.ts`
- Criar: `supabase/functions/_shared/mercadopago_assinatura_test.ts`

**Interfaces:**
- Consome: nada.
- Produz:
  `export async function validarAssinatura(args: { xSignature: string | null; xRequestId: string | null; dataId: string; segredo: string; agora?: number; toleranciaSegundos?: number }): Promise<boolean>`

**Esta é a única autenticação que o webhook tem.** Não há JWT. Se ela passar só nos casos
felizes, não testamos nada.

- [ ] **Passo 1: confirmar o formato do manifesto na documentação do MP**

Use `mcp__context7__query-docs` para o Mercado Pago: validação de `x-signature` em webhooks —
o formato do header, o template do manifesto e o algoritmo.

O que este plano assume (e que **você tem de confirmar antes de escrever o teste**):
- o header vem como `ts=<epoch>,v1=<hex>`;
- o manifesto é `id:<data.id>;request-id:<x-request-id>;ts:<ts>;`;
- HMAC-SHA256 do manifesto com o segredo, comparado ao `v1` em hexadecimal.

**Se a documentação divergir em qualquer ponto — inclusive se o `data.id` alfanumérico tiver
de ir em minúsculas, ou se o segmento `request-id` for omitido quando o header não vem —
siga a documentação e diga no relatório o que mudou.** O vetor do teste depende disso, e um
manifesto errado faz a função recusar 100% dos webhooks legítimos.

- [ ] **Passo 2: gerar o vetor do teste com uma implementação independente**

Rode, no PowerShell, com o manifesto **exatamente como a documentação descreve**:

```bash
node -e "const c=require('crypto');const m='id:12345;request-id:abc-123;ts:1700000000;';console.log(c.createHmac('sha256','segredo-de-teste').update(m).digest('hex'))"
```

Anote a saída. O teste vai comparar a implementação em Deno contra este valor, produzido pelo
`crypto` do Node — **duas implementações concordando**, não a função conferindo a si mesma.

- [ ] **Passo 3: escrever o teste que falha**

```ts
import { assert, assertEquals } from "https://deno.land/std@0.177.0/testing/asserts.ts";
import { validarAssinatura } from "./mercadopago.ts";

const SEGREDO = "segredo-de-teste";
const TS = 1700000000;
const DATA_ID = "12345";
const REQUEST_ID = "abc-123";
// Gerado pelo crypto do Node em 07/08/2026, com o manifesto
// `id:12345;request-id:abc-123;ts:1700000000;`. Se este hex for recalculado
// pela propria funcao, o teste deixa de provar qualquer coisa.
//
// SE o Passo 1 revelar manifesto diferente, REFACA o Passo 2 e troque este
// valor — este hex vale para o manifesto acima e para nenhum outro.
const V1_VALIDO =
  "5bad78f1f0f10eb98d20496b6b8330f24a7469884503659db81991a37b30de40";

const agoraOk = (TS + 10) * 1000;

Deno.test("aceita assinatura valida", async () => {
  const ok = await validarAssinatura({
    xSignature: `ts=${TS},v1=${V1_VALIDO}`,
    xRequestId: REQUEST_ID,
    dataId: DATA_ID,
    segredo: SEGREDO,
    agora: agoraOk,
  });
  assert(ok);
});

Deno.test("recusa segredo errado", async () => {
  const ok = await validarAssinatura({
    xSignature: `ts=${TS},v1=${V1_VALIDO}`,
    xRequestId: REQUEST_ID,
    dataId: DATA_ID,
    segredo: "outro-segredo",
    agora: agoraOk,
  });
  assertEquals(ok, false);
});

Deno.test("recusa corpo adulterado com assinatura antiga", async () => {
  // Mesmo ts, mesmo v1, OUTRO pagamento: e' o ataque que a assinatura existe
  // para barrar — reaproveitar um header legitimo apontando para outro id.
  const ok = await validarAssinatura({
    xSignature: `ts=${TS},v1=${V1_VALIDO}`,
    xRequestId: REQUEST_ID,
    dataId: "99999",
    segredo: SEGREDO,
    agora: agoraOk,
  });
  assertEquals(ok, false);
});

Deno.test("recusa ts fora da tolerancia", async () => {
  const ok = await validarAssinatura({
    xSignature: `ts=${TS},v1=${V1_VALIDO}`,
    xRequestId: REQUEST_ID,
    dataId: DATA_ID,
    segredo: SEGREDO,
    agora: (TS + 60 * 60) * 1000,
  });
  assertEquals(ok, false);
});

Deno.test("recusa header ausente ou malformado", async () => {
  for (const xSignature of [null, "", "v1=semtimestamp", "ts=abc,v1=xyz", "lixo"]) {
    const ok = await validarAssinatura({
      xSignature,
      xRequestId: REQUEST_ID,
      dataId: DATA_ID,
      segredo: SEGREDO,
      agora: agoraOk,
    });
    assertEquals(ok, false, `deveria recusar: ${JSON.stringify(xSignature)}`);
  }
});
```

- [ ] **Passo 4: rodar e verificar que falha**

```bash
deno test --allow-all --no-check supabase/functions/_shared/mercadopago_assinatura_test.ts
```

Esperado: FALHA — `validarAssinatura` não existe.

- [ ] **Passo 5: implementar**

Acrescente ao fim de `supabase/functions/_shared/mercadopago.ts`. Ajuste o manifesto ao que a
documentação confirmou no Passo 1:

```ts
/**
 * Valida o x-signature do webhook do Mercado Pago.
 *
 * E' a UNICA autenticacao que a webhook-mercadopago tem: ela roda com
 * verify_jwt = false porque o MP nao manda JWT. Sem isto, quem descobrir a URL
 * forja um "aprovado" e leva produto de graca.
 *
 * Pura e com `agora` injetavel para o teste nao depender do relogio.
 */
export async function validarAssinatura(args: {
  xSignature: string | null;
  xRequestId: string | null;
  dataId: string;
  segredo: string;
  agora?: number;
  toleranciaSegundos?: number;
}): Promise<boolean> {
  const { xSignature, xRequestId, dataId, segredo } = args;
  const agora = args.agora ?? Date.now();
  const tolerancia = args.toleranciaSegundos ?? 300;

  if (!xSignature || !segredo || !dataId) return false;

  let ts = "";
  let v1 = "";
  for (const parte of xSignature.split(",")) {
    const [chave, ...resto] = parte.split("=");
    const valor = resto.join("=").trim();
    if (chave?.trim() === "ts") ts = valor;
    if (chave?.trim() === "v1") v1 = valor;
  }
  if (!ts || !v1) return false;

  // `ts` fora da janela: header legitimo reaproveitado semanas depois nao vale.
  const tsNumero = Number(ts);
  if (!Number.isFinite(tsNumero)) return false;
  const idadeSegundos = Math.abs(agora / 1000 - tsNumero);
  if (idadeSegundos > tolerancia) return false;

  // O segmento de request-id so entra quando o header veio — ver Passo 1.
  const manifesto = xRequestId
    ? `id:${dataId};request-id:${xRequestId};ts:${ts};`
    : `id:${dataId};ts:${ts};`;

  const chave = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(segredo),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const assinado = await crypto.subtle.sign(
    "HMAC",
    chave,
    new TextEncoder().encode(manifesto),
  );
  const esperado = Array.from(new Uint8Array(assinado))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  // Comparacao de tempo constante: `===` em string vaza, pelo tempo de
  // resposta, quantos caracteres do prefixo o atacante ja acertou.
  if (esperado.length !== v1.length) return false;
  let diferenca = 0;
  for (let i = 0; i < esperado.length; i++) {
    diferenca |= esperado.charCodeAt(i) ^ v1.charCodeAt(i);
  }
  return diferenca === 0;
}
```

- [ ] **Passo 6: rodar e verificar que passa**

```bash
deno test --allow-all --no-check supabase/functions/_shared/mercadopago_assinatura_test.ts
```

Esperado: 5 testes passando.

- [ ] **Passo 7: prova por mutação**

Troque a comparação de tempo constante por `return esperado === v1;` — os testes **têm que
continuar passando** (o comportamento é o mesmo; o que muda é o vazamento por tempo, que
nenhum teste pega, e está aqui só para você saber disso). Depois **remova a checagem de
tolerância do `ts`** — o teste "recusa ts fora da tolerancia" tem que **reprovar**. Desfaça as
duas.

- [ ] **Passo 8: commit**

```bash
git add supabase/functions/_shared/mercadopago.ts supabase/functions/_shared/mercadopago_assinatura_test.ts
```

```bash
git commit -m "feat(edge): valida a assinatura do webhook do Mercado Pago"
```

---

### Task 4: `webhook-mercadopago`

**Arquivos:**
- Criar: `supabase/functions/webhook-mercadopago/index.ts`
- Criar: `supabase/functions/webhook-mercadopago/index_test.ts`
- Modificar: `supabase/config.toml` (acrescentar a entrada)

**Interfaces:**
- Consome: `validarAssinatura`, `consultarPagamento`, `mapearStatus` do
  `../_shared/mercadopago.ts`; `carregarChavesVapid`, `enviarParaInscritos`, `resumir`,
  `corsHeaders`, `readKey` do `../_shared/webpush.ts`; a RPC `confirmar_pagamento` da Task 2.
- Produz: nada que outra tarefa consuma.

**A costura de teste é a mesma da `criar-pagamento`:** um `handler(req, deps = {})` com
`deps.supabase` e `deps.fetchImpl`, e **`serve((req) => handler(req))` com um único
argumento** — nunca `serve(handler)` direto, porque o `serve` do std passa um segundo
argumento (`ConnInfo`) que cairia em `deps` por acidente. Leia
`supabase/functions/criar-pagamento/index.ts:124-140` antes de escrever.

- [ ] **Passo 1: escrever os testes que falham**

Cubra, com `deps` injetadas (sem rede, sem banco):

1. **assinatura inválida → 401** e `confirmar_pagamento` **não é chamada** (registre as
   chamadas no fake do supabase e asserte `rpc.length === 0`).
2. **MP responde 500 → a função responde 500** (é quando reenviar ajuda).
3. **MP diz `approved`, RPC devolve `'pago'` → 200** e o push é disparado uma vez.
4. **RPC devolve `'ja_pago'` → 200 e NENHUM push.** É a prova da idempotência.
5. **RPC devolve `'pago_apos_expirar'` → 200 e push disparado** (texto diferente).
6. **MP devolve status desconhecido (ex.: `in_mediation`) → 200, sem chamar a RPC com um
   status inventado.** `mapearStatus` devolve `null`; a função não pode traduzir `null` em
   nada.
7. **corpo sem `data.id` → 400**, sem tocar em MP nem banco.

Para o push, injete uma dependência `enviarPush` em `deps` que só conta chamadas — não suba
push service local aqui; o envio em si já é coberto pelos testes da `send-push`, que
exercitam o mesmo `enviarParaInscritos`. É o mesmo argumento que `notify-new-order/index_test.ts:7-12`
usa.

Para o MP, use `deps.fetchImpl` devolvendo `new Response(JSON.stringify({...}), {status})` —
igual ao que os testes da `criar-pagamento` já fazem.

- [ ] **Passo 2: rodar e verificar que falham**

```bash
deno test --allow-all --no-check supabase/functions/webhook-mercadopago/
```

Esperado: FALHA — o módulo não existe.

- [ ] **Passo 3: implementar o handler**

Regras que o código tem de obedecer, e que os testes acima cobrem:

- Lê **só** `body.data.id`. Nada mais do corpo influencia decisão.
- Chama `consultarPagamento` e usa **o status que o MP devolveu**, nunca o do corpo.
- `mapearStatus(...) === null` → `200` com `console.warn` alto, **sem chamar a RPC**.
- Chama `supabase.rpc("confirmar_pagamento", { p_order_id, p_payment_id, p_status })`, onde
  `p_order_id` vem do `external_reference` da resposta do MP — **não** do corpo do webhook.
- **O retorno da RPC decide o push:** só `'pago'` e `'pago_apos_expirar'` disparam.
- `500` só para falha transitória: `consultarPagamento` com `status >= 500` ou `status === 0`,
  e erro de banco. Todo o resto é `200`.

O texto do push (o lojista precisa distinguir venda de lixo em formação — "novo pedido" virou
sinônimo de lixo neste projeto):

```ts
const aviso = resultado === "pago_apos_expirar"
  ? {
      title: "Pagamento fora do prazo",
      body: `${numeroDoPedido(orderId)} · ${formatarBRL(valor)} · estoque ja devolvido`,
      url: "/admin-orders",
    }
  : {
      title: "Pedido pago",
      body: `${numeroDoPedido(orderId)} · ${formatarBRL(valor)}`,
      url: "/admin-orders",
    };
```

`numeroDoPedido` e `formatarBRL` **não são exportados de um lugar comum hoje** —
`numeroDoPedido` está em `notify-new-order/index.ts:73` e `formatarBRL` é local ali. Importar
de `notify-new-order` acopla uma função à outra. **Copie as duas para este arquivo** e diga no
relatório: extrair para `_shared` é refatoração que a sessão principal decide, não você.

- [ ] **Passo 4: rodar e verificar que passam**

```bash
deno test --allow-all --no-check supabase/functions/webhook-mercadopago/
```

- [ ] **Passo 5: acrescentar a entrada no `config.toml`**

```toml
# verify_jwt = false OBRIGATORIO: o Mercado Pago nao manda JWT. Quem autentica
# e' o x-signature validado em _shared/mercadopago.ts. Ligar o verify_jwt aqui
# faz o gateway recusar TODA confirmacao de pagamento, em silencio, e os
# pedidos pagos expiram como se ninguem tivesse pago.
[functions.webhook-mercadopago]
verify_jwt = false
```

- [ ] **Passo 6: prova por mutação**

Remova a chamada a `validarAssinatura` (aceite qualquer requisição) — o teste 1 tem que
**reprovar**. Depois troque a condição do push para disparar em qualquer retorno — o teste 4
tem que **reprovar**. Desfaça as duas.

- [ ] **Passo 7: verificação e commit**

```bash
npm test
```

```bash
npm run typecheck
```

```bash
git add supabase/functions/webhook-mercadopago/ supabase/config.toml
```

```bash
git commit -m "feat(checkout): webhook do Mercado Pago confirma pagamento de PIX"
```

---

### Task 5: migration da reconciliação — candidatos, `pg_net` e cron

**Arquivos:**
- Criar: `supabase/migrations/20260808000100_reconciliacao.sql`
- Modificar: `scripts/db-prove-checkout-060.cjs` (acrescenta os casos de candidatos)

**Interfaces:**
- Consome: `paid_at` e a CHECK de `payment_status` (Task 2).
- Produz: `public.pagamentos_a_reconciliar()` devolvendo `TABLE(order_id uuid,
  gateway_payment_id text)`.

- [ ] **Passo 1: confirmar `pg_net` e Vault na documentação**

Use `mcp__context7__query-docs` para Supabase: `pg_net` com `pg_cron`, e como guardar segredo
no Vault (`vault.create_secret` / `vault.decrypted_secrets`) para o cron ler sem deixar a
credencial em texto na definição do job.

**Se o Vault não estiver disponível neste projeto, PARE e reporte.** Deixar o segredo em texto
na definição do job é decisão da sessão principal — não sua.

- [ ] **Passo 2: escrever a migration**

```sql
-- Fase 3: quem o webhook perdeu.
-- SEM BEGIN/COMMIT: o db-apply.cjs abre a transacao.

-- 1. So SELECIONA candidatos. Nao decide nada -------------------------
-- A decisao mora inteira na confirmar_pagamento. Se esta funcao decidisse,
-- existiriam DOIS codigos movendo estoque a partir de status de pagamento, e
-- eles divergiriam em tres meses — como a regra de frete gratis, que chegou a
-- estar escrita em sete lugares (#53).
CREATE OR REPLACE FUNCTION public.pagamentos_a_reconciliar()
RETURNS TABLE (order_id uuid, gateway_payment_id text)
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $candidatos$
    SELECT id, gateway_payment_id
      FROM public.marketplace_orders
     WHERE payment_status = 'expirado'
       AND gateway_payment_id IS NOT NULL
       AND paid_at IS NULL
       -- 24 h: depois disso o PIX ja nao e' pagavel e a janela vira varredura
       -- do historico inteiro a cada 10 minutos.
       AND expires_at > now() - interval '24 hours'
     ORDER BY expires_at
     LIMIT 100;
$candidatos$;

REVOKE ALL ON FUNCTION public.pagamentos_a_reconciliar()
  FROM PUBLIC, anon, authenticated;

-- 2. pg_net + agendamento ---------------------------------------------
CREATE EXTENSION IF NOT EXISTS pg_net;
```

O agendamento vai no **mesmo arquivo**. Rascunho abaixo — **confirme cada nome contra o que o
Passo 1 devolveu antes de usar**, porque `vault.decrypted_secrets` e a assinatura de
`net.http_post` são exatamente o tipo de detalhe que não pode vir de memória:

```sql
-- O segredo NAO fica em texto aqui: sai do Vault na hora da chamada. E nao e'
-- a service_role — e' um RECONCILIACAO_SECRET dedicado, cujo pior caso ao
-- vazar e' alguem disparar uma reconciliacao, que so pergunta ao MP e chama a
-- confirmar_pagamento (idempotente).
SELECT cron.schedule(
    'reconciliar-pagamentos',
    '*/10 * * * *',
    $cron$
    SELECT net.http_post(
        url     := (SELECT decrypted_secret FROM vault.decrypted_secrets
                     WHERE name = 'reconciliacao_url'),
        headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'x-reconciliacao-secret',
            (SELECT decrypted_secret FROM vault.decrypted_secrets
              WHERE name = 'reconciliacao_secret')
        ),
        body    := '{}'::jsonb
    );
    $cron$
);
```

Os dois segredos (`reconciliacao_url` e `reconciliacao_secret`) **são criados fora desta
migration**, pela sessão principal, com `vault.create_secret`. O arquivo da migration não pode
conter nenhum dos dois valores — o `secretlint` barraria, e com razão.

Espelhe a forma do agendamento que a Fase 1 já criou: leia
`scripts/db-check-cron-expiracao.cjs` para ver como o job da expiração ficou registrado.

- [ ] **Passo 3: acrescentar os casos ao script de prova**

No `db-prove-checkout-060.cjs`, dentro da mesma transação com `ROLLBACK`:

| cenário | esperado |
| --- | --- |
| `expirado` + `gateway_payment_id` + `paid_at` nulo + expirou há 1 h | **aparece** |
| `expirado` + `gateway_payment_id` nulo | **não aparece** (nunca teve cobrança) |
| `expirado` + `paid_at` preenchido | **não aparece** (já reconciliado) |
| `expirado` há 30 h | **não aparece** (fora da janela) |
| `aguardando` no prazo | **não aparece** |

- [ ] **Passo 4: aplicar e provar**

```bash
node scripts/db-apply.cjs supabase/migrations/20260808000100_reconciliacao.sql
```

```bash
node scripts/db-prove-checkout-060.cjs
```

Esperado: todos os casos das tarefas 2 e 5 verdes. **Cole a saída.**

- [ ] **Passo 5: prova por mutação**

Remova o `AND paid_at IS NULL` e rode a prova: o caso "já reconciliado" tem que **reprovar**.
Desfaça.

- [ ] **Passo 6: commit**

```bash
git add supabase/migrations/20260808000100_reconciliacao.sql scripts/db-prove-checkout-060.cjs
```

```bash
git commit -m "feat(checkout): candidatos a reconciliacao e o agendamento no pg_cron"
```

---

### Task 6: `reconciliar-pagamentos`

**Arquivos:**
- Criar: `supabase/functions/reconciliar-pagamentos/index.ts`
- Criar: `supabase/functions/reconciliar-pagamentos/index_test.ts`
- Modificar: `supabase/config.toml`

**Interfaces:**
- Consome: `pagamentos_a_reconciliar()` (Task 5), `confirmar_pagamento` (Task 2),
  `consultarPagamento` e `mapearStatus` (`_shared/mercadopago.ts`).
- Produz: nada que outra tarefa consuma.

- [ ] **Passo 1: escrever os testes que falham**

1. **Sem o header `x-reconciliacao-secret` correto → 401**, e `pagamentos_a_reconciliar`
   **não é chamada**.
2. **Nenhum candidato → 200** com `{ ok: true, verificados: 0 }`.
3. **Candidato cujo MP diz `approved` → chama `confirmar_pagamento` com `'pago'`** e conta 1
   confirmado. (A RPC é quem decide virar `pago_apos_expirar`; esta função **não** decide.)
4. **Candidato cujo MP diz `cancelled` → chama a RPC com `'recusado'`.**
5. **Um candidato falha na consulta ao MP e os outros continuam** — a falha de um não aborta
   o lote.

- [ ] **Passo 2: rodar e verificar que falham**

```bash
deno test --allow-all --no-check supabase/functions/reconciliar-pagamentos/
```

- [ ] **Passo 3: implementar**

Mesma costura `handler(req, deps = {})` da Task 4. Regras:

- Compara o header com `Deno.env.get("RECONCILIACAO_SECRET")` **em tempo constante** — reuse a
  ideia da comparação de `validarAssinatura`. Segredo ausente no ambiente → `503`, nunca
  "passa direto".
- Para cada candidato: `consultarPagamento` → `mapearStatus` → se `null`, `console.warn` e
  segue para o próximo; senão `supabase.rpc("confirmar_pagamento", ...)`.
- **Cada candidato dentro do seu próprio `try`.** Um erro não pode abortar o lote — é
  exatamente o cenário do teste 5.
- Devolve `{ ok: true, verificados, confirmados, falhas }`. Contagem verdadeira: responder
  sucesso sem verificar nada é como este projeto passou meses achando que o push funcionava
  (#80).
- **Não manda push.** Quem avisa é o webhook; se a reconciliação também avisasse, o lojista
  receberia dois avisos do mesmo pedido. O `pago_apos_expirar` encontrado aqui aparece na fila
  de atenção da Task 9.

- [ ] **Passo 4: rodar, verificar que passam, e mutar**

```bash
deno test --allow-all --no-check supabase/functions/reconciliar-pagamentos/
```

Depois remova a checagem do segredo — o teste 1 tem que **reprovar**. Desfaça.

- [ ] **Passo 5: entrada no `config.toml`**

```toml
# verify_jwt = false de proposito: quem chama e' o pg_cron via pg_net, e com
# verify_jwt = true a credencial teria de ser a service_role — que passaria a
# viver dentro do banco. Aqui a autenticacao e' o RECONCILIACAO_SECRET, cujo
# pior caso ao vazar e' alguem disparar uma reconciliacao idempotente.
[functions.reconciliar-pagamentos]
verify_jwt = false
```

- [ ] **Passo 6: verificação e commit**

```bash
npm test
```

```bash
git add supabase/functions/reconciliar-pagamentos/ supabase/config.toml
```

```bash
git commit -m "feat(checkout): reconciliacao pega o pagamento que o webhook perdeu"
```

---

### Task 7: `criar-pagamento` — `notification_url` e recusa de cartão

**Arquivos:**
- Modificar: `supabase/functions/criar-pagamento/index.ts:156` e o trecho que monta o corpo
  (linhas 224–244)
- Modificar: `supabase/functions/_shared/mercadopago.ts` (`montarCorpoPix`)
- Modificar: os testes existentes da `criar-pagamento` e do `_shared`

**Interfaces:**
- Consome: `montarCorpoPix` (assinatura atual em `_shared/mercadopago.ts:58-83`).
- Produz: `montarCorpoPix` passa a aceitar `notificationUrl?: string`.

**Duas mudanças, uma razão comum:** as duas fecham porta que a Fase 2 deixou aberta e que só
morde quando a flag ligar.

- [ ] **Passo 1: escrever os testes que falham**

Em `_shared`: `montarCorpoPix` com `notificationUrl` **inclui** `notification_url` no corpo; e
**sem** o parâmetro, a chave **não existe** no objeto (não pode virar `undefined` serializado).

Na `criar-pagamento`: `body.metodo === "cartao"` devolve **400** com mensagem que diz que o
cartão está indisponível, **sem chamar o MP** (asserte que `fetchImpl` não foi chamado).

- [ ] **Passo 2: rodar e verificar que falham**

```bash
deno test --allow-all --no-check supabase/functions/
```

- [ ] **Passo 3: implementar**

Em `_shared/mercadopago.ts`, dentro de `montarCorpoPix`, depois do `external_reference`:

```ts
// Sem isto o webhook depende de configuracao no painel do MP — que ninguem
// percebe quando some, e nenhum teste pega. Herança nº 4 da Fase 2.
...(args.notificationUrl ? { notification_url: args.notificationUrl } : {}),
```

Em `criar-pagamento/index.ts:156`, trocar a validação de método:

```ts
  // Fase 3 entrega SO PIX. O cartao continua desligado no Brick (Task 8), mas
  // a recusa tem de ser aqui tambem: a tela e' do cliente, e o caminho de
  // cartao tem defeito conhecido — depois da primeira recusa o pedido fica
  // impagavel ate expirar (herança nº 2 da Fase 2). Cartao e' a Fase 3.5.
  if (body.metodo !== "pix") {
    return json({ error: "No momento aceitamos apenas PIX." }, 400);
  }
```

E o `notificationUrl` na chamada de `montarCorpoPix`:

```ts
        notificationUrl: `${Deno.env.get("SUPABASE_URL")}/functions/v1/webhook-mercadopago`,
```

O ramo `montarCorpoCartao` fica **inalcançável** a partir daqui. **Não apague
`montarCorpoCartao` nem seus testes** — é a Fase 3.5 que os usa. Diga no relatório que ele
ficou órfão de propósito, para o `knip` não ser "corrigido" por engano.

- [ ] **Passo 4: rodar, verificar, mutar**

```bash
deno test --allow-all --no-check supabase/functions/
```

Mutação: troque `body.metodo !== "pix"` de volta para a condição antiga — o teste do cartão
tem que **reprovar**.

- [ ] **Passo 5: commit**

```bash
git add supabase/functions/criar-pagamento/ supabase/functions/_shared/mercadopago.ts
```

```bash
git commit -m "feat(checkout): notification_url no corpo e recusa de cartao na Fase 3"
```

---

### Task 8: Brick só com PIX

**Arquivos:**
- Modificar: `src/components/checkout/PagamentoOnline.tsx:102-106`
- Modificar/criar: teste em `tests/front/`

**Interfaces:**
- Consome: nada.
- Produz: nada.

- [ ] **Passo 1: confirmar a configuração do Brick na documentação**

Use `mcp__context7__query-docs` para o Mercado Pago Bricks: como **desabilitar cartão** no
Payment Brick — se é omitir a chave `creditCard` do `customization.paymentMethods` ou passar
um valor explícito. Siga o que a documentação disser.

- [ ] **Passo 2: escrever o teste que falha**

O teste monta o componente com o SDK do MP stubado e asserte que o objeto passado a
`mp.bricks().create("payment", ...)` **não** habilita cartão. Leia os testes já existentes
deste componente em `tests/front/` antes — a Fase 2 deixou o stub do SDK pronto, e refazer
outro do zero é como o teste começa a divergir do componente.

- [ ] **Passo 3: rodar e verificar que falha**

```bash
npx vitest run tests/front
```

- [ ] **Passo 4: implementar**

Em `PagamentoOnline.tsx:104-106`:

```tsx
        customization: {
          // So PIX na Fase 3. O caminho de cartao existe no codigo mas tem
          // defeito conhecido: depois da primeira recusa o pedido fica
          // impagavel ate expirar, e a mensagem atual pede "tente outro
          // cartao", o que e' impossivel. Religar cartao e' a Fase 3.5, e
          // depende de chave de idempotencia versionada.
          paymentMethods: { bankTransfer: "all" },
        },
```

- [ ] **Passo 5: rodar, verificar, mutar**

```bash
npx vitest run tests/front
```

Mutação: devolva `creditCard: "all"` — o teste tem que **reprovar**.

- [ ] **Passo 6: commit**

```bash
git add src/components/checkout/PagamentoOnline.tsx tests/front
```

```bash
git commit -m "feat(checkout): Brick oferece so PIX na Fase 3"
```

---

### Task 9: fila de atenção no admin

**Arquivos:**
- Modificar: `src/views/admin/AdminOrdersView.tsx`
- Modificar: `src/components/admin/orders/OrderStatusBadge.tsx` (é onde o destaque visual de
  status já mora — **leia antes**, para o `payment_status` seguir a mesma convenção do
  `status` em vez de inventar uma segunda)
- Modificar/criar: teste em `tests/front/`

**Interfaces:**
- Consome: a coluna `payment_status` (Fase 1) e `paid_at` (Task 2).
- Produz: nada.

**O mínimo que a decisão de `pago_apos_expirar` exige, e nada além.** Painel completo de
pagamento é a Fase 4 (#110). Se esta tarefa crescer para além de filtro e destaque, ela saiu
do escopo — pare e reporte.

- [ ] **Passo 1: ler a tela antes de tocar nela**

Leia `src/views/admin/AdminOrdersView.tsx` e `src/components/admin/orders/OrderStatusBadge.tsx`
inteiros. Use `mcp__serena__find_referencing_symbols` no badge para ver quem mais o consome
antes de mudar a assinatura dele. **Não** faça `grep` cego: este repositório tem arquivos
grandes (o `CheckoutView.tsx` tem 1.110 linhas) e mudança cega neles é como se cria duplicata
— foi assim que a regra de frete grátis acabou em sete lugares (#53).

- [ ] **Passo 2: escrever o teste que falha**

Com uma lista de pedidos em memória cobrindo `aguardando`, `pago`, `pago_apos_expirar`,
`estornado` e `payment_status` **nulo** (os 64 pedidos históricos têm `NULL` — a tela não pode
quebrar com eles), asserte:

1. o filtro por `payment_status` restringe a lista;
2. `pago_apos_expirar` e `estornado` recebem destaque visual distinto dos demais;
3. pedido com `payment_status` nulo continua aparecendo e não quebra a renderização.

- [ ] **Passo 3: rodar e verificar que falha**

```bash
npx vitest run tests/front
```

- [ ] **Passo 4: implementar**

Siga o padrão de filtro que a tela já usa para `status`. Não introduza biblioteca nova. Os
rótulos em português, na convenção do resto do admin:

| valor | rótulo |
| --- | --- |
| `aguardando` | Aguardando pagamento |
| `pago` | Pago |
| `recusado` | Recusado |
| `expirado` | Expirado |
| `estornado` | Estornado — precisa de atenção |
| `pago_apos_expirar` | Pago fora do prazo — precisa de atenção |
| `NULL` | Sem cobrança online |

- [ ] **Passo 5: rodar, verificar, e ver na tela**

```bash
npx vitest run tests/front
```

Suba o preview com `mcp__Claude_Browser__preview_start` e `{name: "core_app_mkt"}` e confira o
filtro. **Não crie pedido nem cadastro pela tela** — o dev local escreve no Supabase de
produção. Só olhe a lista que já existe.

- [ ] **Passo 6: commit**

```bash
git add src tests/front
```

```bash
git commit -m "feat(admin): filtro por status de pagamento e fila de atencao"
```

---

## Fecho da fase — o que a sessão principal faz

Depois das nove tarefas revisadas e integradas:

1. Rodar os sete comandos do CI e **colar a saída**.
2. Abrir o PR para a `develop`.
3. **Portão do Gabriel:** `vercel env ls` provando que o Preview **não** aponta para o
   Supabase de produção. Se apontar, **parar aqui** — o PIX de teste reservaria estoque real,
   revertido só pelo `pg_cron` 35 min depois.
4. **Portão do Gabriel:** Task 0 do Mercado Pago — escopo de PIX na conta, aceitar que o
   dinheiro cai no saldo do MP, gerar credenciais de **TESTE**.
5. Deploy das functions com o `config.toml` conferido contra o painel, e os segredos
   (`MP_WEBHOOK_SECRET`, `RECONCILIACAO_SECRET`) no ambiente das functions.
6. Ligar `VITE_PAGAMENTO_ONLINE=true` **só no Preview**.
7. Um PIX de teste percorrendo `pagamento → webhook → pago → push`.

**A loja em produção continua sem cobrar quando esta fase fechar.** Ligar lá é decisão
separada do Gabriel.

---

## O que este plano NÃO entrega

- **Cartão** — desligado no Brick e recusado na `criar-pagamento`. Fase 3.5, e ela precisa de
  chave de idempotência versionada (`orderId:1`, `orderId:2`) e tela de sucesso.
- **Teste de concorrência real** entre a varredura e o webhook. Exige duas sessões de banco
  simultâneas. O script prova o **resultado** (pedido `expirado` recebendo confirmação vira
  `pago_apos_expirar`), não o entrelaçamento das travas. **A garantia ali vem do `FOR UPDATE`
  e da releitura — quem revisar precisa olhar o código com esse olho.**
- **`in_mediation` mapeado explicitamente** — cai no ramo de desconhecido (`200` + log +
  fila), que é seguro. Fase 3.5.
- **Painel completo de pagamento** (#110), **e-mail de confirmação** (#106), **status em
  `notificacoes`** (#107).
- **Cupom devolvido em pedido expirado** — #116 (CUPOM-030), já no board.
