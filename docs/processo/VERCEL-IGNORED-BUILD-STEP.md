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
if [ "$VERCEL_GIT_COMMIT_REF" = "claude/oi-uunug6" ]; then exit 0; fi; git diff --quiet HEAD^ HEAD -- . ':(exclude)docs' ':(exclude)*.md'
```

A Vercel interpreta a saída assim: **0 = pular o build**, **1 = construir**.

- **Primeira parte** (`if … exit 0`): pausa os deploys da branch `claude/oi-uunug6`. O preview fica congelado
  no último build. Para voltar a ver mudanças novas nessa branch, apague essa parte (até o primeiro `fi;`).
- **Segunda parte** (`git diff --quiet …`): pula qualquer commit, em qualquer branch, que só altere `docs/` ou
  arquivos `.md`. `git diff --quiet` sai com 0 quando não há diferença fora dessas exclusões.
- **Na dúvida, constrói.** Se o histórico git for curto demais para comparar (`HEAD^` inexistente), o comando
  falha com código diferente de 0 e a Vercel constrói normalmente. Isso evita pular um build por engano.

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
