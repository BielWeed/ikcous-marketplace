import { DebouncedSearchInput } from "@/components/admin/DebouncedSearchInput";
import { type TomDeEstado, classeDoTexto } from "@/lib/tons-de-estado";
import { cn } from "@/lib/utils";
import {
  AlertCircle,
  ChevronLeft,
  ChevronRight,
  LayoutGrid,
  List,
  Loader2,
  type LucideIcon,
  Maximize2,
  Minimize2,
  Search,
} from "lucide-react";
import { type ReactNode, useEffect, useId, useRef, useState } from "react";

/**
 * Peças compartilhadas das telas Perguntas e Avaliações do painel (desenho
 * aprovado em 22/10/2026). Tudo aqui é NEUTRO: cor só entra onde significa
 * algo (vermelho de exclusão e de erro), sempre em texto, glifo ou borda fina
 * — nunca em bloco cheio. Tokens `admin-*` e classes que o tema Claro/
 * Confortável já remapeiam, nunca cor fixa.
 *
 * Todo `<button>` com borda leva `border-solid`: o reset de `button` do
 * index.css apaga o estilo da borda e só `border` + cor não a devolve.
 */

/** Botão de ação neutro: moldura visível, 44px de toque. */
export const BOTAO_NEUTRO =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-solid border-admin-border-strong bg-admin-raised px-4 text-sm font-semibold text-zinc-100 transition-colors hover:bg-admin-hover disabled:cursor-not-allowed disabled:opacity-40";

/** Botão que apaga: só texto/glifo e moldura em vermelho, sem preenchimento. */
export const BOTAO_DE_EXCLUIR =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-solid border-red-500/40 bg-transparent px-4 text-sm font-semibold text-red-400 transition-colors hover:bg-red-500/10 disabled:cursor-not-allowed disabled:opacity-40";

/** Botão quadrado de 44px só com ícone (lixeira, seta, ajuda). */
export const BOTAO_DE_ICONE =
  "inline-flex size-11 shrink-0 items-center justify-center rounded-xl border border-solid border-admin-border-strong bg-transparent text-zinc-200 transition-colors hover:bg-admin-raised disabled:cursor-not-allowed disabled:opacity-40";

/** Lixeira: quadrada de 44px, só o glifo e a moldura em vermelho. */
export const BOTAO_DE_ICONE_EXCLUIR =
  "inline-flex size-11 shrink-0 items-center justify-center rounded-xl border border-solid border-red-500/40 bg-transparent text-red-400 transition-colors hover:bg-red-500/10 disabled:cursor-not-allowed disabled:opacity-40";

/** Rola a lista até o topo ao trocar de página (mesmo caminho de antes). */
export function rolarAoTopo(origem: HTMLElement) {
  const alvo =
    origem.closest(".admin-scroll-container") ||
    document.querySelector(".active-scroll-container") ||
    document.querySelector("main");
  if (alvo) alvo.scrollTo({ top: 0, behavior: "smooth" });
}

/** Inicial do cliente num círculo neutro (sem degradê de cor por nome). */
export function Avatar({ nome }: { readonly nome: string | undefined }) {
  const inicial = nome ? nome.trim().charAt(0).toUpperCase() : "";
  return (
    <span
      aria-hidden="true"
      className="flex size-10 shrink-0 items-center justify-center rounded-full border border-solid border-admin-border-strong bg-admin-raised text-sm font-bold text-zinc-100"
    >
      {inicial || "?"}
    </span>
  );
}

/** Busca com lupa, botão de limpar e a troca compacto/detalhado ao lado. */
export function BuscaEModo({
  id,
  rotulo,
  placeholder,
  valor,
  aoMudar,
  aoDigitar,
  buscando,
  detalhado,
  aoTrocarModo,
}: {
  readonly id: string;
  readonly rotulo: string;
  readonly placeholder: string;
  readonly valor: string;
  readonly aoMudar: (novo: string) => void;
  readonly aoDigitar: (digitando: boolean) => void;
  readonly buscando: boolean;
  readonly detalhado: boolean;
  readonly aoTrocarModo: () => void;
}) {
  const nomeDoModo = detalhado
    ? "Visualização Compacta"
    : "Visualização Detalhada";
  const IconeDoModo: LucideIcon = detalhado ? LayoutGrid : List;
  return (
    <div className="flex items-center gap-2">
      <div className="relative min-w-0 flex-1">
        <span
          aria-hidden="true"
          className="pointer-events-none absolute left-3.5 top-1/2 z-10 -translate-y-1/2 text-zinc-300"
        >
          {buscando ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Search className="size-4" />
          )}
        </span>
        <label htmlFor={id} className="sr-only">
          {rotulo}
        </label>
        <DebouncedSearchInput
          id={id}
          name="search"
          placeholder={placeholder}
          limpavel
          className="h-11 rounded-2xl border border-solid border-admin-border-strong bg-admin-bg pl-10 pr-3 text-base text-white placeholder:text-sm placeholder:text-zinc-400 md:text-base"
          value={valor}
          onChange={aoMudar}
          onTyping={aoDigitar}
          delay={300}
        />
      </div>
      <button
        type="button"
        onClick={aoTrocarModo}
        aria-pressed={detalhado}
        aria-label={nomeDoModo}
        title={nomeDoModo}
        className="flex size-11 shrink-0 items-center justify-center rounded-2xl border border-solid border-admin-border-strong bg-admin-surface text-zinc-200 transition-colors hover:bg-admin-raised"
      >
        <IconeDoModo aria-hidden="true" className="size-5" />
      </button>
    </div>
  );
}

export interface OpcaoDeFiltro<T extends string | number> {
  readonly valor: T;
  readonly rotulo: ReactNode;
  /** Nome falado (leitor de tela) quando o rótulo é só um ícone/símbolo. */
  readonly nome?: string;
  readonly contagem?: ReactNode;
  /** Cor do número (só quando ele significa algo: âmbar = pendente). */
  readonly tomDaContagem?: TomDeEstado;
  readonly larga?: boolean;
}

/** Filtro em segmentos: o escolhido leva moldura forte e fundo elevado. */
export function FiltroEmSegmentos<T extends string | number>({
  rotulo,
  opcoes,
  valor,
  aoEscolher,
}: {
  readonly rotulo: string;
  readonly opcoes: readonly OpcaoDeFiltro<T>[];
  readonly valor: T;
  readonly aoEscolher: (novo: T) => void;
}) {
  return (
    <div
      role="group"
      aria-label={rotulo}
      className="flex gap-px rounded-2xl border border-solid border-admin-border bg-admin-surface p-0.5"
    >
      {opcoes.map((opcao) => {
        const escolhido = opcao.valor === valor;
        const corDaContagem = opcao.tomDaContagem
          ? classeDoTexto(opcao.tomDaContagem)
          : "";
        return (
          <button
            key={String(opcao.valor)}
            type="button"
            aria-pressed={escolhido}
            aria-label={opcao.nome}
            onClick={() => aoEscolher(opcao.valor)}
            className={cn(
              "flex min-h-11 min-w-11 items-center justify-center gap-1.5 whitespace-nowrap rounded-xl border border-solid px-1.5 text-sm transition-colors",
              opcao.larga ? "flex-[1.5]" : "flex-1",
              escolhido
                ? "border-admin-border-strong bg-admin-raised font-bold text-white"
                : "border-transparent font-medium text-zinc-300 hover:bg-admin-raised",
            )}
          >
            {opcao.rotulo}
            {opcao.contagem != null && (
              <>
                {" "}
                <span className={cn("font-bold tabular-nums", corDaContagem)}>
                  {opcao.contagem}
                </span>
              </>
            )}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Resumo numa linha que se expande em cartões. Fechado mostra só `linha`;
 * aberto troca a linha pelo título e mostra os cartões (`children`) — os
 * números nunca aparecem duas vezes na tela.
 */
export function ResumoRecolhivel({
  linha,
  nome,
  titulo = "Resumo",
  colunas = 2,
  children,
}: {
  readonly linha: ReactNode;
  /** Nome falado da seção (leitor de tela); o título visível é `titulo`. */
  readonly nome?: string;
  readonly titulo?: string;
  /** Quantos cartões por linha (Perguntas: 3; Avaliações: 2). */
  readonly colunas?: 2 | 3;
  readonly children: ReactNode;
}) {
  const [aberto, setAberto] = useState(false);
  const idDosCartoes = useId();
  const botao = (
    <button
      type="button"
      aria-expanded={aberto}
      aria-controls={aberto ? idDosCartoes : undefined}
      onClick={() => setAberto((a) => !a)}
      className="inline-flex min-h-11 shrink-0 items-center gap-2 rounded-2xl border border-solid border-admin-border-strong bg-transparent px-3.5 text-sm font-semibold text-zinc-100 transition-colors hover:bg-admin-raised"
    >
      {aberto ? (
        <Minimize2 aria-hidden="true" className="size-4" />
      ) : (
        <Maximize2 aria-hidden="true" className="size-4" />
      )}
      {aberto ? "Recolher" : "Expandir"}
    </button>
  );
  return (
    <section aria-label={nome ?? titulo}>
      {aberto ? (
        <>
          <div className="flex items-center justify-between gap-3">
            <p className="text-base font-bold text-white">{titulo}</p>
            {botao}
          </div>
          <div
            id={idDosCartoes}
            className={cn(
              "mt-3 grid gap-2",
              colunas === 3
                ? "grid-cols-2 min-[380px]:grid-cols-3"
                : "grid-cols-2",
            )}
          >
            {children}
          </div>
        </>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
          <div className="flex min-w-[12rem] flex-1 items-center gap-2.5">
            {linha}
          </div>
          {botao}
        </div>
      )}
    </section>
  );
}

/** Barrinha de proporção, neutra (o número já está escrito ao lado). */
export function BarraDeProporcao({
  percentual,
  className,
}: {
  readonly percentual: number;
  readonly className?: string;
}) {
  const largura = Math.min(100, Math.max(0, percentual));
  return (
    <span
      aria-hidden="true"
      className={cn(
        "block h-1.5 min-w-8 flex-1 overflow-hidden rounded-full bg-admin-raised",
        className,
      )}
    >
      <span
        className="block h-full rounded-full bg-foreground"
        style={{ width: `${largura}%` }}
      />
    </span>
  );
}

/** Cartão de número do resumo expandido. */
export function CartaoDeNumero({
  rotulo,
  valor,
  extra,
  rodape,
}: {
  readonly rotulo: ReactNode;
  readonly valor: ReactNode;
  readonly extra?: ReactNode;
  readonly rodape: ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5 rounded-2xl border border-solid border-admin-border bg-admin-surface p-3">
      <span className="break-words text-sm font-medium text-zinc-300">
        {rotulo}
      </span>
      <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-3xl font-bold leading-none tabular-nums text-white">
        {valor}
      </span>
      {extra}
      <span className="text-sm text-zinc-400">{rodape}</span>
    </div>
  );
}

/** Lista vazia: ícone neutro, título, frase e, se couber, um botão. */
export function VazioDaLista({
  icone: Icone,
  titulo,
  frase,
  acao,
}: {
  readonly icone: LucideIcon;
  readonly titulo: string;
  readonly frase: string;
  readonly acao?: { readonly rotulo: string; readonly aoClicar: () => void };
}) {
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-14 text-center">
      <span
        aria-hidden="true"
        className="flex size-16 items-center justify-center rounded-full border border-solid border-admin-border-strong text-zinc-200"
      >
        <Icone className="size-7" />
      </span>
      <h2 className="text-lg font-bold text-white">{titulo}</h2>
      <p className="max-w-xs text-sm text-zinc-300">{frase}</p>
      {acao && (
        <button
          type="button"
          onClick={acao.aoClicar}
          className={cn(BOTAO_NEUTRO, "mt-1")}
        >
          {acao.rotulo}
        </button>
      )}
    </div>
  );
}

/** Aviso em vermelho discreto (sem internet, falha ao carregar). */
export function AvisoDeProblema({
  children,
  acao,
}: {
  readonly children: ReactNode;
  readonly acao?: ReactNode;
}) {
  return (
    <div
      role="alert"
      className="flex flex-col gap-3 rounded-2xl border border-solid border-red-500/40 p-3.5"
    >
      <p className="flex items-start gap-2.5 text-sm text-zinc-100">
        <AlertCircle
          aria-hidden="true"
          className="mt-0.5 size-4 shrink-0 text-red-400"
        />
        <span className="min-w-0 flex-1">{children}</span>
      </p>
      {acao}
    </div>
  );
}

/**
 * Exclusão pedida por uma frase dentro do cartão: Cancelar (à esquerda, recebe
 * o foco — o foco não pode se perder quando a lixeira some) e Excluir.
 * Se `aoConfirmar` devolve uma promessa, os dois botões travam até ela acabar:
 * o segundo toque não dispara outra exclusão (nem "removida" + "erro" juntos).
 */
export function ConfirmarExclusao({
  frase,
  aoCancelar,
  aoConfirmar,
}: {
  readonly frase: string;
  readonly aoCancelar: () => void;
  readonly aoConfirmar: () => unknown;
}) {
  const cancelar = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    cancelar.current?.focus();
  }, []);
  const [excluindo, setExcluindo] = useState(false);
  const travado = useRef(false);
  async function confirmar() {
    if (travado.current) return;
    travado.current = true;
    setExcluindo(true);
    try {
      await aoConfirmar();
    } finally {
      travado.current = false;
      setExcluindo(false);
    }
  }
  return (
    <div>
      <p className="text-base text-zinc-100">{frase}</p>
      <div className="mt-3 flex gap-2">
        <button
          ref={cancelar}
          type="button"
          disabled={excluindo}
          onClick={aoCancelar}
          className={cn(BOTAO_NEUTRO, "flex-1")}
        >
          Cancelar
        </button>
        <button
          type="button"
          disabled={excluindo}
          onClick={() => void confirmar()}
          className={cn(BOTAO_DE_EXCLUIR, "flex-1")}
        >
          {excluindo ? "Excluindo…" : "Excluir"}
        </button>
      </div>
    </div>
  );
}

/** Anterior / "Página X de N" / Seguinte. */
export function Paginador({
  pagina,
  totalDePaginas,
  aoMudar,
}: {
  readonly pagina: number;
  readonly totalDePaginas: number;
  readonly aoMudar: (nova: number, origem: HTMLElement) => void;
}) {
  return (
    <nav
      aria-label="Páginas"
      className="mt-5 flex items-center justify-between gap-3"
    >
      <button
        type="button"
        onClick={(e) => aoMudar(Math.max(0, pagina - 1), e.currentTarget)}
        disabled={pagina === 0}
        className={BOTAO_NEUTRO}
      >
        <ChevronLeft aria-hidden="true" className="size-4" />
        Anterior
      </button>
      <span className="text-sm text-zinc-300">
        Página <strong className="text-white">{pagina + 1}</strong> de{" "}
        {totalDePaginas}
      </span>
      <button
        type="button"
        onClick={(e) =>
          aoMudar(Math.min(totalDePaginas - 1, pagina + 1), e.currentTarget)
        }
        disabled={pagina >= totalDePaginas - 1}
        className={BOTAO_NEUTRO}
      >
        Seguinte
        <ChevronRight aria-hidden="true" className="size-4" />
      </button>
    </nav>
  );
}
