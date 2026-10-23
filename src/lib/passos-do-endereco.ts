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
  /** O "N" do "N de 3": primeiro segmento vazio (1 a 3; tudo cheio fica em 3). */
  atual: 1 | 2 | 3;
}

const tem = (texto: string) => texto.trim().length > 0;

export function passosDoEndereco(entrada: EntradaDosPassos): PassosDoEndereco {
  const segmentos: PassosDoEndereco["segmentos"] = [
    // Mesma régua do schema do formulário: o que vale é a contagem de DÍGITOS.
    { id: "cep", cheio: entrada.cep.replace(/\D/g, "").length === 8 },
    {
      id: "endereco",
      cheio:
        tem(entrada.rua) &&
        tem(entrada.bairro) &&
        tem(entrada.cidade) &&
        tem(entrada.uf),
    },
    { id: "entrega", cheio: tem(entrada.numero) && tem(entrada.recebedor) },
  ];
  const primeiroVazio = segmentos.findIndex((s) => !s.cheio);
  const atual = (primeiroVazio === -1 ? 3 : primeiroVazio + 1) as 1 | 2 | 3;
  return { segmentos, atual };
}
