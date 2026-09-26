import { DebouncedSearchInput } from "@/components/admin/DebouncedSearchInput";
import { PaginacaoAdmin } from "@/components/admin/PaginacaoAdmin";
import { useStore } from "@/contexts/StoreContext";
import { useCrmClientes } from "@/hooks/useCrm";
import {
  SEGMENTOS_DO_CRM,
  classesDoTom,
  formatarInteiro,
  formatarMoeda,
  formatarMoedaCompacta,
  infoDoSegmento,
  linkWhatsappDoCrm,
  mensagemDoSegmento,
  rotuloDoCanal,
} from "@/lib/crm";
import { nomeDaLoja } from "@/lib/nome-da-loja";
import { cn } from "@/lib/utils";
import type { View } from "@/types";
import type { ClienteDoCrm, ResumoDoSegmento, SegmentoCrm } from "@/types/crm";
import {
  AlertCircle,
  ChevronRight,
  MessageCircle,
  RefreshCw,
  Search,
  Users,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";

const POR_PAGINA = 20;

function CrachaDoSegmento({
  segmento,
}: Readonly<{ segmento: SegmentoCrm | null }>) {
  if (!segmento) {
    return (
      <span className="inline-flex items-center rounded-full border border-white/10 px-2 py-0.5 text-[10px] font-bold text-zinc-400">
        Sem segmento
      </span>
    );
  }
  const info = infoDoSegmento(segmento);
  const classes = classesDoTom(info.tom);
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-bold",
        classes.cracha,
      )}
    >
      <span
        className={cn("size-1.5 rounded-full", classes.marca)}
        aria-hidden="true"
      />
      {info.rotulo}
    </span>
  );
}

function GradeDeSegmentos({
  segmentos,
  carregando,
  selecionado,
  aoSelecionar,
}: Readonly<{
  segmentos: readonly ResumoDoSegmento[];
  carregando: boolean;
  selecionado: SegmentoCrm | null;
  aoSelecionar: (segmento: SegmentoCrm | null) => void;
}>) {
  const porSegmento = new Map(segmentos.map((s) => [s.segmento, s]));
  const totalDeClientes = segmentos.reduce((soma, s) => soma + s.clientes, 0);

  return (
    <section aria-labelledby="crm-segmentos-titulo" className="space-y-3">
      <div className="flex items-baseline justify-between gap-3">
        <h2
          id="crm-segmentos-titulo"
          className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-400"
        >
          Segmentos RFM
        </h2>
        <button
          type="button"
          onClick={() => aoSelecionar(null)}
          aria-pressed={selecionado === null}
          className={cn(
            "min-h-11 rounded-full border px-3 text-[10px] font-black uppercase tracking-widest transition-colors",
            selecionado === null
              ? "border-admin-gold/40 bg-admin-gold/10 text-admin-gold"
              : "border-white/10 text-zinc-400 hover:text-white",
          )}
        >
          Todos
          {totalDeClientes > 0 ? ` · ${formatarInteiro(totalDeClientes)}` : ""}
        </button>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 sm:gap-3 lg:grid-cols-5">
        {SEGMENTOS_DO_CRM.map((segmento) => {
          const info = infoDoSegmento(segmento);
          const classes = classesDoTom(info.tom);
          const resumo = porSegmento.get(segmento);
          const ativo = selecionado === segmento;
          return (
            <button
              key={segmento}
              type="button"
              aria-pressed={ativo}
              onClick={() => aoSelecionar(ativo ? null : segmento)}
              className={cn(
                "flex min-h-[92px] flex-col justify-between gap-2 rounded-2xl border p-3 text-left transition-all active:scale-[0.98]",
                ativo
                  ? "border-admin-gold/50 bg-admin-gold/[0.08] shadow-lg"
                  : "border-white/5 bg-zinc-950/60 hover:border-white/15",
              )}
            >
              <span className="flex items-center gap-1.5">
                <span
                  className={cn("size-2 shrink-0 rounded-full", classes.marca)}
                  aria-hidden="true"
                />
                <span className="truncate text-[11px] font-bold text-zinc-200">
                  {info.rotulo}
                </span>
              </span>
              {carregando && !resumo ? (
                <span
                  className="premium-shimmer h-6 w-12 rounded-md"
                  aria-hidden="true"
                />
              ) : (
                <span>
                  <span className="block text-xl font-black text-white">
                    {formatarInteiro(resumo?.clientes ?? 0)}
                  </span>
                  <span className="block truncate text-[10px] tabular-nums text-zinc-500">
                    {formatarMoedaCompacta(resumo?.receita ?? 0)}
                  </span>
                </span>
              )}
              <span className="hidden text-[10px] leading-snug text-zinc-500 lg:block">
                {info.descricao}
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

function LinhaDoCliente({
  cliente,
  loja,
  onNavigate,
}: Readonly<{
  cliente: ClienteDoCrm;
  loja: string;
  onNavigate: (view: View, id?: string) => void;
}>) {
  const nome = cliente.nome ?? "Cliente sem nome";
  const whatsapp = linkWhatsappDoCrm(
    cliente.whatsapp,
    mensagemDoSegmento(cliente.segmento, { nome: cliente.nome, loja }),
  );
  const dias = cliente.diasSemComprar;

  return (
    <li className="flex flex-col gap-3 rounded-2xl border border-white/5 bg-zinc-950/60 p-3 sm:p-4 lg:grid lg:grid-cols-12 lg:items-center lg:gap-4">
      <div className="flex min-w-0 items-center gap-3 lg:col-span-4">
        <span
          aria-hidden="true"
          className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-zinc-900 text-sm font-black text-admin-gold"
        >
          {nome.charAt(0).toUpperCase()}
        </span>
        <div className="min-w-0 space-y-1">
          <p className="truncate text-sm font-bold text-white">{nome}</p>
          <CrachaDoSegmento segmento={cliente.segmento} />
        </div>
      </div>

      <dl className="grid grid-cols-3 gap-2 text-xs lg:col-span-5">
        <div>
          <dt className="text-[10px] uppercase tracking-wider text-zinc-500">
            Pedidos
          </dt>
          <dd className="font-bold tabular-nums text-white">
            {formatarInteiro(cliente.pedidos)}
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="text-[10px] uppercase tracking-wider text-zinc-500">
            Receita
          </dt>
          <dd className="truncate font-bold tabular-nums text-white">
            {formatarMoeda(cliente.receita)}
          </dd>
        </div>
        <div>
          <dt className="text-[10px] uppercase tracking-wider text-zinc-500">
            Sem comprar
          </dt>
          <dd className="font-bold tabular-nums text-white">
            {dias == null
              ? "—"
              : `${formatarInteiro(dias)} ${dias === 1 ? "dia" : "dias"}`}
          </dd>
        </div>
        {cliente.canalPreferido ? (
          <div className="col-span-3 text-[11px] text-zinc-400">
            Prefere:{" "}
            <span className="font-semibold text-zinc-200">
              {rotuloDoCanal(cliente.canalPreferido)}
            </span>
          </div>
        ) : null}
      </dl>

      <div className="flex gap-2 lg:col-span-3 lg:justify-end">
        {whatsapp ? (
          <a
            href={whatsapp}
            target="_blank"
            rel="noopener noreferrer"
            className="flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl border border-emerald-500/25 bg-emerald-500/10 px-3 text-[10px] font-black uppercase tracking-widest text-emerald-300 transition-colors hover:bg-emerald-500/20 lg:flex-none"
          >
            <MessageCircle className="size-4" aria-hidden="true" />
            WhatsApp
            <span className="sr-only"> — chamar {nome} (abre em nova aba)</span>
          </a>
        ) : (
          <span className="flex min-h-11 flex-1 items-center justify-center rounded-xl border border-dashed border-white/10 px-3 text-[10px] font-bold text-zinc-500 lg:flex-none">
            Sem WhatsApp
          </span>
        )}
        {cliente.userId ? (
          <button
            type="button"
            onClick={() =>
              onNavigate("admin-user-detail", cliente.userId ?? undefined)
            }
            className="flex min-h-11 flex-1 items-center justify-center gap-1 rounded-xl border border-white/10 px-3 text-[10px] font-black uppercase tracking-widest text-zinc-200 transition-colors hover:bg-white/5 lg:flex-none"
          >
            Ver cliente
            <ChevronRight className="size-4" aria-hidden="true" />
            <span className="sr-only"> {nome}</span>
          </button>
        ) : null}
      </div>
    </li>
  );
}

/**
 * Aba "Clientes" do CRM: a grade de segmentos RFM (toque filtra a lista) e
 * a lista de `crm_clientes` com busca, paginação e as duas ações de um
 * toque — WhatsApp com o texto do segmento e a ficha do cliente (quando ele
 * tem conta).
 */
export function ClientesDoCrm({
  segmentos,
  carregandoSegmentos,
  segmento,
  aoMudarSegmento,
  active,
  onNavigate,
  sinalDeAtualizacao,
}: Readonly<{
  segmentos: readonly ResumoDoSegmento[];
  carregandoSegmentos: boolean;
  segmento: SegmentoCrm | null;
  aoMudarSegmento: (segmento: SegmentoCrm | null) => void;
  active: boolean;
  onNavigate: (view: View, id?: string) => void;
  /** Muda quando o lojista toca em "Sincronizar" no topo do CRM. */
  sinalDeAtualizacao: number;
}>) {
  const { config } = useStore();
  const loja = nomeDaLoja(config);
  const [busca, setBusca] = useState("");
  // Página amarrada ao filtro: trocar segmento ou busca volta à página 1
  // no MESMO render (sem uma consulta extra na página antiga).
  const chaveDoFiltro = `${segmento ?? "todos"}|${busca}`;
  const [paginacao, setPaginacao] = useState({
    chave: chaveDoFiltro,
    pagina: 0,
  });
  const pagina = paginacao.chave === chaveDoFiltro ? paginacao.pagina : 0;

  const { lista, carregando, erro, atualizar } = useCrmClientes({
    segmento,
    busca,
    pagina,
    porPagina: POR_PAGINA,
    active,
  });

  // "Sincronizar" do topo: só recarrega quando o sinal MUDA depois de a
  // aba montar (montar já busca).
  const sinalAtendidoRef = useRef(sinalDeAtualizacao);
  useEffect(() => {
    if (sinalAtendidoRef.current === sinalDeAtualizacao) return;
    sinalAtendidoRef.current = sinalDeAtualizacao;
    atualizar();
  }, [sinalDeAtualizacao, atualizar]);

  const total = lista?.total ?? 0;
  const totalPaginas = Math.max(1, Math.ceil(total / POR_PAGINA));
  const esqueleto = carregando && !lista;
  const nomeDoSegmento = segmento ? infoDoSegmento(segmento).rotulo : null;

  return (
    <div className="space-y-6">
      <GradeDeSegmentos
        segmentos={segmentos}
        carregando={carregandoSegmentos}
        selecionado={segmento}
        aoSelecionar={aoMudarSegmento}
      />

      <section aria-labelledby="crm-lista-titulo" className="space-y-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h2
            id="crm-lista-titulo"
            className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.2em] text-zinc-400"
          >
            <Users className="size-3.5" aria-hidden="true" />
            {nomeDoSegmento
              ? `Clientes · ${nomeDoSegmento}`
              : "Todos os clientes"}
            {lista ? (
              <span className="font-bold normal-case tracking-normal text-zinc-500">
                ({formatarInteiro(total)})
              </span>
            ) : null}
          </h2>
          <div className="relative sm:w-72">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-zinc-500"
              aria-hidden="true"
            />
            <label htmlFor="crm-busca-cliente" className="sr-only">
              Buscar cliente por nome, e-mail ou WhatsApp
            </label>
            <DebouncedSearchInput
              id="crm-busca-cliente"
              value={busca}
              onChange={setBusca}
              placeholder="Nome, e-mail ou WhatsApp"
              className="h-11 rounded-xl border-white/10 bg-zinc-950/60 pl-9 text-sm"
            />
          </div>
        </div>

        {erro && !carregando ? (
          <div
            role="alert"
            className="flex items-center gap-3 rounded-2xl border border-red-500/20 bg-red-500/10 p-4 text-red-300"
          >
            <AlertCircle className="size-5 shrink-0" aria-hidden="true" />
            <p className="flex-1 text-xs">{erro}</p>
            <button
              type="button"
              onClick={atualizar}
              className="flex min-h-11 shrink-0 items-center gap-1.5 rounded-xl border border-red-500/20 px-3 text-[10px] font-black uppercase tracking-wider transition-colors hover:bg-red-500/10"
            >
              <RefreshCw className="size-3.5" aria-hidden="true" />
              Tentar de novo
            </button>
          </div>
        ) : null}

        {esqueleto ? (
          <ul className="space-y-2" aria-busy="true">
            {Array.from({ length: 4 }, (_, i) => (
              <li
                key={i}
                className="premium-shimmer h-[104px] rounded-2xl lg:h-[76px]"
              />
            ))}
          </ul>
        ) : lista && lista.clientes.length > 0 ? (
          <ul
            className={cn(
              "space-y-2 transition-opacity",
              carregando && "opacity-60",
            )}
          >
            {lista.clientes.map((cliente) => (
              <LinhaDoCliente
                key={cliente.chave}
                cliente={cliente}
                loja={loja}
                onNavigate={onNavigate}
              />
            ))}
          </ul>
        ) : lista ? (
          <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-white/10 p-8 text-center">
            <Users className="size-6 text-zinc-600" aria-hidden="true" />
            <p className="text-sm font-bold text-white">
              {busca.trim()
                ? `Nenhum cliente encontrado para “${busca.trim()}”`
                : nomeDoSegmento
                  ? `Nenhum cliente em ${nomeDoSegmento} agora`
                  : "Ainda não há clientes com compra paga"}
            </p>
            {busca.trim() || segmento ? (
              <button
                type="button"
                onClick={() => {
                  setBusca("");
                  aoMudarSegmento(null);
                }}
                className="min-h-11 rounded-xl border border-white/10 px-4 text-[10px] font-black uppercase tracking-widest text-zinc-200 transition-colors hover:bg-white/5"
              >
                Ver todos os clientes
              </button>
            ) : (
              <button
                type="button"
                onClick={() => onNavigate("admin-pdv")}
                className="min-h-11 rounded-xl bg-admin-gold px-4 text-[10px] font-black uppercase tracking-widest text-black transition-colors hover:bg-admin-gold/90"
              >
                Registrar uma venda
              </button>
            )}
          </div>
        ) : null}

        <PaginacaoAdmin
          pagina={pagina}
          totalPaginas={totalPaginas}
          totalItens={total}
          itensPorPagina={POR_PAGINA}
          aoMudar={(novaPagina) =>
            setPaginacao({ chave: chaveDoFiltro, pagina: novaPagina })
          }
        />
      </section>
    </div>
  );
}
