# Estado de cada trabalho parcial (26/09/2026, pausa por cota)

Os patches são `git diff` do worktree sobre a base indicada (arquivos novos
incluídos). Aplicar com `git apply` num branch criado na base, depois
verificar TUDO: nenhum deles foi verificado ainda.

## migrations-achados-wip.patch (base `b3a26fbc`)

- Código escrito, sem nenhuma execução: nem Postgres, nem Deno, nem tsc.
  Espere 1–2 rodadas de correção.
- Achados cobertos no código:
  - **A:** cupom rateado no retrato, com limite no disponível.
  - **B:** lista de permissão com NULL.
  - **C:** `devolver_estoque` desconta o que já foi reestocado.
  - **D:** a gaveta subtrai o estorno externo. O filtro `estornado` foi mantido de propósito, porque tirá-lo subtrairia duas vezes.
  - **E:** categorias `fora_dre`.
  - **F:** coluna `estorno_manual_registrado_em`, com a redefinição de `registrar_estorno_manual` na **76**, não na 77, por causa do teste "Financeiro não escreve em pedido".
  - **G:** mais de 180 dias vai para o manual, mais a RPC `admin_devolucao_reemitir_reembolso`, já tipada em `database.types.ts`.
  - **H:** revalida no lock.
  - **K:** o CMV exclui `stock_returned_at`.
  - **L:** grant por coluna só em `config_pagamento_cartao`. Não foi feito em `politica_devolucao`, porque o front das devoluções lê essa tabela com `select("*")`.
  - **M:** sem cair em `updated_at`.
  - **R:** `DO` de guarda nos 3 rollbacks.
  - Casos vivos escritos para os 4 mutantes.
- Arquivos tocados:
  - migrations 75, 76 e 77 e seus rollbacks;
  - `tests/migration_a_devolucao_nasce_no_pedido_test.ts` e `tests/migration_o_cartao_online_nasce_test.ts`;
  - `tests/banco/{devolucoes,financeiro,cartao-online}-viva.cjs`;
  - `src/types/database.types.ts`.
- Próximo passo, na ordem:
  1. Provas vivas: `tests/banco/devolucoes-viva.cjs` e `financeiro-viva.cjs`, via `rodar-isolado.cjs`, em Postgres 17 efêmero.
  2. A réplica completa do rpc-ci, incluindo os invariantes de dinheiro.
  3. Dupla aplicação, e rollback seguido de reaplicação para 75, 76 e 77.
  4. `deno test` dos `tests/migration_*_test.ts`.
  5. `npx tsc -b` e `npm run lint:ratchet`.
  6. Nova revisão de risco independente.
- Ainda falta o grant por coluna em `politica_devolucao`: trocar o `select("*")` do front por colunas explícitas antes.

## cartao-edge-achados-wip.patch (base `b3a26fbc`)

- Retrato intermediário: o agente ainda não tinha respondido quando a pausa
  começou. Se houver `cartao-edge-achados-commits.patch`, ele vale mais.
- Escopo: A1–A4 mais o endurecimento de `metodo_online`, em
  `supabase/functions/{criar-pagamento,webhook-mercadopago,reconciliar-pagamentos,_shared}`.
- Verificar com `deno test` da pasta `supabase/functions`. A base tinha 1057 testes passando.
- Os cenários do revisor precisam virar testes:
  - duas abas → 1 order aprovada;
  - resposta perdida + nova tentativa → 1 order;
  - expira durante a chamada → P1;
  - 3DS abandonado → PIX liberado;
  - PIX idêntico ao de antes.

## portao-dividido-wip.patch (base `03f3eb76`)

- Só existe o arquivo novo `scripts/portaoDividido.ts`, com
  `classificarBundle`/`ehFronteiraDoPainel` e o plugin. Nada ligado nem testado.
- A fronteira confirmada é a entrada dinâmica cujo facade termina em
  `/src/components/layouts/AdminArea.tsx`.
- `AdminLoginView` é lazy direto do `App.tsx` e por isso cai em **cliente** pelo grafo,
  o que é correto.
- Falta, na ordem:
  1. Teste Vitest em `tests/front/` no padrão de `identity-build-config.test.ts`, escrito primeiro para falhar.
  2. `scripts/validarPortaoDeTamanho.cjs`, que falha fechado.
  3. `.size-limit.cjs` com 4 entradas: cliente 800 kB, painel 350 kB, css 100 kB e zxing 400 kB, mantendo `webpack:false`/`running:false`.
  4. Ligar o plugin no `vite.config.ts`, só no build.
  5. `/.portao-tamanho/` no `.gitignore`.
  6. Atualizar a documentação em `docs/onboarding/02-ARQUITETURA.md` e `03-SETUP-AMBIENTE.md`.
  7. Verificação completa:
     - build fixture, com `IKCOUS_CODE_SHA` de 40 caracteres;
     - porteiro: `npx vitest run --config vitest.porteiro.config.ts`;
     - `IKCOUS_IDENTITY_MODE=fixture npm run size`;
     - `tsc -b`;
     - `lint:ratchet`.
