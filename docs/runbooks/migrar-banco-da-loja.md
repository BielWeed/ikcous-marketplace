# Migrar o banco da loja para um projeto novo — passo a passo

> **Incidente em andamento (28/09/2026).** O projeto Supabase da loja
> (`cafkrminfnokvgjqtkle`, us-west-2) foi **pausado** por fatura em atraso. A loja em
> produção (`ickous-marketplace.vercel.app`) responde 503 porque o middleware não
> consegue ler a ficha da loja. O dono não consegue religar nem transferir o projeto
> pausado sem pagar — decisão: migrar para um projeto **novo, grátis, em outra conta**.
>
> **Projeto novo:** ref `dekxabvqdsuukijblazl`, nome `ikcous-loja`, organização IKCOUS,
> região **São Paulo (sa-east-1)**, Postgres 17. URL:
> `https://dekxabvqdsuukijblazl.supabase.co`.

**Este documento cobre as partes (a) descompactar, (b) restaurar e (c) conferir —** as
três que tiram o BANCO do lugar. Elas **não** bastam para tirar a loja do 503 sozinhas:
faltam ainda o Storage (fotos), a troca dos endereços antigos gravados no banco, as
edge functions, a Vercel, o Auth e o Mercado Pago — cada um vira uma seção nova deste
mesmo arquivo numa próxima entrega. **Não aponte a Vercel para o projeto novo depois só
desta parte:** sem o Storage migrado (parte d) e sem os endereços trocados (parte e), a
loja abriria com toda foto quebrada.

## Antes de começar

- [ ] PowerShell **7** (não o 5.1 que já vem no Windows — os comandos abaixo foram
      escritos para o 7, que é o que você tem instalado).
- [ ] O backup baixado do painel do projeto pausado, em
      `C:\Users\Gabriel\Downloads\BACKUP BD IKCOUS`:
      - `db_cluster-28-09-2026@03-20-37.backup.gz` (≈ 1 MB — o banco) — apesar do nome
        `.backup`, é **texto puro** (um dump de `pg_dumpall`, só comprimido em gzip), não
        formato binário do `pg_restore`. Confira abrindo o arquivo descompactado num
        editor de texto: a primeira linha é um comentário `--`.
      - `cafkrminfnokvgjqtkle.storage.zip` (≈ 9,5 MB — os arquivos do Storage; entra na
        parte (d), mais adiante, não nesta entrega).
- [ ] O projeto novo (`dekxabvqdsuukijblazl`) já criado no painel do Supabase, numa
      conta/organização que **não** é a que está com a fatura em atraso.

### Instalar o PostgreSQL 17 (dá o `psql.exe`)

Você já está instalando com:

```powershell
winget install -e --id PostgreSQL.PostgreSQL.17
```

**Como saber que deu certo:** o instalador termina sem erro e este comando devolve uma
versão 17.x —

```powershell
& "C:\Program Files\PostgreSQL\17\bin\psql.exe" --version
```

Se o caminho não existir (instalação customizada), ache onde ficou:

```powershell
Get-ChildItem "C:\Program Files\PostgreSQL" -Recurse -Filter psql.exe -ErrorAction SilentlyContinue
```

Guarde o caminho encontrado — os comandos abaixo assumem
`C:\Program Files\PostgreSQL\17\bin\psql.exe`; troque se o seu for outro.

> **Erro conhecido e não relacionado a isto:** se o `psql` já existia no seu PC de uma
> instalação **anterior a Postgres 16**, a restauração da parte (b) pode falhar com
> `received invalid response to GSSAPI negotiation`. A correção, segundo a documentação
> oficial da Supabase, é desinstalar o Postgres antigo e ficar só com o 17 que você está
> instalando agora.

---

## Parte (a) — Descompactar o backup do banco

O painel do Supabase entrega o backup gzipado. Sem instalar mais nada (o Node do projeto
já resolve), rode:

```powershell
cd "C:\caminho\para\o\seu\clone\do\repositorio"
node scripts\migracao\descompactar.mjs `
  "C:\Users\Gabriel\Downloads\BACKUP BD IKCOUS\db_cluster-28-09-2026@03-20-37.backup.gz" `
  "C:\Users\Gabriel\Downloads\BACKUP BD IKCOUS\db_cluster.sql"
```

(Troque `C:\caminho\para\o\seu\clone\do\repositorio` pela pasta onde você já roda `npm`
neste projeto. O segundo caminho é opcional — sem ele, o script só tira o `.gz` do nome
original; aqui ele já renomeia para `db_cluster.sql`, mais curto de digitar no `psql -f`
da parte (b).)

O script também aceita a pasta inteira, se um dia vier mais de um `.gz`:

```powershell
node scripts\migracao\descompactar.mjs "C:\Users\Gabriel\Downloads\BACKUP BD IKCOUS"
```

**Como saber que deu certo:** a linha impressa começa com `[ok]` e mostra o tamanho de
entrada e de saída —

```
[ok]     C:\...\db_cluster-28-09-2026@03-20-37.backup.gz (1041683 bytes) -> C:\...\db_cluster.sql (NNNN bytes)
```

— e o arquivo `db_cluster.sql` aparece na mesma pasta do backup. Confira que é texto de
verdade (não lixo binário):

```powershell
Get-Content "C:\Users\Gabriel\Downloads\BACKUP BD IKCOUS\db_cluster.sql" -TotalCount 5
```

Deve mostrar linhas de comentário SQL (começando com `--`) e, logo abaixo, `CREATE ROLE`
ou `SET`. Se vier caractere ilegível, o `.gz` estava corrompido ou o download parou no
meio — baixe de novo do painel antes de continuar.

**Idempotente:** rodar o comando de novo não reescreve o arquivo (`[pulei] ... já
existe`). Se precisar refazer (ex.: baixou um `.gz` novo com o mesmo nome), acrescente
`--forcar`.

*(O que faz o script, para quem quiser conferir:
[`scripts/migracao/descompactar.mjs`](../../scripts/migracao/descompactar.mjs) — usa só
`node:zlib`/`node:fs`, escreve num arquivo temporário e só troca de nome no final, para
nunca deixar um `.sql` pela metade se a descompactação cair no meio. Coberto por
[`tests/migracao_descompactar_test.ts`](../../tests/migracao_descompactar_test.ts).)*

---

## Parte (b) — Restaurar no projeto novo

**Fonte:** este passo segue a documentação oficial da Supabase, "Restore Dashboard
backup"
(<https://supabase.com/docs/guides/platform/migrating-within-supabase/dashboard-restore>) —
resgatada aqui porque o domínio `supabase.com` está bloqueado pela rede desta sessão;
conferida contra o texto-fonte do repositório `supabase/supabase` no GitHub. O que vem
marcado **SUPOSIÇÃO** abaixo é o que a doc não cobre e eu não pude confirmar contra o
painel real do projeto novo.

### b.0 — Antes de restaurar: habilitar as extensões que o schema usa

A doc oficial avisa: "se você usava alguma extensão, habilite em Database → Extensions"
— sem isso, a restauração pode dar erro **de verdade** (não um dos inofensivos da lista
abaixo) ao tentar recriar algo que depende da extensão. No painel do projeto novo,
**Database → Extensions**, habilite antes de restaurar:

- `pg_cron` (as 3 tarefas agendadas — expirar reserva, reconciliar pagamento, devolver
  cupom de pedido morto)
- `pg_net` (chamadas HTTP de dentro do banco, usadas pelos gatilhos/cron)
- `pgsodium` (o Vault depende dela)
- `pg_graphql` (normalmente já vem ligada por padrão)
- `pg_trgm`, `unaccent` (busca por nome/telefone no painel)
- `uuid-ossp`, `pgcrypto` (geração de id e hash — estas vêm no instalador padrão do
  Postgres também, mas o projeto Supabase tem a sua própria cópia)

**SUPOSIÇÃO:** não confirmei se o plano Free do projeto novo permite `pg_cron`/`pg_net`
sem passo extra — se o toggle não aparecer ou der erro ao ligar, isso é bloqueante para
a parte (f) (functions) e para a reserva de estoque, mas **não impede** de continuar
esta restauração (as tabelas de negócio não dependem dessas extensões).

### b.1 — Connection string (Session pooler) e senha

Dados do projeto novo, conferidos contra o próprio painel (não é mais suposição):

| Campo | Valor |
| --- | --- |
| Host | `aws-0-sa-east-1.pooler.supabase.com` |
| Porta | `5432` |
| Banco | `postgres` |
| Usuário | `postgres.dekxabvqdsuukijblazl` |
| SSL | `sslmode=require` |

A senha é a do banco do projeto novo — gere/resete em **Project Settings → Database →
Database password** se ainda não tiver uma (pode levar alguns minutos para valer,
segundo a doc oficial da Supabase — se o `psql` disser "Wrong password" logo em seguida,
espere um pouco e tente de novo).

### b.2 — Rodar a restauração

No PowerShell 7, **dentro da pasta do repositório**:

```powershell
# 1) A senha SÓ aqui, digitada por você e MASCARADA na tela — nunca no chat,
#    nunca num arquivo, nunca solta na linha de comando (senha na linha de
#    comando fica gravada no histórico do PowerShell/PSReadLine mesmo depois
#    de fechar o terminal). -MaskInput é do PowerShell 7.
$env:PGPASSWORD = Read-Host "Senha do banco (projeto novo)" -MaskInput

# 2) A connection string SEM a senha embutida — o psql usa PGPASSWORD sozinho.
$conexao = "postgresql://postgres.dekxabvqdsuukijblazl@aws-0-sa-east-1.pooler.supabase.com:5432/postgres?sslmode=require"

# 2b) Teste rápido ANTES de restaurar — se isto não devolver uma versão do
#     Postgres, PARE: a restauração vai falhar do mesmo jeito, e é mais fácil
#     depurar uma linha do que um dump inteiro no meio do caminho.
& "C:\Program Files\PostgreSQL\17\bin\psql.exe" -d $conexao -c "select version();"

# 3) A restauração em si. SEM "-v ON_ERROR_STOP=1" DE PROPÓSITO: o padrão do
#    psql é continuar depois de um erro, e é exatamente esse comportamento que
#    a doc da Supabase espera (a lista de erros inofensivos abaixo depende
#    disso — com ON_ERROR_STOP=1 a restauração pararia no PRIMEIRO "already
#    exists", que é normal).
& "C:\Program Files\PostgreSQL\17\bin\psql.exe" `
  -d $conexao `
  -f "C:\Users\Gabriel\Downloads\BACKUP BD IKCOUS\db_cluster.sql" `
  *> "$env:USERPROFILE\Downloads\restauracao-log.txt"

# 4) Limpa a senha da sessão assim que terminar.
Remove-Item Env:\PGPASSWORD
```

Isto pode levar de alguns segundos a alguns minutos (o backup comprimido tem ~1 MB — é
um banco pequeno, ~64 pedidos fictícios em 5 meses).

### b.3 — Ler o log: o que é normal e o que não é

Abra `restauracao-log.txt` e procure por `ERROR`:

```powershell
Select-String -Path "$env:USERPROFILE\Downloads\restauracao-log.txt" -Pattern "ERROR:"
```

**Inofensivos — ignore estes (a doc oficial da Supabase confirma):**

- `relation "..." already exists`
- `constraint "..." for relation "..." already exists`
- `role "..." already exists`
- `schema "..." already exists`
- `type "..." already exists`
- Qualquer variação de "já existe" em objeto de schema gerenciado pela própria Supabase
  (`auth`, `storage`, `realtime`, `extensions`, `_realtime`) — o dump é um *dump
  completo* (inclui os `CREATE` desses schemas), e o projeto novo **já nasce** com eles.
  A doc chama isso de "expected... because it skips to the next command to run".
- Efeito colateral citado pela doc: **todo gatilho roda durante a restauração** (porque
  cada `INSERT` é uma escrita de verdade) — não é erro, é o preço de restaurar por
  dump lógico. **Decisão tomada aqui:** não usar `session_replication_role = replica`
  para desligar os gatilhos durante a restauração — a documentação oficial não pede
  isso, não é o caminho testado por eles, e desligar réplica pede um privilégio que o
  usuário `postgres` do projeto pode não ter. Se algum gatilho falhar de um jeito que
  pareça bloqueante, isso vira um achado NOVO a levar para o dono, não algo para
  contornar sozinho.

**NÃO são inofensivos — pare e avise se aparecer:**

- Qualquer `ERROR` que não seja "já existe" (erro de sintaxe, "permission denied" fora
  do padrão acima, "could not open extension control file" — sinal de que faltou
  habilitar a extensão no passo b.0, "out of memory").
- A conexão cair no meio (o arquivo de log termina de repente, sem chegar nas últimas
  linhas do backup).
- `received invalid response to GSSAPI negotiation` → psql antigo, ver a nota da seção
  "Instalar o PostgreSQL 17" acima.
- `error received from server in SCRAM exchange: Wrong password` → espere alguns
  minutos depois do reset de senha e tente de novo (nota da doc oficial).

### O que este passo NÃO restaura (e por quê — fica para as próximas partes)

- **Arquivos do Storage** (fotos de produto etc.) — o dump traz só os METADADOS das
  tabelas do Storage (nome do bucket, caminho, tamanho); o **conteúdo** dos arquivos
  precisa ser reenviado à parte (parte d, `scripts/migracao/subir-storage.mjs`, próxima
  entrega).
- **Auth Settings e as chaves de API** (Site URL, Redirect URLs, SMTP, `anon`/
  `service_role` do projeto NOVO são outras) — parte (h), próxima entrega.
- **Edge Functions** — o código delas não mora no banco. Parte (f), próxima entrega.
- **Segredos do Vault** (ex.: `otp_trigger_secret`) — mesmo que a TABELA volte com o
  dump, o valor **não decifra certo** no projeto novo: a chave de criptografia do
  `pgsodium` é gerada por projeto, então um segredo criado no projeto antigo não abre
  no novo. Precisam ser recriados — parte (e), próxima entrega.
- **`auth.users`: a SENHA de cada cliente sobrevive** (o hash vem junto na tabela), mas
  **todo mundo vai precisar entrar de novo** — o projeto novo tem um JWT secret
  diferente, e qualquer sessão/token assinado pelo projeto antigo para de validar no
  instante em que o app passar a falar com o projeto novo. Isso é esperado, não é bug.

---

## Parte (c) — Conferir que a restauração trouxe tudo

O projeto antigo está **pausado** — não dá para rodar uma consulta nele para comparar
"antes x depois" ao vivo. Por isso a conferência tem duas partes bem diferentes:

### c.1 — Checagens absolutas (contra o próprio repositório, não contra o projeto antigo)

Coisas que o código deste repositório já diz qual é o valor CERTO, sem precisar
perguntar para lugar nenhum:

- **Ledger de migrations 72–83** (as 12 migrations mais recentes, do PR #666 e das
  correções de risco que vieram depois — devoluções, cartão, Financeiro, CRM):
  esperado **12 linhas** com `version` entre `20261172000000` e `20261183999999`.
- **Jobs do `pg_cron`:** esperado **3 linhas** — `expirar-pedidos-vencidos` (a cada 5
  min), `reconciliar-pagamentos` (a cada 10 min), `devolver-cupons-de-pedidos-mortos`
  (a cada 15 min). Se vier **0 linhas**, é o sintoma conhecido de dump lógico não levar
  o DADO de uma tabela de extensão (`cron.job`) mesmo levando a extensão em si — nesse
  caso, rode à mão os três `SELECT cron.schedule(...)` que estão em
  `supabase/migrations/20260807000001_agenda_expiracao.sql`,
  `supabase/migrations/20260808000100_reconciliacao.sql` e
  `supabase/migrations/20260901000000_devolver_uso_de_cupom_ao_desfazer_pedido.sql`
  (são idempotentes: cada um começa com `cron.unschedule` do mesmo nome).

### c.2 — Contagens de negócio (comparadas contra uma restauração LOCAL do MESMO arquivo)

Para produtos, pedidos, clientes etc. não existe um "valor certo" escrito em código —
o número depende do que a loja tinha de fato. Como o projeto antigo está inacessível, a
prova de que "a restauração trouxe tudo" é comparar o projeto NOVO contra uma segunda
restauração, **local e descartável**, do **mesmo** arquivo de backup — se as duas
baterem, o arquivo foi totalmente aplicado nos dois lugares.

```powershell
# Um banco local, jogável fora, no Postgres 17 que você já instalou.
# (senha aqui é a do SEU Postgres LOCAL, definida na instalação do winget —
# não tem nada a ver com a senha do projeto Supabase.)
$env:PGPASSWORD = Read-Host "Senha do Postgres LOCAL" -MaskInput
& "C:\Program Files\PostgreSQL\17\bin\createdb.exe" -U postgres -h localhost conferencia_local

& "C:\Program Files\PostgreSQL\17\bin\psql.exe" -U postgres -h localhost -d conferencia_local `
  -f "C:\Users\Gabriel\Downloads\BACKUP BD IKCOUS\db_cluster.sql" `
  *> "$env:USERPROFILE\Downloads\restauracao-local-log.txt"
```

**Espere MAIS erros reais neste log que no da parte (b)** — um Postgres comum não tem
`pg_cron`/`pg_net`/`pgsodium`/`pg_graphql` instalados, então tudo que depende dessas
extensões (agendamento, Vault) vai falhar aqui. **Isso é esperado e não invalida a
comparação**: o que importa comparar são as tabelas de negócio do schema `public`
(produtos, pedidos, clientes, cupons, Financeiro, devoluções), que não dependem de
nenhuma extensão exótica.

Agora rode a MESMA consulta de contagem contra os dois bancos:

```powershell
# Contra o LOCAL:
& "C:\Program Files\PostgreSQL\17\bin\psql.exe" -U postgres -h localhost -d conferencia_local `
  -f scripts\migracao\contagens.sql

# Contra o NOVO (a mesma $conexao da parte b — refaça o $env:PGPASSWORD se já
# tiver limpado):
& "C:\Program Files\PostgreSQL\17\bin\psql.exe" -d $conexao -f scripts\migracao\contagens.sql
```

**Como saber que deu certo:** os números de `produtos`, `product_variants`, `pedidos`,
`profiles`, `auth_users`, `cupons`, `fin_contas`, `fin_lancamentos` e `devolucoes` são
**idênticos** nas duas saídas. Se algum vier diferente, a restauração do projeto NOVO
ficou incompleta nessa tabela — pare e volte ao log da parte (b) para achar o `ERROR`
correspondente antes de seguir para a parte (d).

Descarte o banco local quando terminar (ele não precisa continuar existindo):

```powershell
& "C:\Program Files\PostgreSQL\17\bin\dropdb.exe" -U postgres -h localhost conferencia_local
Remove-Item Env:\PGPASSWORD
```

*(A consulta:
[`scripts/migracao/contagens.sql`](../../scripts/migracao/contagens.sql) — comentada,
`\set ON_ERROR_STOP off` de propósito para a comparação local não morrer na primeira
tabela ausente.)*

---

## Parte (d) — Subir os arquivos do Storage

A restauração da parte (b) trouxe os METADADOS do Storage (`storage.objects`: nome do
bucket, caminho, tamanho) — os 48 registros que o dono já confirmou. O CONTEÚDO de cada
arquivo mora fora do banco, num bucket S3 que o `pg_dumpall` não alcança: sem este passo,
toda foto de produto/banner quebra na loja nova.

```powershell
$env:NOVO_SUPABASE_URL = "https://dekxabvqdsuukijblazl.supabase.co"
$env:NOVO_SERVICE_ROLE_KEY = Read-Host "service_role do projeto novo (Settings -> API)" -MaskInput

node scripts\migracao\subir-storage.mjs "C:\Users\Gabriel\Downloads\BACKUP BD IKCOUS\cafkrminfnokvgjqtkle.storage.zip"

Remove-Item Env:\NOVO_SERVICE_ROLE_KEY
```

O script extrai o `.zip` sozinho (via `Expand-Archive` do próprio Windows — nada para
instalar), anda a estrutura `<bucket>/<caminho>` que o export do painel usa (os 5 buckets
que o dono já viu: `produtos`, `products`, `banners`, `branding`, `devolucoes`) e sobe
cada arquivo com `upsert: true` — rodar de novo não duplica. **Não recria bucket**: os 5
já vieram na restauração da parte (b); se um upload falhar com "bucket not found", o
bucket em questão não veio, e isso se resolve voltando à parte (b)/(c), não aqui.

**Como saber que deu certo:** a última linha impressa é `N arquivo(s), 0 falha(s)` — se
vier alguma falha, a linha `[falhou] bucket/caminho: motivo` logo acima diz qual arquivo e
por quê. Confira também no painel do projeto novo, **Storage**, que os buckets têm
arquivo (não só a pasta vazia).

*(Coberto por
[`tests/migracao_subir_storage_test.ts`](../../tests/migracao_subir_storage_test.ts) — a
parte de rede é injetada nos testes (nenhum teste sobe arquivo de verdade).)*

> **Nota (28/09/2026):** por urgência, o coordenador também passou ao dono um script
> avulso (fetch puro contra a API do Storage) para não esperar esta entrega. Os dois
> fazem a mesma coisa (upsert idempotente); o desta pasta é o que fica versionado e
> testado no repositório.

---

## Parte (e) — Trocar os endereços antigos gravados no banco

Produto, banner, ficha da loja etc. guardam a URL **completa** da foto
(`https://cafkrminfnokvgjqtkle.supabase.co/storage/v1/object/public/...`) em colunas
`text`/`jsonb` do schema `public` — essas linhas continuam apontando para o projeto
PAUSADO até serem trocadas. **Exceção que já funciona sozinha:** a identidade da loja
(logo, ícone, capa) —
[`src/lib/storeIdentity.ts`](../../src/lib/storeIdentity.ts) monta a URL de cada asset de
branding SEMPRE a partir do `VITE_SUPABASE_URL` **atual** (`` `${origin}/storage/v1/object/public/branding/${asset.path}` ``,
`normalizeSupabaseOrigin`/`parseStoreIdentity`) — o banco guarda só o **caminho**
relativo dentro do bucket `branding`, nunca a URL inteira. Então, para a ficha de
identidade especificamente, trocar a variável `VITE_SUPABASE_URL` na Vercel (parte g,
abaixo) já resolve sozinho, **sem** depender desta parte (e) rodar antes — não há
checagem de "mesma origem" que bloqueie isso, é derivação pura. O que ESTA parte (e)
resolve é tudo que guarda URL inteira: fotos de produto, banner e qualquer outro campo
que tenha sido salvo com `getPublicUrl()` do projeto antigo.

Se esta for uma sessão NOVA do PowerShell (fechou o terminal desde a parte b), recrie a
senha e a `$conexao` antes de continuar — são os mesmos dois primeiros comandos de b.2:

```powershell
$env:PGPASSWORD = Read-Host "Senha do banco (projeto novo)" -MaskInput
$conexao = "postgresql://postgres.dekxabvqdsuukijblazl@aws-0-sa-east-1.pooler.supabase.com:5432/postgres?sslmode=require"
```

### e.1 — Dry-run: só contar (sem mudar nada)

```powershell
& "C:\Program Files\PostgreSQL\17\bin\psql.exe" -d $conexao -f scripts\migracao\contar-endereco-antigo.sql
```

Isso varre TODA coluna `text`/`character varying`/`jsonb`/`text[]` de tabela BASE do
schema `public` (via `information_schema.columns`, não uma lista escrita à mão — não
deixa faltar tabela nova) e conta quantas linhas de cada uma contêm
`cafkrminfnokvgjqtkle`. **Como saber que deu certo:** a saída é só contagens, uma por
`tabela.coluna`; nenhum dado pessoal aparece. Anote o total antes de seguir.

### e.2 — Trocar, numa transação só

```powershell
& "C:\Program Files\PostgreSQL\17\bin\psql.exe" -d $conexao -f scripts\migracao\trocar-endereco-antigo.sql
```

O script conta ANTES, faz `BEGIN`, troca `cafkrminfnokvgjqtkle` por
`dekxabvqdsuukijblazl` em toda coluna encontrada (cada tipo com a técnica certa —
`replace()` direto para texto, `replace()` no `::text` e volta para `jsonb`, e
`unnest`/`array_agg` para `text[]`, para não reescrever a estrutura do array por engano),
conta DEPOIS e só then `COMMIT` — se a contagem final não for zero, o script aborta com
`ROLLBACK` em vez de terminar pela metade. **Como saber que deu certo:** a última linha é
`trocado: <N> -> 0 ocorrências restantes` **e** `COMMIT` (não `ROLLBACK`).

> Este script **não** é uma migration (não mora em `supabase/migrations/`), por isso leva
> `BEGIN`/`COMMIT` de propósito — é um ajuste de dado, de uma vez, fora do pipeline de
> schema.

*(Arquivos:
[`scripts/migracao/contar-endereco-antigo.sql`](../../scripts/migracao/contar-endereco-antigo.sql),
[`scripts/migracao/trocar-endereco-antigo.sql`](../../scripts/migracao/trocar-endereco-antigo.sql).)*

### O que esta parte NÃO cobre (de propósito)

- **`cron.job.command`:** conferido contra as 3 migrations que agendam job
  (`20260807000001`, `20260808000100`, `20260901000000`) — NENHUMA grava o ref antigo no
  `command`. Duas chamam só `SELECT public.<função>();`; a terceira
  (`reconciliar-pagamentos`) pega a URL do **Vault** (`reconciliacao_url`) na hora de
  rodar, não do texto do `command`. Ou seja: não há endereço antigo para trocar em
  `cron.job` — o que precisa é RECRIAR o segredo do Vault com a URL do projeto NOVO (parte
  seguinte).
- **Segredos do Vault:** um valor decifrado no projeto antigo não decifra no novo (a
  chave do `pgsodium` é por projeto) — trocar string não ajuda aqui, o segredo precisa
  nascer de novo. Ver a seção abaixo.

---

## Parte (e.3) — Recriar os jobs do pg_cron e os segredos do Vault

O dono já confirmou: `cron.job` restaurou **0 linhas** (`permission denied for table
job` — dump lógico não conseguiu gravar dado de uma tabela do pg_cron) e os segredos do
Vault não restauraram (`permission denied for table secrets`, mesma causa: são tabelas de
extensão, o `postgres` da restauração não tem `INSERT` nelas). **Os dois têm de ser
recriados à mão, uma vez**, depois de (b)/(c):

```powershell
& "C:\Program Files\PostgreSQL\17\bin\psql.exe" -d $conexao -f scripts\migracao\recriar-cron-jobs.sql
```

Esse arquivo é uma cópia, byte a byte, dos três `cron.schedule(...)` que já estão nas
migrations — **não inventa agendamento novo**:

| Job | Cadência | O que faz |
| --- | --- | --- |
| `expirar-pedidos-vencidos` | `*/5 * * * *` | `SELECT public.expirar_pedidos_vencidos();` |
| `reconciliar-pagamentos` | `*/10 * * * *` | `net.http_post` para a URL do Vault (abaixo) |
| `devolver-cupons-de-pedidos-mortos` | `*/15 * * * *` | `SELECT public.devolver_cupons_de_pedidos_mortos();` |

**Como saber que deu certo:** `SELECT jobname, schedule, active FROM cron.job ORDER BY
jobname;` devolve as 3 linhas acima (mesma consulta de `scripts/migracao/contagens.sql`
da parte (c)).

### Segredos do Vault a recriar

Nenhum destes tem o valor antigo recuperável (chave de criptografia é por projeto). Dos
três, só os dois da reconciliação nascem de novo, no projeto NOVO:

| Nome (`vault.create_secret`) | Onde é lido | Valor |
| --- | --- | --- |
| `otp_trigger_secret` | **Não é mais usado.** O trigger `handle_new_otp_verification` foi apagado pela `20260820000100` e a `send-otp-email` não lê `OTP_TRIGGER_SECRET` (`send-otp-email/index.ts:18-21`). Só o `rollback-manual-20260820000100_*.sql` o usaria. Na migração de 28/09/2026 ele não foi recriado. | — |
| `reconciliacao_url` | Job `reconciliar-pagamentos` (`net.http_post`) | `https://dekxabvqdsuukijblazl.supabase.co/functions/v1/reconciliar-pagamentos` — **SUPOSIÇÃO de formato**: a migration não grava a URL (nasce fora, por `vault.create_secret` direto), então não tenho como confirmar se o projeto antigo usava esta forma (`/functions/v1/<nome>`) ou a legada (`https://<ref>.functions.supabase.co/<nome>`) — as duas funcionam hoje; use a primeira, que é a que a Supabase documenta como atual. |
| `reconciliacao_secret` | Job `reconciliar-pagamentos` manda como header `x-reconciliacao-secret`; a função confere contra `RECONCILIACAO_SECRET` do próprio ambiente | Uma string aleatória nova, igual nos dois lados (Vault + segredo da função, parte f). Gere uma vez, use nos dois lugares. |

Comando para cada um (rode duas vezes, um valor por vez — **nunca** cole o valor no chat,
só no seu terminal):

```powershell
& "C:\Program Files\PostgreSQL\17\bin\psql.exe" -d $conexao -c @"
SELECT vault.create_secret('COLE-O-VALOR-AQUI', 'reconciliacao_secret');
"@
```

(Troque o nome para `reconciliacao_url` e o valor na segunda chamada.)

*(Arquivo: [`scripts/migracao/recriar-cron-jobs.sql`](../../scripts/migracao/recriar-cron-jobs.sql).)*

---

## Parte (g) — Variáveis da Vercel

Ainda **não mude a Vercel** se as partes (d) e (e) acima não estiverem feitas — a loja
abriria com foto quebrada e link antigo, sobre um 503 que hoje pelo menos é honesto.
Quando (a)-(e.3) estiverem prontas, troque em **Production E Preview**:

Conferido no código (não é suposição): o front (`src/lib/env.ts` →
`SUPABASE_URL`/`SUPABASE_PUBLISHABLE_KEY`, usado por `src/lib/supabase.ts`) e o porteiro
(`src/hospedagem/porteiro.ts` → `resolverValoresPublicosSupabase`) leem exatamente as
mesmas duas variáveis:

| Variável | Quem lê | Valor novo |
| --- | --- | --- |
| `VITE_SUPABASE_URL` | Front e porteiro — também a origem que `parseStoreIdentity` usa para montar toda URL de imagem da identidade (ver parte e, acima) | `https://dekxabvqdsuukijblazl.supabase.co` |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Front e porteiro, primeira opção (`resolverValoresPublicosSupabase` tenta esta antes) | `sb_publishable_07V7N2KcNA3Kk7e4sxQVLA_dlOKUf14` (publicável — pode ficar em qualquer lugar, inclusive aqui) |
| `VITE_SUPABASE_ANON_KEY` | Front e porteiro, só como QUEDA se a publishable acima faltar — se existir na Vercel, atualize junto para não deixar uma chave morta como plano B silencioso | mesma publishable acima, ou a `anon` nova do projeto (Settings → API) |

O porteiro **recusa** `service_role` de propósito (comentário no próprio arquivo,
`porteiro.ts:259`) — não existe variável de service role para trocar aqui.

Depois de trocar as variáveis (em Production **e** Preview): **Redeploy** do deploy de
produção atual (sem código novo) — é isso, sozinho, que troca de banco sem esperar o
próximo PR.

---

## E agora?

Com (a) até (e.3) feitos e batendo, o **banco e o Storage** do projeto novo estão
prontos, e a Vercel (g) pode apontar para ele. Ainda faltam: publicar as edge functions
com os segredos delas (parte f — inclui recolar as credenciais do Mercado Pago do
lojista, porque aquele cofre também não sobrevive à troca de projeto), o Auth (h,
Site/Redirect URL, SMTP), o webhook do Mercado Pago (i) e os segredos do GitHub Actions
(j). Essas seções chegam numa próxima entrega deste mesmo runbook.
