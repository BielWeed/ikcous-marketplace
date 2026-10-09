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
  Os blocos seguintes da mesma feature (a vaga do cupom, o portao) entram no mesmo arquivo.

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
