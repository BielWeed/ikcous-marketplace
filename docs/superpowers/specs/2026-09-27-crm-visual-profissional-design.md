# Dashboard CRM com cara de produto profissional (27/09/2026)

## O pedido

O Gabriel testou o preview do PR #666 e disse, sobre o Dashboard CRM (`admin-crm`):

- "isso aí é botão e nem parece que é botão": abas, chips de período e a grade de segmentos
  parecem texto solto;
- a aba Canais, com só "Loja física", está "simples demais, estranha, faltando informação";
- o Funil e pedidos "precisa ficar bem melhor";
- "tem que ser um dashboard de CRM profissional, todas essas telas. Profissional nem sempre é
  mais informação, e sim qualidade: layout visual."

Escopo: **só front**. Não muda RPC, migration, tipo de dado nem o que cada número significa.
Toda informação nova sai do que `crm_visao`/`crm_clientes` já devolvem.

## Diagnóstico (prints do dono, 873 px de largura)

1. **Nada se destaca do fundo.** `admin-glass` é `bg-zinc-950/40` sobre `#09090b`, e as bordas
   são `white/5`. Cartão, botão e fundo ficam da mesma cor, então nada parece clicável.
2. **Abas:** só a escolhida tem fundo. As outras são texto cinza solto.
3. **Período:** a borda `white/10` some no fundo. Parecem seis palavras soltas.
4. **Segmentos RFM:** 10 blocos sem superfície visível. São botões de filtro, mas parecem uma
   tabela de números. Nove deles mostram "0 / R$ 0,00" com o mesmo peso do que tem cliente.
5. **Canais:** um cartão sozinho ocupa meia largura; o outro canal some quando está zerado, e
   aí não há comparação ("100%" de quê?). Os títulos são rótulos de 10 px em caixa alta.
6. **Funil:** "Visitas —" e "Produtos vistos — —" viram barras vazias com traço. O
   "650% do passo anterior" aparece porque carrinhos contam *pessoas* e pedidos contam
   *pedidos*: unidades diferentes. Um funil nunca deve mostrar mais de 100%.
7. **Pedidos por status** não depende do período (é a fila de agora), mas fica abaixo do
   seletor de período sem dizer isso.

## Princípios

1. **Superfície visível.** Todo cartão tem fundo e borda que se destacam do `#09090b`
   (`SUPERFICIE_DO_CRM`). Todo clicável tem superfície própria, hover, `focus-visible` e, quando
   leva a outro lugar ou filtra, um ícone de affordance (chevron, funil) (`CLICAVEL_DO_CRM`).
2. **Controle parece controle.**
   - As abas ficam num trilho segmentado (fundo + borda, e a escolhida em destaque).
   - O período vira um controle próprio: trilho menor com os seis períodos, ou um botão
     "Últimos 30 dias ▾" que abre a lista no celular. Em qualquer caso, a tela mostra as datas
     do intervalo ("28 ago – 27 set") e contra o que compara.
3. **Hierarquia tipográfica de produto.**
   - Título de cartão em frase normal, 14 px, semibold, branco, com uma linha de descrição
     cinza que diz o que o cartão responde.
   - O rótulo de 10 px em caixa alta com tracking largo fica só para rótulo de número (KPI).
   - Números com `tabular-nums`, e o valor principal grande.
4. **Zero não compete com dado.** Segmento, canal ou forma zerados ficam visualmente
   secundários (opacidade/tons), mas presentes quando dão contexto: os dois canais aparecem
   sempre.
5. **Nunca mostrar número sem sentido.**
   - Etapa não medida não vira barra com "—": vira uma nota.
   - Conversão só entre etapas da mesma unidade, e nunca acima de 100%.
6. **Cada cartão responde uma pergunta e, quando cabe, oferece uma ação.** Exemplos: "13
   pedidos criados não viraram venda paga — Ver pedidos"; "Nenhuma venda pelo app neste
   período".
7. **Mobile primeiro (375 px), e desktop de verdade (≥ 1024 px).** No desktop, grade de 2
   colunas onde fizer sentido; no celular, nada estoura e nada fica espremido.
8. **Identidade do painel mantida:**
   - fundo `#09090b`;
   - dourado `admin-gold` como cor de seleção e ação;
   - verde/âmbar/vermelho semânticos;
   - app = sky, loja física = violet (a mesma cor do "Hoje" do Início);
   - o título "DASHBOARD CRM" do `AdminPageHeader` continua.

## Peças compartilhadas (`src/components/admin/crm/PecasDoCrm.tsx`)

- `FOCO_DO_CRM`: anel de foco dourado visível no teclado.
- `SUPERFICIE_DO_CRM`: cartão que se destaca do fundo.
- `CLICAVEL_DO_CRM`: superfície de linha, bloco ou chip clicável dentro de cartão.
- `CartaoDoCrm`: `<section>` com título, descrição, ação à direita e `aria-labelledby`.
- `EstadoVazioDoCrm`: título, texto e ação opcional.

Toda aba usa essas peças. Estilo novo que se repete em duas abas vira peça aqui.

## Por aba

### Casca (`AdminCrmView`)

- Abas num trilho segmentado. Mantém o padrão WAI-ARIA atual (tablist, setas, Home/End) e o
  alvo de toque ≥ 44 px.
- Período com `aria-pressed` (ou `listbox`, se virar menu), mostrando o intervalo em datas e a
  comparação.
- A barra fixa continua fixa.

### Visão geral

- Os 8 KPIs usam `SUPERFICIE_DO_CRM`, com o valor grande e a variação em chip colorido
  (▲ verde / ▼ vermelho / = cinza). O "Ver clientes em risco" parece link de ação.
- O bloco "Histórico completo da loja" (componentes antigos de `components/admin/dashboard/`)
  continua com os mesmos componentes. Só o cabeçalho da seção e o espaçamento se alinham à
  hierarquia nova.
- **Atualização (rodadas 3 e 4 da conferência visual, 27/09):** os 4 componentes legados do
  Histórico (`KpiSummaryCards`, `OperationalPerformanceChart`, `StrategicIntelligenceBlocks`,
  `TopProductsList`) FORAM reestilizados — só classe/estrutura de apresentação (superfície
  `SUPERFICIE_DO_CRM`, título em frase normal 14px semibold, sem itálico/gradiente/caixa alta
  espaçadíssima), nenhum dado, cálculo ou texto que os testes procuram mudou. As duas barras
  de participação por item (o rastro de fundo quase invisível e a barrinha ao lado de
  "X vendas", proporcionais ao produto #1) saíram do "Top 5 produtos mais lucrativos" — não
  traziam número novo (a receita já aparece por extenso à direita de cada linha) e eram a
  última peça do visual antigo (glow/gradiente) sobrevivendo ali.

### Clientes

- "Segmentos RFM" vira `CartaoDoCrm`, com uma descrição de uma linha: "Agrupa quem compra por
  quando comprou, quantas vezes e quanto gastou. Toque para filtrar a lista."
- Os segmentos se agrupam em 3 faixas com cabeçalho curto:
  - **Melhores**: campeões, leais, ativos, novos, promissores;
  - **Atenção**: precisam de atenção, quase dormindo;
  - **Perdendo**: em risco, não pode perder, hibernando.
- Cada segmento é um bloco com `CLICAVEL_DO_CRM`, com:
  - ponto de cor, rótulo, número grande e receita;
  - um ícone que indica o filtro;
  - estado escolhido com anel dourado e check;
  - segmento com 0 clientes em tom secundário, ainda clicável.
- Uma linha de filtro ativo ("Mostrando: Em risco · 2 — Limpar") substitui o "Todos · 1" solto.
- Na lista de clientes:
  - no desktop, cabeçalho de colunas alinhado às linhas (cliente, segmento, pedidos, receita,
    última compra, canal, ações);
  - no celular, cartão.
  - WhatsApp e "Ver cliente" parecem botões.

### Canais

- No topo, um resumo do período: total vendido, pedidos e ticket médio, com a variação contra
  o período anterior. Sai de `kpis`.
- Cartão "App × loja física":
  - uma barra empilhada com legenda;
  - os **dois canais sempre**, lado a lado, cada um com receita, % da receita, pedidos, % dos
    pedidos e ticket médio (e se o ticket está acima ou abaixo do geral);
  - canal zerado: "Nenhuma venda pelo app neste período", em tom secundário.
- Cartão "Formas de pagamento":
  - ícone por forma (PIX, dinheiro, crédito, débito, online);
  - receita, %, pedidos e ticket médio derivado (receita ÷ pedidos);
  - barra na cor da forma.
- Desktop com 2 colunas. A leitura principal (qual canal vende mais, qual forma domina) cabe
  numa frase no topo de cada cartão.

### Funil e pedidos

- "Funil do app":
  - só as etapas medidas. As não medidas (hoje, visitas e produtos vistos) viram uma nota:
    "Visitas e produtos vistos ainda não são medidos";
  - etapas com unidade escrita ("pessoas com carrinho", "pedidos criados", "pedidos pagos");
  - taxa entre etapas só quando a unidade é a mesma e o valor fica ≤ 100%;
  - destaque principal para "vendas pagas ÷ pedidos criados" ("Conversão em venda" — não mais
    "taxa de pagamento", achado da revisão: um pedido pago e depois estornado/cancelado sai
    das vendas pagas mas continua contado em pedidos criados, e "taxa de pagamento" ficava
    falsa nesse caso), com ação quando há pedido criado sem venda paga: "N pedidos criados não
    viraram venda paga — Ver pedidos".
- "Pedidos em aberto agora":
  - diz que não depende do período;
  - cada status é uma linha clicável com ícone/cor do status, quantidade e idade do mais
    antigo;
  - pedido parado vira um selo âmbar ("parado há 81 dias");
  - leva a Pedidos.

## Restrições

- Nenhuma dependência nova. Painel ≤ 450 kB no portão (`npm run build && npm run size`).
- Catraca: eslint ≤ 453, biome ≤ 15 (`npm run lint:ratchet`). `npm run typecheck` limpo.
- `tests/front/crm-do-painel.test.tsx` e `tests/front/crm-e-inicio-funcoes-puras.test.ts`
  continuam passando. Texto de teste pode mudar junto com o texto da tela, mas o
  comportamento testado não pode mudar: abas, filtro por segmento, "Ver cliente", WhatsApp,
  navegação para Pedidos.
- Acessibilidade: alvo ≥ 44 px, `focus-visible`, contraste AA para texto, `aria-*` coerentes.
- Função pura nova (ex.: conversão entre etapas, ticket por forma, agrupamento de segmentos)
  mora em `src/lib/crm.ts` e ganha teste em `crm-e-inicio-funcoes-puras.test.ts` **antes** do
  código.

## Verificação visual

O harness em `scratchpad/crm-visual/` renderiza a tela com dados falsos (sem rede) e tira
prints de página inteira das 4 abas em 375 × 812 e 1280 × 900, nos cenários
`real-pequeno` (o que o dono vê hoje) e `loja-cheia`. Cada aba é entregue com prints
de antes e depois, e o revisor olha os prints, não só o código.
