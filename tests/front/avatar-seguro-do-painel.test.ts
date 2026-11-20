import { avatarSeguroDoPainel, getPredefinedAvatarSvg } from "@/utils/avatars";
import { describe, expect, it } from "vitest";

const PAGINA = "https://loja.exemplo.invalid/admin/clientes";

describe("avatar do cliente no painel", () => {
  it.each([
    "data:image/jpeg;base64,/9j/2Q==",
    "data:image/png;base64,AAAA",
    "data:image/webp;base64,AAAA",
    "data:image/svg+xml;base64,PHN2Zy8+",
    "data:image/svg+xml,%3Csvg%2F%3E",
    getPredefinedAvatarSvg("🦊", "#FF512F", "#DD2476"),
  ])("mantém a imagem embutida reconhecida: %s", (src) => {
    expect(avatarSeguroDoPainel(src, PAGINA)).toBe(src);
  });

  it.each([
    "/foto.png",
    "../foto.png",
    "https://loja.exemplo.invalid/foto.png",
  ])("mantém a imagem da mesma origem: %s", (src) => {
    expect(avatarSeguroDoPainel(src, PAGINA)).toBe(
      "https://loja.exemplo.invalid/foto.png",
    );
  });

  it.each([
    "https://exemplo.invalid/x.png",
    "//exemplo.invalid/x.png",
    "https://loja.exemplo.invalid:444/x.png",
    "javascript:void(0)",
    "data:text/plain,teste",
    "",
    null,
  ])("recusa endereço fora dos formatos reconhecidos: %s", (src) => {
    expect(avatarSeguroDoPainel(src, PAGINA)).toBeUndefined();
  });
});
