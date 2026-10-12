# Notas por frente — onda F do painel simples ("um número, um conceito")

> Complementa `docs/superpowers/plans/2026-10-09-painel-simples.md` (F1–F7). **Onde este arquivo e o plano divergem, vale
> este arquivo** (escrito depois de cruzar o plano com o código de `38b54535`). Manifesto:
> `docs/superpowers/lanes/2026-10-09-painel-simples-onda-f.json` (5 frentes, em paralelo). Valem INTEIRAS as regras de
> `…-ondas-cde-notas.md` e `…-ondas-gh-notas.md` ("Regras que valem para TODAS as frentes"): tetos exatos (não rode
> `ATUALIZAR_TETOS`, não edite os `.json` de teto), `AdminPageHeader`/`pixConfiguradoNoBuild` literais intocados, testes
> "por segurança" só mudam rótulo, Biome formata, `npm run typecheck; echo exit=$?`, `CI=true npm run lint:ratchet`
> (catraca de hoje: **eslint 409 / biome 14**, não pode subir), sem `npm test` inteiro, `frente.mjs conferir`.
> **Nenhuma migration, RPC, edge function ou service worker.** Respostas assumidas do dono: P-F1 = texto recomendado
> (ver frente 5), P-F2 = o sino também deixa de listar PIX/cartão não pago, P-F3 = nomes dos cartões iguais aos chips de
> status ("Em trânsito", "Finalizados"), P3 = limiar 5.

## Regras novas desta onda
- **Número que não se sabe é "—", nunca "0"** (padrão PAINEL-05, `AdminOrdersView.tsx` ~397-399). Contagem nova que falha
  vira `null`; nada de `|| 0`.
- **Rótulo novo diz o conceito e a janela.** Mesmo número, mesmo rótulo e mesma fonte.
- **Mock do builder do Supabase:** quem passa a chamar `.or(...)` quebra todo mock sem `or` (o `TypeError` cai no `catch` e
  acende o sino "por dúvida"). Nesses testes acrescente `builder.or = vi.fn(() => builder)`; asserção de comportamento não sai.
- **Somente leitura (todas as frentes):** `src/lib/crm.ts`, `src/types/painel.ts`, `src/utils/avisos-do-lojista.ts`,
  `src/lib/anulacao-do-balcao.ts`, `src/components/admin/pdv/**`, `AdminPageHeader.tsx`, `AdminKpiCarousel.tsx`,
  `crm/TileDeKpi.tsx`, `crm/ChipDeVariacao.tsx`, `src/hooks/useAnalytics.ts`, `src/lib/financeiro.ts`, `supabase/**`.
  Nenhum export muda de assinatura.

## 1. pedidos-para-preparar — F1, F2, F2b, F3 — PEDIDO (DINHEIRO), revisor-risco
Uma regra só para "para preparar", a MESMA do Início. Regra canônica (`painel_inicio`,
`supabase/migrations/20261199000000_portas_do_painel_exigem_admin_atual.sql:1582-1584`):
`status IN ('new','pending','processing') AND COALESCE(payment_status,'') NOT IN ('aguardando','expirado','recusado','estornado')`.
Ordem interna (serial): 1.1 → 1.2 → 1.3 → 1.4 → 1.5.
- **1.1 `src/lib/pedidos-para-preparar.ts` (novo):** `STATUS_PARA_PREPARAR`, `PAGAMENTOS_QUE_NAO_PREPARAM`,
  `estaParaPreparar({status,paymentStatus})`, `estaAguardandoPagamento` (status aberto e `payment_status==="aguardando"`),
  `FILTRO_POSTGREST_PARA_PREPARAR` = `payment_status.is.null,payment_status.not.in.(aguardando,expirado,recusado,estornado)`
  montado a partir das constantes. Teste `pedidos-para-preparar.test.ts`: amostra de 8 pedidos → 5 para preparar; guarda
  contra deriva que LÊ a 20261199 e confere que as listas do SQL são iguais às constantes (caminho literal; se precisar de
  variável, `// eslint-disable-next-line security/detect-non-literal-fs-filename -- caminho fixo do repo`); string do filtro.
- **1.2 selo da aba Pedidos (`AdminLayout.tsx`):** ~76-95 `STATUS_PEDIDOS_COM_ACAO_PENDENTE` vira alias de
  `STATUS_PARA_PREPARAR` (mesmo nome e valor); ~211-215 a consulta ganha `.or(FILTRO_POSTGREST_PARA_PREPARAR)`; ~1244-1252 o
  `aria-label` vira "Pedidos, N para preparar". NÃO toque o selo de conexão (linhas ~55-74 e ~766-828). Teste: em
  `admin-layout-cracha-pedidos-pendentes.test.tsx` o builder grava o argumento de `.or`; caso "PIX aguardando não conta"
  (com o filtro 5, sem 7). Atualize `builder.or` nos mocks de: admin-barra-nao-mente-a-aba-do-pdv, admin-barra-tem-nome-acessivel
  ("3 pendentes"→"3 para preparar"), admin-cabecalho-alvos-44, admin-layout-badge-de-ajustes-nao-mente, admin-layout-porta-unica,
  badges-do-painel-agrupam-rajada, nome-da-loja-painel-endereco, selo-de-conexao-em-palavras,
  sino-do-painel-acende-quando-consulta-falha (o controle negativo quebra sem isso), sino-do-painel-leva-as-notificacoes.
- **1.3 lista do sino (`useAvisosDoLojista.ts` ~3, 51-59):** importa da lib (não mais do AdminLayout) e acrescenta o `.or`.
  Hoje diz "Pedido de X esperando você" para PIX que espera o CLIENTE. Teste novo em `use-avisos-do-lojista.test.ts`.
- **1.4 topo de Pedidos (`AdminOrdersView.tsx` ~541-579 + novo `src/hooks/useNumerosDosPedidos.ts`):** `stats.pending` vem de
  `get_admin_analytics_v2.today_pending` (20261199:1688-1690), SEM filtro de pagamento e sem janela — por isso o 1º cartão
  precisa de contagem própria. Hook `useNumerosDosPedidos(ativo) → {paraPreparar, aguardandoPagamento, aCaminho: number|null,
  recarregar}`: 3 contagens `head:true` em `marketplace_orders` (`in(STATUS_PARA_PREPARAR).or(FILTRO)`;
  `in(STATUS_PARA_PREPARAR).eq("payment_status","aguardando")`; `eq("status","shipping")`), com guarda de rodada (padrão
  `AdminLayout.tsx:166-202`) e construção E `await` dentro de `try` (os ~43 testes que montam a view têm mocks de `from` de
  todo tipo; falha vira `null`). Os 4 cartões: **"Para preparar"** (paraPreparar), **"Aguardando pagamento"** ("PIX ou cartão
  ainda não pago"), **"Em trânsito"** (aCaminho, "Enviados"), **"Finalizados"** (`analyticsStats.deliveredTotal`, a mesma fonte
  de hoje; "Desde o início · app e balcão"). SAI "Receita Hoje" e "Valor médio por venda" do topo — prova de que nada se perde:
  a receita de hoje vive no Início (`painel_inicio.hoje.receita`, pelo dia do pagamento) e em Relatórios; o valor médio por
  venda vive em Clientes e em Relatórios/Início. `loadStats` chama também `recarregar`; remova ícones sem uso se o lint acusar.
  Teste novo `pedidos-numeros-do-topo.test.tsx`: 4 cartões com 5, 2, 1, 3; não existem "Receita Hoje", "Valor médio por venda",
  "Ações Pendentes"; consulta falhando mostra "—", não "0". Atualize `admin-orders-acoes-pendentes-subtitulo-honesto`,
  `admin-orders-total-concluido-e-aviso-pago-cancelado` (rótulos) e `pedidos-falam-a-lingua-da-loja` (~115-120: agora afirma
  que o topo NÃO tem "Valor médio"/"Ticket"). Os demais testes de `AdminOrdersView` só mudam se quebrarem.
- **1.5 comentários** `useAnularVendaDoBalcao.ts:50` e `useOrders.ts:~3347-3349` que citam "Receita Hoje" (só comentário).
- Riscos: contagem nova sem guarda de rodada grava número velho; `.or` montado à mão diverge da constante (o teste 1.1 prende);
  `today_pending` continua calculado no banco sem uso no front (não mexer).

## 2. inicio-com-janela — F4 — ROTINA (revisor confere o rótulo contra `crm__vendas`)
Cada número do Início diz conceito e janela; "Contas vencidas" uma vez só. Fonte de "Hoje" e do mês é `crm__vendas`
(`payment_status IN (pago, pago_apos_expirar, recebido_na_entrega)`, sem cancelled/returned, por dia do pagamento em SP) —
"Vendas pagas" é o rótulo exato dessa régua.
- `HojeNaLoja.tsx`: rótulo visível "Vendas pagas hoje" acima do valor; "N pedidos" → "N vendas" (`hoje.pedidos` = count de
  `crm__vendas` do dia); h2 `text-[10px]`→11px.
- `NumerosDoMes.tsx`: "Receita do mês" → "Vendas pagas no mês"; o rodapé perde "Contas vencidas" e fica "A pagar em 7 dias"
  (→ `admin-financeiro`); rodapé do lucro "Vendas pagas menos o custo dos produtos". "Contas vencidas" FICA no `ParaFazer.tsx`
  (acende a pendência e leva ao Financeiro). "Lucro estimado" vem de `fin_dre`: NÃO renomear para "vendas".
- `SerieDe14Dias.tsx` ~273/277: caption "Vendas pagas por dia nos últimos 14 dias", th "Vendas pagas". `AdminDashboardView.tsx`
  ~305-313 (ajuda): "Vendas pagas hoje: …"; "Lucro estimado: as vendas pagas do mês menos o custo…". NÃO tocar as linhas literais de
  import de `AdminPageHeader` e `pixConfiguradoNoBuild`. `ParaFazer` h2 10px→11px. "Devoluções abertas" mantém o rótulo.
- Teste `inicio-diz-a-janela-de-cada-numero.test.tsx` (a) "Vendas pagas hoje"; (b) "Contas vencidas" aparece UMA vez (no Para
  fazer), "A pagar em 7 dias" ainda navega a `admin-financeiro`; (c) caption e ajuda trazem "Vendas pagas". Atualize
  `inicio-do-painel.test.tsx:~188` ("Receita do mês"→"Vendas pagas no mês"); `relatorios-falam-a-lingua-da-loja` continua.
- Vizinha: pedidos-para-preparar (o "Pedidos para preparar" do Para fazer é o mesmo número do selo depois da 1.2).

## 3. estoque-um-limiar — F5 — ROTINA
No front "estoque baixo" é UMA regra: `precisaDeReposicao(estoque, estoqueMinimo)` =
`estoque <= (estoqueMinimo ?? LIMIAR_PADRAO_DE_ESTOQUE)` (`src/utils/avisos-do-lojista.ts:11,70-75`, valor 5 = P3). Sem coluna/migration.
- `useProducts.ts:~702` `query.lte("estoque", 5)` (ramo NÃO admin) → `LIMIAR_PADRAO_DE_ESTOQUE`. O "low" do admin é SQL
  (`get_admin_products_paged`) e fica fora.
- `AdminProductsView.tsx` ~1638 (selo "Crítico"), ~1719/1727 (cores), ~1890 (cor): uma `const estoqueBaixo =
  precisaDeReposicao(product.stock, product.estoqueMinimo ?? null)` por cartão usada nas 4 linhas; classes iguais (a régua 61 não sobe).
  "Esgotado" (`<= 0`) não muda. `PhoneSimulator.tsx` (`<= 3`) imita a cliente e FICA FORA (resíduo motivado).
- Teste `estoque-baixo-um-limiar.test.ts`: (a) fonte — em `src/views/admin/**`, `src/components/admin/**` (fora PhoneSimulator, com
  o motivo escrito) e `useProducts.ts`, nenhum literal de estoque baixo (`(stock|estoque)[\w.]*\s*<=?\s*[1-9]` e `lte("estoque", <dígito>`);
  (b) comportamento montando a view: estoque 5 e mínimo NULL → "Crítico"; estoque 8 e mínimo 10 → "Crítico"; estoque 4 e mínimo 0 → sem selo.
- Atenção: com `estoque_minimo DEFAULT 5` quase nada muda na tela; o Início segue em 3 (SQL) até a Onda I.

## 4. clientes-de-onde-vem — F6 (o que sobrou) — ROTINA
O botão WhatsApp da Ficha JÁ foi feito na onda 3 (`linkWhatsappDoCliente`, desabilitado e explicado) e NÃO muda. Sobram 2 textos:
- `AdminCustomersView.tsx` ~472-486: `<p>` (≥11px, `text-zinc-400`) abaixo do cabeçalho: "Clientes com conta no app. Quem comprou só
  no balcão aparece em {NOMES_DO_PAINEL["admin-crm"]} › Clientes." Não edite `AdminPageHeader`.
- `ClientesDoCrm.tsx` ~609 `descricao`: "Quem já comprou (app e balcão), quem pediu e não pagou e quem criou conta sem comprar — com
  WhatsApp e ficha a um toque." (correção da spec: "Quem já comprou — app e balcão" seria FALSO; `crm_clientes` junta compradores,
  `pediu_nao_pagou` e `nunca_comprou`, 20261199:1016-1050.)
- Teste `clientes-dizem-de-onde-vem.test.tsx`: as duas frases aparecem; a do CRM não diz "com conta no app". O cartão "Valor médio por
  venda" de Clientes NÃO muda.

## 5. balcao-anular-e-cancelar — F7 — PEDIDO (DINHEIRO, só texto), revisor-risco
Fatos: o "Anular venda" JÁ existe na ficha (`OrderDetail.tsx` ~817-955, guardado por `podeAnularVendaDoBalcao`,
`src/lib/anulacao-do-balcao.ts:51-62`); o canal é `"presencial"` (não "balcao"); "Cancelar pedido" não existe para entregue
(`OrderDetail.tsx` ~406-407) e a venda do balcão nasce entregue. Frase da migration
(`supabase/migrations/20261204000000_a_venda_do_balcao_se_anula_no_mesmo_dia.sql:315`):
`'Só dá para anular no mesmo dia da venda. Para outro dia, registre uma devolução.'`
- Em `OrderFinanceCard` (dentro de `OrderDetail.tsx`), SÓ quando `order.canal === "presencial"`:
  - mesmo dia (`podeAnularVendaDoBalcao(order)` verdadeiro): uma linha antes do botão, ex.: "Venda do balcão não se cancela: se foi
    engano, anule hoje — o estoque volta e o Financeiro desconta.";
  - outro dia (entregue, `recebido_na_entrega` e regra falsa): a 1ª frase LITERAL "Só dá para anular no mesmo dia da venda." e, no lugar
    da 2ª (P-F1: o lojista NÃO tem como abrir devolução de balcão no painel — `solicitar_devolucao` exige o cliente logado), "Depois
    disso, a devolução só pode ser pedida pelo cliente que tem conta no app."
  - Nenhum handler, regra (`podeAnularVendaDoBalcao`) ou componente de `pdv/` muda. Texto novo nasce com régua 0 (≥ 11px).
- Teste `balcao-explica-anular-e-cancelar.test.tsx`: (a) balcão do mesmo dia: explicação + botão; (b) balcão de ontem: a frase literal e
  nenhum botão; (c) pedido do app entregue: nenhum dos dois textos; (d) guarda: LÊ a 20261204, acha a linha 315 e confere que a 1ª frase
  da tela é prefixo dela; (e) renderizar não chama `anular`.
- Os `ficha-do-pedido-*` que montam `AdminOrdersView` são da frente 1; o integrador roda os dois lados.

## Pedidos ao integrador (onda F)
`integrar` na ordem: pedidos-para-preparar → balcao-anular-e-cancelar → inicio-com-janela → estoque-um-limiar → clientes-de-onde-vem;
`ATUALIZAR_TETOS=1` nos dois guardas (HojeNaLoja e ParaFazer caem de 1 para 0); testes de leitura cruzada (portas-das-abas-nas-telas,
titulos-pelo-nome-unico-*, admin-visual-telas-titulo-padronizado, pix-configurado-no-build-contrato, painel-sem-erro-cru,
rotas-de-entrada, hospedagem-rotas, crm-e-inicio-funcoes-puras, admin-kpi-carousel-compacto); `.lint-baseline.json` se a catraca cair;
`npm run build && npm run size` (hook e lib novos só no painel). Para a Onda I: o número `20261207` do plano já foi usado; o próximo
livre é `20261211`.
