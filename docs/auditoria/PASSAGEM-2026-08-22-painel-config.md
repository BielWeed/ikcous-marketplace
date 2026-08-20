# Passagem de sessão — painel do lojista: Clientes, Ajustes, Cupons, Frete e Push

Documento para quem continuar isto numa sessão nova. Lê em 4 minutos.

Esta é a **segunda frente** do mesmo trabalho. A outra — Pedidos e Produtos — tem passagem
própria em [PASSAGEM-2026-08-20.md](PASSAGEM-2026-08-20.md), e o que está lá continua valendo.
Leia as duas: a árvore é compartilhada.

---

## Onde o trabalho está

- **Branch:** `fix/painel-pedidos-alto-risco` (a mesma da outra frente).
- **NADA do meu trabalho está commitado.** Está tudo no working tree, listado abaixo.
- **Nada empurrado para o GitHub. Nenhum PR aberto.**
- **A migration `20260821000200` JÁ FOI APLICADA** no Supabase de desenvolvimento, com
  autorização explícita do Gabriel, e conferida depois de aplicar.

### Arquivos meus no working tree (não commitados)

| Arquivo | O que é |
|---|---|
| `docs/auditoria/2026-08-20-painel-config.md` | o relatório: 16 achados, 4 com ✅ |
| `supabase/migrations/20260821000200_cupom_sem_limite_e_ilimitado.sql` | **já aplicada no banco** |
| `scripts/db-prove-cupom-sem-limite.cjs` | prova da migration, 30 asserções |
| `rollback-20260821000200_...sql` (raiz) | ponto de retorno da migration |
| `src/utils/regra-de-frete.ts` | as frases da tela de Frete |
| `src/views/admin/AdminShippingView.tsx` (modificado) | liga as frases na tela |
| `src/views/admin/AdminCustomersView.tsx` (modificado) | o ticket médio |
| `tests/front/admin-shipping-frases-da-regra.test.ts` | 11 casos |
| `tests/front/admin-shipping-tela-nao-promete-cobranca.test.tsx` | 6 casos |
| `tests/front/admin-customers-ticket-medio.test.tsx` | 5 casos |
| um bloco dentro de `scripts/db-apply.cjs` | a entrada `20260821000200` no `VERIFICACOES` |

⚠️ **`scripts/db-apply.cjs` é compartilhado.** A outra frente já commitou o bloco dela por
montagem cirúrgica; o meu bloco continua em disco esperando commit. Não commite o arquivo
inteiro sem separar.

---

## O que foi feito

Auditoria das cinco telas → **16 achados**, todos com evidência de tela + banco, em
[2026-08-20-painel-config.md](2026-08-20-painel-config.md). O Gabriel mandou corrigir um a um,
por ordem de dor. **Quatro estão fechados:**

| # | Defeito | Correção | Onde |
|---|---|---|---|
| 1 | Cupom com "∞ usos" era aceito no checkout e **recusado ao finalizar** — todo cupom criado sem preencher "Limite de Uso" nascia assim | `usage_limit` nulo ou `<= 0` passa a significar ilimitado nas duas RPCs de criação de pedido | migration **aplicada no banco** |
| 2 | "Frete grátis desativado. **Todos os pedidos terão cobrança de entrega**" — falso quando a taxa também está em zero, aí o app cota R$ 0,00 para o Brasil inteiro | frases saíram do JSX e viraram função pura; aviso destacado no estado perigoso | front |
| 3 | "Frete grátis a partir de R$ 100" sem dizer que **exige estar logado** | a frase passou a contar a condição | front |
| 4 | Clientes dizia "Ticket Médio R$ 28,16" e o Dashboard "R$ 40,95", mesmo rótulo | divisor passou de clientes para **pedidos** | front |

Cada correção tem teste próprio **e prova de mutação** — sabotei o código e conferi que os
testes caem. Os números estão nos blocos ✅ do relatório.

---

## ⚠️ O que falta

1. **12 achados abertos**, do 5 ao 16 no relatório. O próximo por dor é o **5**: a lista de
   Clientes mostra "Pedidos 6" e a ficha do mesmo cliente mostra "Cesta / Pedidos 16" — a
   lista filtra cancelados, a ficha não. Com 72 dos 83 pedidos cancelados, aparece em quase
   todo cliente com histórico.
2. **O `diretor` nunca rodou nesta frente.** Foram 4 entregas em sequência; a regra manda a
   conferência do conjunto. Ele deve receber: o pedido original ("audita o painel… depois
   conserta X"), a tabela acima, e o relatório.
3. **Nada foi revisado por contexto limpo.** Esta sessão foi configurada sem subagentes, então
   não houve `revisor`. Compensei com prova de mutação em tudo, mas a exigência de processo
   continua aberta — em especial para a migration, que é caminho de dinheiro.
4. **PR não aberto, nada commitado.**
5. **Achado novo, não estava na auditoria:** a outra frente aplicou a regra de "só dinheiro
   reconhecido" em nove pontos do painel analítico, mas **não** em `get_admin_customers_paged`.
   Hoje os dois dão o mesmo número porque o pg_cron já cancelou os pedidos em aberto; vai
   divergir no primeiro PIX pendente. Está escrito no fim do relatório.

---

## O que JÁ foi verificado, para não refazer

| | |
|---|---|
| `test:front` completo | **68 arquivos, 368 testes, 0 falhas** — com os 68 conferidos contra o disco |
| `test:edge` | 294 passaram |
| `test:unit` | 18 passaram |
| `typecheck` / `build` / `size` | limpos (523 kB de 800 kB) |
| `lint:links` | nenhum quebrado |
| eslint no escopo do meu diff | **0 erros, 0 avisos nas minhas linhas** — a catraca não sobe |
| prova da migration do cupom | 30 asserções, 2 mutações mortas |
| provas do frete e do ticket médio | 22 casos, 5 mutações mortas |

**A suíte de front só fica verde com `--maxWorkers=1`.** Com paralelismo ela dá falhas
diferentes a cada rodada, em arquivos que passam isolados. Não confie no vermelho paralelo, e
confira sempre o número de arquivos descobertos contra o disco.

---

## ⚠️ Armadilhas que custaram tempo nesta frente

- **O `SET SESSION` vaza entre programas.** O `DATABASE_URL` aponta para o pooler do Supabase
  (`:6543`, Supavisor), que **reaproveita a mesma conexão entre clientes diferentes**. Um
  `SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY` meu grudou na conexão e vazou para o
  script seguinte, que morreu com "cannot execute UPDATE in a read-only transaction" sem nunca
  ter pedido read-only — e chegou a produzir um **falso negativo numa auditoria de segurança
  da outra frente**, que anunciou "o buraco não existe" sobre um buraco real.
  **Use `BEGIN READ ONLY` ou `SET LOCAL`, nunca `SET SESSION`, e abra todo script com
  `RESET ALL`.** (A passagem da outra frente descreve isso como "a conexão abre em modo
  somente leitura, não é defeito" — **isso está errado**: não é característica do ambiente, é
  sujeira que alguém deixou, e some com `RESET ALL`.)
- **Prova de "está protegido" precisa de controle na mesma rodada.** "0 linhas afetadas" é o
  mesmo resultado de um instrumento quebrado. Todo teste desse tipo leva um controle positivo
  (o instrumento escreve quando tem direito?) e um alvo sabidamente vulnerável medido junto.
- **O painel do navegador ficou oculto a sessão inteira.** Sem ele o `requestAnimationFrame`
  não roda, as animações do `framer-motion` congelam e listas com `AnimatePresence` **nunca
  renderizam** — parece defeito da tela e não é. Contorno usado: no console da página,
  `(await import('/node_modules/.vite/deps/framer-motion.js')).MotionGlobalConfig.skipAnimations = true`
  e navegar por `history.pushState` + `PopStateEvent` para forçar o re-render. Nenhuma captura
  de tela foi possível nesta sessão.
- **jsdom neste projeto não traz `localStorage`, `matchMedia`, `ResizeObserver` nem
  `IntersectionObserver`.** Teste que monta tela de admin precisa dos quatro dublês, senão o
  carrossel de KPIs quebra dentro do ErrorBoundary, os cards somem do DOM e o vermelho parece
  ser do valor quando é do ambiente.
- **`git stash` nesta árvore já apagou trabalho da outra frente.** Não use `stash`, `checkout`
  nem `restore` — e proíba isso explicitamente no prompt de qualquer agente. "Já falhava antes"
  provado com stash numa árvore compartilhada não é prova.
- **`lint:ratchet` completo passa de 10 minutos nesta máquina** (o CI faz em ~1,2 min). Rodar
  o eslint só nos arquivos do diff e comparar os avisos linha a linha.
- **Escopo de commit vem de lista fechada** em `.commitlintrc.json` e não aceita português.

---

## Coordenação entre as duas sessões

- **Numeração de migration:** a outra frente fica de `20260825000000` para cima; o range
  `2026082[1-4]*` é desta. A divisão vale **daqui para frente** — as migrations `20260822*`
  já aplicadas continuam sendo dela.
- Já colidimos uma vez: as duas escreveram a **mesma** correção do cupom, reivindicando o
  mesmo número. O Gabriel ficou com a desta frente.
- **Alerta dela que eu verifiquei e é falso:** `sales_overview`, `v_store_config` e
  `vw_questions_with_answers_count` **não** têm a falha de escrita anônima — as três têm
  `security_invoker = on`. A prova está no relatório. Se ela ainda não corrigiu o relatório
  dela, isso vai virar trabalho inútil.

---

## Pendências de produto — decisão do Gabriel, não técnica

- **"Congelar Acesso"** no menu do cliente não faz nada (achado 9). Ou implementa, ou some da
  tela.
- **Os contadores inventados da tela de Push** (achados 6, 7 e 12) mostram números calculados
  por porcentagem fixa, não medidos. Consertar exige decidir o que fazer com segmentos vazios.
- **Cupom vencido continua "Ativo"** (achado 10): não existe nada que desative, e a tela
  promete que existe. Ou cria o mecanismo, ou tira a promessa.
