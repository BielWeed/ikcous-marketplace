// Provedores de consulta de CEP, na ordem em que `useBuscaCep` os tenta.
//
// POR QUE HÁ MAIS DE UM (medido em 03/10/2026, 672 CEPs reais de 48 faixas do
// país, os 4 provedores lado a lado): o ViaCEP sozinho NÃO ACHAVA 13% dos CEPs
// que existem — 382 de 439 — e respondia `{"erro":"true"}` com a mesma cara de
// um CEP digitado errado. É o buraco que a cliente via como "o CEP não pega
// para todo lugar". O OpenCEP recuperou 14 dos 57 perdidos; o AwesomeAPI
// recuperou os 57, sem nenhum falso "não achei" em relação ao ViaCEP, e nos 382
// CEPs que os dois acham, UF e cidade coincidiram em todos.
//
// A ORDEM importa por duas razões:
// 1. Privacidade: o CEP só sai para o provedor seguinte quando o anterior não
//    respondeu com um endereço — ViaCEP (já era o único) vê tudo; os outros
//    só veem o resto.
// 2. Qualidade do dado: ViaCEP e OpenCEP vêm dos Correios, com acento. O
//    AwesomeAPI cobre mais, mas o endereço dele às vezes vem sem acento, às
//    vezes com o número da casa colado na rua ("Avenida Paulista, 52") e o
//    bairro pode diferir — por isso é o último recurso, e a rua é limpa.
//
// BrasilAPI v2 foi medida e NÃO entra: em 396 de 396 acertos o campo `service`
// foi "open-cep", ou seja, ela repassa o OpenCEP (mesma cobertura, 14 dos 57),
// com latência de ~2,2 s contra ~0,1 s do OpenCEP direto, e custaria mais uma
// origem na CSP sem trazer CEP novo.
import type { EnderecoDoCep } from "@/hooks/useBuscaCep";

export type LeituraDoCep =
  | { tipo: "achou"; endereco: EnderecoDoCep }
  // O provedor RESPONDEU e disse que o CEP não existe na base dele.
  | { tipo: "naoEncontrado" }
  // Respondeu algo que não é um endereço nem um "não existe" (corpo vazio,
  // HTML de portal cativo, JSON de outro formato): conta como falha dele.
  | { tipo: "invalida" };

export interface ProvedorDeCep {
  nome: string;
  url: (cepLimpo: string) => string;
  /**
   * Traduz o corpo JSON para a forma única da casa. O ViaCEP avisa "não
   * existe" com status 200 e `erro` no corpo; o OpenCEP e o AwesomeAPI, com
   * status 404 — o hook lê o corpo do 404 e entrega aqui do mesmo jeito.
   */
  ler: (dados: unknown) => LeituraDoCep;
}

function registro(dados: unknown): Record<string, unknown> | null {
  return dados !== null && typeof dados === "object" && !Array.isArray(dados)
    ? (dados as Record<string, unknown>)
    : null;
}

function texto(valor: unknown): string {
  return typeof valor === "string" ? valor.trim() : "";
}

/**
 * Só vale como endereço o que traz cidade e UF de 2 letras: é o que o resto
 * do sistema lê de `user_addresses` (frete, antifraude). Rua e bairro podem
 * vir vazios — CEP de cidade pequena é um só para a cidade inteira, e a
 * cliente completa à mão.
 */
function montar(
  logradouro: string,
  bairro: string,
  cidade: string,
  uf: string,
): LeituraDoCep {
  const ufNormalizada = uf.toUpperCase();
  if (!cidade || !/^[A-Z]{2}$/.test(ufNormalizada)) {
    return { tipo: "invalida" };
  }
  return {
    tipo: "achou",
    endereco: { logradouro, bairro, localidade: cidade, uf: ufNormalizada },
  };
}

// "Rua Doutor Celestino, 183" e "Avenida Minas Gerais, s/n" -> sem o número:
// o número é um campo à parte do formulário e a cliente o digita.
const NUMERO_NO_FIM_DA_RUA = /,\s*(?:\d+[a-z]?|s\/n)\s*$/i;

const viaCep: ProvedorDeCep = {
  nome: "ViaCEP",
  url: (cep) => `https://viacep.com.br/ws/${cep}/json/`,
  ler: (dados) => {
    const d = registro(dados);
    if (!d) return { tipo: "invalida" };
    // `erro` vem como `true` ou como a string "true" (medido), com status 200.
    if (d.erro) return { tipo: "naoEncontrado" };
    return montar(
      texto(d.logradouro),
      texto(d.bairro),
      texto(d.localidade),
      texto(d.uf),
    );
  },
};

const openCep: ProvedorDeCep = {
  nome: "OpenCEP",
  url: (cep) => `https://opencep.com/v1/${cep}`,
  ler: (dados) => {
    const d = registro(dados);
    if (!d) return { tipo: "invalida" };
    // 404 com `{"error":true}` (medido).
    if (d.error || d.erro) return { tipo: "naoEncontrado" };
    return montar(
      texto(d.logradouro),
      texto(d.bairro),
      texto(d.localidade),
      texto(d.uf),
    );
  },
};

const awesomeApi: ProvedorDeCep = {
  nome: "AwesomeAPI",
  url: (cep) => `https://cep.awesomeapi.com.br/json/${cep}`,
  ler: (dados) => {
    const d = registro(dados);
    if (!d) return { tipo: "invalida" };
    // 404 com `{"code":"not_found",...}` (medido).
    if (d.code === "not_found") return { tipo: "naoEncontrado" };
    return montar(
      texto(d.address).replace(NUMERO_NO_FIM_DA_RUA, ""),
      texto(d.district),
      texto(d.city),
      texto(d.state),
    );
  },
};

export const PROVEDORES_DE_CEP: readonly ProvedorDeCep[] = [
  viaCep,
  openCep,
  awesomeApi,
];
