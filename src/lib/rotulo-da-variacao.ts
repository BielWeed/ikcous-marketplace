import { dividirEmAtributos } from "@/utils/variante-composta";

/**
 * O texto que a lojista lê para separar o pedido: "Tamanho M" ou, quando o
 * produto tem combinação, "Cor Azul · Tamanho M".
 *
 * O banco guarda a variação em duas colunas (`product_variants.name` e
 * `.value`). Combinação é UMA linha com os atributos juntos por " / "
 * ("Cor / Tamanho" + "Azul / M" — ver `utils/variante-composta.ts`), então o
 * desmonte reaproveita `dividirEmAtributos`, a mesma peça que o cadastro usa
 * para reabrir a linha. Sem nome ou sem valor devolve "" (nada a mostrar —
 * nunca texto inventado).
 */
export function rotuloDaVariacao(
  name: string | null | undefined,
  value: string | null | undefined,
): string {
  const nome = (name ?? "").trim();
  const valor = (value ?? "").trim();
  if (nome === "" || valor === "") return "";
  return dividirEmAtributos(nome, valor)
    .map((par) => `${par.name.trim()} ${par.value.trim()}`.trim())
    .join(" · ");
}
