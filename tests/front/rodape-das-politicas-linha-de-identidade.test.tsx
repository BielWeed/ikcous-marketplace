// @vitest-environment jsdom
//
// A linha de identidade do rodapé da vitrine, medida pelo que a cliente LÊ.
// Os testes vizinhos (`politicas-identidade-legal`) conferem que razão social
// e documento aparecem, mas não a FORMA da linha, e achamos por mutação que:
// - trocar o separador " · " por qualquer outra coisa passava despercebido;
// - o rótulo "CPF" nunca era conferido (só o do CNPJ);
// - só com e-mail, o rodapé deixava um parágrafo vazio no lugar do nome.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RodapeDasPoliticas } from "@/components/politicas/RodapeDasPoliticas";
import type { IdentidadeLegalDaLoja } from "@/lib/identidade-legal-da-loja";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("RodapeDasPoliticas — a linha de identidade que a cliente lê", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
  });

  async function montar(identidade: IdentidadeLegalDaLoja | null) {
    await act(async () => {
      raiz.render(
        <RodapeDasPoliticas onNavigate={vi.fn()} identidade={identidade} />,
      );
    });
    return hospedeiro.querySelector<HTMLElement>(
      '[data-testid="rodape-identidade-legal"]',
    );
  }

  it("razão social e CNPJ viram UMA linha separada por ponto médio", async () => {
    const bloco = await montar({
      razaoSocial: "Loja da Ana Ltda",
      tipoDoDocumento: "cnpj",
      documento: "11.222.333/0001-81",
      email: null,
    });
    expect(bloco?.querySelector("p")?.textContent).toBe(
      "Loja da Ana Ltda · CNPJ 11.222.333/0001-81",
    );
  });

  it("com CPF o rótulo é CPF (nunca CNPJ)", async () => {
    const bloco = await montar({
      razaoSocial: "Ana Souza",
      tipoDoDocumento: "cpf",
      documento: "529.982.247-25",
      email: null,
    });
    expect(bloco?.querySelector("p")?.textContent).toBe(
      "Ana Souza · CPF 529.982.247-25",
    );
    expect(bloco?.textContent).not.toContain("CNPJ");
  });

  it("só o documento (sem razão social): a linha é só 'CNPJ …', sem separador solto", async () => {
    const bloco = await montar({
      razaoSocial: null,
      tipoDoDocumento: "cnpj",
      documento: "11.222.333/0001-81",
      email: null,
    });
    expect(bloco?.querySelector("p")?.textContent).toBe(
      "CNPJ 11.222.333/0001-81",
    );
  });

  it("só e-mail: o bloco tem o link e NENHUM parágrafo vazio", async () => {
    const bloco = await montar({
      razaoSocial: null,
      tipoDoDocumento: null,
      documento: null,
      email: "oi@loja.com",
    });
    expect(bloco).not.toBeNull();
    expect(bloco?.querySelector("p")).toBeNull();
    expect(
      bloco?.querySelector('a[href="mailto:oi@loja.com"]')?.textContent,
    ).toBe("oi@loja.com");
  });

  it("identidade vazia (nada preenchido): o bloco inteiro não existe", async () => {
    const bloco = await montar({
      razaoSocial: null,
      tipoDoDocumento: null,
      documento: null,
      email: null,
    });
    expect(bloco).toBeNull();
  });
});
