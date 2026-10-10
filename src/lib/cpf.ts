// VALIDAÇÃO DE CPF DO DESTINATÁRIO (checkout compacto + etiqueta nacional,
// 23/09/2026) — função pura, sem estado e sem I/O. O Melhor Envio exige
// `to.document` (CPF, para pessoa física) para inserir o frete no carrinho
// e emitir a etiqueta de envio nacional
// (docs.melhorenvio.com.br/reference/inserir-fretes-no-carrinho); o app só
// pede o campo quando a entrega escolhida é por TRANSPORTADORA — retirada
// na loja e entrega local não exigem nem gravam CPF nenhum.
//
// Pura e exportada pelo mesmo motivo de `decidirSaidaDoCheckout` (Checkout
// View.tsx) e `formatarCep` (useBuscaCep.ts): testável sem montar o
// formulário inteiro, e usada pela MESMA função tanto no campo quanto no
// submit — nunca só o `disabled` do botão.

/** Remove tudo que não é dígito. */
export function somenteDigitosDoCpf(valor: string): string {
  return (valor ?? "").replace(/\D/g, "");
}

/**
 * Formata progressivamente em `000.000.000-00`, do jeito que
 * `formatarCep` (useBuscaCep.ts) já faz para CEP — mesma forma de retorno
 * (`limpo`/`formatado`), para quem chama poder gravar os dígitos crus e
 * mostrar a máscara com a mesma resposta.
 */
export function formatarCpf(bruto: string): {
  limpo: string;
  formatado: string;
} {
  const limpo = somenteDigitosDoCpf(bruto).slice(0, 11);
  let formatado = limpo.slice(0, 3);
  if (limpo.length > 3) formatado += `.${limpo.slice(3, 6)}`;
  if (limpo.length > 6) formatado += `.${limpo.slice(6, 9)}`;
  if (limpo.length > 9) formatado += `-${limpo.slice(9, 11)}`;
  return { limpo, formatado };
}

/**
 * Máscara de EXIBIÇÃO para o resumo recolhido do checkout (pedido do dono,
 * 23/09/2026): só o miolo (dígitos 4 a 9) fica visível —
 * `***.456.789-**`. Nunca usada para gravar nem para validar; entrada que
 * não tem 11 dígitos volta como veio, sem mascarar pela metade.
 */
export function mascararCpfParaExibicao(valor: string): string {
  const digitos = somenteDigitosDoCpf(valor);
  if (digitos.length !== 11) return valor;
  return `***.${digitos.slice(3, 6)}.${digitos.slice(6, 9)}-**`;
}

function todosOsDigitosIguais(digitos: string): boolean {
  return digitos.split("").every((d) => d === digitos[0]);
}

/** Um dígito verificador do algoritmo oficial (Receita Federal). */
function calcularDigitoVerificador(base: string, pesoInicial: number): number {
  let soma = 0;
  let peso = pesoInicial;
  for (const caractere of base) {
    soma += Number(caractere) * peso;
    peso -= 1;
  }
  const resto = (soma * 10) % 11;
  return resto === 10 ? 0 : resto;
}

/**
 * Valida os 11 dígitos e os DOIS dígitos verificadores. Aceita com ou sem
 * máscara (a limpeza é o primeiro passo). Rejeita:
 *   - qualquer coisa que não tenha exatamente 11 dígitos;
 *   - sequência de dígito repetido (`00000000000`, `11111111111`, …) —
 *     passa na conta dos verificadores mas nunca é CPF real, e é o erro de
 *     digitação mais comum de detectar sem consultar a Receita.
 */
export function cpfValido(valorComOuSemMascara: string): boolean {
  const digitos = somenteDigitosDoCpf(valorComOuSemMascara);
  if (digitos.length !== 11) return false;
  if (todosOsDigitosIguais(digitos)) return false;

  const d1 = calcularDigitoVerificador(digitos.slice(0, 9), 10);
  if (d1 !== Number(digitos[9])) return false;

  const d2 = calcularDigitoVerificador(digitos.slice(0, 10), 11);
  if (d2 !== Number(digitos[10])) return false;

  return true;
}
