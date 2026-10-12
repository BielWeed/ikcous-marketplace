# Painel simples — Onda I (banco): notas por frente

Manifesto: `docs/superpowers/lanes/2026-10-09-painel-simples-onda-i.json` (3 frentes disjuntas).
Valem as regras gerais de `2026-10-09-painel-simples-onda-f-notas.md`. Em todas as frentes:
`npm run typecheck; echo exit=$?`, `CI=true npm run lint:ratchet` (teto: eslint 409, biome 13, não usar
`ATUALIZAR_TETOS`), Biome formata, nenhum export muda de assinatura, `frente.mjs conferir` antes de commitar.
**Nunca aplicar migration em banco remoto** (publicação = `aplicar-migrations.yml`, decisão do dono).

## Decisões assumidas (escopo)

- Regra ÚNICA de estoque baixo: `estoque efetivo <= COALESCE(estoque_minimo, 5)`, sobre produto ativo e não
  apagado. Estoque efetivo = soma de `stock_increment` das variações ATIVAS se houver alguma; senão `produtos.estoque`.
  Produto com variações alerta pela SOMA (a mesma de `mappers.ts`, `precisaDeReposicao`, sino e analytics).
- "Lucro se vender tudo" soma valor de venda só de produto COM custo.
- Fora: I3 (endereço sem migration), I4, I5 (o UPDATE de `estoque_minimo` já passa), mínimo por variação,
  correção de `fin_*`/`crm__vendas`, qualquer publicação.

## Fatos medidos pelo planejador (cite arquivo:linha ao revisar)

- `get_admin_products_paged` nunca foi redefinida depois da baseline (`20260806…:1712-1781`); o `p.estoque <= 5`
  fixo está nas linhas 1736 e 1764 (ramo morto: ninguém passa `low`; o PDV passa `all`).
- Os KPIs "Dinheiro parado em estoque" / "Lucro se vender tudo" vêm de `get_admin_analytics_v2`
  (`20261199…:1754-1759`), lidos em `src/views/admin/AdminProductsView.tsx:323-328`.
- `painel_inicio` (`20261199…:1530-1606`) conta estoque baixo por variação com limiar 3 (linhas 1588-1596).
  Hash vigente do corpo: `ebcafff0ad5efbb70391a2cc93a14247`. `get_admin_analytics_v2`: `6abc7e44b0aae3b2e542e87daf055451`
  (ambos em `20261199…:230-231`). Nenhuma migration 20261200–20261210 redefine essas funções.
- O admin já faz `UPDATE vw_produtos_admin SET estoque_minimo` (grants 20261090:109-118, view 20261160:407-441
  com `WITH CASCADED CHECK OPTION`, policy `produtos_admin_update_policy` baseline:5715, único gatilho
  `set_ultima_atualizacao` só carimba data). Coluna `integer DEFAULT 5`, sem CHECK.
- Maior migration em TODAS as `origin/*`: `20261210000000`. Faixa desta onda: `20261212–20261219`
  (`20261211` fica de folga). O mural `~/.claude/mural/core_app_mkt/_REGRAS.md` não existe neste ambiente.

## Ambiente do Postgres efêmero (frentes 1 e 2)

O PG 16 do sistema NÃO serve (`20261090` usa `REVOKE … MAINTAIN`). O pacote `@embedded-postgres/linux-x64@17.9.0-beta.17`
baixa por `npm pack` pelo proxy; precisa dos symlinks de `native/pg-symlinks.json` e de `runuser -u postgres` para o
`initdb` (o agente é root). Em sessão anterior o `initdb`/`pg_ctl start` foi **negado pelo sistema de permissões** —
se for negado de novo, NÃO contorne: commite as provas e diga no relatório que a prova viva fica para o `rpc-ci.yml`
(Postgres 17) no PR. Portas: frente 1 → 5433, frente 2 → 5434 (cada uma com o seu datadir; nunca 5432).

```
runuser -u postgres -- <pkg>/native/bin/initdb -D <dados> -U postgres --auth=trust -E UTF8
runuser -u postgres -- <pkg>/native/bin/pg_ctl -D <dados> -o "-p 5433 -k <dados>" -l <log> -w start
export DATABASE_URL=postgres://postgres:postgres@localhost:5433/postgres CI_BANCO_EFEMERO=1
node tests/banco/provisionar.cjs
node tests/banco/aplicar-migrations.cjs supabase/migrations
node tests/banco/rodar-isolado.cjs tests/banco/<prova>.cjs
```
Prova dupla (datadir novo): `node scripts/ci/banco/provisionar-efemero.cjs && node scripts/ci/banco/aplicar-migrations.cjs supabase/migrations && node scripts/ci/banco/prova-dupla-aplicacao.cjs supabase/migrations`.
Deno não está no PATH: `npx --yes deno@2 test --allow-all --no-check --sloppy-imports <arquivo>` para os testes estáticos `tests/migration_*_test.ts`.

## Frente 1 — `banco-estoque-e-inventario` (RISCO; opus; serial por dentro: 1.1 → 1.5)

Cada migration: número próprio, sem `BEGIN`/`COMMIT`, cabeçalho de 8 itens (molde
`20261150000000_a_loja_declara_a_sua_configuracao_publica.sql`), `CREATE OR REPLACE` com o corpo vigente
**byte a byte** menos o trecho que muda, preflight por md5 no padrão de `20261199:183-260`
(`md5(replace(prosrc, E'\r',''))` = hash vigente OU hash desta, senão `RAISE 'B1_BASELINE_DIVERGENT: …'`), e
`rollback-manual-<número>_<nome>.sql` irmão com preflight que exige o hash desta e devolve o corpo anterior byte a byte.
`CREATE OR REPLACE` preserva dono e ACL: nenhum GRANT/REVOKE. Assinatura igual → `database.types.ts` não muda.
Os rollbacks destas migrations vêm ANTES do rollback da 20261199 (o dela recusa se houver outra redefinição:
`rollback-manual-20261199…:93`); diga isso no cabeçalho.

- **1.1 `20261212000000_o_inicio_conta_estoque_baixo_pela_regra_da_loja.sql`** — `painel_inicio()`; troque só as
  linhas 1588-1596 por:
  ```sql
        'estoque_baixo', (SELECT count(*)
                            FROM public.produtos p
                            LEFT JOIN LATERAL (
                              SELECT count(*) FILTER (WHERE pv.active) AS qtd_ativas,
                                     sum(COALESCE(pv.stock_increment, 0)) FILTER (WHERE pv.active) AS soma_ativas
                                FROM public.product_variants pv
                               WHERE pv.product_id = p.id
                            ) v ON true
                           WHERE p.deleted_at IS NULL AND p.ativo = true
                             AND CASE WHEN COALESCE(v.qtd_ativas, 0) > 0 THEN COALESCE(v.soma_ativas, 0)
                                      ELSE p.estoque END
                                 <= COALESCE(p.estoque_minimo, 5))
  ```
  TDD (escreva e veja falhar primeiro):
  1. `tests/migration_o_inicio_conta_estoque_baixo_pela_regra_da_loja_test.ts` (molde
     `tests/migration_portas_do_painel_exigem_admin_atual_test.ts:38-86`): `avaliarFase0` não recusa;
     `detectarTransacaoExplicita` vazio nos dois arquivos; o corpo novo é o da 20261199 com SÓ o trecho do
     `estoque_baixo` diferente; o preflight cita o md5 REAL dos dois corpos; o rollback devolve o md5 vigente;
     `COALESCE(p.estoque_minimo, 3)` sumiu.
  2. `tests/banco/estoque-baixo-uma-regra-viva.cjs` (por delta): A sem variação, estoque 4, mínimo NULL → baixo;
     B estoque 5, NULL → baixo (borda); C estoque 6, NULL → não; D estoque 8, mínimo 10 → baixo; E estoque 1,
     mínimo 0 → não; F variações ativas 0 e 10 → NÃO (soma 10; a regra antiga contava); G ativas 2+2 e uma
     inativa 50 → baixo (soma 4); H inativo com 0 → não; I `deleted_at` → não. Afirme:
     `painel_inicio()->'pendencias'->>'estoque_baixo'` = `get_admin_analytics_v2(90)->>'inventoryAlerts'` = a fórmula
     do front (copie `precisaDeReposicao`, `src/utils/avisos-do-lojista.ts:70-75`) = +4. Controle: com o corpo antigo
     (aplicado pelo rollback na transação) o Início dá outro número. Reaplicar 2× deixa a impressão digital igual;
     preflight sobre corpo divergente recusa sem escrever; rollback volta ao md5 da 20261199; `prosecdef`,
     `proconfig`, `proacl` iguais antes/depois; cliente comum recusado com 42501. Login como admin: molde
     `tests/banco/crm-inicio-viva.cjs:37-41` e `admin-atual-portas-viva.cjs`.
- **1.2 Adaptar as provas que fixam a 20261199** (senão o `rpc-ci` fica vermelho):
  - novo `tests/banco/sucessoras-da-99.cjs`: lista as migrations que redefinem corpo da 99 (`20261212`, `20261214`);
    exporta `desfazerSucessorasDa99(c)` (aplica os rollbacks na ordem inversa, cada um só se o hash "desta" estiver no ar).
  - `admin-atual-portas-viva.cjs`: chamar no início, no clone (quebram: prova (3) "42 corpos DESTA" `:1105-1123`,
    reaplicar a 99 `:1125-1138`, rollback `:1140+`); prova nova: reaplicar 12 e 14 por cima volta ao estado da árvore.
  - `admin-atual-viva.cjs`: chamar no começo de `desfazerPosterioresNaTransacao` (`:287`) e dentro de `desfazer(i)`
    (`:1336`) antes do rollback da 99 (índice 2). NÃO reordenar `POSTERIORES_A_97` (`:247-283`; endereçado por índice).
  - `pagamentos-rpc-viva.cjs`: acrescentar as duas sucessoras no INÍCIO de `POSTERIORES_A_97` (`:1671-1703`).
  - `tests/front/pedidos-para-preparar.test.ts`: `MIGRATION_DO_INICIO` (`:23`) e `readFileSync` (`:25-31`) apontam a
    20261212; o teste "nenhuma migration mais nova redefine `pedidos_para_preparar`" (`:193-213`) precisa de ajuste
    honesto (a 20261212 copia o corpo inteiro). As listas não mudam.
  - novo `tests/front/inicio-estoque-baixo-mesmo-limiar.test.ts`: lê a migration mais nova que define
    `painel_inicio` (molde `dashboard-diz-o-que-falta-para-vender.test.tsx:532-638`, guarda de 14 dígitos e "não é
    rollback") e afirma que o N de `COALESCE(p.estoque_minimo, N)` = `LIMIAR_PADRAO_DE_ESTOQUE`.
- **1.3 `20261213000000_o_filtro_de_estoque_baixo_do_admin_segue_a_regra.sql`** — `get_admin_products_paged(text,text,text,text,integer,integer)`;
  corpo em `baseline:1716-1780` (`plpgsql SECURITY DEFINER SET search_path TO 'public','extensions'`, mesmos nomes de
  parâmetro e defaults). **Preserve espaços no fim de linha** (`baseline:1750`, `SELECT `): o md5 pega. Hash vigente:
  calcule do texto da baseline. Troque só as linhas 1736 e 1764 por:
  ```sql
  AND (p_stock = 'all' OR (p_stock = 'low' AND (CASE WHEN EXISTS (SELECT 1 FROM public.product_variants pv WHERE pv.product_id = p.id AND pv.active) THEN (SELECT COALESCE(sum(COALESCE(pv.stock_increment, 0)), 0) FROM public.product_variants pv WHERE pv.product_id = p.id AND pv.active) ELSE p.estoque END) <= COALESCE(p.estoque_minimo, 5)))
  ```
  NÃO acrescente `is_admin_atual` (é catálogo; a 99 deixou de fora de propósito, `20261199:57`). Teste estático
  `tests/migration_o_filtro_de_estoque_baixo_do_admin_segue_a_regra_test.ts`; a prova viva 1.1 ganha
  `get_admin_products_paged('', 'all', 'active', 'low', 0, 100)->>'total_count'` = +4; confira que `p_stock='all'` e a busca
  com acento devolvem o mesmo de antes.
- **1.4 `20261214000000_o_lucro_do_estoque_so_conta_produto_com_custo.sql`** — `get_admin_analytics_v2(integer)`
  (`20261199:1609-1881`, `SECURITY DEFINER SET search_path TO 'public'`, sem STABLE). Troque só a linha 1757 por
  `COALESCE(SUM(preco_venda * estoque) FILTER (WHERE custo IS NOT NULL), 0)` (comentário de uma linha com o motivo, se quiser).
  Nenhuma chave JSON muda; `low_stock_count` e `COALESCE(estoque_minimo, 5)` ficam. Único consumidor de `totalValue`:
  `AdminProductsView.tsx:324`. Testes: estático `tests/migration_o_lucro_do_estoque_so_conta_produto_com_custo_test.ts`;
  viva `tests/banco/inventario-so-com-custo-viva.cjs` (P1 custo 10/preço 25/estoque 2; P2 custo NULL/preço 100/estoque 3;
  P3 custo 5/preço 20/variações ativas 1+1; por delta: `totalCost`=30, `totalValue`=90 — o corpo antigo dá 390 —,
  `inventoryAlerts` igual ao antigo, conjunto de chaves do JSON idêntico). Acrescente a 20261214 em `sucessoras-da-99.cjs`.
  Em `tests/front/dashboard-diz-o-que-falta-para-vender.test.tsx:597-601` o texto "a definição VIVA é … 20261199000000"
  passa a dizer 20261214; as guardas de `:625-638` continuam valendo (exigem o literal `COALESCE(estoque_minimo, 5)`).
- **1.5 Rótulos em `src/views/admin/AdminProductsView.tsx`**: `subValue` "Capital Líquido" (`:357`) → "Pelo custo cadastrado";
  "Margem Bruta" (`:368`) → "Só produtos com custo"; na ajuda (`:976-980`, `:1000-1003`) acrescente "Produtos sem custo
  cadastrado ficam de fora da conta." Não mexa em classes (régua visual). Teste novo
  `tests/front/admin-products-lucro-so-com-custo.test.tsx`.
- **Prova do par e verificação:** `node scripts/db-prove-rollback.cjs supabase/migrations/<cada>.sql` (precisa de
  `DATABASE_URL`); TODAS as provas do `rpc-ci`:
  `for f in $(grep -o 'tests/banco/[a-z0-9-]*\.cjs' .github/workflows/rpc-ci.yml | sort -u | grep -v 'provisionar\|aplicar-migrations\|rodar-isolado'); do node tests/banco/rodar-isolado.cjs $f || echo "FALHOU $f"; done`
  mais as duas novas; `npx vitest run tests/front/pedidos-para-preparar.test.ts tests/front/dashboard-diz-o-que-falta-para-vender.test.tsx tests/front/inicio-estoque-baixo-mesmo-limiar.test.ts tests/front/admin-products-lucro-so-com-custo.test.tsx tests/front/estoque-baixo-um-limiar.test.ts tests/front/regua-visual-do-painel.test.ts`; typecheck; lint:ratchet.
- **Riscos:** copiar o corpo com 1 byte de diferença (o md5 amarra); provas antigas que quebram com corpo novo (rodar
  o `rpc-ci` inteiro); rollback na ordem errada é recusado de propósito; `estoque`/`ativo` NULL: a SQL não conta, o front
  trata como 0/ativo — resíduo declarado (o app nunca grava NULL).
- **NÃO fazer:** editar a 20261199 ou qualquer migration existente; BEGIN/COMMIT; tocar `database.types.ts`,
  `rpc-ci.yml`, `tests/banco/LEIA-ME.md`, `tests/ci_conferir_banco_test.ts` (compartilhados → PEDIDO); mudar
  `low_stock_count`/chaves do JSON; `npm install`; aplicar em remoto.

## Frente 2 — `provas-de-leitura` (RISCO dinheiro, só leitura; sem migration)

- **`tests/banco/receita-uma-regua-viva.cjs` (I2)** — semente tudo pago "agora" (cai no mês mesmo no dia 1):
  1 online PIX pago 100; 2 balcão `recebido_na_entrega`/`presencial` 50; 3 entrega paga na hora (`cash`,
  `delivered`, `recebido_na_entrega`) 30; 4 PIX expirado 70; 5 online pago depois estornado 40
  (`estorno_manual_registrado_em` agora); 6 pago depois de expirar (`status cancelled`, `pago_apos_expirar`) 20.
  Prefira os caminhos reais (`expirar_pedidos_vencidos()`, `confirmar_pagamento` como `service_role`,
  `registrar_venda_presencial`, `registrar_pagamento_recebido`, `registrar_estorno_manual`); se um exigir contexto
  que o efêmero não emula, use INSERT do estado final (como `crm-inicio-viva.cjs:49-60`) e diga qual. Mede, por delta:
  `painel_inicio()->'mes'->>'receita'`; `crm_visao(início_do_mês, hoje)->'kpis'->>'receita'` e a soma de
  `crm__vendas(now())` no mês; `fin_resumo(início_do_mês, hoje)->'por_canal'` (online + presencial) e `entradas`/`saidas`.
  Previsão lendo o código (o teste confirma ou desmente): Início = CRM = **180** (casos 1+2+3); vendas do
  Financeiro = **240** (inclui 5 e 6). Achado A: `fin__movimentos` conta a venda `estornado` como entrada bruta com
  saída separada (`20261177:333-336`, `385-400`) e `crm__vendas` exclui `estornado` (`20261178:59`). Achado B:
  `pago_apos_expirar` mantém `status cancelled` (`20261195:242-248`; expiração grava `cancelled`, `20261186:57-58`),
  `crm__vendas` exclui `cancelled` (`20261178:60`), o Financeiro não filtra status. Forma: **caracterização** — afirma
  a igualdade nos casos limpos e as duas divergências conhecidas com valor exato, imprimindo `ACHADO A/B`; falha só em
  divergência NÃO prevista; imprime como informação a quarta régua (`get_admin_analytics_v2.month` = janela móvel de
  30 dias por `created_at`, `20261199:1693-1698`). **Não corrigir nada.**
- **`tests/banco/estoque-minimo-editavel-viva.cjs`** — como admin (`authenticated` + claims + `profiles.role=admin`):
  `UPDATE public.vw_produtos_admin SET estoque_minimo = 7 … RETURNING` dá 7; `= NULL` dá NULL;
  `UPDATE public.produtos SET estoque_minimo = 2` (caminho offline) passa; `INSERT` por `vw_produtos_admin` com
  `estoque_minimo` NULL dá NULL e sem a coluna dá 5. Cliente: 0 linhas ou erro, sem gravar. `anon`: `permission denied`.
- Riscos: semente fora do mês na virada (use "agora"); confundir `por_canal` com `entradas` (que também conta manual e
  suprimento). **NÃO fazer:** migration; corrigir `fin_*`/`crm__vendas`; tocar `rpc-ci.yml`/`LEIA-ME`.

## Frente 3 — `estoque-minimo-no-produto` (ROTINA, front, sem migration)

- `src/views/admin/AdminProductFormView.tsx`: `ProductFormFields` (`:287+`) ganha `estoqueMinimo: string`; estados
  iniciais `""` (`~:400`, `~:423`, `~:833`); carga (`~:755`) `product.estoqueMinimo == null ? "" : String(…)`;
  rascunhos (`~:789-835`, `~:871-890`) levam o campo; `productData` (`~:1882-1900`, regra da casa de `:1870-1880`:
  vazio vira `null`): `estoqueMinimo` = `null` se vazio, senão `Math.max(0, Math.trunc(n))`; texto inválido vira erro
  do campo, nunca NaN. Campo novo na `SecaoRecolhivel` "Avançado" (`:4324-4423`): rótulo "Avisar quando o estoque
  chegar a", ajuda "Vazio usa o padrão (5). Com variações, vale para a soma.", mesmo componente dos vizinhos
  (`LocalBufferedInput`), `type=number`, `min=0`, `step=1`, `id product-estoque-minimo`, texto ≥ 11px; `resumo` da
  seção → "Código interno, código de barras e aviso de estoque".
- `src/hooks/useProducts.ts`: `if (updates.estoqueMinimo !== undefined) dbUpdates.estoque_minimo = updates.estoqueMinimo;`
  no update online (`:1091-1128`) e na fila offline (`:137-166`); no insert (`:876-904`)
  `...(productData.estoqueMinimo !== undefined ? { estoque_minimo: productData.estoqueMinimo } : {})`. NÃO mexer no
  comentário de `:703-709` (vai como pedido). Use `??`, nunca `||` (zero é escolha do lojista, `avisos-do-lojista.ts:66-69`).
- TDD: `tests/front/produto-estoque-minimo.test.tsx` (campo no Avançado; produto com 8 mostra 8; vazio envia `null`;
  "7" envia 7; negativo e decimal não passam; rascunho preserva) e
  `tests/front/use-products-estoque-minimo-percorre-o-caminho.test.tsx` (moldes
  `use-products-codigo-de-barras-percorre-o-caminho.test.tsx`, `produto-sem-custo-grava-nulo-nao-zero.test.tsx`: número e
  `null` chegam ao `dbUpdates` online e offline; `undefined` não chega; no insert `null` vai e `undefined` não).
- Verificação: os 2 testes novos; `npx vitest run $(rg -l "AdminProductFormView|useProducts" tests/front | tr '\n' ' ')`;
  `regua-visual-do-painel` e `painel-sem-jargao`; typecheck e lint:ratchet. Teste antigo que confere o payload inteiro:
  só acrescente a chave nova. **NÃO fazer:** migration; tocar `src/types/*` (o tipo já existe).

## Pedidos ao integrador (orquestrador, depois das frentes)

1. Num mesmo commit (`tests/migration_a_contestacao_decide_sob_a_trava_do_pedido_test.ts:375-445` exige lista = YAML):
   4 passos novos em `.github/workflows/rpc-ci.yml` via `rodar-isolado` (`estoque-baixo-uma-regra-viva`,
   `inventario-so-com-custo-viva`, `receita-uma-regua-viva`, `estoque-minimo-editavel-viva`), os mesmos 4 em
   `PROVAS_DO_DINHEIRO`, entradas em `tests/banco/LEIA-ME.md`. Esse commit toca o mapa de risco → `revisor-risco`.
2. Depois da 20261213: o comentário de `src/hooks/useProducts.ts:703-709` deixa de dizer "`p.estoque <= 5` fixo".
3. Fim da onda: typecheck, `npm test` (Deno), lint:rapido, lint:ratchet e o `rpc-ci` inteiro.

## Onda I-b (depois; antes de qualquer release)

`publicar-release.mjs` bloqueia migration nova sem lote em `scripts/frota/canais-de-backend.json`; depois do apply a
consulta `scripts/publicacao/consultas/8e-conferir-92-a-202-aplicado.sql` (linhas 64 e 76 fixam os hashes da 99) fica
negativa para `painel_inicio` e `get_admin_analytics_v2`. Frente própria cria o lote 17 (consultas 17a/17b, `conferir-banco.cjs`,
`publicar-release.mjs`, workflow, testes, 8e aceitando o sucessor, runbook). Depende do texto final das migrations.

## Perguntas ao dono

1. Produto com variações alerta pela soma (assumido) ou por variação? Por variação exige mínimo por variação (coluna nova,
   outra migration de RISCO).
2. Depois da I2: o pedido cancelado com pagamento (`pago_apos_expirar`) e a venda estornada ficam fora de "Vendas pagas" no
   Início mas entram brutos nas entradas do Financeiro. Recomendado manter o Início; qualquer alinhamento é spec própria
   (`fin_*`).
