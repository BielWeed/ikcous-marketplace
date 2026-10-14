/**
 * "Tentar de novo" de uma aba que não baixou — o caminho PRÓPRIO.
 *
 * Por que recarregar a página: o navegador (Chromium, medido) MEMORIZA a
 * falha de um `import("./X-hash.js")` e devolve a mesma falha sem ir à rede —
 * refazer o import no mesmo carregamento não adianta, e o React.lazy ainda
 * guarda a rejeição por cima. Só uma recarga zera essa memória. Recarregar é
 * seguro aqui: rascunho do checkout e pedido pendente moram em sessionStorage
 * e o carrinho em localStorage — todos sobrevivem à recarga.
 *
 * Por que NÃO usa `recuperacao-chunk`: aquele orçamento é por VERSÃO (ciclo
 * do SW, depois purge seletivo) e existe para o caso "app velho pedindo
 * chunk que o deploy apagou". Um soluço de 3G não pode gastá-lo — gastar
 * deixa a cliente sem a recuperação de verdade quando ela for necessária.
 * Este caminho só recarrega; nunca desregistra SW nem apaga cache.
 *
 * Três saídas, nesta ordem:
 *   · rede NÃO verificada (lê /version.json por CONTEÚDO) → "sem-rede": não
 *     recarrega; a tela segue pedindo para verificar a conexão;
 *   · rede boa e a guarda de laço ainda tem recargas → recarrega;
 *   · rede boa, mas as recargas da janela acabaram → "esgotado": recarregar
 *     mais não conserta (e o laço seria pior); a tela pede para fechar e
 *     abrir o app, sem prometer rede.
 */
import { gravaMotivoDeRecarga } from "@/lib/motivo-de-recarga";
import { verificarRedeDeVerdade } from "@/lib/recuperacao-chunk";

export const CHAVE_RECARGAS_DE_ABA_QUE_FALHOU = "pwa_aba_falhou_recargas";

/** Recargas deste caminho permitidas dentro da janela. */
export const MAX_RECARGAS_DE_ABA_QUE_FALHOU = 2;

/** Janela da guarda de laço (5 minutos). */
export const JANELA_RECARGAS_DE_ABA_QUE_FALHOU_MS = 5 * 60 * 1000;

export type ResultadoDoTentarDeNovo = "cancelada" | "sem-rede" | "esgotado";

interface EstadoDaGuarda {
  inicio: number;
  count: number;
}

/** Reserva UMA recarga na guarda (check-and-set síncrono, sessionStorage:
 * é da aba e sobrevive à recarga). Storage indisponível = não dá para provar
 * que não há laço → recusa (falha fechado). */
export function reservarRecargaDeAbaQueFalhou(
  agora: number = Date.now(),
): boolean {
  try {
    let estado: EstadoDaGuarda = { inicio: agora, count: 0 };
    const cru = sessionStorage.getItem(CHAVE_RECARGAS_DE_ABA_QUE_FALHOU);
    if (cru) {
      const lido = JSON.parse(cru) as Partial<EstadoDaGuarda> | null;
      if (
        lido &&
        typeof lido.inicio === "number" &&
        typeof lido.count === "number" &&
        agora - lido.inicio < JANELA_RECARGAS_DE_ABA_QUE_FALHOU_MS
      ) {
        estado = { inicio: lido.inicio, count: lido.count };
      }
    }
    if (estado.count >= MAX_RECARGAS_DE_ABA_QUE_FALHOU) return false;
    sessionStorage.setItem(
      CHAVE_RECARGAS_DE_ABA_QUE_FALHOU,
      JSON.stringify({ inicio: estado.inicio, count: estado.count + 1 }),
    );
    return true;
  } catch {
    return false;
  }
}

/** Devolve a recarga reservada (a página não saiu — ver o prazo abaixo). */
export function devolverRecargaDeAbaQueFalhou(): void {
  try {
    const cru = sessionStorage.getItem(CHAVE_RECARGAS_DE_ABA_QUE_FALHOU);
    if (!cru) return;
    const lido = JSON.parse(cru) as Partial<EstadoDaGuarda> | null;
    if (
      !lido ||
      typeof lido.inicio !== "number" ||
      typeof lido.count !== "number"
    ) {
      return;
    }
    sessionStorage.setItem(
      CHAVE_RECARGAS_DE_ABA_QUE_FALHOU,
      JSON.stringify({
        inicio: lido.inicio,
        count: Math.max(0, lido.count - 1),
      }),
    );
  } catch {
    // sem storage a guarda já recusa; nada a devolver
  }
}

/** Quanto esperar a página sair depois do `reload()`. Se ela continua viva
 * depois disto, a recarga não aconteceu (no painel, o `beforeunload` de
 * formulário sujo mostra o aviso do navegador e o lojista pode CANCELAR). */
export const PRAZO_DA_PAGINA_SAIR_MS = 3500;

/** Resolve só quando a página NÃO saiu: se a recarga acontece, a página some
 * antes e esta promessa nunca resolve (de propósito). A reserva da guarda
 * nasce ANTES do `reload()` (check-and-set; loop-safe mesmo que a página
 * morra na hora) e é devolvida aqui quando a recarga foi cancelada — assim
 * "cancelar o aviso" não gasta recarga nem deixa o botão preso. */
export async function tentarDeNovoAbaQueNaoBaixou(): Promise<ResultadoDoTentarDeNovo> {
  if (!(await verificarRedeDeVerdade())) return "sem-rede";
  if (!reservarRecargaDeAbaQueFalhou()) return "esgotado";
  gravaMotivoDeRecarga("recuperacao-erro-modulo");
  window.location.reload();
  await new Promise<void>((resolve) =>
    setTimeout(resolve, PRAZO_DA_PAGINA_SAIR_MS),
  );
  devolverRecargaDeAbaQueFalhou();
  return "cancelada";
}
