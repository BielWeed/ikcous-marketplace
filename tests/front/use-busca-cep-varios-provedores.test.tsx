// @vitest-environment jsdom
//
// `useBuscaCep` com cadeia de provedores (ViaCEP -> OpenCEP -> AwesomeAPI).
//
// O DEFEITO (dono, 03/10/2026): "o CEP da tela de endereço não tá pegando pra
// todo lugar". Medido: o ViaCEP sozinho não acha 13% dos CEPs que existem
// (CEPs novos, ruas que ele não indexou) e responde `{"erro":"true"}` igual
// a um CEP digitado errado — a cliente via "CEP não encontrado" para um CEP
// verdadeiro. Estes testes provam que o próximo provedor é consultado, que
// "não encontrado" só sai quando TODOS dizem que não existe, e que as
// guardas de #184 (corrida), #185 (timeout) e #186 (desmonte) valem em cada
// tentativa da cadeia.
//
// Mesmo padrão de use-busca-cep.test.tsx: sem `@testing-library/react`,
// `createRoot` + `act`, componente sonda mínimo.
import {
  TIMEOUT_BUSCA_CEP_MS,
  TIMEOUT_TENTATIVA_CEP_MS,
  useBuscaCep,
} from "@/hooks/useBuscaCep";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const MSG_NAO_ENCONTRADO = "CEP não encontrado";
const MSG_FALHA =
  "Não foi possível buscar o CEP agora. Preencha o endereço manualmente.";
const MSG_DEMOROU =
  "A busca de CEP demorou demais. Preencha o endereço manualmente.";

type Provedor = "viacep" | "opencep" | "awesome";
type Comportamento = (
  cep: string,
  signal: AbortSignal | undefined,
) => Promise<unknown>;

function resposta(corpo: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(corpo),
  };
}

function qualProvedor(url: string): Provedor {
  if (url.includes("viacep.com.br")) return "viacep";
  if (url.includes("opencep.com")) return "opencep";
  if (url.includes("cep.awesomeapi.com.br")) return "awesome";
  throw new Error(`host inesperado na busca de CEP: ${url}`);
}

function cepDaUrl(url: string): string {
  return /(\d{8})/.exec(url)?.[1] ?? "";
}

/** Nunca responde; só rejeita quando a requisição é abortada. */
const pendurado: Comportamento = (_cep, signal) =>
  new Promise((_resolve, reject) => {
    signal?.addEventListener("abort", () => reject(signal.reason));
  });

const ENDERECO_PAULISTA = {
  cep: "01310-100",
  logradouro: "Avenida Paulista",
  bairro: "Bela Vista",
  localidade: "São Paulo",
  uf: "SP",
};
const ENDERECO_PAULISTA_LIDO = {
  logradouro: "Avenida Paulista",
  bairro: "Bela Vista",
  localidade: "São Paulo",
  uf: "SP",
};

const NAO_EXISTE: Record<Provedor, Comportamento> = {
  viacep: () => Promise.resolve(resposta({ erro: "true" })),
  opencep: () => Promise.resolve(resposta({ error: true }, 404)),
  awesome: () =>
    Promise.resolve(
      resposta({ code: "not_found", message: "O CEP nao foi encontrado" }, 404),
    ),
};

function Sonda({
  aoEncontrar,
}: {
  aoEncontrar: (e: unknown) => void;
}) {
  const { buscando, buscar } = useBuscaCep(aoEncontrar);
  return (
    <div>
      <span data-testid="buscando">{String(buscando)}</span>
      <button
        type="button"
        data-testid="buscar-a"
        onClick={() => buscar("40020000")}
      >
        a
      </button>
      <button
        type="button"
        data-testid="buscar-b"
        onClick={() => buscar("01310100")}
      >
        b
      </button>
    </div>
  );
}

describe("useBuscaCep — cadeia de provedores", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let chamadas: { provedor: Provedor; cep: string }[];
  let abortadas: { provedor: Provedor; cep: string }[];

  function usarProvedores(comportamentos: Record<Provedor, Comportamento>) {
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string, init?: { signal?: AbortSignal }) => {
        const provedor = qualProvedor(url);
        const cep = cepDaUrl(url);
        chamadas.push({ provedor, cep });
        init?.signal?.addEventListener("abort", () =>
          abortadas.push({ provedor, cep }),
        );
        const comportamento =
          provedor === "viacep"
            ? comportamentos.viacep
            : provedor === "opencep"
              ? comportamentos.opencep
              : comportamentos.awesome;
        return comportamento(cep, init?.signal);
      }),
    );
  }

  async function esvaziar() {
    await act(async () => {
      for (let i = 0; i < 30; i++) await Promise.resolve();
    });
  }

  function clicar(id: string) {
    act(() => {
      (
        document.querySelector(`[data-testid="${id}"]`) as HTMLButtonElement
      ).click();
    });
  }

  function buscando(): string {
    return (document.querySelector('[data-testid="buscando"]') as HTMLElement)
      .textContent as string;
  }

  async function montar(aoEncontrar = vi.fn()) {
    await act(async () => {
      raiz.render(<Sonda aoEncontrar={aoEncontrar} />);
    });
    return aoEncontrar;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    chamadas = [];
    abortadas = [];
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("ViaCEP acha: para ali — o CEP não vai para os outros provedores", async () => {
    const { toast } = await import("sonner");
    usarProvedores({
      viacep: () => Promise.resolve(resposta(ENDERECO_PAULISTA)),
      opencep: NAO_EXISTE.opencep,
      awesome: NAO_EXISTE.awesome,
    });
    const aoEncontrar = await montar();

    clicar("buscar-b");
    await esvaziar();

    expect(chamadas.map((c) => c.provedor)).toEqual(["viacep"]);
    expect(aoEncontrar).toHaveBeenCalledWith(ENDERECO_PAULISTA_LIDO);
    expect(toast.success).toHaveBeenCalledWith("CEP localizado!");
    expect(buscando()).toBe("false");
  });

  it("O DEFEITO: ViaCEP diz que 40020-000 não existe, OpenCEP acha — a cliente recebe o endereço", async () => {
    const { toast } = await import("sonner");
    usarProvedores({
      viacep: NAO_EXISTE.viacep,
      opencep: () =>
        Promise.resolve(
          resposta({
            cep: "40020-000",
            logradouro: "Rua Chile",
            complemento: "",
            bairro: "Centro",
            localidade: "Salvador",
            uf: "BA",
          }),
        ),
      awesome: NAO_EXISTE.awesome,
    });
    const aoEncontrar = await montar();

    clicar("buscar-a");
    await esvaziar();

    expect(chamadas.map((c) => c.provedor)).toEqual(["viacep", "opencep"]);
    expect(aoEncontrar).toHaveBeenCalledTimes(1);
    expect(aoEncontrar).toHaveBeenCalledWith({
      logradouro: "Rua Chile",
      bairro: "Centro",
      localidade: "Salvador",
      uf: "BA",
    });
    expect(toast.success).toHaveBeenCalledWith("CEP localizado!");
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("CEP novo que só o AwesomeAPI conhece: chega ao terceiro e normaliza a rua", async () => {
    usarProvedores({
      viacep: NAO_EXISTE.viacep,
      opencep: NAO_EXISTE.opencep,
      awesome: () =>
        Promise.resolve(
          resposta({
            cep: "14015150",
            address: "Rua Doutor Celestino, 183",
            district: "Centro",
            city: "Niterói",
            state: "RJ",
          }),
        ),
    });
    const aoEncontrar = await montar();

    clicar("buscar-a");
    await esvaziar();

    expect(chamadas.map((c) => c.provedor)).toEqual([
      "viacep",
      "opencep",
      "awesome",
    ]);
    expect(aoEncontrar).toHaveBeenCalledWith({
      logradouro: "Rua Doutor Celestino",
      bairro: "Centro",
      localidade: "Niterói",
      uf: "RJ",
    });
  });

  it("CEP único de cidade que só o fallback acha: devolve cidade/UF com rua e bairro vazios (a cliente completa à mão)", async () => {
    usarProvedores({
      viacep: NAO_EXISTE.viacep,
      opencep: () =>
        Promise.resolve(
          resposta({
            cep: "38500-000",
            logradouro: "",
            complemento: "",
            bairro: "",
            localidade: "Monte Carmelo",
            uf: "MG",
          }),
        ),
      awesome: NAO_EXISTE.awesome,
    });
    const aoEncontrar = await montar();

    clicar("buscar-a");
    await esvaziar();

    expect(aoEncontrar).toHaveBeenCalledWith({
      logradouro: "",
      bairro: "",
      localidade: "Monte Carmelo",
      uf: "MG",
    });
  });

  it('"não encontrado" só quando TODOS os provedores dizem que não existe', async () => {
    const { toast } = await import("sonner");
    usarProvedores(NAO_EXISTE);
    const aoEncontrar = await montar();

    clicar("buscar-a");
    await esvaziar();

    expect(chamadas.map((c) => c.provedor)).toEqual([
      "viacep",
      "opencep",
      "awesome",
    ]);
    expect(toast.error).toHaveBeenCalledTimes(1);
    expect(toast.error).toHaveBeenCalledWith(MSG_NAO_ENCONTRADO);
    expect(aoEncontrar).not.toHaveBeenCalled();
    expect(buscando()).toBe("false");
  });

  it('um "não existe" misturado com provedor fora do ar NÃO vira "CEP não encontrado" (o ViaCEP erra isso 13% das vezes)', async () => {
    const { toast } = await import("sonner");
    usarProvedores({
      viacep: NAO_EXISTE.viacep,
      opencep: () => Promise.resolve(resposta("<html>erro</html>", 500)),
      awesome: NAO_EXISTE.awesome,
    });
    const aoEncontrar = await montar();

    clicar("buscar-a");
    await esvaziar();

    expect(toast.error).toHaveBeenCalledTimes(1);
    expect(toast.error).toHaveBeenCalledWith(MSG_FALHA);
    expect(aoEncontrar).not.toHaveBeenCalled();
    expect(buscando()).toBe("false");
  });

  it("falha de rede em TODOS: o aviso de falha de sempre, uma vez só, e o spinner desliga", async () => {
    const { toast } = await import("sonner");
    const cai: Comportamento = () =>
      Promise.reject(new TypeError("Failed to fetch"));
    usarProvedores({ viacep: cai, opencep: cai, awesome: cai });
    const aoEncontrar = await montar();

    clicar("buscar-a");
    await esvaziar();

    expect(chamadas).toHaveLength(3);
    expect(toast.error).toHaveBeenCalledTimes(1);
    expect(toast.error).toHaveBeenCalledWith(MSG_FALHA);
    expect(aoEncontrar).not.toHaveBeenCalled();
    expect(buscando()).toBe("false");
  });

  it("ViaCEP fora do ar (500 com HTML) e o seguinte acha: usa o seguinte, sem tentar .json() no corpo do 500", async () => {
    const jsonDo500 = vi.fn(() => Promise.reject(new SyntaxError("<")));
    usarProvedores({
      viacep: () =>
        Promise.resolve({ ok: false, status: 500, json: jsonDo500 }),
      opencep: () => Promise.resolve(resposta(ENDERECO_PAULISTA)),
      awesome: NAO_EXISTE.awesome,
    });
    const aoEncontrar = await montar();

    clicar("buscar-b");
    await esvaziar();

    expect(jsonDo500).not.toHaveBeenCalled();
    expect(aoEncontrar).toHaveBeenCalledWith(ENDERECO_PAULISTA_LIDO);
  });

  it("200 com corpo que não é JSON (portal cativo) conta como falha daquele provedor e a cadeia segue", async () => {
    usarProvedores({
      viacep: () =>
        Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.reject(new SyntaxError("Unexpected token <")),
        }),
      opencep: () => Promise.resolve(resposta(ENDERECO_PAULISTA)),
      awesome: NAO_EXISTE.awesome,
    });
    const aoEncontrar = await montar();

    clicar("buscar-b");
    await esvaziar();

    expect(aoEncontrar).toHaveBeenCalledWith(ENDERECO_PAULISTA_LIDO);
  });

  it("404 com corpo que não é o 'não existe' do provedor (HTML de proxy) é falha, não 'CEP não encontrado'", async () => {
    const { toast } = await import("sonner");
    const html404: Comportamento = () =>
      Promise.resolve({
        ok: false,
        status: 404,
        json: () => Promise.reject(new SyntaxError("<")),
      });
    usarProvedores({
      viacep: NAO_EXISTE.viacep,
      opencep: html404,
      awesome: html404,
    });
    await montar();

    clicar("buscar-a");
    await esvaziar();

    expect(toast.error).toHaveBeenCalledWith(MSG_FALHA);
    expect(toast.error).not.toHaveBeenCalledWith(MSG_NAO_ENCONTRADO);
  });

  it("#185 por tentativa: ViaCEP pendura, estoura em TIMEOUT_TENTATIVA e o OpenCEP é consultado", async () => {
    vi.useFakeTimers();
    usarProvedores({
      viacep: pendurado,
      opencep: () => Promise.resolve(resposta(ENDERECO_PAULISTA)),
      awesome: NAO_EXISTE.awesome,
    });
    const aoEncontrar = await montar();

    clicar("buscar-b");
    expect(chamadas.map((c) => c.provedor)).toEqual(["viacep"]);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(TIMEOUT_TENTATIVA_CEP_MS);
    });

    expect(abortadas).toEqual([{ provedor: "viacep", cep: "01310100" }]);
    expect(chamadas.map((c) => c.provedor)).toEqual(["viacep", "opencep"]);
    expect(aoEncontrar).toHaveBeenCalledWith(ENDERECO_PAULISTA_LIDO);
    expect(buscando()).toBe("false");
  });

  it("#185 teto: todos penduram — para no teto geral, aborta tudo, avisa 'demorou demais' e não passa de 3 tentativas", async () => {
    vi.useFakeTimers();
    const { toast } = await import("sonner");
    usarProvedores({
      viacep: pendurado,
      opencep: pendurado,
      awesome: pendurado,
    });
    const aoEncontrar = await montar();

    clicar("buscar-a");
    expect(buscando()).toBe("true");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(TIMEOUT_BUSCA_CEP_MS);
    });

    expect(chamadas.map((c) => c.provedor)).toEqual([
      "viacep",
      "opencep",
      "awesome",
    ]);
    expect(abortadas.map((c) => c.provedor)).toEqual([
      "viacep",
      "opencep",
      "awesome",
    ]);
    expect(toast.error).toHaveBeenCalledTimes(1);
    expect(toast.error).toHaveBeenCalledWith(MSG_DEMOROU);
    expect(aoEncontrar).not.toHaveBeenCalled();
    expect(buscando()).toBe("false");

    // Nada mais acontece depois do teto.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(TIMEOUT_BUSCA_CEP_MS);
    });
    expect(chamadas).toHaveLength(3);
    expect(toast.error).toHaveBeenCalledTimes(1);
  });

  it("o teto geral não passa do que a cliente já esperava: TIMEOUT_BUSCA_CEP_MS continua 8000 e a tentativa é menor que ele", () => {
    expect(TIMEOUT_BUSCA_CEP_MS).toBe(8000);
    expect(TIMEOUT_TENTATIVA_CEP_MS).toBeLessThan(TIMEOUT_BUSCA_CEP_MS);
  });

  it("#186 desmonte NO MEIO da cadeia: aborta a tentativa em voo, não consulta o próximo provedor e não emite toast", async () => {
    const { toast } = await import("sonner");
    usarProvedores({
      viacep: NAO_EXISTE.viacep,
      opencep: pendurado,
      awesome: NAO_EXISTE.awesome,
    });
    const aoEncontrar = await montar();

    clicar("buscar-a");
    await esvaziar();
    expect(chamadas.map((c) => c.provedor)).toEqual(["viacep", "opencep"]);

    await act(async () => {
      raiz.unmount();
    });
    await esvaziar();

    expect(abortadas).toEqual([{ provedor: "opencep", cep: "40020000" }]);
    expect(chamadas.map((c) => c.provedor)).toEqual(["viacep", "opencep"]);
    expect(aoEncontrar).not.toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();
    expect(console.error).not.toHaveBeenCalled();

    // Recria a raiz para o `afterEach` não desmontar duas vezes.
    hospedeiro.remove();
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  it("#184 corrida NO MEIO da cadeia: a busca velha cai no fallback, a nova assume — só a nova chama aoEncontrar e a velha não segue para o terceiro", async () => {
    usarProvedores({
      viacep: (cep) =>
        Promise.resolve(
          cep === "01310100"
            ? resposta(ENDERECO_PAULISTA)
            : resposta({ erro: "true" }),
        ),
      opencep: pendurado,
      awesome: NAO_EXISTE.awesome,
    });
    const aoEncontrar = await montar();

    clicar("buscar-a"); // velha: ViaCEP não acha, fica pendurada no OpenCEP
    await esvaziar();
    expect(chamadas.map((c) => c.provedor)).toEqual(["viacep", "opencep"]);

    clicar("buscar-b"); // nova: ViaCEP acha
    await esvaziar();

    expect(abortadas).toEqual([{ provedor: "opencep", cep: "40020000" }]);
    expect(chamadas.filter((c) => c.provedor === "awesome")).toEqual([]);
    expect(aoEncontrar).toHaveBeenCalledTimes(1);
    expect(aoEncontrar).toHaveBeenCalledWith(ENDERECO_PAULISTA_LIDO);
    expect(buscando()).toBe("false");
  });

  it("resposta que chega DEPOIS de a busca ter sido superada (mock que ignora o abort) não chama aoEncontrar nem desliga o spinner da nova", async () => {
    const liberarVelha: { fn: ((v: unknown) => void) | null } = { fn: null };
    usarProvedores({
      viacep: (cep) => {
        if (cep === "40020000") {
          // a velha: resposta que não reage ao abort
          return new Promise((resolve) => {
            liberarVelha.fn = resolve;
          });
        }
        return new Promise(() => {}); // a nova: segue em voo
      },
      opencep: NAO_EXISTE.opencep,
      awesome: NAO_EXISTE.awesome,
    });
    const aoEncontrar = await montar();

    clicar("buscar-a");
    clicar("buscar-b");
    expect(buscando()).toBe("true");

    liberarVelha.fn?.(resposta({ erro: "true" }));
    await esvaziar();

    // A velha teria seguido para o OpenCEP; superada, para.
    expect(chamadas.filter((c) => c.provedor === "opencep")).toEqual([]);
    expect(aoEncontrar).not.toHaveBeenCalled();
    expect(buscando()).toBe("true");
  });
});
