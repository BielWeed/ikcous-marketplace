// @vitest-environment jsdom
//
// Testa o componente `LeitorDeCodigo` (tarefa C2.3) isolado do hook —
// `useLeitorDeCodigo` é MOCKADO por completo: este arquivo prova que o
// componente RENDERIZA certo para cada estado do hook e que ele CHAMA
// `tentarDeNovo`/`lerCodigoDigitado`/`aoFechar` nos lugares certos. A prova
// de que `lerCodigoDigitado` de verdade desemboca em `aoLer` já é feita no
// teste do hook (tests/front/leitor-de-codigo-hook.test.tsx, caso 12) — não
// duplicamos a câmera aqui, este arquivo é sobre o componente BURRO.
//
// Sem `@testing-library/react` (não instalado): `createRoot` + `act` do
// React puro, mesmo padrão da casa.
import { LeitorDeCodigo } from "@/components/admin/pdv/LeitorDeCodigo";
import type { LeitorDeCodigoEmUso } from "@/hooks/useLeitorDeCodigo";
import { useLeitorDeCodigo } from "@/hooks/useLeitorDeCodigo";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público — mesmo padrão
// usado em outros testes de componente deste projeto.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@/hooks/useLeitorDeCodigo", () => ({
  useLeitorDeCodigo: vi.fn(),
}));

const hookMockado = vi.mocked(useLeitorDeCodigo);

function resultadoPadrao(
  parcial: Partial<LeitorDeCodigoEmUso> = {},
): LeitorDeCodigoEmUso {
  return {
    estado: "lendo",
    erro: null,
    motor: "nativo",
    ultimaLeitura: null,
    refDoVideo: { current: null },
    tentarDeNovo: vi.fn(),
    lerCodigoDigitado: vi.fn(),
    ...parcial,
  };
}

describe("LeitorDeCodigo (componente)", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    hookMockado.mockReturnValue(resultadoPadrao());
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    vi.clearAllMocks();
  });

  async function montar(props: Parameters<typeof LeitorDeCodigo>[0]) {
    await act(async () => {
      raiz.render(<LeitorDeCodigo {...props} />);
    });
  }

  it("13. aberto: existe <video> muted/playsInline/autoPlay e uma região aria-live polite", async () => {
    await montar({ aberto: true, aoLer: vi.fn(), aoFechar: vi.fn() });

    const video = document.querySelector("video") as HTMLVideoElement | null;
    expect(video).not.toBeNull();
    expect(video?.muted).toBe(true);
    expect(video?.autoplay).toBe(true);
    expect((video as unknown as { playsInline: boolean })?.playsInline).toBe(
      true,
    );

    const regiao = document.querySelector('[aria-live="polite"]');
    expect(regiao).not.toBeNull();
  });

  it("14. depois de uma leitura, a região aria-live contém o código lido", async () => {
    hookMockado.mockReturnValue(
      resultadoPadrao({
        ultimaLeitura: { codigo: "7891000315507", formato: "ean_13" },
      }),
    );

    await montar({ aberto: true, aoLer: vi.fn(), aoFechar: vi.fn() });

    const regiao = document.querySelector('[aria-live="polite"]');
    expect(regiao?.textContent).toBe("Código lido: 7891000315507");
  });

  it("15. erro de permissão: aparece role=alert com a frase e o botão Tentar de novo", async () => {
    const tentarDeNovo = vi.fn();
    hookMockado.mockReturnValue(
      resultadoPadrao({
        estado: "erro",
        motor: null,
        erro: {
          origem: "permissao_negada",
          mensagem:
            "Você precisa permitir o acesso à câmera para ler o código. Libere a câmera nas configurações do navegador ou do aparelho e toque em Tentar de novo.",
        },
        tentarDeNovo,
      }),
    );

    await montar({ aberto: true, aoLer: vi.fn(), aoFechar: vi.fn() });

    const alerta = document.querySelector('[role="alert"]');
    expect(alerta).not.toBeNull();
    expect(alerta?.textContent).toContain(
      "Você precisa permitir o acesso à câmera para ler o código.",
    );

    const botoes = Array.from(document.querySelectorAll("button"));
    const botaoTentarDeNovo = botoes.find(
      (b) => b.textContent?.trim() === "Tentar de novo",
    );
    expect(botaoTentarDeNovo).toBeDefined();

    act(() => {
      botaoTentarDeNovo?.click();
    });
    expect(tentarDeNovo).toHaveBeenCalledTimes(1);
  });

  it("16. 'Digitar o código' revela o campo; submeter chama lerCodigoDigitado com o valor digitado", async () => {
    const lerCodigoDigitado = vi.fn();
    hookMockado.mockReturnValue(resultadoPadrao({ lerCodigoDigitado }));

    await montar({ aberto: true, aoLer: vi.fn(), aoFechar: vi.fn() });

    expect(document.querySelector("form")).toBeNull();

    const botoes = Array.from(document.querySelectorAll("button"));
    const botaoDigitar = botoes.find(
      (b) => b.textContent?.trim() === "Digitar o código",
    );
    expect(botaoDigitar).toBeDefined();

    act(() => {
      botaoDigitar?.click();
    });

    const campo = document.querySelector(
      "#codigo-de-barras-manual",
    ) as HTMLInputElement | null;
    expect(campo).not.toBeNull();
    const rotulo = document.querySelector(
      'label[for="codigo-de-barras-manual"]',
    );
    expect(rotulo?.textContent).toBe("Código de barras");

    act(() => {
      const setValor = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value",
      )?.set;
      setValor?.call(campo, "7891000315507");
      campo?.dispatchEvent(new Event("input", { bubbles: true }));
    });

    const form = document.querySelector("form") as HTMLFormElement;
    act(() => {
      form.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true }),
      );
    });

    expect(lerCodigoDigitado).toHaveBeenCalledWith("7891000315507");
  });

  it("17. 'Fechar' chama aoFechar", async () => {
    const aoFechar = vi.fn();
    await montar({ aberto: true, aoLer: vi.fn(), aoFechar });

    const botoes = Array.from(document.querySelectorAll("button"));
    const botaoFechar = botoes.find((b) => b.textContent?.trim() === "Fechar");
    expect(botaoFechar).toBeDefined();

    act(() => {
      botaoFechar?.click();
    });
    expect(aoFechar).toHaveBeenCalledTimes(1);
  });

  it("18. aberto={false}: não renderiza vídeo nenhum, e o hook recebe ativo:false (solta a câmera)", async () => {
    await montar({ aberto: false, aoLer: vi.fn(), aoFechar: vi.fn() });

    expect(document.querySelector("video")).toBeNull();
    // Fechado, o componente também solta o TECLADO: sem `lerTeclado: false`
    // o hook (padrão true, efeito sem `ativo`) seguiria ouvindo keydown em
    // document e disparando aoLer com o componente renderizando null.
    expect(hookMockado).toHaveBeenCalledWith(
      expect.objectContaining({ ativo: false, lerTeclado: false }),
    );
  });
});
