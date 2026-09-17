# O que já está pronto (na branch `claude/app-major-upgrade-wmc8x2`, até `e3dd469`)

A descrição do PR #624 tem o resumo por área e os 18 passos de teste manual; este arquivo é a lista
completa, commit a commit, do mais novo para o mais antigo (77 commits sobre `develop`). Tudo aqui
passou por teste que falha antes, revisão em contexto limpo e CI verde.

Por área, em uma linha cada:

- **Mercado Pago (A1, completo)**: as cinco functions usam a credencial do LOJISTA (cifrada no banco)
  com falha fechada; tela de Ajustes com interruptor honesto "Receber PIX no app"; teste de conexão
  diz a causa real; prompt do agente do MP reescrito como roteiro para leigo, com a URL de notificações
  da loja; `DEPLOYMENT.md` §5.2/§5.2.1/§5.3/§5.3.2.
- **PDV (C1 a C4 + C5.1)**: quatro migrations (código de barras, canal/vendedor, RPCs
  `buscar_por_codigo_barras` e `registrar_venda_presencial`, `p_canal`); leitor (nativo + zxing
  injetado, buffer USB, debounce, bip); tela `admin-pdv` com cupom/cliente/fechamento/recibo e botão
  "Vender"; canal nos pedidos (selo, ficha, CSV, e-mail, chip "Balcão"); C5.1 leva `codigoBarras`
  do banco ao domínio e de volta.
- **Frete**: `calculate-shipping` (filtro por chave, cache tolerante, por_produto), etiqueta com frete
  grátis, histórico de cotações, tela de frete sem token, lista de etiquetas paginada, loja nova sem
  R$ 350.
- **Vitrine/cliente/checkout**: estoque honesto, notificações no celular, favoritos, checkout sem rede
  e convidado, chave de idempotência por eixo, CEP parcial, carrinho e selo de frete grátis.
- **Painel/roteador/pedidos/catálogo**: aba ativa com formulário sujo, Voltar do celular, prefetch,
  legendas honestas, cache limpo no logout, fila offline, realtime, cancelados sem repetição, deep link,
  variantes, duplicar produto, WEBP, guias do formulário, geometria do recorte.
- **Tooling/CI/docs**: send-push paginado; `src/types/supabase.ts` apagado; catraca de lint mais
  honesta e teto 485→467; workflow `publicar-functions`; comandos `/checar`, `/nova-tela`,
  `/nova-migration`, `/release`; documentos de estado.

Lista completa (`git log origin/develop..HEAD`):

```
e3dd469 feat(catalog): codigo de barras percorre dominio, mapper, gravacao e cofre do produto
4475820 style(admin): formata o teste do guia do mercado pago como o biome pede
b1a5e30 feat(admin): prompt do agente do mp guia o lojista leigo e ensina a chave de notificacoes
9906cd7 Merge remote-tracking branch 'origin/develop' into claude/app-major-upgrade-wmc8x2
63c0b9c ci(edge): workflow publicar-functions publica edge functions do supabase sob demanda
315b3a7 fix(edge): teste do mercado pago registra a causa da falha e não culpa a internet do lojista
866ba93 test(ci): a finalização da hospedagem espera as 114 linhas de _redirects com a tela admin-pdv
0ae433f chore(tooling): abaixa o teto de warnings do eslint de 485 para 467, medido no CI
e7ce07e fix(tooling): a catraca de lint reprova quando o biome não roda ou devolve resumo sem números
a63d9de feat(admin): tela de venda de balcão do PDV: cupom, cliente, fechamento pela RPC e recibo
f745091 feat(shipping): lista de etiquetas pagina, busca por pedido e marca as já emitidas
10d2cb6 feat(orders): chip 'Balcão' filtra a lista no banco e o card mostra o selo do canal
c0cebd9 fix(catalog): selo 'Frete Grátis' do produto segue o preset da loja
300770d fix(shipping): acerto de cache da calculadora seleciona a opção mais barata, não a primeira
02969c0 fix(shipping): a tela de frete não baixa o token da transportadora para acender um ponto verde
878fd29 fix(shipping): histórico de cotações mostra o motivo do erro e agrupa por destino e transportadora
3c40879 fix(cart): calculadora visível mesmo com frete grátis e meta some quando o preset não é por valor
0f4a4af fix(edge): sobras do mercado pago: eco do ler leva a chave, recusa por zero linha aconselha certo
b6eaf18 feat(orders): csv ganha a coluna Canal e o e-mail da venda de balcão diz 'Compra na loja'
46a3695 fix(shipping): etiqueta com frete grátis: o lojista escolhe o serviço e a recusa diz o motivo real
d8938a5 feat(orders): máquina de estados da venda de balcão (useVendaPresencial) com rascunho no F5
584f70b feat(orders): rótulo por canal: 'Recebido no balcão' no selo, na frase da ficha e no estorno manual
03c1aa1 fix(shipping): serviço casa por chave, cache tolera linha dupla e por_produto zera com um item
53a92b2 fix(shipping): loja nova nasce com frete grátis desligado, não com o limiar de R$ 350
fa43e0f feat(orders): o canal da venda entra no domínio: Order ganha canal e vendedorId e o mapper os lê
77eb692 fix(catalog): upload usa o tipo real da imagem recortada e guias dizem a regra real do estoque
2476b21 feat(pwa): câmera liberada no vercel.json, wasm no precache e chunk do leitor fora do Admin*
33ecf3a feat(db): a lista de pedidos do painel filtra por canal (p_canal em get_admin_orders_paged)
b8800f8 fix(orders): eco de cancelamento expira, desmonte corta o encadeamento e insert usa debounce
17f70e4 fix(checkout): chave de idempotência muda com o eixo do pagamento e cep parcial não é fora da cidade
bf3ad36 feat(catalog): leitor de código de barras: buffer físico, debounce, bip e o hook da câmera
8c4b6cf feat(db): rpc registrar_venda_presencial: a venda de balcão nasce inteira, com idempotência
8c8e5f3 fix(catalog): duplicar o mesmo produto duas vezes não perde a grade de variações
0628b4c fix(catalog): variante nova em produto com variantes salvas não quebra o lote; erro diz a regra
0854c56 feat(db): rpc buscar_por_codigo_barras: o balcão acha o produto ou a variação pelo código exato
50c260d fix(orders): ficha aberta por deep link não remonta a cada mudança em orders
ca507e6 fix(admin): painel de ajustes acompanha o interruptor do pix e avisa credencial sem teste
b5bc9d4 fix(orders): realtime insert respeita o filtro do painel; cancelados sem varredura repetida
4ad4d30 test(orders): fixtures de pedido ganham canal e vendedor_id (colunas novas da 20261160000000)
13affca feat(catalog): decodificador de código de barras com nativo e fallback zxing-wasm injetado
3bdd9f6 refactor(edge): credenciais do mercado pago exigem client de service role e fixtures viram módulo
dbc287c feat(db): código de barras em produtos e variações, canal e vendedor da venda em marketplace_orders
aaff6ea test(edge): fixtures das credenciais do mercado pago entram no repositório
389a0db fix(edge): webhook trunca o data.id no log do ramo sem credencial
5c7263e fix(edge): ligar_pix publica a public key junto, salvar desliga o pix ao trocar a credencial
b391286 fix(edge): webhook fecha com 500 quando o cofre falta e recusa lixo sem tocar no banco
0f030b3 docs(edge): deployment explica as duas origens da credencial do mercado pago e o interruptor do pix
31d37e1 feat(admin): ajustes > mercado pago ganha o interruptor honesto 'receber pix no app'
16af9ea chore(db): apaga src/types/supabase.ts (divergiu 839 linhas) e testa a trava dupla do CI de banco
57694ce fix(admin): banners: Esc fecha só o recorte; o toggle avisa falha; banner vazio num lugar só
4d9fec0 feat(edge): edge de credenciais publica a public key na loja e ganha ligar/desligar do PIX
9ba1f5b feat(edge): as 4 functions do Mercado Pago usam a credencial do lojista, com falha fechada
43f3fc3 docs(tooling): agents, contributing e readme dizem o estado de hoje
890c794 docs(tooling): estado atual, auditorias e backlog marcam o que já fechou e o que segue aberto
ef9b8d5 refactor(ui): geometria do recorte do ImageAdjuster extraída em funções puras com 16 testes
d7ff7af fix(admin): primeiro clique em 'LTV (Gasto)' ordena como o chip; ajuda de 'Pedidos Totais' honesta
e652e16 fix(checkout): finalizar sem rede não trava o botão; convidado sai do beco na tela de sucesso
cfdf70c perf(ui): prefetchAll não baixa os 18 chunks do admin para todo cliente
d10d635 fix(admin): voltar do celular com o diálogo de banner aberto fecha só o diálogo
843a059 docs(tooling): /release descreve a mecânica real do min_app_version e a trava que existe
5677af9 docs(tooling): plano registra a verificação adversarial de PWA, catálogo e tooling
08fb635 docs(tooling): /nova-migration ensina a receita real da casa, sem BEGIN/COMMIT
493633d docs(tooling): /nova-tela traz o checklist real de registro de uma tela (12 pontos, linhas de hoje)
ad9dee9 fix(checkout): a impressão da chave de idempotência aceita o meio de pagamento
0bcf0c1 fix(catalog): favoritos de visitante refletem preço e estoque atuais do catálogo
3f024bc docs(tooling): plano da super atualização completo (14 áreas, Ondas A, B e C, PDV, decisões)
a430601 docs(tooling): /checar descreve o gate real do repo (testes, CI, lefthook, typecheck)
5efc1d3 feat(edge): módulo compartilhado resolve as credenciais do Mercado Pago do lojista com falha fechada
0e39f2f fix(orders): fila offline preserva os filtros do painel e não reativa pedido cancelado
eaec915 fix(admin): tocar a aba já ativa com formulário sujo só rola ao topo, sem abrir 'Descartar e sair'
70984d5 fix(catalog): a correção do selo 'em estoque' entra no código (completa a3d6c8c)
2f5e7dd fix(edge): send-push pagina os inscritos e respeita um orçamento de tempo, com contagem honesta
a82adea fix(auth): cache de dados do admin é limpo no logout e na troca de usuário na mesma aba
212c9a6 fix(admin): legenda do donut de categorias diz que o total é o mesmo dinheiro do Volume Total
8310636 fix(notifications): botão de excluir notificação fica visível e tocável no celular
a3d6c8c fix(catalog): página do produto não afirma 'em estoque' quando esgotado nem promete envio rápido
a583fc3 docs(tooling): plano da super atualização do app (parte 1: diagnóstico e princípios)
```
