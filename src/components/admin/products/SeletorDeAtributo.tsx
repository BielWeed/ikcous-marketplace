import { LocalBufferedInput } from "@/components/admin/LocalBufferedInput";
import { cn } from "@/lib/utils";
import {
  SEPARADOR_DE_ATRIBUTOS,
  type TipoDoAtributo,
  dobrar,
  tipoDoNome,
} from "@/utils/atributos-da-variacao";
import { PALETA_DE_CORES, corDaVariacao } from "@/utils/cor-da-variacao";
import {
  Check,
  Layers,
  Package,
  Pencil,
  Plus,
  Ruler,
  X,
  Zap,
} from "lucide-react";
import { type KeyboardEvent, type ReactNode, useState } from "react";

/**
 * Escolher em vez de digitar: o lojista toca o que muda no produto (Tamanho,
 * Cor, Voltagem, Capacidade, Material ou Outro) e, embaixo, toca a bolinha da
 * cor ou o botão do tamanho, da voltagem, da capacidade ou do material. A loja
 * já mostra a cor como bolinha; aqui o painel fala a mesma língua. Tamanho e
 * Capacidade têm ABAS (Roupas | Números | Calçados | Outro; Armazenamento |
 * Volume | Outro): a aba aberta nasce do valor que o produto já grava.
 *
 * O que é GRAVADO não muda: o nome do atributo ("Cor") e o nome do valor
 * ("Azul marinho") continuam sendo texto em `product_variants` — o seletor só
 * muda como o lojista chega neles. Por isso o tipo marcado é DERIVADO do nome
 * que já existe: produto antigo com "Cor" abre com a peça Cor marcada; qualquer
 * outro nome ("Estampa") abre em "Outro" com o texto preservado, e o valor
 * antigo ("Espacial Grey", "2 anos") segue no campo de texto e na aba Outro,
 * nunca se perde.
 *
 * Dois modos: `unico` (a variação de um valor só) e `multiplo` (a grade, onde
 * vários valores entram de uma vez). O estado dos valores é do PAI — o seletor
 * só desenha e avisa.
 */

// A leitura do nome mora em utils (a loja usa a mesma): aqui só se repassa.
export type { TipoDoAtributo };
export { tipoDoNome };

const NOMES_DA_PALETA = PALETA_DE_CORES.map((cor) => cor.nome);

/** "34", "36"… "56": os números como TEXTO, que é o que o produto grava. */
const faixa = (de: number, ate: number, passo = 1): string[] =>
  Array.from({ length: Math.floor((ate - de) / passo) + 1 }, (_, i) =>
    String(de + i * passo),
  );

interface Aba {
  rotulo: string;
  /** Vazia = a aba "Outro": nada a tocar, o lojista digita. */
  valores: readonly string[];
}

/** O que cada tipo oferece para TOCAR. Mais de uma aba = a faixa de abas. */
interface Catalogo {
  abas: readonly Aba[];
  /** Largura do botão decide as colunas: 4 cabem só o que tem até 5 letras. */
  colunas: string;
  rotuloDasAbas?: string;
  ajuda: string;
  /** A aba Outro explica o que fazer; o texto vale para a ação também. */
  exemplo?: string;
  /** "Digitar outro tamanho": atalho para a aba Outro e o campo. */
  digitarOutro?: string;
  /** O Material não tem aba Outro: o botão "Outro" da própria lista leva ao campo. */
  botaoOutro?: string;
  icone?: ReactNode;
}

const OUTRA_ABA: Aba = { rotulo: "Outro", valores: [] };

const CATALOGO = new Map<TipoDoAtributo, Catalogo>([
  [
    "Tamanho",
    {
      abas: [
        {
          rotulo: "Roupas",
          valores: ["PP", "P", "M", "G", "GG", "XG", "Único"],
        },
        { rotulo: "Números", valores: faixa(34, 56, 2) },
        { rotulo: "Calçados", valores: faixa(33, 44) },
        OUTRA_ABA,
      ],
      // Abaixo de 360 px o "Único" marcado (✓ + texto) não cabe em 4 colunas.
      colunas: "grid-cols-4 max-[359px]:grid-cols-3",
      rotuloDasAbas: "Sistema de medida",
      ajuda: "Roupas: PP a XG e Único · Números: 34 a 56 · Calçados: 33 a 44",
      exemplo: "Digite o tamanho no campo abaixo. Ex.: 2 anos, 48.",
      digitarOutro: "Digitar outro tamanho",
    },
  ],
  [
    "Voltagem",
    {
      abas: [{ rotulo: "Voltagem", valores: ["110V", "220V", "Bivolt"] }],
      colunas: "grid-cols-3",
      ajuda: "Bivolt serve nas duas tomadas (110V e 220V).",
      icone: <Zap aria-hidden="true" className="size-4 shrink-0" />,
    },
  ],
  [
    "Capacidade",
    {
      abas: [
        {
          rotulo: "Armazenamento",
          valores: [
            "16 GB",
            "32 GB",
            "64 GB",
            "128 GB",
            "256 GB",
            "512 GB",
            "1 TB",
          ],
        },
        {
          rotulo: "Volume",
          valores: ["50 ml", "100 ml", "250 ml", "500 ml", "1 L", "2 L"],
        },
        OUTRA_ABA,
      ],
      colunas: "grid-cols-3",
      rotuloDasAbas: "Tipo de capacidade",
      ajuda: "Armazenamento: 16 GB a 1 TB · Volume: 50 ml a 2 L",
      exemplo: "Digite a capacidade no campo abaixo. Ex.: 3 L, 750 ml.",
      digitarOutro: "Digitar outra capacidade",
    },
  ],
  [
    "Material",
    {
      abas: [
        {
          rotulo: "Material",
          valores: [
            "Algodão",
            "Poliéster",
            "Couro",
            "Couro sintético",
            "Linho",
            "Jeans",
            "Plástico",
            "Metal",
            "Madeira",
            "Vidro",
          ],
        },
      ],
      colunas: "grid-cols-3",
      ajuda: "Não achou o seu? Toque em Outro e digite.",
      botaoOutro: "Outro material",
    },
  ],
]);

/** Tudo o que o tipo oferece pronto, de todas as abas (a Cor oferece a paleta). */
function ofertaDoTipo(tipo: TipoDoAtributo | null): readonly string[] {
  if (tipo === "Cor") return NOMES_DA_PALETA;
  return (
    (tipo ? CATALOGO.get(tipo)?.abas : undefined)?.flatMap((a) => a.valores) ??
    []
  );
}

/** A régua do TOQUE para dizer "é o mesmo valor": sem as pontas, sem caixa, sem
 *  acento e sem espaço no meio ("128gb" é o "128 GB" da lista, "Algodao" é o
 *  "Algodão"). Serve só para reconhecer o botão e reaproveitar a grafia que o
 *  produto já grava; o que o lojista DIGITA nunca passa por ela e grava como
 *  foi digitado. */
const chave = (texto: string): string => dobrar(texto).replace(/\s+/g, "");

/** A aba que abre: a que tem MAIS dos valores já existentes (empate = a primeira,
 *  e o que nenhuma lista tem conta para "Outro"). Sem valor nenhum, a primeira.
 *  Quem decide é só a abertura: depois o lojista manda, e digitar um valor novo
 *  não faz a aba pular. "38" mora em Números e em Calçados e abre em Números. */
function abaInicial(abas: readonly Aba[], valores: string[]): string {
  const placar = new Map<string, number>();
  for (const v of new Set(valores.map(chave).filter((c) => c !== ""))) {
    const dona =
      abas.find((a) => a.valores.some((item) => chave(item) === v)) ??
      abas.find((a) => a.valores.length === 0);
    if (dona) placar.set(dona.rotulo, (placar.get(dona.rotulo) ?? 0) + 1);
  }
  let melhor = abas.at(0);
  let maximo = 0;
  for (const a of abas) {
    const n = placar.get(a.rotulo) ?? 0;
    if (n > maximo) [melhor, maximo] = [a, n];
  }
  return melhor?.rotulo ?? "";
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
   *  que a trava recusa. As partes sem peça própria (ex.: "Estampa") viram
   *  atalho, sem redigitar. Vazio = nada em uso. */
  sugestoes?: string[];
  /** Par de uma variante composta: a mesma coisa, mais enxuta. */
  compacto?: boolean;
  aoRemover?: () => void;
  rotuloDoRemover?: string;
  /** Tipos (Cor, Tamanho, Voltagem…) que OUTRO atributo do mesmo produto já
   *  escolheu: a peça fica apagada e não clicável. O tipo do próprio atributo
   *  nunca apaga, e "Outro" não conta (os nomes livres se distinguem). */
  tiposOcupados?: TipoDoAtributo[];
  /** Os NOMES (não os tipos) que os outros pares/cartões do mesmo produto já
   *  usam. A peça e o atalho nunca escrevem um desses: "Memória / Memória" a
   *  trava recusaria. Vazio = nenhum outro par. */
  nomesOcupados?: string[];
  /** O atributo nasce em "Outro" com o campo do nome aberto (o atalho "+ Outro"). */
  iniciarEmOutro?: boolean;
}

interface Unico extends Comum {
  modo: "unico";
  valor: string;
  onValor: (valor: string) => void;
  /** Valores que o produto já grava para ESTE atributo. A loja compara o texto
   *  exato, então "azul" e "Azul" seriam duas cores: quem escolhe ou digita um
   *  valor que já existe (em qualquer caixa) recebe a grafia que está gravada. */
  valoresEmUso?: string[];
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
  /** Troca a lista inteira de escolhidos de uma vez. É o que "Marcar todos" e
   *  "Limpar" usam: marcar 12 tamanhos com 12 chamadas de `onAlternar` deixaria
   *  só o último (cada uma parte da lista velha). Sem ele, os dois botões não
   *  aparecem. */
  onDefinir?: (selecionados: string[]) => void;
}

export type SeletorDeAtributoProps = Unico | Multiplo;

// Tamanho primeiro: é por ele que a cliente começa na loja (escolhe o tamanho
// e vê as cores que existem nele), e o lojista monta o produto na mesma ordem.
// Seis peças cabem em 320 px porque viram 3 colunas × 2 linhas.
const PECAS: ReadonlyArray<{ tipo: TipoDoAtributo; icone: ReactNode }> = [
  { tipo: "Tamanho", icone: <Ruler aria-hidden="true" className="size-6" /> },
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
  { tipo: "Voltagem", icone: <Zap aria-hidden="true" className="size-6" /> },
  {
    tipo: "Capacidade",
    icone: <Package aria-hidden="true" className="size-6" />,
  },
  { tipo: "Material", icone: <Layers aria-hidden="true" className="size-6" /> },
  { tipo: "Outro", icone: <Pencil aria-hidden="true" className="size-6" /> },
];

const CAMPO =
  "w-full rounded-2xl border border-admin-border bg-admin-bg px-4 py-3 text-sm font-bold transition-all focus:border-foreground focus:outline-none focus:ring-2 focus:ring-ring";

const PLACEHOLDER: Record<TipoDoAtributo, string> = {
  Cor: "Outra cor? Digite aqui",
  Tamanho: "Outro tamanho? Digite aqui",
  Voltagem: "Outra voltagem? Digite aqui",
  Capacidade: "Outra capacidade? Digite aqui",
  Material: "Outro material? Digite aqui",
  Outro: "Outro valor? Digite aqui",
};

const CHAMADA = new Map<TipoDoAtributo, [string, string]>([
  ["Cor", ["Escolha a cor", "Escolha as cores"]],
  ["Tamanho", ["Escolha o tamanho", "Escolha os tamanhos"]],
  ["Voltagem", ["Escolha a voltagem", "Escolha as voltagens"]],
  ["Capacidade", ["Escolha a capacidade", "Escolha as capacidades"]],
  ["Material", ["Escolha o material", "Escolha os materiais"]],
]);

/** "3 selecionadas" (cores e capacidades, feminino) · "3 selecionados" (o resto) · "nenhum selecionado". */
function contagemDosSelecionados(n: number, feminino: boolean): string {
  if (n === 0) return feminino ? "nenhuma selecionada" : "nenhum selecionado";
  const palavra = feminino ? "selecionada" : "selecionado";
  return `${n} ${palavra}${n === 1 ? "" : "s"}`;
}

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

/** O botão grande de um valor pronto (tamanho, voltagem, capacidade, material):
 *  marcado = fundo mais claro, borda forte e o ✓ ANTES do texto. */
function BotaoDeValor({
  item,
  tipo,
  ativa,
  icone,
  aoTocar,
}: {
  item: string;
  tipo: TipoDoAtributo;
  ativa: boolean;
  icone?: ReactNode;
  aoTocar: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={ativa}
      aria-label={`${tipo} ${item}`}
      onClick={aoTocar}
      className={cn(
        "flex min-h-[52px] min-w-0 items-center justify-center gap-1 rounded-2xl border border-solid px-0.5 text-center text-sm font-bold leading-tight transition-all active:scale-95",
        ativa
          ? "border-foreground bg-admin-hover text-foreground ring-1 ring-inset ring-foreground"
          : "border-admin-border bg-admin-bg text-zinc-300 hover:border-admin-border-strong",
      )}
    >
      {ativa ? (
        <Check
          data-marca="selecionado"
          strokeWidth={3}
          className="size-3.5 shrink-0"
        />
      ) : (
        icone
      )}
      {item}
    </button>
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
  const [outroAberto, setOutroAberto] = useState(props.iniciarEmOutro ?? false);
  const tipo = outroAberto ? "Outro" : tipoDoNome(nome);

  const selecionadosDoModo =
    props.modo === "unico"
      ? props.valor.trim() === ""
        ? []
        : [props.valor]
      : props.selecionados;
  const marcado = (item: string) =>
    selecionadosDoModo.some((s) => chave(s) === chave(item));

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

  const emUso = (props.sugestoes ?? [])
    .flatMap((n) => n.split(SEPARADOR_DE_ATRIBUTOS))
    .map((n) => n.trim())
    .filter((n) => n !== "");

  // Nomes que OUTRO par do produto já usa (sem caixa nem acento) e, entre os que
  // o produto grava, os de cada tipo. Um produto "Memória / Armazenamento" tem
  // DOIS nomes do tipo Capacidade: a peça sozinha não distingue, então o nome
  // real vira atalho e a peça escolhe o que ainda não foi tomado.
  const tomados = new Set((props.nomesOcupados ?? []).map(dobrar));
  const unicos = (nomes: string[]) =>
    nomes.filter(
      (n, i) => nomes.findIndex((o) => dobrar(o) === dobrar(n)) === i,
    );
  const emUsoDoTipo = (alvo: TipoDoAtributo) =>
    unicos(emUso.filter((n) => tipoDoNome(n) === alvo));
  /** O nome que a peça escreve: o que o produto já grava e ninguém tomou; sem
   *  nome em uso, o canônico, se o tipo e o nome estão livres. `undefined` = a
   *  peça não tem o que escrever (fica apagada). */
  const grafiaLivre = (alvo: TipoDoAtributo): string | undefined =>
    emUsoDoTipo(alvo).find((n) => !tomados.has(dobrar(n))) ??
    // O canônico só vale quando o produto não grava nome nenhum desse tipo.
    ((props.tiposOcupados ?? []).includes(alvo) ||
    tomados.has(dobrar(alvo)) ||
    emUsoDoTipo(alvo).length > 0
      ? undefined
      : alvo);

  // O atalho do nome que OUTRO par já usa não grava (o do próprio par nunca é "tomado").
  const atalhoTomado = (atalho: string) =>
    tomados.has(dobrar(atalho)) && dobrar(nome) !== dobrar(atalho);

  const tocarNaPeca = (alvo: TipoDoAtributo) => {
    if (alvo === tipo) return;
    if (alvo === "Outro") {
      setOutroAberto(true);
      // O nome de Cor/Tamanho/Voltagem sai: o campo livre nasce vazio.
      if (tipoDoNome(nome) !== "Outro" && nome !== "") trocarDeTipo("");
      return;
    }
    // A loja agrupa pelo nome EXATO: num produto que já grava "cor", a peça Cor
    // grava "cor" (e não "Cor", que viraria um segundo grupo na vitrine).
    const grafia = grafiaLivre(alvo);
    if (grafia === undefined) return;
    setOutroAberto(false);
    if (nome !== grafia) trocarDeTipo(grafia);
  };

  // O que o lojista TOCA (bolinha, tamanho, chip) usa a grafia que o produto já
  // grava: "azul" gravado + toque na bolinha Azul = "azul". O que ele DIGITA
  // nunca é trocado: texto digitado grava exatamente o que foi digitado.
  // Na grade vale também o que já está marcado (digitado nesta abertura): tocar
  // o botão equivalente o DESMARCA em vez de criar um segundo valor.
  const valoresGravados =
    props.modo === "unico"
      ? (props.valoresEmUso ?? [])
      : [
          // O já marcado vem primeiro: com "1 L" e "1L" gravados, o toque acha o
          // valor marcado e o desmarca, em vez de marcar o "gêmeo".
          ...props.selecionados,
          ...props.chips.filter((chip) => chip.usado).map((chip) => chip.valor),
        ];
  const casarValor = (item: string): string =>
    valoresGravados.find((gravado) => chave(gravado) === chave(item)) ?? item;
  const escolher = (item: string) => {
    const valor = casarValor(item);
    if (props.modo === "unico") props.onValor(valor);
    else props.onAlternar(valor);
  };
  // Atalho = nome em uso que a peça não representa sozinha: os de "Outro" e os
  // de um tipo com mais de um nome em uso.
  const atalhos = unicos(emUso).filter((n) => {
    const t = tipoDoNome(n);
    return t === "Outro" || (t !== null && emUsoDoTipo(t).length > 1);
  });
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
            !ofertaDoTipo(tipo).some(
              (item) => chave(item) === chave(chip.valor),
            ),
        )
      : [];

  const ehPaleta = tipo === "Cor";

  // As abas: a que abre vem do que o produto já grava; depois quem manda é o
  // lojista. Trocar de tipo recomeça (a lista de Capacidade não é a de Tamanho).
  const catalogo = tipo ? CATALOGO.get(tipo) : undefined;
  const temAbas = (catalogo?.abas.length ?? 0) > 1;
  const valoresDoProduto =
    props.modo === "unico"
      ? [props.valor]
      : [...props.selecionados, ...props.chips.map((chip) => chip.valor)];
  const abaDeAbertura = catalogo
    ? abaInicial(catalogo.abas, valoresDoProduto)
    : "";
  const [escolhaDaAba, setEscolhaDaAba] = useState({
    tipo,
    rotulo: abaDeAbertura,
  });
  if (escolhaDaAba.tipo !== tipo) {
    setEscolhaDaAba({ tipo, rotulo: abaDeAbertura });
  }
  const rotuloDaAba =
    escolhaDaAba.tipo === tipo ? escolhaDaAba.rotulo : abaDeAbertura;
  const abaAtual =
    catalogo?.abas.find((a) => a.rotulo === rotuloDaAba) ??
    catalogo?.abas.at(0);
  const irParaOCampo = () => document.getElementById(idDoValor)?.focus();
  const abrirAba = (rotulo: string, comCampo: boolean) => {
    setEscolhaDaAba({ tipo, rotulo });
    if (comCampo) irParaOCampo();
  };
  const idDaAba = (indice: number) => `${idDoValor}-aba-${indice}`;
  const idDoPainel = `${idDoValor}-painel`;
  // Setas, Home e End como no padrão tablist: trocam a aba e levam o foco.
  const aoTeclarNaAba = (
    e: KeyboardEvent<HTMLButtonElement>,
    indice: number,
  ) => {
    const total = catalogo?.abas.length ?? 0;
    const destino =
      e.key === "ArrowRight"
        ? (indice + 1) % total
        : e.key === "ArrowLeft"
          ? (indice + total - 1) % total
          : e.key === "Home"
            ? 0
            : e.key === "End"
              ? total - 1
              : -1;
    const aba = destino >= 0 ? catalogo?.abas.at(destino) : undefined;
    if (!aba) return;
    e.preventDefault();
    abrirAba(aba.rotulo, false);
    document.getElementById(idDaAba(destino))?.focus();
  };
  const abaOutro = catalogo?.abas.find((a) => a.valores.length === 0);
  const naoMarcados = (abaAtual?.valores ?? []).filter(
    (item) => !marcado(item),
  );
  const marcarTodos = () => {
    if (props.modo !== "multiplo" || !props.onDefinir) return;
    // A grafia que o produto já grava vence a da lista ("p" gravado fica "p").
    props.onDefinir([...props.selecionados, ...naoMarcados.map(casarValor)]);
  };
  const podeDefinir = props.modo === "multiplo" && !!props.onDefinir;
  const chamada = tipo
    ? CHAMADA.get(tipo)?.at(props.modo === "unico" ? 0 : 1)
    : undefined;
  const escolhaAtual = props.modo === "unico" ? props.valor.trim() : "";
  const hexDaEscolha = escolhaAtual ? corDaVariacao(escolhaAtual) : null;

  // O cartão diz o nome GRAVADO quando ele difere do tipo ("Memória",
  // "Armazenamento"): dois cartões do mesmo tipo não podem se chamar igual.
  const rotuloDoCartao =
    tipo === "Outro"
      ? nome.trim() || "Outro"
      : tipo === null
        ? "Escolha o tipo"
        : nome.trim() !== "" && dobrar(nome) !== dobrar(tipo)
          ? nome.trim()
          : tipo;

  return (
    <div data-testid={`atributo-${numero - 1}`} className="space-y-4">
      <div className="flex items-start gap-2">
        {/* O × fica na coluna da direita e não encolhe: a contagem é que desce
            para baixo do título quando não cabe a 320 px. */}
        <div className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2">
          <p className="min-w-0 text-base font-bold text-foreground">
            {props.modo === "multiplo"
              ? `${numero} · ${rotuloDoCartao}`
              : titulo}
          </p>
          {props.modo === "multiplo" && (
            <span
              data-testid="contagem-do-atributo"
              className="whitespace-nowrap text-sm text-zinc-400"
            >
              {contagemDosSelecionados(
                props.selecionados.length,
                tipo === "Cor" || tipo === "Capacidade",
              )}
            </span>
          )}
        </div>
        {props.aoRemover && (
          <button
            type="button"
            aria-label={props.rotuloDoRemover ?? `Remover atributo ${numero}`}
            onClick={props.aoRemover}
            className="flex size-11 shrink-0 items-center justify-center rounded-xl border border-solid border-admin-border bg-admin-bg text-zinc-500 transition-all hover:border-red-500/30 hover:text-red-500 active:scale-95"
          >
            <X className="size-4" />
          </button>
        )}
      </div>

      <div
        role="group"
        aria-label={`O que muda, atributo ${numero}`}
        className={cn(
          "grid gap-2",
          pecasVisiveis.length > 4
            ? "grid-cols-3"
            : "auto-cols-fr grid-flow-col",
        )}
      >
        {pecasVisiveis.map(({ tipo: peca, icone }) => {
          const ativa = tipo === peca;
          const ocupada =
            !ativa && peca !== "Outro" && grafiaLivre(peca) === undefined;
          return (
            <button
              key={peca}
              type="button"
              aria-pressed={ativa}
              aria-disabled={ocupada || undefined}
              onClick={() => {
                if (!ocupada) tocarNaPeca(peca);
              }}
              className={cn(
                "flex min-h-11 min-w-0 flex-col items-center justify-center gap-1.5 rounded-2xl border border-solid px-1 py-2.5 text-xs font-bold transition-all active:scale-95",
                ocupada && "cursor-not-allowed opacity-40",
                ativa
                  ? "border-foreground bg-admin-hover text-foreground ring-1 ring-inset ring-foreground"
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
              aria-disabled={atalhoTomado(atalho) || undefined}
              onClick={() => {
                if (atalhoTomado(atalho)) return;
                setOutroAberto(false);
                trocarDeTipo(atalho);
              }}
              className={cn(
                "min-h-11 rounded-full border border-solid px-3 text-xs font-bold transition-all active:scale-95",
                atalhoTomado(atalho) && "cursor-not-allowed opacity-40",
                dobrar(nome) === dobrar(atalho)
                  ? "border-foreground bg-admin-hover text-foreground"
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
          // Sair do campo sem editar não pode regravar o nome (nem marcar a
          // variação como alterada): só avisa o pai quando o texto mudou.
          onFlush={(texto) => {
            if (texto !== nome) onNome(texto);
          }}
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
          Toque no que muda neste produto: tamanho, cor, voltagem, capacidade,
          material ou outro.
        </p>
      )}

      {ehPaleta && (
        <div className="grid grid-cols-6 gap-x-0.5 gap-y-3 max-[359px]:grid-cols-5 max-[359px]:gap-x-0">
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
                      "w-full hyphens-none text-center text-[11px] leading-tight [overflow-wrap:normal]",
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

      {catalogo && abaAtual && (
        <div className="space-y-3">
          {temAbas && (
            <div
              role="tablist"
              aria-label={catalogo.rotuloDasAbas}
              className="flex gap-1"
            >
              {catalogo.abas.map((a, indice) => {
                const ativa = a.rotulo === abaAtual.rotulo;
                return (
                  <button
                    key={a.rotulo}
                    id={idDaAba(indice)}
                    type="button"
                    role="tab"
                    aria-selected={ativa}
                    aria-controls={idDoPainel}
                    tabIndex={ativa ? 0 : -1}
                    onKeyDown={(e) => aoTeclarNaAba(e, indice)}
                    onClick={() => abrirAba(a.rotulo, a.valores.length === 0)}
                    className={cn(
                      "min-h-11 min-w-0 flex-auto truncate rounded-full border border-solid px-1 text-xs min-[360px]:px-2 font-bold transition-all active:scale-95",
                      ativa
                        ? "border-foreground bg-admin-hover text-foreground"
                        : "border-admin-bg bg-admin-bg text-zinc-400 hover:border-admin-border-strong",
                    )}
                  >
                    {a.rotulo}
                  </button>
                );
              })}
            </div>
          )}

          <div
            id={temAbas ? idDoPainel : undefined}
            role={temAbas ? "tabpanel" : undefined}
            aria-labelledby={
              temAbas ? idDaAba(catalogo.abas.indexOf(abaAtual)) : undefined
            }
          >
            {abaAtual.valores.length > 0 ? (
              <div
                data-testid="valores-do-atributo"
                className={cn("grid gap-2", catalogo.colunas)}
              >
                {abaAtual.valores.map((item) => (
                  <BotaoDeValor
                    key={item}
                    item={item}
                    tipo={tipo ?? "Outro"}
                    ativa={marcado(item)}
                    icone={catalogo.icone}
                    aoTocar={() => escolher(item)}
                  />
                ))}
                {catalogo.botaoOutro && (
                  <button
                    type="button"
                    aria-label={catalogo.botaoOutro}
                    onClick={irParaOCampo}
                    className="flex min-h-[52px] min-w-0 items-center justify-center gap-1.5 rounded-2xl border border-solid border-admin-border bg-admin-bg px-1 text-sm font-bold text-zinc-300 transition-all hover:border-admin-border-strong active:scale-95"
                  >
                    <Pencil aria-hidden="true" className="size-4 shrink-0" />
                    Outro
                  </button>
                )}
              </div>
            ) : (
              <p className="text-sm text-zinc-400">{catalogo.exemplo}</p>
            )}
          </div>

          <p className="text-[11px] text-zinc-500">{catalogo.ajuda}</p>

          <div className="flex flex-wrap items-center gap-x-4">
            {podeDefinir && naoMarcados.length > 0 && (
              <button
                type="button"
                onClick={marcarTodos}
                className="min-h-11 text-xs font-bold text-zinc-400 transition-all hover:text-foreground active:scale-95"
              >
                Marcar todos
              </button>
            )}
            {props.modo === "multiplo" &&
              props.onDefinir &&
              props.selecionados.length > 0 && (
                <button
                  type="button"
                  onClick={() => props.onDefinir?.([])}
                  className="min-h-11 text-xs font-bold text-zinc-400 transition-all hover:text-foreground active:scale-95"
                >
                  Limpar
                </button>
              )}
            {catalogo.digitarOutro && (
              <button
                type="button"
                onClick={() =>
                  abrirAba(abaOutro?.rotulo ?? abaAtual.rotulo, true)
                }
                className="min-h-11 text-xs font-bold text-zinc-400 transition-all hover:text-foreground active:scale-95"
              >
                {catalogo.digitarOutro}
              </button>
            )}
          </div>
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
                    "min-h-11 rounded-full border border-solid px-3 py-2 text-xs font-bold transition-all active:scale-95",
                    ativa
                      ? "border-foreground bg-admin-hover text-foreground"
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
                  className="flex min-h-11 items-center gap-2 rounded-full border border-solid border-admin-border bg-admin-bg px-3 text-xs font-bold text-foreground transition-all active:scale-95"
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
          // Grava o digitado, sem trocar nada. Só o que o lojista de fato mudou é
          // reescrito: focar e sair do campo não marca a variação como alterada.
          onFlush={(texto) => {
            if (texto !== props.valor) props.onValor(texto);
          }}
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
            className="flex size-11 shrink-0 items-center justify-center rounded-xl border border-solid border-emerald-500/20 bg-emerald-500/10 text-emerald-500 transition-all hover:bg-emerald-500 hover:text-emerald-950 active:scale-95"
          >
            <Plus className="size-4" />
          </button>
        </div>
      )}
    </div>
  );
}
