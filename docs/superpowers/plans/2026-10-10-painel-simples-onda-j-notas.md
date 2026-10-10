# Painel simples — Onda J (acabamento visual no celular): notas por frente

Manifesto: `docs/superpowers/lanes/2026-10-10-painel-simples-onda-j.json` (7 frentes disjuntas, nenhuma toca banco,
edge, dinheiro, autenticação ou service worker). Base: `claude/oi-uunug6` @ `39f4b09e`.

## Origem

Render do painel num celular simulado (Chromium, 360x740 e 412x915, dados fictícios; NÃO é aparelho real), com
screenshots em `/tmp/.../scratchpad/telas/` (temporário). Defeitos reais confirmados a olho: cartões de métrica
cortam rótulo (8,5px) e subtítulo (9px) e em 360px até o valor ("R$ 7.348,…"); o acento das maiúsculas some
(`leading-none` + `truncate`); em Clientes o número de "Pedidos" fica fora do cartão; o carrossel muda sozinho a cada 4s
(o "Para preparar" já não estava à vista); jargão (ROI, Portfólio, CUSTOMER, PDV, MiB, checkout, "2147483647"); percentuais
em inglês ("130.15%") e "1150" sem milhar; tabela de Consultas de frete rola na lateral sem sinal; barra inferior
translúcida (a classe `.admin-glass`, emitida DEPOIS de `bg-zinc-950/95` no CSS final, vencia o fundo e a borda).

## Decisões assumidas (o dono não respondeu; vale o padrão recomendado e é reversível)

- **P-J1** o carrossel de métricas NÃO anda sozinho (autoplay desligado; a prop `autoplayInterval` continua existindo
  com padrão 0, e quem passar o valor liga).
- **P-J2** a grade de Produtos mostra o selo "Crítico" (mesma regra `precisaDeReposicao`, limiar 5, do modo detalhado).
- **P-J3** o botão de Pedidos continua "CSV" (decisão do dono de 12/09, registrada em AdminOrdersView ~1891); NÃO trocar
  para "Planilha". Não mexer no texto visível "CSV" nem no nome acessível.
- **P-J4** o cartão de métrica pode ficar mais alto SÓ no celular (de 64px para até ~96px), todos da mesma faixa com a
  mesma altura; no computador continua 68px. Reverter é uma classe.

## Regras para TODAS as frentes

Valem as de `…-ondas-cde-notas.md`, `…-ondas-gh-notas.md` e `…-onda-f-notas.md`. Esta onda soma:
- **Tetos exatos.** Não rode `ATUALIZAR_TETOS`; não edite `tests/front/regua-visual-do-painel.json` nem
  `tests/front/painel-sem-jargao.teto.json`. "Baixe o teto para N" nos seus arquivos é esperado; quem regrava é o
  integrador. Nenhum teto sobe; arquivo novo nasce com teto 0. Classe nova nunca é `text-[6–10.5px]`, `#09090b` nem ouro
  literal.
- **Catraca**: eslint 409 / biome 13 (`.lint-baseline.json`); não pode subir.
- **Somente leitura nesta onda**: `src/lib/glossario-do-painel.ts` (entradas novas = pedido ao integrador), `src/lib/crm.ts`
  (pode importar `formatarInteiro`/`formatarPercentual`), `src/index.css`, `src/components/admin/primitivos/**`,
  `AdminPageHeader.tsx`, `src/components/admin/pdv/**`, `supabase/**`, `src/utils/avisos-do-lojista.ts`, os testes de
  leitura cruzada (`portas-das-abas-nas-telas`, `titulos-pelo-nome-unico-*`, `admin-visual-*`).
- **Nenhum export muda de assinatura**: `KpiCardConfig`, as props de `AdminKpiCarousel`, `motivoDaCotacao`,
  `nomeDoProvedorNoHistorico` ficam iguais; o novo é acréscimo.
- **Atualizar teste existente só troca rótulo, formato de exibição ou classe.** Asserção de comportamento não sai.
- **Prova de cada frente** (uma rodada escopada): `npx vitest run <testes da frente> tests/front/painel-sem-jargao.test.ts
  tests/front/regua-visual-do-painel.test.ts`; `npm run typecheck; echo exit=$?`; `CI=true npm run lint:ratchet`;
  `node scripts/paralelo/frente.mjs conferir`. Sem `npm test` inteiro. Commit só por `frente.mjs commitar`. Biome
  formata os arquivos tocados (`npx biome format --write <arquivos>`). Sem python para editar.
- Confira cada número de linha com `rg` antes de editar (as linhas são da base `39f4b09e`).

## J1 · metricas-cabem

Objetivo: o cartão de métrica mostra rótulo, valor e subtítulo inteiros em 360px, com acento; a faixa não anda sozinha.
Arquivo `src/components/admin/AdminKpiCarousel.tsx`:
- L57: `temAlturaFixa ? "h-16 sm:h-[68px]"` → `h-full min-h-16 sm:min-h-[68px]` (slide estica no flex do Embla; grade na 297;
  cartões da mesma faixa com a mesma altura, sem altura travada que corte texto).
- L62-67 ícone: `hidden xs:flex` (xs = 480px) — abaixo dele o texto ganha ~46px (de ~87 para ~135px).
- L77 rótulo: sai `truncate text-[8.5px] leading-none tracking-[0.18em]`; entra `line-clamp-2 break-words text-[11px]
  leading-[1.25] tracking-[0.06em]` (continua em maiúsculas; "AGUARDANDO / PAGAMENTO" cabe em 2 linhas).
- L84-91 valor: `text-[15px] xs:text-base sm:text-lg leading-tight tabular-nums`; `truncate` só como último recurso.
- L93 e L98 subtítulo e rodapé: `text-[11px] leading-[1.25] line-clamp-2`, sem `uppercase`.
- L250 título da faixa `text-[11px]`. L258-271 pontos: cada um vira `<button>` de `h-11 w-6` com o ponto visível por dentro,
  `aria-label="Mostrar o grupo N de M"` e `aria-current` no ativo (sai `title="Ir para snap N"`). L278 Expandir/Carrossel
  `min-h-11 text-[11px]`.
- L192-238 autoplay: `autoplayInterval` com padrão `0` = desligado; o efeito retorna cedo quando `!autoplayInterval`.
  Nenhum chamador passa a prop (7 usos: Banners, Coupons, Customers, Orders, Products, QA, Reviews) → desliga em todas.
TDD, teste novo `tests/front/metricas-cabem-no-celular.test.tsx` (falha primeiro): (a) rótulo/subtítulo/rodapé sem
`truncate` nem `leading-none`, com `line-clamp-2`; (b) ícone `hidden` + `xs:flex`; (c) pontos são botões com `aria-label`
"Mostrar o grupo 1 de 3" e `aria-current`; (d) Expandir `min-h-11`; (e) com `vi.mock("embla-carousel-react")` (API com
`scrollNext` espião) e `vi.useFakeTimers()`, avançar 12s NÃO chama `scrollNext`; (f) com `autoplayInterval={4000}` explícito
chama (opt-in continua). Atualizar `admin-kpi-carousel-compacto.test.tsx` (L142-153: "altura FIXA (`h-16`)" → "mesma altura
por esticar (`h-full` + `min-h-16`) e `overflow-hidden`"; o resto fica). Prova: os dois + `admin-products-kpi-apos-mexer-no-catalogo`,
`admin-customers-ticket-medio`, `pedidos-numeros-do-topo` (esses só rodam) + guardas; a régua deve pedir "baixe o teto para 0" em
`AdminKpiCarousel.tsx` (hoje 5). NÃO: trocar para 1 cartão por vez (decisão de 02/09: "2 por vez"); mexer em `TileDeKpi`;
remover a prop `autoplayInterval`.

## J2 · pedidos-no-celular (o caminho `*order*` acende o revisor-risco; só confere que é texto/formato)

Arquivos `src/views/admin/AdminOrdersView.tsx` e `src/components/admin/orders/AdminOrderCard.tsx`:
- L580 `stats.completed.toString()` → `formatarInteiro(stats.completed)` (`src/lib/crm.ts:669`, pt-BR, devolve "—" para null);
  idem L558, 566 e 573 por consistência.
- L1637 placeholder "Buscar pedidos..." → "Buscar…" (o `<label class="sr-only">Buscar pedidos</label>` da L1631 fica).
- Botão de exportar (L1107-1116, 1880-1908): P-J3 = fica "CSV". NÃO trocar o texto.
- `AdminOrderCard.tsx:294` WhatsApp `size-10` → `size-11` (alvo de 44px).
TDD, teste novo `tests/front/pedidos-cabem-no-celular.test.tsx`: (a) com `get_admin_analytics_v2` mockado com `delivered_total` 1150
o cartão "Finalizados" mostra "1.150"; (b) placeholder da busca "Buscar…"; (c) botão WhatsApp do cartão com `size-11`.
Atualizar `pedidos-numeros-do-topo` (caso de milhar) e, só se afirmarem `size-10`, `admin-orders-card-whatsapp-sem-destinatario`,
`admin-order-card-redesenho`, `admin-order-card-forma-de-pagamento`. NÃO: tocar `exportarCsv`, `handleRegistrarPagamento`,
filtros, consultas, a L959 (contrato 22023) nem os textos dos cartões de métricas (regra da onda F).

## J3 · produtos-no-celular (serial por dentro: 3.1 → 3.5)

**3.1 Métricas sem ROI e em pt-BR** (`AdminProductsView.tsx`): L372 "ROI do Portfólio" → **"Lucro sobre o custo"** (termo do
glossário; `avgRoi` = lucro potencial ÷ custo investido, L329-332); L379 subtítulo "Média do estoque com custo"; L375
`toFixed(2)%` → formato pt-BR com 1 casa (`toLocaleString("pt-BR",{minimumFractionDigits:1,maximumFractionDigits:1})` + `%`, função
local; "130.15%" → "130,2%"); o mesmo formato em L1331, 1340, 1679, 1712 (simulador e cartão detalhado); L1023 (ajuda "ROI do Portfólio")
e o texto vizinho 1024-1026 → "Lucro sobre o custo" em 11px; L1337 "ROI Unitário" → "Lucro sobre o custo (por unidade)"; L1697
"ROI de Rendimento" → "Lucro sobre o custo"; L1743 e L1906 `padStart(2,"0")` sai (estoque "2", não "02").
**3.2 Grade: estoque baixo em palavra** (P-J2): L1867-1882 na coluna de selos sobre a foto, o mesmo `<Badge>Crítico</Badge>` do modo
detalhado (L1640-1643) com a mesma regra `estoqueBaixo` (`precisaDeReposicao`, L1506), `text-[11px]`; L1888-1890 nome
`line-clamp-2 break-words`; L1801 `h-[250px]` → a altura que cabe categoria (1 linha, `truncate`), nome em 2 linhas, estoque e
preço (estimativa ~`h-[284px]`; mude a altura, NÃO tire a classe do `content-visibility`); as classes de 8–9px que esta tarefa já
reescreve (L1870, 1886, 1896, 1913) viram 11px.
**3.3 Modo detalhado: nome inteiro**: L1604 `p-8` → `p-5 sm:p-8`; L1606 `gap-6` → `gap-4 sm:gap-6`, imagem `size-20 sm:size-24`; L1618
nome de `truncate` → `line-clamp-2 break-words pr-12` (não ficar sob o ⋮ absoluto da L1557); selos de L1626, 1641, 1645, 1650 e
rótulos de L1661, 1696 (8px) → 11px.
**3.4 Botão grade/lista** (L742-757): `aria-label` com o que o toque faz ("Mostrar em lista com detalhes" / "Mostrar em grade"); sem
`aria-pressed`.
**3.5 Formulário** (`AdminProductFormView.tsx`): L2945 Salvar/Publicar `text-[9px] md:text-[10px]` → `text-[11px]`, `min-h-11 min-w-11`
(hoje 83x30); estoque mínimo L313-314/L327-336: `ESTOQUE_MINIMO_MAXIMO = 2147483647` fica e o teto real continua valendo, mas a mensagem vira
duas — texto/negativo/decimal: **"Use um número inteiro: 0, 1, 2… (sem vírgula nem sinal de menos)."**; acima do teto: **"Número grande
demais. Use um valor menor."** (nenhum número enorme aparece na tela); código de barras (L4426-4456 produto e 2633-2667 variação):
`flex gap-2` → `flex flex-col gap-2 xs:flex-row` (botão "Ler com a câmera" abaixo do campo no celular; 13 dígitos cabem, `font-mono
tabular-nums` também no do produto; botão da variação (L2662) `min-h-11 text-[11px]`); PDV: textos visíveis nas L2670, 3513, 4459, 4598,
4664 "o PDV lê" → **"a tela Vender lê"** (`NOMES_DO_PAINEL["admin-pdv"] = "Vender"`), L4100 "(ROI)" sai (comentários `//` podem ficar);
dicas das fotos (L3155-3160) e "Arraste as imagens…" (L3151) em 11px, "12MB" → "12 MB"; selo "Principal/#N" (L3302) de 7px → 11px; ações da foto
"Ajustar e Cortar"/"Excluir" (36x36) → `size-11` (confirme as linhas com `rg -n "Ajustar e Cortar"`); L4063 `marginPct.toFixed(1)%` → mesmo formato pt-BR.
TDD: `tests/front/produtos-cabem-no-celular.test.tsx` — (a) KPI "Lucro sobre o custo" com "130,2%" e nenhum `/\bROI\b|Portf[óo]lio/`; (b) grade:
estoque 2 e mínimo nulo mostra "Crítico", estoque 30 não; (c) nome da grade com `line-clamp-2`; (d) detalhado: margem "33,3%" e retorno "50,0%"; (e) botão de
modo com nome acessível; (f) estoque "2", não "02"; (g) teste de fonte: sem `toFixed(` seguido de `}%`/`%` nos dois arquivos. `tests/front/produto-formulario-no-celular.test.tsx` — (a)
Salvar/Publicar `min-h-11`; (b) com câmera mockada (`temCameraDisponivel`), contêiner do código de barras com `flex-col` e `xs:flex-row`; (c) nenhum texto
visível com "PDV"; (d) "3000000000" mostra "Número grande demais…", "-3" e "2.5" mostram "Use um número inteiro…", e o texto NÃO contém "2147483647"; (e) "Principal" sem
classe < 11px. Atualizar: `admin-products-margem-sem-custo` (L333, 362, 401-402: "100.0%" → "100,0%", "33,3%", "50,0%"; o caso "sem custo mostra —" fica),
`produto-estoque-minimo` (L387-429: as frases novas; o payload com 2147483647 continua igual), `estoque-baixo-um-limiar` (se contar "Crítico" uma vez por cartão), e só se
quebrarem por rótulo/classe: `admin-product-form-codigo-de-barras`, `admin-product-form-ler-com-a-camera`, `produto-fala-a-lingua-da-loja`, `produto-basico-primeiro`. Esperado nas guardas:
régua de `AdminProductsView` abaixo de 61 e de `AdminProductFormView` abaixo de 77; jargão de `AdminProductFormView` continua 2 (as duas pontes "Código interno (SKU)"). NÃO: mexer em
cálculo (`avgRoi`, `margin`, `roi`, `invested`); criar outra regra de estoque; renomear identificadores (`roi-portfolio`, `avgRoi`); tocar `useProducts.ts`, `ModalVarianteGrade`,
`LinhasDaGrade`, `PhoneSimulator`.

## J4 · clientes-no-celular

- Novo `src/lib/papel-da-conta.ts`: `rotuloDoPapel(role: string | null | undefined): string` — `admin`→"Administrador", `gerente`→"Gerente", `vendedor`→"Vendedor", `customer`→"Cliente";
  desconhecido ou vazio → "Cliente" (o CHECK do banco só tem estes 4). Função pura.
- `AdminCustomersView.tsx`: L888 e L1113 `{customer.role}` → `{rotuloDoPapel(customer.role)}`; L1137-1157 (KPIs de baixo do cartão compacto): contêiner `grid grid-cols-[minmax(0,1fr)_auto] items-end gap-2`;
  rótulo "Total já comprado" de `tracking-[0.2em]` → `tracking-wide`, com `break-words` e `min-w-0`; "Pedidos" e o número na coluna `auto`, à direita; mesmo `tracking-wide` na L946; L1000/1085 "Ver Perfil Elite" →
  "Ver ficha do cliente"; L1007/1092 "Notificação Push" → `NOMES_DO_PAINEL["admin-push"]` ("Avisar clientes") (opcional).
- `AdminUserDetailView.tsx`: L664 `{profile?.role || "Cliente"}` → `rotuloDoPapel(profile?.role)`; L1040-1056 "Auditoria de Carrinho" → "Carrinho do cliente", "Produtos retidos na estrutura de checkout" → "O que está no carrinho agora", "{n} Elementos" → "{n} itens".
TDD: `papel-da-conta.test.ts` (4 papéis; null; "superuser"); `clientes-cabem-no-celular.test.tsx` — (a) lista mostra "Cliente" e "Administrador" e nenhum "customer"/"CUSTOMER" como texto; (b) linha de KPIs do cartão compacto
com `grid-cols-[minmax(0,1fr)_auto]` e rótulo sem `tracking-[0.2em]`; (c) a ficha mostra "Cliente". Atualizar `listas-falam-a-lingua-da-loja`, `admin-customers-*`, `admin-ficha-cliente-*`, `admin-user-detail-pedidos-que-contam` só se
afirmarem o papel cru ou "Ver Perfil Elite". NÃO: `handleSort("role")` (a ordenação continua pelo valor cru); `linkWhatsappDoCliente`; `handleClearUserCart`.

## J5 · historico-de-consultas (só front; a edge `calculate-shipping` não muda)

- `src/lib/motivo-da-cotacao.ts` `traduzirCorpo` (L47-59), por pedaço depois do prefixo `<id>: `: `^tempo esgotado:` → "A transportadora demorou demais para responder. Tente de novo mais tarde."; `^falha de rede:` → "Não deu para
  falar com a transportadora (sem conexão). Tente de novo mais tarde."; `resposta não é JSON válido` → `frase(null)`. As frases reais da edge estão em `supabase/functions/calculate-shipping/provedores.ts:259` e `:280` (SÓ LER; confira
  em `index.ts:~480-510` como `log.motivo` é composto); o texto inteiro continua no `title`.
- `src/components/admin/settings/HistoricoCotacoesCard.tsx` (tabela L207-305): no celular cada consulta vira um bloco sem rolagem lateral — `<table className="block sm:table">`, `<thead className="sr-only sm:table-header-group">`,
  `<tbody className="block sm:table-row-group">`, `<tr className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 p-3 sm:table-row sm:p-0">`, cada `<td>` com `block sm:table-cell`, papéis ARIA explícitos (`role="table"`, `rowgroup`,
  `row`, `cell`, `columnheader`); ordem no bloco: Quando · Status (direita) / CEP do cliente · Transportadora / Tempo; motivo em largura inteira; CEP com `whitespace-nowrap`; cabeçalho da L209 sem `tracking-[0.2em]`; contêiner da L207
  `sm:overflow-x-auto`. Rodapé L331-336 → **"N consultas recentes em M linhas — as repetidas aparecem juntas (×2)."** Botão Atualizar (L340-349) `min-h-11 px-3`.
TDD: `motivo-da-cotacao.test.ts` (casos novos: "superfrete: tempo esgotado: The signal has been aborted" → frase de demora; "falha de rede: error sending request…" → frase de conexão; frase em português passa igual);
`historico-de-consultas-no-celular.test.tsx` — (a) `role="table"` e células `role="cell"`; (b) CEP com `whitespace-nowrap`; (c) contêiner sem `overflow-x-auto` sem `sm:`; (d) rodapé com agrupamento diz "em 3 linhas"; (e) Atualizar `min-h-11`. Atualizar
`historico-de-consultas-legivel`, `admin-shipping-historico-honesto` (rodapé e classe da L254), `admin-shipping-historico-mostra-o-motivo` (só rótulo/classe); `admin-visual-frete` só roda. NÃO: usar `mensagemDeErroDoPainel`; tocar `agruparRepeticoesDeErro`,
`fetchLogs`, `buscarConfiguracaoDeFrete`; dar nome de arquivo novo com "frete".

## J6 · minha-loja-textos

- `AdminAboutStoreView.tsx`: L448 `descricao` do bloco Horário → "Aparece na página Sobre a Loja e no rodapé da página inicial." (a frase "Informe quando a loja atende…" sai do `BusinessHoursSection` L82 para não repetir); L477-480 "Formatação rica (texto em negrito,
  imagens) é peça futura." sai (fica "Texto simples: deixe uma linha em branco para começar outro parágrafo."); L486 "…do checkout…" → "…o MESMO número do botão da página Sobre a Loja, da finalização da compra, dos pedidos e do perfil…"; bloco Marca: se a descrição vier
  duplicada (BlocoNumerado + IdentitySettingsSection), tire uma das duas.
- `BusinessHoursSection.tsx`: L85 `<label>` em `text-[11px] font-black uppercase` como os outros, sem repetir o título do bloco: "Dias e horários"; L92 input `h-11`; L99-118 "Salvar horário" vira botão primário (`min-h-11 rounded-xl bg-admin-gold px-4 font-black text-black
  disabled:opacity-40`) e "Descartar horário" secundário (`min-h-11 border border-white/15 bg-white/5 … disabled:opacity-40`); o jargão (teto 2: `lerSupabaseUrl`) não muda.
- `IdentitySettingsSection.tsx:128` "Até 20 MiB" → "Até 20 MB".
TDD `tests/front/minha-loja-fala-a-lingua-da-loja.test.tsx`: (a) sem "MiB", "checkout", "peça futura"; (b) "Informe quando a loja atende" no máximo uma vez; (c) "Salvar horário" com `min-h-11` e `disabled:opacity-40`; (d) dica do ícone "Até 20 MB". Atualizar (só texto)
`ajustes-horario-de-atendimento`, `horario-resposta-da-sessao`, `identity-settings-section`, `admin-settings-identidade-da-loja`, `admin-sobre-a-loja-salva-sem-apagar`; `endereco-e-horario-tem-um-dono` só roda. NÃO: tocar `save()`, `updateConfig`, `useStoreIdentityEditor`, `ContatoDaLoja`.

## J7 · barra-inferior

- `src/components/layouts/AdminLayout.tsx:1219`: tirar `admin-glass` do `className` do `motion.nav` (ficam explícitos `bg-zinc-950/95 backdrop-blur-2xl border border-white/15 shadow-[…]`, já na string); comentário curto com a causa (a ordem do CSS: `.admin-glass`
  em `src/index.css:491`, `@layer utilities`, sai depois de `.bg-zinc-950/95`). NÃO mexer em `src/index.css` (`.admin-glass` é usada em 23 arquivos). L1300 selo de número `text-[8px] h-4.5 min-w-4.5` → `text-[11px] h-5 min-w-5`.
TDD `tests/front/barra-inferior-cobre-o-conteudo.test.tsx`: (a) o `nav` móvel não tem `admin-glass` e tem `bg-zinc-950/95`; (b) selo de Pedidos com `text-[11px]` (reutilize o mock de `admin-barra-tem-nome-acessivel.test.tsx`, com `builder.or`, regra da onda F). Atualizar
`admin-barra-tem-nome-acessivel` só se afirmar a classe do selo. NÃO: tocar o selo de conexão (~L766-828), `navItems`, a contagem `.or(...)`, nem o `bottom:` calculado.

## Pedidos ao integrador (onda J)

1. Ordem de `integrar`: metricas-cabem → barra-inferior → pedidos-no-celular → produtos-no-celular → clientes-no-celular → historico-de-consultas → minha-loja-textos.
2. `ATUALIZAR_TETOS=1` nos dois testes de guarda (só abaixa). Esperado na régua: `AdminKpiCarousel` 5 → 0; `AdminProductsView` e `AdminProductFormView` abaixo de 61 e 77; `AdminOrderCard` e `AdminAboutStoreView` iguais ou menores. Nenhuma entrada nova.
3. Glossário (`src/lib/glossario-do-painel.ts` + um caso em `painel-sem-jargao.test.ts`), depois de tudo integrado: entradas `ROI` → "Lucro sobre o custo" (`/\bROI\b/`), `Portfólio` (`/Portf[óo]lio/`), `MiB` → "MB" (`/\bMiB\b/`). NÃO acrescentar "PDV" nem "checkout" nem "CSV" (P-J3).
   A guarda passa SEM mudar teto nenhum (essas palavras devem estar em 0).
4. Testes sem dono que montam telas tocadas: `npx vitest run tests/front/portas-das-abas-nas-telas.test.tsx tests/front/titulos-pelo-nome-unico-telas.test.ts tests/front/titulos-pelo-nome-unico-abas.test.ts tests/front/admin-visual-telas-titulo-padronizado.test.tsx
   tests/front/admin-visual-frete.test.tsx $(rg -l "AdminKpiCarousel|AdminCouponsView|AdminQAView|AdminReviewsView|AdminBannersView" tests/front | tr '\n' ' ')`.
5. `.lint-baseline.json` se a catraca cair. 6. `npm run build && npm run size`. 7. Reexecutar o harness de render (scratchpad, fora do repo) e comparar antes×depois.

## Fora desta onda (onda K)

Texto < 11px em massa (726 ocorrências em 38 arquivos; só `AdminBannersView` tem teto 326) e alvos < 44px em massa (botões "?" de 28–32px em 15 views; caixas de seleção 16px e 13px; interruptor do modo de teste e "Ver serviços da conta" no `TransportadorasCard`,
caminho `*frete*`); Início ("Caixa aberto — feche no fim do …", valores desalinhados, "R$ 15,4 mil" ao lado de "R$ 3.200,00", `capitalize`); Frete ("Acima de R$ / 199", "Melhor Envio / ligado", subtítulos truncados; arquivos `*frete*` acendem o revisor-risco);
Ajustes (título "MINHA LOJA / MINHA LOJA", Conexão em meia largura, "Prazos, formas de devolver…" truncado); `StrategicIntelligenceBlocks.tsx:97` `toFixed(1)}%` em Relatórios; "Choose File / No file chosen" (idioma do Chromium de teste, não é defeito do app).
