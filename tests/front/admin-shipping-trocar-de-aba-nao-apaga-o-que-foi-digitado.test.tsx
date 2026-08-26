// @vitest-environment jsdom
//
// Trocar de aba do painel não pode apagar o que o lojista digitou.
//
// Achado 3 da auditoria rodada 2 (26/08/2026). O efeito de sincronização com o
// config (`AdminShippingView.tsx:151-173`) faz `setFormData({...config})` sem
// nenhuma guarda, e depende de `[isLoaded, config, active, fetchShippingCreds]`.
// Como a view do painel NUNCA desmonta (o `DeferredTabContent` a mantém viva) e
// `active` volta a `true` toda vez que a aba reativa, o caminho
// Frete → Pedidos → Frete reescrevia o formulário inteiro com o valor salvo e
// jogava fora o que a pessoa tinha acabado de digitar. Sem aviso nenhum.
//
// O que torna isto um defeito e não uma escolha: o componente JÁ SABE que há
// alteração pendente — calcula `isFormDirty` e reporta ao pai em `:262`. O
// efeito de reset simplesmente não consultava o valor que está ali do lado.
//
// A ARMADILHA DESTE CONSERTO, e por isso ela está escrita aqui: a primeira
// sincronização NÃO pode ser bloqueada. O `formData` nasce com valores neutros
// (`freeShippingMin: 0`, `originCep: ""`), então numa loja configurada o
// formulário já nasce "sujo" em relação ao config — guardar o efeito só com
// `isFormDirty` faria a tela NUNCA carregar os valores salvos. Por isso a
// guarda é "já sincronizei uma vez E o lojista mexeu", nunca só a segunda
// parte. O terceiro teste deste arquivo é o que prende essa metade.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const updateConfig = vi.fn();

// `atual` guarda a IDENTIDADE do objeto de config, não só os valores. Isso
// importa: o efeito sob teste depende de `config` na lista de dependências, e
// o React compara por identidade. Um mock que MUTA o mesmo objeto nunca faz o
// efeito redisparar — o teste passaria sem exercitar nada. Custou uma rodada
// verde-por-acaso para perceber; trocar a config agora é sempre um objeto novo.
const { estadoDaLoja } = vi.hoisted(() => ({
  estadoDaLoja: {
    atual: {
      originCep: "38400-000" as string | undefined,
      freeShippingMin: 150,
      enabledShippingMethods: ["sedex", "pac"] as string[],
    },
  },
}));

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: estadoDaLoja.atual,
    isLoaded: true,
    updateConfig,
  }),
}));

vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => ({
      select: () => Promise.resolve({ data: [], error: null }),
    }),
    functions: { invoke: vi.fn() },
  },
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function esperarMicrotarefas(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe("AdminShippingView — trocar de aba não apaga o que foi digitado", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
    estadoDaLoja.atual = {
      originCep: "38400-000",
      freeShippingMin: 150,
      enabledShippingMethods: ["sedex", "pac"],
    };
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

  async function renderizar(active: boolean) {
    const { AdminShippingView } = await import(
      "@/views/admin/AdminShippingView"
    );
    await act(async () => {
      raiz.render(<AdminShippingView active={active} onSetDirty={vi.fn()} />);
    });
    await act(async () => {
      await esperarMicrotarefas();
    });
  }

  function pegarCampoCep(): HTMLInputElement {
    const campo = hospedeiro.querySelector("#origin-cep") as HTMLInputElement;
    expect(campo).not.toBeNull();
    return campo;
  }

  // Escrever num input controlado por React em jsdom exige o setter nativo +
  // evento de input; atribuir `.value` direto não avisa o React.
  async function digitarNoCep(texto: string) {
    const campo = pegarCampoCep();
    const setter = Object.getOwnPropertyDescriptor(
      globalThis.HTMLInputElement.prototype,
      "value",
    )?.set;
    await act(async () => {
      setter?.call(campo, texto);
      campo.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }

  it("o CEP digitado sobrevive a sair da aba e voltar", async () => {
    await renderizar(true);
    expect(pegarCampoCep().value).toBe("38400-000");

    await digitarNoCep("11111000");
    expect(pegarCampoCep().value).toBe("11111-000");

    // O lojista vai para Pedidos (a aba de Frete fica viva, só inativa)...
    await renderizar(false);
    // ...e volta para Frete.
    await renderizar(true);

    // Contra o HEAD (843ca0a) esta asserção reprova: o efeito reescrevia o
    // formulário com "38400-000" e o trabalho da pessoa sumia.
    expect(pegarCampoCep().value).toBe("11111-000");
  });

  it("o CEP digitado sobrevive a uma atualização do config vinda de fora", async () => {
    await renderizar(true);
    await digitarNoCep("22222000");
    expect(pegarCampoCep().value).toBe("22222-000");

    // O StoreContext recebe uma config nova (realtime, outra aba, um save em
    // outra tela). OBJETO NOVO de propósito: é a identidade que faz o efeito
    // redisparar, e é isso que este teste precisa exercitar.
    estadoDaLoja.atual = { ...estadoDaLoja.atual, freeShippingMin: 999 };
    await renderizar(true);

    expect(pegarCampoCep().value).toBe("22222-000");
  });

  it("a PRIMEIRA carga continua trazendo o valor salvo (a guarda não pode travar isso)", async () => {
    // Sem esta prova, a guarda do conserto poderia bloquear a sincronização
    // inicial — o formulário nasce neutro e portanto "sujo" contra uma loja
    // configurada, e a tela abriria eternamente vazia.
    estadoDaLoja.atual = { ...estadoDaLoja.atual, originCep: "99999-000" };
    await renderizar(true);

    expect(pegarCampoCep().value).toBe("99999-000");
  });
});
