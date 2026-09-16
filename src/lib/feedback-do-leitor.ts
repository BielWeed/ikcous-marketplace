// Bip + vibração de uma leitura de código de barras aceita ou recusada.
// Mora em src/lib/ (não em src/lib/leitor/) de propósito: é vizinho de
// src/utils/haptic.ts, e a tela do PDV pode querer usar o mesmo feedback
// fora do leitor. O repositório não tinha nada de áudio até agora
// (`grep -rn "AudioContext" src/` era vazio) e já tinha vibração pronta —
// este módulo reaproveita `haptic`, não reescreve.

import { haptic } from "@/utils/haptic";

export interface FeedbackDoLeitor {
  /** Bip curto + vibração leve: leitura aceita. */
  confirmar(): void;
  /** Bip grave + vibração de erro: código desconhecido/esgotado. */
  recusar(): void;
  /** Fecha o `AudioContext`. Idempotente. */
  encerrar(): void;
}

export interface OpcoesDoFeedbackDoLeitor {
  /** Padrão `true`. */
  readonly som?: boolean;
  /** Padrão `true`. */
  readonly vibracao?: boolean;
  /** Injeção para teste — padrão resolve `AudioContext`/`webkitAudioContext` do `globalThis`. */
  readonly criarContexto?: () => AudioContext | null;
}

/** Dó agudo — bip curto de confirmação. */
const FREQUENCIA_CONFIRMAR_HZ = 1046.5;
const DURACAO_CONFIRMAR_MS = 80;

/** Grave — bip mais longo de recusa. */
const FREQUENCIA_RECUSAR_HZ = 220;
const DURACAO_RECUSAR_MS = 250;

/** Baixo de propósito: é um balcão, não um alarme. */
const GANHO_DO_BIP = 0.05;

function resolverConstrutorPadrao(): (() => AudioContext | null) | null {
  const Ctor =
    (globalThis as { AudioContext?: typeof AudioContext }).AudioContext ??
    (globalThis as { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;
  if (!Ctor) {
    return null;
  }
  return () => new Ctor();
}

export function criarFeedbackDoLeitor(
  opcoes: OpcoesDoFeedbackDoLeitor = {},
): FeedbackDoLeitor {
  const somLigado = opcoes.som ?? true;
  const vibracaoLigada = opcoes.vibracao ?? true;
  // `null` explícito, distinto de "ainda não decidido": permite diferenciar
  // "sem AudioContext neste navegador" de "ainda não tentamos criar".
  const criarContexto: () => AudioContext | null =
    opcoes.criarContexto ?? resolverConstrutorPadrao() ?? (() => null);

  // O AudioContext NASCE PREGUIÇOSO, só na primeira chamada de
  // confirmar/recusar — nunca aqui. Motivo real: o navegador só deixa tocar
  // som depois de um gesto do usuário (no PDV, o toque em "Abrir leitor");
  // criar o contexto antes disso deixa-o em "suspended" para sempre e ainda
  // acorda o aviso de autoplay no console.
  let contexto: AudioContext | null = null;
  let contextoJaTentado = false;
  let encerrado = false;

  function obterContexto(): AudioContext | null {
    if (!contextoJaTentado) {
      contextoJaTentado = true;
      try {
        contexto = criarContexto();
      } catch {
        // Som é enfeite — nunca pode derrubar uma venda.
        contexto = null;
      }
    }
    return contexto;
  }

  function tocarBip(frequenciaHz: number, duracaoMs: number): void {
    if (!somLigado || encerrado) return;
    const ctx = obterContexto();
    if (!ctx) return;

    try {
      if (ctx.state === "suspended") {
        // Retomada assíncrona: se falhar (gesto ainda não aconteceu de
        // verdade, autoplay bloqueado...), ignora — o bip simplesmente não
        // toca desta vez.
        ctx.resume().catch(() => {});
      }

      const oscilador = ctx.createOscillator();
      const ganho = ctx.createGain();
      oscilador.type = "square";
      oscilador.frequency.value = frequenciaHz;
      ganho.gain.value = GANHO_DO_BIP;
      oscilador.connect(ganho);
      ganho.connect(ctx.destination);
      oscilador.start();
      oscilador.stop(ctx.currentTime + duracaoMs / 1000);
    } catch {
      // Som é enfeite — nunca pode derrubar uma venda.
    }
  }

  function confirmar(): void {
    if (vibracaoLigada) {
      haptic.light();
    }
    tocarBip(FREQUENCIA_CONFIRMAR_HZ, DURACAO_CONFIRMAR_MS);
  }

  function recusar(): void {
    if (vibracaoLigada) {
      haptic.error();
    }
    tocarBip(FREQUENCIA_RECUSAR_HZ, DURACAO_RECUSAR_MS);
  }

  function encerrar(): void {
    if (encerrado) return;
    encerrado = true;
    if (contexto) {
      try {
        contexto.close();
      } catch {
        // Idempotente e sem efeito colateral visível — encerrar não pode
        // lançar por cima de quem está fechando a tela do PDV.
      }
    }
  }

  return { confirmar, recusar, encerrar };
}
