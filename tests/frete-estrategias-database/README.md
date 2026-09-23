# Estratégias de frete local e nacional (T1/banco, 23/09/2026)

Ensaio local da migration `20261171000000_o_frete_nacional_ganha_estrategia_propria.sql`,
no molde de `tests/frete-revisao-database/` (a mesma receita: Postgres 17 efêmero e
descartável via Docker, criado e destruído pelo próprio script). **O CI geral do app NÃO
roda este ensaio automaticamente** — ele não está referenciado em nenhum
`.github/workflows/*.yml`. Rode explicitamente antes de aplicar a migration em qualquer
banco:

```powershell
node tests/frete-estrategias-database/run.cjs
```

Opcional, repetível — aplica migration(ões) EXTRA por cima da raiz inteira (mesmo
mecanismo de `tests/banco/aplicar-migrations.cjs`: arquivo inteiro numa query só) e roda
os casos (b)-(h) de novo nesse estado, mais os casos conjuntos (j1)-(j3) (ver seção
própria abaixo):

```powershell
node tests/frete-estrategias-database/run.cjs --com-migration "C:\caminho\absoluto\para\a_migration_extra.sql"
```

## O que ele faz

Seis containers Postgres efêmeros e descartáveis (`postgres:17`, a mesma imagem do
`rpc-ci.yml`), cada um numa porta de host própria — nunca tocam banco de loja nem
qualquer DSN do `manutencao-bancos`. Nada é instalado além do Docker Desktop (já
presente na máquina) e do pacote `pg` (já é dependência do repositório). O sexto
container só sobe quando `--com-migration` é passado.

**Quatro containers — um por valor de `free_shipping_min` — provam a preservação (item
a):** a cópia legada (bloco `DO` da migration) só roda **uma vez por banco**, guardada
por `information_schema.columns`, então comparar "antes da 20261171" com "depois" exige
uma transição nova a cada valor:

1. Sobe o container, aplica `supabase/migrations` **até (exclusive) a 20261171** —
   diretório temporário filtrado por nome de arquivo — e ajusta `free_shipping_min`.
2. Cria um pedido nacional (via `shipping_quotes_cache`, sem o campo `estrategiaNacional`
   — o formato de antes desta migration) e um pedido local; grava os fretes cobrados
   (ANTES).
3. Aplica **só** o arquivo `20261171000000_...sql` (a migration em si, lida e executada
   direto — não a pasta inteira: o baseline `20260806000000` não é idempotente e uma
   segunda passada pela raiz falharia em "relation already exists").
4. Confere as 5 colunas copiadas contra a tabela do contrato (`desligado`/`sempre`/
   `por_produto`/`acima_de_valor`).
5. Cria um SEGUNDO pedido nacional (cache novo, ainda sem carimbo) e local; grava os
   fretes (DEPOIS). Compara ANTES == DEPOIS nos dois.
6. Destrói o container (`finally`), passe ou falhe o caso.

Valores testados: `0` (desligado), `0.01` (sempre), `-1` com item marcado (por_produto),
`150` (acima_de_valor).

**Um quinto container, com a raiz inteira aplicada uma vez (já com a 20261171 dentro),
prova os casos (b) a (i)**, sequencialmente, reconfigurando `store_config` entre casos.
Com `--com-migration`, um **sexto** container aplica a(s) extra(s) por cima e
roda (c)-(h) e (j1)-(j3). Nesse banco, (b) não reaplica a 20261171: a trava
de hash impede corretamente sobrescrever uma RPC já alterada pela extra.
O container principal prova (b) e (i), incluindo o rollback-manual da 20261171.

- **(b) reaplicação não sobrescreve**: muda `free_shipping_min` para um valor que
  produziria outra estratégia se a cópia rodasse de novo, mantém a coluna nacional em
  `'desligado'` (a escolha da lojista), reaplica o arquivo da migration, confere que a
  coluna continua `'desligado'`.
- **(c) os 5 CHECKs recusam**: `acima_de_valor` com mínimo `0`; `desconto_na_mais_barata`
  sem tipo; percentual `101`; percentual `12.5` (não inteiro); valor negativo — cada
  tentativa é uma `UPDATE` isolada, e o SQLSTATE esperado é `23514`.
- **(d) `upsert_store_config` separa local de nacional**: salvar só `free_shipping_min`
  não mexe nas 5 colunas nacionais, e salvar só colunas nacionais não mexe em
  `free_shipping_min` — nos dois sentidos.
- **(e) o carimbo `estrategiaNacional`**: igual às 5 colunas atuais cobra o `price` do
  cache (inclusive com desconto: cheio R$ 24,90 / price R$ 21,16 — fórmula do contrato em
  CENTAVOS inteiros, `Math.round(2490 × 15 / 100) = 374` → `2490 − 374 = 2116`); divergente
  recusa com `FRETE_COTACAO_DESATUALIZADA` e não grava pedido nem item; ausente (a CHAVE
  não existe no JSON) com a configuração atual sendo o **espelho legado** aplica a regra
  de `free_shipping_min`; ausente com a configuração **fora** do espelho recusa.
  **EMENDA (revisão T1, 23/09)**: carimbo PRESENTE mas não é um objeto JSON completo —
  json `null` (e5), `{}` vazio (e6), ou faltando um campo (e7, falta `alcance`) — recusa
  DIRETO, sem consultar o espelho (não é "carimbo ausente": a edge escreveu algo, só que
  malformado). **Subtotal velho (e8-e10, e12-e13)**: com `acima_de_valor` ou
  `desconto_na_mais_barata` e mínimo > 0, se o `subtotalCotacao` do carimbo (o subtotal do
  instante da cotação) está do lado ERRADO do mínimo em relação ao subtotal recalculado no
  pedido (produto mudou de preço entre a cotação e a finalização), recusa — nos dois
  sentidos (subiu ou caiu o preço) e para as duas estratégias que usam mínimo. **Rodada
  final (e11)**: uma cotação com DUAS opções na mesma linha do cache (o formato real da
  edge) — só a de menor `precoCheio` leva o desconto; escolher a outra cobra o `price`
  PRÓPRIO dela (cheio), provando que a RPC lê a opção certa por `id`, não a primeira/mais
  barata da lista.
- **(f) local e nacional não vazam um para o outro**: `free_shipping_min=0.01` (local
  sempre grátis) com nacional `desligado` — o pedido nacional cobra o preço do cache
  normalmente, o local sai `0`; e o inverso (local desligado, nacional `sempre`) — o
  local cobra `local_delivery_fee`, o nacional sai `0`.
- **(g) os portões da RPC**: id nacional com CEP dentro da faixa local recusa; id
  nacional com CEP inválido (sem dígito nenhum) recusa; endereço de conta com CEP local
  salvo + `p_address_data.cep` de um CEP distante (mas igual ao CEP da cotação, para não
  cair na reconciliação pré-existente do 2-bis) recusa com "cotado para outro CEP";
  `free-shipping-promo` sem a estratégia `por_produto` vigente recusa; com `por_produto`
  e item marcado sai `0`.
- **(h) retirada e local continuam intocados**, e a `v23` (RPC do pagamento na entrega)
  continua recusando qualquer opção de transportadora pela mensagem pré-existente
  (código morto nesta migration, sem regressão — mesma nota da 20261170) e continua
  servindo `local-delivery` normalmente.
- **(i) o ciclo migration → rollback → reaplicação**: aplica o rollback-manual e confere,
  pelo hash SHA-256 de `pg_proc.prosrc`, que `create_marketplace_order_v23`/`_v24` e
  `upsert_store_config` voltam ao corpo **exato** que a `20261170000000`/`20261167000000`
  deixavam; confere que `v_store_config` volta a não ter as 5 colunas nacionais (via
  `information_schema.columns`); confere que a **coluna** `store_config.national_*`
  continua na tabela com o valor de fantasia gravado antes do rollback (o rollback NÃO
  dropa coluna — só a regra e a leitura pública voltam, o dado da lojista sobrevive);
  reaplica a migration e confere que os hashes voltam aos valores novos e que o dado
  nacional não foi reescrito; reaplica de novo (migration já viva) e confere que é
  no-op.

### (j) casos conjuntos — só com `--com-migration`

Rodam no sexto container, depois de (c)-(h) e da(s) extra(s) aplicada(s) por cima:

- **prova de mecanismo (não numerada)**: se a extra é a sintética deste próprio README
  (função `public._prova_ensaio_frete_migration_extra()`), confere que ela responde com a
  marca esperada — prova que o TEXTO do arquivo passado por `--com-migration` realmente
  rodou no banco, não só foi "aceito sem efeito". Fica em silêncio com uma extra real (que
  não define essa função).
- **(j1) v24 nacional com desconto + CPF**: só roda se o SQL da(s) extra(s) mencionar
  `'cpf'` **e** usar o padrão esperado pelo plano (`p_address_data->>'cpf'` ou
  equivalente) — sem os dois, não há como saber por qual campo injetar o CPF no teste sem
  adivinhar, e o caso vira `SKIP` com o motivo exato. Quando roda: pedido nacional com
  desconto (price 21,16) e CPF de 11 dígitos em `p_address_data.cpf` → confere
  `shipping = 21.16` e `customer_data->>'cpf'` com 11 dígitos.
- **(j2) chamada de 13 argumentos sem CPF** (app antigo que nunca soube do CPF) continua
  criando pedido `local-delivery` normalmente — SEMPRE roda, independente de (j1).
- **(j3) a extra não apagou a regra nacional**: o hash de `create_marketplace_order_v23`/
  `_v24` (com a extra aplicada) não é mais o da `20261170` **e** o corpo (`pg_proc.prosrc`)
  ainda contém o texto `estrategiaNacional`.

✅ **Prova conjunta com a migration real do CPF (`20261172`)**: executado com
`--com-migration` apontando ao SQL em `ikcous-cart-ux-wt`; (j1), (j2) e (j3)
passaram em Postgres temporário. O CPF usado em (j1) é válido (`52998224725`).
A reaplicação isolada da 20261171 e o rollback dela foram verificados no
container principal; a migração posterior é aplicada uma vez no sexto container.

## Fixtures

UUIDs fixos, nunca gerados por round-trip (mesma convenção de
`tests/frete-revisao-database/run.cjs`). Dois produtos: um normal (`preco_venda 50.00`,
`frete_gratis false`) e um marcado (`preco_venda 30.00`, `frete_gratis true`, usado nos
casos de `por_produto`/`free-shipping-promo`). CEPs locais em `38500-0xx` (dentro da
faixa `38500000-38505000`); CEPs nacionais fora dessa faixa, um bloco por caso para não
colidir na busca do cache (`destination_cep` + `origin_cep` + `cart_hash` + `id` + janela
de 24h). Dinheiro em teste é dado de FIXTURE — nenhum dado de cliente, nenhuma chave
real.

## Aplicação de verdade (depois da revisão, nunca por este ensaio)

```powershell
node scripts/db-apply.cjs 20261171000000_o_frete_nacional_ganha_estrategia_propria.sql
```

🔴 **Só o nome do arquivo (basename), nunca `supabase/migrations/...`** — mesma
observação já registrada no README de `tests/frete-revisao-database/`: passar o caminho
com diretório quebra a escrita automática do rollback do `db-apply.cjs`.
