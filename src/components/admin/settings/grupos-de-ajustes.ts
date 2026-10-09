import { NOMES_DO_PAINEL, type TelaDoPainel } from "@/config/nomes-do-painel";

// Os seis grupos da tela de Ajustes (painel simples, spec 2026-10-09 §3),
// declarados UMA vez. A tela (AdminSettingsView) desenha os grupos e a ajuda
// da mesma tela lista os mesmos grupos lendo ESTA constante: se um grupo
// entrar, sair ou mudar de nome, tela e ajuda mudam juntas (era o texto
// "três grupos" escrito à mão que apodrecia).
//
// As portas de dentro dos grupos são as de PORTAS_DO_PAINEL.ajustes, com o
// nome de NOMES_DO_PAINEL; o teste confere que nenhuma se perde nem repete.
// Os acordeões (Transportadoras, Formas de pagamento, Mercado Pago, Trocas e
// devoluções, Minha loja está no ar?, Consultas de frete) não são portas:
// continuam sendo montados pela tela dentro do grupo de cada um.

export type ChaveDoGrupoDeAjustes =
  | "minha-loja"
  | "aparencia"
  | "entrega"
  | "pagamentos"
  | "devolucao"
  | "ferramentas";

export interface PortaDoGrupoDeAjustes {
  readonly tela: TelaDoPainel;
  /** Linha curta sob o nome da porta, no cartão. */
  readonly descricao: string;
}

export interface GrupoDeAjustes {
  readonly chave: ChaveDoGrupoDeAjustes;
  readonly titulo: string;
  /** O que o grupo traz, em uma ou duas frases — texto da ajuda. */
  readonly ajuda: string;
  /** Cartões-porta que abrem outra tela do painel (vazio = só acordeões). */
  readonly portas: readonly PortaDoGrupoDeAjustes[];
}

export const GRUPOS_DE_AJUSTES: readonly GrupoDeAjustes[] = [
  {
    chave: "minha-loja",
    titulo: NOMES_DO_PAINEL["admin-about-store"],
    ajuda:
      "Nome, logo, cores, endereço, horário de atendimento e a descrição da loja — tudo editado numa única tela.",
    portas: [
      {
        tela: "admin-about-store",
        descricao: "Marca, endereço, horário e descrição",
      },
    ],
  },
  {
    chave: "aparencia",
    titulo: "Aparência do app",
    ajuda:
      "Os Banners (artes, links e agendamentos) e as Vitrines (títulos, ordem e ativação) que a cliente vê no app.",
    portas: [
      { tela: "admin-banners", descricao: "Artes, links e agendamentos" },
      { tela: "admin-carousels", descricao: "Títulos, ordem e ativação" },
    ],
  },
  {
    chave: "entrega",
    titulo: NOMES_DO_PAINEL["admin-shipping"],
    ajuda:
      "A tela de Entrega e frete (frete local, nacional e retirada) e, aqui mesmo, as Transportadoras: a escolha da transportadora e o token da integração — ajuste raro, feito uma vez.",
    portas: [
      {
        tela: "admin-shipping",
        descricao: "Frete local, nacional e retirada na loja",
      },
    ],
  },
  {
    chave: "pagamentos",
    titulo: "Pagamentos",
    ajuda:
      "O que a loja aceita na entrega e as chaves do Mercado Pago para receber pelo app, com teste de conexão.",
    portas: [],
  },
  {
    chave: "devolucao",
    titulo: "Regras de troca e devolução",
    ajuda:
      "Prazos, formas de devolver e o texto da política que a cliente lê antes de comprar.",
    portas: [],
  },
  {
    chave: "ferramentas",
    titulo: "Ferramentas",
    ajuda:
      "Minha loja está no ar? — o termômetro do pagamento por PIX com o diagnóstico completo e a medição de latência com o banco de dados — e as Consultas de frete, o histórico das cotações já feitas à transportadora ativa.",
    portas: [],
  },
];
