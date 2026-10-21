import {
  GRUPO_DOS_CLASSICOS,
  type IconeDoCatalogo,
  buscarNoCatalogo,
  carregarCatalogo,
  catalogoEmMemoria,
  classicoCombinaComBusca,
  gruposDoCatalogo,
  sugerirPeloNome,
} from "@/lib/catalogo-de-icones";
import {
  CHAVES_DE_ICONES,
  type ChaveDeIcone,
  IconeDaCategoria,
  formaDeIconeValida,
  iconeDaCategoria,
  iconeEscolhido,
  nomeDoIcone,
} from "@/lib/icones-de-categoria";
import { normalizeText } from "@/lib/utils";
import { ChevronDown, Search } from "lucide-react";
import { type ReactNode, useEffect, useId, useState } from "react";

// Seletor de ícone de uma categoria (Gerenciar categorias). Mostra os 14 clássicos de sempre e, quando o
// catálogo chega, mais ~100 desenhos em grupos, com busca e uma sugestão pelo NOME da categoria. O catálogo é
// um arquivo à parte, buscado só quando o seletor abre (`src/lib/catalogo-de-icones.ts`); se não vier, os
// clássicos e o ícone que a categoria já tem gravado continuam funcionando.
//
// Escolher não grava nada aqui: devolve a escolha ao pai (`aoEscolher`), que grava as duas colunas no mesmo
// pedido. Uma escolha do catálogo guarda a FORMA (`categorias.icone_forma`) e deixa `icone` vazio; um clássico
// guarda a chave (`categorias.icone`) e deixa a forma vazia; "Automático" esvazia as duas.

export interface EscolhaDeIcone {
  readonly icone: ChaveDeIcone | null;
  readonly forma: string | null;
}

interface SeletorDeIconeProps {
  /** Nome da categoria (rótulo dos botões e prévia do "Automático"). */
  readonly nomeDaCategoria: string;
  /** Nome em que a sugestão se baseia: o atual ou o que a lojista está digitando. */
  readonly nomeParaSugerir: string;
  /** O que está gravado hoje (do banco, sem validar). */
  readonly gravado: {
    readonly icone?: string | null;
    readonly forma?: string | null;
  };
  /** Uma gravação em andamento: nenhum botão responde até ela terminar. */
  readonly desabilitado: boolean;
  readonly aoEscolher: (escolha: EscolhaDeIcone) => void;
}

type Catalogo =
  | { readonly estado: "carregando" }
  | { readonly estado: "erro" }
  | { readonly estado: "pronto"; readonly lista: readonly IconeDoCatalogo[] };

const TODOS = "Todos";
const BOTAO =
  "inline-flex min-h-11 items-center justify-center gap-1.5 rounded-xl border px-3.5 text-xs font-black uppercase tracking-wider transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-admin-gold/50 disabled:pointer-events-none disabled:opacity-40";
const BOTAO_NEUTRO = `${BOTAO} border-admin-border bg-admin-surface text-zinc-300 hover:bg-zinc-800 hover:text-white`;
const BOTAO_DOURADO = `${BOTAO} border-admin-gold bg-admin-gold text-black hover:brightness-110`;
const PECA =
  "flex min-h-16 min-w-0 flex-col items-center justify-center gap-1 rounded-xl border px-1 py-2 text-center text-[11px] font-bold leading-tight transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-admin-gold/50 disabled:opacity-40";
const PECA_COMUM =
  "border-admin-border bg-admin-surface text-zinc-300 hover:bg-zinc-800 hover:text-white";
const PECA_ESCOLHIDA = "border-admin-gold bg-admin-gold/10 text-admin-gold";
const FICHA =
  "min-h-11 shrink-0 whitespace-nowrap rounded-full border px-3.5 text-xs font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-admin-gold/50";

function Peca({
  rotulo,
  categoria,
  escolhida,
  desabilitada,
  aoTocar,
  children,
}: Readonly<{
  rotulo: string;
  categoria: string;
  escolhida: boolean;
  desabilitada: boolean;
  aoTocar: () => void;
  children: ReactNode;
}>) {
  return (
    <button
      type="button"
      aria-label={`Ícone ${rotulo} para ${categoria}`}
      aria-pressed={escolhida}
      disabled={desabilitada}
      onClick={aoTocar}
      className={`${PECA} ${escolhida ? PECA_ESCOLHIDA : PECA_COMUM}`}
    >
      {children}
      <span className="line-clamp-2 w-full [overflow-wrap:anywhere]">
        {rotulo}
      </span>
    </button>
  );
}

function Secao({
  titulo,
  children,
}: Readonly<{ titulo: string; children: ReactNode }>) {
  return (
    <section aria-label={titulo}>
      <h4 className="mb-2 text-[11px] font-black uppercase tracking-widest text-zinc-500">
        {titulo}
      </h4>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(4rem,1fr))] gap-2">
        {children}
      </div>
    </section>
  );
}

export function SeletorDeIcone({
  nomeDaCategoria,
  nomeParaSugerir,
  gravado,
  desabilitado,
  aoEscolher,
}: SeletorDeIconeProps) {
  const id = useId();
  const [aberto, setAberto] = useState(false);
  const [busca, setBusca] = useState("");
  const [grupo, setGrupo] = useState(TODOS);
  const [catalogo, setCatalogo] = useState<Catalogo>(() => {
    const lista = catalogoEmMemoria();
    return lista ? { estado: "pronto", lista } : { estado: "carregando" };
  });
  const [tentativa, setTentativa] = useState(0);

  // O catálogo só é pedido quando o seletor abre (e de novo em "Tentar de novo").
  useEffect(() => {
    if (!aberto) return;
    let vivo = true;
    setCatalogo((atual) =>
      atual.estado === "pronto" ? atual : { estado: "carregando" },
    );
    carregarCatalogo().then(
      (lista) => vivo && setCatalogo({ estado: "pronto", lista }),
      () => vivo && setCatalogo({ estado: "erro" }),
    );
    return () => {
      vivo = false;
    };
  }, [aberto, tentativa]);

  const lista = catalogo.estado === "pronto" ? catalogo.lista : null;
  const classicoGravado = iconeEscolhido({ icone: gravado.icone });
  const formaGravada = formaDeIconeValida(gravado.forma) ? gravado.forma : null;
  const semEscolha = classicoGravado === null && formaGravada === null;

  const itemGravado = lista?.find((item) => item.d === formaGravada);
  // (o React Compiler do projeto já memoiza estas contas)
  const sugestao = semEscolha
    ? sugerirPeloNome(lista ?? [], nomeParaSugerir)
    : null;

  const termo = busca.trim();
  const classicos = CHAVES_DE_ICONES.filter((c) =>
    classicoCombinaComBusca(c, termo),
  );
  const automaticoApareceu =
    termo === "" || normalizeText("Automático").includes(normalizeText(termo));
  const doCatalogo = lista ? buscarNoCatalogo(lista, termo) : [];
  const grupos = lista ? gruposDoCatalogo(lista) : [];
  const gruposAExibir =
    grupo === GRUPO_DOS_CLASSICOS
      ? []
      : grupos.filter((g) => grupo === TODOS || grupo === g);
  const mostraClassicos = grupo === TODOS || grupo === GRUPO_DOS_CLASSICOS;
  const algumResultado =
    (mostraClassicos && (classicos.length > 0 || automaticoApareceu)) ||
    gruposAExibir.some((g) => doCatalogo.some((item) => item.grupo === g));

  const previa = iconeDaCategoria({
    name: nomeDaCategoria,
    icone: gravado.icone,
  });
  let rotuloAtual = "Automático, pelo nome da categoria";
  if (formaGravada) rotuloAtual = itemGravado?.nome ?? "Ícone escolhido";
  else if (classicoGravado) rotuloAtual = nomeDoIcone(classicoGravado);

  function escolherClassico(chave: ChaveDeIcone | null) {
    aoEscolher({ icone: chave, forma: null });
  }
  function escolherDoCatalogo(item: IconeDoCatalogo) {
    aoEscolher({ icone: null, forma: item.d });
  }

  return (
    <div>
      <button
        type="button"
        aria-expanded={aberto}
        aria-controls={`${id}-painel`}
        onClick={() => setAberto((a) => !a)}
        className="flex min-h-11 w-full items-center justify-between gap-2 rounded-lg text-left text-sm font-bold text-zinc-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400"
      >
        Escolher ícone
        <ChevronDown
          aria-hidden="true"
          className={`size-4 shrink-0 transition-transform ${aberto ? "rotate-180" : ""}`}
        />
      </button>

      {aberto ? (
        <div
          id={`${id}-painel`}
          className="mt-2 min-w-0 space-y-3 rounded-xl border border-admin-border bg-zinc-950/60 p-3"
        >
          <div className="flex items-center gap-3">
            <span className="flex size-16 shrink-0 items-center justify-center rounded-2xl border border-admin-border bg-admin-surface text-zinc-200">
              <IconeDaCategoria
                icone={previa}
                forma={formaGravada}
                className="size-10"
              />
            </span>
            <div className="min-w-0">
              <p className="text-[11px] font-black uppercase tracking-widest text-zinc-500">
                Ícone atual
              </p>
              <p className="break-words text-sm font-bold text-white">
                {rotuloAtual}
              </p>
            </div>
          </div>

          {sugestao ? (
            <div
              role="group"
              aria-label={`Sugestão de ícone para ${nomeParaSugerir}`}
              className="flex flex-wrap items-center gap-3 rounded-xl border border-admin-gold/40 bg-admin-gold/10 p-3"
            >
              <span className="flex size-11 shrink-0 items-center justify-center rounded-xl border border-admin-gold/40 text-admin-gold">
                <IconeDaCategoria
                  icone={
                    sugestao.tipo === "classico" ? sugestao.chave : "etiqueta"
                  }
                  forma={sugestao.tipo === "catalogo" ? sugestao.item.d : null}
                  className="size-7"
                />
              </span>
              <p className="min-w-0 flex-1 basis-40 text-sm text-white">
                Sugestão para “{nomeParaSugerir}”:{" "}
                <strong className="font-black">
                  {sugestao.tipo === "classico"
                    ? nomeDoIcone(sugestao.chave)
                    : sugestao.item.nome}
                </strong>
              </p>
              <button
                type="button"
                disabled={desabilitado}
                className={BOTAO_DOURADO}
                onClick={() =>
                  sugestao.tipo === "classico"
                    ? escolherClassico(sugestao.chave)
                    : escolherDoCatalogo(sugestao.item)
                }
              >
                Usar sugestão
              </button>
            </div>
          ) : null}

          <div className="relative">
            <Search
              aria-hidden="true"
              className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-zinc-500"
            />
            <label htmlFor={`${id}-busca`} className="sr-only">
              Buscar ícone para {nomeDaCategoria}
            </label>
            <input
              id={`${id}-busca`}
              type="search"
              value={busca}
              maxLength={40}
              autoComplete="off"
              placeholder="Buscar: blusa, bolsa…"
              onChange={(e) => setBusca(e.target.value)}
              className="min-h-11 w-full rounded-xl border border-admin-border bg-zinc-950 pl-9 pr-3 text-sm font-bold text-white placeholder:font-normal placeholder:text-zinc-500 focus:border-admin-gold focus:outline-none focus:ring-2 focus:ring-admin-gold/30"
            />
          </div>

          <div
            role="group"
            aria-label="Grupos de ícones"
            className="flex gap-2 overflow-x-auto overscroll-x-contain pb-1"
          >
            {[TODOS, GRUPO_DOS_CLASSICOS, ...grupos].map((nome) => (
              <button
                type="button"
                key={nome}
                aria-pressed={grupo === nome}
                onClick={() => setGrupo(nome)}
                className={`${FICHA} ${
                  grupo === nome
                    ? "border-admin-gold bg-admin-gold/10 text-admin-gold"
                    : "border-admin-border bg-admin-surface text-zinc-400 hover:text-white"
                }`}
              >
                {nome}
              </button>
            ))}
          </div>

          {catalogo.estado === "carregando" ? (
            <p role="status" className="text-xs text-zinc-400">
              Carregando mais ícones…
            </p>
          ) : null}
          {catalogo.estado === "erro" ? (
            <div
              role="alert"
              className="flex flex-wrap items-center gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200"
            >
              <p className="min-w-0 flex-1 basis-40">
                Não deu para carregar os ícones novos agora. Os ícones clássicos
                continuam disponíveis.
              </p>
              <button
                type="button"
                className={BOTAO_NEUTRO}
                onClick={() => setTentativa((n) => n + 1)}
              >
                Tentar de novo
              </button>
            </div>
          ) : null}

          <fieldset
            disabled={desabilitado}
            className="custom-scrollbar max-h-80 min-w-0 space-y-4 overflow-y-auto pr-1"
          >
            <legend className="sr-only">Ícone de {nomeDaCategoria}</legend>

            {mostraClassicos && (classicos.length > 0 || automaticoApareceu) ? (
              <Secao titulo={GRUPO_DOS_CLASSICOS}>
                {automaticoApareceu ? (
                  <Peca
                    rotulo="Automático"
                    categoria={nomeDaCategoria}
                    escolhida={semEscolha}
                    desabilitada={desabilitado}
                    aoTocar={() => escolherClassico(null)}
                  >
                    <IconeDaCategoria
                      icone={iconeDaCategoria({ name: nomeDaCategoria })}
                      className="size-6"
                    />
                  </Peca>
                ) : null}
                {classicos.map((chave) => (
                  <Peca
                    key={chave}
                    rotulo={nomeDoIcone(chave)}
                    categoria={nomeDaCategoria}
                    escolhida={
                      classicoGravado === chave && formaGravada === null
                    }
                    desabilitada={desabilitado}
                    aoTocar={() => escolherClassico(chave)}
                  >
                    <IconeDaCategoria icone={chave} className="size-6" />
                  </Peca>
                ))}
              </Secao>
            ) : null}

            {gruposAExibir.map((nomeDoGrupo) => {
              const itens = doCatalogo.filter(
                (item) => item.grupo === nomeDoGrupo,
              );
              if (itens.length === 0) return null;
              return (
                <Secao key={nomeDoGrupo} titulo={nomeDoGrupo}>
                  {itens.map((item) => (
                    <Peca
                      key={item.chave}
                      rotulo={item.nome}
                      categoria={nomeDaCategoria}
                      escolhida={formaGravada === item.d}
                      desabilitada={desabilitado}
                      aoTocar={() => escolherDoCatalogo(item)}
                    >
                      <IconeDaCategoria
                        icone="etiqueta"
                        forma={item.d}
                        className="size-6"
                      />
                    </Peca>
                  ))}
                </Secao>
              );
            })}

            {!algumResultado && catalogo.estado !== "carregando" ? (
              <p role="status" className="text-sm text-zinc-400">
                Nenhum ícone com “{termo}”. Tente outra palavra ou escolha um
                grupo.
              </p>
            ) : null}
          </fieldset>
        </div>
      ) : null}
    </div>
  );
}
