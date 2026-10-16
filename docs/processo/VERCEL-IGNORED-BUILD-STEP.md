# Vercel: Ignored Build Step (economia de deploys de preview)

> Registro da regra que decide se um `git push` gera deploy na Vercel. Desde 10/10/2026 ela mora no
> **`vercel.json`** (chave `ignoreCommand`, versionada com o código) e DEVE morar também, com o mesmo texto, no
> **painel da Vercel** (Settings › Build and Deployment › Ignored Build Step). **Pendente:** hoje o painel ainda
> tem o texto de 09/10 (sem a regra da `main` e sem o `&& exit 0; exit 1`); até alguém atualizá-lo, a proteção da
> `main` depende só desse texto antigo. Existe para que ninguém precise lembrar de cabeça o que foi colado onde,
> nem por quê.

## O problema

A integração GitHub–Vercel faz um deploy de preview a cada `git push`, inclusive em commits que só mexem em
documentação. Um dia de trabalho em ondas paralelas (muitos commits pequenos) gasta deploys à toa e pode
estourar a cota do plano.

## O comando

No `vercel.json` (`ignoreCommand`) e, com o MESMO texto, no painel › **Custom**:

```
case "$VERCEL_GIT_COMMIT_REF" in claude/oi-uunug6|claude/app-major-upgrade-wmc8x2|main) exit 0;; esac; git diff --quiet HEAD^ HEAD -- . ':(exclude)docs' ':(exclude)*.md' >/dev/null 2>&1 && exit 0; exit 1
```

**Limite da Vercel: o comando tem de ter NO MÁXIMO 256 caracteres.** Em 16/10/2026 a versão com três `if`/`||` chegou a
280 e a publicação do dono parou em `projectSettings.commandForIgnoringBuildStep should NOT be longer than 256
characters` (a CLI envia o `ignoreCommand` do `vercel.json` como configuração do projeto). A forma com `case` faz
exatamente o mesmo (medido: mesmas saídas para `claude/oi-uunug6`, a branch principal, `main`, outra branch, `develop`
e ref vazio) e tem 203. O teste `vercel-so-constroi-o-que-vai-ao-ar` reprova se passar de 256.

A Vercel interpreta a saída assim: **0 = pular o build**, **1 = construir**. **Qualquer outro código de saída
NÃO é "construir": o deploy termina em `Error`** (ver "Incidente de 10/10/2026", abaixo).

- **Primeira parte** (`if … exit 0`): nunca constrói por `git push` nas branches `claude/oi-uunug6` (preview
  congelado no último build; para voltar a ver mudanças nela, tire só essa condição) e `main` (ver "Por que a
  `main`", abaixo).
- **Segunda parte** (`git diff --quiet … && exit 0; exit 1`): pula (0) só quando o `git diff` PROVA que o commit
  não mexeu fora de `docs/` e de `.md`. Em qualquer outro caso (mexeu em código, não há `HEAD^`, não há `.git`,
  erro do git) sai com 1 e constrói.
- **Na dúvida, constrói** — e é o `&& exit 0; exit 1` que garante isso. A versão de 09/10 era só o
  `git diff --quiet …` puro, e este sai com 128/129 (não com 1) quando o git não consegue comparar.

### Por que a linha de trabalho do dono (`claude/app-major-upgrade-wmc8x2`) — 16/10/2026

Medido pela CLI da Vercel (só leitura): cada merge nessa branch gerou um deploy de Preview real (2 a 3 min de
build), mesmo com `claude/**: false` em `git.deploymentEnabled` (96 deploys de Preview em 24 h, perto do limite
diário do plano, que a release precisa). Esses previews não servem a nada: a produção sai só pela CLI do dono
(`vercel --prod --skip-domain` e `vercel promote`) e os testes de navegador rodam no CI. A branch entrou na
primeira parte do comando e a chave exata dela em `deploymentEnabled` passou de `true` para `false` (era um
`true` de 15/10 que vencia o `claude/**: false`: a Vercel faz deploy se QUALQUER regra que casa for `true`, e o
`ignoreCommand` sozinho só cancela o build depois de o deploy ser criado). Para voltar a ver preview dela, desfaça
as duas coisas; o teste `tests/front/vercel-so-constroi-o-que-vai-ao-ar.test.ts` guarda a regra.

### Por que a `main`

A produção deste projeto sai SÓ pela linha de comando do dono (`vercel --prod --skip-domain` e depois
`vercel promote`, ver `docs/runbooks/producao-unica-fonte.md`). Um push na `main` que construísse como `Production`
poderia, com a atribuição automática de domínios ligada, trocar a versão da frota inteira sem passar pelo
`promote`. O runbook de 30/09 já registrava que "builds disparados por push na `main` são PULADOS" por este
passo; o comando de 09/10 perdeu essa regra e a `main` ficou protegida só por acidente (todo deploy dava
`Error`). **Não cole no painel uma versão do comando sem a regra da `main`** sem antes confirmar no painel que a
`main` não é mais a branch de produção ou que a atribuição automática de domínios está desligada.

## Cuidados

- O campo vale para o **projeto inteiro**: um commit só de documentação (em qualquer branch) também não gera
  build, quando o git consegue compará-lo. Isso é intencional.
- **O `vercel.json` vale por commit.** Branches cujo `vercel.json` não tem a chave `ignoreCommand` continuam sob
  o comando do painel: hoje isso inclui `main`, `production`, `develop`, `claude/oi-uunug6` e a linha de trabalho
  do dono até este arquivo chegar a elas. **Na `main`, portanto, a proteção depende 100% do painel.** Por isso o
  painel deve ter o mesmo texto.
- Se já houver um comando no painel, **não o apague sem registrar qual era** — ele pode ser uma regra importante.
- **Desfazer tudo:** remova `ignoreCommand` do `vercel.json` **e** volte o seletor do painel para **Automatic**
  (só uma das duas não basta).
- **Vários commits no mesmo push:** o comando só compara `HEAD^` com `HEAD`. Um push `[commit em src/, commit só em
  docs/]` tem o topo só de docs: o comando sai com 0 e o build do código do commit anterior é pulado até o próximo
  push com código. A alternativa é comparar com `$VERCEL_GIT_PREVIOUS_SHA` (último deploy bem-sucedido da branch),
  mantendo o fallback de construir; não foi adotada porque não pôde ser testada fora da Vercel.

## Limite conhecido: hoje o pulo de "só docs" não acontece

O `.vercelignore` tem a linha `.git` (desde 29/09) e a Vercel remove os arquivos ignorados ANTES de rodar este
passo. Sem `.git`, o `git diff` não compara nada, o comando sai com 1 e **todo push constrói**, inclusive os de
documentação. Ou seja: o comando de 10/10 elimina o `Error`, mas não devolve a economia de deploys. Para ter a
economia, a linha `.git` precisa sair do `.vercelignore` (a CLI da Vercel não sobe `.git` de qualquer forma) e o
clone da Vercel precisa ter `HEAD^` (se for raso demais, o comando também constrói, que é o lado seguro). Isso é
decisão do dono e não foi feito.

## Como conferir que funciona

- **O que prova o conserto:** o deploy de preview de um `git push` NÃO termina em `Error` (fica `Building`/`Ready`).
- **O que só valeria com `.git` fora do `.vercelignore`:** um commit que só altere `docs/` aparecer como
  **Canceled** ("Skipped"). Enquanto a linha `.git` estiver lá, esse resultado não acontece (ver acima).

## Incidente de 10/10/2026: todo deploy de preview terminava em `Error`

**Sintoma.** Depois de 09/10 (último preview com sucesso: PR #790, 18:38), todo `git push` gerava um deploy de
preview com status `Error`, sem build. O log (`npx vercel inspect <dpl_…> --logs`) mostra o comando do Ignored
Build Step falhando antes de qualquer build:

```
Found .vercelignore
Removed 143 ignored files defined in .vercelignore
Running "if [ "$VERCEL_GIT_COMMIT_REF" = "claude/oi-uunug6" ]; then exit 0; fi; git diff --quiet HEAD^ HEAD -- . ..."
warning: Not a git repository. Use --no-index to compare two paths outside a working tree
status ● Error
```

**Causa.** O `.vercelignore` tem a linha `.git`, e a Vercel remove os arquivos ignorados ANTES de rodar o Ignored
Build Step. Sem `.git`, o `git diff HEAD^ HEAD` sai com **129** (uso inválido); com histórico curto demais, sai
com 128. A Vercel só entende **0 = pular** e **1 = construir**; qualquer outro código é erro. A premissa anterior
deste doc ("falha com código diferente de 0 e a Vercel constrói normalmente") estava errada.

**Conserto.** O comando da seção "O comando", que termina em `&& exit 0; exit 1`. Testado com o `ignoreCommand`
extraído do próprio `vercel.json`, em 8 cenários: sem `.git` → 1; só `docs/` ou `.md` → 0; código → 1; push na
`main` com código → 0; branch congelada → 0; a linha de trabalho do dono com código → 1; um branch chamado
`mainline` (não é a `main`) com código → 1; primeiro commit, sem `HEAD^` → 1.

**Onde ele está agora.** No `vercel.json` (`ignoreCommand`). Pela documentação da Vercel, o `ignoreCommand` do
`vercel.json` vale sobre o campo do painel; **isso não foi verificado aqui** (o ambiente do agente não alcança a
documentação da Vercel; o código da CLI da Vercel confirma que a chave é lida e enviada como substituição do
comando do projeto). A prova é o primeiro `git push` depois dessa mudança: se o preview sair de `Error`, o
`vercel.json` está valendo. Se continuar em `Error`, o campo do painel venceu: cole o comando de "O comando" lá,
**com a regra da `main`**.

A publicação de produção por linha de comando (`vercel --prod`, como a 1.5.24 em 10/10, registrada no PR #793)
seguiu funcionando durante o incidente.
