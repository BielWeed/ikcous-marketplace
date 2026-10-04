/**
 * E-mail de pagador para ensaio de cartão em MODO DE TESTE do Mercado Pago —
 * só na prévia de desenvolvimento (autorizado pelo dono em 04/10/2026).
 *
 * A doc da Orders API (checkout-api-orders/integration-test/cards) diz que o
 * único e-mail de pagador aceito com credenciais de teste é
 * `test@testuser.com`; com o e-mail real do cliente a order de teste é criada
 * e fica pendente. Esta opção troca o e-mail SÓ DA TENTATIVA de cartão, sem
 * mexer em segredo do servidor nem em configuração compartilhada.
 *
 * Liga somente com as TRÊS condições:
 *  - `import.meta.env.DEV === true` (o build de produção troca `DEV` por
 *    `false` e o ramo inteiro some);
 *  - `import.meta.env.MODE === "development"` (o servidor de desenvolvimento;
 *    fecha a brecha de um `.env` com `NODE_ENV=development` num build de
 *    produção, que liga o `DEV` mas deixa o modo em "production");
 *  - `VITE_MP_TEST_PAYER_EMAIL` igual, byte a byte, ao literal abaixo.
 * Qualquer outra coisa (ausente, vazio, com espaço, outro e-mail) desliga e o
 * fluxo normal segue idêntico.
 */
export const EMAIL_DE_TESTE_DO_MERCADO_PAGO = "test@testuser.com";

export type AmbienteDoEmailDeTeste = {
  readonly dev: unknown;
  readonly modo: unknown;
  readonly valor: unknown;
};

function ambienteDoBuild(): AmbienteDoEmailDeTeste {
  return {
    dev: import.meta.env.DEV,
    modo: import.meta.env.MODE,
    valor: import.meta.env.VITE_MP_TEST_PAYER_EMAIL,
  };
}

/** O literal de teste quando a opção está ligada; `null` em todo o resto. */
export function emailDeTesteDoMercadoPago(
  ambiente: AmbienteDoEmailDeTeste = ambienteDoBuild(),
): string | null {
  return ambiente.dev === true &&
    ambiente.modo === "development" &&
    ambiente.valor === EMAIL_DE_TESTE_DO_MERCADO_PAGO
    ? EMAIL_DE_TESTE_DO_MERCADO_PAGO
    : null;
}
