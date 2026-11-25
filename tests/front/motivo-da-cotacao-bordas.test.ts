// Bordas do texto do histórico de cotações (caça por mutação): corte exato de
// 160 caracteres, "Cotação parcial", maiúsculas na falha de rede, corpo HTML
// só com <body>, vários "_" no id e texto com quebra de linha.
// Fixtures inventadas.
import {
  motivoDaCotacao,
  nomeDoProvedorNoHistorico,
} from "@/lib/motivo-da-cotacao";
import { describe, expect, it } from "vitest";

const nomesConhecidos = new Map([
  ["melhor_envio", "Melhor Envio"],
  ["frenet", "Frenet"],
]);
const nomeDe = (id: string) => nomesConhecidos.get(id) ?? null;

describe("motivoDaCotacao: bordas", () => {
  it("desconhecido com exatamente 160 caracteres não leva reticências", () => {
    const texto = "x".repeat(160);
    expect(motivoDaCotacao(texto)).toBe(
      `Não foi possível concluir a cotação. (${texto})`,
    );
  });

  it("desconhecido com 161 caracteres é cortado em 160 e ganha reticências", () => {
    const texto = "y".repeat(161);
    expect(motivoDaCotacao(texto)).toBe(
      `Não foi possível concluir a cotação. (${"y".repeat(160)}…)`,
    );
  });

  it("desconhecido com 159 caracteres passa inteiro", () => {
    const texto = "z".repeat(159);
    expect(motivoDaCotacao(texto)).toBe(
      `Não foi possível concluir a cotação. (${texto})`,
    );
  });

  it("cotação parcial: mantém o aviso de parcial e traduz o resto", () => {
    expect(
      motivoDaCotacao(
        "Cotação parcial: Melhor Envio API retornou 500: erro interno",
      ),
    ).toBe(
      "Cotação parcial — A transportadora não respondeu direito (erro 500). Tente de novo mais tarde.",
    );
  });

  it("cotação parcial com duas transportadoras traduz cada parte", () => {
    expect(
      motivoDaCotacao(
        "Cotação parcial: melhor_envio: API retornou 403: negado | frenet: tempo esgotado: aborted",
        nomeDe,
      ),
    ).toBe(
      "Cotação parcial — Melhor Envio: A transportadora recusou a chave de acesso. Confira a chave em Transportadoras e toque em Testar. | Frenet: A transportadora demorou demais para responder. Tente de novo mais tarde.",
    );
  });

  it("texto sem o prefixo de parcial não ganha aviso de parcial", () => {
    expect(motivoDaCotacao("Melhor Envio API retornou 500: x")).not.toContain(
      "Cotação parcial",
    );
  });

  it("'Cotação parcial: ' no meio do texto não conta como parcial", () => {
    expect(motivoDaCotacao("Erro qualquer. Cotação parcial: fim")).toBe(
      "Não foi possível concluir a cotação. (Erro qualquer. Cotação parcial: fim)",
    );
  });

  it("falha de rede e tempo esgotado em MAIÚSCULAS continuam traduzidos", () => {
    expect(motivoDaCotacao("Tempo esgotado: The signal has been aborted")).toBe(
      "A transportadora demorou demais para responder. Tente de novo mais tarde.",
    );
    expect(motivoDaCotacao("FALHA DE REDE: fetch failed")).toBe(
      "Não deu para falar com a transportadora (sem conexão). Tente de novo mais tarde.",
    );
  });

  it("página HTML que só tem <body> no meio do texto vira frase, sem despejar o HTML", () => {
    expect(motivoDaCotacao("Gateway ruim: <body>erro</body>")).toBe(
      "A transportadora não respondeu direito. Tente de novo mais tarde.",
    );
  });

  it("falha ao gravar com 'duplicate key' sozinho é a frase técnica da cotação", () => {
    expect(
      motivoDaCotacao("Falha ao gravar a cotação: duplicate key value"),
    ).toBe(
      "A cotação foi calculada, mas não pôde ser salva. Algumas opções de frete podem não ter aparecido para a cliente.",
    );
  });

  it("falha ao gravar sem termo técnico conhecido fica na frase curta", () => {
    expect(motivoDaCotacao("Falha ao gravar a cotação: erro qualquer")).toBe(
      "A cotação foi calculada, mas não pôde ser salva.",
    );
  });

  it("prefixo de transportadora com corpo de várias linhas ainda recebe o nome", () => {
    expect(
      motivoDaCotacao(
        "frenet: Nenhum método de envio retornado.\nlinha dois",
        nomeDe,
      ),
    ).toMatch(/^Frenet: /);
  });

  it("texto vazio, nulo e indefinido dão vazio", () => {
    expect(motivoDaCotacao("")).toBe("");
    expect(motivoDaCotacao(null)).toBe("");
    expect(motivoDaCotacao(undefined)).toBe("");
  });
});

describe("nomeDoProvedorNoHistorico: bordas", () => {
  it("id desconhecido com vários '_' troca todos por espaço", () => {
    expect(nomeDoProvedorNoHistorico("flat_fee_extra_grande", nomeDe)).toBe(
      "flat fee extra grande",
    );
  });

  it("lista separada por vírgula sem espaço e com vários espaços", () => {
    expect(nomeDoProvedorNoHistorico("melhor_envio,frenet", nomeDe)).toBe(
      "Melhor Envio, Frenet",
    );
    expect(nomeDoProvedorNoHistorico("melhor_envio,   frenet", nomeDe)).toBe(
      "Melhor Envio, Frenet",
    );
  });

  it("selo (Cache) em desconhecido troca '_' e marca resposta guardada", () => {
    expect(nomeDoProvedorNoHistorico("flat_fee (Cache)", nomeDe)).toBe(
      "flat fee (resposta guardada)",
    );
  });

  it("vazio, nulo e indefinido dão vazio", () => {
    expect(nomeDoProvedorNoHistorico("", nomeDe)).toBe("");
    expect(nomeDoProvedorNoHistorico(null, nomeDe)).toBe("");
    expect(nomeDoProvedorNoHistorico(undefined, nomeDe)).toBe("");
  });
});
