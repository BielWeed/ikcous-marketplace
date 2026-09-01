// @vitest-environment jsdom
//
// Laudo 0109 (A-8) — `navigator.clipboard.writeText(x)` era chamado sem
// await e sem catch, e a tela já comemorava ("Copiado!" verde, toast de
// sucesso) mesmo quando a cópia FALHAVA (permissão negada, janela sem foco,
// contexto não seguro). O util novo é o juiz: devolve true só quando a
// cópia de verdade aconteceu.
//
// Teste de unidade — quem DECIDE ok/fracasso é o util; as telas (pontos de
// uso) têm prova própria em ficha-do-pedido-copiar-endereco-falha-avisa
// e admin-cupom-copiar-codigo-falha-avisa.
import { copiarParaClipboard } from "@/lib/copiar-para-clipboard";
import { afterEach, describe, expect, it, vi } from "vitest";

function stubClipboard(writeText: (texto: string) => Promise<void>) {
  const clipboardStub: {
    writeText: (texto: string) => Promise<void>;
  } = { writeText };
  Object.defineProperty(window.navigator, "clipboard", {
    value: clipboardStub,
    configurable: true,
  });
}

afterEach(() => {
  Reflect.deleteProperty(window.navigator, "clipboard");
});

describe("copiarParaClipboard — não finge sucesso (laudo 0109, A-8)", () => {
  it("clipboard aceita: devolve true e copiou o texto pedido", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    stubClipboard(writeText);

    await expect(copiarParaClipboard("Rua das Flores, 123")).resolves.toBe(
      true,
    );
    expect(writeText).toHaveBeenCalledWith("Rua das Flores, 123");
  });

  it("clipboard recusa (NotAllowedError etc.): devolve false, não lança", async () => {
    stubClipboard(vi.fn().mockRejectedValue(new Error("NotAllowedError")));

    await expect(copiarParaClipboard("qualquer")).resolves.toBe(false);
  });

  it("sem navigator.clipboard (contexto não seguro): devolve false, não lança", async () => {
    // jsdom não define navigator.clipboard — exatamente o cenário de um
    // navegador onde a API não existe: o acesso já estoura, e o util tem
    // de transformar isso em `false`, não em exceção estourando na tela.
    Reflect.deleteProperty(window.navigator, "clipboard");

    await expect(copiarParaClipboard("qualquer")).resolves.toBe(false);
  });
});
