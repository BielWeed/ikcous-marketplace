# Recebimento na entrega — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** O lojista passa a registrar, pela tela, que recebeu um pagamento na entrega — e a receita do painel para de contar como recebido o dinheiro que nunca entrou.

**Architecture:** Duas migrations separadas por natureza. A primeira é **aditiva** (duas colunas, uma tabela de histórico, uma RPC) e não nega nada a ninguém. A segunda **recusa**: tira o `payment_status IS NULL` de 12 pontos em 3 funções, e é ela que faz o número cair. O front lê os campos novos pelo mapper e oferece um botão no cartão do pedido.

**Tech Stack:** Postgres/Supabase (plpgsql, `SECURITY DEFINER`, RLS), React 19 + TypeScript, Vitest (`tests/front/`), Deno (`tests/`).

**Spec:** [`docs/superpowers/specs/2026-08-27-recebimento-na-entrega-design.md`](../specs/2026-08-27-recebimento-na-entrega-design.md)

## Global Constraints

- **Árvore de trabalho COMPARTILHADA por várias sessões.** Nunca `git stash`, `git checkout`, `git restore`, `git clean`, `git reset`. Para comparar com o original: `git show HEAD:<caminho>`.
- **Nunca `git add` seguido de `git commit`.** O índice do git também é compartilhado. Use `git commit -- <caminho> [<caminho>…]`. Arquivo novo: `git add -- "<caminho exato>"` e em seguida `git commit -- "<mesmo caminho exato>"`, nunca `git add .`.
- **Migration NÃO leva `BEGIN`/`COMMIT`.** Com eles o `ROLLBACK` do script de prova vira no-op e a mudança grava mesmo assim.
- **Toda migration tem um `rollback-manual-<nome>.sql` na raiz do repositório.** O `.gitignore` ignora `rollback-*.sql` e abre exceção só para `!rollback-manual-*.sql`.
- **Toda migration tem entrada no mapa `VERIFICACOES` de `scripts/db-apply.cjs`.** Sem ela o `db-apply` devolve `PULADA` com saída 2 — que não é sucesso nem falha, é "ninguém conferiu".
- **NINGUÉM APLICA MIGRATION.** Nenhuma tarefa deste plano roda `db-apply.cjs` sem `--dry-run`, `supabase db push`, nem escreve no banco. Quem aplica é a sessão principal, com autorização do Gabriel. `--dry-run` **não é inerte**: ele escreve arquivo e sobrescreve o que estiver no caminho.
- **Faixa de migration reservada por esta frente: `20261020000000` e `20261021000000`.** Conferido livre em 27/08/2026 (a maior no disco é `20261012000000`).
- 🔴 **`payment_status` TEM guarda no banco, e ela recusa o valor novo.** A versão anterior desta linha dizia "texto livre, não enum, não há guarda" — **era falsa, e foi afirmada sem medir**. Medido em 27/08/2026, no banco vivo:

  ```
  marketplace_orders_payment_status_check
    CHECK (payment_status IS NULL OR payment_status = ANY
      (ARRAY['aguardando','pago','recusado','expirado','estornado','pago_apos_expirar']))

  UPDATE ... SET payment_status='recebido_na_entrega'  -> RECUSADO (violates check constraint)
  CONTROLE POSITIVO: mesmo UPDATE com 'pago'           -> ACEITO (o instrumento discrimina)
  ```

  A constraint nasceu em `supabase/migrations/20260807000000_reserva_com_expiracao.sql`. **Sem alargá-la, a funcionalidade não funciona uma única vez** — e nada acusa: o `db-apply` confere marcadores dentro do corpo da função, todos casam, a migration aplica limpa e a verificação sai "verificada". A falha só aparece no primeiro clique do lojista.

- **O tipo `PaymentStatus` (`src/types/index.ts:135-141`) é o espelho dessa constraint**, e o comentário dele diz isso por escrito: *"Mudar aqui sem mudar lá (ou o contrário) é como o pedido fica com estado que o banco recusa."* Os dois lados mudam juntos, nesta ordem: banco na Task 1, tipo na Task 3.
- **Vocabulário fixo:** `payment_method` é `"pix" | "card" | "cash" | "online"` (`src/types/index.ts:128`). `online` = pago pelo site (Mercado Pago); os outros três = na entrega.
- **Valor novo de `payment_status`: exatamente a string `recebido_na_entrega`.** Os já existentes: `pago`, `pago_apos_expirar`, `expirado`, e `NULL`.
- **Verificação:** diff que toca `src/` ou `tests/` pede os sete comandos do CI (`npm ci`, `npm run typecheck`, `npm test`, `npm run build`, `npm run lint:links`, `npm run lint:ratchet`, `npm run size`). Diff que toca só `supabase/migrations/`, `scripts/` ou documentação: rode `npm test` e `npm run lint:ratchet`, e **não** rode o resto — a sessão principal roda o que faltar.
- **Teto do lint:** `.lint-baseline.json` manda. Warning novo reprova igual a erro novo.

## A ordem de subida — e por que ela NÃO é "tela antes do banco"

A regra geral do repositório é publicar a tela antes do banco, porque tela nova com banco velho funciona e banco novo com tela velha quebra. **Aqui ela se aplica só à metade que recusa.**

| # | passo | por quê |
|---|---|---|
| 1 | aplicar `20261020000000` (aditiva) | só acrescenta coluna, tabela e função. Não nega nada, não muda nenhum número, e nada na tela depende dela ainda |
| 2 | publicar o front em produção | o botão já encontra a RPC existindo. Se subisse antes do passo 1, o primeiro clique daria erro |
| 3 | aplicar `20261021000000` (a regra) | é ela que faz a receita cair. Só depois de o lojista ter como marcar recebimento |

**Se os passos 2 e 3 forem invertidos**, existe uma janela em que a receita já caiu e o lojista não tem botão para registrar o que recebeu — o mesmo defeito que a migration do estorno abriu em 27/08/2026.

---

### Task 1: Migration aditiva — colunas, histórico e a RPC

**Files:**
- Create: `supabase/migrations/20261020000000_lojista_registra_pagamento_recebido.sql`
- Create: `rollback-manual-20261020000000_lojista_registra_pagamento_recebido.sql`
- Modify: `scripts/db-apply.cjs` (acrescentar entrada no mapa `VERIFICACOES`)
- Test: `tests/migration_lojista_registra_pagamento_recebido_test.ts`

**Interfaces:**
- Consumes: nada de tarefa anterior.
- Produces:
  - colunas `public.marketplace_orders.pagamento_recebido_em timestamptz` e `public.marketplace_orders.pagamento_recebido_por uuid`
  - tabela `public.marketplace_order_payment_history`
  - `public.registrar_pagamento_recebido(p_order_id uuid, p_recebido boolean) RETURNS jsonb`, `SECURITY DEFINER`, com `GRANT EXECUTE` para `authenticated`
  - o jsonb devolvido tem as chaves: `order_id`, `payment_status`, `pagamento_recebido_em`, `pagamento_recebido_por`, `ja_estava` (boolean)
  - a string de status nova: `recebido_na_entrega`

- [ ] **Step 1: Escrever o teste de forma (que roda no CI, sem banco)**

Este teste é a **única** rede: nenhuma das sete verificações do CI olha SQL. Ele segue o padrão de `tests/migration_vitrine_sabe_que_produto_mudou_test.ts` e reusa o detector de transação de `scripts/db-prove-rollback.cjs` em vez de escrever um regex novo (aquele detector já passou por rodadas de mutação contra comentário, string, dollar-quote e `CASE … END`).

Criar `tests/migration_lojista_registra_pagamento_recebido_test.ts`:

```ts
// @ts-nocheck
import { createRequire } from "node:module";
import { fromFileUrl } from "https://deno.land/std@0.177.0/path/mod.ts";
import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.177.0/testing/asserts.ts";

const require = createRequire(import.meta.url);
const { avaliarFase0 } = require("../scripts/db-prove-rollback.cjs");

const DIR = fromFileUrl(new URL(".", import.meta.url));
const NOME = "20261020000000_lojista_registra_pagamento_recebido.sql";
const MIGRATION_PATH = `${DIR}../supabase/migrations/${NOME}`;
const ROLLBACK_PATH = `${DIR}../rollback-manual-${NOME}`;
const DB_APPLY_PATH = `${DIR}../scripts/db-apply.cjs`;

const migration = Deno.readTextFileSync(MIGRATION_PATH);
const rollback = Deno.readTextFileSync(ROLLBACK_PATH);
const dbApply = Deno.readTextFileSync(DB_APPLY_PATH);

// `avaliarFase0` avalia o PAR de uma vez — assinatura conferida no codigo real
// (scripts/db-prove-rollback.cjs:308) e no arquivo-molde
// (tests/migration_vitrine_sabe_que_produto_mudou_test.ts:99). Ela recebe UM
// OBJETO NOMEADO e devolve `{ recusado, motivos }` — nao `{ recusas }`, e nao
// aceita a string solta. Alem de BEGIN/COMMIT escondido, ela ja recusa
// `CREATE FUNCTION` sem `OR REPLACE` nos DOIS arquivos, entao nao existe teste
// separado para isso: seria assercao mais fraca que a que ja esta aqui.
Deno.test("avaliarFase0 nao recusa o par migration+rollback", () => {
  const r = avaliarFase0({
    sqlMigration: migration,
    sqlRollback: rollback,
    temRollback: true,
  });
  assertEquals(r.recusado, false, `motivos: ${(r.motivos || []).join("; ")}`);
});

// 🔴 Toda assercao de guarda daqui para baixo e' BLOCO AMARRADO: a condicao E a
// consequencia, na mesma string. Marcador solto afere que a LINHA existe, nao que
// ela FAZ algo — medido: mantendo `IF NOT public.is_admin() THEN` no lugar e
// trocando so' o `RAISE` por `NULL;`, a guarda vira no-op, qualquer cliente logado
// marca qualquer pedido como pago, e a bateria inteira continua VERDE.
// `norm` existe para a assercao nao depender de indentacao.
const norm = (s) => s.replace(/\s+/g, " ").trim();
const migrationN = norm(migration);
const rollbackN = norm(rollback);

Deno.test("a migration alarga a CHECK constraint para aceitar o valor novo", () => {
  // Sem isto a funcionalidade nao funciona UMA vez: a constraint de
  // 20260807000000 tem seis valores e recusa o setimo. Medido em 27/08/2026.
  assertStringIncludes(
    migrationN,
    norm("DROP CONSTRAINT IF EXISTS marketplace_orders_payment_status_check"),
  );
  assertStringIncludes(migrationN, norm("'recebido_na_entrega'::text"));
  // ADITIVA: os seis originais continuam todos la.
  for (const v of [
    "aguardando",
    "pago",
    "recusado",
    "expirado",
    "estornado",
    "pago_apos_expirar",
  ]) {
    assertStringIncludes(migrationN, norm(`'${v}'::text`));
  }
});

Deno.test("a migration cria as duas colunas e a tabela de historico", () => {
  assertStringIncludes(migrationN, norm("ADD COLUMN IF NOT EXISTS pagamento_recebido_em timestamptz"));
  assertStringIncludes(migrationN, norm("ADD COLUMN IF NOT EXISTS pagamento_recebido_por uuid"));
  assertStringIncludes(migrationN, norm("CREATE TABLE IF NOT EXISTS public.marketplace_order_payment_history"));
});

Deno.test("as QUATRO recusas da RPC sao blocos amarrados, nao linhas soltas", () => {
  assertStringIncludes(
    migrationN,
    norm(`IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'Não autorizado: só a loja registra pagamento recebido.';`),
  );
  assertStringIncludes(
    migrationN,
    norm(`IF v_status = 'cancelled' THEN
        RAISE EXCEPTION 'Pedido cancelado não recebe pagamento.';`),
  );
  assertStringIncludes(
    migrationN,
    norm(`IF v_payment_method = 'online' THEN
        RAISE EXCEPTION 'Este pedido é pago pelo site:`),
  );
  // A palavra do lojista NAO sobrescreve a do gateway.
  assertStringIncludes(
    migrationN,
    norm(`ELSIF v_payment_status IS NOT NULL THEN
            RAISE EXCEPTION 'Este pedido já tem pagamento registrado`),
  );
});

Deno.test("os tres pontos que o plano chama de 'a correcao em si' tem assercao", () => {
  // 1. FOR UPDATE: dois cliques simultaneos nao gravam duas linhas de historico.
  assertStringIncludes(migrationN, norm("WHERE id = p_order_id FOR UPDATE;"));
  // 2. O UPDATE grava o valor NOVO — amarrado a atribuicao que o define, porque a
  //    string 'recebido_na_entrega' aparece em 3 lugares do arquivo e so' UMA
  //    decide o que e' gravado.
  assertStringIncludes(
    migrationN,
    norm(`v_depois := 'recebido_na_entrega';
            UPDATE public.marketplace_orders
               SET payment_status = v_depois,`),
  );
  // 3. Segundo clique nao gera linha de historico fantasma.
  assertStringIncludes(
    migrationN,
    norm(`IF NOT v_ja_estava THEN
        INSERT INTO public.marketplace_order_payment_history`),
  );
});

Deno.test("a RPC nasce SECURITY DEFINER, sem privilegio para anon", () => {
  assertStringIncludes(migrationN, norm("CREATE OR REPLACE FUNCTION public.registrar_pagamento_recebido"));
  assertStringIncludes(migrationN, norm("SECURITY DEFINER"));
  assertStringIncludes(migrationN, norm("SET search_path = public"));
  // Funcao nova nasce com EXECUTE para `anon` por default deste banco
  // (pg_default_acl) — o REVOKE e' o que desfaz isso, e sem assercao ninguem nota
  // se ele sumir.
  assertStringIncludes(
    migrationN,
    norm("REVOKE ALL ON FUNCTION public.registrar_pagamento_recebido(uuid, boolean) FROM anon"),
  );
  assertStringIncludes(
    migrationN,
    norm("GRANT EXECUTE ON FUNCTION public.registrar_pagamento_recebido(uuid, boolean) TO authenticated"),
  );
});

Deno.test("o rollback derruba TUDO que a migration cria — os QUATRO objetos", () => {
  assertStringIncludes(rollbackN, norm("DROP FUNCTION IF EXISTS public.registrar_pagamento_recebido(uuid, boolean)"));
  assertStringIncludes(rollbackN, norm("DROP TABLE IF EXISTS public.marketplace_order_payment_history"));
  // As duas colunas: apagar estas duas linhas do rollback deixava a bateria verde.
  assertStringIncludes(rollbackN, norm("DROP COLUMN IF EXISTS pagamento_recebido_em"));
  assertStringIncludes(rollbackN, norm("DROP COLUMN IF EXISTS pagamento_recebido_por"));
});

// A lista da constraint restaurada, extraida do ARRAY[...] em vez de procurada
// no arquivo inteiro. Contar ocorrencia no arquivo todo foi medido furado nos
// DOIS sentidos: exigindo `::text`, um setimo valor sem o cast entrava na
// constraint e passava verde (e o Postgres aceita o literal nu num text[]);
// sem exigir, o texto do portao derrubava o teste a toa.
function listaDaConstraintRestaurada(sql) {
  const m = sql.match(
    /ADD CONSTRAINT marketplace_orders_payment_status_check[\s\S]*?ARRAY\s*\[([\s\S]*?)\]/,
  );
  if (!m) return null;
  // `[^']+` e nao `[a-z_]+`: com a classe estreita, um setimo valor como
  // 'recebido_na_entrega2' ou 'PIX' NAO casava e sumia em silencio da lista
  // comparada — medido passando verde. Descartar em silencio e' o modo de
  // falha que nao levanta suspeita.
  return (m[1].match(/'([^']+)'/g) || []).map((x) => x.slice(1, -1));
}

Deno.test("o rollback restaura a constraint com EXATAMENTE os seis originais", () => {
  const lista = listaDaConstraintRestaurada(rollback);
  assert(lista !== null, "nao achei o ARRAY da constraint no rollback");
  assertEquals(
    lista,
    [
      "aguardando",
      "pago",
      "recusado",
      "expirado",
      "estornado",
      "pago_apos_expirar",
    ],
    `a constraint restaurada tem de ter os seis originais, na ordem, e nada mais — achei: ${JSON.stringify(lista)}`,
  );
});

Deno.test("a reversao inteira e' UM bloco atomico, com o portao dentro", () => {
  // 🔴 Bloco DO e' UM comando, logo UMA transacao: ou reverte inteiro ou nada.
  // Sem isso, portao / DROP CONSTRAINT / ADD CONSTRAINT sao tres comandos com
  // confirmacao propria, e uma falha no meio deixa a marketplace_orders SEM
  // TRAVA em payment_status. Medido: com a versao em tres comandos, bastava o
  // portao cair entre o DROP e o ADD — ou alguem clicar "recebi" no painel
  // nesse intervalo — para a guarda viva desde 20260807000000 sumir.
  // Conta so' nas linhas de CODIGO. Sem isto, citar o literal num comentario
  // do cabecalho derruba o teste a toa — e o conserto tentador de quem tropecar
  // nisso e' AFROUXAR a assercao, que e' o pior desfecho possivel.
  // (Medido: `removerRuido` de db-prove-rollback.cjs NAO serve aqui — ele trata
  //  `$$ ... $$` como string e apaga o bloco inteiro, entao dois blocos reais
  //  contam ZERO. Filtrar linha de comentario e' o que funciona: conferido com
  //  controle positivo, dois blocos -> 2, e negativo, so' prosa -> 0.)
  const codigo = rollback
    .split("\n")
    .filter((l) => !l.trim().startsWith("--"))
    .join("\n");
  assertEquals(
    (codigo.match(/DO \$\$/g) || []).length,
    1,
    "a reversao tem de ser UM bloco atomico so'",
  );
  assertEquals(
    (codigo.match(/END \$\$;/g) || []).length,
    1,
    "a reversao tem de fechar UM bloco atomico so'",
  );

  // O portao existe, e e' bloco amarrado: a condicao E a recusa.
  assertStringIncludes(
    rollbackN,
    norm(`IF EXISTS (
        SELECT 1 FROM public.marketplace_orders
         WHERE payment_status = 'recebido_na_entrega'
    ) THEN
        RAISE EXCEPTION 'Reversao recusada:`),
  );

  // NADA que destroi pode ficar FORA do bloco — e "fora" tem DOIS lados.
  // 🔴 A versao anterior olhava so' o que vinha DEPOIS do `END $$;`. Medido: um
  // `ALTER TABLE ... DROP CONSTRAINT` inserido ANTES do `DO $$` passava verde —
  // e ele e' comando de topo, confirma sozinho, entao o portao aborta so' a si
  // mesmo e a tabela fica SEM TRAVA, com o operador lendo "reversao recusada" e
  // achando que nada aconteceu. Era o mesmo dano, pelo lado que ninguem olhava.
  // Usa `codigo` (sem linhas de comentario) porque o cabecalho cita DROP em prosa.
  const iAbre = codigo.indexOf("DO $$");
  const iFecha = codigo.indexOf("END $$;");
  assert(iAbre > -1 && iFecha > iAbre, "nao achei o bloco atomico no codigo");
  const antesDoBloco = codigo.slice(0, iAbre);
  const depoisDoBloco = codigo.slice(iFecha + "END $$;".length);
  const perigosos = ["DROP ", "ALTER TABLE ", "CREATE ", "TRUNCATE ", "UPDATE ", "DELETE "];
  for (const [onde, trecho] of [["ANTES", antesDoBloco], ["DEPOIS", depoisDoBloco]]) {
    for (const perigoso of perigosos) {
      assertEquals(
        trecho.includes(perigoso),
        false,
        `"${perigoso.trim()}" nao pode aparecer ${onde} do bloco atomico — la ele confirma sozinho`,
      );
    }
  }
});

Deno.test("a tabela nova nasce com RLS ligado e policy so' para admin", () => {
  // 🔴 Tabela nova em `public` NASCE com INSERT/SELECT/UPDATE/DELETE para `anon`
  // por pg_default_acl deste banco (medido), e a chave anonima vai no bundle do
  // front. O RLS e' a UNICA coisa entre ela e essa tabela. Medido: apagar o
  // ENABLE ROW LEVEL SECURITY, ou apagar a policy, deixava a bateria verde.
  assertStringIncludes(
    migrationN,
    norm("ALTER TABLE public.marketplace_order_payment_history ENABLE ROW LEVEL SECURITY"),
  );
  assertStringIncludes(
    migrationN,
    norm(`CREATE POLICY mkt_order_payment_history_select
    ON public.marketplace_order_payment_history
    FOR SELECT
    USING (public.is_admin())`),
  );
  // Nenhuma policy de ESCRITA: quem escreve e' a RPC, que e' SECURITY DEFINER.
  // Uma policy de INSERT/UPDATE/DELETE/ALL aqui abriria a tabela para `anon`.
  //
  // 🔴 REGEX, nao lista de strings. Medido: a versao com quatro literais
  // (`ON public.<tabela> FOR INSERT`) pegava a grafia canonica e PERDIA duas
  // igualmente validas — sem qualificar o schema (`ON <tabela> FOR INSERT`) e
  // com clausula no meio (`ON public.<tabela> AS PERMISSIVE FOR ALL`). Quatro
  // strings literais nao enumeram uma gramatica.
  // Aspas opcionais: `ON "public"."tabela"` e forma valida e existe neste
  // repositorio. Sem isso, a grafia entre aspas escapava — medido verde.
  const policyDeEscrita =
    /ON (?:"?public"?\.)?"?marketplace_order_payment_history"?[^;]*?\bFOR (?:INSERT|UPDATE|DELETE|ALL)\b/;
  assertEquals(
    policyDeEscrita.test(migrationN),
    false,
    "a tabela de historico nao pode ter policy de escrita: quem escreve e' a RPC",
  );
});

Deno.test("a entrada em VERIFICACOES existe e nomeia a funcao", () => {
  assertStringIncludes(dbApply, `"${NOME}"`);
  const i = dbApply.indexOf(`"${NOME}"`);
  assert(i > -1);
  const trecho = dbApply.slice(i, i + 1200);
  assertStringIncludes(trecho, "registrar_pagamento_recebido");
});
```

- [ ] **Step 2: Rodar o teste e confirmar que ele FALHA**

Run: `deno test --allow-all --no-check tests/migration_lojista_registra_pagamento_recebido_test.ts`
Expected: FAIL — `No such file or directory` na leitura da migration, que ainda não existe.

- [ ] **Step 3: Escrever a migration**

Criar `supabase/migrations/20261020000000_lojista_registra_pagamento_recebido.sql`.

Cabeçalho obrigatório, em comentário: o que a migration faz, que ela é **aditiva** (não nega nada), e a linha `-- Sem BEGIN/COMMIT de proposito: com eles o ROLLBACK do script de prova vira no-op.`

Conteúdo, nesta ordem:

0. 🔴 **Alargar a CHECK constraint — sem isto nada mais aqui funciona.** Vem primeiro no arquivo, antes das colunas, porque é a guarda que recusa o valor que a RPC grava:

```sql
-- A constraint nasceu em 20260807000000_reserva_com_expiracao.sql com seis
-- valores. O setimo entra aqui, junto da funcionalidade que o usa. Medido em
-- 27/08/2026: sem esta linha, o UPDATE da RPC morre com
-- "violates check constraint marketplace_orders_payment_status_check" no
-- PRIMEIRO clique do lojista -- e nada acusa antes disso, porque a verificacao
-- do db-apply confere marcadores DENTRO do corpo da funcao, e todos casam.
ALTER TABLE public.marketplace_orders
  DROP CONSTRAINT IF EXISTS marketplace_orders_payment_status_check;

ALTER TABLE public.marketplace_orders
  ADD CONSTRAINT marketplace_orders_payment_status_check
  CHECK (
    payment_status IS NULL
    OR payment_status = ANY (ARRAY[
      'aguardando'::text,
      'pago'::text,
      'recusado'::text,
      'expirado'::text,
      'estornado'::text,
      'pago_apos_expirar'::text,
      'recebido_na_entrega'::text
    ])
  );
```

⚠️ **Isto continua sendo ADITIVO:** a lista só ganha um valor, nenhum sai. Nenhuma linha existente passa a violar a constraint, e nada que hoje é aceito passa a ser recusado. Se você se pegar removendo um dos seis, parou — leia de novo.

1. As duas colunas:

```sql
ALTER TABLE public.marketplace_orders
  ADD COLUMN IF NOT EXISTS pagamento_recebido_em timestamptz;

ALTER TABLE public.marketplace_orders
  ADD COLUMN IF NOT EXISTS pagamento_recebido_por uuid;
```

Com `COMMENT ON COLUMN` em cada uma dizendo: `NULL = o lojista ainda nao confirmou recebimento` e `qual admin confirmou`.

2. A tabela de histórico — **lista própria, não a `marketplace_order_history`**, que guarda status do PEDIDO (natureza diferente):

```sql
CREATE TABLE IF NOT EXISTS public.marketplace_order_payment_history (
    id                    uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    order_id              uuid NOT NULL REFERENCES public.marketplace_orders(id) ON DELETE CASCADE,
    acao                  text NOT NULL CHECK (acao IN ('recebido', 'desfeito')),
    payment_status_antes  text,
    payment_status_depois text,
    created_by            uuid,
    created_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mkt_order_payment_history_order
    ON public.marketplace_order_payment_history (order_id, created_at DESC);

ALTER TABLE public.marketplace_order_payment_history ENABLE ROW LEVEL SECURITY;
```

E **uma** policy, só de leitura e só para admin. Não criar policy de INSERT/UPDATE/DELETE: quem escreve é a RPC, que é `SECURITY DEFINER` e passa por cima do RLS.

```sql
DROP POLICY IF EXISTS mkt_order_payment_history_select ON public.marketplace_order_payment_history;
CREATE POLICY mkt_order_payment_history_select
    ON public.marketplace_order_payment_history
    FOR SELECT
    USING (public.is_admin());
```

3. A RPC. Contrato exato:

```sql
CREATE OR REPLACE FUNCTION public.registrar_pagamento_recebido(
    p_order_id uuid,
    p_recebido boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_status          TEXT;
    v_payment_status  TEXT;
    v_payment_method  TEXT;
    v_caller          UUID := auth.uid();
    v_antes           TEXT;
    v_depois          TEXT;
    v_ja_estava       BOOLEAN := FALSE;
    v_recebido_em     TIMESTAMPTZ;
    v_recebido_por    UUID;
BEGIN
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'Não autorizado: só a loja registra pagamento recebido.';
    END IF;

    SELECT status, payment_status, payment_method,
           pagamento_recebido_em, pagamento_recebido_por
      INTO v_status, v_payment_status, v_payment_method,
           v_recebido_em, v_recebido_por
      FROM public.marketplace_orders
     WHERE id = p_order_id
     FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Pedido não encontrado.';
    END IF;

    IF v_status = 'cancelled' THEN
        RAISE EXCEPTION 'Pedido cancelado não recebe pagamento.';
    END IF;

    IF v_payment_method = 'online' THEN
        RAISE EXCEPTION 'Este pedido é pago pelo site: quem confirma o pagamento é o gateway, não a loja.';
    END IF;

    v_antes := v_payment_status;

    IF p_recebido THEN
        IF v_payment_status = 'recebido_na_entrega' THEN
            v_ja_estava := TRUE;
            v_depois := v_payment_status;
        ELSIF v_payment_status IS NOT NULL THEN
            RAISE EXCEPTION 'Este pedido já tem pagamento registrado como "%": não dá para marcar recebimento na entrega por cima.', v_payment_status;
        ELSE
            v_depois := 'recebido_na_entrega';
            UPDATE public.marketplace_orders
               SET payment_status = v_depois,
                   pagamento_recebido_em = now(),
                   pagamento_recebido_por = v_caller,
                   updated_at = now()
             WHERE id = p_order_id
             RETURNING pagamento_recebido_em, pagamento_recebido_por
                  INTO v_recebido_em, v_recebido_por;
        END IF;
    ELSE
        IF v_payment_status IS DISTINCT FROM 'recebido_na_entrega' THEN
            v_ja_estava := TRUE;
            v_depois := v_payment_status;
        ELSE
            v_depois := NULL;
            UPDATE public.marketplace_orders
               SET payment_status = NULL,
                   pagamento_recebido_em = NULL,
                   pagamento_recebido_por = NULL,
                   updated_at = now()
             WHERE id = p_order_id;
            v_recebido_em := NULL;
            v_recebido_por := NULL;
        END IF;
    END IF;

    IF NOT v_ja_estava THEN
        INSERT INTO public.marketplace_order_payment_history
            (order_id, acao, payment_status_antes, payment_status_depois, created_by)
        VALUES
            (p_order_id,
             CASE WHEN p_recebido THEN 'recebido' ELSE 'desfeito' END,
             v_antes, v_depois, v_caller);
    END IF;

    RETURN jsonb_build_object(
        'order_id', p_order_id,
        'payment_status', v_depois,
        'pagamento_recebido_em', v_recebido_em,
        'pagamento_recebido_por', v_recebido_por,
        'ja_estava', v_ja_estava
    );
END;
$$;

REVOKE ALL ON FUNCTION public.registrar_pagamento_recebido(uuid, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.registrar_pagamento_recebido(uuid, boolean) FROM anon;
GRANT EXECUTE ON FUNCTION public.registrar_pagamento_recebido(uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.registrar_pagamento_recebido(uuid, boolean) TO service_role;
```

**Três pontos deste corpo que não são estilo, são a correção:**
- `FOR UPDATE` no `SELECT`: dois cliques simultâneos no mesmo pedido não podem gravar duas linhas de histórico.
- O `ELSIF v_payment_status IS NOT NULL THEN RAISE`: impede marcar "recebi na mão" por cima de um `pago` do gateway. Sem ele, a palavra do lojista sobrescreveria a do Mercado Pago em silêncio.
- `IF NOT v_ja_estava` em volta do `INSERT`: segundo clique não gera linha de histórico fantasma.

- [ ] **Step 4: Escrever o rollback manual**

Criar `rollback-manual-20261020000000_lojista_registra_pagamento_recebido.sql`, com o mesmo aviso de `BEGIN`/`COMMIT` no cabeçalho, e:

🔴 **A ORDEM DESTE ARQUIVO É A CORREÇÃO, NÃO ESTILO. Não reordene.**

`db-apply.cjs` aplica **migration** dentro de uma transação (`:1604-1614`, com `ROLLBACK` se falhar), mas **nunca aplica `rollback-manual`** — conferido, zero referências no script. A reversão é rodada à mão, fora de transação, e **cada comando confirma sozinho**. Isso significa que um comando que falha no meio deixa tudo que veio antes já gravado.

A versão anterior deste arquivo punha a constraint por último "para falhar barulhento". Medido: ela falharia **depois** de `DROP FUNCTION`, `DROP TABLE` e os dois `DROP COLUMN` já terem confirmado, e o `DROP CONSTRAINT` também já teria passado — deixando a `marketplace_orders` **sem nenhuma trava em `payment_status`**, a guarda que existe desde `20260807000000` simplesmente sumida, e o histórico que diria quais pedidos causaram a falha já apagado. Barulho no fim não é o mesmo que segurança.

**Recusar antes de destruir** é o que resolve, e é o primeiro bloco do arquivo:

**A reversão inteira vai num bloco `DO $$` único.** Bloco `DO` é **um** comando, e um comando é uma transação — então ou a reversão inteira acontece, ou nada acontece. Isso mata a classe de defeito pela raiz, em vez de guardá-la com uma asserção de ordem que já errou de âncora uma vez.

```sql
DO $$
BEGIN
    -- PORTAO: recusa enquanto a reversao apagaria registro de pagamento.
    -- Dentro do bloco atomico, entao nem o DROP CONSTRAINT chega a acontecer.
    IF EXISTS (
        SELECT 1 FROM public.marketplace_orders
         WHERE payment_status = 'recebido_na_entrega'
    ) THEN
        RAISE EXCEPTION 'Reversao recusada: existem pedidos com pagamento '
            'marcado como recebido na entrega. Reverter apagaria esse '
            'registro. Desmarque-os pelo painel, ou decida explicitamente '
            'descarta-los, antes de rodar este arquivo.';
    END IF;

    -- A constraint volta aos SEIS valores de 20260807000000.
    ALTER TABLE public.marketplace_orders
      DROP CONSTRAINT IF EXISTS marketplace_orders_payment_status_check;

    ALTER TABLE public.marketplace_orders
      ADD CONSTRAINT marketplace_orders_payment_status_check
      CHECK (
        payment_status IS NULL
        OR payment_status = ANY (ARRAY[
          'aguardando'::text,
          'pago'::text,
          'recusado'::text,
          'expirado'::text,
          'estornado'::text,
          'pago_apos_expirar'::text
        ])
      );

    DROP FUNCTION IF EXISTS public.registrar_pagamento_recebido(uuid, boolean);

    DROP TABLE IF EXISTS public.marketplace_order_payment_history;

    ALTER TABLE public.marketplace_orders
      DROP COLUMN IF EXISTS pagamento_recebido_em;
    ALTER TABLE public.marketplace_orders
      DROP COLUMN IF EXISTS pagamento_recebido_por;
END $$;
```

**O que a atomicidade fecha, e que a versão anterior deixava aberto:**

- **A ordem deixa de importar para a segurança.** Antes, portão, `DROP CONSTRAINT` e `ADD CONSTRAINT` eram três comandos com confirmação própria: uma falha entre eles deixava a tabela **sem trava em `payment_status`**. Agora não existe "entre eles".
- **A corrida deixa de existir.** Antes, alguém podia clicar "recebi" no painel **depois** do portão passar e **antes** do `ADD CONSTRAINT` — e o `ADD` falhava com a trava já derrubada. Um comando só não tem essa janela.

✅ **`avaliarFase0` aceita a reversão inteira num `DO $$` — medido em 27/08/2026**, com controle positivo (`BEGIN;`/`COMMIT;` de verdade continua sendo recusado).

⚠️ **A mensagem do portão fala de `payment_status`, e é isso que o predicado olha.** Ela **não** promete nada sobre a tabela de histórico: um pedido marcado e depois desmarcado pelo painel volta a `payment_status = NULL` e **deixa duas linhas** no histórico, que o `DROP TABLE` apaga. Isso é decisão de produto do Gabriel, está anotado, e **não** é para o executor resolver — escreva a mensagem exatamente como está acima, sem prometer mais do que ela detecta.

✅ **`avaliarFase0` aceita o bloco `DO $$ … BEGIN … END $$` — medido em 27/08/2026, não suposto**, com controle positivo na mesma rodada:

```
bloco DO $$ ... BEGIN ... END $$                -> ACEITO
CONTROLE POSITIVO: BEGIN;/COMMIT; de verdade    -> RECUSADO
  ("migration contém controle de transação em nível superior (BEGIN/COMMIT)
    — invalida o ROLLBACK da prova")
```

O detector distingue o `BEGIN` de bloco plpgsql do `BEGIN` de transação. Se mesmo assim ele recusar o seu arquivo, o problema é outro (SQL malformado, dollar-quote desbalanceado) — leia o motivo que ele imprime antes de mexer no desenho.

**No cabeçalho, escrever por que aqui as colunas CAEM** (ao contrário do rollback da `20260970000000`, que deixa as dela de propósito): esta migration é aditiva e nenhum pedido real tem valor nessas colunas no momento em que ela é revertida. Se um dia houver dado gravado ali, este rollback passa a apagar histórico e precisa ser revisto.

- [ ] **Step 5: Acrescentar a entrada no mapa `VERIFICACOES`**

Em `scripts/db-apply.cjs`, seguir o formato da entrada `"20260970000000_cancelamento_respeita_o_envio.sql"` (mapa `nome do arquivo` → array de `{ funcao, esperado: [trechos] }`).

Acrescentar:

```js
  "20261020000000_lojista_registra_pagamento_recebido.sql": [
    {
      funcao: "registrar_pagamento_recebido",
      esperado: [
        // BLOCOS AMARRADOS -- condicao E consequencia na mesma string. A versao
        // anterior desta entrada usava marcador de linha unica ("IF NOT
        // public.is_admin() THEN" sozinho) e um comentario que se dizia
        // "amarrado". Medido por revisor de contexto limpo: mantendo a linha e
        // trocando so' o RAISE por `NULL;`, a guarda vira no-op -- qualquer
        // cliente logado marca qualquer pedido como pago -- e os tres marcadores
        // continuavam CASANDO. Marcador que sobrevive a neutralizacao da guarda
        // nao verifica nada; ele so' registra que alguem digitou a palavra.
        "IF NOT public.is_admin() THEN\n        RAISE EXCEPTION 'Não autorizado: só a loja registra pagamento recebido.';",
        "IF v_payment_method = 'online' THEN\n        RAISE EXCEPTION 'Este pedido é pago pelo site:",
        "ELSIF v_payment_status IS NOT NULL THEN\n            RAISE EXCEPTION 'Este pedido já tem pagamento registrado",
      ],
    },
  ],
```

⚠️ **Estes marcadores são casados contra o corpo que o Postgres devolve em `pg_get_functiondef`, não contra o arquivo.** Escreva a indentação exatamente como ela sai no corpo vivo — se o `db-apply` reprovar dizendo que o marcador não casou, o problema é espaço, não lógica. Confira comparando com a saída real antes de mexer no SQL.

- [ ] **Step 6: Rodar o teste e confirmar que ele PASSA**

Run: `deno test --allow-all --no-check tests/migration_lojista_registra_pagamento_recebido_test.ts`
Expected: PASS, **11 testes**.

- [ ] **Step 7: Provar por mutação que o teste tem dente — DEZENOVE mutações, uma por vez**

Apagar uma linha e ver o teste cair prova pouco: prova que o teste vê **a linha**. A pergunta certa é se ele vê **o efeito**. Estas dezesseis foram medidas contra versões anteriores deste teste, e **quinze passaram verdes em algum momento** — cada uma agora tem de derrubar pelo menos um caso.

Antes de cada mutação, copie o arquivo original para o seu scratchpad; depois restaure copiando de volta e confirme com `git diff --stat` que voltou idêntico. **Nunca** `git stash`/`checkout`/`restore`.

| # | mutação (aplicar sozinha, sempre a partir do original) | tem de derrubar |
|---|---|---|
| M1 | manter `IF NOT public.is_admin() THEN` e trocar o `RAISE` dele por `NULL;` | as quatro recusas |
| M2 | apagar as duas linhas `DROP COLUMN` do **rollback** | o rollback derruba TUDO |
| M3 | apagar o `FOR UPDATE` do `SELECT` | os três pontos |
| M4 | `IF NOT v_ja_estava THEN` → `IF TRUE THEN` | os três pontos |
| M5 | o `UPDATE` grava `'pago'` em vez de `v_depois` | os três pontos |
| M6 | neutralizar o `RAISE` da recusa de sobrescrever o gateway | as quatro recusas |
| M7 | tirar `'recebido_na_entrega'::text` da lista da CHECK constraint | a constraint alargada |
| M8 | tirar `'estornado'::text` da constraint do **rollback** | o rollback restaura com os SEIS |
| M9 | apagar o `ALTER TABLE … ENABLE ROW LEVEL SECURITY` da tabela nova | RLS ligado e policy |
| M10 | apagar a `CREATE POLICY mkt_order_payment_history_select` inteira | RLS ligado e policy |
| M11 | tirar o `DO $$`/`END $$;` do rollback, deixando os comandos soltos | a reversao e' UM bloco atomico |
| M12 | acrescentar `DROP TABLE public.x;` **depois** do `END $$;` | a reversao e' UM bloco atomico |
| M13 | devolver o setimo valor a constraint do rollback **sem** o `::text` | a constraint restaurada tem EXATAMENTE os seis |
| M14 | policy de escrita **sem qualificar o schema**: `ON marketplace_order_payment_history FOR INSERT` | RLS ligado e policy |
| M15 | policy com clausula no meio: `ON public.marketplace_order_payment_history AS PERMISSIVE FOR ALL` | RLS ligado e policy |
| M16 | policy de escrita na grafia canonica (**controle positivo**: ja derrubava, tem de continuar derrubando) | RLS ligado e policy |
| M17 | inserir `ALTER TABLE ... DROP CONSTRAINT ...;` **ANTES** do `DO $$` no rollback | a reversao e' UM bloco atomico |
| M18 | devolver a constraint do rollback um setimo valor **com digito**: `'recebido_na_entrega2'::text` | EXATAMENTE os seis |
| M19 | policy de escrita com identificador **entre aspas**: `ON "public"."marketplace_order_payment_history" FOR INSERT` | RLS ligado e policy |

As de M11 a M15 foram medidas **passando verdes** contra a versão anterior deste teste — cada uma é um buraco real que a asserção anterior não via. M16 é controle positivo: ela já derrubava, e tem de continuar derrubando; se parar, a correção alargou demais e a asserção passou a acusar tudo. M8 continua sendo a mais traiçoeira: um rollback que restaurasse a constraint com **cinco** valores passava a bateria inteira, e rodado para valer estreitaria a trava em silêncio — o próximo estorno de pedido passaria a ser recusado pelo banco, com erro genérico, longe da causa.

**Se alguma das dezenove passar verde (ou se o controle positivo M16 parar de derrubar), o teste é decorativo naquele ponto e você conserta o teste — não segue em frente.** Cole no relatório a tabela com o resultado real de cada uma.

M17, M18 e M19 foram medidas passando **verdes** contra a versao anterior deste teste — as tres sao buracos reais que as assercoes anteriores nao viam, e as tres tem de derrubar agora.

Expected apos restaurar tudo: PASS, 11 testes, e `git diff` vazio.

- [ ] **Step 8: Rodar a verificação que este diff pede**

O diff toca `supabase/migrations/`, `scripts/` e `tests/`. Rodar, e **colar a saída no relatório**:

```bash
npm test
```

```bash
npm run lint:ratchet
```

Não rodar `typecheck`, `build`, `lint:links` nem `size` — a sessão principal roda o que faltar.

- [ ] **Step 9: Commit**

```bash
git add -- "supabase/migrations/20261020000000_lojista_registra_pagamento_recebido.sql" "rollback-manual-20261020000000_lojista_registra_pagamento_recebido.sql" "tests/migration_lojista_registra_pagamento_recebido_test.ts"
```

```bash
git commit -- "supabase/migrations/20261020000000_lojista_registra_pagamento_recebido.sql" "rollback-manual-20261020000000_lojista_registra_pagamento_recebido.sql" "tests/migration_lojista_registra_pagamento_recebido_test.ts" "scripts/db-apply.cjs"
```

Mensagem: `feat(db): a loja passa a poder registrar o pagamento que recebeu na mao`

⚠️ `scripts/db-apply.cjs` é **arquivo compartilhado**. Se `git status` mostrar que ele tem mudança de outra frente, **não** commitar o arquivo: relatar isso e deixar a entrada do `VERIFICACOES` para a sessão principal integrar.

---

### Task 2: Migration da regra — a receita para de contar o que não entrou

**Files:**
- Create: `supabase/migrations/20261021000000_receita_conta_so_dinheiro_que_entrou.sql`
- Create: `rollback-manual-20261021000000_receita_conta_so_dinheiro_que_entrou.sql`
- Modify: `scripts/db-apply.cjs` (mais uma entrada no mapa `VERIFICACOES`)
- Test: `tests/migration_receita_conta_so_dinheiro_que_entrou_test.ts`

**Interfaces:**
- Consumes: da Task 1, a string de status `recebido_na_entrega`.
- Produces: `get_admin_analytics_v2`, `get_admin_customers_paged` e `get_segmented_push_targets` sem nenhuma ocorrência de `payment_status IS NULL` na regra de dinheiro.

**Contexto medido em 27/08/2026, no banco vivo** (não remedir, mas conferir se ainda bate antes de escrever):

| função | ocorrências | linhas na definição viva |
|---|---:|---|
| `get_admin_analytics_v2` | 9 | 63, 71, 86, 94, 104, 112, 169, 182, 212 |
| `get_admin_customers_paged` | 2 | 44, 78 |
| `get_segmented_push_targets` | 1 | 29 |

- [ ] **Step 1: Ler os corpos VIVOS que a sessão principal já extraiu**

O corpo que o Postgres guarda é o texto do arquivo que o aplicou — **não existe convenção do repositório para seguir**, e o fim de linha varia por função. A fonte da verdade é `pg_get_functiondef` do banco, nunca um arquivo de migration antigo.

**Você não acessa o banco.** A sessão principal extraiu os três corpos vivos e deixou um arquivo por função em:

```
.superpowers/sdd/2026-08-27-recebimento-na-entrega/corpos-vivos/
  get_admin_analytics_v2.sql
  get_admin_customers_paged.sql
  get_segmented_push_targets.sql
```

Leia os três. Eles são a base **do rollback** (cópia literal) e a base **da migration** (a mesma cópia, com os 12 pontos alterados). Se algum dos três arquivos não existir ou estiver vazio, **pare e avise** — sem eles não há como escrever nem a migration nem o rollback com fidelidade, e reconstruir o corpo de memória é exatamente como se embarca um rollback infiel.

## O fim de linha: escreva LF — e a conferência abaixo é a única que mede

**Os três corpos vivos estão em LF puro**, e **este repositório inteiro também está** — medido por contagem de bytes em 27/08/2026, disco e blob:

```
                                                   CR    LF
rollback-manual-20261020000000_....sql              0    75
supabase/migrations/20261020000000_....sql          0   185
tests/migration_lojista_..._test.ts                 0   307
tests/migration_vitrine_..._test.ts                 0   445
supabase/migrations/20261012000000_a_vitrine.sql    0   148
```

Então escrever LF **é** seguir a convenção daqui; não há conflito. Em Python, `open(..., "w", newline="\n")` — nunca o modo texto padrão do Windows, que traduz para CRLF sem avisar.

🔴 **A conferência NÃO pode ser `grep -c $'\r'`.** Medido, com controle positivo e negativo:

```
                         grep -c $'\r'    Python (bytes)
arquivo CRLF de verdade        0            CR=3
arquivo LF de verdade          0            CR=0
```

**O `grep` devolve o MESMO número para entradas opostas** — o escape da barra invertida é comido antes de chegar nele. Instrumento cego que imprime número plausível é pior que instrumento quebrado, porque não levanta suspeita. Uma versão anterior deste plano trazia esse comando como portão obrigatório; ela estava errada e as contagens que ela produziu eram, na verdade, **contagem de linhas**.

**A conferência que mede:**

```bash
python -c "print(open('supabase/migrations/20261021000000_receita_conta_so_dinheiro_que_entrou.sql','rb').read().count(chr(13).encode()))"
```

```bash
python -c "print(open('rollback-manual-20261021000000_receita_conta_so_dinheiro_que_entrou.sql','rb').read().count(chr(13).encode()))"
```

Os dois têm de dar **0**.

**A assinatura da falha, se ainda assim escapar CRLF:** `db-prove-rollback.cjs` devolve `FALHOU / rollback infiel` com `divergencias de conteudo: N` e **`so de espaco/formatacao: 0`**, com as duas strings visualmente idênticas na saída. O normalizador do script **não** trata quebra de linha como espaço, e é essa severidade que salva — se classificasse como formatação, um rollback infiel embarcaria com aprovação.

ℹ️ Para o casamento dos marcadores do `VERIFICACOES` isto é indiferente: `scripts/db-apply.cjs:1379-1391` normaliza `\r\n → \n` dos **dois** lados antes de comparar. O que depende de LF é a **fidelidade do rollback**, comparada pelo `db-prove-rollback`.

- [ ] **Step 2: Escrever o teste de forma**

Criar `tests/migration_receita_conta_so_dinheiro_que_entrou_test.ts`, no mesmo molde do teste da Task 1 (mesmos imports, mesmo `avaliarFase0`), com estes casos:

```ts
// Assinatura conferida no codigo real (scripts/db-prove-rollback.cjs:308):
// objeto nomeado na entrada, `{ recusado, motivos }` na saida. Ela ja cobre
// `CREATE FUNCTION` sem `OR REPLACE` nos dois arquivos — nao duplicar.
Deno.test("avaliarFase0 nao recusa o par migration+rollback", () => {
  const r = avaliarFase0({
    sqlMigration: migration,
    sqlRollback: rollback,
    temRollback: true,
  });
  assertEquals(r.recusado, false, `motivos: ${(r.motivos || []).join("; ")}`);
});

Deno.test("a migration redefine as TRES funcoes", () => {
  for (const fn of [
    "get_admin_analytics_v2",
    "get_admin_customers_paged",
    "get_segmented_push_targets",
  ]) {
    assertStringIncludes(migration, `CREATE OR REPLACE FUNCTION public.${fn}`);
  }
});

Deno.test("nenhum ponto de dinheiro aceita mais payment_status IS NULL", () => {
  const restos = migration.match(/payment_status\s+IS\s+NULL/gi) || [];
  assertEquals(restos.length, 0, `sobrou ${restos.length} ocorrencia(s) de IS NULL`);
});

Deno.test("a regra nova cita os TRES status que contam como dinheiro", () => {
  const regra = /payment_status\s+IN\s*\(\s*'pago',\s*'pago_apos_expirar',\s*'recebido_na_entrega'\s*\)/gi;
  const achadas = migration.match(regra) || [];
  assertEquals(achadas.length, 12, `esperava 12 pontos trocados, achei ${achadas.length}`);
});

Deno.test("orders_count e last_order_date NAO foram tocados", () => {
  assertStringIncludes(
    migration,
    "orders_count e last_order_date continuam contando qualquer",
  );
});

Deno.test("o rollback restaura as tres funcoes", () => {
  for (const fn of [
    "get_admin_analytics_v2",
    "get_admin_customers_paged",
    "get_segmented_push_targets",
  ]) {
    assertStringIncludes(rollback, `CREATE OR REPLACE FUNCTION public.${fn}`);
  }
  assertEquals((rollback.match(/payment_status\s+IS\s+NULL/gi) || []).length, 12);
});
```

O último caso é o mais importante: **o rollback tem de trazer de volta exatamente as 12 ocorrências**, senão ele não desfaz.

- [ ] **Step 3: Rodar o teste e confirmar que FALHA**

Run: `deno test --allow-all --no-check tests/migration_receita_conta_so_dinheiro_que_entrou_test.ts`
Expected: FAIL — arquivo da migration não existe.

- [ ] **Step 4: Escrever a migration**

Partindo dos corpos vivos salvos no Step 1, um `CREATE OR REPLACE FUNCTION` por função, **copiando o corpo caractere a caractere** e alterando **somente** os 12 pontos:

de
```sql
(payment_status IS NULL OR payment_status IN ('pago', 'pago_apos_expirar'))
```
para
```sql
(payment_status IN ('pago', 'pago_apos_expirar', 'recebido_na_entrega'))
```

Em `get_admin_customers_paged:78` a forma é `o.payment_status`, com o prefixo da tabela — preservar o prefixo. Em `get_segmented_push_targets:29` idem (`o.payment_status`).

**Não tocar** em nada mais. Em particular, o bloco de `get_admin_customers_paged` que calcula `orders_count` e `last_order_date` fica **idêntico**, e o comentário que já existe ali (`orders_count e last_order_date continuam contando qualquer pedido não cancelado/devolvido`) tem de sobreviver na íntegra — é ele que o teste do Step 2 cobra.

No cabeçalho da migration, escrever: o número medido (R$ 2.977,09 contados contra R$ 4,00 recebidos), que a queda do número é o **objetivo** e não um defeito, e que ela depende da `20261020000000` já estar aplicada.

- [ ] **Step 5: Escrever o rollback manual**

`rollback-manual-20261021000000_receita_conta_so_dinheiro_que_entrou.sql`: os **três corpos vivos salvos no Step 1**, sem nenhuma alteração — é literalmente o estado anterior.

- [ ] **Step 6: Acrescentar a entrada no `VERIFICACOES`**

```js
  "20261021000000_receita_conta_so_dinheiro_que_entrou.sql": [
    {
      funcao: "get_admin_analytics_v2",
      esperado: ["payment_status IN ('pago', 'pago_apos_expirar', 'recebido_na_entrega')"],
    },
    {
      funcao: "get_admin_customers_paged",
      esperado: ["o.payment_status IN ('pago', 'pago_apos_expirar', 'recebido_na_entrega')"],
    },
    {
      funcao: "get_segmented_push_targets",
      esperado: ["o.payment_status IN ('pago', 'pago_apos_expirar', 'recebido_na_entrega')"],
    },
  ],
```

- [ ] **Step 7: Rodar o teste e confirmar que PASSA**

Run: `deno test --allow-all --no-check tests/migration_receita_conta_so_dinheiro_que_entrou_test.ts`
Expected: PASS, **6 testes**.

- [ ] **Step 8: Mutação**

Trocar **um** dos 12 pontos de volta para a forma com `IS NULL`, rodar, e confirmar que o teste da contagem falha dizendo `esperava 12 pontos trocados, achei 11`. Restaurar e conferir com `git diff --stat`.

- [ ] **Step 9: Verificação e commit**

```bash
npm test
```

```bash
npm run lint:ratchet
```

Commit com a mesma cautela da Task 1 quanto ao `scripts/db-apply.cjs` compartilhado.

Mensagem: `fix(db): a receita passa a contar so o dinheiro que entrou de verdade`

---

### Task 3: O front enxerga os campos novos

**Files:**
- Modify: `src/types/index.ts` (interface `Order`, perto de `returnedToSellerAt` na linha 178)
- Modify: `src/lib/mappers.ts` (`mapOrderFromDB`, perto da linha 256)
- Modify: `src/hooks/useOrders.ts` (nova função, no molde de `confirmarRetornoDoProduto` na linha 1758)
- Test: `tests/front/lojista-registra-pagamento-recebido.test.ts`

**Interfaces:**
- Consumes: da Task 1, a RPC `registrar_pagamento_recebido(p_order_id uuid, p_recebido boolean)` e as chaves do jsonb (`payment_status`, `pagamento_recebido_em`, `ja_estava`).
- Produces:
  - em `Order`: `pagamentoRecebidoEm?: string | null` e `pagamentoRecebidoPor?: string | null`
  - de `useOrders()`: `registrarPagamentoRecebido: (orderId: string, recebido: boolean) => Promise<void>`

🔴 **O defeito histórico deste projeto mora exatamente aqui.** Numa entrega anterior, um plano dizia "Consome: a coluna `payment_status`" como se ela chegasse ao front — e o `mapOrderFromDB` nunca a copiou. O filtro e o selo ficaram corretos no código e **todo** pedido se comportava como se o campo fosse vazio. **Coluna que não passa pelo mapper não existe para a tela.**

- [ ] **Step 1: Escrever o teste que falha**

Criar `tests/front/lojista-registra-pagamento-recebido.test.ts`. O primeiro caso é o do mapper, e ele é obrigatório:

```ts
import { describe, expect, it, vi } from "vitest";
import { mapOrderFromDB } from "@/lib/mappers";

describe("o mapper leva os campos de recebimento para a tela", () => {
  it("copia pagamento_recebido_em e pagamento_recebido_por", () => {
    const pedido = mapOrderFromDB({
      id: "o1",
      status: "pending",
      payment_method: "cash",
      payment_status: "recebido_na_entrega",
      pagamento_recebido_em: "2026-08-27T12:00:00.000Z",
      pagamento_recebido_por: "admin-1",
      total: 250,
      items: [],
    } as never);

    expect(pedido.pagamentoRecebidoEm).toBe("2026-08-27T12:00:00.000Z");
    expect(pedido.pagamentoRecebidoPor).toBe("admin-1");
  });

  it("pedido sem os campos vira null, nao undefined nem string vazia", () => {
    const pedido = mapOrderFromDB({
      id: "o2",
      status: "pending",
      payment_method: "pix",
      payment_status: null,
      total: 10,
      items: [],
    } as never);

    expect(pedido.pagamentoRecebidoEm).toBeNull();
    expect(pedido.pagamentoRecebidoPor).toBeNull();
  });
});
```

O segundo caso existe porque a migration ainda **não** está aplicada quando o front sobe (ver "A ordem de subida"): o banco devolve linha sem essas colunas, e a tela tem de sobreviver a isso sem quebrar.

- [ ] **Step 2: Rodar e confirmar que FALHA**

Run: `npx vitest run tests/front/lojista-registra-pagamento-recebido.test.ts`
Expected: FAIL — `pagamentoRecebidoEm` é `undefined`.

- [ ] **Step 3a: 🔴 Acrescentar o valor novo ao tipo `PaymentStatus`**

Em `src/types/index.ts:135-141`. O comentário que já está acima dele diz por que isto é obrigatório: *"Espelha a CHECK constraint marketplace_orders_payment_status_check, criada na migration 20260807000000. Mudar aqui sem mudar lá (ou o contrário) é como o pedido fica com estado que o banco recusa."*

A Task 1 alargou a constraint no banco. Este é o outro lado:

```ts
export type PaymentStatus =
  | "aguardando"
  | "pago"
  | "recusado"
  | "expirado"
  | "estornado"
  | "pago_apos_expirar"
  | "recebido_na_entrega";
```

**Não altere o comentário acima do tipo** — ele continua verdadeiro e é ele que faz o próximo leitor manter os dois lados juntos.

⚠️ Acrescentar valor a esta união **quebra `switch` exaustivo** que não trate o caso novo. O `typecheck` acusa (TS2678 / falta de caso). Se ele apontar, o conserto é tratar o caso novo em cada `switch`, **não** afrouxar o tipo nem usar `default` para engolir — pelo menos dois `switch` deste projeto dependem dessa exaustividade de propósito. Cole a saída do `typecheck` no relatório mesmo quando ela passar.

- [ ] **Step 3b: Acrescentar os campos ao tipo `Order`**

Em `src/types/index.ts`, logo abaixo de `returnedToSellerAt` (linha 178):

```ts
  /** Quando a loja confirmou que recebeu o pagamento na entrega. NULL = não confirmado. */
  pagamentoRecebidoEm?: string | null;
  /** Qual admin confirmou o recebimento. */
  pagamentoRecebidoPor?: string | null;
```

- [ ] **Step 4: Copiar os campos no mapper**

Em `src/lib/mappers.ts`, dentro de `mapOrderFromDB`, ao lado de `cancelledAfterShipping` / `returnedToSellerAt` (linhas 256-257), no mesmo estilo — o cast `(row as any)` é necessário porque `database.types.ts` ainda não foi regenerado, exatamente como as duas linhas vizinhas:

```ts
    // Colunas da migration 20261020000000: ainda não regeneradas em
    // database.types.ts, por isso o cast — igual às duas linhas acima.
    pagamentoRecebidoEm: (row as any).pagamento_recebido_em ?? null,
    pagamentoRecebidoPor: (row as any).pagamento_recebido_por ?? null,
```

- [ ] **Step 5: Rodar e confirmar que PASSA**

Run: `npx vitest run tests/front/lojista-registra-pagamento-recebido.test.ts`
Expected: PASS, 2 casos.

- [ ] **Step 6: Escrever o teste do hook**

Acrescentar ao mesmo arquivo. O caso que mais importa é o do cache — **sem ele a tela marca o pagamento e o número da receita não muda**, porque `useAnalytics` guarda o resultado em cache de módulo:

```ts
vi.mock("@/hooks/useAnalytics", () => ({
  clearAnalyticsCache: vi.fn(),
  useAnalytics: () => ({ stats: null, fetchExecutiveSummary: vi.fn() }),
}));
```

E um caso que assere: depois de `registrarPagamentoRecebido(id, true)` resolver, `clearAnalyticsCache` foi chamado **uma** vez. Montar o resto do teste seguindo o molde do arquivo já existente `tests/front/cancelar-enviado-otimista-marca-que-precisa-devolver.test.tsx`, que exercita `confirmarRetornoDoProduto` com o mesmo formato de mock do `supabase.rpc`.

- [ ] **Step 7: Escrever a função no hook**

Em `src/hooks/useOrders.ts`, no molde de `confirmarRetornoDoProduto` (linha 1758). A função:

1. chama `(supabase.rpc as any)("registrar_pagamento_recebido", { p_order_id: orderId, p_recebido: recebido })`;
2. em erro, `throw` (o toast traduzido já existe no hook);
3. lê `data?.payment_status` e `data?.pagamento_recebido_em` da resposta — **a verdade é a que o banco devolveu**, não a otimista, porque a RPC é idempotente e um segundo clique devolve `ja_estava: true` sem ter mexido em nada;
4. atualiza `cachedAdminOrders`, `setOrders` e `setPedidosCancelados` com os campos novos, no mesmo padrão das três atualizações que `confirmarRetornoDoProduto` já faz;
5. chama `clearAnalyticsCache()`.

- [ ] **Step 8: Rodar e confirmar que PASSA**

Run: `npx vitest run tests/front/lojista-registra-pagamento-recebido.test.ts`
Expected: PASS.

- [ ] **Step 9: Mutação — a prova de que o teste tem dente**

Apagar a linha `clearAnalyticsCache();` da função nova (guardando o conteúdo no scratchpad), rodar, e confirmar que o teste do cache **FALHA**. Restaurar e conferir por `git diff --stat`.

- [ ] **Step 10: Verificação e commit**

O diff toca `src/` e `tests/`: rodar os **sete** comandos e colar a saída.

```bash
npm ci
```

```bash
npm run typecheck
```

```bash
npm test
```

```bash
npm run build
```

```bash
npm run lint:links
```

```bash
npm run lint:ratchet
```

```bash
npm run size
```

Mensagem: `feat(orders): a tela enxerga o pagamento que a loja recebeu na mao`

---

### Task 4: O botão no cartão do pedido

**Files:**
- Modify: `src/views/admin/AdminOrdersView.tsx` (perto de `handleConfirmarRetorno`, linha 415)
- Test: `tests/front/painel-botao-registrar-pagamento-recebido.test.tsx`

**Interfaces:**
- Consumes: da Task 3, `registrarPagamentoRecebido(orderId, recebido)` de `useOrders()`, e `order.pagamentoRecebidoEm`.
- Produces: nada que outra tarefa consuma.

- [ ] **Step 1: Escrever os testes que falham**

Criar `tests/front/painel-botao-registrar-pagamento-recebido.test.tsx`, seguindo o molde de montagem de `tests/front/painel-lista-estorno-devido.test.tsx`. Quatro casos, e os três primeiros são guardas de escopo:

1. pedido com `paymentMethod: "cash"` e `pagamentoRecebidoEm: null` → o botão "Marcar como recebido" **aparece**;
2. pedido com `paymentMethod: "online"` → o botão **não** aparece (quem confirma é o gateway);
3. pedido com `status: "cancelled"` → o botão **não** aparece;
4. pedido com `pagamentoRecebidoEm` preenchido → aparece o texto de recebido **e** a ação de desfazer; clicar em desfazer chama `registrarPagamentoRecebido(id, false)` — assertar o **segundo argumento `false`**, não só que a função foi chamada.

O caso 4 assere o argumento porque marcar e desmarcar chamam a **mesma** função: um teste que só confere "foi chamada" passa com o botão de desfazer marcando de novo.

- [ ] **Step 2: Rodar e confirmar que FALHAM**

Run: `npx vitest run tests/front/painel-botao-registrar-pagamento-recebido.test.tsx`
Expected: FAIL nos 4 — nada renderiza o botão ainda.

- [ ] **Step 3: Implementar o botão**

Em `AdminOrdersView.tsx`:

- um `useCallback` `handleRegistrarPagamento(orderId, recebido)` no molde de `handleConfirmarRetorno` (linha 415), com o mesmo `try/catch/finally` e um estado `registrandoPagamentoId` para desabilitar o botão durante a chamada;
- a condição de exibição, escrita **uma vez** e usada pelos dois ramos:

```ts
const podeRegistrarPagamento =
  order.paymentMethod !== "online" && order.status !== "cancelled";
```

- se `order.pagamentoRecebidoEm` for nulo: botão "Marcar como recebido";
- se estiver preenchido: o texto com a data formatada e a ação "desfazer".

Seguir o padrão visual dos botões que já existem no cartão. **Não** inventar componente novo.

- [ ] **Step 4: Rodar e confirmar que PASSAM**

Run: `npx vitest run tests/front/painel-botao-registrar-pagamento-recebido.test.tsx`
Expected: PASS, 4 casos.

- [ ] **Step 5: Mutação**

Trocar `order.paymentMethod !== "online"` por `true` e confirmar que o caso 2 **falha**. Restaurar e conferir por `git diff --stat`.

- [ ] **Step 6: Ver na tela de verdade**

Subir o preview (`preview_start` com `{name: "core_app_mkt"}`), abrir o painel de pedidos, e **tirar um print** do cartão com o botão. Ler o console e a rede à procura de erro. Colar o print no relatório.

- [ ] **Step 7: Verificação e commit**

Os sete comandos, saída colada.

Mensagem: `feat(admin): o lojista marca no painel o pagamento que recebeu na mao`

---

### Task 5: Conferência do conjunto

Esta tarefa **nasce com o plano**, não é lembrada no fim. Plano de 3+ tarefas abre com ela agendada, porque quando a falha é "ninguém aciona a checagem no fim", a solução não é um fiscal melhor no fim — é marcar a checagem na agenda antes de começar.

- [ ] **Step 1: Despachar o `diretor`**

Com o pedido original nas palavras do Gabriel, a lista das quatro tarefas, e onde está o resultado de cada uma. Ele responde só o que se responde com fato:

- o item pedido está lá? (o lojista consegue marcar e desmarcar; a receita conta só o que entrou)
- as peças se encaixam? (a coluna passa pelo mapper; o botão chama a RPC certa; o cache é limpo)
- a verificação teve lastro? (os arquivos, os prints e as saídas existem mesmo)
- o número mexeu?

- [ ] **Step 2: A medição de comportamento no banco real — a que vale**

Feita pela **sessão principal**, não por subagente, depois de a `20261020000000` estar aplicada. Tudo dentro de `BEGIN … ROLLBACK`, com **`SAVEPOINT` por chamada que deve falhar** (o primeiro erro aborta a transação e as seguintes viram falso "barrado"):

1. admin marca → `payment_status` vira `recebido_na_entrega`, carimbo gravado, e a receita **sobe exatamente o `total` daquele pedido**. ⚠️ O pedido do teste tem de ter `created_at` **dentro da janela medida** — "Receita Hoje" só enxerga `created_at >= date_trunc('day', now())`. Pedido antigo dá diferença zero e parece que não funcionou;
2. admin desmarca → volta, a receita desce ao valor de antes, e o histórico tem **duas** linhas (`recebido`, `desfeito`), nessa ordem;
3. **controle negativo:** não-admin é recusado — e o privilégio do sujeito é **assertado antes** de interpretar o resultado. A guarda mora dentro de `IF NOT is_admin()`, e o dono da maioria dos pedidos deste banco **é** admin: um teste descuidado devolve "não recusou" e parece defeito da migration;
4. pedido `online` é recusado;
5. pedido cancelado é recusado;
6. marcar duas vezes → a segunda devolve `ja_estava: true` e o histórico continua com **uma** linha;
7. o `ROLLBACK` valeu: a contagem de pedidos por status fica idêntica à de antes.

- [ ] **Step 3: Prova de rollback das duas migrations**

```bash
node scripts/db-prove-rollback.cjs 20261020000000_lojista_registra_pagamento_recebido.sql
```

```bash
node scripts/db-prove-rollback.cjs 20261021000000_receita_conta_so_dinheiro_que_entrou.sql
```

⚠️ Ler o **exit code sem pipe** — `cmd | tail; echo $?` mede o `tail`. E se o veredito for `FALHOU`, **ler a primeira divergência e perguntar se as outras são efeito dela** antes de tratar como rollback quebrado: o script compara coluna por posição, e coluna nova desloca todas as seguintes. Contar as linhas da saída é medir a estrutura errada.

- [ ] **Step 4: PR**

Base `develop` (a `main` só recebe `release/*` e `hotfix/*` — o histórico deste repositório é 29 a 1). No corpo: o número antes e depois, a ordem de subida em três passos, e o aviso de que a queda da receita é o objetivo.

---

## Self-Review

**Cobertura da spec:** as seis decisões da spec têm tarefa. Decisão 1 (receita conta só o que entrou) → Task 2. Decisão 2 (valor novo separado) → Task 1. Decisão 3 (desmarcar com registro) → Task 1 (tabela e RPC) e Task 4 (o botão de desfazer). Decisão 4 (lista própria) → Task 1. Decisão 5 (as três funções juntas) → Task 2. Decisão 6 (marcar em qualquer momento, menos cancelado) → Task 1. O que a spec põe fora de escopo continua fora.

**Placeholders:** nenhum "TBD"/"TODO". O único ponto que depende de descoberta é o Step 1 da Task 2 (o corpo vivo das funções), e ele traz o comando e o `SELECT` exato caso o script não exista.

**Consistência de tipos:** `registrarPagamentoRecebido(orderId: string, recebido: boolean)` tem o mesmo nome e a mesma ordem de argumentos na Task 3 (produz) e na Task 4 (consome). `pagamentoRecebidoEm` / `pagamentoRecebidoPor` são os mesmos nomes no tipo, no mapper e na tela. A string `recebido_na_entrega` é a mesma na Task 1, na Task 2 e nos testes.

**Divergência assumida em relação à spec:** a spec dizia "a tela vai a produção antes do banco". Este plano refina: **banco aditivo primeiro, tela depois, regra por último.** A regra da spec vale para mudança que *recusa*; a `20261020000000` só acrescenta, e subir a tela antes dela faria o botão quebrar no primeiro clique.
