# Como as frentes eram executadas (e como fazer sem a mesma ferramenta)

`wf-implementa.js.txt` (salvo com sufixo `.txt` para ficar fora do lint; renomeie para `.js` ao usar) é o script que a sessão usava na ferramenta Workflow do Claude Code: recebe uma
frente (`frente`), o arquivo de especificação (`arquivo`, um dos `../frentes/*.json`), a lista de
tarefas (`tarefas: [{id, titulo}]`, id e título IGUAIS aos do JSON) e os modelos (`modelo_impl`,
padrão `sonnet`; `modelo_rev`, padrão `opus`). Para cada tarefa, em série: um agente IMPLEMENTADOR
(lê a entrada do JSON, escreve o teste que falha, implementa, roda a verificação do projeto, relata) e
um agente REVISOR em contexto limpo (lê só o diff dos arquivos da tarefa, roda tudo de novo e devolve
`veredito` — `passa` / `passa com ressalva` / `nao passa` — com `achados` classificados em BLOQUEIA,
ANTES DE CRESCER e ANOTADO). Uma reprovação manda a tarefa de volta ao implementador (`r2`, `r3`).
O orquestrador (a sessão principal) nunca implementa: lê o journal, corrige ANTES DE CRESCER pequenos,
verifica na cópia limpa e commita por caminho.

Retomada depois de interrupção: `Workflow({scriptPath, resumeFromRunId, args: <os MESMOS args>})`;
agentes já concluídos voltam do cache. Sem os args ele falha.

Limites desta máquina (4 núcleos, 16 GB): no máximo 2 workflows ao mesmo tempo; `VITEST_MAX_WORKERS=1`
e `NODE_OPTIONS=--max-old-space-size=2048` no ambiente; a frente `tooling` roda `npm run build` e vai
sozinha ou com 1 outra.

Sem a ferramenta Workflow: faça o mesmo à mão. Para cada tarefa do JSON, leia `instrucoes`,
`criterio_de_aceite`, `testes`, `riscos` e `nao_fazer`; implemente com o teste antes; peça a revisão a
um agente NOVO (sem o contexto da implementação) com o texto do prompt de revisão que está no fim do
script (procure `Faça você mesmo: rode os testes da tarefa`); só então commite por caminho, seguindo a
rotina do `../00-LEIA-PRIMEIRO.md`.
