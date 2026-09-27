import { SUPERFICIE_DO_CRM } from "@/components/admin/crm/PecasDoCrm";
import { cn } from "@/lib/utils";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

/**
 * Um número do painel: rótulo · valor · (variação ou linha de apoio).
 * No celular o valor pode trocar para a forma compacta ("R$ 12,3 mil") —
 * só uma das duas formas fica visível por vez, então o leitor de tela lê
 * uma só. Superfície de `SUPERFICIE_DO_CRM` por padrão (a linguagem do
 * CRM, usada pelos 8 KPIs de `VisaoGeralDoCrm`): sem ela, o cartão (quase
 * da mesma cor do fundo `#09090b`) não parecia um cartão.
 *
 * `superficie` existe porque este MESMO componente também é usado pelos 4
 * tiles de "Este mês" no Início (`NumerosDoMes`) — ali, o resto da tela
 * (Hoje, Para fazer, Assinatura) continua em `admin-glass`, e trocar só o
 * TileDeKpi para `SUPERFICIE_DO_CRM` deixava os 4 tiles perceptivelmente
 * mais claros/"caixudos" que os outros cartões (achado da revisão,
 * confirmado no print do harness em 375/1280). O Início passa
 * `superficie="admin-glass"`; o CRM não passa nada e mantém o padrão.
 *
 * `rounded-2xl` é FIXO aqui embaixo (não faz parte de `superficie`): a
 * re-revisão pegou que `.admin-glass` (`src/index.css`) não define
 * `rounded-*` nenhum — quando o Início troca a superfície inteira, o
 * cartão perdia o canto arredondado. `SUPERFICIE_DO_CRM` também tem
 * `rounded-2xl` (redundante quando ela é a superfície ativa, inofensivo:
 * é a mesma classe duas vezes), mas ela é usada em vários outros lugares
 * (`CartaoDoCrm` etc.) que não podem perder o canto — por isso o canto
 * mora no CORPO do tile, não em `SUPERFICIE_DO_CRM`.
 */
export function TileDeKpi({
  rotulo,
  valor,
  valorCompacto,
  icone: Icone,
  corDoIcone = "text-admin-gold",
  rodape,
  carregando = false,
  superficie = SUPERFICIE_DO_CRM,
  className,
}: Readonly<{
  rotulo: string;
  valor: string;
  valorCompacto?: string;
  icone: LucideIcon;
  corDoIcone?: string;
  rodape?: ReactNode;
  carregando?: boolean;
  superficie?: string;
  className?: string;
}>) {
  return (
    <div
      className={cn(
        superficie,
        "flex min-h-[112px] flex-col justify-between gap-2 rounded-2xl p-3 sm:p-4",
        className,
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-[10px] font-black uppercase leading-tight tracking-widest text-zinc-400">
          {rotulo}
        </p>
        <Icone
          className={cn("size-4 shrink-0", corDoIcone)}
          aria-hidden="true"
        />
      </div>
      {carregando ? (
        <div className="space-y-2" aria-hidden="true">
          <div className="premium-shimmer h-6 w-3/4 rounded-lg" />
          <div className="premium-shimmer h-3 w-1/2 rounded-md" />
        </div>
      ) : (
        <div className="min-w-0 space-y-1">
          <p className="truncate text-lg font-black tabular-nums tracking-tight text-white sm:text-2xl">
            {valorCompacto && valorCompacto !== valor ? (
              <>
                <span className="sm:hidden">{valorCompacto}</span>
                <span className="hidden sm:inline">{valor}</span>
              </>
            ) : (
              valor
            )}
          </p>
          {rodape ? (
            <div className="min-h-4 text-[11px] text-zinc-400">{rodape}</div>
          ) : null}
        </div>
      )}
    </div>
  );
}
