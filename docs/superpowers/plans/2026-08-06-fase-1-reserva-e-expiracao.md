# Fase 1 — Reserva de estoque com expiração

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **⚠️ PARE DEPOIS DA TASK 4.** Decisão do Gabriel: as Tasks 1–4 podem correr
> seguidas; a Task 5 cancela 13 pedidos de clientes reais e exige aprovação
> explícita antes de começar. O portão está marcado no meio do documento.

**Goal:** Fazer o estoque reservado por um pedido voltar sozinho ao catálogo se o pedido não for pago em 30 minutos, e devolver as 33 unidades presas em 13 pedidos abandonados desde março.

**Architecture:** Duas colunas novas em `marketplace_orders` (`payment_status`, `expires_at`) mais uma terceira já preparada para a Fase 2 (`gateway_payment_id`). Uma função `devolver_estoque()` reutilizável, uma varredura `expirar_pedidos_vencidos()` agendada no `pg_cron` a cada 5 minutos, e a RPC `create_marketplace_order_v24` que carimba o prazo na criação. Nada aqui toca Mercado Pago.

**Tech Stack:** PostgreSQL 17 (Supabase), plpgsql, `pg_cron`, Node 24 para os scripts de aplicação e prova, React/TypeScript no front.

**Spec:** [`2026-08-06-gateway-mercadopago-design.md`](../specs/2026-08-06-gateway-mercadopago-design.md)

## Global Constraints

- **A migration NÃO pode conter `BEGIN` / `COMMIT`.** O `db-apply.cjs` já abre transação própria, e um `COMMIT` embutido faz o `ROLLBACK` do script de prova virar no-op — grava em produção achando que está testando. Já aconteceu neste repositório.
- **Nunca rodar `supabase db push`.** A aplicação é `node scripts/db-apply.cjs <arquivo.sql>`, um arquivo por vez.
- **Antes de aplicar qualquer migration**, cumprir o § 9 de `docs/onboarding/03-SETUP-AMBIENTE.md`: confirmar que o backup de hoje já saiu (`npx supabase backups list --project-ref cafkrminfnokvgjqtkle`, olhar o `inserted_at` mais recente) e rodar `node scripts/db-snapshot-politicas.cjs`. **Não há PITR** — reverter custa até 24 h de pedidos.
- **Linhas históricas ficam com `payment_status = NULL`.** Todas as funções desta fase só agem sobre `'aguardando'`. Isso protege os 64 pedidos que já existem de qualquer varredura automática.
- **Nomes em português** nas funções novas, seguindo `devolver_estoque` / `expirar_pedidos_vencidos`, como o resto do banco (`update_order_status_atomic` é legado em inglês; não seguir).
- A catraca de lint reprova se qualquer contagem subir: `npm run lint:ratchet` tem de sair `ok` antes de cada commit.

---

## Estrutura de arquivos

| arquivo | responsabilidade |
| --- | --- |
| `supabase/migrations/20260807000000_reserva_com_expiracao.sql` | **criar** — colunas, `devolver_estoque`, `expirar_pedidos_vencidos`, `create_marketplace_order_v24` |
| `supabase/migrations/20260807000001_agenda_expiracao.sql` | **criar** — extensão `pg_cron` e o agendamento |
| `supabase/migrations/20260807000002_backfill_pedidos_abandonados.sql` | **criar** — cancela os 13 antigos, devolve 33 unidades |
| `scripts/db-prove-checkout-010.cjs` | **criar** — prova as três funções em transação com `ROLLBACK` |
| `src/hooks/useOrders.ts:~860` | **modificar** — `createOrder` passa a chamar a `v24` |

Três migrations em vez de uma porque cada uma pode ser aprovada ou rejeitada sozinha: a primeira é estrutura, a segunda é agendamento (e depende de extensão que pode não subir), a terceira mexe em **dado real de cliente** e merece revisão separada.

**O que da spec NÃO entra aqui, e por quê:** a `reconciliar_pagamentos()` aparece na lista de componentes do desenho, mas ela pergunta ao Mercado Pago o status de um pagamento — não existe sem a API integrada. **É da Fase 3**, junto do webhook que ela protege. Não é lacuna deste plano.

---

### Task 1: Colunas de pagamento e a função de devolver estoque

**Files:**
- Create: `supabase/migrations/20260807000000_reserva_com_expiracao.sql`
- Create: `scripts/db-prove-checkout-010.cjs`

**Interfaces:**
- Produces: `public.devolver_estoque(p_order_id uuid) RETURNS integer` — devolve o total de unidades repostas. Usada pela Task 2 e, na Fase 3, pelo webhook de recusa.
- Produces: colunas `marketplace_orders.payment_status text`, `.expires_at timestamptz`, `.gateway_payment_id text`.

- [ ] **Step 1: Escrever a migration com as colunas e a função**

Criar `supabase/migrations/20260807000000_reserva_com_expiracao.sql`:

```sql
-- Fase 1 da cobranca no site (CHECKOUT-010 #109 / CHECKOUT-040 #110).
-- SEM BEGIN/COMMIT: o db-apply.cjs abre a transacao.

-- 1. Colunas de pagamento -----------------------------------------------
-- payment_status fica NULL nas 64 linhas existentes de proposito: as funcoes
-- abaixo so agem sobre 'aguardando', entao historico nao e varrido por engano.
ALTER TABLE public.marketplace_orders
  ADD COLUMN IF NOT EXISTS payment_status     text,
  ADD COLUMN IF NOT EXISTS expires_at         timestamptz,
  ADD COLUMN IF NOT EXISTS gateway_payment_id text;

ALTER TABLE public.marketplace_orders
  DROP CONSTRAINT IF EXISTS marketplace_orders_payment_status_check;

ALTER TABLE public.marketplace_orders
  ADD CONSTRAINT marketplace_orders_payment_status_check
  CHECK (payment_status IS NULL OR payment_status IN (
    'aguardando', 'pago', 'recusado', 'expirado', 'estornado', 'pago_apos_expirar'
  ));

-- Indice para a varredura nao fazer seq scan a cada 5 minutos.
CREATE INDEX IF NOT EXISTS idx_marketplace_orders_expiracao
  ON public.marketplace_orders (expires_at)
  WHERE payment_status = 'aguardando';

-- gateway_payment_id e unico: e o que torna o webhook idempotente na Fase 3.
CREATE UNIQUE INDEX IF NOT EXISTS idx_marketplace_orders_gateway_payment_id
  ON public.marketplace_orders (gateway_payment_id)
  WHERE gateway_payment_id IS NOT NULL;

-- 2. Devolver estoque ---------------------------------------------------
CREATE OR REPLACE FUNCTION public.devolver_estoque(p_order_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $devolver$
DECLARE
    v_item     RECORD;
    v_unidades integer := 0;
BEGIN
    FOR v_item IN
        SELECT product_id, variant_id, quantity
        FROM public.marketplace_order_items
        WHERE order_id = p_order_id
    LOOP
        -- IF/ELSE, nao dois IF: a v23 debita XOR (variante OU produto, nunca os
        -- dois), e o front manda product_id preenchido junto com variant_id. Com
        -- dois IF, todo pedido de variante que expirasse creditaria o produto pai
        -- tambem, inflando o catalogo para sempre. Mesma forma do restore que ja
        -- existe em update_order_status_atomic.
        IF v_item.variant_id IS NOT NULL THEN
            UPDATE public.product_variants
               SET stock_increment = stock_increment + v_item.quantity
             WHERE id = v_item.variant_id;
        ELSE
            UPDATE public.produtos
               SET estoque = estoque + v_item.quantity
             WHERE id = v_item.product_id;
        END IF;

        v_unidades := v_unidades + v_item.quantity;
    END LOOP;

    RETURN v_unidades;
END;
$devolver$;

REVOKE ALL ON FUNCTION public.devolver_estoque(uuid) FROM PUBLIC, anon, authenticated;
```

O `REVOKE` importa: sem ele, qualquer cliente autenticado poderia chamar a função com o id de um pedido alheio e inflar o estoque. Ela é chamada só por outras funções `SECURITY DEFINER` e pelo `pg_cron`.

- [ ] **Step 2: Escrever o script de prova, com o teste falhando**

Criar `scripts/db-prove-checkout-010.cjs`. Ele segue o padrão dos `db-prove-*.cjs` que já existem: abre transação, monta o cenário, verifica, e termina em `ROLLBACK` — **nada é gravado**.

```js
#!/usr/bin/env node
/**
 * Prova as funcoes da Fase 1 (CHECKOUT-010 #109).
 *
 * TUDO roda em UMA transacao terminada em ROLLBACK. Nada e gravado.
 * Isso so e verdade porque a migration NAO tem COMMIT embutido — se alguem
 * acrescentar um, este script passa a gravar em producao sem avisar.
 */
const fs = require("node:fs");
const path = require("node:path");
const { Client } = require("pg");

const RAIZ = path.resolve(__dirname, "..");

function lerDatabaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  for (const arquivo of [".env.local", ".env"]) {
    const caminho = path.join(RAIZ, arquivo);
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    if (!fs.existsSync(caminho)) continue;
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    const linha = fs.readFileSync(caminho, "utf8")
      .split(/\r?\n/)
      .find((l) => l.startsWith("DATABASE_URL="));
    if (linha) return linha.slice("DATABASE_URL=".length).replace(/^"|"$/g, "");
  }
  throw new Error("DATABASE_URL não encontrada.");
}

let passou = 0;
let falhou = 0;

function conferir(nome, condicao, detalhe) {
  if (condicao) {
    passou++;
    console.log(`  ok   ${nome}`);
  } else {
    falhou++;
    console.error(`  FALHA ${nome}${detalhe ? ` — ${detalhe}` : ""}`);
  }
}

async function main() {
  const client = new Client({
    connectionString: lerDatabaseUrl(),
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  await client.query("BEGIN");

  try {
    console.log("\n=== devolver_estoque ===");

    // `custo` e NOT NULL sem default nesta tabela — omitir quebra o INSERT.
    const prod = await client.query(`
      INSERT INTO public.produtos (nome, custo, preco_venda, estoque, categoria)
      VALUES ('PROVA CHECKOUT-010', 5.00, 10.00, 5, 'teste')
      RETURNING id, estoque
    `);
    const produtoId = prod.rows[0].id;

    // `customer_data` (jsonb) e `subtotal` sao NOT NULL sem default nesta
    // tabela — omitir qualquer um dos dois quebra o INSERT. E por isso que os
    // outros db-prove-*.cjs criam pedido pela RPC em vez de INSERT cru.
    const ped = await client.query(`
      INSERT INTO public.marketplace_orders
        (total, subtotal, status, payment_status, customer_name, customer_data)
      VALUES (20.00, 20.00, 'pending', 'aguardando', 'PROVA', '{}'::jsonb)
      RETURNING id
    `);
    const pedidoId = ped.rows[0].id;

    await client.query(
      `INSERT INTO public.marketplace_order_items
         (order_id, product_id, product_name, quantity, price)
       VALUES ($1, $2, 'PROVA CHECKOUT-010', 2, 10.00)`,
      [pedidoId, produtoId],
    );

    await client.query(
      "UPDATE public.produtos SET estoque = estoque - 2 WHERE id = $1",
      [produtoId],
    );

    const devolvidas = await client.query(
      "SELECT public.devolver_estoque($1) AS unidades",
      [pedidoId],
    );
    conferir(
      "devolve o numero de unidades do pedido",
      devolvidas.rows[0].unidades === 2,
      `veio ${devolvidas.rows[0].unidades}`,
    );

    const depois = await client.query(
      "SELECT estoque FROM public.produtos WHERE id = $1",
      [produtoId],
    );
    conferir(
      "estoque volta ao valor original",
      depois.rows[0].estoque === 5,
      `veio ${depois.rows[0].estoque}`,
    );

    // Item de VARIANTE: a linha carrega product_id E variant_id, porque e assim
    // que a v23 grava. Como o debito dela e XOR, a devolucao tambem tem de ser —
    // creditar os dois infla o catalogo. Este par de asserts e a trava disso.
    const prodVar = await client.query(`
      INSERT INTO public.produtos (nome, custo, preco_venda, estoque, categoria)
      VALUES ('PROVA VARIANTE', 5.00, 10.00, 7, 'teste')
      RETURNING id
    `);
    const produtoVarId = prodVar.rows[0].id;

    const variante = await client.query(
      `INSERT INTO public.product_variants (product_id, name, value, stock_increment)
       VALUES ($1, 'Tamanho', 'M', 4)
       RETURNING id`,
      [produtoVarId],
    );
    const varianteId = variante.rows[0].id;

    const pedVar = await client.query(`
      INSERT INTO public.marketplace_orders
        (total, subtotal, status, payment_status, customer_name, customer_data)
      VALUES (10.00, 10.00, 'pending', 'aguardando', 'PROVA VARIANTE', '{}'::jsonb)
      RETURNING id
    `);
    await client.query(
      `INSERT INTO public.marketplace_order_items
         (order_id, product_id, variant_id, product_name, quantity, price)
       VALUES ($1, $2, $3, 'PROVA VARIANTE', 1, 10.00)`,
      [pedVar.rows[0].id, produtoVarId, varianteId],
    );
    await client.query(
      "UPDATE public.product_variants SET stock_increment = stock_increment - 1 WHERE id = $1",
      [varianteId],
    );

    await client.query("SELECT public.devolver_estoque($1)", [pedVar.rows[0].id]);

    const varDepois = await client.query(
      "SELECT stock_increment FROM public.product_variants WHERE id = $1",
      [varianteId],
    );
    conferir(
      "variante volta ao estoque original",
      varDepois.rows[0].stock_increment === 4,
      `veio ${varDepois.rows[0].stock_increment}`,
    );

    const paiDepois = await client.query(
      "SELECT estoque FROM public.produtos WHERE id = $1",
      [produtoVarId],
    );
    conferir(
      "produto pai da variante NAO e creditado",
      paiDepois.rows[0].estoque === 7,
      `veio ${paiDepois.rows[0].estoque}, esperava 7 — creditar os dois infla o catalogo`,
    );
  } finally {
    await client.query("ROLLBACK");
    await client.end();
  }

  console.log(`\n${passou} passaram, ${falhou} falharam.`);
  process.exit(falhou > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
```

- [ ] **Step 3: Rodar a prova e confirmar que FALHA**

```bash
node scripts/db-prove-checkout-010.cjs
```

Esperado: erro. A coluna `payment_status` ainda não existe, então a falha vem antes da função — `column "payment_status" of relation "marketplace_orders" does not exist` é tão válido quanto `function public.devolver_estoque(uuid) does not exist`. O que importa é que **falhe**. Se passar, a migration já foi aplicada antes da hora — pare e investigue.

- [ ] **Step 4: Cumprir o § 9 antes de aplicar**

```bash
npx supabase backups list --project-ref cafkrminfnokvgjqtkle
```

Olhar o `inserted_at` mais recente. **Se não for de hoje, parar e esperar.**

```bash
node scripts/db-snapshot-politicas.cjs
```

- [ ] **Step 5: Aplicar a migration**

```bash
node scripts/db-apply.cjs 20260807000000_reserva_com_expiracao.sql
```

- [ ] **Step 6: Rodar a prova e confirmar que PASSA**

```bash
node scripts/db-prove-checkout-010.cjs
```

Esperado: `4 passaram, 0 falharam.`

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/20260807000000_reserva_com_expiracao.sql scripts/db-prove-checkout-010.cjs
git commit -m "feat(db): colunas de pagamento e devolver_estoque (CHECKOUT-010)"
```

---

### Task 2: A varredura de expiração

**Files:**
- Modify: `supabase/migrations/20260807000000_reserva_com_expiracao.sql` (acrescentar ao fim)
- Modify: `scripts/db-prove-checkout-010.cjs` (acrescentar bloco de teste)

**Interfaces:**
- Consumes: `devolver_estoque(uuid)` da Task 1.
- Produces: `public.expirar_pedidos_vencidos() RETURNS integer` — devolve quantos pedidos expirou. Chamada pelo `pg_cron` na Task 3.

> **Atenção:** a Task 1 já foi aplicada. Esta task acrescenta ao **mesmo arquivo** de migration, que será reaplicado — por isso tudo nele é `CREATE OR REPLACE` / `IF NOT EXISTS`. Reaplicar é seguro e é o comportamento esperado.

- [ ] **Step 1: Escrever o teste, primeiro**

Acrescentar ao `db-prove-checkout-010.cjs`, dentro do `try`, depois do bloco anterior:

```js
    console.log("\n=== expirar_pedidos_vencidos ===");

    // Pedido VENCIDO: deve ser expirado e devolver estoque.
    const prod2 = await client.query(`
      INSERT INTO public.produtos (nome, custo, preco_venda, estoque, categoria)
      VALUES ('PROVA EXPIRACAO', 5.00, 10.00, 3, 'teste')
      RETURNING id
    `);
    const produto2 = prod2.rows[0].id;

    const vencido = await client.query(`
      INSERT INTO public.marketplace_orders
        (total, subtotal, status, payment_status, expires_at, customer_name, customer_data)
      VALUES (10.00, 10.00, 'pending', 'aguardando', now() - interval '1 minute', 'VENCIDO', '{}'::jsonb)
      RETURNING id
    `);
    await client.query(
      `INSERT INTO public.marketplace_order_items
         (order_id, product_id, product_name, quantity, price)
       VALUES ($1, $2, 'PROVA EXPIRACAO', 1, 10.00)`,
      [vencido.rows[0].id, produto2],
    );

    // Pedido AINDA NO PRAZO: nao pode ser tocado.
    const noPrazo = await client.query(`
      INSERT INTO public.marketplace_orders
        (total, subtotal, status, payment_status, expires_at, customer_name, customer_data)
      VALUES (10.00, 10.00, 'pending', 'aguardando', now() + interval '20 minutes', 'NO PRAZO', '{}'::jsonb)
      RETURNING id
    `);

    // Pedido HISTORICO (payment_status NULL): nao pode ser tocado.
    const historico = await client.query(`
      INSERT INTO public.marketplace_orders
        (total, subtotal, status, customer_name, customer_data)
      VALUES (10.00, 10.00, 'pending', 'HISTORICO', '{}'::jsonb)
      RETURNING id
    `);

    await client.query("SELECT public.expirar_pedidos_vencidos()");

    const est2 = await client.query(
      "SELECT estoque FROM public.produtos WHERE id = $1",
      [produto2],
    );
    conferir(
      "expiracao devolve o estoque do pedido vencido",
      est2.rows[0].estoque === 4,
      `veio ${est2.rows[0].estoque}, esperava 4 (3 + 1 devolvida)`,
    );

    const estados = await client.query(
      `SELECT id, status, payment_status FROM public.marketplace_orders
        WHERE id = ANY($1::uuid[])`,
      [[vencido.rows[0].id, noPrazo.rows[0].id, historico.rows[0].id]],
    );
    const por = (id) => estados.rows.find((r) => r.id === id);

    conferir(
      "vencido vira expirado e cancelado",
      por(vencido.rows[0].id).payment_status === "expirado" &&
        por(vencido.rows[0].id).status === "cancelled",
    );
    conferir(
      "pedido no prazo NAO e tocado",
      por(noPrazo.rows[0].id).payment_status === "aguardando" &&
        por(noPrazo.rows[0].id).status === "pending",
    );
    conferir(
      "pedido historico (payment_status NULL) NAO e tocado",
      por(historico.rows[0].id).payment_status === null &&
        por(historico.rows[0].id).status === "pending",
    );
```

- [ ] **Step 2: Rodar e confirmar que FALHA**

```bash
node scripts/db-prove-checkout-010.cjs
```

Esperado: `function public.expirar_pedidos_vencidos() does not exist`.

- [ ] **Step 3: Escrever a função**

Acrescentar ao fim de `20260807000000_reserva_com_expiracao.sql`:

```sql
-- 3. Varredura de expiracao ---------------------------------------------
CREATE OR REPLACE FUNCTION public.expirar_pedidos_vencidos()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $expirar$
DECLARE
    v_pedido   RECORD;
    v_expirados integer := 0;
BEGIN
    -- FOR UPDATE SKIP LOCKED: se o webhook da Fase 3 estiver confirmando este
    -- mesmo pedido agora, ele detem a trava e a varredura pula em vez de
    -- disputar. Quem chegou primeiro ganha; nao ha sobrescrita.
    FOR v_pedido IN
        SELECT id
        FROM public.marketplace_orders
        WHERE payment_status = 'aguardando'
          AND expires_at IS NOT NULL
          AND expires_at < now()
        FOR UPDATE SKIP LOCKED
    LOOP
        PERFORM public.devolver_estoque(v_pedido.id);

        UPDATE public.marketplace_orders
           SET payment_status = 'expirado',
               status         = 'cancelled',
               updated_at     = now()
         WHERE id = v_pedido.id;

        v_expirados := v_expirados + 1;
    END LOOP;

    RETURN v_expirados;
END;
$expirar$;

REVOKE ALL ON FUNCTION public.expirar_pedidos_vencidos() FROM PUBLIC, anon, authenticated;
```

- [ ] **Step 4: Aplicar e rodar a prova**

```bash
node scripts/db-apply.cjs 20260807000000_reserva_com_expiracao.sql
```

```bash
node scripts/db-prove-checkout-010.cjs
```

Esperado: `8 passaram, 0 falharam.`

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260807000000_reserva_com_expiracao.sql scripts/db-prove-checkout-010.cjs
git commit -m "feat(db): varredura de expiracao de pedido nao pago (CHECKOUT-010)"
```

---

### Task 3: A RPC v24 carimba o prazo

**Files:**
- Modify: `supabase/migrations/20260807000000_reserva_com_expiracao.sql` (acrescentar ao fim)
- Modify: `scripts/db-prove-checkout-010.cjs`

**Interfaces:**
- Produces: `public.create_marketplace_order_v24(...)` — **mesma assinatura de 12 argumentos da v23**, mesmo retorno `uuid`.

- [ ] **Step 1: Extrair o corpo da v23 do baseline**

A v24 é a v23 com **uma única mudança**. Não redigite as 242 linhas — copie:

```bash
node -e "const fs=require('fs');const s=fs.readFileSync('supabase/migrations/20260806000000_baseline_do_schema_vivo.sql','utf8');const i=s.indexOf('CREATE FUNCTION public.create_marketplace_order_v23');const f=s.indexOf('\$\$;',i);fs.writeFileSync('/tmp/v23.sql',s.slice(i,f+3))"
```

No PowerShell, use `$env:TEMP\v23.sql` no lugar de `/tmp/v23.sql`.

- [ ] **Step 2: Aplicar a única mudança**

No texto extraído, trocar `create_marketplace_order_v23` por `create_marketplace_order_v24` no cabeçalho, e trocar **este bloco**:

```sql
    INSERT INTO public.marketplace_orders (
        user_id, total, shipping, payment_method, address_id,
        coupon_id, status, notes, customer_name, customer_data,
        subtotal, discount, coupon_code
    ) VALUES (
        v_user_id, v_calculated_total, v_shipping_validated, p_payment_method, p_address_id,
        v_coupon_id, 'pending', p_observation, p_customer_name,
```

por **este**:

```sql
    INSERT INTO public.marketplace_orders (
        user_id, total, shipping, payment_method, address_id,
        coupon_id, status, notes, customer_name, customer_data,
        subtotal, discount, coupon_code,
        payment_status, expires_at
    ) VALUES (
        v_user_id, v_calculated_total, v_shipping_validated, p_payment_method, p_address_id,
        v_coupon_id, 'pending', p_observation, p_customer_name,
```

e, no fim da mesma instrução, trocar:

```sql
        v_calculated_subtotal, v_discount_amount, p_coupon_code
    ) RETURNING id INTO v_order_id;
```

por:

```sql
        v_calculated_subtotal, v_discount_amount, p_coupon_code,
        'aguardando', now() + interval '30 minutes'
    ) RETURNING id INTO v_order_id;
```

**Nada mais muda.** Toda a validação de preço, estoque, frete e cupom fica idêntica — é caminho de dinheiro já testado, e mexer nele aqui seria escopo alheio a esta fase.

Colar o resultado ao fim da migration, e acrescentar:

```sql
GRANT EXECUTE ON FUNCTION public.create_marketplace_order_v24(
  jsonb, numeric, numeric, text, uuid, text, text, text, text, jsonb, text, text
) TO anon, authenticated;
```

O `GRANT` para `anon` é intencional: o checkout de convidado precisa criar pedido, e é assim que a v23 já está concedida hoje.

- [ ] **Step 3: Escrever o teste**

Acrescentar ao `db-prove-checkout-010.cjs`:

```js
    console.log("\n=== create_marketplace_order_v24 ===");

    const assinatura = await client.query(`
      SELECT pg_get_function_identity_arguments(p.oid) AS args
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = 'create_marketplace_order_v24'
    `);
    conferir(
      "v24 existe com os 12 argumentos da v23",
      assinatura.rowCount === 1 &&
        assinatura.rows[0].args.split(",").length === 12,
      `veio ${assinatura.rows[0]?.args ?? "(nao existe)"}`,
    );

    const corpo = await client.query(`
      SELECT pg_get_functiondef(p.oid) AS def
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = 'create_marketplace_order_v24'
    `);
    conferir(
      "v24 carimba payment_status aguardando",
      corpo.rows[0].def.includes("'aguardando'"),
    );
    conferir(
      "v24 carimba expiracao de 30 minutos",
      corpo.rows[0].def.includes("interval '30 minutes'"),
    );
```

- [ ] **Step 4: Aplicar e provar**

```bash
node scripts/db-apply.cjs 20260807000000_reserva_com_expiracao.sql
```

```bash
node scripts/db-prove-checkout-010.cjs
```

Esperado: `11 passaram, 0 falharam.`

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260807000000_reserva_com_expiracao.sql scripts/db-prove-checkout-010.cjs
git commit -m "feat(db): create_marketplace_order_v24 carimba prazo de pagamento (CHECKOUT-010)"
```

---

### Task 4: Agendar a varredura no pg_cron

**Files:**
- Create: `supabase/migrations/20260807000001_agenda_expiracao.sql`

**Interfaces:**
- Consumes: `expirar_pedidos_vencidos()` da Task 2.

> `pg_cron` **não está instalado** neste banco — só `pg_net` v0.19.5, medido em 06/08/2026. Se o `CREATE EXTENSION` falhar por permissão, ligue pelo painel do Supabase (Database → Extensions → `pg_cron`) e reaplique.

- [ ] **Step 1: Escrever a migration**

```sql
-- Agendamento da expiracao (CHECKOUT-010 #109). SEM BEGIN/COMMIT.
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Remove agendamento anterior de mesmo nome, para a migration ser reaplicavel.
SELECT cron.unschedule('expirar-pedidos-vencidos')
WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'expirar-pedidos-vencidos'
);

SELECT cron.schedule(
  'expirar-pedidos-vencidos',
  '*/5 * * * *',
  $cron$ SELECT public.expirar_pedidos_vencidos(); $cron$
);
```

Cinco minutos, e não um: a janela é de 30 minutos, então até 5 minutos de atraso na devolução é irrelevante para o cliente — e reduz em 5× o número de execuções sobre a tabela de pedidos.

- [ ] **Step 2: Aplicar**

```bash
node scripts/db-apply.cjs 20260807000001_agenda_expiracao.sql
```

- [ ] **Step 3: Confirmar que o agendamento existe**

```bash
node -e "const{Client}=require('pg');const fs=require('fs');const l=fs.readFileSync('.env','utf8').split(/\r?\n/).find(x=>x.startsWith('DATABASE_URL='));const c=new Client({connectionString:l.slice(13).replace(/^\"|\"$/g,''),ssl:{rejectUnauthorized:false}});c.connect().then(()=>c.query(\"SELECT jobname, schedule, active FROM cron.job WHERE jobname='expirar-pedidos-vencidos'\")).then(r=>{console.table(r.rows);return c.end()})"
```

Esperado: uma linha, `schedule = */5 * * * *`, `active = true`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260807000001_agenda_expiracao.sql
git commit -m "feat(db): agenda a expiracao de pedidos no pg_cron (CHECKOUT-010)"
```

---

## 🛑 PORTÃO OBRIGATÓRIO — parar aqui

**Decisão do Gabriel em 06/08/2026: a execução PARA depois da Task 4.**

As Tasks 1 a 4 constroem a máquina e não tocam pedido de cliente nenhum. Da Task
5 em diante, muda dado real: 13 pedidos de clientes são cancelados e 33 unidades
voltam ao catálogo.

**Antes de seguir para a Task 5, mostre ao Gabriel:**

```bash
node scripts/db-prove-checkout-010.cjs
```

```bash
node -e "const{Client}=require('pg');const fs=require('fs');const l=fs.readFileSync('.env','utf8').split(/\r?\n/).find(x=>x.startsWith('DATABASE_URL='));const c=new Client({connectionString:l.slice(13).replace(/^\"|\"$/g,''),ssl:{rejectUnauthorized:false}});c.connect().then(()=>c.query(\"SELECT jobname, schedule, active FROM cron.job WHERE jobname='expirar-pedidos-vencidos'\")).then(r=>{console.table(r.rows);return c.end()})"
```

E **esperar aprovação explícita**. Não interprete "continue" genérico como
liberação do backfill — pergunte de novo, citando os 13 pedidos.

---

### Task 5: Backfill dos 13 pedidos abandonados

**Files:**
- Create: `supabase/migrations/20260807000002_backfill_pedidos_abandonados.sql`

> **Esta task mexe em dado real de cliente.** Ela cancela 13 pedidos e devolve 33 unidades ao catálogo — mais do que o catálogo inteiro tem hoje (28). Revise com atenção maior que as anteriores.
>
> Os 2 pedidos pendentes com menos de 30 dias (de 30/07 e 08/07) **não são tocados**: ficam para o Gabriel revisar na mão, como decidido.

- [ ] **Step 1: Conferir o alvo ANTES de escrever, com os números do dia**

```bash
node -e "const{Client}=require('pg');const fs=require('fs');const l=fs.readFileSync('.env','utf8').split(/\r?\n/).find(x=>x.startsWith('DATABASE_URL='));const c=new Client({connectionString:l.slice(13).replace(/^\"|\"$/g,''),ssl:{rejectUnauthorized:false}});c.connect().then(()=>c.query(\"SELECT count(*)::int pedidos, coalesce(sum(i.quantity),0)::int unidades FROM public.marketplace_orders o LEFT JOIN public.marketplace_order_items i ON i.order_id=o.id WHERE o.status='pending' AND o.payment_status IS NULL AND o.created_at < now() - interval '30 days'\")).then(r=>{console.table(r.rows);return c.end()})"
```

Em 06/08/2026 isso dava **13 pedidos / 33 unidades**. **Se os números vierem diferentes, pare** — algo mudou desde o desenho, e o backfill precisa ser reavaliado antes de rodar.

- [ ] **Step 2: Escrever a migration**

```sql
-- Backfill dos pedidos abandonados (CHECKOUT-010 #109). SEM BEGIN/COMMIT.
--
-- Cancela os pedidos pendentes com 30+ dias que nunca tiveram pagamento e
-- devolve o estoque que eles seguravam. Medido em 06/08/2026: 13 pedidos,
-- 33 unidades — contra um catalogo vivo de 28 unidades.
--
-- NAO toca os pendentes com menos de 30 dias: ficam para revisao manual.
-- NAO estorna dinheiro: nenhum desses pedidos foi pago.

DO $backfill$
DECLARE
    v_pedido    RECORD;
    v_unidades  integer := 0;
    v_pedidos   integer := 0;
BEGIN
    FOR v_pedido IN
        SELECT id
        FROM public.marketplace_orders
        WHERE status = 'pending'
          AND payment_status IS NULL
          AND created_at < now() - interval '30 days'
        FOR UPDATE
    LOOP
        v_unidades := v_unidades + public.devolver_estoque(v_pedido.id);

        UPDATE public.marketplace_orders
           SET payment_status = 'expirado',
               status         = 'cancelled',
               updated_at     = now()
         WHERE id = v_pedido.id;

        v_pedidos := v_pedidos + 1;
    END LOOP;

    RAISE NOTICE 'Backfill: % pedidos cancelados, % unidades devolvidas',
                 v_pedidos, v_unidades;
END;
$backfill$;
```

- [ ] **Step 3: Cumprir o § 9 de novo**

Esta migration muda dado de cliente. Refazer os dois passos:

```bash
npx supabase backups list --project-ref cafkrminfnokvgjqtkle
```

```bash
node scripts/db-snapshot-politicas.cjs
```

- [ ] **Step 4: Aplicar**

```bash
node scripts/db-apply.cjs 20260807000002_backfill_pedidos_abandonados.sql
```

Esperado no log: `Backfill: 13 pedidos cancelados, 33 unidades devolvidas`.

- [ ] **Step 5: Conferir o resultado**

```bash
node -e "const{Client}=require('pg');const fs=require('fs');const l=fs.readFileSync('.env','utf8').split(/\r?\n/).find(x=>x.startsWith('DATABASE_URL='));const c=new Client({connectionString:l.slice(13).replace(/^\"|\"$/g,''),ssl:{rejectUnauthorized:false}});c.connect().then(()=>c.query(\"SELECT (SELECT count(*)::int FROM public.marketplace_orders WHERE status='pending') pendentes, (SELECT sum(estoque)::int FROM public.produtos WHERE deleted_at IS NULL) estoque\")).then(r=>{console.table(r.rows);return c.end()})"
```

Esperado: `pendentes = 2` (os dois recentes) e `estoque = 61` (28 + 33).

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260807000002_backfill_pedidos_abandonados.sql
git commit -m "fix(orders): devolve o estoque de 13 pedidos abandonados (CHECKOUT-010)"
```

---

### Task 6: O front passa a chamar a v24

**Files:**
- Modify: `src/hooks/useOrders.ts` (dentro de `createOrder`, a chamada `.rpc(...)`)

**Interfaces:**
- Consumes: `create_marketplace_order_v24` da Task 3.

Sem isso, pedidos novos continuam nascendo pela v23, **sem prazo de expiração** — e a varredura nunca os alcança, porque ela só age sobre `payment_status = 'aguardando'`.

- [ ] **Step 1: Trocar a versão da RPC**

Em `src/hooks/useOrders.ts`, dentro de `createOrder`, trocar:

```ts
      const { data, error } = await (supabase as any).rpc(
        "create_marketplace_order_v23",
```

por:

```ts
      const { data, error } = await (supabase as any).rpc(
        "create_marketplace_order_v24",
```

Os 12 argumentos ficam idênticos — a assinatura não mudou.

- [ ] **Step 2: Atualizar o comentário logo acima, que cita a v22**

Trocar:

```ts
      // 🛡️ SECURITY: Usando a RPC v22 Blindada (Zero-Trust)
```

por:

```ts
      // 🛡️ SECURITY: RPC v24 blindada (Zero-Trust). O backend recalcula o total
      // pelos precos do banco e usa p_total_amount so como checksum.
      // A v24 e a v23 mais o carimbo de payment_status/expires_at: o pedido
      // nasce com 30 minutos de reserva de estoque (CHECKOUT-010, #109).
```

- [ ] **Step 3: Rodar typecheck e a catraca**

```bash
npm run typecheck
```

```bash
npm run lint:ratchet
```

Esperado: `typecheck` exit 0; catraca `ok` em eslint errors e warnings.

- [ ] **Step 4: Confirmar que um pedido novo nasce com prazo**

Com `npm run dev` no ar, fazer um pedido de teste pela loja. Depois:

```bash
node -e "const{Client}=require('pg');const fs=require('fs');const l=fs.readFileSync('.env','utf8').split(/\r?\n/).find(x=>x.startsWith('DATABASE_URL='));const c=new Client({connectionString:l.slice(13).replace(/^\"|\"$/g,''),ssl:{rejectUnauthorized:false}});c.connect().then(()=>c.query(\"SELECT id, payment_status, expires_at, created_at FROM public.marketplace_orders ORDER BY created_at DESC LIMIT 1\")).then(r=>{console.table(r.rows);return c.end()})"
```

Esperado: `payment_status = 'aguardando'` e `expires_at` ≈ `created_at` + 30 min.

> ⚠️ Isso cria pedido **real em produção** — o `npm run dev` aponta para o banco de produção. Depois de conferir, cancele o pedido pelo painel para o estoque voltar.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useOrders.ts
git commit -m "feat(orders): checkout passa a criar pedido com prazo de pagamento (CHECKOUT-010)"
```

---

## Ao fim da Fase 1

Estado esperado, verificável:

| | esperado |
| --- | ---: |
| pedidos em `pending` | 2 (os recentes, para revisão manual) |
| estoque no catálogo | 61 unidades |
| `cron.job` ativo | 1 |
| provas em `db-prove-checkout-010.cjs` | 11 passando |

O vazamento de estoque está fechado, **sem uma linha de Mercado Pago**. A Fase 2 pode começar — ou não começar — sem que este trabalho perca valor.
