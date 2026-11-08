// @vitest-environment jsdom
import type { OpcoesDoLeitorDeCodigo } from "@/hooks/useLeitorDeCodigo";
import { useLeitorDeCodigo } from "@/hooks/useLeitorDeCodigo";
//
// Testa `useLeitorDeCodigo` isoladamente (tarefa C2.3), sem o componente
// `LeitorDeCodigo` (esse é o outro arquivo de teste desta tarefa). Segue a
// receita da casa: sem `@testing-library/react` (não instalado), `createRoot`
// + `act` do React puro, componente sonda que expõe o estado do hook no DOM
// (esqueleto de tests/front/use-busca-cep.test.tsx e
// tests/front/admin-kpi-carousel-compacto.test.tsx).
//
// O jsdom NÃO implementa `srcObject`, `play()` nem `readyState` de
// `HTMLMediaElement` — sem os três dublês abaixo o arquivo inteiro falha
// com "Not implemented" e parece defeito do hook, não do ambiente.
import {
  type Decodificador,
  ErroDoDecodificador,
  type Leitura,
  type OpcoesDoDecodificador,
} from "@/lib/leitor/decodificador";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público — mesmo padrão
// usado em tests/front/use-busca-cep.test.tsx.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

/**
 * Componente sonda: só existe para montar o hook e expor o estado no DOM.
 * Desestrutura os campos do hook em vez de manter `resultado.X` — mantendo
 * `resultado.refDoVideo` e `resultado.estado` no MESMO objeto encadeado, a
 * regra `react-hooks/refs` do eslint (eslint-plugin-react-hooks v6) trata
 * qualquer leitura de propriedade nesse objeto como acesso a ref durante o
 * render (falso positivo — só `refDoVideo` é ref de verdade). Desestruturar
 * é o mesmo padrão já usado em src/components/admin/pdv/LeitorDeCodigo.tsx.
 */
function Sonda(props: { readonly opcoes: OpcoesDoLeitorDeCodigo }) {
  const {
    estado,
    motor,
    erro,
    ultimaLeitura,
    refDoVideo,
    tentarDeNovo,
    lerCodigoDigitado,
  } = useLeitorDeCodigo(props.opcoes);
  return (
    <div>
      <video ref={refDoVideo} muted playsInline autoPlay />
      <span data-testid="estado">{estado}</span>
      <span data-testid="motor">{motor ?? ""}</span>
      <span data-testid="erro-origem">{erro?.origem ?? ""}</span>
      <span data-testid="erro-mensagem">{erro?.mensagem ?? ""}</span>
      <span data-testid="ultima-leitura">{ultimaLeitura?.codigo ?? ""}</span>
      <button
        type="button"
        data-testid="tentar-de-novo"
        onClick={() => tentarDeNovo()}
      >
        tentar de novo
      </button>
      <button
        type="button"
        data-testid="ler-digitado"
        onClick={() => lerCodigoDigitado("  7891000315507  ")}
      >
        ler digitado
      </button>
      <button
        type="button"
        data-testid="ler-digitado-vazio"
        onClick={() => lerCodigoDigitado("   ")}
      >
        ler digitado vazio
      </button>
      <button
        type="button"
        data-testid="ler-digitado-com-espacos"
        onClick={() => lerCodigoDigitado("7 891234 567895")}
      >
        ler digitado com espaços
      </button>
      {/* Alvo real de foco para o caso 11 (o buffer do leitor físico se
          cala quando o foco está num campo editável). */}
      <input type="text" data-testid="campo-de-verdade" />
    </div>
  );
}

function criarStreamDuble(pararTrack: () => void): MediaStream {
  return {
    getTracks: () => [{ stop: pararTrack }],
  } as unknown as MediaStream;
}

function criarDecodificadorDuble(
  opcoesParciais: Partial<Decodificador> & { motor: "nativo" | "zxing" },
): Decodificador {
  return {
    entrada: "video",
    formatos: ["ean_13"],
    detectar: vi.fn(async () => []),
    encerrar: vi.fn(),
    ...opcoesParciais,
  } as Decodificador;
}

describe("useLeitorDeCodigo", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let pararTrack: () => void;

  beforeEach(() => {
    vi.useFakeTimers({
      toFake: [
        "Date",
        "setTimeout",
        "clearTimeout",
        "requestAnimationFrame",
        "cancelAnimationFrame",
      ],
    });

    Object.defineProperty(HTMLMediaElement.prototype, "srcObject", {
      configurable: true,
      writable: true,
      value: null,
    });
    Object.defineProperty(HTMLMediaElement.prototype, "play", {
      configurable: true,
      writable: true,
      value: () => Promise.resolve(),
    });
    Object.defineProperty(HTMLMediaElement.prototype, "readyState", {
      configurable: true,
      get: () => 4,
    });

    pararTrack = vi.fn();
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  function texto(testId: string): string {
    return (document.querySelector(`[data-testid="${testId}"]`) as HTMLElement)
      .textContent as string;
  }

  function clicar(testId: string) {
    (
      document.querySelector(`[data-testid="${testId}"]`) as HTMLButtonElement
    ).click();
  }

  async function montar(opcoes: OpcoesDoLeitorDeCodigo) {
    await act(async () => {
      raiz.render(<Sonda opcoes={opcoes} />);
    });
  }

  /** Avança o relógio falso e deixa as promessas pendentes assentarem. */
  async function avancar(ms: number) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });
  }

  it("1. ativo=true chama getUserMedia com facingMode ideal environment e chega a 'lendo' com o motor do dublê", async () => {
    const getUserMedia = vi.fn(async () => criarStreamDuble(pararTrack));
    const dec = criarDecodificadorDuble({ motor: "nativo", entrada: "video" });
    const criarDecodificador = vi.fn(async (_o?: OpcoesDoDecodificador) => dec);

    await montar({
      ativo: true,
      aoLer: vi.fn(),
      midia: { getUserMedia },
      criarDecodificador,
    });
    await avancar(0);

    expect(getUserMedia).toHaveBeenCalledTimes(1);
    expect(getUserMedia).toHaveBeenCalledWith({
      video: {
        facingMode: { ideal: "environment" },
        width: { ideal: 1280 },
        height: { ideal: 720 },
      },
      audio: false,
    });
    expect(texto("estado")).toBe("lendo");
    expect(texto("motor")).toBe("nativo");
  });

  it("2. código PARADO na frente da câmera é lido uma vez só, por mais tempo que fique (não soma unidade sem a pessoa pedir)", async () => {
    const leitura: Leitura = { codigo: "7891000315507", formato: "ean_13" };
    const detectar = vi.fn(async () => [leitura]);
    const dec = criarDecodificadorDuble({
      motor: "nativo",
      entrada: "video",
      detectar,
    });
    const aoLer = vi.fn();

    await montar({
      ativo: true,
      aoLer,
      intervaloMs: 100,
      midia: { getUserMedia: vi.fn(async () => criarStreamDuble(pararTrack)) },
      criarDecodificador: vi.fn(async () => dec),
    });
    await avancar(0);
    expect(texto("estado")).toBe("lendo");

    await avancar(300); // várias janelas de intervaloMs, mesmo código
    expect(aoLer).toHaveBeenCalledTimes(1);
    expect(aoLer).toHaveBeenCalledWith(leitura);

    // Segue parado bem além de 1,5 s (e além de qualquer outra janela): o
    // código nunca saiu do quadro, então continua sendo UMA leitura.
    await avancar(10_000);
    expect(detectar.mock.calls.length).toBeGreaterThan(20);
    expect(aoLer).toHaveBeenCalledTimes(1);
  });

  it("2b. o mesmo código que SAIU do quadro e voltou é outra leitura", async () => {
    const leitura: Leitura = { codigo: "7891000315507", formato: "ean_13" };
    let noQuadro = true;
    const detectar = vi.fn(async () => (noQuadro ? [leitura] : []));
    const dec = criarDecodificadorDuble({
      motor: "nativo",
      entrada: "video",
      detectar,
    });
    const aoLer = vi.fn();

    await montar({
      ativo: true,
      aoLer,
      intervaloMs: 100,
      midia: { getUserMedia: vi.fn(async () => criarStreamDuble(pararTrack)) },
      criarDecodificador: vi.fn(async () => dec),
    });
    await avancar(0);
    await avancar(300);
    expect(aoLer).toHaveBeenCalledTimes(1);

    // A peça sai do quadro por alguns segundos…
    noQuadro = false;
    await avancar(3000);
    expect(aoLer).toHaveBeenCalledTimes(1);

    // …e entra uma segunda peça igual.
    noQuadro = true;
    await avancar(300);
    expect(aoLer).toHaveBeenCalledTimes(2);
  });

  it("3. códigos diferentes em quadros seguidos chamam aoLer duas vezes", async () => {
    let vez = 0;
    const detectar = vi.fn(async () => {
      vez += 1;
      return [
        {
          codigo: vez === 1 ? "111" : "222",
          formato: "ean_13" as const,
        },
      ];
    });
    const dec = criarDecodificadorDuble({
      motor: "nativo",
      entrada: "video",
      detectar,
    });
    const aoLer = vi.fn();

    await montar({
      ativo: true,
      aoLer,
      intervaloMs: 50,
      midia: { getUserMedia: vi.fn(async () => criarStreamDuble(pararTrack)) },
      criarDecodificador: vi.fn(async () => dec),
    });
    await avancar(0);
    await avancar(200);

    expect(aoLer).toHaveBeenCalledTimes(2);
    expect(aoLer).toHaveBeenCalledWith({ codigo: "111", formato: "ean_13" });
    expect(aoLer).toHaveBeenCalledWith({ codigo: "222", formato: "ean_13" });
  });

  it("4. modo 'unico': a primeira leitura chama aoLer e solta a câmera — nenhum detectar depois", async () => {
    const leitura: Leitura = { codigo: "999", formato: "ean_13" };
    const detectar = vi.fn(async () => [leitura]);
    const dec = criarDecodificadorDuble({
      motor: "nativo",
      entrada: "video",
      detectar,
    });
    const aoLer = vi.fn();

    await montar({
      ativo: true,
      modo: "unico",
      aoLer,
      intervaloMs: 50,
      midia: { getUserMedia: vi.fn(async () => criarStreamDuble(pararTrack)) },
      criarDecodificador: vi.fn(async () => dec),
    });
    await avancar(0);
    await avancar(200);

    expect(aoLer).toHaveBeenCalledTimes(1);
    expect(pararTrack).toHaveBeenCalledTimes(1);
    expect(texto("estado")).toBe("ocioso");

    const chamadasAntes = detectar.mock.calls.length;
    await avancar(500);
    expect(detectar.mock.calls.length).toBe(chamadasAntes);
  });

  it("5. NotAllowedError vira 'permissao_negada' com a frase exata; tentarDeNovo chama getUserMedia de novo", async () => {
    const getUserMedia = vi.fn(async () => {
      throw new DOMException("bloqueado", "NotAllowedError");
    });

    await montar({ ativo: true, aoLer: vi.fn(), midia: { getUserMedia } });
    await avancar(0);

    expect(texto("estado")).toBe("erro");
    expect(texto("erro-origem")).toBe("permissao_negada");
    expect(texto("erro-mensagem")).toBe(
      "Você precisa permitir o acesso à câmera para ler o código. Libere a câmera nas configurações do navegador ou do aparelho e toque em Tentar de novo.",
    );

    act(() => {
      clicar("tentar-de-novo");
    });
    await avancar(0);
    expect(getUserMedia).toHaveBeenCalledTimes(2);
  });

  it("6. NotFoundError -> sem_camera; NotReadableError -> camera_ocupada; erro sem nome -> desconhecido", async () => {
    async function origemPara(erro: unknown): Promise<string> {
      await montar({
        ativo: true,
        aoLer: vi.fn(),
        midia: {
          getUserMedia: vi.fn(async () => {
            throw erro;
          }),
        },
      });
      await avancar(0);
      const origem = texto("erro-origem");
      act(() => {
        raiz.unmount();
      });
      hospedeiro.remove();
      hospedeiro = document.createElement("div");
      document.body.appendChild(hospedeiro);
      raiz = createRoot(hospedeiro);
      return origem;
    }

    expect(await origemPara(new DOMException("x", "NotFoundError"))).toBe(
      "sem_camera",
    );
    expect(await origemPara(new DOMException("x", "NotReadableError"))).toBe(
      "camera_ocupada",
    );
    expect(
      await origemPara(new Error("falha esquisita sem nome próprio")),
    ).toBe("desconhecido");
  });

  it("7. midia: null -> sem_suporte, sem chamar nada", async () => {
    await montar({ ativo: true, aoLer: vi.fn(), midia: null });
    await avancar(0);

    expect(texto("estado")).toBe("erro");
    expect(texto("erro-origem")).toBe("sem_suporte");
  });

  it("8. desmontar durante a leitura solta as tracks e encerra o decodificador; nenhum detectar depois", async () => {
    const detectar = vi.fn(async () => []);
    const dec = criarDecodificadorDuble({
      motor: "nativo",
      entrada: "video",
      detectar,
    });

    await montar({
      ativo: true,
      aoLer: vi.fn(),
      intervaloMs: 50,
      midia: { getUserMedia: vi.fn(async () => criarStreamDuble(pararTrack)) },
      criarDecodificador: vi.fn(async () => dec),
    });
    await avancar(0);
    expect(texto("estado")).toBe("lendo");

    await act(async () => {
      raiz.unmount();
    });

    expect(pararTrack).toHaveBeenCalledTimes(1);
    expect(dec.encerrar).toHaveBeenCalledTimes(1);

    const chamadasAntes = detectar.mock.calls.length;
    await avancar(500);
    expect(detectar.mock.calls.length).toBe(chamadasAntes);

    // Recria a raiz para o `afterEach` não tentar desmontar de novo.
    hospedeiro.remove();
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  it("9. vazamento: getUserMedia que só resolve depois do desmonte para as tracks assim mesmo", async () => {
    let resolver: (stream: MediaStream) => void = () => {};
    const getUserMedia = vi.fn(
      () =>
        new Promise<MediaStream>((resolve) => {
          resolver = resolve;
        }),
    );

    await montar({ ativo: true, aoLer: vi.fn(), midia: { getUserMedia } });
    await avancar(0);
    expect(texto("estado")).toBe("preparando");

    await act(async () => {
      raiz.unmount();
    });

    // A resposta chega SÓ AGORA, depois do desmonte.
    await act(async () => {
      resolver(criarStreamDuble(pararTrack));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(pararTrack).toHaveBeenCalledTimes(1);

    hospedeiro.remove();
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  it("10. visibilitychange pausa a decodificação (document.hidden) e retoma ao voltar", async () => {
    const descritorOriginal = Object.getOwnPropertyDescriptor(
      document,
      "hidden",
    );
    let escondido = false;
    Object.defineProperty(document, "hidden", {
      configurable: true,
      get: () => escondido,
    });

    try {
      const detectar = vi.fn(async () => []);
      const dec = criarDecodificadorDuble({
        motor: "nativo",
        entrada: "video",
        detectar,
      });

      await montar({
        ativo: true,
        aoLer: vi.fn(),
        intervaloMs: 50,
        midia: {
          getUserMedia: vi.fn(async () => criarStreamDuble(pararTrack)),
        },
        criarDecodificador: vi.fn(async () => dec),
      });
      await avancar(0);
      expect(texto("estado")).toBe("lendo");
      await avancar(200);
      const chamadasAntesDePausar = detectar.mock.calls.length;
      expect(chamadasAntesDePausar).toBeGreaterThan(0);

      escondido = true;
      act(() => {
        document.dispatchEvent(new Event("visibilitychange"));
      });
      expect(texto("estado")).toBe("pausado");

      await avancar(300);
      expect(detectar.mock.calls.length).toBe(chamadasAntesDePausar);

      escondido = false;
      act(() => {
        document.dispatchEvent(new Event("visibilitychange"));
      });
      expect(texto("estado")).toBe("lendo");

      await avancar(200);
      expect(detectar.mock.calls.length).toBeGreaterThan(chamadasAntesDePausar);
    } finally {
      if (descritorOriginal) {
        Object.defineProperty(document, "hidden", descritorOriginal);
      }
    }
  });

  it("11. teclado: teclas + Enter chamam aoLer com o código montado; com foco num input real, não chama", async () => {
    const aoLer = vi.fn();
    await montar({ ativo: false, aoLer });
    await avancar(0);

    function teclar(key: string, alvo: EventTarget = document.body) {
      const evento = new KeyboardEvent("keydown", {
        key,
        bubbles: true,
        cancelable: true,
      });
      act(() => {
        alvo.dispatchEvent(evento);
      });
    }

    for (const digito of ["7", "8", "9", "1"]) {
      teclar(digito);
    }
    teclar("Enter");
    expect(aoLer).toHaveBeenCalledWith({
      codigo: "7891",
      formato: "desconhecido",
      deTeclado: true,
    });

    aoLer.mockClear();
    const campoReal = document.querySelector(
      '[data-testid="campo-de-verdade"]',
    ) as HTMLInputElement;
    campoReal.focus();
    for (const digito of ["1", "2", "3", "4"]) {
      teclar(digito, campoReal);
    }
    teclar("Enter", campoReal);
    expect(aoLer).not.toHaveBeenCalled();
  });

  it("11b. teclado: o MESMO código bipado duas vezes em menos de 1,5s chama aoLer duas vezes (cada bipe da pistola é deliberado)", async () => {
    const aoLer = vi.fn();
    await montar({ ativo: false, aoLer });
    await avancar(0);

    function bipar(codigo: string) {
      for (const tecla of [...codigo, "Enter"]) {
        const evento = new KeyboardEvent("keydown", {
          key: tecla,
          bubbles: true,
          cancelable: true,
        });
        act(() => {
          document.body.dispatchEvent(evento);
        });
      }
    }

    bipar("7891000315507");
    await avancar(300);
    bipar("7891000315507");

    expect(aoLer).toHaveBeenCalledTimes(2);
    // Cada chamada leva a marca de teclado: é ela que o balcão usa para não
    // aplicar a proteção da câmera (mesmo código parado no quadro).
    for (const [leitura] of aoLer.mock.calls) {
      expect(leitura).toMatchObject({ deTeclado: true });
    }
  });

  it("12c. lerCodigoDigitado: o MESMO código digitado duas vezes em menos de 1,5s chama aoLer duas vezes", async () => {
    const aoLer = vi.fn();
    await montar({ ativo: false, aoLer });
    await avancar(0);

    act(() => {
      clicar("ler-digitado");
    });
    await avancar(300);
    act(() => {
      clicar("ler-digitado");
    });

    expect(aoLer).toHaveBeenCalledTimes(2);
  });

  it("12. lerCodigoDigitado tira os espaços; string vazia não chama nada", async () => {
    const aoLer = vi.fn();
    await montar({ ativo: false, aoLer });
    await avancar(0);

    act(() => {
      clicar("ler-digitado-vazio");
    });
    expect(aoLer).not.toHaveBeenCalled();

    act(() => {
      clicar("ler-digitado");
    });
    expect(aoLer).toHaveBeenCalledWith({
      codigo: "7891000315507",
      formato: "desconhecido",
      deTeclado: true,
    });
  });

  it("12b. lerCodigoDigitado tira também os espaços do MEIO (etiqueta EAN-13 impressa)", async () => {
    const aoLer = vi.fn();
    await montar({ ativo: false, aoLer });
    await avancar(0);

    act(() => {
      clicar("ler-digitado-com-espacos");
    });
    expect(aoLer).toHaveBeenCalledWith({
      codigo: "7891234567895",
      formato: "desconhecido",
      deTeclado: true,
    });
  });

  it("13. entrada 'imageData' sem canvas 2D (jsdom sem o pacote `canvas`) vira erro sem_suporte e para o laço", async () => {
    const detectar = vi.fn(async () => []);
    const dec = criarDecodificadorDuble({
      motor: "zxing",
      entrada: "imageData",
      detectar,
    });

    await montar({
      ativo: true,
      aoLer: vi.fn(),
      intervaloMs: 50,
      midia: { getUserMedia: vi.fn(async () => criarStreamDuble(pararTrack)) },
      criarDecodificador: vi.fn(async () => dec),
    });
    await avancar(0);
    await avancar(200);

    expect(texto("estado")).toBe("erro");
    expect(texto("erro-origem")).toBe("sem_suporte");
    expect(detectar).not.toHaveBeenCalled();

    const chamadasAntes = detectar.mock.calls.length;
    await avancar(300);
    expect(detectar.mock.calls.length).toBe(chamadasAntes);
  });

  it("14. o leitor (WASM) não carregou: detectar rejeita com falha_do_fallback -> erro leitor_nao_carregou com a frase de conexão, câmera solta e laço parado; Tentar de novo religa", async () => {
    const detectar = vi.fn(async () => {
      throw new ErroDoDecodificador("falha_do_fallback", new Error("rede"));
    });
    const dec = criarDecodificadorDuble({
      motor: "zxing",
      entrada: "video",
      detectar,
    });
    const getUserMedia = vi.fn(async () => criarStreamDuble(pararTrack));
    const aviso = vi.spyOn(console, "warn").mockImplementation(() => {});

    await montar({
      ativo: true,
      aoLer: vi.fn(),
      intervaloMs: 50,
      midia: { getUserMedia },
      criarDecodificador: vi.fn(async () => dec),
    });
    await avancar(0);
    await avancar(200);

    expect(texto("estado")).toBe("erro");
    expect(texto("erro-origem")).toBe("leitor_nao_carregou");
    expect(texto("erro-mensagem")).toBe(
      "Não foi possível carregar o leitor de código de barras. Verifique a conexão e toque em Tentar de novo.",
    );
    expect(pararTrack).toHaveBeenCalledTimes(1);
    expect(dec.encerrar).toHaveBeenCalledTimes(1);
    expect(aviso).toHaveBeenCalled();

    // O laço parou: nenhum detectar depois do erro.
    const chamadasAntes = detectar.mock.calls.length;
    await avancar(500);
    expect(detectar.mock.calls.length).toBe(chamadasAntes);

    act(() => {
      clicar("tentar-de-novo");
    });
    await avancar(0);
    expect(getUserMedia).toHaveBeenCalledTimes(2);
  });

  it("15. outro erro de detectar (não é falha do leitor) não mata o laço: segue lendo e acerta no quadro seguinte", async () => {
    const leitura: Leitura = { codigo: "7891000315507", formato: "ean_13" };
    let vez = 0;
    const detectar = vi.fn(async () => {
      vez += 1;
      if (vez === 1) throw new Error("quadro ruim");
      return [leitura];
    });
    const dec = criarDecodificadorDuble({
      motor: "nativo",
      entrada: "video",
      detectar,
    });
    const aoLer = vi.fn();
    vi.spyOn(console, "warn").mockImplementation(() => {});

    await montar({
      ativo: true,
      aoLer,
      intervaloMs: 50,
      midia: { getUserMedia: vi.fn(async () => criarStreamDuble(pararTrack)) },
      criarDecodificador: vi.fn(async () => dec),
    });
    await avancar(0);
    await avancar(300);

    expect(detectar.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(aoLer).toHaveBeenCalledWith(leitura);
    expect(texto("estado")).toBe("lendo");
  });
});
