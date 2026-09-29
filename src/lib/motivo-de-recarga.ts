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

/** Lê e LIMPA a origem gravada. `true` só quando existe origem E ela difere
 * do build atual — a prova de que a recarga trouxe outro build. Sem a chave
 * (nada gravado nesta aba, storage limpo no meio do caminho) devolve
 * `false`: sem evidência, ninguém anuncia atualização. */
export function atualizacaoTrocouDeBuild(versaoAtual: string): boolean {
  try {
    const origem = sessionStorage.getItem(CHAVE_ORIGEM_DE_ATUALIZACAO);
    sessionStorage.removeItem(CHAVE_ORIGEM_DE_ATUALIZACAO);
    return !!origem && origem !== versaoAtual;
  } catch {
    return false;
  }
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
