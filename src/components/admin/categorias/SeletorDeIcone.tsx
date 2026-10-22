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
import { Check, ChevronDown, Search } from "lucide-react";
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
  /**
   * `gaveta` (padrão): um botão "Escolher ícone" abre e fecha a galeria, como em Gerenciar categorias.
   * `direto`: a galeria já vem aberta, para dentro de uma folha (ex.: "Nova categoria" no formulário de produto).
   */
  readonly modo?: "gaveta" | "direto";
  readonly aoEscolher: (escolha: EscolhaDeIcone) => void;
}

type Catalogo =
  | { readonly estado: "carregando" }
  | { readonly estado: "erro" }
  | { readonly estado: "pronto"; readonly lista: readonly IconeDoCatalogo[] };

const TODOS = "Todos";
const BOTAO =
  "inline-flex min-h-11 items-center justify-center gap-1.5 rounded-xl border px-3.5 text-sm font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40";
const BOTAO_SECUNDARIO = `${BOTAO} border-admin-border-strong bg-admin-raised text-foreground hover:bg-admin-hover`;
const PECA =
  "relative flex min-h-16 min-w-0 flex-col items-center justify-center gap-1 rounded-xl border px-1 py-2 text-center text-xs font-bold leading-tight transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40";
const PECA_COMUM =
  "border-admin-border bg-admin-surface text-muted-foreground hover:bg-admin-hover hover:text-foreground";
const PECA_ESCOLHIDA =
  "border-2 border-foreground bg-admin-raised text-foreground";
const FICHA =
  "min-h-11 shrink-0 whitespace-nowrap rounded-full border px-3.5 text-sm font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

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
      {escolhida ? (
        <span
          aria-hidden="true"
          className="absolute right-1 top-1 flex size-4 items-center justify-center rounded-full bg-foreground text-background"
        >
          <Check className="size-3" strokeWidth={3} />
        </span>
      ) : null}
      {children}
      <span className="line-clamp-2 w-full break-words">{rotulo}</span>
    </button>
  );
}

function Secao({
  titulo,
  quantidade,
  children,
}: Readonly<{ titulo: string; quantidade: number; children: ReactNode }>) {
  return (
    <section aria-label={titulo}>
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <h4 className="text-sm font-bold text-muted-foreground">{titulo}</h4>
        <span className="text-xs text-muted-foreground">
          {quantidade === 1 ? "1 ícone" : `${quantidade} ícones`}
        </span>
      </div>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(5.5rem,1fr))] gap-2">
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
  modo = "gaveta",
  aoEscolher,
}: SeletorDeIconeProps) {
  const id = useId();
  const [gavetaAberta, setAberto] = useState(false);
  const aberto = modo === "direto" || gavetaAberta;
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
  const sugerida = sugerirPeloNome(lista ?? [], nomeParaSugerir);
  // A faixa some quando a lojista escolheu OUTRO ícone; se escolheu o sugerido, ela fica marcada "Usado".
  const sugestaoUsada =
    sugerida !== null &&
    !semEscolha &&
    (sugerida.tipo === "catalogo"
      ? formaGravada === sugerida.item.d
      : classicoGravado === sugerida.chave && formaGravada === null);
  const sugestao = semEscolha || sugestaoUsada ? sugerida : null;

  const termo = busca.trim();
  const classicos = CHAVES_DE_ICONES.filter((c) =>
    classicoCombinaComBusca(c, termo),
  );
  const doCatalogo = lista ? buscarNoCatalogo(lista, termo) : [];
  const grupos = lista ? gruposDoCatalogo(lista) : [];
  const gruposAExibir =
    grupo === GRUPO_DOS_CLASSICOS
      ? []
      : grupos.filter((g) => grupo === TODOS || grupo === g);
  const mostraClassicos = grupo === TODOS || grupo === GRUPO_DOS_CLASSICOS;
  const algumResultado =
    (mostraClassicos && classicos.length > 0) ||
    gruposAExibir.some((g) => doCatalogo.some((item) => item.grupo === g));

  // Prévia do "Automático": a mesma regra da vitrine (sugestão pelo nome, depois o genérico).
  const automatico = sugerirPeloNome(lista ?? [], nomeDaCategoria);
  const previa =
    classicoGravado ??
    (automatico?.tipo === "classico"
      ? automatico.chave
      : iconeDaCategoria({ name: nomeDaCategoria }));
  const formaDaPrevia =
    formaGravada ??
    (classicoGravado === null && automatico?.tipo === "catalogo"
      ? automatico.item.d
      : null);
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
      {modo === "gaveta" ? (
        <button
          type="button"
          aria-expanded={aberto}
          aria-controls={`${id}-painel`}
          onClick={() => setAberto((a) => !a)}
          className="flex min-h-11 w-full items-center justify-between gap-2 rounded-lg text-left text-sm font-bold text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          Escolher ícone
          <ChevronDown
            aria-hidden="true"
            className={`size-4 shrink-0 transition-transform ${aberto ? "rotate-180" : ""}`}
          />
        </button>
      ) : null}

      {aberto ? (
        <div
          id={`${id}-painel`}
          className="mt-2 min-w-0 space-y-3 rounded-xl border border-admin-border bg-admin-bg p-3"
        >
          <div className="flex items-center gap-3">
            <span className="flex size-16 shrink-0 items-center justify-center rounded-2xl border border-admin-border bg-admin-surface text-foreground">
              <IconeDaCategoria
                icone={previa}
                forma={formaDaPrevia}
                className="size-10"
              />
            </span>
            <div className="min-w-0">
              <p className="text-xs text-muted-foreground">Ícone atual</p>
              <p className="break-words text-sm font-bold text-foreground">
                {rotuloAtual}
              </p>
            </div>
          </div>

          {sugestao ? (
            <div
              role="group"
              aria-label={`Sugestão de ícone para ${nomeParaSugerir}`}
              className="flex flex-wrap items-center gap-3 rounded-xl border border-admin-border-strong bg-admin-surface p-3"
            >
              <span className="flex size-11 shrink-0 items-center justify-center rounded-xl border border-admin-border bg-admin-raised text-foreground">
                <IconeDaCategoria
                  icone={
                    sugestao.tipo === "classico" ? sugestao.chave : "etiqueta"
                  }
                  forma={sugestao.tipo === "catalogo" ? sugestao.item.d : null}
                  className="size-7"
                />
              </span>
              <p className="min-w-0 flex-1 basis-40 text-sm text-foreground">
                <span className="flex items-center gap-1 text-xs text-muted-foreground">
                  Sugerimos pelo nome “{nomeParaSugerir}”
                </span>
                <strong className="font-black">
                  {sugestao.tipo === "classico"
                    ? nomeDoIcone(sugestao.chave)
                    : sugestao.item.nome}
                </strong>
              </p>
              <button
                type="button"
                disabled={desabilitado || sugestaoUsada}
                aria-label={sugestaoUsada ? "Usado: sugestão" : "Usar sugestão"}
                className={BOTAO_SECUNDARIO}
                onClick={() =>
                  sugestao.tipo === "classico"
                    ? escolherClassico(sugestao.chave)
                    : escolherDoCatalogo(sugestao.item)
                }
              >
                {sugestaoUsada ? (
                  <Check aria-hidden="true" className="size-4" />
                ) : null}
                {sugestaoUsada ? "Usado" : "Usar"}
              </button>
            </div>
          ) : null}

          <div className="flex items-center justify-between gap-2">
            <h3 className="text-base font-bold text-foreground">
              Ícone da categoria
            </h3>
            <button
              type="button"
              aria-label={`Ícone Automático para ${nomeDaCategoria}`}
              aria-pressed={semEscolha}
              disabled={desabilitado}
              onClick={() => escolherClassico(null)}
              className="inline-flex min-h-11 items-center gap-1.5 rounded-xl px-2 text-sm font-bold text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40"
            >
              Automático
              {semEscolha ? (
                <Check aria-hidden="true" className="size-4" />
              ) : null}
            </button>
          </div>

          <div className="relative">
            <Search
              aria-hidden="true"
              className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
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
              placeholder="Buscar ícone: bolsa, tênis, vestido…"
              onChange={(e) => setBusca(e.target.value)}
              className="min-h-11 w-full rounded-xl border border-admin-border bg-admin-surface pl-9 pr-3 text-sm font-bold text-foreground placeholder:font-normal placeholder:text-muted-foreground focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring"
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
                    ? "border-foreground bg-foreground text-background"
                    : "border-admin-border bg-admin-surface text-muted-foreground hover:text-foreground"
                }`}
              >
                {nome}
              </button>
            ))}
          </div>

          {catalogo.estado === "carregando" ? (
            <p role="status" className="text-xs text-muted-foreground">
              Carregando mais ícones…
            </p>
          ) : null}
          {catalogo.estado === "erro" ? (
            <div
              role="alert"
              className="flex flex-wrap items-center gap-2 rounded-xl border border-amber-500/40 px-3 py-2 text-xs text-foreground"
            >
              <p className="min-w-0 flex-1 basis-40">
                Não deu para carregar os ícones novos agora. Os ícones clássicos
                continuam disponíveis.
              </p>
              <button
                type="button"
                className={BOTAO_SECUNDARIO}
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

            {mostraClassicos && classicos.length > 0 ? (
              <Secao titulo={GRUPO_DOS_CLASSICOS} quantidade={classicos.length}>
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
                <Secao
                  key={nomeDoGrupo}
                  titulo={nomeDoGrupo}
                  quantidade={itens.length}
                >
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
              <p role="status" className="text-sm text-muted-foreground">
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
