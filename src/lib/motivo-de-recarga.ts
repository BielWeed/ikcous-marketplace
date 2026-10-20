/**
 * Motivo de recarga do PWA — protocolo único e HONESTO (laudo varredura
 * profunda #2, achado P-1).
 *
 * O problema: 4 lugares gravavam textos livres em `pwa_reload_reason` e o
 * consumidor (App.tsx) exibia SEMPRE "Sistema Atualizado" — 3 dos 4 caminhos
 * não eram update nenhum (erro de rede num chunk, crash do React, recuperação
 * do sentinela), então o cliente recebia a notícia de uma atualização que não
 * houve, às vezes com texto técnico cru na descrição.
 *
 * O conserto: quem grava grava um MOTIVO NOMINAL da lista abaixo; quem exibe
 * usa `descreveMotivoDeRecarga`, que traduz motivo → frase honesta e tom do
 * toast. Textos do protocolo antigo continuam legíveis (retrocompatibilidade
 * com recargas gravadas antes do conserto) — e os legítimos continuam
 * virando "Sistema Atualizado".
 */
import { partesDoNucleoSemver } from "./versao-do-servidor";

export type MotivoDeRecarga =
  | "atualizacao-aplicada"
  | "atualizacao-nao-confirmada"
  | "recuperacao-erro-modulo"
  | "recuperacao-crash"
  | "recuperacao-sentinela";

export const CHAVE_MOTIVO_DE_RECARGA = "pwa_reload_reason";

export interface RecargaDescrita {
  titulo: string;
  descricao: string;
  tom: "success" | "info" | "warning";
}

export function gravaMotivoDeRecarga(motivo: MotivoDeRecarga): void {
  try {
    localStorage.setItem(CHAVE_MOTIVO_DE_RECARGA, motivo);
  } catch {
    // storage cheio/indisponível: a recarga segue sem motivo registrado —
    // o boot só não terá toast explicativo.
  }
}

export function limpaMotivoDeRecarga(): void {
  try {
    localStorage.removeItem(CHAVE_MOTIVO_DE_RECARGA);
  } catch {
    // idem
  }
}

// ─── Evidência de build (peça 22/09/2026) ────────────────────────────────────
//
// "Sistema Atualizado" só é verdade quando o build TROCOU de verdade entre a
// partida da atualização e o boot seguinte. Quem dispara o apply sabe apenas
// o build de ORIGEM; a comparação com o build de CHEGADA só pode ser feita
// pelo boot (App.tsx), depois da recarga. A origem viaja por esta chave, em
// SESSIONSTORAGE de propósito (fechamento do achado 1 da revisão):
//   · sobrevive ao reload/replace do próprio apply — é da MESMA aba;
//   · é INVISÍVEL às abas irmãs: o boot de outra aba não pode consumir (e
//     destruir) a evidência de quem está aplicando a atualização;
//   · morre com a aba: fechou antes de recarregar, o boot mostra o neutro —
//     sempre na direção honesta, nunca sucesso inventado.

export const CHAVE_ORIGEM_DE_ATUALIZACAO = "pwa_update_from_build";

/** Grava o build que estava no ar quando a tentativa de atualização começou.
 * Gravar NÃO é afirmar sucesso — o motivo nominal de sucesso é escrito
 * separadamente, só com evidência (controllerchange), e ainda assim o boot
 * reconfere contra o build que chegou. */
export function gravaOrigemDeAtualizacao(versao: string): void {
  try {
    sessionStorage.setItem(CHAVE_ORIGEM_DE_ATUALIZACAO, versao);
  } catch {
    // storage indisponível: sem evidência, o boot mostrará o neutro.
  }
}

/** A versão que a tentativa de atualização ESPERA encontrar ao chegar (o alvo
 * lido do servidor antes de instalar). Mesma sessão de aba da origem, pelos
 * mesmos motivos. */
export const CHAVE_VERSAO_ESPERADA_DA_ATUALIZACAO =
  "pwa_update_expected_version";

/** Grava a versão-alvo da tentativa. Sem versão legível não grava nada: sem
 * expectativa, a prova é só a troca de build (como sempre foi). */
export function gravaVersaoEsperadaDaAtualizacao(
  versao: string | null | undefined,
): void {
  try {
    if (versao) {
      sessionStorage.setItem(CHAVE_VERSAO_ESPERADA_DA_ATUALIZACAO, versao);
    } else {
      sessionStorage.removeItem(CHAVE_VERSAO_ESPERADA_DA_ATUALIZACAO);
    }
  } catch {
    // storage indisponível: sem expectativa registrada.
  }
}

/** A versão que chegou serve à tentativa? Sem expectativa legível, sim (nada a
 * contradizer). Com ela, o núcleo semver que chegou tem de ser IGUAL OU MAIOR
 * (um deploy ainda mais novo no meio do caminho também é sucesso); menor ou
 * ilegível NÃO é — o boot mostra o neutro, nunca "Pronto". */
function chegouCompativelComAEsperada(
  versaoAtual: string,
  esperada: string | null,
): boolean {
  if (!esperada) return true;
  const alvo = partesDoNucleoSemver(esperada);
  if (!alvo) return true;
  const chegou = partesDoNucleoSemver(versaoAtual);
  if (!chegou) return false;
  const [cMaior, cMenor, cPatch] = chegou;
  const [aMaior, aMenor, aPatch] = alvo;
  if (cMaior !== aMaior) return cMaior > aMaior;
  if (cMenor !== aMenor) return cMenor > aMenor;
  return cPatch >= aPatch;
}

/** O que o boot descobre sobre a atualização que o recarregou. */
export interface OrigemDaAtualizacao {
  /** `true` só quando existe origem, ela difere do build atual E a versão que
   * chegou serve à versão esperada pela tentativa (quando havia uma) — a prova
   * de que a recarga trouxe o build certo. */
  readonly trocouDeBuild: boolean;
  /** O build de onde a atualização partiu, exatamente como foi gravado (a
   * versão completa, com sufixo). Nulo sem origem gravada. Com `trocouDeBuild`
   * falso (recarga que não curou) ainda vem preenchido: quem usa para
   * escolher "o que mudou" só deve olhá-lo quando houve troca. */
  readonly de: string | null;
  /** A versão que a tentativa esperava encontrar (nula quando não registrada). */
  readonly versaoEsperada: string | null;
}

/** Lê e LIMPA a origem gravada (e a versão esperada), devolvendo a evidência e
 * de onde ela veio. Sem a chave (nada gravado nesta aba, storage limpo no meio
 * do caminho ou storage lançando) devolve `trocouDeBuild: false`: sem
 * evidência, ninguém anuncia atualização. */
export function consumirOrigemDaAtualizacao(
  versaoAtual: string,
): OrigemDaAtualizacao {
  try {
    const origem = sessionStorage.getItem(CHAVE_ORIGEM_DE_ATUALIZACAO);
    const esperada = sessionStorage.getItem(
      CHAVE_VERSAO_ESPERADA_DA_ATUALIZACAO,
    );
    sessionStorage.removeItem(CHAVE_ORIGEM_DE_ATUALIZACAO);
    sessionStorage.removeItem(CHAVE_VERSAO_ESPERADA_DA_ATUALIZACAO);
    return {
      trocouDeBuild:
        !!origem &&
        origem !== versaoAtual &&
        chegouCompativelComAEsperada(versaoAtual, esperada),
      de: origem || null,
      versaoEsperada: esperada || null,
    };
  } catch {
    return { trocouDeBuild: false, de: null, versaoEsperada: null };
  }
}

/** Lê e LIMPA a origem gravada. `true` só quando existe origem E ela difere
 * do build atual — a prova de que a recarga trouxe outro build. Sem a chave
 * (nada gravado nesta aba, storage limpo no meio do caminho) devolve
 * `false`: sem evidência, ninguém anuncia atualização. */
export function atualizacaoTrocouDeBuild(versaoAtual: string): boolean {
  return consumirOrigemDaAtualizacao(versaoAtual).trocouDeBuild;
}

const DESCRICOES: Record<MotivoDeRecarga, RecargaDescrita> = {
  "atualizacao-aplicada": {
    titulo: "Sistema Atualizado",
    descricao: "A loja foi atualizada para a versão mais recente.",
    tom: "success",
  },
  "atualizacao-nao-confirmada": {
    titulo: "Aplicativo recarregado",
    descricao:
      "O aplicativo recarregou para concluir a atualização, mas não houve confirmação de que a versão nova foi instalada. Se algo parecer estranho, feche e abra de novo.",
    tom: "info",
  },
  "recuperacao-erro-modulo": {
    titulo: "Aplicativo recarregado",
    descricao:
      "Uma parte da loja não carregou (pode ter sido a internet) e o app foi recarregado automaticamente. Nenhuma versão nova foi instalada.",
    tom: "info",
  },
  "recuperacao-crash": {
    titulo: "O aplicativo se recuperou",
    descricao:
      "Ocorreu um erro inesperado e o app foi reiniciado. Se algo parecer estranho, feche e abra de novo.",
    tom: "warning",
  },
  "recuperacao-sentinela": {
    titulo: "Aplicativo recarregado",
    descricao:
      "O aplicativo ficou inativo por muito tempo e foi reiniciado automaticamente.",
    tom: "info",
  },
};

/** Textos do protocolo antigo (pré-conserto) → motivo equivalente. */
function motivoLegado(valor: string): RecargaDescrita | null {
  if (valor.includes("Sistema atualizado e otimizado")) {
    return DESCRICOES["atualizacao-aplicada"];
  }
  if (
    valor.includes("Auto-recuperação (Erro de Módulo)") ||
    valor.includes("Failed to fetch dynamically imported module")
  ) {
    return DESCRICOES["recuperacao-erro-modulo"];
  }
  if (valor.startsWith("Fatal Crash:")) {
    return DESCRICOES["recuperacao-crash"];
  }
  if (valor.startsWith("Sentinel Recovery")) {
    return DESCRICOES["recuperacao-sentinela"];
  }
  return null;
}

export function descreveMotivoDeRecarga(
  valor: string | null,
): RecargaDescrita | null {
  if (!valor) return null;

  const nominal = DESCRICOES[valor as MotivoDeRecarga];
  if (nominal) return nominal;

  const legado = motivoLegado(valor);
  if (legado) return legado;

  // Motivo desconhecido: recarregou por algo não mapeado — honesto e sem
  // inventar atualização.
  return {
    titulo: "Aplicativo recarregado",
    descricao: valor,
    tom: "info",
  };
}
