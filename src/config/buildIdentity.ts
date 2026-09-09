// Apresentação apenas: a preparação do build já validou a identidade inteira.
// Não há marca de reserva fora da entrega nem semente para configuração gravável.
if (typeof __STORE_IDENTITY__ === "undefined") {
  throw new Error("IDENTITY_BUILD_MISSING");
}

export const buildIdentity: typeof __STORE_IDENTITY__ = __STORE_IDENTITY__;
