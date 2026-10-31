/**
 * Catálogo em trânsito -- quem sincroniza espera quem já está baixando.
 *
 * O DEFEITO (1ª visita): a configuração da loja (3 KB) chega antes do catálogo
 * (48 KB) e liga o motor de sincronização. A rodada de reconciliação (`catchUp`)
 * lê o cofre local, acha-o VAZIO -- o catálogo só é gravado depois de baixar --
 * e baixa tudo de novo, produto por produto. O mesmo catálogo pela rede duas
 * vezes, e a vitrine troca os cartões de lugar (o cofre devolve por ordem de id).
 *
 * O CONSERTO: `buscarProdutos` (StoreContext) ABRE um registro quando começa a
 * consulta do catálogo e o FECHA quando a consulta e a gravação no cofre
 * terminaram, de qualquer jeito. O `catchUp` espera esse registro (com prazo)
 * antes de ler o cofre.
 *
 * Fica num módulo próprio, fora do motor, pelo mesmo motivo do
 * `geracao-do-cofre.ts`: o `StoreContext` precisa avisar sem depender do que
 * o motor exporta (testes substituem o motor inteiro).
 */

/** Passado esse prazo a rodada segue como se nada estivesse em voo. */
export const PRAZO_DE_ESPERA_DO_CATALOGO_MS = 8000;

type Registro = { aberto: boolean; fim: Promise<void> };

/** Só a consulta MAIS NOVA conta: a lojista consulta duas vezes (cliente e painel). */
let maisNova: Registro | null = null;

/**
 * Anota que uma consulta do catálogo começou. Devolve o `fechar`, que TEM de
 * ser chamado quando ela termina -- no sucesso (depois da gravação no cofre),
 * na falha de rede, na gravação que falha e na consulta superada. Chamar
 * `fechar` mais de uma vez é inofensivo.
 */
export function abrirCatalogoEmVoo(): () => void {
  let encerrar!: () => void;
  const registro: Registro = {
    aberto: true,
    fim: new Promise<void>((resolve) => {
      encerrar = resolve;
    }),
  };
  maisNova = registro;
  return () => {
    registro.aberto = false;
    // Fechar uma consulta antiga não apaga a mais nova que já a substituiu.
    if (maisNova === registro) maisNova = null;
    encerrar();
  };
}

/** Há consulta do catálogo em voo agora? */
export function catalogoEmVoo(): boolean {
  return maisNova?.aberto === true;
}

/**
 * Espera a consulta mais nova do catálogo terminar, no máximo `prazoMs`.
 * Nunca rejeita. Sem nada registrado volta na hora e NÃO cria relógio (quem
 * quiser evitar até o tique extra confere `catalogoEmVoo()` antes).
 * Se uma consulta ainda mais nova abrir durante a espera, espera por ela
 * também, dentro do MESMO prazo.
 */
export async function esperarCatalogoEmVoo(
  prazoMs: number = PRAZO_DE_ESPERA_DO_CATALOGO_MS,
): Promise<void> {
  if (!catalogoEmVoo()) return;
  let estourou = false;
  let relogio: ReturnType<typeof setTimeout> | undefined;
  const prazo = new Promise<void>((resolve) => {
    relogio = setTimeout(() => {
      estourou = true;
      resolve();
    }, prazoMs);
  });
  try {
    while (!estourou && catalogoEmVoo()) {
      const esperado = maisNova as Registro;
      await Promise.race([esperado.fim, prazo]);
    }
  } finally {
    clearTimeout(relogio);
  }
}
