import { formatarInteiro, formatarMoeda } from "@/lib/crm";
import {
  type TomDeEstado,
  classeDoTexto,
  tomDoValor,
} from "@/lib/tons-de-estado";
import { cn } from "@/lib/utils";
import type { View } from "@/types";
import type { PainelInicio } from "@/types/painel";
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  ChevronRight,
  Wallet,
} from "lucide-react";
import {
  CARTAO_LISTA_INICIO,
  LINHA_INICIO,
  TileDoInicio,
  TituloDoInicio,
  VALOR_INICIO,
  valorNaCor,
} from "./visualDoInicio";

/**
 * "Dinheiro nas contas": saldo (branco; vermelho se negativo), a receber
 * (verde) e a pagar (vermelho), com o número de contas vencidas em vermelho.
 * Os números vêm do Financeiro e levam a ele.
 */
export function DinheiroNasContas({
  painel,
  carregando,
  onNavigate,
}: Readonly<{
  painel: PainelInicio | null;
  carregando: boolean;
  onNavigate: (view: View) => void;
}>) {
  const esqueleto = carregando && !painel;
  const vencidas = painel?.contasVencidas ?? null;
  const contas: readonly {
    titulo: string;
    detalhe: string;
    vencidas?: string;
    valor: number | null | undefined;
    icone: typeof Wallet;
    tomDoIcone: TomDeEstado;
    classeDoValor: string;
  }[] = [
    {
      titulo: "Saldo em contas",
      detalhe: "Disponível nas contas",
      valor: painel?.saldoTotal,
      icone: Wallet,
      tomDoIcone: "neutro",
      classeDoValor:
        painel?.saldoTotal != null && painel.saldoTotal < 0
          ? valorNaCor("negativo")
          : VALOR_INICIO,
    },
    {
      titulo: "A receber",
      detalhe: "Vencidas + próximos 7 dias",
      valor: painel?.aReceber7d,
      icone: ArrowDownToLine,
      tomDoIcone: "positivo",
      classeDoValor: valorNaCor(
        tomDoValor(painel?.aReceber7d) === "neutro" ? "neutro" : "positivo",
      ),
    },
    {
      titulo: "A pagar",
      detalhe: "Vencidas + próximos 7 dias",
      vencidas:
        (vencidas ?? 0) > 0
          ? `${formatarInteiro(vencidas)} ${vencidas === 1 ? "vencida" : "vencidas"}`
          : undefined,
      valor: painel?.aPagar7d,
      icone: ArrowUpFromLine,
      tomDoIcone: "negativo",
      classeDoValor: valorNaCor(
        tomDoValor(painel?.aPagar7d) === "neutro" ? "neutro" : "negativo",
      ),
    },
  ];

  return (
    <section
      aria-labelledby="inicio-contas-titulo"
      aria-busy={esqueleto}
      className="min-w-0"
    >
      <TituloDoInicio id="inicio-contas-titulo">
        Dinheiro nas contas
      </TituloDoInicio>
      <ul className={cn(CARTAO_LISTA_INICIO, "divide-y divide-admin-border")}>
        {contas.map((conta) => (
          <li key={conta.titulo}>
            <button
              type="button"
              onClick={() => onNavigate("admin-financeiro")}
              className={cn(LINHA_INICIO, "flex-wrap")}
              aria-label={`${conta.titulo} — ${formatarMoeda(conta.valor)}. ${conta.detalhe}${conta.vencidas ? `, ${conta.vencidas}` : ""}. Abrir Financeiro`}
            >
              <TileDoInicio icone={conta.icone} tom={conta.tomDoIcone} />
              <span className="min-w-28 flex-1">
                <span className="block text-base font-semibold leading-snug text-white">
                  {conta.titulo}
                </span>
                <span className="mt-0.5 block text-sm text-zinc-400">
                  {conta.detalhe}
                </span>
                {conta.vencidas ? (
                  <span
                    className={cn(
                      "block text-sm font-semibold",
                      classeDoTexto("negativo"),
                    )}
                  >
                    {conta.vencidas}
                  </span>
                ) : null}
              </span>
              <strong
                className={cn(
                  "ml-auto shrink-0 text-right text-base",
                  conta.classeDoValor,
                )}
              >
                {formatarMoeda(conta.valor)}
              </strong>
              <ChevronRight
                className="size-5 shrink-0 text-zinc-400"
                aria-hidden="true"
              />
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
