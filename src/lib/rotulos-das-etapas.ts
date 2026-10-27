/**
 * Os nomes das quatro etapas do pedido, como a CLIENTE lê em toda tela
 * (ficha do pedido, lista "Meus pedidos" e linha do tempo do Perfil). Antes
 * cada tela tinha o seu ("Separação" / "Preparando" / "Separado", "Em rota" /
 * "A caminho") e a mesma etapa parecia outra de uma tela para a outra.
 * Só o texto: a lógica de etapas continua em cada tela.
 *
 * Na retirada na loja a etapa "A caminho" se chama "Pronto para retirar"
 * (`ROTULO_RETIRADA_PRONTA`; a lista, mais apertada, usa a forma curta).
 */
export const ROTULOS_DAS_ETAPAS = {
  recebido: "Recebido",
  separado: "Separado",
  aCaminho: "A caminho",
  entregue: "Entregue",
} as const;

export const ROTULO_RETIRADA_PRONTA = "Pronto para retirar";
export const ROTULO_RETIRADA_PRONTA_CURTO = "Pronto p/ retirar";
