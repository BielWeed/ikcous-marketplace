/** Prazo previsto da cobrança em milissegundos; sem data válida não há aviso. */
export function lerPrazoDoPixEmMs(expiraEm: string | null | undefined): number {
  if (!expiraEm) return Number.NaN;

  // Postgres pode entregar mais dígitos de fração do que Date.parse aceita
  // de forma interoperável. Normaliza para milissegundos sem mudar o fuso.
  return Date.parse(
    expiraEm.replace(
      /\.(\d+)(?=Z$|[+-]\d{2}:\d{2}$)/i,
      (_, fracao: string) => `.${fracao.padEnd(3, "0").slice(0, 3)}`,
    ),
  );
}

export function prazoDoPixPassou(vencimento: number, agora: number) {
  return Number.isFinite(vencimento) && agora >= vencimento;
}
