// @vitest-environment jsdom
//
// Buracos achados por caça de mutação em PoliticaDeDevolucaoSection (os
// testes antigos passavam mesmo com o defeito de uma linha plantado):
//  - o aviso "com tudo desligado" some se uma das duas listas de métodos esvazia;
//  - sem a linha id=1 no banco a tela usa os padrões (7/30/90), não erro;
//  - categoria que já estava salva com outra caixa de letra sai da lista ao
//    desmarcar, em vez de ficar duplicada;
//  - resposta estranha do servidor avisa e RELÊ a política do banco;
//  - "Salva em <data>" só aparece com a tela sem alteração pendente;
//  - ao fechar a tela com alteração pendente, o painel é avisado que não há mais.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const { rpc, maybeSingle, toast } = vi.hoisted(() => ({
  rpc: vi.fn(),
  maybeSingle: vi.fn(),
  toast: Object.assign(vi.fn(), {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
  }),
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    rpc,
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle }) }),
    }),
  },
}));
vi.mock("@/hooks/useCategories", () => ({
  useCategories: () => ({
    categories: [
      { id: "c-1", name: "Moda íntima" },
      { id: "c-2", name: "Calçados" },
    ],
  }),
}));
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: { storeAddress: "Rua de Teste, 1" },
    isLoaded: true,
    updateConfig: vi.fn(),
  }),
}));
vi.mock("sonner", () => ({ toast }));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const LINHA = {
  id: 1,
  prazo_arrependimento_dias: 7,
  prazo_troca_dias: 30,
  prazo_vicio_dias: 90,
  aceita_troca: true,
  aceita_vale: true,
  exige_fotos_vicio: true,
  metodos_locais: ["entrega_na_loja", "coleta"],
  metodos_nacionais: ["etiqueta_reversa", "envio_proprio"],
  reembolso_momento: "ao_receber",
  frete_troca_pago_por: "cliente",
  categorias_sem_troca: [] as string[],
  texto_politica: null,
  endereco_devolucao: null,
  updated_at: "2026-09-26T10:00:00Z",
  updated_by: null,
};

let raiz: Root;
let hospedeiro: HTMLDivElement;
const onDirtyMudou = vi.fn();

beforeAll(async () => {
  await import("@/components/admin/settings/PoliticaDeDevolucaoSection");
}, 60_000);

beforeEach(() => {
  vi.clearAllMocks();
  maybeSingle.mockResolvedValue({ data: LINHA, error: null });
  rpc.mockImplementation(
    (_nome: string, args: { p: Record<string, unknown> }) =>
      Promise.resolve({ data: { ...LINHA, ...args.p }, error: null }),
  );
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
});

afterEach(() => {
  act(() => raiz.unmount());
  hospedeiro.remove();
});

async function montar(offline = false) {
  const { PoliticaDeDevolucaoSection } = await import(
    "@/components/admin/settings/PoliticaDeDevolucaoSection"
  );
  await act(async () => {
    raiz.render(
      <PoliticaDeDevolucaoSection
        onDirtyMudou={onDirtyMudou}
        isOffline={offline}
      />,
    );
  });
  await act(async () => {
    for (let i = 0; i < 6; i++) await Promise.resolve();
  });
}

async function digitar(id: string, valor: string) {
  const campo = hospedeiro.querySelector<HTMLInputElement>(`#${id}`);
  expect(campo).toBeTruthy();
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )?.set;
  await act(async () => {
    campo?.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    setter?.call(campo, valor);
    campo?.dispatchEvent(new Event("input", { bubbles: true }));
    campo?.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
  });
}

function botao(texto: string) {
  return Array.from(hospedeiro.querySelectorAll("button")).find(
    (b) => b.textContent?.trim() === texto,
  );
}

async function esperar() {
  await act(async () => {
    for (let i = 0; i < 6; i++) await Promise.resolve();
  });
}

const FRASE_DO_AVISO = "o direito do cliente continua";

describe("aviso 'com tudo desligado' da política de devolução", () => {
  it("aparece quando só a lista dos pedidos locais ficou vazia", async () => {
    maybeSingle.mockResolvedValue({
      data: { ...LINHA, metodos_locais: [] },
      error: null,
    });
    await montar();
    expect(hospedeiro.textContent).toContain(FRASE_DO_AVISO);
  });

  it("aparece quando só a lista dos pedidos nacionais ficou vazia", async () => {
    maybeSingle.mockResolvedValue({
      data: { ...LINHA, metodos_nacionais: [] },
      error: null,
    });
    await montar();
    expect(hospedeiro.textContent).toContain(FRASE_DO_AVISO);
  });

  it("não aparece com as duas listas preenchidas", async () => {
    await montar();
    expect(hospedeiro.textContent).not.toContain(FRASE_DO_AVISO);
  });
});

describe("política que ainda não existe no banco", () => {
  it("usa os padrões 7/30/90 e os interruptores de fábrica, sem acusar erro de leitura", async () => {
    maybeSingle.mockResolvedValue({ data: null, error: null });
    await montar();

    expect(hospedeiro.textContent).not.toContain(
      "Não consegui carregar a política de devolução.",
    );
    const valor = (id: string) =>
      hospedeiro.querySelector<HTMLInputElement>(`#${id}`)?.value;
    expect(valor("politica-arrependimento")).toBe("7");
    expect(valor("politica-troca")).toBe("30");
    expect(valor("politica-vicio")).toBe("90");
    const ligado = (rotulo: string) =>
      hospedeiro
        .querySelector(`[role="switch"][aria-label="${rotulo}"]`)
        ?.getAttribute("aria-checked");
    expect(ligado("Troca por tamanho ou gosto")).toBe("true");
    expect(ligado("Vale-troca")).toBe("true");
    expect(ligado("Exigir fotos em caso de defeito")).toBe("true");
    expect(botao("O cliente paga")?.getAttribute("aria-pressed")).toBe("true");
    expect(botao("A loja paga")?.getAttribute("aria-pressed")).toBe("false");
    // Sem linha lida a tela está limpa: nada a salvar.
    expect(botao("Política salva")?.disabled).toBe(true);
  });

  it("mexer num prazo envia só esse prazo (o resto vem do padrão, não de uma cópia vazia)", async () => {
    maybeSingle.mockResolvedValue({ data: null, error: null });
    await montar();
    await digitar("politica-troca", "45");
    await act(async () => {
      botao("Salvar política")?.click();
    });
    await esperar();
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("salvar_politica_de_devolucao", {
      p: { prazo_troca_dias: 45 },
    });
  });
});

describe("categorias sem troca por gosto", () => {
  it("desmarcar tira da lista a categoria salva com outra caixa de letra, sem duplicar", async () => {
    maybeSingle.mockResolvedValue({
      data: { ...LINHA, categorias_sem_troca: ["calçados"] },
      error: null,
    });
    await montar();
    // As duas grafias aparecem como botão e as duas contam como marcadas.
    expect(botao("calçados")?.getAttribute("aria-pressed")).toBe("true");
    expect(botao("Calçados")?.getAttribute("aria-pressed")).toBe("true");

    await act(async () => {
      botao("Calçados")?.click();
    });
    // A grafia só-minúscula sai da lista e, por não ser categoria da loja,
    // some da tela; a da loja fica desmarcada.
    expect(botao("calçados")).toBeUndefined();
    expect(botao("Calçados")?.getAttribute("aria-pressed")).toBe("false");

    await act(async () => {
      botao("Salvar política")?.click();
    });
    await esperar();
    // a lista vai com a versão que a tela VIU (`vistos`): o banco recusa se outro aparelho a mudou
    expect(rpc).toHaveBeenCalledWith("salvar_politica_de_devolucao", {
      p: {
        categorias_sem_troca: [],
        vistos: { categorias_sem_troca: ["calçados"] },
      },
    });
  });
});

describe("resposta estranha ao salvar", () => {
  it("avisa que foi enviada, NÃO comemora e relê a política do banco", async () => {
    await montar();
    expect(maybeSingle).toHaveBeenCalledTimes(1);
    await digitar("politica-arrependimento", "10");
    rpc.mockResolvedValueOnce({ data: { lixo: true }, error: null });
    maybeSingle.mockResolvedValue({
      data: { ...LINHA, prazo_arrependimento_dias: 12 },
      error: null,
    });

    await act(async () => {
      botao("Salvar política")?.click();
    });
    await esperar();

    expect(toast.error).toHaveBeenCalledExactlyOnceWith(
      "A política foi enviada, mas a resposta veio estranha. Recarregue para conferir.",
    );
    expect(toast.success).not.toHaveBeenCalled();
    // A releitura trouxe o que o banco tem (12), no lugar do rascunho (10).
    expect(maybeSingle).toHaveBeenCalledTimes(2);
    expect(
      hospedeiro.querySelector<HTMLInputElement>("#politica-arrependimento")
        ?.value,
    ).toBe("12");
    expect(botao("Política salva")?.disabled).toBe(true);
  });
});

describe("data do último salvamento", () => {
  it("aparece com a tela limpa e some enquanto há alteração pendente", async () => {
    await montar();
    const hora = hospedeiro.querySelector("time");
    expect(hora?.getAttribute("datetime")).toBe("2026-09-26T10:00:00Z");

    await digitar("politica-arrependimento", "10");
    expect(hospedeiro.querySelector("time")).toBeNull();
  });

  it("não mostra data quando a do banco é ilegível", async () => {
    maybeSingle.mockResolvedValue({
      data: { ...LINHA, updated_at: "isto-nao-e-data" },
      error: null,
    });
    await montar();
    expect(hospedeiro.querySelector("time")).toBeNull();
  });
});

describe("aviso de alteração pendente ao painel", () => {
  it("fechar a tela com alteração pendente avisa que não há mais pendência", async () => {
    await montar();
    await digitar("politica-arrependimento", "10");
    expect(onDirtyMudou).toHaveBeenLastCalledWith(true);

    await act(async () => {
      raiz.unmount();
    });
    expect(onDirtyMudou).toHaveBeenLastCalledWith(false);
    // O afterEach desmonta de novo: recria a raiz para não estourar.
    raiz = createRoot(hospedeiro);
  });
});

describe("sem internet", () => {
  it("o botão de salvar fica travado e nada é enviado, mesmo com alteração feita", async () => {
    await montar(true);
    await digitar("politica-arrependimento", "10");
    const salvar = botao("Salvar política");
    expect(salvar?.disabled).toBe(true);
    await act(async () => {
      salvar?.click();
    });
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("prazos digitados com espaço nas pontas (funções puras)", () => {
  it("espaço antes ou depois do número não vira 'Informe o número de dias'", async () => {
    const { erroDaTroca, erroDoArrependimento, erroDoVicio } = await import(
      "@/components/admin/settings/PoliticaDeDevolucaoSection"
    );
    expect(erroDoArrependimento(" 10 ")).toBeNull();
    expect(erroDaTroca(" 0 ")).toBeNull();
    expect(erroDoVicio(" 45 ", " 10 ")).toBeNull();
    // E o que não é número inteiro continua recusado.
    expect(erroDoArrependimento("1 0")).toBe("Informe o número de dias.");
    expect(erroDoArrependimento("7,5")).toBe("Informe o número de dias.");
  });
});
