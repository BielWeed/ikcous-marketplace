# Publicar o painel, o cartão e as devoluções (PR #666) — passo a passo

O PR #666 traz quatro migrations
([`20261175`](../../supabase/migrations/20261175000000_a_devolucao_nasce_no_pedido.sql) devoluções,
[`20261176`](../../supabase/migrations/20261176000000_o_cartao_online_nasce.sql) cartão,
[`20261177`](../../supabase/migrations/20261177000000_o_financeiro_da_loja_nasce.sql) Financeiro,
[`20261178`](../../supabase/migrations/20261178000000_o_crm_e_o_inicio_leem_a_loja.sql) CRM e Início),
cinco edge functions novas e o front do Início, do Dashboard CRM, do Financeiro, das devoluções
e do cartão pelo app. Este runbook é para o dono ou para um agente com acesso ao GitHub Actions
e ao painel do Supabase. Regras de fundo: [AGENTS.md](../../AGENTS.md); functions:
[DEPLOYMENT.md §5.3](../../DEPLOYMENT.md).

**O cartão sai DESLIGADO** (`config_pagamento_cartao`: crédito e débito `false`). Publicar este
PR não oferece cartão a ninguém. Ligar é o passo 6, separado, depois do teste.

## A ordem, e o que acontece se ela for trocada

| Passo | O quê | Se pular ou inverter |
| --- | --- | --- |
| 1 | As 4 migrations, pelo workflow `aplicar-migrations.yml` | — |
| 2 | As functions, pelo workflow `publicar-functions.yml` | **Function antes da migration: todo PIX responde 503.** A `criar-pagamento` nova lê `tentativas_de_pagamento`, coluna que só existe depois da `20261176`. |
| 3 | O front (Vercel) | Front antes do banco: Início, CRM, Financeiro e devoluções mostram erro de carregamento. O cartão some sozinho, porque a leitura da configuração falha fechada. |
| 6 | Ligar crédito e débito | Só depois do checklist do passo 6. |

Entre os passos 1 e 2, a loja segue funcionando com as functions e o front antigos. As
migrations são aditivas, e as cinco funções que elas redefinem mantêm a assinatura e o
contrato: `devolver_estoque`, `get_admin_orders_cancelados_recentes`, `solicitar_estorno`,
`update_order_status_atomic` e `registrar_estorno_manual`. A única mudança de comportamento em
`update_order_status_atomic` é descontar o reembolso manual de uma devolução já concluída
antes de abrir o estorno automático do cancelamento. As functions novas continuam aceitando o PIX do front antigo
(`metodo: "pix"`).

---

## 0. Antes de começar

- [ ] **CI do PR verde**, exceto em dois jobs:
  - **"Código x banco (objetos usados)"** fica vermelho até o passo 1, e isso é esperado. Esse
    job compara o código com o catálogo do banco, e a lista `AUSENTE` do log só pode ter os
    objetos das 4 migrations: `politica_devolucao`, `devolucoes`, `devolucao_itens`,
    `devolucao_eventos`, o bucket `devolucoes`, as RPCs de devolução, `config_pagamento_cartao`,
    `salvar_config_pagamento_cartao`, `liberar_cobranca_do_pedido`, `fin_*`,
    `assinatura_da_loja_ler`, `crm_visao`, `crm_clientes` e `painel_inicio`. **Se aparecer
    qualquer outro nome, pare.**
  - Os jobs marcados "(informacional)" não bloqueiam.
- [ ] **"Build e tamanho" verde.** O portão de tamanho é dividido: cliente ≤ 550 kB, painel
  ≤ 450 kB ([AGENTS.md](../../AGENTS.md), Verificação).
- [ ] **Todas as revisões de risco independentes deram PASSA**, no commit que vai ser publicado:
  - migrations 75–78;
  - edges do cartão;
  - etiqueta reversa;
  - front do checkout.

  Se algum commit em `supabase/` entrou depois da última revisão, a revisão vale de novo.
- [ ] **Anote o SHA do commit revisado.** Os dois workflows rodam a partir do branch que você
  escolher em *Run workflow*, e esse branch tem de estar exatamente nesse SHA.
- [ ] **Anote o alvo do rollback das functions**: o commit do último run verde do
  `publicar-functions.yml` na aba Actions. Na falta dele, use a base do PR.
- [ ] **Confira o backup.** O backup é diário e não há PITR. Olhe a hora do último backup em
  Supabase → Database → Backups.
- [ ] **Escolha um horário de pouco movimento** e faça os passos 1 e 2 na mesma sessão.
- [ ] **Rode no SQL Editor do projeto da loja** e confira os valores esperados. É uma consulta
  só, porque o SQL Editor mostra apenas o último resultado:

```sql
SELECT (SELECT count(*) FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'store_config'
           AND column_name = 'formas_pagamento_entrega') AS base_74,  -- 1: a base (PR #664) já está na loja
       to_regclass('public.devolucoes')                  AS t75,      -- NULL
       to_regclass('public.config_pagamento_cartao')     AS t76,      -- NULL
       to_regclass('public.fin_contas')                  AS t77,      -- NULL
       to_regprocedure('public.painel_inicio()')         AS f78;      -- NULL
```

`base_74 = 0` quer dizer que falta a migration de que o front deste PR depende. Qualquer `t75`–`f78`
diferente de NULL quer dizer que alguém aplicou por fora. **Pare nos dois casos.** O
`CREATE TABLE IF NOT EXISTS` manteria uma forma velha da tabela.

- [ ] **Confira que o corpo vivo das 5 funções que 75 e 76 redefinem bate com a base**
  ([CONTRIBUTING.md](../../CONTRIBUTING.md), regra do `pg_get_functiondef`). As funções são
  `devolver_estoque`, `get_admin_orders_cancelados_recentes`, `solicitar_estorno`,
  `update_order_status_atomic` (base: `2026110000000_o_estorno_nasce_no_ledger.sql`) e
  `registrar_estorno_manual`. Os rollbacks devolvem exatamente estes corpos, verbatim dos
  arquivos-base (conferido por md5 em 26/09/2026). Se o corpo vivo for outro, o rollback
  restauraria uma função diferente da que está no ar. Gere a consulta a partir dos próprios
  rollbacks, na raiz do repositório:

```bash
node - <<'JS' > conferir-corpos-vivos.sql
const fs = require("fs"), crypto = require("crypto");
const re = /CREATE OR REPLACE FUNCTION public\.(\w+)\([\s\S]*?\bAS\s+(\$\w*\$)([\s\S]*?)\2/g;
const linhas = [];
for (const arq of ["rollback-manual-20261175000000_a_devolucao_nasce_no_pedido.sql", "rollback-manual-20261176000000_o_cartao_online_nasce.sql"]) {
  for (const m of fs.readFileSync("supabase/migrations/" + arq, "utf8").matchAll(re)) {
    const md5 = crypto.createHash("md5").update(m[3].replace(/\r/g, ""), "utf8").digest("hex");
    linhas.push(`('${m[1]}', '${md5}')`);
  }
}
console.log(`SELECT v.funcao, count(p.oid) AS versoes_vivas,
       bool_and(md5(replace(p.prosrc, E'\\r', '')) = v.md5) AS igual_ao_rollback
  FROM (VALUES ${linhas.join(",\n               ")}) AS v(funcao, md5)
  LEFT JOIN pg_proc p ON p.proname = v.funcao AND p.pronamespace = 'public'::regnamespace
 GROUP BY v.funcao ORDER BY v.funcao;`);
JS
```

  O resultado esperado são 5 linhas, com `versoes_vivas = 1` e `igual_ao_rollback = true`.
  Se der `false`, **pare**. Compare com
  `SELECT pg_get_functiondef('public.<função>'::regproc);` e leve a diferença ao dono.

## 1. Aplicar as 4 migrations — só pelo workflow

**Não use `supabase db push`, não cole no SQL Editor e não rode `db-apply.cjs` desta vez.**

O cabeçalho de cada migration diz "COMO APLICAR: `node scripts/db-apply.cjs`". Aqui o caminho
é o workflow por dois motivos:
- ele usa o mesmo token que publica as functions;
- o projeto de destino fica explícito.

Além disso, `DATABASE_URL` já apontou para o projeto errado: a passagem de 19/09/2026 registra o
segredo do repositório apontando para outro projeto. Desde 26/09/2026, o job "Código x banco
(objetos usados)" do `ci.yml` fica VERMELHO enquanto esse secret continuar apontando para o
sandbox, em vez de silenciosamente comparar o código com o banco errado.

1. *(Opcional, recomendado)* Faça um ensaio:
   1. Abra GitHub → Actions → **"Aplicar migrations (Supabase)"** → *Run workflow*.
   2. Deixe `migracoes` **vazio**.
   3. O run só imprime a `FINGERPRINT (pedidos, cancelados)`. Isso prova o token e o projeto
      antes de qualquer DDL.
2. Faça o run de verdade:
   1. Abra *Run workflow* de novo, no branch do SHA anotado.
   2. Preencha `migracoes` com o texto abaixo, **nessa ordem e numa linha só**:

      ```text
      20261175000000_a_devolucao_nasce_no_pedido.sql,20261176000000_o_cartao_online_nasce.sql,20261177000000_o_financeiro_da_loja_nasce.sql,20261178000000_o_crm_e_o_inicio_leem_a_loja.sql
      ```

   3. Deixe `projeto_ref` **no padrão**, que é o projeto da loja.

   A ordem importa porque cada migration lê a anterior:
   - `registrar_estorno_manual` (76) lê `devolucoes` (75);
   - o Financeiro (77) lê `devolucoes` e as colunas da 76;
   - o CRM e o Início (78) chamam `fin__*` (77).
3. Anote a `FINGERPRINT` do log: são os pedidos e cancelados antes do DDL.

**O que o workflow faz**, arquivo por arquivo
([`.github/workflows/aplicar-migrations.yml`](../../.github/workflows/aplicar-migrations.yml)):
1. Recusa nome fora do padrão `^[0-9]{14}_[a-z0-9_-]+\.sql$`. Por isso ele não aceita os
   `rollback-manual-*`.
2. Roda a **prova** `BEGIN; <arquivo>; ROLLBACK;`.
3. Faz o **apply**.

Ele para na primeira falha, e os arquivos já aplicados **ficam** aplicados. As 4 migrations são
idempotentes: `IF NOT EXISTS`, `CREATE OR REPLACE` e `ON CONFLICT DO NOTHING`. A dupla aplicação
é provada no CI ("Migrations do zero"). Por isso, depois de entender o erro, dá para repetir a
mesma lista inteira.

**O que o workflow NÃO faz:**
- **A verificação do fim não é destas migrations.** Ela confere só grants e colunas antigos: as
  RPCs do PDV e `get_admin_orders_cancelados_recentes`, mais as colunas `canal` e
  `codigo_barras`. "FIM: tudo aplicado e verificado" não prova nada sobre 75–78. Quem prova é o
  §1.1.
- **Não roda os marcadores `VERIFICACOES`** de [`scripts/db-apply.cjs`](../../scripts/db-apply.cjs).
  Rode o §1.2.
- **Não grava o ledger** `supabase_migrations.schema_migrations`. Veja o §1.3.

### 1.1 Conferir o que nasceu (SQL Editor, só leitura)

Uma consulta só, porque o SQL Editor mostra o último resultado. Toda linha tem de dar
`ok = true`. Se der erro de objeto inexistente, a migration daquele objeto não entrou.

```sql
SELECT checagem, valor, esperado, COALESCE(valor = esperado, false) AS ok FROM (VALUES
  ('75 política padrão',          (SELECT concat_ws('/', prazo_arrependimento_dias, prazo_troca_dias, prazo_vicio_dias) FROM public.politica_devolucao), '7/30/90'),
  ('75 bucket privado',           (SELECT public::text FROM storage.buckets WHERE id = 'devolucoes'), 'false'),
  ('76 cartão nasce desligado',   (SELECT concat_ws('/', credito::text, debito::text, parcelas_max) FROM public.config_pagamento_cartao), 'false/false/1'),
  ('76 colunas do pedido',        (SELECT count(*)::text FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'marketplace_orders' AND column_name IN ('tentativas_de_pagamento', 'metodo_online', 'parcelas', 'estorno_manual_registrado_em')), '4'),
  ('76 gatilho do estorno ligado',(SELECT tgenabled::text FROM pg_trigger WHERE tgname = 'tr_marca_estorno_direto_do_pedido'), 'O'),
  ('77 contas de sistema',        (SELECT count(*)::text FROM public.fin_contas WHERE sistema), '3'),
  ('77 categorias de sistema',    (SELECT count(*)::text FROM public.fin_categorias WHERE sistema), '23'),
  ('RLS nas 10 tabelas novas',    (SELECT count(*)::text FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relrowsecurity AND relname IN ('politica_devolucao', 'devolucoes', 'devolucao_itens', 'devolucao_eventos', 'config_pagamento_cartao', 'fin_contas', 'fin_categorias', 'fin_lancamentos', 'fin_caixa_sessoes', 'assinatura_da_loja')), '10'),
  ('app executa liberar_cobranca',has_function_privilege('authenticated', 'public.liberar_cobranca_do_pedido(uuid,text)', 'EXECUTE')::text, 'false'),
  ('anon lê updated_by do cartão',has_column_privilege('anon', 'public.config_pagamento_cartao', 'updated_by', 'SELECT')::text, 'false'),
  ('app grava assinatura',        has_table_privilege('authenticated', 'public.assinatura_da_loja', 'INSERT')::text, 'false'),
  ('app grava lançamento direto', has_table_privilege('authenticated', 'public.fin_lancamentos', 'INSERT')::text, 'false'),
  ('anon executa fin_dre',        has_function_privilege('anon', 'public.fin_dre(date,date)', 'EXECUTE')::text, 'false'),
  ('anon executa painel_inicio',  has_function_privilege('anon', 'public.painel_inicio()', 'EXECUTE')::text, 'false')
) AS c(checagem, valor, esperado)
ORDER BY ok, checagem;
```

O valor 23 das categorias foi contado no `INSERT` da `20261177`. A ficha no cabeçalho da
migration diz 22, e o arquivo semeia 23.

### 1.2 Conferir os marcadores (o que o `db-apply` conferiria)

Os marcadores moram no mapa `VERIFICACOES` de `scripts/db-apply.cjs`. São trechos que somem se
uma regra de dinheiro for tirada. Gere a consulta **a partir do mapa**, no mesmo commit
publicado, na raiz do repositório (Git Bash serve):

```bash
node - <<'JS' > conferir-marcadores.sql
const { VERIFICACOES } = require("./scripts/db-apply.cjs");
const q = (s) => "'" + s + "'";
const linhas = [];
for (const arquivo of Object.keys(VERIFICACOES).filter((a) => /^(2026117[5-8]|20261180)/.test(a)).sort()) {
  for (const c of [].concat(VERIFICACOES[arquivo])) {
    for (const bruto of c.esperado) {
      const m = typeof bruto === "string" ? { texto: bruto } : bruto;
      linhas.push(`  (${q(arquivo.slice(0, 14))}, ${q(c.funcao)}, $marcador$${m.texto}$marcador$, ${m.vezes ?? 1})`);
    }
  }
}
console.log(`WITH m(migration, funcao, marcador, vezes) AS (VALUES
${linhas.join(",\n")}
), d AS (
  SELECT m.*, (SELECT string_agg(pg_get_functiondef(p.oid), E'\\n') FROM pg_proc p
                WHERE p.pronamespace = 'public'::regnamespace AND p.proname = m.funcao) AS def
    FROM m
)
SELECT migration, funcao, vezes AS esperado,
       (length(def) - length(replace(def, marcador, ''))) / length(marcador) AS achado,
       COALESCE((length(def) - length(replace(def, marcador, ''))) / length(marcador) = vezes, false) AS ok
  FROM d ORDER BY ok, migration, funcao;`);
JS
```

Cole o `conferir-marcadores.sql` no SQL Editor. O filtro acima cobre 75–78 e a 80 (§1.4, **se
aplicada**) — **não conte marcadores de cabeça**: rode a consulta e confira que TODA linha do
resultado dá `ok = true`, seja qual for o total (o número exato muda a cada revisão de qualquer
uma das migrations; hard-codar uma contagem aqui é exatamente o que ficou errado numa rodada
anterior deste runbook). Nos dois sentidos:
- `achado` menor que `esperado` quer dizer que parte do trecho sumiu;
- `achado` maior que `esperado` quer dizer que a função mudou de um jeito que ninguém previu.

Nos dois casos a situação pede olho humano antes do passo 2.

**A 79 (`cancelar_devolucao_barra_compra_em_voo`) NÃO entra neste filtro** — ela é de outra
frente (`fix/devolucao-pos-revisao`) e tem o próprio procedimento de conferência, no §7.3 do
runbook daquela frente. Se a 79 estiver aplicada, confira os marcadores dela lá, não aqui —
duplicar a lista aqui é como a contagem hard-coded acima ficou errada quando a 79 ganhou um
overload novo na rodada 4 dela.

### 1.3 Ledger (decisão do dono)

O workflow não registra as versões em `supabase_migrations.schema_migrations`. Só o `db-apply`
registra. Para casar o ledger, use o mesmo `INSERT` que o `db-apply` faz:

```sql
INSERT INTO supabase_migrations.schema_migrations (version, name) VALUES
  ('20261175000000', 'a_devolucao_nasce_no_pedido'),
  ('20261176000000', 'o_cartao_online_nasce'),
  ('20261177000000', 'o_financeiro_da_loja_nasce'),
  ('20261178000000', 'o_crm_e_o_inicio_leem_a_loja')
ON CONFLICT (version) DO NOTHING;
```

**A linha da 79 não entra neste `INSERT`** — o ledger dela é registrado pelo §7.4 do runbook da
frente `fix/devolucao-pos-revisao`, que é quem publica e mantém aquela migration.

Se registrar e depois reverter (§5), apague as linhas das versões revertidas.

### 1.4 Aplicar a 80 (achado independente de risco, 26/09/2026)

A `20261180000000_cliente_nao_cancela_com_cartao_vivo.sql` é publicada À PARTE das 4 migrations
do §1 — mesmo procedimento (workflow, nunca `db-apply.cjs` direto), mas em outro run, DEPOIS de
o §1.1/§1.2 confirmarem que 75 e 76 estão de pé (ela lê `metodo_online` e `devolucoes`).

1. Abra *Run workflow* de novo, no branch do SHA anotado.
2. Preencha `migracoes`:

   ```text
   20261180000000_cliente_nao_cancela_com_cartao_vivo.sql
   ```

3. Deixe `projeto_ref` **no padrão**, que é o projeto da loja.

Esta migration tem um **preflight** (`B1_BASELINE_DIVERGENT`, `DO $preflight_20261180$` no topo
do arquivo) que recusa ANTES de qualquer `CREATE` se `marketplace_orders.metodo_online` ou
`public.devolucoes` não existirem, ou se o corpo vivo de `update_order_status_atomic` não bater
com o que a 75 deixou nem com o que ela própria deixa — aplicar fora de ordem (ex.: direto sobre
um banco parado na 74) sai com esse erro e **nada é gravado**, em vez de criar uma função quebrada
silenciosamente (o que aconteceria sem o preflight — provado em Postgres 17 efêmero, ver o
cabeçalho do arquivo).

Depois de aplicar, acrescente ao ledger do §1.3:

```sql
INSERT INTO supabase_migrations.schema_migrations (version, name) VALUES
  ('20261180000000', 'cliente_nao_cancela_com_cartao_vivo')
ON CONFLICT (version) DO NOTHING;
```

### 1.5 A 81 — já aplicada em produção (achado LGPD, alto)

A `20261181000000_pedido_por_whatsapp_fecha_para_anon.sql` **já foi aplicada em produção em
26/09/2026 às 19:34** — este runbook só está registrando o fato, não instruindo a aplicar. O
achado (auditoria de LGPD): `get_orders_by_whatsapp_v3` continuava executável por `anon` e por
`authenticated` com GRANT PRÓPRIO (sobrevivente ao `REVOKE ... FROM PUBLIC` de uma migration mais
antiga), sem exigir OTP nem limitar tentativa — bastava telefone + e-mail da vítima e um sufixo de
4+ caracteres do id do pedido ou do código de rastreio para ler `customer_data` cru (com CPF
desde a 72). A migration:
1. Revoga `EXECUTE` de `get_orders_by_whatsapp_v3` de `PUBLIC`, `anon` e `authenticated` (nenhum
   caller legítimo restava — ver o cabeçalho do arquivo).
2. Redefine `get_orders_by_otp_v1` (o caminho de convidado que continua em uso) para tirar `cpf`
   de `customer_data` — raiz e dentro de `address`, quando `address` é objeto.

**Independente de 75–80**: não tem preflight nem guarda referenciando `devolucoes`,
`config_pagamento_cartao` nem nenhum outro objeto daquelas migrations — só mexe em
`get_orders_by_otp_v1` e no ACL de `get_orders_by_whatsapp_v3` (conferido lendo o arquivo: zero
menção a tabelas/funções de 75–80). Por isso ela **não tem posição fixa na fila de rollback do
§5** — pode reverter a qualquer momento, sem depender de 79/80 estarem ou não aplicadas.

**Rollback**: `rollback-manual-20261181000000_pedido_por_whatsapp_fecha_para_anon.sql` — devolve
`get_orders_by_otp_v1` ao corpo anterior (byte a byte) e o `GRANT EXECUTE` de
`get_orders_by_whatsapp_v3` para `anon`/`authenticated`. ⚠️ **Rodar este rollback REABRE o
vazamento de LGPD** — só rode se a 81 em si for a causa de um problema, nunca por rotina.

Ledger (se ainda não estiver registrado):

```sql
INSERT INTO supabase_migrations.schema_migrations (version, name) VALUES
  ('20261181000000', 'pedido_por_whatsapp_fecha_para_anon')
ON CONFLICT (version) DO NOTHING;
```

## 2. Publicar as functions — só depois do §1 conferido

1. Abra GitHub → Actions → **"Publicar edge functions (Supabase)"** → *Run workflow*, no branch
   do SHA anotado.
2. Preencha `projeto`: `loja`.
3. Preencha `functions` com:

```text
criar-pagamento, webhook-mercadopago, reconciliar-pagamentos, estornar-pagamento, melhor-envio-etiqueta, send-order-confirmation
```

| Function | Por que sobe |
| --- | --- |
| `criar-pagamento` | Cartão pela Orders API, idempotência por tentativa, recusa que libera a vaga, 3DS. Lê `tentativas_de_pagamento` e `config_pagamento_cartao` (76). Usa `_shared/webpush.ts` (achado #3 abaixo). |
| `webhook-mercadopago` | Recusa ou cancelamento de cartão chamam `liberar_cobranca_do_pedido` (76). Notificação sobre cobrança órfã não aplica pago nem estornado (achado A3). Comprovante com `metodo_online`. Usa `_shared/estorno.ts` e `mapearStatusOrder` (achados #1/#2 abaixo). |
| `reconciliar-pagamentos` | A mesma liberação da vaga e o mesmo comprovante. Usa `_shared/estorno.ts` e `mapearStatusOrder` (achados #1/#2 abaixo). |
| `estornar-pagamento` | Achado #1 abaixo — `_shared/estorno.ts` mudou (`corpoNoLog: false`). |
| `melhor-envio-etiqueta` | Ação `gerar_devolucao_reversa`, que lê e grava `devolucoes`/`devolucao_eventos` (75). |
| `send-order-confirmation` | Importa `_shared/comprovante.ts`, que agora seleciona `metodo_online`. **Publicada antes da 76, a leitura do pedido falha.** |

`credenciais-mercado-pago` **não** precisa subir: de `_shared/mercadopago.ts` só usa
`fetchComTempo` e `BASE_URL_PADRAO`, inalterados nesta branch (confirmado pela checagem abaixo).

**Checagem de publicação da branch do cartão online — CORRIGIDA na 9ª rodada (26/09/2026)**: a
checagem anterior (mesma rodada) usava `git diff 08c0f7aa..HEAD -- .../estorno.ts` — diff de DOIS
PONTOS a partir de `08c0f7aa`, um commit DESTA MESMA branch. Isso compara a árvore de `08c0f7aa`
(que já tem a mudança) com a de `HEAD` (que também tem, sem diferença): o diff mentia "nada mudou"
para qualquer mudança que `08c0f7aa` já tivesse introduzido. O método certo é diff de TRÊS PONTOS a
partir da base REAL da branch (`fe045939`, o commit antes de qualquer trabalho do cartão online):
```
git diff fe045939...fix/cartao-edge-achados --stat -- supabase/functions/_shared
```
Resultado, arquivo por arquivo:
1. **`_shared/estorno.ts`** (+5 linhas, commit `08c0f7aa`): `consultarTransacaoDaOrder` ganhou
   `corpoNoLog: false` — a order consultada ali pode ser de CARTÃO (payer com e-mail e CPF do
   titular), e o log de erro parou de gravar o corpo cru. `grep -rl "_shared/estorno"
   supabase/functions/*/index.ts` — três consumidores: `estornar-pagamento`,
   `reconciliar-pagamentos`, `webhook-mercadopago`. Os dois últimos já estavam na lista;
   **`estornar-pagamento` entra agora**.
2. **`_shared/mercadopago.ts`** (rodada 8): `mapearStatusOrder` generaliza
   `canceled`/`cancelled`/`expired` para qualquer `status_detail`. `grep -rl mapearStatusOrder
   supabase/functions/*/index.ts` — três consumidores: `criar-pagamento`, `webhook-mercadopago`,
   `reconciliar-pagamentos`. As três já na lista — nenhuma function nova por causa deste arquivo.
3. **`_shared/webpush.ts`** (rodada 6): ganhou `dispararSemEsperarCliente`, uma função NOVA e
   ADITIVA — não muda nenhum export existente. `grep -rn dispararSemEsperarCliente
   supabase/functions/*/index.ts` mostra que só `criar-pagamento` a chama (já na lista). Os outros
   seis importadores de `webpush.ts` (`notify-new-order`, `reconciliar-pagamentos`,
   `send-order-confirmation`, `send-otp-email`, `send-push`, `webhook-mercadopago`) não usam a
   função nova — comportamento deles intacto, não entram por causa deste arquivo.

Conclusão: a lista de publicação conjunta desta branch é `criar-pagamento`, `webhook-mercadopago`,
`reconciliar-pagamentos` e `estornar-pagamento` — as quatro já na tabela acima, pelos achados #1
(`_shared/estorno.ts`) e #2 (`_shared/mercadopago.ts`).

O workflow publica uma function por vez e nunca passa `--no-verify-jwt`: quem manda é
`supabase/config.toml`. No fim, ele grava `supabase functions list` no resumo do job. Confira que
as seis aparecem com a data de agora.

## 3. Front

O front sobe pela Vercel quando este código chega ao branch de produção. O PR #666 entra na base
`claude/app-major-upgrade-wmc8x2`, e não direto em produção.

A ordem é sempre esta: primeiro banco e functions (§1–§2), depois o front. Enquanto o front
antigo roda por cima do banco e das functions novas, a combinação é segura:
- o PIX usa o mesmo contrato;
- o cartão continua desligado;
- as telas antigas ignoram os campos novos.

Se a publicação do front for release pública, faça o bump de patch da versão ([AGENTS.md](../../AGENTS.md),
"Versão por release").

O preview da Vercel fala com o banco da loja ([ADR 0001](../decisoes/0001-preview-da-vercel-aponta-para-producao.md)).
Por isso as telas novas só funcionam no preview **depois** do §1.

## 4. Conferência depois do deploy

**Banco e CI**
- [ ] Rode de novo o job "Código x banco (objetos usados)" do PR. Ele tem de ficar verde agora.
- [ ] Faça de novo o §1.1 e o §1.2, se passou tempo ou alguém mexeu no banco.

**PIX, porque ninguém pode perder o PIX**
- [ ] Crie um pedido PIX de teste no app ([DEPLOYMENT.md §5.4–5.5](../../DEPLOYMENT.md)). O QR
  tem de aparecer, sem 503. Depois consulte:

  ```sql
  SELECT id, payment_status, metodo_online, tentativas_de_pagamento, created_at
    FROM public.marketplace_orders ORDER BY created_at DESC LIMIT 3;
  -- o pedido novo: metodo_online = 'pix', tentativas_de_pagamento = 0
  ```

  Se não pagar, o pedido expira sozinho em 30 min e o estoque volta.
- [ ] Os logs de `webhook-mercadopago` mostram `200`, e a reconciliação segue viva
  ([DEPLOYMENT.md §5.6](../../DEPLOYMENT.md)).

**Início, CRM e Financeiro** (como admin)
- [ ] **Início**:
  - carrega o perfil da loja, o "Hoje", os 4 números do mês, a série de 14 dias e as
    pendências;
  - o card do plano diz "Plano ainda não sincronizado com a sua conta" até o hub gravar
    `assinatura_da_loja` ([assinatura da loja](assinatura-da-loja.md)).
- [ ] **Dashboard CRM**:
  - "Visão geral" tem os 8 números e, abaixo, o dashboard antigo intacto;
  - Clientes (segmentos RFM), Canais e "Funil e pedidos" carregam.
- [ ] **Financeiro**:
  - Visão mostra 3 contas: Caixa da loja, Conta bancária e Mercado Pago;
  - Extrato lista as vendas do período, lidas dos pedidos;
  - DRE marca o CMV como estimado;
  - Caixa: abrir com R$ 0,00 e fechar com R$ 0,00 conta como teste. **A sessão fica no
    histórico, porque não há apagar.** Use a observação "teste de publicação".

**Devoluções**
- [ ] Painel: Pedidos → **Devoluções** abre a lista com os chips por status (vazia).
- [ ] Ajustes → Pós-venda → **Trocas e devoluções** mostra 7/30/90 e não aceita arrependimento
  < 7 nem defeito < 30.
- [ ] Cliente: um pedido **entregue e pago** mostra "Solicitar devolução ou troca" dentro da
  janela.
- [ ] **Não gere código de postagem reverso** para testar. A ação compra o envio no Melhor
  Envio e debita o saldo. Só faça isso em devolução real.

**Cartão continua desligado**
- [ ] Ajustes → Formas de pagamento → **Cartão pelo app**: crédito e débito desligados.
- [ ] No checkout, o grupo "No app" oferece só PIX.

## 5. Se der errado — rollback

**Problema só no cartão?** O interruptor é o rollback:
1. Desligue crédito e débito em Ajustes → Formas de pagamento → Cartão pelo app.
2. A `criar-pagamento` confere a configuração a cada chamada e recusa na hora. O checkout
   esconde a opção em até 1 min, por causa do cache.

Não precisa mexer em banco.

**Rollback completo**, na ordem dos cabeçalhos dos `rollback-manual-*`:
1. Desligue o cartão, se estiver ligado. Espere as cobranças de cartão em aberto assentarem:
   até 40 min, que é o teto do 3DS.
2. **Front**, se já subiu: promova de volta, no painel da Vercel, o deployment de produção
   anterior.
3. **Functions**: rode o `publicar-functions.yml` a partir do commit anotado no §0, com as
   mesmas cinco do §2. As versões antigas não leem nada das migrations novas.
4. **Banco**: rode **sempre 80 → 79 → 78 → 77 → 76 → 75** e pare onde o problema acabar. **A 80
   e a 79 só entram na fila se já tiverem sido aplicadas** — as duas são publicadas à parte das
   75–78, em frentes independentes. **A 79 (`cancelar_devolucao_barra_compra_em_voo`) — o
   procedimento completo dela (comando, guardas, ledger) está no §7.5 deste mesmo runbook; aqui
   só a ORDEM RELATIVA importa: ela vem depois da 80 e antes da 78.** Se nenhuma das duas estava
   aplicada, comece direto em 78. **A 81 (`pedido_por_whatsapp_fecha_para_anon`, LGPD, já
   aplicada em produção em 26/09/2026 19:34) é INDEPENDENTE de 75–80** — não referencia nem
   depende de nenhum objeto que elas criam (só `get_orders_by_otp_v1` e o ACL de
   `get_orders_by_whatsapp_v3`) — então revertê-la, se precisar, não tem posição fixa nesta
   fila; ver o aviso sobre reabrir o vazamento de LGPD antes de rodar o rollback dela. Execute
   pelo `psql` com a string de conexão do projeto da loja. **Confira o host antes**, porque o
   workflow não aceita `rollback-manual-*` e o `db-apply` gravaria o rollback no ledger.

   ```bash
   psql "$CONEXAO_DA_LOJA" -1 -v ON_ERROR_STOP=1 -f supabase/migrations/rollback-manual-20261180000000_cliente_nao_cancela_com_cartao_vivo.sql
   # 79, se aplicada: arquivo e comando exatos no §7.5 (mesmo runbook)
   # 81, se precisar reverter (LGPD — reabre o vazamento; ver acima): arquivo
   # rollback-manual-20261181000000_pedido_por_whatsapp_fecha_para_anon.sql, independente da ordem abaixo
   psql "$CONEXAO_DA_LOJA" -1 -v ON_ERROR_STOP=1 -f supabase/migrations/rollback-manual-20261178000000_o_crm_e_o_inicio_leem_a_loja.sql
   psql "$CONEXAO_DA_LOJA" -1 -v ON_ERROR_STOP=1 -f supabase/migrations/rollback-manual-20261177000000_o_financeiro_da_loja_nasce.sql
   psql "$CONEXAO_DA_LOJA" -1 -v ON_ERROR_STOP=1 -f supabase/migrations/rollback-manual-20261176000000_o_cartao_online_nasce.sql
   psql "$CONEXAO_DA_LOJA" -1 -v ON_ERROR_STOP=1 -f supabase/migrations/rollback-manual-20261175000000_a_devolucao_nasce_no_pedido.sql
   ```

**Guardas que recusam a ordem errada** (um `DO` com `RAISE EXCEPTION`, antes de qualquer
`DROP`) — 75, 76, 77 e 80 (a guarda da 79 é descrita no §7.5, não repetida aqui; a 81 não tem
guarda de ordem — é independente das demais, sem referenciar nenhum objeto criado por 75–80):
- a 80 não tem guarda de ordem própria (é sempre a primeira a reverter, se estiver aplicada), e
  seu ROLLBACK tem guarda própria do lado de baixo: recusa se `public.devolucoes` já não
  existir (a 75 já revertida por baixo dela deixaria `update_order_status_atomic` quebrada
  para qualquer cancelamento);
- a 77 recusa se `painel_inicio()`/`crm_visao` existirem;
- a 76 recusa se 78 ou 77 existirem;
- a 75 recusa, nesta ordem: se o CORPO ATUAL de `update_order_status_atomic` ainda tiver a
  guarda da 80 (lido de `pg_get_functiondef`, procurando `verificando:` — a 80 só redefine
  essa função, não cria objeto novo nenhum, então "o objeto existe?" não bastava para
  detectá-la); senão, se `admin_devolucao_liberar_vinculo_reverso` existir (a 79 — checado por
  `EXISTS` sobre `pg_proc.proname`, não por `to_regproc`/`to_regprocedure`: o nome sozinho pode
  ter mais de um overload — a rodada 4 da 79 criou um segundo, `(uuid, boolean)`, ao lado do
  `(uuid)` original — e tanto `to_regproc` quanto uma assinatura fixa dariam falso negativo
  nesse caso); senão, se 78, 77 ou 76 existirem (pelo objeto `config_pagamento_cartao`).
  Reverter a 75 por baixo da 80 ou da 79 sem essas checagens quebraria a guarda de cartão vivo,
  ou as RPCs de devolução da 79, em silêncio, sem erro nenhum.

Recusa com `-1` não deixa nada pela metade. A 78 não tem guarda, porque é a primeira da fila
das 75–78 (a 80 e a 79, quando aplicadas, vêm antes dela).

Antes da 77 e da 75, **exporte os dados**, porque o rollback apaga:

```bash
psql "$CONEXAO_DA_LOJA" -c "\copy public.fin_lancamentos TO 'fin_lancamentos.csv' CSV HEADER"
psql "$CONEXAO_DA_LOJA" -c "\copy public.fin_caixa_sessoes TO 'fin_caixa_sessoes.csv' CSV HEADER"
psql "$CONEXAO_DA_LOJA" -c "\copy public.devolucoes TO 'devolucoes.csv' CSV HEADER"
psql "$CONEXAO_DA_LOJA" -c "\copy public.devolucao_itens TO 'devolucao_itens.csv' CSV HEADER"
psql "$CONEXAO_DA_LOJA" -c "\copy public.devolucao_eventos TO 'devolucao_eventos.csv' CSV HEADER"
```

**O que fica depois do rollback completo:**

| Migration | Apagado | Fica, de propósito |
| --- | --- | --- |
| 81 | Nada é apagado — `get_orders_by_otp_v1` volta ao corpo anterior e `get_orders_by_whatsapp_v3` recebe de volta o GRANT para `anon`/`authenticated`. Independente de 75–80 (sem posição fixa na fila). | ⚠️ REABRE o achado LGPD: convidado sem OTP volta a ler `customer_data` (com CPF) de qualquer pedido só com telefone + e-mail + 4 caracteres do id/rastreio. Só reverta se ELA for a causa do problema. |
| 80 | Nada é apagado — só redefine `update_order_status_atomic`, que volta ao corpo exato da 75 (comprovado byte a byte). | A guarda de cartão vivo desaparece: o cliente volta a poder cancelar pedido com cobrança de cartão possivelmente aprovável. |
| 79 | Ver §7.5 (mesma seção deste runbook) — o conteúdo exato muda a cada rodada de revisão daquela migration; duplicar aqui é o que ficou desatualizado numa revisão anterior deste runbook. | Ver §7.5. |
| 78 | Só funções de leitura. | Nada. |
| 77 | Lançamentos, contas, categorias, sessões de caixa e a linha de `assinatura_da_loja`. Ao reaplicar, o hub precisa sincronizar de novo. | Pedidos, estornos e devoluções, que o Financeiro só lia. |
| 76 | `config_pagamento_cartao`, as RPCs, o gatilho do estorno e as CHECKs. `registrar_estorno_manual` volta ao corpo de `20261072000000`. | As **colunas** `tentativas_de_pagamento`, `metodo_online`, `parcelas` e `estorno_manual_registrado_em`, que guardam como cada pedido foi pago. |
| 75 | Devoluções, itens, trilha, política, RPCs e as policies do bucket. `devolver_estoque`, `get_admin_orders_cancelados_recentes`, `solicitar_estorno` e `update_order_status_atomic` voltam ao corpo original. | As linhas de `order_refunds` abertas por devolução, porque dinheiro não se apaga do ledger. O **bucket `devolucoes` e as fotos**: apagar foto de cliente é decisão do dono. |

Depois do rollback, o job "Código x banco" volta a ficar vermelho enquanto o código que usa
esses objetos estiver no branch. Reaplicar é repetir o §1, porque as migrations são
idempotentes. Rollback seguido de reaplicação foi provado em Postgres 17 efêmero.

## 6. Ligar o cartão — checklist (decisão do Gabriel)

O cartão só liga quando **todos** os itens abaixo passarem num pedido de teste. O interruptor
vale para a loja inteira, porque preview e produção leem a mesma linha. Durante o teste, o
cartão aparece para todo cliente, então faça em horário sem movimento.

**O que muda no PIX (achado B, revisão de risco da migration 80, 26/09/2026 — registro, sem
código de cartão envolvido)**: `podeCobrar` (`criar-pagamento/index.ts`) passou a recusar,
terminal, qualquer pedido com `status = 'cancelled'` — inclusive PIX, que já está em produção.
Antes desta correção, o PIX de um pedido que o CLIENTE cancelou (`update_order_status_atomic`,
`status='cancelled'`, `payment_status` continua `'aguardando'`) seguia "cobrável": reabrir o QR ou
pedir PIX de novo devolvia o mesmo QR de sempre, mesmo com o pedido cancelado. Depois desta
correção, essa mesma chamada devolve 409 terminal "Este pedido foi cancelado." — o comportamento
CERTO (um pedido cancelado não deveria continuar pagável), mas é uma MUDANÇA de comportamento em
produção, independente de o cartão estar ligado ou não — vale para QUALQUER publicação desta
`criar-pagamento` daqui pra frente, não só para quando o cartão for ligado.

**Correção (revisão independente, 26/09/2026)**: o alcance real é mais estreito do que "impede
qualquer tentativa de pagamento seguinte" — esta edge só deixa de MOSTRAR e de CRIAR um QR novo
para um pedido cancelado. `update_order_status_atomic` (a RPC que o cancelamento do cliente chama)
é uma gravação SÓ NO BANCO — ela não cancela a order PIX no Mercado Pago. Um QR antigo, já copiado
pelo cliente antes de cancelar, continua válido no banco emissor e pode ser pago mesmo depois do
cancelamento; esse pagamento chega pelo webhook e vira `pago_apos_expirar` (Política P1), com push
ao admin — não é bloqueado, nem devia ser (é dinheiro de verdade entrando). No deploy, confira que
"Cancelar pedido" tira o botão de gerar/reabrir o QR na tela, mas não assuma que um QR já copiado
parou de funcionar no banco do cliente.

**Preparar**
- [ ] A migration **20261180000000** (`cliente_nao_cancela_com_cartao_vivo`, achado
  independente de risco de 26/09/2026) está aplicada. Sem ela, o cliente pode cancelar um
  pedido cuja cobrança de cartão ainda pode ser aprovada pelo banco — o estoque volta, e se o
  banco aprovar depois, o dinheiro sai do fluxo (`pago_apos_expirar`). Confira com
  `SELECT pg_get_functiondef('public.update_order_status_atomic(uuid,text,text,boolean)'::regprocedure) LIKE '%verificando:%'`
  (`true` = aplicada).
- [ ] A **edge de `fix/cartao-edge-achados`** (021b8720 em diante) está publicada. O 409
  `idempotency_key_already_used` (retry com o MESMO token) JÁ grava o sentinela `verificando:`
  hoje (`fe045939`, `criar-pagamento/index.ts:1598-1607`) — não é esse o gap. A guarda da 80 só
  fecha o cenário de falha de REDE/timeout/5xx na CRIAÇÃO da cobrança (`criar-pagamento/
  index.ts:1742-1745`, resposta 502 sem tocar a vaga) se essa edge estiver no ar — é ela quem
  passa a gravar o sentinela `verificando:` nesse 502 de criação
  (`respostaCartaoAmbiguoNaCriacao`, commit `bf15876f`); sem ela, a vaga fica com
  `gateway_payment_id`/`metodo_online` NULL e a guarda não tem o que ler (gap documentado no
  cabeçalho da 20261180000000 e no teste `tests/banco/cartao-online-viva.cjs`, caso E). Confira
  o commit publicado em `publicar-functions.yml` antes de ligar o cartão.
- [ ] O §4 está completo, e o PIX pelo app está ligado. O painel trava o cartão sem o PIX,
  porque os dois usam a mesma credencial.
- [ ] **Cartão de teste só aprova com credencial de TESTE** do Mercado Pago
  ([DEPLOYMENT.md §5.1–5.2](../../DEPLOYMENT.md)). Com a chave de produção da loja, o teste vira
  cobrança real. Escolha um dos dois caminhos:
  - **(a)** Troque temporariamente as chaves da loja pelas de teste em Ajustes → Pagamentos →
    Mercado Pago. Enquanto isso, o PIX da loja também fica em modo de teste. Crie o secret
    `MP_SANDBOX_PAYER_EMAIL` (e-mail `@testuser.com`), porque a Orders API recusa outro
    e-mail em teste.
  - **(b)** Faça o teste com um cartão real, de valor baixo, e estorne pelo painel.
- [ ] Ligue crédito (e débito, se for oferecer) em Ajustes → Formas de pagamento → Cartão pelo
  app. Parcelas: comece em 1x ou no teto que a loja decidir.

**Testar, com o DevTools aberto na aba Console**
- [ ] **O documento já é o do deploy sem COEP.** No Console, `crossOriginIsolated` tem de dar
  `false`; na aba Network, a resposta do documento não pode trazer
  `Cross-Origin-Embedder-Policy`. Se trouxer, o service worker serviu o HTML antigo do cache:
  aceite a atualização do app ou faça um reload que ignora o cache (Shift+Reload no
  navegador), confira de novo e só então siga. Sem isso, o Brick pode aparecer barrado por um
  cabeçalho que já não está no ar.
- [ ] **O Brick carrega**: com o formulário do cartão aberto, o Console **não pode** ter
  `ERR_BLOCKED_BY_RESPONSE` nem `Refused to frame` (CSP `frame-src`). Campos vazios ou
  cinzas = barrado. **Barrado: não ligue.** (O `COEP: credentialless` que travava o Brick
  foi removido do `vercel.json` em 26/09/2026 — decisão do dono; ver
  [spec do cartão](../superpowers/specs/2026-09-26-cartao-online-design.md), decisão 7.)
- [ ] **Aprovado**:
  1. Pague com o cartão de teste, titular `APRO`.
  2. A tela diz "Pagamento aprovado — confirmando o pedido".
  3. Pelo webhook, o pedido vira `pago`, com `metodo_online = 'credito'` e `parcelas`
     preenchido.
  4. O comprovante diz "Cartao de credito pelo site".
- [ ] **Recusado**:
  1. Pague com o titular de recusa da doc do MP, como `OTHE` ou `FUND`.
  2. A tela mostra o motivo, "Tentar outro cartão" e "Pagar com PIX".
  3. O pedido **continua `aguardando`**, com `gateway_payment_id` nulo e
     `tentativas_de_pagamento` subindo 1.
  4. O estoque **não** volta.
- [ ] **Recusa → PIX na mesma reserva**: depois da recusa, "Pagar com PIX" gera o QR. A chave
  nova é `<pedido>:<n>`.
- [ ] **3DS**, feito no **Chrome** (de preferência Android), que é onde o atributo
  `credentialless` do iframe do desafio age (ver a spec, decisão 7):
  1. Use o cenário de desafio da doc "Integrar 3DS" da Orders API (link na spec).
  2. O desafio abre no iframe. Isso depende do domínio da URL estar no `frame-src` e do
     `postMessage` de conclusão vir de origem do MP.
  3. Concluído, o webhook confirma.
  4. Abandonado com troca para PIX, a order `action_required` é cancelada no MP e o PIX nasce.
  5. O `expires_at` do pedido foi estendido, até 40 min.

  Se o desafio não concluir no Chrome, o primeiro suspeito é o atributo `credentialless` do
  iframe (`PagamentoComCartao.tsx`). Tire o atributo e repita o teste antes de desistir do
  cartão.
- [ ] **Em análise** (titular `CONT`): a tela diz que aguarda o banco. Pedir PIX nesse estado dá
  409 recuperável, sem uma segunda cobrança.
- [ ] **Idempotência**:
  1. Com duas abas no mesmo pedido, ou com duplo envio, pague com dois cartões na mesma
     tentativa.
  2. No painel do MP, só pode existir **uma** order com esse `external_reference` por
     tentativa, porque a chave é `<pedido>:c<n>`, sem o token.
  3. Os logs da `criar-pagamento` não podem ter `cartao_orfao`.
  4. **Resíduo aceito (achado #2, 8ª rodada de risco)**: se a MESMA chamada que troca de forma
     (PIX→cartão, cartão morto→cartão novo, sentinela liberado→cartão novo) tiver a criação do
     cartão NOVO falhando de novo (rede/timeout/5xx), a vaga fica presa até `expires_at` — a order
     nova nasce milissegundos depois do limite que a PRÓPRIA chamada acabou de gravar, dentro da
     margem de 15s, e nunca libera sozinha. Sem dinheiro em jogo (é o cliente da PRÓPRIA chamada) e
     raro (exige duas falhas seguidas). Se aparecer no teste, confirme que é ISTO antes de tratar
     como bug novo.
- [ ] **Débito**, se ligado: o Brick mostra só o que o MP aceita para a conta. Na Orders API do
  Brasil, isso é débito Elo.
- [ ] Todos os eventos acima têm `200` nos logs do `webhook-mercadopago`.

**Comportamentos do Mercado Pago a confirmar no sandbox** (escritos no código sem prova contra
a API real):
- [ ] **Busca de orders** (`GET /v1/orders?external_reference=...&begin_date=...&end_date=...`,
  usada para resolver o sentinela — achados B1/B2, 5ª revisão de risco). Meça no sandbox, com
  uma order de cartão de teste, ANTES de qualquer outro item deste checklist:
  - o nome do campo da lista na resposta (`results`, `elements`, ou outro);
  - se cada order traz `external_reference`, `status`/`status_detail` na raiz, um campo de data
    de CRIAÇÃO (anote o nome exato — `date_created`, `created_date`, ou outro) e
    `transactions.payments[].payment_method.type`;
  - **`external_reference` em TODA order da lista, sem exceção**: o filtro do cliente (B2, 5ª
    revisão) descarta qualquer order sem esse campo batendo com o pedido — se o MP omitir ou
    truncar `external_reference` em algum caso (ex.: order antiga, criada antes de o app
    começar a mandá-lo), o filtro descarta a lista inteira, a busca nunca encontra nada, e a
    liberação do sentinela nunca resolve;
  - o formato de data que `begin_date`/`end_date` aceitam;
  - o atraso de indexação entre criar (ou mudar o status de) uma order e ela aparecer nesta
    busca.

  Se qualquer um desses vier diferente do que o código espera, **o cartão fica DESLIGADO**. Sem
  a busca confiável, a liberação da vaga degrada, em silêncio, para "PIX bloqueado até
  `expires_at`" — inclusive no caso mais comum, a recusa cuja resposta se perdeu (S1 da 3ª
  rodada de achados de risco).
- [ ] **Desvio de relógio entre o `date_created` do MP e o relógio desta function** (achado #6, 8ª
  rodada de risco): meça a diferença entre o instante em que uma order de teste é criada (medido
  por ESTE servidor, `Date.now()` logo após o POST responder) e o `date_created` que a Orders API
  devolve para ela. `MARGEM_LIBERAR_APOS_LIMITE_MS` (15s, `resolverSentinela`) depende deste
  desvio ser pequeno — se o relógio do MP correr atrasado por mais de ~15s, uma order NOVA
  (legítima) pode parecer "criada antes do limite" e nunca liberar; se correr adiantado, o
  problema é o oposto (o achado B1 original: uma order da tentativa ANTERIOR parece "depois" do
  limite e libera errado). Se o desvio medido for maior que uma fração pequena da margem, ela
  precisa subir.
- [ ] **Idempotência da Orders API, corrigida na 7ª rodada** (a frase anterior aqui estava
  errada): a mesma `X-Idempotency-Key` com CORPO diferente (token novo a cada tentativa, por
  exemplo) devolve `409 idempotency_key_already_used`, NÃO a mesma order — é esse 409 que vira
  sentinela (`verificando:<pedido>:c<n>:<limiteInferiorMs>`). Só com o CORPO idêntico o MP faz
  replay e devolve a MESMA order — é o que permite o retry de cartão sobre o sentinela DA MESMA
  tentativa repetir o POST com a mesma chave sem duplicar a cobrança (item 2, 7ª rodada). Confirme
  os dois casos no sandbox antes de ligar; é a premissa do achado A1.
- [ ] **A Orders API valida o CORPO antes ou depois de olhar a idempotência?** (achado #3, 8ª
  rodada de risco — UNVERIFIED, o código assume o pior caso por precaução). No sandbox: crie uma
  order de cartão de teste com uma chave de idempotência `K`; repita o POST com a MESMA chave `K`,
  corpo DIFERENTE, mas com um dado INVÁLIDO de propósito (token de cartão malformado). Se a
  resposta for `409 idempotency_key_already_used` (a idempotência venceu, o corpo nem foi
  validado), o código está mais conservador do que precisa — soltar a vaga só em 201/402 nunca
  perde a c0. Se a resposta for `400` (o corpo foi validado primeiro, ANTES de olhar a chave), o
  código já está certo em NUNCA soltar a vaga com um 400 sobre um sentinela — é exatamente o caso
  que motivou a correção (a c0 pode estar viva por baixo do 400, achado R7-V).
- [ ] Os códigos de 400 que culpam o dado do cartão são `invalid_card_token`,
  `card_token_not_found` e `bad_filled_card_data`. A lista não foi conferida na doc do MP
  (`erro400EhDeDadoDoCartao`). Qualquer outro 400 vira 502.
- [ ] Onde vive a URL do desafio 3DS (`transaction_security.url`), e se ela carrega em iframe.
- [ ] A notificação da order `canceled`, na troca de cartão para PIX, chega e responde
  `nada_a_liberar` ou `cobranca_liberada`, sem cancelar o pedido.
- [ ] Juros de parcelamento: a conferência de ±R$ 0,05 compara o `total_amount` pedido. Confira
  que um parcelado com juros do comprador não vira "valor divergente".

**Limpar e ligar de verdade**
- [ ] Volte as chaves de produção da loja e **apague** o secret `MP_SANDBOX_PAYER_EMAIL`. Deixar
  o secret em branco não basta ([DEPLOYMENT.md §5.2](../../DEPLOYMENT.md)).
- [ ] Cancele os pedidos de teste no painel e confira o estoque.
- [ ] Só então o Gabriel liga crédito e débito para os clientes. Anote a data. Nas primeiras
  vendas, olhe os logs do webhook e o push de cobrança órfã aos admins (`cartao_orfao`).

## 7. Publicar a 79 (compra em voo da etiqueta reversa) — depois de 75–78 no ar

A revisão de risco pré-publicação da etiqueta reversa (achado A1, com a rodada 2 achados
R1/R2) achou que `cancelar_devolucao` (nascida na 75) deixava cancelar uma devolução ENQUANTO a
compra do envio reverso estava em voo no Melhor Envio, ou sem avisar o lojista quando o código já
tinha saído pago. A correção é [`20261179000000_cancelar_devolucao_barra_compra_em_voo.sql`
](../../supabase/migrations/20261179000000_cancelar_devolucao_barra_compra_em_voo.sql) — redefine
`cancelar_devolucao` (mesma assinatura da 75) e cria `admin_devolucao_liberar_vinculo_reverso`
(nova: a "saída" para um vínculo real preso sem código — edge que morreu, liberação que falhou,
ou Sandbox do Melhor Envio, que nunca gera o código da reversa).

Esta migration **não estava aplicada em nenhum lugar** quando foi escrita — por isso sobe como
passo À PARTE, depois que 75–78 já estiverem no ar e conferidos (§1–§4 acima), nunca junto com
elas: ela só faz sentido em cima do `cancelar_devolucao` que a 75 publicou.

A mesma leva de achados também mudou a edge `melhor-envio-etiqueta` (retry + degradação do
vínculo preso para reserva vencida, achado R3; a frase do carrinho em
`tratarVinculoNaoConfirmado` também condicional ao DELETE, achado R4; um evento além do toast
quando a devolução muda de status durante o checkout, achado N2). A function já é uma das cinco
do §2.

**Ordem obrigatória (achado 2, rodada 4): publique `melhor-envio-etiqueta` (§2) ANTES do §7.1
(aplicar a 79), nunca depois.** A function desta branch só GRAVA em `devolucao_eventos` (o
marcador de pagamento, achados R5/1a/1b/1c) — não chama nada que a 79 cria, então funciona sem
ela. Já a 79 sozinha, sem a function nova, cria uma RPC cujos guards de marcador nunca disparam
(a edge antiga nunca grava o marcador) — inofensivo, mas sem a proteção. Publicando a function
primeiro, o marcador já está sendo gravado no instante em que a 79 entra no ar, encurtando ao
máximo a janela sem proteção. Se a publicação de functions do §2 já tiver acontecido ANTES desta
migration por outro motivo, republique **só** `melhor-envio-etiqueta` pelo mesmo workflow
(`publicar-functions.yml`, `functions: melhor-envio-etiqueta`) — mas sempre antes do §7.1, nunca
depois.

**Vínculos criados antes da function nova estar no ar não têm marcador nenhum.** Qualquer
`me_reverse_id` real gravado pela edge de produção ANTES da publicação desta function (medido
pela revisão em 26/09/2026 17:50 UTC) não tem — e nunca vai ter — o evento 'sistema' que os
guards da 79 procuram. Para esses vínculos específicos, a checagem manual em "Meus envios" (§7.6)
é a ÚNICA proteção — a RPC não teria como recusar sozinha.

**Rodada 3 (achado R5, DINHEIRO)**: a revisão seguinte achou que
`admin_devolucao_liberar_vinculo_reverso` (a "saída" da rodada 2) conseguia soltar um vínculo que
JÁ TINHA SIDO PAGO no Melhor Envio, mas cujo código de postagem ainda não tinha voltado — nesse
caso a gravação do código, na edge, batia 0 linhas sem erro e a resposta virava `ok: true` sem
nada salvo, abrindo a porta para uma segunda compra. A RPC agora recusa soltar quando um marcador
de pagamento confirmado (gravado pela edge, evento 'sistema') existir para o `me_reverse_id`
atual — ver o procedimento operacional no §7.6. A nota do evento também passou a distinguir
reserva de vínculo real (achado N-a).

**Rodada 4 (achados 1/2/3/4/5, scratchpad rev79/ataque3.cjs)**: a revisão seguinte achou que o
marcador da rodada 3 só era gravado em UM ponto (logo após o checkout da PRIMEIRA chamada) —
faltando no caminho "vinculado" (2ª chamada em diante), sem aviso quando a própria gravação do
marcador falhava, e sem nada registrado quando o checkout ficava INDETERMINADO (5xx/exceção).
Também achou que `is_admin()` (baseline) aceita `service_role`/`postgres` sem sessão nenhuma — um
atalho que este runbook, na rodada 3, afirmava não existir. Correções: (a) o caminho vinculado
também grava o marcador quando prova pagamento; (b) a gravação tenta 2x e a resposta avisa se as
duas falharem; (c) um marcador DIFERENTE ("pagamento indeterminado") cobre o caso ambíguo — a RPC
recusa por padrão, mas libera com o novo argumento `p_conferi_no_melhor_envio = true`, só depois
de um admin ter conferido "Meus envios"; (3) a RPC agora também exige `auth.uid() IS NOT NULL`,
fechando o atalho de `service_role`/`postgres`; (4) o guard trocou `LIKE` por `strpos` (substring
literal, sem curinga) e ganhou um teste (`tests/marcador_pagamento_reverso_contrato_test.ts`) que
amarra o texto da edge ao texto da RPC.

**Rodada 5 (achados 1/2/3/4/5, scratchpad rev79/ataque4.cjs + fn8/)**: a revisão seguinte achou
que o guard do marcador indeterminado (rodada 4) só recusava soltar o vínculo QUANDO esse marcador
existia — um vínculo REAL sem NENHUM marcador (edge derrubada no meio do caminho, ou qualquer link
de produção anterior a esta proteção nascer) passava direto, SEM pedir confirmação nenhuma (achado
G5, dinheiro). Correção: a RPC agora "nega por padrão" — para QUALQUER `me_reverse_id` REAL (a
fase de reserva continua isenta), `p_conferi_no_melhor_envio = true` é OBRIGATÓRIO, com ou sem
marcador; o marcador indeterminado virou só informação na mensagem de recusa. Achado 3 (G7): o
texto do marcador indeterminado também mudou para NEUTRO (o dono da devolução lê essa nota por
RLS, mesmo motivo do achado R2) — a âncora do `strpos` mudou junto. Achados 2/4 (edge, sem mudança
de SQL): a exceção do `generate` depois do pagamento confirmado agora avisa corretamente se o
marcador falhou (antes o aviso se perdia), o marcador indeterminado também ganhou a retentativa de
2x, e o aviso de marcador-não-gravado saiu da resposta 200 (ruído: o código já escrito basta para
a RPC recusar sozinha). Ver §7.6 atualizado.

**Achado 5 (rodada 5) — publicação da function em conjunto com `fix/etiqueta-le-endereco-da-conta`:**
a edge `melhor-envio-etiqueta` só pode ser publicada a partir de um commit que contenha ESTA
branch (`fix/devolucao-pos-revisao`) **E** a branch `fix/etiqueta-le-endereco-da-conta` (a etiqueta
nacional lendo o endereço da conta, não do pedido). Publicar a partir de uma branch sozinha
apagaria a correção da outra — as duas mexem no mesmo arquivo `index.ts`. O coordenador faz o
merge das duas ANTES de publicar; não publique esta function isolada.

### 7.0 Antes de aplicar

- [ ] 75–78 já aplicadas, com §1.1 e §1.2 dando `ok = true` em TODAS as linhas.
- [ ] Confirme que o corpo VIVO de `cancelar_devolucao` ainda é o que a 75 publicou (ninguém
  tocou por fora, e portanto o rollback de 79 vai devolver o corpo certo):

```sql
SELECT md5(replace(prosrc, E'\r', '')) = '45c56a39cc29f31ec5ff904f1929737e' AS igual_ao_corpo_da_75
  FROM pg_proc WHERE proname = 'cancelar_devolucao' AND pronamespace = 'public'::regnamespace;
```

  Se `false`, **pare** — o rollback de 79 promete restaurar exatamente esse corpo (conferido por
  md5 no teste estático); se o corpo vivo já é outro, o rollback restauraria a função errada.

### 7.1 Rodar o workflow

Mesmo workflow do §1 (`aplicar-migrations.yml`), campo `migracoes` com um arquivo só:

```text
20261179000000_cancelar_devolucao_barra_compra_em_voo.sql
```

### 7.2 Conferir o que nasceu (SQL Editor, só leitura)

Nenhuma linha abaixo grava em `devolucoes` — é tudo leitura de catálogo (`pg_proc`,
`has_function_privilege`). **Não teste cancelando uma devolução real** só para conferir a
migration; isso é o único jeito de checar 79 sem tocar em pedido de cliente nenhum.

```sql
SELECT checagem, valor, esperado, COALESCE(valor = esperado, false) AS ok FROM (VALUES
  ('79 cancelar_devolucao: corpo novo',          (SELECT md5(replace(prosrc, E'\r', '')) FROM pg_proc WHERE proname = 'cancelar_devolucao' AND pronamespace = 'public'::regnamespace), '74fd42d04f8ea55257a0aec73bfcabc1'),
  ('79 admin_devolucao_liberar_vinculo_reverso: corpo', (SELECT md5(replace(prosrc, E'\r', '')) FROM pg_proc WHERE proname = 'admin_devolucao_liberar_vinculo_reverso' AND pronamespace = 'public'::regnamespace), '83144be5ac2bc52f07f02274023a83ab'),
  ('79 as duas SECURITY DEFINER',                 (SELECT count(*)::text FROM pg_proc WHERE proname IN ('cancelar_devolucao', 'admin_devolucao_liberar_vinculo_reverso') AND pronamespace = 'public'::regnamespace AND prosecdef), '2'),
  ('79 as duas com search_path fixo',             (SELECT count(*)::text FROM pg_proc WHERE proname IN ('cancelar_devolucao', 'admin_devolucao_liberar_vinculo_reverso') AND pronamespace = 'public'::regnamespace AND proconfig @> ARRAY['search_path=public']), '2'),
  ('rpc nova tem só UM overload (rodada 4: o DROP limpou o de 1 argumento)', (SELECT count(*)::text FROM pg_proc WHERE proname = 'admin_devolucao_liberar_vinculo_reverso' AND pronamespace = 'public'::regnamespace), '1'),
  ('cancelar_devolucao continua p/ authenticated', has_function_privilege('authenticated', 'public.cancelar_devolucao(uuid)', 'EXECUTE')::text, 'true'),
  ('rpc nova SAI de anon',                         has_function_privilege('anon', 'public.admin_devolucao_liberar_vinculo_reverso(uuid, boolean)', 'EXECUTE')::text, 'false'),
  ('rpc nova executa p/ authenticated',            has_function_privilege('authenticated', 'public.admin_devolucao_liberar_vinculo_reverso(uuid, boolean)', 'EXECUTE')::text, 'true')
) AS c(checagem, valor, esperado)
ORDER BY ok, checagem;
```

(O md5 de `cancelar_devolucao` e o `45c56a39cc29f31ec5ff904f1929737e` do §7.0 foram conferidos em
26/09/2026 (rodada 2) e continuam valendo — nenhuma rodada seguinte tocou o corpo desta função. O
md5 de `admin_devolucao_liberar_vinculo_reverso` mudou de novo na rodada 5 (achado 1: o guard do
marcador indeterminado virou o guard "negar por padrão", exigindo `p_conferi_no_melhor_envio`
sempre para um id real; achado 3: a âncora do `strpos` mudou de texto) e outra vez na rodada 6a
(achado 2, dinheiro: `NOT p_conferi_no_melhor_envio` virou `p_conferi_no_melhor_envio IS NOT
TRUE` — um `NULL` explícito não podia mais se comportar como `true`) — o valor acima já é o da
rodada 6a. Recompute-o de novo se o conteúdo do arquivo mudar antes de publicar.)

### 7.3 Marcadores — o filtro do §1.2 precisa alargar

O script do §1.2 já filtra `Object.keys(VERIFICACOES)` por `/^(2026117[5-8]|20261180)/` (75–78 e
a 80) — mas a 79 (esta migration) não entra nesse padrão. Troque por
`/^(2026117[5-8]|20261179|20261180)/` antes de gerar `conferir-marcadores.sql` desta vez, para
cobrir 75–78, a 79 e a 80 de uma vez. **Não fixe aqui quantas linhas o total deveria ter** — a
lista de marcadores muda a cada rodada de revisão de qualquer uma das três; rode a consulta e
confira `ok = true` em TODAS as linhas que ela devolver.

### 7.4 Ledger

```sql
INSERT INTO supabase_migrations.schema_migrations (version, name) VALUES
  ('20261179000000', 'cancelar_devolucao_barra_compra_em_voo')
ON CONFLICT (version) DO NOTHING;
```

### 7.5 Rollback — 79 ANTES de 78 (e DEPOIS de 80)

A ordem GLOBAL de rollback (§5, ajustada pela branch `fix/cancelar-com-cartao-vivo` para incluir a
80) é **80 → 79 → 78 → 77 → 76 → 75**. Se 79 estiver aplicada e for preciso desfazer o PR inteiro,
rode o rollback dela depois do de 80 e **antes** de tocar em 78/77/76/75 — ela redefine uma função
que mora na 75 e cria uma RPC que só faz sentido com a tabela `devolucoes` (75) no ar:

```bash
psql "$CONEXAO_DA_LOJA" -1 -v ON_ERROR_STOP=1 -f supabase/migrations/rollback-manual-20261179000000_cancelar_devolucao_barra_compra_em_voo.sql
```

Depois disso, a ordem do §5 (78 → 77 → 76 → 75) continua igual. Se só 79 precisar sair (o
problema é isolado nela), o rollback acima sozinho já basta — `cancelar_devolucao` volta ao corpo
da 75 e `admin_devolucao_liberar_vinculo_reverso` é derrubada; nada em 75–78 é tocado.

**Por que a ORDEM importa (N-a/N-c, rodada 3) — e as DUAS guardas que agora cobrem os dois
sentidos:** a GUARDA DE ORDEM que o rollback da 75 tinha originalmente
(`rollback-manual-20261175000000_...sql`, bloco `DO $$ ... RAISE EXCEPTION 'reverta 78/77/76 antes
desta (75)' ... $$`) foi escrita ANTES de a 79 existir — sozinha, ela não sabia nada sobre
`admin_devolucao_liberar_vinculo_reverso`. Revertendo a 75 com a 79 ainda aplicada, essa guarda não
barrava: o rollback da 75 derruba `public.devolucoes` sem `CASCADE` (um `DROP TABLE` simples não
enxerga o corpo de uma função plpgsql como dependência de catálogo), e
`admin_devolucao_liberar_vinculo_reverso` sobrevivia — ÓRFÃ, apontando para uma tabela que não
existe mais, falhando com `42P01` (relation does not exist) na primeira chamada seguinte. **Isso
já não depende só desta instrução:** o rollback da 75 (branch `fix/cancelar-com-cartao-vivo`,
migration 80) agora recusa por si só, checando `admin_devolucao_liberar_vinculo_reverso` por NOME
em `pg_proc` — reverter 75 com a 79 viva não passa mais batido; e o rollback da 79 (achado do
addendum, rodada 4) recusa cedo com `to_regclass('public.devolucoes') IS NULL` — reverter 79 sem a
75 no ar também não passa batido. As duas guardas cobrem a ordem errada nos dois sentidos; a
instrução acima (80 → 79 → 78 → 77 → 76 → 75) continua sendo o caminho feliz, sem depender de
decorar a ordem de cabeça.

### 7.6 Usar `admin_devolucao_liberar_vinculo_reverso` em produção (achados R5/1/2/3)

Esta RPC é um escape hatch — só deve ser chamada quando um vínculo real (`me_reverse_id` que não é
`reservando:...`) fica preso sem código de postagem por tempo demais (edge que morreu entre a
reserva e o vínculo, liberação que falhou nas duas tentativas apesar da degradação automática —
achado R3 —, ou Sandbox do Melhor Envio, que nunca gera o código da reversa). **Achado 1 (rodada
6b): desde essa rodada existe UI para ela** — o caminho preferido é o painel (abaixo); o `curl`
manual (§7.6, "via REST") continua valendo como saída de emergência (painel fora do ar, ou uma
checagem direto pelo SQL Editor).

**QUANDO usar — confira ANTES de chamar, SEMPRE (achado 1, rodada 5, "negar por padrão"):**

Desde a rodada 5, a RPC exige `p_conferi_no_melhor_envio = true` para QUALQUER `me_reverse_id`
REAL (não uma reserva) — com ou sem marcador algum gravado. Isso fecha o achado G5 (um vínculo
real sem NENHUM marcador saía solto sem pedir confirmação nenhuma), mas também quer dizer que a
checagem manual em "Meus envios" deixou de ser condicional a existir um marcador indeterminado: é
SEMPRE o primeiro passo, nunca uma formalidade para "destravar" o parâmetro.

1. Abra "Meus envios" na conta do Melhor Envio da loja e procure o `me_reverse_id` da devolução
   (`SELECT me_reverse_id FROM public.devolucoes WHERE id = '<id-da-devolucao>'`).
2. **Se o envio aparece como PAGO** (mesmo sem código de rastreio ainda): NÃO chame a RPC. Se o
   marcador de pagamento confirmado (achado R5) foi gravado, a RPC recusa com `22023` MESMO com
   `p_conferi_no_melhor_envio = true` — sem exceção possível. Mas esse marcador só existe se a edge
   chegou a rodar até o checkout responder; se o pagamento foi confirmado por outro caminho (ex.:
   um checkout manual feito direto no Melhor Envio, fora da edge, ou um vínculo criado ANTES de a
   function nova estar no ar — ver o aviso no início do §7), o marcador pode faltar — e como a RPC
   agora SEMPRE aceita `p_conferi_no_melhor_envio = true` para liberar um id real sem marcador
   nenhum, ela soltaria esse vínculo pago se você mandar essa confirmação sem ter checado de
   verdade. A checagem manual em "Meus envios" é a ÚNICA linha de defesa nesse caso — a RPC não tem
   como saber sozinha.
3. **Se o checkout ficou INDETERMINADO** (achado 1c, rodada 4 — 5xx ou exceção, sem confirmar nem
   recusar o pagamento) **ou se não há registro de pagamento nenhum** (achado 1, rodada 5 — nem
   confirmado nem indeterminado; o caso mais comum de "edge que morreu no meio do caminho"): a RPC
   recusa por padrão com `22023` nos dois casos — a mensagem diz qual dos dois é (cita o marcador
   indeterminado quando ele existe; diz que não há registro nenhum quando não existe). Só depois de
   confirmar em "Meus envios" que o envio NÃO foi pago, chame de novo passando
   `p_conferi_no_melhor_envio = true`.
4. **Se o envio ainda está no CARRINHO sem pagamento** (ex.: o checkout nunca rodou, ou rodou e foi
   recusado sem o retry conseguir soltar o vínculo): remova o item do carrinho no Melhor Envio
   ANTES de liberar aqui — a RPC só apaga o vínculo no NOSSO banco, nunca mexe no carrinho do
   provedor.
5. **Se o código de postagem já saiu**: não há nada para "destravar" — a RPC recusa com `22023`
   ("o código de postagem já foi emitido"). Cancelar o envio é direto no Melhor Envio.

**COMO usar — pelo painel (rodada 6b, caminho preferido):**

Abra a devolução na tela Devoluções do painel administrativo. Quando ela está `aprovada`, o
método é etiqueta reversa, há um `me_reverse_id` REAL (não uma reserva) e o código de postagem
ainda não saiu, um bloco amarelo aparece em "Próximo passo"
(`src/components/admin/devolucoes/AcoesDaDevolucao.tsx`, `podeLiberarVinculoReverso` em
`src/lib/devolucao.ts` — o mesmo guard "negar por padrão" da RPC, achado 1, rodada 5, espelhado no
front só para decidir visibilidade):

1. O bloco mostra o `me_reverse_id` (o id do envio no Melhor Envio) para você achar o envio em
   "Meus envios" — é o MESMO id que aparece lá.
2. Abra "Meus envios" na conta do Melhor Envio da loja e procure esse id. **Se ele aparecer como
   PAGO, NÃO marque a confirmação** — cancele o envio direto no Melhor Envio; volte ao passo 2 da
   lista "QUANDO usar" acima.
3. Só depois de confirmar que o envio NÃO foi pago, marque a caixa "Conferi em Meus envios que
   este envio NÃO foi pago" — o botão "Liberar vínculo preso" fica desabilitado até isso acontecer
   (não é possível liberar sem passar por essa confirmação).
4. O botão chama a RPC com `p_conferi_no_melhor_envio: true` sempre (o painel nunca chama com
   `false` ou omitindo o parâmetro) — a RPC ainda recusa sozinha, sem exceção nenhuma, se um
   marcador de pagamento CONFIRMADO existir (achado R5). Achado 3 (rodada 6c): como o painel
   SEMPRE manda `true`, as recusas que ele de fato alcança são só cinco — `22023` confirmado
   (achado R5), `22023` sem vínculo ou `22023` código já emitido (as duas últimas são CORRIDAS: o
   estado mudou no banco entre abrir a ficha e clicar), `42501` (sessão perdeu admin no meio do
   caminho) e `P0002` (a devolução sumiu). "Indeterminado" e "sem registro" (achado 1, rodada 5)
   só acontecem SEM esse parâmetro — inalcançáveis pelo painel, só pelo `curl` da seção "via REST"
   abaixo. Qualquer uma dessas cinco recusas aparece num toast de erro com a MESMA frase que a RPC
   devolveu — o painel nunca troca o texto por uma mensagem genérica, para o motivo nunca ficar
   escondido.
5. Com sucesso, um toast confirma e a ficha relê: o bloco amarelo some (o vínculo não está mais
   preso) e a devolução volta a poder ser cancelada pelo cliente ou seguir para gerar um código
   novo. Achado 1 (rodada 6c, DINHEIRO): a confirmação (a caixa marcada) é amarrada ao
   `me_reverse_id` da tela E reseta depois de QUALQUER resultado (sucesso ou recusa) — **não é
   possível liberar sem passar por essa confirmação de novo**, nem reaproveitar uma confirmação
   antiga se a MESMA ficha ganhar um vínculo novo por baixo (ex.: "Gerar código de postagem"
   comprando de novo com o checkout indeterminado, sem a tela remontar).

Testes: `tests/front/devolucao-liberar-vinculo-reverso.test.tsx` (visibilidade nos dois sentidos,
botão só habilita depois da confirmação, chamada com `p_conferi_no_melhor_envio: true`, as três
recusas da RPC aparecem sem esconder o motivo) e `tests/front/devolucao-regras-puras.test.ts`
(`podeLiberarVinculoReverso`, `lerResultadoLiberacaoVinculo`).

**COMO chamar — via REST, fallback sem painel (nunca como `postgres`/service-role sem JWT):**

A RPC checa `public.is_admin() AND auth.uid() IS NOT NULL`. **Correção (achado 3, rodada 4): a
versão da rodada 3 deste runbook dizia que não havia atalho de `service_role`/`postgres` — isso
era falso.** `is_admin()` (baseline) aceita `current_setting('role') IN ('postgres',
'service_role')` mesmo sem sessão nenhuma, e a rodada 3 da RPC não tinha proteção extra contra
isso (prova em `ataque3.cjs`, cenário F3: `SET ROLE service_role` sem login nenhum liberava o
vínculo). A rodada 4 fechou esse atalho, exigindo `auth.uid() IS NOT NULL` além de `is_admin()` —
uma sessão do SQL Editor do Supabase (ou um `psql` direto como `postgres`, ou `SET ROLE
service_role`/`postgres` sem JWT) não carrega um JWT de usuário e recebe `42501`, mesmo sendo uma
conexão de superusuário ou tendo o papel de service_role. O jeito de chamar de verdade:

1. Faça login no painel administrativo como um admin de verdade (perfil com `role = 'admin'`).
2. O client Supabase deste app (`src/lib/supabase.ts`) NÃO expõe `window.supabase` — não há atalho
   de console pronto. Pegue o token da PRÓPRIA sessão logada: DevTools → Application → Local
   Storage → chave `sb-<project-ref>-auth-token` → campo `access_token` do JSON, e cole no prompt
   abaixo SEM deixar rastro no histórico do shell nem na tela:

   ```bash
   read -rs TOKEN   # cole o access_token aqui e aperte Enter (não aparece na tela)
   ```

3. Com `$TOKEN` na variável, chame a RPC por REST (troque `{SUPABASE_URL}` e `{ANON_KEY}` — a
   chave pública do projeto, a mesma que `VITE_SUPABASE_PUBLISHABLE_KEY`). Achado 1 (rodada 5): para
   um `me_reverse_id` REAL, `p_conferi_no_melhor_envio: true` já é OBRIGATÓRIO desde a primeira
   chamada — só depois de ter conferido "Meus envios" (passo 1 acima). Chamar sem o parâmetro só
   funciona para soltar uma RESERVA (`reservando:...`), o que normalmente já se resolve sozinho na
   próxima tentativa da edge, sem precisar desta RPC:

   ```bash
   curl -X POST "{SUPABASE_URL}/rest/v1/rpc/admin_devolucao_liberar_vinculo_reverso" \
     -H "apikey: {ANON_KEY}" \
     -H "Authorization: Bearer $TOKEN" \
     -H "Content-Type: application/json" \
     -d '{"p_id": "<id-da-devolucao>", "p_conferi_no_melhor_envio": true}'
   ```

   Se a recusa vier mesmo assim com `22023` e a mensagem citar "já confirmou o pagamento", é o
   marcador CONFIRMADO — não insista, não há `p_conferi_no_melhor_envio` que contorne isso (achado
   R5); volte ao passo 2 acima.

4. A resposta de sucesso é `{ id, me_reverse_id_liberado }`. Confira o evento novo em
   `devolucao_eventos` (ator `'sistema'`) para ver o texto gravado — ele também é visível ao
   cliente dono da devolução (achado R2, texto sempre neutro).
5. `unset TOKEN` ao terminar.

O mecanismo por trás (RLS via `auth.uid()`/`is_admin()`, não o papel da conexão Postgres) é o
mesmo provado na prova viva `tests/banco/devolucoes-viva.cjs` — os testes `mutante
R1_rpc_sem_gate_admin` (cliente comum, `42501`), `mutante F3_service_role_sem_jwt` e `mutante
F3_postgres_sem_jwt` (`SET ROLE` sem sessão, `42501`) provam a recusa; chamado como admin
autenticado (mesma emulação de `auth.uid()`), a RPC funciona. É essa autenticação — não o usuário
nem o papel da conexão Postgres — que este procedimento reproduz em produção.
