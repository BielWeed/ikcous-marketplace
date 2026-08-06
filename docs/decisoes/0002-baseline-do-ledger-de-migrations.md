# ADR 0002 — Reconciliar o ledger de migrations por baseline do schema vivo

**Status:** Aceito
**Data:** 05/08/2026
**Decisor:** Gabriel
**Issues:** `BANCO-050` #42, `BANCO-030` #112 · **Depende de:** `BANCO-040` #40 (respondida)

---

## Contexto

O ledger de migrations não descreve o banco. Medido em 05/08/2026 com
`node scripts/db-reconcilia-ledger.cjs`:

| | 30/07/2026 | **05/08/2026** |
| --- | ---: | ---: |
| linhas no ledger | 121 | **126** |
| versões distintas em disco | 134 | **139** |
| casadas | 93 | **98** |
| só em disco ("pendentes") | 41 | **41** (42 arquivos) |
| **só no ledger, sem arquivo** | 28 | **28** |

As "41 versões" e os "42 arquivos" que aparecem em documentos diferentes **estão
os dois certos**: o prefixo `20260708020000` tem dois arquivos
(`add_avatar_url_to_admin_questions_rpc` e `enable_realtime_for_monitored_tables`).

### Três fatos que decidiram

**1. A fila não é fila de deploy.** Das 41 pendentes, 22 não contêm função
alguma. Das 19 restantes, **19 de 33 pares função/arquivo têm corpo idêntico ao
que está vivo** — prova de que já rodaram sob outro timestamp. (O levantamento de
30/07 mediu 24 pares; a diferença é de método e das cinco migrations que entraram
entre as duas datas. Mesma ordem de grandeza, mesma conclusão.)

**2. Aplicar a fila desmontaria o RLS, e nem completaria.** Somando as 41:
**309 `DROP POLICY` contra 209 `CREATE POLICY`** e 129 `REVOKE`, sobre **71
policies vivas** — saldo de **−100**. E o bloqueador segue vivo:
`generate_order_otp_v1` retorna `boolean` no banco, e
`20260708150000_database_deep_cleanup_and_optimization.sql` faz
`CREATE OR REPLACE ... RETURNS TEXT` sem `DROP` antes. O Postgres recusa com
*cannot change return type* e o push aborta **ali** — depois de já ter derrubado
policies e sem chegar no que as reconstrói.

**3. O banco é a fonte de verdade, não o repositório.** O front está codificado
contra o schema vivo. Recriar o banco a partir dos arquivos produziria um schema
que o app atual não consegue usar.

---

## Opções consideradas

### Opção A — Baseline novo a partir do schema vivo

Gerar uma migration de baseline do estado real, marcar tudo até ela como
aplicado, e arquivar as pendentes.

### Opção B — Reconciliação arquivo a arquivo

**Descartada por impossibilidade, não por preferência.** Para **28 versões** do
ledger o SQL não existe: não está no repositório, não está em backup, não está em
lugar nenhum. Oito delas saíram num intervalo de três minutos em 13/07
(`20260713042914` a `20260713043203`), com cara de execução automatizada. **Não
se reconcilia o que não se pode ler.** Isso elimina a opção por aritmética.

### Opção C — Congelar e só escrever daqui pra frente

Não resolve o critério 5 da #112: continuaria não existindo forma de saber, a
partir do repositório, qual é o estado real do banco. É a Opção A sem a parte que
responde a pergunta.

---

## Decisão

**Opção A.** O repositório passa a descrever o banco, e migration nova nasce em
cima de um estado conhecido.

### O que já foi executado (05/08/2026)

- **As 42 pendentes foram movidas para `supabase/migrations/_arquivadas/`**, com
  `git mv` para o histórico sobreviver. **Não foram apagadas**: são a única pista
  do que aconteceu em julho, e o `BEGIN`/`COMMIT` embutido em várias delas ainda
  é matéria de investigação.
- **Dois arquivos sem prefixo de timestamp** (`add_user_id_to_orders.sql`,
  `favorites_migration.sql`) foram para o mesmo lugar: o CLI do Supabase nunca os
  aplicaria, então eram peso morto que parecia dívida.
- **Resultado medido: 0 pendentes.** Um `supabase db push` acidental hoje é
  no-op, em vez de desmontar o RLS. Era o risco imediato, e saiu.
- `scripts/db-reconcilia-ledger.cjs` ficou versionado. Ele **regenera** todos os
  números acima, e é o que responde ao critério 5 da #112.

### O que falta, e por que não foi feito hoje

**A migration de baseline em si.** Ela sai de `supabase db dump`, que exige
Docker rodando — e o Docker não estava no ar. Sem ela, o repositório ainda não
descreve o schema; ele apenas parou de mentir sobre o que está pendente.

Procedimento, quando o Docker estiver disponível — e seguindo o § 9 do
[`03-SETUP-AMBIENTE.md`](../onboarding/03-SETUP-AMBIENTE.md):

1. Confirmar que o backup de **hoje** já saiu.
2. `supabase db dump --db-url "$env:DATABASE_URL" -f backups/schema.sql` —
   **conferir o tamanho do arquivo**, porque sem Docker ele sai vazio sem erro.
3. Transformar o dump em `supabase/migrations/<timestamp>_baseline.sql`.
4. Registrar a versão do baseline no ledger **sem executá-la** (o schema já
   existe; executar seria recriar o que está lá).

---

## Consequências

**O histórico de julho deixa de ser executável e vira documento.** Quem quiser
saber por que uma policy é como é vai ler `_arquivadas/`, não replicar. Em troca,
ninguém mais roda por engano uma fila que derruba 100 policies líquidas.

**As 28 versões sem arquivo continuam ilegíveis, e isso é permanente.** O
baseline as absorve pelo efeito — o schema resultante inclui o que elas fizeram —
mas o *porquê* de cada uma está perdido. É o custo de ter chegado até aqui sem
disciplina de migration, e não há como recuperá-lo.

**A regra de nunca rodar `supabase db push` continua valendo** até o baseline
existir. Depois dele, o push volta a ser possível — mas só com o § 9 cumprido.

### Um achado que caiu no colo desta reconciliação

`20260601000001_remove_whatsapp_infrastructure.sql` **está aplicada**, e ela
remove de propósito o trigger `on_order_created_whatsapp`, a função
`handle_new_order_whatsapp()` e as três colunas `whatsapp_api_*` de
`store_config`.

Isso explica a edge function `send-order-whatsapp`, que está publicada, consulta
essas três colunas e devolve 500 em toda invocação: ela é **sobra de uma
desativação deliberada de 01/06/2026**, não uma integração meio-pronta. Muda o
destino provável da `INFRA-330` (#167) de "versionar e consertar" para
"despublicar". Registrado lá.

Vale como argumento a favor desta ADR: a resposta estava no repositório o tempo
todo, ilegível debaixo de 42 arquivos que ninguém sabia se valiam.

**Desacordo registrado:** nenhum.

---

## Quando revisar

- Quando o baseline for gerado — esta ADR passa a ter uma execução completa.
- Se alguém precisar do SQL de alguma das 28 versões perdidas. A resposta será
  não, e é melhor que esteja escrito aqui do que descoberto na hora.
