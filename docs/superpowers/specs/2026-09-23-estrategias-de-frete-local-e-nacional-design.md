# Estratégias de frete LOCAL e NACIONAL — desenho (23/09/2026, rev. 2)

Pedido do dono (captura Admin > Frete, 23/09 02:07): separar o "FRETE GRÁTIS" atual em
**estratégias do frete local** (fica na seção atual) e criar uma **tela própria de estratégias do
frete nacional** — grátis acima de um valor, ou desconto (percentual ou fixo) na opção nacional
mais barata. A cliente vê o valor certo no carrinho, finaliza e o pedido nasce com o mesmo
valor. As configurações de hoje de todas as lojas são preservadas, e a promoção local nunca
vaza para o nacional.

Branch `feat/local-national-shipping-strategies-20260923`, base `e822ba3`. Entrega: PR draft,
sem aplicar migration em banco de loja, sem deploy, sem merge.

Rev. 2 incorpora: crítica de desenho Opus (veredito CORRIGE — B1, B2, B3, I1–I5, M1–M4, e a
alternativa A1, adotada) e o `socio` (D1–D5 + "benefício nacional na mais barata").

## 1. O contrato de hoje (medido, não suposto)

| Peça | O que faz com a regra de grátis |
|---|---|
| `store_config.free_shipping_min` | Campo ÚNICO, `numeric(10,2)`. Sentinelas: `0` desligado · `0.01` sempre · `<0` por produto · `>0` acima de R$ X |
| `src/lib/presets-de-frete-gratis.ts` | `presetDoConfig`/`valorDoPreset` — fonte única no front |
| `CartContext.freteGratis` (`:818`) | SIM/NÃO global. **Não olha a opção escolhida.** `shippingFee` vira 0 antes do preço da opção |
| RPC `create_marketplace_order_v23/_v24` bloco 4 (`20261170:513`) | Mesma regra ANTES de olhar a opção: se bate, frete = 0 **para qualquer modalidade**, sem consultar o cache |
| RPC passo 6 | Recalcula o total e **recusa diferença > R$ 0,05** |
| edge `calculate-shipping` (`:856,:899`) | Só o preset por produto: `free-shipping-promo` R$ 0 fora da cidade (**sem gravar no cache**) e entrega local zerada. Transportadora sai com preço CHEIO |
| `configuracao.ts:121` `calcularRevisaoConfig` | Impressão da configuração que invalida o cache do celular (2 h) e do servidor |
| `ShippingCalculator` (`:792,:908`) | Com `freteGratis`, TODO cartão diz "GRÁTIS" |
| Promessas antes da escolha | selo nos produtos (7 telas), `FreeShippingBlock`, `ShippingProgress`/meta do `CartView`, `CartReminder` (2ª cópia da regra), pílula de economia, `utils/regra-de-frete.ts`, `StoreContext.calculateShipping` (3ª cópia) |
| `v23` (pagamento na entrega) | Recusa transportadora sempre (2-ter). Nacional só nasce pela `v24` |

## 2. Modelo persistido

**Local = o campo que já existe.** `free_shipping_min`, mesmas sentinelas, mesmo significado —
passa a valer **só** para `local-delivery` e `store-pickup` (esta já é R$ 0).

**Nacional = 5 colunas novas em `store_config`** (colunas com CHECK — é dinheiro):

| Coluna | Tipo | Regra |
|---|---|---|
| `national_shipping_strategy` | text NOT NULL DEFAULT `'desligado'` | `desligado`, `acima_de_valor`, `sempre`, `por_produto`, `desconto_na_mais_barata` |
| `national_shipping_min` | numeric(10,2) NOT NULL DEFAULT 0 | `>= 0`. Obrigatório `> 0` em `acima_de_valor`; opcional no desconto (0 = sem mínimo) |
| `national_discount_type` | text NULL | `percentual`, `fixo` |
| `national_discount_value` | numeric(10,2) NOT NULL DEFAULT 0 | `>= 0` |
| `national_benefit_scope` | text NOT NULL DEFAULT `'mais_barata'` | `mais_barata`, `todas`. Alcance do GRÁTIS nacional. Desconto é sempre `mais_barata` |

CHECK de linha: `acima_de_valor ⇒ min > 0`; `desconto_na_mais_barata ⇒ tipo NOT NULL AND
valor > 0 AND (tipo = 'fixo' OR (valor <= 100 AND valor = trunc(valor)))` (M1).

**Preservação (cópia da regra de hoje), só no instante em que a coluna nasce (B2):** um bloco
`DO` confere em `information_schema.columns` se `national_shipping_strategy` já existe; se NÃO
existe, cria as colunas e copia; se já existe, não toca em dado nenhum. Reaplicar nunca
sobrescreve a escolha da lojista.

| `free_shipping_min` hoje | nacional nasce | alcance |
|---|---|---|
| `0` / NULL | `desligado` | — |
| `0.01` | `sempre` | `todas` |
| `< 0` | `por_produto` | `todas` |
| `> 0` | `acima_de_valor`, min = o mesmo | `todas` |

Com `todas`, cada loja cobra no dia seguinte **exatamente** o que cobra hoje. Loja criada depois
da migration nasce com o nacional `desligado` (M2, decisão D2 do `socio`: igual à regra local de
loja nova).

## 3. A regra nacional — calculada UMA vez, na edge (A1)

Na cotação de fora da cidade, depois de os provedores responderem, a edge aplica a estratégia
nacional sobre as opções E grava o resultado no cache (é o que a RPC lê):

- subtotal = soma dos preços do BANCO (`produtos.preco_venda` / `price_override` da variação ×
  quantidade), a mesma conta da RPC.
- `desligado` → preço cheio.
- `sempre` / `por_produto` (algum item marcado) / `acima_de_valor` (subtotal ≥ min) → R$ 0 nas
  opções do alcance (`todas`, ou só as de menor preço cheio).
- `desconto_na_mais_barata` com subtotal ≥ min → só nas opções de menor preço cheio (empate:
  todas as empatadas). Conta em **centavos inteiros** (I3): `percentual` → `cheio −
  round(cheioCentavos × pct / 100)`; `fixo` → `cheio − min(valorCentavos, cheioCentavos)`.
  Nunca negativo.
- Cada opção leva `price` (final), `precoCheio`, e `estrategiaNacional` = as 5 colunas lidas no
  instante da cotação (carimbo literal — sem algoritmo de hash para bater entre TS e SQL).
- O atalho `free-shipping-promo` (por produto) passa a obedecer a estratégia NACIONAL e **é
  gravado no cache** com o mesmo carimbo.
- `calcularRevisaoConfig` inclui as colunas nacionais **só quando existem** (B1): mudar a
  estratégia invalida o cache do celular e do servidor; banco antigo mantém o hash de hoje.
- Colunas lidas numa consulta separada e tolerante (molde `lerEnderecoDaLoja`): banco sem elas =
  nacional espelha a local com alcance `todas` = comportamento de hoje.

## 4. Servidor (RPC) — confere, não calcula

**Migration `20261171000000_o_frete_nacional_ganha_estrategia_propria.sql`** (aditiva, sem
BEGIN/COMMIT; preflight por hash dos corpos vivos: v23 e v24 da `20261170` **e**
`upsert_store_config` da `20261167` (I5); entrada no `VERIFICACOES` do `db-apply.cjs`):
- colunas + CHECKs + cópia (seção 2); `v_store_config` com as colunas no FIM;
  `upsert_store_config` no padrão `CASE WHEN config_json ? 'coluna'` (salvar a tela local não
  apaga a nacional e vice-versa). Triggers `dominio_publico_*`: as colunas NÃO entram (são do
  lojista, não da frota — M4).
- bloco 4 das duas RPCs:
  - **opção da loja** (`local-delivery`, `store-pickup`): regra LOCAL, idêntica à de hoje.
  - **opção nacional**: nunca mais pula o cache. Exige (B3): CEP de entrega conhecido e NÃO local;
    com `p_address_id` de conta, o CEP vem de `user_addresses` e tem de bater com o
    `p_address_data.cep` enviado. Preço = `price` da opção na linha do cache do carrinho (como
    hoje), e o carimbo `estrategiaNacional` tem de ser IGUAL às colunas atuais — senão recusa
    `FRETE_COTACAO_DESATUALIZADA` (o front já trata esse prefixo: recota).
  - consequência: o furo antigo "id inventado + CEP distante + grátis ⇒ R$ 0 sem cotação" fecha.
- `rollback-manual-20261171...sql`: corpos EXATOS da `20261170`/`20261167` e a view sem as
  colunas; **não** remove colunas (DROP COLUMN apagaria a configuração da lojista).

**Janela de publicação (ordem obrigatória):** 1) migration; 2) edge; 3) front. Entre 1 e 2 a edge
velha grava opções SEM carimbo → a RPC tem de aceitar opção sem carimbo **enquanto a estratégia
nacional for a cópia legada** (carimbo ausente ⇒ tratar como "estratégia = espelho da local,
alcance todas" e aplicar a regra legada no servidor). Isso mantém a janela sem recusa; depois que
a edge nova sobe, todo carimbo existe. (O teste de banco cobre os dois lados da janela.)

## 5. Front

- Nova `src/lib/estrategias-de-frete.ts` (pura): regra LOCAL (hoje em `presetDoConfig`),
  descrição das promessas, e leitura do carimbo nacional. O front **não recalcula** preço
  nacional: usa `option.price` (já final) e `precoCheio` para riscar.
- `CartContext`: veredito da opção escolhida. Local → regra local; nacional → `option.price`.
  `descontoDoFrete = precoCheio − price`. `freteIndefinido` só dispensa escolha quando nenhuma
  opção é necessária (local grátis E cliente local). Colunas novas mapeadas em
  `StoreContext` (`:102,:485`) e `realtimeSyncEngine.ts:120` (I4).
- `ShippingCalculator`: preço final por cartão; com desconto, cheio riscado + final + "desconto
  da loja"; "GRÁTIS" só no cartão que é grátis; embaixo das não beneficiadas: "o benefício vale
  só na opção mais barata". Auto-seleção pelo preço final; nova cotação não troca escolha manual.
- `CheckoutView`: linha do frete em 3 estados (grátis / com desconto / cheio); pílula de
  economia soma o desconto do frete. Payload inalterado.
- **Promessas antes da escolha** (D4): se local e nacional dizem o mesmo, a frase de hoje; se
  diferem, a frase diz onde vale ("Frete grátis na cidade", "Frete grátis para todo o Brasil
  acima de R$ X"). Com CEP conhecido (conta com endereço), só a regra que vale para ela. Desconto
  nacional não vira selo. `CartReminder`, `StoreContext.calculateShipping` e
  `utils/regra-de-frete.ts` passam a ler a mesma função (fim das cópias).

## 6. Admin

- Seção "Frete grátis" → **"Estratégias do frete local"** (entrega na cidade e retirada): os 4
  presets de hoje. Mesmo salvar.
- Dentro de "Fora da cidade": botão **"Estratégias do frete nacional →"** com o estado salvo ao
  lado ("desligado", "grátis acima de R$ 199 · todas as opções", "15% na mais barata").
- **Tela própria** `admin-shipping-national` (skill `nova-tela`): 5 escolhas em pills (direção
  D), painel de mínimo/valor/alcance, prévia em reais, aviso sem transportadora ligada, barra de
  salvar própria, guarda de alteração não salva. Salva só as colunas nacionais.
- **Alcance (`socio`, 23/09):** o valor salvo nunca muda sozinho — mexer só no mínimo mantém
  "todas as opções". O padrão "só a mais barata" vale só para loja nova e para quem sai de
  `desligado` e liga um grátis nacional pela primeira vez.
- **Aviso com custo, não genérico**, quando o alcance é `todas`: "Hoje a cliente pode escolher a
  entrega expressa e o frete dela fica por sua conta. Quer limitar o grátis à opção mais
  barata?" com o botão que troca o alcance (e ainda exige salvar).
- Card de etiquetas: esta branch não toca (outra frente o remove da tela).

## 7. Testes

- Edge (Deno): tabela de casos da regra nacional (5 estratégias × alcance × empate × mínimo ×
  arredondamento em centavos × cotação parcial); carimbo gravado; `free-shipping-promo` no cache;
  banco sem colunas = hoje; revisão muda com a estratégia.
- Banco (Postgres descartável, molde `tests/frete-revisao-database/`): preservação (4 configs
  legadas → mesmo total antes/depois); reaplicação não sobrescreve escolha; CHECKs; carimbo
  divergente recusa; carimbo ausente na janela legada aceita; id nacional com CEP local / sem CEP
  / CEP forjado vs endereço recusa; opção local intocada; rollback → hash EXATO; idempotência.
- Front (Vitest): local grátis + nacional pago e o inverso; desconto (total enviado = preço do
  cache); promessas com alcance; tela admin nacional (salva só as colunas nacionais).
- `database.types.ts` atualizado à mão para as colunas.

## 8. Fora do escopo

Aplicar a migration em banco, publicar edge, merge. Configurador de etiquetas. Desconto em
opções além da mais barata. Estratégia por região/UF.
