import { linkDeRastreioDeCodigoValido } from "@/lib/link-de-rastreio";

export function avisoDeRastreio(codigo?: string | null): string {
  const salvo = codigo?.trim() ?? "";
  if (!salvo) {
    return "Sem código salvo, a cliente vê “A caminho”, mas não consegue rastrear. Se já tem o código, salve antes de avançar.";
  }
  if (linkDeRastreioDeCodigoValido(salvo)) return "";

  const caracteres = Array.from(salvo);
  const trecho =
    caracteres.length > 30 ? `${caracteres.slice(0, 29).join("")}…` : salvo;
  return `O código de rastreio salvo (“${trecho}”) não é válido: a cliente não consegue rastrear. Corrija o código antes de avançar.`;
}
