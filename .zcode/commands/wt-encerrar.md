---
description: Encerrar worktree com merge confirmado (uso: /wt-encerrar nome)
---

Encerre a worktree `$ARGUMENTS` deste projeto de forma CONSERVADORA. Nunca
descarte trabalho; nunca una sem confirmação do dono. Passos:

1. Leia o `estado.json`. Se a worktree não existir lá, recuse. Se estiver
   `ocupada` por outro agente, recuse e diga por quem.
2. INFORME o que será unido ANTES de unir: `git log
   <principal>..wt/<nome> --oneline` e `git diff --stat <principal>...wt/<nome>`
   (branch principal = a branch atual do repositório na raiz do projeto).
   Apresente a lista de commits e o resumo de mudanças ao dono e PERGUNTA se
   confirma o merge. Sem confirmação explícita do dono, ofereça só o
   desligamento sem merge (a branch `wt/<nome>` fica preservada).
3. Exija worktree limpa: `git -C .worktrees/<nome> status --porcelain` precisa
   vir vazio. Se houver mudanças não commitadas, recuse e liste o que falta
   commitar (nada é descartado).
4. Se o dono confirmou o merge: marque `status: "mesclando"` no `estado.json`
   (gravação atômica), depois rode
   `git merge --no-ff -m "Galeria: união da worktree <nome> (wt/<nome>)"
   wt/<nome>` na raiz do projeto.
   - Em conflito: `git merge --abort`, devolva o status anterior no
     `estado.json` e explique que NADA foi perdido; o dono resolve na mão.
5. Com o merge feito (ou sem merge, se foi o que o dono escolheu):
   `git worktree remove .worktrees/<nome>`; no caso com merge,
   `git branch -d wt/<nome>` (o `-d` minúsculo só apaga branch já unida — se
   recusar, PARE e informe o dono; não use `-D`).
6. Remova a entrada do `estado.json` (gravação atômica) e reescreva o
   PAINEL-Worktrees.md.
7. Informe o resultado: o que foi unido (ou que a branch ficou preservada), o
   commit de merge gerado e o estado final do painel.
