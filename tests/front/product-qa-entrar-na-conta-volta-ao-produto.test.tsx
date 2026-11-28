// @vitest-environment jsdom
//
// "ENTRAR NA CONTA" DAS PERGUNTAS AO VENDEDOR LEVAVA AO PERFIL.
//
// O botão abria o login sem dizer de onde vinha; depois de entrar, a pessoa
// caía no Perfil em vez de voltar ao produto que estava vendo. Agora o login
// guarda o produto pedido (`requested: "product-detail"` + `id`) e o App
// (`destinoPosLogin`) leva de volta a ele.
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

import { destinoPosLogin } from "@/lib/destinoPosLogin";

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: null, profile: null, isAdmin: false }),
}));

// Sem vi.importActual: o módulo real cria um client Supabase só de ser
// importado (mesmo comentário de product-qa-edit-prefill.test.tsx).
vi.mock("@/hooks/useQuestions", () => ({
  useQuestions: () => ({
    questions: [],
    loading: false,
    getQuestionsByProduct: vi.fn(),
    addQuestion: vi.fn(),
    addAnswer: vi.fn(),
    subscribeToQuestions: () => () => {},
  }),
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("ProductQA — 'Entrar na Conta' volta ao produto", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let ProductQA: typeof import("@/components/ui/custom/ProductQA").ProductQA;

  beforeAll(async () => {
    ({ ProductQA } = await import("@/components/ui/custom/ProductQA"));
  }, 15000);

  beforeEach(() => {
    globalThis.history.replaceState(null, "", "/product-detail?id=prod-9");
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

  it("o login nasce pedindo o produto, e destinoPosLogin devolve product-detail com o id", async () => {
    await act(async () => {
      raiz.render(<ProductQA productId="prod-9" />);
    });
    const botao = [...hospedeiro.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("Entrar na Conta"),
    );
    expect(botao).toBeDefined();
    await act(async () => {
      botao!.click();
    });

    expect(globalThis.location.pathname).toBe("/auth");
    expect(globalThis.history.state).toMatchObject({
      view: "auth",
      requested: "product-detail",
      id: "prod-9",
    });
    expect(destinoPosLogin(globalThis.history.state)).toBe("product-detail");
  });

  // Caça "voltar do navegador" (27/11/2026): o login aberto daqui nascia sem
  // `from` nem `haEntradaAntes` — os dois campos que o App grava em todo
  // login que ELE abre (handleNavigate). Sem eles, depois de entrar, a troca
  // da entrada de login não sabia que a tela atrás era o produto: o destino
  // ficava sem `from` e o Voltar ia ao Início em vez de voltar de onde a
  // pessoa chegou ao produto.
  async function clicarEmEntrar() {
    await act(async () => {
      raiz.render(<ProductQA productId="prod-9" />);
    });
    const botao = [...hospedeiro.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("Entrar na Conta"),
    );
    expect(botao).toBeDefined();
    await act(async () => {
      botao!.click();
    });
  }

  it("produto aberto de uma tela do app: o login grava from e haEntradaAntes=true", async () => {
    globalThis.history.replaceState(
      { view: "product-detail", id: "prod-9", from: "home" },
      "",
      "/product-detail?id=prod-9",
    );
    await clicarEmEntrar();

    expect(globalThis.history.state).toMatchObject({
      view: "auth",
      from: "product-detail",
      haEntradaAntes: true,
    });
  });

  it("produto aberto por link direto (sem from): haEntradaAntes=false", async () => {
    globalThis.history.replaceState(
      { view: "product-detail", id: "prod-9" },
      "",
      "/product-detail?id=prod-9",
    );
    await clicarEmEntrar();

    expect(globalThis.history.state).toMatchObject({
      view: "auth",
      from: "product-detail",
      haEntradaAntes: false,
    });
  });
});
