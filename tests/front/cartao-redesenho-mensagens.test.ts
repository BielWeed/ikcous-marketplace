// @vitest-environment jsdom
//
// REDESENHO DA TELA DO CARTÃO (16/10/2026) — as peças PURAS: a categoria da
// recusa, as frases, o prazo e o estilo do Brick com as cores da loja.
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";

import {
  estiloDoBrick,
  hslDoTailwindParaHex,
} from "@/components/checkout/estilo-do-brick";
import {
  FRASES_DO_SERVIDOR_POR_CATEGORIA,
  TEXTOS_DO_CARTAO,
  categoriaDaRecusa,
  lerPrazoEmMs,
} from "@/components/checkout/mensagens-do-cartao";

describe("categoriaDaRecusa — a categoria sai da frase curada do servidor", () => {
  it("cada frase conhecida cai na sua categoria", () => {
    expect(
      categoriaDaRecusa("Confira os dados do cartão e tente de novo."),
    ).toBe("dados");
    expect(
      categoriaDaRecusa("Os dados do cartão expiraram. Digite de novo."),
    ).toBe("dados");
    expect(
      categoriaDaRecusa("Saldo ou limite insuficiente neste cartão."),
    ).toBe("sem-limite");
    expect(
      categoriaDaRecusa(
        "Seu banco pede autorização: ligue para ele e tente de novo.",
      ),
    ).toBe("autorizacao");
  });

  it("espaços em volta não derrubam a frase", () => {
    expect(
      categoriaDaRecusa("  Saldo ou limite insuficiente neste cartão. \n"),
    ).toBe("sem-limite");
  });

  it("BORDA: o que não conhecemos — inclusive segurança, texto cru do Mercado Pago, vazio e lixo — é 'geral'", () => {
    for (const motivo of [
      "Pagamento recusado por segurança. Tente outro cartão ou pague com PIX.",
      "O banco emissor recusou o pagamento.",
      "Pagamento recusado. Tente outro cartão ou pague com PIX.",
      "cc_rejected_high_risk",
      "insufficient_amount",
      "",
      "   ",
      undefined,
      null,
      42,
      { motivo: "x" },
    ]) {
      expect(categoriaDaRecusa(motivo)).toBe("geral");
    }
  });

  it("CONTRATO COM O SERVIDOR: toda frase mapeada ainda existe em _shared/mercadopago.ts", () => {
    // Se o servidor reescrever uma frase, o mapa daqui passaria a cair em
    // 'geral' sem ninguém ver. Este teste lê o arquivo do servidor.
    // O vitest roda da raiz do repositório (como o resto da suíte `tests/front`).
    const servidor = readFileSync(
      "supabase/functions/_shared/mercadopago.ts",
      "utf8",
    );
    for (const [frase] of FRASES_DO_SERVIDOR_POR_CATEGORIA) {
      expect(servidor, `frase sumiu do servidor: ${frase}`).toContain(
        `"${frase}"`,
      );
    }
  });
});

describe("frases da tela", () => {
  it("nenhuma frase promete 'sem juros' nem fala em antifraude", () => {
    const tudo = Object.values(TEXTOS_DO_CARTAO).join("\n").toLowerCase();
    expect(tudo).not.toContain("sem juros");
    expect(tudo).not.toContain("antifraude");
    expect(tudo).not.toContain("high_risk");
    expect(tudo).not.toContain("certific");
  });

  it("a linha de juros diz que PODE cobrar, a partir de 2x", () => {
    expect(TEXTOS_DO_CARTAO.juros).toBe(
      "No parcelado, o cartão pode cobrar juros a partir de 2x. O valor de cada parcela e o total aparecem na escolha das parcelas.",
    );
  });
});

describe("lerPrazoEmMs — o mesmo prazo que o PIX lê", () => {
  it("fração de 1 a 6 dígitos preserva o instante", () => {
    const base = Date.parse("2026-10-16T12:00:00.123Z");
    expect(lerPrazoEmMs("2026-10-16T12:00:00.123456Z")).toBe(base);
    expect(lerPrazoEmMs("2026-10-16T12:00:00.1Z")).toBe(base - 23);
    expect(lerPrazoEmMs("2026-10-16T12:00:00Z")).toBe(base - 123);
  });

  it("BORDA: ilegível, vazio ou de outro tipo é null — nunca inventa horário", () => {
    for (const v of ["x", "", "   ", undefined, null, 123, {}]) {
      expect(lerPrazoEmMs(v)).toBeNull();
    }
  });
});

describe("estiloDoBrick — as cores da loja no Card Payment Brick", () => {
  afterEach(() => {
    document.documentElement.removeAttribute("style");
  });

  it("converte o HSL do Tailwind para hexadecimal", () => {
    expect(hslDoTailwindParaHex("240 5.9% 10%")).toBe("#18181b");
    expect(hslDoTailwindParaHex("0 0% 98%")).toBe("#fafafa");
    expect(hslDoTailwindParaHex("0 100% 50%")).toBe("#ff0000");
  });

  it("BORDA: valor que não é HSL legível não vira cor", () => {
    for (const v of [
      "",
      "azul",
      "#ff0000",
      "240 5.9 10",
      "240 500% 10%",
      "x y% z%",
    ]) {
      expect(hslDoTailwindParaHex(v)).toBeNull();
    }
  });

  it("com --primary e --primary-foreground no :root, o botão do Brick leva a cor da loja e o texto de contraste", () => {
    document.documentElement.style.setProperty("--primary", "0 100% 50%");
    document.documentElement.style.setProperty(
      "--primary-foreground",
      "0 0% 98%",
    );
    const { style, hideFormTitle } = estiloDoBrick();
    const v = style.customVariables;
    expect(hideFormTitle).toBe(true);
    expect(v.baseColor).toBe("#ff0000");
    expect(v.outlinePrimaryColor).toBe("#ff0000");
    expect(v.buttonTextColor).toBe("#fafafa");
    // As variantes de hover são a MESMA cor, mais escura — nunca o azul padrão.
    expect(v.baseColorFirstVariant).toMatch(/^#[0-9a-f]{6}$/);
    expect(v.baseColorFirstVariant).not.toBe("#ff0000");
    expect(v.baseColorSecondVariant).not.toBe(v.baseColorFirstVariant);
  });

  it("legibilidade e tamanho sempre saem: fonte de 16 px, campo de ~48 px, sem card por dentro", () => {
    const v = estiloDoBrick().style.customVariables;
    expect(v.fontSizeMedium).toBe("16px");
    expect(v.fontSizeSmall).toBe("16px");
    expect(v.inputVerticalPadding).toBe("14px");
    expect(v.formPadding).toBe("0px");
    expect(v.inputFocusedBorderWidth).toBe("2px");
  });

  it("BORDA: sem a variável da loja (ou ilegível) o Brick fica com a cor padrão dele — nada inventado", () => {
    const sem = estiloDoBrick().style.customVariables;
    expect(sem.baseColor).toBeUndefined();
    expect(sem.buttonTextColor).toBeUndefined();

    document.documentElement.style.setProperty("--primary", "lixo");
    document.documentElement.style.setProperty(
      "--primary-foreground",
      "0 0% 98%",
    );
    const lixo = estiloDoBrick().style.customVariables;
    expect(lixo.baseColor).toBeUndefined();
    expect(lixo.buttonTextColor).toBeUndefined();
    expect(lixo.fontSizeMedium).toBe("16px");
  });

  it("raiz nula (SSR) não lança", () => {
    expect(() => estiloDoBrick(null)).not.toThrow();
  });
});

describe("categoriaDoServidor", () => {
  it("traduz o conjunto fechado do servidor e ignora o resto", async () => {
    const { categoriaDoServidor } = await import(
      "@/components/checkout/mensagens-do-cartao"
    );
    expect(categoriaDoServidor("dados_do_cartao")).toBe("dados");
    expect(categoriaDoServidor("sem_limite")).toBe("sem-limite");
    expect(categoriaDoServidor("banco_pediu_autorizacao")).toBe("autorizacao");
    expect(categoriaDoServidor("banco_pediu_confirmacao")).toBe("geral");
    expect(categoriaDoServidor("outra")).toBe("geral");
    for (const lixo of [undefined, null, 3, {}, "", "geral", "SEM_LIMITE"]) {
      expect(categoriaDoServidor(lixo)).toBeNull();
    }
  });
});
