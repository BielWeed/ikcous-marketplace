// ============================================================================
// CPF do destinatário — o Melhor Envio exige `to.document` para inserir o
// frete no carrinho (doc oficial: "Documentos from/to",
// docs.melhorenvio.com.br/reference/inserir-fretes-no-carrinho). Este módulo
// cobre a PARTE DA TELA: validar antes de mandar pro servidor, limpar
// máscara e nunca reexibir o CPF inteiro depois de salvo.
//
// MESMA fonte de verdade que a edge `melhor-envio-etiqueta`
// (supabase/functions/melhor-envio-etiqueta/cpf.ts): algoritmo de validação
// é cópia DELIBERADA (o mesmo padrão de `elegibilidade-da-etiqueta.ts` com a
// regex do id do Melhor Envio) — o servidor é quem recusa de verdade; esta
// tela só evita o clique que ia ouvir "não".
// ============================================================================

/** Remove tudo que não é dígito. `""` para valor vazio/ausente. */
export function somenteDigitos(valor: unknown): string {
  return typeof valor === "string" || typeof valor === "number"
    ? String(valor).replace(/\D/g, "")
    : "";
}

/**
 * Valida CPF: 11 dígitos, recusa sequência de dígitos repetidos
 * (000.000.000-00, 111.111.111-11, ...) e confere os dois dígitos
 * verificadores pelo algoritmo oficial (módulo 11).
 */
export function cpfValido(valor: unknown): boolean {
  const digitos = somenteDigitos(valor);
  if (digitos.length !== 11) return false;
  if (/^(\d)\1{10}$/.test(digitos)) return false;

  const digitoVerificador = (base: string): number => {
    let soma = 0;
    let peso = base.length + 1;
    for (const caractere of base) {
      soma += Number(caractere) * peso;
      peso--;
    }
    const resto = (soma * 10) % 11;
    return resto === 10 ? 0 : resto;
  };

  const primeirosNove = digitos.slice(0, 9);
  const d1 = digitoVerificador(primeirosNove);
  const d2 = digitoVerificador(primeirosNove + String(d1));

  return digitos[9] === String(d1) && digitos[10] === String(d2);
}

/**
 * Máscara de exibição: só os 4 últimos dígitos aparecem
 * (`***.***.*89-01`) — a tela NUNCA reexibe o CPF inteiro depois de salvo.
 * CPF com formato inesperado (não 11 dígitos) devolve a máscara toda
 * oculta, em vez de vazar um resto de número fora do padrão.
 */
export function mascararCpf(valor: unknown): string {
  const digitos = somenteDigitos(valor);
  if (digitos.length !== 11) return "***.***.***-**";
  const mascarados = digitos.slice(0, 7).replace(/\d/g, "*") + digitos.slice(7);
  return `${mascarados.slice(0, 3)}.${mascarados.slice(3, 6)}.${mascarados.slice(6, 9)}-${mascarados.slice(9, 11)}`;
}

/**
 * Máscara de DIGITAÇÃO (formata enquanto a lojista digita no campo — não
 * confundir com `mascararCpf`, que ESCONDE o CPF depois de salvo). Corta em
 * 11 dígitos; formato completo só aparece quando os 11 chegam.
 */
export function formatarCpfEnquantoDigita(valor: unknown): string {
  const digitos = somenteDigitos(valor).slice(0, 11);
  const partes = [
    digitos.slice(0, 3),
    digitos.slice(3, 6),
    digitos.slice(6, 9),
    digitos.slice(9, 11),
  ].filter(Boolean);
  if (partes.length <= 1) return partes[0] ?? "";
  if (partes.length === 2) return `${partes[0]}.${partes[1]}`;
  if (partes.length === 3) return `${partes[0]}.${partes[1]}.${partes[2]}`;
  return `${partes[0]}.${partes[1]}.${partes[2]}-${partes[3]}`;
}
