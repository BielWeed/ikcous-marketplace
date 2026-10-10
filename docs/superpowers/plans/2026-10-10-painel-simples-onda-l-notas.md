# Painel simples — Onda L (alvos de 44px e letra de 11px que restaram)

Manifesto: `docs/superpowers/lanes/2026-10-10-painel-simples-onda-l.json` (12 frentes disjuntas, `frente.mjs validar` verde; só front: nenhuma toca
banco, edge, regra de dinheiro, auth ou service worker). Base: `claude/oi-uunug6` @ `5d44b562` (onda K integrada, CI 15/15). Regras gerais: as de
`2026-10-10-painel-simples-onda-j-notas.md`, `…-onda-j2-notas.md` e `…-onda-k-notas.md` (leia a K: "Correção de premissa", "Regras para TODAS as
frentes", "Padrão A3", "Padrão vidro"), com o que está abaixo. As linhas citadas são da base `5d44b562` (confira com `rg -n` antes de editar: elas vêm de
mapas feitos por leitura, sem renderizar).

## Origem

Medida no Chromium simulado (360x740 e 412x915, dados fictícios; NÃO é aparelho real) sobre a onda K integrada, mais a lista de texto abaixo de 11px que a
régua ainda conta. Alvos de toque que restaram: Ajustes (linhas de grupo 302x40, termômetro do PIX 334x37), Frete (cabeçalhos recolhíveis 328x30,
interruptores, caixas de seleção 20x20), ficha do cliente (abas 148x36, copiar 26x26, código 54x21), Produtos (abas do guia 148x40), seletor de setor
do formulário (328x36), Compartilhar do Início (40x44).

## Regras para TODAS as frentes

- **Letra:** `text-[<11px]` vira `text-[11px]` (nunca menos). Onde a mesma tag tem `uppercase` + `tracking-widest`/`tracking-[0.2em]`/`tracking-[0.3em]` e a
  caixa tem largura fixa, `truncate`, `whitespace-nowrap`, `w-`/`h-`/`size-` fixo ou `leading-none`, troque o tracking por `tracking-wider` (ou
  `tracking-[0.12em]`) e confira a caixa lendo o contexto; nunca esconda texto com `truncate` onde antes cabia. Pílulas/selos com `p-0.5`..`1.5` ficam como
  estão (a caixa cresce com o texto).
- **Toque:** o `<button>`/`<label>`/`<input>` vira (ou fica dentro de) uma área de `min-h-11` (e `min-w-11` quando a largura é do ícone). O desenho visível pode
  continuar menor (Padrão A3 da onda K: `<button>` envoltório de 44px, círculo no `<span aria-hidden>` interno, `hover:` vira `group-hover:`; `onClick`, `title`,
  `aria-*` e `type` ficam no `<button>`; o botão sem texto visível precisa de `title` ou `aria-label`).
- `src/components/ui/**` é COMPARTILHADO com a loja da cliente: SÓ leitura (use `className` local; o `cn` usa tailwind-merge, então `min-h-11` vence `h-9`;
  `Switch`/`Button`/`Select`/`Tabs`/`Input` aceitam `className`). Também só leitura: `src/index.css`, `src/lib/glossario-do-painel.ts`, tetos `.json`.
- **Cores literais (`#09090b`, `#FFBF00`, `#e3c25e`, `#e2c04a`) e `fixed inset-0` sem `role="dialog"` NÃO entram nesta onda** (a régua os conta junto, por isso o teto
  de alguns arquivos não zera). Única exceção: `AdminDashboardView.tsx` (frente inicio-e-pecas-comuns), onde o literal vira o token. `PhoneSimulator.tsx`
  (réplica da loja) fica FORA da onda.
- **Tetos só descem; NÃO rode `ATUALIZAR_TETOS` nem edite `regua-visual-do-painel.json`/`painel-sem-jargao.teto.json`.** A régua falha quando a contagem fica
  ABAIXO do teto ("baixe o teto para N"); na prova da frente ela pode sair vermelha SÓ com linhas "baixe o teto" de arquivos da própria posse, nos números
  esperados da sua seção (relate o número real). Qualquer linha de `excedentes` (subiu) reprova. O integrador regrava uma vez no fim.
- Nenhum export muda de assinatura; nenhum `onClick`/`onChange`/`checked`/handler/consulta muda; atualizar teste existente só troca rótulo, formato, classe
  ou seletor (asserção de comportamento não sai).
- **TDD:** teste novo (nome na sua posse) que FALHA primeiro, por achar o elemento e reprovar a classe de hoje (não vácuo). Teste estático que lê fonte copia o
  cabeçalho `/* eslint-disable security/detect-non-literal-fs-filename, security/detect-unsafe-regex -- … */` com motivo (veja
  `tests/front/ajuda-e-inicio-letra-e-toque.test.ts`); sem ele a catraca do eslint sobe. Biome: `noExportsInTest` é erro (não exporte de teste).
- **Prova escopada** (UMA rodada): `npx vitest run <seus testes> tests/front/painel-sem-jargao.test.ts tests/front/regua-visual-do-painel.test.ts`;
  `npm run typecheck`; `CI=true npm run lint:ratchet` (eslint **408** / biome 13 / 1 — não sobe); `npx biome format --write <arquivos tocados>`;
  `node scripts/paralelo/frente.mjs conferir`; commit só por `frente.mjs commitar`. **Há 12 frentes rodando juntas: a máquina fica carregada.** Timeout
  `Hook timed out in 10000ms` no `beforeAll` é carga: rode o arquivo sozinho (`npx vitest run <arquivo>`), não é falha; nunca suba o timeout nem pule teste.
- jsdom não aplica CSS: a prova de layout é por classe; a medida real é do render do integrador. No relatório, liste "o que só o render confirma".
- Se encontrar um teste fora da sua posse que quebra só por seletor/classe, NÃO edite: descreva no relatório (PEDIDO, com arquivo:linha e a troca exata).

## ajustes-e-pagamentos (L1) — risco pelo caminho (`*pagamento*`, `*mercado*`); conteúdo só classe

- `AdminSettingsView.tsx` ~L386, `SecaoColapsavel` (`<button type="button" … aria-expanded={aberta} className="group flex w-full items-center justify-between gap-3 text-left">`):
  acrescente `min-h-11` (uma classe cobre os 4 grupos: Formas de pagamento, Mercado Pago, Trocas e devoluções, Minha loja está no ar). NÃO mude o
  elemento nem `aria-expanded` (os testes acham o cabeçalho por `button[aria-expanded]`). O cabeçalho "Diagnóstico de Conexão" (~L203-207) ganha `min-h-11`.
- `StatusPagamentoPix.tsx` ~L94-99 (`<button … aria-expanded={aberto} className="flex w-full … px-4 py-2.5 …">`, mede 37px): `min-h-11`.
  Confira com `rg` quem importa (Ajustes; o mapa não confirmou imports em `LojaProntaEEstoqueBaixo`/`CheckoutView`) — se importar, a mudança vale lá também (ok, só altura).
- `FormasDePagamentoCard.tsx`: os `Switch` (~L183-189 as 3 formas na entrega; ~L344-357 Crédito; ~L361-374 Débito, todos `className="scale-75 data-[state=checked]:bg-admin-gold"`)
  ficam dentro de `<label className="flex min-h-11 cursor-pointer items-center justify-between gap-2">` no lugar do `<div>` da linha (mesmo padrão de
  `TransportadorasCard` "Modo de teste": o texto vira rótulo clicável; o `aria-label` do Switch continua). Com o `disabled` do Switch o clique no label não deve
  mudar nada (já é o comportamento do botão desabilitado). O `<select id={idDasParcelas}>` (~L390-413) ganha `min-h-11`. NÃO mude o botão "Configurar
  credenciais" (~L160-166): `pagamentos-status-uma-vez.test.tsx:270-272` pega `parentElement` dele.
- `MercadoPagoSection.tsx` (nenhum `min-h-11` hoje): cabeçalho do `Expansor` (~L240-245) `min-h-11`; botões "Tentar de novo" (~L721), "Copiar prompt" (~L822),
  "Salvar chaves" (~L937), "Testar conexão" (~L951 e ~L1151), "Desligar/Ligar o pagamento pelo app" (~L1014), "Pausar" (~L1058), "Retomar" (~L1079) →
  `min-h-11`; os 3 `<input>` `h-9` (Public Key `mp-public-key`, Access Token `mp-access-token`, `mp-webhook-secret`) → `h-11`. Mantenha `data-estado-recebimento`
  e o cabeçalho do Avançado como `:scope > button[aria-expanded]` dentro da `section`.
- NÃO: `PoliticaDeDevolucaoSection.tsx` (fora da posse), textos/chaves de `mercado-pago-conteudo.ts`, a lógica de salvar/testar/ligar.
- Teste novo: `ajustes-alvos-de-toque-l.test.tsx` (estático por marcador, modelo `transportadoras-e-minha-loja-alvos-44.test.tsx`): cabeçalho da
  `SecaoColapsavel` com `min-h-11`; botão do PIX com `min-h-11`; `<label>` com `min-h-11` envolvendo cada Switch das formas/crédito/débito; `<select>` das
  parcelas com `min-h-11`; botões/inputs listados do Mercado Pago. Render onde já houver harness: clicar no texto "Crédito" liga o Switch uma vez.
- Só o render confirma: a linha dos grupos com 44px não desalinha o ícone `size-10`; as linhas das formas de pagamento a 360px.

## frete-e-identidade (L2) — risco pelo caminho (`*frete*` nos blocos); conteúdo só classe

- `PainelRecolhivel.tsx` ~L49-61 (`<button … className="group flex w-full flex-wrap … border-b border-white/10 pb-3.5 text-left">`, 328x30): `min-h-11`
  (vale para as 6 instâncias em `AdminShippingView.tsx` L719-945). O `pb-3.5`/`border-b` ficam (desenho da linha).
- `primitivas-direcao-d.tsx` ~L138-150, `Chave` (`<button role="switch" … className="inline-flex cursor-pointer items-center …">`, 46x26): `min-h-11` (a área de toque), mantendo `role`,
  `aria-checked`, `aria-label` e o pino interno (L118-129). Testes dependem de `[role="switch"][aria-label=…]`.
- `TransportadorasCard.tsx`: "Modo de teste" (~L1364-1388) já é `<label min-h-11>` com o Switch `scale-75` dentro; as 2 caixas `size-5` (~L1212 e ~L1629) já estão em label
  `min-h-11` — o alvo do input em si é 20x20: dê ao `<input>` área de 44 sem engordar o desenho (ex.: o label já tem 44; se a medida é do input, use
  `size-5` dentro de um `<span>` de `min-h-11 min-w-11` ou deixe o label como alvo e documente). **Se mudar `size-5`, atualize
  `transportadoras-e-minha-loja-alvos-44.test.tsx` (está na sua posse).** "Salvar ligados" (~L1228-1237) → `min-h-11`.
- `AdminShippingView.tsx`: "Conectar transportadora" (~L799-805) → `min-h-11`; o link "Pedidos" dentro do `<p>` (~L920-926) é link de texto: `inline-flex min-h-11 items-center`
  só se não quebrar o parágrafo (senão deixe e diga).
- `FreteLocalBloco.tsx` ~L170: campo de CEP `h-10` → `h-11`. `FreteNacionalBloco.tsx` botões `py-2`/`py-1` (~L160, ~L169, ~L220, ~L296, ~L322) → `min-h-11`.
  `EstrategiaNacionalBloco.tsx`: pílulas `role="radio"` (~L199-215 e ~L320-336) e "Limitar à mais barata" (~L346) → `min-h-11`; `FreteGratisBloco.tsx` radios
  (~L122-133) `min-h-11`; os círculos `✓` `size-[17px] … text-[10px]` (`FreteGratisBloco.tsx:137`, `EstrategiaNacionalBloco.tsx:158`) → `text-[11px]` e `size-5`.
- `IdentitySettingsSection.tsx`: cada `<Button>` sem `className` (L85-91 "Tentar novamente"; L295-306 "Retirar referência"; ~L327 alternância de papel; L370 "Cancelar envio";
  L382-390 "Conferir configuração atual"; L425-432 par do conflito; L446 "Salvar identidade"; L456 "Descartar alterações"; L477 "Sim, descartar rascunho"; L487 "Continuar editando")
  → `className="min-h-11"`. A caixa "Usar também na abertura" (~L207-217): mesma observação das caixas (label já `min-h-11`).
- NÃO: `src/components/ui/switch.tsx`, `onModoDeTesteMudou`, a trava `disabled={ligado && !sandboxAtual}`, `buscarConfiguracaoDeFrete`, `NOME_DO_PROVEDOR`, `save()`,
  `useStoreIdentityEditor`; `h-9` proibido em `TransportadorasCard` (teste existente).
- Régua esperada: `EstrategiaNacionalBloco` 1→0 e `FreteGratisBloco` 1→0 (chaves somem).
- Teste novo: `paineis-e-blocos-alvos-de-toque-l.test.tsx` (estático): `PainelRecolhivel` com `min-h-11`; `Chave` com `min-h-11`; `FreteLocalBloco` sem `h-10` no CEP;
  botões listados com `min-h-11`; `Button`s da Identidade com `min-h-11`; sem `text-[<11px]` nos blocos.
- Só o render confirma: os 6 cabeçalhos do Frete a 360px; a `Chave` de 46x26 dentro da linha com 44px.

## ficha-do-cliente (L3) — rotina

- `AdminUserDetailView.tsx`: as 4 abas `<TabsTrigger` (~L896, L907, L918, L929; `className="flex items-center justify-center gap-1.5 rounded-xl py-2.5 text-[11px] …"`) → `min-h-11`
  em cada (vence o `h-[calc(100%-1px)]` do primitivo; `ui/tabs` não muda). "Copiar e-mail" (~L711-722) e "Copiar telefone" (~L741-752) (`shrink-0 rounded-md p-1.5 …`, 26x26,
  sem `type`) → `flex min-h-11 min-w-11 items-center justify-center` + `type="button"` + `aria-label` igual ao `title`; a linha pai pode crescer (aceitável). O botão do
  código do cliente (~L604-618, `px-2 py-0.5 font-mono text-[11px]`, copia o ID) → `min-h-11`. Mantenha os rótulos Ped./Carr./End./Voz e
  "Pedidos/Carrinho/Endereços/Voz do Cliente" (testes acham as abas por `[role="tab"]` + texto).
- `VozClienteTab.tsx` (9, nenhum commit da K): `text-[8px]/[9px]/[10px]` → `text-[11px]` em ~L123 (Badge: o className local sobrescreve o `text-xs` do `ui/badge`), L128, L137, L145,
  L175, L188, L250 (botão "Tentar novamente": também `min-h-11`), L272, L281.
- NÃO: `handleCopy`, `handleClearUserCart`, `rotuloDoPapel`, `handleSort`, `linkWhatsappDoCliente`, LTV/ticket, as ações já corrigidas na K (WhatsApp `h-11`, abrir pedido `size-11`).
- Régua esperada: `VozClienteTab` 9→0 (a chave some). `AdminUserDetailView` não está no JSON (0).
- Teste novo: `ficha-alvos-e-letra-l.test.tsx` (render com o harness de `ficha-e-consultas-acabamento` + estático): as 4 abas `min-h-11`; botões de copiar `min-h-11 min-w-11`
  e com nome; botão do ID `min-h-11`; `VozClienteTab` sem texto <11px.
- Só o render confirma: abas 2x2 a 360px com 44px; a linha de e-mail/telefone com o botão maior.

## produtos-guia (L4) — rotina

- `AdminProductsView.tsx`: abas do guia `<button … onClick={() => setHelpTab("concepts")}` (~L966, "Dicionário") e `setHelpTab("simulator")` (~L979, "Simulador"), className
  `"flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-[11px] …"` → `min-h-11`. Aba "Conceitos" (entre `{helpTab === "concepts" ? (` ~L996 e
  `/* Simulador de Lucratividade */` ~L1207): as 27 ocorrências (~L1000-1194; h4 `text-[10px]` (2), parágrafos `text-[10px]` (6), subtítulos `text-[9px]` (3), caixas
  `font-mono text-[9px]` (6), rótulos `text-[8px]` (10)) → `text-[11px]` (caixas mono: confira que não estouram; troque tracking se necessário).
- **Atualize `tests/front/produtos-letra-e-toque.test.tsx` (caso "d")**: hoje varre FORA do trecho de Conceitos e o título diz "só sobra na aba Conceitos… onda L"; passe a varrer o
  arquivo TODO (zero) e corrija o título. Mantenha os dois marcadores textuais enquanto algum caso os usar. Mantenha os textos "Dicionário"/"Simulador" (`produtos-cabem-no-celular.test.tsx:387` acha o botão por `textContent`).
- NÃO: cálculo, `precisaDeReposicao`, a altura/`contain-intrinsic-size`/esqueleto da J2-A, `useProducts.ts`, `percentualComUmaCasa`, o `admin-glass` dos esqueletos.
- Régua esperada: `AdminProductsView` 27→0 (a chave some).
- Teste novo: `produtos-guia-letra-e-toque-l.test.tsx` (estático): abas do guia `min-h-11`; arquivo sem texto <11px.

## formulario-de-produto (L5) — rotina

- `AdminProductFormView.tsx` (4896 linhas). Seletor de setor `SelectTrigger id="product-category"` (~L3625, `className="h-auto w-full … py-3 … sm:py-5"`): o `data-[size=default]:h-9` do
  `ui/select.tsx` vence o `h-auto` (variante com atributo) → acrescente `min-h-11` (min-height vence height). "Tirar Foto": `<label htmlFor="product-image-capture">` do estado vazio (~L3208-3217,
  `px-4 py-3 text-[10px] …`) → `min-h-11 text-[11px]`; com fotos (~L3085 `size-10` câmera, ~L3104 `size-10` upload) → `size-11` (`title` ficam). "Visualizar App" (~L4594-4604, FAB) só a letra
  (~L4602) → `text-[11px]`. Botões "Tentar de novo"/"Remover" da foto com falha (~L3382, ~L3389, `px-3 py-1.5 text-[10px]`) → `min-h-11 text-[11px]`. Botão "Recarregar" do erro
  de carga (~L2201, `px-4 py-2 text-[9px]`) → `min-h-11 text-[11px]`. Chips de atributo do modal de variante (~L2477) e "+ Atributo" (~L2563) → `min-h-11`. Botões editar/ligar/excluir da lista
  de variações (`VariantItem`, ~L4864, ~L4878, ~L4889, `size-8`) → `size-11` (mantenha os `aria-label`: `admin-product-form-desligar-e-religar-variacao-na-linha` usa o de ~L4873).
- Os 39 textos <11px por trecho: erro de carga (~L2192, 2195, 2201); modal Nova Categoria (~L2322); modal Nova Variante (~L2431, 2477, 2563, 2769, 2799, 2836);
  cabeçalho (~L2935 [2 ocorrências: `text-[9px] … md:text-[10px]`], 2944, 2953); fotos (~L3211, 3292, 3310 [tooltip só no hover], 3349, 3382, 3389); folhas de ajuda inline
  (Guia de Fotos ~L3411, 3416, 3420, 3442; Guia de Cadastro ~L3491, 3496, 3500; Guia de Custos ~L4127, 4132, 4136); cartão de lucro/margem (~L4344, 4361, 4375, 4389: `text-[9px] sm:text-[11px]`);
  Visualizar App (~L4602); AdminHelpModal (~L4641, 4699); lista de variações (~L4839 `text-[7px]` "Offline", ~L4844). Rode `rg -n "text-\[(6|7|8|9|10|10\.5)(\.[0-9]+)?px\]" src/views/admin/AdminProductFormView.tsx` para a lista viva
  (a régua conta decimais; `5.5px` não conta).
- **Atualize** `produto-formulario-letra-e-toque.test.tsx` (caso "d": tire a exceção do `htmlFor="product-image-capture"` e o comentário "onda L") e
  `produto-formulario-no-celular.test.tsx` se alguma asserção de classe mudar. NÃO: SKU, `ESTOQUE_MINIMO_MAXIMO`, `aria-invalid`/`aria-describedby` do estoque mínimo, cálculos, `useProducts`, a lógica de upload/toast.
- Régua esperada: 43→4 (sobram 3 `fixed inset-0` sem dialog em ~L2303, ~L2416, ~L4774 e 1 cor em ~L2176 — NÃO tratar).
- Teste novo: `formulario-produto-letra-e-toque-l.test.tsx` (estático): o arquivo não tem `text-[<11px]`; o trigger do setor com `min-h-11`; "Tirar Foto" `min-h-11`;
  botões da lista de variações `size-11`. Só o render confirma: o cabeçalho/FAB a 360px; o seletor de setor com 44px; a lista de variações com botões maiores.

## grade-do-produto (L5b) — rotina

- `ModalVarianteGrade.tsx` (6 texto + `fixed inset-0` ~L391 que NÃO se trata): ~L404, 421, 461 (chip de atributo `px-2.5 py-1 rounded-full text-[9px]` → também `min-h-11`), 495, 534 (botão "+ Atributo" `px-5 py-3 text-[10px]` →
  `min-h-11 text-[11px]`), 541. `LinhasDaGrade.tsx` (6): ~L62, 95 (botão "Aplicar para todas" `px-5 py-3` → `min-h-11`), 99, 108, 124, 169.
- Régua esperada: `ModalVarianteGrade` 7→1, `LinhasDaGrade` 6→0 (a chave some). Nenhum teste dedicado lê esses arquivos (cobertos por `admin-product-form-grade-*`: rode-os).
- Teste novo: `grade-do-produto-letra-e-toque-l.test.tsx` (estático): sem texto <11px; chips e botões listados `min-h-11`.

## inicio-e-pecas-comuns (L6) — rotina

- `PerfilDaLoja.tsx` ~L102-112 (Compartilhar, `relative flex min-h-11 shrink-0 … px-3 …`; a 360px o texto é `sr-only xs:not-sr-only` e o botão mede 40x44): acrescente `min-w-11`. O
  `<span … aria-hidden="true">Compartilhar</span>` fica (o teste de nome acessível exige).
- `AdminDashboardView.tsx` ~L157: `bg-[#09090b]` → `bg-admin-bg` (token equivalente a `hsl(240 10% 3.9%)` ≈ #09090b; existe em `tailwind.config.js:50`). Régua: 1→0 (a chave some).
- `LocalBufferedInput.tsx` ~L205 e ~L329: a mensagem de erro `text-[10px]` → `text-[11px]` (componente comum a ~12 telas: rode os testes dos formulários que o usam:
  `rg -l "LocalBufferedInput" tests/front` e os `produto-*`, `admin-product-form-*`, `minha-loja-*`, `push-*`, `form-do-cupom-*`). `AdminErrorState.tsx` ~L37 (botão `h-10 … text-[10px]`) → `min-h-11 text-[11px]` (troque `h-10` por `min-h-11`).
- Régua esperada: `LocalBufferedInput` 2→0, `AdminErrorState` 1→0 (chaves somem).
- Teste novo: `inicio-e-pecas-letra-e-toque-l.test.tsx` (estático): Compartilhar `min-w-11`; Dashboard sem `#09090b`; `LocalBufferedInput`/`AdminErrorState` sem texto <11px;
  `AdminErrorState` botão `min-h-11`. Estenda `ajuda-e-inicio-letra-e-toque.test.ts` só se fizer sentido (Compartilhar `min-w-11`).

## banners (L7) — rotina; ARQUIVO GRANDE (5083 linhas)

- `AdminBannersView.tsx`: a régua conta 326 = 166 texto + 160 cor literal. **Só os 166 de texto entram** (cores ficam). Histograma do texto: 6px (1), 7px (10), 7.5px (32), 8px (24), 8.5px (26), 9px (26),
  9.5px (13), 10px (28), 10.5px (6). Regex da régua: `/text-\[(?:[6-9]|10)(?:\.\d+)?px\]/g` (conta `md:text-[9px]` também; NÃO conta `5.5px` nem `11px`).
- **Fora (não suba):** as miniaturas de celular do formulário (linhas ~2772, 2807, 2853, 2906, 3993, 4028, 4074, 4127: `text-[9px]`/`text-[7px]`) e a pré-visualização ao vivo do banner (~L2430-2601,
  8 ocorrências: ~2435, 2443×2, 2478, 2524, 2559, 2575×2): são desenhos de outra tela e subir distorce a proporção. Eles continuam contando na régua.
- Ordem de edição sugerida (seções contíguas): helpers/estado (1-1969) → lista/KPIs (1970-2290) → formulário/stepper (2291-2601) → modo simples (2602-2971) → Passo 1 (2972-3253) → Passo 2
  (3254-3973) → Passo 3 (3974-4870) → rodapé/guia (4871-5022). Os 106 pontos `uppercase`+`tracking-*` que sobem de 7-8.5px para 11px são o maior risco de estouro: use `tracking-wider`/`tracking-[0.12em]`;
  onde há `truncate`/`whitespace-nowrap`/`line-clamp`/`h-N` fixo (14+8 pontos) confira. Dica: faça por regex com revisão manual do diff (`git diff --stat` + leitura), não às cegas.
- Nenhum teste afirma classe `text-[Npx]` aqui. Rode: `admin-banners-*`, `banners-modo-lembrado`, `ajuda-e-inicio-letra-e-toque`, `admin-visual-telas-titulo-padronizado`,
  `guarda-de-cor-sai-junto-com-a-escrita` (whitelist `primaryColor` do arquivo = 1; NÃO adicione `primaryColor`), `titulos-pelo-nome-unico-telas`. NÃO mude textos de tela (jargão: teto 1).
- Régua esperada: 326 → ~176 (160 cor + as ~16 das miniaturas/pré-visualização); relate o número real. Teste novo: `banners-letra-l.test.tsx` (estático): fora das
  linhas das miniaturas/pré-visualização (delimite por comentário/estrutura que você identificar), o arquivo não tem `text-[<11px]`; o total cai ao número relatado.
- Só o render confirma: o formulário em 3 passos a 360px (rótulos de 11px nas pílulas), o modo simples, a lista de banners.

## avisar-clientes (L8) — rotina

- `AdminPushView.tsx` (1905 linhas; 43 texto + 4 cor): 9px (~L110, 119, 1011, 1035, 1065, 1177, 1212, 1269, 1282, 1293, 1386, 1477, 1532, 1592, 1596, 1648, 1687, 1824), 10px (~L250, 293, 998, 1007, 1070, 1159, 1310, 1441,
  1606, 1618, 1660, 1684, 1768, 1776, 1805, 1847), 8px (~L1181, 1216, 1403, 1640, 1671, 1690), **9.5px (~L239, 267, 270: prévia da notificação do SO)** → `text-[11px]`. Riscos: `truncate` ~L267, 1065, 1386, 1690; `leading-none`
  ~L1282, 1310, 1768, 1776; `line-clamp-1` ~L1684, 1687; badge `size-3` ~L1070 e `size-4` ~L1159 (círculos com texto: aumente o círculo ou deixe sem texto <11).
- NÃO: textos de tela (jargão), lógica de envio/segmentos, `LocalBufferedInput`. Cores (~L977, 981, 1553) ficam. Testes a rodar: `admin-push-*`, `push-*`, `admin-visual-canais-avisar`, `sino-*`, `admin-push-cabecalho-nao-estoura-no-mobile`.
- Régua esperada: 47 → 4. Teste novo: `avisar-clientes-letra-l.test.tsx` (estático): arquivo sem `text-[<11px]`.

## avaliacoes-e-notificacoes (L9) — rotina

- `AdminReviewsView.tsx` (36 texto + 3 cor): 9px (~L398, 403, 573, 582, 629, 644, 733, 871, 996, 1048, 1240, 1292, 1298, 1393), 10px (~L573 e 582 `sm:text-[10px]`, 878, 896, 911, 945, 972, 986, 1001, 1007, 1041, 1099, 1107,
  1142, 1208, 1216, 1231, 1346, 1493), 8px (~L587, 1201, 1329) → `text-[11px]` (L573 e L582 têm DUAS ocorrências: `text-[9px] … sm:text-[10px]`). Riscos: abas/filtros `whitespace-nowrap` ~L629, 644; pílula `truncate` ~L1216; `line-clamp-2` ~L1231;
  `leading-none` ~L896; botões de ação `px-5 py-3` (~L972-1142) crescem de altura (ok).
- `AdminNotificationsView.tsx` (4 texto + 2 cor): ~L105 (9px, `leading-none tracking-widest` com `max-w`), L144, L147, L188 (10px) → `text-[11px]`.
- Cores (~L536, 539, 1551; ~L174, 175) ficam. NÃO mudar textos de tela. Testes a rodar: `admin-reviews-*`, `perguntas-e-avaliacoes-alternam`, `moderacao-ativa-e-real`, `admin-notifications-view`, `titulos-pelo-nome-unico-telas`.
- Régua esperada: Reviews 39→3, Notifications 6→2. Teste novo: `avaliacoes-e-avisos-letra-l.test.tsx` (estático).

## cupons (L10) — rotina (o assunto é dinheiro, o diff é só classe)

- `AdminCouponFormView.tsx` (19 texto + 3 cor): 9px (~L374, 395, 463, 543, 560), 10px (~L392, 475, 483, 509, 530, 583, 611, 637, 688, 725, 732), **6px ~L428** (pílula `rounded-full px-2 py-0.5 text-[6px] tracking-widest` → 11px: use
  `tracking-wider` e deixe a pílula crescer), **7px ~L441, 451** (bilhete do cupom, `tracking-widest`). Alternador segmentado ~L543, 560 (`flex-1 … text-[9px]`). Os botões ~L725, 732 (`h-11 flex-1`) NÃO mudam de altura.
- `AdminCouponsView.tsx` (13 texto + 6 cor): 9px (~L305, 317, 370, 676, 693, 697, 728), 10px (~L532, 763), 8px (~L599 [selo do alcance, classes vêm de `classesDoSeloPorRotulo`], 623, 647, 657). Selos ficam legíveis, caixa cresce.
- Os recortes circulares do bilhete (`size-5`/`size-7` com `bg-[#09090b]`) e as cores ficam. NÃO mudar textos/rótulos (testes de selos leem o texto). Rode: `admin-coupons-view-*`, `admin-coupon-form-view-minimo-com-centavos`,
  `admin-cupom-*`, `form-do-cupom-edita-pelo-id-da-rota`, `um-toast-so-ao-falhar-o-save-do-cupom`, `status-do-cupom`.
- Régua esperada: CouponForm 22→3, Coupons 19→6. Teste novo: `cupons-letra-l.test.tsx` (estático).

## telas-sensiveis (L11) — **risco pelo caminho** (`*login*`, `*devolu*`, `*cartao*`, `*order*`, `*cupom*`); conteúdo só 10px→11px

- `AdminLoginView.tsx` (6 texto, todos 10px `uppercase tracking-widest`/`tracking-[0.2em]`/`[0.3em]`: ~L136, 140, 159, 169, 187, 227): `text-[11px]`; ~L227 (botão `py-5 tracking-[0.3em]`) e ~L136/L140
  (cabeçalho `justify-between`) com `tracking-wider` se estourar. **NÃO mexa em `border-b` nem em classes de `admin-glass`** (exceção permanente da guarda) nem em nenhum texto/handler de login.
- `AdminDevolucoesView.tsx` ~L196 (contador do chip, 10px); `AcoesDaDevolucao.tsx` ~L53, 258, 590, 608; `DetalheDaDevolucao.tsx` ~L39, 302 (`aspect-square p-2 text-center text-[10px]`);
  `SelosDaDevolucao.tsx` ~L31, 48 (`shrink-0 … tracking-widest`); `CartaoDaDevolucao.tsx` ~L64; `OrderReceipt.tsx` ~L120 (nota do recibo impresso); `QuemPodeUsarOCupom.tsx` ~L141, 201, 262, 274, 288 → `text-[11px]`.
  Cores e `fixed inset-0` (Devoluções ~L302, ~L151; Detalhe ~L93) ficam.
- O diff NÃO pode mudar nenhum handler, `checked`/`onChange`, condição de habilitar botão, consulta, contrato, texto de aviso de dinheiro nem chave de status. Rode: `devolucao-*`, `painel-botao-registrar-pagamento-recebido`,
  `recibo-impresso-*`, `quem-pode-usar-o-cupom`, `admin-cupom-quem-pode-usar`, `admin-login-*`, `auth-mensagem-traduzida`, `admin-glass-sem-classe-que-perde`, `selos-alvos-e-faixas-sem-letra-miuda`.
- Régua esperada: Login 7→1, Devoluções view 4→3, Detalhe 3→1, Acoes 4→0, Selos 2→0, Cartao 1→0, OrderReceipt 1→0, QuemPode 5→0.
- Teste novo: `telas-sensiveis-letra-l.test.tsx` (estático): os 8 arquivos sem texto <11px (exceto o que a régua ainda conta como cor/fixed, que não é texto).

## Pedidos ao integrador (onda L)

1. Ordem de `integrar`: inicio-e-pecas-comuns → ficha-do-cliente → produtos-guia → grade-do-produto → formulario-de-produto → avisar-clientes → avaliacoes-e-notificacoes → cupons → banners →
   ajustes-e-pagamentos → frete-e-identidade → telas-sensiveis.
2. `ATUALIZAR_TETOS=1 npx vitest run tests/front/regua-visual-do-painel.test.ts tests/front/painel-sem-jargao.test.ts` UMA vez no fim (só desce; chaves zeradas somem). Esperado: Products 27→0, ProductForm 43→4, Banners 326→~176,
   Push 47→4, Reviews 39→3, Notifications 6→2, CouponForm 22→3, Coupons 19→6, Login 7→1, DevolucoesView 4→3, Detalhe 3→1, Acoes/Selos/Cartao/OrderReceipt/QuemPode→0, LocalBufferedInput/ErrorState→0,
   Modal 7→1, Linhas→0, Dashboard→0, VozClienteTab→0, EstrategiaNacional/FreteGratis→0, PhoneSimulator igual (37). Jargão: nenhuma mudança.
3. `.lint-baseline.json` só se a catraca cair (depois do CI verde, como manda o arquivo).
4. Testes sem dono que montam telas tocadas: `npx vitest run $(rg -l "LocalBufferedInput|AdminErrorState|PainelRecolhivel|StatusPagamentoPix" tests/front | tr '\n' ' ')`.
5. `npm run build && npm run size`, e reexecutar o harness de render (scratchpad, fora do repo): alvos <44px e texto <11px nas telas L.

## Fora desta onda

`PhoneSimulator.tsx` (37; réplica da loja, decisão do dono); cores literais `#FFBF00`/`#09090b`/`#e2c04a` em geral (150 só em Banners; trocar muda o tom: decisão visual) e as 10 cores em dado de
`AdminBannersView`; `fixed inset-0` sem `role="dialog"` (a11y, onda própria); `StrategicIntelligenceBlocks.tsx`/`FluxoDeCaixaGrafico.tsx` (cor em string de gráfico);
`PoliticaDeDevolucaoSection.tsx` (Switch sem label); o `data-[size=default]:h-9` latente em `AdminPushView:1438` e `AdminBannersView:2140` (mesmo bug do seletor de setor); cabeçalhos `psql -1 -f` dos `rollback-manual-*`.
