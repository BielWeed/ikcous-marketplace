---
description: Criar e travar uma worktree nova (uso: /wt nome)
---

Crie a worktree `$ARGUMENTS` neste projeto seguindo a convenção da galeria.
Se o nome vier vazio, inválido (use letras minúsculas, números e hífen, até 48
caracteres) ou já existir como pasta em `.worktrees/` ou como branch
`wt/<nome>`, recuse e explique. Passos:

1. Confirme que o projeto é um repositório git. Se não for, recuse ensinando a
   rodar o instalador de projetos da galeria (todo projeto ganha git na
   instalação).
2. Garanta `.worktrees/` no `.gitignore` do projeto (adicione a linha se
   faltar).
3. Garanta que `.worktrees/estado.json` existe com o formato
   `{"versao": 1, "worktrees": []}` (crie com esse conteúdo se faltar).
4. Confira no `estado.json` e em `git worktree list` que o nome está livre.
5. Crie com `git worktree add -b wt/<nome> .worktrees/<nome>` (branch nova a
   partir do estado atual). Se a branch `wt/<nome>` já existir, recuse: nome
   novo é mais seguro que reaproveitar trabalho antigo.
6. Registre a entrada no `estado.json` (gravação atômica: escreva
   `estado.json.tmp` e renomeie por cima):
   `{"nome": "<nome>", "branch": "wt/<nome>", "criada_em": "<data/hora ISO>",
   "agente": "<seu nome de agente>", "status": "ocupada",
   "atualizada_em": "<data/hora ISO>"}` — você já nasce travado.
7. Reescreva o PAINEL-Worktrees.md (mesmo formato do `/worktrees`).
8. Anuncie na conversa: caminho da pasta, branch, que você está travado nela e
   a disciplina (trabalhar SÓ dentro dela; commitar pequeno; nunca mexer na
   worktree de outro). Se outra worktree já estiver ocupada por outro agente,
   reforce que você não vai tocá-la.
