import type { EstadoDeOperacao } from "@/components/admin/PontoDeOperacao";
import { cn } from "@/lib/utils";
import {
  Check,
  ChevronDown,
  Clock,
  RefreshCw,
  Wifi,
  WifiOff,
  X,
} from "lucide-react";
import { type KeyboardEvent, useId, useRef, useState } from "react";

/** Só apresenta a medição do AdminLayout; não abre outra sonda de rede. */
export function ConexaoDoPainel({
  estado: { isOffline, quality, showSyncFlash },
  nome,
}: {
  estado: EstadoDeOperacao;
  nome?: string;
}) {
  const [aberta, setAberta] = useState(false);
  const id = useId();
  const botao = useRef<HTMLButtonElement>(null);
  const visual = isOffline
    ? {
        rotulo: "Sem internet",
        titulo: "Sem conexão com o servidor",
        detalhe: "Aguarde o retorno do servidor.",
        cor: "text-[#FFA1B0]",
        Icone: WifiOff,
      }
    : showSyncFlash
      ? {
          rotulo: "Sincronizado",
          titulo: "Sincronização concluída!",
          detalhe: "A conexão voltou a responder.",
          cor: "text-emerald-400",
          Icone: Check,
        }
      : quality === "slow"
        ? {
            rotulo: "Lenta",
            titulo: "Conexão lenta",
            detalhe: "As respostas podem demorar.",
            cor: "text-orange-300",
            Icone: Clock,
          }
        : {
            rotulo: "Online",
            titulo: "Conexão boa",
            detalhe: "A loja está conectada.",
            cor: quality === "good" ? "text-sky-300" : "text-emerald-400",
            Icone: Wifi,
          };
  const Icone = visual.Icone;

  function fechar() {
    setAberta(false);
    botao.current?.focus();
  }

  function aoPressionar(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === "Escape" && aberta) {
      event.stopPropagation();
      fechar();
    }
  }

  return (
    <div className={cn("min-w-0 flex-1", !nome && "relative")}>
      <button
        ref={botao}
        type="button"
        // O nome acessível começa pelo texto visível (WCAG 2.5.3) e diz o estado.
        aria-label={`${nome ? `${nome} ` : ""}Admin, conexão ${visual.rotulo}. Detalhes da conexão`}
        aria-expanded={aberta}
        aria-controls={id}
        title={visual.titulo}
        onClick={() => setAberta(!aberta)}
        onKeyDown={aoPressionar}
        className={cn(
          "flex min-h-11 w-full min-w-11 items-center gap-2 rounded-xl text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300",
          !nome && "border border-white/10 bg-[#17171C] px-3",
        )}
      >
        <span className="min-w-0 flex-1">
          {nome && (
            <span
              className={cn(
                "block break-words font-semibold leading-4 text-zinc-50",
                nome.length > 26 ? "text-[12.5px]" : "text-[15px]",
              )}
            >
              {nome}
            </span>
          )}
          <span className="flex items-center gap-1 text-[11px] leading-4 text-[#A1A1AD]">
            <Icone
              aria-hidden="true"
              className={cn("size-3.5 shrink-0", visual.cor)}
            />
            {nome && <span>Admin · </span>}
            <span
              className={cn(
                "cursor-help flex shrink-0 items-center gap-1",
                isOffline || showSyncFlash || quality === "slow"
                  ? visual.cor
                  : "text-[#A1A1AD]",
                showSyncFlash && "animate-pulse",
              )}
              title={visual.titulo}
            >
              <span className="text-[11px]">{visual.rotulo}</span>
            </span>
          </span>
        </span>
        <ChevronDown
          aria-hidden="true"
          className={cn(
            "size-3.5 shrink-0 text-[#A1A1AD]",
            aberta && "rotate-180",
          )}
        />
      </button>
      {aberta && (
        <div
          id={id}
          className={cn(
            "absolute top-full z-[110] mt-2 flex items-center gap-3 rounded-2xl border border-white/15 bg-[#1E1E24] p-3 shadow-xl",
            nome ? "inset-x-5" : "inset-x-0",
          )}
        >
          <span
            className={cn(
              "flex size-8 shrink-0 items-center justify-center rounded-xl border border-current bg-white/5",
              visual.cor,
            )}
          >
            {isOffline ? (
              <RefreshCw aria-hidden="true" className="size-4" />
            ) : (
              <Icone aria-hidden="true" className="size-4" />
            )}
          </span>
          <div className="min-w-0 flex-1 text-xs">
            <p className="font-semibold text-zinc-50">
              {isOffline ? "Reconexão automática" : visual.titulo}
            </p>
            <p className="mt-1 text-[#A1A1AD]">{visual.detalhe}</p>
          </div>
          <button
            type="button"
            aria-label="Fechar detalhes da conexão"
            onClick={fechar}
            onKeyDown={aoPressionar}
            className="flex size-11 shrink-0 items-center justify-center rounded-xl border border-white/15 bg-[#26262E] text-[#A1A1AD] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300"
          >
            <X aria-hidden="true" className="size-5" />
          </button>
        </div>
      )}
    </div>
  );
}
