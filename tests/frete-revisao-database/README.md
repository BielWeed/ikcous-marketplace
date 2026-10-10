# A cotação de frete confere a revisão (pacote M, Emenda R3, 23/09/2026)

Ensaio local da migration `20261170000000_a_cotacao_de_frete_confere_a_revisao.sql`,
no molde de `tests/banco/` (a suíte que o `rpc-ci.yml` roda) e de `tests/identity-database/`
(ensaio manual documentado por README). **O CI geral do app NÃO roda este ensaio
automaticamente** — ele não está referenciado em nenhum `.github/workflows/*.yml`. Rode
explicitamente antes de aplicar a migration em qualquer banco:

```powershell
node tests/frete-revisao-database/run.cjs
```

## O que ele faz

Um Postgres **efêmero e descartável**, criado e destruído pelo próprio script via Docker
(`postgres:17`, a mesma imagem do `rpc-ci.yml`), num container e numa porta de host só
deste ensaio — nunca toca em banco de loja nem em qualquer DSN do
`manutencao-bancos`. Nada é instalado além do Docker Desktop (já presente na máquina) e
do pacote `pg`, que já é dependência do repositório (`scripts/ci/banco`,
`tests/banco/invariantes-dinheiro.cjs`) — nada novo entrou em `package.json`.

Passos:

1. Sobe o container, espera `pg_isready`.
2. Reaplica `tests/banco/provisionar.cjs` (papéis de fábrica, `auth.*` emulado,
   extensões) e `tests/banco/aplicar-migrations.cjs supabase/migrations` — a RAIZ
   INTEIRA do repositório, na ordem de nome de arquivo, incluindo a migration nova.
   Isto prova, de quebra, que a migration nasce depois da 20261169000000 e que o
   preflight de baseline (`B1_BASELINE_DIVERGENT`) aceita o corpo que ela deixou.
3. Roda os 6 casos obrigatórios do contrato (R3-3) chamando a RPC REAL
   (`create_marketplace_order_v23`/`_v24`) via `pg`, nunca uma simulação:
   - revisão igual → pedido criado;
   - revisão diferente → `FRETE_COTACAO_DESATUALIZADA`, sem pedido nem item gravado;
   - sem a linha `_revisao` → idêntico ao de hoje;
   - retirada e entrega local → sem checagem (mesmo com `_revisao` divergente);
   - concorrência: cache gravado tardiamente com a revisão velha → recusa;
   - as duas funções, v23 e v24 — ver a nota abaixo sobre v23.
4. Prova o ciclo migration → rollback → reaplicação: aplica
   `rollback-manual-20261170000000_...sql` e confere, pelo hash SHA-256 do
   `pg_proc.prosrc`, que o corpo volta EXATO ao que a 20261169000000 deixava; reaplica a
   migration e confere que o hash volta ao valor do passo 2 (idempotência dos dois
   lados).
5. Deixa o banco como estava antes do passo 4 (migration aplicada) e destrói o
   container, sempre (`finally`), passe ou falhe o ensaio.

## Nota sobre v23: o ramo novo existe, mas está morto por desenho

O ponto onde a checagem entra (bloco 4, `ELSIF p_destination_cep IS NOT NULL`) só é
alcançado quando a opção de entrega NÃO é `local-delivery` nem `store-pickup`. Em
`create_marketplace_order_v23`, o bloco 2-ter — que roda ANTES do bloco 4 — recusa
**qualquer** opção de transportadora, sempre (`'Envio por transportadora exige
pagamento antecipado...'`), independente do meio de pagamento: essa é a RPC do
pagamento na entrega, e transportadora é sempre pré-pago (v24). Isto é **anterior a
esta migration** (migration 20261168000000) e não muda aqui.

Resultado: a checagem de revisão nova em `v23` é código morto no estado atual do
sistema — nunca é alcançada, porque o bloco 2-ter já barrou o pedido antes. O teste
prova as duas coisas: (a) o corpo é estruturalmente IDÊNTICO ao de `v24` naquele
trecho (mesmo diff aplicado nos dois — conferido pela migration em si, que gera os
dois `CREATE OR REPLACE` a partir do mesmo patch), e (b) chamar `v23` com uma opção de
transportadora continua recusando pela mensagem PRÉ-EXISTENTE, com ou sem `_revisao`
divergente — ou seja, esta migration não muda o comportamento observável de `v23`.
Os cenários funcionais dos 6 casos rodam contra `v24`, que é a única das duas onde o
ramo de transportadora é alcançável.

## Aplicação de verdade (depois da revisão, nunca por este ensaio)

```powershell
node scripts/db-apply.cjs 20261170000000_a_cotacao_de_frete_confere_a_revisao.sql
```

🔴 **Só o nome do arquivo (basename), nunca `supabase/migrations/...`.** O
`main()` do `db-apply.cjs` monta o nome do rollback automático com
`arquivos[0]` cru (sem `path.basename`) — passar o caminho com diretório
gera o literal `rollback-supabase/migrations/...sql` e `fs.writeFileSync`
falha por diretório ausente ANTES de aplicar a migration. Rodei o comando
acima de verdade contra um Postgres 17 efêmero e descartável (nunca banco
de loja): veredito **"Tudo aplicado e verificado"**, exit code 0 — ver
`CHECKPOINT-M.txt` do pacote M para a saída completa e a entrada nova de
`VERIFICACOES` que a torna possível.

## Fixtures

UUIDs fixos, nunca gerados por round-trip (mesma convenção de
`tests/banco/invariantes-dinheiro.cjs`). Dinheiro em teste é dado de FIXTURE — nenhum
dado de cliente, nenhuma chave real. `_revisao` usa tokens de texto simples (`R0`,
`R1`, `R2`) em vez de UUID v4 de verdade: a RPC compara por igualdade de texto pura
(`IS DISTINCT FROM`), então o formato do valor não importa para o comportamento
provado aqui — só a igualdade/desigualdade importa.
