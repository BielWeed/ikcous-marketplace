// Central de Fornecedores, E1: as regras puras do cadastro de fornecedor.
//
// ESPELHA os CHECKs da migration 20261450000000_a_loja_guarda_os_fornecedores.sql:
// o formulário nunca aceita o que o banco recusaria (conta por caractere, como o
// `char_length` do Postgres, e não por unidade de UTF-16), e o atalho de um toque
// (WhatsApp, Instagram, site) só nasce de um valor que passa na MESMA regra do
// banco. Valor estranho já gravado (dado antigo, edição por fora) vira "sem
// atalho", nunca um link perigoso.

export const LIMITE_DO_NOME = 80;
export const LIMITE_DA_CIDADE = 80;
export const LIMITE_DAS_OBSERVACOES = 500;
export const LIMITE_DO_SITE = 200;
export const LIMITE_DO_INSTAGRAM = 30;

export const UFS = [
  "AC",
  "AL",
  "AP",
  "AM",
  "BA",
  "CE",
  "DF",
  "ES",
  "GO",
  "MA",
  "MT",
  "MS",
  "MG",
  "PA",
  "PB",
  "PR",
  "PE",
  "PI",
  "RJ",
  "RN",
  "RS",
  "RO",
  "RR",
  "SC",
  "SP",
  "SE",
  "TO",
] as const;

type Uf = (typeof UFS)[number];

/** O nome de cada estado: a lista de escolha do Estado mostra e busca por ele. */
export const NOME_DA_UF: Readonly<Record<Uf, string>> = {
  AC: "Acre",
  AL: "Alagoas",
  AP: "Amapá",
  AM: "Amazonas",
  BA: "Bahia",
  CE: "Ceará",
  DF: "Distrito Federal",
  ES: "Espírito Santo",
  GO: "Goiás",
  MA: "Maranhão",
  MT: "Mato Grosso",
  MS: "Mato Grosso do Sul",
  MG: "Minas Gerais",
  PA: "Pará",
  PB: "Paraíba",
  PR: "Paraná",
  PE: "Pernambuco",
  PI: "Piauí",
  RJ: "Rio de Janeiro",
  RN: "Rio Grande do Norte",
  RS: "Rio Grande do Sul",
  RO: "Rondônia",
  RR: "Roraima",
  SC: "Santa Catarina",
  SP: "São Paulo",
  SE: "Sergipe",
  TO: "Tocantins",
};

/** Uma linha da tabela `fornecedores`, já no formato que a tela usa. */
export interface Fornecedor {
  readonly id: string;
  readonly nome: string;
  readonly whatsapp: string | null;
  readonly instagram: string | null;
  readonly site: string | null;
  readonly cidade: string | null;
  readonly uf: string | null;
  readonly observacoes: string | null;
  readonly favorito: boolean;
}

/** O que a lojista digita (tudo texto, como nos campos). */
export interface FormularioDoFornecedor {
  nome: string;
  whatsapp: string;
  instagram: string;
  site: string;
  cidade: string;
  uf: string;
  observacoes: string;
  favorito: boolean;
}

/** O que vai para o banco: já normalizado, vazio = `null`. */
export type DadosDoFornecedor = Omit<Fornecedor, "id">;

export type CampoDoFornecedor =
  | "nome"
  | "whatsapp"
  | "instagram"
  | "site"
  | "cidade"
  | "uf"
  | "observacoes";

export type ErrosDoFornecedor = Partial<Record<CampoDoFornecedor, string>>;

export type ResultadoDoFornecedor =
  | { readonly ok: true; readonly dados: DadosDoFornecedor }
  | { readonly ok: false; readonly erros: ErrosDoFornecedor };

/** Tamanho em caracteres (pontos de código), como o `char_length` do Postgres. */
function tamanho(texto: string): number {
  return Array.from(texto).length;
}

const SO_NUMEROS_DO_BANCO = /^[0-9]{10,13}$/;
const USUARIO_DO_INSTAGRAM = /^[A-Za-z0-9._]{1,30}$/;
// Caminhos do Instagram que NÃO são perfil (post, reel, etc.).
const CAMINHOS_QUE_NAO_SAO_PERFIL = new Set([
  "p",
  "reel",
  "reels",
  "stories",
  "explore",
  "tv",
  "accounts",
  "direct",
  "about",
  "web",
]);

function interpretarUrl(texto: string): URL | null {
  try {
    return new URL(texto);
  } catch {
    return null;
  }
}

function validarWhatsapp(bruto: string): {
  valor: string | null;
  erro?: string;
} {
  const texto = bruto.trim();
  if (texto === "") return { valor: null };
  const FRASE =
    "Digite o WhatsApp com DDD, só números (de 10 a 13 números). Ex.: (11) 90000-0000";
  // Máscara comum passa; letra ou outro símbolo recusa em vez de sumir em silêncio.
  if (!/^[0-9\s()+.-]+$/.test(texto)) return { valor: null, erro: FRASE };
  const digitos = texto.replace(/\D/g, "");
  if (!SO_NUMEROS_DO_BANCO.test(digitos)) return { valor: null, erro: FRASE };
  return { valor: digitos };
}

function validarInstagram(bruto: string): {
  valor: string | null;
  erro?: string;
} {
  const texto = bruto.trim();
  if (texto === "") return { valor: null };
  const FRASE_PERFIL =
    "Digite só o @usuario ou cole o link do perfil (instagram.com/usuario).";
  let usuario = texto;
  const pareceLink =
    /^[a-z][a-z0-9+.-]*:\/\//i.test(texto) ||
    /instagram\.com\//i.test(texto) ||
    /^www\./i.test(texto);
  if (pareceLink) {
    const url = interpretarUrl(
      /^[a-z][a-z0-9+.-]*:\/\//i.test(texto) ? texto : `https://${texto}`,
    );
    if (!url || (url.protocol !== "https:" && url.protocol !== "http:")) {
      return { valor: null, erro: FRASE_PERFIL };
    }
    const host = url.hostname.toLowerCase();
    if (host !== "instagram.com" && host !== "www.instagram.com") {
      return { valor: null, erro: FRASE_PERFIL };
    }
    const primeiro = url.pathname.split("/").filter(Boolean)[0] ?? "";
    if (
      primeiro === "" ||
      CAMINHOS_QUE_NAO_SAO_PERFIL.has(primeiro.toLowerCase())
    ) {
      return {
        valor: null,
        erro: "Esse link não é de um perfil. Cole o link do perfil ou só o @usuario.",
      };
    }
    usuario = primeiro;
  }
  usuario = usuario.replace(/^@/, "");
  if (!USUARIO_DO_INSTAGRAM.test(usuario)) {
    return {
      valor: null,
      erro: "O usuário do Instagram tem só letras, números, ponto e sublinhado (até 30).",
    };
  }
  return { valor: usuario };
}

function validarSite(bruto: string): { valor: string | null; erro?: string } {
  const texto = bruto.trim();
  if (texto === "") return { valor: null };
  const FRASE =
    "Digite o endereço do site, como www.exemplo.com.br (começando por https://).";
  if (/\s/.test(texto)) return { valor: null, erro: FRASE };
  let comEsquema: string;
  if (/^https?:\/\//i.test(texto)) {
    // http:// sobe para https:// (o app só abre site seguro).
    comEsquema = texto.replace(/^http:\/\//i, "https://");
  } else if (
    /^[a-z][a-z0-9+.-]*:/i.test(texto) &&
    !/^[^/:]+\.[^/:]+:\d+(\/|$)/.test(texto)
  ) {
    // "javascript:x", "ftp://x", "mailto:x"...: esquema que não é de site. Nunca ganha https:// na frente.
    return { valor: null, erro: FRASE };
  } else {
    comEsquema = `https://${texto}`;
  }
  const url = interpretarUrl(comEsquema);
  if (
    !url ||
    url.protocol !== "https:" ||
    url.username !== "" ||
    url.password !== "" ||
    !url.hostname.includes(".")
  ) {
    return { valor: null, erro: FRASE };
  }
  let href = url.href;
  if (url.pathname === "/" && url.search === "" && url.hash === "") {
    href = href.replace(/\/$/, "");
  }
  if (tamanho(href) > LIMITE_DO_SITE) {
    return {
      valor: null,
      erro: `O endereço do site é longo demais (até ${LIMITE_DO_SITE} caracteres).`,
    };
  }
  return { valor: href };
}

/** Valida e normaliza o formulário. Com qualquer erro, NÃO devolve dados. */
export function validarFornecedor(
  form: FormularioDoFornecedor,
): ResultadoDoFornecedor {
  const erros: ErrosDoFornecedor = {};

  const nome = form.nome.trim().replace(/\s+/g, " ");
  if (nome === "") erros.nome = "Digite o nome do fornecedor.";
  else if (tamanho(nome) > LIMITE_DO_NOME) {
    erros.nome = `O nome pode ter no máximo ${LIMITE_DO_NOME} caracteres.`;
  }

  const whatsapp = validarWhatsapp(form.whatsapp);
  if (whatsapp.erro) erros.whatsapp = whatsapp.erro;
  const instagram = validarInstagram(form.instagram);
  if (instagram.erro) erros.instagram = instagram.erro;
  const site = validarSite(form.site);
  if (site.erro) erros.site = site.erro;

  const cidadeTexto = form.cidade.trim().replace(/\s+/g, " ");
  if (tamanho(cidadeTexto) > LIMITE_DA_CIDADE) {
    erros.cidade = `A cidade pode ter no máximo ${LIMITE_DA_CIDADE} caracteres.`;
  }

  const ufTexto = form.uf.trim();
  if (ufTexto !== "" && !(UFS as readonly string[]).includes(ufTexto)) {
    erros.uf = "Escolha um estado da lista.";
  }

  const observacoes = form.observacoes.replace(/\r\n/g, "\n").trim();
  if (tamanho(observacoes) > LIMITE_DAS_OBSERVACOES) {
    erros.observacoes = `As observações podem ter no máximo ${LIMITE_DAS_OBSERVACOES} caracteres.`;
  }

  if (Object.keys(erros).length > 0) return { ok: false, erros };
  return {
    ok: true,
    dados: {
      nome,
      whatsapp: whatsapp.valor,
      instagram: instagram.valor,
      site: site.valor,
      cidade: cidadeTexto === "" ? null : cidadeTexto,
      uf: ufTexto === "" ? null : ufTexto,
      observacoes: observacoes === "" ? null : observacoes,
      favorito: form.favorito,
    },
  };
}

/**
 * `https://wa.me/55...` — sem país (até 11 números) ganha 55; com país fica como está.
 * Zeros à esquerda (o zero antigo de operadora/DDD, "(011) 90000-0000") saem só do LINK;
 * o número salvo no banco não muda. Só números do Brasil ou já com 55 são suportados.
 */
export function linkDoWhatsapp(
  valor: string | null | undefined,
): string | null {
  if (typeof valor !== "string" || !SO_NUMEROS_DO_BANCO.test(valor))
    return null;
  const nacional = valor.replace(/^0+/, "");
  // Telefone do Brasil com DDD tem no mínimo 10 números; menos que isso, depois de tirar os zeros, não é número.
  if (nacional.length < 10) return null;
  return `https://wa.me/${nacional.length <= 11 ? `55${nacional}` : nacional}`;
}

/** `https://instagram.com/usuario` — só de usuário que passa na regra do banco. */
export function linkDoInstagram(
  valor: string | null | undefined,
): string | null {
  if (typeof valor !== "string" || !USUARIO_DO_INSTAGRAM.test(valor))
    return null;
  return `https://instagram.com/${valor}`;
}

/** O site, só se for https de verdade (o banco também recusa o resto). */
export function linkDoSite(valor: string | null | undefined): string | null {
  if (typeof valor !== "string" || !/^https:\/\/\S+$/.test(valor)) return null;
  const url = interpretarUrl(valor);
  if (
    !url ||
    url.protocol !== "https:" ||
    url.username !== "" ||
    url.password !== ""
  ) {
    return null;
  }
  return url.href;
}

/** Favoritos primeiro; dentro de cada grupo, por nome (pt-BR, sem ligar para acento/caixa). */
export function ordenarFornecedores<
  T extends Pick<Fornecedor, "nome" | "favorito">,
>(lista: readonly T[]): T[] {
  return [...lista].sort((a, b) => {
    if (a.favorito !== b.favorito) return a.favorito ? -1 : 1;
    return a.nome.localeCompare(b.nome, "pt-BR", { sensitivity: "base" });
  });
}

/** Minúscula e sem acento, para a busca por nome achar "bras" em "Brás". */
export function semAcento(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

/** Filtra pela busca no nome (sem acento/caixa) e, se pedido, só os favoritos. Mantém a ordem. */
export function filtrarFornecedores<
  T extends Pick<Fornecedor, "nome" | "favorito">,
>(lista: readonly T[], busca: string, soFavoritos: boolean): T[] {
  const termo = semAcento(busca.trim().replace(/\s+/g, " "));
  return lista.filter(
    (f) =>
      (!soFavoritos || f.favorito) &&
      (termo === "" || semAcento(f.nome).includes(termo)),
  );
}
