import { DebouncedSearchInput } from "@/components/admin/DebouncedSearchInput";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import {
  LayoutGrid,
  List,
  Loader2,
  type LucideIcon,
  Search,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";

const FOCO =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300";
const BOTAO = `flex min-h-11 items-center justify-center gap-2 whitespace-normal break-words rounded-full border border-white/10 bg-[#17171C] px-4 py-2 text-sm font-semibold text-zinc-200 ${FOCO}`;

interface Opcao {
  readonly valor: string;
  readonly rotulo: string;
  readonly selecionada: boolean;
  readonly onClick: () => void;
  readonly quantidade?: number;
  readonly ariaLabel?: string;
  readonly icone?: LucideIcon;
  readonly cor?: string;
}

interface BarraDeBuscaProps {
  readonly id: string;
  readonly name?: string;
  readonly rotulo: string;
  readonly placeholder: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly onTyping?: (digitando: boolean) => void;
  readonly carregando?: boolean;
  readonly modo: "compact" | "detailed";
  readonly onMudarModo: (modo: "compact" | "detailed") => void;
  readonly produtos?: boolean;
  readonly grupo: string;
  readonly opcoes: readonly Opcao[];
  readonly tituloFiltro?: string;
  readonly filtrosAtivos?: number;
  readonly nomeFiltros?: string;
  readonly filtrosAbertos?: boolean;
  readonly onAbrirFiltros?: () => void;
  readonly onLimpar?: () => void;
  readonly onGerenciarCategorias?: () => void;
  readonly children?: ReactNode;
}

export function OpcoesDaBusca({
  opcoes,
  folha = false,
}: {
  opcoes: readonly Opcao[];
  folha?: boolean;
}) {
  return opcoes.map(
    ({
      valor,
      rotulo,
      selecionada,
      onClick,
      quantidade,
      ariaLabel,
      icone: Icone,
      cor,
    }) => (
      <button
        key={valor}
        type="button"
        aria-label={ariaLabel}
        aria-pressed={selecionada}
        onClick={onClick}
        className={cn(
          BOTAO,
          folha ? "w-full" : "max-w-full shrink-0",
          selecionada && "border-admin-gold bg-admin-gold/10 text-admin-gold",
        )}
      >
        {Icone ? (
          <Icone aria-hidden="true" className={cn("size-5 shrink-0", cor)} />
        ) : cor ? (
          <span
            aria-hidden="true"
            className={cn("size-1.5 shrink-0 rounded-full", cor)}
          />
        ) : null}
        <span className="min-w-0 [overflow-wrap:anywhere]">{rotulo}</span>
        {!folha && quantidade !== undefined && (
          <span
            className="tabular-nums"
            aria-label={`${quantidade} no recorte`}
          >
            {quantidade}
          </span>
        )}
      </button>
    ),
  );
}

export function BarraDeBusca({
  id,
  name = "search",
  rotulo,
  placeholder,
  value,
  onChange,
  onTyping,
  carregando,
  modo,
  onMudarModo,
  produtos = false,
  grupo,
  opcoes,
  tituloFiltro,
  filtrosAtivos = 0,
  nomeFiltros = "Filtros",
  filtrosAbertos,
  onAbrirFiltros,
  onLimpar,
  onGerenciarCategorias,
  children,
}: BarraDeBuscaProps) {
  const [aberta, setAberta] = useState(false);
  const botaoFiltros = useRef<HTMLButtonElement>(null);
  const faixaDeOpcoes = useRef<HTMLDivElement>(null);
  const escolhida = opcoes.find((opcao) => opcao.selecionada)?.valor;
  // Escolha vinda de fora (alerta, valor salvo) pode estar além da borda: traz
  // a opção ligada para a vista, para o lojista ver qual filtro está valendo.
  // biome-ignore lint/correctness/useExhaustiveDependencies: só reage à troca
  useEffect(() => {
    faixaDeOpcoes.current
      ?.querySelector('[aria-pressed="true"]')
      ?.scrollIntoView?.({ inline: "nearest", block: "nearest" });
  }, [escolhida]);
  const abrindoCategorias = useRef(false);
  const detalhada = modo === "detailed";
  // O nome diz o que o toque faz (o PRÓXIMO modo); o ícone mostra o modo atual
  // em Pedidos e Clientes e o próximo em Produtos, como já era antes.
  const IconeModo = detalhada ? LayoutGrid : List;
  const proximoModo = produtos
    ? detalhada
      ? "Mostrar em grade"
      : "Mostrar em lista com detalhes"
    : detalhada
      ? "Mostrar compacto"
      : "Mostrar detalhado";

  return (
    <div
      data-barra-de-busca
      className="sticky top-0 z-30 -mx-5 space-y-2 border-b border-white/5 bg-[#08080A]/95 px-5 py-2 backdrop-blur-md"
    >
      <div className="flex items-center gap-2">
        <div className="group relative min-w-0 flex-1">
          <label htmlFor={id} className="sr-only">
            {rotulo}
          </label>
          <DebouncedSearchInput
            limpavel
            id={id}
            name={name}
            placeholder={placeholder}
            value={value}
            onChange={onChange}
            onTyping={onTyping}
            delay={300}
            className="h-12 w-full rounded-2xl border-white/10 bg-[#17171C] pl-10 text-sm text-white placeholder:text-zinc-400 focus-visible:ring-2 focus-visible:ring-sky-300 dark:bg-[#17171C]"
          />
          <span
            className="pointer-events-none absolute inset-y-0 left-3 flex items-center"
            aria-hidden="true"
          >
            {carregando ? (
              <Loader2 className="size-5 animate-spin text-sky-300" />
            ) : (
              <Search className="size-5 text-zinc-400" />
            )}
          </span>
        </div>
        <button
          type="button"
          aria-label={proximoModo}
          title={proximoModo}
          onClick={() => onMudarModo(detalhada ? "compact" : "detailed")}
          className={cn(BOTAO, "size-12 shrink-0 rounded-2xl p-0 text-sky-300")}
        >
          <IconeModo aria-hidden="true" className="size-5" />
        </button>
        <button
          ref={botaoFiltros}
          type="button"
          aria-label={nomeFiltros}
          title={nomeFiltros}
          aria-haspopup="dialog"
          aria-expanded={filtrosAbertos ?? aberta}
          onClick={() => {
            abrindoCategorias.current = false;
            if (onAbrirFiltros) onAbrirFiltros();
            else setAberta(true);
          }}
          className={cn(BOTAO, "relative size-12 shrink-0 rounded-2xl p-0")}
        >
          <SlidersHorizontal aria-hidden="true" className="size-5" />
          {filtrosAtivos > 0 && (
            <span className="absolute -right-1 -top-1 rounded-full bg-admin-gold px-1.5 text-[11px] font-bold text-zinc-950">
              {filtrosAtivos}
            </span>
          )}
        </button>
      </div>
      <div
        ref={faixaDeOpcoes}
        role="group"
        aria-label={grupo}
        className="custom-scrollbar-hidden flex gap-2 overflow-x-auto"
      >
        <OpcoesDaBusca opcoes={opcoes} />
      </div>
      {children}
      {!onAbrirFiltros && (
        <Dialog open={aberta} onOpenChange={setAberta}>
          <DialogContent
            showCloseButton={false}
            aria-describedby={undefined}
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              if (!abrindoCategorias.current) botaoFiltros.current?.focus();
            }}
            className="bottom-0 left-1/2 top-auto z-[80] max-h-[90dvh] max-w-full -translate-x-1/2 translate-y-0 gap-5 overflow-y-auto rounded-b-none rounded-t-[28px] border-white/15 bg-[#17171C] p-5 pb-[max(20px,env(safe-area-inset-bottom))] text-zinc-100 sm:bottom-auto sm:top-1/2 sm:max-w-lg sm:-translate-y-1/2 sm:rounded-[28px]"
          >
            <div className="flex items-center justify-between gap-3">
              <DialogTitle className="text-xl font-bold">Filtros</DialogTitle>
              <button
                type="button"
                aria-label="Fechar filtros"
                onClick={() => setAberta(false)}
                className={cn(BOTAO, "size-11 shrink-0 rounded-2xl p-0")}
              >
                <X aria-hidden="true" className="size-5" />
              </button>
            </div>
            <fieldset className="space-y-2">
              <legend className="mb-3 text-sm font-bold text-zinc-100">
                {tituloFiltro}
              </legend>
              <OpcoesDaBusca opcoes={opcoes} folha />
            </fieldset>
            {onGerenciarCategorias && (
              <button
                type="button"
                className={cn(BOTAO, "w-full text-teal-300")}
                onClick={() => {
                  abrindoCategorias.current = true;
                  setAberta(false);
                  onGerenciarCategorias();
                }}
              >
                Gerenciar categorias
              </button>
            )}
            {onLimpar && (
              <button
                type="button"
                onClick={onLimpar}
                className={`${BOTAO} w-full`}
              >
                Limpar tudo
              </button>
            )}
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
