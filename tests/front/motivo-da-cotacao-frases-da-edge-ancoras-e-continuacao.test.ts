// Caça por mutação (25/11/2026) em `motivo-da-cotacao.ts`: o texto do Histórico
// de Cotações que a lojista lê. Os testes vizinhos provam o caminho feliz de
// cada regra; aqui estão as FRONTEIRAS onde um defeito de uma linha passava:
//  - as frases acionáveis que a edge escreve em português (com o texto REAL dela)
//    passam sem alteração — cada alternativa da lista, uma a uma;
//  - as regras de reconhecimento são ancoradas: uma frase parecida no MEIO de
//    outro texto não ganha o tratamento de "frase já clara";
//  - "API retornou N" exige exatamente três dígitos inteiros; "cep_destino" só
//    vale com 422 (e só esse campo: "cep_origem" é erro da LOJA, não da cliente);
//  - corpo cru em lista JSON ou doctype sem tag, e "NÃO É JSON" em maiúsculas;
//  - várias transportadoras: um pedaço sem "<id>: " continua o anterior, o nome
//    só é omitido quando o texto JÁ COMEÇA com ele, e corpo vazio não ganha "()".
// Fixtures inventadas.
import {
  motivoDaCotacao,
  nomeDoProvedorNoHistorico,
} from "@/lib/motivo-da-cotacao";
import { describe, expect, it } from "vitest";

const nomes = new Map([
  ["melhor_envio", "Melhor Envio"],
  ["frenet", "Frenet"],
  ["superfrete", "SuperFrete"],
]);
const nomeDe = (id: string) => nomes.get(id) ?? null;

const GENERICA = "Não foi possível concluir a cotação.";
const NAO_RESPONDEU = "A transportadora não respondeu direito";
const TENTE = "Tente de novo mais tarde.";

describe("frases acionáveis da edge passam sem alteração", () => {
  it.each([
    "Não foi possível ler os produtos do carrinho; a cotação de fora da cidade não foi feita.",
    "Não foi possível ler as credenciais das transportadoras agora. A cotação de fora da cidade não foi feita.",
    "Não foi possível ler a revisão da configuração do frete; a cotação de fora da cidade não foi feita.",
    "As transportadoras ligadas estão sem chave de acesso. Salve a chave em Ajustes > Transportadoras.",
    "Falta o e-mail de contato técnico da SuperFrete — preencha em Ajustes > Transportadoras.",
    "Melhor Envio não consultado: nenhum serviço válido na seleção salva.",
    "SuperFrete não consultada: nenhum serviço habilitado (sedex, pac ou jadlog) corresponde a um serviço da SuperFrete.",
    "Frenet não consultada: nenhum serviço válido na seleção salva.",
    "Nenhuma transportadora ligada para entregas fora da cidade. Ligue ao menos uma em Ajustes > Transportadoras.",
    "Loja sem transportadora conectada para entregas fora da cidade. Conecte Melhor Envio, Frenet ou SuperFrete.",
    "o corpo da resposta não pôde ser lido (tempo esgotado ou conexão caiu).",
    "Frenet: a transportadora recusou a chave de acesso",
    "SuperFrete: credencial em modo de testes (Sandbox) não cota para clientes",
  ])("%s", (frase) => {
    expect(motivoDaCotacao(frase)).toBe(frase);
  });

  it("a mesma frase no MEIO de outro texto não é tratada como frase pronta", () => {
    expect(
      motivoDaCotacao("Aviso: Nenhuma transportadora ligada no momento."),
    ).toBe(`${GENERICA} (Aviso: Nenhuma transportadora ligada no momento.)`);
  });

  it("'Nenhum método de envio retornado' só vale com o texto exato", () => {
    expect(motivoDaCotacao("Nenhum método de envio retornado.")).toBe(
      "Nenhuma opção de envio ficou disponível para esta cotação.",
    );
    expect(motivoDaCotacao("Nenhum método de envio retornado para o CEP")).toBe(
      `${GENERICA} (Nenhum método de envio retornado para o CEP)`,
    );
  });

  it("'Token ... ausente' só vale com o texto inteiro, sem sobra antes nem depois", () => {
    expect(motivoDaCotacao("Token da Frenet ausente")).toBe(
      "Falta a chave de acesso. Salve a chave em Ajustes > Transportadoras.",
    );
    expect(motivoDaCotacao("Token do Melhor Envio ausente e expirado")).toBe(
      `${GENERICA} (Token do Melhor Envio ausente e expirado)`,
    );
    expect(motivoDaCotacao("Falta o Token da Frenet ausente")).toBe(
      `${GENERICA} (Falta o Token da Frenet ausente)`,
    );
  });
});

describe("'API retornou N': três dígitos inteiros, e cep_destino só com 422", () => {
  it.each([
    ["Melhor Envio API retornou 5000: x", "Melhor Envio API retornou 5000: x"],
    ["Melhor Envio API retornou 50: x", "Melhor Envio API retornou 50: x"],
    ["XAPI retornou 500: x", "XAPI retornou 500: x"],
  ])("%s não é lido como status HTTP", (texto, detalhe) => {
    expect(motivoDaCotacao(texto)).toBe(`${GENERICA} (${detalhe})`);
  });

  it("'cep_destino' com status diferente de 422 não culpa o CEP da cliente", () => {
    expect(
      motivoDaCotacao("Frenet API retornou 500: cep_destino inválido"),
    ).toBe(`${NAO_RESPONDEU} (erro 500). ${TENTE}`);
  });

  it("422 sobre o CEP de ORIGEM (da loja) não vira 'CEP do cliente'", () => {
    expect(
      motivoDaCotacao('Melhor Envio API retornou 422: {"cep_origem":"x"}'),
    ).toBe(`${NAO_RESPONDEU} (erro 422). ${TENTE}`);
  });
});

describe("falha de rede, tempo esgotado e corpo cru: ancoragem e caixa", () => {
  it.each(["Falha: tempo esgotado: x", "Erro: falha de rede: x"])(
    "'%s' no meio do texto não é a frase de demora/conexão",
    (texto) => {
      expect(motivoDaCotacao(texto)).toBe(`${GENERICA} (${texto})`);
    },
  );

  it("'RESPOSTA NÃO É JSON VÁLIDO' em maiúsculas vira a frase sem número", () => {
    expect(motivoDaCotacao("RESPOSTA NÃO É JSON VÁLIDO")).toBe(
      `${NAO_RESPONDEU}. ${TENTE}`,
    );
  });

  it.each([
    "[1,2]",
    '[{"error":"x"}]',
    "Bad Gateway <!DOCTYPE>",
    "<error>Bad gateway</error>",
  ])("corpo cru %s vira a frase sem número, sem despejar o texto", (texto) => {
    expect(motivoDaCotacao(texto)).toBe(`${NAO_RESPONDEU}. ${TENTE}`);
  });
});

describe("falha ao gravar e configuração mudou: o começo do texto manda", () => {
  it("'statement timeout' fora de 'Falha ao gravar a cotação' não vira frase do banco", () => {
    expect(
      motivoDaCotacao("Banco: canceling statement due to statement timeout"),
    ).toBe(`${GENERICA} (Banco: canceling statement due to statement timeout)`);
  });

  it.each([
    "Falha ao gravar a cotação: there is no unique or exclusion constraint",
    "Falha ao gravar a cotação: Duplicate Key",
    "Falha ao gravar a cotação: RELATION foo DOES NOT EXIST",
  ])("termo técnico '%s' vira a frase técnica da cotação", (texto) => {
    expect(motivoDaCotacao(texto)).toContain(
      "mas não pôde ser salva. Algumas opções de frete",
    );
  });

  it("termo técnico no meio de texto que NÃO começa com 'Falha ao gravar' não vira frase de gravação", () => {
    const texto =
      "Melhor Envio: a transportadora devolveu duplicate key no cadastro";

    expect(motivoDaCotacao(texto)).toBe(`${GENERICA} (${texto})`);
  });

  it("'configuracao_mudou_durante_cotacao' só vale como começo do texto, com os dois pontos", () => {
    expect(
      motivoDaCotacao("configuracao_mudou_durante_cotacao sem dois pontos"),
    ).toBe(`${GENERICA} (configuracao_mudou_durante_cotacao sem dois pontos)`);
    expect(
      motivoDaCotacao("Melhor Envio: configuracao_mudou_durante_cotacao: x"),
    ).toBe(`${GENERICA} (Melhor Envio: configuracao_mudou_durante_cotacao: x)`);
  });
});

describe("várias transportadoras: continuação, nome e corpo vazio", () => {
  it("pedaço sem '<id>: ' continua o anterior mesmo com ': ' no meio", () => {
    expect(
      motivoDaCotacao(
        "frenet: Frenet API retornou 502: corpo | com {a: 1} dentro",
        nomeDe,
      ),
    ).toBe(`Frenet: ${NAO_RESPONDEU} (erro 502). ${TENTE}`);
  });

  it("a continuação volta com ' | ' entre os pedaços", () => {
    expect(motivoDaCotacao("frenet: erro | sem prefixo", nomeDe)).toBe(
      `Frenet: ${GENERICA} (erro | sem prefixo)`,
    );
  });

  it("o nome só é omitido quando o texto traduzido COMEÇA com ele", () => {
    expect(motivoDaCotacao("frenet: erro da Frenet", nomeDe)).toBe(
      `Frenet: ${GENERICA} (erro da Frenet)`,
    );
  });

  it("corpo vazio depois do id fica na frase curta, sem parênteses vazios", () => {
    expect(motivoDaCotacao("frenet: ", nomeDe)).toBe(`Frenet: ${GENERICA}`);
  });
});

describe("nomeDoProvedorNoHistorico: selo de cache", () => {
  it("'(Cache)' colado ao id, sem o espaço, não é o selo da edge", () => {
    expect(nomeDoProvedorNoHistorico("frenet(Cache)", nomeDe)).toBe(
      "frenet(Cache)",
    );
  });

  it("o selo certo (com espaço) continua sendo reconhecido", () => {
    expect(nomeDoProvedorNoHistorico("frenet (Cache)", nomeDe)).toBe(
      "Frenet (resposta guardada)",
    );
  });
});
