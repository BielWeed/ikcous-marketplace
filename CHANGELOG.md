# Changelog

Formato baseado em [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/),
versionamento por [SemVer](https://semver.org/lang/pt-BR/).

Este arquivo começa na `1.0.1`, a **primeira release sob o GitFlow** implantado em 30/07/2026
(PR #11). A `1.0.0` que consta no `package.json` desde o início do projeto nunca foi tagueada e
não tem escopo registrado — não há como reconstruí-lo com honestidade, então ele não está aqui.

## [1.0.2] — 2026-08-05

Release de segurança de dados do cliente. Quatro vazamentos fechados, todos medidos contra o banco
de produção antes e depois — e nenhum deles era visível para quem compra, o que é justamente o
problema de vazamento: ninguém percebe.

O que o **lojista** vai notar são as duas outras coisas: cadastrar produto voltou a funcionar, e o
botão de pré-visualizar saiu de trás do menu.

### Corrigido

- **Faturamento consolidado da loja legível por qualquer cliente cadastrado** (#103). A RPC
  `get_category_analytics` é `SECURITY DEFINER` — ignora o RLS de pedidos, itens e produtos — e não
  tinha checagem de quem chamou, com `EXECUTE` para `authenticated`. Qualquer pessoa que criasse
  conta extraía faturamento por categoria, número de pedidos, ticket médio e frete arrecadado com
  uma chamada. Medido: um cliente comum lia 4 linhas de faturamento antes da guarda.
- **Cliente logado cancelava pedido de convidado, e a venda era desfeita** (#115). A checagem de
  dono usava `!=`, e em SQL `NULL != <uuid>` avalia para NULL, não para true. Pedido de convidado
  tem `user_id` NULL, então a exceção de autorização nunca acontecia. Cancelar devolve o estoque, e
  o id do pedido aparece na tela de sucesso, no rastreio e em qualquer print. O autocancelamento de
  convidado, que só funcionava por causa deste bug, deixou de existir — o botão passou a exigir
  sessão.
- **Margem de todo produto ativo legível por qualquer cliente cadastrado** (#119). Não era
  privilégio de coluna mal posto: `authenticated` tinha `SELECT` de tabela inteira em `produtos`, e
  a policy libera a linha pela vitrine. Medido: 18 de 18 produtos ativos, com `custo`.
- **O código de rastreio de convidado abria o pedido de outra pessoa** (#118). Era o único achado
  crítico ainda aberto da auditoria de 29/07. A tela pedia e-mail, WhatsApp e um ID de pedido
  marcado como opcional; a RPC casava os dois canais com `OR`, e o ID vazio virava um curinga que
  casava qualquer pedido. Quem soubesse o WhatsApp de um cliente recebia **na própria caixa** o
  código que abria nome, e-mail, telefone, itens, totais e endereço da vítima. E não havia limite de
  tentativas no código de 6 dígitos. Agora os dois canais são obrigatórios, o ID do pedido também,
  o código fica amarrado a um pedido só, e morre em 5 tentativas erradas.
- **Cadastro de produto novo estava quebrado** (#119, achado no caminho). O painel devolvia "Erro ao
  processar as modificações do produto". A causa: `vw_produtos_admin`, chamada em sete pontos do
  front, tinha sumido do banco sem deixar migration. A listagem sobrevivia porque cai numa view
  pública quando a de admin falha, e foi esse silêncio que segurou o defeito em produção por tempo
  indeterminado.
- **Botão "Visualizar App" escondido atrás do menu inferior** (#138). Empilhamento: o botão era
  `z-50`, o menu do admin é `z-60`, e os dois ocupavam a mesma faixa da tela no celular.

### Infraestrutura

- Cada correção de banco tem um script de prova versionado, que reproduz o defeito e mede a
  correção numa transação terminada em `ROLLBACK`. Eles moram em `scripts/db-prove-*.cjs` e rodam
  contra o banco real, não contra fixture.
- Rollback versionado para as quatro migrations. Duas delas precisaram ser escritas à mão: o
  `db-apply.cjs` só sabe fotografar função, e migration de view, grant ou `ALTER TABLE` sai com
  rollback vazio — o que é pior que rollback nenhum, porque parece uma rede de segurança. Virou a
  #140.
- A catraca de lint caiu de 7 para 6 erros de eslint, com o teto baixado no mesmo PR.

### Sabido e não corrigido

- A regra de frete grátis continua escrita em 10 lugares (`FRETE-020`, #53), dependendo da decisão
  `FRETE-030`.
- Nada avisa quando o código passa a depender de um objeto que o banco não tem. Foi assim que o
  cadastro de produto quebrou sem ninguém saber; é a `BANCO-080` (#139), aberta com a evidência.
- `anon` tem `INSERT`, `UPDATE`, `DELETE` e `TRUNCATE` em `produtos` (`BANCO-090`, #141). Hoje é
  inerte — o RLS nega por ausência de policy e o PostgREST não expõe `TRUNCATE` — mas é privilégio
  que ninguém quis dar.
- Duas telas desta release não foram exercitadas no navegador: o botão na posição nova e o fluxo
  "Rastrear sem Conta" ponta a ponta. Nenhuma das duas tem cobertura automatizada; o que as cobre é
  typecheck e lint.

## [1.0.1] — 2026-08-04

Primeira release com processo: 13 commits que estavam parados na `develop`. Três correções chegam
ao cliente; o resto é infraestrutura e documentação, invisível para quem compra.

### Corrigido

- **Frete grátis anunciado para visitante deslogado** (#128). O carrinho mostrava "GRÁTIS" nas
  opções de entrega assim que o subtotal passava de `free_shipping_min`, mas a RPC
  `create_marketplace_order_v23` só zera o frete para usuário autenticado — o convidado via
  grátis na tela e era cobrado no fechamento. Com `free_shipping_min = 100,00` e
  `shipping_fee = 10,00` em produção, era R$ 10,00 de diferença por pedido de convidado acima do
  mínimo. Corrigido em `ShippingCalculator.tsx`, e reproduzido no preview deploy antes do merge.
- **Barra de frete grátis cheia com a regra desligada** (#128). `CartReminder` não tinha guarda
  para `freeShippingMin = 0`: com a regra desativada no admin, `isFree` era sempre verdadeiro
  (todo total é `>= 0`) e o progresso dividia por zero.
- **Edge functions presas às chaves legadas do Supabase** (#7). As três funções passam a ler
  `SUPABASE_SECRET_KEYS` e `SUPABASE_PUBLISHABLE_KEYS`, com fallback para as legadas. O front
  ainda usa a legada — é a `INFRA-260` (#126).
- **`admin-carousels` inacessível por deep link** (#3). A rota era navegável em memória mas
  faltava em seis pontos do roteador manual; F5 em `/admin-carousels` caía na home.

### Infraestrutura

- **GitFlow, CI e hooks de git** (#11). `develop` como branch de integração, CI com 5 jobs
  (tipos, testes Deno, build e tamanho, varredura de segredo, catraca de lint), e hooks de
  `pre-commit`, `commit-msg` e `pre-push` via lefthook. O `npm run typecheck` passou a checar de
  verdade — era `tsc --noEmit` sem `-b`, analisando zero arquivo.
- **Limpeza da raiz do repositório** (#10). Screenshots do Playwright e PNGs saíram do controle de
  versão; `.env.bak` passou a ser ignorado.
- **Rotação de senha do banco** (#6), com runbook em `docs/runbooks/`.

### Documentação

- **ADR 0001** (#129, #132): o ambiente Preview da Vercel passa a apontar para o banco de
  produção, com regra escrita de que preview não fecha pedido nem escreve no admin. Decisão
  tomada por restrição de tempo e marcada como tal; a saída definitiva é o `INFRA-270` (#131).
- **Resgate do conhecimento do PR #1** (#130): as regras do roteador manual, das migrations do
  DataVault e dos mappers duplicados, reverificadas contra o código antes de virar texto — os
  três veredictos originais estavam errados. Mais sete armadilhas completadas e a tabela de saúde
  da engenharia remedida.
- Onboarding, backlog priorizado, metodologia, Kanban e rituais (#8, #12, #124, #125).

### Sabido e não corrigido

- A regra de frete grátis continua escrita em 10 lugares — sete no caminho do carrinho e três
  selos de catálogo. A unificação é a `FRETE-020` e depende da decisão `FRETE-030`.
- O OTP de rastreio de pedido de convidado continua entregando pedido de terceiro
  (`AUTH-010`, #118). É o único achado crítico ainda aberto da auditoria de 29/07.
