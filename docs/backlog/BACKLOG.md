# Backlog — IKCOUS Marketplace

> ⚠️ **Nenhuma das 111 tarefas abaixo tem campo de estado.** Os 11 campos por tarefa (Épico,
> Tipo, Tamanho, Risco, Prioridade, Evidência, Depende de, Critério de aceite, Contexto,
> Arquivos, Bom pra quem chega) **não incluem "feito ou não"** — então este arquivo lista
> trabalho já concluído como se estivesse pendente.
>
> **Prova disso, medida em 22/08/2026:** `PEDIDO-010` continua marcado **P0** aqui, e está
> corrigido desde `supabase/migrations/20260804010000_fix_order_owner_check_null_safety.sql:99`,
> de **04/08**.
>
> **Antes de pegar qualquer tarefa daqui, confira o estado real em
> [`../auditoria/2026-08-22-reauditoria-de-julho.md`](../auditoria/2026-08-22-reauditoria-de-julho.md).**
> O mesmo vale para o [`backlog.csv`](backlog.csv), que sai da mesma fonte.

Gerado em 30/07/2026, a partir da reauditoria dos 85 achados de 29/07, do estado medido do
banco de produção e do levantamento de lacuna de produto. O retrato que originou este backlog
está em [`06-ESTADO-ATUAL.md`](../onboarding/06-ESTADO-ATUAL.md); a ordem sugerida de ataque,
em [`ROADMAP.md`](ROADMAP.md).

**111 tarefas** — 4 P0 · 32 P1 · 57 P2 · 18 P3, em 22 épicos.

A mesma lista, achatada para importar no Notion ou no Excel, está em
[`backlog.csv`](backlog.csv). Os dois arquivos são gerados da mesma fonte, então não divergem —
editar um à mão faz os dois saírem de sincronia.

> **Como ler a prioridade.** P0 é "a loja está perdendo dinheiro agora"; P1 é "perde venda";
> P2 "atrapalha"; P3 "melhoria". Se tudo fosse P0, nada seria. São 4 P0 neste backlog.
>
> **Antes de puxar cartão, leia a abertura do [`ROADMAP.md`](ROADMAP.md).** Três pares de
> tarefas aqui descrevem o mesmo trabalho por ângulos diferentes e precisam ser executados
> juntos, num PR só — senão o segundo vira retrabalho. O ROADMAP lista quais são.

---

## Por onde o Netim começa

7 tarefas de entrada, escolhidas com estes critérios: entregam valor real,
têm escopo fechado (não dependem de decisão pendente), atravessam uma camada inteira do
sistema — que é como se aprende a arquitetura fazendo — e têm risco baixo de derrubar a loja.
Estão espalhadas por áreas diferentes de propósito.

| ID | Tarefa | O que ela ensina |
| --- | --- | --- |
| `ADMIN-130` | Exportar pedidos em CSV a partir do painel | Ensina o formato real do pedido (itens, subtotal, frete, desconto, status) e como a listagem do admin filtra e pagina, sem escrever uma linha no banco. Entrega ao lojista o primeiro relatório que sai do sistema, hoje inexistente. |
| `BANCO-020` | Adicionar guarda de is_admin em get_category_analytics | É a porta de entrada para o padrão de RPC SECURITY DEFINER com guarda de is_admin(), que sustenta boa parte do backend, e obriga a escrever e aplicar uma migration num projeto cujo ledger está fora de sincronia. Fecha um vazamento real: hoje qualquer cliente cadastrado extrai o faturamento consolidado da loja. |
| `BUSCA-010` | Normalizar acentuação nos três pontos de busca do cliente | Revela que existem três implementações independentes de busca no cliente e que src/lib/utils.ts é onde regra repetida deveria morar. Valor direto em venda: quem digita sem acento, que é o padrão no teclado do celular, hoje não acha o produto mesmo com ele ativo e em estoque. |
| `INFRA-020` | Fazer `npm run typecheck` checar de verdade | Abre a configuração de build do projeto — tsconfig solution-style com project references — e devolve a rede de segurança que hoje é verde falso, já que o comando passa em menos de um segundo sem analisar arquivo nenhum. Vale como primeiro commit do dia 1: sem ele, toda task seguinte é feita no escuro. |
| `PEDIDO-030` | Impedir que a reconexão do realtime zere a lista de pedidos do admin | Mostra que o mesmo hook useOrders serve as duas metades do app, cliente e admin, por caminhos diferentes, e como o realtime recarrega dados ao reconectar. O sintoma — o lojista vendo "nenhum pedido" com pedidos parados na fila — é o pior risco operacional da loja hoje. |
| `PEDIDO-060` | Mostrar o código de rastreio para o cliente | Atravessa a fatia de dados inteira numa tacada fina: coluna no banco, mapper, hook de pedidos e tela do cliente. Ensina por que o front tem uma camada de mappers traduzindo o formato do banco para o formato do app, e entrega valor visível ao comprador já no primeiro PR. |
| `PUSH-020` | Checar a sessão antes de criar a assinatura push no navegador | Costura permissão do navegador, sessão do AuthContext e RLS de push_subscriptions numa correção curta — o jeito mais barato de entender por que uma escrita falha silenciosamente quando não há usuário logado. Hoje o cliente acha que está inscrito, nunca recebe nada, e a permissão do navegador já foi gasta. |

Candidatas que **não** entraram, e por quê:

- **Criar o primeiro workflow de CI rodando lint, typecheck e build (n=79)** — Parecia a melhor forma de aprender o projeto por fora, mas não tem escopo fechado: depende da task 78 (destravar `*.yml` no .gitignore) e o critério de aceite exige definir um limite de warnings de lint com 1.106 avisos preexistentes, o que é acordo entre os dois devs, não decisão do Netim. É o passo natural logo depois do typecheck (n=77) — e a suíte de testes do front (n=81) só faz sentido depois dele.
- **Mostrar alerta de estoque baixo no dashboard e tornar o limiar configuravel (n=71)** — A primeira metade é ótima (o dado já vem da RPC e ninguém renderiza), mas "o limiar vem da configuração da loja" arrasta store_config, que exige edição em seis pontos mais migration (é a task n=59 inteira). O escopo escapa no meio do caminho.
- **Criar chave de idempotencia do pedido e lock sincrono no botao de finalizar (n=16)** — Valor alto e problema real, mas acrescenta coluna e índice único em marketplace_orders e um short-circuit na RPC de checkout; errar o índice bloqueia pedido legítimo. Risco de derrubar a venda, não é trabalho de quem ainda não tem o mapa do sistema.
- **Unificar a regra de frete gratis, que hoje esta escrita em sete lugares (n=56)** — Consolidação tentadora e didática no papel, mas é a regra mais frágil do sistema e acabou de ser corrigida em 29/07 depois de derrubar o checkout de convidado. Reescrever sem preservar o comportamento exato reabre o incidente.
- **O que fazer com as 42 migrations pendentes e as 28 versoes do ledger sem arquivo? (n=100)** — É tipo `decisao`, portanto fora por regra, e é o item de maior raio de explosão do projeto: aplicar a fila abortaria no meio, com boa parte do RLS já desmontada. Precisa da decisão do Gabriel antes de virar trabalho de qualquer um.

---

## Índice

| ID | Título | Tipo | Prio | Tam | Entrada |
| --- | --- | --- | --- | --- | --- |
| `AUTH-010` | Exigir e-mail e WhatsApp juntos e amarrar o OTP de convidado a um pedido específico | bug | P0 | G | — |
| `CHECKOUT-010` | Decidir: a loja vai cobrar dentro do site ou a cobrança continua acontecendo fora? | decisao | P0 | P | — |
| `PEDIDO-010` | Trocar != por IS DISTINCT FROM na checagem de dono de update_order_status_atomic | bug | P0 | M | — |
| `PEDIDO-020` | Avisar o lojista quando entra um pedido novo | feature | P0 | M | — |
| `ADMIN-010` | Fazer updateConfig sinalizar falha em vez de engolir o erro e mostrar sucesso | bug | P1 | M | — |
| `ADMIN-020` | Decidir se as colunas de vitrines e de banner completo entram no banco ou saem do código | decisao | P1 | P | — |
| `ADMIN-030` | Parar de apagar do storage a imagem de banner que o admin não enviou nesta sessão | bug | P1 | M | — |
| `AUTH-020` | Por que o envio do OTP depende de um SEGUNDO projeto Supabase e quem tem acesso a ele? | decisao | P1 | P | — |
| `BANCO-010` | Parar de expor a coluna custo para qualquer usuário autenticado | bug | P1 | M | — |
| `BANCO-020` | Adicionar guarda de is_admin em get_category_analytics | bug | P1 | P | ✅ |
| `BANCO-030` | Decidir a estratégia de reconciliação do ledger de migrations | decisao | P1 | M | — |
| `BANCO-040` | Qual política de backup e PITR está ativa no plano Supabase? | decisao | P1 | P | — |
| `BANCO-050` | O que fazer com as 42 migrations pendentes e as 28 versões do ledger sem arquivo? | decisao | P1 | P | — |
| `CARRINHO-010` | Preservar variantNames na reidratação do localStorage e na sincronia entre dispositivos | bug | P1 | M | — |
| `CARRINHO-020` | Reidratar o snapshot de produto guardado no carrinho antes do checkout | bug | P1 | G | — |
| `CATALOGO-010` | Parar de esvaziar o catálogo quando a consulta pública de produtos falha | bug | P1 | M | — |
| `CATALOGO-020` | Por que o catálogo está travado em 200 produtos? | decisao | P1 | P | — |
| `CHECKOUT-020` | Bloquear checkout com carrinho vazio no front e no RPC | bug | P1 | M | — |
| `CHECKOUT-030` | Criar chave de idempotência do pedido e lock síncrono no botão de finalizar | bug | P1 | G | — |
| `CHECKOUT-040` | Registrar status de pagamento do pedido (pendente/pago/estornado) no admin | feature | P1 | M | — |
| `FRETE-010` | Qual provedor de frete está realmente ativo em produção: flat_fee, Melhor Envio ou Frenet? | decisao | P1 | P | — |
| `INFRA-010` | Eliminar as requisições duplicadas do boot causadas por callbacks instáveis | divida tecnica | P1 | G | — |
| `INFRA-020` | Fazer `npm run typecheck` checar de verdade | infra | P1 | P | ✅ |
| `INFRA-030` | Remover `*.yml` do .gitignore para permitir arquivos de CI | infra | P1 | P | — |
| `INFRA-040` | Criar o primeiro workflow de CI rodando lint, typecheck e build | infra | P1 | M | — |
| `INFRA-050` | Proteger o `.env.bak` no .gitignore | infra | P1 | P | — |
| `INFRA-060` | Qual é a fonte de verdade das variáveis de produção, e qual DATABASE_URL ficou viva depois da troca de 30/07? | decisao | P1 | P | — |
| `PEDIDO-030` | Impedir que a reconexão do realtime zere a lista de pedidos do admin | bug | P1 | P | ✅ |
| `PEDIDO-040` | Quebrar o loop de requisições do OrderDetailsView para usuário sem pedidos | bug | P1 | P | — |
| `PEDIDO-050` | Decidir o destino do segundo projeto Supabase que envia o OTP de convidado | decisao | P1 | P | — |
| `PEDIDO-060` | Mostrar o código de rastreio para o cliente | feature | P1 | P | ✅ |
| `PEDIDO-070` | Enviar e-mail de confirmação de pedido para o cliente | feature | P1 | M | — |
| `PUSH-010` | Fazer send-push reportar quantos envios falharam em vez de sempre success:true | bug | P1 | M | — |
| `PUSH-020` | Checar a sessão antes de criar a assinatura push no navegador | bug | P1 | P | ✅ |
| `PUSH-030` | As chaves VAPID estão configuradas no ambiente da edge function send-push? | decisao | P1 | P | — |
| `PWA-010` | Unificar a recuperação de erro de chunk e dar saída para o usuário | bug | P1 | G | — |
| `ADMIN-040` | Sincronizar o cache de módulo de banners e parar de mutar o state no reorder | bug | P2 | M | — |
| `ADMIN-050` | Usar null em vez de undefined nos campos que o admin precisa poder zerar | bug | P2 | M | — |
| `ADMIN-060` | Corrigir o ciclo de vida do formulário de produto: duplo clique e rascunho perdido | bug | P2 | M | — |
| `ADMIN-070` | Inverter as fases do deleteProduct: soft-delete no banco antes de mover a mídia | bug | P2 | M | — |
| `ADMIN-080` | Fazer o modal de Perguntas e Respostas editar a resposta em vez de criar uma segunda | bug | P2 | M | — |
| `ADMIN-090` | Fazer o interruptor de Avaliações desligar as avaliações de verdade | bug | P2 | M | — |
| `ADMIN-100` | Resolver a disputa pela classe dark entre o App e o StoreContext | bug | P2 | P | — |
| `ADMIN-110` | Distinguir falha de consulta de ausência de dados no dashboard de faturamento | bug | P2 | M | — |
| `ADMIN-120` | Decidir o que fazer com AdminBannersView, que tem 5.385 linhas num componente | decisao | P2 | P | — |
| `ADMIN-130` | Exportar pedidos em CSV a partir do painel | feature | P2 | P | ✅ |
| `ADMIN-140` | Mostrar alerta de estoque baixo no dashboard e tornar o limiar configurável | feature | P2 | M | — |
| `ADMIN-150` | Registrar eventos de funil na tabela analytics_events | feature | P2 | M | — |
| `ADMIN-160` | Listar carrinhos abandonados no painel do admin | feature | P2 | M | — |
| `AUTH-030` | Fechar a enumeração de e-mails cadastrados na recuperação de senha | bug | P2 | M | — |
| `AUTH-040` | Fazer a verificação de admin resolver por usuário em vez de semáforo global de módulo | bug | P2 | M | — |
| `AUTH-050` | Encerrar a sessão localmente no logout e limpar os caches de PII do usuário anterior | bug | P2 | M | — |
| `BANCO-060` | Versionar em migration os objetos que existem em produção e não no repositório | divida tecnica | P2 | M | — |
| `BANCO-070` | Revogar ou remover as RPCs órfãs que ninguém chama e que ainda têm EXECUTE | divida tecnica | P2 | M | — |
| `BUSCA-010` | Normalizar acentuação nos três pontos de busca do cliente | bug | P2 | M | ✅ |
| `CATALOGO-030` | Tratar deleted_at no handler de UPDATE do RealtimeSyncEngine | bug | P2 | P | — |
| `CATALOGO-040` | Resetar a Home pelo critério de filtro, não pela referência do array nem pela URL | bug | P2 | M | — |
| `CATALOGO-050` | Dar key ao ProductView para não reaproveitar estado entre produtos | bug | P2 | P | — |
| `CATALOGO-060` | Tornar determinística a escolha de preço e de variante enviada ao carrinho | bug | P2 | M | — |
| `CATALOGO-070` | Remover o teto de 200 produtos e os três sintomas que ele produz | divida tecnica | P2 | G | — |
| `CATALOGO-080` | Corrigir a resposta da loja invisível e o contador Útil das avaliações | bug | P2 | M | — |
| `CATALOGO-090` | Unificar as três semânticas de estoque de variação | divida tecnica | P2 | G | — |
| `CATALOGO-100` | Os hard-codes de produto no mappers.ts podem sair? | decisao | P2 | P | — |
| `CHECKOUT-050` | Gerar PIX copia-e-cola no checkout com a chave da loja | feature | P2 | M | — |
| `CHECKOUT-060` | A loja vai emitir nota fiscal? O CPF passa a ser obrigatório no checkout? | decisao | P2 | P | — |
| `CUPOM-010` | Gravar a validade do cupom como fim do dia no fuso local, não meia-noite UTC | bug | P2 | P | — |
| `CUPOM-020` | Limitar cupom a um uso por cliente | feature | P2 | M | — |
| `DOC-010` | Introspectar e documentar as views vw_produtos_public e vw_produtos_admin | doc | P2 | P | — |
| `DOC-020` | Confirmar se o embed de product_variants sobre a view funciona nesta instância | doc | P2 | P | — |
| `DOC-030` | Documentar como deployar as 3 edge functions e quais segredos cada uma exige | doc | P2 | M | — |
| `FRETE-020` | Unificar a regra de frete grátis, que hoje está escrita em sete lugares | divida tecnica | P2 | M | — |
| `FRETE-030` | Frete grátis só para usuário logado é decisão de produto ou efeito colateral? | decisao | P2 | P | — |
| `INFRA-070` | Garantir que o RealtimeSyncEngine sempre suba, mesmo com o IndexedDB lento | bug | P2 | M | — |
| `INFRA-080` | Parar de mascarar falha de leitura do DataVault como lista vazia | bug | P2 | G | — |
| `INFRA-090` | Fatiar o refetch do catchUp e parar de logar sucesso quando a query falhou | bug | P2 | M | — |
| `INFRA-100` | Parar o prefetch preditivo de rodar em todo render e de poluir o próprio histórico | bug | P2 | P | — |
| `INFRA-110` | Remover console.* do bundle de produção e a sobrescrita global de console.warn | divida tecnica | P2 | M | — |
| `INFRA-120` | Corrigir os dois comandos que mentem sobre a qualidade do build | divida tecnica | P2 | P | — |
| `INFRA-130` | Restaurar o indicador de foco de teclado e corrigir os alvos de toque abaixo de 44 px | bug | P2 | M | — |
| `INFRA-140` | Rodar no CI os 12 testes Deno que já existem na edge function de frete | infra | P2 | P | — |
| `INFRA-150` | Instalar um runner de teste no front e cobrir os mappers | infra | P2 | M | — |
| `INFRA-160` | Ativar hooks de git de verdade com lefthook | infra | P2 | M | — |
| `INFRA-170` | Tirar os screenshots do controle de versão | infra | P2 | M | — |
| `INFRA-180` | Limpar as branches já mergeadas e resolver o `origin/master` zumbi | infra | P2 | P | — |
| `PEDIDO-080` | Parar de prometer entrega de código OTP que não foi confirmada | bug | P2 | P | — |
| `PEDIDO-090` | Enviar o push de mudança de status somente depois que a RPC confirmar | bug | P2 | P | — |
| `PEDIDO-100` | Serializar a fila offline de status e descartar erro terminal em vez de reenfileirar | bug | P2 | M | — |
| `PEDIDO-110` | Gravar mudança de status do pedido na tabela notificacoes | feature | P2 | M | — |
| `PEDIDO-120` | Habilitar os status de devolução e estorno no ciclo do pedido | feature | P2 | M | — |
| `PEDIDO-130` | Qual é a política de devolução e troca da loja? | decisao | P2 | P | — |
| `PUSH-040` | Fazer notificação de campanha global poder ser lida e excluída pelo cliente | bug | P2 | M | — |
| `PWA-020` | Parar de cachear cada /version.json?t= como entrada nova no Service Worker | bug | P2 | P | — |
| `SEO-010` | Versionar o robots.txt e colocar as URLs de produto no sitemap | feature | P2 | P | — |
| `ADMIN-170` | Reduzir os seis pontos de edição necessários para adicionar um campo em store_config | divida tecnica | P3 | G | — |
| `AUTH-060` | Parar de derivar isAdmin do objeto de sessão em cache no localStorage | divida tecnica | P3 | P | — |
| `BUSCA-020` | Mover a busca do cliente para o servidor com índice | feature | P3 | G | — |
| `CATALOGO-110` | Passar sizes nos dois LazyImage que ainda baixam a imagem original | divida tecnica | P3 | P | — |
| `CUPOM-030` | Devolver o uso do cupom quando o pedido é cancelado | bug | P3 | M | — |
| `DOC-040` | Medir o max-rows do PostgREST deste projeto e documentar | doc | P3 | P | — |
| `DOC-050` | Fechar os links quebrados da documentação de onboarding | doc | P3 | P | — |
| `DOC-060` | Documentar o inventário real de RPCs e como contar os call sites corretamente | doc | P3 | P | — |
| `FRETE-040` | Por que R$ 15 é o fallback de frete e por que a tolerância de valor é R$ 0,05? | decisao | P3 | P | — |
| `INFRA-190` | Dar destino à URL inválida em vez de renderizar a Home com a URL errada na barra | divida tecnica | P3 | M | — |
| `INFRA-200` | Remover os arquivos e objetos fantasmas que fingem ser arquitetura | divida tecnica | P3 | P | — |
| `INFRA-210` | Corrigir a identidade do projeto no package.json | infra | P3 | P | — |
| `INFRA-220` | Fazer o Biome cobrir as edge functions e remover o ignore de caminho absoluto | infra | P3 | P | — |
| `INFRA-230` | Limpar as dependências e scripts que ninguém executa | infra | P3 | P | — |
| `INFRA-240` | Vamos reescrever o histórico do git para tirar os 15,5 MB de screenshots? | decisao | P3 | P | — |
| `INFRA-250` | Zerar os 553 warnings de eslint e baixar o teto da catraca até zero | divida tecnica | P3 | G | — |
| `PWA-030` | Por que existem 13 ramos de manualChunks no vite.config.ts? | decisao | P3 | P | — |
| `SEO-020` | Vale investir em SSR ou prerender para o preview de link de produto? | decisao | P3 | P | — |

---

## Épico: Acessibilidade e higiene do front

### [INFRA-130] Restaurar o indicador de foco de teclado e corrigir os alvos de toque abaixo de 44 px

**Tipo:** bug
**Prioridade:** P2
**Tamanho:** M
**Épico:** Acessibilidade e higiene do front
**Risco de mexer:** médio — remover o !important do seletor universal pode fazer outline aparecer em lugares onde ninguém esperava; precisa revisar visualmente as telas principais.

**Contexto:** Uma regra universal com outline: none !important zera o indicador de foco de todos os elementos, o que torna a regra :focus-visible do próprio arquivo código morto — ela não tem !important e sempre perde. Componentes shadcn escapam porque usam ring (box-shadow), mas os botões próprios do app shell (Voltar, logo, sino, carrinho, chips de categoria, cards de produto) ficam sem nenhuma indicação ao navegar por Tab. Falha WCAG 2.4.7. Junto disso, os indicadores do carrossel têm 8x6 px e os botões do header 36x36 px, contra o mínimo de 44x44 da WCAG 2.5.5.

**Evidência:** Achados #73 e R6. src/index.css:138 (`outline: none !important;` dentro do seletor universal do @layer base, bloco de :131-140) e :423-425 (:focus-visible sem !important, portanto sempre perdido). Classes outline-none que anulariam a correção: src/components/ui/custom/Header.tsx:179 e src/components/ui/custom/CategoryFilter.tsx:57 (BottomNav.tsx:94 também tem, mas compensa com focus-visible:ring-2). Alvos pequenos: src/components/ui/custom/BannerCarousel.tsx:259-262 (h-1.5 com w-2 quando inativo) e src/components/ui/custom/Header.tsx:171, :343 e :360 (size-9, subindo só para size-10 no breakpoint xs). alt vazio quando o banner não tem título: BannerCarousel.tsx:119.

**Critério de aceite:**

- [ ] O !important sai do seletor universal e a regra :focus-visible passa a valer.
- [ ] Navegar a Home inteira só com Tab mostra indicador visível em todos os controles: Voltar, logo, sino, carrinho, chips de categoria e cards de produto.
- [ ] As classes outline-none de Header.tsx:179 e CategoryFilter.tsx:57 foram removidas ou compensadas com ring.
- [ ] Os indicadores do carrossel e os botões do header têm área de toque de pelo menos 44x44 px (pode ser por padding ou pseudo-elemento, sem mudar o visual).
- [ ] Banner sem título tem alt descritivo ou aria-label equivalente.
- [ ] Nenhuma tela ganhou outline indesejado no uso com mouse (o :focus-visible só dispara em teclado).

**Arquivos envolvidos:** `src/index.css`, `src/components/ui/custom/Header.tsx`, `src/components/ui/custom/CategoryFilter.tsx`, `src/components/ui/custom/BannerCarousel.tsx`, `src/components/ui/custom/BottomNav.tsx`
**Depende de:** nada
**Bom pra quem está chegando:** não — fora das 7 tarefas de entrada escolhidas; ver "Por onde o Netim começa" no topo

### [CATALOGO-110] Passar sizes nos dois LazyImage que ainda baixam a imagem original

**Tipo:** divida tecnica
**Prioridade:** P3
**Tamanho:** P
**Épico:** Acessibilidade e higiene do front
**Risco de mexer:** baixo — a transformação já tem fallback para a URL original se falhar; a mudança é acrescentar uma prop.

**Contexto:** A infraestrutura de redimensionamento de imagem existe e já está aplicada no banner, no card de produto e na página de produto. Sobrou um resíduo: no LazyImage a transformação é opt-in pela prop sizes, e o herói do bloco de ofertas da Home e as miniaturas de review não passam sizes — então continuam baixando a imagem em resolução original. O de ofertas renderiza na Home, num container de proporção 4/3 ocupando a largura toda.

**Evidência:** Achado R5 (residual). src/lib/imageUrl.ts:35-62 (imagemRedimensionada e conjuntoDeImagens) e src/components/LazyImage.tsx:5 (escada 200-1280) e :129-134 (srcSet e sizes só quando o chamador informa sizes), com fallback em :140-149. Cobertos hoje: src/components/ui/custom/BannerCarousel.tsx:123-124, src/components/ui/custom/ProductCard.tsx:154 e src/views/customer/ProductView.tsx:730. Sem sizes: src/components/ui/custom/PremiumOffers.tsx:367-372 (renderizado na Home via src/views/customer/HomeView.tsx:312) e src/components/ui/custom/ReviewCard.tsx:129-133. O doc de arquitetura registra: de 14 usos de LazyImage, só 2 passavam sizes.

**Critério de aceite:**

- [ ] PremiumOffers e ReviewCard passam a prop sizes coerente com o container em que renderizam.
- [ ] Na aba Network da Home, a imagem do bloco de ofertas vem por /storage/v1/render/image/public/ com width, não por /object/public/.
- [ ] O peso transferido da Home caiu, medido antes e depois.
- [ ] Imagem que não é do Supabase continua sendo servida intacta.
- [ ] Os outros usos de LazyImage sem sizes foram revisados e está registrado quais foram deixados de propósito.

**Arquivos envolvidos:** `src/components/ui/custom/PremiumOffers.tsx`, `src/components/ui/custom/ReviewCard.tsx`, `src/components/LazyImage.tsx`, `src/lib/imageUrl.ts`
**Depende de:** nada
**Bom pra quem está chegando:** não — fora das 7 tarefas de entrada escolhidas; ver "Por onde o Netim começa" no topo

### [INFRA-190] Dar destino à URL inválida em vez de renderizar a Home com a URL errada na barra

**Tipo:** divida tecnica
**Prioridade:** P3
**Tamanho:** M
**Épico:** Acessibilidade e higiene do front
**Risco de mexer:** médio — o roteador é manual (useState + pushState, sem react-router) e a lista de views válidas é literal; um redirect mal colocado pode capturar rota legítima.

**Contexto:** Qualquer caminho fora da lista fixa de views cai num else vazio: a Home permanece renderizada e a URL inválida fica na barra de endereço. Não há página de erro nem redirect. E o rewrite da Vercel manda tudo para o index.html, então o servidor sempre responde 200 — o crawler indexa lixo como página válida. Um link antigo ou um erro de digitação vira uma Home com endereço errado, sem sinal nenhum de que algo deu errado.

**Evidência:** Achado R9. src/App.tsx:1434 (`if (validViews.includes(path as View))` sobre a lista literal de :1396-1433) e :1677-1679 (o else final é apenas `isTransitioningRef.current = false;`). Busca por NotFound, not-found, 'Pagina nao encontrada' e 404 em src/ não retorna nenhum componente. Não há router instalado (grep de react-router em package.json: nada), e o manualChunks do vite.config ainda cria um chunk vendor-router para pacotes que não estão instalados. vercel.json faz rewrite de /(.*) para /index.html.

**Critério de aceite:**

- [ ] Caminho fora de validViews redireciona para a Home usando replaceState, ou renderiza uma view de erro — a URL inválida não fica na barra sem nada acontecer.
- [ ] Abrir uma URL inventada não deixa o app num estado ambíguo.
- [ ] O comportamento das rotas válidas não mudou (conferir navegação entre todas as abas e o botão Voltar).
- [ ] O chunk morto vendor-router do manualChunks foi removido, já que os pacotes não estão instalados.

**Arquivos envolvidos:** `src/App.tsx`, `vite.config.ts`, `vercel.json`, `public/robots.txt`
**Depende de:** nada
**Bom pra quem está chegando:** não — mexer no roteador manual de 2.712 linhas sem teste automatizado tem chance alta de capturar rota legítima por engano.

---

## Épico: Catálogo e busca

### [BUSCA-020] Mover a busca do cliente para o servidor com índice

**Tipo:** feature
**Prioridade:** P3
**Tamanho:** G
**Épico:** Catálogo e busca
**Risco de mexer:** alto — troca a fonte da busca da loja inteira; se sair errado, a vitrine para de achar produto. Exige migration de índice e provavelmente RPC nova.

**Contexto:** A busca do cliente é String.includes() em memória sobre a lista já carregada, que está travada em 200 produtos: o produto 201 é literalmente inencontrável. Não há ranking, nem tolerância a erro de digitação, nem busca por categoria ou código. O lado admin usa ILIKE '%termo%', que é varredura, não índice. Não existe tsvector nem pg_trgm em nenhuma migration.

**Evidência:** src/hooks/useSearch.ts:20-41 (includes() em memória, consumido por src/views/customer/SearchView.tsx:99); src/contexts/StoreContext.tsx:391 e :402 (.limit(200)); src/hooks/useProducts.ts:325 (ilike sobre 'nome'); grep por tsvector|to_tsquery|pg_trgm|similarity em supabase/migrations retorna 0.

**Critério de aceite:**

- [ ] Buscar por um produto que não está entre os 200 carregados o encontra
- [ ] Busca com e sem acento devolve o mesmo resultado
- [ ] Erro de digitação de uma letra ainda encontra o produto (ou a decisão de não suportar isso está escrita)
- [ ] A busca responde em menos de 300 ms com o catálogo atual e a consulta usa índice (EXPLAIN comprovado, sem Seq Scan em produtos)

**Arquivos envolvidos:** `src/hooks/useSearch.ts`, `src/views/customer/SearchView.tsx`, `src/contexts/StoreContext.tsx`, `supabase/migrations/`
**Depende de:** [CATALOGO-020]
**Bom pra quem está chegando:** não — troca a fonte de dado da vitrine e depende de decisão de arquitetura ainda em aberto

---

## Épico: Confiabilidade do catálogo

### [CATALOGO-010] Parar de esvaziar o catálogo quando a consulta pública de produtos falha

**Tipo:** bug
**Prioridade:** P1
**Tamanho:** M
**Épico:** Confiabilidade do catálogo
**Risco de mexer:** médio — é o único caminho de carga do catálogo, com dois ramos (admin e público) e fallback entre eles. Regressão aqui é a loja em branco.

**Contexto:** No fallback para vw_produtos_public, o erro só é lançado quando a consulta admin também falhou. Para cliente comum a variável error é sempre null, então qualquer falha de rede ou de PostgREST passa batido, data fica null e o código cai no else que troca a lista de produtos por array vazio. O PWA offline perde o catálogo que já tinha no IndexedDB e mostra 'Nenhum produto agora' — o oposto do que o offline-first promete, e zero venda enquanto durar.

**Evidência:** Achado #15. src/contexts/StoreContext.tsx:397-410 (`if (publicRes.error && error) { throw error; } else if (publicRes.data) {...}`), :430-432 (`setProducts((prev) => (prev.length === 0 ? prev : []))`), :434-436 (catch só faz console.error).

**Critério de aceite:**

- [ ] Falha na consulta pública propaga o erro independentemente do ramo admin.
- [ ] Falha de rede NUNCA substitui a lista de produtos por array vazio: o que já estava carregado permanece.
- [ ] Com o catálogo em cache no IndexedDB e a rede desligada, a Home continua mostrando os produtos.
- [ ] Falha real de carga mostra algum sinal na UI em vez de 'Nenhum produto agora'.
- [ ] Primeira carga sem cache e sem rede continua mostrando estado vazio explícito, não a Home quebrada.

**Arquivos envolvidos:** `src/contexts/StoreContext.tsx`, `src/lib/dataVault.ts`, `src/views/customer/HomeView.tsx`
**Depende de:** nada
**Bom pra quem está chegando:** não — fora das 7 tarefas de entrada escolhidas; ver "Por onde o Netim começa" no topo

### [CATALOGO-030] Tratar deleted_at no handler de UPDATE do RealtimeSyncEngine

**Tipo:** bug
**Prioridade:** P2
**Tamanho:** P
**Épico:** Confiabilidade do catálogo
**Risco de mexer:** médio — chavear pela coluna errada quebra o fluxo de pausar produto. Tem que ser deleted_at, nunca 'ativo'.

**Contexto:** Excluir produto no admin é soft delete (UPDATE com deleted_at + ativo=false). O handler de INSERT/UPDATE do engine grava qualquer linha recebida no store de produtos sem olhar deleted_at, e o StoreContext relê o vault: o produto excluído reaparece na home e nos carrosséis, com preço e estoque, e continua clicável até o próximo catchUp ou reload.

**Evidência:** Achado #49. src/lib/realtimeSyncEngine.ts:430-436 (`case 'INSERT': case 'UPDATE':` com `if (raw?.id)` seguido de vault.put, sem checar deleted_at) e :484-497 (o único tratamento de remoção está no case DELETE). O filtro .is('deleted_at', null) só aparece no catchUp, em :585. Consumidor: src/contexts/StoreContext.tsx:566-578.

**Critério de aceite:**

- [ ] Linha recebida com deleted_at não nulo é removida do store em vez de gravada.
- [ ] Excluir um produto no admin faz ele sumir da Home de outra aba/dispositivo sem reload.
- [ ] Pausar um produto (ativo=false, deleted_at nulo) continua funcionando como hoje e não remove nada do cache.
- [ ] As variantes do produto removido também saem do cache.

**Arquivos envolvidos:** `src/lib/realtimeSyncEngine.ts`, `src/contexts/StoreContext.tsx`, `src/hooks/useProducts.ts`
**Depende de:** nada
**Bom pra quem está chegando:** não — fora das 7 tarefas de entrada escolhidas; ver "Por onde o Netim começa" no topo

### [BUSCA-010] Normalizar acentuação nos três pontos de busca do cliente

**Tipo:** bug
**Prioridade:** P2
**Tamanho:** M
**Épico:** Confiabilidade do catálogo
**Risco de mexer:** baixo — a técnica já existe no projeto e a mudança é aditiva; o risco é esquecer um dos lados da comparação ou um dos três arquivos.

**Contexto:** Toda a busca do cliente compara com toLowerCase() apenas, sem tirar acento. Em catálogo brasileiro, quem digita 'alianca' ou 'coracao' — comportamento padrão em teclado de celular — não acha nada, mesmo com o produto ativo e em estoque. São três implementações independentes de busca, e nenhuma normaliza. A técnica de normalização NFD já existe no repositório, só não foi aplicada aqui.

**Evidência:** Achado #46. src/hooks/useSearch.ts:22-28 (toLowerCase puro nos dois lados), src/components/ui/custom/SearchBar.tsx:108,121,131,137,148,153,163,170-173 e src/views/customer/HomeView.tsx:129-136. Grep por normalizeText em src/ retorna zero. A única normalização NFD do repo é src/hooks/useCategories.ts:121, usada só para gerar slug.

**Critério de aceite:**

- [ ] Existe um normalizeText compartilhado em src/lib/utils.ts, com remoção de diacríticos por NFD.
- [ ] A normalização é aplicada nos DOIS lados da comparação, nos três arquivos.
- [ ] Buscar 'alianca' encontra o produto cadastrado como 'Aliança' com cedilha, e vice-versa.
- [ ] Buscar por descrição com produto de description null não lança erro (hoje SearchBar.tsx:171 quebra).
- [ ] A busca do admin (ILIKE no servidor) não é alterada nesta task.

**Arquivos envolvidos:** `src/lib/utils.ts`, `src/hooks/useSearch.ts`, `src/components/ui/custom/SearchBar.tsx`, `src/views/customer/HomeView.tsx`, `src/hooks/useCategories.ts`
**Depende de:** nada
**Bom pra quem está chegando:** sim — Revela que existem três implementações independentes de busca no cliente e que src/lib/utils.ts é onde regra repetida deveria morar. Valor direto em venda: quem digita sem acento, que é o padrão no teclado do celular, hoje não acha o produto mesmo com ele ativo e em estoque.

### [CATALOGO-040] Resetar a Home pelo critério de filtro, não pela referência do array nem pela URL

**Tipo:** bug
**Prioridade:** P2
**Tamanho:** M
**Épico:** Confiabilidade do catálogo
**Risco de mexer:** médio — mexe no sincronizador de rota do App.tsx, que roda a cada navegação e tem interação com popstate e com o roteador manual.

**Contexto:** Dois defeitos que o cliente sente como 'a Home não guarda meu lugar'. Um: a paginação do scroll infinito é resetada sempre que a REFERÊNCIA do array de produtos muda, e o StoreContext troca essa referência a cada evento do RealtimeSyncEngine (qualquer venda que decremente estoque, qualquer ajuste do admin) — quem já rolou até 60 produtos volta para 12, a grade encolhe e a página salta. Dois: o filtro de categoria é relido da URL a cada execução do sincronizador de rota, e como as URLs das outras abas não carregam ?category, ir ao Carrinho e voltar reseta o filtro para 'Todas'.

**Evidência:** Achados #45 e #72. src/components/ui/custom/ProductList.tsx:36-38 (`useEffect(() => { setVisibleCount(12); }, [products]);`, sem prop resetKey na interface de :10-19) e src/contexts/StoreContext.tsx:566-578 (setProducts com array novo a cada sync). src/App.tsx:1541-1543 (lê ?category e chama setSelectedCategory dentro de syncWithUrl), com syncWithUrl chamado em :1682 e :1774 e o efeito que o contém tendo currentView nas deps (:1788-1797). handleCategoryChange em :606-613 só grava ?category enquanto se está na home.

**Critério de aceite:**

- [ ] ProductList recebe um resetKey com o critério real de filtragem (categoria|busca|ordenação) e reseta a paginação por ele, não pelo array.
- [ ] Um evento de realtime (mudança de estoque) com o usuário rolado até 60 produtos não encolhe a grade nem move o scroll.
- [ ] Trocar de categoria continua voltando a paginação para 12.
- [ ] Selecionar uma categoria, ir ao Carrinho e voltar mantém a categoria selecionada.
- [ ] Navegar pelo botão Voltar do navegador continua respeitando a categoria da URL quando ela existe.

**Arquivos envolvidos:** `src/components/ui/custom/ProductList.tsx`, `src/contexts/StoreContext.tsx`, `src/App.tsx`, `src/views/customer/HomeView.tsx`
**Depende de:** nada
**Bom pra quem está chegando:** não — o roteador do App.tsx é manual (useState + pushState, sem react-router) e tem 2.712 linhas; entender quando syncWithUrl roda exige contexto que não está escrito em lugar nenhum.

### [CATALOGO-050] Dar key ao ProductView para não reaproveitar estado entre produtos

**Tipo:** bug
**Prioridade:** P2
**Tamanho:** P
**Épico:** Confiabilidade do catálogo
**Risco de mexer:** baixo — acrescentar key segue o padrão que checkout e user-profile já usam no mesmo switch.

**Contexto:** A tela de detalhe do produto é renderizada sem key atrelada ao id, e o container das views secundárias usa key={currentView}. Navegar de um produto para outro pelas recomendações reconcilia a MESMA instância de ProductView, sem resetar quantidade, índice de imagem, variações selecionadas nem status do botão. Hoje o dano visível é limitado porque todos os 18 produtos ativos têm exatamente 1 imagem, mas o defeito volta a morder assim que houver produto com galeria ou com grupos de variação de mesmo nome.

**Evidência:** Achado #16. src/App.tsx:1945-1959 renderiza PreloadedOrLazy com component={ProductView} SEM key, ao contrário de checkout (:1967) e user-profile (:1979), que passam key. Em src/views/customer/ProductView.tsx não existe efeito que resete quantity (:244), currentImageIndex (:245), cartStatus (:246) nem selectedVariants (:253). Medição de hoje: todos os 18 produtos ativos têm array_length(imagem_urls,1)=1.

**Critério de aceite:**

- [ ] O case product-detail passa key com o id do produto.
- [ ] Abrir o produto A, escolher quantidade 3 e uma variação, clicar numa recomendação: o produto B abre com quantidade 1, sem variação selecionada e com o botão no estado inicial.
- [ ] O índice de imagem volta a 0 na troca de produto.
- [ ] A galeria não quebra quando o produto novo tem menos imagens que o anterior.

**Arquivos envolvidos:** `src/App.tsx`, `src/views/customer/ProductView.tsx`
**Depende de:** nada
**Bom pra quem está chegando:** não — fora das 7 tarefas de entrada escolhidas; ver "Por onde o Netim começa" no topo

### [CATALOGO-060] Tornar determinística a escolha de preço e de variante enviada ao carrinho

**Tipo:** bug
**Prioridade:** P2
**Tamanho:** M
**Épico:** Confiabilidade do catálogo
**Risco de mexer:** médio — mexe na regra de preço exibido, que é o número que o cliente vê antes de comprar. Divergência aqui vira reclamação direta.

**Contexto:** Quando um produto tem dois ou mais grupos de variação, o preço exibido vem do ÚLTIMO override clicado (ordem de inserção das chaves), mas o carrinho recebe o id da variação do PRIMEIRO grupo clicado. O servidor cobra COALESCE(price_override, preco_venda) desse único id e só dá baixa nele. Resultado: preço mostrado diverge do cobrado conforme a ordem de clique, e o estoque das demais variações escolhidas nunca é decrementado. Está latente hoje (só existem 2 variantes, ambas 'Cor: Rosa' sem override), mas é perda de receita direta assim que o catálogo crescer.

**Evidência:** Achado #17. src/views/customer/ProductView.tsx:534-537 (`selectedVariantObjects.reduce((acc, v) => v?.priceOverride || acc, product.price)` — fica com o último override, e o || também ignora priceOverride igual a 0) e :586 (`onAddToCart(quantity, selectedVariantObjects[0]?.id, variantNames)`). Consulta de hoje em product_variants: 2 linhas, ambas name='Cor'/value='Rosa' com price_override NULL.

**Critério de aceite:**

- [ ] A ordem de avaliação dos overrides passa a ser determinística, derivada de variantGroups e não da ordem de clique.
- [ ] Existe um único conceito de 'variante que define o preço', e é ele que vai para o carrinho.
- [ ] priceOverride igual a 0 é respeitado como preço válido (trocar || por checagem de null/undefined).
- [ ] Com um produto de teste de 2 grupos e overrides diferentes, clicar em ordens diferentes produz sempre o mesmo preço exibido.
- [ ] O preço exibido é igual ao cobrado pela RPC no pedido resultante.

**Arquivos envolvidos:** `src/views/customer/ProductView.tsx`, `src/contexts/CartContext.tsx`, `src/lib/mappers.ts`
**Depende de:** nada
**Bom pra quem está chegando:** não — exige decidir a semântica de variação multi-eixo, que hoje tem três interpretações incompatíveis no código e nenhum dado de produção que sirva de referência.

### [CATALOGO-070] Remover o teto de 200 produtos e os três sintomas que ele produz

**Tipo:** divida tecnica
**Prioridade:** P2
**Tamanho:** G
**Épico:** Confiabilidade do catálogo
**Risco de mexer:** alto — são duas metades do sistema que discordam sobre o tamanho do catálogo (fetchProducts trunca em 200 e grava por replaceAll; catchUp busca sem limite e grava por putMany), sem mutex compartilhado. Mexer numa sem a outra troca um bug por outro.

**Contexto:** As duas consultas de produtos usam .limit(200) ordenando por data_cadastro desc, e esse array é a única fonte da Home, da busca, dos carrosséis e dos favoritos. A partir do 201o produto os mais antigos somem sem aviso; a lista de favoritos perde os itens fora do recorte enquanto o coração continua preenchido no card; e abrir link de produto fora do array renderiza header e BottomNav com o miolo permanentemente vazio, sem loading, mensagem ou redirect. A loja tem 18 produtos ativos hoje, então está dormente — mas o corte é silencioso e não há nada avisando quando ele passar a morder.

**Evidência:** Achados #18, #67 e #71, mais docs/onboarding/02-ARQUITETURA.md seção 6.3. src/contexts/StoreContext.tsx:391 e :402 (.limit(200), sem .range()) e :424 (replaceAll). src/lib/realtimeSyncEngine.ts:581-583 (summary sem limite) e :819 (putMany). src/App.tsx:1939-1943 (`if (!product) return null;`) e :1819-1866 (a verificação de rede só faz console.log quando o produto existe). src/contexts/FavoritesContext.tsx:186-190 (interseção com allProducts).

**Critério de aceite:**

- [ ] As duas consultas de produtos usam paginação explícita ou um limite alinhado com o do catchUp — as duas metades passam a concordar sobre o tamanho do catálogo.
- [ ] Com mais de 200 produtos cadastrados, alternar de aba e voltar não muda a quantidade exibida na Home.
- [ ] Abrir link direto de um produto que não está no array em memória busca o produto na rede e renderiza, ou mostra erro explícito — nunca tela vazia.
- [ ] A lista de favoritos mostra todos os favoritos do banco, inclusive de produto fora do recorte ou inativo, com sinalização adequada.
- [ ] O coração preenchido no card e a lista de favoritos nunca discordam.

**Arquivos envolvidos:** `src/contexts/StoreContext.tsx`, `src/lib/realtimeSyncEngine.ts`, `src/App.tsx`, `src/contexts/FavoritesContext.tsx`, `src/hooks/useProducts.ts`, `docs/onboarding/02-ARQUITETURA.md`
**Depende de:** nada
**Bom pra quem está chegando:** não — é a dívida arquitetural registrada na seção 6.3 do doc de arquitetura, com duas escritas concorrentes no mesmo store e nenhum teste; além disso o motivo do teto de 200 não está documentado.

### [CATALOGO-080] Corrigir a resposta da loja invisível e o contador Útil das avaliações

**Tipo:** bug
**Prioridade:** P2
**Tamanho:** M
**Épico:** Confiabilidade do catálogo
**Risco de mexer:** baixo no mapper, médio no voto — criar tabela de votos é migration nova; sem ela o voto continua ilimitado.

**Contexto:** Dois defeitos na mesma área. O admin responde a uma avaliação, a RPC grava merchant_reply na tabela e o ReviewCard tem um bloco 'Resposta da Loja' — mas o mapper usado na página do produto não copia o campo, então o trabalho de atendimento fica invisível para o cliente. E um clique em 'Útil' incrementa o número duas vezes na tela (uma no estado do hook, outra na renderização do card) enquanto o banco sobe só 1, então o contador cai sozinho no próximo fetch; como não existe tabela de votos, o mesmo usuário pode recarregar e votar indefinidamente.

**Evidência:** Achados #65 e #68. src/hooks/useReviews.ts:93-104 (mapper de getReviewsByProduct sem merchantReply, embora a query de :82-89 traga o campo) e :173-223 (markHelpful sem retorno, +1 otimista em :188; :102 sem `?? 0`). src/components/ui/custom/ReviewCard.tsx:153 (`review.helpful + (hasMarkedHelpful ? 1 : 0)`) e :143 (botão trava antes de qualquer confirmação). No banco: increment_helpful RETURNS void só faz UPDATE ... helpful + 1; não existe tabela review_helpful_votes.

**Critério de aceite:**

- [ ] O mapper copia merchant_reply para merchantReply e a resposta da loja aparece na página do produto.
- [ ] Um clique em Útil soma exatamente 1 na tela, e o número continua o mesmo depois de recarregar.
- [ ] Existe registro de voto por usuário: o mesmo usuário não consegue votar duas vezes no mesmo review.
- [ ] Convidado que clica em Útil recebe aviso em vez de ver o botão travar com +1 falso.
- [ ] helpful nulo no banco não quebra a renderização.

**Arquivos envolvidos:** `src/hooks/useReviews.ts`, `src/components/ui/custom/ReviewCard.tsx`, `supabase/migrations/ (arquivo novo)`, `src/views/customer/ProductView.tsx`
**Depende de:** nada
**Bom pra quem está chegando:** não — fora das 7 tarefas de entrada escolhidas; ver "Por onde o Netim começa" no topo

---

## Épico: Confiabilidade do checkout

### [CHECKOUT-020] Bloquear checkout com carrinho vazio no front e no RPC

**Tipo:** bug
**Prioridade:** P1
**Tamanho:** M
**Épico:** Confiabilidade do checkout
**Risco de mexer:** médio — a guarda no RPC exige nova migration na função mais crítica do sistema; a guarda no front é trivial.

**Contexto:** A rota de checkout é deep link válido, então dar F5 depois de comprar remonta a tela com carrinho vazio e o formulário já preenchido pelo perfil, com o botão habilitado. Com p_items = [], o RPC calcula subtotal 0 mas ainda soma a taxa de entrega, e o front manda total 0: o cliente leva um erro de divergência sem sentido. Se a taxa de entrega for 0, um pedido fantasma de R$ 0,00 é criado e aparece no painel do admin. O RPC aceita p_items vazio vindo de qualquer chamador anon.

**Evidência:** Achado #36. src/views/customer/CheckoutView.tsx:378-395 (handleSubmitEvent valida form e endereço, nunca cart.length; grep por 'cart.length' no arquivo não retorna nada), :1027 e :1030 (disabled só por !isValid || isSubmitting). No banco, create_marketplace_order_v23 entra direto no FOR sobre jsonb_array_elements(p_items) sem guarda de array vazio, com EXECUTE para anon.

**Critério de aceite:**

- [ ] Dar F5 na rota de checkout com o carrinho vazio mostra estado vazio ou redireciona, e o botão de finalizar fica desabilitado.
- [ ] handleSubmitEvent retorna cedo se o carrinho estiver vazio.
- [ ] Nova migration faz create_marketplace_order_v23 levantar exceção quando jsonb_array_length(p_items) = 0.
- [ ] Chamar a RPC direto no endpoint REST com p_items = [] não cria linha em marketplace_orders (verificado em transação com ROLLBACK).
- [ ] Nenhum pedido de R$ 0,00 é criável pelo caminho normal.

**Arquivos envolvidos:** `src/views/customer/CheckoutView.tsx`, `supabase/migrations/ (arquivo novo)`, `supabase/migrations/20260729000002_shipping_quote_validation_v23.sql`, `scripts/db-test-guest-checkout.cjs`
**Depende de:** nada
**Bom pra quem está chegando:** não — fora das 7 tarefas de entrada escolhidas; ver "Por onde o Netim começa" no topo

### [CHECKOUT-030] Criar chave de idempotência do pedido e lock síncrono no botão de finalizar

**Tipo:** bug
**Prioridade:** P1
**Tamanho:** G
**Épico:** Confiabilidade do checkout
**Risco de mexer:** alto — acrescenta coluna e índice único em marketplace_orders e um short-circuit na RPC do checkout. Errar o índice bloqueia pedidos legítimos do mesmo cliente.

**Contexto:** A única proteção contra envio duplicado é o atributo disabled do botão, e ele só é ativado depois de um await — ou seja, fora do tick síncrono do clique. Pior: se a RPC comita o pedido mas a resposta HTTP estoura por timeout, o front cai no catch, mantém o carrinho e reabilita o botão. O cliente toca de novo e cria um segundo pedido idêntico, com estoque debitado duas vezes e cupom de uso único consumido duas vezes.

**Evidência:** Achado #37. src/views/customer/CheckoutView.tsx:378-389 (handleSubmitEvent começa com await form.trigger() e só chama setIsSubmitting(true) na :389; grep por 'submitLock' no arquivo retorna zero), :460-469 (catch não limpa o carrinho) e :471 (finally reabilita). marketplace_orders NÃO tem coluna idempotency_key (colunas listadas em 30/07/2026) e create_marketplace_order_v23 não recebe chave de idempotência.

**Critério de aceite:**

- [ ] Existe um lock síncrono (ref) verificado no primeiro tick do clique, antes de qualquer await.
- [ ] Nova migration adiciona idempotency_key em marketplace_orders com índice único parcial.
- [ ] O front gera a chave uma vez por tentativa de checkout e a reenvia idêntica no retry.
- [ ] A RPC faz short-circuit: chamada repetida com a mesma chave devolve o pedido já criado em vez de criar outro.
- [ ] Simular timeout na resposta e tocar de novo em finalizar resulta em UM pedido, com estoque debitado uma vez e cupom consumido uma vez.
- [ ] Dois pedidos legítimos seguidos do mesmo cliente continuam sendo criados normalmente.

**Arquivos envolvidos:** `src/views/customer/CheckoutView.tsx`, `src/hooks/useOrders.ts`, `supabase/migrations/ (arquivo novo)`, `supabase/migrations/20260729000002_shipping_quote_validation_v23.sql`
**Depende de:** nada
**Bom pra quem está chegando:** não — mexe na RPC do checkout e adiciona restrição de unicidade numa tabela de produção; o modo de falha (bloquear pedido legítimo) é pior que o bug original.

---

## Épico: Crescimento e conversão

### [ADMIN-150] Registrar eventos de funil na tabela analytics_events

**Tipo:** feature
**Prioridade:** P2
**Tamanho:** M
**Épico:** Crescimento e conversão
**Risco de mexer:** médio — escrita nova em tabela de produção a partir do cliente; precisa ser assíncrona, tolerante a falha e não pode virar mais uma requisição no boot (o app já tem duplicação de requisições no carregamento, achado #R4).

**Contexto:** Não se sabe quantas pessoas viram um produto, adicionaram ao carrinho, começaram o checkout ou desistiram — nem onde desistiram. A tabela para isso já existe no banco, com colunas event_type, product_id, source_view e metadata, e chegou a ter RLS ajustada em várias migrations, mas o código NUNCA escreve nela.

**Evidência:** Conferido agora: grep por analytics_events em src/ excluindo src/types/ retorna ZERO. A tabela está declarada em src/types/database.types.ts:38-66. Não há ferramenta de terceiro também: gtag|google.analytics|posthog|plausible|mixpanel|umami|@vercel/analytics não aparece em src/, index.html nem package.json.

**Critério de aceite:**

- [ ] Os 4 eventos mínimos são gravados: ver produto, adicionar ao carrinho, iniciar checkout, concluir pedido
- [ ] Cada evento tem product_id quando aplicável e source_view preenchido
- [ ] A gravação é assíncrona: derrubar a rede não trava nem atrasa nenhuma interação da loja
- [ ] Uma consulta SQL simples devolve o funil dos últimos 7 dias com os 4 números
- [ ] Nenhum dado pessoal (nome, e-mail, telefone, endereço) vai para metadata

**Arquivos envolvidos:** `src/views/customer/ProductView.tsx`, `src/contexts/CartContext.tsx`, `src/views/customer/CheckoutView.tsx`, `src/types/database.types.ts`
**Depende de:** nada
**Bom pra quem está chegando:** não — fora das 7 tarefas de entrada escolhidas; ver "Por onde o Netim começa" no topo

### [ADMIN-160] Listar carrinhos abandonados no painel do admin

**Tipo:** feature
**Prioridade:** P2
**Tamanho:** M
**Épico:** Crescimento e conversão
**Risco de mexer:** baixo — leitura de tabela que já existe e já é populada; nenhuma escrita.

**Contexto:** O carrinho já é persistido no servidor e o admin até consegue olhar o carrinho parado de UM cliente específico, se souber em qual cliente clicar. Não existe nenhuma visão agregada de quem abandonou, nem qualquer automação. Todo carrinho montado e não finalizado é perda total, e o dado já está gravado.

**Evidência:** O carrinho persiste em cart_items via src/contexts/CartContext.tsx:201 e a RPC sync_cart_atomic (:479). O único lugar que mostra isso é src/views/admin/AdminUserDetailView.tsx:1036 ('Carrinho Atual (Abandonado)'), por cliente. Não há agendador: pg_cron|cron.schedule não aparece em supabase/migrations. A RPC de segmentação de push (supabase/migrations/20260630150000_restore_get_segmented_push_targets.sql:27-84) só conhece uuid específico, 'vip', 'inactive', 'new' e 'all'.

**Critério de aceite:**

- [ ] Existe uma tela ou aba no admin listando carrinhos com itens e sem pedido concluído, ordenados por data da última alteração
- [ ] Cada linha mostra cliente, quantidade de itens, valor estimado e há quanto tempo está parado
- [ ] Clicar leva ao detalhe do cliente que já existe
- [ ] A consulta não trava com a base atual e não carrega o carrinho de todo mundo de uma vez (tem paginação ou limite explícito)

**Arquivos envolvidos:** `src/views/admin/AdminUserDetailView.tsx`, `src/views/admin/AdminCustomersView.tsx`, `src/hooks/useOrders.ts`
**Depende de:** nada
**Bom pra quem está chegando:** não — fora das 7 tarefas de entrada escolhidas; ver "Por onde o Netim começa" no topo

### [CUPOM-020] Limitar cupom a um uso por cliente

**Tipo:** feature
**Prioridade:** P2
**Tamanho:** M
**Épico:** Crescimento e conversão
**Risco de mexer:** médio — exige tabela nova e alteração da RPC de validação, que roda dentro do caminho do checkout. Recriar a RPC errado derruba todo pedido com cupom.

**Contexto:** O cupom hoje é global: qualquer pessoa usa o mesmo código quantas vezes quiser até estourar o limite geral. Não existe cupom de primeira compra nem de uso único por pessoa. Um código vazado em grupo de WhatsApp é usado sem limite. Sem isso, não dá pra rodar a promoção mais comum de loja nova.

**Evidência:** A tabela coupons (src/types/database.types.ts:305-344) tem code, type, value, min_purchase, usage_limit, usage_count, used_count, valid_until, active — nenhuma coluna de usuário nem de primeira compra, e não há tabela de uso por usuário no schema. A validação no servidor (supabase/migrations/20260526000000_coupon_percentage_fixes.sql:35) checa apenas validade, valor mínimo e limite global.

**Critério de aceite:**

- [ ] Existe registro de qual usuário usou qual cupom, gravado na mesma transação do pedido
- [ ] Tentar usar o mesmo cupom duas vezes com a mesma conta é recusado com mensagem clara no checkout
- [ ] Cupom marcado como 'primeira compra' é recusado para quem já tem pedido não cancelado
- [ ] Convidado (sem conta) tem o comportamento definido e documentado, não um caminho acidental
- [ ] Pedido cancelado libera o uso de volta para aquele cliente

**Arquivos envolvidos:** `supabase/migrations/`, `src/hooks/useCoupons.ts`, `src/views/admin/AdminCouponFormView.tsx`, `src/views/customer/CheckoutView.tsx`
**Depende de:** nada
**Bom pra quem está chegando:** não — mexe na RPC do caminho de checkout, onde erro significa pedido não fechado

---

## Épico: Custo e correção do boot

### [INFRA-010] Eliminar as requisições duplicadas do boot causadas por callbacks instáveis

**Tipo:** divida tecnica
**Prioridade:** P1
**Tamanho:** G
**Épico:** Custo e correção do boot
**Risco de mexer:** alto — mexe nos efeitos de boot de três contextos ao mesmo tempo. Estabilizar demais faz o app não recarregar depois que a autenticação resolve; estabilizar de menos não resolve nada.

**Contexto:** No primeiro carregamento o app dispara o mesmo endpoint várias vezes (a auditoria contou 5x notificações, 4x produtos, 4x store_config, 4x favoritos; 29 requisições REST no total). A causa é que os efeitos de boot dos contextos dependem de callbacks cuja identidade muda quando o estado de auth resolve (isAdmin, loading, user), e não existe nenhuma trava de requisição em voo nem AbortController. A contenção degrada a latência: a mesma query de produtos ia de 746 ms para 1.687 ms na segunda chamada.

**Evidência:** Achado R4. src/contexts/StoreContext.tsx:514-523 (efeito de boot com deps [fetchConfig, fetchProducts]), :439 (fetchProducts com deps [isAdmin, loading]) e :375 (fetchConfig com deps [isAdmin, mapConfig, applyBranding]). Mesmo padrão em src/contexts/FavoritesContext.tsx:36-52 e src/contexts/NotificationContext.tsx:109-165. StrictMode ligado em src/main.tsx:93. Ressalva registrada na própria classificação: as contagens exatas vieram de Resource Timing e não foram remedidas — o que foi confirmado é que a estrutura que as causava não mudou.

**Critério de aceite:**

- [ ] Existe trava de requisição em voo (ou AbortController) em fetchProducts, fetchConfig, fetchDbFavorites e fetchNotifications.
- [ ] Medição antes e depois na aba Network do boot em produção, com o número de requisições por endpoint registrado nos dois momentos.
- [ ] Nenhum endpoint é chamado mais de duas vezes no boot (uma pelo StrictMode em dev, uma real).
- [ ] Quando a autenticação resolve e isAdmin muda, os dados de admin são carregados — a deduplicação não pode impedir o recarregamento legítimo.
- [ ] O tempo até o catálogo aparecer não piorou.

**Arquivos envolvidos:** `src/contexts/StoreContext.tsx`, `src/contexts/FavoritesContext.tsx`, `src/contexts/NotificationContext.tsx`, `src/main.tsx`
**Depende de:** nada
**Bom pra quem está chegando:** não — exige medir antes e depois com o app rodando em produção e entender a ordem de resolução da autenticação, que é a parte menos documentada do boot.

### [INFRA-070] Garantir que o RealtimeSyncEngine sempre suba, mesmo com o IndexedDB lento

**Tipo:** bug
**Prioridade:** P2
**Tamanho:** M
**Épico:** Custo e correção do boot
**Risco de mexer:** médio — trocar o ref por estado reativo faz o efeito re-executar; sem cuidado, sobe dois engines na mesma aba.

**Contexto:** O efeito que sobe o engine sai por um return quando vaultRef.current ainda é null, e como ref não é dependência reativa ele nunca mais roda naquela aba. Isso acontece quando o IndexedDB demora (retry ou blocked por outra aba) e a resposta de config chega antes, setando isLoaded=true. Pior: no caminho de erro, a instância de vault recuperada no catch nunca é guardada no ref, então todos os puts viram no-op silencioso. Resultado: aba sem realtime pelo resto da sessão — preço alterado pelo admin nunca aparece, produto esgotado continua comprável.

**Evidência:** Achado #47. src/contexts/StoreContext.tsx:526-541 (`if (!isLoaded || !vaultRef.current) return;` com deps [isLoaded, isLeader, isAdmin]), :66 (vaultRef é ref, não dispara re-render) e :119-134 (catch faz `const vault = vaultRef.current || (await DataVault.init());` SEM reatribuir vaultRef.current, enquanto :142 seta setIsLoaded(true)). Não existe estado vaultReady no arquivo.

**Critério de aceite:**

- [ ] A prontidão do vault vira estado reativo (ou o efeito passa a depender de algo que muda quando o vault fica pronto).
- [ ] O catch de :119-134 reatribui vaultRef.current com a instância recuperada.
- [ ] Abrir duas abas simultâneas, com a segunda pegando o IndexedDB blocked, resulta nas duas com realtime funcionando.
- [ ] Nunca sobe mais de um engine por aba (conferido nos logs prefixados).
- [ ] Mudar o preço de um produto no admin reflete em todas as abas abertas sem reload.

**Arquivos envolvidos:** `src/contexts/StoreContext.tsx`, `src/lib/realtimeSyncEngine.ts`, `src/lib/dataVault.ts`
**Depende de:** nada
**Bom pra quem está chegando:** não — o modo de falha depende de corrida entre IndexedDB e rede, e o engine tem eleição de aba líder, o que torna a reprodução trabalhosa.

### [INFRA-080] Parar de mascarar falha de leitura do DataVault como lista vazia

**Tipo:** bug
**Prioridade:** P2
**Tamanho:** G
**Épico:** Custo e correção do boot
**Risco de mexer:** alto — hoje `[]` significa duas coisas (store vazio e leitura falhou) e três consumidores dependem dessa ambiguidade com a guarda `if (length > 0)`. Desambiguar sem ajustar os três derruba a tela quando o store estiver legitimamente vazio.

**Contexto:** Duas metades do mesmo defeito. Quando outra aba sobe a versão do IndexedDB, o handler fecha a conexão e zera o singleton, mas todas as referências já distribuídas continuam apontando para a instância morta: dali em diante as leituras lançam InvalidStateError, o catch engole e resolve com [] — a UI passa a ver 'nao ha dados' em vez de erro — e as escritas rejeitam num .catch vazio. E como `[]` é ambíguo, os três listeners de sync só aplicam o resultado quando ele não está vazio: excluir o último banner, a última categoria ou o último produto não some da tela, porque o `if (length > 0)` barra o setState.

**Evidência:** Achados #50 e #51. src/lib/dataVault.ts:129-136 (onversionchange fecha e zera o singleton, registrado antes de `_instance = new DataVault(db)` em :151), :221-237 (getAll resolve([]) no catch, em :234) e :242-264 (getById resolve(undefined) em :261). Grep por ensureDb, markClosed e 'private closed' no arquivo: zero. Consumidores: src/contexts/StoreContext.tsx:571-575, src/hooks/useBanners.ts:610-613 e src/hooks/useCategories.ts:282-285.

**Critério de aceite:**

- [ ] getAll e getById rejeitam em erro de leitura em vez de resolver com valor vazio; NotFoundError continua distinguível de InvalidStateError.
- [ ] A instância do DataVault se auto-cura: uma leitura após onversionchange reabre a conexão em vez de falhar para sempre.
- [ ] Os três listeners aplicam SEMPRE o resultado da leitura, com try/catch próprio para o caso de erro.
- [ ] Excluir o último banner faz ele sumir da Home sem reload; idem para a última categoria e o último produto.
- [ ] Abrir duas abas e forçar uma mudança de versão do IndexedDB não congela os dados de nenhuma delas.
- [ ] As escritas com .catch(() =&gt; {}) passam a registrar o erro.

**Arquivos envolvidos:** `src/lib/dataVault.ts`, `src/contexts/StoreContext.tsx`, `src/hooks/useBanners.ts`, `src/hooks/useCategories.ts`
**Depende de:** nada
**Bom pra quem está chegando:** não — muda o contrato da abstração central de persistência offline, consumida por quatro módulos, sem nenhum teste que segure a regressão.

### [INFRA-090] Fatiar o refetch do catchUp e parar de logar sucesso quando a query falhou

**Tipo:** bug
**Prioridade:** P2
**Tamanho:** M
**Épico:** Custo e correção do boot
**Risco de mexer:** médio — o catchUp apaga do IndexedDB antes de refazer o fetch; endurecer a guarda errado faz o cache do cliente ser limpo sem ser reconstruído.

**Contexto:** Na reconciliação, o engine primeiro apaga do IndexedDB os produtos ausentes do summary e só depois busca os desatualizados com um .in('id', [...]) sem chunking e sem checar erro. Como o summary não tem limite mas o cache do StoreContext é truncado em 200, em catálogo maior quase todos os produtos entram na lista, a URL estoura (414 ou timeout), o erro é descartado e a função ainda loga 'CatchUp complete'. O cliente offline fica com catálogo incompleto e nenhuma mensagem.

**Evidência:** Achado #48. src/lib/realtimeSyncEngine.ts:804-808 (`const { data: rawProducts } = await supabase...in('id', outOfDateIds);` — sem fatiamento e sem desestruturar error), :852 (log de conclusão incondicional), :750 (guarda `if (serverProductsSummary)`, não `.length > 0`), :756-780 (deleções antes do refetch) e :581-583 (summary sem .limit). Contraparte: src/contexts/StoreContext.tsx:391 e :402 (.limit(200)).

**Critério de aceite:**

- [ ] O refetch é fatiado em blocos de até 50 ids, com erro checado por bloco.
- [ ] A função só loga conclusão quando todos os blocos vieram sem erro; caso contrário registra a falha.
- [ ] Summary vazio não limpa o cache inteiro (guarda passa a exigir length &gt; 0).
- [ ] As deleções só acontecem depois de o refetch ter sucesso, ou são revertidas se ele falhar.
- [ ] Os limites de summary e de cache estão alinhados e o valor está escrito em um único lugar.

**Arquivos envolvidos:** `src/lib/realtimeSyncEngine.ts`, `src/contexts/StoreContext.tsx`
**Depende de:** [CATALOGO-070]
**Bom pra quem está chegando:** não — o catchUp tem 290 linhas, roda em três gatilhos diferentes e apaga dados do cliente; entender a ordem entre deleção e refetch exige ler o engine inteiro.

### [INFRA-100] Parar o prefetch preditivo de rodar em todo render e de poluir o próprio histórico

**Tipo:** bug
**Prioridade:** P2
**Tamanho:** P
**Épico:** Custo e correção do boot
**Risco de mexer:** baixo — estabilizar o retorno de useNetworkAdaptive é uma memoização; a guarda de path é um ref.

**Contexto:** O hook de prefetch preditivo re-executa em todo render do app porque useNetworkAdaptive devolve um objeto literal novo a cada render, invalidando a cadeia de callbacks. Cada render vira duas leituras e duas gravações síncronas em localStorage na main thread, e o histórico enche de auto-transições (home para home) que dominam a ordenação e fazem a previsão sempre cair no próprio path atual — que a própria guarda descarta. Ou seja: custo de bloqueio de UI em todo render e zero prefetch efetivamente previsto.

**Evidência:** Achado #74. src/hooks/useBehavioralPrefetch.ts:57-69 (efeito sem guarda de path; deps [currentPath, updateMarkovChain, getPrediction, prefetchCallback]; não há useRef no arquivo — o import da linha 1 é só useCallback e useEffect) e :62-64 (console.log de produção). src/hooks/useNetworkAdaptive.ts devolve objeto literal novo a cada render. src/hooks/usePrefetchOnHover.ts:56 memoiza prefetchView com deps [isSlow].

**Critério de aceite:**

- [ ] useNetworkAdaptive devolve um objeto com identidade estável entre renders.
- [ ] O efeito de prefetch só roda quando currentPath realmente muda (guarda por ref).
- [ ] Não há auto-transição (home para home) sendo gravada na cadeia de Markov.
- [ ] O console.log de previsão não vai para o bundle de produção.
- [ ] Medição: número de gravações em localStorage por render cai para zero em render sem mudança de rota.

**Arquivos envolvidos:** `src/hooks/useBehavioralPrefetch.ts`, `src/hooks/useNetworkAdaptive.ts`, `src/hooks/usePrefetchOnHover.ts`, `src/App.tsx`
**Depende de:** nada
**Bom pra quem está chegando:** não — fora das 7 tarefas de entrada escolhidas; ver "Por onde o Netim começa" no topo

### [INFRA-110] Remover console.* do bundle de produção e a sobrescrita global de console.warn

**Tipo:** divida tecnica
**Prioridade:** P2
**Tamanho:** M
**Épico:** Custo e correção do boot
**Risco de mexer:** médio — dropar console em produção apaga o mecanismo de depuração oficial do projeto (logs prefixados). Precisa preservar console.error ou definir um caminho de diagnóstico antes de cortar tudo.

**Contexto:** O bundle de produção carrega 523 chamadas de console em 80 arquivos JS, medido no dist que está no disco, incluindo nome completo de usuário. Não há drop_console, pure_funcs, terserOptions nem esbuild.drop no vite.config.ts. Além disso, o main.tsx substitui console.warn global por um filtro tão amplo que engole qualquer aviso legítimo que mencione width, height e chart ao mesmo tempo — em produção e em dev.

**Evidência:** Achado R8. Contagem de hoje em src/**/*.{ts,tsx}: 506 ocorrências (270 console.error, 168 console.log, 66 console.warn, 2 console.debug). No dist de 30/07 06:48: 289 error, 158 log, 73 warn, 2 debug, 1 trace. Grep por drop_console, pure_funcs, terserOptions e esbuild.drop em vite.config.ts: nenhum. Vazamento de PII literal em src/contexts/AuthContext.tsx:239 (`console.log('[Auth] Profile fetched:', profileData.full_name)`). Sobrescrita em src/main.tsx:5-17, com o filtro de :10-12.

**Critério de aceite:**

- [ ] vite.config.ts remove console.log, console.debug e console.warn do bundle de produção (esbuild.drop ou pure_funcs), preservando console.error ou substituindo-o por um caminho de diagnóstico definido.
- [ ] Um build de produção limpo tem zero ocorrências de console.log em dist/assets/*.js (grep).
- [ ] AuthContext.tsx:239 não registra mais nome completo de usuário, nem em dev.
- [ ] O filtro de console.warn do main.tsx é restringido à mensagem exata do Recharts, ou removido junto com o drop.
- [ ] O comportamento em dev continua igual: os logs prefixados aparecem normalmente.

**Arquivos envolvidos:** `vite.config.ts`, `src/main.tsx`, `src/contexts/AuthContext.tsx`
**Depende de:** nada
**Bom pra quem está chegando:** não — fora das 7 tarefas de entrada escolhidas; ver "Por onde o Netim começa" no topo

### [INFRA-120] Corrigir os dois comandos que mentem sobre a qualidade do build

**Tipo:** divida tecnica
**Prioridade:** P2
**Tamanho:** P
**Épico:** Custo e correção do boot
**Risco de mexer:** baixo — a checagem real já passa com zero erros, então apontar o script para o projeto certo não abre cratera. A troca no vite.config é de uma variável que o próprio arquivo já calcula.

**Contexto:** Dois comandos dão sinal verde falso. `npm run typecheck` roda `tsc --noEmit` sobre um tsconfig cujo files é [] com references solution-style: volta exit 0 em 0,78 s sem analisar arquivo nenhum. E o vite.config decide se injeta o plugin de inspeção de dev olhando process.env.NODE_ENV em vez do mode do Vite, que ele mesmo já calcula na linha 38 — nesta máquina NODE_ENV=development está no shell, então `npm run build` produz silenciosamente um artefato de desenvolvimento (precache de 2,69 MB contra 1,85 MB no build limpo).

**Evidência:** Achados R7 e a medição de typecheck do relatório de saúde. package.json:11 (`"typecheck": "tsc --noEmit"`) e tsconfig.json:2 (`"files": []`). A checagem real existe e passa: `npx tsc -p tsconfig.app.json --noEmit` carrega 911 arquivos (177 sob src/), leva 14,16 s e devolve 0 erros; tsconfig.node.json também dá 0. Nota: `npm run build` já usa `npx tsc -b`, então o build de fato typecheca — o script quebrado é só o typecheck. vite.config.ts:143 (`process.env.NODE_ENV === "development" && inspectAttr(),`) contra vite.config.ts:38 (`const isDev = mode === "development"`).

**Critério de aceite:**

- [ ] `npm run typecheck` passa a analisar os projetos referenciados (tsc -b --noEmit ou apontando para tsconfig.app.json) e leva na casa dos 10 s, não 0,8 s.
- [ ] Introduzir um erro de tipo proposital em qualquer arquivo de src/ faz `npm run typecheck` falhar.
- [ ] vite.config.ts:143 usa isDev em vez de process.env.NODE_ENV.
- [ ] Com NODE_ENV=development no shell, `npm run build` produz o mesmo precache do build limpo (cerca de 1,85 MB / 77 entradas) — medido antes e depois.

**Arquivos envolvidos:** `package.json`, `tsconfig.json`, `tsconfig.app.json`, `vite.config.ts`
**Depende de:** nada
**Bom pra quem está chegando:** não — fora das 7 tarefas de entrada escolhidas; ver "Por onde o Netim começa" no topo

---

## Épico: Decisões pendentes

### [CATALOGO-020] Por que o catálogo está travado em 200 produtos?

**Tipo:** decisao
**Prioridade:** P1
**Tamanho:** P
**Épico:** Decisões pendentes
**Risco de mexer:** baixo — é uma resposta escrita. Mexer no número sem a resposta é que é arriscado: o limite alimenta home, busca, carrosséis, favoritos e a rota de detalhe.

**Contexto:** As duas consultas de catálogo usam .limit(200) e esse array é a única fonte de tudo que o cliente vê. A partir do produto 201 os mais antigos somem sem aviso, favoritos fora do recorte desaparecem e link de produto vira tela em branco. Não há comentário, migration nem plano explicando o número. Hoje a loja tem 18 produtos ativos, então nada quebra — mas nenhuma das tasks de catálogo, busca e favoritos pode ser dimensionada sem saber se 200 é teto proposital ou acidente.

**Evidência:** src/contexts/StoreContext.tsx:391 e :402 — `.limit(200)` nos dois ramos. docs/onboarding/02-ARQUITETURA.md, 'Motivo não documentado — perguntar pro Gabriel': 'Por que o teto é 200 produtos'. Achados #18, #67 e #71 dependem desta resposta para sair do estado latente.

**Critério de aceite:**

- [ ] Gabriel responde: 200 é limite intencional de performance, chute antigo, ou restrição de plano
- [ ] Se for intencional, o motivo e o plano para quando o catálogo crescer estão escritos na documentação
- [ ] Se não for intencional, está definido o caminho substituto (paginação, busca no servidor, ou ambos) e ele vira task
- [ ] A resposta desbloqueia explicitamente os achados #18, #67 e #71

**Arquivos envolvidos:** `src/contexts/StoreContext.tsx`, `docs/onboarding/02-ARQUITETURA.md`
**Depende de:** nada
**Bom pra quem está chegando:** não — é resposta do dono do produto

### [PUSH-030] As chaves VAPID estão configuradas no ambiente da edge function send-push?

**Tipo:** decisao
**Prioridade:** P1
**Tamanho:** P
**Épico:** Decisões pendentes
**Risco de mexer:** baixo — verificação de configuração. O risco é construir em cima de um canal que não funciona.

**Contexto:** Todo o fluxo de notificação push depende de um par de chaves VAPID que ninguém confirmou existir no ambiente. O par privado não está no repositório. Se as chaves não estiverem lá, o canal de push inteiro é teórico — e a edge function ainda responde sucesso mesmo com todos os envios falhando (achado #19), então a falha é invisível.

**Evidência:** docs/onboarding/05-FLUXOS-CRITICOS.md, 'Não verificado': 'Se VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY estão no ambiente da edge function send-push e se existe alguma linha em push_subscriptions hoje. Sem os dois, o Fluxo 4 é teórico.' docs/onboarding/03-SETUP-AMBIENTE.md:165 registra VITE_VAPID_PUBLIC_KEY como '&lt;pedir pro Gabriel&gt;' e que `git ls-files vapid_keys.json` retorna 0 linhas. Medição do banco: push_subscriptions tem 8 linhas, 6 delas com user_id NULL.

**Critério de aceite:**

- [ ] Está confirmado por escrito se VAPID_PUBLIC_KEY e VAPID_PRIVATE_KEY existem no ambiente da função send-push
- [ ] A chave pública que o front usa é a mesma do par do servidor (conferido, não suposto)
- [ ] Se as chaves não existirem ou estiverem dessincronizadas, existe uma task para gerar e publicar o par
- [ ] O Netim recebeu a VITE_VAPID_PUBLIC_KEY para o ambiente local dele

**Arquivos envolvidos:** `supabase/functions/send-push/index.ts`, `src/hooks/usePushNotifications.ts`, `docs/onboarding/03-SETUP-AMBIENTE.md`
**Depende de:** nada
**Bom pra quem está chegando:** não — depende de acesso ao painel do Supabase, que só o Gabriel tem hoje

### [INFRA-060] Qual é a fonte de verdade das variáveis de produção, e qual DATABASE_URL ficou viva depois da troca de 30/07?

**Tipo:** decisao
**Prioridade:** P1
**Tamanho:** P
**Épico:** Decisões pendentes
**Risco de mexer:** baixo — é uma resposta. Sem ela, qualquer tentativa de reproduzir produção localmente é adivinhação, e usar a string errada pode apontar para o banco errado.

**Contexto:** Existem cinco dumps de variáveis da Vercel na raiz, com datas entre fevereiro e 30/07 e frescor desconhecido. Dois deles trazem DATABASE_URL diferentes entre si — a string mudou em 30/07 e não está documentado por que, nem qual está valendo. Além disso `vercel env pull` devolve valores vazios e o motivo não está explicado.

**Evidência:** docs/onboarding/03-SETUP-AMBIENTE.md:135 — os dumps .env.vercel.pulled e .env.vercel.pulled.bak têm DATABASE_URL de 134 e 111 caracteres. :207 — 'Por que a Vercel devolve vazio não está documentado — perguntar pro Gabriel.' Seção 'Não verificado': 'O que está no painel de env vars da Vercel, por que vercel env pull devolve "" e qual DATABASE_URL ficou viva depois da troca de 30/07.'

**Critério de aceite:**

- [ ] Está escrito qual DATABASE_URL está viva e por que ela mudou em 30/07
- [ ] Está escrito por que `vercel env pull` devolve vazio (sensitive, permissão, ou outro motivo)
- [ ] Existe uma lista única de qual variável mora onde: Vercel, Supabase, arquivo local
- [ ] Os dumps .env.vercel.* obsoletos foram apagados do disco ou marcados como históricos, para ninguém copiar deles

**Arquivos envolvidos:** `docs/onboarding/03-SETUP-AMBIENTE.md`, `vercel.json`
**Depende de:** nada
**Bom pra quem está chegando:** não — exige acesso ao painel da Vercel e conhecimento do que aconteceu em 30/07

### [BANCO-040] Qual política de backup e PITR está ativa no plano Supabase?

**Tipo:** decisao
**Prioridade:** P1
**Tamanho:** P
**Épico:** Decisões pendentes
**Risco de mexer:** baixo — abrir o painel e escrever a resposta. O risco de não responder é perder a loja inteira sem ponto de restauração.

**Contexto:** Ninguém sabe se existe backup, com que frequência, quanto tempo de retenção e se há recuperação a ponto no tempo. Isso é o gate de qualquer trabalho de migration: o ledger já está fora de sincronia e existe uma sequência de migrations pendentes que desmontaria boa parte das policies de RLS se fosse aplicada. Sem ponto de restauração, nenhuma dessas mexidas pode ser tentada.

**Evidência:** docs/onboarding/03-SETUP-AMBIENTE.md, 'Não verificado': 'Qual política de backup/PITR está ativa no plano Supabase. O painel não foi aberto.' Contexto de risco medido: as 25 migrations pendentes que rodariam antes do bloqueador executam 190 DROP POLICY contra 127 CREATE POLICY, e o banco tem 71 policies vivas.

**Critério de aceite:**

- [ ] Está documentado: existe backup automático, com que frequência, qual a retenção e se há PITR
- [ ] Está documentado quanto tempo leva restaurar e quem tem permissão para fazer isso
- [ ] Foi feito ao menos um dump manual antes de qualquer trabalho de migration, e o local dele está registrado
- [ ] Se não houver backup adequado, há uma task para contratar ou configurar, e ela bloqueia o trabalho de migrations

**Arquivos envolvidos:** `docs/onboarding/03-SETUP-AMBIENTE.md`, `supabase/migrations/`
**Depende de:** nada
**Bom pra quem está chegando:** não — exige acesso de owner ao projeto Supabase

### [AUTH-020] Por que o envio do OTP depende de um SEGUNDO projeto Supabase e quem tem acesso a ele?

**Tipo:** decisao
**Prioridade:** P1
**Tamanho:** P
**Épico:** Decisões pendentes
**Risco de mexer:** baixo — é uma resposta. O risco vivo é o de hoje: um fluxo de produção depende de código que não está neste repositório.

**Contexto:** O rastreio de pedido de convidado depende de um e-mail com código. O gatilho que dispara esse e-mail chama uma edge function publicada num SEGUNDO projeto Supabase, cujo código-fonte não está neste repositório e cuja função equivalente daqui deploya para o projeto principal. Se esse segundo projeto for pausado, o convidado para de conseguir consultar pedido e ninguém acha a causa olhando este repo.

**Evidência:** O corpo vivo de handle_new_otp_verification faz net.http_post para `https://jvgyjlbjhbfrncwbytls.functions.supabase.co/send-otp-email` e traz o comentário literal 'updated to jvgyjlbjhbfrncwbytls'. Enquanto isso supabase/.temp/project-ref e a VITE_SUPABASE_URL apontam para cafkrminfnokvgjqtkle, e supabase/functions/send-otp-email existe no repo (deployando para o projeto principal). Nenhuma migration aplicada local define essa função.

**Critério de aceite:**

- [ ] Está escrito por que o segundo projeto existe e desde quando
- [ ] Está escrito quem tem acesso a ele e onde vive o código-fonte da função publicada lá
- [ ] Foi decidido: consolidar tudo no projeto principal ou manter os dois, com o motivo registrado
- [ ] Se for consolidar, existe uma task com o passo de troca e o rollback

**Arquivos envolvidos:** `supabase/functions/send-otp-email/index.ts`, `supabase/migrations/20260708190000_secure_otp_flow.sql`, `docs/onboarding/05-FLUXOS-CRITICOS.md`
**Depende de:** nada
**Bom pra quem está chegando:** não — só o Gabriel sabe por que o segundo projeto existe

### [BANCO-050] O que fazer com as 42 migrations pendentes e as 28 versões do ledger sem arquivo?

**Tipo:** decisao
**Prioridade:** P1
**Tamanho:** P
**Épico:** Decisões pendentes
**Risco de mexer:** alto — a decisão errada aqui derruba a loja. Foi medido que aplicar a fila abortaria no meio, depois de 25 arquivos com saldo de -63 policies já executados, deixando o banco com boa parte do RLS desmontado e sem o passo que reconstrói.

**Contexto:** O ledger de migrations é um registro errado da realidade: o banco está à frente e o repositório está atrasado. Boa parte das 'pendentes' já está aplicada sob outro timestamp, e algumas das restantes reintroduziriam bugs já corrigidos. Enquanto não houver uma decisão de rumo, ninguém consegue escrever migration nova com segurança — e isso trava metade do backlog de banco.

**Evidência:** Levantamento desta semana: ledger com 121 linhas contra 134 versões distintas em disco; 41 versões locais fora do ledger e 28 versões no ledger sem arquivo. 24 pares função/arquivo pendente têm corpo IDÊNTICO ao corpo vivo (prova de que já foram aplicados). O arquivo 20260708150000 faz CREATE OR REPLACE de generate_order_otp_v1 mudando o tipo de retorno de boolean para text, o que o Postgres recusa — o push aborta ali.

**Critério de aceite:**

- [ ] Gabriel escolhe e registra o rumo: (a) baseline novo a partir do schema vivo, (b) reconciliação arquivo a arquivo, ou (c) congelar e só escrever migrations novas daqui pra frente
- [ ] Está escrito qual é o procedimento aprovado para aplicar migration (já que supabase db push está proibido)
- [ ] Está escrito o que acontece com os 42 arquivos pendentes: arquivados, reconciliados ou apagados
- [ ] A decisão tem backup confirmado como pré-requisito

**Arquivos envolvidos:** `supabase/migrations/`, `docs/onboarding/03-SETUP-AMBIENTE.md`
**Depende de:** [BANCO-040]
**Bom pra quem está chegando:** não — é a decisão de maior risco do projeto

### [FRETE-010] Qual provedor de frete está realmente ativo em produção: flat_fee, Melhor Envio ou Frenet?

**Tipo:** decisao
**Prioridade:** P1
**Tamanho:** P
**Épico:** Decisões pendentes
**Risco de mexer:** baixo — é leitura de configuração e resposta. Sem ela, todo trabalho de frete é feito no escuro.

**Contexto:** A edge function de frete sabe cotar por Melhor Envio e por Frenet, e também tem taxa fixa e entrega local. Ninguém verificou se existe credencial ativa de transportadora. Isso muda completamente o peso de várias tasks: se a loja opera em taxa fixa, o rastreio da transportadora e as cotações por API são código dormente; se opera com transportadora, a metade que falta do rastreio é urgente.

**Evidência:** supabase/functions/calculate-shipping/index.ts:220-296 implementa melhor_envio e frenet, mas só para COTAR — nunca para gerar etiqueta nem puxar evento de entrega. O levantamento de lacuna registra explicitamente: 'Não verifiquei se a loja tem credencial ativa de Melhor Envio ou Frenet em store_shipping_credentials.' O fallback de contingência é um preço fixo cravado em :755.

**Critério de aceite:**

- [ ] Está escrito qual provedor está configurado hoje e se a credencial está válida
- [ ] Está escrito o que a loja pretende usar nos próximos meses
- [ ] Uma cotação real foi feita em produção e o resultado (provedor que respondeu, preço, se caiu em fallback) está registrado
- [ ] Se a loja opera em taxa fixa, as tasks de rastreio de transportadora são rebaixadas explicitamente

**Arquivos envolvidos:** `supabase/functions/calculate-shipping/index.ts`, `src/views/admin/AdminShippingView.tsx`
**Depende de:** nada
**Bom pra quem está chegando:** não — exige acesso às credenciais e à intenção comercial do dono

### [CATALOGO-100] Os hard-codes de produto no mappers.ts podem sair?

**Tipo:** decisao
**Prioridade:** P2
**Tamanho:** P
**Épico:** Decisões pendentes
**Risco de mexer:** baixo — a resposta é barata; remover sem perguntar é que quebraria a vitrine de um produto específico.

**Contexto:** O mapeador que transforma linha do banco em produto do app tem duas regras cravadas para produtos específicos: uma substitui as imagens de um produto por uma URL da Amazon, ignorando o que estiver no banco, e outra renomeia um produto na exibição. Não há comentário, migration nem plano explicando. Enquanto isso, ninguém pode encostar no mappers com segurança.

**Evidência:** Conferido agora: src/lib/mappers.ts:26-28 — `if (name?.includes("Aliança Luxo")) { return ["https://m.media-amazon.com/images/I/51-mYyA-zXL._AC_SL1000_.jpg"]; }`, que retorna ANTES de olhar as imagens reais da linha. src/lib/mappers.ts:80-83 — nome 'boobie goods'/'Boobie Goods' é exibido como 'Bobbie Goods'. docs/onboarding/02-ARQUITETURA.md lista os dois em 'Motivo não documentado — perguntar pro Gabriel'.

**Critério de aceite:**

- [ ] Gabriel diz por que cada um dos dois hard-codes existe
- [ ] Para cada um está decidido: fica (com o motivo escrito no código) ou sai (com o dado corrigido no banco antes)
- [ ] Se sair, existe task de correção do dado com o produto identificado por id, não por nome
- [ ] A URL externa da Amazon foi avaliada: se fica, está registrado o risco de o link morrer e a imagem sumir

**Arquivos envolvidos:** `src/lib/mappers.ts`, `docs/onboarding/02-ARQUITETURA.md`
**Depende de:** nada
**Bom pra quem está chegando:** não — precisa do histórico que só o Gabriel tem

### [FRETE-030] Frete grátis só para usuário logado é decisão de produto ou efeito colateral?

**Tipo:** decisao
**Prioridade:** P2
**Tamanho:** P
**Épico:** Decisões pendentes
**Risco de mexer:** baixo — a regra hoje está consistente nas três camadas; o risco é alguém 'corrigir' o que é intencional, ou manter o que foi acidente.

**Contexto:** A regra de frete grátis por valor só vale para quem está logado — no carrinho, na vitrine e dentro do RPC que fecha o pedido. Isso foi alinhado de propósito em 29/07 (achado #1 e #28), mas nunca foi registrado como decisão de produto. Convidado acima do valor mínimo continua pagando frete. É uma escolha legítima de incentivo a cadastro, ou um efeito colateral que virou regra.

**Evidência:** src/contexts/CartContext.tsx:746-751 exige `&& user`; src/views/customer/CartView.tsx:257 usa `isRuleActive = (config.freeShippingMin || 0) > 0 && !!user`; o corpo vivo de create_marketplace_order_v23 exige `(v_user_id IS NOT NULL AND v_calculated_subtotal >= v_free_shipping_min)`. O levantamento de lacuna registra: 'é uma decisão de produto não documentada em lugar nenhum'.

**Critério de aceite:**

- [ ] Gabriel confirma se a regra é intencional
- [ ] Se for intencional, a justificativa está na documentação de produto e o texto que o cliente vê deixa isso claro
- [ ] Se não for, existe uma task para estender o benefício ao convidado, cobrindo as três camadas de uma vez (carrinho, vitrine e RPC)
- [ ] O comportamento com freeShippingMin igual a zero (regra desligada) está escrito junto

**Arquivos envolvidos:** `src/contexts/CartContext.tsx`, `src/views/customer/CartView.tsx`, `src/components/ui/custom/FreeShippingBlock.tsx`
**Depende de:** nada
**Bom pra quem está chegando:** não — decisão comercial

### [PEDIDO-130] Qual é a política de devolução e troca da loja?

**Tipo:** decisao
**Prioridade:** P2
**Tamanho:** P
**Épico:** Decisões pendentes
**Risco de mexer:** baixo — é uma resposta. Sem ela, não dá pra desenhar status, telas nem prazos.

**Contexto:** Não existe nada de devolução ou troca no sistema: nem tabela, nem status, nem tela, nem para o cliente pedir, nem para o lojista aprovar. Direito de arrependimento de 7 dias e troca por defeito são obrigatórios e hoje são resolvidos no WhatsApp, sem registro, sem prazo controlado e sem rastro para disputa. Também está em aberto até quando o cliente pode cancelar sozinho.

**Evidência:** Nenhuma tabela de devolução nas migrations (busca por CREATE TABLE com return|devolu|troca|refund|exchange retorna 0). supabase/migrations/20260327000003_sync_order_status_constraint.sql:13-17 aceita apenas pending, processing, shipping, delivered, cancelled, new. src/hooks/useOrders.ts:17-35 só permite o cliente cancelar pedido em 'pending', e a mesma regra existe no banco.

**Critério de aceite:**

- [ ] Está escrito o prazo de arrependimento, o prazo de troca por defeito e quem paga o frete de retorno em cada caso
- [ ] Está escrito até qual status o cliente pode cancelar sozinho e o que acontece depois disso
- [ ] Está definido se a devolução devolve estoque automaticamente e como o dinheiro volta (dado que hoje não há cobrança no site)
- [ ] A política vira texto público na loja além de virar código

**Arquivos envolvidos:** `src/hooks/useOrders.ts`, `src/views/customer/OrderDetailsView.tsx`, `supabase/migrations/`
**Depende de:** nada
**Bom pra quem está chegando:** não — política comercial e jurídica

### [CHECKOUT-060] A loja vai emitir nota fiscal? O CPF passa a ser obrigatório no checkout?

**Tipo:** decisao
**Prioridade:** P2
**Tamanho:** P
**Épico:** Decisões pendentes
**Risco de mexer:** baixo — a resposta é barata, mas tornar CPF obrigatório depois de ter base de clientes é caro; melhor decidir cedo.

**Contexto:** Não há emissão de documento fiscal, nem integração com emissor, nem captura de CPF na compra. O schema do checkout exige apenas nome e WhatsApp. Vender com estoque próprio e sem nota é risco fiscal direto, e impede venda para quem precisa de nota. Sem essa resposta não dá pra dimensionar nada de fiscal nem de conciliação contábil.

**Evidência:** src/views/customer/CheckoutView.tsx:119-120 — o schema exige apenas name e whatsapp; CPF nem é perguntado. src/types/database.types.ts:848 — profiles.cpf existe e é nullable, preenchido só opcionalmente no cadastro (src/contexts/AuthContext.tsx:489-499). src/components/admin/orders/OrderReceipt.tsx é layout de impressão interno, sem numeração nem chave fiscal.

**Critério de aceite:**

- [ ] Gabriel responde se a loja vai emitir nota e em que prazo
- [ ] Está decidido se o CPF passa a ser obrigatório no checkout, opcional, ou pedido só quando o cliente quiser nota
- [ ] Se for emitir, está escolhido o caminho (emissor próprio, integração ou processo manual do contador)
- [ ] A decisão está refletida na política de dados: guardar CPF exige justificativa e prazo de retenção

**Arquivos envolvidos:** `src/views/customer/CheckoutView.tsx`, `src/components/admin/orders/OrderReceipt.tsx`, `src/contexts/AuthContext.tsx`
**Depende de:** nada
**Bom pra quem está chegando:** não — decisão fiscal do dono

### [SEO-020] Vale investir em SSR ou prerender para o preview de link de produto?

**Tipo:** decisao
**Prioridade:** P3
**Tamanho:** P
**Épico:** Decisões pendentes
**Risco de mexer:** baixo — a resposta é barata. A implementação, se for sim, é mudança estrutural de deploy.

**Contexto:** O app é uma SPA 100% cliente com reescrita de tudo para index.html na Vercel. Título, descrição e dados estruturados de produto só existem depois que o JavaScript roda, então crawler sem JS — inclusive o do WhatsApp — lê apenas as tags estáticas genéricas do index.html. Na prática, todo link de produto compartilhado no WhatsApp mostra o mesmo preview da loja, não o do produto. Numa loja que vende por WhatsApp, isso é conversão perdida.

**Evidência:** vercel.json (lido agora): rewrites de `/(.*)` para `/index.html`. index.html:9-35 tem metas e Open Graph estáticos. src/hooks/useDocumentMeta.ts:6-19 documenta no próprio comentário que o hook roda no cliente e que crawler sem JS continua lendo só as tags estáticas. A URL de produto é /product-detail?id=&lt;uuid&gt;, sem nome nem slug.

**Critério de aceite:**

- [ ] Gabriel responde se preview de link de produto no WhatsApp é prioridade comercial
- [ ] Se for, está escolhido o caminho (função de borda gerando meta tags, prerender no build, ou migração de framework) com o custo estimado
- [ ] Se não for, isso está registrado como decisão consciente e a task de sitemap por produto continua valendo por si
- [ ] A decisão considera que a URL de produto hoje não tem slug

**Arquivos envolvidos:** `vercel.json`, `index.html`, `src/hooks/useDocumentMeta.ts`
**Depende de:** nada
**Bom pra quem está chegando:** não — decisão de arquitetura com impacto de custo

### [PWA-030] Por que existem 13 ramos de manualChunks no vite.config.ts?

**Tipo:** decisao
**Prioridade:** P3
**Tamanho:** P
**Épico:** Decisões pendentes
**Risco de mexer:** baixo para responder; médio para mexer — fatiamento de chunk errado piora o carregamento inicial e já se sabe que há ramo apontando para pacote que nem está instalado.

**Contexto:** O vite.config.ts divide o bundle em 13 grupos manuais e só um deles tem dependência verificável. Há inclusive um grupo criado para pacotes de roteamento que não estão instalados, ou seja configuração morta. Sem entender o critério, ninguém pode otimizar o carregamento sem risco de piorar.

**Evidência:** docs/onboarding/02-ARQUITETURA.md:121 — 'Para os outros 12 ramos: motivo não documentado — perguntar pro Gabriel.' Medição registrada: o manualChunks ainda cria um chunk vendor-router para react-router-dom e @remix-run/router, pacotes que não constam no package.json (conferido agora: não há router nenhum nas dependências). O precache do build limpo hoje é de ~1,85 MB em 77 entradas.

**Critério de aceite:**

- [ ] Gabriel explica o critério dos grupos, ou confirma que foram acrescentados sem critério
- [ ] Os ramos que apontam para pacotes não instalados foram removidos e o build continua funcionando
- [ ] O tamanho do precache e do bundle inicial foi medido antes e depois e está registrado
- [ ] O critério final (qualquer que seja) está escrito como comentário no próprio vite.config.ts

**Arquivos envolvidos:** `vite.config.ts`, `docs/onboarding/02-ARQUITETURA.md`
**Depende de:** nada
**Bom pra quem está chegando:** não — depende de histórico; mas a limpeza dos ramos mortos que sai dela é uma boa task derivada

### [INFRA-240] Vamos reescrever o histórico do git para tirar os 15,5 MB de screenshots?

**Tipo:** decisao
**Prioridade:** P3
**Tamanho:** P
**Épico:** Decisões pendentes
**Risco de mexer:** alto se a resposta for sim — reescrever histórico quebra todo clone existente e exige coordenação com o outro dev; baixo se for não.

**Contexto:** Tirar os screenshots do índice resolve o futuro, mas os 15,5 MB continuam no histórico para sempre. Reescrever histórico é a única forma de recuperar o espaço, e é uma operação que só faz sentido decidir uma vez, com os dois desenvolvedores combinados. Há registro de que uma decisão parecida (sobre o histórico) já foi adiada.

**Evidência:** Conferido agora: 205 arquivos versionados em .playwright-mcp/ e 109 PNGs versionados fora de public/. O .git tem 33 MB; os 12 maiores arquivos versionados do projeto são todos screenshots. docs/onboarding/PROMPTS-ONBOARDING-DEV.md:603 registra que uma decisão sobre o histórico já foi adiada pelo Gabriel em 30/07/2026.

**Critério de aceite:**

- [ ] Gabriel decide: reescrever o histórico agora, adiar com data, ou nunca
- [ ] Se for reescrever, existe uma janela combinada com o outro dev e um plano de reclone escrito
- [ ] Se for adiar ou nunca, isso fica registrado para ninguém reabrir a discussão a cada auditoria
- [ ] A remoção do índice (task separada) acontece de qualquer forma, independentemente desta resposta

**Arquivos envolvidos:** `.git`, `.gitignore`
**Depende de:** [INFRA-170]
**Bom pra quem está chegando:** não — decisão que afeta o clone dos dois desenvolvedores

### [FRETE-040] Por que R$ 15 é o fallback de frete e por que a tolerância de valor é R$ 0,05?

**Tipo:** decisao
**Prioridade:** P3
**Tamanho:** P
**Épico:** Decisões pendentes
**Risco de mexer:** baixo — resposta escrita. O risco é alguém ajustar esses números achando que são arbitrários quando não são (ou o contrário).

**Contexto:** Dois números mágicos governam o fechamento de pedido e nenhum tem justificativa no código. O primeiro é o preço de contingência quando a cotação falha: se estiver abaixo do custo real, cada pedido nesse caminho dá prejuízo. O segundo é a tolerância de divergência entre o total do cliente e o recalculado pelo servidor: se estiver folgada demais, abre espaço para manipulação; apertada demais, recusa pedido legítimo por arredondamento.

**Evidência:** docs/onboarding/05-FLUXOS-CRITICOS.md, 'Motivo não documentado': 'por que R$ 15 é o preço dos dois fallbacks de contingência, por que a tolerância é R$ 0,05'. Código: supabase/functions/calculate-shipping/index.ts:748-765 devolve preço 15 literal no catch de topo; o corpo vivo de create_marketplace_order_v23 aborta em `ABS(v_calculated_total - p_total_amount) > 0.05`.

**Critério de aceite:**

- [ ] Está escrito de onde vem o R$ 15 e se ele cobre o custo real de envio hoje
- [ ] Está escrito por que a tolerância é R$ 0,05 e o que acontece com arredondamento de desconto percentual
- [ ] Se os números forem arbitrários, foi definido o valor correto e ele saiu do código para a configuração da loja
- [ ] Os dois números ganharam comentário explicativo no ponto onde são usados

**Arquivos envolvidos:** `supabase/functions/calculate-shipping/index.ts`, `supabase/migrations/20260729000002_shipping_quote_validation_v23.sql`, `docs/onboarding/05-FLUXOS-CRITICOS.md`
**Depende de:** [FRETE-010]
**Bom pra quem está chegando:** não — depende de dado comercial (custo real de envio) que só o Gabriel tem

---

## Épico: Desduplicação de regra de negócio

### [FRETE-020] Unificar a regra de frete grátis, que hoje está escrita em sete lugares

**Tipo:** divida tecnica
**Prioridade:** P2
**Tamanho:** M
**Épico:** Desduplicação de regra de negócio
**Risco de mexer:** alto — é a regra mais frágil do sistema e acabou de ser corrigida em 29/07 depois de derrubar o checkout de convidado. Reescrever sem preservar exatamente o comportamento atual reabre o incidente.

**Contexto:** A regra de frete grátis está escrita em sete lugares. Cinco exigem usuário logado e um deles é a RPC, que é a fonte de verdade. Dois NÃO exigem — e são justamente os que escrevem 'Gratis' na frente do cliente: o lembrete de carrinho e a calculadora de frete. Pior, o lembrete usa freeShippingMin sem a guarda de maior que zero, então com a regra desligada no admin ele calcula isFree como sempre verdadeiro e uma barra de progresso com divisão por zero. E existe uma oitava cópia morta: StoreContext.calculateShipping está no contextValue e não tem um único consumidor.

**Evidência:** docs/onboarding/02-ARQUITETURA.md seção 6.2 e o residual do achado #63. Com `&& user`: src/contexts/CartContext.tsx:746-751, src/contexts/StoreContext.tsx:600-605, src/views/customer/CartView.tsx:257, src/components/ui/custom/FreeShippingBlock.tsx:18-25 (gate em :81) e supabase/migrations/20260729000002_shipping_quote_validation_v23.sql:224-227. Sem `&& user`: src/components/ui/custom/CartReminder.tsx:25-27 e src/components/ui/custom/ShippingCalculator.tsx:202. Código morto: StoreContext.tsx:580-614, exposto em :637, sem consumidor. A edge function NÃO tem cópia da regra (grep por free_shipping_min em supabase/functions/calculate-shipping/index.ts não devolve nada).

**Critério de aceite:**

- [ ] Existe uma única função pura no front que responde 'esse carrinho tem frete gratis?', e as cinco cópias do front passam a chamá-la.
- [ ] CartReminder e ShippingCalculator param de dizer 'Gratis' para convidado, alinhados com a RPC.
- [ ] Com freeShippingMin igual a 0, CartReminder não calcula progress como Infinity e não mostra barra.
- [ ] StoreContext.calculateShipping, que não tem consumidor, foi removido do contextValue ou ganhou um consumidor.
- [ ] A RPC continua sendo a fonte de verdade: o front nunca decide o frete que será cobrado.
- [ ] Os cenários de convidado e de logado, acima e abaixo do mínimo, foram testados com scripts/db-test-guest-checkout.cjs antes e depois.

**Arquivos envolvidos:** `src/contexts/CartContext.tsx`, `src/contexts/StoreContext.tsx`, `src/components/ui/custom/CartReminder.tsx`, `src/components/ui/custom/ShippingCalculator.tsx`, `src/components/ui/custom/FreeShippingBlock.tsx`, `src/views/customer/CartView.tsx`, `scripts/db-test-guest-checkout.cjs`
**Depende de:** nada
**Bom pra quem está chegando:** não — foi o defeito que derrubou o checkout de convidado em julho, tem sete cópias e o único teste que cobre parte disso depende de alguém lembrar de rodar.

### [CATALOGO-090] Unificar as três semânticas de estoque de variação

**Tipo:** divida tecnica
**Prioridade:** P2
**Tamanho:** G
**Épico:** Desduplicação de regra de negócio
**Risco de mexer:** alto — o número de estoque aparece no card, no detalhe, no carrinho e no admin, e a RPC do checkout decrementa com base em outra lógica ainda. Convergir errado faz o cliente comprar o que não existe.

**Contexto:** O mesmo conceito tem três interpretações incompatíveis no código. A SOMA das variações ativas tem quatro cópias; o MÍNIMO entre os eixos selecionados vive na tela de produto; e o valor ABSOLUTO de uma variação vive no carrinho. O card mostra a soma e o detalhe mostra o mínimo, ou seja: o cliente vê dois números diferentes de estoque para o mesmo produto em duas telas seguidas. Nenhuma dessas cópias foi extraída para um lugar comum, e a semântica correta não está escrita em nenhum documento.

**Evidência:** docs/onboarding/02-ARQUITETURA.md seção 6.2, com a numeração usada no documento inteiro: cópia 1 = src/lib/mappers.ts:85-93; cópias 2 e 3 = src/lib/realtimeSyncEngine.ts:454-458 e :510-514; cópia 4 = src/views/admin/AdminProductFormView.tsx:760-763. As outras duas semânticas: mínimo entre eixos em src/views/customer/ProductView.tsx:538-543 e valor absoluto em src/contexts/CartContext.tsx:543-545. Relacionado ao achado #17 (qual variação define preço e estoque).

**Critério de aceite:**

- [ ] Está escrito qual semântica é a correta em cada contexto (card, detalhe, carrinho, admin) e por quê.
- [ ] A soma existe em UM lugar só, importado pelos quatro pontos que hoje a reimplementam.
- [ ] O número de estoque exibido no card e o exibido no detalhe são explicável um pelo outro — ou são iguais, ou a diferença está rotulada na UI.
- [ ] O estoque que o carrinho usa para limitar a quantidade é o mesmo que a RPC vai validar no checkout.
- [ ] Um produto com duas variações de estoques diferentes foi usado como caso de teste, e o resultado está registrado nas quatro telas.

**Arquivos envolvidos:** `src/lib/mappers.ts`, `src/lib/realtimeSyncEngine.ts`, `src/views/admin/AdminProductFormView.tsx`, `src/views/customer/ProductView.tsx`, `src/contexts/CartContext.tsx`, `docs/onboarding/02-ARQUITETURA.md`
**Depende de:** [CATALOGO-060]
**Bom pra quem está chegando:** não — exige decidir semântica de domínio que não está documentada, com quatro cópias espalhadas e o risco de vender produto sem estoque.

### [ADMIN-120] Decidir o que fazer com AdminBannersView, que tem 5.385 linhas num componente

**Tipo:** decisao
**Prioridade:** P2
**Tamanho:** P
**Épico:** Desduplicação de regra de negócio
**Risco de mexer:** alto — quebrar o arquivo sem teste nenhum é a forma mais provável de introduzir regressão silenciosa numa tela que o lojista usa toda semana; mas deixar como está faz cada bug de banner custar caro.

**Contexto:** AdminBannersView.tsx tem 5.385 linhas num único componente — mais que a pasta src/lib inteira somada. Quatro achados desta auditoria vivem nele ou no hook que ele usa, e todos foram difíceis de rastrear justamente por causa do tamanho: três pontos concorrentes de limpeza de arquivo no Storage, um handler global de teclado com precedência invertida, um cache de módulo dessincronizado e uma mutação de state no reorder. Não está registrado se o arquivo chegou a esse tamanho por decisão ou por acréscimo, e sem essa informação não dá para saber se quebrá-lo é seguro.

**Evidência:** docs/onboarting/02-ARQUITETURA.md seção 6.1 (AdminBannersView 5.385 linhas; depois dele AdminProductFormView 3.219, App.tsx 2.712, AdminProductsView 1.718, ProductView 1.415; src/views/admin/ soma 23.562 linhas em 17 arquivos) e seção 'Nao verificado', que registra a pergunta em aberto. Achados que moram ali: #23, #24, #54 e #55.

**Critério de aceite:**

- [ ] Está respondido se o arquivo chegou a 5.385 linhas por decisão ou por acréscimo.
- [ ] Está escrito se ele será quebrado agora, quebrado depois das correções de bug, ou congelado como está.
- [ ] Se for quebrar, está escrito qual é o primeiro corte (candidato natural: o diálogo de formulário e o editor de imagem, que já são logicamente separados) e o que serve de rede de segurança, já que não há teste.
- [ ] A decisão vale também para os outros arquivos patológicos listados na seção 6.1, ou explica por que não vale.

**Arquivos envolvidos:** `src/views/admin/AdminBannersView.tsx`, `src/hooks/useBanners.ts`, `docs/onboarding/02-ARQUITETURA.md`
**Depende de:** [ADMIN-030]
**Bom pra quem está chegando:** não — a pergunta é sobre histórico do projeto e apetite de risco do dono, não sobre código.

### [ADMIN-170] Reduzir os seis pontos de edição necessários para adicionar um campo em store_config

**Tipo:** divida tecnica
**Prioridade:** P3
**Tamanho:** G
**Épico:** Desduplicação de regra de negócio
**Risco de mexer:** médio — centralizar o mapeamento toca o caminho de config inteiro, que alimenta branding, frete e PWA. Esquecer um campo na migração faz ele parar de persistir silenciosamente.

**Contexto:** Adicionar um campo em store_config custa seis pontos de edição em três arquivos, mais a tela de admin, mais uma RPC. Esquecer um dos seis não dá erro: o campo simplesmente não persiste, ou não volta do realtime. Foi exatamente isso que produziu o achado das vitrines (home_sections vai no payload e não existe coluna). O caminho foi rastreado com localCepRange e está escrito no doc de arquitetura, então a lista de pontos já existe.

**Evidência:** docs/onboarding/02-ARQUITETURA.md seção 6.2. Os seis pontos rastreados: src/types/index.ts:216; src/contexts/StoreContext.tsx:37 (default), :276-279 (mapConfig), :319 (insert de inicialização) e :485-486 (updateConfig); src/lib/realtimeSyncEngine.ts:119 (mapa do realtime); mais a RPC em supabase/migrations/20260729000001_fix_upsert_store_config_partial.sql:145-147. E a tela: src/views/admin/AdminShippingView.tsx:56, :145, :187, :301 e :869-873.

**Critério de aceite:**

- [ ] Existe uma declaração única de campos de store_config (nome no app, nome na coluna, valor padrão) da qual o default, o mapConfig, o updateConfig e o mapa do realtime derivam.
- [ ] Adicionar um campo novo passa a exigir edição em no máximo dois lugares no caminho de dados, mais a tela.
- [ ] Os campos existentes continuam persistindo e voltando pelo realtime — conferido campo a campo antes e depois.
- [ ] Um campo declarado sem coluna correspondente no banco falha visivelmente em vez de ser ignorado em silêncio.
- [ ] O doc de arquitetura foi atualizado com o novo caminho.

**Arquivos envolvidos:** `src/types/index.ts`, `src/contexts/StoreContext.tsx`, `src/lib/realtimeSyncEngine.ts`, `src/views/admin/AdminShippingView.tsx`, `supabase/migrations/20260729000001_fix_upsert_store_config_partial.sql`, `docs/onboarding/02-ARQUITETURA.md`
**Depende de:** [ADMIN-020]
**Bom pra quem está chegando:** não — é refatoração transversal de um caminho de dados que alimenta branding, frete e PWA, sem teste que segure a regressão, e a falha é sempre silenciosa.

### [INFRA-200] Remover os arquivos e objetos fantasmas que fingem ser arquitetura

**Tipo:** divida tecnica
**Prioridade:** P3
**Tamanho:** P
**Épico:** Desduplicação de regra de negócio
**Risco de mexer:** baixo — são arquivos com zero importadores confirmados; o cuidado é conferir o knip.json, que hoje declara dois deles como entry e por isso os protege da detecção de código morto.

**Contexto:** Vários arquivos existem, têm nome épico, aparecem no knip.json como ponto de entrada legítimo, e não fazem absolutamente nada. Um SharedWorker que manteria estado entre abas e nunca foi instanciado. Um Web Worker que filtraria produtos fora da main thread e nunca foi instanciado — e que é a quarta implementação de busca do projeto. Um arquivo de tipos byte a byte idêntico a outro, com zero importadores. Uma tela completa que é renderizada com lista vazia e handlers vazios, e para a qual nenhum lugar do app navega. O custo não é o peso: é que um dev novo lê o nome, o comentário e a entrada no knip e conclui que ali mora lógica de verdade.

**Evidência:** docs/onboarding/02-ARQUITETURA.md seções 4.3 e 6.4. src/shared-brain.ts (45 linhas; grep por SharedWorker em src/ retorna só o próprio comentário da linha 4) e src/state-worker.ts (46 linhas; grep por 'new Worker' em src/ retorna zero), ambos declarados como entry em knip.json:5-6, o que impede o knip de reportá-los. src/types/supabase.ts (2.160 linhas, idêntico a database.types.ts, zero importadores, ignorado em knip.json:11). src/App.css (179 linhas, não importado). src/views/customer/CompareView.tsx (267 linhas, renderizada com products vazio e handlers vazios em src/App.tsx:2062-2074, sem nenhuma navegação para ela). Comentários obsoletos nos globIgnores de vite.config.ts (images/demo aponta para pasta vazia; og-image comentado como 670 kB tem 30 kB desde o commit 78e7d3c).

**Critério de aceite:**

- [ ] shared-brain.ts e state-worker.ts foram removidos, e as entradas correspondentes saíram do knip.json.
- [ ] src/types/supabase.ts foi removido e a linha de ignore correspondente saiu do knip.json.
- [ ] App.css foi removido ou passou a ser importado.
- [ ] CompareView tem destino definido: ligada a uma navegação real ou removida junto com o case do App.tsx.
- [ ] Os comentários obsoletos dos globIgnores do vite.config.ts foram corrigidos ou os padrões removidos.
- [ ] `npx knip` roda depois da limpeza e o resultado está registrado.
- [ ] A aplicação continua construindo e funcionando (build limpo + navegação pelas telas principais).

**Arquivos envolvidos:** `src/shared-brain.ts`, `src/state-worker.ts`, `src/types/supabase.ts`, `src/App.css`, `src/views/customer/CompareView.tsx`, `knip.json`, `vite.config.ts`, `src/App.tsx`
**Depende de:** nada
**Bom pra quem está chegando:** não — fora das 7 tarefas de entrada escolhidas; ver "Por onde o Netim começa" no topo

---

## Épico: Documentação viva

### [DOC-010] Introspectar e documentar as views vw_produtos_public e vw_produtos_admin

**Tipo:** doc
**Prioridade:** P2
**Tamanho:** P
**Épico:** Documentação viva
**Risco de mexer:** baixo — é introspecção somente leitura no banco, expressamente permitida. Não alterar a view.

**Contexto:** As duas views são o único caminho de leitura do catálogo (a pública atende o visitante anônimo, que nem tem SELECT na tabela produtos), e a documentação de onboarding registra que a definição real nunca foi lida. vw_produtos_admin não aparece em nenhuma das 137 migrations. Sem isso, qualquer mexida no catálogo é chute — e já se sabe que a view pública não é security_invoker, ou seja, protege por omissão de coluna, não por regra.

**Evidência:** docs/onboarding/02-ARQUITETURA.md, seção 'Não verificado': 'A definição real de vw_produtos_admin — colunas, security_invoker, se expõe custo. Sei só o que o código espera dela.' docs/onboarding/05-FLUXOS-CRITICOS.md, mesma seção: 'Definição real de vw_produtos_admin. Zero ocorrências nas 137 migrations.' Consumidores: src/contexts/StoreContext.tsx:391 (admin) e :402 (public).

**Critério de aceite:**

- [ ] A definição completa das duas views (colunas, reloptions, GRANTs) está na documentação, obtida por introspecção e com a data da leitura
- [ ] Está escrito explicitamente se cada view expõe a coluna custo e para quais roles
- [ ] Está registrado que vw_produtos_public não é security_invoker e o que isso implica na prática
- [ ] As três migrations pendentes que mexem nessa view estão listadas com o risco de cada uma

**Arquivos envolvidos:** `docs/onboarding/02-ARQUITETURA.md`, `docs/onboarding/05-FLUXOS-CRITICOS.md`, `src/contexts/StoreContext.tsx`
**Depende de:** nada
**Bom pra quem está chegando:** não — fora das 7 tarefas de entrada escolhidas; ver "Por onde o Netim começa" no topo

### [DOC-020] Confirmar se o embed de product_variants sobre a view funciona nesta instância

**Tipo:** doc
**Prioridade:** P2
**Tamanho:** P
**Épico:** Documentação viva
**Risco de mexer:** baixo — uma consulta de leitura. Se o resultado for negativo, a task vira insumo pra uma correção urgente, não pra uma correção feita aqui.

**Contexto:** O frontend carrega o catálogo com um embed de variantes sobre uma VIEW. Existe uma migration documentando que exatamente isso dava erro PGRST200, e ela criou uma RPC de contorno que o frontend NUNCA chama. Se o embed falhar em produção, o fluxo de catálogo cai no caminho que esvazia a lista de produtos — a loja fica sem vitrine. Ninguém verificou.

**Evidência:** docs/onboarding/05-FLUXOS-CRITICOS.md, 'Não verificado': 'Se o embed .select("*, product_variants(*)") sobre uma VIEW funciona nesta instância. 20260323000000_fix_pgrst200_rpc_variants.sql:1-7 documenta PGRST200 para esse caso e criou uma RPC de contorno que o frontend nunca chama. Se falhar, o Fluxo 1 cai em setProducts([]).' Consumidores: src/contexts/StoreContext.tsx:389 e :401; a mesma consulta reaparece em src/lib/realtimeSyncEngine.ts:804-808.

**Critério de aceite:**

- [ ] A consulta exata que o front faz foi executada contra produção (somente leitura) e o resultado está colado na documentação com a data
- [ ] Está escrito se as variantes vêm preenchidas, vêm vazias ou o PostgREST devolve erro
- [ ] Se o embed falha, foi aberta uma task de correção referenciando esta e o fato foi comunicado imediatamente
- [ ] O papel da RPC get_products_with_variants ficou registrado: contorno vivo, contorno morto ou lixo a remover

**Arquivos envolvidos:** `docs/onboarding/05-FLUXOS-CRITICOS.md`, `src/contexts/StoreContext.tsx`, `src/lib/realtimeSyncEngine.ts`, `supabase/migrations/20260323000000_fix_pgrst200_rpc_variants.sql`
**Depende de:** nada
**Bom pra quem está chegando:** não — fora das 7 tarefas de entrada escolhidas; ver "Por onde o Netim começa" no topo

### [DOC-030] Documentar como deployar as 3 edge functions e quais segredos cada uma exige

**Tipo:** doc
**Prioridade:** P2
**Tamanho:** M
**Épico:** Documentação viva
**Risco de mexer:** médio — deploy de edge function altera produção. Se a verificação incluir deploy, combinar antes; se for só leitura e documentação, o risco é baixo.

**Contexto:** Existem três edge functions no repositório e nenhuma foi invocada ou deployada por quem escreveu a documentação. Não há registro de qual versão está publicada, de quais segredos cada uma precisa nem de como publicar. Já apareceu um caso concreto de dúvida: o código-fonte da função de frete foi corrigido, mas ninguém conseguiu confirmar qual versão está no ar.

**Evidência:** docs/onboarding/03-SETUP-AMBIENTE.md, 'Não verificado': 'As Edge Functions. Nenhuma foi invocada nem deployada. Existem 3 (calculate-shipping, send-otp-email, send-push).' O achado #6 registra a mesma ressalva: 'Não consegui confirmar qual versão está publicada no Supabase.' supabase/functions/send-push/index.ts:29-45 mostra que send-push exige token de admin; supabase/functions/send-otp-email/index.ts:29-37 exige igualdade exata com a service_role.

**Critério de aceite:**

- [ ] Para cada uma das 3 funções está documentado: para que serve, quem a chama, quais variáveis de ambiente exige e qual o comando de deploy
- [ ] A versão publicada de cada função foi verificada e registrada com a data
- [ ] Está escrito qual projeto Supabase recebe o deploy de cada uma (o OTP hoje envolve um segundo projeto)
- [ ] Nenhum valor de credencial foi copiado para dentro da documentação

**Arquivos envolvidos:** `docs/onboarding/03-SETUP-AMBIENTE.md`, `supabase/functions/calculate-shipping/index.ts`, `supabase/functions/send-otp-email/index.ts`, `supabase/functions/send-push/index.ts`
**Depende de:** [AUTH-020]
**Bom pra quem está chegando:** não — fora das 7 tarefas de entrada escolhidas; ver "Por onde o Netim começa" no topo

### [DOC-040] Medir o max-rows do PostgREST deste projeto e documentar

**Tipo:** doc
**Prioridade:** P3
**Tamanho:** P
**Épico:** Documentação viva
**Risco de mexer:** baixo — leitura e configuração de painel, sem escrita.

**Contexto:** O motor de sincronização faz uma consulta de resumo sem `.limit()`, então o teto real é o do servidor, e ninguém sabe qual é. Enquanto isso o cache do catálogo está travado em 200. A divergência entre os dois limites é o que produz a oscilação de catálogo descrita na arquitetura — e ela não pode nem ser avaliada sem esse número.

**Evidência:** docs/onboarding/02-ARQUITETURA.md, 'Não verificado': 'O max-rows do PostgREST deste projeto. catchUp não passa .limit() (:581-583), então o teto é o do servidor. O default do Supabase é 1000, mas não conferi.' Código: src/lib/realtimeSyncEngine.ts:581-583 (sem limit) contra src/contexts/StoreContext.tsx:391 e :402 (.limit(200)).

**Critério de aceite:**

- [ ] O valor de max-rows está documentado com a fonte (painel do Supabase ou resposta de teste) e a data
- [ ] Está escrito o que acontece quando o catálogo passar do menor dos dois limites
- [ ] O número de produtos ativos hoje está registrado ao lado, para dar escala

**Arquivos envolvidos:** `docs/onboarding/02-ARQUITETURA.md`, `src/lib/realtimeSyncEngine.ts`, `src/contexts/StoreContext.tsx`
**Depende de:** nada
**Bom pra quem está chegando:** não — fora das 7 tarefas de entrada escolhidas; ver "Por onde o Netim começa" no topo

### [DOC-050] Fechar os links quebrados da documentação de onboarding

**Tipo:** doc
**Prioridade:** P3
**Tamanho:** P
**Épico:** Documentação viva
**Risco de mexer:** baixo — só texto.

**Contexto:** A documentação de onboarding aponta para três arquivos que não existem. Quem chega segue o link e bate em nada, o que corrói a confiança no resto do material logo no primeiro dia.

**Evidência:** docs/onboarding/02-ARQUITETURA.md (tabela do rodapé) registra literalmente que 06-ESTADO-ATUAL.md, ../backlog/BACKLOG.md e ../backlog/ROADMAP.md 'Ainda não existem'. docs/onboarding/03-SETUP-AMBIENTE.md, 'Não verificado', repete o aviso. `ls docs/onboarding/` mostra apenas 01 a 05, PROMPTS-ONBOARDING-DEV.md e o jsonl de dados brutos.

**Critério de aceite:**

- [ ] Nenhum link relativo da pasta docs/onboarding aponta para arquivo inexistente
- [ ] Os arquivos que ainda vão existir estão marcados como pendentes no texto, em vez de linkados como se existissem
- [ ] Uma verificação de links (script simples ou passo manual documentado) foi executada e o resultado registrado

**Arquivos envolvidos:** `docs/onboarding/01-VISAO-GERAL.md`, `docs/onboarding/02-ARQUITETURA.md`, `docs/onboarding/03-SETUP-AMBIENTE.md`, `docs/onboarding/05-FLUXOS-CRITICOS.md`
**Depende de:** nada
**Bom pra quem está chegando:** não — fora das 7 tarefas de entrada escolhidas; ver "Por onde o Netim começa" no topo

### [DOC-060] Documentar o inventário real de RPCs e como contar os call sites corretamente

**Tipo:** doc
**Prioridade:** P3
**Tamanho:** P
**Épico:** Documentação viva
**Risco de mexer:** baixo — documentação e, no máximo, um script de apoio.

**Contexto:** Qualquer inventário feito com um grep ingênuo de `.rpc(` cobre menos da metade do que o front realmente usa, porque várias chamadas usam cast e nome na linha seguinte. Já foi medido: 17 linhas no grep simples contra 41 call sites reais e 30 nomes distintos. Sem isso registrado, o próximo levantamento erra do mesmo jeito.

**Evidência:** Levantamento do estado do banco desta semana: `grep -rn "\.rpc(" src/` devolve 17 linhas; varredura cobrindo também `(supabase.rpc as any)("nome")` acha 41 call sites e 30 nomes distintos. Exemplos que o grep simples perde: sync_cart_atomic (src/contexts/CartContext.tsx:479), upsert_store_config (src/contexts/StoreContext.tsx:490), update_order_status_atomic (src/hooks/useOrders.ts:56 e :734).

**Critério de aceite:**

- [ ] A documentação lista os 30 nomes de RPC com pelo menos um arquivo:linha de chamada para cada
- [ ] Existe um comando ou script versionado que reproduz a contagem e que encontra os 41 call sites
- [ ] Estão marcadas as RPCs que só funcionam por causa de argumento com DEFAULT, e as sobrecargas duplicadas que dariam ambiguidade se fossem chamadas
- [ ] A data da medição está no documento

**Arquivos envolvidos:** `docs/onboarding/02-ARQUITETURA.md`, `src/hooks/useOrders.ts`, `src/contexts/StoreContext.tsx`, `src/contexts/CartContext.tsx`
**Depende de:** nada
**Bom pra quem está chegando:** não — fora das 7 tarefas de entrada escolhidas; ver "Por onde o Netim começa" no topo

---

## Épico: Fundação de engenharia

### [INFRA-020] Fazer `npm run typecheck` checar de verdade

**Tipo:** infra
**Prioridade:** P1
**Tamanho:** P
**Épico:** Fundação de engenharia
**Risco de mexer:** baixo — já foi medido que o código passa limpo no typecheck real, então corrigir o script não abre cratera nenhuma.

**Contexto:** `npm run typecheck` volta exit 0 em menos de 1 segundo sem analisar arquivo nenhum, porque o tsconfig raiz é solution-style com `files: []` e o script não usa `-b`. É o pior tipo de armadilha: verde falso. Enquanto isso o script de build já faz `npx tsc -b`, ou seja o projeto tem a configuração certa e o script errado.

**Evidência:** package.json:10 — `"typecheck": "tsc --noEmit"`. tsconfig.json:2 — `"files": []` com `references` para tsconfig.app.json e tsconfig.node.json. package.json:8 — `"build": "npx tsc -b && vite build"` (o build já resolve as referências). Medição: o script atual roda em ~0,78 s; `npx tsc -p tsconfig.app.json --noEmit` roda em ~14 s, carrega 911 arquivos e retorna 0 erros.

**Critério de aceite:**

- [ ] `npm run typecheck` analisa os arquivos de src/ (comprovado por tempo de execução ou --listFiles)
- [ ] Introduzir um erro de tipo proposital em qualquer arquivo de src/ faz o comando falhar com exit diferente de zero
- [ ] O comando continua retornando 0 erros no código atual, sem precisar afrouxar nenhuma flag do tsconfig
- [ ] tsconfig.node.json também é coberto

**Arquivos envolvidos:** `package.json`, `tsconfig.json`, `tsconfig.app.json`, `tsconfig.node.json`
**Depende de:** nada
**Bom pra quem está chegando:** sim — Abre a configuração de build do projeto — tsconfig solution-style com project references — e devolve a rede de segurança que hoje é verde falso, já que o comando passa em menos de um segundo sem analisar arquivo nenhum. Vale como primeiro commit do dia 1: sem ele, toda task seguinte é feita no escuro.

### [INFRA-030] Remover `*.yml` do .gitignore para permitir arquivos de CI

**Tipo:** infra
**Prioridade:** P1
**Tamanho:** P
**Épico:** Fundação de engenharia
**Risco de mexer:** baixo — mas conferir antes o que passa a ser rastreado; a regra foi colateral de uma limpeza de screenshots e pode estar escondendo outros .yml locais.

**Contexto:** A regra `*.yml` no .gitignore faz qualquer arquivo de workflow ser ignorado em silêncio: criar `.github/workflows/ci.yml` e dar `git add` falha sem mensagem de erro. Enquanto essa linha existir, é impossível ter CI neste repositório. Ela mora no bloco de screenshots do Playwright, junto de `.playwright-mcp/` e `*.png` — foi acidente, não decisão.

**Evidência:** Conferido agora: .gitignore:60 é `*.yml`, dentro do bloco 'Playwright & test screenshots/configs' (linhas 53-60). `git check-ignore -v .github/workflows/ci.yml` devolve `.gitignore:60:*.yml` com exit 0. Confirmado também que lefthook.yml existe no disco e não está versionado por causa dessa regra.

**Critério de aceite:**

- [ ] `git check-ignore -v .github/workflows/ci.yml` retorna exit 1 (não ignorado)
- [ ] `git status` depois da mudança foi revisado e nenhum .yml com dado sensível entrou por engano
- [ ] Se algum .yml precisa continuar fora do git, ele está ignorado por nome explícito, não por curinga
- [ ] lefthook.yml aparece como arquivo rastreável

**Arquivos envolvidos:** `.gitignore`, `lefthook.yml`
**Depende de:** nada
**Bom pra quem está chegando:** não — fora das 7 tarefas de entrada escolhidas; ver "Por onde o Netim começa" no topo

### [INFRA-040] Criar o primeiro workflow de CI rodando lint, typecheck e build

**Tipo:** infra
**Prioridade:** P1
**Tamanho:** M
**Épico:** Fundação de engenharia
**Risco de mexer:** baixo — CI não altera o produto. O cuidado é não configurar o gate como bloqueante antes de os comandos passarem, senão trava o PR de todo mundo.

**Contexto:** Não existe CI: o diretório .github/workflows nem foi criado. Todos os 14 scripts de qualidade dependem de alguém lembrar de rodar na mão, e com dois desenvolvedores isso deixa de funcionar. Sem CI, cada task de bug fica mais cara porque não há rede que segure regressão.

**Evidência:** Conferido agora: `.github/` contém apenas copilot-instructions.md; `.github/workflows/` não existe. package.json:8-21 tem 14 scripts de qualidade e nenhum `test`. `npm run lint` hoje retorna exit 1 com 14 erros e 1106 warnings; `npm run biome:check` retorna exit 1 com 337 diagnósticos, 87% deles só formatação (CRLF).

**Critério de aceite:**

- [ ] Existe .github/workflows/ci.yml versionado e ele roda em todo push e em todo pull request
- [ ] O workflow roda o typecheck corrigido e o build, e falha se qualquer um falhar
- [ ] O lint roda no workflow, mas com um limite de aviso definido e escrito (não pode reprovar por causa dos 1106 warnings preexistentes)
- [ ] Um PR de teste com erro de tipo proposital aparece reprovado na interface do GitHub
- [ ] O README ou a doc de onboarding explica o que o CI checa e como reproduzir localmente

**Arquivos envolvidos:** `.github/workflows/ci.yml`, `package.json`, `README.md`, `docs/onboarding/03-SETUP-AMBIENTE.md`
**Depende de:** [INFRA-030]
**Bom pra quem está chegando:** não — fora das 7 tarefas de entrada escolhidas; ver "Por onde o Netim começa" no topo

### [INFRA-140] Rodar no CI os 12 testes Deno que já existem na edge function de frete

**Tipo:** infra
**Prioridade:** P2
**Tamanho:** P
**Épico:** Fundação de engenharia
**Risco de mexer:** baixo — os testes já existem e não tocam em nada de produção.

**Contexto:** O contexto do projeto diz 'zero testes automatizados', e isso é meia verdade: existem 12 casos de teste bem escritos para a edge function de frete, cobrindo inclusive o bug do hífen no formato de faixa de CEP. O que é zero é a EXECUÇÃO — não há script, não há CI, e o knip ainda classifica o arquivo como não usado.

**Evidência:** Conferido agora: supabase/functions/calculate-shipping/index_test.ts existe (3.994 bytes) com 12 blocos `Deno.test`, cobrindo calculateSmartFallback, getCartHash e isLocalCep. Não há script de teste em package.json (14 scripts, nenhum `test`). `npx knip` lista esse arquivo em 'Unused files (1)'. Existe também supabase/tests/database_verification_test.sql (897 bytes) que nada referencia.

**Critério de aceite:**

- [ ] `npm test` (ou script equivalente documentado) executa os 12 testes Deno localmente e passa
- [ ] O CI executa esses testes em todo PR e reprova se algum falhar
- [ ] O knip para de listar index_test.ts como arquivo não usado
- [ ] O destino de supabase/tests/database_verification_test.sql está decidido e escrito: entra no CI ou é removido

**Arquivos envolvidos:** `supabase/functions/calculate-shipping/index_test.ts`, `supabase/tests/database_verification_test.sql`, `package.json`, `knip.json`, `.github/workflows/ci.yml`
**Depende de:** [INFRA-040]
**Bom pra quem está chegando:** não — fora das 7 tarefas de entrada escolhidas; ver "Por onde o Netim começa" no topo

### [INFRA-150] Instalar um runner de teste no front e cobrir os mappers

**Tipo:** infra
**Prioridade:** P2
**Tamanho:** M
**Épico:** Fundação de engenharia
**Risco de mexer:** baixo — adiciona devDependency e arquivos novos; não toca em código de produção.

**Contexto:** Não há runner de teste no front: nem vitest, nem jest, nem playwright nas dependências. Começar por src/lib/mappers.ts é a escolha certa porque é função pura, cobre o ponto onde o formato do banco vira o formato do app (nome de coluna em português x inglês, view x tabela) e é exatamente onde um erro passa despercebido hoje.

**Evidência:** package.json (conferido agora): 14 scripts e nenhum `test`; nas devDependencies não existe vitest, jest nem playwright. `git ls-files | grep -Ei '(\.test\.|\.spec\.|__tests__)'` retorna 0. src/lib/mappers.ts:49-95 é a função mapProductFromDB, que aceita tanto linha de tabela quanto de view e tem vários fallbacks silenciosos.

**Critério de aceite:**

- [ ] `npm test` roda no front e passa
- [ ] Existem testes cobrindo mapProductFromDB para os dois formatos (linha de tabela e linha de view) e para produto sem imagem
- [ ] Existe teste cobrindo o mapeamento de pedido em mapOrderFromDB
- [ ] O CI executa esses testes em todo PR
- [ ] A doc de onboarding registra onde os testes ficam e como rodar

**Arquivos envolvidos:** `package.json`, `src/lib/mappers.ts`, `.github/workflows/ci.yml`, `docs/onboarding/03-SETUP-AMBIENTE.md`
**Depende de:** [INFRA-040]
**Bom pra quem está chegando:** não — fora das 7 tarefas de entrada escolhidas; ver "Por onde o Netim começa" no topo

### [INFRA-160] Ativar hooks de git de verdade com lefthook

**Tipo:** infra
**Prioridade:** P2
**Tamanho:** M
**Épico:** Fundação de engenharia
**Risco de mexer:** médio — hook mal configurado trava o commit dos dois desenvolvedores. Começar só com o básico é rápido.

**Contexto:** O lefthook.yml tem 41 linhas e todas são comentário — é o boilerplate de exemplo intocado. O lefthook nem está no package.json (foi baixado pelo cache do npx). E o único hook instalado, prepare-commit-msg, tem o caminho do executável cravado na máquina do Gabriel, então some na máquina do Netim. Resultado: nada é verificado antes de entrar no repositório.

**Evidência:** lefthook.yml: as 41 linhas começam com '#' (lido inteiro agora). `grep -i lefthook package.json` não retorna nada. `.git/hooks/` tem só prepare-commit-msg sem sufixo .sample, e o fallback aponta para C:/Users/Gabriel/AppData/Local/npm-cache/_npx/... . @commitlint/cli está nas devDependencies e nunca é invocado (o knip o marca como não usado).

**Critério de aceite:**

- [ ] lefthook está declarado nas devDependencies e `npm install` seguido do passo documentado instala os hooks
- [ ] O pre-commit roda pelo menos formatação e lint nos arquivos alterados, e leva menos de 10 segundos num commit típico
- [ ] Um commit com erro de tipo ou lint bloqueante é recusado localmente
- [ ] O hook funciona numa máquina que nunca rodou npx (sem caminho absoluto no arquivo)
- [ ] O commitlint passa a ser usado de verdade ou sai das devDependencies

**Arquivos envolvidos:** `lefthook.yml`, `package.json`, `.git/hooks/prepare-commit-msg`, `docs/onboarding/03-SETUP-AMBIENTE.md`
**Depende de:** [INFRA-030]
**Bom pra quem está chegando:** não — fora das 7 tarefas de entrada escolhidas; ver "Por onde o Netim começa" no topo

### [INFRA-220] Fazer o Biome cobrir as edge functions e remover o ignore de caminho absoluto

**Tipo:** infra
**Prioridade:** P3
**Tamanho:** P
**Épico:** Fundação de engenharia
**Risco de mexer:** baixo — só muda o alcance do linter; não altera código de produção. Cuidado: incluir supabase/ pode gerar um lote grande de diagnósticos de formatação de uma vez.

**Contexto:** O biome.json ignora o diretório supabase INTEIRO, então as três edge functions Deno nunca passam por nenhum linter ou formatador — justamente o código que roda no servidor e que mais precisa. Tem também um ignore de caminho absoluto da máquina do Gabriel, que não faz sentido em repositório compartilhado.

**Evidência:** biome.json (lido agora), bloco files.ignore: node_modules, dist, .vite-pwa, "supabase", "C:\\Users\\Gabriel\\Documents", .unlighthouse, .playwright-mcp, .loki, test-results. As 3 edge functions vivem exatamente em supabase/functions/.

**Critério de aceite:**

- [ ] O ignore de caminho absoluto C:\\Users\\Gabriel\\Documents saiu do biome.json
- [ ] `npx biome check supabase/functions` roda e reporta diagnósticos
- [ ] Os arquivos das edge functions foram formatados num commit separado, só de formatação, para não poluir revisão de lógica
- [ ] Nenhum ignore novo foi acrescentado só para silenciar diagnóstico

**Arquivos envolvidos:** `biome.json`, `supabase/functions/calculate-shipping/index.ts`, `supabase/functions/send-otp-email/index.ts`, `supabase/functions/send-push/index.ts`
**Depende de:** nada
**Bom pra quem está chegando:** não — fora das 7 tarefas de entrada escolhidas; ver "Por onde o Netim começa" no topo

---

### [INFRA-250] Zerar os 553 warnings de eslint e baixar o teto da catraca até zero

**Tipo:** divida tecnica
**Prioridade:** P3
**Tamanho:** G
**Épico:** Fundação de engenharia
**Risco de mexer:** médio — o risco não é funcional na maior parte, é de CONFLITO: são 54 arquivos, e um commit gigante de formatação colide com tudo que o outro dev tiver aberto. Por isso o aceite exige três PRs separados, em ordem, e combinados no Discord antes. A exceção é a fase 3: `react-hooks/exhaustive-deps` pode mudar comportamento de verdade (loop de render, efeito que deixa de disparar) e cada caso precisa ser entendido, nunca silenciado.

**Contexto:** O CI tem uma catraca de lint (`npm run lint:ratchet`) que compara com os tetos de `.lint-baseline.json` e reprova só o que sobe. Ela impede a dívida de crescer, mas não a diminui sozinha. Enquanto o teto for 553, o job fica verde com 553 warnings — o que é honesto, mas não é o objetivo. Esta task é o trabalho de derrubar o número até zero e, aí sim, transformar a catraca num gate de verdade.

**Evidência:** Medido no CI em 30/07/2026 (execução `30583264354`): 553 warnings e 7 erros em 54 arquivos. Distribuição por regra, do maior para o menor:

| Regra | Quantidade | Natureza |
| --- | --- | --- |
| `tailwindcss/classnames-order` | 352 | auto-corrigível com `--fix`, zero risco funcional |
| `security/detect-object-injection` | 108 | quase sempre falso positivo em TS tipado |
| `security/detect-non-literal-fs-filename` | 36 | scripts de build lendo caminho montado; falso positivo |
| `tailwindcss/no-custom-classname` | 33 | classe que falta na whitelist do `eslint.config.js` |
| `react-hooks/exhaustive-deps` | 13 | **o único grupo que pode esconder bug de verdade** |
| outras 7 regras | 11 | resto |

Os 7 erros (que não são warning) estão fora do escopo desta task: são 3 de `react-hooks` em `AdminCarouselsView.tsx` e 4 de `jsx-a11y/label-has-associated-control` em `AdminProductFormView.tsx` e `AdminShippingView.tsx`.

**Critério de aceite:**

- [ ] **Fase 1, um PR só de formatação:** `npx eslint . --fix` resolve os 352 de `classnames-order`; o diff é revisado para confirmar que só ordem de classe mudou; `.lint-baseline.json` cai para 201 no mesmo PR
- [ ] **Fase 2, um PR de decisão:** para `security/detect-object-injection` e `security/detect-non-literal-fs-filename` (144 no total), a escolha entre corrigir, desligar a regra no `eslint.config.js` ou suprimir com comentário está tomada e **escrita no PR**; se a decisão for desligar, o motivo está no próprio arquivo de config, não só na mensagem do commit
- [ ] **Fase 3, um PR por vez:** cada um dos 13 `react-hooks/exhaustive-deps` foi aberto e entendido; nenhum foi silenciado com `eslint-disable` sem uma frase dizendo por que a dependência faltante é intencional
- [ ] `.lint-baseline.json` está com `eslint.warnings` em **0** e `eslint.errors` no valor da época
- [ ] `npm run lint:ratchet` sai com 0 e não imprime nenhuma linha "baixou"
- [ ] O comentário do job `Catraca de lint` no `ci.yml` foi atualizado: não cita mais esta task como pendente

**Arquivos envolvidos:** `.lint-baseline.json`, `eslint.config.js`, `.github/workflows/ci.yml`, e os 54 arquivos que hoje têm warning (a lista sai de `npx eslint . --format json`)
**Depende de:** [INFRA-040] — a catraca e o baseline só existem depois que o CI entra
**Bom pra quem está chegando:** não — parece tarefa de entrada por ser mecânica, mas toca 54 arquivos ao mesmo tempo e o custo de errar é conflito com o outro dev, não erro de código. Combine antes.

---

## Épico: Higiene do repositório

### [INFRA-050] Proteger o `.env.bak` no .gitignore

**Tipo:** infra
**Prioridade:** P1
**Tamanho:** P
**Épico:** Higiene do repositório
**Risco de mexer:** baixo — uma linha no .gitignore. Não abrir o conteúdo do arquivo nem copiar valor nenhum para lugar algum.

**Contexto:** Existe um `.env.bak` na raiz que não está versionado E não está ignorado. Um `git add .` distraído comita o arquivo, e o projeto já teve credencial em histórico público antes. É cinco minutos de trabalho para fechar um risco que já aconteceu uma vez.

**Evidência:** Conferido agora: `git check-ignore -v .env.bak` retorna exit 1 (nenhuma regra casa). O .gitignore cobre .env, .env.local, .env.*.local, .env.vercel*, .env.production e .env*.local (linhas 4-8 e 40), mas nenhum padrão pega `.env.bak`. Dos 11 arquivos .env* da raiz, só .env.example está versionado, o que está correto.

**Critério de aceite:**

- [ ] `git check-ignore -v .env.bak` retorna exit 0
- [ ] O padrão adicionado cobre variações futuras (.bak, .old, .backup) sem excluir o .env.example
- [ ] `git status` não lista mais o .env.bak como untracked
- [ ] Nenhum valor de credencial foi copiado para dentro de arquivo de documentação ou de commit

**Arquivos envolvidos:** `.gitignore`
**Depende de:** nada
**Bom pra quem está chegando:** não — fora das 7 tarefas de entrada escolhidas; ver "Por onde o Netim começa" no topo

### [INFRA-170] Tirar os screenshots do controle de versão

**Tipo:** infra
**Prioridade:** P2
**Tamanho:** M
**Épico:** Higiene do repositório
**Risco de mexer:** médio — `git rm --cached` de 300+ arquivos gera um commit grande que colide com qualquer branch aberta. Combinar a janela com o outro dev antes.

**Contexto:** O diretório de screenshots do Playwright é o maior conteúdo do repositório: 205 arquivos versionados, e os 12 maiores arquivos do projeto são todos imagem. Somando os PNGs soltos, são mais de 300 arquivos de imagem versionados e nenhum arquivo de código aparece entre os maiores. As regras de .gitignore já existem, mas foram adicionadas depois — gitignore não destrava o que já está dentro.

**Evidência:** Conferido agora: `git ls-files .playwright-mcp/ | wc -l` = 205; `git ls-files '*.png' | grep -v '^public/' | wc -l` = 109. As regras existem em .gitignore:54 (.playwright-mcp/) e :55-59 (*.png com exceções de public/), mas chegaram tarde. O .git tem 33 MB e o conteúdo versionado do HEAD, 21,48 MB em 650 arquivos.

**Critério de aceite:**

- [ ] `git ls-files .playwright-mcp/` retorna 0 linhas
- [ ] `git ls-files '*.png' | grep -v '^public/'` retorna 0 linhas
- [ ] Os ícones e imagens legítimas de public/ continuam versionados e o build continua gerando o favicon e o og-image corretos
- [ ] Os arquivos continuam no disco local de quem precisa (remoção só do índice, não do disco)
- [ ] O outro desenvolvedor foi avisado antes do merge

**Arquivos envolvidos:** `.gitignore`, `.playwright-mcp/`
**Depende de:** nada
**Bom pra quem está chegando:** não — fora das 7 tarefas de entrada escolhidas; ver "Por onde o Netim começa" no topo

### [INFRA-180] Limpar as branches já mergeadas e resolver o `origin/master` zumbi

**Tipo:** infra
**Prioridade:** P2
**Tamanho:** P
**Épico:** Higiene do repositório
**Risco de mexer:** médio — apagar branch remota é destrutivo. Nada pode ser apagado antes de conferir o que tem dentro, e `origin/master` só sai com autorização explícita.

**Contexto:** São 10 branches locais e 11 refs remotas, várias já mergeadas em main. O caso perigoso é `origin/master`: último commit em 21/04/2026, divergente de origin/main. Com um segundo desenvolvedor entrando, ter master e main no mesmo remote é convite a push no lugar errado.

**Evidência:** Conferido com `git branch -a`: locais backup/pre-limpeza-segredos, chore/claude-code-setup, chore/migra-chaves-api-supabase, chore/rotacao-senha-e-gitignore, claude/relaxed-robinson-cac8ad, docs/estado-e-backlog (atual), docs/onboarding-mapa-projeto, feat/rebrand-ikcous, main, shadow-fix-transitions; remotas incluem origin/master além de origin/main. origin/master: SHA 5b58bb8 contra 072f03e de origin/main.

**Já resolvido em 30/07/2026, no PR `chore/limpeza-raiz`:** `git log origin/main..origin/master` respondeu a pergunta que estava em aberto — `origin/master` **não tem ancestral comum** com a `main` (`git diff origin/main...origin/master` devolve "no merge base"). Não era branch antiga do projeto, era uma raiz paralela com um commit, `5b58bb8 feat: Ikcous Architecture Initial`. Foi preservada na tag `arquivo/master-inicial` e a branch foi apagada do remoto. As duas branches locais vazias (`claude/relaxed-robinson-cac8ad` e `shadow-fix-transitions`, ambas com 0 commits à frente da main) saíram com `git branch -d`. A `backup/pre-limpeza-segredos` ficou, por ser a rede de segurança do incidente de credencial.

**O que sobra:** as branches remotas de PR já mergeado (`origin/docs/prompts-onboarding-dev`, `origin/feat/rebrand-ikcous`) e as de PR aberto, que só saem quando os PRs entrarem. O auto-delete de branch após merge resolve isso daqui para frente, e faz parte do item 7 do PR do GitFlow.

**Critério de aceite:**

- [x] `git log origin/main..origin/master` foi rodado e o resultado está registrado por escrito na task
- [x] origin/master foi apagado, com o commit preservado na tag `arquivo/master-inicial`
- [ ] Branches remotas de PR já mergeado foram apagadas, com a lista do que foi apagado registrada
- [ ] `delete_branch_on_merge` está ligado no repositório, para o problema não voltar
- [ ] Um push direto em `main` é recusado pelo hook `pre-push` local — **testado**, não presumido
- [ ] Está escrito na documentação que não existe proteção do lado do servidor, e por quê

> O critério anterior era "main está protegida no GitHub contra push direto". Era **inatingível**: em repositório privado no plano Free, `GET /repos/.../branches/main/protection` e `/rulesets` devolvem 403 com "Upgrade to GitHub Pro or make this repository public". Enquanto esse checkbox existisse, a task nunca poderia ser fechada. A proteção possível hoje é hook local, contornável com `--no-verify` — ver "A trava que não existe" no `CONTRIBUTING.md`. Trocar isso por proteção de verdade é a decisão registrada na [INFRA-240].

**Arquivos envolvidos:** `.git`
**Depende de:** nada
**Bom pra quem está chegando:** não — fora das 7 tarefas de entrada escolhidas; ver "Por onde o Netim começa" no topo

### [INFRA-210] Corrigir a identidade do projeto no package.json

**Tipo:** infra
**Prioridade:** P3
**Tamanho:** P
**Épico:** Higiene do repositório
**Risco de mexer:** baixo — o campo name de um pacote privado não é usado por nada em runtime; conferir apenas se nenhum script ou config depende dele.

**Contexto:** O package.json ainda tem o nome de template do Vite. Não quebra nada, mas é o primeiro arquivo que alguém novo abre e passa a mensagem errada sobre o cuidado do projeto.

**Evidência:** package.json:2 — `"name": "my-app"`, com private: true e version 1.0.0 (conferido agora). O restante do arquivo já está correto para o projeto.

**Critério de aceite:**

- [ ] O campo name identifica o projeto (ex.: ikcous-marketplace)
- [ ] Foram adicionados description e repository apontando para o repositório real
- [ ] `npm install` e `npm run build` continuam funcionando após a mudança
- [ ] Nenhum script, config de ferramenta ou nome de chunk quebrou por causa da troca

**Arquivos envolvidos:** `package.json`
**Depende de:** nada
**Bom pra quem está chegando:** não — fora das 7 tarefas de entrada escolhidas; ver "Por onde o Netim começa" no topo

### [INFRA-230] Limpar as dependências e scripts que ninguém executa

**Tipo:** infra
**Prioridade:** P3
**Tamanho:** P
**Épico:** Higiene do repositório
**Risco de mexer:** baixo — remover devDependency não usada não afeta o build; validar rodando build e lint depois.

**Contexto:** O ferramental declarado não corresponde ao que existe. Há script chamando binário que não está instalado, dependências que nada usa e um orçamento de tamanho de bundle configurado que ninguém roda. Isso confunde quem chega e faz o `npm install` demorar mais do que precisa.

**Evidência:** `npx knip` reporta 3 devDependencies não usadas (@commitlint/cli, pg, puppeteer), 1 dependência não listada (jsr, usado em supabase/functions/send-push/index.ts:4) e 1 binário não listado (sqlfluff, chamado pelo script sqlfluff:lint em package.json:15). .size-limit.json existe com limite de 800 kB para JS e 100 kB para CSS e o script `size` (package.json:20) não é chamado por nada.

**Critério de aceite:**

- [ ] Cada devDependency apontada pelo knip foi removida ou passou a ser realmente usada, com a escolha registrada
- [ ] O script sqlfluff:lint funciona (binário instalado e documentado) ou foi removido
- [ ] O script `size` roda no CI com os limites do .size-limit.json, ou o arquivo e o script são removidos
- [ ] `npm install` a partir de node_modules limpo seguido de `npm run build` funciona

**Arquivos envolvidos:** `package.json`, `knip.json`, `.size-limit.json`, `supabase/functions/send-push/index.ts`
**Depende de:** [INFRA-040]
**Bom pra quem está chegando:** não — fora das 7 tarefas de entrada escolhidas; ver "Por onde o Netim começa" no topo

---

## Épico: Integridade do carrinho

### [CARRINHO-010] Preservar variantNames na reidratação do localStorage e na sincronia entre dispositivos

**Tipo:** bug
**Prioridade:** P1
**Tamanho:** M
**Épico:** Integridade do carrinho
**Risco de mexer:** médio — recriar sync_cart_atomic é uma migration numa RPC do caminho quente do carrinho; o lado do Zod é uma linha. Se a RPC sair errada o carrinho sincronizado esvazia.

**Contexto:** A variação escolhida ('Cor: Azul, Tamanho: M') não sobrevive nem à recarga da página nem à troca de aparelho, por dois motivos independentes. O schema Zod que valida o carrinho no localStorage não declara variantNames, e o Zod v4 remove chave não declarada. E a RPC sync_cart_atomic faz DELETE + INSERT sem a coluna variant_names — que existe na tabela e fica sempre NULL. O CheckoutView monta a observação do pedido exatamente com esse campo, então o pedido chega ao lojista sem indicação da variação e o item errado é separado.

**Evidência:** Achados #10 e #11. src/contexts/CartContext.tsx:19-24 (schema sem o campo), :112-127 (safeParse na reidratação), :471 (envia variant_names) e :266-267 (lê de volta). Comportamento do Zod v4 confirmado empiricamente com a versão instalada: safeParse descarta a chave. Corpo vivo de sync_cart_atomic (pg_get_functiondef, 30/07): INSERT sem variant_names. Consumidor: src/views/customer/CheckoutView.tsx:401-402.

**Critério de aceite:**

- [ ] cartItemSchema declara variantNames como string opcional.
- [ ] Adicionar produto com variação, recarregar a página (F5) e abrir o carrinho: o texto da variação continua visível.
- [ ] Nova migration recria sync_cart_atomic incluindo MAX(item-&gt;&gt;'variant_names') no INSERT agregado.
- [ ] Montar carrinho com variação no celular e abrir no desktop logado com a mesma conta: a variação aparece.
- [ ] A observação do pedido gerada no CheckoutView cita a variação nos dois cenários acima.

**Arquivos envolvidos:** `src/contexts/CartContext.tsx`, `supabase/migrations/ (arquivo novo)`, `supabase/migrations/20260606000000_fix_sync_cart_atomic_updated_at.sql`, `src/views/customer/CheckoutView.tsx`
**Depende de:** nada
**Bom pra quem está chegando:** não — fora das 7 tarefas de entrada escolhidas; ver "Por onde o Netim começa" no topo

### [CARRINHO-020] Reidratar o snapshot de produto guardado no carrinho antes do checkout

**Tipo:** bug
**Prioridade:** P1
**Tamanho:** G
**Épico:** Integridade do carrinho
**Risco de mexer:** alto — o merge do carrinho tem Last-Write-Wins com tombstones de 7 dias e uma assinatura que zera a cotação de frete a cada mudança. Mexer no merge sem entender os tombstones ressuscita item que o cliente apagou.

**Contexto:** O item do carrinho guarda o objeto Product inteiro (preço, estoque, freeShipping) no instante em que foi adicionado, e persiste isso no localStorage. Nada reidrata esse snapshot: convidado nem tenta, e no usuário logado o merge descarta o item remoto sempre que o timestamp local for maior ou igual. Se o admin reajusta o preço, o cliente vê o valor velho e a RPC v23 recusa o pedido pela divergência de total. A mensagem hoje é amigável ('Atualize o carrinho e tente novamente') mas não existe caminho de atualização: o cliente precisa adivinhar que tem de remover e re-adicionar o item.

**Evidência:** Achado #9. src/contexts/CartContext.tsx:317-319 (ramo vazio do LWW mantém o item.product antigo inteiro), :184-190 (early-return do convidado, 'Preserving local cart'). Grep por 'revalidate' em src/ só acha um comentário não relacionado em src/lib/dataVault.ts:8. A recusa continua ativa: create_marketplace_order_v23 aborta em ABS(v_calculated_total - p_total_amount) &gt; 0.05 (bloco 6 do corpo vivo).

**Critério de aceite:**

- [ ] Existe uma função de revalidação que, ao abrir o carrinho, cruza os itens com os produtos atuais do StoreContext/DataVault e atualiza preço, estoque e freeShipping.
- [ ] Alterar o preço de um produto no admin e abrir o carrinho do cliente (sem limpar nada) mostra o preço novo e o novo total.
- [ ] Item cujo produto ficou sem estoque ou inativo é sinalizado na UI com ação explícita de remover.
- [ ] O convidado também passa pela revalidação, não só o usuário logado.
- [ ] Os tombstones continuam funcionando: item removido pelo cliente não volta após a revalidação.
- [ ] O checkout deixa de recusar por divergência num carrinho que acabou de ser aberto.

**Arquivos envolvidos:** `src/contexts/CartContext.tsx`, `src/views/customer/CartView.tsx`, `src/contexts/StoreContext.tsx`, `src/views/customer/CheckoutView.tsx`
**Depende de:** nada
**Bom pra quem está chegando:** não — o merge do carrinho é a área com mais invariantes implícitas do projeto (LWW, tombstones de 7 dias, assinatura do carrinho que zera o frete) e nenhuma está coberta por teste.

---

## Épico: Notificações que funcionam

### [PUSH-010] Fazer send-push reportar quantos envios falharam em vez de sempre success:true

**Tipo:** bug
**Prioridade:** P1
**Tamanho:** M
**Épico:** Notificações que funcionam
**Risco de mexer:** médio — mexe numa edge function em produção, e não há como confirmar pelo repositório qual versão está publicada; precisa de deploy e verificação no dashboard do Supabase.

**Contexto:** A edge function usa Promise.allSettled mas devolve sempre {success:true, total} com HTTP 200, sem contar quantos envios falharam. O admin só verifica o erro do invoke, então VAPID inválido, endpoint expirado ou erro da lib webpush aparecem como sucesso: toast verde 'Notificacao enviada para N dispositivos', log com recipient_count cheio e histórico marcando 'Enviada', mesmo que ninguém tenha recebido nada. Como o push é o único canal de aviso de status para o cliente, essa mentira esconde a falha inteira do canal.

**Evidência:** Achado #19. supabase/functions/send-push/index.ts:127-130 (`return new Response(JSON.stringify({ success: true, total: subscriptions.length, results }))` sem contar fulfilled/rejected do Promise.allSettled de :85 e :124). Lado cliente: src/views/admin/AdminPushView.tsx:376 (invoke sem capturar data), :391-400 (só checa pushError) e :330 (grava recipient_count com o total de alvos antes do disparo). push_subscriptions tem 8 linhas hoje.

**Critério de aceite:**

- [ ] A resposta da edge function inclui contagem de sucesso e de falha, e a lista de motivos de falha.
- [ ] O admin captura o data do invoke e mostra o número real de entregues, não o de alvos.
- [ ] Envio com todos os endpoints inválidos mostra aviso, não toast verde.
- [ ] recipient_count gravado no histórico é o número de entregues, não o de alvos.
- [ ] Endpoint expirado (410/404) é removido de push_subscriptions.
- [ ] Está registrado qual versão da function foi publicada e quando (a versão em produção não é verificável pelo repositório).

**Arquivos envolvidos:** `supabase/functions/send-push/index.ts`, `src/views/admin/AdminPushView.tsx`
**Depende de:** nada
**Bom pra quem está chegando:** não — fora das 7 tarefas de entrada escolhidas; ver "Por onde o Netim começa" no topo

### [PUSH-020] Checar a sessão antes de criar a assinatura push no navegador

**Tipo:** bug
**Prioridade:** P1
**Tamanho:** P
**Épico:** Notificações que funcionam
**Risco de mexer:** baixo — mover uma guarda para antes do subscribe e desfazer a assinatura órfã; não mexe em RLS nem em banco.

**Contexto:** O subscribe() pede permissão e cria a PushSubscription no navegador ANTES de checar se existe usuário logado. Sem sessão ele apenas faz console.warn e retorna, deixando uma assinatura órfã ativa no navegador e nenhuma linha no banco (a RLS só aceita authenticated com auth.uid() = user_id). No próximo carregamento getSubscription() devolve a assinatura órfã, o banner some para sempre e o cliente acha que está inscrito, mas nunca receberá nada — e a permissão do navegador já foi gasta.

**Evidência:** Achado #20. src/hooks/usePushNotifications.ts:64-73 (subscribe em :64-67 acontece antes do `if (!user)` de :69-73, que só faz console.warn e return; permissão já pedida em :44) e :76-86 (o upsert nunca roda; :83 mantém user_id: user?.id || null). RLS conferida hoje em pg_policies: push_subscriptions_all_policy, roles {authenticated}, qual/with_check ((SELECT auth.uid()) = user_id) OR is_admin(). Das 8 linhas de push_subscriptions, 6 estão com user_id NULL.

**Critério de aceite:**

- [ ] A checagem de sessão acontece ANTES de pedir permissão e antes do subscribe.
- [ ] Visitante deslogado que toca em ativar notificações vê convite para entrar, não um console.warn mudo.
- [ ] Se por algum caminho o subscribe ocorrer sem sessão, a assinatura é desfeita (unsubscribe) para não envenenar o getSubscription futuro.
- [ ] Usuário logado que ativa notificações tem linha gravada em push_subscriptions com user_id preenchido.
- [ ] Está registrado o que fazer com as 6 linhas existentes de user_id NULL.

**Arquivos envolvidos:** `src/hooks/usePushNotifications.ts`, `src/components/ui/custom/PushPermissionBanner.tsx`, `src/contexts/AuthContext.tsx`
**Depende de:** nada
**Bom pra quem está chegando:** sim — Costura permissão do navegador, sessão do AuthContext e RLS de push_subscriptions numa correção curta — o jeito mais barato de entender por que uma escrita falha silenciosamente quando não há usuário logado. Hoje o cliente acha que está inscrito, nunca recebe nada, e a permissão do navegador já foi gasta.

### [PUSH-040] Fazer notificação de campanha global poder ser lida e excluída pelo cliente

**Tipo:** bug
**Prioridade:** P2
**Tamanho:** M
**Épico:** Notificações que funcionam
**Risco de mexer:** médio — mudar para fan-out por usuário multiplica linhas na tabela; manter a linha global exige mexer em policy. As duas saídas têm consequência e a escolha precisa estar registrada.

**Contexto:** Toda campanha de push para o segmento 'all' cria uma linha com usuario_id NULL. O cliente vê essa notificação (a policy de SELECT permite NULL), mas as policies de UPDATE e DELETE exigem auth.uid() = usuario_id: marcar como lida ou excluir casa com 0 linhas e o PostgREST devolve sucesso sem erro. A UI atualiza otimisticamente, nada persiste, e ao reabrir o app a notificação volta como não lida — repetível infinitamente. markAllAsRead ainda por cima marca todas no estado local mesmo filtrando o UPDATE pelo usuário.

**Evidência:** Achado #64. src/contexts/NotificationContext.tsx:32-37 (fetch com .or usuario_id.eq/.is.null), :79-93 (markAllAsRead filtra por usuario_id mas marca todas no state), :63-77 e :95-107 (markAsRead e deleteNotification sem .select() para conferir linhas afetadas). pg_policies em 30/07/2026: notificacoes_update_policy e notificacoes_delete_policy com qual ((auth.uid() = usuario_id) OR is_admin()); notificacoes_select_policy inclui OR (usuario_id IS NULL). Origem: src/views/admin/AdminPushView.tsx:345-352 insere usuario_id: null quando segment === 'all'.

**Critério de aceite:**

- [ ] Está escrito qual saída foi escolhida: fan-out por usuário via RPC SECURITY DEFINER, ou linha global com tabela de leitura por usuário.
- [ ] Marcar uma notificação de campanha como lida persiste: reabrir o app mostra ela como lida.
- [ ] Excluir uma notificação de campanha persiste.
- [ ] As mutações conferem o número de linhas afetadas (.select()) e não atualizam a UI quando o resultado foi zero.
- [ ] markAllAsRead só marca no estado local o que o UPDATE realmente alcançou.

**Arquivos envolvidos:** `src/contexts/NotificationContext.tsx`, `src/views/admin/AdminPushView.tsx`, `supabase/migrations/ (arquivo novo)`, `src/views/customer/NotificationsView.tsx`
**Depende de:** nada
**Bom pra quem está chegando:** não — fora das 7 tarefas de entrada escolhidas; ver "Por onde o Netim começa" no topo

---

## Épico: Operação de pedidos do lojista

### [PEDIDO-030] Impedir que a reconexão do realtime zere a lista de pedidos do admin

**Tipo:** bug
**Prioridade:** P1
**Tamanho:** P
**Épico:** Operação de pedidos do lojista
**Risco de mexer:** baixo — são três chamadas no mesmo arquivo; a guarda por isAdmin já existe como parâmetro do hook e é usada em outros pontos.

**Contexto:** Quando o socket do realtime cai e volta (comum em 4G ou ao trazer o app do background), o hook recarrega os pedidos chamando sempre fetchUserOrders, que filtra por user_id do próprio administrador — normalmente zero pedidos — e substitui a lista paginada do admin. A tela passa a exibir 'Ainda não tem nenhum pedido' enquanto a paginação continua indicando várias páginas. Numa loja onde o maior risco operacional é pedido parado sem ninguém ver, isso é grave.

**Evidência:** Achado #13. src/hooks/useOrders.ts:536 (handleReconnect), :591 (handleVisibilityChange) e :608 (handleOnline) chamam fetchUserOrdersRef.current() sem guarda de modo. fetchUserOrders é a consulta pessoal: :162-163 só checa !user || !enabled, :194 filtra .eq('user_id', user.id), :204 faz setOrders. O parâmetro isAdmin existe em :110 e já é usado em :391, :447 e :457.

**Critério de aceite:**

- [ ] As três recargas passam a chamar a consulta paginada de admin quando isAdmin é true, ou no mínimo ficam dentro de if (!isAdmin).
- [ ] Com a tela de Pedidos do admin aberta e várias páginas, desligar e religar a rede mantém a lista e a paginação intactas.
- [ ] O filtro e a página em que o admin estava são preservados após a reconexão.
- [ ] O cliente comum continua tendo os pedidos recarregados ao voltar do background.

**Arquivos envolvidos:** `src/hooks/useOrders.ts`, `src/views/admin/AdminOrdersView.tsx`
**Depende de:** nada
**Bom pra quem está chegando:** sim — Mostra que o mesmo hook useOrders serve as duas metades do app, cliente e admin, por caminhos diferentes, e como o realtime recarrega dados ao reconectar. O sintoma — o lojista vendo "nenhum pedido" com pedidos parados na fila — é o pior risco operacional da loja hoje.

### [PEDIDO-040] Quebrar o loop de requisições do OrderDetailsView para usuário sem pedidos

**Tipo:** bug
**Prioridade:** P1
**Tamanho:** P
**Épico:** Operação de pedidos do lojista
**Risco de mexer:** baixo — são duas mudanças pequenas: guarda de referência no setOrders e tirar `orders` das deps do useCallback.

**Contexto:** Na tela de detalhe do pedido, o useCallback que carrega o pedido depende do array orders, e o useEffect depende desse callback. Para um usuário logado sem nenhum pedido e sem cache, cada fetch devolve [] e o setOrders cria um array novo, recriando o callback e disparando o efeito outra vez: requisições ao Supabase em loop com o spinner travado. O mesmo `if (orders.length === 0)` faz o oposto quando há cache: a tela nunca revalida no servidor.

**Evidência:** Achado #14. src/views/customer/OrderDetailsView.tsx:122-126 (`if (orders.length === 0) currentOrders = await fetchUserOrders();`), :145 (deps incluem `orders`), :147-149 (efeito depende do callback). Origem em src/hooks/useOrders.ts:202-208 — `if (data)` é verdadeiro para array vazio, então setOrders([]) troca a referência a cada volta.

**Critério de aceite:**

- [ ] Abrir a tela de detalhe com um usuário logado que nunca comprou dispara no máximo uma requisição (conferido na aba Network).
- [ ] O spinner sai e a tela mostra estado de 'pedido não encontrado' em vez de girar para sempre.
- [ ] Com pedidos em cache, a tela revalida no servidor pelo menos uma vez ao abrir.
- [ ] setOrders não substitui o estado quando o resultado é equivalente ao atual.

**Arquivos envolvidos:** `src/views/customer/OrderDetailsView.tsx`, `src/hooks/useOrders.ts`
**Depende de:** nada
**Bom pra quem está chegando:** não — fora das 7 tarefas de entrada escolhidas; ver "Por onde o Netim começa" no topo

### [PEDIDO-050] Decidir o destino do segundo projeto Supabase que envia o OTP de convidado

**Tipo:** decisao
**Prioridade:** P1
**Tamanho:** P
**Épico:** Operação de pedidos do lojista
**Risco de mexer:** alto — o código que hoje envia o e-mail não está neste repositório. Qualquer mexida às cegas no trigger derruba o único caminho de rastreio do convidado, e não há como testar sem escrever no banco.

**Contexto:** O rastreio de pedido de convidado depende de um e-mail com código de 6 dígitos que hoje NÃO chega. O trigger busca a chave de autorização em app_settings, que está vazia, e cai no fallback da chave anon do header — que a edge function recusa. Como net.http_post é fire-and-forget, o erro some e a tela mostra 'Código enviado para seu e-mail!'. Pior: o trigger vivo aponta para um SEGUNDO projeto Supabase (jvgyjlbjhbfrncwbytls), cujo código-fonte não está neste repositório, enquanto supabase/functions/send-otp-email deploya para o projeto principal. Ninguém consegue consertar isso sem o Gabriel responder: esse segundo projeto fica, ou o envio volta pro principal?

**Evidência:** Achado #32. SELECT key FROM public.app_settings devolveu ZERO linhas em 30/07/2026. Trigger on_otp_created_send_email ativo em otp_verifications (pg_trigger, tgenabled='O'). Corpo vivo de handle_new_otp_verification aponta para `https://jvgyjlbjhbfrncwbytls.functions.supabase.co/send-otp-email`, com o comentário literal 'updated to jvgyjlbjhbfrncwbytls'. Nenhuma migration aplicada local define essa função. supabase/functions/send-otp-email/index.ts:29-37 exige igualdade exata com a service_role. A UI promete entrega em src/components/ui/custom/OrderSearch.tsx:82.

**Critério de aceite:**

- [ ] Está escrito qual projeto passa a hospedar send-otp-email, e por quê.
- [ ] Está escrito como o trigger vai se autenticar: segredo dedicado no Vault com header próprio, ou Database Webhook — não a chave do header.
- [ ] Se o segundo projeto for mantido, está escrito onde vive o código-fonte dele e quem tem acesso.
- [ ] A decisão registra explicitamente que a migration pendente 20260708190000_secure_otp_flow.sql reverteria a URL para o projeto principal se algum dia rodar.

**Arquivos envolvidos:** `supabase/functions/send-otp-email/index.ts`, `supabase/migrations/20260708190000_secure_otp_flow.sql`, `src/components/ui/custom/OrderSearch.tsx`
**Depende de:** nada
**Bom pra quem está chegando:** não — depende de informação que só o Gabriel tem (acesso e histórico do segundo projeto); não há o que investigar no repositório.

### [PEDIDO-080] Parar de prometer entrega de código OTP que não foi confirmada

**Tipo:** bug
**Prioridade:** P2
**Tamanho:** P
**Épico:** Operação de pedidos do lojista
**Risco de mexer:** baixo — mexe só no texto e no estado da tela de rastreio, não no banco.

**Contexto:** Enquanto a decisão sobre o envio do OTP não sai, o convidado fica preso: a tela afirma 'Código de verificação enviado para seu e-mail!' e avança para a etapa de digitar o código, mas o e-mail não chega e não há saída nem explicação. A RPC devolve boolean e o front trata como confirmação de entrega, o que ela nunca foi.

**Evidência:** Achado #32 (metade de UI). src/components/ui/custom/OrderSearch.tsx:76-86 — o toast de sucesso dispara com o retorno booleano da RPC, que só indica que a linha foi inserida em otp_verifications, não que o e-mail saiu. O disparo real é fire-and-forget via net.http_post no trigger.

**Critério de aceite:**

- [ ] A mensagem deixa de afirmar entrega e passa a dizer que o código foi solicitado.
- [ ] A etapa de digitar o código oferece caminho de saída visível: reenviar e voltar.
- [ ] Se o cliente errar ou não receber, a tela explica o que fazer em vez de só falhar.
- [ ] Nenhuma mudança no banco nesta task.

**Arquivos envolvidos:** `src/components/ui/custom/OrderSearch.tsx`, `src/hooks/useOrders.ts`
**Depende de:** [PEDIDO-050]
**Bom pra quem está chegando:** não — fora das 7 tarefas de entrada escolhidas; ver "Por onde o Netim começa" no topo

### [PEDIDO-090] Enviar o push de mudança de status somente depois que a RPC confirmar

**Tipo:** bug
**Prioridade:** P2
**Tamanho:** P
**Épico:** Operação de pedidos do lojista
**Risco de mexer:** baixo — é uma reordenação de blocos dentro de uma função, mais um fallback para resolver o userId.

**Contexto:** No painel admin, o push 'Seu pedido agora está: X' é disparado ANTES da RPC que muda o status. Se a RPC falhar (401, sessão expirada, pedido já cancelado), o cliente já foi notificado de uma mudança que não aconteceu e a UI faz rollback. Além disso o userId vem de orders.find(...): se o admin abriu o pedido por deep link, order é undefined e nenhum push é enviado, sem aviso nenhum.

**Evidência:** Achado #42. src/views/admin/AdminOrdersView.tsx:440 (`const order = orders?.find((o) => o.id === orderId);`), :442-468 (invoke de send-push) e só em :471 vem `await updateOrderStatus(...)` dentro do try/catch que mostra 'Erro ao atualizar status do pedido' em :482.

**Critério de aceite:**

- [ ] O bloco de push roda depois do await de updateOrderStatus, dentro do caminho de sucesso.
- [ ] Forçar a RPC a falhar não gera nenhum push.
- [ ] O userId é resolvido por selectedOrder quando orders.find não encontra o pedido (caso deep link).
- [ ] Se o alvo do push não for encontrado, o admin vê um aviso em vez de silêncio.

**Arquivos envolvidos:** `src/views/admin/AdminOrdersView.tsx`, `src/hooks/useOrders.ts`
**Depende de:** nada
**Bom pra quem está chegando:** não — fora das 7 tarefas de entrada escolhidas; ver "Por onde o Netim começa" no topo

### [PEDIDO-100] Serializar a fila offline de status e descartar erro terminal em vez de reenfileirar

**Tipo:** bug
**Prioridade:** P2
**Tamanho:** M
**Épico:** Operação de pedidos do lojista
**Risco de mexer:** médio — o hook é montado em seis lugares ao mesmo tempo; a trava tem que ser de escopo de módulo, não de instância, senão não resolve nada.

**Contexto:** Várias instâncias de useOrders montadas simultaneamente leem a MESMA fila em localStorage e disparam a mesma RPC ao voltar a conexão. A segunda chamada falha ('Apenas pedidos pendentes podem ser cancelados'), o item volta para a fila e passa a falhar em toda reconexão futura — o cliente vê 'Falha ao sincronizar' para sempre, por um cancelamento que já foi concluído com sucesso.

**Evidência:** Achado #43. src/hooks/useOrders.ts:39-102 (syncOfflineOrderUpdates sem guarda de promessa em voo; catch em :67-74 faz remainingQueue.push(item) incondicional) e :997-1020 (efeito guarda só typeof window, sem checar enabled). Call sites confirmados: src/views/customer/CartView.tsx:70, src/components/ui/custom/OrderSearch.tsx:31 (renderizado dentro do CartView), src/views/customer/ProfileView.tsx:95, src/views/customer/OrderDetailsView.tsx:89, src/components/layouts/AdminLayout.tsx:56 e src/views/customer/CheckoutView.tsx:89.

**Critério de aceite:**

- [ ] Existe uma promessa em escopo de módulo que serializa a sincronização: com seis instâncias montadas, a fila é processada uma vez só.
- [ ] Erro terminal (pedido já cancelado, pedido não mais pendente) remove o item da fila em vez de reenfileirar.
- [ ] Erro transitório (rede, 5xx) continua reenfileirando.
- [ ] Cancelar offline, reconectar e reconectar de novo não produz nenhum toast de 'Falha ao sincronizar' repetido.
- [ ] As instâncias com enabled=false não registram o listener de 'online'.

**Arquivos envolvidos:** `src/hooks/useOrders.ts`
**Depende de:** nada
**Bom pra quem está chegando:** não — fora das 7 tarefas de entrada escolhidas; ver "Por onde o Netim começa" no topo

---

## Épico: Operação do lojista

### [PEDIDO-020] Avisar o lojista quando entra um pedido novo

**Tipo:** feature
**Prioridade:** P0
**Tamanho:** M
**Épico:** Operação do lojista
**Risco de mexer:** médio — envolve edge function e possivelmente trigger no banco; qualquer trigger novo em marketplace_orders entra no caminho do checkout e um erro ali derruba a venda. Fazer o disparo assíncrono e tolerante a falha.

**Contexto:** Não existe nenhum canal que avise o lojista de pedido novo: nem push, nem e-mail, nem som, nem badge. O único sinal é o canal realtime da tela de pedidos do admin, que exige a tela aberta e ativa. Em loja com estoque imediato, pedido parado por horas é a causa número um de cancelamento.

**Evidência:** Reprodução: fechar o painel admin, criar um pedido pelo site, nenhum canal notifica. Código: supabase/functions/send-push/index.ts:29-45 exige que QUEM CHAMA seja admin (valida o token e checa profiles.role='admin'), então um pedido de cliente nunca consegue dispará-la. marketplace_orders não tem trigger non-internal (medido). O toast de pedido novo em src/hooks/useOrders.ts:326-328 está atrás de `if (!isAdmin && ...)`, ou seja nunca dispara para o admin. src/App.tsx:476-486 — o badge conta itens do carrinho, não pedidos.

**Critério de aceite:**

- [ ] Criar um pedido de teste com o painel admin FECHADO e o lojista recebe o aviso em até 1 minuto
- [ ] O aviso contém número do pedido, valor e nome do cliente
- [ ] Se o canal de aviso falhar, o pedido continua sendo criado normalmente (falha do aviso não pode abortar o checkout)
- [ ] O caminho de disparo não exige que o chamador seja admin

**Arquivos envolvidos:** `supabase/functions/send-push/index.ts`, `src/hooks/useOrders.ts`, `src/views/admin/AdminOrdersView.tsx`
**Depende de:** [PUSH-030]
**Bom pra quem está chegando:** não — precisa decidir arquitetura de disparo (trigger vs chamada do front vs webhook) e mexe no caminho crítico do checkout

### [ADMIN-130] Exportar pedidos em CSV a partir do painel

**Tipo:** feature
**Prioridade:** P2
**Tamanho:** P
**Épico:** Operação do lojista
**Risco de mexer:** baixo — é só leitura e geração de arquivo no cliente; nenhuma escrita no banco.

**Contexto:** Nenhum relatório sai do sistema. Fechamento de mês, entrega ao contador e conferência de estoque viram trabalho de olhar tela e copiar número. As únicas ocorrências de download/impressão no projeto são a impressão de UM pedido e o preview de imagem no formulário de produto.

**Evidência:** Busca por \.csv|text/csv|createObjectURL|download=|window\.print em src/ retorna apenas 2 linhas: src/components/admin/orders/OrderDetail.tsx:125 (globalThis.print() de um pedido) e src/views/admin/AdminProductFormView.tsx:72 (createObjectURL de preview de imagem). Não há papaparse, xlsx nem jspdf no package.json (conferido agora).

**Critério de aceite:**

- [ ] O admin baixa um CSV com os pedidos do período filtrado na tela
- [ ] O CSV abre corretamente no Excel em português (separador e encoding conferidos com acentuação)
- [ ] Colunas mínimas: número, data, cliente, itens, subtotal, frete, desconto, total, status, forma de pagamento
- [ ] A exportação respeita o filtro de data e status ativo na tela, e isso é demonstrável com dois filtros diferentes

**Arquivos envolvidos:** `src/views/admin/AdminOrdersView.tsx`, `src/hooks/useOrders.ts`, `src/lib/mappers.ts`
**Depende de:** nada
**Bom pra quem está chegando:** sim — Ensina o formato real do pedido (itens, subtotal, frete, desconto, status) e como a listagem do admin filtra e pagina, sem escrever uma linha no banco. Entrega ao lojista o primeiro relatório que sai do sistema, hoje inexistente.

### [ADMIN-140] Mostrar alerta de estoque baixo no dashboard e tornar o limiar configurável

**Tipo:** feature
**Prioridade:** P2
**Tamanho:** M
**Épico:** Operação do lojista
**Risco de mexer:** baixo — o número já é calculado pelo banco e o limiar hoje é uma constante literal na listagem; nenhuma escrita nova em produto.

**Contexto:** A baixa de estoque é sólida (a RPC de pedido valida e decrementa de forma atômica, e o cancelamento devolve). O que falta é o alerta: a RPC do dashboard devolve inventoryAlerts e o campo está declarado no tipo, mas nenhum componente renderiza esse número. O único sinal de estoque baixo é uma barra vermelha com limiar 5 cravado no código.

**Evidência:** grep por inventoryAlerts em src/ retorna exatamente 2 linhas, ambas de declaração: src/hooks/useAnalytics.ts:92 e src/types/index.ts:329 — nenhum componente consome. Limiar cravado em src/views/admin/AdminProductsView.tsx:1458, :1529, :1537 e :1695 (`product.stock <= 5`).

**Critério de aceite:**

- [ ] O dashboard mostra o número de produtos em estoque baixo e clicar nele leva à lista filtrada
- [ ] O limiar sai do código e vem da configuração da loja
- [ ] Alterar o limiar no admin muda o que a listagem de produtos destaca, sem recarregar a página
- [ ] Produto com variações usa o estoque somado das variações, igual ao resto da tela

**Arquivos envolvidos:** `src/hooks/useAnalytics.ts`, `src/components/admin/dashboard/KpiSummaryCards.tsx`, `src/views/admin/AdminProductsView.tsx`, `src/contexts/StoreContext.tsx`
**Depende de:** nada
**Bom pra quem está chegando:** não — fora das 7 tarefas de entrada escolhidas; ver "Por onde o Netim começa" no topo

---

## Épico: PWA que se recupera sozinho

### [PWA-010] Unificar a recuperação de erro de chunk e dar saída para o usuário

**Tipo:** bug
**Prioridade:** P1
**Tamanho:** G
**Épico:** PWA que se recupera sozinho
**Risco de mexer:** alto — o purge nuclear desregistra service workers, apaga todos os caches e deleta o IndexedDB. Errar aqui deixa a base instalada sem app offline, e o caminho de teste passa por instalar o PWA de verdade.

**Contexto:** Existem DOIS mecanismos concorrentes de recuperação de erro de chunk, com chaves diferentes, janelas diferentes e estratégias diferentes, e as guardas não se conhecem. No boundary, o reload só acontece se passaram 10 s do último; quando a guarda bloqueia, o render continua devolvendo uma tela de spinner 'Atualizando o Aplicativo' sem botão e sem timeout — o usuário fica preso até fechar o app. No outro mecanismo, o handler de ChunkLoadError chama o purge nuclear sem nenhuma checagem de conectividade: o cliente perde o service worker, o cache e o conteúdo offline e cai numa tela de sem conexão do navegador — justamente no cenário de rede ruim, que é o que produz o erro de chunk.

**Evidência:** Achados #21 e #53. src/components/ui/custom/GlobalErrorBoundary.tsx:49-65 (guarda de 10 s com chave pwa_chunk_reload_time; se bloquear, nada acontece), :104-116 (ramo isChunkError só com spinner; State em :10-13 não tem recoveryBlocked) e :93-98 (handleReset não limpa caches nem desregistra SW). src/hooks/useUpdateCheck.ts:358 e :370 (chave pwa_chunk_error_reload), :380 (chama performNuclearPurge(true)), :136-211 (nenhuma menção a navigator.onLine no arquivo), :164-172 (deleteDatabase fire-and-forget) e :202 (window.location.href em vez de replace). A trava anti-loop e a comparação semver já foram corrigidas em 29/07 (commit 9542f04).

**Critério de aceite:**

- [ ] Existe UM único mecanismo de recuperação de erro de chunk, com uma única chave de guarda.
- [ ] Quando a guarda bloqueia o reload, a tela mostra botão de ação e explicação — nunca spinner infinito.
- [ ] O purge só roda com navigator.onLine true e com verificação real de rede bem-sucedida.
- [ ] O purge disparado por erro de chunk PRESERVA o IndexedDB (o catálogo offline), apagando apenas caches e service workers.
- [ ] O deleteDatabase é efetivamente aguardado antes de navegar.
- [ ] A navegação usa location.replace, sem empilhar o parâmetro forceUpdate no histórico.
- [ ] Com o PWA instalado e a rede desligada, forçar um erro de chunk não deixa o app inutilizável.

**Arquivos envolvidos:** `src/components/ui/custom/GlobalErrorBoundary.tsx`, `src/hooks/useUpdateCheck.ts`, `src/pwa-sentinel.ts`, `public/silent-guardian.js`
**Depende de:** nada
**Bom pra quem está chegando:** não — é a área com mais mecanismos concorrentes não documentados do projeto (quatro removedores do loader, dois recuperadores de chunk, um sentinel), e o modo de falha atinge a base instalada sem caminho de rollback.

### [PWA-020] Parar de cachear cada /version.json?t= como entrada nova no Service Worker

**Tipo:** bug
**Prioridade:** P2
**Tamanho:** P
**Épico:** PWA que se recupera sozinho
**Risco de mexer:** médio — a ordem importa: primeiro o early-return no SW, só depois trocar o cliente. Inverter deixa uma janela em que a verificação de versão lê resposta cacheada.

**Contexto:** O app pede /version.json com cache-busting por query a cada 3 minutos e a cada volta de foco, e o Service Worker guarda cada uma dessas URLs únicas no Cache Storage, que não tem teto (só o cache de imagens tem). Em poucos dias são milhares de entradas que nunca serão reutilizadas; quando a quota estoura, os cache.put falham em silêncio — a promise nem tem .catch, virando unhandled rejection no SW — e assets legítimos deixam de ser cacheados.

**Evidência:** Achado #52. src/sw/sw.ts:73-183: após o guard de GET em :81 não há early-return para /version.json (grep por 'version.json' em src/sw/ retorna zero), e o ramo stale-while-revalidate de :171-183 grava qualquer 200 basic/cors com cache.put em :180-182, sem filtro de query string e sem .catch(). Produtor: src/hooks/useUpdateCheck.ts:69 (`fetch(/version.json?t=${Date.now()})`), chamado pelo setInterval de 3 min em :113 e pelo visibilitychange em :115-120. index.html:62 tem '/version.json' no speculationrules.

**Critério de aceite:**

- [ ] O Service Worker tem early-return para /version.json antes de qualquer cache.put — a URL nunca entra no Cache Storage, com ou sem query.
- [ ] Depois disso, o cliente troca o cache-busting por query por fetch com { cache: 'no-store' }.
- [ ] Todos os cache.put têm tratamento de erro, sem unhandled rejection no SW.
- [ ] Após 30 minutos de app aberto, o Cache Storage não tem nenhuma entrada de /version.json (conferido no DevTools &gt; Application).
- [ ] A detecção de nova versão continua funcionando.

**Arquivos envolvidos:** `src/sw/sw.ts`, `src/hooks/useUpdateCheck.ts`, `index.html`
**Depende de:** nada
**Bom pra quem está chegando:** não — fora das 7 tarefas de entrada escolhidas; ver "Por onde o Netim começa" no topo

---

## Épico: Painel administrativo que não mente

### [ADMIN-010] Fazer updateConfig sinalizar falha em vez de engolir o erro e mostrar sucesso

**Tipo:** bug
**Prioridade:** P1
**Tamanho:** M
**Épico:** Painel administrativo que não mente
**Risco de mexer:** médio — muda a assinatura de uma função do StoreContext consumida por cinco telas de admin; deixar uma tela sem ajustar troca o toast falso por comportamento inconsistente.

**Contexto:** updateConfig captura qualquer erro internamente e retorna normalmente, sem re-lançar e sem devolver sucesso. Todo chamador que embrulhou a chamada num try/catch tem catch morto: em caso de falha (RLS, sessão expirada, rede) a UI segue para onSetDirty(false) e toast de sucesso. Em AdminCarouselsView isso faz o admin ver 'Vitrines salvas com sucesso!', o modal fechar e a vitrine sumir da lista. O mesmo padrão de catch morto existe em AdminShippingView, AdminPushView, AdminReviewsView e AdminCouponsView.

**Evidência:** Achado #56. src/contexts/StoreContext.tsx:50 (assinatura Promise&lt;void&gt;), :444-447 (early-return de não-admin com toast.error e return, sem sinalizar falha) e :506-509 (catch faz console.error + toast.error e NÃO re-lança). src/views/admin/AdminCarouselsView.tsx:113-127 (try/catch com catch inalcançável) e :184-208 (handleAddCustomVitrine limpa o título e fecha o modal incondicionalmente após o await).

**Critério de aceite:**

- [ ] updateConfig passa a devolver Promise&lt;boolean&gt; (ou lançar) e não mais Promise&lt;void&gt; silencioso.
- [ ] As cinco telas que chamam updateConfig respeitam o retorno: em falha, não limpam o formulário, não fecham o modal e não mostram toast de sucesso.
- [ ] O early-return de não-admin também sinaliza falha ao chamador.
- [ ] Simular falha (revogar sessão no DevTools e salvar) mostra erro e mantém o formulário preenchido, em todas as cinco telas.
- [ ] O caminho de sucesso continua idendico ao de hoje.

**Arquivos envolvidos:** `src/contexts/StoreContext.tsx`, `src/views/admin/AdminCarouselsView.tsx`, `src/views/admin/AdminShippingView.tsx`, `src/views/admin/AdminPushView.tsx`, `src/views/admin/AdminReviewsView.tsx`, `src/views/admin/AdminCouponsView.tsx`
**Depende de:** nada
**Bom pra quem está chegando:** não — fora das 7 tarefas de entrada escolhidas; ver "Por onde o Netim começa" no topo

### [ADMIN-020] Decidir se as colunas de vitrines e de banner completo entram no banco ou saem do código

**Tipo:** decisao
**Prioridade:** P1
**Tamanho:** P
**Épico:** Painel administrativo que não mente
**Risco de mexer:** médio — criar coluna em store_config e em banners é barato; remover campo do formulário apaga funcionalidade que o Gabriel talvez queira. É escolha de produto, não de engenharia.

**Contexto:** Duas telas do admin escrevem em colunas que não existem no banco de produção. A curadoria de vitrines (AdminCarouselsView) manda home_sections no payload, a coluna não existe em nenhuma relação, o RPC a ignora em silêncio e a tela mostra 'Configurações salvas' — nada persiste. E o formulário de banners no modo 'completo' escreve subtitle, title_color, badge_text, start_date, end_date e show_text_overlay: os tipos declaram 22 colunas para a tabela banners, a produção tem 8, e o PostgREST rejeita. Nos dois casos a saída é a mesma pergunta: cria a coluna e persiste, ou remove o campo e desliga a tela?

**Evidência:** Achado #3 (residual) e achado #22 (reclassificado). src/contexts/StoreContext.tsx:485-486 envia dbUpdates.home_sections; query em information_schema.columns por column_name='home_sections' voltou vazia em 30/07/2026. src/views/admin/AdminCarouselsView.tsx:118 chama updateConfig({homeSections}). src/types/database.types.ts:145-170 declara 22 colunas para banners; SELECT das colunas reais devolveu 8 (id, image_url, title, link, position, active, order, created_at) e `select subtitle from banners` falha. Writers: src/hooks/useBanners.ts:300-327 (INSERT) e :415-443 (UPDATE).

**Critério de aceite:**

- [ ] Está escrito, para vitrines: cria a coluna home_sections e persiste, ou remove o campo do payload e desliga a tela de curadoria.
- [ ] Está escrito, para banners: quais dos 15 campos do modo completo viram coluna e quais saem do formulário e dos tipos.
- [ ] A decisão registra que os tipos em database.types.ts estão dessincronizados do banco e como serão regerados.
- [ ] A decisão registra que nenhuma migration do repo cria essas colunas (grep por badge_text/subtitle em supabase/migrations: 0 arquivos).

**Arquivos envolvidos:** `src/views/admin/AdminCarouselsView.tsx`, `src/contexts/StoreContext.tsx`, `src/hooks/useBanners.ts`, `src/views/admin/AdminBannersView.tsx`, `src/types/database.types.ts`
**Depende de:** nada
**Bom pra quem está chegando:** não — a informação que falta é de produto (o que o lojista realmente usa dessas telas), não está no código e só o Gabriel tem.

### [ADMIN-030] Parar de apagar do storage a imagem de banner que o admin não enviou nesta sessão

**Tipo:** bug
**Prioridade:** P1
**Tamanho:** M
**Épico:** Painel administrativo que não mente
**Risco de mexer:** alto — AdminBannersView.tsx tem 5.385 linhas num componente só, com três pontos de limpeza de arquivo e um handler global de Escape. O erro atual é silenciado com .catch(() =&gt; {}), então regressão aqui também será silenciosa.

**Contexto:** Dois caminhos apagam do bucket a imagem errada. Ao DUPLICAR um banner, o formulário recebe a URL da imagem do original e o editingBanner é zerado; se o admin fechar sem salvar, a limpeza compara formData.imageUrl com editingBanner?.imageUrl (undefined), a comparação é sempre verdadeira e o arquivo do banner ORIGINAL é apagado — o banner original continua na tabela apontando para URL 404 e a Home exibe espaço vazio. E o handler global de Escape testa isDialogOpen ANTES de isAdjusterOpen: como o editor de imagem abre por cima do formulário, apertar Esc dentro do editor fecha o formulário inteiro e dispara a mesma limpeza, apagando a imagem recém-enviada. O mesmo caminho é usado pelo gesto de voltar no mobile.

**Evidência:** Achados #23 e #24. src/views/admin/AdminBannersView.tsx:1237-1251 (handleOpenChange compara com editingBanner?.imageUrl e engole o erro), :1181-1235 (handleDuplicateBanner: setEditingBanner(null) e copia banner.imageUrl), :851-865 (precedência do Escape invertida, sem ramo para bannerToDelete), :5327-5329 (ImageAdjuster renderizado fora do bloco do diálogo). Grep por sessionUploadsRef: 0 ocorrências. src/hooks/useBanners.ts:453-459 apaga oldBanner.imageUrl sem checar se outro banner usa a mesma URL. Há 4 banners na tabela hoje.

**Critério de aceite:**

- [ ] A limpeza de arquivos órfãos só apaga URLs que foram enviadas NESTA sessão do formulário (ref de uploads da sessão), nunca por comparação com editingBanner.
- [ ] Duplicar um banner e cancelar não apaga nenhum arquivo do storage; a imagem do original continua acessível.
- [ ] Esc dentro do editor de imagem fecha apenas o editor, e o formulário permanece aberto com a imagem intacta.
- [ ] O gesto de voltar no mobile tem o mesmo comportamento do Esc.
- [ ] deleteBanner e updateBanner não apagam URL que ainda esteja referenciada por outro banner.
- [ ] O .catch(() =&gt; {}) da exclusão passa a registrar o erro em vez de engolir.

**Arquivos envolvidos:** `src/views/admin/AdminBannersView.tsx`, `src/hooks/useBanners.ts`
**Depende de:** nada
**Bom pra quem está chegando:** não — o arquivo tem 5.385 linhas num único componente, três pontos de limpeza concorrentes e um handler de teclado global; achar todos os caminhos exige tempo de leitura que um dev recém-chegado não tem.

### [ADMIN-040] Sincronizar o cache de módulo de banners e parar de mutar o state no reorder

**Tipo:** bug
**Prioridade:** P2
**Tamanho:** M
**Épico:** Painel administrativo que não mente
**Risco de mexer:** médio — o hook tem cache de módulo, throttle de 60 s, DataVault e state React, todos com fontes de verdade próprias. Sincronizar errado faz a Home mostrar banner fantasma.

**Contexto:** Dois defeitos do mesmo hook. O cache de módulo globalBannersCache só é escrito no fetch de rede e no load inicial do IndexedDB — criar, editar, excluir ou reordenar atualiza apenas o state local e o DataVault; como toda nova instância do hook inicializa a partir desse cache e já marca isLoaded=true, uma tela montada dentro dos 60 s de throttle recebe a lista desatualizada e nem consulta o IndexedDB, que tem o dado certo. E na normalização de colisão de ordem, `b.order = idx + 1` muta diretamente os objetos do state React (mutação fora do React, sem re-render), e o snapshot de rollback é tirado DEPOIS disso e é cópia rasa — se a RPC falhar, o rollback não desfaz nada e a ordem gravada no DataVault fica divergente do banco.

**Evidência:** Achados #54 e #55. src/hooks/useBanners.ts:69-76 (persistToVault só grava no DataVault), :125 e :207 (as únicas escritas de globalBannersCache), :64-65 (state inicializa do cache com isLoaded=true), :122 (efeito de mount só lê o vault quando !globalBannersCache), :236 (throttle de 60 s), :518 (`b.order = idx + 1;`), :531 (`const previousBanners = [...banners];` depois do bloco de colisão), :525-527 (catch só com console.error, sem checar o .error que o supabase-js resolve em vez de rejeitar).

**Critério de aceite:**

- [ ] globalBannersCache é atualizado dentro de persistToVault, então toda mutação o reflete.
- [ ] lastBannersFetchTime é zerado após mutação, para o throttle não servir dado velho.
- [ ] Criar um banner e navegar para a Home dentro de 60 s mostra o banner novo; excluir e navegar não mostra o excluído.
- [ ] A normalização de ordem não muta objetos do state: cria novos objetos.
- [ ] O snapshot de rollback é tirado ANTES de qualquer normalização e é cópia profunda o suficiente para restaurar order.
- [ ] O erro dos updates é detectado (checar o .error do supabase-js, não só try/catch) e o rollback restaura a ordem anterior na tela e no DataVault.

**Arquivos envolvidos:** `src/hooks/useBanners.ts`, `src/views/admin/AdminBannersView.tsx`, `src/lib/dataVault.ts`
**Depende de:** nada
**Bom pra quem está chegando:** não — fora das 7 tarefas de entrada escolhidas; ver "Por onde o Netim começa" no topo

### [ADMIN-050] Usar null em vez de undefined nos campos que o admin precisa poder zerar

**Tipo:** bug
**Prioridade:** P2
**Tamanho:** M
**Épico:** Painel administrativo que não mente
**Risco de mexer:** médio — trocar undefined por null muda o que chega no UPDATE de produtos e de cupons; se aplicar em campo errado, zera dado que o admin não pediu para zerar.

**Contexto:** Mesma causa-raiz em dois formulários: JSON.stringify descarta chave undefined, e os hooks aplicam campo com a guarda `!== undefined`. Resultado: desmarcar 'Produto em Promoção' nunca remove preco_original do banco (o cliente continua vendo o preço riscado e a etiqueta de desconto, e ao reabrir o formulário a promoção volta marcada); e limpar a Validade de um cupom não remove valid_until (o selo 'Expira em' reaparece e depois da data o cupom para de funcionar no checkout). Nos dois casos a UI confirma sucesso. Vale para SKU, preço de custo, min_purchase e usage_limit também.

**Evidência:** Achados #25 e #60. src/views/admin/AdminProductFormView.tsx:1068-1072 (costPrice e originalPrice montados como undefined) e :1081 (sku). src/hooks/useProducts.ts:636-639 e :658 (guarda `!== undefined`). src/hooks/useCoupons.ts:155-166 (payload literal com valid_until: updates.validUntil) e :170 (toast.success). src/views/admin/AdminCouponFormView.tsx:461 (setFormData com validUntil: undefined).

**Critério de aceite:**

- [ ] Desmarcar 'Produto em Promoção' e salvar deixa preco_original NULL no banco; a etiqueta de desconto some da vitrine e o formulário reabre sem promoção.
- [ ] Limpar SKU e limpar preço de custo também persistem como NULL.
- [ ] Limpar a Validade de um cupom deixa valid_until NULL; o selo 'Expira em' some e o cupom volta a valer no checkout.
- [ ] O mesmo vale para min_purchase e usage_limit.
- [ ] Salvar sem tocar nesses campos NÃO os zera — a distinção entre 'não mexi' e 'quero limpar' é preservada.

**Arquivos envolvidos:** `src/views/admin/AdminProductFormView.tsx`, `src/hooks/useProducts.ts`, `src/hooks/useCoupons.ts`, `src/views/admin/AdminCouponFormView.tsx`
**Depende de:** nada
**Bom pra quem está chegando:** não — fora das 7 tarefas de entrada escolhidas; ver "Por onde o Netim começa" no topo

### [CUPOM-010] Gravar a validade do cupom como fim do dia no fuso local, não meia-noite UTC

**Tipo:** bug
**Prioridade:** P2
**Tamanho:** P
**Épico:** Painel administrativo que não mente
**Risco de mexer:** baixo — nenhum cupom tem validade cadastrada hoje, então não há dado a migrar; a mudança é no onChange e no value do campo.

**Contexto:** O campo de validade grava new Date('AAAA-MM-DD').toISOString(), que é meia-noite UTC. Como o banco compara valid_until &lt; NOW() em UTC, um cupom 'válido até 15/08' para de funcionar às 21h de 14/08 no horário de Brasília — e a listagem, que formata em fuso local, imprime 14/08 enquanto o formulário mostra 15/08. Todo cupom datado criado a partir de agora nasce errado.

**Evidência:** Achado #26. src/views/admin/AdminCouponFormView.tsx:459-471 (onChange faz new Date(e.target.value) e grava d.toISOString()) e :451-457 (value usa d.toISOString().split('T')&#91;0]). No banco: coupons.valid_until é timestamp with time zone e `show timezone` = UTC. SELECT em coupons WHERE valid_until IS NOT NULL devolveu 0 linhas em 30/07/2026 — não há backfill a fazer.

**Critério de aceite:**

- [ ] A validade é montada como fim do dia no fuso local a partir dos componentes de data, não por new Date(string).
- [ ] O value do input é formatado a partir das partes locais da data, não de toISOString().
- [ ] Cadastrar 'válido até 15/08' e conferir: o cupom ainda funciona às 22h de 15/08 no horário de Brasília.
- [ ] A data mostrada na listagem é a mesma mostrada no formulário.
- [ ] Nenhum backfill é necessário (conferir que continua havendo 0 cupons com valid_until).

**Arquivos envolvidos:** `src/views/admin/AdminCouponFormView.tsx`, `src/hooks/useCoupons.ts`
**Depende de:** nada
**Bom pra quem está chegando:** não — fora das 7 tarefas de entrada escolhidas; ver "Por onde o Netim começa" no topo

### [ADMIN-060] Corrigir o ciclo de vida do formulário de produto: duplo clique e rascunho perdido

**Tipo:** bug
**Prioridade:** P2
**Tamanho:** M
**Épico:** Painel administrativo que não mente
**Risco de mexer:** médio — o arquivo tem 3.219 linhas e o auto-save escreve no localStorage a cada segundo; mexer no efeito errado pode fazer o rascunho sobrescrever o formulário aberto.

**Contexto:** Dois defeitos do mesmo formulário. Depois de salvar com sucesso, o botão é liberado 1,5 segundo antes de navegar: nessa janela ele mostra 'Salvo' mas continua clicável, e a única guarda de reentrada é `if (isSubmitting) return` — um segundo clique cria um produto duplicado, sem idempotência no backend. E ao ABRIR um produto para edição, formData e initialData ficam idênticos, o efeito de auto-save considera o formulário limpo e apaga a chave do rascunho 1 segundo depois — enquanto o toast 'Rascunho não salvo encontrado' ainda promete restauração por 10 segundos. Se o admin não clicar naquele instante, o rascunho está perdido: exatamente o cenário que o recurso deveria proteger.

**Evidência:** Achados #57 e #59. src/views/admin/AdminProductFormView.tsx:990 (`if (isSubmitting) return;` sem showSuccess), :1139 (setIsSubmitting(false) antes do setTimeout de :1147-1150), :1742-1744 (disabled sem showSuccess), :774-784 (efeito de auto-save com `else { localStorage.removeItem(draftKey); }` incondicional), :648-660 (toast com ação Restaurar, duration 10000) e :672 (setDraftChecked(true) logo após montar o toast). Grep por draftResolvedRef e successTimerRef: 0 ocorrências.

**Critério de aceite:**

- [ ] O disabled do botão inclui showSuccess, e a guarda de reentrada do handleSubmit também.
- [ ] Clicar duas vezes rápido em Publicar cria UM produto (conferido na listagem e no banco).
- [ ] O setTimeout de navegação é guardado em ref e cancelado no unmount.
- [ ] O rascunho só é removido do localStorage após decisão explícita do usuário (restaurar ou descartar), nunca pelo auto-save ao abrir.
- [ ] Abrir um produto com rascunho pendente, esperar 30 segundos e recarregar: o rascunho ainda está lá e o toast reaparece.

**Arquivos envolvidos:** `src/views/admin/AdminProductFormView.tsx`, `src/hooks/useProducts.ts`
**Depende de:** nada
**Bom pra quem está chegando:** não — fora das 7 tarefas de entrada escolhidas; ver "Por onde o Netim começa" no topo

### [ADMIN-070] Inverter as fases do deleteProduct: soft-delete no banco antes de mover a mídia

**Tipo:** bug
**Prioridade:** P2
**Tamanho:** M
**Épico:** Painel administrativo que não mente
**Risco de mexer:** médio — o rollback atual restaura state e cache mas não desfaz os moves no Storage; inverter as fases resolve, mas exige cuidado para não deixar arquivo órfão no caminho de sucesso.

**Contexto:** Em deleteProduct, os arquivos do Storage são movidos para backup/ ANTES do soft-delete no banco. Se o UPDATE em produtos falhar, o rollback recoloca o produto na listagem e na vitrine, mas as URLs em imagem_urls apontam para caminhos que não existem mais: todas as fotos ficam quebradas para admin e clientes, e o toast só diz 'Erro ao excluir produto'. Além disso, produto sem imagens grava imagem_urls: [] e imagem_url: null sem necessidade, e os dois laços são N+1 sequenciais.

**Evidência:** Achado #58. src/hooks/useProducts.ts:741-762 (laço sequencial de backupStorageFile das imagens e depois das variantes, com o error do update de product_variants descartado em :756-759), :764-772 (o UPDATE em produtos só vem depois) e :774 (`if (error) throw error`). O catch de rollback em :780-787 restaura state e cache mas não desfaz os moves.

**Critério de aceite:**

- [ ] O soft-delete no banco acontece primeiro; a movimentação de mídia só roda depois, em try/catch próprio.
- [ ] Falha na fase de mídia não reverte o soft-delete nem quebra as imagens do produto restaurado.
- [ ] Produto sem imagens não tem imagem_urls zerado desnecessariamente (guard de array vazio).
- [ ] Os dois laços de backup viram Promise.all em vez de await sequencial.
- [ ] O erro do update de product_variants deixa de ser descartado.

**Arquivos envolvidos:** `src/hooks/useProducts.ts`, `src/views/admin/AdminProductsView.tsx`
**Depende de:** nada
**Bom pra quem está chegando:** não — fora das 7 tarefas de entrada escolhidas; ver "Por onde o Netim começa" no topo

### [ADMIN-080] Fazer o modal de Perguntas e Respostas editar a resposta em vez de criar uma segunda

**Tipo:** bug
**Prioridade:** P2
**Tamanho:** M
**Épico:** Painel administrativo que não mente
**Risco de mexer:** médio — exige migration na RPC e possivelmente índice único em answers(question_id); se já existirem duplicatas em produção, o índice falha na criação.

**Contexto:** O modal se comporta como editor: vem pré-preenchido com a resposta atual e avisa sobre alterações não salvas. Mas a RPC answer_question_atomic só sabe inserir. Cada 'edição' cria uma segunda linha em answers, e as duas aparecem empilhadas na página do produto e no perfil do cliente. Não existe UI para apagar resposta, então a duplicata é permanente e só sai por SQL manual.

**Evidência:** Achado #31. Corpo vivo de public.answer_question_atomic(uuid,text) lido com pg_get_functiondef em 30/07/2026: só INSERT INTO answers, sem caminho de UPDATE; a sobrecarga de 3 args também só insere. Não há índice único em answers(question_id) — os índices são answers_pkey, idx_answers_question_id, idx_answers_user_id. Front: src/views/admin/AdminQAView.tsx:212-223 (pré-preenche com answers[0].answer) e :299-305 (chama addAnswer); src/hooks/useQuestions.ts:279-285. Consumidores: src/components/ui/custom/ProductQA.tsx:269 e src/views/customer/UserProfileView.tsx:549.

**Critério de aceite:**

- [ ] A RPC passa a fazer upsert por question_id, ou existe um caminho explícito de update chamado quando já há resposta.
- [ ] Responder e depois editar deixa UMA linha em answers para aquela pergunta.
- [ ] A página do produto mostra uma única resposta, a mais recente.
- [ ] Antes de criar o índice único, foi conferido se já há duplicatas em produção e definido o que fazer com elas.
- [ ] O admin consegue remover uma resposta pela UI, ou está registrado que isso fica fora do escopo.

**Arquivos envolvidos:** `src/views/admin/AdminQAView.tsx`, `src/hooks/useQuestions.ts`, `supabase/migrations/ (arquivo novo)`, `src/components/ui/custom/ProductQA.tsx`
**Depende de:** nada
**Bom pra quem está chegando:** não — fora das 7 tarefas de entrada escolhidas; ver "Por onde o Netim começa" no topo

### [ADMIN-090] Fazer o interruptor de Avaliações desligar as avaliações de verdade

**Tipo:** bug
**Prioridade:** P2
**Tamanho:** M
**Épico:** Painel administrativo que não mente
**Risco de mexer:** médio — envolve gate na vitrine, no JSON-LD e na policy de INSERT; desligar demais tira as avaliações de quem tem o recurso ligado.

**Contexto:** O admin tem um interruptor 'Avaliações dos Clientes' que muda o pill para Inativo e mostra toast de sucesso, mas nenhuma tela do cliente lê o flag. A página do produto continua exibindo nota, distribuição e comentários; o JSON-LD continua publicando aggregateRating para os buscadores; e o cliente continua conseguindo avaliar pela tela do pedido entregue. É um controle puramente cosmético: quem desliga acha que escondeu as avaliações e não escondeu nada.

**Evidência:** Achado #66. Grep por enableReviews em src/ retorna somente src/views/admin/AdminReviewsView.tsx (99, 620, 630, 646, 649, 674), src/contexts/StoreContext.tsx (26, 223-226, 308, 460-461) e src/lib/realtimeSyncEngine.ts:103 — nenhuma view de cliente. src/views/customer/ProductView.tsx:839, :1088 (aba Avaliações no array fixo), :1158-1161 (seção sem gate) e :675 (spread de aggregateRating só condicionado a reviewCount &gt; 0), com config disponível em :258 e não usado. src/views/customer/OrderDetailsView.tsx:408-428 (gate só por status delivered). No banco, reviews_insert_policy não verifica enable_reviews.

**Critério de aceite:**

- [ ] Com o flag desligado, a página do produto não mostra nota, distribuição, aba nem lista de avaliações.
- [ ] Com o flag desligado, o JSON-LD não inclui aggregateRating.
- [ ] Com o flag desligado, a tela de pedido entregue não oferece avaliar.
- [ ] Com o flag ligado, tudo volta a funcionar exatamente como hoje.
- [ ] Está registrado se a policy de INSERT também passa a checar o flag no servidor, ou se o gate fica só na UI (e por quê).

**Arquivos envolvidos:** `src/views/customer/ProductView.tsx`, `src/views/customer/OrderDetailsView.tsx`, `src/views/admin/AdminReviewsView.tsx`, `src/contexts/StoreContext.tsx`, `src/hooks/useReviews.ts`
**Depende de:** nada
**Bom pra quem está chegando:** não — fora das 7 tarefas de entrada escolhidas; ver "Por onde o Netim começa" no topo

### [ADMIN-100] Resolver a disputa pela classe dark entre o App e o StoreContext

**Tipo:** bug
**Prioridade:** P2
**Tamanho:** P
**Épico:** Painel administrativo que não mente
**Risco de mexer:** baixo — são dois efeitos pequenos; a classe admin-mode que serve de alternativa já existe no AdminLayout.

**Contexto:** Dois efeitos disputam a classe 'dark' no elemento html: o App adiciona quando a view começa com 'admin', e o StoreContext remove sempre que primaryColor ou themeMode mudam, além de no carregamento do cache do vault. Como as deps do efeito do App não mudam nesse momento, o painel admin — desenhado para fundo escuro — vira tema claro no meio da sessão, com texto branco sobre branco, até o admin navegar para outra tela. Acontece ao salvar a cor primária e ao abrir o painel direto pela URL.

**Evidência:** Achado #70. src/App.tsx:542-560 (sem else final; deps [currentView, config?.themeMode] em :560). src/contexts/StoreContext.tsx:97-105 (classList.remove('dark') no ramo else do loadFromVault) e :167-180 com deps [config.primaryColor, config.themeMode, applyBranding] em :180 — mudar só a cor primária dispara o remove sem o efeito do App re-executar. A classe admin-mode existe em src/components/layouts/AdminLayout.tsx:60-62.

**Critério de aceite:**

- [ ] Existe um único dono da classe dark no elemento html, ou o modo admin usa um seletor próprio que o StoreContext não pode desfazer.
- [ ] Salvar a cor primária no admin não muda o tema da tela.
- [ ] Abrir a rota do painel direto pela URL entra já em tema escuro e permanece.
- [ ] Sair do admin para a loja volta ao tema configurado pelo lojista.
- [ ] Trocar themeMode na loja continua funcionando nos três valores (light, dark, glass).

**Arquivos envolvidos:** `src/App.tsx`, `src/contexts/StoreContext.tsx`, `src/components/layouts/AdminLayout.tsx`, `src/index.css`
**Depende de:** nada
**Bom pra quem está chegando:** não — fora das 7 tarefas de entrada escolhidas; ver "Por onde o Netim começa" no topo

### [ADMIN-110] Distinguir falha de consulta de ausência de dados no dashboard de faturamento

**Tipo:** bug
**Prioridade:** P2
**Tamanho:** M
**Épico:** Painel administrativo que não mente
**Risco de mexer:** baixo — acrescenta estado de erro e um ramo visual; não muda cálculo nenhum, exceto pela base do total, que precisa ser decidida com cuidado.

**Contexto:** Dois problemas na mesma tela. Quando a RPC de análise por categoria falha, o hook só loga no console e devolve null: o dashboard não mostra banner de falha nem botão de tentar de novo, e o bloco de Divisão de Faturamento cai no empty state 'Sem Dados Registrados'. O admin conclui que não houve vendas quando a chamada quebrou. E na mesma tela o card 'Volume Total' usa SUM(marketplace_orders.total), já líquido de desconto, enquanto o centro do donut soma as fatias de get_category_analytics, que é itens + frete sem subtrair desconto: com qualquer cupom concedido os dois números divergem, sem legenda explicando. Hoje há 0 pedidos com desconto, então a divergência aparece na primeira campanha de cupom.

**Evidência:** Achados #62 e #76. src/hooks/useAnalytics.ts:407-412 (catch de fetchCategoryAnalytics só com console.error + return null), :417-425 (o hook não expõe categoryError) e :351-378 (revalidação em background descarta o erro). src/components/admin/dashboard/StrategicIntelligenceBlocks.tsx:324 (empty state) e :221-225 (soma de visibleCategoryData exibida como Total em :81). Corpo vivo de get_category_analytics: SUM(oi.price * oi.quantity) com INNER JOIN em produtos, mais a linha 'Frete' com SUM(o.shipping), sem subtrair desconto. src/components/admin/dashboard/KpiSummaryCards.tsx:24-26 usa stats.executive.totalRevenue.

**Critério de aceite:**

- [ ] O hook expõe um estado de erro próprio para a análise por categoria, propagado até o bloco visual.
- [ ] Falha na RPC mostra banner de erro com botão de tentar de novo, visualmente distinto do empty state.
- [ ] 'Sem Dados Registrados' só aparece quando a consulta teve sucesso e devolveu zero linhas.
- [ ] As duas bases (card Volume Total e centro do donut) passam a bater, ou a diferença está explicitada na UI com legenda.
- [ ] Com um pedido de teste com desconto, os dois números são consistentes ou a diferença está rotulada.

**Arquivos envolvidos:** `src/hooks/useAnalytics.ts`, `src/components/admin/dashboard/StrategicIntelligenceBlocks.tsx`, `src/components/admin/dashboard/KpiSummaryCards.tsx`, `src/views/admin/AdminDashboardView.tsx`
**Depende de:** [BANCO-020]
**Bom pra quem está chegando:** não — fora das 7 tarefas de entrada escolhidas; ver "Por onde o Netim começa" no topo

---

## Épico: Pós-venda e comunicação com o cliente

### [PEDIDO-060] Mostrar o código de rastreio para o cliente

**Tipo:** feature
**Prioridade:** P1
**Tamanho:** P
**Épico:** Pós-venda e comunicação com o cliente
**Risco de mexer:** baixo — é leitura de um campo que já chega mapeado até o objeto Order; nenhuma escrita, nenhuma migration.

**Contexto:** O rastreio existe só na metade do lojista: o admin digita o código à mão e monta um link para linkrastreio.com. O campo viaja do banco até o objeto Order no front, mas nenhuma tela do cliente o renderiza — quem comprou não vê o código em lugar nenhum e precisa pedir por WhatsApp.

**Evidência:** Conferido agora: grep por trackingCode|tracking_code em src/views/customer/ retorna ZERO ocorrências. O campo chega ao objeto: src/lib/mappers.ts:234 e src/hooks/useOrders.ts:343. Lado admin completo em src/components/admin/orders/OrderDetail.tsx:558-664 (bloco 'Logistica & Rastreio'), :634 (link linkrastreio.com) e :975 (update do tracking_code).

**Critério de aceite:**

- [ ] Com um pedido que tem tracking_code preenchido, o código aparece na tela de detalhe do pedido do cliente
- [ ] Existe botão de copiar o código e link para o rastreio externo
- [ ] Pedido sem tracking_code não mostra bloco vazio nem 'undefined'
- [ ] O mesmo código aparece na listagem de pedidos ou na tela de rastreio de convidado (definir qual e cumprir)

**Arquivos envolvidos:** `src/views/customer/OrderDetailsView.tsx`, `src/lib/mappers.ts`, `src/hooks/useOrders.ts`, `src/components/admin/orders/OrderDetail.tsx`
**Depende de:** nada
**Bom pra quem está chegando:** sim — Atravessa a fatia de dados inteira numa tacada fina: coluna no banco, mapper, hook de pedidos e tela do cliente. Ensina por que o front tem uma camada de mappers traduzindo o formato do banco para o formato do app, e entrega valor visível ao comprador já no primeiro PR.

### [PEDIDO-070] Enviar e-mail de confirmação de pedido para o cliente

**Tipo:** feature
**Prioridade:** P1
**Tamanho:** M
**Épico:** Pós-venda e comunicação com o cliente
**Risco de mexer:** médio — cria uma edge function nova e usa segredo de terceiro (Resend). Se for disparada de dentro do fluxo de pedido, precisa ser fire-and-forget para não derrubar o checkout.

**Contexto:** O cliente sai do checkout sem receber um único e-mail. Não há comprovante fora do app, e quem comprou como convidado depende de lembrar de voltar ao site e pedir código OTP. O Resend já está em uso no projeto, só que exclusivamente para o OTP de consulta de pedido.

**Evidência:** Resend só é chamado em supabase/functions/send-otp-email/index.ts:59, e o payload exige record.otp_code (:49-52). Não existe sendgrid|nodemailer|smtp|mailgun|postmark em src/ nem supabase/. Só há 3 edge functions no repo e nenhuma envia e-mail de pedido.

**Critério de aceite:**

- [ ] Fechar um pedido de teste com e-mail válido resulta em e-mail recebido em até 2 minutos
- [ ] O e-mail contém número do pedido, itens, valor total, forma de pagamento e endereço de entrega
- [ ] Falha no envio não impede a criação do pedido e fica registrada em log
- [ ] Convidado (sem conta) também recebe

**Arquivos envolvidos:** `supabase/functions/send-otp-email/index.ts`, `src/hooks/useOrders.ts`, `src/views/customer/CheckoutView.tsx`, `email_template.html`
**Depende de:** [DOC-030]
**Bom pra quem está chegando:** não — fora das 7 tarefas de entrada escolhidas; ver "Por onde o Netim começa" no topo

### [PEDIDO-110] Gravar mudança de status do pedido na tabela notificacoes

**Tipo:** feature
**Prioridade:** P2
**Tamanho:** M
**Épico:** Pós-venda e comunicação com o cliente
**Risco de mexer:** médio — mexe em RLS/policies de notificacoes e no caminho de update de status do admin.

**Contexto:** Quando o admin muda o status de um pedido, o único aviso é um Web Push disparado na hora. Quem não deu permissão de push, ou abriu o app depois, não vê nada: a tela de notificações do app lê somente a tabela 'notificacoes', e o único INSERT nessa tabela vem do envio manual de campanha do admin.

**Evidência:** src/views/admin/AdminOrdersView.tsx:443-465 invoca send-push no updateOrderStatus e não insere em notificacoes. Os únicos INSERT em 'notificacoes' estão em src/views/admin/AdminPushView.tsx:338, :346 e :368 (campanha manual). src/contexts/NotificationContext.tsx:33 lê apenas a tabela 'notificacoes'.

**Critério de aceite:**

- [ ] Mudar o status de um pedido cria uma linha em notificacoes com usuario_id do dono do pedido
- [ ] A notificação aparece na tela de notificações do cliente mesmo com push negado
- [ ] Pedido de convidado (user_id NULL) não gera linha órfã nem erro
- [ ] A notificação pode ser marcada como lida e a marcação persiste após recarregar

**Arquivos envolvidos:** `src/views/admin/AdminOrdersView.tsx`, `src/contexts/NotificationContext.tsx`, `src/hooks/useOrders.ts`
**Depende de:** nada
**Bom pra quem está chegando:** não — fora das 7 tarefas de entrada escolhidas; ver "Por onde o Netim começa" no topo

### [PEDIDO-120] Habilitar os status de devolução e estorno no ciclo do pedido

**Tipo:** feature
**Prioridade:** P2
**Tamanho:** M
**Épico:** Pós-venda e comunicação com o cliente
**Risco de mexer:** médio — altera a constraint de status de marketplace_orders, que é lida por RPCs e pelo front; qualquer valor novo precisa ser tratado em todas as telas que fazem switch em status.

**Contexto:** Não existe fluxo de devolução nem de troca: nem tabela, nem status, nem tela. Direito de arrependimento de 7 dias e troca por defeito são obrigatórios, e hoje isso é resolvido no WhatsApp sem registro nenhum. Há até uma inconsistência registrada: uma RPC filtra por um status que a constraint proíbe gravar.

**Evidência:** supabase/migrations/20260327000003_sync_order_status_constraint.sql:13-17 aceita apenas 'pending','processing','shipping','delivered','cancelled','new'. src/types/index.ts:110-115 tem o mesmo conjunto. supabase/migrations/20260630150000_restore_get_segmented_push_targets.sql:42 filtra `status NOT IN ('cancelled','returned')` — 'returned' não existe na constraint.

**Critério de aceite:**

- [ ] A constraint e o tipo OrderStatus aceitam os status definidos pela política escolhida
- [ ] O admin consegue mover um pedido entregue para devolvido, e o estoque volta
- [ ] Nenhuma tela do cliente ou do admin quebra ou mostra rótulo em branco no status novo
- [ ] A migration tem rollback escrito ao lado

**Arquivos envolvidos:** `supabase/migrations/`, `src/types/index.ts`, `src/views/admin/AdminOrdersView.tsx`, `src/views/customer/OrderDetailsView.tsx`
**Depende de:** [PEDIDO-130]
**Bom pra quem está chegando:** não — mexer em constraint de status de pedido exige mapear todos os consumidores antes

---

## Épico: Receber pagamento no site

### [CHECKOUT-010] Decidir: a loja vai cobrar dentro do site ou a cobrança continua acontecendo fora?

**Tipo:** decisao
**Prioridade:** P0
**Tamanho:** P
**Épico:** Receber pagamento no site
**Risco de mexer:** baixo — é uma conversa, não mexe em código. O risco está em NÃO decidir: todo o épico de pagamento fica parado.

**Contexto:** Hoje o checkout não cobra nada. O 'metodo de pagamento' é só um rótulo de texto gravado no pedido, e a tela de sucesso com confete aparece no instante em que a linha do pedido é gravada. Pior: o estoque é decrementado na criação do pedido mesmo sem ninguém ter pago. Nada nesta área pode ser planejado antes desta resposta.

**Evidência:** Nenhum gateway no projeto: busca por mercadopago|stripe|pagseguro|asaas|pagarme|cielo|getnet|iugu|paypal|payment_intent em src/, supabase/ e package.json não retorna nenhuma integração. src/types/index.ts:116 — `export type PaymentMethod = "pix" | "card" | "cash"`. src/views/customer/CheckoutView.tsx:214 (useState&lt;PaymentMethod&gt;("pix")), :876/:882/:888 (as três opções são botões de rótulo) e :426 (paymentMethod vai cru pro RPC). Só existem 3 edge functions: calculate-shipping, send-otp-email, send-push.

**Critério de aceite:**

- [ ] Gabriel responde por escrito uma das três: (a) integrar gateway X, (b) PIX estático com conferência manual, (c) continuar cobrando 100% fora do site
- [ ] Se a resposta for (a), o nome do gateway e quem tem a conta ficam registrados em docs/onboarding/
- [ ] Se a resposta for (b) ou (c), fica registrado quem confere o pagamento e em quanto tempo, e a decisão entra na doc como escolha consciente e não como lacuna

**Arquivos envolvidos:** `src/views/customer/CheckoutView.tsx`, `src/types/index.ts`, `docs/onboarding/01-VISAO-GERAL.md`
**Depende de:** nada
**Bom pra quem está chegando:** não — é decisão de negócio do dono, não tem código pra escrever

### [CHECKOUT-040] Registrar status de pagamento do pedido (pendente/pago/estornado) no admin

**Tipo:** feature
**Prioridade:** P1
**Tamanho:** M
**Épico:** Receber pagamento no site
**Risco de mexer:** médio — exige migration nova em marketplace_orders, e o ledger de migrations já está fora de sincronia (nunca rodar supabase db push aqui). A coluna em si é aditiva e não quebra leitura existente.

**Contexto:** Hoje não existe nenhum registro de se o pedido foi pago. A tabela marketplace_orders tem status de fulfillment (pending/processing/shipping/delivered/cancelled) e nada sobre dinheiro. O lojista não tem como conciliar o que recebeu, e o estoque é baixado na criação do pedido, independentemente de pagamento. Esta task vale com ou sem gateway: se um gateway entrar depois, ele passa a escrever nessa mesma coluna.

**Evidência:** Colunas vivas de marketplace_orders (levantamento do banco): id, customer_name, customer_data, status, total, subtotal, shipping, discount, payment_method, coupon_code, notes, created_at, updated_at, user_id, tracking_code, address_id, coupon_id, customer_phone, total_amount, shipping_cost, observation — nenhuma coluna de status de pagamento, id de transação ou valor pago. src/views/customer/CheckoutView.tsx:426 manda apenas o rótulo paymentMethod.

**Critério de aceite:**

- [ ] Existe coluna de status de pagamento em marketplace_orders com default 'pendente'
- [ ] O admin consegue marcar um pedido como pago e como estornado, e a mudança persiste após recarregar
- [ ] A lista de pedidos do admin permite filtrar por pagos e não pagos
- [ ] A migration está escrita como arquivo em supabase/migrations/ com rollback ao lado e foi aplicada pelo caminho combinado (não por supabase db push)

**Arquivos envolvidos:** `supabase/migrations/`, `src/views/admin/AdminOrdersView.tsx`, `src/components/admin/orders/OrderDetail.tsx`, `src/lib/mappers.ts`, `src/types/index.ts`
**Depende de:** nada
**Bom pra quem está chegando:** não — a primeira migration de alguém neste repo não deveria ser numa tabela do caminho do checkout, com o ledger fora de sincronia

### [CHECKOUT-050] Gerar PIX copia-e-cola no checkout com a chave da loja

**Tipo:** feature
**Prioridade:** P2
**Tamanho:** M
**Épico:** Receber pagamento no site
**Risco de mexer:** médio — mexe na tela de sucesso do checkout, que hoje é o único ponto de contato pós-compra. Não movimenta dinheiro por conta própria: é só a geração do BR Code.

**Contexto:** Enquanto não houver gateway, o cliente escolhe 'PIX' e não recebe nada: nem chave, nem valor, nem QR. A conferência é 100% manual e fora do sistema. Um BR Code estático com valor e identificador do pedido já elimina a maior parte do atrito, sem integração bancária nenhuma.

**Evidência:** src/views/customer/CheckoutView.tsx:876 (opção 'pix' é só um botão de rótulo) e :446-458 (após createOrder o app só limpa o carrinho, mostra sucesso e dispara confetti). Nenhum gateway no projeto (ver task de decisão de pagamento).

**Critério de aceite:**

- [ ] Escolhendo PIX, a tela de sucesso mostra o código copia-e-cola e o QR com o valor exato do pedido
- [ ] O identificador do pedido viaja no campo apropriado do BR Code, de forma que o lojista consegue conciliar o recebimento com o pedido
- [ ] O código gerado é aceito por pelo menos dois bancos diferentes num teste real de leitura
- [ ] A chave PIX vem da configuração da loja, não está cravada no código

**Arquivos envolvidos:** `src/views/customer/CheckoutView.tsx`, `src/contexts/StoreContext.tsx`, `src/views/admin/AdminSettingsView.tsx`
**Depende de:** [CHECKOUT-010]
**Bom pra quem está chegando:** não — fora das 7 tarefas de entrada escolhidas; ver "Por onde o Netim começa" no topo

---

## Épico: Reconciliação banco x repositório

### [BANCO-030] Decidir a estratégia de reconciliação do ledger de migrations

**Tipo:** decisao
**Prioridade:** P1
**Tamanho:** M
**Épico:** Reconciliação banco x repositório
**Risco de mexer:** alto — é o item de maior raio de explosão do projeto. Um `supabase db push` hoje aborta no meio, depois de 25 arquivos já terem desmontado boa parte do RLS, e sem chegar nas migrations que o reconstroem.

**Contexto:** O ledger tem 121 linhas e o disco tem 134 versões distintas: 93 casadas, 41 versões locais sem ledger e 28 versões no ledger sem arquivo. E a lista de pendentes NÃO é fila de deploy: 24 pares função/arquivo pendente têm corpo idêntico ao que já está vivo no banco, o que prova que boa parte já foi aplicada sob outro timestamp. O banco está à frente e o front está codificado contra ele, não contra os arquivos. Recriar o banco a partir das migrations do repo produziria um schema que o app atual não consegue usar. Ninguém toca nisso sem o Gabriel escolher a estratégia.

**Evidência:** Seção 'migrations_pendentes_risco' e 'divergencias' do relatório de banco. Bloqueador: supabase/migrations/20260708150000_database_deep_cleanup_and_optimization.sql:113-116 faz CREATE OR REPLACE de generate_order_otp_v1 RETURNS TEXT enquanto a função viva RETURNS boolean, e não há DROP antes — o Postgres levanta 'cannot change return type'. As 25 que rodariam antes somam 190 DROP POLICY contra 127 CREATE POLICY e 96 REVOKE, contra 71 policies vivas. Regressões específicas: 20260703080000 (is_admin muda a fonte da verdade de JWT para profiles.role, com 57 policies dependentes), 20260708080000 e 20260712230000 (reintroduzem o upsert_store_config que apaga a config da loja), 20260708190000 (reverte a URL do OTP para o projeto principal).

**Critério de aceite:**

- [ ] Está escrita a estratégia escolhida: squash a partir do estado vivo, reparo do ledger versão a versão, ou congelamento com dump versionado.
- [ ] Está escrito o que acontece com as 41 versões locais sem ledger — quais são arquivadas, quais são aplicadas e quais são reescritas.
- [ ] O arquivo bloqueador (20260708150000) tem destino definido: corrigido com DROP antes do CREATE, ou arquivado.
- [ ] As quatro regressões nomeadas (is_admin, upsert_store_config x2, URL do OTP) têm destino definido individualmente.
- [ ] Existe uma forma verificável de saber, a partir do repositório, qual é o estado real do banco — hoje não existe.
- [ ] A regra de nunca rodar `supabase db push` continua valendo até a estratégia estar executada.

**Arquivos envolvidos:** `supabase/migrations/20260708150000_database_deep_cleanup_and_optimization.sql`, `supabase/migrations/20260703080000_optimize_remaining_rls.sql`, `supabase/migrations/20260712230000_add_local_shipping_config.sql`, `supabase/migrations/20260708190000_secure_otp_flow.sql`, `scripts/db-apply.cjs`
**Depende de:** nada
**Bom pra quem está chegando:** não — exige histórico do projeto (por que o banco foi alterado fora das migrations) que só o Gabriel tem, e a decisão errada quebra produção sem caminho de volta.

### [BANCO-060] Versionar em migration os objetos que existem em produção e não no repositório

**Tipo:** divida tecnica
**Prioridade:** P2
**Tamanho:** M
**Épico:** Reconciliação banco x repositório
**Risco de mexer:** médio — vw_produtos_public não é security_invoker e é o único caminho de leitura do catálogo do anônimo; um CREATE OR REPLACE VIEW descuidado expõe coluna que hoje não aparece, ou quebra a vitrine.

**Contexto:** Objetos críticos existem no banco de produção e não têm origem no histórico de migrations, então recriar o banco a partir do repositório produz um ambiente diferente do real — e a falha é silenciosa. A view vw_produtos_admin não existe em nenhuma das 137 migrations, mas cinco arquivos de código dependem dela em sete pontos. E o realtime de pedidos funciona hoje (confirmado por SELECT), mas foi habilitado pelo dashboard: nenhuma migration registra marketplace_orders, marketplace_order_items e notificacoes na publicação. Recriar sem isso deixa o canal em SUBSCRIBED sem nunca receber evento — o admin não vê pedido novo e ninguém descobre o motivo.

**Evidência:** Achado #44 e docs/onboarding/02-ARQUITETURA.md seção 6.4. Grep por vw_produtos_admin nas 137 migrations devolve zero; consumidores em src/contexts/StoreContext.tsx:388, src/hooks/useProducts.ts:228, :483, :669, src/hooks/useReviews.ts:314, src/components/admin/orders/OrderDetail.tsx:880 e src/views/admin/AdminUserDetailView.tsx:130, mais o tipo em src/types/database.types.ts:1445. Publicação: supabase/migrations/20260708020000_enable_realtime_for_monitored_tables.sql:5 lista 8 tabelas e não inclui marketplace_orders; SELECT em pg_publication_tables mostra 14 tabelas em produção, e pg_class.relreplident de marketplace_orders é 'f' (FULL).

**Critério de aceite:**

- [ ] Existe migration que cria vw_produtos_admin com a definição extraída do banco vivo (pg_get_viewdef), conferida coluna a coluna.
- [ ] A migration registra explicitamente se a view é security_invoker e se expõe custo — e a escolha está justificada.
- [ ] Existe migration com o ALTER PUBLICATION das três tabelas de pedido e o REPLICA IDENTITY FULL.
- [ ] A definição versionada de vw_produtos_public confere com a viva (nenhuma das três migrations pendentes que mexem nela altera o comportamento atual sem que isso esteja registrado).
- [ ] Existe uma forma de checar, sem rodar migration, se o banco vivo e a definição versionada divergiram.

**Arquivos envolvidos:** `supabase/migrations/ (arquivos novos)`, `supabase/migrations/20260708020000_enable_realtime_for_monitored_tables.sql`, `src/types/database.types.ts`, `docs/onboarding/02-ARQUITETURA.md`
**Depende de:** [BANCO-030]
**Bom pra quem está chegando:** não — mexer na view que serve o catálogo do anônimo, sem a definição versionada como referência, arrisca expor custo ou derrubar a vitrine.

### [BANCO-070] Revogar ou remover as RPCs órfãs que ninguém chama e que ainda têm EXECUTE

**Tipo:** divida tecnica
**Prioridade:** P2
**Tamanho:** M
**Épico:** Reconciliação banco x repositório
**Risco de mexer:** médio — remover função que alguma policy usa quebra RLS em cascata; a conferência tem que ser feita contra pg_policies antes de qualquer DROP.

**Contexto:** O banco tem um monte de função que ninguém chama e que continua com EXECUTE concedido. Duas são perigosas de verdade. A create_marketplace_order legada (v1, 7 args) grava em total_amount e shipping_cost, colunas diferentes das que a v23 usa: se alguém chamar, o pedido nasce com total NULL e aparece zerado no painel do admin sem nenhum erro — e ela continua com EXECUTE para anon e authenticated. E get_sales_analytics e get_retention_analytics têm sobrecargas genuinamente ambíguas (timestamp x timestamptz, 0 args x p_days com default) que dariam 300 Multiple Choices no PostgREST na primeira chamada. Quem for escrever a tela de analytics vai tropeçar sem entender por que.

**Evidência:** Seção 'rpcs' e 'divergencias' do relatório de banco. create_marketplace_order v1: 138 linhas, insere em total_amount e shipping_cost (linhas 98 e 102 do corpo vivo), zero call sites no front, EXECUTE para anon e authenticated. Sobrecargas ambíguas: get_sales_analytics (duas versões que diferem só por timestamp vs timestamptz) e get_retention_analytics (0 args RETURNS TABLE vs p_days DEFAULT 90 RETURNS numeric). Órfãs confirmadas sem call site: validate_coupon_secure v1, check_is_admin, get_admin_dashboard_stats, get_admin_dashboard_summary, get_admin_executive_summary, get_admin_list_paginated, get_customer_intelligence, get_inventory_health, get_product_optimization_data, get_product_stats, get_products_with_variants, get_category_sales, get_active_products_internal, check_stock_v1, decrement_stock. Nota: a auditoria por grep ingênuo de `.rpc(` subconta em mais da metade — o cruzamento correto achou 41 call sites e 30 nomes.

**Critério de aceite:**

- [ ] EXECUTE de anon e authenticated é revogado de create_marketplace_order (v1) e de create_marketplace_order_v22.
- [ ] O EXECUTE concedido a PUBLIC em create_marketplace_order_v23 (grantee vazio no proacl) é removido, mantendo anon e authenticated.
- [ ] As sobrecargas ambíguas de get_sales_analytics e get_retention_analytics são resolvidas: uma versão de cada, ou nomes distintos.
- [ ] Antes de qualquer DROP, foi conferido em pg_policies que nenhuma policy referencia a função.
- [ ] O checkout, o painel admin e o rastreio continuam funcionando (os 30 nomes que o front realmente usa estão listados e foram testados).

**Arquivos envolvidos:** `supabase/migrations/ (arquivo novo)`, `src/hooks/useOrders.ts`, `src/hooks/useAnalytics.ts`, `scripts/db-apply.cjs`
**Depende de:** [BANCO-030]
**Bom pra quem está chegando:** não — fora das 7 tarefas de entrada escolhidas; ver "Por onde o Netim começa" no topo

### [CUPOM-030] Devolver o uso do cupom quando o pedido é cancelado

**Tipo:** bug
**Prioridade:** P3
**Tamanho:** M
**Épico:** Reconciliação banco x repositório
**Risco de mexer:** médio — exige recriar update_order_status_atomic, que já tem outra correção pendente; as duas deveriam ir na mesma migration para não recriar a função duas vezes.

**Contexto:** Todo pedido com cupom incrementa coupons.usage_count na criação, mas o cancelamento só devolve estoque — o contador de uso nunca volta. Numa campanha com limite de uso, cancelamentos vão consumindo o limite até o cupom morrer sem ter vendido. Hoje não há nenhum pedido com cupom em produção, então é dívida latente e não incêndio; mas há 2 cupons cadastrados, um com limite de 50.

**Evidência:** Achado #69. Corpo vivo de update_order_status_atomic lido em 30/07/2026: declara só v_old_status, v_user_id, v_caller_id, v_is_admin, v_item, v_result; o SELECT FOR UPDATE traz apenas status e user_id; o bloco de cancelamento restaura estoque de produtos e variantes e não menciona coupon_id nem usage_count. Do outro lado, create_marketplace_order_v23 grava coupon_id e faz UPDATE coupons SET usage_count = usage_count + 1. marketplace_orders tem as colunas coupon_id, discount, shipping, subtotal e total. Medição: 0 pedidos com coupon_id preenchido e 0 cancelados com cupom.

**Critério de aceite:**

- [ ] A função passa a ler coupon_id do pedido e a decrementar usage_count no cancelamento, sem deixar o contador negativo.
- [ ] Criar pedido com cupom, cancelar e conferir: usage_count voltou ao valor anterior.
- [ ] Cancelar duas vezes o mesmo pedido não decrementa duas vezes.
- [ ] O contador foi reconciliado a partir dos pedidos não cancelados existentes (hoje isso é no-op, mas o passo está registrado).
- [ ] A correção vai na mesma migration da checagem de dono, para não recriar a função duas vezes.

**Arquivos envolvidos:** `supabase/migrations/ (arquivo novo)`, `supabase/migrations/20260707000000_fix_update_order_status_atomic.sql`, `src/hooks/useCoupons.ts`, `src/hooks/useOrders.ts`
**Depende de:** [PEDIDO-010]
**Bom pra quem está chegando:** não — fora das 7 tarefas de entrada escolhidas; ver "Por onde o Netim começa" no topo

---

## Épico: SEO e descoberta

### [SEO-010] Versionar o robots.txt e colocar as URLs de produto no sitemap

**Tipo:** feature
**Prioridade:** P2
**Tamanho:** P
**Épico:** SEO e descoberta
**Risco de mexer:** baixo — arquivos estáticos em public/; nenhum impacto em runtime da aplicação.

**Contexto:** O sitemap tem 4 URLs e nenhuma é de produto — os buscadores não têm como descobrir a vitrine. E o robots.txt existe no disco mas NÃO está versionado, então nunca chega ao build da Vercel: em produção o arquivo simplesmente não existe.

**Evidência:** Conferido agora: `git ls-files public/robots.txt` retorna 0 linhas (o arquivo está no disco, mas untracked). public/sitemap.xml tem exatamente 4 &lt;url&gt; (/, ?view=cart, ?view=favorites, ?view=orders), lastmod 2024-03-21, nenhuma de produto. public/robots.txt:4 usa caminho relativo `Sitemap: /sitemap.xml` em vez de URL absoluta.

**Critério de aceite:**

- [ ] public/robots.txt está versionado (git ls-files o encontra) e a diretiva Sitemap usa URL absoluta
- [ ] O sitemap inclui uma URL por produto ativo
- [ ] Existe um caminho definido e escrito para o sitemap não envelhecer (script de build ou passo manual documentado)
- [ ] Requisição HTTP a `https://ickous-marketplace.vercel.app/robots.txt` e /sitemap.xml depois do deploy devolve 200 com o conteúdo novo

**Arquivos envolvidos:** `public/robots.txt`, `public/sitemap.xml`, `vercel.json`, `package.json`
**Depende de:** nada
**Bom pra quem está chegando:** não — fora das 7 tarefas de entrada escolhidas; ver "Por onde o Netim começa" no topo

---

## Épico: Segurança e privacidade do cliente

### [AUTH-010] Exigir e-mail e WhatsApp juntos e amarrar o OTP de convidado a um pedido específico

**Tipo:** bug
**Prioridade:** P0
**Tamanho:** G
**Épico:** Segurança e privacidade do cliente
**Risco de mexer:** alto — reescreve as duas RPCs que o fluxo 'Rastrear sem Conta' usa, ambas com EXECUTE para anon. Errar a condição deixa o rastreio de convidado inacessível para todo mundo, e a tela não tem caminho alternativo.

**Contexto:** A tela de rastreio pede WhatsApp, e-mail e um ID de pedido marcado como opcional. A RPC casa os pedidos com OR entre WhatsApp e e-mail, o fragmento vazio vira ILIKE '%' (casa qualquer pedido) e o OTP é gravado com o e-mail que o próprio chamador digitou. Quem souber o WhatsApp de um cliente recebe na caixa dele o código que abre os pedidos da vítima: nome, e-mail, telefone, itens, totais e endereço completo. Não há limite de tentativas no código de 6 dígitos.

**Evidência:** Achados #2 e #35. Corpo vivo de generate_order_otp_v1 e get_orders_by_otp_v1 lido com pg_get_functiondef em 30/07/2026: OR entre canais, filtro `o.id::text ILIKE '%' || p_order_fragment` e INSERT em otp_verifications com o p_email recebido. A tabela otp_verifications não tem as colunas order_id nem attempts (information_schema). UI: src/components/ui/custom/OrderSearch.tsx:233 (placeholder 'ID DO PEDIDO (OPCIONAL)') e :76-80, que envia orderFragment.trim() vazio. Fonte no repo: supabase/migrations/20260708190000_secure_otp_flow.sql:33.

**Critério de aceite:**

- [ ] Nova migration recria generate_order_otp_v1 exigindo AND entre e-mail e WhatsApp, e rejeita fragmento de pedido com menos de 6 caracteres.
- [ ] Chamar generate_order_otp_v1 com o WhatsApp de um pedido real e um e-mail que não consta naquele pedido retorna falso e NÃO insere linha em otp_verifications (verificável via scripts/db-apply.cjs em transação com ROLLBACK).
- [ ] otp_verifications ganha order_id NOT NULL e attempts; get_orders_by_otp_v1 devolve somente o pedido daquele order_id, nunca a lista por e-mail.
- [ ] get_orders_by_otp_v1 invalida o código após 5 tentativas erradas, e o caminho de falha RETORNA um objeto de erro em vez de RAISE — no PostgREST cada RPC é uma transação, e o RAISE reverteria o incremento do contador.
- [ ] O campo de ID do pedido na UI deixa de dizer '(OPCIONAL)' e o submit fica bloqueado enquanto ele estiver vazio.
- [ ] Os GRANTs de EXECUTE para anon foram reconferidos em pg_proc.proacl depois do replace.

**Arquivos envolvidos:** `supabase/migrations/ (arquivo novo)`, `src/components/ui/custom/OrderSearch.tsx`, `src/hooks/useOrders.ts`, `scripts/db-apply.cjs`
**Depende de:** nada
**Bom pra quem está chegando:** não — exige entender a semântica transacional do PostgREST (RAISE reverte o contador de tentativas) e alterar RPC exposta a anon, com um fluxo de cliente que quebra em silêncio se a condição sair errada.

### [PEDIDO-010] Trocar != por IS DISTINCT FROM na checagem de dono de update_order_status_atomic

**Tipo:** bug
**Prioridade:** P0
**Tamanho:** M
**Épico:** Segurança e privacidade do cliente
**Risco de mexer:** médio — recriar a função obriga a repetir os GRANT/REVOKE; se esquecer, o cancelamento do cliente para de funcionar de imediato. A mudança em si é de uma linha.

**Contexto:** Pedido de convidado é gravado com user_id NULL. A checagem de dono usa '!=' e, em SQL, 'NULL != &lt;uuid&gt;' avalia para NULL — o IF nunca dispara e a exceção de autorização nunca acontece. Qualquer usuário logado que conheça o id de um pedido de convidado (ele aparece na tela de sucesso, no rastreio e em prints) consegue cancelar o pedido de outra pessoa. O cancelamento devolve o estoque, então a venda é desfeita de verdade.

**Evidência:** Achado #34. Corpo vivo de public.update_order_status_atomic(uuid,text,text,boolean) lido com pg_get_functiondef em 30/07/2026: 'IF v_user_id != v_caller_id AND NOT v_is_admin THEN RAISE EXCEPTION'. Idêntico a supabase/migrations/20260707000000_fix_update_order_status_atomic.sql:48. ACL: authenticated tem EXECUTE. create_marketplace_order_v23 insere v_user_id := auth.uid(), que é NULL para convidado.

**Critério de aceite:**

- [ ] Nova migration com CREATE OR REPLACE (não DROP) troca '!=' por 'IS DISTINCT FROM' e nega chamador cujo auth.uid() seja NULL.
- [ ] Usuário logado A, de posse do id de um pedido de convidado, recebe exceção de autorização ao chamar a RPC — comprovado em transação com ROLLBACK.
- [ ] Admin continua conseguindo mudar o status de pedido de convidado.
- [ ] Cliente dono continua conseguindo cancelar o próprio pedido em status pending.
- [ ] pg_proc.proacl da função conferido depois do replace é igual ao de antes.

**Arquivos envolvidos:** `supabase/migrations/ (arquivo novo)`, `supabase/migrations/20260707000000_fix_update_order_status_atomic.sql`, `src/hooks/useOrders.ts`, `scripts/db-apply.cjs`
**Depende de:** nada
**Bom pra quem está chegando:** não — fora das 7 tarefas de entrada escolhidas; ver "Por onde o Netim começa" no topo

### [BANCO-010] Parar de expor a coluna custo para qualquer usuário autenticado

**Tipo:** bug
**Prioridade:** P1
**Tamanho:** M
**Épico:** Segurança e privacidade do cliente
**Risco de mexer:** médio — a policy produtos_select_policy libera a LINHA inteira pelo ramo `ativo = true`; restringir errado tira o catálogo do ar ou tira o custo do admin, que precisa dele nas telas de produto e no ROI de estoque.

**Contexto:** Qualquer pessoa que crie conta na loja lê a margem de todos os produtos ativos com uma única chamada PostgREST. Foi medido, não inferido: com SET LOCAL ROLE authenticated, SELECT count(custo) FROM produtos WHERE ativo=true devolveu 18 de 18. O visitante anônimo NÃO vê, porque passa por vw_produtos_public, que não tem a coluna — ou seja, a proteção de hoje é por omissão de coluna numa view, não por regra.

**Evidência:** Estado do banco, seção divergências: 'custo continua legível por authenticated — confirmado com leitura real, e anon NÃO lê'. information_schema.column_privileges confirma SELECT em produtos.custo para authenticated. Policy produtos_select_policy: USING ((ativo = true) OR (auth.role()='authenticated' AND is_admin())), roles = PUBLIC.

**Critério de aceite:**

- [ ] Com SET LOCAL ROLE authenticated e um auth.uid() de cliente comum, SELECT custo FROM produtos falha ou devolve NULL para as 18 linhas ativas.
- [ ] O painel admin continua exibindo custo, margem e o bloco de ROI de estoque sem erro de permissão.
- [ ] A vitrine do visitante anônimo continua carregando os produtos normalmente.
- [ ] A mudança está numa migration versionada, não aplicada pelo dashboard.

**Arquivos envolvidos:** `supabase/migrations/ (arquivo novo)`, `src/hooks/useProducts.ts`, `src/contexts/StoreContext.tsx`, `src/types/database.types.ts`
**Depende de:** nada
**Bom pra quem está chegando:** não — fora das 7 tarefas de entrada escolhidas; ver "Por onde o Netim começa" no topo

### [BANCO-020] Adicionar guarda de is_admin em get_category_analytics

**Tipo:** bug
**Prioridade:** P1
**Tamanho:** P
**Épico:** Segurança e privacidade do cliente
**Risco de mexer:** baixo — CREATE OR REPLACE acrescentando o mesmo bloco de guarda que as outras RPCs administrativas já usam. Não mexe em schema nem em policy.

**Contexto:** A RPC roda como SECURITY DEFINER (ignora o RLS de marketplace_orders, marketplace_order_items e produtos) e não tem a checagem de admin que as irmãs têm. O EXECUTE está concedido a authenticated, então qualquer cliente cadastrado extrai faturamento consolidado por categoria, número de pedidos, ticket médio e total arrecadado em frete usando o mesmo cliente Supabase da loja.

**Evidência:** Achado #61. Verificado no banco vivo (pg_get_functiondef + proacl, 30/07/2026): prosecdef = true, corpo vai de BEGIN direto para RETURN QUERY sem nenhuma ocorrência de is_admin, ACL 'authenticated=X/postgres'. Fonte no disco: supabase/migrations/20260704170000_reconcile_category_analytics_frete.sql:10-19.

**Critério de aceite:**

- [ ] Nova migration usa CREATE OR REPLACE (não DROP, que obrigaria a refazer os GRANTs) e acrescenta IF NOT public.is_admin() THEN RAISE EXCEPTION.
- [ ] Chamada com sessão de cliente comum retorna erro de permissão.
- [ ] O bloco 'Divisão de Faturamento' do dashboard continua carregando para o admin.
- [ ] O ACL da função em pg_proc.proacl é o mesmo antes e depois.

**Arquivos envolvidos:** `supabase/migrations/ (arquivo novo)`, `supabase/migrations/20260704170000_reconcile_category_analytics_frete.sql`, `src/hooks/useAnalytics.ts`
**Depende de:** nada
**Bom pra quem está chegando:** sim — É a porta de entrada para o padrão de RPC SECURITY DEFINER com guarda de is_admin(), que sustenta boa parte do backend, e obriga a escrever e aplicar uma migration num projeto cujo ledger está fora de sincronia. Fecha um vazamento real: hoje qualquer cliente cadastrado extrai o faturamento consolidado da loja.

### [AUTH-030] Fechar a enumeração de e-mails cadastrados na recuperação de senha

**Tipo:** bug
**Prioridade:** P2
**Tamanho:** M
**Épico:** Segurança e privacidade do cliente
**Risco de mexer:** médio — a revogação no banco e a mudança na UI têm que ir no MESMO deploy. Revogar sem ajustar o AuthView deixa a tela de recuperar senha quebrada com erro de permissão.

**Contexto:** check_user_confirmation_status é SECURITY DEFINER, consulta auth.users por e-mail e tem EXECUTE para anon e authenticated, sem rate limit. Dá pra jogar uma lista de e-mails no endpoint REST e descobrir quem tem conta e quem confirmou. A própria tela de 'Recuperar senha' confirma isso em texto para o visitante.

**Evidência:** Achado #39. pg_proc.proacl lido em 30/07/2026: postgres=X, anon=X, authenticated=X, service_role=X. GRANT de origem em supabase/migrations/20260628100000_add_user_confirmation_check.sql:30-31, sem revogação posterior. Consumo no front: src/contexts/AuthContext.tsx:566-571 (chamada), :592-599 (status 'not_found' com a mensagem 'Este e-mail não está cadastrado...'), :601-624 ('unconfirmed'), e o union type em :16.

**Critério de aceite:**

- [ ] Migration revoga EXECUTE de anon E de authenticated na função.
- [ ] resetPassword devolve a MESMA mensagem neutra existindo ou não a conta — os ramos 'not_found' e 'unconfirmed' somem da UI.
- [ ] A tela de recuperar senha não quebra: o fluxo termina com a mesma tela de confirmação nos dois casos.
- [ ] O usuário legítimo continua recebendo o e-mail de reset do Supabase Auth.

**Arquivos envolvidos:** `supabase/migrations/ (arquivo novo)`, `src/contexts/AuthContext.tsx`, `src/views/customer/AuthView.tsx`
**Depende de:** nada
**Bom pra quem está chegando:** não — fora das 7 tarefas de entrada escolhidas; ver "Por onde o Netim começa" no topo

### [AUTH-040] Fazer a verificação de admin resolver por usuário em vez de semáforo global de módulo

**Tipo:** bug
**Prioridade:** P2
**Tamanho:** M
**Épico:** Segurança e privacidade do cliente
**Risco de mexer:** médio — mexe no caminho de boot da autenticação, que tem dois fast paths e um timeout de 3 s. Regressão aqui aparece como tela de admin em branco ou como cliente vendo menu de admin.

**Contexto:** checkingLock e initPromise são variáveis de módulo compartilhadas. Se uma segunda verificação começa enquanto outra está em voo, ela apenas espera e retorna — quem escreve setIsAdmin e o localStorage é sempre a closure do usuário ANTIGO, com o userId e o cacheKey dele. Na troca de conta na mesma aba (admin sai, cliente entra antes da RPC responder), o cliente herda isAdmin=true, vê o menu admin liberado e leva erro de permissão em todas as telas.

**Evidência:** Achado #38. src/contexts/AuthContext.tsx:57-59 (variáveis de módulo), :150-158 (`if (checkingLock) { await checkingLock; return; }` sem calcular o próprio resultado), :161-180 (closure captura userId e cacheKey do primeiro chamador), :183-187 (queryPromise órfã sobrevive ao timeout de 3 s). activeUserIdRef só é declarada em :251, depois de checkAdmin em :121.

**Critério de aceite:**

- [ ] A promise em voo passa a RESOLVER o booleano em vez de ser aguardada por efeito colateral.
- [ ] As chamadas são coalescidas por userId: dois usuários diferentes nunca compartilham a mesma promise.
- [ ] O resultado só é aplicado (setIsAdmin + localStorage) se o usuário ainda for o ativo no momento da resolução.
- [ ] Trocar de conta admin para cliente na mesma aba, sem recarregar, deixa isAdmin=false e o menu admin escondido.
- [ ] O boot com um único usuário continua fazendo no máximo uma chamada de verificação.

**Arquivos envolvidos:** `src/contexts/AuthContext.tsx`
**Depende de:** nada
**Bom pra quem está chegando:** não — é concorrência com closure capturada, semáforo de módulo e ordem de declaração de refs; o modo de falha depende de timing e não aparece em teste manual simples.

### [AUTH-050] Encerrar a sessão localmente no logout e limpar os caches de PII do usuário anterior

**Tipo:** bug
**Prioridade:** P2
**Tamanho:** M
**Épico:** Segurança e privacidade do cliente
**Risco de mexer:** médio — limpar chave demais desloga ou zera carrinho de quem não devia; limpar de menos mantém o bug. Precisa de uma lista de prefixos conferida contra os writers reais.

**Contexto:** Dois defeitos da mesma família. Em falha de rede, supabase.auth.signOut() retorna erro ANTES de remover a sessão do storage, e o app só mostra um toast: o usuário continua logado e o token continua no localStorage. E o handler de SIGNED_OUT apaga uma chave que não existe ('app.favorites') mas não apaga as que guardam dado pessoal: histórico completo de pedidos e endereços com CEP, rua, número e destinatário. Num tablet ou PC compartilhado isso sobrevive ao logout indefinidamente e é legível no DevTools.

**Evidência:** Achados #40 e #41. src/contexts/AuthContext.tsx:531-541 (signOut só limpa estado no ramo de sucesso, sem fallback local) e :459-471 (bloco de limpeza). Writers dos caches não limpos: `ikcous_orders_cache_${user.id}` em src/hooks/useOrders.ts:121,147,164,321,348,363,699,756 e `ikcous_addresses_cache_${user.id}` em src/hooks/useAddresses.ts:12,33,49,144,202,231. Grep por clearLocalUserData em src/ retorna zero.

**Critério de aceite:**

- [ ] Existe uma única função de limpeza de sessão, chamada tanto pelo logout quanto pelo listener de SIGNED_OUT.
- [ ] Com a rede desligada, clicar em Sair deixa o app deslogado e sem chave `-auth-token` nem `-code-verifier` no localStorage.
- [ ] Após o logout, nenhuma chave com prefixo ikcous_orders_cache\_ ou ikcous_addresses_cache\_ permanece no localStorage (varredura por prefixo, não por id fixo).
- [ ] A chave morta 'app.favorites' saiu da lista.
- [ ] O carrinho de convidado (marketplace_cart_v1) continua com o comportamento atual — se hoje é apagado, continua sendo.

**Arquivos envolvidos:** `src/contexts/AuthContext.tsx`, `src/hooks/useOrders.ts`, `src/hooks/useAddresses.ts`
**Depende de:** nada
**Bom pra quem está chegando:** não — fora das 7 tarefas de entrada escolhidas; ver "Por onde o Netim começa" no topo

### [AUTH-060] Parar de derivar isAdmin do objeto de sessão em cache no localStorage

**Tipo:** divida tecnica
**Prioridade:** P3
**Tamanho:** P
**Épico:** Segurança e privacidade do cliente
**Risco de mexer:** médio — os dois fast paths existem para evitar piscar a tela no boot; removê-los sem substituto faz o painel admin piscar entre estados a cada carregamento.

**Contexto:** O estado inicial de isAdmin e o atalho rápido do checkAdmin vêm do objeto de sessão em cache no localStorage, que é texto editável — o supabase-js não verifica assinatura no cliente. Editando a chave de auth no DevTools o usuário renderiza o shell administrativo inteiro e ainda grava o cache local de admin. Não é escalonamento de privilégio real (o controle continua no servidor com is_admin e RLS), é quebra de invariante e ruído: shell admin renderizado com dados vazios e erros de RLS por toda parte. O comentário no código afirma que a leitura é criptograficamente segura, o que não é verdade.

**Evidência:** Achado #75. src/contexts/AuthContext.tsx:85-89 (cachedIsAdmin montado a partir de getCachedSession(), que faz JSON.parse do localStorage em :70-82, lendo app_metadata.role), :97 (useState semeado com cachedIsAdmin), :120 (checkAdmin sem parâmetro que distinga fonte verificada) e :129-135 (Fast Path 1 retorna cedo com setIsAdmin(true) e grava o cache, sem nunca chegar ao networkCheck; o comentário da linha 129 afirma que a leitura é 'cryptographically secure').

**Critério de aceite:**

- [ ] O papel de admin só é considerado confirmado depois de vir de fonte verificada (RPC is_admin ou claim de JWT já validado pelo supabase-js na sessão ativa), nunca de JSON.parse do localStorage.
- [ ] Editar a chave de auth no DevTools para role admin não renderiza o shell administrativo.
- [ ] O boot de um admin legítimo não piscou nem ficou mais lento (medir antes e depois).
- [ ] O comentário que afirma segurança criptográfica foi corrigido ou removido.

**Arquivos envolvidos:** `src/contexts/AuthContext.tsx`, `src/App.tsx`, `src/components/layouts/AdminLayout.tsx`
**Depende de:** [AUTH-040]
**Bom pra quem está chegando:** não — mexe no caminho de boot da autenticação, onde os dois fast paths existem por motivo de percepção de velocidade e o custo de errar aparece como piscar de tela para o lojista.
