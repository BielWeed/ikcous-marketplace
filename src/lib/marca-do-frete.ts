// MARCA DO FRETE (tarefa "cart-frete-logos", 23/09/2026) — normalizador
// central de nome de transportadora e agregador para os cartões de cotação
// de frete. Função pura, só EXIBIÇÃO: nunca altera `id`, `provider` nem
// qualquer campo do objeto persistido — quem chama continua mandando o
// `ShippingOption` original para o carrinho/checkout/pedido. Serve tanto o
// carrinho/checkout (que tem o `ShippingOption` inteiro) quanto o painel
// admin (que só tem `transportadora`/`servico`/`provedor` soltos, sem `id`
// nem `name`) — por isso todo campo de entrada é opcional.
//
// REGRA DE TÍTULO/SUBTÍTULO (por que o card hoje repete informação):
// A edge `calculate-shipping` monta `name` como "Entrega econômica" (PAC dos
// Correios), "Entrega expressa" (SEDEX dos Correios) ou "<Transportadora> —
// <Serviço>" para o resto (`supabase/functions/calculate-shipping/regua.ts`,
// `nomeDaOpcao`). O card hoje mostra `name` como título e "Transportadora —
// Serviço · via Provedor" como subtítulo — ex.: "Loggi — Express" seguido de
// "Loggi — Express · via Melhor Envio": a transportadora e o serviço
// aparecem duas vezes na mesma linha visual. A regra daqui:
//   - Transportadora reconhecida: título = "<Transportadora> <Serviço
//     limpo>" (ex.: "Loggi Express"), sem subtítulo — o "via <Provedor>"
//     fica por conta de quem desenha o card (peça 3, `MarcaDoFrete.tsx`),
//     que já mostra o logo do agregador ao lado.
//   - Correios PAC/SEDEX são a ÚNICA exceção: o título continua o rótulo
//     genérico que a cliente já reconhece ("Entrega econômica"/"Entrega
//     expressa"), e o subtítulo mostra o serviço real ("Correios · PAC")
//     porque, aí sim, o título sozinho perdeu a especificidade.
//   - Transportadora desconhecida: mesma composição de "<Transportadora>
//     <Serviço>", com o texto tal como veio (aparado) — sem inventar nome.
//   - Sem transportadora (retirada na loja, entrega local, frete grátis):
//     devolve o `name` original como título, sem transportadora nem
//     agregador — essas opções não têm nenhuma das duas coisas.
import type { ShippingOption } from "@/types/index";

/** Transportadora normalizada, ou `null` quando a opção não tem uma. */
export interface TransportadoraNormalizada {
  /** Slug do arquivo de logo (`LOGO_TRANSPORTADORA`), ou `null` se não reconhecida. */
  slug: string | null;
  /** Nome canônico para exibir; para a desconhecida, o texto original aparado. */
  nome: string;
}

/** Agregador (Melhor Envio/Frenet/SuperFrete) normalizado, ou `null`. */
export interface AgregadorNormalizado {
  slug: string;
  nome: string;
}

export interface MarcaDoFrete {
  transportadora: TransportadoraNormalizada | null;
  servico: string | null;
  titulo: string;
  subtitulo: string | null;
  agregador: AgregadorNormalizado | null;
}

/**
 * Entrada aceita: o `ShippingOption` inteiro (carrinho/checkout) ou só o
 * recorte que o admin tem (`transportadora`/`servico`/`provedor`, sem `id`
 * nem `name`). Todo campo é opcional de propósito.
 */
export type EntradaMarcaDoFrete = Partial<
  Pick<
    ShippingOption,
    "id" | "name" | "transportadora" | "servico" | "provedorRotulo" | "provider"
  >
>;

/** Mapa slug → arquivo do logo da transportadora, servido de `public/logos/`. */
export const LOGO_TRANSPORTADORA: Readonly<Record<string, string>> = {
  correios: "/logos/transportadoras/correios.svg",
  jadlog: "/logos/transportadoras/jadlog.png",
  loggi: "/logos/transportadoras/loggi.svg",
  "jt-express": "/logos/transportadoras/jt-express.png",
  "total-express": "/logos/transportadoras/total-express.svg",
  "latam-cargo": "/logos/transportadoras/latam-cargo.svg",
  "azul-cargo": "/logos/transportadoras/azul-cargo.svg",
  buslog: "/logos/transportadoras/buslog.png",
};

/**
 * Logos oficiais cujo texto é BRANCO (feitos para o cabeçalho escuro do
 * site da marca): no selo de fundo branco a palavra sumiria — a Azul Cargo
 * ficava só com o ícone. Esses ganham selo de fundo escuro.
 */
export const LOGO_SOBRE_FUNDO_ESCURO: ReadonlySet<string> = new Set([
  "azul-cargo",
]);

/** Mapa slug → arquivo do logo do agregador, servido de `public/logos/`. */
export const LOGO_AGREGADOR: Readonly<Record<string, string>> = {
  "melhor-envio": "/logos/provedores/melhor-envio.png",
  frenet: "/logos/provedores/frenet.svg",
  superfrete: "/logos/provedores/superfrete.png",
};

// Consulta por Map, nunca `OBJETO[slug]`: um slug como "constructor" ou
// "toString" devolveria um membro do protótipo em vez de `undefined`.
const LOGO_TRANSPORTADORA_POR_SLUG = new Map(
  Object.entries(LOGO_TRANSPORTADORA),
);
const LOGO_AGREGADOR_POR_SLUG = new Map(Object.entries(LOGO_AGREGADOR));

/** Arquivo do logo da transportadora, ou `undefined` se não há logo oficial. */
export function logoDaTransportadora(slug: string): string | undefined {
  return LOGO_TRANSPORTADORA_POR_SLUG.get(slug);
}

/** Arquivo do logo do agregador, ou `undefined` se não há logo oficial. */
export function logoDoAgregador(slug: string): string | undefined {
  return LOGO_AGREGADOR_POR_SLUG.get(slug);
}

/** Remove acento, caixa e pontuação — a mesma chave serve "JadLog", "JADLOG" e "Jad Log". */
function canonizar(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

interface DefinicaoTransportadora {
  slug: string;
  nome: string;
  /** Formas reconhecidas do NOME da transportadora, já canonizadas. */
  apelidos: readonly string[];
  /** Prefixo a remover do início do SERVIÇO quando ele repete a transportadora. */
  prefixoNoServico: RegExp;
}

const TRANSPORTADORAS: readonly DefinicaoTransportadora[] = [
  {
    slug: "correios",
    nome: "Correios",
    apelidos: ["correios"],
    prefixoNoServico: /^correios\s+/i,
  },
  {
    slug: "jadlog",
    nome: "Jadlog",
    apelidos: ["jadlog"],
    prefixoNoServico: /^jad\s*log\s+/i,
  },
  {
    slug: "loggi",
    nome: "Loggi",
    apelidos: ["loggi"],
    prefixoNoServico: /^loggi\s+/i,
  },
  {
    slug: "jt-express",
    nome: "J&T Express",
    // "J&T Express", "JeT", "J&T", "JT", "J & T" — tudo vira "jt"/"jet"/"jtexpress".
    apelidos: ["jt", "jet", "jtexpress", "jetexpress"],
    // Espaços já vêm colapsados em `limparServico` (um espaço só), então
    // o espaço é literal e o "express" opcional vira alternância — sem
    // quantificador aninhado (security/detect-unsafe-regex).
    prefixoNoServico: /^(?:j ?&? ?t|jet)(?:express| express)? /i,
  },
  {
    slug: "total-express",
    nome: "Total Express",
    apelidos: ["totalexpress"],
    prefixoNoServico: /^total\s*express\s+/i,
  },
  {
    slug: "latam-cargo",
    nome: "LATAM Cargo",
    apelidos: ["latamcargo"],
    prefixoNoServico: /^latam\s*cargo\s+/i,
  },
  {
    slug: "azul-cargo",
    nome: "Azul Cargo Express",
    // "Azul Cargo" (forma curta) e "Azul Cargo Express" (forma completa)
    // são o MESMO slug — ver FONTES.md sobre o rebranding para "Azul
    // Logística" (02/05/2026): o edge ainda manda "Azul Cargo"/"Azul Cargo
    // Express", então o reconhecimento cobre as duas.
    apelidos: ["azulcargoexpress", "azulcargo"],
    prefixoNoServico: /^azul ?cargo(?:express| express)? /i,
  },
  {
    slug: "buslog",
    nome: "Buslog",
    apelidos: ["buslog"],
    prefixoNoServico: /^buslog\s+/i,
  },
];

function encontrarTransportadora(
  textoCanonico: string,
): DefinicaoTransportadora | undefined {
  return TRANSPORTADORAS.find((t) => t.apelidos.includes(textoCanonico));
}

/** Normaliza o nome bruto da transportadora — nunca `null`: a desconhecida vira `{slug: null, nome: <texto aparado>}`. */
function normalizarTransportadora(bruta: string): TransportadoraNormalizada {
  const def = encontrarTransportadora(canonizar(bruta));
  if (def) return { slug: def.slug, nome: def.nome };
  return { slug: null, nome: bruta };
}

/**
 * Limpa o serviço: tira ponto solto no início (".Package" → "Package",
 * exceto ".Com", nome de produto da Jadlog) e o
 * nome da transportadora quando ele se repete no início do serviço
 * ("Jadlog Package" → "Package", "JeT Standard" → "Standard"). Preserva
 * tudo o mais — "Package Centralizado" continua "Package Centralizado".
 */
function limparServico(
  def: DefinicaoTransportadora | undefined,
  servicoBruto: string,
): string | null {
  // Espaços colapsados ANTES dos prefixos (eles contam com no máximo um).
  let s = servicoBruto.replace(/\s+/g, " ").trim();
  if (!s) return null;
  // ".Com" é NOME de produto da Jadlog (o dono o escreve com o ponto):
  // sem o ponto, "Com" não diz nada. Os demais pontos soltos caem.
  if (!/^\.com$/i.test(s)) s = s.replace(/^\.+\s*/, "").trim();
  if (def) s = s.replace(def.prefixoNoServico, "").trim();
  return s || null;
}

interface DefinicaoAgregador {
  slug: string;
  nome: string;
  reconhece: RegExp;
}

const AGREGADORES: readonly DefinicaoAgregador[] = [
  { slug: "melhor-envio", nome: "Melhor Envio", reconhece: /melhor\s*envio/i },
  { slug: "frenet", nome: "Frenet", reconhece: /frenet/i },
  { slug: "superfrete", nome: "SuperFrete", reconhece: /super\s*frete/i },
];

/** Agregador (Melhor Envio/Frenet/SuperFrete), a partir do rótulo ou do `provider` bruto. Rótulo desconhecido nunca vira agregador inventado. */
function normalizarAgregador(
  provedorRotulo: string | undefined,
  provider: string | undefined,
): AgregadorNormalizado | null {
  const texto = (provedorRotulo ?? provider ?? "").trim();
  if (!texto) return null;
  const def = AGREGADORES.find((a) => a.reconhece.test(texto));
  return def ? { slug: def.slug, nome: def.nome } : null;
}

/**
 * Título/subtítulo para uma transportadora já normalizada. Correios
 * PAC/SEDEX são a única exceção que usa o rótulo genérico + subtítulo —
 * ver a nota de contrato no topo do arquivo.
 */
function montarTituloSubtitulo(
  transportadora: TransportadoraNormalizada,
  servicoLimpo: string | null,
): { titulo: string; subtitulo: string | null } {
  if (transportadora.slug === "correios" && servicoLimpo) {
    const s = servicoLimpo.toUpperCase();
    if (s === "PAC") {
      return { titulo: "Entrega econômica", subtitulo: "Correios · PAC" };
    }
    if (s === "SEDEX") {
      return { titulo: "Entrega expressa", subtitulo: "Correios · SEDEX" };
    }
  }
  const titulo = servicoLimpo
    ? `${transportadora.nome} ${servicoLimpo}`
    : transportadora.nome;
  return { titulo, subtitulo: null };
}

/**
 * Normaliza uma opção de frete (ou o recorte que o admin tem) para exibição:
 * transportadora canônica com slug de logo, serviço limpo, título/subtítulo
 * sem repetição e o agregador (se houver). Nunca muda `id`/`provider`/o
 * objeto original — é puramente de exibição.
 */
export function marcaDoFrete(entrada: EntradaMarcaDoFrete): MarcaDoFrete {
  const nomeOriginal =
    typeof entrada.name === "string" ? entrada.name.trim() : "";
  const transportadoraBruta =
    typeof entrada.transportadora === "string"
      ? entrada.transportadora.trim()
      : "";

  if (!transportadoraBruta) {
    return {
      transportadora: null,
      servico: null,
      titulo: nomeOriginal,
      subtitulo: null,
      agregador: null,
    };
  }

  const def = encontrarTransportadora(canonizar(transportadoraBruta));
  const transportadora = normalizarTransportadora(transportadoraBruta);
  const servicoBruto =
    typeof entrada.servico === "string" ? entrada.servico.trim() : "";
  const servico = servicoBruto ? limparServico(def, servicoBruto) : null;
  const { titulo, subtitulo } = montarTituloSubtitulo(transportadora, servico);
  const agregador = normalizarAgregador(
    typeof entrada.provedorRotulo === "string"
      ? entrada.provedorRotulo
      : undefined,
    typeof entrada.provider === "string" ? entrada.provider : undefined,
  );

  return { transportadora, servico, titulo, subtitulo, agregador };
}
