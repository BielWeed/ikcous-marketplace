// @vitest-environment jsdom
//
// Buracos achados por caça de mutação em BusinessHoursSection (os testes
// antigos só exercitam o editor pela tela "Minha loja", onde o botão próprio
// não existe):
//  - "Salvar horário" e "Descartar horário" só ficam ligados com alteração;
//  - "Descartar" devolve o texto salvo (não apaga);
//  - enquanto grava, o painel é avisado que há pendência (não pode fechar);
//  - quem não é administrador não edita e não deixa pendência.
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

const { auth, updateConfig, toast } = vi.hoisted(() => ({
  auth: {
    atual: {
      user: { id: "admin-a" } as { id: string } | null,
      session: { user: { id: "admin-a" } } as {
        user: { id: string };
      } | null,
      isAdmin: true,
      adminStatus: "admin" as string,
    },
  },
  updateConfig: vi.fn(),
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
}));

vi.mock("@/hooks/useAuth", () => ({ useAuth: () => auth.atual }));
vi.mock("@/lib/env-valores", () => ({
  lerSupabaseUrl: () => "https://exemplo-de-teste.invalid",
  lerChaveSupabase: () => "chave-de-teste",
}));
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: { businessHours: "Ter a Sáb, 9h às 18h" },
    isLoaded: true,
    updateConfig,
  }),
}));
vi.mock("sonner", () => ({ toast }));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let raiz: Root;
let hospedeiro: HTMLDivElement;

beforeAll(async () => {
  await import("@/components/admin/settings/BusinessHoursSection");
}, 60_000);

beforeEach(() => {
  vi.clearAllMocks();
  auth.atual = {
    user: { id: "admin-a" },
    session: { user: { id: "admin-a" } },
    isAdmin: true,
    adminStatus: "admin",
  };
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
});

afterEach(() => {
  act(() => raiz.unmount());
  hospedeiro.remove();
});

async function montar(
  props: {
    onDirtyChange?: (d: boolean) => void;
    active?: boolean;
    onRegistrarSalvamento?: (e: {
      alterado: boolean;
      salvar: () => Promise<boolean>;
    }) => void;
  } = {},
) {
  const { BusinessHoursSection } = await import(
    "@/components/admin/settings/BusinessHoursSection"
  );
  await act(async () => {
    raiz.render(
      <BusinessHoursSection
        onDirtyChange={props.onDirtyChange ?? (() => {})}
        active={props.active}
        onRegistrarSalvamento={props.onRegistrarSalvamento}
      />,
    );
  });
}

const campo = () =>
  hospedeiro.querySelector<HTMLInputElement>("#store-business-hours");
const botao = (texto: string) =>
  Array.from(hospedeiro.querySelectorAll("button")).find(
    (b) => b.textContent?.trim() === texto,
  );

async function digitar(valor: string) {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )?.set;
  await act(async () => {
    setter?.call(campo(), valor);
    campo()?.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("editor avulso do horário (sem a tela Minha loja)", () => {
  it("nasce com o horário salvo e com Salvar e Descartar travados", async () => {
    await montar();
    expect(campo()?.value).toBe("Ter a Sáb, 9h às 18h");
    expect(botao("Salvar horário")?.disabled).toBe(true);
    expect(botao("Descartar horário")?.disabled).toBe(true);
  });

  it("alterar liga os dois botões; Descartar devolve o texto salvo e trava de novo", async () => {
    await montar();
    await digitar("Seg a Sex, 8h às 12h");
    expect(botao("Salvar horário")?.disabled).toBe(false);
    expect(botao("Descartar horário")?.disabled).toBe(false);

    await act(async () => {
      botao("Descartar horário")?.click();
    });
    expect(campo()?.value).toBe("Ter a Sáb, 9h às 18h");
    expect(botao("Salvar horário")?.disabled).toBe(true);
    expect(botao("Descartar horário")?.disabled).toBe(true);
  });

  it("falha ao gravar mantém o texto, avisa, e Descartar limpa o aviso", async () => {
    updateConfig.mockResolvedValue(false);
    await montar();
    await digitar("Seg a Sex, 8h às 12h");
    await act(async () => {
      botao("Salvar horário")?.click();
    });
    expect(hospedeiro.querySelector('[role="alert"]')?.textContent).toContain(
      "Não foi possível confirmar que o horário foi salvo",
    );
    expect(campo()?.value).toBe("Seg a Sex, 8h às 12h");
    expect(toast.success).not.toHaveBeenCalled();

    await act(async () => {
      botao("Descartar horário")?.click();
    });
    expect(hospedeiro.querySelector('[role="alert"]')).toBeNull();
  });

  it("gravação com sucesso avisa e deixa o editor limpo", async () => {
    updateConfig.mockResolvedValue(true);
    await montar();
    await digitar("  Seg a Sex, 8h às 12h  ");
    await act(async () => {
      botao("Salvar horário")?.click();
    });
    expect(updateConfig).toHaveBeenCalledWith(
      { businessHours: "Seg a Sex, 8h às 12h" },
      { isCurrent: expect.any(Function), silent: true },
    );
    expect(toast.success).toHaveBeenCalledWith("Horário de atendimento salvo");
    expect(botao("Salvar horário")?.disabled).toBe(true);
  });
});

describe("pendência avisada ao painel", () => {
  it("enquanto a gravação não responde, o painel continua avisado (não pode fechar)", async () => {
    let terminar: (v: boolean) => void = () => {};
    updateConfig.mockReturnValue(
      new Promise<boolean>((r) => {
        terminar = r;
      }),
    );
    const onDirtyChange = vi.fn();
    await montar({ onDirtyChange });
    await digitar("Seg a Sex, 8h às 12h");
    await act(async () => {
      botao("Salvar horário")?.click();
    });
    expect(onDirtyChange).toHaveBeenLastCalledWith(true);
    expect(campo()?.disabled).toBe(true);

    await act(async () => {
      terminar(true);
    });
    expect(onDirtyChange).toHaveBeenLastCalledWith(false);
  });
});

describe("pendência com o salvar() do pai sem texto alterado", () => {
  it("o painel fica avisado enquanto a gravação não responde, mesmo sem alteração no texto", async () => {
    let terminar: (v: boolean) => void = () => {};
    updateConfig.mockReturnValue(
      new Promise<boolean>((r) => {
        terminar = r;
      }),
    );
    const onDirtyChange = vi.fn();
    const registrar = vi.fn();
    await montar({ onDirtyChange, onRegistrarSalvamento: registrar });
    const ultimo = registrar.mock.calls.at(-1)?.[0] as {
      salvar: () => Promise<boolean>;
    };
    expect(onDirtyChange).toHaveBeenLastCalledWith(false);
    let pendente: Promise<boolean> = Promise.resolve(false);
    await act(async () => {
      pendente = ultimo.salvar();
    });
    expect(onDirtyChange).toHaveBeenLastCalledWith(true);
    await act(async () => {
      terminar(true);
      await pendente;
    });
    expect(onDirtyChange).toHaveBeenLastCalledWith(false);
  });
});

describe("dentro da tela Minha loja (salvamento registrado)", () => {
  it("não mostra o botão próprio e entrega salvar() ao pai", async () => {
    updateConfig.mockResolvedValue(true);
    const registrar = vi.fn();
    await montar({ onRegistrarSalvamento: registrar });
    expect(botao("Salvar horário")).toBeUndefined();
    expect(botao("Descartar horário")).toBeDefined();

    await digitar("Seg a Sex, 8h às 12h");
    const ultimo = registrar.mock.calls.at(-1)?.[0] as {
      alterado: boolean;
      salvar: () => Promise<boolean>;
    };
    expect(ultimo.alterado).toBe(true);
    let resultado = false;
    await act(async () => {
      resultado = await ultimo.salvar();
    });
    expect(resultado).toBe(true);
    expect(updateConfig).toHaveBeenCalledTimes(1);
  });

  it("com a aba inativa, salvar() recusa e não chama o servidor", async () => {
    const registrar = vi.fn();
    await montar({ onRegistrarSalvamento: registrar, active: false });
    const ultimo = registrar.mock.calls.at(-1)?.[0] as {
      salvar: () => Promise<boolean>;
    };
    let resultado = true;
    await act(async () => {
      resultado = await ultimo.salvar();
    });
    expect(resultado).toBe(false);
    expect(updateConfig).not.toHaveBeenCalled();
    expect(campo()?.disabled).toBe(true);
  });
});

describe("permissão", () => {
  it.each([
    ["não é admin", { isAdmin: false }],
    ["status de admin não confirmado", { adminStatus: "pendente" }],
    ["sem usuário", { user: null }],
    ["sessão de outro usuário", { session: { user: { id: "outra-pessoa" } } }],
  ])(
    "%s: não mostra o editor e não deixa pendência",
    async (_nome, mudanca) => {
      auth.atual = { ...auth.atual, ...mudanca };
      const onDirtyChange = vi.fn();
      await montar({ onDirtyChange });
      expect(campo()).toBeNull();
      expect(hospedeiro.querySelector('[role="alert"]')?.textContent).toBe(
        "Entre como administrador para editar o horário.",
      );
      expect(onDirtyChange).toHaveBeenLastCalledWith(false);
    },
  );
});
