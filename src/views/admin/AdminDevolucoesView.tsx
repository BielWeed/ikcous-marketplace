import { Loader2, RefreshCw, RotateCcw, Search } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { DebouncedSearchInput } from "@/components/admin/DebouncedSearchInput";
import { CartaoDaDevolucao } from "@/components/admin/devolucoes/CartaoDaDevolucao";
import { DetalheDaDevolucao } from "@/components/admin/devolucoes/DetalheDaDevolucao";
import {
  tomarDevolucaoParaAbrir,
  useDevolucoesAdmin,
} from "@/hooks/useDevolucoesAdmin";
import {
  STATUS_EM_ORDEM,
  contagemDe,
  rotuloStatusPlural,
  totalGeral,
} from "@/lib/devolucao";
import { cn } from "@/lib/utils";
import type { View } from "@/types";
import type { StatusDevolucao } from "@/types/devolucao";

interface AdminDevolucoesViewProps {
  onNavigate: (view: View, id?: string) => void;
  active?: boolean;
  onSetDirty?: (dirty: boolean) => void;
  onSetBackOverride?: (fn: (() => void) | null) => void;
}

const TEXTO_DESCARTAR =
  "Você escreveu algo que ainda não foi enviado. Descartar e sair?";

/**
 * Devoluções e trocas do painel (plano 2026-09-26, seção "Devoluções").
 * Lista com chips por status (contagem do servidor), busca e a ficha de uma
 * devolução: folha de tela cheia no celular, painel à direita a partir de
 * 1024px. O Voltar do celular fecha a ficha antes de sair da tela.
 */
export function AdminDevolucoesView({
  onNavigate,
  active,
  onSetDirty,
  onSetBackOverride,
}: AdminDevolucoesViewProps) {
  const [status, setStatus] = useState<StatusDevolucao | null>(null);
  const [busca, setBusca] = useState("");
  const [digitando, setDigitando] = useState(false);
  // A devolução que o card do pedido pediu para abrir chega por aqui, uma
  // vez, na montagem.
  const [selecionada, setSelecionada] = useState<string | null>(() =>
    tomarDevolucaoParaAbrir(),
  );
  const [sujo, setSujo] = useState(false);
  // "Agora" congelado por montagem: prazo e idade não mudam de rótulo no
  // meio da leitura, e o render continua puro.
  const [agora] = useState(() => new Date());
  const sujoRef = useRef(false);

  const lista = useDevolucoesAdmin({ status, busca, ativo: active !== false });
  const { recarregar } = lista;

  useEffect(() => {
    sujoRef.current = sujo;
    onSetDirty?.(sujo);
  }, [sujo, onSetDirty]);
  useEffect(() => () => onSetDirty?.(false), [onSetDirty]);

  const podeDescartar = useCallback(
    () => !sujoRef.current || globalThis.confirm(TEXTO_DESCARTAR),
    [],
  );

  const fechar = useCallback(() => {
    if (!podeDescartar()) return;
    setSujo(false);
    setSelecionada(null);
  }, [podeDescartar]);

  const abrir = useCallback(
    (id: string) => {
      if (id === selecionada) return;
      if (!podeDescartar()) return;
      setSujo(false);
      setSelecionada(id);
    },
    [selecionada, podeDescartar],
  );

  // Voltar do aparelho fecha a ficha primeiro (mesmo contrato do PDV e dos
  // banners): a trava evita fechar duas vezes com um popstate atrasado.
  const fechouRef = useRef(false);
  useEffect(() => {
    if (!onSetBackOverride) return;
    if (selecionada) {
      fechouRef.current = false;
      onSetBackOverride(() => () => {
        if (fechouRef.current) return;
        fechouRef.current = true;
        fechar();
      });
    } else {
      onSetBackOverride(null);
    }
    return () => onSetBackOverride(null);
  }, [selecionada, fechar, onSetBackOverride]);

  // No celular a ficha cobre a tela: o fundo não pode rolar por baixo.
  useEffect(() => {
    if (!selecionada) return;
    const largo = globalThis.matchMedia?.("(min-width: 1024px)")?.matches;
    if (largo) return;
    document.body.classList.add("admin-modal-open");
    return () => document.body.classList.remove("admin-modal-open");
  }, [selecionada]);

  const aoMudar = useCallback(() => recarregar(), [recarregar]);
  const aoAbrirPedido = useCallback(
    (orderId: string) => {
      if (!podeDescartar()) return;
      setSujo(false);
      onNavigate("admin-orders", orderId);
    },
    [onNavigate, podeDescartar],
  );

  const contagem = lista.contagem;
  const chips: Array<{
    chave: StatusDevolucao | null;
    rotulo: string;
    n: number | null;
  }> = [
    { chave: null, rotulo: "Todas", n: contagem ? totalGeral(contagem) : null },
    ...STATUS_EM_ORDEM.map((s) => ({
      chave: s,
      rotulo: rotuloStatusPlural(s),
      n: contagem ? contagemDe(contagem, s) : null,
    })),
  ];

  return (
    <div className="pb-admin h-auto bg-[#09090b] text-white lg:pb-12">
      <div className="flex items-center justify-between gap-4 px-6 pb-2 pt-6">
        <AdminPageHeader
          titulo="Devoluções"
          acoes={
            <button
              type="button"
              onClick={recarregar}
              aria-label="Atualizar devoluções"
              className="flex size-11 items-center justify-center rounded-xl border border-white/5 bg-zinc-900/60 text-zinc-400 transition-all hover:text-white active:scale-95"
            >
              <RefreshCw
                className={cn("size-4", lista.carregando && "animate-spin")}
              />
            </button>
          }
        />
      </div>

      <div className="space-y-4 px-4 pb-6 sm:px-6 lg:px-8">
        <div
          role="group"
          aria-label="Filtrar por status"
          className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:-mx-6 sm:px-6 lg:mx-0 lg:flex-wrap lg:px-0"
        >
          {chips.map((chip) => {
            const ativo = chip.chave === status;
            const pedeAcao = chip.chave === "solicitada" && (chip.n ?? 0) > 0;
            return (
              <button
                key={chip.chave ?? "todas"}
                type="button"
                aria-pressed={ativo}
                onClick={() => setStatus(chip.chave)}
                className={cn(
                  "flex min-h-11 shrink-0 items-center gap-2 rounded-xl border px-3.5 text-[11px] font-bold transition-colors",
                  ativo
                    ? "border-admin-gold/50 bg-admin-gold/10 text-admin-gold"
                    : "border-white/5 bg-zinc-900/60 text-zinc-400 hover:text-white",
                )}
              >
                {chip.rotulo}
                {chip.n !== null && (
                  <span
                    className={cn(
                      "rounded-md px-1.5 py-0.5 text-[10px] font-black tabular-nums",
                      pedeAcao
                        ? "bg-admin-gold text-black"
                        : "bg-white/5 text-zinc-300",
                    )}
                  >
                    {chip.n}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        <div className="group relative">
          <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-4">
            {digitando ? (
              <Loader2 className="size-4 animate-spin text-admin-gold" />
            ) : (
              <Search className="size-4 text-zinc-600 group-focus-within:text-admin-gold" />
            )}
          </div>
          <label htmlFor="busca-devolucoes" className="sr-only">
            Buscar devoluções
          </label>
          <DebouncedSearchInput
            id="busca-devolucoes"
            name="busca"
            placeholder="Protocolo, cliente ou nº do pedido"
            value={busca}
            onChange={setBusca}
            onTyping={setDigitando}
            delay={350}
            className="h-11 w-full rounded-xl border-zinc-800 bg-black/40 pl-10 text-xs font-bold text-white placeholder:text-zinc-600 focus:border-admin-gold/50 focus:ring-admin-gold/20"
          />
        </div>

        <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] lg:items-start lg:gap-6">
          <div className="space-y-2" data-testid="lista-devolucoes">
            {lista.erro && (
              <div className="admin-glass space-y-3 rounded-2xl border border-red-500/20 p-4">
                <p className="text-xs font-bold text-red-300">
                  Não consegui carregar as devoluções.
                </p>
                <button
                  type="button"
                  onClick={recarregar}
                  className="min-h-11 rounded-xl border border-white/10 bg-white/5 px-4 text-[11px] font-bold text-zinc-200"
                >
                  Tentar de novo
                </button>
              </div>
            )}

            {!lista.erro && !lista.carregando && lista.itens.length === 0 && (
              <div className="flex flex-col items-center gap-2 rounded-2xl border border-white/5 bg-zinc-950/40 px-6 py-12 text-center">
                <div className="flex size-10 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-zinc-400">
                  <RotateCcw className="size-5" />
                </div>
                <p className="text-sm font-black text-white">
                  {busca.trim()
                    ? "Nada encontrado"
                    : status
                      ? `Nenhuma devolução ${rotuloStatusPlural(status).toLowerCase()}`
                      : "Nenhuma devolução ainda"}
                </p>
                <p className="max-w-xs text-[11px] leading-snug text-zinc-500">
                  Quando um cliente pedir para devolver ou trocar um produto
                  entregue, o pedido aparece aqui e no sino.
                </p>
              </div>
            )}

            {lista.itens.map((linha) => (
              <CartaoDaDevolucao
                key={linha.id}
                linha={linha}
                selecionada={linha.id === selecionada}
                agora={agora}
                onAbrir={abrir}
              />
            ))}

            {lista.temMais && (
              <button
                type="button"
                onClick={lista.carregarMais}
                disabled={lista.carregando}
                className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-white/5 bg-zinc-900/60 text-[11px] font-bold text-zinc-300 disabled:opacity-50"
              >
                {lista.carregando && (
                  <Loader2 className="size-4 animate-spin" />
                )}
                Mostrar mais
              </button>
            )}

            {lista.carregando && lista.itens.length === 0 && (
              <div className="flex items-center justify-center gap-2 py-10 text-xs font-bold text-zinc-500">
                <Loader2 className="size-4 animate-spin" />
                Carregando…
              </div>
            )}
          </div>

          {selecionada ? (
            <div className="fixed inset-0 z-[130] flex flex-col bg-[#09090b] duration-300 animate-in slide-in-from-bottom-4 lg:sticky lg:inset-auto lg:top-4 lg:z-auto lg:h-[calc(100dvh-9rem)] lg:animate-none lg:overflow-hidden lg:rounded-2xl lg:border lg:border-white/5">
              <DetalheDaDevolucao
                key={selecionada}
                id={selecionada}
                agora={agora}
                onFechar={fechar}
                onMudou={aoMudar}
                onSujoMudou={setSujo}
                onAbrirPedido={aoAbrirPedido}
              />
            </div>
          ) : (
            <div className="hidden lg:sticky lg:top-4 lg:flex lg:h-64 lg:items-center lg:justify-center lg:rounded-2xl lg:border lg:border-dashed lg:border-white/10 lg:text-xs lg:text-zinc-500">
              Escolha uma devolução para ver os detalhes.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
