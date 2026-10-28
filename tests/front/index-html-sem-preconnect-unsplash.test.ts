// A vitrine só usa o Unsplash como foto de reserva; abrir a conexão adiantada
// com ele gasta 3 idas e voltas do rádio no 3G, justo quando a conexão com o
// Supabase (a que importa) está sendo aberta.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const html = readFileSync("index.html", "utf-8");

describe("index.html — conexões adiantadas", () => {
  it("não abre conexão adiantada com o Unsplash", () => {
    expect(html).not.toMatch(/rel="preconnect"[^>]*unsplash/);
  });

  it("mantém a conexão adiantada com o Supabase", () => {
    expect(html).toMatch(
      /<link rel="preconnect" href="https:\/\/[^"]+\.supabase\.co" crossorigin \/>/,
    );
  });
});
