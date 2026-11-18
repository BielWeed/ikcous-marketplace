const UFS = new Set(
  "AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO".split(
    " ",
  ),
);

// Limpa o que a pessoa digitou ou COLOU no campo de UF: tira os espaços, põe em
// maiúsculas e só então corta em 2 letras. O corte tem que vir depois da
// limpeza: com `maxLength={2}` no <input>, o navegador cortava " SP " em " S"
// antes de qualquer limpeza e a UF copiada certa virava "Estado inválido".
export function normalizarUf(valor: string): string {
  return valor.replace(/\s+/g, "").toUpperCase().slice(0, 2);
}

export function ufBrasileiraValida(uf: string | undefined): boolean {
  return UFS.has(uf?.trim().toUpperCase() ?? "");
}
