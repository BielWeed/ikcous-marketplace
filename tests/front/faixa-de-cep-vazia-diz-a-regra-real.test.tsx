// @vitest-environment jsdom
//
// FAIXA DE CEP VAZIA: o painel diz a regra REAL do servidor (14/10/2026).
//
// Com a faixa vazia, o servidor (banco `is_local_cep`, edge calculate-shipping
// e `cepEhLocal`) só compara os 5 PRIMEIROS números do CEP da cliente com os
// do CEP da loja. Em cidade de CEP único (38500-000) isso é a cidade inteira;
// em cidade com CEP por rua (loja 38400-100, cliente 38408-100) NÃO é. O
// painel dizia "vazio = cidade inteira" e o lojista novo nunca percebia.
import { act } from "react";

import { type Root, createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";

import { FreteLocalBloco } from "@/components/admin/shipping/FreteLocalBloco";
import {
  avisoDaFaixaDeCep,
  dicaDaFaixaVazia,
  prefixoDoCepDaLoja,
} from "@/lib/loja-pronta";

describe("prefixoDoCepDaLoja", () => {
  it("devolve os 5 primeiros números, com ou sem hífen", () => {
    expect(prefixoDoCepDaLoja("38400-100")).toBe("38400");
    expect(prefixoDoCepDaLoja("38400100")).toBe("38400");
  });
  it("sem CEP completo devolve null", () => {
    expect(prefixoDoCepDaLoja("")).toBeNull();
    expect(prefixoDoCepDaLoja(undefined)).toBeNull();
    expect(prefixoDoCepDaLoja("384")).toBeNull();
  });
});

describe("dicaDaFaixaVazia", () => {
  it("com CEP da loja cita os 5 números", () => {
    expect(dicaDaFaixaVazia("38400-100")).toBe(
      "Vazio = só CEPs que começam com 38400",
    );
  });
  it("sem CEP da loja usa o texto genérico", () => {
    expect(dicaDaFaixaVazia(null)).toBe(
      "Vazio = só CEPs que começam com os mesmos 5 números do CEP da loja",
    );
  });
});

describe("avisoDaFaixaDeCep (pendência da loja pronta)", () => {
  it("loja 38400-100 com faixa vazia → avisa, com o prefixo", () => {
    const aviso = avisoDaFaixaDeCep({
      originCep: "38400-100",
      localCepRange: "",
    });
    expect(aviso).toBe(
      "Sua entrega local só vale para CEPs que começam com 38400. Se sua cidade tem vários CEPs, escolha até onde você entrega",
    );
  });
  it("faixa só com espaços também conta como vazia", () => {
    expect(
      avisoDaFaixaDeCep({ originCep: "38400100", localCepRange: "   " }),
    ).not.toBeNull();
    expect(avisoDaFaixaDeCep({ originCep: "38400100" })).not.toBeNull();
  });
  it("loja 38500-000 (CEP geral da cidade) com faixa vazia → sem aviso", () => {
    expect(
      avisoDaFaixaDeCep({ originCep: "38500-000", localCepRange: "" }),
    ).toBeNull();
  });
  it("faixa preenchida → sem aviso", () => {
    expect(
      avisoDaFaixaDeCep({
        originCep: "38400-100",
        localCepRange: "38400-000, 38415-999",
      }),
    ).toBeNull();
  });
  it("sem CEP completo da loja → sem aviso (outro passo já cobra)", () => {
    expect(avisoDaFaixaDeCep({ originCep: "", localCepRange: "" })).toBeNull();
    expect(avisoDaFaixaDeCep({ originCep: "384" })).toBeNull();
  });
});

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

describe("FreteLocalBloco diz a regra real", () => {
  let raiz: Root | null = null;
  let host: HTMLElement | null = null;
  afterEach(() => {
    act(() => raiz?.unmount());
    host?.remove();
    raiz = null;
    host = null;
  });

  function desenhar(cepDaLoja: string | null, faixa: string): string {
    host = document.createElement("div");
    document.body.appendChild(host);
    raiz = createRoot(host);
    act(() => {
      raiz?.render(
        <FreteLocalBloco
          valor={0}
          onValor={() => {}}
          faixa={faixa}
          onFaixa={() => {}}
          coverage="national"
          onCoverage={() => {}}
          cidade="Uberlândia"
          uf="MG"
          cepDaLoja={cepDaLoja}
        />,
      );
    });
    return host.textContent ?? "";
  }

  it("não promete mais a cidade inteira e cita os 5 números da loja", () => {
    const texto = desenhar("38400-100", "");
    expect(texto).not.toContain("inteira");
    expect(texto).toContain("Vazio = só CEPs que começam com 38400");
    expect(texto).toContain("escolha até onde você entrega");
  });

  it("faixa preenchida: sem o aviso", () => {
    const texto = desenhar("38400-100", "38400-000, 38415-999");
    expect(texto).not.toContain("escolha até onde você entrega");
  });

  it("CEP geral da cidade: dica sem o aviso", () => {
    const texto = desenhar("38500-000", "");
    expect(texto).toContain("Vazio = só CEPs que começam com 38500");
    expect(texto).not.toContain("escolha até onde você entrega");
  });
});
