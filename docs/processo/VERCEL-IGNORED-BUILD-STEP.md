# Vercel: Ignored Build Step (economia de deploys de preview)

> Registro de uma configuração que mora no **painel da Vercel**, não no repositório. Existe para que ninguém
> precise lembrar de cabeça o que foi colado lá, nem por quê.

## O problema

A integração GitHub–Vercel faz um deploy de preview a cada `git push`, inclusive em commits que só mexem em
documentação. Um dia de trabalho em ondas paralelas (muitos commits pequenos) gasta deploys à toa e pode
estourar a cota do plano.

## O comando

Em **Settings › Build and Deployment** (nas versões antigas do painel, **Settings › Git**) › **Ignored Build
Step** › **Custom**:

```
if [ "$VERCEL_GIT_COMMIT_REF" = "claude/oi-uunug6" ]; then exit 0; fi; git diff --quiet HEAD^ HEAD -- . ':(exclude)docs' ':(exclude)*.md' >/dev/null 2>&1 && exit 0; exit 1
```

A Vercel interpreta a saída assim: **0 = pular o build**, **1 = construir**. **Qualquer outro código de saída
NÃO é "construir": o deploy termina em `Error`** (ver "Incidente de 10/10/2026", abaixo).

- **Primeira parte** (`if … exit 0`): pausa os deploys da branch `claude/oi-uunug6`. O preview fica congelado
  no último build. Para voltar a ver mudanças novas nessa branch, apague essa parte (até o primeiro `fi;`).
- **Segunda parte** (`git diff --quiet … && exit 0; exit 1`): pula (0) só quando o `git diff` PROVA que o commit
  não mexeu fora de `docs/` e de `.md`. Em qualquer outro caso (mexeu em código, não há `HEAD^`, não há `.git`,
  erro do git) sai com 1 e constrói.
- **Na dúvida, constrói** — e é o `&& exit 0; exit 1` que garante isso. A versão anterior do comando era só o
  `git diff --quiet …` puro, e este sai com 128/129 (não com 1) quando o git não consegue comparar.

## Cuidados

- O campo vale para o **projeto inteiro**, inclusive a branch de produção: um commit só de documentação na
  produção também não gera build. Isso é intencional.
- Se já houver um comando nesse campo, **não o apague sem registrar qual era** — ele pode ser uma regra
  importante. Junte as duas regras num só script.
- Desfazer tudo: volte o seletor para **Automatic**.

## Como conferir que funciona

Faça um commit que só altere `docs/` e envie. Na aba **Deployments** do projeto, o deploy novo deve aparecer
como **Canceled** (ou "Skipped"), com a mensagem de que o Ignored Build Step pulou o build.

Este próprio arquivo foi o commit de teste de 09/10/2026.

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

**Causa.** O `.vercelignore` tem a linha `.git` (desde 29/09), e a Vercel remove os arquivos ignorados ANTES de
rodar o Ignored Build Step. Sem `.git`, o `git diff HEAD^ HEAD` sai com **129** (uso inválido); com histórico
curto demais, sai com 128. A Vercel só entende **0 = pular** e **1 = construir**; qualquer outro código é erro.
A premissa anterior deste doc ("falha com código diferente de 0 e a Vercel constrói normalmente") estava errada.

**Conserto.** Trocar o comando do painel pelo da seção "O comando" (termina em `&& exit 0; exit 1`). Medido em
quatro cenários, com a saída de cada um: sem `.git` → 1 (constrói); só `docs/` ou `.md` → 0 (pula); código → 1
(constrói); primeiro commit, sem `HEAD^` → 1 (constrói). A linha `.git` do `.vercelignore` não precisa sair: o
comando novo não depende dela.

**Limite.** O campo mora no painel da Vercel; este repositório só registra o texto. Quem tem acesso ao projeto
precisa colar o comando novo em **Settings › Build and Deployment › Ignored Build Step**. Enquanto isso não for
feito, todo preview de `git push` continua terminando em `Error`. A publicação de produção por linha de comando
(`vercel --prod`, como a 1.5.24 em 10/10, registrada no PR #793) seguiu funcionando durante o incidente.
