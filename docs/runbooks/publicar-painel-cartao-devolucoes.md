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
segredo do repositório apontando para outro projeto.

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
for (const arquivo of Object.keys(VERIFICACOES).filter((a) => /^2026117[5-8]/.test(a)).sort()) {
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

Cole o `conferir-marcadores.sql` no SQL Editor. No commit `1af39ee1` (26/09/2026) o mapa tem **32
marcadores**, e todos precisam dar `ok = true`. A contagem é exata, como no `db-apply`:
- `achado` menor que `esperado` quer dizer que parte do trecho sumiu;
- `achado` maior que `esperado` quer dizer que a função mudou de um jeito que ninguém previu.

Nos dois casos a situação pede olho humano antes do passo 2.

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

Se registrar e depois reverter (§5), apague as linhas das versões revertidas.

## 2. Publicar as functions — só depois do §1 conferido

1. Abra GitHub → Actions → **"Publicar edge functions (Supabase)"** → *Run workflow*, no branch
   do SHA anotado.
2. Preencha `projeto`: `loja`.
3. Preencha `functions` com:

```text
criar-pagamento, webhook-mercadopago, reconciliar-pagamentos, melhor-envio-etiqueta, send-order-confirmation
```

| Function | Por que sobe |
| --- | --- |
| `criar-pagamento` | Cartão pela Orders API, idempotência por tentativa, recusa que libera a vaga, 3DS. Lê `tentativas_de_pagamento` e `config_pagamento_cartao` (76). |
| `webhook-mercadopago` | Recusa ou cancelamento de cartão chamam `liberar_cobranca_do_pedido` (76). Notificação sobre cobrança órfã não aplica pago nem estornado (achado A3). Comprovante com `metodo_online`. |
| `reconciliar-pagamentos` | A mesma liberação da vaga e o mesmo comprovante. |
| `melhor-envio-etiqueta` | Ação `gerar_devolucao_reversa`, que lê e grava `devolucoes`/`devolucao_eventos` (75). |
| `send-order-confirmation` | Importa `_shared/comprovante.ts`, que agora seleciona `metodo_online`. **Publicada antes da 76, a leitura do pedido falha.** |

`estornar-pagamento` e `credenciais-mercado-pago` **não** precisam subir. Das peças de
`_shared/mercadopago.ts`, elas só usam `fetchComTempo`, `consultarOrder`, `idEhClassico` e
`BASE_URL_PADRAO`, e as quatro estão idênticas às da base. Por isso não use o apelido
`cobranca`, que publicaria as cinco do Mercado Pago.

O workflow publica uma function por vez e nunca passa `--no-verify-jwt`: quem manda é
`supabase/config.toml`. No fim, ele grava `supabase functions list` no resumo do job. Confira que
as cinco aparecem com a data de agora.

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
4. **Banco**: rode **sempre 78 → 77 → 76 → 75** e pare onde o problema acabar. Execute pelo
   `psql` com a string de conexão do projeto da loja. **Confira o host antes**, porque o
   workflow não aceita `rollback-manual-*` e o `db-apply` gravaria o rollback no ledger.

   ```bash
   psql "$CONEXAO_DA_LOJA" -1 -v ON_ERROR_STOP=1 -f supabase/migrations/rollback-manual-20261178000000_o_crm_e_o_inicio_leem_a_loja.sql
   psql "$CONEXAO_DA_LOJA" -1 -v ON_ERROR_STOP=1 -f supabase/migrations/rollback-manual-20261177000000_o_financeiro_da_loja_nasce.sql
   psql "$CONEXAO_DA_LOJA" -1 -v ON_ERROR_STOP=1 -f supabase/migrations/rollback-manual-20261176000000_o_cartao_online_nasce.sql
   psql "$CONEXAO_DA_LOJA" -1 -v ON_ERROR_STOP=1 -f supabase/migrations/rollback-manual-20261175000000_a_devolucao_nasce_no_pedido.sql
   ```

**Guardas que recusam a ordem errada** (um `DO` com `RAISE EXCEPTION`, antes de qualquer
`DROP`):
- a 77 recusa se `painel_inicio()`/`crm_visao` existirem;
- a 76 recusa se 78 ou 77 existirem;
- a 75 recusa se 78, 77 ou 76 existirem, pelo objeto `config_pagamento_cartao`.

Recusa com `-1` não deixa nada pela metade. A 78 não tem guarda, porque é a primeira da fila.

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

**Preparar**
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
- [ ] **COEP**: o app envia `Cross-Origin-Embedder-Policy: credentialless` (`vercel.json`), e
  o Brick cria iframes do Mercado Pago sem o atributo `credentialless`. Com o formulário do
  cartão aberto, o Console **não pode** ter bloqueio de `Cross-Origin-Embedder-Policy`/
  `ERR_BLOCKED_BY_RESPONSE`, nem `Refused to frame` (CSP `frame-src`). Campos vazios ou
  cinzas = barrado. **Barrado: não ligue.** A decisão sobre o COEP sobe ao dono
  ([spec do cartão](../superpowers/specs/2026-09-26-cartao-online-design.md), decisão 7).
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
- [ ] **3DS**:
  1. Use o cenário de desafio da doc "Integrar 3DS" da Orders API (link na spec).
  2. O desafio abre no iframe. Isso depende do domínio da URL estar no `frame-src` e do
     `postMessage` de conclusão vir de origem do MP.
  3. Concluído, o webhook confirma.
  4. Abandonado com troca para PIX, a order `action_required` é cancelada no MP e o PIX nasce.
  5. O `expires_at` do pedido foi estendido, até 40 min.
- [ ] **Em análise** (titular `CONT`): a tela diz que aguarda o banco. Pedir PIX nesse estado dá
  409 recuperável, sem uma segunda cobrança.
- [ ] **Idempotência**:
  1. Com duas abas no mesmo pedido, ou com duplo envio, pague com dois cartões na mesma
     tentativa.
  2. No painel do MP, só pode existir **uma** order com esse `external_reference` por
     tentativa, porque a chave é `<pedido>:c<n>`, sem o token.
  3. Os logs da `criar-pagamento` não podem ter `cartao_orfao`.
- [ ] **Débito**, se ligado: o Brick mostra só o que o MP aceita para a conta. Na Orders API do
  Brasil, isso é débito Elo.
- [ ] Todos os eventos acima têm `200` nos logs do `webhook-mercadopago`.

**Comportamentos do Mercado Pago a confirmar no sandbox** (escritos no código sem prova contra
a API real):
- [ ] A mesma `X-Idempotency-Key` com token diferente devolve a MESMA order. É a premissa do
  achado A1.
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
amarra o texto da edge ao texto da RPC. Ver §7.6 atualizado.

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
  ('79 admin_devolucao_liberar_vinculo_reverso: corpo', (SELECT md5(replace(prosrc, E'\r', '')) FROM pg_proc WHERE proname = 'admin_devolucao_liberar_vinculo_reverso' AND pronamespace = 'public'::regnamespace), '83a620da726bee13c21578daec6909f3'),
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
md5 de `admin_devolucao_liberar_vinculo_reverso` mudou de novo na rodada 4 (achados 1c/3/4: o
segundo guard do marcador indeterminado, o `auth.uid() IS NOT NULL` e a troca de `LIKE` por
`strpos`) — o valor acima já é o da rodada 4. Recompute-o de novo se o conteúdo do arquivo mudar
antes de publicar.)

### 7.3 Marcadores — o filtro do §1.2 precisa alargar

O script do §1.2 filtra `Object.keys(VERIFICACOES)` por `/^2026117[5-8]/` — a 79 não entra nesse
padrão. Troque por `/^(2026117[5-8]|20261179)/` antes de gerar `conferir-marcadores.sql` desta
vez. O total sobe de **32 para 41 marcadores** (mais 9, os da 79: 3 em `cancelar_devolucao`
(rodada 2, sem mudança) e 6 em `admin_devolucao_liberar_vinculo_reverso` — os 3 da rodada 2, mais
2 da rodada 3 (o guard do marcador de pagamento confirmado, achado R5, e a nota que distingue
reserva de vínculo real, achado N-a), mais 1 da rodada 4 (o guard do marcador de pagamento
INDETERMINADO, achado 1c) — confira que a query devolve 41 linhas, todas `ok = true`.

### 7.4 Ledger

```sql
INSERT INTO supabase_migrations.schema_migrations (version, name) VALUES
  ('20261179000000', 'cancelar_devolucao_barra_compra_em_voo')
ON CONFLICT (version) DO NOTHING;
```

### 7.5 Rollback — 79 ANTES de 78

Se 79 estiver aplicada e for preciso desfazer o PR inteiro (§5), rode o rollback dela **antes**
de tocar em 78/77/76/75 — ela redefine uma função que mora na 75 e cria uma RPC que só faz
sentido com a tabela `devolucoes` (75) no ar:

```bash
psql "$CONEXAO_DA_LOJA" -1 -v ON_ERROR_STOP=1 -f supabase/migrations/rollback-manual-20261179000000_cancelar_devolucao_barra_compra_em_voo.sql
```

Depois disso, a ordem do §5 (78 → 77 → 76 → 75) continua igual. Se só 79 precisar sair (o
problema é isolado nela), o rollback acima sozinho já basta — `cancelar_devolucao` volta ao corpo
da 75 e `admin_devolucao_liberar_vinculo_reverso` é derrubada; nada em 75–78 é tocado.

**Por que a ORDEM importa (N-a/N-c, rodada 3):** a GUARDA DE ORDEM que o rollback da 75 já tem
(`rollback-manual-20261175000000_...sql`, bloco `DO $$ ... RAISE EXCEPTION 'reverta 78/77/76 antes
desta (75)' ... $$`) foi escrita ANTES de a 79 existir — ela não sabe nada sobre
`admin_devolucao_liberar_vinculo_reverso`. Se alguém reverter a 75 com a 79 ainda aplicada (pulando
o passo acima), essa guarda NÃO barra: o rollback da 75 derruba `public.devolucoes` sem `CASCADE`
(um `DROP TABLE` simples não enxerga o corpo de uma função plpgsql como dependência de catálogo),
e `admin_devolucao_liberar_vinculo_reverso` sobrevive — ORFÃ, apontando para uma tabela que não
existe mais, falhando com `42P01` (relation does not exist) na primeira chamada seguinte. Rodar o
rollback da 79 primeiro é o que evita essa órfã; não há proteção automática contra a ordem errada
além desta instrução.

### 7.6 Usar `admin_devolucao_liberar_vinculo_reverso` em produção (achados R5/1/3)

Esta RPC é um escape hatch manual, não um botão do painel — não existe UI para ela. Ela só deve
ser chamada quando um vínculo real (`me_reverse_id` que não é `reservando:...`) fica preso sem
código de postagem por tempo demais (edge que morreu entre a reserva e o vínculo, liberação que
falhou nas duas tentativas apesar da degradação automática — achado R3 —, ou Sandbox do Melhor
Envio, que nunca gera o código da reversa).

**QUANDO usar — confira ANTES de chamar:**

1. Abra "Meus envios" na conta do Melhor Envio da loja e procure o `me_reverse_id` da devolução
   (`SELECT me_reverse_id FROM public.devolucoes WHERE id = '<id-da-devolucao>'`).
2. **Se o envio aparece como PAGO** (mesmo sem código de rastreio ainda): NÃO chame a RPC. Ela
   mesma recusa com `22023` quando o marcador de pagamento confirmado (achado R5) foi gravado —
   mas esse marcador só existe se a edge chegou a rodar até o checkout responder; se o pagamento
   foi confirmado por outro caminho (ex.: um checkout manual feito direto no Melhor Envio, fora da
   edge, ou um vínculo criado ANTES de a function nova estar no ar — ver o aviso no início do §7),
   o marcador pode faltar e a RPC soltaria um vínculo pago sem avisar. A checagem manual no "Meus
   envios" é a primeira linha de defesa, não a RPC.
3. **Se o checkout ficou INDETERMINADO** (achado 1c, rodada 4 — o Melhor Envio respondeu 5xx ou
   a chamada deu exceção, sem confirmar nem recusar o pagamento): a RPC recusa por padrão com
   `22023` (marcador de "pagamento indeterminado"). Só depois de confirmar em "Meus envios" que o
   envio NÃO foi pago, chame de novo passando `p_conferi_no_melhor_envio = true` — sem essa
   confirmação manual, não force esse parâmetro.
4. **Se o envio ainda está no CARRINHO sem pagamento** (ex.: o checkout nunca rodou, ou rodou e foi
   recusado sem o retry conseguir soltar o vínculo): remova o item do carrinho no Melhor Envio
   ANTES de liberar aqui — a RPC só apaga o vínculo no NOSSO banco, nunca mexe no carrinho do
   provedor.
5. **Se o código de postagem já saiu**: não há nada para "destravar" — a RPC recusa com `22023`
   ("o código de postagem já foi emitido"). Cancelar o envio é direto no Melhor Envio.

**COMO chamar — como um admin autenticado, nunca como `postgres`/service-role sem JWT:**

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
   chave pública do projeto, a mesma que `VITE_SUPABASE_PUBLISHABLE_KEY`):

   ```bash
   curl -X POST "{SUPABASE_URL}/rest/v1/rpc/admin_devolucao_liberar_vinculo_reverso" \
     -H "apikey: {ANON_KEY}" \
     -H "Authorization: Bearer $TOKEN" \
     -H "Content-Type: application/json" \
     -d '{"p_id": "<id-da-devolucao>"}'
   ```

   (Achado 1c: se a recusa for por pagamento INDETERMINADO e "Meus envios" já confirmou que não
   foi pago, repita com `-d '{"p_id": "<id-da-devolucao>", "p_conferi_no_melhor_envio": true}'`.)

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
