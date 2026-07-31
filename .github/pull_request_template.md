## O que muda e por quê

<!-- Duas linhas. O "por quê" importa mais que o "o quê" — o diff já mostra o quê. -->

Closes #

## Como testar

<!-- Passos que outra pessoa consegue repetir sem te perguntar nada.
     Se for visual, cole print do antes e do depois. -->

1.
2.

## Definition of Done

- [ ] `npm run typecheck` passa localmente
- [ ] `npm test` passa localmente
- [ ] O CI está verde nos cinco jobs
- [ ] Testei no preview deploy da Vercel, não só no localhost
- [ ] A mensagem de commit segue Conventional Commits e o escopo está em `.commitlintrc.json`
- [ ] Não sobrou credencial, `console.log` de depuração nem código comentado
- [ ] Se mudei comportamento documentado, atualizei o documento junto

## Toca em banco de dados?

- [ ] **Não toca** — pode ignorar o resto desta seção

Se toca:

- [ ] O SQL foi validado em `BEGIN; ... ROLLBACK;` contra produção e o resultado está colado abaixo
- [ ] O arquivo de rollback existe e está neste PR
- [ ] Conferi que o corpo da função ao vivo bate com o arquivo-base antes de alterar
      (`SELECT pg_get_functiondef(...)` — ver regra 1 do `CONTRIBUTING.md`)
- [ ] O Gabriel revisou (só ele aplica alteração em produção)

<!-- Cole aqui a saída da transação de validação: -->

```
```
