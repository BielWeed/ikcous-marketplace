import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import { cn } from "@/lib/utils";
import { createContext, useContext } from "react";

/**
 * Ponto de status do tempo real — Missão 06, C3 (aprovada pelo dono):
 * substitui a tag "Operações ao Vivo" (verde fixo após a carga, mentindo
 * sobre a conexão) por um ponto com os estados do modelo da barra
 * (offline vermelho · lento âmbar · boa sky · padrão verde · flash de sync).
 * A medição vive em UMA instância (AdminLayout) e as telas consomem via
 * provider — o fallback autônomo é componente separado de propósito (ver
 * PontoAutonomo).
 */
export interface EstadoDeOperacao {
  isOffline: boolean;
  quality: "excellent" | "good" | "slow" | "offline";
  latency: number;
  showSyncFlash: boolean;
}

const EstadoDeOperacaoContext = createContext<EstadoDeOperacao | null>(null);

export function EstadoDeOperacaoProvider({
  value,
  children,
}: {
  value: EstadoDeOperacao;
  children: React.ReactNode;
}) {
  return (
    <EstadoDeOperacaoContext.Provider value={value}>
      {children}
    </EstadoDeOperacaoContext.Provider>
  );
}

function PontoComEstado({
  estado,
  sincronizando = false,
  className,
}: {
  estado: EstadoDeOperacao;
  sincronizando?: boolean;
  className?: string;
}) {
  const { isOffline, quality, latency, showSyncFlash } = estado;

  // Ordem de precedência: offline ganha de tudo; flash de sync mostra o
  // "acabou de sincronizar"; depois a carga da tela; por fim a qualidade
  // (mesma régua do modelo da barra: lenta âmbar, boa sky, padrão verde).
  const visual = isOffline
    ? {
        cor: "bg-red-500",
        ping: null,
        titulo: "Sem conexão com o servidor",
      }
    : showSyncFlash
      ? {
          cor: "bg-emerald-400",
          ping: "bg-emerald-300",
          titulo: "Sincronização concluída!",
        }
      : sincronizando
        ? {
            cor: "bg-amber-500",
            ping: "bg-amber-400",
            titulo: "Sincronizando dados...",
          }
        : quality === "slow"
          ? {
              cor: "bg-amber-500",
              ping: "bg-amber-400",
              titulo: `Tempo real ativo — conexão lenta (${latency}ms)`,
            }
          : quality === "good"
            ? {
                cor: "bg-sky-400",
                ping: "bg-sky-300",
                titulo: `Tempo real ativo — latência ${latency}ms`,
              }
            : {
                cor: "bg-emerald-500",
                ping: "bg-emerald-400",
                titulo: `Tempo real ativo — latência ${latency}ms`,
              };

  return (
    <span
      data-testid="ponto-de-operacao"
      role="status"
      aria-label={visual.titulo}
      title={visual.titulo}
      className={cn(
        "relative flex size-2 shrink-0 rounded-full",
        visual.cor,
        className,
      )}
    >
      {visual.ping && (
        <span
          className={cn(
            "absolute inline-flex size-full animate-ping rounded-full opacity-75",
            visual.ping,
          )}
        />
      )}
    </span>
  );
}

/**
 * Render FORA do AdminLayout (render direto em testes, uso avulso). É um
 * componente SEPARADO de propósito: hooks não podem ser condicionais, e
 * chamar useOnlineStatus (que por dentro É a sonda completa de latência,
 * com fetch + interval de 15s) incondicionalmente montaria uma sonda de
 * rede por ponto — 4 sondas onde 1 bastaria (achado 1, revisão 5.3).
 */
function PontoAutonomo(props: {
  sincronizando?: boolean;
  className?: string;
}) {
  const offline = useOnlineStatus();
  return (
    <PontoComEstado
      estado={{
        isOffline: offline,
        quality: offline ? "offline" : "excellent",
        latency: 0,
        showSyncFlash: false,
      }}
      {...props}
    />
  );
}

export function PontoDeOperacao({
  sincronizando = false,
  className,
}: {
  /** Carga de dados da tela em andamento (sinal honesto de "conectando"). */
  sincronizando?: boolean;
  className?: string;
}) {
  const estado = useContext(EstadoDeOperacaoContext);
  return estado ? (
    <PontoComEstado
      estado={estado}
      sincronizando={sincronizando}
      className={className}
    />
  ) : (
    <PontoAutonomo sincronizando={sincronizando} className={className} />
  );
}
