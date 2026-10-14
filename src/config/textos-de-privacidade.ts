/**
 * Todos os textos da área "Privacidade e meus dados" (cliente) e da lista de
 * pedidos de privacidade (painel da loja), num arquivo SÓ — de propósito, para a
 * revisão jurídica ler tudo num lugar e trocar sem mexer em tela.
 *
 * ⚠️ PRECISA DE REVISÃO DO DONO (e de quem entende de LGPD) antes de a loja
 * tratar este texto como definitivo. Ele descreve o que o app faz de verdade
 * hoje — o pedido é registrado e a loja atende à mão, por anonimização, nunca
 * apagando sozinha (docs/runbooks/atender-pedido-de-privacidade.md) —, mas as
 * palavras, o prazo e a lista do que "fica guardado por lei" são do dono.
 *
 * Regra de escrita: português simples, frase curta, sem jargão jurídico.
 */

/** O prazo que a loja promete para responder, em dias (mudou aqui, mudou em tudo). */
export const PRAZO_DE_RESPOSTA_EM_DIAS = 15;

/** Texto da cliente ("Privacidade e meus dados", na conta). */
export const TEXTOS_DA_CLIENTE = {
  titulo: "Privacidade e meus dados",
  abertura: "Aqui você pede à loja para mexer nos dados da sua conta.",
  guardaTitulo: "O que a loja guarda de você",
  guarda:
    "Seu nome, WhatsApp, e-mail de entrada, endereços, favoritos e o histórico dos seus pedidos.",
  apagaTitulo: "O que a exclusão apaga",
  apaga: [
    "Seu nome",
    "Seu telefone",
    "Seus endereços",
    "Seus favoritos",
    "Os avisos guardados neste aparelho",
  ],
  ficaTitulo: "O que fica guardado por lei",
  fica: "Os pedidos e as notas fiscais ficam guardados, mas sem o seu nome depois da exclusão.",
  prazo: `A loja responde em até ${PRAZO_DE_RESPOSTA_EM_DIAS} dias.`,

  botaoExcluir: "Pedir exclusão da minha conta",
  botaoCorrigirEmail: "Corrigir meu e-mail",

  confirmaExcluirTitulo: "Pedir a exclusão da sua conta?",
  confirmaExcluirTexto: `A loja vai analisar o seu pedido e responder em até ${PRAZO_DE_RESPOSTA_EM_DIAS} dias. Quando a exclusão for feita, você deixa de entrar na conta. Seus pedidos e notas ficam guardados por lei, sem o seu nome.`,
  confirmaExcluirAcao: "Sim, pedir exclusão",
  confirmaVoltar: "Voltar",

  confirmaEmailTitulo: "Corrigir o seu e-mail",
  confirmaEmailTexto: `Digite o e-mail certo. A loja vai trocar o e-mail de entrada da sua conta e responder em até ${PRAZO_DE_RESPOSTA_EM_DIAS} dias. Até lá, continue entrando com o e-mail de hoje.`,
  campoEmailRotulo: "E-mail novo",
  campoEmailDica: "Exemplo: nome@exemplo.com",
  confirmaEmailAcao: "Enviar pedido",

  emailVazio: "Digite o e-mail novo.",
  emailInvalido: "Esse e-mail não parece certo. Confira e tente de novo.",
  emailIgual: "Esse já é o e-mail da sua conta. Digite o e-mail novo.",

  enviando: "Enviando…",
  carregando: "Verificando seus pedidos…",
  falhaAoCarregar:
    "Não conseguimos ver se você já fez algum pedido. Confira a internet e tente de novo.",
  recarregar: "Ver de novo meus pedidos",

  falhaDeRede:
    "Sem conexão agora. Seu pedido não foi enviado. Confira a internet e tente de novo.",
  falhaJaExiste:
    "Você já tem um pedido igual esperando resposta da loja. Não precisa pedir de novo.",
  falhaSemSessao:
    "Sua sessão acabou. Entre na conta de novo e tente outra vez.",
  falhaGenerica:
    "Não foi possível enviar o pedido agora. Tente de novo em alguns minutos.",
} as const;

/** "Pedido enviado em 14/10/2026 — a loja responde em até 15 dias." */
export function frasePedidoEnviado(dataFormatada: string): string {
  return `Pedido enviado em ${dataFormatada} — a loja responde em até ${PRAZO_DE_RESPOSTA_EM_DIAS} dias.`;
}

/** Pedido que a loja já decidiu, visto pela cliente. */
export function fraseDecisaoDaLoja(
  situacao: "atendido" | "recusado",
  dataFormatada: string,
): string {
  return situacao === "atendido"
    ? `Pedido atendido pela loja em ${dataFormatada}.`
    : `A loja respondeu ao seu pedido em ${dataFormatada} e não pôde atendê-lo.`;
}

/** O que cada tipo de pedido se chama na tela (cliente e painel). */
export const NOME_DO_PEDIDO = {
  excluir_conta: "Exclusão da conta",
  corrigir_email: "Correção de e-mail",
} as const;

/** Texto do painel da loja (Ajustes → "Pedidos de privacidade dos clientes"). */
export const TEXTOS_DA_LOJA = {
  titulo: "Pedidos de privacidade dos clientes",
  subtitulo: "Exclusão de conta e correção de e-mail pedidas pelo app",
  explicacao: `Quando uma cliente pede para excluir a conta ou corrigir o e-mail, o pedido aparece aqui. A loja tem até ${PRAZO_DE_RESPOSTA_EM_DIAS} dias para responder. O app NÃO apaga nada sozinho: quem atende é a loja, seguindo o roteiro (anonimizar nome, telefone, endereços e favoritos, bloquear a entrada e manter os pedidos como "Cliente removido"). Depois de atender, marque o pedido aqui.`,
  vazio: "Nenhum pedido de privacidade por enquanto.",
  abertos: "Esperando resposta",
  decididos: "Já respondidos",
  carregando: "Carregando os pedidos…",
  falhaAoCarregar: "Não consegui carregar os pedidos. Tente de novo.",
  recarregar: "Tentar de novo",
  pedidoEm: "Pedido em",
  atendidoEm: "Respondido em",
  emailPedido: "E-mail pedido",
  clienteSemNome: "Cliente",
  verCliente: "Ver cliente",
  notaRotulo: "Resposta para a cliente (ela pode ler)",
  notaDica:
    "Opcional. Escreva em português simples, sem dados de outras pessoas.",
  marcarAtendido: "Marcar como atendido",
  marcarRecusado: "Não posso atender",
  salvando: "Salvando…",
  falhaAoDecidir:
    "Não consegui salvar a resposta. Confira a internet e tente de novo.",
  falhaJaDecidido:
    "Este pedido já tinha sido respondido ou você não tem mais permissão. A lista foi atualizada.",
  semBotaoDeApagar:
    "Os pedidos ficam guardados como registro. Não há botão de apagar de propósito.",
  prazoAte: "Responder até",
  prazoVencido: "Prazo vencido — responda hoje",
  listaCortada:
    "Há mais pedidos do que cabem aqui. Os mais antigos estão guardados no banco.",
  confirmaAtendidoTitulo: "Marcar como atendido?",
  confirmaAtendidoTexto:
    "Confirme só depois de fazer o que o roteiro pede (anonimizar a conta e bloquear a entrada, ou trocar o e-mail). A resposta fica registrada e não dá para mudar depois.",
  confirmaRecusadoTitulo: "Responder que não pode atender?",
  confirmaRecusadoTexto:
    "A cliente vai ver que o pedido não foi atendido e pode ler a sua nota. Escreva o motivo na nota. A resposta fica registrada e não dá para mudar depois.",
  confirmaAcaoAtendido: "Sim, já atendi",
  confirmaAcaoRecusado: "Sim, não posso atender",
  voltar: "Voltar",
} as const;
