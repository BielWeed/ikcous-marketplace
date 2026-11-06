// Trava ENTRE ABAS para a passada de sincronização das filas offline do painel.
// A fila vive no `localStorage` (uma só para todas as abas do aparelho), mas a
// trava do módulo de cada hook só enxerga a PRÓPRIA aba: com o painel aberto em
// duas abas, as duas sincronizavam a mesma fila ao voltar a internet. A
// primeira mudava a versão do produto no servidor e a segunda, com a versão
// velha, avisava que a edição offline "não foi aplicada" — falso.
//
// O Web Lock (`navigator.locks`) é do navegador e vale entre abas; é solto
// sozinho se a aba que o tem fechar ou travar. Pedido com `ifAvailable`: a aba
// que não o consegue NÃO espera na fila e sai sem avisar (a passada em curso já
// leva a fila inteira, e o que entrar nela depois a próxima chamada pega) —
// o mesmo contrato da trava do módulo.

/**
 * Prazo do lock (e da marca de módulo) de uma passada de fila offline: uma
 * passada travada de vez (rede que troca de Wi-Fi para 4G com o socket meio
 * aberto, sem resposta nem erro) não pode impedir a fila de sair para sempre —
 * nem a desta aba, nem a das outras abas do mesmo usuário. Vale para as filas
 * de produtos e de pedidos.
 */
export const PRAZO_DA_TRAVA_DA_FILA_MS = 120_000;

/**
 * Roda `passada` sob o Web Lock `nome`. Devolve `semLock` (sem rodar nada) se
 * outra aba já o tem.
 *
 * - Sem `navigator.locks` (Safari antigo, contexto sem suporte), ou se o
 *   navegador RECUSAR o pedido antes de rodar a passada (origem restrita lança
 *   `SecurityError`): roda a passada direto — vale só a trava do módulo de
 *   quem chama, como era antes. Erro lançado pela PRÓPRIA passada nunca é
 *   engolido nem reexecutado.
 * - `prazoMs`: se a passada travar de vez (rede que nunca responde), o lock é
 *   solto depois desse prazo para que uma travada não impeça a fila de sair
 *   para sempre. A passada travada continua sendo a promessa devolvida a quem
 *   a chamou.
 */
export async function comTravaEntreAbas<T>(
  nome: string,
  semLock: T,
  passada: () => Promise<T>,
  prazoMs?: number,
): Promise<T> {
  const locks = typeof navigator === "undefined" ? undefined : navigator.locks;
  if (!locks || typeof locks.request !== "function") return passada();

  let promessaDaPassada: Promise<T> | undefined;
  let pegouOLock = false;
  try {
    await locks.request(nome, { ifAvailable: true }, (lock) => {
      if (!lock) return undefined;
      pegouOLock = true;
      const minha = passada();
      promessaDaPassada = minha;
      // A falha da passada não é tratada AQUI (quem a chamou a recebe abaixo):
      // o lock só precisa saber QUANDO ela acaba.
      const terminou = minha.then(
        () => undefined,
        () => undefined,
      );
      if (prazoMs === undefined) return terminou;
      let relogio: ReturnType<typeof setTimeout> | undefined;
      const venceu = new Promise<void>((resolve) => {
        relogio = setTimeout(resolve, prazoMs);
      });
      return Promise.race([terminou, venceu]).finally(() =>
        clearTimeout(relogio),
      );
    });
  } catch (erro) {
    if (pegouOLock) throw erro;
    // O navegador recusou o pedido sem rodar nada: sem lock, só a trava do
    // módulo.
    return passada();
  }
  return promessaDaPassada ?? semLock;
}
