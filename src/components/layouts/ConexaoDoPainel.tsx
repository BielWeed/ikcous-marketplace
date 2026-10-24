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
        cor: "text-red-400",
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

  // Estado fora do normal: a palavra também ganha a cor do estado (a bolinha
  // sozinha não basta); no normal fica o cinza de apoio, como no desenho.
  const anormal = isOffline || showSyncFlash || quality === "slow";

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
          "flex min-h-11 w-full min-w-11 items-center gap-2 rounded-xl text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          !nome && "border border-admin-border bg-admin-raised px-3",
        )}
      >
        {nome ? (
          // Desenho "Tinta": nome com a seta colada no fim dele e, embaixo,
          // bolinha do estado + "Estado · Admin". Nome comprido QUEBRA em
          // linhas (a seta acompanha a última).
          <span className="min-w-0">
            <span
              className={cn(
                "block break-words font-semibold leading-5 text-foreground",
                nome.length > 26
                  ? "text-[14px]"
                  : "text-[15px] min-[360px]:text-[17px]",
              )}
            >
              {nome}
              <ChevronDown
                aria-hidden="true"
                className={cn(
                  "ml-1 inline size-4 align-[-3px] text-muted-foreground",
                  aberta && "rotate-180",
                )}
              />
            </span>
            <span className="mt-0.5 flex items-center gap-1.5 text-[13px] leading-4 text-muted-foreground">
              <span
                aria-hidden="true"
                className={cn(
                  "size-2 shrink-0 rounded-full bg-current",
                  visual.cor,
                  showSyncFlash && "animate-pulse",
                )}
              />
              <span
                className={cn(
                  "cursor-help",
                  anormal && visual.cor,
                  showSyncFlash && "animate-pulse",
                )}
                title={visual.titulo}
              >
                {visual.rotulo} · Admin
              </span>
            </span>
          </span>
        ) : (
          <>
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-1 text-[11px] leading-4 text-muted-foreground">
                <Icone
                  aria-hidden="true"
                  className={cn("size-3.5 shrink-0", visual.cor)}
                />
                <span
                  className={cn(
                    "cursor-help flex shrink-0 items-center gap-1",
                    anormal && visual.cor,
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
                "size-3.5 shrink-0 text-muted-foreground",
                aberta && "rotate-180",
              )}
            />
          </>
        )}
      </button>
      {aberta && (
        <div
          id={id}
          className={cn(
            "absolute top-full z-[110] mt-2 flex items-center gap-3 rounded-[18px] border border-admin-border-strong bg-admin-raised p-3 shadow-xl",
            nome ? "inset-x-5" : "inset-x-0",
          )}
        >
          <span
            className={cn(
              "flex size-8 shrink-0 items-center justify-center rounded-xl border border-current",
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
            <p className="font-semibold text-foreground">
              {isOffline ? "Reconexão automática" : visual.titulo}
            </p>
            <p className="mt-1 text-muted-foreground">{visual.detalhe}</p>
          </div>
          <button
            type="button"
            aria-label="Fechar detalhes da conexão"
            onClick={fechar}
            onKeyDown={aoPressionar}
            className="flex size-11 shrink-0 items-center justify-center rounded-xl border border-admin-border-strong bg-admin-hover text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <X aria-hidden="true" className="size-5" />
          </button>
        </div>
      )}
    </div>
  );
}
