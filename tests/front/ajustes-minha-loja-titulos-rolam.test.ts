// Guarda do desenho: jsdom não mede rolagem; verificamos as classes da fonte.
// A prova visual em navegador fica com a integração.
/* eslint-disable security/detect-non-literal-fs-filename --
   caminhos constantes de arquivos-fonte do próprio repositório */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("Ajustes e Minha loja — títulos acompanham a rolagem", () => {
  it.each(["AdminSettingsView", "AdminAboutStoreView"])(
    "%s usa o cabeçalho padrão sem ancorar o título",
    (tela) => {
      const fonte = readFileSync(
        join(__dirname, "../../src/views/admin", `${tela}.tsx`),
        "utf8",
      );
      const cabecalho = fonte.match(/<header\b[\s\S]*?<\/header>/)?.[0];
      expect(cabecalho).toBeDefined();
      expect(cabecalho).toContain("admin-topo-cabecalho");
      expect(cabecalho).toContain("h-[76px]");
      expect(cabecalho).toContain("[&_h1]:normal-case");
      expect(cabecalho).toContain("[&_h1]:tracking-tight");
      expect(cabecalho).toContain("[&_h1_span]:not-italic");
      expect(cabecalho).toContain("<AdminPageHeader");
      expect(cabecalho).not.toMatch(/\bsticky\b|\bfixed\b|backdrop-blur|border-b|bg-admin-bg\//);
      if (tela === "AdminSettingsView") {
        expect(cabecalho).toContain("max-w-2xl");
        expect(cabecalho).toContain('aria-label="Guia de Configurações e Ajuda"');
        expect(cabecalho).toContain("onClick={() => setShowHelpModal(true)}");
      }
    },
  );
});
