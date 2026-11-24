import { textoSemControlesDeDirecao } from "@/lib/texto-sem-controles-de-direcao";

const UFS = new Set(
  "AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO".split(
    " ",
  ),
);

const SIGLAS_POR_NOME = new Map([
  ["acre", "AC"],
  ["alagoas", "AL"],
  ["amapa", "AP"],
  ["amazonas", "AM"],
  ["bahia", "BA"],
  ["ceara", "CE"],
  ["distrito federal", "DF"],
  ["espirito santo", "ES"],
  ["goias", "GO"],
  ["maranhao", "MA"],
  ["mato grosso", "MT"],
  ["mato grosso do sul", "MS"],
  ["minas gerais", "MG"],
  ["para", "PA"],
  ["paraiba", "PB"],
  ["parana", "PR"],
  ["pernambuco", "PE"],
  ["piaui", "PI"],
  ["rio de janeiro", "RJ"],
  ["rio grande do norte", "RN"],
  ["rio grande do sul", "RS"],
  ["rondonia", "RO"],
  ["roraima", "RR"],
  ["santa catarina", "SC"],
  ["sao paulo", "SP"],
  ["sergipe", "SE"],
  ["tocantins", "TO"],
]);

export function normalizarUf(entrada: string): string {
  const valor = textoSemControlesDeDirecao(entrada);
  const semEspacos = valor.replace(/\s+/g, "");
  if (/^[a-z]{0,2}$/i.test(semEspacos)) return semEspacos.toUpperCase();

  const nome = valor
    .trim()
    .replace(/\s+/g, " ")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase();
  // Um nome desconhecido precisa continuar visível e inválido, não virar
  // outra UF por acidente (por exemplo, "Mato Grosso do Xul" → "MA").
  return SIGLAS_POR_NOME.get(nome) ?? valor;
}

// Considera a seleção, para não substituir texto que não faz parte da colagem.
export function siglaDaUfColada(campo: HTMLInputElement, texto: string) {
  const inicio = campo.selectionStart ?? campo.value.length;
  const fim = campo.selectionEnd ?? inicio;
  const uf = normalizarUf(
    campo.value.slice(0, inicio) + texto + campo.value.slice(fim),
  );
  return ufBrasileiraValida(uf) ? uf : undefined;
}

export function ufBrasileiraValida(uf: string | undefined): boolean {
  return UFS.has(uf?.trim().toUpperCase() ?? "");
}
