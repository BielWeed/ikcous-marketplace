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

  O resultado esperado são 4 linhas, com `versoes_vivas = 1` e `igual_ao_rollback = true`.
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

Cole o `conferir-marcadores.sql` no SQL Editor. Em 26/09/2026 o mapa tinha **19 marcadores**, e
todos precisam dar `ok = true`. A contagem é exata, como no `db-apply`:
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
