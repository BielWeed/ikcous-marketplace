# Cancelamento com estorno — passo 1: a regra, sem mover dinheiro

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Aplicar a regra de cancelamento decidida pelo Gabriel — cliente cancela pedido não enviado ou já enviado, o estoque de produto que saiu só volta quando o produto voltar, e o lojista passa a ter a lista do que precisa estornar.

**Architecture:** A regra mora no **servidor** (`update_order_status_atomic`), não na tela — quem chama a API direto tem de bater na mesma trava. Duas colunas novas em `marketplace_orders` guardam o que o app hoje esquece: se o pedido estava enviado quando foi cancelado, e quando o produto voltou à mão do lojista. A lista de "estorno devido" é **derivada**, não gravada: pedido `cancelled` cujo `payment_status` diz que o dinheiro entrou e ainda não foi estornado.

**Tech Stack:** PostgreSQL (Supabase, plpgsql `SECURITY DEFINER`), React 19 + TypeScript, Vitest (`tests/front/`).

## Global Constraints

- **Migration na faixa `20260970*`–`20260979*`**, reservada por escrito no `_REGRAS.md` do mural antes deste plano existir. Prevista **UMA**.
- **Migration NÃO leva `BEGIN`/`COMMIT`** — com eles o `ROLLBACK` do script de prova vira no-op e a mudança fica gravada mesmo assim.
- **A migration NÃO é aplicada no banco** por nenhuma tarefa deste plano. Aplicar exige prova de `ROLLBACK` rodada e autorização do Gabriel dada na sessão que aplica; aprovação por repasse não vale.
- **Reversão versionada obrigatória**, com `manual-` no nome (`rollback-manual-20260970000000_*.sql`), senão o git a ignora e ela vira exemplar único fora de controle.
- **Árvore compartilhada:** nunca `git stash`, `checkout`, `restore`, `clean` ou `reset`; nunca `git add` seguido de `git commit` (use `git commit -- <caminho>`); **subagente não commita**.
- **Nada de `npm ci`** — apagaria o `node_modules` com servidor de outras sessões rodando.
- **`delivered` está FORA da regra.** O Gabriel falou de enviado e de não enviado. Produto entregue é devolução, outro assunto e outra decisão dele. Nenhuma tarefa aqui trata `delivered`.
- **Este passo não move dinheiro.** Nenhuma chamada à API de estorno do Mercado Pago. Se uma tarefa parecer precisar disso, ela saiu do escopo — pare e devolva.

## File Structure

| Arquivo | Responsabilidade |
|---|---|
| `supabase/migrations/20260970000000_cancelamento_respeita_o_envio.sql` (novo) | as 2 colunas, a nova versão de `update_order_status_atomic`, e a RPC `confirmar_retorno_do_produto` |
| `rollback-manual-20260970000000_cancelamento_respeita_o_envio.sql` (novo) | reversão provada: derruba a RPC nova e restaura o corpo anterior das funções |
| `scripts/db-apply.cjs` | entrada no mapa `VERIFICACOES` para a migration nova — sem ela o script diz "aplicado" sem verificar |
| `src/types/index.ts` | os 2 campos novos em `Order` |
| `src/lib/mappers.ts` | tradução das 2 colunas novas |
| `src/hooks/useOrders.ts` | `validateStatusUpdate` (espelho da regra do servidor) e a chamada da RPC de retorno |
| `src/views/customer/OrderDetailsView.tsx` | quando o botão Cancelar aparece e o que o aviso diz em cada caso |
| `src/views/admin/AdminOrdersView.tsx` | a lista de estorno devido, em dois baldes |

---

### Task 1: A migration — a regra no servidor

**Files:**
- Create: `supabase/migrations/20260970000000_cancelamento_respeita_o_envio.sql`
- Create: `rollback-manual-20260970000000_cancelamento_respeita_o_envio.sql`
- Reference: `supabase/migrations/20260901000000_devolver_uso_de_cupom_ao_desfazer_pedido.sql` (a definição viva de `update_order_status_atomic`, l.279-400)

**Interfaces:**
- Produces: colunas `marketplace_orders.cancelled_after_shipping boolean NOT NULL DEFAULT false` e `marketplace_orders.returned_to_seller_at timestamptz NULL`; RPC `public.confirmar_retorno_do_produto(p_order_id uuid) RETURNS jsonb`; `update_order_status_atomic(p_order_id uuid, p_new_status text, p_notes text DEFAULT NULL, p_silent boolean DEFAULT FALSE) RETURNS jsonb` com a regra nova.

- [ ] **Step 1: Leia a função viva inteira antes de escrever uma linha**

`sed -n '279,400p' supabase/migrations/20260901000000_devolver_uso_de_cupom_ao_desfazer_pedido.sql`

Você vai reescrever essa função por `CREATE OR REPLACE`. **Copie o corpo dela como base** e altere só o que este plano manda. Trecho que hoje decide a regra (l.320-327):

```sql
    IF NOT v_is_admin THEN
        IF p_new_status IS DISTINCT FROM 'cancelled' THEN
            RAISE EXCEPTION 'Operação não permitida: Usuários só podem cancelar seus próprios pedidos.';
        END IF;
        IF v_old_status IS DISTINCT FROM 'pending' THEN
            RAISE EXCEPTION 'Apenas pedidos pendentes podem ser cancelados pelo usuário.';
        END IF;
    END IF;
```

- [ ] **Step 2: Escreva a migration**

Sem `BEGIN`/`COMMIT`. As colunas primeiro:

```sql
ALTER TABLE public.marketplace_orders
  ADD COLUMN IF NOT EXISTS cancelled_after_shipping boolean NOT NULL DEFAULT false;

ALTER TABLE public.marketplace_orders
  ADD COLUMN IF NOT EXISTS returned_to_seller_at timestamptz;

COMMENT ON COLUMN public.marketplace_orders.cancelled_after_shipping IS
  'true quando o pedido foi cancelado ja em status shipping. HISTORICO: nunca volta a false. E o que faz o estorno e o estoque esperarem o produto voltar.';

COMMENT ON COLUMN public.marketplace_orders.returned_to_seller_at IS
  'quando o lojista confirmou que o produto voltou a mao dele. NULL = ainda nao voltou. So a RPC confirmar_retorno_do_produto grava aqui, e e nesse instante que o estoque volta.';
```

A troca da regra, dentro de `update_order_status_atomic`:

```sql
    IF NOT v_is_admin THEN
        IF p_new_status IS DISTINCT FROM 'cancelled' THEN
            RAISE EXCEPTION 'Operação não permitida: Usuários só podem cancelar seus próprios pedidos.';
        END IF;
        -- Regra do Gabriel (24/08/2026): o divisor e' se o produto SAIU, nao se
        -- foi pago. Nao enviado e enviado podem ser cancelados; entregue nao —
        -- produto entregue e' devolucao, que e' outro assunto e outra decisao.
        IF v_old_status NOT IN ('pending', 'processing', 'shipping') THEN
            RAISE EXCEPTION 'Este pedido não pode mais ser cancelado por você.';
        END IF;
    END IF;

    -- Grava o que o app hoje ESQUECE ao cancelar: se o produto ja tinha saido.
    -- Sem isto, depois do cancelamento nao ha como saber se o estorno espera a
    -- mercadoria voltar. Nao existe tabela de historico de status neste banco.
    IF p_new_status = 'cancelled'
       AND v_old_status = 'shipping'
       AND v_old_status IS DISTINCT FROM p_new_status THEN
        UPDATE public.marketplace_orders
           SET cancelled_after_shipping = true
         WHERE id = p_order_id;
    END IF;
```

E a devolução de estoque passa a pular o pedido que saiu. O bloco de hoje começa em `IF p_new_status = 'cancelled' AND v_old_status IS DISTINCT FROM 'cancelled' THEN`; a condição ganha mais um termo:

```sql
    -- STOCK RESTORATION LOGIC
    -- `v_old_status <> 'shipping'`: produto que ja saiu esta FISICAMENTE com o
    -- cliente. Devolver a prateleira aqui faria a loja vender uma peca que nao
    -- tem. O estoque desse caso volta em confirmar_retorno_do_produto.
    IF p_new_status = 'cancelled'
       AND v_old_status IS DISTINCT FROM 'cancelled'
       AND v_old_status IS DISTINCT FROM 'shipping' THEN
```

A RPC do retorno:

```sql
CREATE OR REPLACE FUNCTION public.confirmar_retorno_do_produto(p_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_item RECORD;
    v_cancelled_after_shipping BOOLEAN;
    v_returned_at TIMESTAMPTZ;
BEGIN
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'Não autorizado: só a loja confirma que o produto voltou.';
    END IF;

    SELECT cancelled_after_shipping, returned_to_seller_at
      INTO v_cancelled_after_shipping, v_returned_at
      FROM public.marketplace_orders
     WHERE id = p_order_id
       FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Pedido não encontrado.';
    END IF;

    IF NOT v_cancelled_after_shipping THEN
        RAISE EXCEPTION 'Este pedido não estava enviado quando foi cancelado: não há produto para voltar.';
    END IF;

    -- Idempotencia: sem isto, dois cliques dobram o estoque da loja.
    IF v_returned_at IS NOT NULL THEN
        RETURN jsonb_build_object('ok', true, 'ja_confirmado', true, 'returned_to_seller_at', v_returned_at);
    END IF;

    FOR v_item IN
        SELECT product_id, variant_id, quantity
          FROM public.marketplace_order_items
         WHERE order_id = p_order_id
    LOOP
        IF v_item.variant_id IS NOT NULL THEN
            UPDATE public.product_variants
               SET stock_increment = stock_increment + v_item.quantity
             WHERE id = v_item.variant_id;
        ELSE
            UPDATE public.produtos
               SET estoque = estoque + v_item.quantity
             WHERE id = v_item.product_id;
        END IF;
    END LOOP;

    UPDATE public.marketplace_orders
       SET returned_to_seller_at = now()
     WHERE id = p_order_id;

    RETURN jsonb_build_object('ok', true, 'ja_confirmado', false);
END;
$$;

REVOKE ALL ON FUNCTION public.confirmar_retorno_do_produto(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.confirmar_retorno_do_produto(uuid) TO authenticated;
```

- [ ] **Step 3: Escreva a reversão, e ela é o par obrigatório**

`rollback-manual-20260970000000_cancelamento_respeita_o_envio.sql`:

```sql
DROP FUNCTION IF EXISTS public.confirmar_retorno_do_produto(uuid);
```

e, **abaixo disso, o corpo ANTERIOR de `update_order_status_atomic` copiado inteiro** de `20260901000000` (l.279-400), por `CREATE OR REPLACE`.

🔴 **Copie do arquivo, não escreva de memória.** Uma reversão que restaura corpo *parecido* passa em 23 de 24 asserções e não é reversão — foi exatamente isso que uma prova de frete deste repositório deixou passar.

As colunas **não** são derrubadas pela reversão: `DROP COLUMN` apagaria o histórico de quem já cancelou. Escreva isso como comentário no topo do arquivo, para o próximo leitor não achar que foi esquecimento.

- [ ] **Step 4: Prove a reversão sem gravar nada**

```
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c "BEGIN READ ONLY;" -c "SELECT 1;" -c "ROLLBACK;"
```

Rode a migration e a reversão dentro de uma transação que termina em `ROLLBACK`, e mostre que o corpo de `update_order_status_atomic` volta **caractere a caractere** ao original (`pg_get_functiondef` antes x depois, com igualdade, não com `LIKE`). Cole as duas saídas.

- [ ] **Step 5: Verificação**

```
grep -cE "^\s*(BEGIN|COMMIT)\s*;" supabase/migrations/20260970000000_cancelamento_respeita_o_envio.sql
grep -cE "^\s*(BEGIN|COMMIT)\s*;" rollback-manual-20260970000000_cancelamento_respeita_o_envio.sql
```

Esperado: **0** nos dois.

- [ ] **Step 6: NÃO aplique, NÃO commite**

Deixe os dois arquivos no working tree e relate. Aplicar exige autorização do Gabriel na sessão que aplica.

---

### Task 2: O `db-apply` sabe verificar esta migration

**Files:**
- Modify: `scripts/db-apply.cjs` (só a entrada nova no mapa `VERIFICACOES`)

**Interfaces:**
- Consumes: os nomes de objeto criados na Task 1 (`cancelled_after_shipping`, `returned_to_seller_at`, `confirmar_retorno_do_produto`).

- [ ] **Step 1: Leia como as entradas vizinhas são escritas**

`grep -n -A20 "const VERIFICACOES" scripts/db-apply.cjs`

- [ ] **Step 2: Acrescente a entrada, no mesmo formato**

Ela tem de conferir, no banco: que as **duas colunas** existem em `marketplace_orders`, que `confirmar_retorno_do_produto` existe, e que `update_order_status_atomic` contém a nova regra (`NOT IN ('pending', 'processing', 'shipping')`).

🔴 **Entrada que nunca reprova é PIOR que entrada ausente:** a saída passaria a dizer "verificado". Prove por sabotagem — derrube **um marcador por vez** e mostre que cada um acusa. Se algum não acusar, ele é decorativo e o defeito é seu.

- [ ] **Step 3: Verificação**

`node scripts/db-apply.cjs --dry-run` (ou o modo de listagem que o script tiver — leia o cabeçalho dele). **Não aplique nada.**

- [ ] **Step 4: NÃO commite.** Arquivo compartilhado; a sessão principal integra.

---

### Task 3: Os dois campos chegam ao app

**Files:**
- Modify: `src/types/index.ts` (interface `Order`, perto de `trackingCode?: string;`)
- Modify: `src/lib/mappers.ts:250-254` (dentro de `mapOrderFromDB`, que começa em `:190`)
- Test: `tests/front/pedido-carrega-o-estado-do-retorno.test.ts` (novo)

**Interfaces:**
- Produces: `Order.cancelledAfterShipping: boolean` e `Order.returnedToSellerAt?: string | null`.

- [ ] **Step 1: Escreva o teste que falha**

A função do mapper chama-se **`mapOrderFromDB`** (`src/lib/mappers.ts:190`) — conferido no disco, não suposto. Para a linha de base do objeto de entrada (os campos que ela já exige), **copie de `tests/front/mappers.test.ts`**, que já monta uma linha de pedido válida; não invente o formato.

```ts
import { describe, expect, it } from "vitest";
import { mapOrderFromDB } from "@/lib/mappers";

describe("mapper do pedido — o estado do retorno do produto", () => {
  it("traz cancelled_after_shipping e returned_to_seller_at para o app", () => {
    const pedido = mapOrderFromDB({
      ...linhaDePedidoValida, // da base copiada de tests/front/mappers.test.ts
      cancelled_after_shipping: true,
      returned_to_seller_at: "2026-08-25T10:00:00Z",
    } as never);

    expect(pedido.cancelledAfterShipping).toBe(true);
    expect(pedido.returnedToSellerAt).toBe("2026-08-25T10:00:00Z");
  });

  it("pedido antigo, com as colunas ausentes, NAO vira 'já voltou'", () => {
    const pedido = mapOrderFromDB({ ...linhaDePedidoValida } as never);
    // O default do banco e false; o mapper nao pode inventar true.
    expect(pedido.cancelledAfterShipping).toBe(false);
    expect(pedido.returnedToSellerAt ?? null).toBeNull();
  });
});
```

🔴 O segundo teste é o que importa: **o zero que quer dizer "não sei" não pode virar "já resolvido"**. Um pedido antigo sem a coluna tem de cair no lado seguro.

- [ ] **Step 2: Rode e confirme que falha** — `npx vitest run tests/front/pedido-carrega-o-estado-do-retorno.test.ts`. Esperado: falha por propriedade inexistente.

- [ ] **Step 3: Implemente**

Em `src/types/index.ts`, dentro de `interface Order`, depois de `trackingCode?: string;`:

```ts
  /** true quando o pedido já estava enviado no momento do cancelamento. */
  cancelledAfterShipping: boolean;
  /** quando o lojista confirmou que o produto voltou. null = ainda não voltou. */
  returnedToSellerAt?: string | null;
```

Em `src/lib/mappers.ts`, junto de `trackingCode`:

```ts
    cancelledAfterShipping: row.cancelled_after_shipping === true,
    returnedToSellerAt: row.returned_to_seller_at ?? null,
```

- [ ] **Step 4: Rode e confirme verde.**

- [ ] **Step 5: Prove o dente** — troque `=== true` por `!== false` e mostre que o segundo teste fica **vermelho**. Restaure.

- [ ] **Step 6: Verificação** — `npm run typecheck` e o arquivo de teste. **Não commite.**

---

### Task 4: A tela do cliente segue a regra

**Files:**
- Modify: `src/hooks/useOrders.ts:18-37` (`validateStatusUpdate`)
- Modify: `src/views/customer/OrderDetailsView.tsx:179-205` (`handleCancelOrder`) e o botão em `:569`
- Test: `tests/front/cliente-cancela-conforme-o-envio.test.tsx` (novo)

**Interfaces:**
- Consumes: `Order.cancelledAfterShipping` (Task 3).

- [ ] **Step 1: Escreva o teste que falha**

Três casos, cada um com asserção própria:

```tsx
it("pedido em preparação: o botão Cancelar APARECE", async () => { /* status 'processing' */ });
it("pedido já enviado: o botão aparece E o aviso fala do produto voltar", async () => {
  // status 'shipping' + paymentStatus 'pago'
  // o texto do confirm tem de dizer que o dinheiro volta DEPOIS que o produto voltar
});
it("pedido entregue: o botão NÃO aparece", async () => { /* status 'delivered' */ });
```

- [ ] **Step 2: Rode e confirme que falha pelo motivo certo** (hoje o botão só aparece em `pending`).

- [ ] **Step 3: Implemente a regra no cliente, espelhando o servidor**

```ts
    if (order && !["pending", "processing", "shipping"].includes(order.status)) {
      const errorMsg = "Este pedido não pode mais ser cancelado";
      if (!silent) toast.error(errorMsg);
      throw new Error(errorMsg);
    }
```

E o aviso passa a ter **três** caminhos, não dois. Enviado e pago:

> "Este pedido já foi enviado. Se cancelar, você precisa devolver o produto à loja — o dinheiro volta **depois** que ele chegar de volta. Tem certeza?"

Não enviado e pago: o texto de hoje continua valendo (o dinheiro não volta sozinho, fale com a loja).
Não pago: o texto genérico de hoje.

🔴 **Não apague o aviso de "o dinheiro não volta automaticamente" enquanto o estorno automático não existir.** Ele é verdadeiro hoje, e prometer o que o sistema não cumpre é exatamente o defeito que esta linha de trabalho vem corrigindo.

- [ ] **Step 4: Rode e confirme verde.**

- [ ] **Step 5: Prove o dente** — sabotagem um caso por vez (3 rodadas), cada uma derrubando **só** o teste do seu caso.

- [ ] **Step 6: Verificação** — `npm run typecheck` + os testes novos. **Não commite.**

---

### Task 5: O lojista vê o que precisa estornar

**Files:**
- Modify: `src/views/admin/AdminOrdersView.tsx`
- Modify: `src/hooks/useOrders.ts` (só a função que chama `confirmar_retorno_do_produto`)
- Test: `tests/front/painel-lista-estorno-devido.test.tsx` (novo)

**Interfaces:**
- Consumes: `Order.cancelledAfterShipping`, `Order.returnedToSellerAt` (Task 3); RPC `confirmar_retorno_do_produto` (Task 1).

- [ ] **Step 1: Escreva o teste que falha**

A lista é **derivada**, não gravada. Um pedido entra nela quando: `status === "cancelled"` **e** o pagamento entrou (`paymentStatus` é `"pago"` ou `"pago_apos_expirar"`). Dois baldes:

- **Devolver agora** — `cancelledAfterShipping === false`
- **Esperando o produto voltar** — `cancelledAfterShipping === true && !returnedToSellerAt`

```tsx
it("pedido cancelado e pago, não enviado: cai em 'Devolver agora'", async () => {});
it("pedido cancelado e pago, enviado e sem retorno: cai em 'Esperando o produto voltar'", async () => {});
it("pedido cancelado e pago, enviado, com retorno confirmado: cai em 'Devolver agora'", async () => {});
it("pedido cancelado com pagamento 'estornado': NÃO aparece em lugar nenhum", async () => {});
it("pedido cancelado que nunca foi pago: NÃO aparece em lugar nenhum", async () => {});
```

🔴 Os dois últimos são os que impedem a lista de virar ruído — e o `estornado` é o que faz o item **sair** da lista sozinho quando o Gabriel devolve o dinheiro pelo painel do Mercado Pago.

- [ ] **Step 2: Rode e confirme que falha.**

- [ ] **Step 3: Implemente**

A derivação em função pura, testável sem tela:

```ts
export type BaldeDeEstorno = "devolver_agora" | "esperando_o_produto" | null;

export function baldeDeEstorno(pedido: Order): BaldeDeEstorno {
  if (pedido.status !== "cancelled") return null;
  const entrou =
    pedido.paymentStatus === "pago" || pedido.paymentStatus === "pago_apos_expirar";
  if (!entrou) return null;
  if (pedido.cancelledAfterShipping && !pedido.returnedToSellerAt) {
    return "esperando_o_produto";
  }
  return "devolver_agora";
}
```

E o botão **"O produto voltou"**, que só aparece no balde `esperando_o_produto`, chamando a RPC.

- [ ] **Step 4: Rode e confirme verde.**

- [ ] **Step 5: Prove o dente** — 5 sabotagens, uma por caso.

- [ ] **Step 6: Verificação** — `npm run typecheck` + os testes novos. **Não commite.**

---

### Task 6: Conferir o conjunto (`diretor`)

**Files:** nenhum — é leitura.

- [ ] **Step 1: A sessão principal despacha o `diretor`** com: o pedido original nas palavras do Gabriel, esta lista de tarefas, e onde está o resultado.

Perguntas que só ele faz: o conjunto ainda é a regra que o Gabriel decidiu? As peças se encaixam (servidor, tela do cliente, painel)? A verificação teve lastro? **Vale continuar gastando?**

🔴 Esta tarefa nasce escrita junto com as outras, e não lembrada no fim — é a trava contra "cada peça passou e o todo deixou de ser o pedido".

---

## O que este plano deliberadamente NÃO faz

- **Não move dinheiro.** Nenhuma chamada à API de estorno do Mercado Pago. Isso é o passo 2, com pesquisa na fonte oficial e revisão Opus própria.
- **Não trata `delivered`.** Fora da regra que o Gabriel deu.
- **Não aplica a migration no banco.** Precisa da prova de `ROLLBACK` e da autorização dele na sessão que aplica.
- **Não mexe no webhook do Mercado Pago.** `payment_status = 'estornado'` continua chegando de fora, e é ele que tira o pedido da lista.
