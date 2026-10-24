// Barra de 3 passos da tela de endereço (redesenho "Tinta", 23/10/2026).
// Só apresentação: lê os valores que o formulário já tem e diz quais
// segmentos estão cheios. Não valida nada e não decide nada — quem valida
// continua sendo o zod do AddressForm.

export interface EntradaDosPassos {
  cep: string;
  rua: string;
  bairro: string;
  cidade: string;
  uf: string;
  numero: string;
  recebedor: string;
}

export interface SegmentoDoPasso {
  id: "cep" | "endereco" | "entrega";
  cheio: boolean;
}

export interface PassosDoEndereco {
  segmentos: [SegmentoDoPasso, SegmentoDoPasso, SegmentoDoPasso];
  /**
   * O "N" do "N de 3": quantos segmentos estão cheios EM SEQUÊNCIA a partir do
   * 1º (mínimo 1). Nunca "3 de 3" com o 3º vazio, e nunca barra com buraco.
   */
  atual: 1 | 2 | 3;
}

const tem = (texto: string) => texto.trim().length > 0;

export function passosDoEndereco(entrada: EntradaDosPassos): PassosDoEndereco {
  // Cada segmento só enche se o anterior encheu: sem CEP de 8 dígitos não há
  // barra cheia, mesmo que rua e número ainda estejam no formulário.
  const cep = entrada.cep.replace(/\D/g, "").length === 8;
  const endereco =
    cep &&
    tem(entrada.rua) &&
    tem(entrada.bairro) &&
    tem(entrada.cidade) &&
    tem(entrada.uf);
  const entrega = endereco && tem(entrada.numero) && tem(entrada.recebedor);
  const segmentos: PassosDoEndereco["segmentos"] = [
    // Mesma régua do schema do formulário: o que vale é a contagem de DÍGITOS.
    { id: "cep", cheio: cep },
    { id: "endereco", cheio: endereco },
    { id: "entrega", cheio: entrega },
  ];
  const cheios = segmentos.filter((s) => s.cheio).length;
  const atual = Math.max(1, cheios) as 1 | 2 | 3;
  return { segmentos, atual };
}
