# A organização central do Supabase — criar, provar o token, transferir e desfazer

> Escrito em 27/11/2026 (A23 do plano da org central), a partir da seção 6 do plano
> `PLANO-NOVA-LOJA-ORG-CENTRAL-26-11` e conferido no código de
> [`scripts/frota/org-central.json`](../../scripts/frota/org-central.json),
> [`scripts/frota/medir-token-da-org.cjs`](../../scripts/frota/medir-token-da-org.cjs) e
> [`scripts/frota/copiar-banco.mjs`](../../scripts/frota/copiar-banco.mjs) nesta data.
> **Nenhuma destas receitas foi executada ainda.** A abertura de loja nova está em
> [ligar-loja-nova.md](ligar-loja-nova.md).

## O que é, em uma frase

A partir de 01/12/2026, a IKCOUS é dona de todos os bancos das lojas, numa organização paga só do
Supabase, a **"IKCOUS Lojas"**. A IKCOUS e a Savy mudam para ela por **transferência de projeto**,
que mantém os dados, o endereço e as chaves da loja.

## O que a transferência faz e não faz (documentação do Supabase)

- **Mantém** os dados, o endereço do projeto e as chaves de API. A loja não muda de endereço.
- **Exige** que o dono seja **Owner** da organização de origem, e que nada bloqueie a troca
  (conexão com GitHub, fatura atrasada).
- **Não tem "desfazer".** Para voltar, transfere-se de novo, para a organização antiga.
- O banco só reinicia se o tamanho da máquina mudar. Do Free para o Pro ele continua do mesmo
  tamanho, então **não deve haver queda**.
- **Tokens limitados à organização de origem param de valer para aquele projeto.** Tokens antigos
  de acesso total continuam valendo se o dono for membro da organização de destino.
- **Os dois projetos de hoje se chamam "BielWeed's Project".** Na transferência, o projeto se
  identifica pelo **ref no endereço da página**, nunca pelo nome:
  - IKCOUS: `cafkrminfnokvgjqtkle` (organização de hoje: `gestaolojinha`);
  - Savy: `gnjsrucsmjkajijrakzr` (organização de hoje: `loja-Savy-cliente-01`).

## As peças no repositório

| Peça | Para que serve |
|---|---|
| [`scripts/frota/org-central.json`](../../scripts/frota/org-central.json) | O slug da organização central (`null` até ela existir), o nome dela, a chave do cofre (`org-ikcous-lojas`) e o NOME do segredo dos workflows (`SUPABASE_ACCESS_TOKEN_LOJAS`) |
| `node scripts/frota/nova-loja.mjs autorizar` | A autorização OAuth da organização, uma vez só, no PC do dono ([ligar-loja-nova.md](ligar-loja-nova.md#autorizar--a-autorização-da-organização-no-terminal-do-dono)) |
| `.github/workflows/medir-token-da-org.yml` | A prova de que o segredo dos workflows enxerga **só** a organização central |
| `node scripts/frota/copiar-banco.mjs` | A cópia do banco de uma loja no PC, antes da transferência |

---

## 6.1 — 01/12: criar a organização e assinar o Pro

1. **No Chrome, abra `supabase.com/dashboard`.**
   - Vai aparecer: a lista de projetos, com o nome da organização no canto de cima à esquerda.
2. **Clique no nome da organização (canto de cima à esquerda) e depois em "New organization".**
   - Vai aparecer: um formulário com Name, Type e Plan.
3. **Preencha:**
   - Name: `IKCOUS Lojas`;
   - Type: `Company`;
   - Plan: `Pro`.

   Clique em "Create organization".
   - Vai aparecer: a tela de pagamento. **O cartão é você quem digita.**
   - **Deu certo se:** a organização "IKCOUS Lojas" aparece com a etiqueta "Pro", sem nenhum
     projeto.
   - **Se aparecer diferente:** se o plano Pro não aparecer no formulário, crie como Free e vá em
     Billing → "Upgrade to Pro". Se ele pedir algo além do cartão, **pare e me mande um print**.
4. **Vercel Pro.** Abra `vercel.com` → o time `gabriels-projects` → Settings → Billing →
   "Upgrade to Pro".
   - **Deu certo se:** o time mostra "Pro" e o projeto `ickous-marketplace` continua na lista.
   - **Se aparecer diferente:** se a tela mandar **criar um time novo** ou mover o projeto,
     **pare**. Mover o projeto troca o id dele, e isso quebra o inventário da frota.
5. **O slug da organização (eu).** Leio o slug da "IKCOUS Lojas" pelo login do CLI do Supabase
   (`supabase orgs list`, só leitura) e gravo em `scripts/frota/org-central.json`, num PR (B2 do
   plano). Até esse PR entrar, o `criar-projeto` e o `medir-token-da-org.yml` respondem que a
   organização ainda não existe.
6. **A autorização (você, uma vez).** É o `autorizar` do
   [ligar-loja-nova.md](ligar-loja-nova.md#autorizar--a-autorização-da-organização-no-terminal-do-dono):
   duas rodadas no PowerShell e, no meio, marcar **só "IKCOUS Lojas"** na tela "Authorize IKCOUS".
   - **Deu certo se:** a segunda rodada diz `SIM` (`autorização da org recebida`).
   - **Se aparecer diferente:** se um passo de loja depois disser "a autorização tem de cobrir
     exatamente a organização", rode o `autorizar` de novo e escolha a organização certa.
7. **O token dos workflows** — a próxima seção.

## O token dos workflows e a prova do escopo

**Por que tem prova:** um token **pessoal** do Supabase (Account → Access Tokens, sem escolher
organização) alcança a **conta inteira** do dono: a IKCOUS, a Savy e qualquer outro projeto.
Guardado como o segredo da organização, ele daria a todo workflow de toda loja nova o alcance dos
bancos da IKCOUS e da Savy. O segredo só pode ficar se o `medir-token-da-org.yml` **provar** que
ele enxerga uma organização só, a central.

**Que token é esse:** o mais provável é um token com escopo de organização (o Supabase chama de
"scoped personal access token", e ele começa com `sbp_fc`) ou o token do OAuth App. **Qual dos
dois, com quais permissões e com qual validade sai do ensaio M3 do plano, ainda não feito.** Até o
M3, pare antes do passo 1 abaixo e me chame: eu escrevo aqui as permissões certas.

1. **No Chrome:** avatar (canto de cima à direita) → Account → Access Tokens → "Generate new
   token".
   - Escolha o acesso por organização: **só "IKCOUS Lojas"**.
   - Permissões: as que eu deixar escritas aqui depois do M3.
   - Validade: a mais longa oferecida.
   - Copie o token.
2. **No PowerShell, na pasta do repositório:**

   ```powershell
   gh secret set SUPABASE_ACCESS_TOKEN_LOJAS
   ```

   - Vai aparecer: "Paste your secret". Cole e tecle Enter.
   - **Deu certo se:** aparecer `✓ Set Actions secret`.
   - **Feche a aba do token sem salvar o valor em lugar nenhum.**
3. **A prova (eu).** Rodo o workflow, só leitura:

   ```powershell
   gh workflow run medir-token-da-org.yml --repo BielWeed/ikcous-marketplace --ref <ramo> -f expected_sha=<SHA completo do topo do ramo>
   ```

   Ele faz duas leituras (`GET /v1/organizations` e `GET /v1/projects`) e:
   - fica **verde** (`PROVADO`) só se o token enxerga **exatamente uma** organização, com o slug
     de `org-central.json`, e todo projeto que ele enxerga é dela;
   - fica **vermelho** com **"o segredo é amplo demais"** se enxerga qualquer organização ou
     projeto a mais (o log diz quantos, e o nome das lojas do cadastro que apareceram, nunca o
     nome nem o ref de organização ou projeto alheio);
   - fica **vermelho** em 401/403 (o segredo não vale ou não tem permissão de leitura), sem o
     slug em `org-central.json`, ou se uma loja do cadastro que usa o segredo da organização não
     aparece.

   **O esperado logo depois de gravar (B3):** verde, com a organização central e **0 projetos**.
   **O esperado depois de transferir a IKCOUS (B5):** verde, com a IKCOUS visível (`ikcous-publicada:
   sim`). Isso prova que o token enxerga um projeto que chegou depois dele. **Se não enxergar,
   nenhuma loja nova abre até trocar o token.**

**Se der "o segredo é amplo demais":** o token gravado alcança mais do que a organização. Nenhuma
loja entra no cadastro com ele. Gere outro token com acesso só à "IKCOUS Lojas", grave por cima
com o mesmo `gh secret set` e rode a prova de novo. Depois, **revogue o token largo** em Account →
Access Tokens (o botão de apagar ao lado dele).

---

## 6.2 — Transferir a IKCOUS

**Antes (eu, só leitura), e guardo as respostas:**

- `supabase projects list`: organização, ref, região e status;
- a lista de functions;
- o registro de migrations aplicadas;
- o `version.json` de `ickous-marketplace.vercel.app`;
- a lista das tarefas agendadas do banco (`cron.job`);
- **a cópia do banco no PC**, com o [`copiar-banco`](#a-cópia-do-banco-no-pc-copiar-banco).

**Antes (você):** no Chrome, organização `gestaolojinha` → Settings → Team. A sua linha tem de
dizer **Owner**. Se não disser, pare.

1. **Abra `supabase.com/dashboard/project/cafkrminfnokvgjqtkle/settings/general`.**
   - O projeto se chama "BielWeed's Project", igual ao da Savy: confira o `cafkrm…` no endereço.
   - Vai aparecer: as configurações gerais e, no fim da página, "Transfer project".
2. **Clique em "Transfer project" e escolha "IKCOUS Lojas".**
   - Vai aparecer: uma lista de conferências.
   - **Só siga se todas estiverem verdes.** Se uma falhar ("GitHub connection", "Vercel",
     fatura), me mande o print. O botão fica cinza até tudo passar.
3. **Clique em "Transfer Project".**
   - **Deu certo se:** o projeto passa a aparecer dentro de "IKCOUS Lojas".

**Depois (eu):**

- `GET /v1/projects/cafkrminfnokvgjqtkle`: a organização é a central, e o status é
  `ACTIVE_HEALTHY`;
- o site abre e o `version.json` está igual ao de antes;
- functions, migrations e tarefas agendadas iguais à fotografia de antes;
- o `conferir-banco-da-loja.yml` só leitura em `ikcous-publicada`, com o segredo de hoje
  (`SUPABASE_ACCESS_TOKEN_IKCOUS`). Se der 401 ou 403, o token era limitado à organização antiga,
  e você gera um novo pela receita de [rotacao-credenciais-supabase.md](rotacao-credenciais-supabase.md);
- a prova do token de novo (B5), na seção [O token dos workflows](#o-token-dos-workflows-e-a-prova-do-escopo).

**Desfazer:** a mesma tela, "Transfer project" → `gestaolojinha`. A organização antiga fica,
**não apague**. Os dados e as chaves não mudam em nenhum dos dois sentidos.

## 6.3 — Transferir a Savy (de madrugada)

É igual à 6.2, com três diferenças:

- a organização de origem é `loja-Savy-cliente-01`, e a conferência de **Owner** é nela;
- a cópia do banco no PC (`copiar-banco --loja savy`) é **obrigatória** antes;
- vai num horário sem venda (madrugada), e só com a IKCOUS estável há 24 horas ou mais depois da
  transferência dela.

A página é `supabase.com/dashboard/project/gnjsrucsmjkajijrakzr/settings/general` (confira o
`gnjsru…` no endereço).

**Depois:** além das conferências da 6.2, eu confiro só por leitura o último pedido pago e o
`conferir-banco-da-loja.yml` em `savy`, com `SUPABASE_ACCESS_TOKEN_SAVY`.

**Desfazer:** transferir de volta para `loja-Savy-cliente-01`, que fica vazia e **não se apaga**.

---

## A cópia do banco no PC (`copiar-banco`)

**O que faz:** guarda no PC do dono o esquema e os dados do banco de uma loja, pelo
`supabase db dump` do CLI, com o **login do CLI do dono** (sem a senha do banco). É o que sobra se
a transferência der errado.

**Antes:**

- o **Docker Desktop ligado** (o `db dump` roda o `pg_dump` num contêiner);
- o CLI do Supabase logado com a conta do dono (`supabase login`, uma vez);
- a pasta do repositório aberta no PowerShell, como em
  [ligar-loja-nova.md](ligar-loja-nova.md#abrir-o-terminal-no-lugar-certo).

Primeiro o ensaio (nada roda, nada se cria):

```powershell
node scripts/frota/copiar-banco.mjs --loja ikcous-publicada
```

- **Vai aparecer:** `ENSAIO (nada rodou): copiaria o banco de ikcous-publicada (ref ...)`, os dois
  comandos que ele rodaria e os dois arquivos que ele criaria.

Depois, de verdade:

```powershell
node scripts/frota/copiar-banco.mjs --loja ikcous-publicada --aplicar
```

(Na Savy, `--loja savy`.) Pode demorar alguns minutos.

- **Deu certo se** aparecer `SIM: cópia do banco de ... gravada:` e os dois arquivos, cada um com o
  tamanho em bytes, em `$env:LOCALAPPDATA\ikcous\copias\`:
  - `<loja>-<ref>-<data e hora>-esquema.sql` (as tabelas, funções e regras);
  - `<loja>-<ref>-<data e hora>-dados.sql` (as linhas).
- **Se aparecer `NÃO`:**
  - `saiu com código N`: o Docker Desktop está ligado? O CLI está logado com a conta do dono? O
    projeto está ativo? A fala do CLI **não é mostrada de propósito** (ela pode ter o endereço de
    conexão do banco). Confira os três e rode de novo: nenhum arquivo pela metade fica na pasta.
  - `o supabase não rodou`: o CLI do Supabase não está instalado ou não está no PATH.
  - `loja fora do cadastro`: use o NOME da loja do `scripts/frota/lojas.json` (`ikcous-publicada`,
    `savy`), nunca o ref.
  - `a pasta das cópias não pode ficar dentro ...`: a variável `LOCALAPPDATA` aponta para dentro de
    um repositório git. Pare e me chame.
  - `já existe ...`: espere um segundo e rode de novo (o nome leva a hora).

**Cuidado com o arquivo:** ele tem **dado de cliente** (nomes, e-mails, endereços, pedidos). Não
mande a ninguém, não ponha no repositório, não suba para nuvem pública. Para guardar fora do PC,
use um pendrive ou o Drive pessoal do dono.

**O que ele deixa no banco da loja:** como todo comando do CLI sem a senha do banco, ele cria
sozinho um papel temporário chamado `cli_login_postgres` no banco da loja. Isso é do próprio
Supabase e não muda dado nenhum.

**Os papéis do banco** (`--role-only`) não entram na cópia: ela tem o esquema e os dados.

---

## Desfazer — tudo num lugar só

| O que foi feito | Como desfazer |
|---|---|
| Criar a organização "IKCOUS Lojas" | Enquanto ela estiver vazia: Billing → voltar ao Free, e depois apagar a organização (decisão do dono; para de cobrar). Com projeto dentro, primeiro transferir os projetos de volta. |
| Vercel Pro | Billing do time → voltar ao Hobby (decisão do dono). O projeto não muda de id. |
| Slug em `org-central.json` (B2) | Um PR que volta o `slug` para `null`. Todo `criar-projeto` volta a responder NÃO. |
| `autorizar` | Revogar no painel: "IKCOUS Lojas" → Organization settings → OAuth Apps → Authorized apps → Revoke (confira o nome na tela). Todo passo de loja para até um `autorizar` novo. |
| `SUPABASE_ACCESS_TOKEN_LOJAS` | Revogar o token em Account → Access Tokens. O segredo do GitHub fica com um valor que não vale mais, e os workflows das lojas da organização param com 401 (falha fechada). Para trocar, grave um token novo por cima com `gh secret set` e rode a prova de novo. |
| Transferir a IKCOUS | Transferir de volta para `gestaolojinha` (a mesma tela). Dados, endereço e chaves não mudam. |
| Transferir a Savy | Transferir de volta para `loja-Savy-cliente-01`. Dados, endereço e chaves não mudam. |
| A cópia do banco no PC | Os arquivos em `$env:LOCALAPPDATA\ikcous\copias\` ficam até o dono decidir apagar (dado de cliente; não apagar antes de a transferência estar confirmada). |
