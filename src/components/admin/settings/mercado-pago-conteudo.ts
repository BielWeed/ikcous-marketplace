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
 *
 * Correção da tarefa mp-4 (16/09/2026): o guia parava em "salve e teste" e
 * deixava o lojista achando que o Pix do app estava resolvido — o texto
 * dizia, na prática, que o Pix seguia intocado por estas chaves. Não segue
 * mais: as chaves daqui são as que cobram o cliente, e quem abre a porta é
 * o interruptor "Receber PIX no app" (ações ligar_pix/desligar_pix da edge
 * credenciais-mercado-pago, que acendem `store_config.pagamento_online`).
 * O passo 5 passou a dizer isso com todas as letras, inclusive o atraso de
 * até 1 minuto da vitrine (cache fresco do porteiro, CACHE_FRESCO_MS).
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
      'As chaves ficam no painel de desenvolvedores do Mercado Pago (developers.mercadopago.com), com a MESMA conta do seu app. Se o agente não conseguir te levar até lá, o caminho direto é: entrar no site com a sua conta, abrir "Suas integrações", criar a aplicação da sua loja e abrir "Credenciais de produção". Nessa tela, toque em "Ativar credenciais de produção" — aceite os termos e conclua o reCAPTCHA; sem esse passo, as chaves não recebem dinheiro de verdade.',
  },
  {
    titulo: "Volte aqui: cole as chaves, salve, teste e LIGUE o PIX",
    descricao:
      'Copie a Public Key e o Access Token de produção e cole nos campos abaixo. Toque em "Salvar chaves" e depois em "Testar conexão" — a resposta aparece aqui mesmo, na hora. O campo "Chave de notificações (opcional)" é OPCIONAL: pode deixar vazio e colar depois, quando quiser — o pagamento por Pix já funciona sem ela. Com o teste dando certo, LIGUE o interruptor "Receber PIX no app": é ele que abre o Pix para o seu cliente no fim da compra — com as chaves salvas e o interruptor desligado, ninguém paga por Pix no seu app. Depois de ligar (ou desligar), a sua vitrine passa a refletir em até 1 minuto. Importante: para o dinheiro do Pix cair na sua conta, ela precisa ter uma CHAVE PIX registrada — veja isso na sua conta do Mercado Pago (área do Pix), não aqui no app.',
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
 *
 * Peça 27 (15/09, pedido do dono depois do teste REAL dele): o prompt não
 * mencionava a CHAVE DE NOTIFICAÇÕES (webhook secret) — terceira chave do
 * painel do MP, OPCIONAL nesta integração (o campo existe na tela; o Pix
 * funciona sem ela — o teste do dono foi feito sem ela). O prompt agora
 * pede ao agente o passo a passo leigo de onde copiar essa chave (área de
 * Webhooks da aplicação, se for lá), e o guia diz que ela é opcional.
 *
 * Peça 28 (17/09/2026, depois do teste real do dono): o prompt virou um
 * roteiro em blocos (quem fala, o que o app usa, o que precisa sair da
 * conversa, como guiar, a chave opcional no final, segurança) e passou a
 * ser MONTADO com o endereço de notificações desta loja — ver
 * `montarPromptParaAgenteMp` e `urlDeNotificacoesDoWebhook` abaixo.
 */
/**
 * Endereço que o Mercado Pago precisa conhecer para gerar a "Assinatura
 * secreta" das notificações: é a edge `webhook-mercadopago` do projeto da
 * loja (criar-pagamento já manda esse mesmo endereço em cada order, como
 * `notification_url`). Função pura: recebe a URL base do Supabase (a ficha
 * da loja ou o ambiente de build, ver `lerSupabaseUrl`) e devolve null quando
 * ela não existe ou não parece uma origem — o prompt então pede o endereço ao
 * lojista em vez de inventar um.
 */
export function urlDeNotificacoesDoWebhook(
  supabaseUrl: string | null | undefined,
): string | null {
  const base = (supabaseUrl ?? "").trim().replace(/\/+$/, "");
  if (!/^https?:\/\/[^\s/]+$/.test(base)) return null;
  return `${base}/functions/v1/webhook-mercadopago`;
}

export type OpcoesDoPromptParaAgenteMp = {
  /** Endereço de notificações desta loja, ou null quando desconhecido. */
  readonly urlDeNotificacoes: string | null;
};

/**
 * Monta o PROMPT PRONTO que o lojista cola no agente de IA do app do Mercado
 * Pago. Peça 28 (17/09/2026, pedido do dono depois do teste real): o prompt
 * anterior descrevia a integração, mas não dizia ao agente QUEM está falando
 * (um lojista leigo, não um programador), o que exatamente tem de sair da
 * conversa, como tirar dúvidas no meio, nem como tratar a chave de
 * notificações. Agora é um roteiro em blocos: quem fala, o que o app usa, o
 * que precisa sair, como guiar, a chave opcional no final (com o endereço
 * real de notificações desta loja, quando conhecido) e a segurança.
 *
 * Texto corrido em blocos, e não JSON, de propósito: o agente do Mercado Pago
 * é um assistente de conversa e lê português melhor do que chaves de objeto;
 * e o lojista LÊ o prompt antes de copiar — JSON o assustaria.
 */
export function montarPromptParaAgenteMp({
  urlDeNotificacoes,
}: OpcoesDoPromptParaAgenteMp): string {
  const trechoDaUrl = urlDeNotificacoes
    ? `colar exatamente este endereço no campo da URL de produção: ${urlDeNotificacoes}`
    : "colar no campo da URL de produção o endereço de notificações do meu aplicativo (eu te passo quando você pedir; ele fica com quem cuida do meu app)";

  return `QUEM ESTÁ FALANDO COM VOCÊ
Sou o dono de uma loja e NÃO sou programador. A minha loja vende dentro do MEU PRÓPRIO aplicativo (o app da minha marca), que já está pronto e funcionando. Eu só preciso pegar as credenciais da MINHA conta do Mercado Pago e colar dentro desse aplicativo, na tela de Ajustes dele. Ninguém precisa programar nada nesta conversa.

O QUE O MEU APLICATIVO USA (só para você entender o cenário)
O app usa a integração oficial CHECKOUT API do Mercado Pago (a documentação também chama de Checkout Transparente): o cliente paga por Pix sem sair do aplicativo, e o QR Code do Pix é criado pelo meu sistema falando direto com o Mercado Pago. NÃO é maquininha, NÃO é link de pagamento, NÃO é Checkout Pro e NÃO é site externo.

O QUE EU PRECISO TER EM MÃOS NO FIM DESTA CONVERSA
1) A PUBLIC KEY de PRODUÇÃO.
2) O ACCESS TOKEN de PRODUÇÃO.
As duas da MESMA conta que eu uso no app do Mercado Pago do meu celular, e as duas de PRODUÇÃO (as que recebem dinheiro de verdade). As credenciais de TESTE não me servem agora.
3) Só no final, e só se eu quiser: a CHAVE DE NOTIFICAÇÕES (no painel aparece como "Assinatura secreta", na área de Webhooks). Ela é OPCIONAL: o Pix já funciona sem ela.

COMO EU QUERO QUE VOCÊ ME GUIE
- UM passo por vez, bem curto, dizendo exatamente ONDE eu toco: o nome do menu, do ícone ou do botão, do jeito que aparece na tela. Espere eu dizer que consegui antes de passar ao próximo.
- Português simples. Se precisar usar uma palavra técnica, explique em uma frase o que ela significa (por exemplo: o que é uma credencial, e qual é a diferença entre produção e teste).
- Se eu fizer uma pergunta no meio, responda e depois volte para o passo em que paramos.
- Se algo não aparecer no app do celular, me leve pelo site: entrar em developers.mercadopago.com com a minha conta, abrir "Suas integrações", criar a aplicação da minha loja (se ainda não existir) e abrir "Credenciais de produção".
- Se aparecer o botão "Ativar credenciais de produção", me ajude a concluir esse passo (aceitar os termos e o reCAPTCHA). Sem isso as chaves não recebem dinheiro de verdade.
- Quando eu chegar nas credenciais, me mostre o botão de copiar de cada uma: primeiro a Public Key, depois o Access Token. Me lembre de colar as duas no aplicativo da minha loja, em Ajustes, Pagamentos, Mercado Pago, na parte "Suas chaves", e depois tocar em "Salvar chaves" e em "Testar conexão".
- Me lembre de conferir se a minha conta do Mercado Pago tem uma CHAVE PIX cadastrada (na área do Pix do app). Sem ela, o dinheiro do Pix não tem onde cair.

NO FINAL: A CHAVE DE NOTIFICAÇÕES, SE EU QUISER
Depois que eu tiver as duas chaves, me pergunte se quero configurar a chave de notificações agora ou deixar para depois. As duas respostas estão certas.
- Se eu quiser: explique em uma frase para que ela serve (é uma assinatura que permite ao meu aplicativo conferir que o aviso de "pagamento aprovado" veio mesmo do Mercado Pago, e não de outra pessoa). Depois me leve até ela, um passo por vez: na mesma aplicação do painel, abrir "Webhooks" (ou "Notificações"), escolher "Configurar notificações", modo "Produção", ${trechoDaUrl}, marcar os eventos de pagamento ("Pagamentos" e, se aparecer, "Pedidos" ou "Orders"), salvar, e então copiar a "Assinatura secreta" que o painel mostra. Eu vou colar essa assinatura no aplicativo da minha loja, no campo "Chave de notificações (opcional)".
- Se eu não quiser agora: tudo bem, o Pix já funciona sem ela e eu posso voltar a isso outro dia.

SEGURANÇA
Essas chaves são SECRETAS. Eu só vou usá-las no painel do Mercado Pago e dentro do aplicativo da minha loja. Não vou enviá-las para ninguém, nem colar em outro site, nem colar aqui nesta conversa. Se eu tentar colar uma chave aqui, me avise para não fazer isso.`;
}

/**
 * A versão do prompt sem o endereço desta loja — o que a tela mostra e copia
 * quando a URL do Supabase não é conhecida, e a referência dos testes de
 * conteúdo. A tela prefere `montarPromptParaAgenteMp` com o endereço real.
 */
export const PROMPT_PARA_AGENTE_MP = montarPromptParaAgenteMp({
  urlDeNotificacoes: null,
});

/** Recado de segurança exibido embaixo do formulário. */
export const RECADO_DE_SEGURANCA =
  "Suas chaves ficam guardadas cifradas no servidor do seu app. Ninguém vê o Access Token inteiro — nem aqui na tela, que mostra só o finalzinho para você reconhecer qual colou.";
