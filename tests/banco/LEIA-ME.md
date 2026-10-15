# tests/banco — contrato do DINHEIRO provado em CI (rpc-ci.yml)

Suíte da frente **CI-CONTRATO-DINHEIRO** (14/09/2026): prova o COMPORTAMENTO
das funções SQL que guardam dinheiro contra um Postgres **efêmero** criado
pelo job do [.github/workflows/rpc-ci.yml](../../.github/workflows/rpc-ci.yml)
— nada de lint de existência: as migrations são aplicadas DO ZERO e as
invariantes abaixo são executadas contra o banco que nasceu delas.

## As provas (`invariantes-dinheiro.cjs`)

- **(a) cupom**: `usage_limit` nunca fica negativo; a vaga do cupom não volta
  duas vezes para o mesmo pedido (`devolver_cupons_de_pedidos_mortos` é
  idempotente pelo fato `coupon_usage_returned`), não volta no cancelamento
  (só depois do PIX morto) e volta usável para o próximo pedido.
- **(b) cancelamento duplo**: cancelar o pedido duas vezes não devolve
  estoque em dobro (`stock_returned_at`) nem abre estorno em dobro (ledger
  `order_refunds`); a 2ª tentativa do dono do pedido é recusada com exceção;
  o re-cancelamento pelo admin não dobra nada.
- **(c) resolver_loja**: só resolve host ATIVO da frota com a chave certa;
  host sem sensibilidade a maiúscula; inativo e chave errada devolvem zero
  linhas (sem oráculo).

- **pagamentos (`pagamentos-rpc-viva.cjs`, via `rodar-isolado.cjs`)**:
  `confirmar_pagamento` e `registrar_pagamento_recebido` — transições,
  estoque devolvido uma vez, expiração, permissão por papel e corridas com
  duas conexões reais (a 2a espera o `FOR UPDATE`).
- **admin atual (`admin-atual-viva.cjs`, via `rodar-isolado.cjs`)**: a
  migration 20261197000000 — admin rebaixado com JWT de admin ainda válido
  (só no `profiles`, só no `auth.users`, nos dois) é recusado nas seis RPCs
  de dinheiro sem escrever nada, e a RLS de `marketplace_orders`/
  `order_refunds` não mostra a ele linha alheia; controle sem a guarda (e
  com a política antiga) escreve/vaza; rollback byte a byte e preflights
  recusando sem escrita. A prova concede `USAGE` no schema `auth` a
  anon/authenticated/service_role **no clone** (o Supabase real concede; o
  `provisionar.cjs` não).

- **cupons desligados (`cupons-desligados-viva.cjs`, via `rodar-isolado.cjs`)**: a
  migration 20261203000000 — com `store_config.enable_coupons IS FALSE` nenhum
  pedido novo nasce com cupom (gatilho BEFORE INSERT em `marketplace_orders`,
  pela v24 e pela v23) e `validate_coupon_secure_v2` recusa com o motivo; chave
  ligada, NULL ou sem linha segue como antes; o retry idempotente de pedido
  criado antes devolve o mesmo pedido; ACL igual antes/depois, rollback byte a
  byte e mutantes (sem gatilho, `IS NOT TRUE`, validação sem a checagem) pegos.
- **portão dos cupons desligados (`cupons-desligados-portao-viva.cjs`, via
  `rodar-isolado.cjs`)**: as consultas `10a-conferir-cupons-desligados-aplicado`
  (DEPOIS do apply, 21 linhas) e `10b-antes-cupons-desligados-gatilho-e-corpo`
  (ANTES, 6 linhas), que são a "prova de objetos" do lote 20261203000000 em
  `scripts/frota/canais-de-backend.json`, executadas como papel de leitura num
  Postgres real e levadas até o portão (`evidenciaDaProva` e `decidirLote`).
  Monta o SEU banco-base **sem** a migration (a 10b positiva ali), aplica o
  ARQUIVO dela de verdade (LF e CRLF; a 10a positiva e igual à da árvore
  inteira) e prova um defeito por vez — gatilho ausente, desabilitado, sem
  `WHEN`, em outro evento, corpo da validate ou do gatilho com 1 byte a mais,
  função sem `search_path`, `EXECUTE` para PUBLIC, índice único ausente ou de
  outra forma — cada um reprovando a SUA linha e levando o portão a NEGATIVA;
  13 mutantes do texto das consultas ficam vermelhos; resposta parcial ou
  duplicada tem `rol=invalido`; erro de SQL nunca vira positivo; o
  `conferir-banco.cjs` de verdade (processo filho, HTTP local) e o lote do
  `canais-de-backend.json` real fecham em APLICAR / NADA / PARAR. **Não prova**
  a IKCOUS nem a Savy (só o run da consulta contra o ref de cada loja prova) e
  não mede o `supabase_read_only_user` nem o Postgres 15 da Supabase.
- **anular venda do balcão (`anular-venda-viva.cjs`, via `rodar-isolado.cjs`)**: a
  migration 20261204000000 — `anular_venda_presencial(uuid, text)`. Só o admin de
  AGORA (o rebaixado com o JWT ainda dizendo admin é recusado sem escrever, nas duas
  fontes do papel), só venda do balcão paga no ato, só no mesmo dia da loja (as duas
  bordas da virada, em qualquer fuso de sessão), motivo obrigatório; sem devolução
  nem estorno do app; o estoque volta UMA vez (inclusive com duas conexões reais),
  o Financeiro e o caixa fecham em zero, repetir o toque devolve `ja_anulada`;
  ordem global das travas, pré-voo, rollback (aplicar, desfazer, aplicar: idêntico)
  e 22 mutantes (cada guarda tirada deixa a prova vermelha). O motivo exige ao menos uma
  letra ou número (espaço de largura zero, BOM e só emoji são recusados) e o
  pagamento desfeito e refeito no mesmo dia tem frase própria.
- **portão da anulação do balcão (`anular-venda-portao-viva.cjs`, via
  `rodar-isolado.cjs`)**: as consultas `11a-conferir-anular-venda-presencial-aplicado`
  (DEPOIS do apply, 14 linhas) e `11b-antes-anular-venda-presencial-funcao-ausente`
  (ANTES, 9 linhas), a "prova de objetos" do lote 20261204000000 em
  `scripts/frota/canais-de-backend.json`, no mesmo molde da prova dos cupons:
  11b positiva na base SEM a migration, 11a positiva depois do apply real (LF e
  CRLF, igual à árvore inteira), um defeito por vez (SECURITY INVOKER, sem
  `search_path`, `EXECUTE` para PUBLIC/anon/service_role, authenticated revogado,
  corpo com 1 byte a mais, sobrecarga extra, função ou dependência ausente, corpo
  de dependência diferente do pré-voo, tabela ou coluna ausente) reprovando a SUA
  linha; 23 mutantes do texto das consultas ficam vermelhos; resposta parcial ou
  duplicada tem `rol=invalido`; erro de SQL nunca vira positivo; o
  `conferir-banco.cjs` de verdade e o lote real fecham em APLICAR / NADA / PARAR.
  **Não prova** a IKCOUS nem a Savy (só o run da consulta contra o ref de cada loja).
- **cupom preso (`cupom-preso-viva.cjs`, via `rodar-isolado.cjs`)**: as migrations
  20261205000000 (a RPC `vaga_do_cupom_presa` e o auxiliar `cupom__vaga_volta_em`) e
  20261206000000 (a vaga do pedido NUNCA cobrado volta 45 min depois de `expires_at`, em
  vez de 24 h). A RPC só lê e só responde ao DONO do pedido cancelado (outro usuário,
  outro código, cupom inativo, sem sessão e anon recebem a resposta de "não preso");
  pedidos criados pelos caminhos REAIS provam que o auxiliar diz "volta" SE E SOMENTE SE
  a varredura devolve; a vaga volta de verdade; o cenário do pagamento fantasma prova que
  a pista rápida é segura porque a vaga de cobrança vazia faz `confirmar_pagamento`
  devolver `divergente`; pré-voo recusa sem gravar, rollbacks byte a byte e cada guarda
  tirada (mutante) deixa a prova vermelha.
- **portão do cupom preso (`cupom-preso-portao-viva.cjs`, via `rodar-isolado.cjs`)**:
  as consultas `12a-conferir-cupom-preso-aplicado` (DEPOIS do apply, 24 linhas) e
  `12b-antes-cupom-preso-funcoes-ausentes` (ANTES, 10 linhas), a "prova de objetos" do
  lote 20261205000000 + 20261206000000 em `scripts/frota/canais-de-backend.json`, no mesmo
  molde da prova da anulação do balcão: 12b positiva na base SEM as migrations, 12a
  positiva depois do apply real das DUAS (LF e CRLF, igual à árvore inteira); um defeito
  por vez (função ausente ou sobrecarga extra, SECURITY INVOKER, `search_path`, corpo com
  1 byte a mais, `EXECUTE` indevido, o dono da varredura ou da RPC sem `EXECUTE` no
  auxiliar, dependência ausente, job do cron ausente, inativo ou fora de 15 em 15 min)
  reprovando a SUA linha; o apply só da primeira migration leva a PARAR; cada linha e cada
  cláusula composta ignorada (mutante) deixa a prova vermelha; resposta parcial ou
  duplicada tem `rol=invalido`; erro de SQL e papel sem acesso ao schema `cron` nunca viram
  positivo; o `conferir-banco.cjs` de verdade e o lote real fecham em APLICAR (as duas, em
  ordem) / NADA / PARAR. **Limite declarado:** a linha do job só vira `NAO VERIFICAVEL` (e
  `ok`) quando a RLS do pg_cron vale para o papel (`row_security_active`) E ele vê zero
  jobs — o job se confere então no painel; quem atravessa a RLS (BYPASSRLS) com zero jobs
  reprova como AUSENTE, e o papel que vê algum job é estrito. **Não prova** a IKCOUS nem a Savy, nem o código das edge
  functions de que a pista rápida depende.
- **o contador duplicado do cupom morre (`contador-duplicado-viva.cjs`, via
  `rodar-isolado.cjs`)**: a migration 20261207000000 apaga `coupons.used_count` (política P4
  do dono) SÓ com toda linha em 0 exato e nada dependendo dela. Tudo 0 aplica e o resto do
  banco (colunas, dados, `usage_count`, corpo e ACL de toda função de `public`, políticas,
  constraints, índices) fica IGUAL; valor 3, NULL, visão, função que cita a coluna, coluna
  GERADA que a cita (a dependência mora no `pg_attrdef` da OUTRA coluna: só o default da
  PRÓPRIA coluna é ignorado), forma diferente do baseline, RLS valendo para o papel e
  `usage_count` ausente ou em outra forma RECUSAM com o nome do motivo e SEM gravar nada; corrida com duas
  conexões (a migration espera a trava, vê o 7 gravado e recusa), `lock_timeout` de 5 s,
  atomicidade (falha depois do DROP desfaz tudo), rollback idêntico ao baseline (comparado em
  `pg_attribute`/`pg_attrdef`); cada guarda tirada (mutante) deixa a prova vermelha, e sem o
  item dos dependentes o `DROP COLUMN` sem `CASCADE` ainda recusa a coluna gerada.
- **portão do contador duplicado (`contador-duplicado-portao-viva.cjs`, via
  `rodar-isolado.cjs`)**: as consultas `14a-conferir-contador-duplicado-apagado` (DEPOIS do
  apply, 4 linhas) e `14b-antes-contador-duplicado-coluna-presente-e-zerada` (ANTES, 13
  linhas), a "prova de objetos" do lote 20261207000000. **Aqui o ANTES é o contrário do
  precedente 12b:** a coluna PRESENTE e zerada, sem dependentes. 14b positiva em `pre`
  (inclusive com o papel mínimo e com `search_path` vazio), 14a positiva depois do apply
  real (LF e CRLF); um defeito por vez reprovando a SUA linha (valor 3, NULL, coluna
  gerada, índice, visão, política, gatilho, função, forma, `usage_count`, o papel que sofre a
  RLS, coluna já apagada dizendo AUSENTE); cada linha e cada cláusula ignorada (voltar a
  excluir todo `pg_attrdef`, não excluir o default da própria coluna, o guarda AUSENTE da
  contagem, NULL como 0) deixa a prova vermelha; o `conferir-banco.cjs` de
  verdade e o lote real fecham em APLICAR / NADA / PARAR. **Limite declarado:** a linha de
  controle não tem negativo local (o catálogo é legível por todo papel). **Não prova** a
  IKCOUS nem a Savy.
- **o checkout mostra os cupons da cliente (`cupons-do-checkout-viva.cjs`, via
  `rodar-isolado.cjs`)**: a migration 20261208000000 cria `coupons.alcance` ('codigo' =
  secreto, o padrão de todo cupom que já existe; 'vitrine' = todos os clientes; 'exclusivo'
  = a lista), `cupom_clientes`, `cupons_do_checkout(numeric)`, as duas funções do painel e o
  gatilho `tr_pedido_com_cupom_so_nasce_para_a_lista`, e troca `validate_coupon_secure_v2`
  partindo do corpo da 20261203 (a #777 fica intacta). Prova: a lista (anon vê só os de todos;
  a dona vê o exclusivo dela, outra não; secreto nunca; sem esgotado, vencido, inativo ou de
  valor 0; `LIMIT 20`; chave desligada esvazia); a validação (exclusivo alheio responde
  "inválido" ANTES de qualquer motivo, `Faltam R$`, corte `<=`, a frase `Cupom atingiu o limite
  de uso.` intacta); o gatilho (v24 e v23; outra conta e visitante recusados sem gastar a vaga,
  inclusive com chave de compra nova; a frase da chave desligada vem antes); **a retentativa
  gêmea com 3 conexões reais e COMMIT** (a lojista tira a cliente da lista entre as duas
  tentativas e ela recebe o MESMO pedido; sem o atalho de retentativa a prova fica vermelha);
  o painel (só o admin ATUAL — rebaixado com sessão velha e cliente comum recusados nas duas
  funções, por superusuário e por `SET ROLE`; leitura sem CPF; teto de 500; anon sem EXECUTE;
  `cupom_clientes` só o admin atual lê e ninguém escreve); a ida e volta (reaplicar 2x, o
  rollback devolve o corpo da 20261203 byte a byte e desativa os exclusivos, rollback repetido,
  corpo divergente recusa, CRLF aceito); **dado que já existia** (cupons e pedido antigos
  ficam intactos e o cupom antigo continua comprando), atomicidade (erro depois do pós-voo não
  deixa nada), envelope REPEATABLE READ com escritor concorrente e `lock_timeout` com pedido em
  andamento (falha em ~5 s sem gravar nada); 18 mutantes por guarda (sem o gatilho, ordem do
  gatilho, atalho só por chave preenchida, `is_admin()` sem o atual nas 2 funções, política com
  `is_admin()`, escrita para `authenticated`, anon com EXECUTE, validação sem o bloco do
  exclusivo, corte `<`, frase do limite trocada, lista vazando o secreto/o exclusivo alheio/sem
  limite/mostrando esgotado/ignorando a chave, painel devolvendo CPF, pré-voo sem a guarda do
  índice único e do hash) deixam a prova vermelha. **Não prova** a IKCOUS nem a Savy (o portão
  da release, consultas 15a/15b, é o item seguinte).
- **portão dos cupons do checkout (`cupons-do-checkout-portao-viva.cjs`, via
  `rodar-isolado.cjs`)**: as consultas `15a-conferir-cupons-do-checkout-aplicado` (DEPOIS do
  apply, 37 linhas) e `15b-antes-cupons-do-checkout-pecas-ausentes` (ANTES, 15 linhas), a
  "prova de objetos" do lote 20261208000000. 15b positiva em `pre` (sem a migration; também com
  o corpo da validação da 203 em CRLF, com papel mínimo, `search_path` trocado e objetos-isca
  em outro schema) e depois do rollback manual; 15a positiva na árvore inteira, no ARQUIVO da
  migration aplicado sobre `pre` (resposta idêntica), em CRLF e depois de ida, volta e ida; um
  defeito por vez reprovando a SUA linha (coluna `alcance`, CHECK, RLS, política, privilégio por
  tabela e por coluna, forma / corpo / sobrecarga / EXECUTE de cada uma das 5 funções, gatilho
  e a ORDEM dele, índice, meia migration); 34 mutantes do texto das consultas deixam a prova
  vermelha; o `conferir-banco.cjs` de verdade e o lote real fecham em APLICAR / NADA / PARAR.
  **Limite declarado:** a linha de controle não tem negativo local (o catálogo é legível por
  todo papel) e o papel `supabase_read_only_user` real não foi medido. **Não prova** a IKCOUS
  nem a Savy.
- **consulta 13a (`consulta-13a-contador-duplicado-viva.cjs`)**: o item dos dependentes
  ignorava todo `pg_attrdef` e escondia uma coluna gerada que cita a coluna; a prova roda a
  consulta num Postgres real (base, coluna gerada, visão, índice) e o mutante que volta a
  excluir todo `pg_attrdef` reproduz o defeito.
- **cupom do PIX anulado (`cupom-pix-anulado-viva.cjs`, via `rodar-isolado.cjs`)**: o cupom
  preso depois de "cancelou com o PIX gerado" volta em minutos, nao em 24 h. O arquivo tem um
  bloco por migration. **Bloco da foto (20261209000000)**: um gatilho grava, no instante em que
  o pedido vira `cancelled`, a foto da cobranca (id na vaga, tentativas, metodo online,
  `payment_status`) em `pedido_cobranca_ao_cancelar`, tabela fechada (RLS sem politica e sem
  privilegio para PUBLIC/anon/authenticated/service_role). A prova cobre: a foto com os valores
  do momento do cancelamento em todos os caminhos reais (edge `cancelar_pedido_com_cobranca`,
  cliente, admin, expiracao, v23); recancelar nao grava foto nova; reativar e cancelar de novo
  sobrescreve; nenhum acesso de fora; 2 cancelamentos simultaneos geram 1 foto; pedido cancelado
  antes da migration segue sem foto; o envelope de producao (`REPEATABLE READ`, foto antes do
  `LOCK`): a migration espera o pedido em andamento SEM parar o checkout (trava por `NOWAIT`,
  nao por fila), recusa em 4 s sem gravar e nao causa deadlock com dois pedidos cruzados; ida e
  volta (aplicar, rollback, reaplicar 2x; o catalogo volta exato); pre-voo, pos-voo e rollback
  que recusam nomeando o problema; mutante por guarda. **Limite declarado:** Postgres 17 local,
  nao o 15/17 da Supabase; o envelope e simulado em texto, nao pelo `aplicar-migrations.yml`.
  **Bloco da vaga (20261210000000)**: a varredura do cupom, o auxiliar `cupom__vaga_volta_em`
  (de 9 para 13 parametros: os 9 de sempre mais os 4 da foto) e a RPC do checkout
  `vaga_do_cupom_presa` passam a ler a foto. O cupom de um pedido cancelado com o PIX gerado volta
  no prazo do PIX (`expires_at`, ~45 min no maximo depois da criacao; nunca `-infinity`, para o
  admin que reativa o pedido nao achar o cupom ja devolvido) SE E SOMENTE SE a foto prova que
  nunca houve cartao (id de PIX na vaga, zero tentativas, metodo `pix`, `aguardando`) e agora o
  pedido esta cancelado, `aguardando`, com a vaga vazia e exatamente uma tentativa. A prova
  cobre: a tabela de 33 casos (cada condicao violada sozinha: o auxiliar, a varredura e a RPC
  concordam caso a caso); o pagamento fantasma (`confirmar_pagamento` do PIX velho da
  `divergente` e o uso do cupom nao muda); duas conexoes reais (varredura x
  `confirmar_pagamento` nas duas ordens, x `liberar`, duas varreduras, varredura no meio da
  aplicacao); o envelope `REPEATABLE READ` (a M2 nao pede trava de tabela: nunca 40P01); a
  atomicidade (falha no meio, depois do `DROP`, devolve tudo); ida e volta byte a byte (o
  rollback devolve os corpos da 1206 e da 1205 por sha256); pre-voo que recusa sem gravar (1 byte
  a mais em cada corpo travado); a ordem de desfazer 1210, 1209, 1206, 1205; mutante por guarda.
  **Limites declarados:** o `SET LOCAL lock_timeout` e cinto (sem trava de tabela nao ha espera
  que ele limite); a varredura nao e executada dentro da migration (so pela prova); o caso de uma
  instancia da varredura em voo no instante exato do COMMIT nao e provavel de forma
  deterministica. O portao (consultas 16a/16b) e o item seguinte.
- **portao do cupom do PIX anulado (`cupom-pix-anulado-portao-viva.cjs`, via
  `rodar-isolado.cjs`)**: as consultas `16a-conferir-pix-anulado-aplicado` (DEPOIS do apply, 32
  linhas) e `16b-antes-pix-anulado-foto-ausente` (ANTES, 14 linhas), a "prova de objetos" do lote
  20261209000000 + 20261210000000 (as duas vao juntas e em ordem). 16b positiva em `pre` (sem as duas:
  auxiliar de 9 parametros, sem foto), tambem com os corpos de 1205/1206 em CRLF, com papel minimo,
  `search_path` vazio e objetos-isca em outro schema, e DEPOIS dos dois rollbacks manuais (a ida e
  volta devolve a loja ao estado de antes); 16a positiva na arvore inteira, nos ARQUIVOS aplicados
  sobre `pre` (resposta identica), em CRLF e depois de rollback seguido de novo apply. Um defeito
  por vez reprovando a SUA linha (coluna, chave primaria e estrangeira, RLS, politica, privilegio
  por tabela e por coluna, forma / corpo / sobrecarga / EXECUTE por papel das 4 funcoes, gatilho
  desligado, REPLICA, BEFORE, sem OF, sem WHEN, outra funcao, o estado MISTURADO, so a 20261209
  aplicada, os donos sem EXECUTE no auxiliar, job); mutantes do texto das consultas (cada linha e
  cada clausula composta) deixam a prova vermelha; o `conferir-banco.cjs` de verdade e o lote real
  fecham em APLICAR / NADA / PARAR; e a 12a (cupom preso) segue positiva no estado que o lote
  deixa. **Limites declarados:** a linha de controle nao tem negativo local (o catalogo e legivel
  por todo papel); o EXECUTE de PUBLIC nao tem mutante proprio (equivalente: PUBLIC alcanca os papeis
  nomeados); a linha de EXECUTE da varredura nao cobre `service_role`; o papel
  `supabase_read_only_user` real e o pg_cron real nao foram medidos. **Nao prova** a IKCOUS nem a
  Savy.

- **estoque baixo numa régua só (`estoque-baixo-uma-regra-viva.cjs`, via `rodar-isolado.cjs`)**:
  as migrations `20261212000000` (Início) e `20261213000000` (filtro "low" de `get_admin_products_paged`). Nove
  produtos (A–I) separam a soma das variações da coluna, a borda `<= 5`, o mínimo 0 e o NULL;
  `painel_inicio`, `get_admin_analytics_v2`, o filtro e a conta do front dão o mesmo número (+4), com
  controle pelo corpo antigo (Início +3; filtro A, B, E, F). Cobre também a porta (42501), reaplicar 2x,
  preflight divergente sem escrever e o rollback. A 20261212 está na lista de `sucessoras-da-99.cjs` (as provas da 20261199 a desfazem).
- **valor do estoque só com custo (`inventario-so-com-custo-viva.cjs`)**: a migration `20261214000000`
  (`totalValue` só soma produto com custo; `totalCost`, alertas e chaves do JSON iguais), com controle pelo
  corpo antigo (390 contra 90).
- **portão da 8e com as sucessoras da 99 (`portao-8e-aceita-sucessoras-viva.cjs`, via `rodar-isolado.cjs`)**:
  a 8e (rol da faixa 92-202) dá positiva na árvore inteira, no estado da `20261199000000` (via
  `sucessoras-da-99.cjs`) e nos estados mistos (só a 12 / só a 14); corpo estranho, AUSENTE, sobrecarga e o
  corpo da sucessora da outra função reprovam só a linha da função; mutantes do texto da consulta pegos.
- **portão do estoque do painel (`estoque-do-painel-portao-viva.cjs`, via `rodar-isolado.cjs`)**: as
  consultas `17a-conferir-estoque-do-painel-aplicado` (DEPOIS do apply, 14 linhas) e
  `17b-antes-estoque-do-painel-corpos-vigentes` (ANTES, 11 linhas), a "prova de objetos" do lote
  20261212000000 + 20261213000000 + 20261214000000 (três migrations independentes, cada uma troca só o corpo
  de uma função). Cada estado numa transação desfeita, as consultas como papel de leitura. 17b positiva no
  antes (os três rollback-manual, via `sucessoras-da-99.cjs` para a 12 e a 14), também em CRLF, depois da ida
  e volta em qualquer ordem, com papel mínimo, `search_path` vazio e funções-isca em outro schema; 17a
  positiva depois do apply dos arquivos (LF, CRLF, 12→14 e 14→12, 2x, ida-volta-ida), igual linha a linha à
  árvore inteira. Os 6 estados mistos reprovam só o corpo das que faltam (17a) e das que entraram (17b), e a
  8e segue positiva em todos os estados. Um defeito por vez reprovando a SUA linha (corpo com 1 byte ou 1
  caractere, função ausente, sobrecarga, forma, EXECUTE a anon/PUBLIC ou sem authenticated, coluna
  renomeada), mais os de várias linhas: `anon` ou `authenticated` inexistentes (renomeados numa transação
  desfeita: as 3 linhas de EXECUTE com `papel ausente`) e o schema `public` renomeado (todas as linhas, o
  controle com `0`); mutantes do texto das consultas (cada linha, inclusive o controle, o CRLF, o hash do
  outro lado, o filtro do schema, a cláusula de cada papel, o `papel ausente` no formato da 16a, o
  `to_regrole` trocado) deixam a prova vermelha; rol fechado e SQL truncado nunca viram positivo; o
  `conferir-banco.cjs` de verdade e o lote real fecham em APLICAR / NADA / PARAR. **Limites declarados:** o
  negativo do controle é o schema `public` renomeado (um papel cego ao `pg_proc` por permissão não é
  montável neste Postgres); a cláusula de PUBLIC desligada e o `NOT a.attisdropped` são mutantes
  EQUIVALENTES (medidos como tais); com o ledger completo e o lote já no SHA servido o portão decide NADA
  sem pedir a 17a (o ponto cego que o runbook fecha mandando desfazer só pelo `aplicar-migrations.yml`);
  `service_role` e o dono não são medidos; o `supabase_read_only_user` real não foi medido. **Não prova** a
  IKCOUS nem a Savy.
- **portão da política de devolução (`politica-devolucao-portao-viva.cjs`, via `rodar-isolado.cjs`)**: as
  consultas `19a-conferir-politica-devolucao-aplicado` (DEPOIS do apply, 9 linhas) e
  `19b-antes-politica-devolucao-grant-de-tabela` (ANTES, 9 linhas), a "prova de objetos" do lote
  `20261215000000` (achado L: `anon` e `authenticated` perdem o SELECT da tabela inteira e leem 15 das 16
  colunas, sem `updated_by`). Cada estado numa transação desfeita, as consultas como papel de leitura. As
  linhas de cada consulta são exatamente o rol de `conferir-banco.cjs`; 19a positiva depois do apply (também
  aplicado 2x e depois de ida e volta) e 19b positiva depois do rollback, cada uma reprovando só as 6 linhas
  de grant da outra; GRANT da tabela, GRANT de `updated_by`, `service_role` sem SELECT, RLS desligada,
  política apagada e tabela ausente reprovam só as suas linhas; o papel mínimo dá o mesmo resultado do dono.
- **portão das fotos da devolução (`fotos-da-devolucao-portao-viva.cjs`, via `rodar-isolado.cjs`)**: as
  consultas `20a-conferir-fotos-da-devolucao-aplicado` (DEPOIS do apply, 6 linhas) e
  `20b-antes-fotos-da-devolucao-sem-delete` (ANTES, 6 linhas), a "prova de objetos" do lote `20261216000000`
  (política de `DELETE` do cliente em `storage.objects`). Cada estado numa transação desfeita, as consultas
  como papel de leitura. As linhas de cada consulta são exatamente o rol de `conferir-banco.cjs`; 20a
  positiva depois do apply (também 2x e depois de ida e volta) e 20b positiva depois do rollback, cada uma
  reprovando só as 3 linhas da política de `DELETE` da outra; uma política de `DELETE` a mais (para `anon`, ou larga demais para `authenticated`),
  a condição sem a pasta e a foto em uso e a falta da política de `INSERT` reprovam só as suas linhas; o
  papel mínimo dá o mesmo resultado do dono. E o comportamento: o cliente apaga a própria foto livre e não a
  em uso por uma devolução, a de outro cliente nem a de outro bucket.
- **teto de e-mail e código do convidado (`teto-de-email-viva.cjs`, via `rodar-isolado.cjs`)**: a migration
  `20261217000000`. Cada caso numa transação desfeita (a corrida usa conexões reais e limpa o que gravou).
  O fluxo legítimo (código, verificação pela v2 e pela v1, comprovante uma vez) passa; o teto por pedido
  (5), por destinatário (10, com o e-mail normalizado) e da loja (40 códigos / 40 comprovantes, contadores
  separados) em 24 h que andam; estourou = erro genérico sem dado do cliente e nada gravado; a janela de
  60 s continua; pedido que não confere não gasta vaga; falha do contador fecha no código e abre no
  comprovante; pedido pago nunca é recusado; duas reservas simultâneas na última vaga: a segunda espera a
  trava e é recusada. A v2 só conta tentativa quando o trio confere; a v1 não devolve mais `restantes`.
  Reaplicar, pré-voo, rollback (os três corpos de antes por md5, com CONTROLE) e privilégios.
- **portão do teto de e-mail (`teto-de-email-portao-viva.cjs`, via `rodar-isolado.cjs`)**: as consultas
  `21a-conferir-teto-de-email-aplicado` (DEPOIS, 14 linhas) e `21b-antes-teto-de-email-corpos-vigentes`
  (ANTES, 8 linhas), a "prova de objetos" do lote `20261217000000`. Rol exato nos dois estados; 21a positiva
  depois do apply (2x, ida e volta, CRLF) e 21b positiva depois do rollback, cada uma reprovando só os 3
  corpos trocados da outra; EXECUTE aberto ou fechado por papel, RLS desligada, privilégio de tabela, corpo
  diferente, função ausente e coluna renomeada reprovam só as suas linhas; o papel mínimo dá o mesmo
  resultado do dono; o veredito do `conferir-banco.cjs` sobre as linhas reais sai com `rol=ok`.
- **portas pequenas do banco (`portas-do-banco-viva.cjs`, via `rodar-isolado.cjs`)**: as migrations
  `20261218000000`, `20261218000100` e `20261219000000`, com os papéis reais (anon, authenticated,
  service_role). Cada caso numa transação desfeita; o ANTES é o banco com os três rollback-manual aplicados
  (CONTROLE de cada recusa). Perfis públicos: o visitante recebe zero linhas sem erro; o logado vê a si, o
  autor de avaliação publicada e o de pergunta, não vê quem nunca escreveu; o admin atual vê todos, o
  rebaixado não; a vitrine do visitante continua com nome e foto do autor. Foto e capa do perfil: teto de
  128 KiB e 512 KiB no UPDATE direto, na RPC e no INSERT; quem já tinha imagem grande segue salvando nome,
  WhatsApp e CPF, e a sincronização acontece. Contagem do push e view do painel: 42501 para o visitante,
  o admin conta, lê e cadastra produto. Configurações e códigos: 42501 para anon e authenticated, a
  service_role lê e grava, o código do convidado segue saindo e sendo conferido; no-op numa loja já
  fechada; grant de coluna some; grant de outro grantor faz a conferência recusar. Reaplicar, CRLF,
  rollback e pré-voo de cada uma.
- **portão das portas pequenas do banco (`portas-do-banco-portao-viva.cjs`, via `rodar-isolado.cjs`)**: as
  consultas `22a-conferir-portas-do-banco-aplicado` (DEPOIS, 15 linhas) e
  `22b-antes-portas-do-banco-estado-vigente` (ANTES, 11 linhas), a "prova de objetos" do lote
  `20261218000000` + `20261218000100` + `20261219000000`. Rol exato nos dois estados; 22a positiva depois do
  apply e 22b positiva depois dos três rollbacks (também numa loja que já tinha as duas tabelas do servidor
  fechadas); reaplicar, CRLF e `search_path` de quem lê não mudam o resultado; o papel mínimo dá o mesmo
  resultado do dono; cada desvio (política, gatilho, EXECUTE, view, tabela, papel) reprova só a sua linha; o
  veredito do `conferir-banco.cjs` sobre as linhas reais sai com `rol=ok`.
- **consulta antiga de pedido por código (`consulta-antiga-de-pedido-viva.cjs`, via `rodar-isolado.cjs`)**: a
  migration `20261220000000` (etapa 2 do achado A-1) tira o `EXECUTE` de `get_orders_by_otp_v1` de PUBLIC, anon e
  authenticated. Cada caso parte do estado ANTES (o `rollback-manual`, um GRANT idempotente): o A-1 reproduz
  (CONTROLE); DEPOIS anon e authenticated recebem 42501, service_role e o dono seguem executando, o A-1 não gasta
  tentativa e a vítima confere pela `get_orders_by_otp_v2`; só a ACL da v1 muda (nenhuma outra função, tabela ou
  corpo), nenhuma linha de pedido ou código muda; reaplicar e CRLF idênticos; o rollback devolve a ACL de antes
  (comparada por conjunto de aclitem: a ordem das entradas do array pode mudar); pré-voo recusa sem escrever
  (corpo, ACL fora das duas conhecidas, v2 ausente/fechada); GRANT de outro grantor faz a conferência recusar; apply
  com uma verificação em voo não espera a trava. **As provas do lote 21 (`teto-de-email-viva` e
  `teto-de-email-portao-viva`) montam o estado de ANTES da 20261220 dentro da transação** (rollback-manual dela
  primeiro): o rollback da 20261220 vem sempre antes de mexer na 20261217.
- **portão da consulta antiga de pedido (`consulta-antiga-de-pedido-portao-viva.cjs`, via `rodar-isolado.cjs`)**: as
  consultas `23a-conferir-consulta-antiga-de-pedido-fechada` (DEPOIS, 5 linhas) e
  `23b-antes-consulta-antiga-de-pedido-aberta` (ANTES, 5 linhas), a "prova de objetos" do lote `20261220000000`. Rol
  exato nos dois estados; 23a positiva depois do apply e 23b positiva depois do rollback; cada desvio (EXECUTE por
  papel e PUBLIC, corpo, função ausente) reprova só a sua linha; a 21a segue positiva depois do corte.
- **avaliações fechadas ao visitante (`avaliacoes-fechadas-ao-visitante-viva.cjs`, via `rodar-isolado.cjs`)**: a
  migration `20261221000000` (menor privilégio, 14/10/2026) tira o `EXECUTE` de PUBLIC e `anon` em
  `get_reviews_metrics` e `increment_helpful` e mantém o de `authenticated`. Cada caso parte do estado ANTES (o
  `rollback-manual`, um `GRANT` a anon): o visitante CHEGA ao corpo (controle); DEPOIS anon recebe 42501 nas duas,
  authenticated chega ao corpo, service_role e o dono seguem, só a ACL das duas muda (nenhuma outra função, tabela
  ou corpo), nenhuma linha de avaliação ou voto muda; reaplicar e CRLF idênticos; o rollback devolve a ACL de antes
  (por conjunto de aclitem); pré-voo recusa sem escrever e falhando na segunda função a primeira não fica fechada;
  GRANT de outro grantor faz a conferência recusar o apply inteiro; concorrência (transação em voo não segura o
  apply; a mesma conexão em transação nova é recusada). A lista de portas (L8) diz `logado` para o voto e
  (até a `20261222000000`) `tolerada` (só authenticated, corpo sem guarda de admin) para a média; desde a
  `20261222000000` diz `logado` para as duas. Depois dela esta prova aceita "chegou ao corpo" como a linha
  (admin) **ou** a exceção da guarda de admin (P0001): o que ela mede é que a ACL não barrou (nada de 42501). O
  mesmo vale para o voto de um logado numa avaliação que não existe: o no-op silencioso de antes **ou** (desde a
  `20261223000000`) a exceção P0001 `Avaliação não encontrada.`, nunca 42501.
- **portão das avaliações fechadas (`avaliacoes-fechadas-ao-visitante-portao-viva.cjs`, via `rodar-isolado.cjs`)**:
  as consultas `24a-conferir-avaliacoes-fechadas-ao-visitante` (DEPOIS, 3 linhas) e
  `24b-antes-avaliacoes-abertas-ao-visitante` (ANTES, 3 linhas), a "prova de objetos" do lote `20261221000000`. Rol
  exato nos dois estados; 24a positiva depois do apply e 24b positiva depois do rollback; cada desvio (EXECUTE por
  papel e PUBLIC, função ausente) reprova só a linha da sua função.
- **a média de avaliações só responde ao administrador (`media-de-avaliacoes-so-admin-viva.cjs`, via
  `rodar-isolado.cjs`)**: a migration `20261222000000` (permissão, 14/10/2026) troca o corpo de
  `get_reviews_metrics` por `CREATE OR REPLACE` com o MESMO corpo da baseline mais a guarda
  `IF NOT public.is_admin()`. Cada caso parte do estado ANTES (o `rollback-manual`, que recria o corpo antigo; o
  `prosrc` é comparado byte a byte com o da baseline LIDO DO ARQUIVO, as linhas com espaço no fim incluídas): o
  cliente comum lê a média de TODAS as avaliações (o defeito) e o visitante já é recusado (42501). DEPOIS: anon
  42501; authenticated NÃO-admin recebe a exceção da guarda (P0001) com JWT de cliente, sem JWT e sem
  `auth.uid()`, e a sessão `postgres` sem `SET ROLE` (GUC `role` = none) também; admin pelo JWT, admin só pelo
  `auth.users`, admin rebaixado com JWT ainda válido (consequência aceita, declarada) e service_role recebem a
  MESMA linha de antes para 11 entradas de filtro, sobre avaliações que já existiam (publicadas, pendentes,
  verificadas, respondidas, resposta só de espaços); só o corpo dessa função muda (nenhuma outra função, tabela
  ou ACL; mesmo oid; dados intactos); reaplicar e CRLF idênticos; o rollback devolve o `prosrc` idêntico ao da
  baseline sem tocar a ACL nem abrir anon; pré-voo recusa sem escrever (corpo desconhecido, STABLE, SECURITY
  INVOKER, search_path, sobrecarga, função ausente, `is_admin()` ausente ou que o dono não executa, ACL aberta
  ou sem a 20261221); as conferências finais, rodadas sobre estados ruins, recusam; concorrência (chamada em voo
  não segura o apply). Mutantes (sem a guarda, guarda por `auth.uid()`, guarda invertida, STABLE) deixam a prova
  vermelha.
- **portão da média só-admin (`media-de-avaliacoes-so-admin-portao-viva.cjs`, via `rodar-isolado.cjs`)**: as
  consultas `25a-conferir-media-de-avaliacoes-so-admin` (DEPOIS, 5 linhas: corpo por md5, guarda no corpo,
  atributos, EXECUTE fechado) e `25b-antes-media-de-avaliacoes-sem-guarda` (ANTES, 4 linhas: o corpo da baseline
  sem a guarda e os atributos; **não mede a ACL**, que é da 24a), a "prova de objetos" do lote `20261222000000`.
  Rol exato nos dois estados; 25a positiva depois do apply e 25b positiva depois do rollback; cada desvio (1 byte
  a mais no corpo, guarda tardia, sem guarda, STABLE, SECURITY INVOKER, search_path, EXECUTE por papel e PUBLIC,
  função ausente) reprova só as linhas certas; ACL aberta não reprova a 25b; mutantes do texto das consultas
  ficam vermelhos. **Não prova** a IKCOUS nem a Savy: o corpo vivo de cada loja só o run da 25b (e da 22m) mede.
- **voto útil só em avaliação pública (`voto-util-so-em-avaliacao-publica-viva.cjs`, via `rodar-isolado.cjs`)**:
  a migration `20261223000000` (o corpo de `increment_helpful` passa a exigir `reviews.status = 'publicada'`, a
  condição da vitrine) com os papéis reais num Postgres efêmero. Cada caso parte do estado ANTES (o rollback-manual
  dela, conferido byte a byte contra o corpo da `20261050000000`): o controle prova o defeito (o logado vota numa
  avaliação pendente e o contador sobe). Depois: anon = 42501; logado em avaliação PUBLICADA vota (contador +1, uma
  linha em `review_votes`, o segundo voto do mesmo usuário é no-op sem exceção, outro usuário soma); PENDENTE e id
  INEXISTENTE = a MESMA exceção `Avaliação não encontrada.` (P0001) e NADA gravado (nem voto, nem contador); o autor
  na própria pendente é recusado e na própria publicada vota; o CHECK barra `'recusada'` (a recusa é apagar); sem
  `auth.uid()` vale a exceção de login de antes. Só o corpo dessa função muda (oid, ACL, dados, outras funções
  intactos), reaplicar 2x e em CRLF = mesmo estado, o rollback devolve o `prosrc` idêntico, o pré-voo recusa sem
  escrever (corpo desconhecido, atributos, sobrecarga, função ausente, `review_votes` ou `reviews.status`
  ausentes, dono sem SELECT, ACL aberta ou sem a 20261221), as conferências finais recusam estado ruim, concorrência
  (chamada em voo não segura o apply).
- **portão do voto útil (`voto-util-so-em-avaliacao-publica-portao-viva.cjs`, via `rodar-isolado.cjs`)**: as
  consultas `26a-conferir-voto-util-so-em-avaliacao-publica` (DEPOIS, 5 linhas) e
  `26b-antes-voto-util-sem-guarda-de-status` (ANTES, 4 linhas; **não mede a ACL**, que é da 24a), a "prova de
  objetos" do lote `20261223000000`. Mesmo desenho do portão 25: rol exato nos dois estados, um negativo por
  linha, mutantes do texto das consultas vermelhos. **Não prova** a IKCOUS nem a Savy.
- **avaliação que nasce sem a resposta da loja (`avaliacao-nasce-sem-resposta-da-loja-viva.cjs`, via
  `rodar-isolado.cjs`)**: a migration `20261224000000` (gatilho BEFORE INSERT em `reviews` que zera
  `merchant_reply`, `merchant_reply_at`, `helpful` e `created_at` de quem NÃO é administrador) com os papéis
  reais num Postgres efêmero. O controle parte do estado ANTES (o rollback) e prova o defeito: o logado grava a
  própria avaliação com a "Resposta Oficial", 9999 úteis e data de 2030. Depois: a avaliação forjada entra
  LIMPA e NADA é recusado; a avaliação normal do app (cinco colunas) entra igual e ainda ganha o selo de compra
  pelo gatilho irmão; `reply_review_atomic` (UPDATE) continua gravando a resposta e avisando o lojista; o
  administrador atual e o `service_role` gravam as quatro colunas como mandaram; sessão direta no banco (papel
  `none`) também; quem só tem "admin" no JWT (sem o papel de agora no banco) é tratado como cliente; mutantes
  (AFTER INSERT, gatilho desligado, corpo com cada condição trocada) ficam vermelhos pela mensagem certa. Só os
  dois objetos novos mudam; reaplicar 2x e em CRLF = mesmo estado; o rollback apaga só o que é dele; o pré-voo
  recusa sem escrever (corpo desconhecido, sobrecarga, gatilho fora do desenho, coluna ou `rls_admin_atual`
  ausente); as conferências finais recusam estado ruim; concorrência (uma avaliação em voo não deixa passar
  forjada: a que chega durante a espera sai limpa). A mesma prova roda a `27m` de verdade (contagem de forjadas
  por sinal, sem id nem texto).
- **portão da avaliação que nasce sem a resposta da loja
  (`avaliacao-nasce-sem-resposta-da-loja-portao-viva.cjs`, via `rodar-isolado.cjs`)**: as consultas
  `27a-conferir-avaliacao-nasce-sem-resposta-da-loja` (DEPOIS, 6 linhas) e
  `27b-antes-avaliacao-aceita-resposta-forjada` (ANTES, 6 linhas), a "prova de objetos" do lote `20261224000000`.
  Mesmo desenho do portão 26: rol exato nos dois estados, um negativo por linha, o veredito do
  `conferir-banco.cjs` (`rol=ok`), mutantes do texto das consultas vermelhos. **Não prova** a IKCOUS nem a Savy.
- **números do painel (`numeros-do-painel-viva.cjs`, via `rodar-isolado.cjs`)**: as migrations `20261227000000`
  (`crm_visao`: a taxa de devolução fala da MESMA turma de vendas e o "vs. ontem" corta o anterior na mesma hora) e
  `20261228000000` (`painel_inicio`: a semana passada do "Hoje" corta na mesma hora), com os papéis reais num Postgres
  efêmero. Cada caso parte do estado ANTES (os rollbacks-manuais, conferidos byte a byte contra os corpos de antes): o
  controle prova o defeito (taxa acima de 100%, chip -66,7% de manhã). Depois: parcial R$ 30 de R$ 100 = 15%, mais
  R$ 70 do mesmo pedido = 50%, 3 vendas com 2 devolvidas = 66,7%, pago-cancela-estorna = 100% de 1 pedido, balcão
  anulado, devolução manual, devolução de venda de OUTRO período fora, sem venda = 0 (nunca divide por zero); o corte
  na mesma hora de hoje (R$ 100 às 04h e R$ 200 às 18h na semana passada, R$ 100 às 05h hoje, às 06h07 = 0%) montado
  em torno do `now()` REAL do banco (o relógio não é injetado; guarda de virada do dia); formato do JSON, ACL e
  travas de admin intactos, reaplicar 2x = mesmo estado, o rollback devolve o `prosrc` idêntico, o pré-voo recusa sem
  escrever (corpo divergente, ACL aberta) e o segundo rollback também; um mutante por defeito (matar o corte, tirar o limite, voltar o
  denominador...) fica vermelho, inclusive o do corte INTEIRO em UTC (relógio e venda no mesmo fuso errado), que só
  uma venda da NOITE separa (23h de SP, ontem e na semana passada; depois das 21h de SP a venda vira a das 20h, e a
  prova espera passar 21h de SP, a meia-noite em UTC). **Não prova** a IKCOUS nem a Savy.
- **portão dos números do painel (`numeros-do-painel-portao-viva.cjs`, via `rodar-isolado.cjs`)**: as consultas
  `30a-conferir-numeros-do-painel-aplicado` (DEPOIS, 9 linhas) e `30b-antes-numeros-do-painel-corpos-vigentes` (ANTES,
  7 linhas; **não mede a ACL**), a "prova de objetos" do lote `20261227000000` + `20261228000000`. Mesmo desenho do
  portão 26: rol exato nos estados (antes, depois, só uma das duas), um negativo por linha, mutantes do texto das
  consultas vermelhos. **Não prova** a IKCOUS nem a Savy.
- **grade do CRM (`a-grade-do-crm-mede-a-recencia-viva.cjs`, via `rodar-isolado.cjs`)**: a migration `20261232000000`
  (`crm_visao`: a grade de segmentos mede a recência até o MESMO instante da lista, `LEAST(meia-noite de amanhã,
  now())`), por cima da `20261227000000` (**só pode ser aplicada depois dela**). Cada caso parte do corpo da 27 e
  reproduz o defeito (grade novos 1 / hibernando 5 contra lista novos 2 / hibernando 4: vermelho no corpo vigente,
  verde no novo): cada virada (29/30/31, 59/60/61, 119/120/121, 239/240/241 dias), o conjunto de 12 compras, as
  outras três chamadas (`crm__vendas`, `crm__pedidos_nao_pagos`, `crm__nunca_comprou`), período que NÃO termina hoje
  com o JSON idêntico ao do corpo antigo, resto do corpo igual byte a byte fora da troca, ACL e travas de admin, rollback
  com o `prosrc` da 27, pré-voo que recusa sem escrever, dois aplicadores ao mesmo tempo e mutantes vermelhos. O
  relógio é o real e a prova se protege da hora do dia: o dado "do futuro" fica SEMPRE entre agora e a meia-noite de
  amanhã (o único trecho em que a âncora antiga e a nova diferem), por construção e conferido por `assert`, e o resto
  é "N dias/horas atrás" (nunca "agora + 2 horas", que a partir das 22h de SP deixava o corpo antigo e os mutantes
  passarem). `GRADE_RELOGIO='2026-10-14 22:30:00-03'` injeta um relógio fixo (uma `public.now()` que sombreia a do
  catálogo, dentro de cada transação desfeita) nas provas que dependem da hora. **Não prova** a IKCOUS nem a Savy.
- **portão da grade do CRM (`a-grade-do-crm-mede-a-recencia-portao-viva.cjs`, via `rodar-isolado.cjs`)**: as consultas
  `33a-conferir-grade-do-crm-aplicado` (DEPOIS, 5 linhas) e `33b-antes-grade-do-crm-corpo-vigente` (ANTES, 4 linhas;
  **não mede a ACL**), a "prova de objetos" do lote `20261232000000`. Rol exato (antes, depois, sem a 27, função
  ausente), um negativo por linha, o veredito do `conferir-banco.cjs`, mutantes do texto das consultas vermelhos; a
  `33b` com o corpo da 20261199 reprova (ordem errada). A `33m` é medição de rol aberto (só agregado). **Não prova**
  a IKCOUS nem a Savy.
- **endereço da compra no pedido (`endereco-no-pedido-viva.cjs`, via `rodar-isolado.cjs`)**: a migration
  `20261229000000` (`create_marketplace_order_v23` e `_v24` copiam o endereço da conta para
  `customer_data.address` no instante da compra) pelo caminho real do checkout, nas duas funções. Cada caso parte
  do estado ANTES (o rollback-manual dela, conferido byte a byte contra os corpos da `20261174000000`): o
  controle prova o defeito (pedido sem endereço dentro de `customer_data`; editar o endereço da conta muda o que
  o pedido mostra; apagar o esvazia). Depois: a cópia (8 chaves, sem chave nula) com e sem CPF; editar e apagar
  depois não mexem no pedido; endereço de OUTRO usuário recusado antes de escrever; a convidada nunca dispara a
  cópia (nem com o id do endereço de outra pessoa); a retirada segue sem endereço e sem erro; o endereço
  digitado não é trocado; a retentativa devolve o mesmo pedido; o MESMO roteiro (com cupom) grava linhas, itens,
  estoque e uso do cupom idênticos antes e depois; o pedido antigo fica intacto (sem backfill); só o corpo das
  duas funções muda (oid, ACL, dados e outras funções intactos); sete mutantes ficam vermelhos (um é equivalente,
  declarado); reaplicar 2x e CRLF = mesmo estado, rollback com o mesmo `prosrc` e a mesma ACL, pré-voo recusa sem
  escrever, conferência recusa estado ruim, as duas trocas caem juntas, e o checkout não trava numa edição em voo
  do endereço da conta.
- **portão do endereço da compra (`endereco-no-pedido-portao-viva.cjs`, via `rodar-isolado.cjs`)**: as consultas
  `31a-conferir-endereco-da-compra-fica-no-pedido` (DEPOIS, 9 linhas) e
  `31b-antes-endereco-da-compra-so-no-ponteiro` (ANTES, 7 linhas; **não mede a ACL**, que é da 31a), a "prova de
  objetos" do lote `20261229000000`. Mesmo desenho do portão 26: rol exato nos dois estados, um negativo por
  linha, mutantes do texto das consultas vermelhos. **Não prova** a IKCOUS nem a Savy.
- **a compra que dá R$ 0,00 não se paga pelo app
  (`a-compra-que-da-zero-reais-nao-se-paga-pelo-app-viva.cjs`, via `rodar-isolado.cjs`)**: a migration
  `20261236000000` (a `create_marketplace_order_v24` recusa, ANTES de reservar estoque e de gastar a vaga do
  cupom, o pedido de pagamento pelo app cujo total calculado pelo servidor é zero; **sucessora da 20261229000000**,
  só a v24). O controle parte do estado ANTES (o rollback-manual, conferido byte a byte contra o corpo da
  `20261229000000`) e prova o defeito (o pedido de R$ 0,00 pelo app nasce `aguardando`, baixa estoque e gasta o
  cupom de uso único). Depois: zero + app recusa com a frase e o identificador no DETAIL (conta, retirada, cupom de
  100%, convidada) e **nada é reservado nem gasto, provado por uma sequência movida por gatilhos** no INSERT do
  pedido, na baixa do estoque e no uso do cupom (sequência não é desfeita por rollback: sem ela, recusar depois de
  reservar passaria despercebido); zero + pagar na retirada/entrega (v23 cash/pix e a v24 chamada direto com cash)
  nasce como hoje; positivo + app nasce como hoje, na borda de R$ 0,01 e com o total do SERVIDOR (R$ 0,04) quando
  o cliente manda R$ 0,00; o cupom de uso único não é gasto na recusa e ainda compra, uma vez, na retirada; total
  divergente recebe a recusa antiga; a retentativa de pedido que já nasceu devolve o pedido. O mesmo roteiro de
  compras grava linhas idênticas antes e depois, só o corpo da v24 muda (a v23, a ACL e os dados ficam), reaplicar
  2x e CRLF = mesmo estado, o rollback devolve o `prosrc` idêntico, o pré-voo recusa sem escrever (inclusive a
  loja ainda no corpo da 20261174), a conferência reprovando desfaz a troca, e 6 mutantes (sem a recusa, recusa
  depois de reservar, recusa também na entrega, limite R$ 0,01, total do cliente, só quem tem conta) ficam
  vermelhos. **As provas da 20261229 (`endereco-no-pedido-viva.cjs` e `endereco-no-pedido-portao-viva.cjs`)
  desfazem esta sucessora antes de medir** (como as da 20261199 fazem com as dela). **Não prova** a IKCOUS nem a
  Savy.
- **portão da compra que dá R$ 0,00 não se paga pelo app
  (`a-compra-que-da-zero-reais-nao-se-paga-pelo-app-portao-viva.cjs`, via `rodar-isolado.cjs`)**: as consultas
  `37a-conferir-compra-de-zero-reais-nao-se-paga-pelo-app-aplicado` (DEPOIS, 6 linhas) e
  `37b-antes-compra-de-zero-reais-nao-se-paga-pelo-app-corpo-vigente` (ANTES, 5 linhas; **não mede a ACL**, que é da
  37a) do lote `20261236000000`. Rol exato nos estados (depois, antes, corpo da 20261174), um negativo por linha
  (inclusive o EXECUTE de anon, authenticated, service_role e PUBLIC), mutantes do texto das consultas, veredito do
  `conferir-banco.cjs` (`rol=ok`). **Não prova** a IKCOUS nem a Savy.
- **reembolso da devolução só "liberado" com o dinheiro (`reembolso-da-devolucao-viva.cjs`, via
  `rodar-isolado.cjs`)**: a migration `20261225000000` (o gatilho de aviso da devolução lê o estado REAL do
  reembolso; um gatilho novo em `order_refunds` avisa "liberado" quando `concluir_estorno` confirma o dinheiro) com
  os papéis reais e o fluxo REAL do painel (`admin_devolucao_concluir`, `concluir_estorno`) num Postgres efêmero.
  O controle parte do estado ANTES (o rollback-manual, conferido byte a byte contra o corpo da `20261175000000`) e
  prova o defeito (a cliente lê "foi liberado" com o reembolso ainda `solicitado`). Depois: concluir com reembolso
  avisa "em processamento" (nunca "liberado"); o "liberado" nasce só quando a linha vira `concluido`, UMA vez
  (repetir `concluir_estorno`, a linha que sai e volta a `concluido` e **duas conexões em corrida** não dobram);
  linha `falhou`/`recusado`/sem linha = "ainda não foi liberado"; reembolso manual = "combinado com a loja"; troca,
  vale e os outros status seguem iguais; um aviso que falha **nunca desfaz o dinheiro** (`concluir_estorno`
  conclui e `valor_estornado` soma); a auxiliar interna não é executável por ninguém. Só o corpo do gatilho de
  aviso muda (nenhuma tabela, ACL ou dado), reaplicar 2x e em CRLF = mesmo estado, o rollback devolve o `prosrc`
  idêntico, o pré-voo recusa sem escrever, a conferência final recusa estado ruim e os **mutantes** (aviso
  "liberado" na conclusão, "liberado" com a linha `falhou`, gatilho sem a guarda da virada, auxiliar sem
  deduplicação, EXECUTE para `authenticated`) deixam a prova vermelha.
- **portão do reembolso da devolução (`reembolso-da-devolucao-portao-viva.cjs`, via `rodar-isolado.cjs`)**: as
  consultas `28a-conferir-reembolso-da-devolucao-so-liberado-com-dinheiro` (DEPOIS, 8 linhas) e
  `28b-antes-reembolso-da-devolucao-avisa-liberado-na-conclusao` (ANTES, 5 linhas; **não mede a ACL**), a "prova
  de objetos" do lote `20261225000000`. Mesmo desenho do portão 26: rol exato nos dois estados, um negativo por
  linha (1 byte a mais em cada corpo, STABLE, SECURITY INVOKER, ACL por papel, gatilho desligado/sem WHEN/ausente,
  função ausente). **Não prova** a IKCOUS nem a Savy.
- **reemissão do reembolso (`reemissao-do-reembolso-viva.cjs`, via `rodar-isolado.cjs`)**: a migration
  `20261226000000` (tabela só-servidor `order_refund_diagnostico`, `registrar_diagnostico_do_estorno`,
  `reemitir_reembolso_da_devolucao` e `admin_devolucao_reembolso_por_fora`) com os papéis reais e o fluxo REAL do
  painel (`admin_devolucao_concluir`, `concluir_estorno`). Cada cenário reproduz um achado do laudo do crítico de
  desenho: só cria chave nova quando o MP PROVOU que nada saiu (`recusado`, ou `falhou` com "sem saldo"/"ainda não
  liberado" repetido, sem carimbo de incerteza); `falhou` legada (sem diagnóstico) e `falhou` incerta nunca ganham
  chave nova; só adota (conclui a linha) o reembolso que o MP já fez para linha incerta, com as guardas de valor, de
  id de outra linha, de outra linha pendente do mesmo valor e de passar do total; devolução pelo painel do MP
  depois da conclusão (linha `sistema`) bloqueia a criação, contestação e linha anterior não; o saldo é o da função
  única; duplo clique e **duas conexões em corrida** (reemitir × reemitir, reemitir × "por fora") não criam duas
  linhas e não dão deadlock; o ator é admin ATUAL nas duas fontes (`auth.users` e `profiles`); ACL fechada e o
  CORPO recusa quem não é servidor mesmo com o EXECUTE aberto; a tabela de diagnóstico não é lida nem escrita por
  papel de API; "Já devolvi por fora" resolve `falhou`/`recusado` (inclusive pedido cancelado), avisa 1 vez e
  sinaliza o risco quando a linha é incerta; o diagnóstico incrementa no banco sem perder contagem em duas
  conexões. Reaplicar 2x e em CRLF = mesmo estado, o rollback apaga só o que a migration criou (e recusa perder
  diagnóstico sem a declaração do operador), o pré-voo recusa sem escrever, a conferência final recusa estado ruim
  e os **mutantes** (cada guarda tirada) deixam o cenário NOMEADO vermelho (`MUTANTE_VERBOSE=1` mostra como cada um
  morreu). **Não prova** o comportamento do Mercado Pago nem a IKCOUS/Savy.
- **portão da reemissão do reembolso (`reemissao-do-reembolso-portao-viva.cjs`, via `rodar-isolado.cjs`)**: as
  consultas `29a-conferir-reemissao-do-reembolso-consulta-o-mp-antes` (DEPOIS, 9 linhas) e
  `29b-antes-reemissao-do-reembolso-base-conhecida` (ANTES, 5 linhas; **não mede a ACL**), a "prova de objetos" do
  lote `20261226000000`. Mesmo desenho do portão 27: rol exato nos dois estados, um negativo por linha (1 byte a
  mais em cada corpo, STABLE, SECURITY INVOKER, ACL por papel, tabela com policy/grant/sem RLS, objeto ausente ou
  já presente). **Não prova** a IKCOUS nem a Savy.
- **busca de clientes (`busca-de-clientes-viva.cjs`, via `rodar-isolado.cjs`)**: as migrations `20261230000000`
  (`get_admin_customers_paged`: a tela Clientes, o balcão e o cupom exclusivo acham pelos DÍGITOS do WhatsApp, com o
  corte do 55 do +55) e `20261231000000` (`crm_clientes`: a aba Clientes do CRM ignora acento), com os papéis reais num
  Postgres efêmero. Oito clientes de fixture (WhatsApp mascarado, gravado com 55, fixo, DDD 55, sem WhatsApp, e-mail
  acentuado, uma compradora). Sete formas de digitar o mesmo número acham a mesma cliente; BORDAS: 3 dígitos não viram
  busca por dígitos e 4 viram, 12/13 dígitos que começam por 55 perdem o 55 mas DDD 55 (11 dígitos) e 12 dígitos fora do 55
  não, vazio/só espaço devolve todos, só símbolos não quebra, cliente sem WhatsApp não é achada nem quebra. O JSON (dados,
  total, estatísticas, ordenação, paginação) é IGUAL ao do corpo antigo nas buscas que o conserto não toca; o corpo
  ANTIGO (rollback numa transação desfeita) reprova as provas do defeito; comum, admin rebaixado e visitante recusados;
  ACL, atributos e dono intactos; reaplicar 2x e aplicar-desfazer-aplicar voltam idênticos; o pré-voo recusa sem
  escrever (corpo divergente, ACL aberta, atributo trocado, coluna ou função ausente) e uma troca interrompida não
  deixa nada; leitura concorrente nunca vê estado misto; mutantes (cada guarda tirada) ficam vermelhos. **Não prova** a
  IKCOUS nem a Savy.
- **portão da busca de clientes (`busca-de-clientes-portao-viva.cjs`, via `rodar-isolado.cjs`)**: as consultas
  `32a-conferir-busca-de-clientes-aplicado` (DEPOIS, 9 linhas) e `32b-antes-busca-de-clientes-corpos-vigentes` (ANTES, 7
  linhas; **não mede a ACL**, que é da 32a), a "prova de objetos" do lote `20261230000000` + `20261231000000`. Mesmo
  desenho do portão 26: rol exato nos estados (antes, depois, só uma das duas), um negativo por linha em CADA função, o
  veredito do `conferir-banco.cjs` (`rol=ok`). **Não prova** a IKCOUS nem a Savy.
- **o lucro só conta produto com custo (`lucro-so-com-custo-viva.cjs`, via `rodar-isolado.cjs`)**: a migration
  `20261234000000` (`get_admin_analytics_v2`: o lucro diário e o "Top 5 produtos mais lucrativos" do CRM > Visão geral
  só somam item de produto com custo informado; produto sem custo fica na receita e fora do lucro, e o campo novo
  `productsWithoutCost` conta quantos ficaram de fora), num Postgres efêmero, loja LIMPA. Produtos: com custo, custo
  NULL, custo 0 (zero medido, CONTA) e um apagado; dia sem venda, cancelado/estornado/aguardando fora, 22h de São Paulo
  no dia certo. O corpo ANTIGO (rollback numa transação desfeita) reproduz o defeito (lucro 230 onde é 120, Brinco em
  1º) e a receita, os pedidos, o custo vendido e o produto-controle saem IGUAIS byte a byte; a única chave nova do
  JSON é `productsWithoutCost`. Porta (cliente e admin rebaixado recusados, anon sem EXECUTE), dados intactos, reaplicar
  2x e aplicar-desfazer-aplicar idênticos, pré-voo recusa sem escrever (corpo divergente, corpo da 20261199, ACL
  aberta), rollback idempotente, leitura concorrente nunca vê estado misto, cinco mutantes ficam vermelhos.
  `LUCRO_SO=comportamento` roda só o comportamento. **Não prova** a IKCOUS nem a Savy.
- **portão do lucro só com custo (`lucro-so-com-custo-portao-viva.cjs`, via `rodar-isolado.cjs`)**: as consultas
  `35a-conferir-lucro-so-com-custo-aplicado` (DEPOIS, 6 linhas) e `35b-antes-lucro-so-com-custo-corpo-vigente` (ANTES, 5
  linhas) do lote `20261234000000`. Rol exato nos estados (depois, antes, corpo da 99), um negativo por linha, mutantes
  do texto das consultas, veredito do `conferir-banco.cjs` (`rol=ok`). **Não prova** a IKCOUS nem a Savy.
- **a venda repetida do balcão devolve a venda feita (`venda-balcao-mesma-chave-viva.cjs`, via `rodar-isolado.cjs`)**: a
  migration `20261235000000` (`registrar_venda_presencial`, a RPC do PDV: trava consultiva pela chave de idempotência
  antes de conferir a chave), com **duas conexões reais** num Postgres efêmero. A repetição da MESMA chave que chega
  antes de a primeira commitar espera a primeira e devolve `ja_existia` com o MESMO pedido (nunca "Estoque
  insuficiente" por causa da última unidade que a própria venda levou); o CONTROLE com o corpo antigo reproduz o defeito;
  estoque sobrando, chaves diferentes, venda sem chave, outro balconista e outro canal (23505), permissão e o gate antes
  da trava, rollback com o md5 da 20261199, pré-voo que recusa sem escrever e mutantes. **Não prova** a IKCOUS nem a Savy.
- **portão da venda repetida do balcão (`venda-balcao-mesma-chave-portao-viva.cjs`, via `rodar-isolado.cjs`)**: as
  consultas `36a-conferir-venda-repetida-do-balcao-aplicado` (DEPOIS, 6 linhas) e
  `36b-antes-venda-repetida-do-balcao-corpo-vigente` (ANTES, 5 linhas; **não mede a ACL**, que é da 36a) do lote
  `20261235000000`. Rol exato nos estados (depois, antes), um negativo por linha, mutantes do texto das consultas,
  veredito do `conferir-banco.cjs` (`rol=ok`). **Não prova** a IKCOUS nem a Savy.
- **a loja declara razão social, CNPJ/CPF e e-mail (`loja-declara-quem-e-viva.cjs`, via `rodar-isolado.cjs`)**: a
  migration `20261239000000` (`upsert_store_config`, as três colunas novas de `store_config` e a `v_store_config`),
  com os papéis de verdade: salvar um dos três não apaga os outros nem os demais campos da loja, as CHECK de forma,
  só o admin atual grava, o visitante lê e não escreve, ida e volta com o corpo da 99 e o ACL da view iguais, o
  rollback que recusa com dado da loja, pré-voo que recusa sem escrever, mutantes. **Não prova** a IKCOUS nem a Savy.
- **portão da identidade legal da loja (`loja-declara-quem-e-portao-viva.cjs`, via `rodar-isolado.cjs`)**: as consultas
  `40a-conferir-identidade-legal-da-loja-aplicado` (DEPOIS, 11 linhas) e
  `40b-antes-identidade-legal-da-loja-base-vigente` (ANTES, 10 linhas) do lote `20261239000000`. Rol exato nos estados
  (depois, antes), um negativo por linha (inclusive o ACL, o dono e as opções da view, que o rollback recria por DROP
  VIEW + CREATE VIEW + GRANT ALL), mutantes do texto das consultas, veredito do `conferir-banco.cjs` (`rol=ok`).
- **a cliente é avisada quando a loja responde a pergunta (`pergunta-respondida-avisa-viva.cjs`, via
  `rodar-isolado.cjs`)**: a migration `20261240000000` (`answer_question_atomic`, as DUAS sobrecargas: a de 2 argumentos,
  que o app usa, e a de 3), num Postgres efêmero. O corpo ANTIGO (rollback numa transação desfeita) reproduz o defeito
  (resposta gravada, nenhum aviso para a cliente, uma linha falsa em `push_notifications_log`); o corpo novo cria UM
  aviso em `notificacoes` só para quem perguntou (tipo, título, nome do produto, destino que abre o produto, não lido) e
  nenhuma linha no log de push, nas duas sobrecargas. Resposta repetida ou editada não duplica; dispensado o aviso, a
  edição avisa de novo; pergunta antiga não ganha aviso em massa. Quem não é admin é recusado sem escrever, o visitante
  não executa, ACL e atributos iguais antes e depois; o aviso que falha nunca perde a resposta; duas lojistas
  respondendo a MESMA pergunta (duas conexões reais) geram UM aviso. Aplicar 2x e em CRLF = mesmo estado, o rollback
  devolve os corpos de antes byte a byte, o pré-voo recusa sem escrever (corpo divergente, sobrecarga extra, índice
  único ausente), o rollback tem pré-voo (recusa corpo alheio em qualquer das duas, sobrecarga extra ou ausente, sem
  escrever; aceita o corpo desta migration e o de antes) e conferência final (recusa corpo que não voltou), seis
  mutantes ficam vermelhos e o ENSAIO (um bloco `DO` que termina em `RAISE EXCEPTION`) serve a uma
  loja real. **Não prova** a IKCOUS nem a Savy.
- **portão da pergunta respondida (`pergunta-respondida-avisa-portao-viva.cjs`, via `rodar-isolado.cjs`)**: as
  consultas `41a-conferir-pergunta-respondida-avisa-a-cliente-aplicado` (DEPOIS, 10 linhas) e
  `41b-antes-pergunta-respondida-corpos-vigentes` (ANTES, 8 linhas) do lote `20261240000000`. Rol exato nos estados
  (depois, antes e a loja PELA METADE, com só a sobrecarga de 3 argumentos de volta), um negativo por linha em CADA
  sobrecarga (corpo +1 byte, corpo que volta a citar o log de push, atributo, `EXECUTE` de PUBLIC/anon/authenticated,
  função ausente, terceira sobrecarga), mutantes do texto das consultas, veredito do `conferir-banco.cjs` (`rol=ok`).
  **Não prova** a IKCOUS nem a Savy.
- **o reembolso em dúvida prende o saldo (`reembolso-em-duvida-viva.cjs`, via `rodar-isolado.cjs`)**: a migration
  `20261241000000` (DINHEIRO; lote R1 do plano reembolso-ab), com o fluxo REAL do painel (`admin_devolucao_concluir`,
  `admin_devolucao_reembolso_por_fora`) e os papéis reais num Postgres efêmero. Cinco formas de pedido SEM linha em
  dúvida têm o mesmo saldo antes (rollback na transação) e depois; o painel (`pedido_reembolsos_e_saldo`) devolve
  exatamente os campos combinados e nenhum código do MP; a `falhou` legada marcada 2x prende o saldo e o novo pedido é
  recusado (marcada 1x, não); a substituída por manual sai da conta; a espera dos 7 dias (devolução e pedido cancelado)
  responde `aguarde` com 3 dias e com 7 dias menos 1 s, libera com exatamente 7 (o botão `por_fora_apos_espera_liberado`
  segue a porta), exige a frase, marca a linha, não se usa duas vezes e o botão some com a marca; o
  `autorizar_post_do_estorno` recusa a linha liberada por fora. CORRIDA de duas conexões nas duas ordens (saída ×
  autorizar). ACL (anon e logado comum recusados; as duas regras fechadas até ao `service_role`). Aplicar 2x e em CRLF,
  rollback idempotente que recusa com marca, pré-voo que recusa corpo divergente sem escrever. Seis mutantes ficam
  VERMELHOS (sem a regra do legado, sem o filtro da substituída nos dois lugares e só na regra, o autorizar sem a marca,
  a espera sem os 7 dias, a espera sem a marca). **Não prova** a IKCOUS nem a Savy.
- **portão do reembolso em dúvida (`reembolso-em-duvida-portao-viva.cjs`, via `rodar-isolado.cjs`)**: as consultas
  `43a-conferir-reembolso-em-duvida-aplicado` (DEPOIS, 21 linhas) e `43b-antes-reembolso-em-duvida-base-vigente`
  (ANTES, 14 linhas) do lote `20261241000000`. Rol exato nos dois estados, um negativo por linha (cada um dos doze
  corpos +1 linha, atributo, `EXECUTE` por papel, a função antiga reaberta, a tabela com policy/grant/sem RLS/coluna a
  mais, a espera ausente, os marcadores), as sucessoras na `8e`, `28a` e `29a` antes e depois, mutantes do texto das
  consultas e o veredito do `conferir-banco.cjs` (`rol=ok`). **Não prova** a IKCOUS nem a Savy.
- **as provas que DESFAZEM corpos redefinidos pela `20261241000000`** (`pagamentos-rpc`, `admin-atual`,
  `contestacao`, `cancelar-pedido`, `ordem-das-travas-composta`) a desfazem ANTES, na transação, por
  `reembolso-em-duvida-posterior.cjs` (só se no ar): ela é a mais nova, e o pré-voo de cada rollback mais velho a recusa.
- **o sino do pedido de retirada (`o-sino-do-pedido-de-retirada-viva.cjs`, via `rodar-isolado.cjs`)**: a migration
  `20261233000000` (`notifica_cliente_de_mudanca_de_status`, a trigger `tr_pedido_avisa_o_cliente`): o pedido de
  RETIRADA na loja (`customer_data->>'shipping_option_id' = 'store-pickup'`) avisa "Pedido pronto para retirar" e
  "Pedido retirado" no sino, com a trigger real e os papéis reais num Postgres efêmero; o resto fica byte a byte como era.
  Fluxo de entrega e de retirada, cancelamento nos dois, 19 formas de `customer_data` que NÃO são retirada (id com espaço,
  sufixo, caixa, lista, objeto, `null`, só o endereço da loja), o mesmo status de novo (quatro jeitos) sem duplicar,
  convidado sem aviso, UPDATE de várias linhas (cada uma com o seu texto), status e dados mudando juntos (vale o NEW),
  falha de aviso que não derruba o pedido, e o aviso que JÁ existia antes da migration, que fica como está. O corpo
  ANTIGO (rollback numa transação desfeita) reprova a prova da retirada e IGUALA o novo em tudo o que não é retirada;
  mutantes do corpo ficam vermelhos; ACL, atributos e dono iguais; aplicar 2x = 1x; o pré-voo recusa sem escrever (corpo,
  ACL, atributo, trigger fora do lugar, coluna, sobrecarga); troca interrompida; leitura concorrente. **Não prova** a
  IKCOUS nem a Savy.
- **portão do sino da retirada (`o-sino-do-pedido-de-retirada-portao-viva.cjs`, via `rodar-isolado.cjs`)**: as consultas
  `34a-conferir-sino-da-retirada-aplicado` (DEPOIS, 7 linhas) e `34b-antes-sino-da-retirada-corpo-vigente` (ANTES, 6
  linhas) e a medição `34m-medir-sino-da-retirada` (rol aberto, só contagens), a "prova de objetos" do lote
  `20261233000000`. Mesmo desenho do portão 26: rol exato nos estados, um negativo por linha, o veredito do
  `conferir-banco.cjs` (`rol=ok`), a 34m por diferença contra os pedidos montados. **Não prova** a IKCOUS nem a Savy.
- **gestão de categorias sem produto órfão (`categorias-gestao-viva.cjs`, via `rodar-isolado.cjs`)**: a migration
  `20261237000000` (14/10/2026; permissão + regra de devolução) cria `renomear_categoria`, `apagar_categoria_vazia`,
  `categorias_com_uso` e oito auxiliares `categoria__*`. A categoria do produto é guardada pelo NOME (texto, sem chave
  estrangeira) e o nome aparece em quatro lugares: a linha de `categorias`, `produtos.categoria`, o link do banner
  (`/?category=<nome>`, codificado ou cru) e a lista `categorias_sem_troca` da política de devolução. A prova roda com os
  papéis reais num Postgres efêmero: renomear troca os QUATRO lugares numa transação e conta cada um (com a chave da
  vitrine: maiúscula e espaço nas pontas; nome PARECIDO e outra categoria ficam; banner inativo também; os outros
  parâmetros do link ficam; a lista da política só troca o item que é a categoria, guarda a ordem e as repetições dos
  outros itens, e o nome novo não se repete; produto e item da lista mantêm o espaço que tinham nas pontas, para a
  regra de devolução, que compara `lower()` sem tirar espaço, dar o MESMO "aceita troca?" de cada produto antes e depois
  da troca, numa matriz de espaços, caixas e itens); falha injetada no banner ou na
  política não deixa NADA trocado (com o controle sem a falha); nome repetido (maiúscula, acento, pontuação, espaço),
  vazio, só símbolos e acima de 80 letras recusam sem escrever; duas linhas quase iguais recusam renomear (ninguém é
  adivinhado); apagar recusa com o motivo e as contagens enquanto houver produto, banner (ativo ou não) ou regra de
  devolução, e vazia apaga só ela; `anon` sem EXECUTE, logado comum, admin rebaixado (JWT velho) e admin só numa das duas
  fontes recebem "Acesso negado" sem escrever (com o controle de que SÓ a segunda guarda os barra), service_role passa e as
  auxiliares são fechadas; a codificação do nome é a de `encodeURIComponent` (inclusive emoji) e a leitura do link a de
  `destino-do-banner.ts`; o rollback apaga as onze funções e só elas e reaplicar devolve o mesmo corpo e a mesma ACL;
  o pré-voo recusa sem escrever. "Escondida da vitrine" é a coluna `ativo` que já existia (o front a respeita): esta
  migration não cria outra. **Não prova** a IKCOUS nem a Savy; **não cobre** link de banner com endereço completo
  escrito à mão nem a corrida entre renomear e salvar um produto com a tela velha.
- **portão da gestão de categorias (`categorias-gestao-portao-viva.cjs`, via `rodar-isolado.cjs`)**: as consultas
  `38a-conferir-gestao-de-categorias-aplicado` (DEPOIS, 8 linhas) e `38b-antes-gestao-de-categorias-funcoes-ausentes`
  (ANTES, 6 linhas), a "prova de objetos" do lote `20261237000000`. Mesmo desenho do portão 34: rol exato nos estados,
  um negativo por linha (byte a mais em cada corpo, atributo, EXECUTE aberto ou fechado demais, auxiliar aberta ou
  ausente ou trocada por uma sobrecarga de outra assinatura, gatilho, coluna e função de que a migration depende), o
  veredito do `conferir-banco.cjs` (`rol=ok`).
  **Não prova** a IKCOUS nem a Savy.
- **pedidos de privacidade da cliente (`pedidos-de-privacidade-viva.cjs`, via `rodar-isolado.cjs`)**: a migration
  `20261238000000` — a tabela `pedidos_de_privacidade` (excluir conta / corrigir e-mail, atendida à mão). Com a RLS real:
  a cliente lê e insere só o dela (leitura cruzada e inserção em nome de outra recusadas), não decide nem escreve
  situação/carimbos/observação, um aberto por (cliente, tipo) (23505), anon fechado, o admin atual atende com carimbo
  do servidor e a decisão é final, o admin rebaixado com JWT velho não lê nem decide, **ninguém apaga** (DELETE e
  TRUNCATE recusados para anon, cliente, admin e service_role; sem grant e sem política de DELETE), forma do e-mail e
  chave estrangeira sem cascata, estrutura (RLS, políticas, índice, colunas de INSERT/UPDATE), rollback que RECUSA com
  pedido registrado. **Não prova** a IKCOUS nem a Savy.
- **ensaio da anonimização de conta (`anonimizar-conta-ensaio-viva.cjs`, via `rodar-isolado.cjs`)**: sem migration. O SQL
  é LIDO dos blocos do roteiro `docs/runbooks/atender-pedido-de-privacidade.md` e roda contra uma cliente de mentira e
  uma vizinha. O ensaio (`v_confirmar := false`) não grava; valendo, o dado pessoal sai (perfil, endereços, favoritos,
  carrinho, avisos, push, códigos, texto livre e endereço dos pedidos, texto da devolução), os pedidos **continuam** com
  os mesmos valores, o login **não é apagado** (fica bloqueado, com e-mail sem identidade), a vizinha e o registro do
  pedido de privacidade ficam intactos; uma varredura independente não acha mais nome/e-mail/telefone/CPF e a "busca de
  sobras" do roteiro acha só a resposta da loja que cita o nome; as travas (pedido ou devolução em andamento, foto no
  Storage, sem pedido aberto) recusam sem mudar nada. Do login do Supabase o roteiro também limpa a troca pendente de
  e-mail/telefone e os códigos de `auth.users`, apaga as linhas dela de `auth.one_time_tokens` e `auth.mfa_factors` e
  deixa o `auth.audit_log_entries` sem IP e sem dado pessoal (a linha fica); do pedido só passa a lista de permitidos
  (forma de entrega, endereço da loja, canal), provada com chave de endereço de nome inesperado. A prova (g) tira UM
  passo por vez (7 mutantes + o do IP) e a varredura tem de achar dado dela. O esquema `auth` é **emulado** por esta
  prova (colunas e tabelas que o roteiro toca, com os tipos do GoTrue); o que só um Supabase real prova está marcado
  `[CONFERIR EM LOJA DE TESTE]` no roteiro. **Não prova** a IKCOUS nem a Savy.
- **portão dos pedidos de privacidade (`pedidos-de-privacidade-portao-viva.cjs`, via `rodar-isolado.cjs`)**: as consultas
  `39a-conferir-pedidos-de-privacidade-aplicado` (DEPOIS do apply, 19 linhas) e `39b-antes-pedidos-de-privacidade-objetos-ausentes`
  (ANTES, 9 linhas, com o `REFERENCES` do papel `postgres` em `auth.users`) e a medição
  `39m-medir-privilegios-do-roteiro-de-privacidade` (rol aberto, só catálogo), a "prova de objetos" do lote `20261238000000`.
  Rol exato em todos os estados (depois, antes, ida e volta, o arquivo em CRLF), a migration que **não é reaplicável**
  recusada no pré-voo, um defeito por vez reprovando SÓ a sua linha (coluna, CHECK trocada ou com valor a mais, chave com
  cascata, índice sem o filtro, RLS desligada, política a menos, a mais, para outro papel ou com a expressão frouxa, cada
  privilégio a mais ou a menos para PUBLIC, anon, authenticated e service_role, corpo com 1 byte, atributos, `EXECUTE`
  aberto, outra sobrecarga, gatilho desligado, de outro tipo, a mais ou com `WHEN`; e, no ANTES, o resto de uma meia
  migration e cada dependência que falta), o `REFERENCES` provado trocando o papel alvo por um papel de teste (o
  `postgres` local é superusuário), a 39m lida certa por tabela com um papel de teste, o papel sem `USAGE` em `auth`
  fazendo a consulta ERRAR (nunca virar positiva) e o veredito do `conferir-banco.cjs` (`rol=ok`). **Não prova** a IKCOUS
  nem a Savy, nem o `REFERENCES` do `postgres` real (só a `39b` rodada na loja). O roteiro manual de anonimização **não
  roda aqui**: ele apaga dado real de login e fica com o dono, caso a caso.
- **receita do mês, caracterização (`receita-uma-regua-viva.cjs`)**: sem migration; escreve só dentro de
  transação desfeita. Seis pedidos (cinco pelos caminhos de produção, o de entrega paga na hora com o estado
  final inserido) comparam Início, CRM e Financeiro; afirma a igualdade onde ela vale e
  imprime os achados A (venda estornada) e B (pago depois de expirar) com valor exato. Falha só em divergência
  NÃO prevista. Não corrige nada.
- **estoque mínimo editável (`estoque-minimo-editavel-viva.cjs`)**: sem migration; escreve só dentro de transação
  desfeita, para provar grants/RLS/view — o admin grava
  `estoque_minimo` (número e NULL) por `vw_produtos_admin` e por `produtos`; cliente e anon não.
- **`sucessoras-da-99.cjs`** não é prova: é o módulo que lista as migrations que redefinem corpos da
  `20261199000000` (20261212, 20261214, 20261227, 20261228, 20261230, 20261231, 20261234, 20261235, 20261239) e as desfaz/reaplica para as provas antigas, e `conferirLista()`
  reprova se aparecer uma sucessora que não esteja na lista.
- **função nova não nasce aberta (`portas-do-visitante-so-as-permitidas-viva.cjs`, via `rodar-isolado.cjs`)**: L8 da
  auditoria de 12/10, sem migration. Com todas as migrations aplicadas, toda função de `public` que anon,
  authenticated ou PUBLIC executa (função de extensão inclusive) tem de estar em
  `portas-do-visitante-permitidas.json`, com quem executa, tipo, SECURITY DEFINER e o porquê. Reprova função
  nova aberta, porta que abriu mais ou fechou (a tela quebraria), tipo ou SECURITY DEFINER que mudou, linha
  duplicada e linha de função que não existe mais. A lista é a foto das duas lojas reais de 14/10/2026. Para
  abrir uma função de propósito: a linha entra no mesmo PR da migration. Um autoteste prova que o detector
  enxerga função sem REVOKE, com REVOKE só de PUBLIC, com `authenticated` esquecido e de extensão.

## Como rodar

**SÓ no CI** (regra do dono, 14/09: suíte de banco não roda na máquina do
dono). A receita inteira está no workflow:

1. service `postgres:17` do próprio job (efêmero, morre no fim);
2. `node tests/banco/provisionar.cjs` — emula a fábrica do Supabase: papéis
   anon/authenticated/service_role, default privileges, contrib no schema
   `extensions` (pgcrypto para o `extensions.crypt` da `resolver_loja`),
   `auth.*` (o `auth.uid()` daqui lê o GUC `app.rpc.user_id`, que é o "login"
   da prova), publication de realtime, storage mínimo e **pg_cron emulado por
   stub** (agendamentos registram, nada dispara);
3. `node tests/banco/aplicar-migrations.cjs supabase/migrations` — aplica a
   raiz inteira do zero; as duas linhas `CREATE EXTENSION ... pg_cron/pg_net`
   viram comentário (stub já de pé), todo o resto aplica nativo;
4. `node tests/banco/invariantes-dinheiro.cjs` — as provas.

Trava de segurança (`efemero.cjs`): a suíte RECUSA rodar sem
`CI_BANCO_EFEMERO=1` e com `DATABASE_URL` fora de localhost — este diretório
**nunca** aponta para banco real, e dinheiro em teste é dado de FIXTURE.

## Custódia

Arquivos desta pasta são da frente CI-CONTRATO-DINHEIRO. A receita de
provisionamento é a mesma da frente ci-banco (`scripts/ci/banco/`, PR #585),
reesrita autocontida — com três diferenças documentadas no cabeçalho do
`provisionar.cjs` (auth.uid() lendo GUC, auth.users com raw_app_meta_data e
o stub do pg_cron), todas necessárias para PROVAR comportamento, não só
aplicação.
