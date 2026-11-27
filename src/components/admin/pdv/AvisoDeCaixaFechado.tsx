// O aviso do fechamento quando a forma é Dinheiro e o caixa está FECHADO
// (decisão do sócio, 27/11/2026): sem caixa aberto, a venda em dinheiro não
// entra no relatório do dia. O aviso NÃO bloqueia — Registrar continua valendo;
// o botão só leva à aba Caixa do Financeiro, onde se conta a gaveta e abre.
// Quem decide QUANDO ele aparece é `FechamentoDaVenda` (consulta na escolha).
//
// `role="status"`: o leitor de tela fala uma vez, sem interromper (não é erro).
//
// REGRA DE OURO da pasta: nada de Supabase aqui.

import { Button } from "@/components/ui/button";
import { AlertTriangle } from "lucide-react";
import type { ReactElement } from "react";
import "./pdv.css";

export const TEXTO_DO_CAIXA_FECHADO =
  "Caixa fechado: abra o caixa antes de finalizar para esta venda entrar no relatório de hoje.";

export interface PropsDoAvisoDeCaixaFechado {
  /** Leva à abertura do caixa (a view navega para o Financeiro, aba Caixa). */
  readonly aoAbrirCaixa: () => void;
  /** Venda sendo registrada: trava como os outros botões da seção. */
  readonly desabilitado: boolean;
}

export function AvisoDeCaixaFechado({
  aoAbrirCaixa,
  desabilitado,
}: PropsDoAvisoDeCaixaFechado): ReactElement {
  return (
    <div role="status" className="pdv-notice">
      <p className="pdv-heading">
        <AlertTriangle aria-hidden="true" className="pdv-icon pdv-orange" />
        <span>{TEXTO_DO_CAIXA_FECHADO}</span>
      </p>
      <div className="pdv-actions">
        <Button
          type="button"
          variant="outline"
          className="pdv-secondary"
          disabled={desabilitado}
          onClick={aoAbrirCaixa}
        >
          Abrir caixa
        </Button>
      </div>
    </div>
  );
}
