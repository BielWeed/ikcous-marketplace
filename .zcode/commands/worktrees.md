---
description: Mostrar o painel de worktrees deste projeto em texto
---

Mostre o painel de worktrees deste projeto, atualizando o arquivo vivo
PAINEL-Worktrees.md na raiz do projeto. Passos, em português do Brasil:

1. Confirme que este projeto é um repositório git (`git rev-parse
   --is-inside-work-tree`). Se não for, explique que o suporte a worktrees
   exige git e que o instalador de projetos da galeria prepara isso.
2. Leia `<projeto>/.worktrees/estado.json` (se existir) e rode
   `git worktree list --porcelain`. Aponte divergências (registro no estado
   sem pasta; pasta sem registro).
3. Para cada worktree, colete: nome, branch (`wt/<nome>`), agente travado,
   status (`livre`/`ocupada`/`mesclando`), mudanças pendentes
   (`git -C .worktrees/<nome> status --porcelain | wc -l`) e última atividade
   (`git -C .worktrees/<nome> log -1 --format=%cI`, ou a data de criação).
4. Reescreva `<projeto>/PAINEL-Worktrees.md` com uma tabela desses dados, a
   data/hora de geração e um aviso curto da disciplina (só trabalhar na sua
   worktree; merge só com confirmação do dono).
5. Apresente a MESMA tabela na conversa e, se alguma worktree estiver ocupada,
   diga por quem. Não crie, não trave e não encerre nada neste comando.
