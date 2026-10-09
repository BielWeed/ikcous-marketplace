// @vitest-environment jsdom
//
// Frente lote-b-telas-admin, tarefa T1 (12/09): a tela de Atendimento sai do
// padrão de seções colapsáveis e vira FORMULÁRIO DIRETO — direção B aprovada
// pelo dono (proposta em equipe/entregas/20260912-lote-b-propostas-glm,
// tela1-atendimento-B-formulario-direto.html). Três blocos numerados, todos
// abertos, zero controle de colapso, e o jargão vira texto de lojista
// ("Formato e Protocolo" morre; no lugar, o que acontece se deixar vazio).
//
// O MORADOR fica intacto — é o que este teste prende:
//   • campo vazio continua salvando NULL (o botão de WhatsApp some da loja);
//   • os 30 modelos prontos continuam preenchendo o editor com as tags
//     🏷️/💰/🔗;
//   • (A1, 09/10) o bloco "Horário de atendimento" virou leitura: sem campo e
//     sem `businessHours` no payload de salvar;
//   • o campo de telefone vira type="tel" com rótulo clicável, como manda a
//     qualidade de interface da direção B.
//
// ATUALIZAÇÃO do painel simples (D9/D11, 09/10/2026): a tela "Atendimento" foi
// apagada; o WhatsApp e a mensagem viraram o bloco Contato de Minha loja
// (`ContatoDaLoja`). O horário saiu daqui por inteiro (o editor único é o
// BusinessHoursSection, em Minha loja), então o bloco "Horário de atendimento"
// de leitura não existe mais; o resto do contrato segue de pé. O Salvar é
// próprio do bloco ("Salvar contato") e só liga com alteração.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const updateConfig = vi.fn(async () => true);
const { mockConfig } = vi.hoisted(() => ({
  mockConfig: {
    whatsappNumber: "5534999998888",
    businessHours: "",
    shareText: "Confira [nome] por [preco]: [link]",
  },
}));

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: mockConfig,
    isLoaded: true,
    updateConfig,
    refresh: vi.fn(),
    products: [],
  }),
}));
vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));
vi.mock("@/lib/supabase", () => ({ supabase: {} }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: "u1" } }) }));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function esperar(ms = 0): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("Minha loja › Contato — formulário direto (direção B)", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    vi.restoreAllMocks();
  });

  async function abrirTela() {
    const { ContatoDaLoja } = await import(
      "@/components/admin/minha-loja/ContatoDaLoja"
    );
    await act(async () => {
      raiz.render(<ContatoDaLoja />);
    });
    await act(async () => {
      await esperar(50);
    });
  }

  it("os dois blocos nascem à vista, sem controle de colapso", async () => {
    await abrirTela();

    // Dois blocos, nesta ordem (o horário saiu: é de BusinessHoursSection).
    expect(
      [...hospedeiro.querySelectorAll("h3")].map((h) => h.textContent),
    ).toEqual(["WhatsApp da loja", "Mensagem de compartilhamento"]);

    // Zero controle de colapso: nenhum botão de seção aqui.
    expect(hospedeiro.querySelectorAll("button[aria-expanded]")).toHaveLength(
      0,
    );

    // Tudo à vista de uma vez — nada escondido atrás de clique.
    expect(hospedeiro.querySelector("#settings-whatsapp")).not.toBeNull();
    // O horário não é editado aqui (A1): sem campo.
    expect(hospedeiro.querySelector("#settings-business-hours")).toBeNull();
    expect(
      hospedeiro.querySelector("#settings-share-message-editor"),
    ).not.toBeNull();

    // Jargão morto; no lugar, a consequência em português de lojista.
    const texto = hospedeiro.textContent ?? "";
    expect(texto).not.toContain("Formato e Protocolo");
    expect(texto).toContain("botão de WhatsApp some da loja");

    // O botão Salvar do bloco existe (desligado enquanto nada mudou).
    const salvar = [...hospedeiro.querySelectorAll("button")].find((b) =>
      (b.textContent ?? "").includes("Salvar"),
    ) as HTMLButtonElement;
    expect(salvar).toBeTruthy();
    expect(salvar.disabled).toBe(true);
  });

  it("campo de telefone é tel com autocomplete e rótulo clicável", async () => {
    await abrirTela();

    const campo = hospedeiro.querySelector(
      "#settings-whatsapp",
    ) as HTMLInputElement;
    expect(campo.getAttribute("type")).toBe("tel");
    expect(campo.getAttribute("autocomplete")).toBe("tel");

    const rotulo = hospedeiro.querySelector(
      'label[for="settings-whatsapp"]',
    ) as HTMLLabelElement;
    expect(rotulo).toBeTruthy();
    expect(rotulo.textContent).toContain("Número do WhatsApp");
  });

  it("modelo pronto continua preenchendo o editor com as tags", async () => {
    await abrirTela();

    const abrirModelos = [...hospedeiro.querySelectorAll("button")].find((b) =>
      (b.textContent ?? "").includes("Modelos prontos"),
    ) as HTMLButtonElement;
    expect(abrirModelos).toBeTruthy();
    await act(async () => {
      abrirModelos.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await esperar(400);
    });

    // O painel abre no portal do body, com a lista de modelos.
    const modelo = [...document.querySelectorAll("button")].find((b) =>
      (b.textContent ?? "").includes("Oferta Quente"),
    ) as HTMLButtonElement;
    expect(modelo).toBeTruthy();
    await act(async () => {
      modelo.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await esperar(400);
    });

    const editor = hospedeiro.querySelector(
      "#settings-share-message-editor",
    ) as HTMLDivElement;
    expect(editor.innerHTML).toContain('data-tag="nome"');
    expect(editor.innerHTML).toContain('data-tag="preco"');
    expect(editor.innerHTML).toContain('data-tag="link"');

    // Aplicar fecha o painel (mesma saída de sempre — a animação de saída
    // do bottom sheet em spring precisa do seu tempo no jsdom).
    await act(async () => {
      await esperar(1200);
    });
    expect(
      [...document.querySelectorAll("button")].find((b) =>
        (b.textContent ?? "").includes("Oferta Quente"),
      ),
    ).toBeUndefined();
  });

  it("campo vazio continua salvando NULL (o botão de WhatsApp some da loja)", async () => {
    await abrirTela();

    const campo = hospedeiro.querySelector(
      "#settings-whatsapp",
    ) as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!;
    await act(async () => {
      campo.focus();
      setter.call(campo, "");
      campo.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      await esperar(500); // flush do LocalBufferedInput (350 ms)
    });

    const salvar = [...hospedeiro.querySelectorAll("button")].find((b) =>
      (b.textContent ?? "").includes("Salvar"),
    ) as HTMLButtonElement;
    expect(salvar.disabled).toBe(false);

    await act(async () => {
      salvar.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await esperar(50);
    });

    // Sem `businessHours` no payload (A1): salvar aqui nunca toca o horário.
    expect(updateConfig).toHaveBeenCalledWith(
      {
        whatsappNumber: null,
        shareText: "Confira [nome] por [preco]: [link]",
      },
      { silentSuccess: true },
    );
  });
});
