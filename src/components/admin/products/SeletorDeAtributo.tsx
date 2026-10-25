import { LocalBufferedInput } from "@/components/admin/LocalBufferedInput";
import { cn } from "@/lib/utils";
import { SEPARADOR_DE_ATRIBUTOS } from "@/utils/atributos-da-variacao";
import { PALETA_DE_CORES, corDaVariacao } from "@/utils/cor-da-variacao";
import { Check, Pencil, Plus, Ruler, X, Zap } from "lucide-react";
import { type ReactNode, useState } from "react";

/**
 * Escolher em vez de digitar: o lojista toca o que muda no produto (Cor,
 * Tamanho, Voltagem ou Outro) e, embaixo, toca a bolinha da cor, o tamanho ou
 * a voltagem. A loja já mostra a cor como bolinha; aqui o painel fala a mesma
 * língua.
 *
 * O que é GRAVADO não muda: o nome do atributo ("Cor") e o nome do valor
 * ("Azul marinho") continuam sendo texto em `product_variants` — o seletor só
 * muda como o lojista chega neles. Por isso o tipo marcado é DERIVADO do nome
 * que já existe: produto antigo com "Cor" abre com a peça Cor marcada; qualquer
 * outro nome ("Material") abre em "Outro" com o texto preservado, e o valor
 * antigo ("Espacial Grey") segue no campo de texto, nunca se perde.
 *
 * Dois modos: `unico` (a variação de um valor só) e `multiplo` (a grade, onde
 * vários valores entram de uma vez). O estado dos valores é do PAI — o seletor
 * só desenha e avisa.
 */

export type TipoDoAtributo = "Cor" | "Tamanho" | "Voltagem" | "Outro";

const TAMANHOS = [
  "PP",
  "P",
  "M",
  "G",
  "GG",
  "XG",
  "34",
  "36",
  "38",
  "40",
  "42",
  "44",
  "Único",
] as const;
const VOLTAGENS = ["110V", "220V", "Bivolt"] as const;
const NOMES_DA_PALETA = PALETA_DE_CORES.map((cor) => cor.nome);

/** Minúscula, sem acento e sem as pontas: "Lilás " e "lilas" são a mesma coisa. */
const dobrar = (texto: string): string =>
  texto.normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase();

/** O tipo que o nome gravado representa. Vazio = nenhum marcado. */
export function tipoDoNome(nome: string): TipoDoAtributo | null {
  const chave = dobrar(nome);
  if (chave === "") return null;
  if (chave === "cor") return "Cor";
  if (chave === "tamanho") return "Tamanho";
  if (chave === "voltagem") return "Voltagem";
  return "Outro";
}

function listaDoTipo(tipo: TipoDoAtributo | null): readonly string[] {
  if (tipo === "Cor") return NOMES_DA_PALETA;
  if (tipo === "Tamanho") return TAMANHOS;
  if (tipo === "Voltagem") return VOLTAGENS;
  return [];
}

/**
 * O valor digitado que já existe na lista do tipo (cor da paleta, tamanho,
 * voltagem) vira o nome da lista — "azul marinho" → "Azul marinho" — e por isso
 * não duplica a bolinha que já está na tela. Fora da lista, o texto do lojista
 * passa como veio (só sem as pontas).
 */
export function valorDaPaleta(atributo: string, texto: string): string {
  const limpo = texto.trim();
  const chave = dobrar(limpo);
  return (
    listaDoTipo(tipoDoNome(atributo)).find((item) => dobrar(item) === chave) ??
    limpo
  );
}

/** Cor clara pede check escuro (e o contrário): o check nunca some na bolinha. */
function ehClara(hex: string): boolean {
  const cheio =
    hex.length === 4 ? `#${[...hex.slice(1)].map((c) => c + c).join("")}` : hex;
  const [r, g, b] = [1, 3, 5].map((i) =>
    Number.parseInt(cheio.slice(i, i + 2), 16),
  );
  return (r * 299 + g * 587 + b * 114) / 1000 > 150;
}

export interface ChipDoProduto {
  valor: string;
  /** Veio das variações já gravadas deste produto (e não digitado agora). */
  usado: boolean;
}

interface Comum {
  /** 1, 2, 3… — vira o rótulo dos campos ("Novo valor do atributo 2"). */
  numero: number;
  idDoNome: string;
  idDoValor: string;
  nome: string;
  onNome: (nome: string) => void;
  titulo?: string;
  /** Nomes de atributo que o produto já usa (a combinação "Cor / Tamanho"
   *  conta como as duas partes). Um produto aceita um grupo só (ver
   *  `um-grupo-de-variacao.ts`), então sobram as peças dessas partes e
   *  "Outro" — sugerir "Tamanho" a quem já usa "Cor" seria convidar para o
   *  que a trava recusa. As partes que não são Cor, Tamanho nem Voltagem
   *  (ex.: "Material") viram atalho, sem redigitar. Vazio = nada em uso. */
  sugestoes?: string[];
  /** Par de uma variante composta: a mesma coisa, mais enxuta. */
  compacto?: boolean;
  aoRemover?: () => void;
  rotuloDoRemover?: string;
}

interface Unico extends Comum {
  modo: "unico";
  valor: string;
  onValor: (valor: string) => void;
}

interface Multiplo extends Comum {
  modo: "multiplo";
  selecionados: string[];
  /** Valores já usados no produto e os digitados nesta abertura. */
  chips: ChipDoProduto[];
  /** Marca ou desmarca o valor (as bolinhas, os chips e o × usam este). */
  onAlternar: (valor: string) => void;
  rascunho: string;
  onRascunho: (texto: string) => void;
  onAdicionar: () => void;
  /** O tipo mudou de verdade: o que estava escolhido era do atributo antigo. */
  onLimpar: () => void;
}

export type SeletorDeAtributoProps = Unico | Multiplo;

const PECAS: ReadonlyArray<{ tipo: TipoDoAtributo; icone: ReactNode }> = [
  {
    tipo: "Cor",
    icone: (
      <span
        aria-hidden="true"
        className="size-6 rounded-full"
        style={{
          background:
            "conic-gradient(#ef4444,#f59e0b,#22c55e,#3b82f6,#a855f7,#ef4444)",
        }}
      />
    ),
  },
  { tipo: "Tamanho", icone: <Ruler aria-hidden="true" className="size-6" /> },
  { tipo: "Voltagem", icone: <Zap aria-hidden="true" className="size-6" /> },
  { tipo: "Outro", icone: <Pencil aria-hidden="true" className="size-6" /> },
];

const CAMPO =
  "w-full rounded-2xl border border-admin-border bg-admin-bg px-4 py-3 text-sm font-bold transition-all focus:border-foreground focus:outline-none focus:ring-2 focus:ring-ring";

const PLACEHOLDER: Record<TipoDoAtributo, string> = {
  Cor: "Outra cor? Digite aqui",
  Tamanho: "Outro tamanho? Digite aqui",
  Voltagem: "Outra voltagem? Digite aqui",
  Outro: "Outro valor? Digite aqui",
};

const CHAMADA = new Map<TipoDoAtributo, [string, string]>([
  ["Cor", ["Escolha a cor", "Escolha as cores"]],
  ["Tamanho", ["Escolha o tamanho", "Escolha os tamanhos"]],
  ["Voltagem", ["Escolha a voltagem", "Escolha as voltagens"]],
]);

function Marca({ clara }: { clara: boolean }) {
  return (
    <Check
      data-marca="selecionado"
      strokeWidth={3}
      className={cn("size-5", clara ? "text-zinc-900" : "text-white")}
    />
  );
}

function Bolinha({
  hex,
  tamanho,
  marcada,
}: {
  hex: string;
  tamanho: "size-11" | "size-3";
  marcada?: boolean;
}) {
  return (
    <span
      data-bolinha={hex}
      style={{ backgroundColor: hex }}
      className={cn(
        "flex shrink-0 items-center justify-center rounded-full border border-admin-border-strong",
        tamanho,
        marcada &&
          "ring-2 ring-foreground ring-offset-2 ring-offset-admin-surface",
      )}
    >
      {marcada && <Marca clara={ehClara(hex)} />}
    </span>
  );
}

export function SeletorDeAtributo(props: SeletorDeAtributoProps) {
  const {
    numero,
    idDoNome,
    idDoValor,
    nome,
    onNome,
    compacto = false,
    titulo = "O que muda neste produto?",
  } = props;
  // "Outro" escolhido com o nome ainda vazio não se deriva do nome: este
  // estado guarda a escolha, e a mantém enquanto o lojista digita (digitar
  // "Cor" no campo livre não pode fazer o campo sumir debaixo dos dedos).
  const [outroAberto, setOutroAberto] = useState(false);
  const tipo = outroAberto ? "Outro" : tipoDoNome(nome);

  const selecionadosDoModo =
    props.modo === "unico"
      ? props.valor.trim() === ""
        ? []
        : [props.valor]
      : props.selecionados;
  const marcado = (item: string) =>
    selecionadosDoModo.some((s) => dobrar(s) === dobrar(item));
  const escolher = (item: string) =>
    props.modo === "unico" ? props.onValor(item) : props.onAlternar(item);

  // Trocar de Cor para Tamanho com "Azul" ainda escolhido geraria "Tamanho:
  // Azul". Só vale quando já havia um nome: quem digitou o valor antes de tocar
  // a peça não perde o que digitou.
  const trocarDeTipo = (novoNome: string) => {
    const haviaOutro = nome.trim() !== "" && dobrar(nome) !== dobrar(novoNome);
    onNome(novoNome);
    if (!haviaOutro) return;
    if (props.modo === "unico") props.onValor("");
    else props.onLimpar();
  };

  const tocarNaPeca = (alvo: TipoDoAtributo) => {
    if (alvo === tipo) return;
    if (alvo === "Outro") {
      setOutroAberto(true);
      // O nome de Cor/Tamanho/Voltagem sai: o campo livre nasce vazio.
      if (tipoDoNome(nome) !== "Outro" && nome !== "") trocarDeTipo("");
      return;
    }
    setOutroAberto(false);
    if (dobrar(nome) !== dobrar(alvo)) trocarDeTipo(alvo);
  };

  const emUso = (props.sugestoes ?? [])
    .flatMap((n) => n.split(SEPARADOR_DE_ATRIBUTOS))
    .map((n) => n.trim())
    .filter((n) => n !== "");
  const atalhos = emUso
    .filter((n) => tipoDoNome(n) === "Outro")
    .filter(
      (n, i, todos) => todos.findIndex((o) => dobrar(o) === dobrar(n)) === i,
    );
  // Sem nada em uso, as quatro peças. Com grupo em uso, só as dele: a peça do
  // que a linha em edição já é nunca some.
  const pecasVisiveis = PECAS.filter(
    ({ tipo: peca }) =>
      emUso.length === 0 ||
      peca === "Outro" ||
      peca === tipo ||
      emUso.some((n) => tipoDoNome(n) === peca),
  );

  // O digitado que já tem peça na grade (bolinha, tamanho) não repete como chip:
  // o que veio do produto fica sempre, para o lojista reaproveitar.
  const chipsDoProduto =
    props.modo === "multiplo"
      ? props.chips.filter(
          (chip) =>
            chip.usado ||
            !listaDoTipo(tipo).some(
              (item) => dobrar(item) === dobrar(chip.valor),
            ),
        )
      : [];

  const ehPaleta = tipo === "Cor";
  const lista =
    tipo === "Tamanho" || tipo === "Voltagem" ? listaDoTipo(tipo) : [];
  const chamada = tipo
    ? CHAMADA.get(tipo)?.at(props.modo === "unico" ? 0 : 1)
    : undefined;
  const escolhaAtual = props.modo === "unico" ? props.valor.trim() : "";
  const hexDaEscolha = escolhaAtual ? corDaVariacao(escolhaAtual) : null;

  return (
    <div data-testid={`atributo-${numero - 1}`} className="space-y-4">
      <div className="flex items-center gap-2">
        <p className="flex-1 text-base font-bold text-foreground">{titulo}</p>
        {props.aoRemover && (
          <button
            type="button"
            aria-label={props.rotuloDoRemover ?? `Remover atributo ${numero}`}
            onClick={props.aoRemover}
            className="flex size-11 shrink-0 items-center justify-center rounded-xl border border-admin-border bg-admin-bg text-zinc-500 transition-all hover:border-red-500/30 hover:text-red-500 active:scale-95"
          >
            <X className="size-4" />
          </button>
        )}
      </div>

      <div
        role="group"
        aria-label="O que muda"
        className="grid auto-cols-fr grid-flow-col gap-2"
      >
        {pecasVisiveis.map(({ tipo: peca, icone }) => {
          const ativa = tipo === peca;
          return (
            <button
              key={peca}
              type="button"
              aria-pressed={ativa}
              onClick={() => tocarNaPeca(peca)}
              className={cn(
                "flex min-h-11 min-w-0 flex-col items-center justify-center gap-1.5 rounded-2xl border px-1 py-2.5 text-xs font-bold transition-all active:scale-95",
                ativa
                  ? "border-solid border-foreground bg-admin-hover text-foreground ring-1 ring-inset ring-foreground"
                  : "border-admin-border bg-admin-bg text-zinc-400 hover:border-admin-border-strong",
              )}
            >
              {!compacto && icone}
              {peca}
            </button>
          );
        })}
      </div>

      {atalhos.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] text-zinc-500">
            Já usado neste produto:
          </span>
          {atalhos.map((atalho) => (
            <button
              key={atalho}
              type="button"
              data-testid="atalho-de-atributo"
              aria-pressed={dobrar(nome) === dobrar(atalho)}
              onClick={() => trocarDeTipo(atalho)}
              className={cn(
                "min-h-11 rounded-full border px-3 text-xs font-bold transition-all active:scale-95",
                dobrar(nome) === dobrar(atalho)
                  ? "border-solid border-foreground bg-admin-hover text-foreground"
                  : "border-admin-border bg-admin-bg text-zinc-400 hover:border-admin-border-strong",
              )}
            >
              {atalho}
            </button>
          ))}
        </div>
      )}

      {tipo === "Outro" && (
        <LocalBufferedInput
          id={idDoNome}
          name={idDoNome}
          type="text"
          aria-label={`Nome do atributo ${numero}`}
          value={nome}
          onFlush={onNome}
          className={CAMPO}
          placeholder="Ex: Material"
        />
      )}

      {chamada && (
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm text-zinc-400">{chamada}</p>
          {props.modo === "multiplo" ? (
            <span className="text-[11px] text-zinc-500">Toque para marcar</span>
          ) : (
            escolhaAtual !== "" && (
              <span
                data-testid="escolha-atual"
                className="flex min-w-0 items-center gap-2 text-sm font-bold text-foreground"
              >
                {hexDaEscolha && (
                  <Bolinha hex={hexDaEscolha} tamanho="size-3" />
                )}
                <span className="truncate">{escolhaAtual}</span>
              </span>
            )
          )}
        </div>
      )}
      {tipo === null && (
        <p className="text-sm text-zinc-500">
          Toque no que muda neste produto: cor, tamanho, voltagem ou outro.
        </p>
      )}

      {ehPaleta && (
        <div className="grid grid-cols-6 gap-x-0.5 gap-y-3">
          {PALETA_DE_CORES.map((cor) => {
            const ativa = marcado(cor.nome);
            return (
              <button
                key={cor.nome}
                type="button"
                aria-label={cor.nome}
                aria-pressed={ativa}
                onClick={() => escolher(cor.nome)}
                className="flex min-h-11 min-w-0 flex-col items-center gap-1 rounded-xl px-0 py-0.5 transition-all active:scale-95"
              >
                <Bolinha hex={cor.hex} tamanho="size-11" marcada={ativa} />
                {!compacto && (
                  <span
                    className={cn(
                      "w-full break-words text-center text-[11px] leading-tight",
                      ativa ? "font-bold text-foreground" : "text-zinc-400",
                    )}
                  >
                    {cor.nome}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}

      {lista.length > 0 && (
        <div className="grid grid-cols-4 gap-2">
          {lista.map((item) => {
            const ativa = marcado(item);
            return (
              <button
                key={item}
                type="button"
                aria-pressed={ativa}
                onClick={() => escolher(item)}
                className={cn(
                  "relative flex min-h-11 items-center justify-center rounded-xl border px-2 text-sm font-bold transition-all active:scale-95",
                  ativa
                    ? "border-solid border-foreground bg-admin-hover text-foreground ring-1 ring-inset ring-foreground"
                    : "border-admin-border bg-admin-bg text-zinc-300 hover:border-admin-border-strong",
                )}
              >
                {item}
                {ativa && (
                  <span className="absolute right-0.5 top-0.5 flex size-5 items-center justify-center rounded-full bg-foreground">
                    <Check
                      data-marca="selecionado"
                      strokeWidth={3}
                      className="size-3.5 text-background"
                    />
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}

      {props.modo === "multiplo" && chipsDoProduto.length > 0 && (
        <div className="space-y-2">
          <p className="text-[11px] text-zinc-500">Outros valores</p>
          <div className="flex flex-wrap gap-1.5">
            {chipsDoProduto.map((chip) => {
              const ativa = marcado(chip.valor);
              return (
                <button
                  key={chip.valor}
                  type="button"
                  data-testid="chip-do-produto"
                  aria-pressed={ativa}
                  onClick={() => props.onAlternar(chip.valor)}
                  className={cn(
                    "min-h-11 rounded-full border px-3 py-2 text-xs font-bold transition-all active:scale-95",
                    ativa
                      ? "border-solid border-foreground bg-admin-hover text-foreground"
                      : "border-admin-border bg-admin-bg text-zinc-400 hover:border-admin-border-strong",
                  )}
                >
                  {chip.valor}{" "}
                  {chip.usado && !ativa && (
                    <span className="text-[11px] font-black uppercase tracking-wider text-zinc-600">
                      já usado
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {props.modo === "multiplo" && props.selecionados.length > 0 && (
        <div className="space-y-2">
          <p className="text-[11px] text-zinc-500">Selecionadas:</p>
          <div className="flex flex-wrap gap-1.5">
            {props.selecionados.map((valor) => {
              const hex = ehPaleta ? corDaVariacao(valor) : null;
              return (
                <button
                  key={valor}
                  type="button"
                  aria-label={`Tirar ${valor}`}
                  onClick={() => props.onAlternar(valor)}
                  className="flex min-h-11 items-center gap-2 rounded-full border border-admin-border bg-admin-bg px-3 text-xs font-bold text-foreground transition-all active:scale-95"
                >
                  {hex && <Bolinha hex={hex} tamanho="size-3" />}
                  {valor}
                  <X className="size-3.5 text-zinc-500" />
                </button>
              );
            })}
          </div>
        </div>
      )}

      {props.modo === "unico" ? (
        <LocalBufferedInput
          id={idDoValor}
          name={idDoValor}
          type="text"
          aria-label={`Valor do atributo ${numero}`}
          value={props.valor}
          onFlush={(texto) => props.onValor(valorDaPaleta(nome, texto))}
          className={CAMPO}
          placeholder={PLACEHOLDER[tipo ?? "Outro"]}
        />
      ) : (
        <div className="flex items-center gap-2">
          <LocalBufferedInput
            id={idDoValor}
            name={idDoValor}
            type="text"
            aria-label={`Novo valor do atributo ${numero}`}
            value={props.rascunho}
            onFlush={props.onRascunho}
            className={CAMPO}
            placeholder={PLACEHOLDER[tipo ?? "Outro"]}
          />
          <button
            type="button"
            aria-label={`Adicionar valor do atributo ${numero}`}
            onClick={props.onAdicionar}
            className="flex size-11 shrink-0 items-center justify-center rounded-xl border border-emerald-500/20 bg-emerald-500/10 text-emerald-500 transition-all hover:bg-emerald-500 hover:text-emerald-950 active:scale-95"
          >
            <Plus className="size-4" />
          </button>
        </div>
      )}
    </div>
  );
}
