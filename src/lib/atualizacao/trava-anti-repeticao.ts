/**
 * A TRAVA ANTI-REPETIÇÃO da atualização — no máximo 2 tentativas por
 * versão-alvo E no máximo 2 por build de origem em cada aparelho (atualização
 * única e obrigatória, 16/10/2026).
 *
 * Por que existe: em julho houve loop de recarregamento — a versão nova não
 * entrava, o app recarregava, via a atualização de novo e recarregava outra
 * vez. Sem botão de recusar, só esta trava impede que uma atualização que não
 * pega vire um aparelho preso em recarga. Esgotada, a decisão é DESISTIR EM
 * SILÊNCIO (o app continua funcionando na versão que tem).
 *
 * DOIS CONTADORES, porque um só é contornável (revisão Opus, 16/10):
 *   · por versão-alvo — a chave é o alvo que o servidor disse; ela MUDA entre
 *     aberturas ("1.5.32-sha.x" quando o servidor responde, "desconhecida-de-…"
 *     quando não), e o canal realtime aceita qualquer string como versão;
 *   · por build de ORIGEM — saindo do mesmo build instalado, no máximo 2
 *     tentativas automáticas, seja qual for o alvo. Este é o teto que não se
 *     contorna trocando de chave. Quando o app é atualizado de verdade, a
 *     origem muda e o teto zera.
 * O contador de origem EXPIRA: 24 h contadas desde a PRIMEIRA tentativa daquela
 * origem (não da última — senão cada nova tentativa prorrogaria a janela para
 * sempre). Sem validade, dois erros temporários (rede ruim, deploy no meio)
 * deixariam o aparelho sem tentar nunca mais até a origem mudar, e a origem só
 * muda quando a atualização entra. Dentro da janela o teto segue valendo
 * contra a alternância de alvos; vencida, o registro recomeça do 1. O contador
 * por ALVO não expira (alvo esgotado é alvo que não pega).
 *
 * As chaves começam com `pwa_` de propósito: estão na lista branca da purga
 * (localStoragePurgeWhitelist.ts) e sobrevivem a ela — a purga de versão
 * obrigatória é justamente um dos caminhos que recarrega, e se ela apagasse a
 * trava o loop voltaria.
 *
 * STORAGE QUE NÃO CONFIRMA = NÃO INSTALA (lado seguro). Cada contagem é
 * gravada e LIDA DE VOLTA; se o localStorage lança, está cheio, ou o valor lido
 * não é o que foi gravado, a reserva é NEGADA. Instalar sem conseguir contar é
 * exatamente o loop que a trava existe para impedir. O custo é aceitável: quem
 * navega com localStorage quebrado recebe a versão nova quando fechar todas as
 * abas (o service worker em espera assume sozinho), não por recarga automática.
 * Não há piso em memória nem em sessionStorage: eles não seriam vistos pelas
 * outras abas, e a contagem é POR APARELHO.
 *
 * A reserva é chamada SOB a reserva de instalação (exclusao-de-instalacao.ts):
 * só uma aba por vez chega aqui, então duas abas decidindo juntas não gastam
 * as tentativas numa rodada só.
 *
 * `devolverTentativa`: quando a execução recusa ANTES de apagar ou recarregar
 * qualquer coisa ("agora não": sem rede, operação sensível), a tentativa
 * gasta volta — queda de internet não pode esgotar o orçamento.
 */

export const CHAVE_DA_TRAVA_DE_ATUALIZACAO = "pwa_atualizacao_tentativas";
export const CHAVE_DA_TRAVA_POR_ORIGEM = "pwa_atualizacao_tentativas_origem";

/** Tentativas por versão-alvo E por build de origem em cada aparelho. */
export const MAX_TENTATIVAS_POR_VERSAO = 2;

/** Validade do contador por build de origem, desde a primeira tentativa dele. */
export const JANELA_DO_TETO_POR_ORIGEM_MS = 24 * 60 * 60 * 1000;

interface RegistroPorAlvo {
  alvo: string;
  count: number;
  /** Instante da última tentativa que gastou orçamento (diagnóstico). */
  ultimaEm: number;
}

interface RegistroPorOrigem {
  origem: string;
  count: number;
  /** Instante da PRIMEIRA tentativa contada desta origem: abre a janela. */
  primeiraEm: number;
  ultimaEm: number;
}

/** `"indisponivel"` = o storage lançou — diferente de `null` ("nada guardado"
 * ou valor ilegível, que vale como primeira tentativa). */
function lerJson(chave: string): unknown | null | "indisponivel" {
  let cru: string | null;
  try {
    cru = localStorage.getItem(chave);
  } catch {
    return "indisponivel";
  }
  if (!cru) return null;
  try {
    return JSON.parse(cru) as unknown;
  } catch {
    // JSON corrompido: lixo vale como primeira tentativa, nunca trava para
    // sempre por conteúdo ilegível.
    return null;
  }
}

function comoPorAlvo(valor: unknown): RegistroPorAlvo | null {
  const v = valor as Partial<RegistroPorAlvo> | null;
  if (
    v &&
    typeof v.alvo === "string" &&
    typeof v.count === "number" &&
    typeof v.ultimaEm === "number"
  ) {
    return { alvo: v.alvo, count: v.count, ultimaEm: v.ultimaEm };
  }
  return null;
}

function comoPorOrigem(valor: unknown): RegistroPorOrigem | null {
  const v = valor as Partial<RegistroPorOrigem> | null;
  if (
    v &&
    typeof v.origem === "string" &&
    typeof v.count === "number" &&
    typeof v.ultimaEm === "number"
  ) {
    // Registro gravado antes de existir a janela: a última tentativa serve de
    // início (o mais conservador que se sabe).
    return {
      origem: v.origem,
      count: v.count,
      primeiraEm: typeof v.primeiraEm === "number" ? v.primeiraEm : v.ultimaEm,
      ultimaEm: v.ultimaEm,
    };
  }
  return null;
}

function contagemPorAlvo(alvo: string): number | "indisponivel" {
  const lido = lerJson(CHAVE_DA_TRAVA_DE_ATUALIZACAO);
  if (lido === "indisponivel") return "indisponivel";
  const registro = comoPorAlvo(lido);
  return registro && registro.alvo === alvo ? registro.count : 0;
}

/** O registro desta origem que ainda VALE (da origem certa e dentro das 24 h).
 * Relógio que voltou no tempo (agora < primeiraEm) não vence nada: conservador. */
function registroVigenteDaOrigem(
  origem: string,
  agora: number,
): RegistroPorOrigem | null | "indisponivel" {
  const lido = lerJson(CHAVE_DA_TRAVA_POR_ORIGEM);
  if (lido === "indisponivel") return "indisponivel";
  const registro = comoPorOrigem(lido);
  if (!registro || registro.origem !== origem) return null;
  if (agora - registro.primeiraEm >= JANELA_DO_TETO_POR_ORIGEM_MS) return null;
  return registro;
}

function contagemPorOrigem(
  origem: string,
  agora: number,
): number | "indisponivel" {
  const registro = registroVigenteDaOrigem(origem, agora);
  if (registro === "indisponivel") return "indisponivel";
  return registro ? registro.count : 0;
}

/** Leitura sem efeito: ainda cabe uma tentativa para esta versão-alvo (e, se a
 * origem foi informada, para este build de origem)? Storage indisponível = não
 * (não dá para contar, então não se instala). */
export function podeTentarAtualizar(
  alvo: string,
  origem?: string,
  agora: number = Date.now(),
): boolean {
  const feitas = contagemPorAlvo(alvo);
  if (feitas === "indisponivel" || feitas >= MAX_TENTATIVAS_POR_VERSAO) {
    return false;
  }
  if (origem === undefined) return true;
  const daOrigem = contagemPorOrigem(origem, agora);
  return daOrigem !== "indisponivel" && daOrigem < MAX_TENTATIVAS_POR_VERSAO;
}

/** Quantas tentativas já foram gastas para o alvo (0 quando não há registro
 * ou o storage não responde). Só para diagnóstico e teste. */
export function tentativasFeitas(alvo: string): number {
  const feitas = contagemPorAlvo(alvo);
  return feitas === "indisponivel" ? 0 : feitas;
}

/** Idem, para o build de origem (só as que ainda valem, dentro das 24 h). */
export function tentativasDaOrigem(
  origem: string,
  agora: number = Date.now(),
): number {
  const feitas = contagemPorOrigem(origem, agora);
  return feitas === "indisponivel" ? 0 : feitas;
}

/** Grava e CONFIRMA lendo de volta. */
function gravarEConfirmar(
  chave: string,
  valor: object,
  confere: (lido: unknown) => boolean,
): boolean {
  try {
    localStorage.setItem(chave, JSON.stringify(valor));
  } catch {
    return false;
  }
  const lido = lerJson(chave);
  return lido !== null && lido !== "indisponivel" && confere(lido);
}

/** Gasta uma tentativa: lê, grava e CONFIRMA lendo de volta. `false` =
 * esgotada (no alvo ou na origem), ou o storage não confirmou — em todos os
 * casos, não instale. Sem `origem`, vale só a conta por alvo. */
export function reservarTentativa(
  alvo: string,
  origem?: string,
  agora: number = Date.now(),
): boolean {
  const feitasAlvo = contagemPorAlvo(alvo);
  if (
    feitasAlvo === "indisponivel" ||
    feitasAlvo >= MAX_TENTATIVAS_POR_VERSAO
  ) {
    return false;
  }
  let feitasOrigem = 0;
  // Abre a janela agora; se já há registro vigente, a janela dele continua.
  let inicioDaJanela = agora;
  if (origem !== undefined) {
    const vigente = registroVigenteDaOrigem(origem, agora);
    if (vigente === "indisponivel") return false;
    if (vigente) {
      if (vigente.count >= MAX_TENTATIVAS_POR_VERSAO) return false;
      feitasOrigem = vigente.count;
      inicioDaJanela = vigente.primeiraEm;
    }
  }

  const porAlvo: RegistroPorAlvo = {
    alvo,
    count: feitasAlvo + 1,
    ultimaEm: agora,
  };
  const okAlvo = gravarEConfirmar(
    CHAVE_DA_TRAVA_DE_ATUALIZACAO,
    porAlvo,
    (l) => {
      const r = comoPorAlvo(l);
      return r !== null && r.alvo === alvo && r.count === porAlvo.count;
    },
  );
  if (!okAlvo) return false;

  if (origem !== undefined) {
    const porOrigem: RegistroPorOrigem = {
      origem,
      count: feitasOrigem + 1,
      primeiraEm: inicioDaJanela,
      ultimaEm: agora,
    };
    const okOrigem = gravarEConfirmar(
      CHAVE_DA_TRAVA_POR_ORIGEM,
      porOrigem,
      (l) => {
        const r = comoPorOrigem(l);
        return r !== null && r.origem === origem && r.count === porOrigem.count;
      },
    );
    if (!okOrigem) {
      // Não conseguiu contar na origem: devolve a do alvo e nega (lado seguro).
      devolverTentativa(alvo);
      return false;
    }
  }
  return true;
}

/** Devolve uma tentativa gasta (nunca abaixo de zero), nos contadores do alvo e
 * da origem. Melhor esforço: storage lançando não derruba. */
export function devolverTentativa(alvo: string, origem?: string): void {
  try {
    const porAlvo = comoPorAlvo(lerJson(CHAVE_DA_TRAVA_DE_ATUALIZACAO));
    if (porAlvo && porAlvo.alvo === alvo && porAlvo.count > 0) {
      localStorage.setItem(
        CHAVE_DA_TRAVA_DE_ATUALIZACAO,
        JSON.stringify({ ...porAlvo, count: porAlvo.count - 1 }),
      );
    }
    if (origem !== undefined) {
      const porOrigem = comoPorOrigem(lerJson(CHAVE_DA_TRAVA_POR_ORIGEM));
      if (porOrigem && porOrigem.origem === origem && porOrigem.count > 0) {
        localStorage.setItem(
          CHAVE_DA_TRAVA_POR_ORIGEM,
          JSON.stringify({ ...porOrigem, count: porOrigem.count - 1 }),
        );
      }
    }
  } catch {
    // Sem devolver, a tentativa fica gasta: o lado seguro.
  }
}
