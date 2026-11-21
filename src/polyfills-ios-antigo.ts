// APIs usadas pelo app e primeiro iOS com suporte nativo (MDN/caniuse):
// 15.4 — Object.hasOwn, Array.at, TypedArray.at, AbortSignal.throwIfAborted e crypto.randomUUID.
// 16.0 — AbortSignal.timeout. Sem dependências: roda antes da leitura da ficha.
function definir(alvo: object, chave: string, value: unknown) {
  Object.defineProperty(alvo, chave, {
    value,
    configurable: true,
    writable: true,
  });
}

if (typeof Object.hasOwn !== "function") {
  definir(
    Object,
    "hasOwn",
    function hasOwn(objeto: unknown, chave: PropertyKey) {
      if (objeto === null || objeto === undefined) throw new TypeError();
      return Object.prototype.hasOwnProperty.call(Object(objeto), chave);
    },
  );
}

// O + aplica ToNumber (BigInt e Symbol lançam, ao contrário de Number(BigInt)).
function inteiro(valor: number) {
  return Math.trunc(+valor) || 0;
}

function lerEm(objeto: object, tamanho: number, indice: number): unknown {
  const relativo = inteiro(indice);
  const posicao = relativo < 0 ? tamanho + relativo : relativo;
  return posicao >= 0 && posicao < tamanho
    ? Reflect.get(objeto, posicao)
    : undefined;
}

if (typeof Array.prototype.at !== "function") {
  definir(
    Array.prototype,
    "at",
    function at(this: ArrayLike<unknown>, indice: number) {
      if (this === null || this === undefined) throw new TypeError();
      const objeto = Object(this) as ArrayLike<unknown>;
      const tamanho = Math.min(
        Number.MAX_SAFE_INTEGER,
        Math.max(0, inteiro(objeto.length)),
      );
      return lerEm(objeto, tamanho, indice);
    },
  );
}

if (typeof Uint8Array.prototype.at !== "function") {
  const prototipo = Object.getPrototypeOf(Uint8Array.prototype);
  definir(prototipo, "at", function at(this: Uint8Array, indice: number) {
    // Valida o receptor (inclusive buffer destacado) e ignora um length próprio.
    Uint8Array.prototype.values.call(this);
    return lerEm(this, Reflect.get(prototipo, "length", this), indice);
  });
}

if (typeof AbortSignal.prototype.throwIfAborted !== "function") {
  definir(
    AbortSignal.prototype,
    "throwIfAborted",
    function throwIfAborted(this: AbortSignal) {
      if (Reflect.get(AbortSignal.prototype, "aborted", this)) {
        if ("reason" in this) throw this.reason;
        throw new DOMException("Operação cancelada", "AbortError");
      }
    },
  );
}

if (typeof AbortSignal.timeout !== "function") {
  definir(AbortSignal, "timeout", function timeout(ms: number) {
    const prazo = Math.trunc(+ms);
    if (!Number.isSafeInteger(prazo) || prazo < 0) throw new TypeError();
    const controller = new AbortController();
    const sinal = controller.signal;
    const agendar = (restante: number) => {
      // Timers aceitam no máximo um inteiro de 32 bits.
      const parcela = Math.min(restante, 0x7fffffff);
      setTimeout(() => {
        if (restante > parcela) {
          agendar(restante - parcela);
          return;
        }
        const motivo = new DOMException("Prazo esgotado", "TimeoutError");
        // No iOS anterior ao 15.4, abort() não guarda o motivo.
        if (!("reason" in sinal))
          Object.defineProperty(sinal, "reason", { value: motivo });
        controller.abort(motivo);
      }, parcela);
    };
    agendar(prazo);
    return sinal;
  });
}

if (
  typeof crypto !== "undefined" &&
  typeof crypto.randomUUID !== "function" &&
  globalThis.isSecureContext
) {
  definir(
    Object.getPrototypeOf(crypto),
    "randomUUID",
    function randomUUID(this: Crypto) {
      const bytes = this.getRandomValues(new Uint8Array(16));
      bytes[6] = (bytes[6] & 0x0f) | 0x40;
      bytes[8] = (bytes[8] & 0x3f) | 0x80;
      const hex = Array.from(bytes, (byte) =>
        byte.toString(16).padStart(2, "0"),
      ).join("");
      return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    },
  );
}

export {};
