// O código interno (SKU) automático do produto: só um valor de TEXTO gerado no
// cliente, que o servidor já aceita pelas regras de hoje (letras, números e
// hífen; o código do PRODUTO pode repetir, o de cada VARIAÇÃO é único na loja
// e a grade confere isso por conta própria). Aqui, só a conta.
import {
  ALFABETO_DO_CODIGO,
  montarCodigoAutomatico,
  prefixoDoCodigo,
  sufixoDoCodigo,
  sufixoLivre,
} from "@/utils/sku-automatico";
import { describe, expect, it } from "vitest";

const FORMATO_ACEITO_PELO_FORMULARIO = /^[A-Z0-9-]+$/;

describe("prefixoDoCodigo", () => {
  it("usa as 3 primeiras letras da categoria, sem acento e em maiúsculas", () => {
    expect(prefixoDoCodigo("Camisetas", "Qualquer nome")).toBe("CAM");
    expect(prefixoDoCodigo("Calçados", "")).toBe("CAL");
    expect(prefixoDoCodigo("Ação & Aventura", "")).toBe("ACA");
  });

  it("sem categoria, cai para a primeira palavra do nome", () => {
    expect(prefixoDoCodigo("", "Vestido longo azul")).toBe("VES");
    expect(prefixoDoCodigo("   ", "  bolsa de couro")).toBe("BOL");
  });

  it("categoria curta ou só com símbolos não quebra", () => {
    expect(prefixoDoCodigo("Mu", "")).toBe("MU");
    expect(prefixoDoCodigo("###", "Tênis")).toBe("TEN");
  });

  it("sem categoria nem nome com letra, usa PRD", () => {
    expect(prefixoDoCodigo("", "")).toBe("PRD");
    expect(prefixoDoCodigo("--", "!!")).toBe("PRD");
  });

  it("aceita número no começo e nunca devolve caractere fora do formato", () => {
    expect(prefixoDoCodigo("3D Print", "")).toBe("3DP");
    expect(prefixoDoCodigo("Água/Sabão", "")).toMatch(
      FORMATO_ACEITO_PELO_FORMULARIO,
    );
  });
});

describe("sufixoDoCodigo", () => {
  it("tem 4 caracteres do alfabeto legível (sem 0, O, 1, I)", () => {
    const sufixo = sufixoDoCodigo();
    expect(sufixo).toHaveLength(4);
    for (const letra of sufixo) {
      expect(ALFABETO_DO_CODIGO).toContain(letra);
    }
    expect(ALFABETO_DO_CODIGO).not.toMatch(/[01OI]/);
  });

  it("é determinístico quando o sorteio é conhecido", () => {
    let i = 0;
    const sorteio = () => i++;
    expect(sufixoDoCodigo(sorteio)).toBe(
      [0, 1, 2, 3].map((n) => ALFABETO_DO_CODIGO[n]).join(""),
    );
  });
});

describe("montarCodigoAutomatico", () => {
  it("junta prefixo e sufixo com hífen e passa na validação do formulário", () => {
    const codigo = montarCodigoAutomatico("CAM", "7K3F");
    expect(codigo).toBe("CAM-7K3F");
    expect(codigo).toMatch(FORMATO_ACEITO_PELO_FORMULARIO);
  });
});

describe("sufixoLivre", () => {
  it("pula o sufixo cujo código já está ocupado (sem diferenciar caixa)", () => {
    const fila = ["AAAA", "BBBB", "CCCC"];
    // Sorteio que devolve sempre o próximo índice da fila.
    const sufixos = fila[Symbol.iterator]();
    const sortear = () => sufixos.next().value as string;
    const sufixo = sufixoLivre("CAM", ["cam-aaaa", "CAM-BBBB"], sortear);
    expect(sufixo).toBe("CCCC");
  });

  it("depois de muitas tentativas ocupadas devolve mesmo assim um sufixo válido", () => {
    // Tudo ocupado: não pode ficar em laço infinito nem devolver vazio.
    const sufixo = sufixoLivre("CAM", ["CAM-ZZZZ"], () => "ZZZZ");
    expect(sufixo).toHaveLength(4);
  });

  it("lista vazia de ocupados devolve o primeiro sorteio", () => {
    expect(sufixoLivre("CAM", [], () => "A2B3")).toBe("A2B3");
  });
});
