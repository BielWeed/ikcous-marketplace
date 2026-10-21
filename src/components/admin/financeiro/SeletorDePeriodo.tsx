import { CalendarRange, Check, ChevronDown, ChevronRight } from "lucide-react";
import { useState } from "react";

import {
  intervaloDoPeriodo,
  rotuloDoPeriodo,
  validarIntervalo,
} from "@/lib/financeiro";
import { cn } from "@/lib/utils";
import type {
  DataIso,
  IntervaloDeDatas,
  PeriodoEscolhido,
  PresetDePeriodo,
} from "@/types/financeiro";
import { FolhaFinanceira } from "./FolhaFinanceira";
import {
  CLASSE_BOTAO_PRIMARIO,
  CLASSE_BOTAO_SECUNDARIO,
  CLASSE_CAMPO,
  Campo,
  SeloFinanceiro,
} from "./partes";

const PRESETS: readonly { valor: PresetDePeriodo; rotulo: string }[] = [
  { valor: "mes_atual", rotulo: "Mês atual" },
  { valor: "mes_anterior", rotulo: "Mês anterior" },
  { valor: "7d", rotulo: "7 dias" },
  { valor: "30d", rotulo: "30 dias" },
  { valor: "ano", rotulo: "Ano" },
  { valor: "personalizado", rotulo: "Personalizado" },
];

export function OpcoesDePeriodo({
  periodo,
  hoje,
  aoEscolher,
  aoPedirPersonalizado,
}: {
  readonly periodo: PeriodoEscolhido;
  readonly hoje: DataIso;
  readonly aoEscolher: (periodo: PeriodoEscolhido) => void;
  readonly aoPedirPersonalizado: () => void;
}) {
  return (
    <div
      role="group"
      aria-label="Período"
      className="flex flex-col gap-2 rounded-3xl border border-admin-border bg-admin-surface p-3"
    >
      {PRESETS.map((preset) => (
        <button
          key={preset.valor}
          type="button"
          aria-pressed={periodo.preset === preset.valor}
          onClick={() =>
            preset.valor === "personalizado"
              ? aoPedirPersonalizado()
              : aoEscolher({ preset: preset.valor })
          }
          className={`flex min-h-16 items-center gap-3 rounded-2xl px-3 py-2 text-left text-sm font-bold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300 ${periodo.preset === preset.valor ? "bg-admin-gold/10 text-admin-gold" : "text-white hover:bg-white/5"}`}
        >
          <SeloFinanceiro
            icone={periodo.preset === preset.valor ? Check : CalendarRange}
            matiz="#7AA2FF"
          />
          <span className="min-w-0 flex-1">
            {preset.rotulo}
            <span className="mt-1 block text-xs font-normal text-zinc-400">
              {preset.valor === "personalizado"
                ? "Escolha o primeiro e o último dia"
                : rotuloDoPeriodo(
                    { preset: preset.valor },
                    intervaloDoPeriodo({ preset: preset.valor }, hoje),
                  )}
            </span>
          </span>
          <ChevronRight aria-hidden="true" className="size-4" />
        </button>
      ))}
    </div>
  );
}

/** Linha de períodos (rola de lado no celular) + o intervalo por extenso. */
export function SeletorDePeriodo({
  periodo,
  rotulo,
  aoEscolher,
  aoPedirPersonalizado,
  aoPedirOpcoes,
}: {
  readonly periodo: PeriodoEscolhido;
  readonly rotulo: string;
  readonly aoEscolher: (periodo: PeriodoEscolhido) => void;
  readonly aoPedirPersonalizado: () => void;
  readonly aoPedirOpcoes?: () => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={aoPedirOpcoes}
        aria-label={`Período: ${rotulo}`}
        className="flex min-h-12 items-center gap-2 rounded-2xl bg-admin-raised px-3 py-2 text-left text-xs text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300 lg:hidden"
      >
        <CalendarRange
          aria-hidden="true"
          className="size-5 shrink-0 text-blue-300"
        />
        <span className="min-w-0 flex-1 break-words">{rotulo}</span>
        <ChevronDown
          aria-hidden="true"
          className="size-4 shrink-0 text-zinc-400"
        />
      </button>
      <div
        role="group"
        aria-label="Período"
        className="no-scrollbar hidden gap-2 overflow-x-auto lg:flex"
      >
        {PRESETS.map((preset) => {
          const ativo = periodo.preset === preset.valor;
          return (
            <button
              key={preset.valor}
              type="button"
              aria-pressed={ativo}
              onClick={() =>
                preset.valor === "personalizado"
                  ? aoPedirPersonalizado()
                  : aoEscolher({ preset: preset.valor })
              }
              className={cn(
                "min-h-11 shrink-0 select-none rounded-full border px-4 text-xs font-black transition-colors",
                ativo
                  ? "border-admin-gold/50 bg-admin-gold/10 text-admin-gold"
                  : "border-admin-border bg-admin-raised text-zinc-400 hover:bg-white/5 hover:text-white",
              )}
            >
              {preset.rotulo}
            </button>
          );
        })}
      </div>
      <p className="hidden items-center gap-1.5 text-xs text-zinc-400 lg:flex">
        <CalendarRange aria-hidden="true" className="size-4" />
        <span>
          Período: <strong className="text-zinc-300">{rotulo}</strong>
        </span>
      </p>
    </div>
  );
}

/** Folha do período personalizado: duas datas, validadas antes de aplicar. */
export function PeriodoPersonalizadoFolha({
  inicial,
  hoje,
  aoFechar,
  aoAplicar,
}: {
  readonly inicial: IntervaloDeDatas | null;
  readonly hoje: DataIso;
  readonly aoFechar: () => void;
  readonly aoAplicar: (intervalo: IntervaloDeDatas) => void;
}) {
  const [inicio, setInicio] = useState(inicial?.inicio ?? hoje);
  const [fim, setFim] = useState(inicial?.fim ?? hoje);
  const [erro, setErro] = useState<string | null>(null);

  function aplicar() {
    const falha = validarIntervalo(inicio, fim);
    if (falha) {
      setErro(falha);
      return;
    }
    aoAplicar({ inicio, fim });
  }

  return (
    <FolhaFinanceira
      titulo="Período personalizado"
      icone={CalendarRange}
      matiz="#7AA2FF"
      descricao="Escolha o primeiro e o último dia (os dois entram na conta)."
      aoFechar={aoFechar}
      rodape={
        <div className="flex flex-col-reverse gap-3">
          <button
            type="button"
            onClick={aoFechar}
            className={`${CLASSE_BOTAO_SECUNDARIO} flex-1`}
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={aplicar}
            className={`${CLASSE_BOTAO_PRIMARIO} flex-[2]`}
          >
            Aplicar período
          </button>
        </div>
      }
    >
      <div className="grid grid-cols-1 gap-5">
        <Campo id="fin-periodo-inicio" rotulo="De">
          <input
            id="fin-periodo-inicio"
            type="date"
            value={inicio}
            onChange={(e) => {
              setInicio(e.target.value);
              setErro(null);
            }}
            className={CLASSE_CAMPO}
          />
        </Campo>
        <Campo id="fin-periodo-fim" rotulo="Até">
          <input
            id="fin-periodo-fim"
            type="date"
            value={fim}
            onChange={(e) => {
              setFim(e.target.value);
              setErro(null);
            }}
            className={CLASSE_CAMPO}
          />
        </Campo>
      </div>
      <p className="mt-4 rounded-2xl bg-sky-400/5 p-3 text-xs leading-relaxed text-zinc-400">
        Até 400 dias; a data final deve ser igual ou posterior à inicial. Datas
        futuras são permitidas.
      </p>
      {erro ? (
        <p role="alert" className="mt-3 text-xs font-bold text-red-400">
          {erro}
        </p>
      ) : null}
    </FolhaFinanceira>
  );
}
