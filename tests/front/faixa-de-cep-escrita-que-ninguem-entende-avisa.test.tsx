// @vitest-environment jsdom
//
// "ALCANCE POR CEP" aceita texto livre, e a regra do servidor (banco
// `is_local_cep`, edge calculate-shipping e `cepEhLocal`) só entende UM
// formato: dois CEPs completos separados por vírgula ("38500-000, 38509-999").
// A lojista que escrevia "38500-000 a 38509-999" via "Configurações salvas" e
// depois nem o CEP da própria cidade tinha entrega local (14/10/2026).
//
// O conserto é um AVISO (nunca bloqueio: uma faixa legítima pode deixar de
// fora o CEP da loja), reaproveitando `cepEhLocal` como o oráculo: se nem o CEP
// da loja cai na faixa, a faixa não está sendo entendida. As três cópias da
// regra (SQL, edge, front) NÃO mudam.
import { act } from "react";

import { type Root, createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";

import { FreteLocalBloco } from "@/components/admin/shipping/FreteLocalBloco";
import { cepEhLocal } from "@/lib/cep-local";
import { avisoDaFaixaDeCep } from "@/lib/loja-pronta";

const CEP_DA_LOJA = "38500-000";
const NO_MEIO = "38505-100";
const FORMATO_QUE_FUNCIONA = "38500-000, 38509-999";

const ESCRITAS_NATURAIS_QUE_NAO_FUNCIONAM = [
  "38500-000 a 38509-999",
  "38500-000 até 38509-999",
  "38500-38509",
  "38500 a 38509",
  "38500-000; 38509-999",
  "38500-000 38509-999",
  "38500-000 / 38509-999",
];

const FRASE_DO_AVISO = "não está sendo entendido";

describe("o oráculo: a regra do servidor continua como está", () => {
  it("só o formato do placeholder cobre o CEP do meio da faixa", () => {
    expect(cepEhLocal(CEP_DA_LOJA, NO_MEIO, FORMATO_QUE_FUNCIONA)).toBe(true);
    for (const escrita of ESCRITAS_NATURAIS_QUE_NAO_FUNCIONAM) {
      expect(cepEhLocal(CEP_DA_LOJA, NO_MEIO, escrita), escrita).toBe(false);
      expect(cepEhLocal(CEP_DA_LOJA, CEP_DA_LOJA, escrita), escrita).toBe(
        false,
      );
    }
  });
});

describe("avisoDaFaixaDeCep: faixa escrita que o servidor não entende", () => {
  it.each(ESCRITAS_NATURAIS_QUE_NAO_FUNCIONAM)("avisa com %s", (escrita) => {
    const aviso = avisoDaFaixaDeCep({
      originCep: CEP_DA_LOJA,
      localCepRange: escrita,
    });
    expect(aviso).not.toBeNull();
    expect(aviso).toContain(FRASE_DO_AVISO);
    expect(aviso).toContain("nem o CEP da sua loja entra");
    // O aviso ensina o formato que funciona.
    expect(aviso).toContain("38500-000, 38509-999");
  });

  it("o formato do placeholder não avisa", () => {
    expect(
      avisoDaFaixaDeCep({
        originCep: CEP_DA_LOJA,
        localCepRange: FORMATO_QUE_FUNCIONA,
      }),
    ).toBeNull();
  });

  it("faixa de dois blocos longos (38500000-38509999) não avisa", () => {
    expect(
      avisoDaFaixaDeCep({
        originCep: CEP_DA_LOJA,
        localCepRange: "38500000-38509999",
      }),
    ).toBeNull();
  });

  it("faixa vazia: o comportamento de antes é preservado", () => {
    expect(
      avisoDaFaixaDeCep({ originCep: CEP_DA_LOJA, localCepRange: "" }),
    ).toBeNull();
    expect(
      avisoDaFaixaDeCep({ originCep: "38400-100", localCepRange: "  " }),
    ).toBe(
      "Sua entrega local só vale para CEPs que começam com 38400. Se sua cidade tem vários CEPs, escolha até onde você entrega",
    );
  });

  it("trocar o CEP da loja e esquecer a faixa antiga dispara o aviso", () => {
    expect(
      avisoDaFaixaDeCep({
        originCep: CEP_DA_LOJA,
        localCepRange: FORMATO_QUE_FUNCIONA,
      }),
    ).toBeNull();
    const depoisDeMudar = avisoDaFaixaDeCep({
      originCep: "01310-100",
      localCepRange: FORMATO_QUE_FUNCIONA,
    });
    expect(depoisDeMudar).not.toBeNull();
    expect(depoisDeMudar).toContain(FRASE_DO_AVISO);
  });

  it("sem CEP completo da loja não há como conferir: sem aviso", () => {
    expect(
      avisoDaFaixaDeCep({
        originCep: "",
        localCepRange: "38500-000 a 38509-999",
      }),
    ).toBeNull();
    expect(
      avisoDaFaixaDeCep({
        originCep: "385",
        localCepRange: "38500-000 a 38509-999",
      }),
    ).toBeNull();
  });
});

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

describe("FreteLocalBloco mostra o aviso e o formato", () => {
  let raiz: Root | null = null;
  let host: HTMLElement | null = null;
  afterEach(() => {
    act(() => raiz?.unmount());
    host?.remove();
    raiz = null;
    host = null;
  });

  function desenhar(cepDaLoja: string | null, faixa: string) {
    host = document.createElement("div");
    document.body.appendChild(host);
    raiz = createRoot(host);
    const aoMudar: string[] = [];
    act(() => {
      raiz?.render(
        <FreteLocalBloco
          valor={0}
          onValor={() => {}}
          faixa={faixa}
          onFaixa={(f) => aoMudar.push(f)}
          coverage="local"
          onCoverage={() => {}}
          cidade="Monte Carmelo"
          uf="MG"
          cepDaLoja={cepDaLoja}
        />,
      );
    });
    return { texto: host.textContent ?? "", aoMudar };
  }

  it.each(ESCRITAS_NATURAIS_QUE_NAO_FUNCIONAM)(
    "avisa na tela com %s, sem travar o campo",
    (escrita) => {
      const { texto } = desenhar(CEP_DA_LOJA, escrita);
      expect(texto).toContain(FRASE_DO_AVISO);
      const campo = host?.querySelector<HTMLInputElement>("#local-cep-range");
      expect(campo?.disabled).toBe(false);
      expect(campo?.value).toBe(escrita);
      expect(host?.querySelector('[role="note"]')).not.toBeNull();
    },
  );

  it("o formato do placeholder: sem aviso", () => {
    const { texto } = desenhar(CEP_DA_LOJA, FORMATO_QUE_FUNCIONA);
    expect(texto).not.toContain(FRASE_DO_AVISO);
  });

  it("faixa vazia numa loja de CEP geral: sem aviso nenhum", () => {
    const { texto } = desenhar(CEP_DA_LOJA, "");
    expect(texto).not.toContain(FRASE_DO_AVISO);
    expect(texto).not.toContain("escolha até onde você entrega");
  });

  it("o placeholder e a ajuda deixam o formato explícito", () => {
    const { texto } = desenhar(CEP_DA_LOJA, "");
    const campo = host?.querySelector<HTMLInputElement>("#local-cep-range");
    expect(campo?.placeholder).toBe("Ex: 38500-000, 38509-999");
    expect(texto).toContain("dois CEPs separados por vírgula");
  });
});
