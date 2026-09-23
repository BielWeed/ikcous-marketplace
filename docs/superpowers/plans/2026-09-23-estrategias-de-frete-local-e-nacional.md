# Plano — estratégias de frete local e nacional (23/09/2026)

Desenho: `docs/superpowers/specs/2026-09-23-estrategias-de-frete-local-e-nacional-design.md`
(rev. 2, aprovado pelo dono). Branch `feat/local-national-shipping-strategies-20260923`.

## CONTRATO FIXO ENTRE AS PEÇAS (nenhum executor muda isto sozinho)

### Colunas (`store_config`, migration `20261171000000_o_frete_nacional_ganha_estrategia_propria.sql`)
| coluna | tipo | default | CHECK |
|---|---|---|---|
| `national_shipping_strategy` | text NOT NULL | `'desligado'` | in (`desligado`,`acima_de_valor`,`sempre`,`por_produto`,`desconto_na_mais_barata`) |
| `national_shipping_min` | numeric(10,2) NOT NULL | `0` | `>= 0` |
| `national_discount_type` | text NULL | — | in (`percentual`,`fixo`) |
| `national_discount_value` | numeric(10,2) NOT NULL | `0` | `>= 0` |
| `national_benefit_scope` | text NOT NULL | `'mais_barata'` | in (`mais_barata`,`todas`) |

CHECK de linha: `strategy='acima_de_valor' ⇒ min > 0`; `strategy='desconto_na_mais_barata' ⇒
type IS NOT NULL AND value > 0 AND (type='fixo' OR (value <= 100 AND value = trunc(value)))`.

Cópia legada, SÓ quando `national_shipping_strategy` ainda não existe (bloco DO com
`information_schema.columns` antes do ADD): `free_shipping_min` NULL/0 → `desligado`;
`= 0.01` → `sempre`,`todas`; `< 0` → `por_produto`,`todas`; `> 0` (e ≠ 0.01) →
`acima_de_valor`, min = free_shipping_min, `todas`.

**Espelho legado** (usado pela RPC e pela edge quando falta dado): o que a cópia produziria a
partir do `free_shipping_min` ATUAL. "Config atual é o espelho" ⇔ strategy = espelho.strategy
AND (strategy <> 'acima_de_valor' OR min = free_shipping_min) AND (strategy = 'desligado' OR
scope = 'todas') AND type IS NULL.

### Front (`StoreConfig` em `src/types/index.ts`)
`nationalShippingStrategy: 'desligado'|'acima_de_valor'|'sempre'|'por_produto'|'desconto_na_mais_barata'`,
`nationalShippingMin: number`, `nationalDiscountType: 'percentual'|'fixo'|null`,
`nationalDiscountValue: number`, `nationalBenefitScope: 'mais_barata'|'todas'`.
Ausentes no banco (antes da migration) ⇒ o StoreContext preenche com o ESPELHO legado.

### Opção nacional (JSON da edge e do `shipping_quotes_cache.options[]`)
Campos novos em toda opção NACIONAL (não em `local-delivery`/`store-pickup`):
- `price`: preço FINAL (já com grátis/desconto) — é o que a RPC cobra.
- `precoCheio`: preço da transportadora antes da estratégia.
- `estrategiaNacional`: `{ "estrategia": text, "minimo": number, "tipoDesconto": text|null,
  "valorDesconto": number, "alcance": text }` = as 5 colunas lidas no instante da cotação.
- `subtotalCotacao`: number — o subtotal (preços do BANCO) com que a regra foi aplicada
  (EMENDA pós-revisão T1, 23/09). Vai em toda opção carimbada.

EMENDA (revisão T1): na RPC, (a) carimbo que não é objeto JSON completo (null, `{}`, campo
faltando) = DIVERGENTE (`IF NOT COALESCE((...), false)`); (b) com estratégia `acima_de_valor`
ou `desconto_na_mais_barata` e mínimo > 0: se `(v_calculated_subtotal >= minimo)` difere de
`(subtotalCotacao >= minimo)` — ou `subtotalCotacao` ausente — recusa
`FRETE_COTACAO_DESATUALIZADA` (a cliente recota e a edge aplica a regra com o subtotal de agora).
Espelho legado de `desligado` na edge: alcance `mais_barata` (igual ao default do banco).

### Regra nacional (edge, fonte ÚNICA do preço)
subtotal = Σ preço do BANCO (`price_override` da variação, senão `preco_venda`) × quantidade.
Beneficiadas = todas as nacionais (alcance `todas`) ou só as de MENOR `precoCheio` (empate: todas).
- `desligado` → cheio. `sempre` → 0 nas beneficiadas. `por_produto` (algum item `frete_gratis`)
  → atalho `free-shipping-promo` R$ 0 (como hoje, sem cotar). `acima_de_valor` (subtotal ≥ min)
  → 0 nas beneficiadas.
- `desconto_na_mais_barata` (subtotal ≥ min; min 0 = sempre) → só nas de menor cheio, em
  CENTAVOS inteiros: `percentual`: `cheioC − Math.round(cheioC × pct / 100)`; `fixo`:
  `cheioC − min(valorC, cheioC)`. Nunca < 0.
- Revisão (`calcularRevisaoConfig`) inclui as 5 colunas SÓ se existirem na leitura.
- Leitura das colunas: consulta separada tolerante; falhou/ausente ⇒ espelho legado.

### Regra na RPC (`create_marketplace_order_v23/_v24`, bloco 4 + 2-ter)
- `local-delivery`/`store-pickup`: regra LOCAL exatamente como hoje (free_shipping_min).
- Nacional (qualquer outro id):
  1. CEP de entrega conhecido e NÃO local (`is_local_cep` false) — senão
     `'Opção de entrega inválida. Volte ao carrinho e escolha uma entrega válida.'`.
     Com `p_address_id` de conta: CEP do `user_addresses` tem de bater com `p_address_data.cep`
     quando este vier (mesma frase de "cotado para outro CEP" do 2-bis).
  2. `free-shipping-promo`: aceito sem cache SÓ se strategy = `por_produto` e há item marcado
     (frete 0); senão recusa como opção inválida.
  3. Demais ids: SEMPRE pela linha do cache (mesmo SELECT de hoje, + `opt->'estrategiaNacional'`).
     - carimbo presente e igual às 5 colunas atuais ⇒ frete = `price` da opção.
     - carimbo presente e diferente ⇒ `FRETE_COTACAO_DESATUALIZADA: ...`.
     - carimbo AUSENTE (edge velha) ⇒ aceito só se a config atual é o ESPELHO legado; então
       frete = regra legada (se a regra de `free_shipping_min` bate: 0; senão `price`). Config
       não-espelho ⇒ `FRETE_COTACAO_DESATUALIZADA`.
  4. Checagem `_revisao` da 20261170 permanece.

### Arquivos por peça (escrita disjunta)
- **T1 banco**: `supabase/migrations/20261171000000_*.sql`, `supabase/migrations/rollback-manual-20261171000000_*.sql`,
  `scripts/db-apply.cjs` (só a entrada VERIFICACOES), `tests/frete-estrategias-database/**`,
  `src/types/database.types.ts`, testes de mapa existentes que a migration exigir.
- **T2 edge**: `supabase/functions/calculate-shipping/**`.
- **T3 front núcleo**: `src/types/index.ts` (StoreConfig + ShippingOption), `src/contexts/StoreContext.tsx`,
  `src/lib/realtimeSyncEngine.ts`, `src/lib/estrategias-de-frete.ts` (novo), `src/lib/presets-de-frete-gratis.ts`,
  `src/contexts/CartContext.tsx`, `src/components/ui/custom/ShippingCalculator.tsx`,
  `src/views/customer/CheckoutView.tsx`, `src/views/customer/CartView.tsx`, `src/lib/economia-do-frete.ts`,
  `src/hooks/useEconomiaDoFreteExibida.ts`, `src/lib/auto-selecao-de-frete.ts`, `src/lib/destaques-do-frete.ts`,
  selos/banners (`ProductCard`, `PremiumOffers`, `ProductView`, `SearchView`, `FavoritesView`, `ProductList`,
  `ProductCarousel`, `FreeShippingBlock`, `ShippingProgress`, `CartReminder`), `src/utils/regra-de-frete.ts`, `tests/front/**` desses.
- **T4 admin** (depois do T3): `src/views/admin/AdminShippingView.tsx` (só frete grátis + botão), `src/components/admin/shipping/FreteGratisBloco.tsx`,
  `FreteNacionalBloco.tsx`, `src/views/admin/AdminShippingNationalView.tsx` (novo), roteador (skill `nova-tela`), `tests/front/admin-*`.
  NÃO tocar `EtiquetasEnvioCard` nem a montagem dele.
- **T5**: verificação integral (typecheck, 3 suítes, build, lint:ratchet, ensaio de banco) + `diretor`.

Travas em todo executor: nunca `git stash/checkout/restore/clean/reset`; NÃO commitar (a hub
commita após revisão); nunca aplicar SQL em banco real, nunca `supabase db push`, nunca deploy.
