/** Limita apenas a espera da tela; a requisição pode concluir no servidor depois. */
export async function aguardarComPrazo<T>(
  requisicao: Promise<T>,
  prazoMs: number,
  erroAoEsgotar: () => Error,
): Promise<T> {
  let temporizador: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      requisicao,
      new Promise<never>((_, reject) => {
        temporizador = setTimeout(() => reject(erroAoEsgotar()), prazoMs);
      }),
    ]);
  } finally {
    if (temporizador !== undefined) clearTimeout(temporizador);
  }
}
