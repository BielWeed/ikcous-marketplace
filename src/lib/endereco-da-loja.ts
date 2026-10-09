/**
 * O endereço da loja, como função PURA (painel simples, §4). "Minha loja" é a
 * fonte única: a tela guarda as PARTES (CEP, rua, número…) e grava as quatro
 * colunas que já existem em `store_config` — `origin_cep`, `store_address`,
 * `store_city`, `store_state` —, sem migration (premissa P1 = A).
 *
 * `storeAddress` é um texto montado, no formato
 *   "Rua, nº[, compl.] — Bairro, Cidade/UF — CEP 00000-000"
 * e `lerEnderecoDaLoja` é o INVERSO EXATO de `montarEnderecoDaLoja`. Texto
 * livre de antes (o campo único escrito à mão) não segue o formato e NÃO se
 * lê: devolve `null`, e a tela pede "Confirme pelo CEP" em vez de adivinhar.
 *
 * Sem React, sem Supabase, sem `import.meta.env`.
 */

export interface PartesDoEndereco {
  /** Com ou sem hífen; só os dígitos contam. */
  readonly cep: string;
  readonly rua: string;
  readonly numero: string;
  readonly complemento: string;
  /** Pode ficar vazio: CEP único de cidade pequena não tem bairro. */
  readonly bairro: string;
  readonly cidade: string;
  readonly uf: string;
}

/** As quatro colunas que o endereço grava. */
export interface EnderecoGravado {
  readonly originCep: string;
  readonly storeAddress: string;
  readonly storeCity: string;
  readonly storeState: string;
}

/** "38500000" → "38500-000" (o mesmo formato que o Frete gravava). Parcial
 * fica parcial: "385" → "385". */
export function formatarCepDaLoja(bruto: string | null | undefined): string {
  const digitos = (bruto ?? "").replace(/\D/g, "").slice(0, 8);
  return digitos.length > 5
    ? `${digitos.slice(0, 5)}-${digitos.slice(5)}`
    : digitos;
}

function digitosDoCep(bruto: string | null | undefined): string {
  return (bruto ?? "").replace(/\D/g, "");
}

function espacosEmUm(texto: string): string {
  return texto.replace(/\s+/g, " ").trim();
}

// A vírgula e o travessão são os SEPARADORES do formato: dentro de uma parte
// viram espaço e hífen, para o texto gravado continuar legível pelo inverso.
function parte(texto: string): string {
  return espacosEmUm(texto.replace(/,/g, " ").replace(/\s*—\s*/g, " - "));
}

// O complemento pode ter vírgula ("Sala 12, 3º andar"): é o último pedaço
// antes do travessão e o formato o lê inteiro. Só o travessão não passa.
function complementoLimpo(texto: string): string {
  return espacosEmUm(texto.replace(/\s*—\s*/g, " - "));
}

/** Monta o texto e as quatro colunas. Não valida: use
 * `motivoDoEnderecoIncompleto` antes de gravar. */
export function montarEnderecoDaLoja(
  partes: PartesDoEndereco,
): EnderecoGravado {
  const cep = formatarCepDaLoja(partes.cep);
  const rua = parte(partes.rua);
  const numero = parte(partes.numero);
  const complemento = complementoLimpo(partes.complemento);
  const bairro = parte(partes.bairro);
  const cidade = parte(partes.cidade);
  const uf = parte(partes.uf).toUpperCase();

  const lugar = [rua, numero, ...(complemento ? [complemento] : [])].join(", ");
  const regiao = [...(bairro ? [bairro] : []), `${cidade}/${uf}`].join(", ");

  return {
    originCep: cep,
    storeAddress: `${lugar} — ${regiao} — CEP ${cep}`,
    storeCity: cidade,
    storeState: uf,
  };
}

const SEPARADOR_DE_BLOCO = " — ";
const SEPARADOR_DE_PARTE = ", ";
const BLOCO_DO_CEP = /^CEP (\d{5}-\d{3})$/;

// Sem regex única de propósito: o formato tem partes opcionais e um
// complemento que aceita vírgula, e uma regex só para tudo é o desenho que o
// `security/detect-unsafe-regex` (com razão) barra. Cada parte é lida por si.
//
// rua, número[, complemento] — [bairro, ]cidade/UF — CEP 00000-000
/** Inverso exato de `montarEnderecoDaLoja`. Texto fora do formato → `null`. */
export function lerEnderecoDaLoja(
  texto: string | null | undefined,
): PartesDoEndereco | null {
  const blocos = (texto ?? "").trim().split(SEPARADOR_DE_BLOCO);
  if (blocos.length !== 3) return null;
  const [lugar, regiao, blocoDoCep] = blocos;

  const cep = BLOCO_DO_CEP.exec(blocoDoCep)?.[1];
  if (!cep) return null;

  // "Rua, nº[, compl.]": rua e número não têm vírgula; o complemento pode.
  const [rua, numero, ...resto] = lugar.split(SEPARADOR_DE_PARTE);
  if (!rua?.trim() || !numero?.trim()) return null;
  const complemento = resto.join(SEPARADOR_DE_PARTE);
  if (resto.length > 0 && !complemento.trim()) return null;

  // "[Bairro, ]Cidade/UF": a UF é o que vem depois da última barra.
  const barra = regiao.lastIndexOf("/");
  if (barra < 0) return null;
  const uf = regiao.slice(barra + 1);
  if (!/^[A-Za-z]{2}$/.test(uf)) return null;
  const [primeiro, segundo, ...sobra] = regiao
    .slice(0, barra)
    .split(SEPARADOR_DE_PARTE);
  if (sobra.length > 0) return null;
  const bairro = segundo === undefined ? "" : primeiro;
  const cidade = segundo === undefined ? primeiro : segundo;
  if (!cidade?.trim() || (segundo !== undefined && !bairro.trim())) return null;

  return { cep, rua, numero, complemento, bairro, cidade, uf };
}

/**
 * Lê o endereço E confere o CEP: o texto só vale se o CEP dele for o CEP da
 * loja (`originCep`). Se o Frete antigo gravou outro CEP depois, o texto está
 * velho — trata como ilegível e a tela pede "Confirme pelo CEP".
 */
export function lerEnderecoConferido(
  storeAddress: string | null | undefined,
  originCep: string | null | undefined,
): PartesDoEndereco | null {
  const lido = lerEnderecoDaLoja(storeAddress);
  if (!lido) return null;
  const cepDaLoja = digitosDoCep(originCep);
  if (cepDaLoja.length !== 8 || cepDaLoja !== digitosDoCep(lido.cep)) {
    return null;
  }
  return lido;
}

/** Por que ainda não dá para gravar (o texto que a lojista lê), ou `null`. */
export function motivoDoEnderecoIncompleto(
  partes: PartesDoEndereco,
): string | null {
  if (digitosDoCep(partes.cep).length !== 8) {
    return "Digite o CEP completo (8 números) para preencher o endereço.";
  }
  if (!parte(partes.rua)) return "Falta a rua.";
  if (!parte(partes.numero)) return "Falta o número do endereço.";
  if (!parte(partes.cidade)) return "Falta a cidade.";
  if (!/^[A-Za-z]{2}$/.test(parte(partes.uf))) {
    return "Falta a UF (2 letras).";
  }
  return null;
}

// Sem acento, sem maiúscula, espaços em um: "SÃO  Paulo" = "sao paulo".
function comparavel(texto: string | null | undefined): string {
  return espacosEmUm(texto ?? "")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase();
}

function cidadeBarraUf(
  cidade: string | null | undefined,
  uf: string | null | undefined,
): string {
  const c = espacosEmUm(cidade ?? "");
  const u = espacosEmUm(uf ?? "").toUpperCase();
  return u ? `${c}/${u}` : c;
}

/**
 * Aviso quando a cidade do CEP não é a cadastrada na loja, ou `null`. Ignora
 * acento e maiúscula. Sem cidade de um dos lados não há o que comparar; a UF
 * só entra na conta quando os dois lados a têm.
 */
export function divergenciaDoEndereco(
  cidadeDoCep: string | null | undefined,
  ufDoCep: string | null | undefined,
  cidadeCadastrada: string | null | undefined,
  ufCadastrada: string | null | undefined,
): string | null {
  if (!comparavel(cidadeDoCep) || !comparavel(cidadeCadastrada)) return null;
  const mesmaCidade = comparavel(cidadeDoCep) === comparavel(cidadeCadastrada);
  const ufsConhecidas = comparavel(ufDoCep) && comparavel(ufCadastrada);
  const mesmaUf =
    !ufsConhecidas || comparavel(ufDoCep) === comparavel(ufCadastrada);
  if (mesmaCidade && mesmaUf) return null;
  return `Seu CEP é de ${cidadeBarraUf(cidadeDoCep, ufDoCep)}, mas a cidade cadastrada da loja é ${cidadeBarraUf(cidadeCadastrada, ufCadastrada)}. Confira qual das duas está certa.`;
}
