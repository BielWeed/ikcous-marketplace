# Painel simples — Onda J2 (correções do que o render refeito achou na onda J)

Manifesto: `docs/superpowers/lanes/2026-10-10-painel-simples-onda-j2.json` (4 frentes disjuntas; nenhuma toca banco, edge, dinheiro, auth ou
service worker). Base: `claude/oi-uunug6` @ `4b2478e1` (onda J integrada, CI 15/15 verde). Regras gerais: as de
`2026-10-10-painel-simples-onda-j-notas.md` (tetos que só descem — NÃO rode `ATUALIZAR_TETOS` nem edite os `.json` de teto; classe nova
nunca `text-[<11px]`; nenhum export muda de assinatura; atualizar teste existente só troca rótulo/formato/classe; prova escopada =
`npx vitest run <testes da frente> tests/front/painel-sem-jargao.test.ts tests/front/regua-visual-do-painel.test.ts`, `npm run typecheck`,
`CI=true npm run lint:ratchet` (eslint 409 / biome 13), `node scripts/paralelo/frente.mjs conferir`; commit só por `frente.mjs commitar`).

## Origem

Render refeito no Chromium simulado (360x740, 412x915, 640 e 1280; dados fictícios; NÃO é aparelho real) sobre a onda J integrada. Relatório
com screenshots e medidas em `/tmp/claude-0/-home-user-ikcous-marketplace/f69ba6a8-7415-5973-a402-3bd1ff777936/scratchpad/telas2/`
(`extras/`, `metricas/`, `recortes/`, `shots4/`). O jsdom não aplica CSS: onde a prova é de layout, a asserção é sobre classes e a medida real
fica para o render do integrador.

## J2-A · produtos-detalhado-sem-corte (ALTA)

Problema medido (`extras/detalhado.json`, `recortes/detalhado-360-a.png`): o cartão do modo DETALHADO de Produtos (`AdminProductsView.tsx`,
altura fixa `h-[440px]` por causa do `content-visibility`) corta o que passa: esconde o **preço de venda e o "Potencial"** — 45–114px a 360/412,
90–143px a 768 e 173–280px a 1280. A onda J trocou o nome de `truncate` para `line-clamp-2` e somou ~24px acima de 640px.
Alvo: o preço, o custo, o estoque e o "Potencial" ficam SEMPRE visíveis, em qualquer largura. Opções (escolha a mais simples que provar por
classe): tirar a altura fixa do cartão detalhado (`h-auto`/`min-h-*`) mantendo `content-visibility: auto` com um `contain-intrinsic-size` coerente
(NÃO edite `src/index.css`: use a classe utilitária/`style` local se precisar), ou aumentar/escalonar a altura por breakpoint com folga medida. O nome
continua em até 2 linhas. Linhas citadas do plano da onda J (confira com `rg`): ~L1604-1618 (padding/gap/nome), `h-[440px]`.
TDD: `tests/front/produtos-detalhado-nao-esconde-o-preco.test.tsx` (falha primeiro): no modo detalhado o cartão NÃO tem altura fixa
(`h-[440px]`) que corte o conteúdo (afirme a classe nova) e o preço/"Potencial" estão no mesmo contêiner; produto de nome longo mantém `line-clamp-2`.
NÃO: mudar cálculo (`avgRoi`, `margin`, `roi`, `invested`), a regra `precisaDeReposicao`, a grade (altura 284 já medida sem corte), `useProducts.ts`.

## J2-B · metricas-sem-pulo (MÉDIA)

`AdminKpiCarousel.tsx`. Medido: (N2) a 1280px em Produtos o rótulo "DINHEIRO PARADO EM…" é cortado no limite de 2 linhas (`metricas/1280x800-produtos-cartoes.png`):
acima de `sm` permita 3 linhas no rótulo ou reduza o `tracking`, sem descer de 11px e sem passar muito de ~96px de altura (a faixa já mede 95,5px;
aceite até ~110px se for o preço de caber inteiro; Clientes tem 81,8); (N3) o conteúdo logo abaixo pula 11–28px quando os dados chegam: o esqueleto tem
96px no celular e 68px de 640 em diante, e a barra de cima passa de 44px (carregando) para ~64,5px (celular, depois que os pontos aparecem e quebram em
2 linhas) — dê ao esqueleto a mesma altura do cartão real por breakpoint (~100px no celular, ~96px no computador) e reserve a altura da barra de cima
(`min-h` da barra = a altura quebrada no celular) para não haver deslocamento; (BAIXA) a seta invisível do carrossel (32x32, `opacity-0`) fica por cima
da borda direita do 2º cartão e captura toque: ponha `pointer-events-none` quando invisível (`pointer-events-auto` no hover/foco, só desktop).
TDD: estenda `tests/front/metricas-cabem-no-celular.test.tsx`: esqueleto com a altura mínima nova por breakpoint; a barra de cima tem `min-h`
reservado; a seta invisível tem `pointer-events-none`; o rótulo acima de `sm` permite o clamp novo. Atualize `admin-kpi-carousel-compacto.test.tsx` só se
afirmar a classe antiga. NÃO: voltar o autoplay, trocar para 1 cartão por vez, mexer em `TileDeKpi`.

## J2-C · barra-solida (MÉDIA)

`AdminLayout.tsx` (~L1219, `motion.nav` da barra do celular). Medido: com o fundo a 95% (`bg-zinc-950/95`) + `backdrop-blur-2xl` ainda se lê texto por baixo
("Extrato, contas a pagar", "Beatriz Souza"); com fundo sólido `rgb(9,9,11)` o texto some (`extras/barra-diag-abc.png`). Pode ser efeito do Chromium sem GPU, mas
sólido resolve nos dois casos. Troque para fundo SÓLIDO (`bg-zinc-950`), mantendo a borda `border-white/15` e a sombra; o blur pode sair (não serve a nada com
fundo opaco) — se mantiver, diga por quê. TDD: ajuste `barra-inferior-cobre-o-conteudo.test.tsx`: o `nav` tem `bg-zinc-950` SEM sufixo de opacidade (`/95`) e não tem
`admin-glass`. NÃO: mexer em `src/index.css`, no selo de conexão, `navItems`, na contagem `.or(...)`, nem no `bottom:` calculado.

## J2-D · clientes-e-ficha (MÉDIA/BAIXA)

`AdminCustomersView.tsx` e `AdminUserDetailView.tsx`:
- Clientes → "Pedidos totais" mostra "1289" sem ponto (nas 4 larguras): use `formatarInteiro` (`@/lib/crm`, pt-BR) onde o número é exibido; confira outros números
  inteiros exibidos na tela sem formato. "Novos (30D)" → "Novos (30 dias)".
- Ficha → aba Carrinho: a tabela rola na lateral (841/308 a 360px): preço e botão de remover ficam fora da tela (`recortes/ficha-carrinho-360.png`). No celular cada
  item vira bloco (mesmo padrão da onda J5, `HistoricoCotacoesCard`: `block sm:table`/grid, cabeçalho `sr-only sm:not-sr-only sm:table-header-group`, e o helper
  de papéis ARIA para não subir a catraca do eslint/biome), com o botão de remover com 44px.
- Ficha → jargão que sobrou nessa aba: "Carrinho (Standby)", "Identificador do Ativo", "Densidade", "Precificação Base", "Estimativa (BRL)", "pre-checkout" → palavras da loja
  (ex.: "Carrinho do cliente", "Produto", "Quantidade", "Preço", "Total estimado", "antes de finalizar a compra"). A aba mostra "CARR. (4)" (unidades) enquanto o selo diz
  "3 produtos": faça os dois contarem a mesma coisa (produtos distintos) e prenda no teste.
TDD: `tests/front/ficha-do-cliente-carrinho-no-celular.test.tsx` (falha primeiro): sem os termos de jargão; "1.289" formatado; a tabela do carrinho com `role`/classes de bloco no
celular e `sm:not-sr-only` no cabeçalho; contagem da aba = a do selo. Atualize os testes existentes da posse só no texto/classe. NÃO: mexer em `rotuloDoPapel`, `handleSort("role")`,
`linkWhatsappDoCliente`, `handleClearUserCart` (comportamento), nem no cálculo de LTV/ticket.

## Fora desta onda (fila da onda K)

Alvos de toque < 44px (botões "?" 28–34px em 8 telas, pontos do carrossel 24x44, "Marcar como recebido" 40px, campos de 36px em Minha loja/Frete/simulador, interruptores 13x13/24x14/16x16,
"Ver serviços da conta" 133x17, "Resetar simulador" 119x24, ações da ficha); texto < 11px que resta (topo "Perfil/Voltar" 10px; Início: gráfico/assinatura 9–10px; Pedidos: selos
10px; Produtos: 8 ocorrências; simulador: rótulos 8–10px; formulário: rótulos 10px; Minha loja: Salvar 10,5px e "Prévia do que o cliente vê" 9px; Frete 10,5px);
`aria-invalid` no campo do estoque mínimo; "Código interno (SKU)"; "ms" na coluna Tempo das consultas de frete; mesma cascata do `admin-glass` em Devoluções/AcoesDaDevolucao/AlertasCancelados;
guarda estática para `admin-glass` junto de classe de fundo/borda/sombra; `percentualComUmaCasa` duplicada com `formatarPercentual` (src/lib/financeiro.ts); toasts "12MB/30MB" do upload.
