import type { ClienteDoCupom } from "@/hooks/useCoupons";
import { cn } from "@/lib/utils";
import type { AlcanceDoCupom } from "@/types";
import {
  AlertTriangle,
  Eye,
  KeyRound,
  Search,
  UserCheck,
  UserPlus,
  X,
} from "lucide-react";
import { type ReactElement, useRef, useState } from "react";

/**
 * "Quem pode usar" do formulário de cupom (frente B, 28/09/2026). Três
 * alcances, que o servidor respeita (migration 20261187000000):
 *   - Quem tiver o código: secreto, não aparece no checkout (o de sempre).
 *   - Todos os clientes: aparece no checkout de qualquer pessoa.
 *   - Clientes escolhidos: só essas contas VEEM e USAM — para as outras, o
 *     código "não existe".
 *
 * Este arquivo NÃO chama Supabase: a busca de clientes é injetada pela view
 * (mesmo desenho do ClienteDaVenda do balcão). Nunca pede nem mostra CPF.
 */

export interface ClienteEncontrado {
  readonly id: string;
  readonly full_name: string | null;
  readonly email: string | null;
}

const OPCOES: ReadonlyArray<{
  valor: AlcanceDoCupom;
  titulo: string;
  explicacao: string;
  Icone: typeof Eye;
}> = [
  {
    valor: "codigo",
    titulo: "Quem tiver o código",
    explicacao: "Não aparece no checkout. Só vale para quem digitar o código.",
    Icone: KeyRound,
  },
  {
    valor: "vitrine",
    titulo: "Todos os clientes",
    explicacao:
      "Aparece no checkout de qualquer cliente, com o botão de aplicar.",
    Icone: Eye,
  },
  {
    valor: "exclusivo",
    titulo: "Clientes escolhidos",
    explicacao:
      "Só as contas escolhidas veem e usam. Para as outras, o código não existe.",
    Icone: UserCheck,
  },
];

export interface QuemPodeUsarOCupomProps {
  readonly alcance: AlcanceDoCupom;
  readonly onAlcance: (alcance: AlcanceDoCupom) => void;
  readonly clientes: readonly ClienteDoCupom[];
  readonly onClientes: (clientes: ClienteDoCupom[]) => void;
  readonly carregandoClientes: boolean;
  /** A lista gravada não carregou: nada de editar/salvar até carregar. */
  readonly falhaAoCarregar?: boolean;
  readonly onCarregarDeNovo?: () => void;
  readonly buscarClientes: (
    termo: string,
  ) => Promise<readonly ClienteEncontrado[]>;
  /** Vitrine sem limite de uso nem validade: o aviso aparece. */
  readonly semLimiteNemValidade: boolean;
  readonly desabilitado: boolean;
}

export function QuemPodeUsarOCupom({
  alcance,
  onAlcance,
  clientes,
  onClientes,
  carregandoClientes,
  falhaAoCarregar = false,
  onCarregarDeNovo,
  buscarClientes,
  semLimiteNemValidade,
  desabilitado,
}: QuemPodeUsarOCupomProps): ReactElement {
  const [termo, setTermo] = useState("");
  const [resultados, setResultados] = useState<readonly ClienteEncontrado[]>(
    [],
  );
  const [buscando, setBuscando] = useState(false);
  const [erroDaBusca, setErroDaBusca] = useState(false);
  const rodadaRef = useRef(0);
  const esperaRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Lista gravada ainda carregando (ou que falhou): não se mexe nela.
  const listaTravada = carregandoClientes || falhaAoCarregar;

  function aoDigitar(valor: string): void {
    setTermo(valor);
    if (esperaRef.current) clearTimeout(esperaRef.current);
    const limpo = valor.trim();
    if (limpo.length < 2) {
      rodadaRef.current++;
      setResultados([]);
      setBuscando(false);
      setErroDaBusca(false);
      return;
    }
    esperaRef.current = setTimeout(async () => {
      const rodada = ++rodadaRef.current;
      setBuscando(true);
      setErroDaBusca(false);
      try {
        const linhas = await buscarClientes(limpo);
        if (rodada !== rodadaRef.current) return;
        setResultados(linhas);
      } catch {
        if (rodada !== rodadaRef.current) return;
        setResultados([]);
        setErroDaBusca(true);
      } finally {
        if (rodada === rodadaRef.current) setBuscando(false);
      }
    }, 300);
  }

  function adicionar(c: ClienteEncontrado): void {
    if (clientes.some((x) => x.id === c.id)) return;
    onClientes([...clientes, { id: c.id, nome: c.full_name, email: c.email }]);
  }

  function remover(id: string): void {
    onClientes(clientes.filter((c) => c.id !== id));
  }

  return (
    <fieldset className="space-y-2" disabled={desabilitado}>
      <legend className="mb-1.5 ml-1 text-[10px] font-bold uppercase tracking-wider text-zinc-500">
        Quem pode usar
      </legend>
      <div role="radiogroup" aria-label="Quem pode usar" className="space-y-2">
        {OPCOES.map(({ valor, titulo, explicacao, Icone }) => {
          const marcado = alcance === valor;
          return (
            <button
              key={valor}
              type="button"
              role="radio"
              aria-checked={marcado}
              onClick={() => onAlcance(valor)}
              className={cn(
                "flex w-full items-start gap-3 rounded-xl border p-3 text-left transition-colors disabled:opacity-50",
                marcado
                  ? "border-emerald-500/40 bg-emerald-500/10"
                  : "border-white/10 bg-white/[0.03] hover:bg-white/[0.06]",
              )}
            >
              <Icone
                aria-hidden="true"
                className={cn(
                  "mt-0.5 size-4 shrink-0",
                  marcado ? "text-emerald-400" : "text-zinc-500",
                )}
              />
              <span className="min-w-0">
                <span
                  className={cn(
                    "block text-xs font-bold",
                    marcado ? "text-white" : "text-zinc-300",
                  )}
                >
                  {titulo}
                </span>
                <span className="mt-0.5 block text-[11px] leading-snug text-zinc-400">
                  {explicacao}
                </span>
              </span>
            </button>
          );
        })}
      </div>

      {alcance === "vitrine" && semLimiteNemValidade && (
        <p className="flex items-start gap-2 rounded-xl border border-amber-500/20 bg-amber-500/10 p-3 text-[11px] leading-snug text-amber-200">
          <AlertTriangle
            aria-hidden="true"
            className="mt-0.5 size-3.5 shrink-0"
          />
          Este cupom vai aparecer para todo mundo sem limite de uso nem
          validade. Se não é essa a ideia, defina um limite ou uma data.
        </p>
      )}

      {alcance === "exclusivo" && (
        <div className="space-y-2 rounded-xl border border-white/10 bg-white/[0.02] p-3">
          <label
            htmlFor="coupon-clientes-busca"
            className="block text-[10px] font-bold uppercase tracking-wider text-zinc-500"
          >
            Adicionar cliente
          </label>
          <div className="relative">
            <Search
              aria-hidden="true"
              className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-zinc-500"
            />
            <input
              id="coupon-clientes-busca"
              type="search"
              disabled={listaTravada}
              autoComplete="off"
              value={termo}
              onChange={(e) => aoDigitar(e.target.value)}
              placeholder="Nome, e-mail ou WhatsApp"
              className="h-11 w-full rounded-xl border border-white/10 bg-white/[0.03] pl-9 pr-3 text-sm text-white placeholder:text-zinc-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/30"
            />
          </div>

          {buscando && (
            <p className="text-[11px] text-zinc-500" aria-live="polite">
              Buscando…
            </p>
          )}
          {erroDaBusca && (
            <p role="alert" className="text-[11px] text-red-400">
              Não foi possível buscar clientes. Tente de novo.
            </p>
          )}
          {!buscando &&
            termo.trim().length >= 2 &&
            resultados.length === 0 &&
            !erroDaBusca && (
              <p className="text-[11px] text-zinc-500">
                Nenhum cliente encontrado.
              </p>
            )}
          {resultados.length > 0 && (
            <ul aria-label="Clientes encontrados" className="space-y-1">
              {resultados.map((c) => {
                const jaEsta = clientes.some((x) => x.id === c.id);
                return (
                  <li key={c.id}>
                    <button
                      type="button"
                      onClick={() => adicionar(c)}
                      disabled={jaEsta || listaTravada}
                      className="flex min-h-11 w-full items-center justify-between gap-2 rounded-lg px-2 text-left hover:bg-white/[0.05] disabled:opacity-50"
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-xs font-semibold text-white">
                          {c.full_name || "Sem nome"}
                        </span>
                        {c.email && (
                          <span className="block truncate text-[11px] text-zinc-500">
                            {c.email}
                          </span>
                        )}
                      </span>
                      <span className="flex shrink-0 items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-emerald-400">
                        <UserPlus aria-hidden="true" className="size-3.5" />
                        {jaEsta ? "Na lista" : "Adicionar"}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}

          <div className="border-t border-white/5 pt-2">
            <p className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-zinc-500">
              {carregandoClientes
                ? "Carregando a lista…"
                : `Na lista (${clientes.length})`}
            </p>
            {falhaAoCarregar && (
              <div className="mb-2 flex items-center justify-between gap-2 rounded-lg border border-red-500/20 bg-red-500/10 p-2">
                <p role="alert" className="text-[11px] text-red-300">
                  A lista de clientes deste cupom não carregou. Nada pode ser
                  mudado nela até carregar.
                </p>
                <button
                  type="button"
                  onClick={onCarregarDeNovo}
                  className="min-h-11 shrink-0 rounded-lg px-3 text-[10px] font-bold uppercase tracking-wider text-white hover:bg-white/10"
                >
                  Carregar de novo
                </button>
              </div>
            )}
            {!listaTravada && clientes.length === 0 && (
              <p className="text-[11px] text-amber-300">
                Nenhum cliente ainda — sem ninguém na lista, ninguém consegue
                usar este cupom.
              </p>
            )}
            <ul
              aria-label="Clientes que podem usar"
              className="flex flex-wrap gap-1.5"
            >
              {clientes.map((c) => (
                <li
                  key={c.id}
                  className="flex max-w-full items-center gap-1 rounded-full border border-white/10 bg-white/[0.05] py-1 pl-3 pr-1 text-[11px] text-zinc-200"
                >
                  <span className="truncate">
                    {c.nome || c.email || "Cliente sem nome"}
                  </span>
                  <button
                    type="button"
                    onClick={() => remover(c.id)}
                    disabled={listaTravada}
                    aria-label={`Tirar ${c.nome || c.email || "cliente"} da lista`}
                    className="flex size-7 shrink-0 items-center justify-center rounded-full text-zinc-400 hover:bg-white/10 hover:text-white"
                  >
                    <X aria-hidden="true" className="size-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </fieldset>
  );
}
