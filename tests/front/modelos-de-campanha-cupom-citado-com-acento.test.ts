// A lojista cria o cupom "Verão10" e o painel grava "VERAO10" (sem acento,
// `normalizarCodigoDoCupom`). No aviso ela escreve "Use o cupom VERÃO10". O
// checkout aceita esse código (tenta como digitado e, se o servidor disser que
// não existe, tenta de novo sem acento), mas a tela de avisos buscava e
// comparava só "VERÃO10" e acusava "O cupom VERÃO10 não existe na sua loja",
// travando o envio. A conferência agora segue a mesma ordem do checkout — e
// não pode aceitar um cupom que a cliente não conseguiria usar.
import {
  type CupomDaLoja,
  cupomDoCodigoCitado,
  filtroDosCodigosCitados,
  problemaDoCupom,
} from "@/lib/modelos-de-campanha";
import { describe, expect, it } from "vitest";

const agora = new Date("2026-11-26T12:00:00Z");

const cupom = (extra: Partial<CupomDaLoja> = {}): CupomDaLoja => ({
  code: "VERAO10",
  active: true,
  valid_until: null,
  usage_limit: null,
  usage_count: 0,
  ...extra,
});

describe("cupom citado com acento, gravado sem acento", () => {
  it("a busca também pede a versão sem acento do código citado", () => {
    const filtro = filtroDosCodigosCitados(["VERÃO10"]).split(",");
    expect(filtro).toContain("code.ilike.VERÃO10");
    expect(filtro).toContain("code.ilike.VERAO10");
  });

  it("código sem acento não se repete no filtro", () => {
    expect(filtroDosCodigosCitados(["NATAL10"])).toBe("code.ilike.NATAL10");
  });

  it('"VERÃO10" no texto com "VERAO10" no banco não acusa inexistente', () => {
    expect(problemaDoCupom("VERÃO10", [cupom()], agora)).toBeNull();
  });

  it("e confere o cupom achado sem acento (desligado continua acusando)", () => {
    expect(problemaDoCupom("VERÃO10", [cupom({ active: false })], agora)).toBe(
      "desativado",
    );
  });
});

describe("sem falso positivo", () => {
  it('"NATAL10" no texto sem nada parecido no banco continua acusando', () => {
    expect(problemaDoCupom("NATAL10", [cupom()], agora)).toBe("nao-existe");
    expect(problemaDoCupom("NATAL10", [], agora)).toBe("nao-existe");
  });

  it('"VERAO10" no texto com só "VERÃO10" no banco continua acusando', () => {
    // O checkout não tira acento do código GRAVADO: quem digita "VERAO10" não
    // acha o cupom antigo "VERÃO10". A conferência não pode dizer que acha.
    expect(
      problemaDoCupom("VERAO10", [cupom({ code: "VERÃO10" })], agora),
    ).toBe("nao-existe");
  });
});

describe("cupom antigo gravado com acento", () => {
  it('"VERÃO10" no banco continua sendo achado pelo texto "VERÃO10"', () => {
    expect(
      problemaDoCupom("VERÃO10", [cupom({ code: "VERÃO10" })], agora),
    ).toBe(null);
  });

  it("com as duas grafias no banco, a grafia citada vem primeiro", () => {
    const comAcento = cupom({ id: "com-acento", code: "VERÃO10" });
    const semAcento = cupom({ id: "sem-acento", code: "VERAO10" });
    expect(cupomDoCodigoCitado("VERÃO10", [semAcento, comAcento])?.id).toBe(
      "com-acento",
    );
    expect(cupomDoCodigoCitado("VERÃO10", [semAcento])?.id).toBe("sem-acento");
    expect(cupomDoCodigoCitado("NATAL10", [semAcento, comAcento])).toBe(
      undefined,
    );
  });
});
