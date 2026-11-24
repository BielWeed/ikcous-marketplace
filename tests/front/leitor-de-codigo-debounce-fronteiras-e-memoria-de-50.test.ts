// Protege as bordas do debounce da câmera que os testes de
// leitor-de-codigo-buffer-e-debounce deixam passar:
//  · a SAÍDA DO QUADRO em exatos 1000 ms (999 ainda é a mesma peça parada,
//    1000 é outra peça) e a constante de 1 s em si, provada por uma peça
//    parada que a câmera revê a cada 950 ms;
//  · a memória de 50 códigos: 50 distintos cabem TODOS, só o 51º expulsa;
//  · a ordem da memória é "há mais tempo sem ser aceito", não "inserido há
//    mais tempo": o código reaceito depois da janela vai para o fim da fila;
//  · `esquecer()` sem argumento esquece tudo.
// Relógio injetado, nada de timer falso.
import { criarDebounceDeLeitura } from "@/lib/leitor/debounce-de-leitura";
import { describe, expect, it } from "vitest";

describe("debounce da câmera: bordas do quadro e da memória", () => {
  it("peça revista a cada 950 ms continua sendo a MESMA peça parada, por mais de 1,5 s", () => {
    let t = 10_000;
    const debounce = criarDebounceDeLeitura({ agora: () => t });
    expect(debounce.aceita("7891000000011")).toBe(true);
    t += 950;
    expect(debounce.aceita("7891000000011")).toBe(false);
    // 1900 ms depois do aceite (passou da janela de 1,5 s) mas só 950 ms
    // depois da última vez que a câmera a viu: não saiu do quadro.
    t += 950;
    expect(debounce.aceita("7891000000011")).toBe(false);
  });

  it("a 999 ms da última vista ainda é a mesma peça; a 1000 ms é outra", () => {
    let t = 10_000;
    const debounce = criarDebounceDeLeitura({ agora: () => t });
    // Aceito, revisto (recusado, dentro da janela) 1400 ms depois, e de novo
    // na borda da saída do quadro, já depois da janela de 1,5 s do aceite.
    expect(debounce.aceita("B")).toBe(true);
    t += 1400;
    expect(debounce.aceita("B")).toBe(false);
    t += 999; // 999 ms desde a última vista: ainda no quadro
    expect(debounce.aceita("B")).toBe(false);
    t += 1000; // exatos 1000 ms sem ver: saiu do quadro, é outra peça
    expect(debounce.aceita("B")).toBe(true);
  });

  it("50 códigos distintos cabem todos na memória; o primeiro ainda é recusado", () => {
    const debounce = criarDebounceDeLeitura({ agora: () => 10_000 });
    for (let i = 0; i < 50; i += 1) {
      expect(debounce.aceita(`cod-${i}`)).toBe(true);
    }
    // Ainda dentro da janela de 1,5 s (t não andou): o primeiro código
    // continua lembrado, ninguém foi expulso.
    expect(debounce.aceita("cod-0")).toBe(false);
  });

  it("o 51º código expulsa o mais antigo, e só ele", () => {
    const debounce = criarDebounceDeLeitura({ agora: () => 10_000 });
    for (let i = 0; i < 51; i += 1) {
      debounce.aceita(`cod-${i}`);
    }
    // O segundo continua lembrado.
    expect(debounce.aceita("cod-1")).toBe(false);
    // O primeiro foi esquecido (aceito de novo na hora).
    expect(debounce.aceita("cod-0")).toBe(true);
  });

  it("código reaceito depois da janela vai para o fim da fila: quem sai primeiro é o que está há mais tempo sem ser aceito", () => {
    let t = 10_000;
    const debounce = criarDebounceDeLeitura({
      agora: () => t,
      maximoDeCodigosLembrados: 3,
    });
    debounce.aceita("A");
    debounce.aceita("B");
    debounce.aceita("C");
    // Depois da janela e da saída do quadro, A é bipado de novo (aceito).
    t += 5000;
    expect(debounce.aceita("A")).toBe(true);
    // D entra e expulsa quem está há mais tempo sem ser aceito: B (não o A,
    // que acabou de ser aceito).
    expect(debounce.aceita("D")).toBe(true);
    expect(debounce.aceita("A")).toBe(false);
    expect(debounce.aceita("B")).toBe(true);
  });

  it("esquecer() sem argumento faz TODOS os códigos serem aceitos na hora", () => {
    const debounce = criarDebounceDeLeitura({ agora: () => 10_000 });
    debounce.aceita("A");
    debounce.aceita("B");
    expect(debounce.aceita("A")).toBe(false);
    expect(debounce.aceita("B")).toBe(false);
    debounce.esquecer();
    expect(debounce.aceita("A")).toBe(true);
    expect(debounce.aceita("B")).toBe(true);
  });
});
