/** O prazo estourou antes de a promessa responder. */
export class PrazoEsgotado extends Error {
  readonly prazoMs: number;

  constructor(prazoMs: number) {
    super(`Prazo de ${prazoMs} ms esgotado`);
    this.name = "PrazoEsgotado";
    this.prazoMs = prazoMs;
  }
}

/**
 * Corre `promessa` contra um relógio. Responde o que a promessa responder se
 * ela vier antes de `prazoMs`; senão rejeita com `PrazoEsgotado`.
 *
 * NÃO cancela o trabalho por baixo — uma promessa que ninguém abortou segue
 * rodando e o resultado dela é descartado. Quem precisa impedir que o resto
 * do trabalho aconteça depois do estouro (ex.: não iniciar o upload de uma
 * foto cuja compressão chegou atrasada) passa `aoEstourar`, chamado no
 * instante do estouro, e confere uma marca no seu próprio fluxo.
 */
export function comPrazo<T>(
  promessa: Promise<T>,
  prazoMs: number,
  aoEstourar?: () => void,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const relogio = setTimeout(() => {
      aoEstourar?.();
      reject(new PrazoEsgotado(prazoMs));
    }, prazoMs);
    promessa.then(
      (valor) => {
        clearTimeout(relogio);
        resolve(valor);
      },
      (erro) => {
        clearTimeout(relogio);
        reject(erro);
      },
    );
  });
}
