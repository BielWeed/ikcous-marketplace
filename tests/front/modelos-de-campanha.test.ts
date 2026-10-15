// Os modelos prontos da tela "Avisar clientes" prometiam um cupom que a loja
// nunca criou: "Use o cupom BEMVINDO" (nada confere se o cupom existe — a
// cliente digitava e recebia "O cupom BEMVINDO não existe") e "10% OFF ativo
// por 1 hora" (a loja não tem desconto com relógio). O modelo agora traz um
// MARCADOR no lugar do código, e este arquivo prende as regras puras: o que
// os modelos podem dizer, o que conta como marcador pendente e como se
// reconhece um cupom citado no texto.
import {
  type CupomDaLoja,
  MARCADOR_DO_CUPOM,
  MODELOS_DE_CAMPANHA,
  codigosDeCupomCitados,
  mensagemDoProblemaDoCupom,
  problemaDoCupom,
  temMarcadorPendente,
} from "@/lib/modelos-de-campanha";
import { describe, expect, it } from "vitest";

const todosOsModelos = Object.values(MODELOS_DE_CAMPANHA);

describe("modelos prontos de campanha", () => {
  it("nenhum modelo traz código de cupom fixo nem desconto inventado", () => {
    for (const modelo of todosOsModelos) {
      const texto = `${modelo.mensagem.title} ${modelo.mensagem.body}`;
      expect(texto).not.toMatch(/BEMVINDO/i);
      expect(texto).not.toMatch(/\d+\s*%/);
      expect(texto).not.toMatch(/R\$\s*\d/);
      expect(texto).not.toMatch(/\d+\s*(hora|minuto)/i);
      expect(texto).not.toMatch(/frete gr[aá]tis/i);
    }
  });

  it("os modelos de desconto deixam o marcador onde o código vai", () => {
    expect(MODELOS_DE_CAMPANHA.fomo.mensagem.body).toContain(MARCADOR_DO_CUPOM);
    expect(MODELOS_DE_CAMPANHA.value.mensagem.body).toContain(
      MARCADOR_DO_CUPOM,
    );
  });

  it("o modelo do carrinho não cita cupom nenhum", () => {
    const texto = `${MODELOS_DE_CAMPANHA.auth.mensagem.title} ${MODELOS_DE_CAMPANHA.auth.mensagem.body}`;
    expect(texto).not.toMatch(/cupom/i);
    expect(temMarcadorPendente(texto)).toBe(false);
  });

  it("título e texto cabem nos limites da notificação (60 e 140)", () => {
    for (const modelo of todosOsModelos) {
      expect(modelo.mensagem.title.length).toBeLessThanOrEqual(60);
      expect(modelo.mensagem.body.length).toBeLessThanOrEqual(140);
    }
  });
});

describe("temMarcadorPendente", () => {
  it("vê o marcador no título ou no texto", () => {
    expect(temMarcadorPendente(`Use ${MARCADOR_DO_CUPOM} já`)).toBe(true);
    expect(temMarcadorPendente("ok", `Use ${MARCADOR_DO_CUPOM}`)).toBe(true);
  });

  it("vê o marcador mesmo sem acento, em minúsculas ou pela metade", () => {
    expect(temMarcadorPendente("use [CODIGO DO SEU CUPOM]")).toBe(true);
    expect(temMarcadorPendente("use [código do seu cupom]")).toBe(true);
    expect(temMarcadorPendente("use [ CÓDIGO")).toBe(true);
  });

  it("texto limpo não é marcador", () => {
    expect(temMarcadorPendente("Use o cupom VERAO10 hoje")).toBe(false);
    expect(temMarcadorPendente("", "")).toBe(false);
    expect(temMarcadorPendente("o código do cupom está na loja")).toBe(false);
  });
});

describe("codigosDeCupomCitados", () => {
  it("acha o código escrito depois da palavra cupom", () => {
    expect(codigosDeCupomCitados("Use o cupom BEMVINDO e economize")).toEqual([
      "BEMVINDO",
    ]);
    expect(codigosDeCupomCitados("Cupom VERAO10! Só hoje")).toEqual([
      "VERAO10",
    ]);
  });

  it("junta título e texto sem repetir", () => {
    expect(
      codigosDeCupomCitados(
        "Use o cupom VERAO10",
        "Cupom VERAO10 e cupom DEZ20",
      ),
    ).toEqual(["VERAO10", "DEZ20"]);
  });

  it("não confunde palavra comum com código", () => {
    expect(codigosDeCupomCitados("Cupom Relâmpago na loja")).toEqual([]);
    expect(codigosDeCupomCitados("Use seu cupom de desconto")).toEqual([]);
    expect(codigosDeCupomCitados("Seu carrinho está te esperando")).toEqual([]);
    expect(codigosDeCupomCitados("Use o cupom abc na loja")).toEqual([]);
  });

  it("não sai por código curto demais", () => {
    expect(codigosDeCupomCitados("cupom AB")).toEqual([]);
  });
});

describe("problemaDoCupom", () => {
  const agora = new Date("2026-10-14T12:00:00Z");
  const bom: CupomDaLoja = {
    code: "VERAO10",
    active: true,
    valid_until: null,
    usage_limit: null,
    usage_count: 0,
  };

  it("cupom ativo, sem prazo e sem limite não tem problema", () => {
    expect(problemaDoCupom("VERAO10", [bom], agora)).toBeNull();
  });

  it("código que a loja não criou não existe", () => {
    expect(problemaDoCupom("BEMVINDO", [bom], agora)).toBe("nao-existe");
    expect(problemaDoCupom("BEMVINDO", [], agora)).toBe("nao-existe");
  });

  it("cupom desligado, vencido ou esgotado é problema", () => {
    expect(problemaDoCupom("VERAO10", [{ ...bom, active: false }], agora)).toBe(
      "desativado",
    );
    expect(
      problemaDoCupom(
        "VERAO10",
        [{ ...bom, valid_until: "2026-10-01T00:00:00Z" }],
        agora,
      ),
    ).toBe("vencido");
    expect(
      problemaDoCupom(
        "VERAO10",
        [{ ...bom, usage_limit: 5, usage_count: 5 }],
        agora,
      ),
    ).toBe("esgotado");
  });

  it("validade no futuro e limite com sobra não atrapalham", () => {
    expect(
      problemaDoCupom(
        "VERAO10",
        [
          {
            ...bom,
            valid_until: "2026-12-31T00:00:00Z",
            usage_limit: 5,
            usage_count: 4,
          },
        ],
        agora,
      ),
    ).toBeNull();
  });

  it("cada problema tem uma frase que diz o código", () => {
    for (const p of [
      "nao-existe",
      "desativado",
      "vencido",
      "esgotado",
    ] as const) {
      expect(mensagemDoProblemaDoCupom("VERAO10", p)).toContain("VERAO10");
    }
  });
});
