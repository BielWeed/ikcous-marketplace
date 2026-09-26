import { CalendarRange } from "lucide-react";
import { useState } from "react";

import { validarIntervalo } from "@/lib/financeiro";
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
} from "./partes";

const PRESETS: readonly { valor: PresetDePeriodo; rotulo: string }[] = [
  { valor: "mes_atual", rotulo: "Mês atual" },
  { valor: "mes_anterior", rotulo: "Mês anterior" },
  { valor: "7d", rotulo: "7 dias" },
  { valor: "30d", rotulo: "30 dias" },
  { valor: "ano", rotulo: "Ano" },
  { valor: "personalizado", rotulo: "Personalizado" },
];

/** Linha de períodos (rola de lado no celular) + o intervalo por extenso. */
export function SeletorDePeriodo({
  periodo,
  rotulo,
  aoEscolher,
  aoPedirPersonalizado,
}: {
  readonly periodo: PeriodoEscolhido;
  readonly rotulo: string;
  readonly aoEscolher: (periodo: PeriodoEscolhido) => void;
  readonly aoPedirPersonalizado: () => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div
        role="group"
        aria-label="Período"
        className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 sm:mx-0 sm:px-0"
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
                  ? "border-white bg-white text-black"
                  : "border-white/10 bg-white/[0.03] text-zinc-400 hover:bg-white/5 hover:text-white",
              )}
            >
              {preset.rotulo}
            </button>
          );
        })}
      </div>
      <p className="flex items-center gap-1.5 text-xs text-zinc-500">
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
      descricao="Escolha o primeiro e o último dia (os dois entram na conta)."
      aoFechar={aoFechar}
      rodape={
        <div className="flex gap-3">
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
      <div className="grid grid-cols-2 gap-3">
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
      {erro ? (
        <p role="alert" className="mt-3 text-xs font-bold text-red-400">
          {erro}
        </p>
      ) : null}
    </FolhaFinanceira>
  );
}
