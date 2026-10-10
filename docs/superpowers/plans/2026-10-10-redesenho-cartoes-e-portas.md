# Redesenho de cartões de métrica e botões de porta — extensão (10/10/2026)

Pedido do dono: "cartões de métrica e botões novos estão horríveis". O PR #794 refez os dois
componentes compartilhados (`AdminKpiCarousel`/`KpiCard` e `AtalhosDaAba`). Esta onda leva o MESMO
desenho aos cartões e botões feitos à mão em outras telas. **Só visual**: nenhum texto visível, rota,
prop, handler, query ou regra de negócio muda. Risco: rotina (sem banco, edge, checkout, SW).

## Padrão a aplicar (fonte: `src/components/admin/AdminKpiCarousel.tsx` e `.../primitivos/AtalhosDaAba.tsx`)

- Cartão de métrica: `rounded-2xl border border-white/10 bg-zinc-900/70 bg-gradient-to-b from-white/[0.06] to-transparent`;
  rótulo em frase normal `text-xs font-semibold text-zinc-300` (NÃO uppercase miúdo cinza 500/600);
  valor grande, branco, `font-black tabular-nums` (22–24px); subtítulo/rodapé `text-xs font-medium text-zinc-400`;
  ícone em selo `size-8 rounded-xl border border-white/10 bg-white/[0.06]` quando houver ícone.
- Botão-linha: `rounded-2xl border border-white/10 bg-zinc-900/70 bg-gradient-to-r from-white/[0.05] to-transparent`,
  selo de ícone dourado `size-10 rounded-xl border-admin-gold/25 bg-admin-gold/10`, nome `text-[15px] font-bold text-white`,
  seta `ChevronRight size-5 text-zinc-500` que vira dourada no hover, alvo mínimo `min-h-11`.
- Contraste: nada de `text-zinc-500/600/700` em texto que carrega informação (mínimo `text-zinc-400`).

## Travas que valem para TODAS as frentes

1. **Texto visível idêntico** (testes de jargão/idioma da loja varrem os textos). Trocar `uppercase`/cor/tamanho é CSS, ok; trocar palavras, não.
2. **Nunca texto abaixo de 11px e nenhum hex literal novo**: `tests/front/regua-visual-do-painel.test.ts` exige teto IGUAL à contagem por arquivo.
   Não remova nem adicione `text-[<11px]`/hex nos arquivos que já têm contagem (Banners, Cupons, Avaliações, Notificações, Push, FluxoDeCaixaGrafico):
   mexer na contagem é PEDIDO ao integrador (`regua-visual-do-painel.json` é compartilhado, ninguém o edita).
3. Preservar o que os testes da própria faixa travam (`min-h-11`, `min-h-20`, `data-rotulo-do-kpi`, `line-clamp-2`, `tracking-*` específicos, `role="button"` etc.).
   Se o desenho novo contradiz um teste da faixa, atualize o TESTE da faixa para o contrato novo e diga no relatório (foi o que o PR #794 fez).
4. Cores de estado (sobra/quebra, saúde da margem, amber de pendente) permanecem — só a casca muda.
5. Sem componente novo compartilhado entre frentes (cada frente é dona dos seus arquivos); duplicar a classe é aceito, criar import cruzado não.
6. Mobile primeiro: conferir 390px (cartões de 2 colunas ~170px de largura útil; valor `R$ 1.312.456,78` não pode quebrar o layout).

## Frentes e tarefas

1. **crm-kpis** — `TileDeKpi.tsx` (usado por VisaoGeralDoCrm ×8 e NumerosDoMes ×4: NÃO mude props nem a prop `superficie`; `rounded-2xl` fixo e `admin-glass` do Início seguem), `CanaisDoCrm.tsx` (`ItemDoResumo`, `BlocoDeCanal`). Contraste mínimo zinc-400 (`crm-contraste-aa`). Não altere `SUPERFICIE_DO_CRM` (compartilhada com o Dashboard).
2. **financeiro** — `partes.tsx`: `BlocoKpi` (manter `data-rotulo-do-kpi`, `line-clamp-2`, `break-words`, `min-h-[2.5em]`, sem `truncate`), `EsqueletoDeKpis` (altura acompanha o cartão novo); mini-cartões de AbaVisao (Vencido/Próximos 7 dias, saldo por conta), AbaExtrato (Entrou/Saiu/Resultado), FolhasDoCaixa (Esperado/Contado/Diferença — cores de estado intactas), AbaCaixa, AbaContasECategorias/FolhasDeCadastro (linhas-botão). Não mexa em `Dinheiro`/`ContextoValoresOcultos`.
3. **ajustes-porta** — `PortaDeAjustes` (`AdminSettingsView.tsx` ~467-505) no desenho de botão-linha novo, mantendo descrição, `role="button"`, `tabIndex=0`, Enter/Espaço, `h3` com o nome; `GrupoDeAjustes` h2 filho direto da section; botão "Ver o PIX em Pagamentos" (`min-h-11`).
4. **produtos-indicadores** — `AdminProductsView.tsx`: 4 caixas do simulador (`min-h-20`, nunca `h-20`), grade "Operational Metrics" do detalhe, rótulos zinc-600/700 do cartão de detalhe e da grade compacta; cartões do Guia de Produtos só no que for casca/contraste.
5. **cupons-clientes** — `AdminCouponsView.tsx` (mini-caixas Desconto/Mínimo Compra, "Expira em", "Aproveitamento"), `AdminCustomersView.tsx` (rodapé de KPIs "Total já comprado"/"Pedidos": manter `tracking-wide break-words min-w-0`, sem `tracking-[0.2em]`, grade `grid-cols-1 xs:grid-cols-[minmax(0,1fr)_auto] xs:items-end`).
6. **qa-avaliacoes** — `AdminQAView.tsx` e `AdminReviewsView.tsx`: linhas de estado dentro do `content` dos KpiCards ("Ação Requerida/Fila Limpa", "N aguardando sua aprovação"), pílulas de data/cliente, cartões de pergunta/avaliação. `avaliacoes-e-avisos-letra-l.test.tsx` é desta frente (lê também `AdminNotificationsView.tsx`, que é da frente 7: lá, não mexa no que esse teste checa).
7. **inicio-avisos** — `components/admin/inicio/**` (AtalhosDoInicio: descrição 11px → `text-xs`; ParaFazer e botão "A pagar em 7 dias" no desenho de botão-linha; HojeNaLoja/NumerosDoMes/ParaFazer/SerieDe14Dias/CartaoDaAssinatura/PerfilDaLoja: só a casca/rótulo dos cartões-seção se couber, sem mexer em `TileDeKpi`) e `AdminNotificationsView.tsx` (`AvisoCard` no desenho de botão-linha; preservar as 2 ocorrências sub-11px da régua).

Cada frente: rodar o teste ESCOPADO da faixa + `npx tsc -b`, biome/eslint dos arquivos tocados; nunca `npm test` inteiro.

## Fora desta onda (anotado, não feito)
`FreteResumoFaixa.tsx`, cartões de modal de ajuda (`AdminHelpModal`), `blocoDaFicha` do OrderDetail (desenho deliberado da ficha), `SUPERFICIE_DO_CRM`/Dashboard.
