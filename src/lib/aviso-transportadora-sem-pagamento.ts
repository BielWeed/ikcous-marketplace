/**
 * O aviso "transportadora sem pagamento pelo app" (14/10/2026), como regra
 * PURA — o painel só desenha o que esta função decide.
 *
 * O defeito que ela serve: o checkout recusa o envio por transportadora
 * quando a loja não recebe pagamento pelo app (`pagamentoIncompativelComFrete`
 * em `guarda-de-frete.ts`; o banco também recusa). O cliente de outra cidade
 * vê "PAC R$ X", preenche nome, endereço e CPF e só no último passo descobre.
 * Nenhum pedido nasce errado — mas o LOJISTA nunca soube, e perdia em
 * silêncio toda venda para fora da cidade. Estas regras não mexem em nada do
 * checkout: só decidem QUANDO o painel avisa.
 */

/**
 * A transportadora está de fato OFERECIDA ao cliente de outra cidade?
 *
 * - `nomesLigados` é a lista da MESMA régua da faixa-resumo do Frete
 *   (`status-da-entrega.ts`): ligada, com chave salva e, quando o provedor
 *   exige, e-mail de contato válido. `null` = a leitura não chegou ou falhou
 *   — não se chuta, e quem chama passa `null`;
 * - loja que atende SÓ a cidade (`cobertura === "local"`) não oferece
 *   transportadora, mesmo com uma ligada; cobertura ausente vale "national"
 *   (o mesmo padrão da faixa-resumo).
 */
export function transportadoraVendeForaDaCidade(args: {
  readonly cobertura: string | null | undefined;
  readonly nomesLigados: readonly string[] | null;
}): boolean {
  if ((args.cobertura || "national") === "local") return false;
  return args.nomesLigados !== null && args.nomesLigados.length > 0;
}

/**
 * Com a transportadora vendendo, o pagamento pelo app desligado deixa o
 * cliente de outra cidade sem como finalizar a compra. Sem transportadora, o
 * pagamento pelo app desligado é só uma escolha da loja (pagar na entrega).
 */
export function transportadoraFicaSemPagamento(args: {
  readonly transportadoraVende: boolean;
  readonly pagamentoPeloAppLigado: boolean;
}): boolean {
  return args.transportadoraVende && !args.pagamentoPeloAppLigado;
}

/** O aviso fixo da tela de Frete: a loja JÁ está nesse estado. */
export const AVISO_DO_FRETE = {
  titulo: "Transportadora só funciona com pagamento pelo app ligado.",
  detalhe:
    "Hoje seus clientes de outras cidades não conseguem finalizar a compra. Ligue o pagamento pelo app para voltar a vender para fora da cidade.",
} as const;

/** O aviso de ANTES de pausar: a loja VAI entrar nesse estado. */
export const AVISO_DE_PAUSAR = {
  titulo: "Sua transportadora vai parar de vender.",
  detalhe:
    "A transportadora só funciona com pagamento pelo app ligado. Enquanto estiver pausado, seus clientes de outras cidades não conseguem finalizar a compra. Você pode retomar quando quiser.",
} as const;
