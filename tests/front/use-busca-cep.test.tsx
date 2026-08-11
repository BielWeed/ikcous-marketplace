// @vitest-environment jsdom
//
// Testa o hook `useBuscaCep` isoladamente, sem os dois formulários que o
// consomem (AddressForm.tsx e o checkout de convidado em CheckoutView.tsx).
// Segue o padrão de address-form-cep-race.test.tsx: sem
// `@testing-library/react` (não instalado neste projeto), `createRoot` +
// `act` do React puro, e um componente sonda mínimo que expõe o estado do
// hook no DOM.
//
// Duas famílias de mock de `fetch`, como no arquivo de referência:
//
// - `mockFetchSimples`: ignora `AbortSignal` por completo — guarda o
//   resolver num mapa e só resolve quando o teste mandar. Usado nos casos
//   de corrida (#184), porque precisamos controlar a ORDEM de resolução
//   manualmente; se o mock reagisse ao abort, a busca "antiga" rejeitaria
//   sozinha assim que a busca nova chamasse `abort()`, e o teste nunca
//   chegaria a exercitar a guarda de sequência (foi o que aconteceu na
//   primeira versão deste arquivo — os 7 casos passavam mesmo com a guarda
//   de sequência removida do hook).
// - `mockFetchComSignal`: reage a `AbortSignal` de verdade — usado nos
//   casos que precisam provar que a requisição foi abortada (#185 timeout,
//   #186 desmonte).
import {
  type EnderecoDoCep,
  TIMEOUT_BUSCA_CEP_MS,
  formatarCep,
  useBuscaCep,
} from "@/hooks/useBuscaCep";
import { StrictMode, act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// O hook é dono dos toasts (ver a tarefa) — mocka `sonner` para poder
// asserir `toHaveBeenCalledWith` em vez de depender do comportamento real
// da lib de toast, que não tem `Toaster` montado neste teste.
vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

// @ts-expect-error flag interna do React, sem tipo público — mesmo padrão já
// usado em address-form-cep-race.test.tsx.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

type FetchResolver = (data: unknown) => void;

function extrairCep(url: string): string {
  return /viacep\.com\.br\/ws\/(\d+)\/json/.exec(url)?.[1] ?? "";
}

/** Componente sonda: só existe para montar o hook e expor o estado no DOM. */
function Sonda({
  aoEncontrar,
}: {
  aoEncontrar: (endereco: EnderecoDoCep) => void;
}) {
  const { buscando, buscar } = useBuscaCep(aoEncontrar);
  return (
    <div>
      <span data-testid="buscando">{String(buscando)}</span>
      <button
        type="button"
        data-testid="buscar-01310100"
        onClick={() => buscar("01310100")}
      >
        buscar velho
      </button>
      <button
        type="button"
        data-testid="buscar-38500000"
        onClick={() => buscar("38500000")}
      >
        buscar novo
      </button>
      <button
        type="button"
        data-testid="buscar-curto"
        onClick={() => buscar("123")}
      >
        buscar curto
      </button>
    </div>
  );
}

describe("useBuscaCep", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let pendentes: Map<string, FetchResolver>;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    pendentes = new Map();
    fetchMock = vi.fn((url: string) => {
      const cep = extrairCep(url);
      return new Promise((resolve) => {
        pendentes.set(cep, (data: unknown) =>
          resolve({ json: () => Promise.resolve(data) } as Response),
        );
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
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

  function clicar(testId: string) {
    const el = document.querySelector(
      `[data-testid="${testId}"]`,
    ) as HTMLButtonElement;
    el.click();
  }

  function buscando(): string {
    return (document.querySelector('[data-testid="buscando"]') as HTMLElement)
      .textContent as string;
  }

  it("caminho feliz: preenche o endereço e emite os toasts corretos", async () => {
    const { toast } = await import("sonner");
    const aoEncontrar = vi.fn();

    await act(async () => {
      raiz.render(<Sonda aoEncontrar={aoEncontrar} />);
    });

    act(() => {
      clicar("buscar-01310100");
    });
    expect(buscando()).toBe("true");
    expect(pendentes.size).toBe(1);

    pendentes.get("01310100")!({
      logradouro: "Avenida Paulista",
      bairro: "Bela Vista",
      localidade: "São Paulo",
      uf: "SP",
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(aoEncontrar).toHaveBeenCalledWith({
      logradouro: "Avenida Paulista",
      bairro: "Bela Vista",
      localidade: "São Paulo",
      uf: "SP",
    });
    expect(toast.success).toHaveBeenCalledWith("CEP localizado!");
    expect(buscando()).toBe("false");
  });

  it("CEP inexistente: emite toast.error e não chama aoEncontrar", async () => {
    const { toast } = await import("sonner");
    const aoEncontrar = vi.fn();

    await act(async () => {
      raiz.render(<Sonda aoEncontrar={aoEncontrar} />);
    });

    act(() => {
      clicar("buscar-01310100");
    });
    pendentes.get("01310100")!({ erro: true });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(toast.error).toHaveBeenCalledWith("CEP não encontrado");
    expect(aoEncontrar).not.toHaveBeenCalled();
    expect(buscando()).toBe("false");
  });

  it("gate: CEP com menos de 8 dígitos não dispara fetch", async () => {
    const aoEncontrar = vi.fn();

    await act(async () => {
      raiz.render(<Sonda aoEncontrar={aoEncontrar} />);
    });

    act(() => {
      clicar("buscar-curto");
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(buscando()).toBe("false");
  });

  it("#184 corrida: a velha resolve depois, mas aoEncontrar recebe o endereço da nova", async () => {
    const aoEncontrar = vi.fn();

    await act(async () => {
      raiz.render(<Sonda aoEncontrar={aoEncontrar} />);
    });

    act(() => {
      clicar("buscar-01310100"); // busca ANTIGA
    });
    act(() => {
      clicar("buscar-38500000"); // busca NOVA
    });
    expect(pendentes.size).toBe(2);

    // A nova responde primeiro.
    pendentes.get("38500000")!({
      logradouro: "Rua Nova",
      bairro: "Bairro Novo",
      localidade: "Monte Carmelo",
      uf: "MG",
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    // A antiga resolve depois — tem de ser descartada.
    pendentes.get("01310100")!({
      logradouro: "Avenida Paulista",
      bairro: "Bela Vista",
      localidade: "São Paulo",
      uf: "SP",
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(aoEncontrar).toHaveBeenCalledTimes(1);
    expect(aoEncontrar).toHaveBeenCalledWith({
      logradouro: "Rua Nova",
      bairro: "Bairro Novo",
      localidade: "Monte Carmelo",
      uf: "MG",
    });
  });

  it("#184 spinner: a velha resolve enquanto a nova ainda está em voo — buscando continua true", async () => {
    const aoEncontrar = vi.fn();

    await act(async () => {
      raiz.render(<Sonda aoEncontrar={aoEncontrar} />);
    });

    act(() => {
      clicar("buscar-01310100"); // busca ANTIGA
    });
    act(() => {
      clicar("buscar-38500000"); // busca NOVA
    });
    expect(pendentes.size).toBe(2);
    expect(buscando()).toBe("true");

    // A ANTIGA responde primeiro, com a NOVA ainda pendente.
    pendentes.get("01310100")!({
      logradouro: "Avenida Paulista",
      bairro: "Bela Vista",
      localidade: "São Paulo",
      uf: "SP",
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    // A guarda do desligamento: a resposta velha não desliga o spinner de
    // uma busca que não é dela.
    expect(buscando()).toBe("true");

    // Só a resposta da busca corrente desliga o spinner.
    pendentes.get("38500000")!({
      logradouro: "Rua Nova",
      bairro: "Bairro Novo",
      localidade: "Monte Carmelo",
      uf: "MG",
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(buscando()).toBe("false");
  });

  it("#185 timeout: estoura em 8000ms, aborta a requisição e avisa o usuário", async () => {
    const abortadas: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string, init?: { signal?: AbortSignal }) => {
        const cep = extrairCep(url);
        return new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            abortadas.push(cep);
            reject(init.signal!.reason);
          });
          // Nunca resolve — simula o ViaCEP pendurando a conexão.
        });
      }),
    );
    vi.useFakeTimers();
    const { toast } = await import("sonner");
    const aoEncontrar = vi.fn();

    await act(async () => {
      raiz.render(<Sonda aoEncontrar={aoEncontrar} />);
    });

    act(() => {
      clicar("buscar-01310100");
    });
    expect(buscando()).toBe("true");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(TIMEOUT_BUSCA_CEP_MS);
    });

    expect(abortadas).toEqual(["01310100"]);
    expect(toast.error).toHaveBeenCalledWith(
      "A busca de CEP demorou demais. Preencha o endereço manualmente.",
    );
    expect(buscando()).toBe("false");
    expect(aoEncontrar).not.toHaveBeenCalled();
  });

  it("#186 desmonte: aborta a busca em voo e não emite toast nem chama aoEncontrar depois", async () => {
    const abortadas: string[] = [];
    const resolveres = new Map<string, FetchResolver>();
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string, init?: { signal?: AbortSignal }) => {
        const cep = extrairCep(url);
        return new Promise((resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            abortadas.push(cep);
            reject(init.signal!.reason);
          });
          resolveres.set(cep, (data: unknown) =>
            resolve({ json: () => Promise.resolve(data) } as Response),
          );
        });
      }),
    );
    const { toast } = await import("sonner");
    const aoEncontrar = vi.fn();
    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    await act(async () => {
      raiz.render(<Sonda aoEncontrar={aoEncontrar} />);
    });

    act(() => {
      clicar("buscar-01310100");
    });
    expect(resolveres.size).toBe(1);

    await act(async () => {
      raiz.unmount();
    });

    expect(abortadas).toEqual(["01310100"]);

    // Resolver a requisição já abortada (o mock ainda guarda a referência,
    // como uma resposta atrasada de rede) não deve emitir toast nem chamar
    // aoEncontrar.
    resolveres.get("01310100")!({
      logradouro: "Avenida Paulista",
      bairro: "Bela Vista",
      localidade: "São Paulo",
      uf: "SP",
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(aoEncontrar).not.toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
    expect(consoleErrorSpy).not.toHaveBeenCalled();

    // Recria a raiz para o `afterEach` não tentar desmontar de novo.
    hospedeiro.remove();
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  it("#186 desmonte, com resposta que chega APESAR do abort: o flag desmontadoRef segura", async () => {
    // POR QUE ESTE CASO EXISTE, sendo que o de cima já se chama "#186".
    //
    // O caso acima usa mock signal-aware: o `abort()` do desmonte REJEITA a
    // promessa na hora, então quando ele manda `resolveres.get(...)()` a
    // promessa já está resolvida e nada acontece. As asserções finais dele
    // passam com qualquer implementação — aquela metade é INERTE. Medido por
    // mutação: remover `desmontadoRef.current = true` do hook, mantendo o
    // `abort()`, deixava a suíte inteira verde.
    //
    // O flag existe justamente para o caso em que a resposta chega APESAR do
    // abort — mock que ignora o signal, polyfill de fetch, ou resposta já
    // servida pela rede antes do cancelamento chegar. Aqui o `fetchMock`
    // padrão do `beforeEach` ignora o `signal` de propósito, então a
    // promessa continua pendente depois do desmonte e o flag é a única
    // coisa que impede o toast órfão que a issue #186 descreve.
    const { toast } = await import("sonner");
    const aoEncontrar = vi.fn();

    await act(async () => {
      raiz.render(<Sonda aoEncontrar={aoEncontrar} />);
    });

    act(() => {
      clicar("buscar-01310100");
    });
    expect(pendentes.size).toBe(1);

    await act(async () => {
      raiz.unmount();
    });

    // A promessa AINDA está pendente — este mock não reage ao abort.
    pendentes.get("01310100")!({
      logradouro: "Avenida Paulista",
      bairro: "Bela Vista",
      localidade: "São Paulo",
      uf: "SP",
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(aoEncontrar).not.toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();

    // Recria a raiz para o `afterEach` não tentar desmontar de novo.
    hospedeiro.remove();
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  it("StrictMode: repõe desmontadoRef após o ciclo montar->desmontar->montar do efeito e conclui a busca normalmente", async () => {
    // `main.tsx` envolve o app inteiro em `<StrictMode>`. Em desenvolvimento
    // (e nos testes, que rodam com NODE_ENV=test) o React monta, desmonta e
    // remonta os efeitos uma vez a mais na montagem inicial. `desmontadoRef`
    // é setado para `true` na limpeza; se o efeito não repuser `false` na
    // segunda montagem, o hook nasce permanentemente "desmontado" e toda
    // busca subsequente é descartada em silêncio — campo `disabled` para
    // sempre, sem toast, sem erro no console.
    const aoEncontrar = vi.fn();

    await act(async () => {
      raiz.render(
        <StrictMode>
          <Sonda aoEncontrar={aoEncontrar} />
        </StrictMode>,
      );
    });

    act(() => {
      clicar("buscar-01310100");
    });
    expect(pendentes.size).toBe(1);

    pendentes.get("01310100")!({
      logradouro: "Avenida Paulista",
      bairro: "Bela Vista",
      localidade: "São Paulo",
      uf: "SP",
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(aoEncontrar).toHaveBeenCalledTimes(1);
    expect(buscando()).toBe("false");
  });
});

describe("formatarCep", () => {
  it("menos de 5 dígitos: não leva hífen", () => {
    expect(formatarCep("1234")).toEqual({ limpo: "1234", formatado: "1234" });
  });

  it("exatamente 5 dígitos: a condição é '> 5', não leva hífen", () => {
    expect(formatarCep("12345")).toEqual({
      limpo: "12345",
      formatado: "12345",
    });
  });

  it("6 a 8 dígitos: leva hífen", () => {
    expect(formatarCep("123456")).toEqual({
      limpo: "123456",
      formatado: "12345-6",
    });
    expect(formatarCep("12345678")).toEqual({
      limpo: "12345678",
      formatado: "12345-678",
    });
  });

  it("mais de 8 dígitos: `formatado` trunca em slice(5,8), mas `limpo` mantém tudo", () => {
    expect(formatarCep("123456789")).toEqual({
      limpo: "123456789",
      formatado: "12345-678",
    });
  });

  it("entrada já mascarada: o hífen é removido antes de recalcular", () => {
    expect(formatarCep("12345-678")).toEqual({
      limpo: "12345678",
      formatado: "12345-678",
    });
  });

  it('entrada com letras: `replace(/\\D/g, "")` limpa antes de formatar', () => {
    expect(formatarCep("a1b2c3d4")).toEqual({
      limpo: "1234",
      formatado: "1234",
    });
  });
});
