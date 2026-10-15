import { hojeEmSaoPaulo } from "@/lib/financeiro";
import { useEffect, useState } from "react";

/**
 * O DIA de hoje no calendário da loja (`America/Sao_Paulo`, `YYYY-MM-DD`) que
 * ACOMPANHA o relógio: o painel fica aberto (ou congelado em segundo plano no
 * celular) de um dia para o outro, e um `hojeEmSaoPaulo()` calculado só ao
 * desenhar deixa "Hoje" e os períodos "Hoje"/"30 dias" presos em ontem.
 *
 * Reconfere — sem laço e sem leitura a cada desenho — quando:
 * - a tela fica ativa;
 * - o app volta a ficar visível, ganha foco ou é restaurado da memória
 *   (`visibilitychange`, `focus`, `pageshow`);
 * - chega a meia-noite de São Paulo com a tela aberta (UM temporizador por
 *   vez, armado para a virada; no máximo 1 h de espera, para o relógio do
 *   aparelho mudar, ou o aparelho dormir, não deixar o dia preso).
 *
 * Só re-renderiza quando o dia MUDA. Inativo (`ativo = false`), não registra
 * nada — a tela escondida atrás de outra aba não gasta ouvinte nem timer, e
 * confere de novo ao ficar ativa.
 */

const MS_DO_DIA = 86_400_000;
const MS_DA_HORA = 3_600_000;
/** São Paulo fica em UTC−3 o ano todo (sem horário de verão desde 2019). */
const DESLOCAMENTO_DE_SAO_PAULO_MS = 3 * MS_DA_HORA;
/** Folga depois da meia-noite, para o relógio não acordar um instante antes. */
const FOLGA_DA_VIRADA_MS = 1000;

/** Quanto falta (estimado) para a próxima meia-noite de São Paulo. */
export function msAteAViradaDoDia(agora: Date): number {
  const noDia =
    (((agora.getTime() - DESLOCAMENTO_DE_SAO_PAULO_MS) % MS_DO_DIA) +
      MS_DO_DIA) %
    MS_DO_DIA;
  return MS_DO_DIA - noDia + FOLGA_DA_VIRADA_MS;
}

/**
 * Um instante dentro do dia `YYYY-MM-DD` que `diaEmSaoPaulo`/`hojeEmSaoPaulo`
 * leem de volta como o MESMO dia (meio-dia em UTC = 9h em São Paulo). Serve
 * para alimentar as funções do painel que pedem um `Date` com o dia que o
 * hook devolveu.
 */
export function instanteDoDia(dia: string): Date {
  return new Date(`${dia}T12:00:00Z`);
}

export function useDiaDeSaoPaulo(ativo = true): string {
  const [dia, setDia] = useState(() => hojeEmSaoPaulo());

  useEffect(() => {
    if (!ativo) return;
    // O mesmo texto não re-renderiza: só a virada do dia mexe na tela.
    const conferir = () => setDia(hojeEmSaoPaulo());
    const aoFicarVisivel = () => {
      if (document.visibilityState === "visible") conferir();
    };

    let timer: ReturnType<typeof setTimeout> | undefined;
    const armar = () => {
      timer = setTimeout(
        () => {
          conferir();
          armar();
        },
        Math.min(msAteAViradaDoDia(new Date()), MS_DA_HORA),
      );
    };

    conferir();
    armar();
    document.addEventListener("visibilitychange", aoFicarVisivel);
    window.addEventListener("focus", conferir);
    window.addEventListener("pageshow", conferir);
    return () => {
      if (timer !== undefined) clearTimeout(timer);
      document.removeEventListener("visibilitychange", aoFicarVisivel);
      window.removeEventListener("focus", conferir);
      window.removeEventListener("pageshow", conferir);
    };
  }, [ativo]);

  return dia;
}
