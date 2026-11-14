import { normalizeText } from "@/lib/utils";

/** Nome sem acento, sem caixa e com um espaço só entre as palavras: a régua para dizer "é a mesma pessoa". */
const chaveDoNome = (nome: string | null | undefined): string =>
  normalizeText(nome).replace(/\s+/g, " ");

/**
 * O nome de quem vai receber o pedido, SE for outra pessoa; "" quando não há nome ou quando é a própria cliente.
 *
 * A cliente digita "Quem vai receber" no endereço (em presente, na portaria, com outra pessoa em casa) e o pedido
 * guarda esse nome (`customer_data.address.recipient_name`, migration 20261399997000). Na ficha da lojista só vale
 * mostrar "Recebe: X" quando ele diz algo que o nome de quem comprou ainda não disse: o endereço sempre traz o nome
 * da própria cliente por padrão, e repetir o mesmo nome em toda ficha seria ruído. A comparação ignora acento, caixa
 * e espaço sobrando ("José  ANTONIO" e "jose antonio" são a mesma pessoa); "Souza" e "Sousa" não são.
 */
export function quemVaiReceberSeForOutro(
  comprador: string | null | undefined,
  recebe: string | null | undefined,
): string {
  const nome = (recebe ?? "").replace(/\s+/g, " ").trim();
  if (!nome) return "";
  return chaveDoNome(nome) === chaveDoNome(comprador) ? "" : nome;
}
