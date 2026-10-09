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

describe("motivoDaCotacao", () => {
  it("frase em português que a edge escreveu passa igual", () => {
    const credencial =
      'Sem credencial cadastrada para o provedor "melhor_envio". Conecte a transportadora para cotar entregas fora da cidade.';
    expect(motivoDaCotacao(credencial)).toBe(credencial);
    expect(motivoDaCotacao("Nenhum método de envio retornado.")).toBe(
      "Nenhum método de envio retornado.",
    );
  });

  it("'API retornou N: {json}' vira a frase com o número do erro", () => {
    expect(
      motivoDaCotacao(
        'Melhor Envio API retornou 422: {"errors":{"postal_code":["inválido"]}}',
      ),
    ).toBe(FRASE);
  });

  it("'API retornou N: texto solto' também vira a frase (o corpo é da transportadora, não nosso)", () => {
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
