import { cn } from "@/lib/utils";
import { Check, Search, X } from "lucide-react";
import {
  type KeyboardEvent as EventoDeTecla,
  type Ref,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { filtrarOpcoes, partesDoTrecho } from "./busca";
import {
  porLetra,
  primeiraHabilitada,
  proximaHabilitada,
  ultimaHabilitada,
} from "./navegacao";
import type { OpcaoDaLista } from "./tipos";
import "./lista-de-escolha.css";

/** O id de cada opção: pelo índice na lista ORIGINAL (estável com a busca). */
export const idDaOpcao = (id: string, indice: number) =>
  `${id}-opcao-${indice}`;
export const idDaListaDe = (id: string) => `${id}-lista`;
export const idDaBuscaDe = (id: string) => `${id}-busca`;

/**
 * O miolo da lista, igual no celular (folha) e no computador (popover):
 * busca opcional, a contagem, as opções e o teclado.
 *
 * Acessibilidade (APG, "select-only combobox" + listbox):
 *  - sem busca, o próprio `listbox` recebe o foco (`tabIndex=0`) e aponta a
 *    opção ativa com `aria-activedescendant`;
 *  - com busca, o foco fica no input (`role=combobox`) e é ELE quem aponta a
 *    ativa; o listbox não entra na ordem do Tab.
 *
 * Escolher é sempre no `click` (nunca no pointerdown): o dedo que rola a
 * lista não escolhe nada sem querer.
 */
export function CorpoDaLista<V extends string>({
  id,
  rotulo,
  opcoes,
  valorEscolhido,
  comBusca,
  variante,
  anelAoAbrir = false,
  aoEscolher,
  listaRef,
  buscaRef,
}: {
  readonly id: string;
  /** Nome do listbox para o leitor de tela. */
  readonly rotulo: string;
  readonly opcoes: readonly OpcaoDaLista<V>[];
  /** `null` no modo ação: nada fica marcado. */
  readonly valorEscolhido: V | null;
  readonly comBusca: boolean;
  /** Folha do celular (linhas de 50px) ou popover do computador (44px). */
  readonly variante: "folha" | "popover";
  /** Aberta pelo teclado: o anel já nasce na ativa (a que o Enter escolhe). */
  readonly anelAoAbrir?: boolean;
  readonly aoEscolher: (valor: V) => void;
  readonly listaRef?: Ref<HTMLDivElement>;
  readonly buscaRef?: Ref<HTMLInputElement>;
}) {
  const idDaLista = idDaListaDe(id);
  const idDaContagem = `${useId()}-contagem`;
  const [termo, setTermo] = useState("");
  // `teclado`: só depois da primeira tecla o anel da opção ativa aparece —
  // abrir com o dedo ou o mouse não pinta anel em ninguém. Aberta pelo
  // teclado, ou com algo digitado na busca, o anel já está na opção que o
  // Enter vai escolher: nunca se escolhe uma opção sem anel à vista.
  const [teclado, setTeclado] = useState(anelAoAbrir);

  // O índice original de cada opção segue junto: é ele que dá o id estável.
  const indexadas = useMemo(
    () => opcoes.map((opcao, indice) => ({ ...opcao, indice })),
    [opcoes],
  );
  const visiveis = useMemo(
    () => (comBusca ? filtrarOpcoes(indexadas, termo) : indexadas),
    [comBusca, indexadas, termo],
  );
  const indiceDaEscolhida =
    valorEscolhido === null
      ? -1
      : visiveis.findIndex((o) => o.valor === valorEscolhido);

  const [ativa, setAtiva] = useState(() =>
    indiceDaEscolhida >= 0 ? indiceDaEscolhida : -1,
  );
  // Busca nova: a ativa volta para o primeiro resultado (Enter escolhe ele).
  const termoAnterior = useRef(termo);
  useEffect(() => {
    if (termoAnterior.current === termo) return;
    termoAnterior.current = termo;
    setAtiva(termo.trim() ? primeiraHabilitada(visiveis) : indiceDaEscolhida);
  }, [termo, visiveis, indiceDaEscolhida]);

  const opcaoAtiva = ativa >= 0 ? visiveis.at(ativa) : undefined;
  const idDaAtiva = opcaoAtiva ? idDaOpcao(id, opcaoAtiva.indice) : undefined;

  // Abre rolada até a escolhida, no meio da lista (Estado = São Paulo).
  // Só ao abrir: o valor fica guardado no ref, e escolher outro não rola.
  const raizRef = useRef<HTMLDivElement | null>(null);
  const comEscolhaAoAbrir = useRef(valorEscolhido !== null);
  useEffect(() => {
    if (!comEscolhaAoAbrir.current) return;
    const escolhida = raizRef.current?.querySelector<HTMLElement>(
      '[role="option"][aria-selected="true"]',
    );
    // `?.()`: o jsdom dos testes não tem a função.
    escolhida?.scrollIntoView?.({ block: "center" });
  }, []);

  // O teclado leva a ativa junto, sem pular a lista inteira.
  useEffect(() => {
    if (!teclado || !idDaAtiva) return;
    document.getElementById(idDaAtiva)?.scrollIntoView?.({ block: "nearest" });
  }, [teclado, idDaAtiva]);

  function escolher(opcao: OpcaoDaLista<V> | undefined) {
    if (!opcao || opcao.desabilitada) return;
    aoEscolher(opcao.valor);
  }

  function aoTeclar(evento: EventoDeTecla<HTMLElement>, naBusca: boolean) {
    if (evento.altKey || evento.ctrlKey || evento.metaKey) return;
    const mover = (indice: number) => {
      evento.preventDefault();
      setTeclado(true);
      setAtiva(indice);
    };
    switch (evento.key) {
      case "ArrowDown":
        mover(proximaHabilitada(visiveis, ativa, 1));
        return;
      case "ArrowUp":
        mover(proximaHabilitada(visiveis, ativa, -1));
        return;
      case "Home":
        // Na busca, Home e End andam no texto (o padrão do campo de texto).
        if (!naBusca) mover(primeiraHabilitada(visiveis));
        return;
      case "End":
        if (!naBusca) mover(ultimaHabilitada(visiveis));
        return;
      case "Enter":
        evento.preventDefault();
        escolher(opcaoAtiva);
        return;
      case " ":
        // Na busca o espaço é letra ("Rio de Janeiro").
        if (naBusca) return;
        evento.preventDefault();
        escolher(opcaoAtiva);
        return;
      default:
        if (!naBusca && evento.key.length === 1 && evento.key.trim()) {
          mover(porLetra(visiveis, evento.key, ativa));
        }
    }
  }

  const termoLimpo = termo.trim();
  const contagem = termoLimpo
    ? visiveis.length === 1
      ? "1 resultado"
      : `${visiveis.length} resultados`
    : `${opcoes.length} opções`;
  const folha = variante === "folha";

  return (
    <div ref={raizRef} className="flex min-h-0 flex-1 flex-col">
      {comBusca ? (
        <div className={cn("shrink-0", folha ? "px-5 pb-2" : "p-2 pb-1")}>
          <div className="relative">
            <Search
              aria-hidden="true"
              className="pointer-events-none absolute left-3.5 top-1/2 size-5 -translate-y-1/2 text-muted-foreground"
            />
            <input
              ref={buscaRef}
              id={idDaBuscaDe(id)}
              type="text"
              role="combobox"
              aria-label={`Buscar em ${rotulo}`}
              aria-autocomplete="list"
              aria-expanded="true"
              aria-controls={idDaLista}
              aria-activedescendant={idDaAtiva}
              aria-describedby={idDaContagem}
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              enterKeyHint="search"
              placeholder={`Buscar ${rotulo.toLowerCase()}…`}
              value={termo}
              onChange={(e) => {
                setTeclado(true);
                setTermo(e.target.value);
              }}
              onKeyDown={(e) => aoTeclar(e, true)}
              // 16px: menos que isso e o iPhone dá zoom ao focar.
              className="lista-de-escolha-anel lista-de-escolha-texto min-h-12 w-full rounded-2xl border border-admin-border-strong bg-admin-raised px-11 py-2.5 text-base outline-none placeholder:text-muted-foreground focus:border-transparent"
            />
            {termo ? (
              <button
                type="button"
                aria-label="Limpar a busca"
                onClick={() => setTermo("")}
                className="lista-de-escolha-anel absolute right-1.5 top-1/2 flex size-9 -translate-y-1/2 items-center justify-center rounded-full text-muted-foreground hover:bg-admin-hover"
              >
                <X aria-hidden="true" className="size-4" />
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      {comBusca ? (
        <p
          id={idDaContagem}
          aria-live="polite"
          className={cn(
            "shrink-0 text-xs font-semibold text-muted-foreground",
            folha ? "px-5 pb-1 pt-2" : "px-4 pb-1 pt-1",
          )}
        >
          {contagem}
        </p>
      ) : null}

      <div
        ref={listaRef}
        id={idDaLista}
        role="listbox"
        aria-label={rotulo}
        tabIndex={comBusca ? -1 : 0}
        aria-activedescendant={comBusca ? undefined : idDaAtiva}
        onKeyDown={comBusca ? undefined : (e) => aoTeclar(e, false)}
        className={cn(
          "lista-de-escolha-lista custom-scrollbar min-h-0 flex-1 overflow-y-auto overscroll-contain outline-none",
          folha ? "px-3 pb-3" : "p-2",
          // 8 linhas de 44px e o respiro de cima e de baixo.
          !folha && "max-h-[23rem]",
        )}
      >
        {visiveis.length === 0 ? (
          <p className="px-3 py-6 text-center text-sm text-muted-foreground">
            Nada encontrado
          </p>
        ) : (
          visiveis.map((opcao, i) => {
            const escolhida =
              valorEscolhido !== null && opcao.valor === valorEscolhido;
            const Icone = opcao.icone;
            return (
              // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/interactive-supports-focus -- o foco mora no listbox (ou na busca), que aponta a opção por aria-activedescendant e trata o teclado
              <div
                key={`${opcao.indice}`}
                id={idDaOpcao(id, opcao.indice)}
                role="option"
                aria-selected={valorEscolhido === null ? undefined : escolhida}
                aria-disabled={opcao.desabilitada || undefined}
                data-valor={opcao.valor}
                data-rotulo={opcao.rotulo}
                onClick={() => escolher(opcao)}
                className={cn(
                  "flex w-full cursor-pointer select-none items-center gap-3 rounded-[14px] px-3 text-left",
                  folha ? "min-h-[50px] py-2" : "min-h-11 py-1.5",
                  escolhida
                    ? "lista-de-escolha-escolhida font-bold"
                    : "hover:bg-admin-hover",
                  opcao.desabilitada &&
                    "cursor-not-allowed opacity-40 hover:bg-transparent",
                  teclado && i === ativa && "lista-de-escolha-ativa",
                )}
              >
                {Icone ? (
                  <Icone
                    aria-hidden="true"
                    className={cn(
                      "size-5 shrink-0",
                      escolhida
                        ? "lista-de-escolha-ouro"
                        : "text-muted-foreground",
                    )}
                  />
                ) : null}
                {opcao.sigla ? (
                  <span
                    aria-hidden="true"
                    className={cn(
                      "inline-flex h-6 min-w-8 shrink-0 items-center justify-center rounded-md px-1.5 text-[11px] font-bold",
                      escolhida
                        ? "lista-de-escolha-ouro lista-de-escolha-escolhida"
                        : "bg-admin-raised text-muted-foreground",
                    )}
                  >
                    {opcao.sigla}
                  </span>
                ) : null}
                <span className="min-w-0 flex-1">
                  <span className="lista-de-escolha-texto block truncate text-[15px] leading-5">
                    {partesDoTrecho(opcao.rotulo, termoLimpo).map((parte, k) =>
                      parte.achado ? (
                        <mark key={k} className="lista-de-escolha-trecho">
                          {parte.texto}
                        </mark>
                      ) : (
                        <span key={k}>{parte.texto}</span>
                      ),
                    )}
                  </span>
                  {opcao.subinfo ? (
                    <span className="block truncate text-xs font-normal leading-4 text-muted-foreground">
                      {opcao.subinfo}
                    </span>
                  ) : null}
                </span>
                {escolhida ? (
                  <Check
                    aria-hidden="true"
                    className="lista-de-escolha-ouro size-5 shrink-0"
                    strokeWidth={2.5}
                  />
                ) : null}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
