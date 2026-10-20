/**
 * O ESTADO DA ATUALIZAÇÃO — o contrato único entre quem INSTALA (o
 * PWAUpdateGate) e quem MOSTRA (a ilha, o App) — atualização única e
 * obrigatória, 16/10/2026.
 *
 * É uma store externa mínima (sem React Context): o Gate vive num chunk lazy
 * e o App/Header/AdminLayout precisam ler sem estar na mesma árvore de
 * providers. `useSyncExternalStore` dá a leitura consistente sem tearing.
 *
 * Fases:
 *   nenhuma    — nada a anunciar.
 *   aguardando — há versão nova esperando o ponto de parada (a ilha NÃO
 *                precisa aparecer: ninguém é interrompido).
 *   instalando — a instalação começou; a página recarrega em instantes.
 *   concluida  — o boot provou que o build trocou; dura ~3 s e volta sozinha
 *                a "nenhuma".
 */
import { useSyncExternalStore } from "react";

export type FaseDaAtualizacao =
  | "nenhuma"
  | "aguardando"
  | "instalando"
  | "concluida";

export interface EstadoDaAtualizacao {
  readonly fase: FaseDaAtualizacao;
  /** Núcleo semver legível da versão nova (ex.: "1.5.32"); nulo quando o
   * servidor não disse uma versão legível — nunca um valor inventado. */
  readonly versaoNova: string | null;
}

const DURACAO_PADRAO_DA_CONCLUSAO_MS = 3000;

const ESTADO_INICIAL: EstadoDaAtualizacao = {
  fase: "nenhuma",
  versaoNova: null,
};

let estado: EstadoDaAtualizacao = ESTADO_INICIAL;
const ouvintes = new Set<() => void>();
let temporizadorDaConclusao: ReturnType<typeof setTimeout> | null = null;

function cancelarVoltaAutomatica(): void {
  if (temporizadorDaConclusao !== null) {
    clearTimeout(temporizadorDaConclusao);
    temporizadorDaConclusao = null;
  }
}

function avisarOuvintes(): void {
  for (const ouvinte of [...ouvintes]) {
    try {
      ouvinte();
    } catch {
      // Um ouvinte com defeito não pode impedir os outros de saber.
    }
  }
}

export function obterEstadoDaAtualizacao(): EstadoDaAtualizacao {
  return estado;
}

/** Atualiza só os campos informados. Não troca a referência (e não avisa
 * ninguém) quando nada mudou — o `useSyncExternalStore` exige instantâneo
 * estável. Mudar a fase cancela a volta automática da "concluida": um timer
 * velho não pode pisar numa instalação nova. */
export function definirEstadoDaAtualizacao(
  parcial: Partial<EstadoDaAtualizacao>,
): void {
  const proximo: EstadoDaAtualizacao = {
    fase: parcial.fase ?? estado.fase,
    versaoNova:
      parcial.versaoNova === undefined ? estado.versaoNova : parcial.versaoNova,
  };
  if (parcial.fase !== undefined && parcial.fase !== estado.fase) {
    cancelarVoltaAutomatica();
  }
  if (
    proximo.fase === estado.fase &&
    proximo.versaoNova === estado.versaoNova
  ) {
    return;
  }
  estado = proximo;
  avisarOuvintes();
}

function assinar(ouvinte: () => void): () => void {
  ouvintes.add(ouvinte);
  return () => {
    ouvintes.delete(ouvinte);
  };
}

export function useEstadoDaAtualizacao(): EstadoDaAtualizacao {
  return useSyncExternalStore(
    assinar,
    obterEstadoDaAtualizacao,
    obterEstadoDaAtualizacao,
  );
}

/** Fase "concluida" por ~3 s (`duracaoMs`) e volta a "nenhuma". Chamar de novo
 * reinicia o prazo. */
export function anunciarAtualizacaoConcluida(opcoes?: {
  duracaoMs?: number;
}): void {
  const duracao = opcoes?.duracaoMs ?? DURACAO_PADRAO_DA_CONCLUSAO_MS;
  cancelarVoltaAutomatica();
  definirEstadoDaAtualizacao({ fase: "concluida" });
  temporizadorDaConclusao = setTimeout(() => {
    temporizadorDaConclusao = null;
    definirEstadoDaAtualizacao({ fase: "nenhuma" });
  }, duracao);
}
