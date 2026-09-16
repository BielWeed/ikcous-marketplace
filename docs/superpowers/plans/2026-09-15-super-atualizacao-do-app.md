# Super atualização do app — plano de execução

Data: 15/09/2026. Base: `develop` em `4ce2c5f` (release 1.35.0), branch `claude/app-major-upgrade-wmc8x2`.
Origem: pedido do dono (por voz, 15/09): corrigir todos os defeitos, reescrever as partes de pior
qualidade relativa e dar ao lojista a gestão completa da loja no app, começando pela venda
presencial com leitor de código de barras pela câmera. Complemento do mesmo dia: as chaves do
Mercado Pago cadastradas na tela de Ajustes passam a valer para uso real, com segurança, antes da
próxima versão assinada (risco assumido pelo dono, por pouco tempo).

Como este plano foi feito: 14 leitores de contexto limpo, um por subsistema, leram o código de
verdade (não os documentos de auditoria, que envelhecem) e devolveram nota de qualidade relativa,
invariantes, cobertura de teste e achados com `arquivo:linha` e cenário concreto. Cada achado que
não era só dívida anotada passou por duas lentes adversariais independentes (uma procura a guarda
que já trata o caso; a outra tenta reproduzir). Só o que sobreviveu às duas lentes entra como
"confirmado"; divergência vira "a confirmar antes de codar". O desenho do PDV saiu de um painel de
três desenhos independentes julgados por dois juízes com critérios distintos.

## 1. Diagnóstico

### 1.1 Notas por área (1 = reescrever · 3 = refatorar · 4-5 = só corrigir)

| Área | Nota | Veredito | Por quê (uma linha, medido) |
| --- | --- | --- | --- |
| Roteador manual, `App.tsx`, chrome do admin | 2 | Reescrever o núcleo de rotas (tabela declarativa), partir `AdminLayout` | `AppContent` tem ~2.440 linhas, 25 estados de navegação e um `handleNavigate` de 330 linhas; a lista das 5 abas do admin existe em 8 lugares, a de views com `?id=` em 4, e `PreloadedOrLazy` recebe `component: any`, então nenhuma prop das 35 views é checada pelo `tsc`. Zero teste de navegação do admin. |
| Checkout, carrinho e fluxo do dinheiro | 3 | Refatorar `CheckoutView` por partes; edges só correção | `CheckoutView` com 3.536 linhas, 21 estados, 22 efeitos; `create_marketplace_order_v23` e `v24` são 485 linhas copiadas que diferem em 2. O caminho do dinheiro em si (Orders API, HMAC, RPC única) está sólido. |
| Pedidos (`useOrders`, painel, ficha) | 3 | Partir `useOrders` (18 responsabilidades, 9 consumidores) | Fila offline e realtime têm defeitos reais; dois mapas divergentes de rótulo de pagamento; bloco "Marcar como recebido" escrito três vezes. |
| Vitrine do cliente | 4 | Só corrigir | Dezenas de testes nomeados por regressão e invariantes vivas no código (favoritos, notificações, promessas que a loja não cumpre). Restam endereços sem Context, três buscas independentes e um `ProductCard` de ~890 linhas. |
| Banco (migrations, rollback, CI de banco) | 4 | Só corrigir e documentar | A área mais disciplinada do repo: RLS e `search_path` 100% cobertos no schema vivo, par migration+rollback com teste estático, dois CIs em Postgres efêmero. O comando `/nova-migration` mente (manda `BEGIN/COMMIT`) e `src/types/supabase.ts` divergiu 839 linhas. |
| Autenticação, papéis, RLS e `SECURITY DEFINER` | 4 | Só corrigir; partir `AuthContext` na Onda B | Área mais auditada do repo (~30 testes de boot, logout, admin-check, reset). Sobra: `record_vor_action` grava o hash que o cliente manda sem recalcular; `is_admin()` confia no claim do JWT; lista de views redirecionáveis em 3 lugares; cache de módulo do admin nunca limpo no logout. |
| Painel: dashboard, KPIs, clientes, ficha do cliente | 4 | Só corrigir | Lógica extraída em funções puras testadas (`ficha-resumo.ts`, `buildKpiCards`), guardas de corrida testadas, distinção "não sei" de "zero". Sobra: cliente convidado nunca aparece em Clientes; reconstrução do "Estoque Investido" falseia histórico após reposição; `get_admin_user_detail` sem `LIMIT`. |
| Painel: banners, carrosséis, push, notificações, avaliações, Q&A, cupons, WhatsApp, ajustes | 3 | Reescrever só `AdminBannersView` e `ImageAdjuster`; o resto só corrigir | Push, carrosséis, avaliações, Q&A, cupons e ajustes carregam marcas de auditoria e testes nomeados; `AdminBannersView` (5.038 linhas, 25 estados, objeto de 20 campos copiado 6 vezes) e `ImageAdjuster` (1.802, matemática sem teste) não. |
| Edge Functions (12) e `_shared` | 4 | Só corrigir | Toda function viva tem `index_test.ts`; os módulos de dinheiro têm suíte maior que o código. Sobra: `verifyIsAdmin` copiado em 4, cache de frete sem provedor na chave, broadcast de push sem paginação (já corrigido em A). |
| Frete | 3 | Refatorar a edge e a fronteira front/servidor | A regra de frete grátis está em 5 lugares que discordam (`every` × `some`, sentinelas, três valores de "não configurado"); `calculate-shipping` tem 1.318 linhas com `@ts-nocheck` e ~130 linhas mortas. O painel de frete é o melhor desenho da área. |
| PWA, service worker, cofre offline, realtime | 3 | Corrigir os defeitos e partir o motor | Sentinela desregistra o SW a cada 5 min; aviso de atualização sem saída; três caminhos gravam o produto no cofre com colunas diferentes; catálogo offline preso em 200. |
| Catálogo: produtos, variantes, formulário, estoque | 2 | Reescrever `AdminProductFormView` e `useProducts`; preservar as peças puras | Formulário com 3.586 linhas, 24 estados, a lista de 19 campos escrita 6 vezes; salvar não é atômico; ~360 linhas mortas em `useProducts`; nenhum teste no caminho de escrita das variações. As peças puras (`vitrine.ts`, `preco-vendido.ts`, `variante-composta.ts`) valem 5. |
| Testes, tooling e CI | 4 | Só corrigir | 511 arquivos de teste e um CI de 9 jobs. Sobra: a catraca aprova em silêncio se o Biome não roda; o portão de tamanho mede 606 kB quando a entrega real é 777 kB; o recharts entra no boot por causa do `clsx`. |
| Documentação versus código | 2 | Reescrever `/checar` (feito) e datar o resto | A camada nova (AGENTS.md, cabeçalhos de migration, testes nomeados) é excelente; a velha (auditorias, backlog, `06-ESTADO-ATUAL`, `.claude/commands`) apodreceu: 20 de 20 itens da fila de dor fechados, 33 dos 38 "abertos" fechados, 4 P0 fechados sem marca. |


### 1.2 Os problemas mais graves hoje, por degrau de dor

Degrau 1 — mente em silêncio (quem opera decide em cima de número ou estado errado):

| # | Problema | Onde |
| --- | --- | --- |
| 1 | Após sincronizar a fila offline, a lista de pedidos do painel é trocada por "Todos", página 0, sem aviso | `src/hooks/useOrders.ts:2867` |
| 2 | A fila offline aplica avanço de status por cima de um cancelamento feito nesse meio-tempo, reativando pedido morto com estoque já devolvido | `src/hooks/useOrders.ts:196` |
| 3 | Pagamento com valor divergente entra no Mercado Pago e ninguém é avisado: só `console.error`; o pedido expira e o estoque volta (política P2 pede devolução e novo pagamento) | `supabase/functions/webhook-mercadopago/index.ts:1464` |
| 4 | A chave de idempotência do pedido ignora o meio de pagamento: retentativa com outro meio devolve o pedido errado e a tela mente | `src/lib/chave-do-pedido.ts:25` |
| 5 | Endereços divergem entre Perfil e Formulário de Endereço porque `useAddresses` não é compartilhado | `src/hooks/useAddresses.ts:7` |
| 6 | Descrição do produto afirma "Produto em estoque - Envio rápido" mesmo esgotado | `src/views/customer/ProductView.tsx:1253` |

Degrau 2 — promete o que não cumpre:

| # | Problema | Onde |
| --- | --- | --- |
| 7 | Convidado não tem como acompanhar o pedido: o checkout não pede e-mail, e o rastreio por OTP exige e-mail | `src/views/customer/CheckoutView.tsx:3301` |
| 8 | Tocar a aba já ativa do admin com formulário sujo abre "Descartar e sair", que não sai nem descarta, e desliga a guarda | `src/App.tsx:743` |
| 9 | As chaves do Mercado Pago cadastradas em Ajustes são guardadas e testadas, mas o checkout continua cobrando com a chave do ambiente da plataforma | `supabase/functions/criar-pagamento/index.ts:302` |
| 10 | Ficha do pedido aberta por deep link é desmontada a cada mudança em `orders`, perdendo anotação e rastreio em edição | `src/views/admin/AdminOrdersView.tsx:648` |

Degrau 3 — atrapalha, e se vê: realtime INSERT ignora filtro/página (`useOrders.ts:1508`); `fetchPedidosCancelados` baixa todos os cancelados com itens a cada ativação (`useOrders.ts:1417`); `prefetchAll` baixa os 18 chunks do admin para todo cliente (`App.tsx:2114`); Voltar do celular com diálogo de banner aberto sai da tela (`AdminBannersView.tsx:1156`); botão de excluir notificação invisível no celular (`NotificationsView.tsx:421`); favoritos de visitante com preço congelado (`FavoritesContext.tsx:535`); reconciliação com `LIMIT 100 DESC` nunca olha os mais antigos quando há mais de 100 candidatos.

## 2. Princípios de execução (valem para todo lote)

1. **Escopo.** Só o app: o que o lojista e o cliente da loja sentem. Assinatura, cobrança de mensalidade e clonagem de loja são de outro projeto e não entram, mesmo que o defeito more em arquivo daqui.
2. **Uma tarefa por execução.** Cada tarefa cabe em um arquivo ou um comportamento. Quem implementa não decide arquitetura: se o plano estiver errado, para e relata.
3. **TDD de verdade.** Teste que falha pelo motivo certo, depois a implementação, depois o teste passando. Onde mora: `src/**` em `tests/front/*.test.ts(x)` (Vitest); `supabase/functions/<nome>/` em `index_test.ts` (Deno); migration em `tests/migration_<nome>_test.ts` (Deno).
4. **Quem escreveu não revisa.** Revisão em contexto limpo, com as sete lentes do `.claude/agents/revisor.md`. O risco define o custo da revisão, não o tamanho do diff.
5. **Mapa de risco (revisão cara obrigatória):** `supabase/migrations/`, RLS ou `SECURITY DEFINER`, `supabase/functions/`, auth/OTP, checkout/pagamento, service worker, qualquer assinatura consumida por outro módulo.
6. **Escrita serial por arquivo.** Leitura paraleliza; escrita no mesmo arquivo, nunca. Arquivos-gargalo desta atualização: `src/App.tsx`, `src/hooks/useOrders.ts`, `src/lib/mappers.ts`, `src/types/database.types.ts` + `src/types/supabase.ts`, `src/components/layouts/AdminLayout.tsx`, `src/types/index.ts`, `supabase/migrations/`.
7. **Migration.** Sem `BEGIN`/`COMMIT`; arquivo de rollback `rollback-manual-<timestamp>_<nome>.sql` na raiz; teste em `tests/`; tipos regenerados nos DOIS arquivos de tipos (o MCP do Supabase não está disponível nesta sessão: edição manual coerente, conferida por `tsc -b`). Nunca `supabase db push`.
8. **Catraca de lint.** Warning novo de eslint reprova igual a erro. Teto vivo em `.lint-baseline.json` (eslint 0 erro / 485 warnings; biome 19 erros / 1 warning). Quando um número cair, abaixar o teto no mesmo PR, com o número medido no CI.
9. **Bundle.** `size-limit` soma todos os `dist/assets/*.js` (teto 800 kB) e CSS (100 kB). Dependência nova só com o custo medido e chunk lazy.
10. **Decisão de produto sobe ao Gabriel** com recomendação e a conta feita (melhora, piora, conserto, bem maior). Nunca menu vazio.
11. **Nada de `--no-verify`.** O secretlint do pre-commit é a única trava contra credencial vazada. Commit por caminho (`git commit -- <arquivos>`), nunca `git add -A`; nunca `stash`/`checkout`/`restore`/`clean`/`reset`.
12. **Evidência.** Relatório com a saída real dos comandos colada. "Deve estar passando" não é evidência.

### 2.1 Verificação real (a mesma ordem do CI)

```bash
npm run typecheck      # tsc -b --force
npm test               # test:edge (Deno) + test:unit (Deno) + test:front (Vitest)
npm run build          # IKCOUS_IDENTITY_MODE=fixture NODE_ENV=production
npm run size           # IKCOUS_IDENTITY_MODE=fixture, logo após o build
npm run lint:ratchet   # compara com .lint-baseline.json
npm run lint:links     # se tocou .md
npm run secretlint     # se tocou arquivo de configuração ou script
```

Nota desta sessão remota: `deno.land` e `esm.sh` estão bloqueados pelo proxy. As suítes Deno rodam aqui com um mapa de imports local (fora do repo) que aponta `std@0.177.0` para `jsr:@std/*` e `esm.sh/@supabase/supabase-js@2` para `npm:`. Medido em 15/09/2026: edge 540 passaram, unit 380 passaram. O CI (Linux, rede livre) continua sendo quem cobra.

## 3. Onda A — lotes de correção (achados confirmados)

Cada lote é uma frente com arquivos disjuntos das demais; dentro do lote as tarefas são seriais
(o mesmo arquivo nunca é editado por dois ao mesmo tempo). Toda tarefa: teste que falha antes,
implementação, teste passando, `tsc -b`, eslint sem warning novo, biome nos arquivos tocados, e
revisão de contexto limpo com as sete lentes. Estado em 15/09: os lotes A1 a A6 já estão em
execução nesta branch; o estado por tarefa está no PR #624.

### A1 — Chaves do Mercado Pago do lojista valendo de verdade (risco alto: edge + pagamento)

Objetivo: o que o lojista cola em Ajustes > Pagamentos > Mercado Pago passa a ser a credencial
que cria o PIX, valida o webhook, reconcilia e estorna, com falha fechada e sem segredo no
navegador. Pedido explícito do dono em 15/09 (risco assumido antes da versão assinada).

| # | Tarefa | Arquivos | Esforço | Teste |
| --- | --- | --- | --- | --- |
| A1.1 | Módulo `_shared/credenciais-mp.ts`: cifra movida da edge de credenciais; `resolverCredenciaisMp` devolve `lojista` (registro decifrado), `ambiente` (sem registro: `MP_ACCESS_TOKEN`/`MP_WEBHOOK_SECRET`) ou `indisponivel` (registro presente e cofre ausente/corrompido: nunca cai no ambiente) | `supabase/functions/_shared/credenciais-mp.ts`, `credenciais-mercado-pago/index.ts` | M | `_shared/credenciais-mp_test.ts` (5 situações) |
| A1.2 | `criar-pagamento`, `webhook-mercadopago`, `reconciliar-pagamentos`, `estornar-pagamento` usam a resolução; `indisponivel` = mesma resposta de "token ausente" de hoje, com log sem segredo | as 4 functions | M | `index_test.ts` de cada uma: caminho lojista (Bearer = token decifrado) e falha fechada |
| A1.3 | Edge de credenciais sincroniza `store_config.mp_public_key` ao salvar (o trigger aceita `service_role`) e ganha `ligar_pix`/`desligar_pix` (`pagamento_online`); ligar exige último teste conectado; ambiente de teste liga com aviso | `credenciais-mercado-pago/index.ts` | M | C15 a C20 no `index_test.ts` |
| A1.4 | Tela: interruptor "Receber PIX no app" honesto (desabilitado sem teste conectado; aviso de chave de teste; "a vitrine reflete em até 1 minuto" conforme o cache do porteiro) | `MercadoPagoSection.tsx`, `mercado-pago-conteudo.ts` | M | `tests/front/admin-mercado-pago-interruptor-do-pix.test.tsx` |
| A1.5 | `DEPLOYMENT.md` §5.2: env vira reserva; cofre obrigatório com chave cadastrada; como ligar o PIX | `DEPLOYMENT.md` | P | `npm run lint:links` |

Critério de saída: com chave do lojista salva e testada, um PIX criado no checkout usa o token
do lojista (prova no teste da edge); sem chave salva, tudo se comporta como hoje; com cofre
ausente e chave salva, o checkout diz "Pagamento indisponível" em vez de cobrar na conta errada.

### A2 — Roteador e chrome do admin

| # | Tarefa | Arquivos | Esforço |
| --- | --- | --- | --- |
| A2.1 | Aba já ativa com formulário sujo não abre "Descartar e sair" nem desliga a guarda (`App.tsx:743`) | `src/App.tsx` | P |
| A2.2 | Voltar do celular com diálogo de banner aberto fecha só o diálogo (padrão `pushState` + `onSetBackOverride` do checkout) (`AdminBannersView.tsx:1156`) | `src/views/admin/AdminBannersView.tsx` | P |
| A2.3 | `prefetchAll` só pré-carrega chunks do admin quando `isAdmin` está confirmado (`App.tsx:2114`) | `src/App.tsx`, `usePrefetchOnHover.ts` | P |

Fica para decisão do dono (seção 6): o Voltar do admin empurra entrada nova em vez de voltar no
histórico (`AdminLayout.tsx:877`).

### A3 — Pedidos (`useOrders` e painel)

| # | Tarefa | Arquivos | Esforço |
| --- | --- | --- | --- |
| A3.1 | Sincronização da fila offline preserva filtros, página e tamanho (`useOrders.ts:2867`) | `useOrders.ts` | P |
| A3.2 | Fila offline não reativa pedido cancelado nesse meio-tempo (`useOrders.ts:196`) | `useOrders.ts` | M |
| A3.3 | Realtime INSERT respeita filtro, busca, período e página; total acompanha (`useOrders.ts:1508`) | `useOrders.ts` | M |
| A3.4 | `fetchPedidosCancelados` com janela e colunas mínimas, sem refetch redundante (`useOrders.ts:1417`) | `useOrders.ts` | M |
| A3.5 | Ficha por deep link não é remontada a cada mudança em `orders` (`AdminOrdersView.tsx:648`) | `AdminOrdersView.tsx` | M |

### A4 — Checkout (lado do cliente)

| # | Tarefa | Arquivos | Esforço |
| --- | --- | --- | --- |
| A4.1 | Chave de idempotência inclui o meio de pagamento (`chave-do-pedido.ts:25`) | `src/lib/chave-do-pedido.ts` | P |
| A4.2 | Finalizar sem rede: falha de rede antes de resposta é dita como tal e o botão volta (`CheckoutView.tsx:1451`) | `CheckoutView.tsx` | P |
| A4.3 | Convidado informa e-mail para acompanhar o pedido; gravado onde o OTP lê (`CheckoutView.tsx:3301`) | `CheckoutView.tsx`, `OrderSuccessView.tsx` | M |

### A5 — Vitrine e banco

| # | Tarefa | Arquivos | Esforço |
| --- | --- | --- | --- |
| A5.1 | Descrição do produto não afirma "em estoque" quando esgotado nem promete "envio rápido" (`ProductView.tsx:1253`) | `ProductView.tsx` | P |
| A5.2 | Botão de excluir notificação visível no celular (oculto-até-hover só onde há hover) (`NotificationsView.tsx:421`) | `NotificationsView.tsx` | P |
| A5.3 | Favoritos de visitante guardam só ids e resolvem contra o catálogo vivo (`FavoritesContext.tsx:535`) | `FavoritesContext.tsx` | M |
| A5.4 | `/nova-migration` ensina a receita real: sem `BEGIN/COMMIT`, cabeçalho longo, rollback pareado, teste estático, tipos sem MCP | `.claude/commands/nova-migration.md` | P |
| A5.5 | Apagar `src/types/supabase.ts` (839 linhas divergentes) e apontar `useCoupons` para `database.types`; ajustar `knip.json` e o teste que o cita | `src/types/supabase.ts`, `useCoupons.ts`, `knip.json` | P |
| A5.6 | Teste Deno da trava dupla do CI de banco (recusa host gerenciado e `CI_BANCO_EFEMERO` ausente) | `tests/` | M |

### A6 — Painel (dashboard e clientes)

| # | Tarefa | Arquivos | Esforço |
| --- | --- | --- | --- |
| A6.1 | Disclaimer do donut de categorias diz a verdade atual (RPC já bate desde a 20261063) | `StrategicIntelligenceBlocks.tsx` + teste | P |
| A6.2 | Cache de dados do admin limpo no logout e na troca de usuário | `admin_cache.ts`, `AuthContext.tsx` | P |
| A6.3 | Ordenação inicial do LTV igual ao chip; ajuda do card "Pedidos Totais" descreve o que o card mostra | `AdminCustomersView.tsx` | P |

### A7 — Banco e RPCs (risco alto: migrations) — aguarda a janela de menor carga

| # | Tarefa | Esforço |
| --- | --- | --- |
| A7.1 | `record_vor_action` recalcula `proof_hash` no servidor (SHA-256 encadeado com `previous_hash`) e recusa hash divergente; `useVOR.ts` só envia o payload | M |
| A7.2 | Clientes convidados aparecem em Clientes: `get_admin_customers_paged` une `profiles` com pedidos sem `user_id` agrupados por WhatsApp/e-mail; remove `global_ltv`/`global_orders` que ninguém exibe | M |
| A7.3 | `get_admin_user_detail` pagina pedidos e itens (`LIMIT`/`OFFSET`), e a ficha pagina | M |
| A7.4 | Reconciliação: fila ordenada por `expires_at ASC` (mais antigos primeiro) e cursor por `tentativas` (`20261010000000:69`) | P |
| A7.5 | Webhook com valor divergente (política P2): registrar `payment_status='recusado'` com motivo, avisar o lojista (push) e o cliente (tela de status), em vez de só `console.error` | M |
| A7.6 | `create_marketplace_order_v23`/`v24`: uma função só, com a diferença de 2 linhas parametrizada (depois do PDV, para não mexer duas vezes) | G |
| A7.7 | `is_admin()` valida o claim do JWT contra `profiles` no caminho positivo (com cache curto), fechando o atraso de revogação | P |

### A8 — Reconstrução do "Estoque Investido" (decisão do dono)

`OperationalPerformanceChart.tsx:106` reconstrói o histórico só descontando vendas; qualquer
reposição de estoque falseia todo o passado. Correção honesta exige registro de movimentação de
estoque (tabela nova), que o PDV também precisa (entrada de estoque por leitura). Entra na Onda C
como parte do PDV; até lá o gráfico ganha legenda dizendo que é uma estimativa a partir do estoque
atual.

### A9 — Frete (13 achados confirmados, duas frentes com arquivos disjuntos)

Frente edge (revisão cara: `supabase/functions/`):

| # | Tarefa | Arquivos | Esforço |
| --- | --- | --- | --- |
| A9.1 | Filtro de serviços habilitados casa por identificador exato, não por substring ("pac" ligava a Jadlog) (`calculate-shipping/index.ts:1019`) | `calculate-shipping` | P |
| A9.2 | Duas cotações simultâneas não derrubam o cache do servidor por 2 h (leitura tolerante + upsert) (`:880`) | `calculate-shipping` | P |
| A9.3 | Preset `por_produto`: edge alinhada à RPC (`some`), com teste de carrinho misto (`:736`) | `calculate-shipping` | M |
| A9.4 | Pedido com frete grátis gera etiqueta e a recusa diz o motivo verdadeiro (`melhor-envio-etiqueta/index.ts:691`) | `melhor-envio-etiqueta` | M |
| A9.5 | Histórico de cotações mostra o `error_message` que a edge grava (`HistoricoCotacoesCard.tsx:100`) | painel | P |
| A9.6 | Tela de Frete não baixa o token da transportadora só para acender um ponto verde (`AdminShippingView.tsx:126`) | painel | M |
| A9.7 | Lista de etiquetas pagina, busca e marca as já emitidas (`EtiquetasEnvioCard.tsx:116`) | painel | M |

Frente vitrine:

| # | Tarefa | Arquivos | Esforço |
| --- | --- | --- | --- |
| A9.8 | Loja nova nasce sem regra de frete grátis (o front inventava R$ 350) (`StoreContext.tsx:576`) | `StoreContext.tsx` | P |
| A9.9 | Carrinho não esconde a calculadora quando o servidor pode discordar; checkout reabre a escolha em vez de travar (`CartView.tsx:495`) | `CartView.tsx`, `CartContext.tsx` | M |
| A9.10 | Barra "META FRETE GRÁTIS" some quando o preset não é "acima de valor" (`CartView.tsx:328`) | `CartView.tsx` | P |
| A9.11 | Acerto de cache auto-seleciona a mais barata, como o caminho fresco (`ShippingCalculator.tsx:241`) | `ShippingCalculator.tsx` | P |
| A9.12 | Selo "Frete Grátis" do card segue o preset da loja (`ProductCard.tsx:520`) | `ProductCard.tsx`, `ProductView.tsx` | P |
| A9.13 | Convidado da própria cidade não recebe "fora da cidade" no primeiro dígito do CEP (`CheckoutView.tsx:1381`) | `CheckoutView.tsx` (frente do checkout) | P |

### A10 — PWA e cofre offline (verificação adversarial refeita em 16/09: 7 de 9 confirmados pelas duas lentes; A10.1 ficou dividido e começa por confirmar; teto do `app-cache` e relógio do líder rebaixados a anotado)

| # | Tarefa | Onde | Esforço |
| --- | --- | --- | --- |
| A10.1 | Confirmar (as lentes divergiram): a sentinela desregistra o service worker a cada 5 min de aba visível, e o pulso nunca chega à página | `src/pwa-sentinel.ts:79` | P |
| A10.2 | Aviso de atualização com saída ("depois") e sem cobrir a tela do lojista no meio de uma venda; semântica de diálogo (foco, Escape) | `UpdateNotification.tsx:138`, `PWAUpdateGate.tsx` | M |
| A10.3 | `catchUp` fatia o `.in("id", [...])` (teto de ids por chamada) | `realtimeSyncEngine.ts:955` | M |
| A10.4 | Um só esquema de registro de produto no cofre (os três caminhos gravam colunas diferentes) | `realtimeSyncEngine.ts:952`, `StoreContext.tsx:726` | M |
| A10.5 | `onversionchange`: quem segura a instância antiga não escreve no vazio | `dataVault.ts:129` | M |
| A10.6 | Volta à aba não dispara quatro rodadas de rede e um ciclo de liderança | `realtimeSyncEngine.ts:317`, `useLeaderElection.ts:231` | M |
| A10.7 | `app-cache-<versao>` com teto de entradas | `sw.ts:354` | P |

### A11 — Catálogo (verificação adversarial refeita em 16/09: os 13 achados não anotados confirmados pelas duas lentes; A11.1 segue bloqueante, A11.3 e A11.4 rebaixados a "antes de crescer" por uma das lentes)

| # | Tarefa | Onde | Esforço |
| --- | --- | --- | --- |
| A11.1 | Adicionar variante nova a produto que já tem variante salva não quebra o upsert (linhas com e sem `id`) | `useProducts.ts:1591` | P |
| A11.2 | SKU de variante deixa de ser UNIQUE global: passa a único por produto (migration + rollback + teste) | `baseline:4611` | M |
| A11.3 | Realtime recalcula o estoque com o mesmo fallback do mapper (apagar a última variação não zera a vitrine) | `realtimeSyncEngine.ts:605` | M |
| A11.4 | Salvar produto vira atômico: RPC `salvar_produto_com_variantes` (produto + variações numa transação) e a tela dá uma notícia só | `AdminProductFormView.tsx:1283`, migration | G |
| A11.5 | Imagem recortada sobe com o nome e o `Content-Type` do formato real | `AdminProductFormView.tsx:499`, `useProducts.ts:1223` | P |
| A11.6 | Painel usa `estoque_minimo` do produto no aviso de estoque baixo, e o formulário deixa editar | `AdminProductsView.tsx:1630` | M |
| A11.7 | Erros de variante mostram a regra do TruthGate que falhou | `useProducts.ts:1608` | P |
| A11.8 | Duplicar o mesmo produto duas vezes preserva a grade do segundo clone | `AdminProductsView.tsx:546` | P |
| A11.9 | Guia de variações ensina a semântica certa do estoque; ajuda do SKU não promete unicidade que não existe | `AdminProductFormView.tsx:2552`, `:3474` | P |
| A11.10 | Modais de variante e categoria viram diálogos (role, foco preso, Escape) | `AdminProductFormView.tsx:1609` | M |
| A11.11 | Busca do painel com índice (`unaccent` imutável em índice de expressão ou coluna normalizada) | `baseline:1734`, migration | M |

### A12 — Testes, tooling e CI (uma lente confirmou os 8; a segunda lente roda em 16/09; A12.3 é o único que a lente manteve como bloqueante)

| # | Tarefa | Onde | Esforço |
| --- | --- | --- | --- |
| A12.1 | Catraca reprova quando o Biome não consegue rodar, em vez de aprovar em silêncio | `scripts/lint-ratchet.mjs:103` | P |
| A12.2 | `size-limit` mede o que o servidor entrega: brotli por arquivo somado (hoje o portão diz 606 kB e a entrega real é 777 kB) e mede o `dist` promovível | `.size-limit.cjs` | P |
| A12.3 | `clsx` sai do chunk `vendor-charts`: todo cliente deixa de baixar o recharts (92 kB brotli) no boot | `vite.config.ts:214` | P |
| A12.4 | `lint:lockfile` roda no CI (dependência nova sem checagem de origem hoje) | `ci.yml` | P |
| A12.5 | `knip` configurado para `scripts/`, `tests/` e entradas do esbuild (24 falsos positivos hoje) | `knip.json` | M |
| A12.6 | Telas do admin entram no precache do PWA ou um teste trava a lista de exclusão com justificativa | `vite.config.ts:68` | M |
| A12.7 | As nove suítes de `tests/browser-identity-*` (5.819 linhas) passam a rodar em algum workflow ou são arquivadas com decisão escrita | `tests/browser-identity-*/run.mjs` | M |
| A12.8 | Cobertura medida (vitest coverage) publicada como artefato do CI, sem portão no primeiro mês | `vitest.config.ts` | M |

### A13 — Documentação viva (frente `docs`, em execução)

`/checar` reescrito (feito). Restam: `/nova-tela` com o checklist real, `/release` com a mecânica real do `min_app_version`, `06-ESTADO-ATUAL` sem placar gasto, fila de dor e reauditoria marcadas como históricas, `BACKLOG` com o ✅ dos P0/P1 já fechados, `AGENTS.md` (payment_status com `recebido_na_entrega`; `review_votes`), `CONTRIBUTING` (repositório público, branch protection grátis), `README` (o que o app faz hoje).

## 4. Onda B — reescritas e refatorações (áreas nota 1 a 3)

Regra de reescrita segura: testes de caracterização antes; o novo nasce ao lado do velho; a troca no roteador é o último passo; nada de "já que estou aqui".

| # | Reescrita | O que preservar (invariantes medidas) | Estratégia | Esforço |
| --- | --- | --- | --- | --- |
| B1 | Núcleo de rotas de `App.tsx`: uma tabela declarativa por tela (pai, aceita id, é tab, chunk, guarda de auth/admin, prefetch) que gera `VIEW_COMPONENTS`, `TELAS_DE_ENTRADA`, `adminViewIndices`, as quatro listas de `?id=`, `VIEW_PREFETCH_MAP` e `paiDaTelaDoAdmin`; `PreloadedOrLazy` tipado (fim do `component: any`) | Armadilha de histórico da home; dirty → diálogo → `pendingNavigation`; `backOverride`; throttle 400/800 ms; guarda de admin em `syncWithUrl`; os 28 testes de rotas | Tabela nova alimenta as listas existentes primeiro (sem mudar comportamento), depois o `handleNavigate` é partido em funções puras testadas; `AdminLayout` perde badges e diagnóstico para hooks | G |
| B2 | `useOrders` (2.933 linhas, 18 responsabilidades, 9 consumidores) partido: `usePedidosDoPainel`, `usePedidosDoCliente`, `useFilaOfflineDeStatus`, `useCriacaoDePedido`, `usePagamentoDoPedido` | Chave de idempotência; fila offline com releitura de status; recarga por reconexão repetindo a última consulta; os 25 testes atuais | Cada hook novo nasce exportando a mesma superfície que o consumidor usa; `useOrders` vira fachada fina até o último consumidor migrar | G |
| B3 | `CheckoutView` (3.536 linhas) em: `useCheckout` (estado e efeitos), `EnderecoDoCheckout`, `PagamentoDoCheckout`, `ResumoDoCheckout`, `TelaDoPix` (com o QR persistido para sobreviver ao F5) | Rascunho do checkout; `travaDeEnvio`; `recusaDoPedido`; `backOverride` do painel de pagamento; P6 (convidado não paga online) | Extrair primeiro a tela do PIX (achado confirmado), depois o formulário de endereço; a `TelaDoPix` guarda `orderId` + `qr` em `sessionStorage` e é reaberta a partir de "Meus Pedidos" | G |
| B4 | `AdminProductFormView` (3.586 linhas): um só esquema dos 19 campos (`camposDoProduto.ts`) usado pelo estado inicial, pelo rascunho, pelo dirty e pelo submit; um só pipeline de imagem; submit pela RPC atômica de A11.4; modais como diálogos | Rascunho em `localStorage`; duplo clique; um grupo de variação; variante composta; TruthGate; os 6 testes da tela | Esquema único primeiro (zera as seis cópias), depois `useFormularioDoProduto`, depois a tela composta por seções, como `AdminSettingsView` | G |
| B5 | `AdminBannersView` (5.038 linhas) e `ImageAdjuster` (1.802): lista, assistente de 3 passos, cores, agendamento e upload em seções; `bannerVazio()` único; geometria do recorte extraída e testada | RPC atômica de reorder; exclusão de upload órfão sem apagar imagem alheia; os 15 testes | Começa pelas três tarefas confirmadas (Esc, toggle sem toast, objeto duplicado) e pela extração da geometria; a reescrita da tela vem depois de B4, reaproveitando o padrão de seções | G |
| B6 | `AuthContext` (1.201 linhas): boot de sessão, checagem de admin, ações de conta e limpeza de PII em módulos; lista de views redirecionáveis num lugar só | `adminStatus` só por veredito do servidor; não-veredito nunca vira cache; troca de conta zera antes de fetch; os ~30 testes | Extrair `useChecagemDeAdmin` e `limpezaDeSessao` primeiro | M |
| B7 | Catálogo acima de 200 produtos: vitrine e busca paginadas do servidor (cursor por `data_cadastro,id`), cofre sem `replaceAll` de 200, busca por código com índice | Ordenação da vitrine (sem estoque no fim); filtros de categoria; cofre coerente com o `catchUp` | Primeiro o cofre (A10.4), depois a paginação da vitrine; a busca do cliente passa a usar a RPC com `unaccent` indexado | G |
| B8 | Frete: um predicado `temFreteGratis(carrinho, config)` servido pelo servidor (RPC ou coluna calculada) e consumido pelo carrinho, pelos selos e pela edge; `calculate-shipping` (1.318 linhas com `@ts-nocheck`) em módulos tipados sem os ~130 lines mortos | Sentinelas de `free_shipping_min`; guarda do Finalizar; auto-seleção; os 50 testes | A9 primeiro (defeitos), depois a unificação: a RPC v23/v24 é a fonte, a edge e o front passam a chamar a mesma função | G |
| B9 | PWA: sentinela, aviso de atualização, motor de realtime (rodadas por volta à aba, esquema único, `onversionchange`) e `state-worker` morto | Atualização com consentimento; líder entre abas; whitelist do purge | Segue A10 | M |
| B10 | Tooling: medição honesta de bundle, `clsx` fora do vendor de gráficos, `lint:lockfile` e `knip` no CI, cobertura publicada | Catraca de lint como está | Segue A12 | M |

## 5. Onda C — venda presencial (PDV) com leitor de código de barras

### 5.0 Requisitos do dono (transcrição organizada, 15/09/2026)

1. O lojista gerencia a loja por completo dentro do app; a primeira peça é a venda presencial (balcão).
2. Cadastro do produto: campo de código de barras preenchido pela câmera do celular (ou digitado).
3. Botão rápido de venda física: abre a câmera, lê o código, identifica produto e preço, soma ao cupom; a tela espera ajuste de quantidade ou a próxima leitura, contínua, sem apertar botão a cada item.
4. Pergunta se o cliente é cadastrado para registrar quem comprou; se não for, oferece registrar ou seguir sem cliente.
5. Fechamento: pagamento presencial (dinheiro, PIX na hora, cartão na maquininha), estoque baixado, venda aparece em pedidos e relatórios como qualquer venda, recibo compartilhável.
6. Depois, sem inflar o primeiro lote: entrada e ajuste de estoque por leitura, leitor físico USB/Bluetooth, desconto no balcão, troca/devolução.

### 5.1 O que já existe e o desenho reaproveita (medido)

- Recebimento em dinheiro fora do gateway já tem nome e dono: `payment_status = 'recebido_na_entrega'`, RPC `registrar_pagamento_recebido`, histórico em `marketplace_order_payment_history`, e a lista fechada de "dinheiro reconhecido" (`pago`, `pago_apos_expirar`, `recebido_na_entrega`) usada por todos os KPIs e pela ficha do cliente.
- A baixa de estoque tem uma forma só, escrita na RPC do pedido: com `variant_id`, `UPDATE product_variants SET stock_increment = stock_increment - qtd WHERE stock_increment >= qtd`; sem, o mesmo sobre `produtos.estoque`; nunca os dois. Variante composta é uma linha só de `product_variants`.
- Preço nunca vem do cliente: `COALESCE(v.price_override, p.preco_venda)` no servidor e `precoVendido()` no front.
- Idempotência: `p_idempotency_key` com índice único e recuperação do pedido já nascido.
- `notify-new-order` e `send-order-confirmation` são chamadas pelo front depois do INSERT e não olham `payment_status`: servem à venda presencial como estão.
- Padrão de RPC admin: `SECURITY DEFINER`, `SET search_path = pg_catalog, pg_temp`, `IF public.is_admin() IS DISTINCT FROM true THEN RAISE 42501`, `REVOKE ALL` antes do `GRANT` nomeado (molde: migration 20261122000000).
- Tela admin: sub-view registrada nos 12 pontos do roteador (seção A2/`/nova-tela` reescrito), padrão "view fina + seções + hook" de `AdminSettingsView`/`MercadoPagoSection`; formulário com `useState` + `LocalBufferedInput`.
- Cofre offline já guarda `products` e `product_variants` mapeados; ganha um índice novo por migration do IndexedDB.

O que não existe: coluna de código de barras, noção de canal da venda, RPC de venda presencial, busca por código exato, componente de câmera (a `Permissions-Policy` do `vercel.json` nega a câmera até para a própria origem: `camera=()`), fila de escrita offline para criar pedido, criação de cliente pelo lojista.

### 5.2 Modelo de dados (uma migration aditiva, com rollback e teste estático)

| Objeto | Mudança | Por quê |
| --- | --- | --- |
| `produtos.codigo_barras text` | coluna + `GRANT SELECT (codigo_barras) ON produtos TO authenticated` (a porta do `authenticated` é por coluna, lista de 29 nomes) + índice único parcial `WHERE codigo_barras IS NOT NULL AND deleted_at IS NULL` | EAN/GTIN é global: unicidade global é a certa aqui (ao contrário do SKU) |
| `product_variants.codigo_barras text` | coluna + índice único parcial `WHERE codigo_barras IS NOT NULL` | a combinação (Branca/PP) tem o próprio código |
| `vw_produtos_public`, `vw_produtos_admin` | recriadas com a coluna no fim (`CREATE OR REPLACE VIEW` só acrescenta no fim) | views listam colunas uma a uma; a admin é a porta de escrita do painel |
| `marketplace_orders.canal text NOT NULL DEFAULT 'online' CHECK (canal IN ('online','presencial'))` | coluna | filtros, CSV, rótulos e KPIs distinguem a venda de balcão sem oitavo `payment_status` |
| `marketplace_orders.vendedor_id uuid NULL REFERENCES auth.users(id)` | coluna | quem registrou a venda, sempre `auth.uid()` dentro da RPC (nunca parâmetro) |
| `get_admin_orders_paged` | parâmetro opcional `p_canal` e coluna `canal` no retorno | chip "Balcão" na lista |
| `buscar_por_codigo_barras(p_codigo text) RETURNS jsonb` | RPC admin: igualdade em `produtos.codigo_barras` ou `product_variants.codigo_barras`, devolve `{produto, variante}` já resolvido (nome, preço vendido, estoque efetivo, imagem, `variant_id`) | o código pode estar na variação; o cupom precisa do `variant_id` |
| `registrar_venda_presencial(p_itens jsonb, p_pagamento text, p_cliente_user_id uuid, p_cliente_nome text, p_cliente_whatsapp text, p_desconto numeric, p_observacao text, p_idempotency_key uuid) RETURNS jsonb` | RPC admin, atômica: valida itens com `FOR NO KEY UPDATE`, preço do banco, baixa de estoque na forma da v23, INSERT em `marketplace_orders` (`canal='presencial'`, `status='delivered'`, `payment_method` em `cash`/`pix`/`card`, `payment_status='recebido_na_entrega'`, `pagamento_recebido_em=now()`, `pagamento_recebido_por=auth.uid()`, `vendedor_id=auth.uid()`, `user_id=p_cliente_user_id`, `customer_data={whatsapp, canal}`, `shipping=0`, `expires_at NULL`), itens com snapshot, linha em `marketplace_order_history` (`NULL → delivered`) e em `marketplace_order_payment_history` (`recebido`), retorna o pedido | uma transação; nada nasce pela metade; idempotente pelo duplo toque |
| `tests/migration_<nome>_test.ts` + `rollback-manual-<nome>.sql` + `database.types.ts` | par e tipos | receita real da casa (A5.4) |

Método de pagamento reaproveita os valores existentes (`cash`, `pix`, `card`); o `canal` diz que foi presencial. Rótulos: `paymentStatusConfig` passa a receber o canal e mostra "Recebido no balcão" em vez de "Recebido na entrega" quando `canal = 'presencial'`; o mesmo em `OrderList`, ficha, CSV e e-mail de confirmação ("Compra na loja", sem bloco de endereço). Os KPIs contam a venda automaticamente porque o valor de `payment_status` é um dos três reconhecidos.

Cancelar uma venda presencial: `update_order_status_atomic(id, 'cancelled')` devolve o estoque (funciona a partir de `delivered` para admin). O dinheiro devolvido em mãos é registrado por `registrar_estorno_manual` (já existe), com o texto da ficha ajustado para "Devolvido no balcão" quando `canal = 'presencial'` (hoje a frase fala em Mercado Pago).

### 5.3 Telas e fluxo do caixa

Tela `admin-pdv` (sub-view; não é sexta aba), aberta por um botão "Vender" destacado na barra inferior do admin no celular e na barra lateral no computador. A view é fina; o estado mora em `useVendaPresencial` (máquina: `lendo → item lido → cupom → cliente → fechamento → recibo`), com seções pequenas:

1. **Leitor** (`LeitorDeCodigo`): abre a câmera traseira (`getUserMedia`), decodifica quadro a quadro, ignora o mesmo código por 1,5 s, dá bip + vibração a cada leitura, mostra o último item lido em destaque com `−`/`+` de quantidade e "remover"; continua lendo sem apertar nada (fluxo de caixa de mercado). Código desconhecido: cartão "não cadastrado" com atalho "cadastrar produto com este código". Esgotado: aviso e não entra. Produto com variações e código do produto (não da variação): folha de escolha da combinação. Leitor físico USB/Bluetooth (teclado): buffer global de teclas terminado por Enter, mesmo caminho do código lido.
2. **Cupom** (`CupomDaVenda`): itens com foto, nome, variação, quantidade e preço vendido; subtotal; busca manual por nome/SKU (RPC paginada já existente) para produto sem código.
3. **Cliente** (`ClienteDaVenda`): busca por nome, e-mail ou WhatsApp em `get_admin_customers_paged`; ou "sem cliente"; ou nome + WhatsApp avulsos (vão em `customer_data`, como pedido de convidado). Criar conta para o cliente no balcão é decisão do dono (seção 6).
4. **Fechamento** (`FechamentoDaVenda`): dinheiro, PIX na hora ou cartão na maquininha; desconto em reais com motivo (decisão do dono); botão "Registrar venda" com chave de idempotência; sem rede: aviso honesto e cupom preservado em rascunho (`localStorage`, prefixo na whitelist do purge).
5. **Recibo**: `OrderReceipt` já existente, com "Compra na loja"; compartilhar por WhatsApp (`wa.me`); e-mail de confirmação se o cliente tiver e-mail; aviso ao lojista dispensado quando a origem é o próprio painel.

Voltar do celular: cada camada (leitor, folha de variação, cliente) empurra `history.pushState({modal})` e registra `onSetBackOverride`, como o checkout; `onSetDirty(true)` enquanto o cupom tiver itens. F5 recupera o rascunho.

Formulário do produto: campo "Código de barras" para o produto e para cada variação, com botão "Ler com a câmera" (o mesmo leitor em modo de uma leitura) e checagem de duplicidade por `buscar_por_codigo_barras`. O `<input type="file">` da foto ganha `capture="environment"` como opção "Tirar foto".

### 5.4 Tecnologia do leitor e plataforma

| Ponto | Decisão | Medido |
| --- | --- | --- |
| Decodificação | `BarcodeDetector` nativo quando existir (Chrome/Android, 0 byte); fallback `zxing-wasm` (leitura apenas) carregado só quando o nativo falta (Safari iOS) | não há nenhum leitor no repo; a CSP já tem `wasm-unsafe-eval` e `worker-src blob:` |
| Permissão de câmera | `vercel.json`: `Permissions-Policy: camera=(self)` (hoje `camera=()`, negado até para a própria origem) | bloqueio confirmado pelo leitor da área PWA |
| Bundle | o `.wasm` não entra em `dist/assets/*.js`; o JS do fallback entra e é lazy; antes de adicionar qualquer biblioteca, A12.2 (medida honesta: 777 kB de 800) e A12.3 (recharts fora do boot, 92 kB) | folga honesta hoje: 23 kB |
| Precache | o chunk do PDV precisa de nome fora de `assets/Admin*.js` (excluído do precache) ou entrada explícita; `wasm` entra no `globPatterns` do service worker | 28 chunks do admin fora do precache hoje |
| Offline | leitura e identificação funcionam pelo cofre (índice `by_codigo_barras` em `products` e `product_variants`, migration 3 do IndexedDB); fechar a venda exige rede na v1; fila com idempotência é a C6 | sem fila de criação de pedido hoje |
| Aviso de atualização | não pode cobrir a tela do PDV no meio de uma venda (A10.2) | `PWAUpdateGate` só protege telas do cliente |

### 5.5 Testes do PDV

| Prova | Onde |
| --- | --- |
| Migration e rollback são espelho; sem `BEGIN/COMMIT`; colunas, índices, grants e views | `tests/migration_venda_presencial_e_codigo_de_barras_test.ts` |
| RPC: preço do banco, baixa XOR, idempotência, recusa sem admin, histórico e pagamento gravados | `tests/banco/invariantes-dinheiro.cjs` (job `rpc-ci`, Postgres efêmero) |
| Máquina de estados do caixa (leitura repetida, desconhecido, esgotado, variação, quantidade, rascunho) | `tests/front/venda-presencial-maquina-de-estados.test.tsx` |
| Leitor: nativo vs fallback, buffer do leitor físico, debounce | `tests/front/leitor-de-codigo-*.test.tsx` (com `BarcodeDetector` dublê) |
| Tela: registro nos 12 pontos do roteador (contagens de `rotas-de-entrada` e `hospedagem-rotas` atualizadas), Voltar fecha só a camada, dirty enquanto há cupom | `tests/front/admin-pdv-*.test.tsx` |
| Lista, ficha, CSV e badges com `canal = 'presencial'`: rótulo "Balcão", sem endereço, "Recebido no balcão" | `tests/front/pedido-presencial-*.test.tsx` |
| Formulário do produto: campo, leitura única, duplicidade | `tests/front/admin-product-form-codigo-de-barras.test.tsx` |
| Cabeçalhos: `camera=(self)` e `wasm` no precache | `tests/front/vercel-headers-*.test.ts`, `pwa-precache-*.test.ts` |

### 5.6 Lotes da Onda C

| Lote | Conteúdo | Depende de | Risco |
| --- | --- | --- | --- |
| C1 | Migration (colunas, índices, grants, views, `canal`, `vendedor_id`, `p_canal` em `get_admin_orders_paged`), RPCs `buscar_por_codigo_barras` e `registrar_venda_presencial`, rollback, teste estático, invariantes no `rpc-ci`, tipos | A5.4 (receita), A7 (fila de migrations serializada) | alto |
| C2 | `LeitorDeCodigo` (câmera, nativo + fallback, leitor físico, bip/vibração), `camera=(self)`, `wasm` no precache, nome do chunk fora da exclusão; A12.2 e A12.3 antes da dependência nova | A12.2, A12.3 | médio |
| C3 | `useVendaPresencial` + tela `admin-pdv` (leitor, cupom, cliente, fechamento, recibo), registro nos 12 pontos, botão "Vender", rascunho, Voltar e dirty | C1, C2 | médio |
| C4 | Canal nos consumidores: mapper, `OrderList`, ficha, CSV, `paymentStatusConfig` por canal, e-mail/WhatsApp "Compra na loja", chip "Balcão" na lista, `registrar_estorno_manual` com texto de balcão | C1 | médio |
| C5 | Formulário do produto: campo de código no produto e nas variações, leitura pela câmera, duplicidade; mapper, `dbUpdates` (3 lugares), os 8 pontos da tela, cofre (`catchUp` e índice) | C1, C2 | médio |
| C6 | Operação da loja física, depois do primeiro uso real: entrada e ajuste de estoque por leitura (tabela `movimentacoes_de_estoque`, que também conserta o "Estoque Investido" de A8), fila de vendas sem rede com idempotência, troca/devolução parcial, papéis `vendedor`/`gerente` | C3 em produção | alto |

## 6. Decisões para o Gabriel (cada uma com recomendação e a conta feita)

| # | Decisão | Recomendação | Conta |
| --- | --- | --- | --- |
| D1 | Como a venda presencial paga aparece: reaproveitar `payment_status = 'recebido_na_entrega'` com rótulo por canal, ou criar o valor `recebido_no_balcao` | Reaproveitar | Melhora: os KPIs, a ficha do cliente e o CSV contam a venda sem mudar oito lugares e uma CHECK. Piora: o valor no banco tem nome de entrega. Conserto: o rótulo é função do canal em um lugar só. |
| D2 | Cliente no balcão que não tem conta: só nome + WhatsApp avulsos (como convidado) ou criar a conta na hora (convite por e-mail/WhatsApp com senha a definir) | Avulso na v1; convite na C6 | Melhora: a venda fecha em segundos. Piora: o cliente não vê a compra em "Meus Pedidos" até ter conta. Conserto: quando ele criar conta com o mesmo WhatsApp, uma RPC pode reatribuir os pedidos avulsos (`user_id`). |
| D3 | Venda sem rede: recusar com o cupom preservado, ou enfileirar e registrar quando voltar | Recusar na v1 | Melhora: estoque e dinheiro nunca ficam "pendentes de sincronização" num tablet. Piora: sem sinal a venda espera. Conserto: C6 traz a fila com idempotência, depois que a v1 mostrar como a loja usa. |
| D4 | Desconto no balcão: nenhum, em reais com motivo, ou em porcentagem | Em reais com motivo, gravado em `discount` e no `observation` | Melhora: fecha a venda real ("arredonda para 50"). Piora: abre porta para erro de digitação. Conserto: limite por venda configurável em `store_config` (C6). |
| D5 | Voltar do admin: histórico real (`history.back`) ou pai fixo | Histórico real com o pai como reserva | Melhora: o histórico para de crescer a cada ida e volta (achado A2). Piora: muda um hábito. Conserto: os 21 testes do pai continuam como reserva. |
| D6 | Papéis `vendedor`/`gerente`: usar já no PDV ou só admin | Só admin na v1 | Melhora: zero migration de RLS agora. Piora: todo operador é admin. Conserto: C6 desenha os papéis a partir do uso real. |
| D7 | `console.*` em produção (576 chamadas): remover `log`/`debug` no build e manter `warn`/`error` | Remover no build (`esbuild.pure`) | Melhora: menos ruído e nenhum dado de cliente no console. Piora: diagnóstico em produção só por `warn`/`error`. Conserto: os laudos forenses do IndexedDB já existem. |
| D8 | Teto do bundle: corrigir a medida (777 kB reais de 800) e reduzir antes do PDV, ou subir o teto | Corrigir e reduzir (A12.2, A12.3) | Melhora: o portão volta a proteger. Piora: dois PRs de tooling antes da biblioteca do leitor. Conserto: nenhum. |
| D9 | Catálogo acima de 200 produtos: paginar a vitrine (B7) agora ou depois do PDV | Depois de C3, antes da loja passar de 150 produtos | Melhora: PDV chega antes. Piora: risco de a loja crescer antes. Conserto: alerta no painel ao chegar a 150 produtos. |
| D10 | Fallback do leitor no iPhone: incluir `zxing-wasm` ou só nativo | Incluir, lazy | Melhora: iPhone lê. Piora: dependência nova e chunk extra. Conserto: carregado só quando o nativo falta. |
| D11 | Branch protection: o repositório é público e a proteção é grátis | Ligar (checks obrigatórios: os jobs do `ci.yml`) | Melhora: CI vermelho deixa de ser só aviso. Piora: hotfix exige PR. Conserto: nenhum. |
| D12 | Valor divergente no PIX (política P2): registrar como `recusado`, avisar lojista e cliente, e pedir novo pagamento (A7.5) | Fazer | Melhora: P2 vira código. Piora: mais um estado na tela do PIX. Conserto: reaproveita `recusaDoPedido`. |

## 7. Verificação global e critérios de saída

Cada lote: `npm run typecheck` · testes do lote · `npm run build` · `npm run size` · `npm run lint:ratchet` · `npm run lint:links` quando toca `.md`. Antes de tirar o PR do rascunho: `npm test` inteiro (edge, unit, front), `npm run build` e `npm run size` com o artefato promovível.

Critérios de saída da super atualização:

| Critério | Como se prova |
| --- | --- |
| Todos os achados confirmados (Ondas A e C) fechados com teste nomeado pelo comportamento | cada tarefa tem o arquivo de teste na tabela; CI verde |
| Catraca abaixada para os números medidos no CI (eslint hoje 467 contra teto 485) | `.lint-baseline.json` no mesmo PR em que o CI mediu |
| Bundle: medida honesta e abaixo de 800 kB brotli somado, com a biblioteca do leitor incluída | `npm run size` no artefato promovível |
| Nenhum arquivo de `src/` acima de 1.500 linhas sem plano de partição escrito (Onda B) | `wc -l` e a tabela da seção 4 |
| Chaves do Mercado Pago do lojista valendo (A1): teste da edge prova o Bearer decifrado; interruptor liga o PIX na vitrine em até 1 minuto | `index_test.ts` das quatro functions; teste da tela |
| PDV: uma venda de balcão lida pela câmera, com cliente vinculado, aparece na lista, na ficha, no CSV, na receita do dia e em "Meus Pedidos" do cliente; cancelamento devolve estoque uma vez só | testes de C1 a C4 e prova manual no preview da Vercel |
| Documentos de `.claude/` e `docs/onboarding` sem afirmação falsa sobre o estado | frente `docs` + `lint:links` |

## 8. Ordem de execução e paralelismo

```
Agora (em paralelo, arquivos disjuntos):
  A1 chaves do MP ──────────────┐
  A2 roteador ─┐                │
  A3 pedidos ──┤ (useOrders.ts é gargalo: só A3 o toca)
  A4 checkout ─┤ (CheckoutView.tsx: só A4 e depois A9.13)
  A5 vitrine+banco ─┤
  A6 painel ────────┤
  A9 frete (edge | vitrine) ────┤
  A13 docs ─────────────────────┘
Depois de A1..A6:            A7 banco/RPCs (migrations em série, um timestamp por vez)
Confirmados em 16/09:        A10 PWA (menos A10.1) · A11 catálogo · A12 tooling (segunda lente em curso)
Onda C:                      C1 (com A7, na mesma fila de migrations) ‖ C2 (após A12.2/A12.3)
                             C3 e C5 após C1+C2 · C4 após C1 · C6 após uso real
Onda B (por área, após a A da área):  B4 → B5 · B2 → B3 · B1 por último (toca App.tsx, que todos usam)
```

Regra de conflito: `App.tsx`, `useOrders.ts`, `mappers.ts`, `database.types.ts`, `AdminLayout.tsx`, `types/index.ts` e `supabase/migrations/` só têm um escritor por vez; quem precisar de um deles em outra frente para e relata, em vez de editar.
