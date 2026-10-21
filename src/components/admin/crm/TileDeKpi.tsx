import { cn } from "@/lib/utils";
import { clsx } from "clsx";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

/**
 * Casca do cartão de métrica (redesenho de 10/10/2026): a MESMA do `KpiCard`
 * de `AdminKpiCarousel` — borda de 10%, fundo zinc-900/70 com brilho no
 * topo. Local de propósito: `SUPERFICIE_DO_CRM` (PecasDoCrm) é compartilhada
 * com o Dashboard e outros cartões do CRM e não muda com esta onda.
 */
const SUPERFICIE_DO_TILE =
  "border border-admin-border bg-admin-surface bg-gradient-to-b from-white/[0.06] to-transparent";

/**
 * Um número do painel: rótulo · valor · (variação ou linha de apoio).
 * No celular o valor pode trocar para a forma compacta ("R$ 12,3 mil") —
 * só uma das duas formas fica visível por vez, então o leitor de tela lê
 * uma só. Superfície `SUPERFICIE_DO_TILE` por padrão (a linguagem do CRM,
 * usada pelos 8 KPIs de `VisaoGeralDoCrm`): sem ela, o cartão (quase da
 * mesma cor do fundo `#09090b`) não parecia um cartão.
 *
 * `superficie` existe porque este MESMO componente também é usado pelos 4
 * tiles de "Este mês" no Início (`NumerosDoMes`) — ali, o resto da tela
 * (Hoje, Para fazer, Assinatura) continua em `admin-glass`, e trocar só o
 * TileDeKpi para a superfície do CRM deixava os 4 tiles perceptivelmente
 * mais claros/"caixudos" que os outros cartões (achado da revisão,
 * confirmado no print do harness em 375/1280). O Início passa
 * `superficie="admin-glass"`; o CRM não passa nada e mantém o padrão.
 *
 * `rounded-2xl` é FIXO aqui embaixo (não faz parte de `superficie`): a
 * re-revisão pegou que `.admin-glass` (`src/index.css`) não define
 * `rounded-*` nenhum — quando o Início troca a superfície inteira, o
 * cartão perdia o canto arredondado. `SUPERFICIE_DO_CRM` (usada em vários
 * outros lugares, como `CartaoDoCrm`) tem o seu próprio `rounded-2xl` —
 * por isso o canto mora no CORPO do tile, não em `superficie`.
 *
 * Tipografia como no `KpiCard`: rótulo em frase normal 12px semibold zinc-300
 * (contraste AA), valor branco de 18px (24px de 640px em diante; dinheiro não pode cortar a 360px), rodapé
 * 12px zinc-400, ícone num selo de 32px.
 */
export function TileDeKpi({
  rotulo,
  valor,
  valorCompacto,
  icone: Icone,
  corDoIcone = "text-admin-gold",
  rodape,
  carregando = false,
  superficie = SUPERFICIE_DO_TILE,
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
      // `clsx`, não `cn`: o tailwind-merge 3 lê `bg-gradient-to-b` (Tailwind 3)
      // como cor de fundo e descartaria o `bg-admin-surface` da superfície.
      className={clsx(
        superficie,
        "flex min-h-[112px] flex-col justify-between gap-2 rounded-2xl p-3 sm:p-4",
        className,
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="min-w-0 break-words pt-0.5 text-xs font-semibold leading-tight text-zinc-300">
          {rotulo}
        </p>
        <span className="flex size-8 shrink-0 items-center justify-center rounded-xl border border-admin-border bg-white/[0.06]">
          <Icone
            className={cn("size-4 shrink-0", corDoIcone)}
            aria-hidden="true"
          />
        </span>
      </div>
      {carregando ? (
        <div className="space-y-2" aria-hidden="true">
          <div className="premium-shimmer h-6 w-3/4 rounded-lg" />
          <div className="premium-shimmer h-3 w-1/2 rounded-md" />
        </div>
      ) : (
        <div className="min-w-0 space-y-1">
          <p className="truncate text-lg font-black tabular-nums leading-tight tracking-tight text-white sm:text-2xl sm:leading-tight">
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
            <div className="min-h-4 text-xs font-medium leading-tight text-zinc-400">
              {rodape}
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
