// Protege as FRONTEIRAS EXATAS do buffer da pistola USB e o reconhecimento de
// campo editável, que os testes de leitor-de-codigo-buffer-e-debounce só
// provam longe da borda (10 ms contra 50, 70 caracteres contra 64, só INPUT e
// contentEditable=true). Sem o relógio de verdade: `agora` é injetado.
//
// O que cai aqui se alguém mexer:
//  · `>` vira `>=` no intervalo entre teclas (pistola lenta de 50 ms exatos
//    deixaria de ser leitura);
//  · `>` vira `>=` no teto de 64 caracteres (o código de 64 que o banco aceita
//    seria jogado fora);
//  · Meta (Cmd) ou Alt deixam de contar como atalho de sistema;
//  · o burst estourado não "perdoa" um burst novo depois de uma pausa;
//  · TEXTAREA, SELECT, contenteditable="" e contenteditable="true" deixam de
//    ser tratados como lugar onde digitar é o ponto.
import {
  INTERVALO_MAXIMO_ENTRE_TECLAS_MS,
  TAMANHO_MAXIMO_DO_CODIGO,
  type TeclaDoLeitor,
  criarBufferDoLeitorFisico,
  focoEstaEmCampoEditavel,
} from "@/lib/leitor/buffer-do-leitor-fisico";
import { beforeEach, describe, expect, it } from "vitest";

describe("buffer da pistola: fronteiras exatas", () => {
  let t = 0;
  const agora = () => t;
  let lidos: string[];

  beforeEach(() => {
    t = 0;
    lidos = [];
  });

  function novoBuffer() {
    return criarBufferDoLeitorFisico({
      aoLer: (codigo) => lidos.push(codigo),
      agora,
    });
  }

  function digitar(
    buffer: ReturnType<typeof criarBufferDoLeitorFisico>,
    teclas: readonly string[],
    passoMs: number,
    extra: Partial<TeclaDoLeitor> = {},
  ): void {
    for (const key of teclas) {
      buffer.aoPressionarTecla({ key, ...extra });
      t += passoMs;
    }
  }

  it("tecla a EXATOS 50 ms da anterior ainda é a mesma leitura (pistola lenta)", () => {
    const buffer = novoBuffer();
    // A primeira tecla precisa nascer fora da janela do "zero" inicial.
    t = 1000;
    digitar(buffer, ["7", "8", "9", "1"], INTERVALO_MAXIMO_ENTRE_TECLAS_MS);
    // Depois da última tecla o relógio já andou 50 ms: Enter também na borda.
    buffer.aoPressionarTecla({ key: "Enter" });
    expect(lidos).toEqual(["7891"]);
  });

  it("tecla a 51 ms da anterior abre uma leitura NOVA e o código antigo se perde", () => {
    const buffer = novoBuffer();
    t = 1000;
    digitar(buffer, ["7", "8"], 10);
    t += INTERVALO_MAXIMO_ENTRE_TECLAS_MS + 1 - 10;
    digitar(buffer, ["9", "1", "2", "3"], 10);
    buffer.aoPressionarTecla({ key: "Enter" });
    expect(lidos).toEqual(["9123"]);
  });

  it("código de EXATOS 64 caracteres é lido; com 65 não é lido", () => {
    const sessentaEQuatro = Array.from(
      { length: TAMANHO_MAXIMO_DO_CODIGO },
      () => "1",
    );
    const buffer = novoBuffer();
    t = 1000;
    digitar(buffer, sessentaEQuatro, 5);
    buffer.aoPressionarTecla({ key: "Enter" });
    expect(lidos).toEqual([sessentaEQuatro.join("")]);

    lidos.length = 0;
    t += 1000;
    digitar(buffer, [...sessentaEQuatro, "1"], 5);
    buffer.aoPressionarTecla({ key: "Enter" });
    expect(lidos).toEqual([]);
  });

  it("Cmd (metaKey) no meio descarta o que havia acumulado", () => {
    const buffer = novoBuffer();
    t = 1000;
    digitar(buffer, ["7", "8"], 10);
    buffer.aoPressionarTecla({ key: "v", metaKey: true });
    t += 10;
    digitar(buffer, ["9", "1", "2", "3"], 10);
    buffer.aoPressionarTecla({ key: "Enter" });
    expect(lidos).toEqual(["9123"]);
  });

  it("Alt no meio descarta o que havia acumulado", () => {
    const buffer = novoBuffer();
    t = 1000;
    digitar(buffer, ["7", "8"], 10);
    buffer.aoPressionarTecla({ key: "d", altKey: true });
    t += 10;
    digitar(buffer, ["9", "1", "2", "3"], 10);
    buffer.aoPressionarTecla({ key: "Enter" });
    expect(lidos).toEqual(["9123"]);
  });

  it("depois de uma leitura estourada (sem Enter), uma pausa abre um burst novo que lê normalmente", () => {
    const buffer = novoBuffer();
    t = 1000;
    // 70 teclas rápidas: estoura o teto e fica "perdido" até o fim da rajada.
    digitar(
      buffer,
      Array.from({ length: 70 }, () => "5"),
      5,
    );
    // A lojista bipa outra peça: pausa maior que 50 ms, rajada nova.
    t += 500;
    digitar(buffer, ["4", "0", "0", "6"], 10);
    buffer.aoPressionarTecla({ key: "Enter" });
    expect(lidos).toEqual(["4006"]);
  });
});

describe("focoEstaEmCampoEditavel: cada tipo de campo", () => {
  const alvo = (campos: Record<string, unknown>) =>
    campos as unknown as EventTarget;

  it("TEXTAREA é campo editável", () => {
    expect(focoEstaEmCampoEditavel(alvo({ tagName: "TEXTAREA" }))).toBe(true);
  });

  it("SELECT é campo editável", () => {
    expect(focoEstaEmCampoEditavel(alvo({ tagName: "SELECT" }))).toBe(true);
  });

  it("nome da tag em minúsculas (documento XML/SVG) também vale", () => {
    expect(focoEstaEmCampoEditavel(alvo({ tagName: "input" }))).toBe(true);
    expect(focoEstaEmCampoEditavel(alvo({ tagName: "textarea" }))).toBe(true);
  });

  it('contenteditable="" (atributo vazio) é editável', () => {
    expect(
      focoEstaEmCampoEditavel(alvo({ tagName: "DIV", getAttribute: () => "" })),
    ).toBe(true);
  });

  it('contenteditable="true" no atributo é editável', () => {
    expect(
      focoEstaEmCampoEditavel(
        alvo({ tagName: "DIV", getAttribute: () => "true" }),
      ),
    ).toBe(true);
  });

  it('contenteditable="false" e atributo ausente NÃO são editáveis', () => {
    expect(
      focoEstaEmCampoEditavel(
        alvo({ tagName: "DIV", getAttribute: () => "false" }),
      ),
    ).toBe(false);
    expect(
      focoEstaEmCampoEditavel(
        alvo({ tagName: "DIV", getAttribute: () => null }),
      ),
    ).toBe(false);
  });

  it("isContentEditable true basta, mesmo sem getAttribute", () => {
    expect(
      focoEstaEmCampoEditavel(
        alvo({ tagName: "DIV", isContentEditable: true }),
      ),
    ).toBe(true);
  });
});
