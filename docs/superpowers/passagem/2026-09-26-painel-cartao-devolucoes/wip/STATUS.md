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

## cartao-edge-achados-commits.patch (base `b3a26fbc`, commit `28d8c777`)

Aplicar com `git am`. Os hooks passaram no commit.

**Pronto e testado** (257 testes passando em `criar-pagamento` e `_shared/mercadopago`):

- **A1**
  - A chave do cartão passou a ser `<pedido>:c<n>`, sem o hash do token.
  - O UPDATE da vaga do cartão não filtra mais por `payment_status`. Assim, uma
    expiração no meio da chamada cai em P1.
  - Se a vaga for perdida para outra cobrança, `cancelarOrder` roda quando a order
    está `action_required`/`created`. Nos outros casos, `alertarAdminCartaoOrfaoReal`
    manda um push para os admins.
- **A2**
  - Um cartão em `action_required`/`created` é cancelado antes de criar o PIX. Com
    `processing`, o retorno continua sendo 409.
  - `expiracaoParaDesafio3ds` estende o `expires_at` até 40 min quando surge o
    desafio 3DS.
- **A4**
  - `erro400EhDeDadoDoCartao` usa uma lista curada: `invalid_card_token`,
    `card_token_not_found`, `bad_filled_card_data`. Ela não foi confirmada na
    documentação do MP, porque o proxy bloqueia o site.
  - Qualquer outro 400 vira 502.
- O PIX continua idêntico, confirmado pelos testes fixados.

**Não iniciado:**

- **A3**, em `webhook-mercadopago/index.ts`, no bloco `rota === "payment"` que troca
  para `idGravadoNoBanco` (~linha 1667).
  - Para `pago`/`estornado`, rodar `consultarOrder(idGravado)` e só seguir se o
    status bater. Se não bater, responder 200 com `ignorado`.
  - Isso quebra 4 testes, que precisam de `fetchInspecionavel` com mocks de
    `pagamento` e de `order`: ~522, ~1233, ~1387 e ~1765 (M15).
  - Adicionar um teste para a devolução órfã.
- **Endurecimento**, no ramo `rota === "order"`, depois de `recusaLiberaAVaga`.
  - Se `statusBanco === "recusado"` e a vaga não foi liberada, ler
    `marketplace_orders.metodo_online`.
  - Se for `credito`/`debito`, liberar a vaga.
  - Adicionar 2 testes, um de cartão e um de controle com PIX.

**Depois:** rodar a suíte edge inteira (a base tem 1057 testes), `npm run lint:ratchet`
e uma nova revisão de risco.

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
