/**
 * A TRAVA ANTI-REPETIÇÃO da atualização — no máximo 2 tentativas por
 * versão-alvo em cada aparelho (atualização única e obrigatória, 16/10/2026).
 *
 * Por que existe: em julho houve loop de recarregamento — a versão nova não
 * entrava, o app recarregava, via a atualização de novo e recarregava outra
 * vez. Sem botão de recusar, só esta trava impede que uma atualização que não
 * pega vire um aparelho preso em recarga. Esgotada, a decisão é DESISTIR EM
 * SILÊNCIO (o app continua funcionando na versão que tem).
 *
 * A chave começa com `pwa_` de propósito: está na lista branca da purga
 * (localStoragePurgeWhitelist.ts) e sobrevive a ela — a purga de versão
 * obrigatória é justamente um dos caminhos que recarrega, e se ela apagasse a
 * trava o loop voltaria.
 *
 * STORAGE QUE NÃO CONFIRMA = NÃO INSTALA (lado seguro). A contagem é gravada e
 * LIDA DE VOLTA; se o localStorage lança, está cheio, ou o valor lido não é o
 * que foi gravado, a reserva é NEGADA. Instalar sem conseguir contar é exatamente
 * o loop que a trava existe para impedir. O custo é aceitável: quem navega com
 * localStorage quebrado recebe a versão nova quando fechar todas as abas (o
 * service worker em espera assume sozinho), não por recarga automática. Não há
 * piso em memória nem em sessionStorage: eles não seriam vistos pelas outras
 * abas, e a contagem é POR APARELHO.
 *
 * A reserva é chamada SOB a reserva de instalação (exclusao-de-instalacao.ts):
 * só uma aba por vez chega aqui, então duas abas decidindo juntas não gastam
 * as 2 tentativas numa rodada só.
 */

export const CHAVE_DA_TRAVA_DE_ATUALIZACAO = "pwa_atualizacao_tentativas";

/** Tentativas por versão-alvo em cada aparelho. */
export const MAX_TENTATIVAS_POR_VERSAO = 2;

interface RegistroDaTrava {
  alvo: string;
  count: number;
  /** Instante da última tentativa que gastou orçamento (diagnóstico). */
  ultimaEm: number;
}

/** `"indisponivel"` = o storage lançou — diferente de `null` ("nada guardado"
 * ou valor ilegível, que vale como primeira tentativa). */
function ler(): RegistroDaTrava | null | "indisponivel" {
  let cru: string | null;
  try {
    cru = localStorage.getItem(CHAVE_DA_TRAVA_DE_ATUALIZACAO);
  } catch {
    return "indisponivel";
  }
  if (!cru) return null;
  try {
    const parsed = JSON.parse(cru) as Partial<RegistroDaTrava> | null;
    if (
      parsed &&
      typeof parsed.alvo === "string" &&
      typeof parsed.count === "number" &&
      typeof parsed.ultimaEm === "number"
    ) {
      return {
        alvo: parsed.alvo,
        count: parsed.count,
        ultimaEm: parsed.ultimaEm,
      };
    }
  } catch {
    // JSON corrompido: lixo vale como primeira tentativa, nunca trava para
    // sempre por conteúdo ilegível.
  }
  return null;
}

function contagemPara(alvo: string): number | "indisponivel" {
  const registro = ler();
  if (registro === "indisponivel") return "indisponivel";
  if (!registro || registro.alvo !== alvo) return 0;
  return registro.count;
}

/** Leitura sem efeito: ainda cabe uma tentativa para esta versão-alvo? Storage
 * indisponível = não (não dá para contar, então não se instala). */
export function podeTentarAtualizar(alvo: string): boolean {
  const feitas = contagemPara(alvo);
  return feitas !== "indisponivel" && feitas < MAX_TENTATIVAS_POR_VERSAO;
}

/** Quantas tentativas já foram gastas (0 quando não há registro ou o storage
 * não responde). Só para diagnóstico e teste. */
export function tentativasFeitas(alvo: string): number {
  const feitas = contagemPara(alvo);
  return feitas === "indisponivel" ? 0 : feitas;
}

/** Gasta uma tentativa: lê, grava e CONFIRMA lendo de volta. `false` =
 * esgotada, ou o storage não confirmou — em ambos os casos, não instale. */
export function reservarTentativa(
  alvo: string,
  agora: number = Date.now(),
): boolean {
  const feitas = contagemPara(alvo);
  if (feitas === "indisponivel" || feitas >= MAX_TENTATIVAS_POR_VERSAO) {
    return false;
  }
  const novo: RegistroDaTrava = {
    alvo,
    count: feitas + 1,
    ultimaEm: agora,
  };
  try {
    localStorage.setItem(CHAVE_DA_TRAVA_DE_ATUALIZACAO, JSON.stringify(novo));
  } catch {
    return false;
  }
  const lido = ler();
  return (
    lido !== null &&
    lido !== "indisponivel" &&
    lido.alvo === alvo &&
    lido.count === novo.count
  );
}
