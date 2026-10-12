# Painel simples — Onda K (acabamento: toque de 44px, letra de 11px, vidro que perde classe, limpezas)

Manifesto: `docs/superpowers/lanes/2026-10-10-painel-simples-onda-k.json` (6 frentes disjuntas, `frente.mjs validar` verde; só front: nenhuma toca banco,
edge, regra de dinheiro, auth ou service worker). Base: `claude/oi-uunug6` @ `4245d121` (onda J2 integrada). Regras gerais: as de
`2026-10-10-painel-simples-onda-j-notas.md` e `…-onda-j2-notas.md`, com a correção e os padrões abaixo. As linhas citadas são da base `4245d121`
(confira com `rg -n` antes de editar).

## Spec curta

- **Problema.** O render da onda J2 (Chromium simulado, 360–1280px; não é aparelho real) mediu alvos de toque abaixo de 44px (botões "?" de 28–36px em
  15 telas, pontos do carrossel 24x44, "Marcar como recebido" 40px, campos de 36px, interruptores/caixas de 13–16px, "Ver serviços da conta" 133x17,
  "Resetar Simulador" 119x24, ações da ficha), texto abaixo de 11px no que a lojista mais usa, `admin-glass` apagando classe de borda/fundo/sombra no mesmo
  elemento, jargão e formatos de programador ("320ms", "12MB", "Cesta / Pedidos", "Fluxo Zerado", "Variante Indisponível (ID…)", "1289").
- **Quem sente.** A lojista, no celular, operando a própria loja (toque que erra, letra que não se lê, aviso âmbar/vermelho que não aparece).
- **Comportamento esperado.** Todo controle tocável da fila tem área de 44x44 (o desenho visível pode continuar menor); o texto da fila fica em ≥ 11px;
  `admin-glass` nunca divide o elemento com classe que ele apaga (guarda nova); números/unidades em pt-BR; nenhum comportamento muda.
- **Fora do escopo.** Banco, edge, checkout e telas da cliente; `src/components/ui/**` (compartilhado com a loja: `Switch`/`Input`/`Button` só recebem
  classe local); `src/index.css`; cabeçalhos `psql -1 -f` dos `rollback-manual-*` (decisão do dono). Ver "Fora desta onda".
- **Decisões que sobem ao Gabriel.** Nenhuma: a fila veio com as decisões tomadas. As escolhas de desenho abaixo são reversíveis por classe.

## Correção de premissa (régua e jargão)

A fila diz que, ao reduzir ocorrências, "o teste de régua fica verde com folga". **Não fica**: `tests/front/regua-visual-do-painel.test.ts` (L319-340) e
`painel-sem-jargao.test.ts` exigem contagem IGUAL ao teto — abaixo dele o teste FALHA com "X: N ocorrências e o teto é M — baixe o teto para N" (é a
catraca que impede a folga virar licença). Regra desta onda: na prova da frente, os dois testes de guarda podem sair vermelhos **somente** com linhas
`folgas` ("baixe o teto para N") de arquivos da própria posse, nos números esperados de cada seção; qualquer linha de `excedentes` (subiu) reprova. A
frente NÃO roda `ATUALIZAR_TETOS` nem edita os `.json`; o integrador regrava uma vez no fim (pedido 3). A régua só varre `src/views/admin` e
`src/components/admin` e soma três coisas por arquivo: texto 6–10.5px, cor literal (`#09090b`, ouros) e `fixed inset-0` sem `role="dialog"`.

## Regras para TODAS as frentes

- Tetos só descem; classe nova nunca `text-[<11px]`, `#09090b` nem ouro literal; nenhum export muda de assinatura (o novo é acréscimo); atualizar teste
  existente só troca rótulo, formato de exibição, classe ou seletor; asserção de comportamento não sai.
- `src/components/ui/**` é somente leitura (o `Switch` e o `Input` também servem `AddressForm` da loja): passe classe local (`cn` usa tailwind-merge, então
  `className="h-11"` vence o `h-9` do `Input`) ou envolva no admin. Também somente leitura: `src/index.css`, `src/lib/glossario-do-painel.ts`,
  `src/lib/crm.ts` e `src/lib/financeiro.ts` (podem ser importados), `src/components/admin/primitivos/**`, `AdminPageHeader.tsx`, `LocalBufferedInput.tsx`,
  `src/components/admin/pdv/**`, os testes de leitura cruzada (pedido 4).
- **TDD**: o teste novo da frente falha primeiro (não por vácuo: precisa achar o elemento e reprovar a classe/texto de hoje) e passa depois.
- Teste novo que lê arquivo-fonte (estático, como a régua) copia o cabeçalho `/* eslint-disable security/detect-non-literal-fs-filename,
  security/detect-object-injection -- … */` com motivo, da régua; sem ele a catraca do eslint (409) sobe.
- **Prova escopada** (uma rodada): `npx vitest run <testes da posse> tests/front/painel-sem-jargao.test.ts tests/front/regua-visual-do-painel.test.ts`;
  `npm run typecheck; echo exit=$?`; `CI=true npm run lint:ratchet` (eslint 409 / biome 13 / biome warnings 1 — não sobe);
  `node scripts/paralelo/frente.mjs conferir`. Commit só por `frente.mjs commitar`. `npx biome format --write <arquivos tocados>`. Sem python para editar.
- O jsdom não aplica CSS: onde a prova é de toque/layout, a asserção é sobre classe; a medida real é do render do integrador (pedido 7).

### Padrão A3 — botão de ajuda "?" com 44px sem engordar o desenho

O mesmo do Voltar do topo (`AdminLayout.tsx` L1016-1037, teste `admin-cabecalho-alvos-44`): o `<button>` vira o envoltório transparente de 44px e o
círculo visível mora num `<span>` interno. `onClick`, `title`, `aria-*` e `type` ficam no `<button>`; as classes de estado (`expandedHelp…` em `cn`) passam
para o `<span>`; `hover:` vira `group-hover:`.

```tsx
<button type="button" onClick={…} title="…" className="group flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-full active:scale-95">
  <span aria-hidden="true" className="flex size-8 items-center justify-center rounded-full border border-white/5 bg-zinc-900/60 text-zinc-500 transition-all duration-300 group-hover:border-white/10 group-hover:text-white">
    <HelpCircle className="size-4.5" />
  </span>
</button>
```

Mantenha o tamanho visual de hoje (`size-7`, `size-8`, `w-8 h-8`, `size-9`). Prova estática comum: para cada `<HelpCircle` (ou o texto `?` dos botões do
formulário) cujo elemento envolvente é `<button`, a tag de abertura do botão tem `min-h-11` e `min-w-11`.

### Padrão "vidro" — `admin-glass` com classe que perde

Medido compilando o CSS (`npx tailwindcss -i src/index.css`): `.admin-glass` (index.css L491, `@layer utilities`) sai DEPOIS de toda utilitária sem
variante (`.border-amber-500/20` L4688, `.shadow-lg` L9772, `.border-y` L4503 …, `.admin-glass` L10807) e ANTES das com variante (`sm:`, `hover:`,
`group-hover:` vencem). Ele fixa `border-width:1px`, `border-color:white/5`, `background:zinc-950/40`, `shadow-2xl` e `backdrop-blur(40px)`. Logo, no mesmo
`className`, perde: `bg-*`, `border` de lado/cor (`border-y`, `border-b`, `border-amber-…`), `shadow-*` e `backdrop-blur-*` que não sejam os mesmos
valores; `border`, `border-white/5`, `shadow-2xl`, `bg-zinc-950/40` e `backdrop-blur-2xl` são redundantes (não perdem nada). Duas correções:
(1) **honrar a intenção** quando a classe perdida carrega sentido (cor de alerta): tirar `admin-glass` e escrever por extenso
`border bg-zinc-950/40 shadow-2xl backdrop-blur-2xl` + a classe pretendida — muda o visual (o âmbar/vermelho/ouro aparece); (2) **apagar a classe morta**
quando é só sombra/borda alternativa: zero mudança visual. Ocorrências reais hoje (varredura de literais, 35 com `admin-glass`; as outras 25 são só redundantes):

| arquivo:linha | classe que perde | correção | frente |
|---|---|---|---|
| `AlertasCancelados.tsx:199`, `:269` | `border-amber-500/20` | (1) | K-E |
| `AlertasCancelados.tsx:307` | `border-amber-500/30`, `bg-amber-500/5` | (1) | K-E |
| `AdminDevolucoesView.tsx:236` | `border-red-500/20` | (1) | K-E |
| `AcoesDaDevolucao.tsx:256` | `border-admin-gold/20` | (1) | K-E |
| `AdminSettingsView.tsx:239` | `border-y` (+ `sm:border-x` redundante) | (2) | K-E |
| `AdminProductsView.tsx:833` (esqueleto) | `shadow-[0_20px_50px_rgba(0,0,0,0.3)]` | (2) | K-B |
| `AdminProductsView.tsx:884` (esqueleto) | `shadow-lg` | (2) | K-B |
| `AdminProductsView.tsx:1590` | `border-y`, `shadow-[0_20px_50px_rgba(0,0,0,0.3)]` (+ `sm:border-x`) | (2) | K-B |
| `AdminProductsView.tsx:1844` | `shadow-lg` | (2) | K-B |
| `AdminLoginView.tsx:133` | `border-b` | exceção (login = caminho `*login*`, fora da onda) | — |

## K-A · casca-e-pecas-comuns (ROTINA)

Arquivos: `src/components/layouts/AdminLayout.tsx`, `src/components/admin/AdminKpiCarousel.tsx`, `src/components/admin/PaginacaoAdmin.tsx`.
- **Topo e menu sem letra miúda** (`AdminLayout.tsx`, fora da régua — o teste novo é a única guarda): `text-[10px]`/`text-[9px]` → `text-[11px]` em L1031
  (pílula "Perfil/Voltar"), L863, L892, L953, L974 (itens do menu lateral, só desktop), L924 (crachá `h-5 min-w-5`), L989 (faixa "sem conexão"), L1141
  ("Novo Banner" do cabeçalho de Banners; só a letra — o toque dele fica para a onda L). Onde a pílula tem `tracking-widest`, pode descer para
  `tracking-wider` se 11px estourar.
- **Cabeçalho móvel sólido**: L1000 `<header className="sticky top-0 … bg-[#09090b]/95 … backdrop-blur-xl …">` — é `sticky`, a lista rola por baixo (mesmo
  caso da barra inferior da J2-C) → `bg-zinc-950`, sem `backdrop-blur-xl`; ficam `border-b border-white/5` e `shadow-md`. **Barra lateral** L779
  (`bg-[#09090b]/80 backdrop-blur-xl`, `lg:flex`): é coluna irmã do conteúdo, nada rola por baixo dela → NÃO muda (registre no commit o porquê).
- **Pontos do carrossel** (`AdminKpiCarousel.tsx:318`): `flex h-11 w-6` → `flex h-11 w-11`; o ponto visível (L322-328, `h-1 w-1`/`w-4`) não muda.
- **Paginação** (`PaginacaoAdmin.tsx`, usada por Produtos, Clientes, Pedidos e `ClientesDoCrm`): L45-46 `Exibindo {primeiro} - {ultimo} de {totalItens}`
  com `formatarInteiro` (`@/lib/crm`, L669) nos três números e `text-[10px]` → `text-[11px]`; botões L55 e L66 `h-10` → `h-11`. A assinatura de props não muda.
TDD `tests/front/casca-do-painel-letra-e-toque.test.tsx` (falha primeiro): (a) estático — `AdminLayout.tsx` sem `text-[6–10.5px]` fora de linha de comentário;
(b) estático — a tag `<header` tem `bg-zinc-950` sem `/95` e sem `backdrop-blur`; (c) render de `AdminKpiCarousel` com o `vi.mock("embla-carousel-react")` de
`metricas-cabem-no-celular` — cada ponto (`aria-label` "Mostrar o grupo N de M") tem `h-11` e `w-11`; (d) render de `PaginacaoAdmin` com `totalItens={1289}`,
`itensPorPagina={24}`, `pagina={0}` mostra "Exibindo 1 - 24 de 1.289", o `<p>` tem `text-[11px]` e os dois botões `h-11`. Atualizar
`metricas-cabem-no-celular.test.tsx:157` (`w-6` → `w-11`, só classe). Régua esperada: `PaginacaoAdmin` 1 → 0 (folga), `AdminKpiCarousel` fica 0.
NÃO: barra inferior (`motion.nav` ~L1225, já sólida), `navItems`, selo de conexão, contagem `.or(...)`, `bottom:` calculado, `autoplayInterval`, `TileDeKpi`.
Só o render confirma: a barra de cima do carrossel com 3 pontos de 44px (132px em vez de 72px) não quebra além do `min-h` reservado na J2-B a 360px; o
cabeçalho sólido com lista rolando por baixo; "Exibindo" em 11px sem empurrar os botões para a linha de baixo a 360px.

## K-B · produtos-acabamento (ROTINA; serial por dentro: B1 → B5)

**B1 Ajuda** — padrão A3 em `AdminProductsView.tsx:693-705` (estado `expandedHelp["global-guide"]` vai para o `<span>`) e em `AdminProductFormView.tsx`:
L2919-2926 (`HelpCircle`, `size-7`), L3051-3063, L3448-3460, L3736-3748, L4045-4057 (os quatro `?` de `w-8 h-8`, com `scale-110` de estado no `<span>`).
**B2 Simulador** (dentro do guia de ajuda de Produtos, aba simulador, a partir de L1201 `/* Simulador de Lucratividade */`): campos L1226, L1250, L1273
`py-2` → `min-h-11 py-2`; "Resetar Simulador" L1281-1291 → `min-h-11 text-[11px]` (texto fica); texto < 11px → `text-[11px]` em L1204, 1211, 1235, 1259,
1287, 1296, 1318, 1321, 1348, 1367, 1376, 1388, 1403, 1412. **Lista e guia**: L676, 806, 964, 977, 1662, 1763, 1802, 1813 → `text-[11px]` (em 806, 1802, 1813
troque `tracking-widest`/`tracking-[0.3em]` por `tracking-wider`/`tracking-[0.12em]` se cortar). A aba "Conceitos" do guia (L990-1188, 27 ocorrências)
fica para a onda L. Régua esperada `AdminProductsView`: 49 → 27.
**B3 Vidro** — correção (2) em L833, L884, L1590, L1844 (apagar as classes mortas da tabela; `admin-glass` FICA, inclusive no esqueleto: o seletor
`.admin-glass.animate-pulse` de `produtos-detalhado-nao-esconde-o-preco.test.tsx:377` continua valendo).
**B4 `percentualComUmaCasa` (L95-100 e a cópia em `AdminProductFormView.tsx:122-127`) FICA.** Conferido em Node, pt-BR: igual a `formatarPercentual`
(`src/lib/financeiro.ts:96`) para 130,15 / 33,333 / 50 / 0 / 1234,56 / 99,95, mas DIFERENTE para negativo ("-12,3%" × "−12,3%", sinal U+2212) e para
NaN/∞ ("NaN%" × "—"); o simulador e o cartão detalhado mostram margem negativa quando o preço fica abaixo do custo (`simulatorMetrics`, L293-303). Trocar
mudaria a tela; consolidar é decisão de grafia para depois (onda L).
**B5 Formulário** (`AdminProductFormView.tsx`): rótulos, dicas e erros dos campos `text-[10px]`/`text-[9px]`/`text-[8px]` → `text-[11px]` nas 28 linhas
2332, 2448, 2490, 2573, 2598, 2640, 2684, 2689, 2695, 2706, 2723, 2730, 2753, 2764, 2845, 3348, 3554, 3574, 3592, 3675, 3697, 3704, 4160, 4182, 4199, 4202, 4229,
4253 (régua esperada 71 → 43; o resto — folhas de ajuda, selos da foto, cabeçalho, lista de variações — é onda L). Estoque mínimo (L4498-4519,
`LocalBufferedInput` repassa `...props` ao `<input>`): `aria-invalid={estoqueMinimoError ? true : undefined}` e `aria-describedby` apontando para ids novos
na dica (L4512, `product-estoque-minimo-dica`) e no erro (L4516, `product-estoque-minimo-erro`, só quando existe). Toasts do envio de fotos: L1345
"…limite de 12MB…" → "12 MB"; L1354 `(${(totalSize / (1024 * 1024)).toFixed(1)}MB) … 30MB` → total em pt-BR com 1 casa (`toLocaleString("pt-BR",
{minimumFractionDigits:1, maximumFractionDigits:1})`) + " MB" e "30 MB" (comentários L1338-1339 podem ficar). **SKU: nada a mudar** — os dois rótulos
visíveis já dizem "Código interno (SKU)" (L2575 variação, L4404 produto); `rg "\bSKU\b"` fora de comentário só acha esses dois; o jargão de
`AdminProductFormView` continua 2 (as duas pontes, decisão da onda J).
TDD: `tests/front/produtos-letra-e-toque.test.tsx` (estático + render): (a) o botão de ajuda de Produtos com `min-h-11 min-w-11`; (b) os `<input` de
`value={simCost}`, `value={simPrice}`, `value={simStock}` com `min-h-11`; (c) o `<button` de "Resetar Simulador" com `min-h-11` e sem texto < 11px; (d) toda
ocorrência de texto < 11px de `AdminProductsView.tsx` está entre `{helpTab === "concepts" ? (` e `/* Simulador de Lucratividade */`; (e) nenhum literal com
`admin-glass` de `AdminProductsView.tsx` tem `shadow-lg`, `shadow-[` ou `border-y`. `tests/front/produto-formulario-letra-e-toque.test.tsx`: (a) render
(harness de `produto-estoque-minimo.test.tsx`): digitar "-3" no estoque mínimo deixa `aria-invalid="true"` e `aria-describedby` contendo o id do erro;
"5" tira o `aria-invalid`; (b) render (harness de `admin-product-form-upload-usa-o-tipo-real-da-imagem.test.tsx`, `toast` do `sonner` espionado): um arquivo de
13 MB dispara a mensagem com "12 MB"; três de 11 MB disparam "(33,0 MB)" e "30 MB"; nenhuma mensagem casa `/\d(MB)/`; (c) estático — as 5 tags de botão de
ajuda com `min-h-11 min-w-11`; (d) estático — nenhuma tag `<label` e nenhum elemento com `ml-1` + `block` no `className` tem texto < 11px; (e) os dois
"Código interno (SKU)" continuam (caracterização). Atualizar só se quebrarem por classe/seletor: `produto-formulario-no-celular`, `produto-estoque-minimo`,
`admin-product-form-*` da posse, `produtos-cabem-no-celular`.
NÃO: cálculo (`avgRoi`, `margin`, `roi`, `invested`, `simulatorMetrics`), `precisaDeReposicao`, `ESTOQUE_MINIMO_MAXIMO`, a altura/`contain-intrinsic-size` da
J2-A, `useProducts.ts`, `ModalVarianteGrade`, `LinhasDaGrade`, `PhoneSimulator`, `LocalBufferedInput.tsx`, o texto "Resetar Simulador".
Só o render confirma: os 5 "?" do formulário com 44px não empurram os títulos das seções no celular; o simulador em 11px a 360px; os cartões sem a sombra
morta (deve ficar idêntico — se mudar, a classe não estava morta).

## K-C · ficha-e-consultas (ROTINA)

- **Helper novo** `src/lib/papeis-aria-da-tabela.ts`: `export type PapelDeTabela = "table" | "rowgroup" | "row" | "columnheader" | "cell";`
  `export function papel(role: PapelDeTabela): { role: PapelDeTabela }` — com o comentário da causa (J5/J2-D: `display:block` apaga o papel; o espalhamento
  `{...papel("row")}` evita o "redundante" do eslint/biome). Apaga as duas cópias locais (`HistoricoCotacoesCard.tsx:15-24`, `AdminUserDetailView.tsx:67-77`) e
  importa nas duas; as chamadas `{...papel("…")}` ficam iguais. A catraca não pode subir (eslint 409 / biome 13 / warnings 1).
- `HistoricoCotacoesCard.tsx:303-305` `${log.response_time_ms}ms` → função local `tempoDeResposta(ms)`: falsy → "—"; `< 100` → "menos de 0,1 s"; senão
  segundos pt-BR com 1 casa + " s" (320 → "0,3 s", 1500 → "1,5 s"). Cabeçalho "Tempo" (L249) fica.
- `AdminUserDetailView.tsx`: ajuda L597-604 (padrão A3); L812 "Cesta / Pedidos" → **"Pedidos feitos"** (o número continua `pedidosQueContam.length`); L963
  "Fluxo Zerado" → **"Nenhum pedido ainda"** e L966 "Este cliente ainda não integralizou aquisições." → **"Quando este cliente comprar, os pedidos aparecem
  aqui."**; L1202-1203 "Variante Indisponível (ID: {item.variantId})" → **"Esta variação não existe mais"**, com o id só no `title` do selo. Toque: L634
  "Tentar novamente" `py-2` → `min-h-11`; L684 WhatsApp `h-10` → `h-11`; L1032 ícone de abrir pedido `size-8` → `size-11` + `aria-label="Abrir o pedido"`
  (a linha L991 continua sendo quem navega); L1075 "Limpar Carrinho" `h-7` → `min-h-11`.
- `AdminCustomersView.tsx`: ajuda L475-482 (padrão A3).
TDD: `tests/front/papeis-aria-da-tabela.test.ts` (falha primeiro: o módulo não existe) — `papel(r)` devolve `{ role: r }` para os 5 papéis; estático: os dois
arquivos não declaram `const papel =` e importam de `@/lib/papeis-aria-da-tabela`. `tests/front/ficha-e-consultas-acabamento.test.tsx` (harness de
`admin-user-detail-pedidos-que-contam` e `ficha-do-cliente-carrinho-no-celular`; histórico com o de `historico-de-consultas-no-celular`): (a) a ficha mostra
"Pedidos feitos" e não "Cesta / Pedidos", "Fluxo Zerado" nem "integralizou"; (b) item de carrinho com variante sumida mostra "Esta variação não existe mais" e
não "Variante Indisponível" nem "(ID:"; (c) WhatsApp `h-11`, "Limpar Carrinho" `min-h-11`, abrir pedido `size-11` com nome acessível, ajuda da ficha e de
Clientes `min-h-11 min-w-11`, "Tentar novamente" `min-h-11` (estado de erro); (d) histórico: 320 → "0,3 s", 1500 → "1,5 s", 40 → "menos de 0,1 s", 0 → "—", e
nenhum `/\d+ms\b/`. Atualizar `admin-user-detail-pedidos-que-contam.test.tsx` (L235, 263, 303, 328, 343: `numeroDoCard("Cesta / Pedidos")` →
`numeroDoCard("Pedidos feitos")`, só rótulo).
NÃO: `rotuloDoPapel`, `handleSort("role")`, `linkWhatsappDoCliente`, `handleClearUserCart`, LTV/ticket, `pedidosQueContam`, `motivoDaCotacao`,
`agruparRepeticoesDeErro`, `fetchLogs`, `buscarConfiguracaoDeFrete`; nome de arquivo novo com "frete"/"pedido"/"carrinho" (acende o revisor-risco à toa).
Só o render confirma: a linha de pedido da ficha com o ícone de 44px; "Esta variação não existe mais" no bloco do carrinho a 360px.

## K-D · frete-e-minha-loja (ROTINA)

- `TransportadorasCard.tsx`: "Ver serviços da conta"/"Atualizar lista" L1567-1578 → `min-h-11 px-2` (a linha "Serviços da conta" cresce para 44px);
  "Modo de teste" L1361-1376: a `<div>` da linha vira `<label className="flex min-h-11 cursor-pointer items-center justify-between gap-2">` com o `Switch`
  dentro (o `scale-75` e o desenho ficam; tocar no texto também liga/desliga — só muda o rascunho `sandboxEscolhido`, que grava no Salvar, L1138-1140;
  mesmo padrão das linhas de caixa de seleção do próprio cartão); caixas de seleção: os `<label>` das linhas L1205 e L1619 ganham `min-h-11` (a caixa
  `size-4` pode ir a `size-5`); campos L1420 e L1466 `h-9` → `h-11`; "Testar" L1430, "Tentar de novo" L1105, "Salvar" L1660 → `min-h-11`.
- `AdminShippingView.tsx`: ajuda L679-686 (padrão A3, `size-7`); botão Salvar L655 `py-2` → `min-h-11`.
- `PainelRecolhivel.tsx:74` `text-[9px]` → `text-[11px]` (régua 1 → 0).
- `AdminAboutStoreView.tsx`: Salvar L321 `h-10 … text-[10.5px]` → `min-h-11 … text-[11px]`, e no mesmo `className` `hover:bg-[#e3c25e]` →
  `hover:bg-admin-gold/90`, `focus-visible:ring-offset-[#09090b]` → `focus-visible:ring-offset-admin-bg` (token `admin-bg` existe em `tailwind.config.js:50`);
  "Prévia do que o cliente vê" L437 `text-[9px]` → `text-[11px]`. Régua esperada 6 → 2. O número decorativo L100 (`size-7`, não é botão) fica.
- `IdentitySettingsSection.tsx`: os `<Input>` de L108 (arquivo) e L159 (campos de texto/cor) recebem `className="h-11"`; "Usar também na abertura" L206:
  `<label className="flex min-h-11 cursor-pointer items-center gap-2 text-xs">` e a caixa com `className="size-5 accent-admin-gold"`.
TDD `tests/front/transportadoras-e-minha-loja-alvos-44.test.tsx` (estático por marcador + render onde já há harness — `transportadoras-expansivel`,
`identity-settings-section`): (a) o `<button` de "Ver serviços da conta" com `min-h-11`; (b) o `<label` que envolve "Modo de teste" com `min-h-11` e o
`Switch` dentro; clicar no texto chama a troca (render); (c) as duas `<label` de caixa de seleção com `min-h-11`; (d) `TransportadorasCard.tsx` sem `\bh-9\b`;
(e) Testar / Tentar de novo / Salvar do cartão e o Salvar de `AdminShippingView` com `min-h-11`; ajuda de Frete `min-h-11 min-w-11`; (f) render da identidade:
todo `input` de texto com `h-11`, o `<label>` de "Usar também na abertura" com `min-h-11`; (g) Minha loja: Salvar com `min-h-11` e `text-[11px]`, sem
`#e3c25e`/`#09090b` na tag; "Prévia do que o cliente vê" em `text-[11px]`; `PainelRecolhivel.tsx` sem texto < 11px.
NÃO: `onModoDeTesteMudou`/`atualizarRascunho`/a trava `disabled={ligado && !sandboxAtual}`, `buscarConfiguracaoDeFrete`, `NOME_DO_PROVEDOR` (exportado e lido
pelo histórico), `save()`, `updateConfig`, `useStoreIdentityEditor`, `ContatoDaLoja`, os blocos `Frete*Bloco.tsx` (caminho `*frete*`).
Só o render confirma: a linha "Modo de teste" e a de "Serviços da conta" com 44px não desalinham o cartão expandido; o `Input` de arquivo com `h-11` (botão
nativo "Escolher arquivo" centralizado).

## K-E · vidro-e-pedidos (ROTINA no conteúdo — **acende o revisor-risco pelo caminho**)

Os caminhos `*order*` (AdminOrdersView, AdminOrderCard, OrderStatusBadge, OrderDetail), `*devolu*` (AdminDevolucoesView, AcoesDaDevolucao), `*cartao*`
(CartaoDaAssinatura — falso alarme: é o cartão da assinatura do Início, só leitura) e `*frete*` (FreteResumoFaixa) ficam TODOS nesta frente para a onda
pagar UM revisor-risco. O revisor confere que o diff só troca classe/texto: nenhum `onClick`/`onChange`/`checked`/handler (`onRegistrarPagamento`,
`setConfirmadoPara`), consulta ou contrato muda.
- **Guarda nova** `tests/front/admin-glass-sem-classe-que-perde.test.ts` (estática, cabeçalho eslint-disable da régua): varre `src/views/admin/**` e
  `src/components/admin/**` (`.ts`/`.tsx`), troca linha de comentário por vazio (o `semComentarios` da régua), pega cada literal `"…"`, `'…'` e `` `…` `` que
  contém a palavra `admin-glass`, separa por espaço e reprova as classes SEM `:` que casam `^(bg-|border(-|$)|shadow(-|$)|backdrop-blur(-|$))`, menos
  `^border-(solid|dashed|dotted|double|none|hidden|collapse|separate|spacing)` e menos as redundantes `border`, `border-white/5`, `shadow-2xl`, `bg-zinc-950/40`,
  `backdrop-blur-2xl`. Exporta (no próprio teste) `classesQuePerdem(literal)` com casos unitários: redundantes → `[]`; `sm:border-x`/`group-hover:border-white/10`
  → `[]`; `border-y` → `["border-y"]`; `border-amber-500/20` → idem. Controle positivo: acha `admin-glass` em ≥ 20 arquivos. Exceções (lista que só desce,
  cada uma `{ arquivo, classe, motivo }`; uma exceção que não casa mais FALHA com "apague a exceção"): `src/views/admin/AdminLoginView.tsx` `border-b`
  (login = mapa de risco, fora da onda); e as **provisórias** `src/views/admin/AdminProductsView.tsx` `shadow-[0_20px_50px_rgba(0,0,0,0.3)]`, `shadow-lg`,
  `border-y` (motivo: "corrigidas pela frente produtos-acabamento; o integrador apaga estas três depois de integrar as duas" — pedido 2). Falha primeiro na
  base por `AlertasCancelados` (3), `AdminDevolucoesView` (1), `AcoesDaDevolucao` (1), `AdminSettingsView` (1).
- Correções da tabela do padrão "vidro": `AlertasCancelados.tsx` L199, L269, L307, `AdminDevolucoesView.tsx:236`, `AcoesDaDevolucao.tsx:256` (correção 1);
  `AdminSettingsView.tsx:239` (correção 2: sai `border-y` e o `sm:border-x` redundante).
- Toque: `AcoesDaDevolucao.tsx` L461 `<label className="flex items-start gap-2 …">` → `min-h-11`, caixa L470 `size-4` → `size-5` (é a confirmação "cancelei no
  Melhor Envio": `checked`/`onChange` intactos); `AdminSettingsView.tsx` ajuda L820-827 e `AdminOrdersView.tsx` ajuda L1559-1566 (padrão A3);
  `AdminOrderCard.tsx` "Marcar como recebido" L336 e "Desfazer" L323 `h-10` → `h-11`; `OrderDetail.tsx` "Desfazer" L952 `h-10` → `h-11` (o "Copiar" com
  `h-10` afirmado em `ficha-do-pedido-redesenho.test.tsx:897` NÃO muda).
- Letra: `AdminOrderCard.tsx` L166 (selo "Balcão") e L206 (contador sobre a foto, `min-w-5 leading-5`) `text-[10px]` → `text-[11px]`; `OrderStatusBadge.tsx`
  L98-99 e L380-381 `text-[10px]`/`text-[9px]` → `text-[11px]` (no compacto `tracking-widest` → `tracking-wider`; os badges só são desenhados no painel — a
  loja da cliente importa daqui apenas `paymentStatusKey`, lógica que não muda); `CartaoDaAssinatura.tsx` L52, 97, 161, 229, 235, 249, 261 → `text-[11px]`;
  `FreteResumoFaixa.tsx:71` `text-[10.5px]` → `text-[11px]`. Régua esperada: `AdminOrderCard` 2 → 0, `OrderStatusBadge` 4 → 0, `CartaoDaAssinatura` 7 → 0,
  `FreteResumoFaixa` 1 → 0; `AdminDevolucoesView` e `AcoesDaDevolucao` ficam 4 (o texto miúdo de Devoluções é onda L).
TDD: a guarda acima e `tests/front/selos-alvos-e-faixas-sem-letra-miuda.test.tsx`: (a) render de `AdminOrderCard` (harness de
`painel-botao-registrar-pagamento-recebido`): "Marcar como recebido" e "Desfazer" com `h-11`; `[data-testid="selo-canal"]` com `text-[11px]`; (b) render de
`OrderStatusBadge` e `PaymentStatusBadge` nos dois tamanhos: o `<span>` do rótulo com `text-[11px]`, sem 9/10px; (c) estático: o `<button` de "Desfazer" de
`OrderDetail.tsx`, as ajudas de Pedidos e Ajustes (`min-h-11 min-w-11`), a `<label` da confirmação em `AcoesDaDevolucao` (`min-h-11`); `CartaoDaAssinatura.tsx`
e `FreteResumoFaixa.tsx` sem texto < 11px. Atualizar só por classe: `payment-status-badge-compacto`, `admin-order-card-*`, `pedido-presencial-rotulos`.
NÃO: `exportarCsv`, `handleRegistrarPagamento`, `podeRegistrarPagamento`, filtros e consultas de `AdminOrdersView`, a L959 (contrato 22023), `statusConfig` /
`paymentStatusConfig` (textos e chaves), o "CSV" (P-J3), `FormasDePagamentoCard.tsx` (ver Fora), `src/index.css`, `AdminLoginView.tsx`.
Só o render confirma: âmbar/vermelho/ouro aparecendo nos avisos de cancelados e de devolução (é a mudança visual intencional); o selo compacto de 11px em
"Pedidos" a 360px (pode truncar — o `truncate` do L379 já existe); "Marcar como recebido" de 44px na linha do cartão.

## K-F · ajuda-e-inicio (ROTINA)

- Padrão A3 nos botões de ajuda: `AdminDashboardView.tsx:183-191`, `AdminQAView.tsx:1027-1034`, `AdminPushView.tsx:1020-1027` (`size-7`),
  `AdminBannersView.tsx:1991-1998`, `AdminCouponsView.tsx:290-297`, `AdminCarouselsView.tsx:533-541` (`size-9`, `rounded-[12px]`), `AdminReviewsView.tsx:550-557`,
  `AdminCrmView.tsx:190-198`. O `HelpCircle` de `AdminBannersView.tsx:4619` está dentro de um `<label>` (não é botão) e fica.
- Letra do Início: `AdminDashboardView.tsx` L177 e L221 → `text-[11px]` (régua 3 → 1, sobra a cor literal); `SerieDe14Dias.tsx` L180, L252, L261 →
  `text-[11px]` (régua 3 → 0); `PerfilDaLoja.tsx:106` → `text-[11px]` (1 → 0); `AdminCarouselsView.tsx:791` → `text-[11px]` (1 → 0).
TDD `tests/front/ajuda-e-inicio-letra-e-toque.test.ts` (estático): (a) nos 8 arquivos, todo `<HelpCircle` cujo elemento envolvente é `<button` está num botão
com `min-h-11 min-w-11` (falha hoje nos 8); (b) `SerieDe14Dias.tsx`, `PerfilDaLoja.tsx`, `AdminDashboardView.tsx` e `AdminCarouselsView.tsx` sem texto < 11px
fora de comentário. `serie-de-14-dias.test.tsx:220-230` ("pelo menos 9px, não `text-[8px]`") continua valendo com 11px; atualizar só se afirmar a classe antiga.
NÃO: textos dos guias, `toggleHelp`/`expandedHelp`, o conteúdo das folhas, `AdminBannersView` além do botão (teto 326 é onda própria), `CartaoDaAssinatura.tsx`
(é da K-E).
Só o render confirma: os rótulos de 11px do gráfico de 14 dias a 360px (14 colunas de ~20px: o valor acima da barra e o dia podem encostar — se encostar,
mostre o valor só na barra tocada/maior, sem voltar a < 11px); os cabeçalhos de Banners/Vitrines com o botão de 44px.

## Pedidos ao integrador (onda K)

1. Ordem de `integrar`: casca-e-pecas-comuns → ajuda-e-inicio → ficha-e-consultas → frete-e-minha-loja → produtos-acabamento → vidro-e-pedidos (por último: a
   guarda nova já encontra Produtos corrigido).
2. Depois de integrar vidro-e-pedidos: apagar as 3 exceções provisórias de `AdminProductsView.tsx` em `tests/front/admin-glass-sem-classe-que-perde.test.ts`
   (a guarda acusa "exceção que não casa mais"); fica só `AdminLoginView.tsx` `border-b`.
3. `ATUALIZAR_TETOS=1` nos dois testes de guarda, uma vez, depois de tudo integrado (só abaixa). Esperado na régua: `AdminProductsView` 49 → 27,
   `AdminProductFormView` 71 → 43, `AdminAboutStoreView` 6 → 2, `AdminDashboardView` 3 → 1, `CartaoDaAssinatura` 7 → 0, `SerieDe14Dias` 3 → 0, `OrderStatusBadge`
   4 → 0, `AdminOrderCard` 2 → 0, `PaginacaoAdmin` 1 → 0, `PerfilDaLoja` 1 → 0, `FreteResumoFaixa` 1 → 0, `PainelRecolhivel` 1 → 0, `AdminCarouselsView` 1 → 0;
   os demais iguais; nenhuma entrada nova. Jargão: nenhuma mudança esperada (`AdminProductFormView` segue 2). Glossário: nenhuma entrada nova.
4. Testes sem dono que montam telas tocadas (só rodam): `npx vitest run tests/front/portas-das-abas-nas-telas.test.tsx
   tests/front/titulos-pelo-nome-unico-telas.test.ts tests/front/titulos-pelo-nome-unico-abas.test.ts tests/front/admin-visual-telas-titulo-padronizado.test.tsx
   tests/front/admin-visual-frete.test.tsx tests/front/admin-ajustes-salao-e-porao.test.tsx tests/front/ajustes-identidade-e-horario-so-em-sobre-a-loja.test.tsx
   tests/front/frete-um-lugar-so.test.tsx tests/front/pedidos-numeros-do-topo.test.tsx tests/front/app-popstate-camada-antes-do-dirty.test.tsx
   tests/front/painel-avancar-rele-pedido-do-deep-link.test.tsx tests/front/admin-orders-guia-do-pagamento-que-nao-fechou.test.tsx
   tests/front/admin-limpar-campo-persiste-como-null.test.tsx tests/front/sino-do-painel-leva-as-notificacoes.test.tsx tests/front/crm-contraste-aa.test.tsx
   $(rg -l "AdminKpiCarousel|PaginacaoAdmin|ClientesDoCrm" tests/front | tr '\n' ' ')`.
5. `.lint-baseline.json` se a catraca cair. 6. `npm run build && npm run size` (o helper novo é minúsculo; nada muda de fronteira). 7. Reexecutar o harness de
   render (scratchpad, fora do repo) e medir: os 19 botões de ajuda, os pontos do carrossel, "Marcar como recebido", os campos de Frete/Minha loja/simulador,
   "Modo de teste", as caixas de seleção, "Ver serviços da conta", "Resetar Simulador" e as ações da ficha com ≥ 44x44; os textos da fila em ≥ 11px; o cabeçalho
   móvel sólido; o âmbar/vermelho/ouro dos avisos de cancelados e devolução.

## Fora desta onda (fila da onda L)

`FormasDePagamentoCard.tsx` (interruptores `scale-75` de 24x14 nas formas de pagamento na entrega e em crédito/débito, L183-188, L344-375 — caminho
`*pagamento*` e ligar crédito/débito é decisão de dinheiro do dono: onda própria com revisor-risco); `AdminLoginView.tsx:133` `border-b` perdido (exceção da
guarda; caminho `*login*`); texto < 11px que sobra (aba "Conceitos" do guia de Produtos 27, formulário de produto 43, `AdminBannersView` 326, `AdminPushView` 47,
`AdminReviewsView` 39, `AdminCouponFormView` 22, `AdminCouponsView` 19, `PhoneSimulator` 37, `VozClienteTab` 9, `ModalVarianteGrade` 7, `LinhasDaGrade` 6,
`AdminNotificationsView` 6, `QuemPodeUsarOCupom` 5, Devoluções (`AcoesDaDevolucao` 4, `DetalheDaDevolucao` 3, `SelosDaDevolucao` 2, `CartaoDaDevolucao` 1,
`AdminDevolucoesView` 1), `LocalBufferedInput` 2 (erro de 10px, componente comum do admin), `StrategicIntelligenceBlocks` 2, `AdminErrorState` 1,
`OrderReceipt` 1, `FluxoDeCaixaGrafico` 1, os círculos de 17px de `FreteGratisBloco`/`EstrategiaNacionalBloco`); toque do "Novo Banner" no cabeçalho
(`AdminLayout.tsx:1141`, `py-1`); campo de CEP `h-10` de `FreteLocalBloco.tsx:170` e botões `py-2` de `FreteNacionalBloco.tsx` (caminho `*frete*`); a cópia
dupla de `percentualComUmaCasa` (consolidar com `formatarPercentual` depois de escolher o sinal de menos); cabeçalhos `psql -1 -f` dos `rollback-manual-*`
(decisão do dono).
