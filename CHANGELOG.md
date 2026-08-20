# Changelog

Formato baseado em [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/),
versionamento por [SemVer](https://semver.org/lang/pt-BR/).

Este arquivo começa na `1.0.1`, a **primeira release sob o GitFlow** implantado em 30/07/2026
(PR #11). A `1.0.0` que consta no `package.json` desde o início do projeto nunca foi tagueada e
não tem escopo registrado — não há como reconstruí-lo com honestidade, então ele não está aqui.

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
