// O aviso do caixa quando o cupom que voltou NÃO é de hoje: a venda ficou
// aberta de ontem (ou há mais de 12 h, ou sem data). Quem decide é a lojista —
// "Continuar esta venda" ou "Descartar e começar nova" —; nada aqui apaga o
// cupom nem registra venda sozinho. A regra de quando um cupom é "velho" mora
// em `lerRascunhoComIdade` (useVendaPresencial.ts); esta seção só pergunta.
//
// REGRA DE OURO da pasta: nada de Supabase aqui.

import { Button } from "@/components/ui/button";
import { hojeEmSaoPaulo } from "@/lib/financeiro";
import { AlertTriangle } from "lucide-react";
import type { ReactElement } from "react";
import "./pdv.css";

const UM_DIA_MS = 86_400_000;

const HORA_E_MINUTO = new Intl.DateTimeFormat("pt-BR", {
  timeZone: "America/Sao_Paulo",
  hour: "2-digit",
  minute: "2-digit",
});

const DIA_E_MES = new Intl.DateTimeFormat("pt-BR", {
  timeZone: "America/Sao_Paulo",
  day: "2-digit",
  month: "2-digit",
});

/**
 * "desde ontem, às 17:42" — a data em palavras da caixa, no calendário de São
 * Paulo. Sem data (cupom gravado antes de a data existir), diz isso com todas
 * as letras em vez de chutar.
 */
export function quandoFoiAberta(salvoEm: number | null, agora: number): string {
  if (salvoEm === null) return "de uma data que o app não sabe dizer";
  const instante = new Date(salvoEm);
  const hora = HORA_E_MINUTO.format(instante);
  const dia = hojeEmSaoPaulo(instante);
  if (dia === hojeEmSaoPaulo(new Date(agora))) return `desde hoje, às ${hora}`;
  if (dia === hojeEmSaoPaulo(new Date(agora - UM_DIA_MS))) {
    return `desde ontem, às ${hora}`;
  }
  return `desde ${DIA_E_MES.format(instante)}, às ${hora}`;
}

export interface PropsDoAvisoDeVendaAntiga {
  /** Quando o cupom foi gravado (ms); `null` = a data se perdeu. */
  readonly salvoEm: number | null;
  /** `useVendaPresencial().continuarVendaAntiga`. */
  readonly aoContinuar: () => void;
  /** `useVendaPresencial().limparCupom`: zera o caixa e apaga o rascunho. */
  readonly aoDescartar: () => void;
  /** O instante em que o cupom foi lido do disco (ms) — o "agora" da frase. */
  readonly lidoEm: number;
}

export function AvisoDeVendaAntiga({
  salvoEm,
  lidoEm,
  aoContinuar,
  aoDescartar,
}: PropsDoAvisoDeVendaAntiga): ReactElement {
  return (
    <div role="alert" aria-label="Venda antiga no caixa" className="pdv-notice">
      <p className="pdv-heading">
        <AlertTriangle aria-hidden="true" className="pdv-icon pdv-orange" />
        Venda que ficou aberta
      </p>
      <p className="text-base font-bold">
        Esta venda está aberta {quandoFoiAberta(salvoEm, lidoEm)}.
      </p>
      <p className="pdv-muted">
        Confira os itens e o cliente antes de continuar. Se for de outra pessoa,
        descarte e comece uma nova. Se tiver dúvida se ela já foi registrada,
        veja em Pedidos. Nada foi registrado por este aviso.
      </p>
      <div className="pdv-actions">
        <Button
          type="button"
          variant="outline"
          className="pdv-secondary"
          onClick={aoContinuar}
        >
          Continuar esta venda
        </Button>
        <Button
          type="button"
          variant="outline"
          className="pdv-secondary"
          onClick={aoDescartar}
        >
          Descartar e começar nova
        </Button>
      </div>
    </div>
  );
}
