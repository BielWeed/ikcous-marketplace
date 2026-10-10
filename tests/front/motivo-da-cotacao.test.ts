// O motivo que a edge grava em `shipping_calculation_logs.error_message` nem
// sempre é frase da loja: no ramo de falha de API é o corpo BRUTO que a
// transportadora devolveu ("Melhor Envio API retornou 422: {...}"). A
// lojista não lê JSON nem HTML — o histórico mostra uma frase, e o texto
// inteiro fica no `title` (isso é do card; aqui é só a tradução, pura).
import {
  motivoDaCotacao,
  nomeDoProvedorNoHistorico,
} from "@/lib/motivo-da-cotacao";
import { describe, expect, it } from "vitest";

const FRASE =
  "A transportadora não respondeu direito (erro 422). Tente de novo mais tarde.";
const CHAVE_RECUSADA =
  "A transportadora recusou a chave de acesso. Confira a chave em Transportadoras e toque em Testar.";
const CEP_RECUSADO = "A transportadora não aceitou o CEP do cliente.";

describe("motivoDaCotacao", () => {
  it("frase em português que a edge escreveu passa igual", () => {
    const credencial =
      'Sem credencial cadastrada para o provedor "melhor_envio". Conecte a transportadora para cotar entregas fora da cidade.';
    expect(motivoDaCotacao(credencial)).toBe(credencial);
    expect(motivoDaCotacao("Nenhum método de envio retornado.")).toBe(
      "Nenhum método de envio retornado.",
    );
  });

  it("401 e 403 = chave recusada: a lojista troca a chave, não espera", () => {
    for (const status of ["401", "403"]) {
      expect(
        motivoDaCotacao(`Melhor Envio API retornou ${status}: {"message":"x"}`),
      ).toBe(CHAVE_RECUSADA);
    }
  });

  it("422 com cep_destino no corpo = o CEP do cliente não foi aceito", () => {
    expect(
      motivoDaCotacao(
        'Melhor Envio API retornou 422: {"errors":{"postal_code":["O campo cep_destino está invalido"]}}',
      ),
    ).toBe(CEP_RECUSADO);
  });

  it("422 SEM cep_destino é a frase genérica, com o número", () => {
    expect(
      motivoDaCotacao(
        'Melhor Envio API retornou 422: {"errors":{"weight":["inválido"]}}',
      ),
    ).toBe(FRASE);
  });

  it("outro status (500) é a frase genérica com o número; o texto solto do corpo não vaza", () => {
    expect(
      motivoDaCotacao("Frenet API retornou 500: Internal Server Error"),
    ).toBe(
      "A transportadora não respondeu direito (erro 500). Tente de novo mais tarde.",
    );
  });

  it("JSON cru ou HTML cru, sem número, viram a frase sem número", () => {
    const semNumero =
      "A transportadora não respondeu direito. Tente de novo mais tarde.";
    expect(motivoDaCotacao('{"message":"Server Error"}')).toBe(semNumero);
    expect(motivoDaCotacao('[{"erro":1}]')).toBe(semNumero);
    expect(
      motivoDaCotacao("<!DOCTYPE html><html><body>502</body></html>"),
    ).toBe(semNumero);
    expect(motivoDaCotacao("  <html>Bad Gateway</html>")).toBe(semNumero);
  });

  it("falha de vários provedores (separador ' | '): cada parte é traduzida, o id vira o nome", () => {
    const nomeDe = (id: string) =>
      id === "melhor_envio"
        ? "Melhor Envio"
        : id === "frenet"
          ? "Frenet"
          : null;
    expect(
      motivoDaCotacao(
        'melhor_envio: Melhor Envio API retornou 502: <html>x</html> | frenet: Sem credencial cadastrada para o provedor "frenet".',
        nomeDe,
      ),
    ).toBe(
      'Melhor Envio: A transportadora não respondeu direito (erro 502). Tente de novo mais tarde. | Frenet: Sem credencial cadastrada para o provedor "frenet".',
    );
  });

  it("se o corpo já começa com o nome da transportadora, o prefixo não repete", () => {
    const nomeDe = (id: string) =>
      id === "melhor_envio" ? "Melhor Envio" : null;
    expect(
      motivoDaCotacao(
        "melhor_envio: Melhor Envio: resposta inesperada.",
        nomeDe,
      ),
    ).toBe("Melhor Envio: resposta inesperada.");
  });

  // Frases reais da edge (provedores.ts `chamarComTempo` e `lerJson`): o texto
  // depois de "tempo esgotado: " / "falha de rede: " é a mensagem do runtime
  // ("The signal has been aborted", "error sending request…") — inglês técnico
  // que a lojista não lê.
  const DEMOROU =
    "A transportadora demorou demais para responder. Tente de novo mais tarde.";
  const SEM_CONEXAO =
    "Não deu para falar com a transportadora (sem conexão). Tente de novo mais tarde.";
  const SEM_NUMERO =
    "A transportadora não respondeu direito. Tente de novo mais tarde.";

  it("'tempo esgotado: …' vira a frase de demora e o texto técnico não vaza", () => {
    expect(motivoDaCotacao("tempo esgotado: The signal has been aborted")).toBe(
      DEMOROU,
    );
  });

  it("'falha de rede: …' vira a frase de conexão e o texto técnico não vaza", () => {
    expect(
      motivoDaCotacao(
        "falha de rede: error sending request for url (https://x.test/)",
      ),
    ).toBe(SEM_CONEXAO);
  });

  it("'resposta não é JSON válido' vira a frase sem número, com ou sem o nome na frente", () => {
    expect(motivoDaCotacao("Melhor Envio: resposta não é JSON válido.")).toBe(
      SEM_NUMERO,
    );
  });

  it("com vários provedores, o id vira o nome e cada parte é traduzida", () => {
    const nomeDe = (id: string) =>
      id === "superfrete"
        ? "SuperFrete"
        : id === "frenet"
          ? "Frenet"
          : id === "melhor_envio"
            ? "Melhor Envio"
            : null;
    expect(
      motivoDaCotacao(
        "superfrete: tempo esgotado: The signal has been aborted | frenet: falha de rede: dns error | melhor_envio: Melhor Envio: resposta não é JSON válido.",
        nomeDe,
      ),
    ).toBe(
      `SuperFrete: ${DEMOROU} | Frenet: ${SEM_CONEXAO} | Melhor Envio: ${SEM_NUMERO}`,
    );
  });

  it("a frase em português da edge sobre o corpo ilegível passa igual", () => {
    const lido =
      "o corpo da resposta não pôde ser lido (tempo esgotado ou conexão caiu).";
    expect(motivoDaCotacao(lido)).toBe(lido);
  });

  it("vazio ou nulo devolve vazio (linha com campo nulo não derruba a seção)", () => {
    expect(motivoDaCotacao("")).toBe("");
    expect(motivoDaCotacao(null)).toBe("");
    expect(motivoDaCotacao(undefined)).toBe("");
  });
});

describe("nomeDoProvedorNoHistorico", () => {
  const nomeDe = (id: string) =>
    id === "melhor_envio"
      ? "Melhor Envio"
      : id === "superfrete"
        ? "SuperFrete"
        : id === "frenet"
          ? "Frenet"
          : null;

  it("traduz o id para o nome da transportadora", () => {
    expect(nomeDoProvedorNoHistorico("melhor_envio", nomeDe)).toBe(
      "Melhor Envio",
    );
    expect(nomeDoProvedorNoHistorico("superfrete", nomeDe)).toBe("SuperFrete");
  });

  it("vários ligados (lista com vírgula) e o selo '(Cache)' da edge", () => {
    expect(nomeDoProvedorNoHistorico("melhor_envio, frenet", nomeDe)).toBe(
      "Melhor Envio, Frenet",
    );
    expect(nomeDoProvedorNoHistorico("frenet (Cache)", nomeDe)).toBe(
      "Frenet (resposta guardada)",
    );
  });

  it("id desconhecido não vira nome inventado: só troca '_' por espaço", () => {
    expect(nomeDoProvedorNoHistorico("flat_fee", nomeDe)).toBe("flat fee");
  });

  it("nulo vira vazio", () => {
    expect(nomeDoProvedorNoHistorico(null, nomeDe)).toBe("");
  });
});
