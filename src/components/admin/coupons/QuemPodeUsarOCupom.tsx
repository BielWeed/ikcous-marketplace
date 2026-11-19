import { GrupoDeOpcoes } from "@/components/admin/GrupoDeOpcoes";
import {
  CAMPO,
  FOCO,
  SECUNDARIO,
  Selo,
} from "@/components/admin/coupons/apresentacao";
import { programarAvisoDeConsultaDoPainel } from "@/lib/prazo-da-requisicao";
import { cn } from "@/lib/utils";
import type { AlcanceDoCupom, ClienteDoCupom } from "@/types";
import {
  AlertTriangle,
  Check,
  LockKeyhole,
  Search,
  Ticket,
  UserPlus,
  Users,
  X,
} from "lucide-react";
import { type ReactElement, useEffect, useRef, useState } from "react";

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
  Icone: typeof Ticket;
  matiz: string;
}> = [
  {
    valor: "codigo",
    titulo: "Quem tiver o código",
    explicacao: "Não aparece no checkout. Só vale para quem digitar o código.",
    Icone: Ticket,
    matiz: "#FF91B9",
  },
  {
    valor: "vitrine",
    titulo: "Todos os clientes",
    explicacao:
      "Aparece no checkout de qualquer cliente, com o botão de aplicar.",
    Icone: Users,
    matiz: "#53D9CD",
  },
  {
    valor: "exclusivo",
    titulo: "Clientes escolhidos",
    explicacao:
      "Só as contas escolhidas veem e usam. Para as outras, o código não existe.",
    Icone: LockKeyhole,
    matiz: "#BAA0FF",
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
  /** `total` é quantas contas o termo acha no banco inteiro (a página traz só
   * as primeiras): é o que deixa a tela avisar que há mais. */
  readonly buscarClientes: (
    termo: string,
    sinal: AbortSignal,
  ) => Promise<{
    readonly clientes: readonly ClienteEncontrado[];
    readonly total: number;
  }>;
  /** Vitrine sem limite de uso nem validade: o aviso aparece. */
  readonly semLimiteNemValidade: boolean;
  /**
   * O campo "Limite de uso" está em 0 (ilimitado). Clientes escolhidos: o
   * limite é da loja inteira, não de cada cliente. Sem esta informação, vale
   * `semLimiteNemValidade` (que implica limite 0).
   */
  readonly semLimiteDeUso?: boolean;
  readonly desabilitado: boolean;
  /**
   * Recusa do Salvar que é desta região (lista de clientes vazia ou que não
   * carregou): o texto aparece aqui, ligado à região (`aria-describedby`) e à
   * busca. `regiaoId` e `erroId` são dados pela tela, que é quem leva o foco.
   */
  readonly erro?: string | null;
  readonly regiaoId?: string;
  readonly erroId?: string;
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
  semLimiteDeUso,
  desabilitado,
  erro = null,
  regiaoId,
  erroId,
}: QuemPodeUsarOCupomProps): ReactElement {
  const [termo, setTermo] = useState("");
  const [resultados, setResultados] = useState<readonly ClienteEncontrado[]>(
    [],
  );
  const [totalDaBusca, setTotalDaBusca] = useState(0);
  const [buscando, setBuscando] = useState(false);
  const [erroDaBusca, setErroDaBusca] = useState<string | null>(null);
  const rodadaRef = useRef(0);
  const cancelarBuscaRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (alcance !== "exclusivo") {
      setTermo("");
      setResultados([]);
      setTotalDaBusca(0);
      setBuscando(false);
      setErroDaBusca(null);
    }
    return () => {
      rodadaRef.current += 1;
      cancelarBuscaRef.current?.();
    };
  }, [alcance]);

  // Lista gravada ainda carregando (ou que falhou): não se mexe nela.
  const listaTravada = carregandoClientes || falhaAoCarregar;

  function aoDigitar(valor: string): void {
    setTermo(valor);
    const limpo = valor.trim();
    // Invalida a busca anterior já na digitação, antes dos 300 ms de espera.
    const rodada = ++rodadaRef.current;
    cancelarBuscaRef.current?.();
    setResultados([]);
    setTotalDaBusca(0);
    setErroDaBusca(null);
    setBuscando(limpo.length >= 2);
    if (limpo.length < 2) return;
    const espera = setTimeout(async () => {
      const cancelarAviso = programarAvisoDeConsultaDoPainel(() => {
        if (rodada !== rodadaRef.current) return;
        // Depois do prazo, não repõe a lista com a busca antiga.
        rodadaRef.current += 1;
        setErroDaBusca("A busca demorou.");
        setBuscando(false);
      });
      const controle = new AbortController();
      const cancelar = () => {
        cancelarAviso();
        controle.abort();
      };
      cancelarBuscaRef.current = cancelar;
      try {
        const pagina = await buscarClientes(limpo, controle.signal);
        if (rodada !== rodadaRef.current) return;
        setResultados(pagina.clientes);
        setTotalDaBusca(pagina.total);
      } catch {
        if (rodada === rodadaRef.current) {
          setErroDaBusca("Não foi possível buscar clientes.");
        }
      } finally {
        cancelarAviso();
        if (cancelarBuscaRef.current === cancelar) {
          cancelarBuscaRef.current = null;
        }
        if (rodada === rodadaRef.current) setBuscando(false);
      }
    }, 300);
    cancelarBuscaRef.current = () => clearTimeout(espera);
  }

  function adicionar(c: ClienteEncontrado): void {
    if (clientes.some((x) => x.id === c.id)) return;
    onClientes([...clientes, { id: c.id, nome: c.full_name, email: c.email }]);
  }

  function remover(id: string): void {
    onClientes(clientes.filter((c) => c.id !== id));
  }

  return (
    <fieldset
      id={regiaoId}
      tabIndex={regiaoId ? -1 : undefined}
      aria-describedby={erro ? erroId : undefined}
      className="min-w-0 space-y-3 outline-none"
      disabled={desabilitado}
    >
      <legend className="mb-3 flex items-center gap-2.5 text-lg font-bold text-zinc-50">
        <Selo icone={Users} matiz="#73BFFF" />
        Quem pode usar
      </legend>
      <GrupoDeOpcoes
        aria-label="Quem pode usar"
        className="space-y-3 xl:grid xl:grid-cols-3 xl:gap-3 xl:space-y-0"
      >
        {OPCOES.map(({ valor, titulo, explicacao, Icone, matiz }) => {
          const marcado = alcance === valor;
          return (
            <button
              key={valor}
              type="button"
              role="radio"
              aria-checked={marcado}
              onClick={() => onAlcance(valor)}
              className={cn(
                `flex min-h-11 w-full items-center gap-3 rounded-[20px] border p-4 text-left transition-colors ${FOCO}`,
                marcado && !desabilitado
                  ? "border-[#F5C542] bg-[#F5C542]/10"
                  : "border-admin-border bg-admin-surface hover:bg-white/[0.06]",
              )}
            >
              <Selo icone={Icone} matiz={desabilitado ? "#A1A1AD" : matiz} />
              <span className="min-w-0">
                <span
                  className={cn(
                    "block text-sm font-bold",
                    marcado ? "text-white" : "text-zinc-300",
                  )}
                >
                  {titulo}
                </span>
                <span className="mt-1 block text-sm leading-relaxed text-zinc-400">
                  {explicacao}
                </span>
              </span>
              {marcado && (
                <Check
                  aria-hidden="true"
                  className={cn(
                    "ml-auto size-5 shrink-0 rounded-full",
                    desabilitado
                      ? "text-zinc-400"
                      : "bg-[#F5C542] p-0.5 text-[#1B1300]",
                  )}
                />
              )}
            </button>
          );
        })}
      </GrupoDeOpcoes>

      {erro && (
        <p
          id={erroId}
          role="alert"
          className="text-xs font-medium text-red-300"
        >
          {erro}
        </p>
      )}

      {alcance === "vitrine" && semLimiteNemValidade && (
        <p className="flex items-start gap-2 rounded-[20px] border border-sky-300/20 bg-sky-300/5 p-4 text-sm leading-relaxed text-sky-200">
          <AlertTriangle
            aria-hidden="true"
            className="mt-0.5 size-3.5 shrink-0"
          />
          Este cupom vai aparecer para todo mundo sem limite de uso nem
          validade. Se não é essa a ideia, defina um limite ou uma data.
        </p>
      )}

      {alcance === "exclusivo" && (semLimiteDeUso ?? semLimiteNemValidade) && (
        <p className="flex items-start gap-2 rounded-[20px] border border-sky-300/20 bg-sky-300/5 p-4 text-sm leading-relaxed text-sky-200">
          <AlertTriangle
            aria-hidden="true"
            className="mt-0.5 size-3.5 shrink-0"
          />
          Clientes da lista podem usar o cupom sem limite de vezes, desde que
          respeitem o valor mínimo e a validade. Quando definido, o limite de
          usos vale para a loja toda, não por cliente.
        </p>
      )}

      {alcance === "exclusivo" && (
        <div className="space-y-3 rounded-[20px] border border-admin-border bg-admin-surface p-4">
          <label
            htmlFor="coupon-clientes-busca"
            className="block text-sm text-zinc-400"
          >
            Adicionar cliente
          </label>
          <div className="relative">
            <Search
              aria-hidden="true"
              className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-zinc-400"
            />
            <input
              id="coupon-clientes-busca"
              type="search"
              disabled={listaTravada}
              autoComplete="off"
              value={termo}
              onChange={(e) => aoDigitar(e.target.value)}
              placeholder="Nome, e-mail ou WhatsApp"
              aria-invalid={erro ? true : undefined}
              aria-describedby={
                erro
                  ? `coupon-clientes-busca-help ${erroId}`
                  : "coupon-clientes-busca-help"
              }
              className={`${CAMPO} border pl-9 pr-3 ${FOCO}`}
            />
          </div>

          <p id="coupon-clientes-busca-help" className="text-xs text-zinc-400">
            Nome, e-mail ou WhatsApp · 2 caracteres
          </p>
          {buscando && (
            <p className="text-sm text-sky-300" aria-live="polite">
              Buscando…
            </p>
          )}
          {erroDaBusca && (
            <div className="space-y-1">
              <p role="alert" className="text-sm leading-relaxed text-red-300">
                {erroDaBusca}
              </p>
              <button
                type="button"
                onClick={() => aoDigitar(termo)}
                disabled={listaTravada}
                className={`min-h-11 text-sm font-semibold text-zinc-200 underline ${FOCO}`}
              >
                Tentar de novo
              </button>
            </div>
          )}
          {!buscando &&
            termo.trim().length >= 2 &&
            resultados.length === 0 &&
            !erroDaBusca && (
              <p className="text-sm text-zinc-400">
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
                      className={`flex min-h-11 w-full items-center justify-between gap-2 rounded-lg px-2 py-1 text-left hover:bg-white/[0.05] disabled:text-zinc-400 ${FOCO}`}
                    >
                      <span className="min-w-0">
                        <span className="block break-words text-sm font-semibold text-zinc-50 [overflow-wrap:anywhere]">
                          {c.full_name || "Sem nome"}
                        </span>
                        {c.email && (
                          <span className="block break-all text-xs text-zinc-400">
                            {c.email}
                          </span>
                        )}
                      </span>
                      <span className="flex min-h-11 shrink-0 items-center gap-1 rounded-2xl border border-admin-border-strong bg-admin-raised px-3 text-sm font-semibold text-zinc-100">
                        <UserPlus aria-hidden="true" className="size-3.5" />
                        {jaEsta ? "Na lista" : "Adicionar"}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          {resultados.length > 0 && totalDaBusca > resultados.length && (
            <p className="text-sm leading-relaxed text-zinc-400" role="status">
              Mostrando {resultados.length} de {totalDaBusca}. Digite o nome
              completo, o e-mail ou o WhatsApp para achar a pessoa.
            </p>
          )}

          <div className="border-t border-admin-border pt-2">
            <p className="mb-3 text-sm font-bold text-zinc-50">
              {carregandoClientes
                ? "Carregando a lista…"
                : `Na lista (${clientes.length})`}
            </p>
            {falhaAoCarregar && (
              <div className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-red-300/20 bg-red-300/5 p-3">
                <p
                  role="alert"
                  className="text-sm leading-relaxed text-red-300"
                >
                  A lista de clientes deste cupom não carregou. Nada pode ser
                  mudado nela até carregar.
                </p>
                <button
                  type="button"
                  onClick={onCarregarDeNovo}
                  className={SECUNDARIO}
                >
                  Carregar de novo
                </button>
              </div>
            )}
            {!listaTravada && clientes.length === 0 && (
              <p className="rounded-2xl border border-orange-300/20 bg-orange-300/5 p-3 text-sm leading-relaxed text-orange-200">
                Nenhum cliente ainda — sem ninguém na lista, ninguém consegue
                usar este cupom.
              </p>
            )}
            <ul aria-label="Clientes que podem usar" className="space-y-3">
              {clientes.map((c) => (
                <li
                  key={c.id}
                  className="flex min-w-0 items-center justify-between gap-3 rounded-2xl bg-admin-raised py-1 pl-3 pr-1 text-sm text-zinc-100"
                >
                  <span className="min-w-0 break-words [overflow-wrap:anywhere]">
                    {c.nome || c.email || "Cliente sem nome"}
                  </span>
                  <button
                    type="button"
                    onClick={() => remover(c.id)}
                    disabled={listaTravada}
                    aria-label={`Tirar ${c.nome || c.email || "cliente"} da lista`}
                    className={`flex size-11 shrink-0 items-center justify-center rounded-xl text-zinc-400 hover:bg-white/10 hover:text-white ${FOCO}`}
                  >
                    <X aria-hidden="true" className="size-3.5" />
                  </button>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-xs leading-relaxed text-zinc-400">
              Só estas contas podem usar o cupom, mesmo que outras conheçam o
              código.
            </p>
          </div>
        </div>
      )}
    </fieldset>
  );
}
