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
| (as demais áreas entram na parte 2 deste documento) | | | |

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

> **Parte 2 (em preparação nesta mesma branch):** notas e achados das áreas auth, PWA, catálogo, painel (dashboard, clientes, banners, push, avaliações, Q&A, cupons, ajustes), edge functions, frete, testes/bundle e docs; lotes da Onda B (reescritas) e da Onda C (PDV); decisões para o dono.

## Princípios de execução (valem para todo lote)

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

## Verificação real (a mesma ordem do CI)

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

## Requisitos do PDV (transcrição organizada do pedido do dono, 15/09/2026)

1. O lojista gerencia a loja por completo dentro do app; a primeira peça é a venda presencial (balcão).
2. Cadastro do produto: campo de código de barras preenchido pela câmera do celular (ou digitado).
3. Botão rápido de venda física: abre a câmera, lê o código, identifica produto e preço, soma ao cupom; a tela espera ajuste de quantidade ou a próxima leitura, contínua, sem apertar botão a cada item.
4. Pergunta se o cliente é cadastrado para registrar quem comprou; se não for, oferece registrar ou seguir sem cliente.
5. Fechamento: pagamento presencial (dinheiro, PIX na hora, cartão na maquininha), estoque baixado, venda aparece em pedidos e relatórios como qualquer venda, recibo compartilhável.
6. Depois, sem inflar o primeiro lote: entrada e ajuste de estoque por leitura, leitor físico USB/Bluetooth, desconto no balcão, troca/devolução.
