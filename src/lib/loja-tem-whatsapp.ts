// Laudo caça-bugs 31/08 (C1/C2): a decisão de 30/08 ("WhatsApp é opcional —
// sem número, o botão some") vivia colada no ProductView, e as telas de
// pós-venda (OrderDetailsView, ProfileView) e a promessa do sucesso
// (OrderSuccessView) cada uma com sua cópia — foi assim que a régua não
// chegou nelas e `wa.me/` sem destinatário voltou a aparecer. Regra em um
// lugar só (lição #53).
//
// A régua: o número precisa ter PELO MENOS 10 DÍGITOS (DDD + telefone).
// Formatação não importa — "(34) 99999-9999" e "34999999999" valem igual;
// quem monta o link `wa.me/` adiciona o prefixo 55 quando cabe.
export function lojaTemWhatsapp(numero: string | null | undefined): boolean {
  return (numero || "").replace(/\D/g, "").length >= 10;
}
