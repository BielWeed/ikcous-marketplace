import { DebouncedSearchInput } from "@/components/admin/DebouncedSearchInput";
import { PaginacaoAdmin } from "@/components/admin/PaginacaoAdmin";
import {
  CLICAVEL_DO_CRM,
  CartaoDoCrm,
  EstadoVazioDoCrm,
  FOCO_DO_CRM,
} from "@/components/admin/crm/PecasDoCrm";
import { useStore } from "@/contexts/StoreContext";
import { useCrmClientes } from "@/hooks/useCrm";
import {
  FAIXAS_DE_SEGMENTOS_DO_CRM,
  classesDoTom,
  formatarData,
  formatarInteiro,
  formatarMoeda,
  formatarMoedaCompacta,
  infoDoSegmento,
  linkWhatsappDoCrm,
  mensagemDoSegmento,
  rotuloDoCanal,
  textoDoFiltroDeSegmento,
} from "@/lib/crm";
import { nomeDaLoja } from "@/lib/nome-da-loja";
import { cn } from "@/lib/utils";
import type { View } from "@/types";
import type { ClienteDoCrm, ResumoDoSegmento, SegmentoCrm } from "@/types/crm";
import {
  AlertCircle,
  Check,
  ChevronRight,
  Filter,
  MessageCircle,
  RefreshCw,
  Search,
  Users,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";

const POR_PAGINA = 20;

/** Colunas da lista, compartilhadas entre o cabeçalho e cada linha no desktop. */
const COLUNAS_DA_LISTA =
  "lg:grid-cols-[minmax(0,1.7fr)_minmax(0,1.1fr)_minmax(0,0.5fr)_minmax(0,0.8fr)_minmax(0,0.8fr)_minmax(0,0.95fr)_minmax(0,1.45fr)]";

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
        "inline-flex max-w-full items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-[10px] font-bold",
        classes.cracha,
      )}
    >
      <span
        className={cn("size-1.5 shrink-0 rounded-full", classes.marca)}
        aria-hidden="true"
      />
      <span className="min-w-0 truncate">{info.rotulo}</span>
    </span>
  );
}

/**
 * Um segmento RFM na grade: ponto de cor, rótulo, número grande, receita e o
 * ícone de filtro. Escolhido ganha anel dourado e check; com 0 clientes fica
 * em tom secundário, mas continua clicável (`aria-pressed` faz o toggle).
 */
function BlocoDeSegmento({
  segmento,
  resumo,
  carregando,
  selecionado,
  aoSelecionar,
}: Readonly<{
  segmento: SegmentoCrm;
  resumo: ResumoDoSegmento | undefined;
  carregando: boolean;
  selecionado: boolean;
  aoSelecionar: () => void;
}>) {
  const info = infoDoSegmento(segmento);
  const classes = classesDoTom(info.tom);
  const zerado = !carregando && (resumo?.clientes ?? 0) === 0;

  return (
    <button
      type="button"
      aria-pressed={selecionado}
      onClick={aoSelecionar}
      className={cn(
        // Compacto no celular (alvo ~64–72 px: rótulo numa linha, número +
        // receita na outra) — no desktop (`sm:`) volta ao cartão maior de
        // antes, com o número em destaque na própria linha.
        "relative flex min-h-[64px] flex-col justify-center gap-1 rounded-2xl p-2.5 text-left sm:min-h-[92px] sm:justify-between sm:gap-2 sm:p-3",
        CLICAVEL_DO_CRM,
        selecionado &&
          "border-admin-gold/60 bg-admin-gold/[0.08] ring-1 ring-admin-gold/40 hover:border-admin-gold/60",
      )}
    >
      <span className="flex items-center gap-1.5">
        {/* Contraste AA (N3 da re-revisão): a opacidade de "segmento sem
            cliente" ficava no BOTÃO inteiro, dimmerizando também a receita
            em texto (~3,2:1, abaixo do mínimo AA). Ela fica só no ponto de
            cor — um elemento gráfico, não texto — igual ao que já foi
            feito em CanaisDoCrm. */}
        <span
          className={cn(
            "size-2 shrink-0 rounded-full",
            classes.marca,
            zerado && "opacity-60",
          )}
          aria-hidden="true"
        />
        <span className="truncate text-[11px] font-bold text-zinc-200">
          {info.rotulo}
        </span>
        <Filter
          className="ml-auto size-3 shrink-0 text-zinc-500 sm:size-3.5"
          aria-hidden="true"
        />
      </span>
      {carregando && !resumo ? (
        <span
          className="premium-shimmer h-5 w-16 rounded-md sm:h-6 sm:w-12"
          aria-hidden="true"
        />
      ) : (
        <span className="flex items-baseline justify-between gap-1.5 sm:block">
          {/* "Zero não compete com dado" (spec, princípio 4): o número do
              segmento vazio sai em cinza (zinc-400, ainda AA), e o que tem
              cliente fica branco. */}
          <span
            className={cn(
              "text-base font-black tabular-nums sm:block sm:text-xl",
              zerado ? "text-zinc-400" : "text-white",
            )}
          >
            {formatarInteiro(resumo?.clientes ?? 0)}
          </span>
          <span className="shrink-0 truncate text-[10px] tabular-nums text-zinc-400 sm:mt-0.5 sm:block">
            {formatarMoedaCompacta(resumo?.receita ?? 0)}
          </span>
        </span>
      )}
      {selecionado ? (
        <span
          aria-hidden="true"
          className="absolute right-2 top-2 flex size-4 items-center justify-center rounded-full bg-admin-gold text-black"
        >
          <Check className="size-3" strokeWidth={3} />
        </span>
      ) : null}
    </button>
  );
}

function GradeDeSegmentos({
  segmentos,
  carregando,
  selecionado,
  aoSelecionar,
  contagemFiltrada,
}: Readonly<{
  segmentos: readonly ResumoDoSegmento[];
  carregando: boolean;
  selecionado: SegmentoCrm | null;
  aoSelecionar: (segmento: SegmentoCrm | null) => void;
  /**
   * Total já filtrado pela busca (`lista.total`) — substitui o bruto do
   * segmento quando há um termo digitado, senão "Mostrando: Em risco · 14"
   * continuava mostrando o total do segmento inteiro mesmo com a lista
   * abaixo filtrada para 1 ou 2 nomes. `undefined` quando não há busca
   * ativa (usa o bruto do segmento, comportamento de sempre).
   */
  contagemFiltrada?: number;
}>) {
  const porSegmento = new Map(segmentos.map((s) => [s.segmento, s]));
  const resumoSelecionado = selecionado
    ? (contagemFiltrada ?? porSegmento.get(selecionado)?.clientes ?? 0)
    : 0;
  const textoDoFiltro = selecionado
    ? textoDoFiltroDeSegmento(selecionado, resumoSelecionado)
    : null;

  return (
    <CartaoDoCrm
      id="crm-segmentos"
      titulo="Segmentos RFM"
      descricao="Agrupa quem compra por quando comprou, quantas vezes e quanto gastou. Toque para filtrar a lista."
    >
      <div className="space-y-4">
        {FAIXAS_DE_SEGMENTOS_DO_CRM.map((faixa) => (
          <div key={faixa.titulo}>
            <h3 className="mb-2 text-[10px] font-black uppercase tracking-[0.18em] text-zinc-400">
              {faixa.titulo}
            </h3>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 sm:gap-3 lg:grid-cols-5">
              {faixa.segmentos.map((segmento) => {
                const ativo = selecionado === segmento;
                return (
                  <BlocoDeSegmento
                    key={segmento}
                    segmento={segmento}
                    resumo={porSegmento.get(segmento)}
                    carregando={carregando}
                    selecionado={ativo}
                    aoSelecionar={() => aoSelecionar(ativo ? null : segmento)}
                  />
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {textoDoFiltro ? (
        <div className="mt-4 flex items-center justify-between gap-3 rounded-xl border border-admin-gold/20 bg-admin-gold/[0.06] px-3 py-2">
          <p className="truncate text-xs font-semibold text-admin-gold">
            {textoDoFiltro}
          </p>
          <button
            type="button"
            onClick={() => aoSelecionar(null)}
            className={cn(
              "flex min-h-11 shrink-0 items-center gap-1 rounded-lg px-2.5 text-[10px] font-black uppercase tracking-wider text-admin-gold transition-colors hover:bg-admin-gold/10",
              FOCO_DO_CRM,
            )}
          >
            <X className="size-3.5" aria-hidden="true" />
            Limpar
          </button>
        </div>
      ) : null}
    </CartaoDoCrm>
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

  return (
    <li
      className={cn(
        "grid grid-cols-2 gap-x-3 gap-y-2 rounded-2xl border border-white/5 bg-zinc-950/60 p-3 sm:p-4 lg:items-center lg:gap-5",
        COLUNAS_DA_LISTA,
      )}
    >
      <div className="col-span-2 flex min-w-0 items-center gap-2 lg:col-span-1">
        <span
          aria-hidden="true"
          className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-zinc-900 text-sm font-black text-admin-gold"
        >
          {nome.charAt(0).toUpperCase()}
        </span>
        <p className="min-w-0 flex-1 truncate text-sm font-bold text-white">
          {nome}
        </p>
        {/* No celular o segmento já aparece aqui, junto do nome — a coluna
            "Segmento" abaixo só existe (e só conta) a partir do desktop. */}
        <span className="shrink-0 lg:hidden">
          <CrachaDoSegmento segmento={cliente.segmento} />
        </span>
      </div>

      <div className="hidden min-w-0 lg:block">
        <p className="lg:sr-only">Segmento</p>
        <CrachaDoSegmento segmento={cliente.segmento} />
      </div>

      {/* Pedidos/receita/última compra/canal: grade 2×2 no celular (`contents`
          some no desktop e devolve os 4 filhos direto pras colunas deles, na
          mesma ordem do cabeçalho — sem sobrar "Canal" sozinho numa linha). */}
      <div className="col-span-2 grid grid-cols-2 gap-x-3 gap-y-2 lg:contents">
        <div className="min-w-0">
          <p className="text-[10px] uppercase tracking-wider text-zinc-400 lg:sr-only">
            Pedidos
          </p>
          <p className="font-bold tabular-nums text-white">
            {formatarInteiro(cliente.pedidos)}
          </p>
        </div>

        <div className="min-w-0">
          <p className="text-[10px] uppercase tracking-wider text-zinc-400 lg:sr-only">
            Receita
          </p>
          <p className="truncate font-bold tabular-nums text-white">
            {formatarMoeda(cliente.receita)}
          </p>
        </div>

        <div className="min-w-0">
          <p className="text-[10px] uppercase tracking-wider text-zinc-400 lg:sr-only">
            Última compra
          </p>
          <p className="truncate tabular-nums text-zinc-300">
            {formatarData(cliente.ultimaCompra)}
          </p>
        </div>

        <div className="min-w-0">
          <p className="text-[10px] uppercase tracking-wider text-zinc-400 lg:sr-only">
            Canal
          </p>
          <p className="truncate text-zinc-300">
            {cliente.canalPreferido
              ? rotuloDoCanal(cliente.canalPreferido)
              : "—"}
          </p>
        </div>
      </div>

      <div className="col-span-2 flex gap-2 lg:col-span-1 lg:justify-end lg:pl-2">
        {whatsapp ? (
          <a
            href={whatsapp}
            target="_blank"
            rel="noopener noreferrer"
            className={cn(
              "flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl border border-emerald-500/25 bg-emerald-500/10 px-3 text-[10px] font-black uppercase tracking-widest text-emerald-300 transition-colors hover:bg-emerald-500/20 lg:flex-none",
              FOCO_DO_CRM,
            )}
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
            className={cn(
              "flex min-h-11 flex-1 items-center justify-center gap-1 rounded-xl border border-white/10 px-3 text-[10px] font-black uppercase tracking-widest text-zinc-200 transition-colors hover:bg-white/5 lg:flex-none",
              FOCO_DO_CRM,
            )}
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
  // Com busca ativa e a lista já carregada, "Mostrando" usa o total JÁ
  // filtrado (busca + segmento) — o bruto do segmento (crm_visao) ignora a
  // busca e mentia ("Mostrando: Em risco · 14" com a lista abaixo mostrando
  // só 1 nome).
  const contagemFiltradaPelaBusca =
    busca.trim() !== "" && lista ? total : undefined;

  return (
    <div className="space-y-6">
      <GradeDeSegmentos
        segmentos={segmentos}
        carregando={carregandoSegmentos}
        selecionado={segmento}
        aoSelecionar={aoMudarSegmento}
        contagemFiltrada={contagemFiltradaPelaBusca}
      />

      <CartaoDoCrm
        id="crm-lista"
        titulo={
          <span className="flex items-center gap-2">
            <Users className="size-3.5 shrink-0" aria-hidden="true" />
            {nomeDoSegmento
              ? `Clientes · ${nomeDoSegmento}`
              : "Todos os clientes"}
            {lista ? (
              <span className="font-normal text-zinc-500">
                ({formatarInteiro(total)})
              </span>
            ) : null}
          </span>
        }
        descricao="Quem já comprou pago, com WhatsApp e ficha prontos para um toque."
      >
        <div className="space-y-3">
          {/* Linha própria (não vai no `acao` do cabeçalho): o cabeçalho do
              `CartaoDoCrm` é uma linha `flex-wrap` com o título em
              `flex-1 min-w-0` — qualquer irmão com largura própria (fixa OU
              em %) o espreme, porque a decisão de quebrar linha usa a base
              flex do título (0%), não o conteúdo dele. Numa linha SÓ dela,
              a largura da busca não compete com nada. */}
          <div className="flex justify-end">
            <div className="relative w-full sm:w-72">
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
            <div role="alert">
              <EstadoVazioDoCrm
                className="border-red-500/20 bg-red-500/5"
                titulo={
                  <span className="inline-flex items-center gap-2 text-red-300">
                    <AlertCircle
                      className="size-4 shrink-0"
                      aria-hidden="true"
                    />
                    Não foi possível carregar os clientes
                  </span>
                }
                texto={erro}
                acao={
                  <button
                    type="button"
                    onClick={atualizar}
                    className={cn(
                      "flex min-h-11 items-center gap-1.5 rounded-xl border border-red-500/20 px-4 text-[10px] font-black uppercase tracking-wider text-red-200 transition-colors hover:bg-red-500/10",
                      FOCO_DO_CRM,
                    )}
                  >
                    <RefreshCw className="size-3.5" aria-hidden="true" />
                    Tentar de novo
                  </button>
                }
              />
            </div>
          ) : null}

          {esqueleto ? (
            <ul className="space-y-2" aria-busy="true">
              {Array.from({ length: 4 }, (_, i) => (
                <li
                  key={i}
                  className="premium-shimmer h-[132px] rounded-2xl lg:h-[76px]"
                />
              ))}
            </ul>
          ) : lista && lista.clientes.length > 0 ? (
            <div className="space-y-2">
              <div
                aria-hidden="true"
                className={cn(
                  "hidden gap-5 px-4 text-[10px] font-black uppercase tracking-wider text-zinc-400 lg:grid",
                  COLUNAS_DA_LISTA,
                )}
              >
                <span>Cliente</span>
                <span>Segmento</span>
                <span>Pedidos</span>
                <span>Receita</span>
                <span>Última compra</span>
                <span>Canal</span>
                <span>Ações</span>
              </div>
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
            </div>
          ) : lista ? (
            <EstadoVazioDoCrm
              titulo={
                busca.trim()
                  ? `Nenhum cliente encontrado para “${busca.trim()}”`
                  : nomeDoSegmento
                    ? `Nenhum cliente em ${nomeDoSegmento} agora`
                    : "Ainda não há clientes com compra paga"
              }
              texto={
                busca.trim()
                  ? "Tente outro nome, e-mail ou telefone."
                  : nomeDoSegmento
                    ? "Troque o segmento ou limpe o filtro para ver os outros clientes."
                    : "Assim que alguém comprar e o pagamento cair, a lista aparece aqui."
              }
              acao={
                busca.trim() || segmento ? (
                  <button
                    type="button"
                    onClick={() => {
                      setBusca("");
                      aoMudarSegmento(null);
                    }}
                    className={cn(
                      "min-h-11 rounded-xl border border-white/10 px-4 text-[10px] font-black uppercase tracking-widest text-zinc-200 transition-colors hover:bg-white/5",
                      FOCO_DO_CRM,
                    )}
                  >
                    Ver todos os clientes
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => onNavigate("admin-pdv")}
                    className={cn(
                      "min-h-11 rounded-xl bg-admin-gold px-4 text-[10px] font-black uppercase tracking-widest text-black transition-colors hover:bg-admin-gold/90",
                      FOCO_DO_CRM,
                    )}
                  >
                    Registrar uma venda
                  </button>
                )
              }
            />
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
        </div>
      </CartaoDoCrm>
    </div>
  );
}
