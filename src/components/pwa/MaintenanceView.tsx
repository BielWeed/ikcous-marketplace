import { useVoltaDaManutencao } from "@/hooks/useVoltaDaManutencao";
import { recarregarComPaginaNova } from "@/lib/volta-da-manutencao";
import { useState } from "react";

/**
 * Tela "Servidor em Manutenção". Mora FORA do App.tsx de propósito: ela tem
 * relógio e estado próprios, e um componente declarado dentro do App é
 * recriado a cada renderização dele (a tela seria desmontada e o relógio
 * zerado a cada vez).
 *
 * Sai do ar sozinha quando a loja volta (`useVoltaDaManutencao`) e tem o botão
 * "Tentar de novo" para quem não quer esperar. O botão apaga a cópia da página
 * guardada pelo service worker e recarrega: sem apagá-la, recarregar devolveria
 * a mesma tela de manutenção. Ver `src/lib/volta-da-manutencao.ts`.
 */
export function MaintenanceView() {
  useVoltaDaManutencao();
  const [tentando, setTentando] = useState(false);

  const tentarDeNovo = async () => {
    if (tentando) return;
    setTentando(true);
    try {
      await recarregarComPaginaNova();
    } finally {
      setTentando(false);
    }
  };

  return (
    <div className="flex min-h-[75vh] select-none flex-col items-center justify-center px-6 text-center">
      <div className="relative mb-8">
        {/* Glowing background effect */}
        <div className="absolute -inset-1 animate-pulse rounded-full bg-gradient-to-r from-amber-500 to-yellow-400 opacity-20 blur-xl" />

        {/* Animated gear or icon */}
        <div className="relative flex size-24 items-center justify-center rounded-3xl border border-white/10 bg-zinc-950 shadow-2xl">
          <svg
            className="size-12 animate-spin text-amber-400"
            style={{ animationDuration: "8s" }}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={1.5}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 0 1 1.37.49l1.296 2.247a1.125 1.125 0 0 1-.26 1.43l-1.003.828c-.293.241-.438.613-.43.992a7.723 7.723 0 0 1 0 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 0 1-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 0 1-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 0 1-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 0 1-1.369-.49l-1.297-2.247a1.125 1.125 0 0 1 .26-1.43l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 0 1 0-.255c.007-.378-.138-.75-.43-.991l-1.004-.827a1.125 1.125 0 0 1-.26-1.43l1.297-2.247a1.125 1.125 0 0 1 1.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.645-.869l.214-1.28Z"
            />
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z"
            />
          </svg>
        </div>
      </div>

      <h1 className="mb-3 text-2xl font-black uppercase tracking-tighter text-white md:text-3xl">
        Servidor em Manutenção
      </h1>

      <p className="mb-8 max-w-sm text-sm leading-relaxed text-zinc-400">
        Estamos otimizando nossa infraestrutura para melhorar a velocidade e
        estabilidade da sua experiência. Voltamos em alguns minutos!
      </p>

      <div className="flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-2">
        <span className="size-2 animate-ping rounded-full bg-amber-400" />
        <span className="text-[10px] font-black uppercase tracking-widest text-zinc-300">
          Atualizando Banco de Dados
        </span>
      </div>

      <button
        type="button"
        onClick={tentarDeNovo}
        disabled={tentando}
        className="mt-6 min-h-11 rounded-full border border-white/10 bg-white/5 px-6 text-xs font-black uppercase tracking-widest text-zinc-200 transition-colors hover:bg-white/10 disabled:opacity-60"
      >
        {tentando ? "Verificando..." : "Tentar de novo"}
      </button>
    </div>
  );
}
