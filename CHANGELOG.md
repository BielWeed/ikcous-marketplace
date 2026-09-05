# Changelog

Formato baseado em [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/),
versionamento por [SemVer](https://semver.org/lang/pt-BR/).

Este arquivo começa na `1.0.1`, a **primeira release sob o GitFlow** implantado em 30/07/2026
(PR #11). A `1.0.0` que consta no `package.json` desde o início do projeto nunca foi tagueada e
não tem escopo registrado — não há como reconstruí-lo com honestidade, então ele não está aqui.

## [1.21.0] - 2026-09-04

A versão que refaz o frete do zero, imprime a etiqueta de envio com um
clique, blinda o banco-molde contra escrita anônima, deixa a compra em paz
quando chega atualização e fala com o leitor de tela. 21 PRs e 78 commits
desde a 1.20.0; 4 migrations e 2 edge functions, todas já aplicadas e no ar
antes deste merge.

### Para quem COMPRA (vitrine)

- **Atualização não interrompe a compra** (PR #425): o aviso de nova versão
  espera o pedido terminar — carrinho, endereço, pagamento, confirmação e
  login no meio da compra ficam protegidos.
- **Frete sem taxa fixa** (PR #424): a loja cota frete real (Melhor Envio /
  Correios) ou, sem transportadora conectada, avisa com clareza que só
  entrega na cidade. O selo "frete grátis" do produto agora vale de verdade
  no checkout (antes só enfeitava), e a regra do grátis mora no servidor.
- **Pós-compra honesto** (PR #420): a aba "Meus pedidos" do carrinho está
  viva, o endereço da compra é o que foi usado (não o atual), o sino não
  mente enquanto carrega e o toque no aviso responde na hora.
- **Acessibilidade, ondas 1 e 2** (PRs #418 e #422): botões da galeria,
  favoritar e remover cupom têm nome; variantes e meio de pagamento têm
  estado marcado; recusas e carregamentos são anunciados ao leitor de tela,
  numa única região viva na vitrine. Zero mudança visual.

### Para quem VENDE (painel admin)

- **Frete v2, tela premium** (PRs #414 e #424): resumo no topo e três
  blocos — Frete local (valor da cidade, alcance por CEP), Frete nacional
  (só cotação real) e Frete grátis com presets (desligado / acima de um
  valor / sempre / por produto marcado). Transportadoras e histórico de
  cotação mudaram para Ajustes.
- **Etiqueta de envio e rastreio pelo Melhor Envio** (PR #423): card na
  tela de frete gera a etiqueta com confirmação explícita (o 1º clique não
  gasta nada) e consulta o rastreio; pedido "pagar na entrega" nunca
  etiqueta antes do pagamento. Token fica nos ajustes da loja.
- **Ficha do cliente** (PR #419): quem é, o que comprou e como paga, em 3
  segundos.
- **Canais de Atendimento e Avisar clientes** no padrão premium (PR #421) e
  **títulos padronizados** nas telas que faltavam (PRs #413 e #416).

### Técnico

- Migrations, todas aplicadas no banco-molde ANTES deste merge, com prova em
  transação e carimbo no vivo: `20261080` (etiqueta e eventos de rastreio),
  `20261081` (regra do frete grátis no servidor), `20261090` (anon sem
  escrita em produtos e views), `20261091` (v22 e 19 RPCs órfãs sem EXECUTE,
  PUBLIC fora das v23/v24, 2 sobrecargas ambíguas removidas).
- Edge functions no ar desde 04/09 11:27Z: `calculate-shipping` v34 (sem o
  caminho de taxa fixa) e `melhor-envio-etiqueta` v1 (`verify_jwt = true`
  no `config.toml`). Tipos do banco regenerados (PR #426).
- CI: revisor `@claude` (PRs #409–#412), rascunho `@claude-draft` (PR #417)
  e o detector "Código x banco" (#139, PR #428) ligado com o secret
  `DATABASE_URL` — 201 referências conferidas contra o catálogo.
- Este commit de release foi criado por plumbing do git (sem índice, sem
  working tree) e não passou pelo hook de secretlint: só texto, escrito à mão.

## [1.20.0] - 2026-09-02

A versão que devolve o contorno do teclado, dá área de dedo de verdade aos
botões pequenos, enxuga os filtros do painel, deixa o lojista escolher a cor
da própria loja e endireita o checkout de quem compra pelo celular. Front
puro — zero migrations, zero edge functions (PR #406, 8 commits).

### Para quem COMPRA (vitrine)

- **Contorno de teclado de volta** (INFRA-130): quem navega por Tab vê um
  anel claro onde está — cor da marca na vitrine, verde no painel; o clique
  de mouse continua sem contorno.
- **Botões pequenos com área de toque de 44px**: voltar, sino, logo e as
  bolinhas dos carrosséis ficam fáceis de acertar sem mudar o desenho
  (no InfoBlock o alvo só aparece quando há 2+ blocos).
- **Checkout no celular mais limpo**: barra fixa mais fina (73px) com o
  valor dominante, total sempre visível no resumo da compra, avisos
  compactados, rótulos maiores (11px) e alvos de toque de 44px. Zero linha
  de lógica de preço, frete ou cupom tocada.

### Para quem VENDE (painel admin)

- **Chips de filtro compactos** em Pedidos, Produtos e Clientes: a fileira
  de filtros abaixo da busca encolheu sem perder o alvo de toque.
- **Cor da loja editável nos Ajustes**: o lojista escolhe a cor da marca,
  vê a pré-visualização e a loja inteira acompanha pelo mecanismo de cor que
  já existia. Preto continua recusado (a trava da cor preta foi mantida por
  decisão do dono).
- **Títulos padronizados**: Pedidos, Produtos, Clientes e Dashboard usam um
  único componente de título (AdminPageHeader), com o ponto de conexão, o
  botão de alerta e a barra de busca fixada da 1.19.0 intactos.

### Técnico

- Front puro: zero migrations, zero edge functions.
- CI: 8/8 no PR #406 (2ª rodada; a 1ª pegou 8 diagnósticos de Biome
  invisíveis no Windows por CRLF — emenda mecânica `1c1c54b`). Bateria
  local na árvore quieta: edge 382, unit 226, front 339 arquivos / 1703
  testes, build, links, ratchet e size verdes.
- Revisão adversária independente por item, em 3 frentes paralelas (time de
  sessões visual-0209): o revisor do checkout derrubou uma sobreposição de
  zona de toque que podia disparar exclusão de endereço ao tocar "Editar".

## [1.19.0] - 2026-09-02

A versão do painel que respeita o olhar do lojista na operação de todos os
dias: alertas que não empurram a lista da tela, métricas que cabem no
olho, barra de busca que acompanha a rolagem e imagem de variante que
aponta em vez de duplicar arquivo. Front puro — zero migrations, zero edge
functions (PR #403, 13 commits).

### Para quem VENDE (painel admin)

- **Alertas de pedidos cancelados viraram um botão.** A faixa amarela que
  empurrava a lista saiu: um botão com sino de alerta e a contagem no
  canto do título abre os detalhes (dinheiro preso, mercadoria a voltar,
  estorno devido). Fecha com um toque fora, Esc ou ao ir para os pedidos.
- **Métricas compactas e completas.** Os cards de métrica encolheram para
  metade da altura, o carrossel mostra mais cards por tela (2 no celular,
  5 no desktop) e o valor aparece INTEIRO — sem "R$ 1.31..." cortado.
- **Barra de busca que acompanha a rolagem.** Em Pedidos, Produtos e
  Clientes, a busca, o filtro e o modo de visualização ancoram no topo
  quando você rola — e os chips de filtro (status, categoria, ordenação)
  fazem parte dela. Os funis de Produtos e Clientes viraram chips.
- **Imagem da variante aponta em vez de duplicar.** Na criação/edição de
  variante, escolhe-se uma das fotos JÁ enviadas do produto — sem upload
  novo.
- **Simulador com fundo fosco.** O "Visualizar App" esfumaça o formulário
  atrás, deixando nítidos só a barra do simulador e a prévia.
- **Paginação padronizada.** "Exibindo X - Y de Z" com o mesmo desenho
  limpo em Pedidos, Produtos e Clientes — sem o cartão cinza.
- **Ponto de conexão ao lado do título** nas três telas, e o botão de
  recarregar (redundante) saiu da tela de Clientes.

### Técnico

- Front puro: zero migrations, zero edge functions.
- CI: 8/8 no PR #403; bateria local 1695/1695.

## [1.18.0] - 2026-09-02

A versão da prova de rua do dono na loja e do upgrade visual do painel: o
carrinho que diz a verdade sobre frete e pagamento, o card de produto que
deixa escolher sem abrir a página, e um painel que respeita o olhar do
lojista — pedido com o dinheiro primeiro, paginação única e status de
conexão real.

### Para quem COMPRA

- **Carrinho honesto sobre frete e pagamento.** Quem é da cidade da loja vê
  só a Entrega Local (a cotação de transportadora nem é chamada); quem é de
  fora recebe a cotação real. Os status de pagamento trocaram o jargão por
  frases simples — "Pago fora do fluxo" em vez de sigla sem sentido.
- **Escolha de opções direto no card do produto.** Tamanho e cor escolhidos
  na vitrine atualizam na hora o preço, o estoque e a imagem do próprio card
  (na Home, nos carrosséis e nos relacionados) — sem precisar abrir a página
  do produto para descobrir o preço da combinação.
- **Fim do pisca da barra inferior** ao navegar entre telas — a animação de
  transição agora afeta só as imagens, nunca a estrutura da loja.

### Para quem VENDE

- **Card de pedido com o dinheiro primeiro.** O valor domina o topo do
  cartão, o nome do cliente cabe inteiro em duas linhas, o horário aparece
  relativo ("há 5 min" / "hoje 14:32") e os badges de pagamento ganham faixa
  própria sem truncar. A grade do painel se adapta a 1/2/3/4 colunas — fim
  do esmagamento de 5 colunas.
- **Paginação única em todo o painel.** Um só componente, com contador
  "Exibindo X - Y de Z", em pedidos, produtos e clientes — morreram as três
  paginações diferentes ("Perfil do Setor", "Exibindo", "Segmento"), cada
  uma com um tamanho de página.
- **"Operações ao Vivo" mede de verdade.** O ponto de status reflete a
  conexão real agora (offline / lenta / boa, com sincronização), em vez de
  congelar o resultado da carga inicial.
- **Alertas de dinheiro e mercadoria viraram pílula colapsável** na tela de
  Pedidos — os avisos de "dinheiro preso", "mercadoria a voltar" e "estorno
  devido" não empurram mais a lista para baixo; o "Ver pedidos" rola direto
  até a lista.
- **Ajustes em seções colapsáveis.** "Status de funcionamento" (com
  termômetro de 3 níveis do PIX e diagnóstico) e "Identidade e localização"
  ficam fechados por padrão — a tela de configuração parou de ser um muro.
- **Barra inferior do painel com contraste de verdade** e o badge falso "2"
  da engrenagem removido (as perguntas de clientes sempre foram no sino).

## [1.17.0] - 2026-09-01

A versão da segunda varredura profunda: três ângulos nunca auditados como
principais (isolamento e privacidade, PWA/offline como produto, o lojista
leigo e a vida do pedido depois da compra) produziram um laudo de 26 achados
novos — as ondas A a D consertam os que mais doem, com o nascimento das lojas
na frente.

### Para quem COMPRA

- **A marca da loja volta às notificações.** Todo aviso de pedido nascia com
  ícone ausente na tela de bloqueio (o caminho do arquivo não existia) — e o
  ícone de instalação no iPhone era um formato que o iOS não aceita. Os dois
  apontam para os arquivos certos agora.
- **Sem internet, o app diz "Você está sem internet"** — não mais "Erro ao
  carregar seus pedidos" com a lista certa na tela, nem a tela eterna
  "Atualizando o Aplicativo / Instalando uma nova versão" que mentia enquanto
  a rede estava caída (agora é uma tela honesta de offline com botão "Tentar
  novamente").
- **"Sistema Atualizado" só quando houve atualização de verdade.** O aviso
  que aparecia "do nada" era a máscara de qualquer recuperação: erro de
  rede num arquivo, crash do app e reinício automático do vigia interno
  todos anunciavam "atualização". Cada motivo agora tem a frase honesta —
  e nenhum deles finge ser update.
- **Tocar na notificação volta para a loja que já está aberta**, em vez de
  abrir uma segunda cópia dela.

### Para quem VENDE

- **Cancelar pedido no painel pede confirmação** — e a pergunta muda com o
  caso: pedido pago avisa que o dinheiro não volta automático e que o pedido
  entra na lista "Devolver agora"; pedido em rota avisa que a mercadoria não
  volta sozinha. Fim do X vermelho de um clique sem guarda e sem desfazer.
- **O balde "Devolver agora" tem saída à mão**: o botão "Já estornei no
  Mercado Pago" marca o pedido como estornado (com confirmação) — antes ele
  dependia de uma notificação do Mercado Pago que o próprio código admite
  nunca ter sido observada chegar, e o card ficava na tela para sempre.
- **O nome da SUA loja agora tem onde configurar.** O campo "Nome da loja"
  entrou no cartão de Identidade e Localização dos Ajustes — até aqui,
  vitrine, recibo e notificações mostravam o nome do molde para sempre,
  porque nenhuma tela gravava esse valor. Vazio = o app usa o nome do
  branding.
- **Pedido esquecido fica visível.** Pedido pendente há 3 dias ou mais
  mostra "Este pedido espera você há N dias" na ficha — o pedido "na entrega"
  continua sem expirar (decisão de desenho), mas deixa de afundar na lista
  sem ninguém saber há quanto tempo prende o estoque.
- **Os KPIs não dizem "R$ 0,00" quando a consulta falha** — mostram "—"
  (zero medido e zero de falha são coisas diferentes). E apagar um cupom que
  já tem pedidos no histórico agora explica o motivo e aponta a saída real:
  desativá-lo.
- **O painel sincroniza produtos de verdade**: o catch-up de detalhes pedia
  uma coluna que o lojista não pode ler e engolia o erro em silêncio há uma
  semana — agora pede só as colunas permitidas e loga qualquer falha.

### Para quem opera o molde

- **O nascimento das lojas vem nas migrations.** As proteções que viviam só
  no banco de desenvolvimento — esconder o preço de compra (`custo`) do
  catálogo e o storage com travas de administrador — agora nascem do
  repositório: uma loja clonada deixa de nascer com a margem legível para
  qualquer visitante e sem poder subir uma foto sequer. As policies largas
  de banner (qualquer usuário logado escrevia) foram derrubadas.
- **Selo "Compra Verificada" não conta pedido morto**: pedido pago que depois
  foi cancelado ou devolvido deixa de conferir o selo em avaliação nova.
- **Migrations 20261070–73** (grants de coluna de produtos; buckets + policies
  de storage; RPC registrar_estorno_manual com guarda de admin; portão de
  status nas triggers do selo) — com rollback manual, VERIFICACOES no
  db-apply e provas db-prove no padrão da casa (12/12 e 7/7).
- **Faxina do instalável**: promessas que o app não cumpria saíram do
  manifest (compartilhar-para-o-app, screenshot inexistente, ícone
  inexistente) e o arquivo `sros_manifest.json` público foi apagado.

## [1.16.0] - 2026-09-01

A versão da varredura profunda: três ângulos novos de auditoria (regressão do
código novo, o painel do lojista de ponta a ponta e desempenho/escala)
produziram um laudo de 22 achados — as ondas 1 a 3 consertam os 10
importantes e a maior parte dos menores.

### Para quem COMPRA

- **"Meus Pedidos" não trava mais com o tempo.** A lista deixou de ser
  re-serializada inteira e regravada no armazenamento do aparelho a cada
  evento de status (uma rajada de PIX virava rajada de megabytes); cache
  cheio agora avisa em vez de fingir erro de rede.
- **A sessão que chega tarde no boot é conferida no servidor.** Quem entrou
  com internet lenta não fica mais preso a uma sessão revogada — o app
  valida em segundo plano e desloga sozinho quando o token já não vale
  (e continua não deslogando por queda de rede).
- **A busca do catálogo continua igual — só mais rápida.** O motor de
  sincronização deixou de comparar catálogo inteiro par a par a cada volta
  de foco da tela (o casamento agora é por índice), e uma eco de config
  idêntico não redesenha mais a casa inteira.

### Para quem VENDE

- **Responder uma pergunta que falha avisa.** Se a rede cair ou a sessão
  expirar, o botão "Enviar Resposta" diz o que aconteceu em vez de ficar
  mudo.
- **O carrinho do cliente volta a ser administrável pela ficha.** Os
  botões "remover item" e "limpar carrinho" funcionam de verdade — a
  permissão do banco agora tem o ramo do lojista.
- **O recibo impresso sai com o nome da SUA loja**, o que está configurado
  no painel — não mais com o nome de fábrica do molde.
- **A fila de moderação conta a fila inteira**, não só a página visível —
  o cartão deixa de dizer "Nenhuma avaliação na fila" com pendentes
  esperando em outra página.
- **O painel acabou com os botões que mentem:** WhatsApp sem número do
  cliente não aparece mais (na ficha e nos cards); copiar endereço,
  rastreio e código de cupom avisa quando o navegador recusa; excluir
  cupom vibra sucesso só no sucesso; e o texto da busca de pedidos e a
  ajuda do selo "Compra Verificada" descrevem o que o sistema faz de
  verdade.
- **O painel de pedidos busca mais rápido.** A busca por cliente, cupom,
  rastreio, telefone e produto ganhou índice de trigrama no banco — e o
  sino de avisos, o contador de moderação e o carrinho ganharam índices
  próprios, de modo que nada disso varre a tabela inteira a cada uso.

### Para quem opera o molde

- **Timeout no cliente do Mercado Pago.** As quatro chamadas ao gateway
  (criar/consultar order, criar/consultar pagamento) têm teto de 15
  segundos — um gateway pendurado não segura mais o checkout do cliente
  até o limite da plataforma.
- **Sino de avisos com índice e sem varredura**: as duas consultas do
  cliente e o canal em tempo real passam a usar índice próprio — a tabela
  que cresce a cada pedido parou de custar uma varredura completa por
  login e por evento.
- **Config em tempo real sem re-render de graça**: o eco de realtime com
  configuração idêntica preserva a referência (inclusive com vitrines
  salvas, comparadas por valor).
- **Migrations 20261066–68** (índices do sino/carrinho/moderação, ramo de
  admin na policy de carrinho, pg_trgm + wrappers immutable) — com
  rollback manual e provas db-prove no padrão da casa.

## [1.15.0] - 2026-09-01

A versão da prova de rua: o dono navegou a loja, apontou quatro defeitos e
todos saem consertados — junto com a faxina dos avisos em tempo real e o
tratamento honesto do pagamento online antes das chaves.

### Para quem COMPRA

- **"Você também pode gostar" carrega de verdade.** A seção não fica mais
  presa no carregamento — e, quando o produto não tem recomendação, ela
  some em vez de mostrar o título sobre um grid vazio.
- **O banner de frete grátis não pede mais login para quem já está
  logado.** Com internet lenta na abertura, a sessão que chegava depois do
  boot era descartada e o app tratava o usuário como deslogado até ele
  mexer no carrinho. Agora a sessão tardia é aplicada — e, logado, o aviso
  diz o fato ("Ganhe frete grátis em compras acima de R$ X") em vez de
  pedir o que você já fez.
- **Produtos pausados não aparecem mais nas sugestões** ("Mais Amados da
  Loja", com a lista de favoritos vazia) nem no trending da busca vazia.

### Para quem VENDE

- **O formulário de produto não fica mais coberto** pela tag flutuante
  "Visualizar App" — o fim da tela (promoção, custo e preços) tem espaço
  próprio no celular e no desktop.
- **O painel para de gastar à toa:** uma rajada de eventos de pedido custa
  UMA conferência dos sininhos, não três consultas por evento.

### Para quem opera o molde

- **Avisos em tempo real sem barulho (C4):** resposta de pergunta só acorda
  a página daquele produto; mudança em um produto não redesenha a Home
  inteira (merge fino por id, memória dos cards preservada); canal de
  pedidos órfão aposentado.
- **Faxina do laudo 0109:** rótulos do painel alinhados à regra real, fim
  do duplo toast do cupom, guarda de corrida nos clientes de push, log de
  push nasce zero nas DUAS assinaturas da RPC, warmer respeita rede lenta.
- **Pagamento online honesto antes das chaves (D1):** sem chave do Mercado
  Pago o erro é terminal (o cliente sai do loop "tentar de novo") e o
  Ajustes ganha card próprio avisando que falta configurar.


## [1.14.0] - 2026-09-01

A semana que deixou a loja mais difícil de enganar e mais fácil de usar. No
servidor: pedido não nasce em dobro, voto útil não pode mais ser fabricado,
cupom exclusivo fica exclusivo de verdade, e entrega local passa a valer só
para quem está na cidade. Na loja: PWA abre sem internet de verdade, o
convite de notificações não trava mais o botão Finalizar, e o cupom aplicado
sobrevive à volta ao carrinho.

### Para quem COMPRA

- **O pedido não nasce em dobro quando a rede cai.** Se a resposta se
  perder depois de gravado, a retentativa devolve o pedido que já existe —
  estoque e cupom não são debitados duas vezes.
- **O cupom aplicado e o endereço digitado não somem mais** quando você
  volta ao carrinho para conferir algo. E, com a internet de volta, o cupom
  revalida sozinho — o desconto real aparece sem precisar reaplicar.
- **A loja abre e recarrega sem internet.** A PWA agora serve a vitrine do
  cache: sem sinal, abrir ou recarregar continua mostrando os produtos
  (antes: tela branca). E o aviso de update não apaga mais o cache na
  primeira visita de cada celular.
- **O botão Finalizar não fica mais escondido** atrás do convite de
  notificações — no carrinho e no checkout o convite sai do caminho.
- **Entrega local só para quem está na cidade** (e agora o servidor confere:
  convidado de fora é recusado, e a cotação de frete tem de ser do mesmo
  CEP do endereço).

### Para quem VENDE

- **Voto útil com memória no servidor.** Cada cliente logado conta um voto
  por avaliação — na API, não só no botão. Inflar avaliação pela força
  bruta deixou de existir.
- **Cupom exclusivo voltou a ser exclusivo.** A lista de cupons ativos não
  é mais legível por visitantes; quem valida no checkout continua sendo o
  servidor.
- **Erros de rede não valem venda:** frete de transportadora só entra no
  pedido se a cotação foi de verdade, do servidor, para o carrinho certo.

### Para quem opera o molde

- **Idempotência da criação de pedido** (p_idempotency_key nas v23/v24) e
  **gate de entrega no servidor** (cobertura local, reconciliação CEP) —
  migrations 20261035-40 + 50-52; ver fichas nos cabeçalhos.
- **Ghost Purge aposentado** e **navegação do service worker cache-first**:
  a PWA nasce viva e sobrevive offline; purge nuclear não roda sem rede.
- Faxina: sonda de estoque quebrada (check_stock_v1) removida da porta.

## [1.13.0] - 2026-08-30

A loja avisa o cliente na hora certa (cada passo do pedido, e o "Pagamento
confirmado!" quando o PIX cai), o selo "Verificado" nasce da compra real, e
avaliação nova só vai ao ar depois da aprovação da loja. No painel: filtro de
pagamento que conta certo, fila de moderação de verdade, e custo vazio deixa
de virar margem mentirosa.

### Para quem COMPRA

- **O sino agora avisa cada passo do pedido.** Pedido aceito, em preparo, a
  caminho, entregue ou cancelado: o aviso nasce sozinho da mudança real de
  status — antes, o cliente só ficava sabendo se abrisse o pedido na sorte.
- **"Pagamento confirmado!" quando o PIX cai.** O aviso que o cliente mais
  espera não depende mais de o pedido mudar de status. E se o dinheiro entrar
  depois de o pedido já ter sido cancelado ou expirado, a frase é honesta:
  a loja já foi avisada e vai resolver com você.
- **Selo "Verificado" só para quem realmente comprou.** A avaliação com selo
  vem de uma compra com dinheiro reconhecido pela loja; quem já avaliava
  ganha o selo quando o pagamento entra (com efeito retroativo). O selo é
  derivado do pedido — não existe botão para forjar.
- **Avaliação nova passa pela fila da loja.** Sua avaliação chega ao lojista e
  aparece na vitrine depois da aprovação — o app avisa isso na hora de enviar.
  Avaliações já publicadas continuam no ar.
- **O horário de funcionamento da loja aparece na vitrine.** Quando o lojista
  preenche, o cliente vê antes de bater na porta fechada.

### Para quem VENDE

- **O filtro de Status de Pagamento agora filtra NO banco.** Antes ele
  recortava só a página em tela: com muitos pedidos, o total continuava
  contando tudo. Agora lista e contagem vêm filtradas do banco de verdade.
- **Fila de moderação de verdade no painel.** Avaliação nova entra como "Em
  moderação" e vai ao ar só no seu "Aprovar e Publicar". E a fila não é
  contornável por fora: o banco recusa avaliação que tentar nascer publicada
  por atalho.
- **Custo vazio deixa de virar margem mentirosa.** Produto brinde ou sem custo
  pode ficar com o campo vazio: a margem aparece como 100% com a marca "Custo
  Suspeito", em vez do sistema inventar R$ 0 de custo.
- **A recusa do cupom diz o PORQUÊ.** Não existe, desativado, expirou (com a
  data), limite de usos ou compra mínima não atingida: cada caso com a frase
  certa no checkout.
- **O histórico de cotações de frete registra o provedor padrão.** A cotação
  de taxa fixa entra no histórico junto com as do Melhor Envio (deploy da
  função de frete feito nesta versão).
- **O horário de funcionamento que você preenche chega ao cliente — com
  sentinela.** Se a configuração sumir do banco, a vitrine NÃO inventa
  expediente de fábrica.
- **O preview do carrossel e a vitrine ordenam igual.** O que você organiza no
  painel é exatamente a ordem que o cliente vê na loja.

### Ferramenta (não muda nada na loja)

- Cadastro exige senha de 8 caracteres; a marca própria deixa de ser "ICKOUS";
  a ajuda do dashboard aponta para o lugar certo; o contador de usos do cupom
  espelha o que o banco gravou; o KPI executivo não pega pedido fora de
  ordem; a rota órfã de comparação saiu do app.
- O painel de push mede o público-alvo SEM baixar a credencial de envio, e as
  categorias do painel contam só dinheiro reconhecido pela loja.

## [1.12.0] - 2026-08-29

O checkout para de engolir as recusas do banco: a pessoa vê O QUE deu errado
e ganha o botão que resolve. E a lista de pedidos deixa de apagar a si mesma
na volta do PIX.

### Para quem COMPRA

- **Pedido recusado agora diz o motivo e oferece a saída.** As 11 recusas do
  banco (estoque, variação, frete, cupom, endereço...) mostram a frase exata e
  um botão com a ação certa: atualizar o carrinho, escolher a variação, tirar
  o cupom, ver os pedidos. Até agora era só um aviso vermelho que sumia.
- **O botão "Finalizar" trava sozinho nos casos perigosos.** Quando não dá
  para saber se o pedido nasceu (rede caiu no meio), o botão fica travado
  enquanto o aviso está na tela — fechar o aviso destrava. Um clique a mais
  contra dois pedidos no lugar de um.
- **A lista de pedidos não apaga mais a si mesma.** Voltar do banco e tocar
  em "Meus Pedidos" na sequência errada chegou a mostrar "nenhum pedido" com
  o pedido pago. Não mostra mais.
- **Pedidos atualizam ao voltar para a aba.** Qualquer aba do app re-busca a
  lista em silêncio quando volta ao foco — quem actualizou o pedido no
  computador vê a versão nova ao voltar.

### Para quem VENDE

- **O painel para de tocar alerta vermelho sem você pedir.** Recargas de
  fundo com falha ficam registradas nos bastidores; alerta vermelho só em
  carga que você pediu de verdade.

### Ferramenta (não muda nada na loja)

- Migrations passam a viver em dois andares (raiz e _arquivadas) com um
  resolvedor único para todos os scripts de prova — a família que o
  arquivamento quebrou em silêncio voltou a funcionar.
- O db-apply exige CONTAGEM EXATA dos marcadores de verificação, não só
  presença.
- O secretlint varre .ps1, .bat e o package-lock.json — preso por teste com
  iscas de token falso.
- Fim de linha determinístico no checkout (.gitattributes) e os slash
  commands do Claude Code documentados no repositório.

## [1.11.0] - 2026-08-28

A loja passa a conseguir registrar o pagamento que recebeu na mao, e o painel para de
dizer que recebeu dinheiro que nunca entrou.

### Para quem VENDE

- **Da' para marcar na tela que o pagamento foi recebido na entrega** - PIX na entrega,
  cartao na maquininha ou dinheiro na mao. O botao esta no cartao do pedido, e a ficha
  do pedido pergunta ao avancar para "entregue", que e' o momento em que o dinheiro
  troca de mao de verdade. Fica gravado quem confirmou e quando.
- **A "Receita Hoje" para de contar dinheiro que nao entrou.** Ate' agora, pedido sem
  confirmacao de pagamento era tratado como pago - inclusive os pagos na entrega, que
  nao tinham como ser confirmados porque a funcionalidade acima nao existia.
- **O mesmo vale para a ficha do cliente:** o LTV Total e quem conta como "cliente
  frequente" passam a olhar so' dinheiro reconhecido.
- **A lista de pedidos ganha filtro por situacao do pagamento.**

> **O numero vai CAIR, e isso e' o objetivo.** Medido em 27/08/2026, o painel dizia que
> a loja tinha recebido R$ 2.977,09; tinham entrado R$ 4,00. A diferenca eram 53 pedidos
> pagos na entrega que ninguem nunca confirmou. O app nao quebrou - ele parou de mentir.

### Para quem COMPRA

- **Cancelar um pedido ja pago passa a avisar sobre o dinheiro ANTES de confirmar.** Quem
  ja pagou - inclusive na entrega - e' avisado de que o valor fica com a loja ate' alguem
  devolver a' mao, e de que, se o pedido ja saiu, so' depois de o produto voltar. Quem
  ainda nao pagou continua vendo o texto de sempre.
- **A ficha do pedido reconhece o pagamento recebido na entrega** como pagamento
  confirmado, em vez de deixar a pessoa achando que ficou devendo.

### Exige acao no momento de publicar

Esta versao tem **duas migrations que vao coladas a este deploy**, nesta ordem, e nao
antes dele:

1. `20261020000000_lojista_registra_pagamento_recebido.sql` - aditiva, nao nega nada do
   que ja existe.
2. `20261021000000_receita_conta_so_dinheiro_que_entrou.sql` - depende da primeira.

Aplicar a segunda antes de o front subir abre uma janela em que a lista de Clientes e a
ficha do mesmo cliente mostram valores diferentes sob o rotulo "LTV Total" (medido em
27/08/2026: R$ 473,40 contra R$ 3,00, em 4 clientes). A janela fecha sozinha quando as
duas pontas estao no ar - por isso a regra e' encurta-la, nao desfazer nada.

## [1.10.0] — 2026-08-27

Seis defeitos que a loja tinha e ninguém via, mais a metade que faltava do
cancelamento depois do envio. É a versão que fecha a conta aberta na 1.9.x.

### Para quem COMPRA

- **A foto para de virar um retângulo preto.** Imagem com fundo transparente
  perdia o fundo ao ser redimensionada e virava um bloco preto — no catálogo,
  no avatar e na capa.
- **Falha de rede na busca do CEP deixa de ser silêncio.** Se a consulta caía, o
  endereço simplesmente não preenchia e nada explicava por quê: a pessoa ficava
  tentando no escuro, no meio do checkout.
- **Um erro do servidor para de virar "você está sem internet".** Um 502 isolado
  fazia a loja anunciar que a pessoa estava offline, com a internet dela
  funcionando.
- **O app para de reescrever sozinho o nome do produto** ao carregar o catálogo.
- **Quem liga o aviso de novidades para de ficar preso.** Havia becos sem saída
  em que a pessoa autorizava a notificação, nunca recebia nada, e a tela
  continuava dizendo que estava tudo certo.
- **Duas abas abertas param de brigar.** Com a loja aberta em mais de uma aba,
  duas podiam assumir o mesmo posto ao mesmo tempo e duplicar trabalho.

### Para quem VENDE

- **O painel separa duas perguntas que eram uma só:** "o produto voltou?" e
  "pode devolver o dinheiro?". Quando um pedido é cancelado depois de enviado, a
  mercadoria está fisicamente com o cliente — e o painel agora mostra isso, com o
  botão para confirmar o retorno quando ela chegar.
- **O estoque parou de mentir nesse caso.** Antes, cancelar um pedido já enviado
  devolvia a peça para a prateleira na hora, e a loja passava a anunciar um
  produto que não estava lá. Agora ele só volta quando você confirmar que
  recebeu.
- **Cliente não cancela mais pedido já entregue.** Produto entregue é devolução,
  que é outro assunto. Você, como loja, continua podendo.

### 🔴 A ordem em que isto subiu, porque ela não foi a ideal

A regra no banco (migration `20260970000000`) foi aplicada em **27/08/2026, antes
desta release** — verificada em conexão nova, chamando as funções como o app
chama, com controle negativo e a transação encerrada em `ROLLBACK`.

Consequência: desde aquele momento até o merge desta release, o banco já exigia a
confirmação de retorno enquanto o painel publicado **ainda não tinha o botão** —
um cancelamento depois do envio prenderia o estoque sem tela para liberá-lo.
Janela medida: 1 pedido em `shipping` e nenhum pedido novo desde 23/08.

**Esta release é o que fecha essa janela.** O certo, da próxima vez, é publicar a
tela primeiro e o banco depois: tela nova com banco velho funciona; banco novo
com tela velha é que quebra.

### Fecha uma pendência da 1.9.1

A 1.9.1 subiu declarando que faltava cadastrar `VITE_SUPABASE_PUBLISHABLE_KEY` na
Vercel e refazer o deploy. Medido em 27/08: a variável existe em Production e o
site publicado **já carrega a chave nova**. Aquele passo está concluído.

### Sabido e não corrigido

- **Não existe devolver dinheiro pelo app.** O painel passa a *listar* quanto
  você deve estornar; o estorno em si continua manual, no painel do Mercado
  Pago, um pedido por vez.
- Segue valendo o que a 1.9.0 já listava em aberto — frete grátis escrito em 10
  lugares (`FRETE-020`) e o OTP de rastreio de convidado (`AUTH-010`, #118).

## [1.9.1] — 2026-08-27

**Nada muda na tela, e é esse o ponto.** Esta versão existe para a loja
sobreviver a um botão que ainda não foi apertado — por isso sobe só o último
dígito.

### O que estava em risco

O Supabase, que é o banco de dados da loja, está trocando as chaves de acesso:
as antigas dão lugar a novas. As antigas **não têm data para morrer** — elas
funcionam até alguém desligá-las num botão do painel. Não é um relógio
correndo, é um clique.

As oito funções de servidor já sabiam usar a chave nova, com a antiga como
reserva. **O site não sabia.** No instante daquele clique, a loja pararia de
carregar por completo: nem produto, nem login, nem carrinho.

### O que mudou

- O site passa a usar a **chave nova** e só cai para a antiga se a nova faltar.
- A tela de erro de configuração passa a **nomear as duas chaves** — antes
  citava só a antiga, e quem fosse investigar procuraria a variável errada.
- Ao carregar, a loja **registra qual chave usou**. Sem isso, um erro de
  autenticação em massa não teria nenhum rastro para seguir.
- Um caractere invisível colado junto da chave (acontece ao copiar e colar)
  deixa de derrubar a autenticação em silêncio.
- O **manual de troca de credenciais** parou de recomendar, como caminho
  seguro, o passo que derrubaria a loja — e ganhou a conferência que
  realmente distingue qual chave está respondendo.

### Para quem COMPRA

Nada. Nenhuma tela, texto ou comportamento muda.

### Para quem VENDE

Nada muda hoje. O que muda é que desligar as chaves antigas deixa de ser um
risco de derrubar a loja — **desde que o passo do ambiente seja feito**, abaixo.

### 🔴 Esta release NÃO conclui a migração — falta um passo fora do código

Medido em 27/08/2026: a variável `VITE_SUPABASE_PUBLISHABLE_KEY` **não existe**
no ambiente de produção da Vercel. Enquanto ela não existir, o site continua
rodando com a chave antiga, e o clique de desligamento derruba a loja do mesmo
jeito.

Para concluir, **nesta ordem**:

1. esta versão publicada (é o que esta release faz);
2. a variável cadastrada na Vercel com a chave `sb_publishable_...`;
3. um **novo deploy** — a chave entra no código no momento do build, então
   salvar a variável sem republicar não muda o site que está no ar;
4. conferir no Console do navegador que a linha `[EnvGuard]` nomeia
   `VITE_SUPABASE_PUBLISHABLE_KEY`, e **só então** desligar as antigas.

A ordem não pode inverter: cadastrar a chave nova sobre um site antigo faz a
nova vencer a antiga carregando os defeitos que esta release corrige. O passo a
passo está em `docs/runbooks/rotacao-credenciais-supabase.md`.

### Ambiente desta release

**Nenhuma** migration e **nenhuma** edge function entre a `1.9.0` e esta — só
arquivos de tela, um módulo novo de leitura de ambiente e documentação. O
`middleware.ts` (que roda na borda da Vercel) mudou junto, pela mesma razão.

## [1.9.0] — 2026-08-26

**Uma auditoria do app inteiro, em duas rodadas, e ~50 defeitos fechados.** Trinta
e oito entregas desde a `1.8.1`. O número do meio sobe porque muda o que
acontece na tela em dezenas de pontos — a `1.8.1` tinha subido só o último
dígito justamente porque nada de comportamento mudava, e aqui muda.

O trabalho foi dividido em duas metades e **revisado cruzado de propósito**:
ninguém revisou o próprio conserto. Isso pagou — três dos defeitos desta lista
são regressões que a própria rodada de correção criou, achadas pela revisão do
outro lado e fechadas antes de chegar aqui.

### Para quem COMPRA

- **Trocar o CEP no checkout** parou de misturar rua antiga com cidade nova.
- **Engasgo de rede na entrada** parou de deslogar e de esvaziar o carrinho.
- **Salvar o cadastro meio carregado** parou de apagar nome e WhatsApp.
- **Produto sem nenhuma avaliação** parou de exibir cinco estrelas.
- **O botão da tela de erro** parou de apagar carrinho e sessão junto.
- **Falha ao carregar um produto** parou de dizer "produto não encontrado" —
  não conseguir buscar e não existir viraram coisas diferentes.
- **Apagar ou marcar um aviso como lido** parou de falhar em silêncio.
- **Compartilhar um produto** parou de copiar mensagem sem link nenhum. As
  mensagens prontas do painel que não trazem `[link]` voltam a levar o endereço
  da loja — e se o navegador bloquear a cópia, aparece o erro, não um
  "Link copiado!" falso.
- **A limpeza da atualização do app** passou a respeitar a mesma lista do resto:
  o que não pode ser perdido não é perdido.

### Para quem VENDE

- **Um engasgo de rede parou de expulsar o lojista do painel.** A tela
  confundia "o servidor disse que você não é admin" com "o servidor não
  respondeu", e as duas jogavam para fora recarregando a página — levando junto
  o cadastro em andamento. Havia até beco sem saída: com alteração não salva,
  cancelar a saída travava o painel em "Verificando permissões…" até um F5.
- **A seção de chaves de frete parou de morrer calada.** Dizia "Recarregando…"
  para sempre sem nada recarregar. Agora explica e oferece tentar de novo.
- **Trocar de aba parou de apagar** o que foi digitado nas regras de frete, e
  **salvar frete parou de apagar** o token da transportadora.
- **Os números do painel pararam de afirmar zero quando a consulta falha.** Zero
  que quer dizer "não consegui medir" agora se identifica como tal, em pedidos,
  produtos e clientes.
- **Falha ao abrir um pedido** mostra erro e caminho de volta, em vez de rodinha
  eterna.
- **Respostas em tempo real** pararam de ser etiquetadas com o produto errado.
- **O cache de categorias** passou a respeitar o período selecionado.
- **A ficha do pedido parou de prometer estorno** que o app não faz.

### O que esta release NÃO liga — e depende de dois cliques

Três consertos viajam nesta release como arquivo e **ficam dormentes** até
serem ligados à mão. Nada quebra por eles estarem dormentes; eles simplesmente
ainda não fazem efeito.

**Publicar as cinco funções do servidor** — `criar-pagamento`, `send-otp-email`,
`send-order-confirmation`, `webhook-mercadopago` e `reconciliar-pagamentos`.
Enquanto não subirem:

- Um **estorno parcial** continua apagando a venda inteira do faturamento: R$ 5
  devolvidos num pedido de R$ 200 zeram os R$ 200 nos nove relatórios.
- As três primeiras continuam lendo a **chave antiga do Supabase**. Ela não cai
  sozinha em data nenhuma — mas o dia em que essa chave for desligada no painel
  da Supabase, pagamento, e-mail de pedido e login param juntos. O código já
  está pronto para a chave nova; falta publicar.

**Aplicar as três mudanças de banco** — e a ordem importa: a da reconciliação
(`20261010000000`) vai **por último, depois das funções**, porque ela faz a
reconciliação alcançar mais pedidos, e quem processa esses pedidos hoje ainda é
o código que colapsa estorno parcial em estorno total. As outras duas
(`20261011000000`, `20261012000000`) são indiferentes à ordem. Quando aplicadas:

- A **reconciliação passa a alcançar o pedido vivo**: PIX pago cujo aviso do
  Mercado Pago se perdeu deixa de ser cancelado aos 30 minutos com o dinheiro
  parado e o produto revendido.
- O **carrinho passa a guardar a variação escolhida**, não o nome do grupo.
- A **vitrine passa a saber que o produto mudou**: hoje ela pode mostrar preço,
  estoque e foto de ontem mesmo com a pessoa online, e oferecer variação que a
  lojista já apagou.

### Como isto foi verificado

Cada conserto tem teste escrito **antes** dele e visto falhando — 41 arquivos de
prova novos. A exceção está declarada: os cinco consertos do painel da primeira
rodada ficaram sem cobertura, medido revertendo os cinco de uma vez e vendo
1.061 testes continuarem passando.

Onde a correção era "não expulsa mais", há controle negativo provando que quem
não é admin **continua barrado** — senão a asserção passaria com um portão que
simplesmente deixou de proteger.

## [1.8.1] — 2026-08-24

**Texto verde que ninguém conseguia ler volta a ser legível, em 14 pontos.**
Segunda release do dia; sobe só o último dígito porque **nenhum comportamento
muda** — o que muda é conseguir enxergar o que a tela já dizia.

### Para quem COMPRA

Todo texto pequeno em verde media **3,58** de contraste sobre o fundo
verde-claro e **3,77** sobre branco. O mínimo para texto pequeno ser legível é
**4,5**. Agora mede **5,21** e **5,48**. O que volta a se ler:

- **"Estoque: N"** no card da prateleira e na página do produto.
- **"Economizou R$ X"** no carrinho, e o **"Grátis"** da linha do frete.
- **"Vantagem Ativa"** e o valor recebido, no fim do checkout.
- **"Avaliado"** e a linha de desconto/cupom, na ficha do pedido.
- **"Compra verificada"** no perfil, e o aviso de sucesso nas notificações.
- Quatro trechos da **barra de frete grátis** — e esses eram os piores da loja,
  em **2,40**.

### O detalhe que quase passou

Na barra de frete o texto não era só claro demais: ele tinha **transparência**.
Com ela, **nenhum verde da paleta alcança o mínimo** — nem o mais escuro que
existe, que para em 4,16. Uma correção que trocasse só o tom teria deixado os
dois piores pontos da loja reprovando, e o registro diria que consertou. Ali a
transparência saiu.

### O que NÃO mudou, de propósito

Seis pontos continuam no verde antigo: são **ícone**, e a régua de ícone é mais
folgada (3:1, não 4,5:1) porque não é texto para ler. Os seis passam. Trocá-los
seria mexer no desenho sem defeito medido.

### Ambiente desta release

**Nenhuma** migration e **nenhuma** edge function entre a `1.8.0` e esta —
só arquivos de tela e o teto de dívida de lint, que foi abaixado para o número
que o CI mediu (eslint 551→550, biome 28→23; a queda veio da develop, conferida
contra o CI do release anterior, não suposta).

## [1.8.0] — 2026-08-24

**O sino do painel passou a ter para onde levar.** Vinte e duas entregas desde a
`1.7.0`, e a maior delas é uma tela que não existia: a de **Notificações do
lojista**. O número do meio sobe porque muda o que quem VENDE consegue fazer.

### Para quem VENDE

- **Tela de Notificações, nova.** Ela junta os quatro assuntos que antes só
  apareciam se a lojista fosse procurar tela por tela: **pedido esperando
  resposta**, **pergunta de cliente sem resposta**, **avaliação sem resposta** e
  **produto acabando no estoque**. Os avisos vêm ordenados por urgência, e cada
  um leva para a tela onde aquilo se resolve.
- **O sino do topo do painel abre essa tela.** Antes ele levava para a tela de
  envio de push — que é outro assunto: falar com o cliente, e não ser avisado
  pela loja. Essa tela continua existindo, agora com o nome que descreve o que
  ela faz: **"Avisar clientes"**.
- **A tela tem porta no celular e no computador.** A entrada pelos Ajustes tinha
  sumido do celular, e no computador não existia nenhuma.
- **A tela parou de dizer "Tudo em dia" antes de ter conferido.** Enquanto os
  dados carregavam, ela já afirmava que não havia nada pendente — e podia haver.
- **A rodada velha de avisos parou de apagar a nova.** Duas cargas em sequência
  podiam terminar fora de ordem, e a resposta antiga sobrescrevia a recente.
- **O Voltar devolve para a tela de onde a pessoa veio**, não para um lugar fixo.
- **A tela de Clientes parou de repetir a porta das Notificações.**
- **A busca de pedido por telefone passou a achar.** Ela não achava; agora acha,
  aceita o telefone **colado do WhatsApp** (com +55, parênteses e traços) e parou
  de responder a um dígito solto, que trazia meia loja de volta.
- **O painel parou de deixar criar produto com dois tipos de variação** (tamanho
  E cor, por exemplo). O banco guarda uma combinação por item, então esse produto
  nascia impossível de comprar — e o defeito só aparecia lá na frente, no
  carrinho do cliente.
- **O limiar de "estoque baixo" de cada produto chega ao app**, em vez de a loja
  inteira usar o mesmo número.

### Para quem COMPRA

- **Em tela larga, dois carrinhos apareciam ao mesmo tempo.** Agora é um só.
- **O carrinho mostra a opção escolhida, não o nome do grupo.** Onde se lia
  "Cor", agora se lê "Azul" — o que a pessoa de fato escolheu.

### Ambiente desta release

Uma migration (`20260961000000`, a da busca por telefone), **já aplicada antes do
merge** — migration não sobe com a Vercel. Nenhuma edge function tocada. A
produção aponta para o mesmo banco do desenvolvimento (`cafkrminfnokvgjqtkle`),
medido no site publicado antes de subir, e é nele que a migration está.

## [1.7.0] — 2026-08-23

**A maior release desde o GitFlow: 113 commits, 67 correcoes.** Ao contrario da
`1.6.1`, esta muda MUITO para quem compra e para quem vende — e por isso o
numero do meio sobe.

O tema e um so: **o app parou de prometer o que nao cumpria.** Quase toda
correcao aqui e uma tela que afirmava um fato que o sistema nao tinha realizado,
ou um caminho que aceitava algo que deveria recusar.

### 🔴 O caminho do dinheiro

- **Comprar sem escolher a variacao virou impossivel PELO SERVIDOR.** Antes,
  um item sem tamanho/cor era aceito e cobrado pelo preco BASE, com a baixa
  caindo no estoque agregado — o tamanho que acabou continuava a venda. Ate
  entao quem segurava isso eram QUATRO copias de um `if` no cliente, e nenhuma
  alcancava quem chama a API direto. Medido: R$ 120 em vez de R$ 170 no cenario
  da prova, e o estoque da variacao parado.
- **O frete cobrado passou a ser o do carrinho que esta sendo comprado.** Dava
  para cotar com um carrinho pequeno, encher o carrinho e fechar o pedido
  pagando o frete do pequeno.
- **A tela do frete recota quando a quantidade muda**, e o frete guardado no
  navegador deixou de valer para outro carrinho.
- **A loja parou de oferecer frete que o pedido ia recusar** — a cotacao so
  chega a tela depois de gravada.
- **O PIX pago pela rota classica parou de sumir e devolver o estoque.**
- **Quem ja pagou e avisado sobre o dinheiro antes de cancelar**, e a tela parou
  de convidar o cliente a pagar um pedido cancelado.

### O catalogo parou de mentir

- **Produto pausado sai da vitrine** — a busca da mesma tela ja fazia isso; a
  prateleira nao.
- **Produto excluido parou de voltar** para o cache e sumir so no recarregamento
  seguinte (duas portas fechadas), e excluir o ultimo item de uma aba parou de
  poder esvaziar a loja por engano.
- **Trocar de produto parou de trazer a variacao e a foto do anterior.**
- **O selo "Frete Gratis" parou de aparecer em produto que paga frete.**
- **O evento de tempo real parou de apagar as variacoes do produto no cache.**

### O painel parou de afirmar o que nao aconteceu

- **Tres telas** diziam ter feito o que nao fizeram; **tres numeros e um botao**
  apontavam para o lugar errado; **dois numeros** nao tinham como ser conferidos.
- **O painel dizia ter removido o item do carrinho da cliente sem ter removido.**
- **A lojista passou a ver quando um pedido PAGO foi cancelado.**
- **A falha de consulta parou de virar "Fila Limpa"** no cartao de Perguntas.
- **As vitrines da home passaram a gravar de verdade.**
- **A ficha do pedido parou de ficar branca** num status que o banco aceita.
- **Duplicar de banner saiu do painel** — era a unica porta para apagar imagem
  publicada.

### O erro cru do banco parou de chegar a quem usa a loja

Em seis pontos do frete, no login, no checkout, na ficha do pedido e no painel.
Quem compra lia mensagem de banco de dados; agora le portugues.

### Privacidade

- **O nome do cliente parou de aparecer no console do navegador.**
- **Quem tem a conta bloqueada parou de ler que errou a senha** — a mensagem
  antiga distinguia os dois casos e servia para descobrir se um e-mail existe.

### Notificacoes e conta

- **O sino parou de prometer o que o banco proibe**, e "marcar como lida" passou
  a valer.
- **"Quero Receber!" parou de calar quando nao ha conta.**
- **Trocar a senha parou de falhar em silencio.**
- **A resposta da lojista a uma avaliacao passou a chegar ao cliente.**

### Legibilidade

**Seis selos verdes de "deu certo"** voltaram a ser legiveis — reprovavam o
contraste minimo de acessibilidade sobre fundo verde-claro.

### Ferramental

- `lint:rapido` para trabalhar; **`lint:ratchet` continua sendo a prova**.
- A trava de segredo, o mapa de verificacao do `db-apply` e o teto do Biome
  foram endurecidos (ver `1.6.1` para o inicio dessa linha).

### ⚠️ O que esta release NAO inclui

- **A busca de pedido por telefone no painel continua nao achando.** A correcao
  existe, esta provada e aguarda revisao — nao entrou aqui de proposito.
- **Duas migrations desta release ja estavam aplicadas no banco de
  desenvolvimento antes do deploy** (`20260951`, `20260960`). Isso criou uma
  janela em que o servidor recusava o que a tela publicada ainda oferecia; esta
  release fecha essa janela. A licao — medir o que esta publicado ANTES de
  aplicar migration — ficou registrada.

## [1.6.1] — 2026-08-21

Release de ferramental: **a trava que impede uma credencial de ser gravada no
repositório deixa de ter pontos cegos.** Quatro entregas (#256, #261, #262, #263).

**Nada muda para quem COMPRA nem para quem VENDE.** Nenhum arquivo de `src/`
foi tocado, nenhuma migration, nenhuma edge function — o aplicativo que vai ao
ar é byte a byte o mesmo da `1.6.0`. Por isso o número sobe só o último dígito.

### O que muda no MOLDE

O `secretlint` roda no hook de pre-commit e é a **única** proteção deste
repositório contra credencial gravada no git — e o histórico dele já teve
`service_role` e senha de banco commitadas. Ele tinha três cegueiras, e todas
foram medidas antes e depois, com controle positivo na mesma rodada:

- **A chave do Supabase no formato legado** (`eyJ...`, um JWT) passava direto.
  Agora é recusada (#256).
- **A chave no formato novo** (`sb_secret_...`) também passava — e essa é a
  sucessora da `service_role`, que ignora RLS e tem acesso total aos dados. A
  documentação do Supabase descontinua o formato legado até o fim de 2026, então
  a trava estava protegendo justamente o formato que vai deixar de existir (#261).
- **Qualquer credencial dentro de um `.ps1` ou `.bat`** escapava, porque as duas
  extensões estavam na lista de exceções. O terminal deste projeto é PowerShell
  e há quatro arquivos desses versionados aqui (#262).
- **O `package-lock.json`** era pulado. Hoje não há nada sensível nele — as 1.381
  dependências vêm todas do registro público — mas a exceção não pagava nada e
  criava um ponto cego que vale no dia em que o projeto usar um registro
  **privado** de pacotes, o único caminho pelo qual credencial cai num lockfile
  (#263).

A `sb_publishable_` **não** é bloqueada, e isso é deliberado: a documentação
oficial do Supabase diz que ela é feita para ser pública. Bloqueá-la seria falso
positivo por construção — e falso positivo em trava de segurança é o que faz
alguém arrancar a trava inteira. A justificativa mora num caso de teste que
reprova quem acrescentar o padrão sem pensar.

### Como isso foi provado

O `scripts/hooks-prova.mjs` ganhou três controles e passou de 6 para **9**. Ele
não simula: monta um repositório descartável, instala os hooks reais e faz
`git commit` de verdade com a credencial dentro.

```
controles executados: 9 de 9, todos PASSOU
  1b. commit com JWT `service_role` é RECUSADO
  1c. commit com chave `sb_secret_` é RECUSADO
  1d. commit com `sb_secret_` dentro de um `.ps1` é RECUSADO
  2.  o MESMO arquivo, limpo, PASSA
```

E cinco mutações individuais derrubam **exatamente** o controle que cada uma
cobre, nenhum outro — nenhum controle passa de carona no estado do anterior.

### Sabido e não corrigido

- **A cota mensal do GitHub Actions se esgotou em 20/08/2026.** Desde então toda
  execução do CI morre em 3-6 segundos sem rodar um passo, e **o CI não tem
  veredito** sobre nada desta release. Toda a verificação foi local e está dita
  como local em cada PR.
- O `.secretlintignore` mantém `node_modules/`, `dist/`, `.ship-safe/`,
  `.vercel/`, `.git/` e as quatro extensões de imagem. Nenhuma delas é formato
  onde credencial em texto se esconde.
- O pre-commit **não roda a partir de um worktree em outro caminho**: o shim do
  lefthook resolve o binário por caminho relativo à árvore principal. Pré-existente,
  e o motivo de os commits desta release terem sido criados pela API do GitHub,
  com o `secretlint` rodado à mão sobre cada diff em compensação.

## [1.6.0] — 2026-08-21

Release de correção: **o painel para de afirmar o que não sabe**. Três frentes de
auditoria varreram as telas do administrador, a fila de dor resultante foi consertada
em lotes, e o ferramental de verificação que deixava defeito passar foi fechado junto.
55 mudanças sem merge — 29 correções (17 delas em `src/`), 20 de documentação,
3 de formatação, 2 reversões e 1 teste — mais 5 migrations.

O padrão que se repete em quase todos os itens, e que dá o título à release: **a tela
mostrava um número que ela não tinha como saber, e o mostrava com a mesma confiança de
um número real.** Zero de "não consegui medir" era desenhado igual a zero de verdade.

### O que muda para quem COMPRA

- **Cupom de uso único deixa de ser perdido — e deixa de poder ser gasto duas vezes.**
  Quando o pedido que usou o cupom morre de vez (expira ou é cancelado), a vaga volta e
  o cupom pode ser usado de novo. Enquanto o PIX ainda for pagável, a vaga fica presa:
  sem isso o mesmo cupom seria devolvido, gasto num pedido novo, e o pedido original
  ainda assim seria pago com desconto. Levou quatro rodadas até fechar nos dois sentidos.

### O que muda para quem VENDE

O painel administrativo é a superfície inteira desta release.

**Dinheiro deixa de ser contado errado**

- **O LTV do cliente conta só o dinheiro que entrou**, e não mais o que foi apenas pedido.
- **Quem é "cliente frequente" também conta só dinheiro reconhecido.**
- **O Ticket Médio de Clientes lê a mesma fonte do Dashboard**, em vez de ter conta
  própria — antes os dois batiam por coincidência, e parariam de bater sem aviso.
- **Produto sem custo cadastrado para de posar como o mais lucrativo.** Sem custo, a
  margem calculada era 100%.
- **Os KPIs de dinheiro da tela de Produtos param de congelar** no primeiro valor lido.
- **O cartão de pedidos totais conta como o dashboard conta.**

**Pedidos**

- **A tela de Pedidos abre no que precisa de ação**, em vez de abrir num filtro que
  escondia trabalho — e **para de negar pedido que existe**.
- **A ficha para de chamar de cancelado o pedido que foi devolvido.** São duas coisas
  diferentes e o dinheiro delas é diferente.
- **O histórico de frete para de dizer que ninguém tentou cotar** quando houve tentativa.

**Produtos e estoque**

- **O painel para de anunciar "Em Operação" para produto que acabou.**
- **O painel para de precificar um estoque que ele não mostra.**

**Notificações**

- **A tela de Push para de anunciar público que não existe.**
- **O histórico para de carimbar entrega que não houve** — envio despachado não é
  envio recebido.
- **O quinto contador para de fingir zero**, e **o total de aparelhos não finge zero
  quando não conseguiu medir.** Zero passa a significar zero.

**Avisos e contagens**

- **O painel para de contar duas coisas com o mesmo nome e de avisar duas vezes.**
- **O aviso fala só do que ele observou**, sem estender a conclusão ao que não olhou.
- **A tela para de prometer o que o sistema não faz.**
- **A checagem de erro chega nos quatro inserts, não só num** — antes, três falhas
  silenciosas eram possíveis.

### O que muda no MOLDE

Nada disto aparece na loja, e tudo isto decide se um defeito chega nela.

- **O `db-apply` para de dizer "verificado" para migration que ele não conferiu.** A
  fronteira sem teste que deixava isso acontecer de novo foi fechada junto.
- **A varredura de segredo para de ficar verde sem ter varrido nada** — um verde de
  ferramenta que não rodou é pior que vermelho, porque encerra a checagem.
- **A trava de segredo para de aprovar em silêncio dentro de worktree.**
- **A guarda de push volta a olhar o DESTINO do push, não o branch local.**
- **A suíte do front para de reprovar teste que ninguém quebrou.**
- **Cinco migrations** acompanham as correções de dinheiro e de filtro: LTV e cliente
  frequente contando só dinheiro reconhecido, devolução do uso de cupom, o KPI usando o
  mesmo estoque que a tela, e o filtro de pedidos em aberto passando a filtrar no banco.
  Todas já estavam aplicadas no banco antes desta promoção (ledger: 123 arquivos, 123
  casadas, 0 pendentes).

### Sobre a verificação desta release

**A cota mensal do GitHub Actions da conta se esgotou em 20/08/2026**, e desde então
toda execução do CI morre em 3-6 segundos sem rodar um passo sequer. Os sete comandos
foram rodados na máquina local antes da promoção: `typecheck` 0, `test:edge` 294/294,
`test:unit` 66/66, `test:front` 485/485 em 90 arquivos (com `VITE_PAGAMENTO_ONLINE=false`
sobreposto — sem a sobreposição a máquina local dá 484/485, por causa de um `.env.local`
que não existe na Vercel), `build` 0, `lint:links` 0, `lint:ratchet` 0 (eslint 0 erros,
551 warnings, ambos no teto) e `size` 0.

**A prova é local e está dita como local.** O Biome, que o CI mede no Linux, não é
mensurável de forma confiável no Windows; nos arquivos alterados desde o último CI verde
há 4 apontamentos reais, todos em `scripts/` e `tests/`, nenhum em `src/`.

### Sabido e não corrigido

- **Nove achados do lote seguinte** continuam em conserto por outra frente e não entram
  nesta release.
- **A promoção 1.5.0 → produção foi feita por merge direto `develop` → `main`**, sem
  branch de release, e por isso o app ficou no ar identificado como `1.5.0` por algumas
  horas enquanto já servia este conteúdo. Esta entrada corrige o registro.

## [1.5.0] — 2026-08-20

Release de correção: **o app para de falar por uma loja que ele não conhece**.
Duas frentes — o endereço inventado no código e a promessa de e-mail que nunca
saía. Três entregas (#231, #232, #233) e uma ferramenta (#234).

### O que muda para quem COMPRA

- **O código para acompanhar o pedido finalmente chega** (#86, #161). A tela
  dizia "código de verificação enviado para seu e-mail" e ninguém nunca soube se
  algo tinha saído: o caminho era tela → banco → fila → gatilho → função, e a
  fila só é processada **depois** que a transação fecha — a resposta que a tela
  recebia vinha antes disso. O sistema era incapaz de saber. E o e-mail não
  chegava a ninguém de qualquer forma, porque o remetente era o de caixa de
  areia do Resend, que recusa todo destinatário que não seja o dono da conta.
  Agora quem envia responde, e "enviado" só aparece quando o e-mail saiu.
- **Falha de envio é dita na tela**, no mesmo passo, com a pessoa podendo tentar
  de novo — em vez de esperar um e-mail que não vem.
- **Pedir o código de novo cedo demais diz quantos segundos faltam**, em vez de
  parecer travado.
- **O formulário de endereço para de vir preenchido com a cidade errada** (#231).
  Havia o endereço de uma loja específica escrito no código — cidade, estado e
  CEP — e ele vazava em cinco lugares, inclusive travando campos do formulário.
- **O pedido não fecha mais cobrando frete que ninguém escolheu**, e saíram da
  home e da página de produto os selos de "entrega ultrarrápida" e "troca
  garantida" — nenhum dos dois existe no sistema.

### O que muda para quem VENDE

- **A tela de Ajustes passa a ajustar nome, cidade, estado e CEP de despacho**
  da loja. Antes esses dados não tinham onde ser digitados: vinham do código.
- **O painel para de completar o endereço do pedido com cidade inventada** — era
  esse endereço que ia para o mapa na hora de entregar.
- **Frete nunca configurado deixa de virar frete grátis para o Brasil inteiro.**

### O que muda no MOLDE

- **Sai a autenticação por segredo compartilhado** do envio de código, que
  aceitava a `service_role` — uma chave do projeto inteiro trafegando para
  mandar um e-mail. O gatilho e a fila do banco somem junto.
- **O e-mail do código deixa de ter nome de loja e cidade cravados.** O que fica
  cravado neste repositório viaja para toda loja clonada; há teste dedicado a isso.
- **Freio novo:** um código por pedido a cada 60 segundos. A função fica num
  endereço que qualquer visitante alcança, e cada envio gasta uma das ~100
  mensagens diárias da conta de e-mail da loja. Sem o freio, um laço esgota a
  cota e nenhum cliente recebe código pelo resto do dia.
- **O `db-apply` ganhou verificação para a migration da identidade da loja**
  (#232) e o repositório ganhou um script que **prova as duas migrations do
  código de verificação sem gravar nada** (#234): ele aplica, executa a função
  com dados de um pedido real, afere o comportamento e desfaz tudo com
  `ROLLBACK`. Sem ele a segunda migration seria aplicada e o `db-apply` diria
  "Tudo aplicado e verificado" sem ter conferido uma linha (#204).

### Verificação desta release

Os sete comandos do CI passaram em cada entrega. O script de prova das migrations
rodou em 19/08/2026 com **27 asserções e nenhuma falha**, e o banco voltou ao
estado original — conferido fora da transação.

**Ressalva registrada, não escondida:** a entrega #233 subiu **sem revisor de
contexto limpo** — a sessão estava com subagentes desligados, e o CI foi a única
instância independente que olhou aquele código. Ele mexe no caminho de
autenticação de pedido de convidado.

### Ações à mão desta release, na ordem

1. `20260820000000_otp_v2_devolve_o_codigo.sql` — **aplicada em 19/08/2026**,
   antes do merge. É aditiva: cria a função nova ao lado, sem tocar na antiga.
2. Publicar a `send-otp-email` **junto com a subida do front**. Enquanto a
   produção rodar o front antigo, é o caminho velho que atende.
3. **Só então** `20260820000100_otp_sem_fila_nem_gatilho.sql`. Aplicar antes
   derruba o código de verificação até o deploy alcançar.

Entre os passos 2 e 3 existe uma janela de poucos minutos em que pedir o código
não funciona: a função publicada é uma só, e ela troca de dono no caminho.

## [1.4.0] — 2026-08-18

Release de correção: o app **para de afirmar o que não cumpre**. Sete defeitos em
que a tela dizia uma coisa e o sistema fazia outra — para quem compra e para quem
vende. Três entregas (#225, #226, #227).

### O que muda para quem COMPRA

- **O carrinho parou de prometer o que a loja não faz.** Saíram dois selos que
  descreviam recurso inexistente: "Envio expresso e código de rastreio automático"
  (não há envio expresso, e o código é digitado à mão pela lojista) e "Garantia de
  devolução fácil em até 7 dias" (não existe fluxo de devolução — #108 e #46 seguem
  abertas). Ficou o selo de pagamento seguro, que é verdade.
- **O código de rastreio finalmente aparece para quem comprou** (#105). No detalhe
  do pedido, com botão de copiar e botão "Rastrear"; e no cartão da listagem, sem
  precisar abrir o pedido. Pedido sem código não mostra bloco vazio.
- **Digitar "alianca" acha "Aliança"** (#20). A busca comparava sem tirar acento, e
  teclado de celular não põe acento sozinho: o produto estava ativo, em estoque, na
  vitrine, e a busca devolvia nada. Corrigido nos três caminhos de busca do cliente.
  De quebra, produto sem descrição cadastrada não quebra mais a busca inteira.
- **Dois toques no "Finalizar" param de gerar dois pedidos** (#27, metade do front).
  O botão só desabilitava no quadro seguinte da tela, e a validação do formulário
  acontecia antes disso — dois toques rápidos entravam os dois, com estoque
  debitado duas vezes e cupom de uso único consumido duas vezes.

### O que muda para quem VENDE

- **A lista de pedidos do painel para de sumir** (#83). Ao voltar do segundo plano
  ou trocar de rede, o app recarregava a consulta *pessoal* da lojista — que dá zero,
  porque ela não compra na própria loja. O painel dizia "Ainda não tem nenhum pedido"
  com a paginação indicando várias páginas e pedido real parado na fila. Agora a
  recarga repete a mesma página e o mesmo filtro em que ela estava.
- **O painel parou de dizer "salvo" sem salvar** (#96). Desmarcar "Produto em
  Promoção", limpar SKU, preço de custo, validade e limite de uso do cupom agora
  gravam de verdade. Antes a tela confirmava sucesso e o valor antigo continuava no
  banco: o preço riscado seguia na loja, e o cupom parava de funcionar no checkout
  depois da data que ela achava ter apagado.
- **Cotação de frete que falha não vira preço inventado.** Havia **três** pontos
  cravando R$ 15 para qualquer destino do Brasil. O pior estava no front: ele montava
  uma opção própria de R$ 15 e a **auto-selecionava**, o que sobrescreve a taxa que a
  própria lojista configurou no painel e gravava "Entrega Padrão (Fallback)" no pedido
  como se fosse cotação. Agora falha não produz opção nenhuma, e a contingência do
  servidor usa a escada por região (15 / 22 / 38) que já existia.
- **A foto que ela sobe para de ser trocada por outra** (#44). O tradutor entre banco
  e app tinha uma regra: se o produto se chamasse "Aliança Luxo", usar uma imagem
  hospedada na Amazon — **antes** de olhar a foto cadastrada.

### Verificação desta release

Os sete comandos do CI passaram nos três PRs (#225, #226, #227), cada um com o
`develop` do momento. **34 testes novos** acompanham as correções, cada um com âncora
para não passar verde por acidente.

**A edge function `calculate-shipping` foi publicada à mão em 18/08/2026 23:10 UTC**
(versão 23 → 24), preservando `verify_jwt: false`, que era o estado no ar. Atenção:
`supabase/config.toml` declara `verify_jwt = true` para essa função — o arquivo e o
servidor divergem, e o deploy não corrigiu isso de propósito, para não mudar uma
trava de segurança de carona numa correção de frete.

**O que esta release NÃO resolve, de propósito:**

- A segunda metade da #27 (chave de idempotência): se o banco gravar o pedido e a
  resposta estourar por tempo, o cliente pode criar um segundo pedido. Exige
  migration em produção e sobe separado.
- O aviso de pedido novo por e-mail: a única saída de e-mail do app é o Resend com
  remetente de caixa de areia (`onboarding@resend.dev`), que não entrega para ninguém
  além do dono da conta (#161).

**A cobrança pelo site está LIGADA.** Isto muda em relação à 1.3.0, que subiu com o
caminho de pagamento inerte: a variável `VITE_PAGAMENTO_ONLINE` passou a existir em
Production em 17/08/2026, junto com `VITE_MP_PUBLIC_KEY`, e o Gabriel confirmou em
18/08/2026 que o pagamento por PIX via Mercado Pago está ativo no app. Ou seja: a
partir daqui o cliente pode pagar pelo site, com dinheiro de verdade, além das três
formas de pagamento na entrega.

## [1.3.0] — 2026-08-17

Release de funcionalidade: a **cobrança PIX pelo site** entra no código (desligada em Production) e
a **tela de finalizar** foi consertada e passou a dizer o que o cliente está comprando. Dezesseis
entregas acumuladas desde a 1.2.0.

**A loja continua sem cobrar pelo site.** A flag `VITE_PAGAMENTO_ONLINE` segue **sem existir em
Production** (conferido em 17/08/2026 com `vercel env ls production`: só `VITE_MAINTENANCE_MODE`,
`RESEND_API_KEY`, `VITE_VAPID_PUBLIC_KEY`, `VITE_SUPABASE_ANON_KEY` e `VITE_SUPABASE_URL`). Como a
flag só liga com a string exata `"true"`, todo o caminho de cobrança online sobe **inerte**: o
cliente continua vendo apenas pagamento na entrega.

### O que muda para quem COMPRA

- **A tela de finalizar agora diz o que você está comprando, e o que está no preço.** A barra do
  rodapé mostra o item (ou "N itens no pedido"), o total, e **"Inclui R$ X,XX de entrega"** — ou
  "Entrega grátis inclusa". Um toque no total abre a conta inteira: cada item com preço unitário,
  subtotal, entrega, desconto e total. Antes, quem ia pagar na porta (três das quatro formas de
  pagamento são na entrega) não descobria em lugar nenhum do app quanto separar nem se a entrega
  estava inclusa — e conferir o pedido custava o endereço já digitado, porque sair da tela apaga o
  formulário.
- **Os campos de endereço pararam de sair desalinhados.** "Número" ficava colado em "Cidade" e
  "Estado" sobrava sozinho numa linha. Agora é `CEP | Número · Rua · Bairro · Cidade | Estado ·
  Complemento`, cada campo com a largura do que entra nele — nomes longos de rua e bairro cabem.
- **A barra do total encaixou na navegação.** Havia uma fresta de 11px por onde o formulário
  aparecia rolando entre as duas barras. Em tela larga, a barra ficava meia tela deslocada para a
  direita e o formulário esticava de ponta a ponta.
- **Os meios de pagamento ficaram legíveis.** Os nomes tinham contraste de 2,56:1 (o mínimo é 4,5)
  e pareciam desativados. O aviso de que pagar pelo site exige conta vinha em letra de 9px com
  transparência por cima — perto de 1,9:1, justamente o texto que precisa ser lido.
- **O letreiro da busca saiu.** O texto rolava em laço infinito numa janela de 123px sendo que ele
  mede ~130px: nunca cabia inteiro, e não havia como pausar. Virou um texto parado e legível,
  "Buscar produtos".
- **A busca não aparece mais na tela de finalizar.** Tocar num resultado ali trocava de tela e
  apagava nome, WhatsApp, rua, número e complemento já digitados.
- **A variação escolhida do produto para de desaparecer.** O carrinho salvo no aparelho descartava
  o campo da variação ("Tamanho M") — depois de uma recarga, ela sumia da tela **e da nota que o
  vendedor recebe**.

### O que muda para quem VENDE

- **A nota do pedido volta a trazer a variação escolhida** pelo cliente (mesma correção acima).
- **Cobrança PIX pelo site, pronta e desligada:** migração para a Orders API do Mercado Pago,
  reserva de estoque alinhada ao vencimento do QR, aviso na tela quando o pagamento é confirmado,
  link "Pagar pelo Mercado Pago", saída para o cliente cujo pagamento falhou, e a exigência de
  conta para pagar pelo site. Nada disso está ativo em Production.
- **As três edge functions de pagamento** (`criar-pagamento`, `webhook-mercadopago`,
  `reconciliar-pagamentos`) mudaram neste ciclo e **sobem à mão**, não pela Vercel. Como o caminho
  de cobrança online está desligado em Production, o front publicado não as chama.

### Verificação desta release

`typecheck` limpo · **239 testes de front em 38 arquivos**, verdes em 8 rodadas seguidas ·
`test:edge` 237 · `test:unit` 17 · `build` ok · `lint:links` 177 links · `size` 521,47 kB de
800 kB · `lint:ratchet` eslint 0 erros e 553 warnings, no teto. CI inteiro verde no PR #222,
incluindo a catraca de lint em Linux (1m13s).

Biome foi medido **como o CI mede** (cópias dos arquivos em LF, config sem o bloco `vcs`): 4 erros
antes do diff, 4 depois — nenhum novo. O número local (187) é o falso positivo de CRLF no Windows.

## [1.2.0] — 2026-08-13

Release de correção: **dez defeitos**, quatro deles achados só porque a correção de outro defeito
foi revisada com contexto limpo. Nenhuma funcionalidade nova. A loja continua **sem cobrar pelo
site** — a flag `VITE_PAGAMENTO_ONLINE` segue sem existir em Production.

### O que muda para quem COMPRA

- **Recuperar senha não diz mais se o e-mail existe.** Antes, a tela respondia "Este e-mail não
  está cadastrado" ou "seu e-mail ainda não foi confirmado" — o que permitia testar uma lista de
  endereços e descobrir quem tem conta. Agora a resposta é a mesma nos dois casos. A consulta que
  expunha isso também foi revogada no banco. *(#120)*
- **Sair da conta agora sai de verdade, e limpa o rastro.** Com a rede ruim, o botão Sair mostrava
  erro e deixava você logado. E o histórico de pedidos, os endereços com CEP e o último CEP
  digitado ficavam no navegador **depois** do logout — num tablet de loja, para o próximo cliente
  ver. *(#122)*
- **Pedido cancelado que foi pago não some mais.** Se você cancelava e pagava o PIX assim mesmo, e
  a notificação do Mercado Pago se perdia, o dinheiro ficava no limbo: o app dizia "Aguardando
  pagamento" e nenhuma rotina corrigia. Agora a varredura automática alcança esse caso. *(#180)*

### O que muda para quem VENDE

- **O interruptor de Avaliações agora desliga as avaliações.** Ele mudava o selo para "Inativo" e
  não escondia nada: nota, comentários e a nota enviada ao Google continuavam no ar, e o cliente
  continuava conseguindo avaliar. Agora o desligamento vale na vitrine, no dado enviado aos
  buscadores e **na regra do banco**. *(#101)*
- **O painel para de dizer "Sem Dados Registrados" quando a consulta quebra.** Falha agora aparece
  como falha, em vermelho, com botão de tentar de novo. Antes você concluía que não vendeu nada.
  *(#104)*
- **Editar resposta de pergunta deixa de criar uma segunda.** As duas apareciam empilhadas na
  página do produto, sem como apagar. *(#100)*
- **O formulário de produto para de perder rascunho e de aceitar clique duplo.** O salvamento
  automático apagava o rascunho no instante em que você abria o produto para editar — enquanto o
  aviso ainda prometia restaurá-lo. E o botão Publicar continuava clicável por 1,5 s depois de
  salvar, criando produto duplicado. *(#98)*
- **Excluir produto não quebra mais as fotos.** As imagens iam para o backup antes de o produto
  sair do catálogo: se o segundo passo falhasse, o produto voltava para a vitrine com todas as
  fotos quebradas. *(#99)*
- **O painel não vira tema claro sozinho.** Salvar a cor primária apagava o tema escuro, deixando
  texto branco sobre branco até você trocar de tela. *(#102)*
- **Trocar de conta na mesma aba não dá mais menu de administrador ao cliente**, e não é mais
  possível virar "admin" editando o navegador. Não era acesso real aos dados — o servidor sempre
  barrou —, mas o painel montava inteiro, quebrado. *(#121, #123)*

### Sabido e não corrigido

- **O código de verificação do rastreio de pedido ainda não chega a cliente.** Ele sai por uma
  função que fala com o Resend em modo de teste, que só entrega para o dono da conta. Os demais
  e-mails (recuperar senha, confirmar cadastro) **saem normalmente pelo Gmail** — medido no painel
  em 13/08/2026. *(#161)*
- **A enumeração de e-mails não está eliminada, está fechada pela tela.** O limite de pedidos de
  recuperação é por usuário, e limite por usuário só dispara para usuário que existe — quem olhar
  a resposta bruta ainda distingue. Fechar isso é configuração do Supabase, não código. *(#120)*
- **Quem se cadastrou e não confirmou o e-mail não tem como pedir um link novo** depois de fechar
  a aba. O reenvio automático saiu junto com o vazamento que ele causava. *(#200)*
- **Desligar Avaliações não esconde as estrelas na home, na grade, na comparação e no perfil.**
  É decisão de produto em aberto. *(#202)*
- **A suíte de testes falha por sorteio quando roda em paralelo** — 2 de 5 execuções, por estouro
  de prazo, não por defeito de código. *(#201)*
- **O script que aplica mudanças de banco diz "Tudo aplicado e verificado" mesmo quando não
  verificou nada** — ele só sabe conferir função. *(#204)*

## [1.1.0] — 2026-08-11

Release da cobrança online. As três fases do checkout com Mercado Pago entraram — reserva de
estoque com expiração, criação de pagamento PIX com o Brick, e o webhook que confirma o pagamento
— mas **a loja em produção continua sem cobrar**. Tudo está atrás da flag `VITE_PAGAMENTO_ONLINE`,
que falha fechada (só a string exata `"true"` liga) e que **não existe no ambiente de Production**.
Ligar é decisão separada, e ainda depende de um pré-requisito que não é código: a conta do Mercado
Pago nunca criou um pagamento PIX de verdade. Ver *Sabido e não corrigido*.

O que **quem compra** ganha, com a flag desligada: a busca de endereço por CEP passa a funcionar.
Ela nunca funcionou em produção — `viacep.com.br` faltava na `connect-src` da CSP e o navegador
bloqueava a requisição em silêncio, deixando o cliente digitar o endereço inteiro à mão.

> **Ressalva medida em produção, depois da release:** quem já tem a PWA instalada **não recebe
> esta correção na hora**. O `vite.config.ts` usa `registerType: "prompt"`, então o service worker
> novo só assume quando a pessoa aceita o aviso de atualização — e o service worker antigo é
> justamente o que derruba a requisição. Verificado no ar: com o service worker antigo no
> controle, a busca de CEP falha mesmo com a CSP correta sendo servida; depois de trocar o service
> worker, ela responde. Vale igual para o SDK do Mercado Pago. Visita nova pega a correção
> direto; PWA instalada espera o update.

O que o **lojista** ganha: notificação quando entra pedido novo, push de status que só sai depois
de o banco confirmar a mudança, e erro visível quando salvar a configuração da loja falha — antes
falhava calado e a tela dizia que tinha salvo.

### Adicionado

- **Cobrança com Mercado Pago, em três fases, atrás de flag** (#176, #178, #179). A Fase 1 deu ao
  pedido uma reserva de estoque com prazo: colunas de expiração, `devolver_estoque`,
  `expirar_pedidos_vencidos` e um `pg_cron` a cada 5 minutos que cancela o que venceu e devolve as
  unidades ao catálogo — isso já está em produção desde 06/08 e é o que fechou o vazamento de
  estoque antigo. A Fase 2 acrescentou a edge function `criar-pagamento` e o Brick do Mercado Pago
  no checkout, oferecendo **só PIX**; cartão é recusado na função e desligado no Brick. A Fase 3
  fechou o ciclo com a `webhook-mercadopago`, que valida o `x-signature` antes de aceitar qualquer
  confirmação, a RPC `confirmar_pagamento` com guarda de status, e a `reconciliar-pagamentos`, um
  cron a cada 10 minutos que reconsulta o Mercado Pago sobre pedidos aguardando — a rede de
  segurança para o webhook que se perde.
- **Aviso ao lojista quando entra pedido novo** (#166, PEDIDO-020). Edge function
  `notify-new-order`, sem JWT de propósito: o pedido de convidado nasce sem sessão, e o que
  protege é a própria função (aceita só `orderId`, janela de 15 minutos, forma de UUID).
- **`verify_jwt` de cada edge function versionado** em `supabase/config.toml` (#162, INFRA-310).
  Até então ele só existia na linha de comando de quem deployava — e um deploy sem
  `--no-verify-jwt` na função errada derrubava o OTP sem erro nenhum. O arquivo não impede a flag,
  mas põe a decisão em revisão de PR como o resto do projeto.
- **Vitest no projeto, cobrindo os mappers** (#155, INFRA-150). É a terceira suíte: `test:edge` e
  `test:unit` rodam em Deno, `test:front` em Vitest.

### Corrigido

- **A busca de endereço por CEP nunca funcionou em produção** (#179). Faltava `viacep.com.br` na
  `connect-src` da CSP. Junto vieram três defeitos da própria busca, hoje unificada no hook
  `useBuscaCep`: a corrida em que duas requisições em voo terminavam com a resposta velha
  sobrescrevendo o endereço (#184); a ausência de timeout, que deixava o campo `disabled` para
  sempre se o ViaCEP pendurasse a conexão, impedindo a compra (#185); e a falta de abort no
  desmonte, que fazia o toast "CEP localizado!" aparecer por cima da tela seguinte (#186).
- **O service worker derrubava script de terceiro** (#179). O catch-all de
  stale-while-revalidate interceptava requisição cross-origin e a reemitia como `fetch()` — que é
  governado por `connect-src`, não por `script-src`. Um guard de origem consertou.
- **`send-push` não enviava e reportava sucesso falso** (#156, PUSH-010).
- **O push de status saía antes de a RPC confirmar** (#159, PEDIDO-090). O cliente era avisado de
  uma mudança que podia não ter acontecido.
- **`updateConfig` engolia a falha** (#158, ADMIN-010). Salvar a configuração da loja podia falhar
  com a tela dizendo que salvou.
- **Loop de requisição no detalhe do pedido** (#157, PEDIDO-040).
- **O e-mail de OTP apontava para o projeto Supabase errado** (#154, AUTH-020). O trigger fazia
  `net.http_post` para um projeto onde a `send-otp-email` jamais esteve publicada, e respondia
  404 — o convidado nunca receberia o código. Nunca chegou a acontecer com cliente real porque
  `otp_verifications` estava zerada.
- **`NODE_ENV` do shell degradava o build de produção** (#153).

### Banco

- **Baseline do schema vivo**, gerado por `pg_dump` direto (#172), e o ledger de migrations
  reconciliado a partir dele, com as 42 pendentes arquivadas (#171). Sem isso não havia como
  reproduzir o schema a partir do repositório.
- **O rollback do `db-apply` parou de mentir quando sai vazio** (#177). Ele só sabe restaurar
  definição anterior de função; para migration que cria função nova ou agenda cron, o arquivo
  saía vazio e parecia um rollback válido.

### Infraestrutura

- **Segundo projeto Supabase aposentado** (#163, fecha #41 e #85), com o `preconnect` do
  `index.html`, o `.ship-safe` com credencial versionada e a documentação que o desenhava como
  arquitetura saindo junto.
- **`send-order-whatsapp` versionada** (#173, INFRA-330) — era a última publicada sem fonte no
  repositório — e depois **despublicada** (#187, INFRA-340), morta desde 01/06/2026.
- **Identidade do pacote completada e verificador de links ligado** (#164).
- **Subagentes `implementador` e `revisor` versionados**, com o fluxo escrito no `CLAUDE.md`
  (#175). Mudança neles é mudança de processo do time e passa por PR como o resto.
- **A catraca de lint caiu de 29 min para 10 s** (#181). Uma única regra —
  `tailwindcss/no-custom-classname` — era 97,9% do tempo do eslint no Windows. Consertado com
  `--cache`, sem desligar regra nenhuma.

### Documentação

- **O PITR foi recusado por custo, e o procedimento que o substitui está escrito** (#169, #170).
  O backup continua diário: reverter uma migration custa até 24 h de dados.
- **De onde vem o risco neste repositório** (#182). Este repo é o molde que se clona por cliente,
  e o Supabase ligado aqui é de desenvolvimento — o rigor é sobre o que se replica em cada loja
  vendida, não sobre este banco.
- **Limpeza manual de branch** no CONTRIBUTING, agora que o auto-delete está desligado (#151), e
  **recuperação de branch órfã** (#152).
- **`notify-new-order` publicada e o WAF na frente dela** (#168).

### Sabido e não corrigido

- **A cobrança nunca foi exercitada contra um Mercado Pago real.** `POST /v1/payments` devolve
  `500 http is unavailable for request create_ti` para cinco corpos diferentes, inclusive o mínimo
  que a documentação pede — é a conta, não a requisição. O caminho é criar um **usuário de teste**
  no Mercado Pago. Enquanto isso não acontecer, nenhum PIX percorreu
  `pagamento → webhook → pago → push`.
- **Pedido cancelado no app que paga o PIX fica invisível se o webhook se perder** (#180). Buraco
  pré-existente, não regressão; ficou fora da Fase 3 por decisão de 10/08.
- **Como nasce o Supabase de cada loja clonada ainda não está decidido** (#183).
- **O ambiente Preview aponta para o mesmo Supabase** (#131, INFRA-270). Pedido de teste no
  Preview reserva estoque de verdade, revertido pelo `pg_cron` 35 min depois.
- **Nenhum e-mail chega a cliente**: o Resend segue em modo de teste (#161, INFRA-300).
- **`anon` tem INSERT, UPDATE, DELETE e TRUNCATE em `produtos`** (#141, BANCO-090).
- **O que a Fase 3 deliberadamente não entrega:** cartão, painel de status de pagamento (#110),
  e-mail de confirmação de pedido (#106), status em `notificacoes` (#107) e devolução de cupom em
  pedido cancelado (#116).

## [1.0.3] — 2026-08-05

Release de integridade de dados do catálogo. O Truth Gate — a camada que valida os axiomas de
produto antes de gravar — tinha seis buracos de axioma, três caminhos de escrita que não passavam
por ele, e um recibo de verificação que não provava nada. Nada disso é visível para quem compra.

O que o **lojista** vai notar são três mudanças de comportamento, todas no sentido de recusar o
que antes passava: alteração feita offline que viole um axioma agora é descartada na
sincronização com aviso, em vez de entrar calada no banco; cadastro de produto sem nome, preço ou
estoque falha na hora com mensagem; e variante com preço ou estoque negativo é rejeitada.

### Corrigido

- **Toda alteração feita offline entrava no banco sem validação nenhuma** (#145). O
  `syncOfflineUpdates` escrevia direto em `produtos` sem chamar o Truth Gate, e o enfileiramento
  gravava no `localStorage` antes de validar — e `localStorage` é editável pelo usuário. Era o
  furo mais largo: bastava editar offline para contornar a camada inteira. Agora cada item da fila
  é validado no sync. Violação de axioma é permanente, então o item é descartado em vez de voltar
  para a fila e ser retentado a cada reconexão; falha de rede continua indo para retry.
- **Variantes nunca passaram pelo Truth Gate** (#145). `priceOverride` e `stockIncrement` não eram
  validados em nenhum dos quatro caminhos de escrita — e é o `price_override` que a RPC de pedido
  usa como preço final da venda. Uma variante podia carregar preço negativo. Ganharam axiomas
  próprios, e não os do produto: um recibo dizendo `price_non_negative` para um override de
  variante mentiria sobre o que foi validado.
- **O recibo de verificação colidia entre produtos diferentes** (#145). O hash era
  `btoa(id-timestamp-status).slice(0, 16)`, e o corte em 16 caracteres base64 pega exatamente 12
  bytes — que decodificam para o id do produto mais três dígitos do ano. Medido: dois produtos, um
  a R$ 10,00 e outro a R$ 999.999,00, geravam o recibo idêntico `TUVTTU8tSUQtMjAy`. Um recibo que
  não cobre o que foi validado não serve para auditoria. Agora é um digest de 64 bits sobre a
  serialização canônica do payload, do veredito e do instante.
- **Seis axiomas que aceitavam o que deveriam recusar** (#145). Estoque negativo passava (só havia
  teto, sem piso); criação com objeto vazio passava, porque a mesma função servia patch e criação e
  "ausente" era tratado como "válido" nos dois casos; `null`, `NaN` e texto escapavam das
  comparações e chegavam ao banco como `null`; preço zero com custo positivo não avisava prejuízo; e
  — o mais comum na prática — baixar o preço abaixo do custo já gravado não gerava nem aviso, porque
  a validação enxergava só o patch e nunca a entidade mesclada.

### Infraestrutura

- **Os axiomas do Truth Gate passaram a ser cobrados pelo CI** (#146). 11 testes e 44 steps em
  `tests/`, rodando em ~40ms sem tocar rede. A suíte foi verificada por mutação: removendo o piso de
  estoque, tirando o payload do digest, desligando a exigência de campos na criação e devolvendo a
  guarda antiga da margem, cada uma delas deixa a suíte vermelha. Suíte verde que passa também com o
  código quebrado não protege nada.
- O manifesto SROS passou a declarar `stock_non_negative`, para não prometer menos do que o gate
  cobra (#145).
- As skills aposentadas em `.agents_inactive/` foram versionadas com as ressalvas de reativação
  (#147). Uma delas estava no repositório como arquivo vazio.

### Sabido e não corrigido

- O `sros_manifest.json` declara `delivery_restriction: "Monte Carmelo, MG"` como axioma, e o Truth
  Gate não valida nada de entrega. É regra de frete e não de produto — onde ela deve morar continua
  em aberto.
- Nenhuma das mudanças desta release foi exercitada no navegador. O repositório não tem runner de
  teste para `src/`, e o fluxo do admin exige sessão autenticada. O que as cobre é a suíte Deno, o
  typecheck e o lint.
- O `.gitignore` ignora `.agents/` (as skills ativas) e não ignora `.agents_inactive/`: o cemitério
  é versionado e a pasta viva não. Provavelmente não foi intencional.
- A regra de frete grátis continua escrita em 10 lugares (`FRETE-020`, #53), dependendo da decisão
  `FRETE-030`.

## [1.0.2] — 2026-08-05

Release de segurança de dados do cliente. Quatro vazamentos fechados, todos medidos contra o banco
de produção antes e depois — e nenhum deles era visível para quem compra, o que é justamente o
problema de vazamento: ninguém percebe.

O que o **lojista** vai notar são as duas outras coisas: cadastrar produto voltou a funcionar, e o
botão de pré-visualizar saiu de trás do menu.

### Corrigido

- **Faturamento consolidado da loja legível por qualquer cliente cadastrado** (#103). A RPC
  `get_category_analytics` é `SECURITY DEFINER` — ignora o RLS de pedidos, itens e produtos — e não
  tinha checagem de quem chamou, com `EXECUTE` para `authenticated`. Qualquer pessoa que criasse
  conta extraía faturamento por categoria, número de pedidos, ticket médio e frete arrecadado com
  uma chamada. Medido: um cliente comum lia 4 linhas de faturamento antes da guarda.
- **Cliente logado cancelava pedido de convidado, e a venda era desfeita** (#115). A checagem de
  dono usava `!=`, e em SQL `NULL != <uuid>` avalia para NULL, não para true. Pedido de convidado
  tem `user_id` NULL, então a exceção de autorização nunca acontecia. Cancelar devolve o estoque, e
  o id do pedido aparece na tela de sucesso, no rastreio e em qualquer print. O autocancelamento de
  convidado, que só funcionava por causa deste bug, deixou de existir — o botão passou a exigir
  sessão.
- **Margem de todo produto ativo legível por qualquer cliente cadastrado** (#119). Não era
  privilégio de coluna mal posto: `authenticated` tinha `SELECT` de tabela inteira em `produtos`, e
  a policy libera a linha pela vitrine. Medido: 18 de 18 produtos ativos, com `custo`.
- **O código de rastreio de convidado abria o pedido de outra pessoa** (#118). Era o único achado
  crítico ainda aberto da auditoria de 29/07. A tela pedia e-mail, WhatsApp e um ID de pedido
  marcado como opcional; a RPC casava os dois canais com `OR`, e o ID vazio virava um curinga que
  casava qualquer pedido. Quem soubesse o WhatsApp de um cliente recebia **na própria caixa** o
  código que abria nome, e-mail, telefone, itens, totais e endereço da vítima. E não havia limite de
  tentativas no código de 6 dígitos. Agora os dois canais são obrigatórios, o ID do pedido também,
  o código fica amarrado a um pedido só, e morre em 5 tentativas erradas.
- **Cadastro de produto novo estava quebrado** (#119, achado no caminho). O painel devolvia "Erro ao
  processar as modificações do produto". A causa: `vw_produtos_admin`, chamada em sete pontos do
  front, tinha sumido do banco sem deixar migration. A listagem sobrevivia porque cai numa view
  pública quando a de admin falha, e foi esse silêncio que segurou o defeito em produção por tempo
  indeterminado.
- **Botão "Visualizar App" escondido atrás do menu inferior** (#138). Empilhamento: o botão era
  `z-50`, o menu do admin é `z-60`, e os dois ocupavam a mesma faixa da tela no celular.

### Infraestrutura

- Cada correção de banco tem um script de prova versionado, que reproduz o defeito e mede a
  correção numa transação terminada em `ROLLBACK`. Eles moram em `scripts/db-prove-*.cjs` e rodam
  contra o banco real, não contra fixture.
- Rollback versionado para as quatro migrations. Duas delas precisaram ser escritas à mão: o
  `db-apply.cjs` só sabe fotografar função, e migration de view, grant ou `ALTER TABLE` sai com
  rollback vazio — o que é pior que rollback nenhum, porque parece uma rede de segurança. Virou a
  #140.
- A catraca de lint caiu de 7 para 6 erros de eslint, com o teto baixado no mesmo PR.

### Sabido e não corrigido

- A regra de frete grátis continua escrita em 10 lugares (`FRETE-020`, #53), dependendo da decisão
  `FRETE-030`.
- Nada avisa quando o código passa a depender de um objeto que o banco não tem. Foi assim que o
  cadastro de produto quebrou sem ninguém saber; é a `BANCO-080` (#139), aberta com a evidência.
- `anon` tem `INSERT`, `UPDATE`, `DELETE` e `TRUNCATE` em `produtos` (`BANCO-090`, #141). Hoje é
  inerte — o RLS nega por ausência de policy e o PostgREST não expõe `TRUNCATE` — mas é privilégio
  que ninguém quis dar.
- Duas telas desta release não foram exercitadas no navegador: o botão na posição nova e o fluxo
  "Rastrear sem Conta" ponta a ponta. Nenhuma das duas tem cobertura automatizada; o que as cobre é
  typecheck e lint.

## [1.0.1] — 2026-08-04

Primeira release com processo: 13 commits que estavam parados na `develop`. Três correções chegam
ao cliente; o resto é infraestrutura e documentação, invisível para quem compra.

### Corrigido

- **Frete grátis anunciado para visitante deslogado** (#128). O carrinho mostrava "GRÁTIS" nas
  opções de entrega assim que o subtotal passava de `free_shipping_min`, mas a RPC
  `create_marketplace_order_v23` só zera o frete para usuário autenticado — o convidado via
  grátis na tela e era cobrado no fechamento. Com `free_shipping_min = 100,00` e
  `shipping_fee = 10,00` em produção, era R$ 10,00 de diferença por pedido de convidado acima do
  mínimo. Corrigido em `ShippingCalculator.tsx`, e reproduzido no preview deploy antes do merge.
- **Barra de frete grátis cheia com a regra desligada** (#128). `CartReminder` não tinha guarda
  para `freeShippingMin = 0`: com a regra desativada no admin, `isFree` era sempre verdadeiro
  (todo total é `>= 0`) e o progresso dividia por zero.
- **Edge functions presas às chaves legadas do Supabase** (#7). As três funções passam a ler
  `SUPABASE_SECRET_KEYS` e `SUPABASE_PUBLISHABLE_KEYS`, com fallback para as legadas. O front
  ainda usa a legada — é a `INFRA-260` (#126).
- **`admin-carousels` inacessível por deep link** (#3). A rota era navegável em memória mas
  faltava em seis pontos do roteador manual; F5 em `/admin-carousels` caía na home.

### Infraestrutura

- **GitFlow, CI e hooks de git** (#11). `develop` como branch de integração, CI com 5 jobs
  (tipos, testes Deno, build e tamanho, varredura de segredo, catraca de lint), e hooks de
  `pre-commit`, `commit-msg` e `pre-push` via lefthook. O `npm run typecheck` passou a checar de
  verdade — era `tsc --noEmit` sem `-b`, analisando zero arquivo.
- **Limpeza da raiz do repositório** (#10). Screenshots do Playwright e PNGs saíram do controle de
  versão; `.env.bak` passou a ser ignorado.
- **Rotação de senha do banco** (#6), com runbook em `docs/runbooks/`.

### Documentação

- **ADR 0001** (#129, #132): o ambiente Preview da Vercel passa a apontar para o banco de
  produção, com regra escrita de que preview não fecha pedido nem escreve no admin. Decisão
  tomada por restrição de tempo e marcada como tal; a saída definitiva é o `INFRA-270` (#131).
- **Resgate do conhecimento do PR #1** (#130): as regras do roteador manual, das migrations do
  DataVault e dos mappers duplicados, reverificadas contra o código antes de virar texto — os
  três veredictos originais estavam errados. Mais sete armadilhas completadas e a tabela de saúde
  da engenharia remedida.
- Onboarding, backlog priorizado, metodologia, Kanban e rituais (#8, #12, #124, #125).

### Sabido e não corrigido

- A regra de frete grátis continua escrita em 10 lugares — sete no caminho do carrinho e três
  selos de catálogo. A unificação é a `FRETE-020` e depende da decisão `FRETE-030`.
- O OTP de rastreio de pedido de convidado continua entregando pedido de terceiro
  (`AUTH-010`, #118). É o único achado crítico ainda aberto da auditoria de 29/07.
