import type { Order } from "@/types";

/**
 * O endereço do pedido em linhas, com as MESMAS da ficha na tela
 * (OrderDetail.tsx, bloco "Endereço de entrega"): rua, número e complemento;
 * depois bairro, cidade/UF, CEP e referência. O motoboy lê o papel, não a
 * tela — sem o "bloco B, apto 302" e a referência ele toca a campainha errada.
 *
 * Serve ao recibo impresso e ao detalhe do pedido da cliente ("Meus pedidos").
 *
 * Campo vazio não deixa rastro: sem linha em branco, sem vírgula solta, sem
 * rótulo ("CEP:", "Ref:") sem valor.
 */
export function linhasDoEndereco(cliente: Order["customer"]): string[] {
  const texto = (valor: string | null | undefined) => (valor ?? "").trim();
  const ruaENumero = [texto(cliente.address), texto(cliente.number)]
    .filter(Boolean)
    .join(", ");
  const cidade = texto(cliente.city);
  const estado = texto(cliente.state);
  const cep = texto(cliente.cep);
  const referencia = texto(cliente.reference);
  const primeira = [ruaENumero, texto(cliente.complement)]
    .filter(Boolean)
    .join(" - ");
  const segunda = [
    texto(cliente.neighborhood),
    cidade && (estado ? `${cidade}/${estado}` : cidade),
    cep && `CEP: ${cep}`,
    referencia && `Ref: ${referencia}`,
  ]
    .filter(Boolean)
    .join(" • ");
  return [primeira, segunda].filter(Boolean);
}
