// O aviso fixo que vai embaixo de TODA estimativa do DAS (parecer do sócio da
// Gestão Fiscal, 24/11/2026). O texto é EXATO: o teste o compara letra por letra
// com o parecer, e quem quiser mudar uma vírgula muda aqui e no parecer juntos.
//
// Cor neutra de propósito: é uma nota de rodapé, não um alerta. Só apresentação,
// sem botão nem link.

import { Info } from "lucide-react";

import { classeDoTexto } from "@/lib/tons-de-estado";
import { cn } from "@/lib/utils";

export const AVISO_DA_ESTIMATIVA =
  "Isto é uma estimativa feita só com as vendas feitas pelo app (pedidos e balcão). Não é o valor da sua guia. Vendas fora do app e lançamentos feitos à mão no Financeiro (mesmo na categoria Vendas) não entram, e produtos com ICMS-ST ou PIS/Cofins monofásico costumam pagar menos. O valor certo está na guia do Simples (PGDAS-D) ou com o seu contador.";

export function AvisoDaEstimativa() {
  return (
    <div
      role="note"
      aria-label="Aviso sobre a estimativa"
      className="mt-3 flex min-w-0 items-start gap-3 rounded-2xl border border-admin-border bg-admin-bg p-3"
    >
      <Info
        aria-hidden="true"
        className={cn("mt-0.5 size-4 shrink-0", classeDoTexto("neutro"))}
      />
      <p className="min-w-0 text-xs leading-relaxed text-zinc-300">
        {AVISO_DA_ESTIMATIVA}
      </p>
    </div>
  );
}
