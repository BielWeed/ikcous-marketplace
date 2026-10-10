import type { Address } from "@/types";

// O ENDEREÇO QUE VAI RECEBER: o escolhido (id compartilhado no CartContext)
// ou, na falta dele, o principal — e, sem principal marcado, o primeiro da
// lista. Carrinho e checkout derivam o destino do frete por ESTA função: se
// cada tela tivesse a própria regra, a cotação do carrinho apontaria para um
// endereço e o pedido para outro.
export function enderecoDeEntregaEfetivo(
  addresses: readonly Address[],
  selecionadoId: string | null | undefined,
): Address | undefined {
  const escolhido = selecionadoId
    ? addresses.find((a) => a.id === selecionadoId)
    : undefined;
  return escolhido ?? addresses.find((a) => a.is_default) ?? addresses[0];
}

export function formatarCep(cep: string | null | undefined): string {
  const limpo = (cep ?? "").replace(/\D/g, "");
  if (limpo.length !== 8) return cep ?? "";
  return `${limpo.slice(0, 5)}-${limpo.slice(5, 8)}`;
}

// Uma linha para a pessoa reconhecer ONDE vai chegar: rua e número, bairro,
// cidade/UF e CEP. Destinatário, complemento e referência ficam de fora — o
// resumo aparece no carrinho, à vista de quem estiver do lado.
export function resumoDoEndereco(
  endereco: Pick<
    Address,
    "street" | "number" | "neighborhood" | "city" | "state" | "cep"
  >,
): string {
  const rua = [endereco.street?.trim(), endereco.number?.trim()]
    .filter(Boolean)
    .join(", ");
  const cidade = [endereco.city?.trim(), endereco.state?.trim()]
    .filter(Boolean)
    .join("/");
  const partes = [rua, endereco.neighborhood?.trim(), cidade].filter(Boolean);
  const cep = formatarCep(endereco.cep);
  return [partes.join(" — "), cep ? `CEP ${cep}` : ""]
    .filter(Boolean)
    .join(" · ");
}
