// A leitura do caixa que a tela do Financeiro entrega à Visão (`AbaVisao`).
// Os testes que montam a Visão sozinha, sem a tela inteira, passam esta:
// caixa fechado e já lido (não é assunto deles). Quem testa o cartão do caixa
// monta a tela inteira e deixa o `fin_caixa_atual` responder.
export const CAIXA_FECHADO_DA_VISAO = {
  dados: { sessao: null },
  erro: null,
  carregando: false,
  recarregar: () => {},
} as const;
