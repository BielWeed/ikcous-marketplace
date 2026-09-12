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
//   • o campo de telefone vira type="tel" com rótulo clicável, como manda a
//     qualidade de interface da direção B.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const updateConfig = vi.fn(async () => true);
const { mockConfig } = vi.hoisted(() => ({
  mockConfig: {
    whatsappNumber: "",
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

describe("Atendimento — formulário direto (direção B)", () => {
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
    const { AdminWhatsAppConfigView } = await import(
      "@/views/admin/AdminWhatsAppConfigView"
    );
    await act(async () => {
      raiz.render(<AdminWhatsAppConfigView active />);
    });
    await act(async () => {
      await esperar(50);
    });
  }

  it("os três blocos numerados nascem à vista, sem controle de colapso", async () => {
    await abrirTela();

    // Três blocos, nesta ordem, com a medalha do número de cada um.
    const blocos = [
      ...hospedeiro.querySelectorAll<HTMLElement>("section[aria-labelledby]"),
    ];
    expect(blocos.map((b) => b.querySelector("h2")?.textContent)).toEqual([
      "WhatsApp da loja",
      "Horário de atendimento",
      "Mensagem de compartilhamento",
    ]);
    expect(
      blocos.map((b) => b.querySelector("[data-numero]")?.textContent),
    ).toEqual(["1", "2", "3"]);

    // Zero controle de colapso: nenhum botão de seção nesta tela.
    expect(
      hospedeiro.querySelectorAll("button[aria-expanded]"),
    ).toHaveLength(0);

    // Tudo à vista de uma vez — nada escondido atrás de clique.
    expect(hospedeiro.querySelector("#settings-whatsapp")).not.toBeNull();
    expect(
      hospedeiro.querySelector("#settings-business-hours"),
    ).not.toBeNull();
    expect(
      hospedeiro.querySelector("#settings-share-message-editor"),
    ).not.toBeNull();

    // Jargão morto; no lugar, a consequência em português de lojista.
    const texto = hospedeiro.textContent ?? "";
    expect(texto).not.toContain("Formato e Protocolo");
    expect(texto).toContain("botão de WhatsApp some da loja");

    // O botão Salvar continua na linha do título.
    expect(
      [...hospedeiro.querySelectorAll("button")].find((b) =>
        (b.textContent ?? "").includes("Salvar"),
      ),
    ).toBeTruthy();
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

    const salvar = [...hospedeiro.querySelectorAll("button")].find(
      (b) => (b.textContent ?? "").includes("Salvar"),
    ) as HTMLButtonElement;
    expect(salvar.disabled).toBe(false);

    await act(async () => {
      salvar.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await esperar(50);
    });

    expect(updateConfig).toHaveBeenCalledWith({
      whatsappNumber: null,
      businessHours: null,
      shareText: "Confira [nome] por [preco]: [link]",
    });
  });
});
