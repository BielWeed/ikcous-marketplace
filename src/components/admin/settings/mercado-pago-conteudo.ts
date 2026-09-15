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
 */
export const PROMPT_PARA_AGENTE_MP = `Oi! Eu tenho uma loja que vende pelo meu próprio aplicativo e quero ativar o pagamento pelo Mercado Pago nele. Me guie com calma, passo a passo, para eu obter as duas credenciais de PRODUÇÃO da minha própria conta do Mercado Pago: a Public Key e o Access Token.

Eu sei que elas ficam no painel de desenvolvedores do Mercado Pago (developers.mercadopago.com), na área "Suas integrações", criando a aplicação da minha loja e abrindo "Credenciais de produção". Me diga exatamente onde tocar, o que preencher e como ativar as credenciais de produção; se alguma tela não aparecer para mim, me explique o que pode estar faltando.

No final, me lembre de copiar as duas chaves completas (Public Key e Access Token) para eu colar no aplicativo da minha loja. Importante: essas chaves são secretas — eu vou digitá-las somente no painel do Mercado Pago e no aplicativo da minha loja, nunca vou enviá-las para outra pessoa nem colá-las aqui no chat.`;

/** Recado de segurança exibido embaixo do formulário. */
export const RECADO_DE_SEGURANCA =
  "Suas chaves ficam guardadas cifradas no servidor do seu app. Ninguém vê o Access Token inteiro — nem aqui na tela, que mostra só o finalzinho para você reconhecer qual colou.";
