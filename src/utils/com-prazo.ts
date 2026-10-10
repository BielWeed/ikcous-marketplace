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
 *
 * Quem precisa desfazer o que o trabalho atrasado deixou para trás (ex.: o
 * arquivo que um upload lento acabou gravando no armazenamento depois de a
 * tela já o ter dado por falha) passa `aoChegarDepois`: chamado com o valor da
 * promessa SÓ se ela resolver depois do estouro. Se resolver dentro do prazo,
 * nunca é chamado. Erro lançado por ele é engolido (log) -- limpeza tardia não
 * pode virar rejeição sem dono.
 */
export function comPrazo<T>(
  promessa: Promise<T>,
  prazoMs: number,
  aoEstourar?: () => void,
  aoChegarDepois?: (valor: T) => void,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let estourou = false;
    const relogio = setTimeout(() => {
      estourou = true;
      aoEstourar?.();
      reject(new PrazoEsgotado(prazoMs));
    }, prazoMs);
    promessa.then(
      (valor) => {
        clearTimeout(relogio);
        if (estourou) {
          try {
            aoChegarDepois?.(valor);
          } catch (erro) {
            console.error("[comPrazo] falha ao tratar resultado tardio:", erro);
          }
          return;
        }
        resolve(valor);
      },
      (erro) => {
        clearTimeout(relogio);
        reject(erro);
      },
    );
  });
}
