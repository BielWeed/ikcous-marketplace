/**
 * CONTEÚDO do guia "Mercado Pago" na tela de Ajustes — peça 20 (14/09/2026).
 *
 * Texto separado do componente DE PROPÓSITO: é o pedaço que o dono lê,
 * corrige e aprova no PR, e o único lugar onde o guia e o prompt pronto
 * existem (regra de casa: negócio escrito em dois lugares diverge). Mudar
 * o que o lojista vê = mudar SÓ este arquivo.
 *
 * Fatos medidos na doc pública do Mercado Pago em 14/09/2026 (pesquisa da
 * peça): o lojista precisa de DUAS credenciais da conta dele — Public Key e
 * Access Token de produção, criadas em developers.mercadopago.com com a
 * conta normal dele (sem aprovação de pessoa). O ambiente real (produção ×
 * teste) vem da resposta da API (`live_mode`), NÃO do prefixo da chave.
 * O assistente de IA do app do Mercado Pago existe e se chama "Mago"
 * (antes "Assistente Pessoal") — o NOME varia conforme a versão do app, e
 * o CAMINHO exato dentro do app varia também, então o guia não promete
 * nenhum dos dois: ensina a achar e, se o agente não levar lá, dá o
 * caminho direto pelo site.
 *
 * Fatos verificados na doc OFICIAL em 14/09/2026 (peça 26 — investigação
 * pedida pelo dono depois de questionar o termo "Checkout API"): a
 * integração do app é a Checkout API do Mercado Pago na variante ATUAL
 * (via Orders API — a cobrança do Pix nasce no nosso servidor, POST
 * /v1/orders), com o Payment Brick (componente oficial de interface do MP)
 * embutido na nossa tela; a variante antiga via POST /v1/payments está
 * marcada "legacy" na doc de hoje. A doc usa "Checkout Transparente" para
 * o MESMO produto — por isso o prompt cita os dois nomes. Fontes (acesso
 * 14/09/2026):
 *   https://www.mercadopago.com.br/developers/pt/docs/checkout-api-orders/overview
 *   https://www.mercadopago.com.br/developers/pt/docs/checkout-api-orders/payment-integration/pix
 *   https://www.mercadopago.com.br/developers/pt/docs/checkout-bricks/overview
 */

export type PassoDoGuia = {
  readonly titulo: string;
  readonly descricao: string;
};

/** Os 5 passos do guia, na ordem em que o lojista vive eles. */
export const PASSOS_DO_GUIA: readonly PassoDoGuia[] = [
  {
    titulo: "Abra o app do Mercado Pago",
    descricao:
      "No seu celular, entre no aplicativo do Mercado Pago com a sua conta.",
  },
  {
    titulo: "Encontre o agente de IA do app",
    descricao:
      'Procure o assistente de inteligência artificial do Mercado Pago — pode aparecer como "Mago" ou "Assistente Pessoal", dependendo da versão do app. Costuma ficar na tela inicial ou no menu; se não achar, atualize o app ou use a busca do próprio app por "assistente".',
  },
  {
    titulo: "Copie o pedido pronto e cole no agente",
    descricao:
      'Toque no botão "Copiar prompt" aqui embaixo, cole o texto no agente do Mercado Pago e envie. Ele vai te guiar até as chaves da sua conta.',
  },
  {
    titulo: "Siga a orientação do agente",
    descricao:
      'As chaves ficam no painel de desenvolvedores do Mercado Pago (developers.mercadopago.com), com a MESMA conta do seu app. Se o agente não conseguir te levar até lá, o caminho direto é: entrar no site com a sua conta, abrir "Suas integrações", criar a aplicação da sua loja e abrir "Credenciais de produção".',
  },
  {
    titulo: "Volte aqui, cole as chaves, salve e teste",
    descricao:
      'Copie a Public Key e o Access Token de produção e cole nos campos abaixo. Toque em "Salvar chaves" e depois em "Testar conexão" — a resposta aparece aqui mesmo, na hora.',
  },
];

/**
 * O PROMPT PRONTO que o lojista cola no agente de IA do app do Mercado
 * Pago. Pedidos do dono (14/09): pronto para copiar, português de gente,
 * sem prometer o que o agente do MP não faz (ele ORIENTA; quem cria as
 * credenciais é o lojista no painel dele). Diz que as chaves são secretas —
 * o lojista não deve colá-las no chat nem enviá-las a ninguém.
 *
 * Melhoria pedida pelo dono (14/09 à noite): o lojista é LEIGO — o prompt
 * agora diz a tecnologia exata da nossa integração (Checkout API, Pix criado
 * pela API do Mercado Pago dentro do app, sem site externo), pede guia
 * INTERATIVO de UM passo por vez com confirmação, onde tocar exatamente,
 * explicação de palavras difíceis, produção × teste, e reforça a segurança
 * das chaves.
 *
 * Correção da peça 26 (14/09, investigação com a doc oficial — o dono
 * questionou o termo): "Checkout API" estava CERTO e continua no prompt,
 * com a descrição reescrita para bater com a doc de HOJE — o mesmo produto
 * que a doc também chama de "Checkout Transparente", na variante via Orders
 * API (a cobrança do Pix nasce no nosso servidor), com o componente oficial
 * de pagamento (Payment Brick) embutido na nossa tela. Os endpoints ficam no
 * código, não no prompt — provas no relatório o-que-nosso-app-usa.md na mesa.
 */
export const PROMPT_PARA_AGENTE_MP = `Olá! Eu tenho uma loja que vende dentro do MEU PRÓPRIO aplicativo (o app da minha marca) e quero receber pagamento de PIX dentro dele, pelo Mercado Pago. Meu app foi montado para usar a integração oficial chamada CHECKOUT API do Mercado Pago (na documentação ela também aparece como Checkout Transparente): a tela de pagamento abre dentro do meu aplicativo, com o componente oficial de pagamento do Mercado Pago embutido nela, e o Pix do cliente é criado automaticamente pelo meu sistema conversando direto com a API do Mercado Pago — não usa maquininha, nem link de pagamento, nem site externo.

Para isso eu preciso de 2 credenciais da MINHA própria conta do Mercado Pago, e as duas têm que ser de PRODUÇÃO (as de verdade, que recebem dinheiro de verdade — não as de teste):
1) PUBLIC KEY (chave pública)
2) ACCESS TOKEN (token de acesso)

Me guie como se eu nunca tivesse usado o Mercado Pago na vida — eu sou leigo nesse assunto. É importante que você:
- Me dê UM passo por vez, bem curtinho, dizendo exatamente ONDE eu toco: o nome do menu, do ícone ou do botão, do jeito que aparece na tela do celular.
- Espere eu responder que consegui, antes de me dar o próximo passo.
- Explique com calma as palavras difíceis (por exemplo: o que é uma credencial, e por que tem que ser de produção e não de teste).
- Se algo não aparecer para mim, me dê o caminho alternativo: entrar com a minha conta no site developers.mercadopago.com, abrir "Suas integrações", criar a aplicação da minha loja e abrir "Credenciais de produção".
- Sempre usar a MESMA conta que eu uso no aplicativo do Mercado Pago do meu celular.
- Quando eu chegar nas credenciais, me mostrar exatamente o botão de copiar cada uma — primeiro a Public Key, depois o Access Token — e me avisar que vou colar as duas no aplicativo da minha loja, nos Ajustes, na parte "Suas chaves".

Importante: essas chaves são SECRETAS. Eu só vou usá-las no painel do Mercado Pago e no aplicativo da minha loja; nunca vou enviá-las para outra pessoa, nem colar em outro site, nem em outra conversa.`;

/** Recado de segurança exibido embaixo do formulário. */
export const RECADO_DE_SEGURANCA =
  "Suas chaves ficam guardadas cifradas no servidor do seu app. Ninguém vê o Access Token inteiro — nem aqui na tela, que mostra só o finalzinho para você reconhecer qual colou.";
