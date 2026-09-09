import { createHash, webcrypto } from "node:crypto";
import { createRequire } from "node:module";
import {
  IdentityImageError,
  type PrepareIdentityImageOptions,
  prepareIdentityImage,
} from "@/lib/prepareIdentityImage";
import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Node runs the real header library and WebCrypto. Image.decode is controlled;
// only the separate Chromium runner can certify native image decoding.
// jsdom has no installed TypeScript declarations; describe only the parser used.
const { JSDOM } = createRequire(import.meta.url)("jsdom") as {
  JSDOM: new (html: string) => { window: { DOMParser: typeof DOMParser } };
};
const dom = new JSDOM("");
const png = new Uint8Array(
  await sharp({
    create: {
      width: 32,
      height: 16,
      channels: 4,
      background: "red",
    },
  })
    .png()
    .toBuffer(),
);
const hash = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");
const signal = () => new AbortController().signal;
const blob = (bytes = png, type = "") =>
  new Blob([new Uint8Array(bytes)], { type });
const svg = (body = '<svg xmlns="http://www.w3.org/2000/svg"/>') =>
  new Blob([body]);
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
let decode = vi.fn<() => Promise<void>>();
let images: FakeImage[];
class FakeImage {
  src = "";
  onload = null;
  onerror = null;
  naturalWidth = 32;
  naturalHeight = 16;
  constructor() {
    images.push(this);
  }
  decode() {
    return decode();
  }
  removeAttribute(name: string) {
    if (name === "src") this.src = "";
  }
}
beforeEach(() => {
  images = [];
  decode = vi.fn(async () => {});
  vi.stubGlobal("Image", FakeImage);
  vi.stubGlobal("DOMParser", dom.window.DOMParser);
  vi.stubGlobal("crypto", webcrypto);
  vi.stubGlobal(
    "OffscreenCanvas",
    class {
      constructor() {
        throw Error("UNEXPECTED_CANVAS");
      }
    },
  );
  vi.stubGlobal("document", {
    createElement: () => {
      throw Error("UNEXPECTED_DOM_OR_CANVAS");
    },
  });
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:unit-test");
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  vi.stubGlobal(
    "fetch",
    vi.fn(() => {
      throw Error("UNEXPECTED_HTTP");
    }),
  );
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.doUnmock("image-dimensions");
});
async function errorCode(
  input: Blob,
  code: string,
  options: PrepareIdentityImageOptions = { signal: signal() },
) {
  const error = await prepareIdentityImage(input, options).catch(
    (error: unknown) => error,
  );
  expect(error).toBeInstanceOf(IdentityImageError);
  expect(error).toMatchObject({ code, message: code });
  expect(error).not.toHaveProperty("cause");
}

describe("original preservado", () => {
  it("buffer devolvido por caller nao pode alterar Blob nem hash durante decode", async () => {
    const mutable = new Uint8Array(png);
    const input = blob();
    const read = vi
      .spyOn(input, "arrayBuffer")
      .mockResolvedValue(mutable.buffer);
    decode.mockImplementation(async () => {
      mutable.fill(0);
    });
    const result = await prepareIdentityImage(input, { signal: signal() });
    expect(new Uint8Array(await result.blob.arrayBuffer())).toEqual(png);
    expect(result.asset.sha256).toBe(hash(png));
    expect(read).toHaveBeenCalledTimes(1);
  });
  it("limite de 20 MiB e inclusivo, 1 byte e erro de formato", async () => {
    const bytes = new Uint8Array(20 * 1024 * 1024);
    bytes.set(png);
    const result = await prepareIdentityImage(blob(bytes), {
      signal: signal(),
    });
    expect(result.asset.bytes).toBe(bytes.length);
    expect(result.asset.sha256).toBe(hash(bytes));
    await errorCode(blob(new Uint8Array([0])), "IDENTITY_IMAGE_FORMAT");
  });
  it.each(["image/jpeg", "", "text/html"])(
    "conteudo vence MIME %s, nome e bytes nao mudam",
    async (mime) => {
      const input = blob(png, mime);
      Object.defineProperty(input, "name", { value: "../../secret.svg" });
      const result = await prepareIdentityImage(input, { signal: signal() });
      expect(result.asset).toEqual({
        media_type: "image/png",
        path: `v1/${hash(png)}/image.png`,
        sha256: hash(png),
        bytes: png.length,
        width: 32,
        height: 16,
      });
      expect(new Uint8Array(await result.blob.arrayBuffer())).toEqual(png);
      expect(result.blob.type).toBe("image/png");
      expect(Object.isFrozen(result)).toBe(true);
      expect(Object.isFrozen(result.asset)).toBe(true);
      expect(URL.revokeObjectURL).toHaveBeenCalledExactlyOnceWith(
        "blob:unit-test",
      );
      expect(images[0].src).toBe("");
      expect(fetch).not.toHaveBeenCalled();
    },
  );
  it.each(["jpeg", "webp"] as const)(
    "biblioteca real mede %s bruto e preserva bytes",
    async (format) => {
      const bytes = new Uint8Array(
        await (format === "jpeg" ? sharp(png).jpeg() : sharp(png).webp())
          .withMetadata({ orientation: 6 })
          .toBuffer(),
      );
      const result = await prepareIdentityImage(blob(bytes), {
        signal: signal(),
      });
      expect(result.asset).toMatchObject({
        width: 32,
        height: 16,
        media_type: `image/${format}`,
        sha256: hash(bytes),
      });
    },
  );
  it("duas chamadas concorrentes sao independentes e idempotentes", async () => {
    const results = await Promise.all(
      [0, 1].map(() => prepareIdentityImage(blob(), { signal: signal() })),
    );
    expect(results[0].asset).toEqual(results[1].asset);
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(2);
  });
  it.each([0, 8193])(
    "limite raster %s falha antes do decode",
    async (width) => {
      const bytes = new Uint8Array(png);
      new DataView(bytes.buffer).setUint32(16, width);
      await errorCode(blob(bytes), "IDENTITY_IMAGE_DIMENSIONS");
      expect(images).toHaveLength(0);
    },
  );
  it("8192 e valido no leitor de cabecalho", async () => {
    const bytes = new Uint8Array(
      await sharp({
        create: { width: 8192, height: 1, channels: 3, background: "blue" },
      })
        .png()
        .toBuffer(),
    );
    expect(
      (await prepareIdentityImage(blob(bytes), { signal: signal() })).asset
        .width,
    ).toBe(8192);
  });
  it("altura acima do limite e recusada antes de Image", async () => {
    const bytes = new Uint8Array(png);
    new DataView(bytes.buffer).setUint32(20, 8193);
    await errorCode(blob(bytes), "IDENTITY_IMAGE_DIMENSIONS");
    expect(images).toHaveLength(0);
  });
});

// Reviewer counterexample: one fill FF before SOF0, original offset 140.
const paddedJpeg = new Uint8Array(
  Buffer.from(
    "/9j/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj//8AAEQgAEAAgAwEiAAIRAQMRAf/EABUAAQEAAAAAAAAAAAAAAAAAAAAH/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/EABYBAQEBAAAAAAAAAAAAAAAAAAAGCP/EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/AJ0AjmkQAH//2Q==",
    "base64",
  ),
);
const baselineJpeg = new Uint8Array([
  ...paddedJpeg.slice(0, 140),
  ...paddedJpeg.slice(141),
]);
function insertJpeg(bytes: Uint8Array, offset: number, extra: number[]) {
  return new Uint8Array([
    ...bytes.slice(0, offset),
    ...extra,
    ...bytes.slice(offset),
  ]);
}

describe("JPEG com preenchimento entre segmentos", () => {
  it("fixture exata do revisor conserva os 274 bytes e mede 32x16", async () => {
    expect(paddedJpeg.length).toBe(274);
    expect(hash(paddedJpeg)).toBe(
      "31a4aa557fd7fe9f2986b18a4c2c1810b1bf91fdf10e8eff59a4a5ef30945b76",
    );
    const result = await prepareIdentityImage(blob(paddedJpeg), {
      signal: signal(),
    });
    expect(result.asset).toMatchObject({
      width: 32,
      height: 16,
      sha256: hash(paddedJpeg),
    });
    expect(new Uint8Array(await result.blob.arrayBuffer())).toEqual(paddedJpeg);
  });
  it.each([1, 4])("preserva %s FF antes de APP DQT e SOF", async (count) => {
    const fill = Array<number>(count).fill(255);
    const sof = insertJpeg(baselineJpeg, 140, fill);
    const dqt = insertJpeg(sof, 2, fill);
    // APP15 with a payload that includes FF FF, followed by COM with FF FF.
    const bytes = insertJpeg(dqt, 2, [
      ...fill,
      255,
      239,
      0,
      6,
      65,
      255,
      255,
      66,
      255,
      254,
      0,
      4,
      255,
      255,
    ]);
    const result = await prepareIdentityImage(blob(bytes), {
      signal: signal(),
    });
    expect(result.asset).toMatchObject({
      width: 32,
      height: 16,
      sha256: hash(bytes),
    });
    expect(new Uint8Array(await result.blob.arrayBuffer())).toEqual(bytes);
  });
  it.each([1, 6, 8])(
    "progressivo e EXIF %s medem bruto com preenchimento",
    async (orientation) => {
      const original = new Uint8Array(
        await sharp(png)
          .jpeg({ progressive: true })
          .withMetadata({ orientation })
          .toBuffer(),
      );
      const bytes = insertJpeg(original, 2, [255, 255]);
      const result = await prepareIdentityImage(blob(bytes), {
        signal: signal(),
      });
      expect(result.asset).toMatchObject({
        width: 32,
        height: 16,
        sha256: hash(bytes),
      });
      expect(new Uint8Array(await result.blob.arrayBuffer())).toEqual(bytes);
    },
  );
  it.each([
    ["length0", [255, 239, 0, 0]],
    ["length1", [255, 239, 0, 1]],
    ["length-truncated", [255, 239, 0]],
    ["payload-truncated", [255, 239, 255, 255]],
    ["terminal-FF", [255, 255, 255]],
    ["no-SOF", [255, 239, 0, 2]],
    ["SOS", [255, 218, 0, 2]],
    ["SOI", [255, 216]],
    ["EOI", [255, 217]],
    ["TEM", [255, 1]],
    ...Array.from({ length: 8 }, (_, i) => [`RST${i}`, [255, 208 + i]]),
    ["stuffed-zero", [255, 0, 0, 2]],
    ["outside-boundary", [255, 239, 0, 2, 42]],
    ["SOF-short", [255, 192, 0, 7, 8, 0, 16, 0, 32]],
    ["SOF-truncated", [255, 192, 0, 17, 8, 0, 16, 0, 32, 3]],
  ] as Array<[string, number[]]>)(
    "recusa %s antes de abrir",
    async (_name, tail) => {
      await errorCode(
        blob(new Uint8Array([255, 216, ...tail])),
        "IDENTITY_IMAGE_DIMENSIONS",
      );
      expect(images).toHaveLength(0);
      expect(URL.createObjectURL).not.toHaveBeenCalled();
    },
  );
  it("adapta antes da primeira leitura mesmo se leitor retornaria medida plausivel", async () => {
    // Payload and everything after SOF must survive verbatim, including FF FF.
    const tail = insertJpeg(baselineJpeg, 159, [255, 255]);
    const expectedQuery = insertJpeg(
      tail,
      2,
      [255, 239, 0, 6, 65, 255, 255, 66],
    );
    const input = insertJpeg(expectedQuery, 2, [255, 255]);
    let received: Uint8Array | undefined;
    vi.resetModules();
    vi.doMock("image-dimensions", () => ({
      imageDimensionsFromData: (bytes: Uint8Array) => {
        received = bytes;
        return { type: "jpeg", width: 32, height: 16 };
      },
    }));
    const { prepareIdentityImage: prepare } = await import(
      "@/lib/prepareIdentityImage"
    );
    const result = await prepare(blob(input), { signal: signal() });
    expect(received).toEqual(expectedQuery);
    expect(new Uint8Array(await result.blob.arrayBuffer())).toEqual(input);
    expect(result.asset.sha256).toBe(hash(input));
  });
});

describe("entradas recusadas antes de abrir", () => {
  it.each([null, {}, "fake"])("nao Blob %#", async (value) => {
    await errorCode(value as Blob, "IDENTITY_IMAGE_INVALID");
  });
  it.each([0, 20 * 1024 * 1024 + 1])("tamanho %s", async (size) => {
    const input = new Blob([new Uint8Array(size)]);
    const read = vi.spyOn(input, "arrayBuffer");
    await errorCode(input, "IDENTITY_IMAGE_SIZE");
    expect(read).not.toHaveBeenCalled();
  });
  it.each([
    null,
    {},
    { signal: {} },
    { signal: signal(), timeoutMs: 0 },
    { signal: signal(), timeoutMs: 120001 },
    { signal: signal(), timeoutMs: 1.2 },
  ])("opcoes invalidas %#", async (options) => {
    await errorCode(
      blob(),
      "IDENTITY_IMAGE_INVALID",
      options as PrepareIdentityImageOptions,
    );
  });
  it.each([
    "GIF89a",
    "%PDF-1.7",
    "<html/>",
    "<svg/>",
    '<svg xmlns="wrong"/>',
    '<svg xmlns="http://www.w3.org/2000/svg">',
    "RIFF0000AVI ",
    "....ftypavif",
  ])("formato nao autorizado %#", async (content) => {
    await errorCode(
      new Blob([content], { type: "image/png" }),
      "IDENTITY_IMAGE_FORMAT",
    );
    expect(images).toHaveLength(0);
  });
  it("UTF8 invalido falha; entidade externa e erro somente neste parser jsdom", async () => {
    await errorCode(
      blob(new Uint8Array([0xff, 0xfe, 60, 115, 118, 103])),
      "IDENTITY_IMAGE_FORMAT",
    );
    await errorCode(
      svg(
        '<!DOCTYPE svg [<!ENTITY x SYSTEM "http://127.0.0.1/trap">]><svg xmlns="http://www.w3.org/2000/svg">&x;</svg>',
      ),
      "IDENTITY_IMAGE_FORMAT",
    );
  });
  it("arrayBuffer de tamanho diferente e recusado", async () => {
    const input = blob();
    vi.spyOn(input, "arrayBuffer").mockResolvedValue(new ArrayBuffer(1));
    await errorCode(input, "IDENTITY_IMAGE_SIZE");
  });
});

function ico() {
  const bytes = new Uint8Array(26);
  bytes.set([0, 0, 1, 0, 1, 0, 0, 0]);
  const view = new DataView(bytes.buffer);
  view.setUint32(14, 4, true);
  view.setUint32(18, 22, true);
  return bytes;
}
function riff(chunks: Array<[string, Uint8Array]>) {
  const bytes = new Uint8Array(
    12 +
      chunks.reduce(
        (n, [, data]) => n + 8 + data.length + (data.length % 2),
        0,
      ),
  );
  bytes.set(new TextEncoder().encode("RIFF"));
  bytes.set(new TextEncoder().encode("WEBP"), 8);
  const view = new DataView(bytes.buffer);
  view.setUint32(4, bytes.length - 8, true);
  let offset = 12;
  for (const [name, data] of chunks) {
    bytes.set(new TextEncoder().encode(name), offset);
    view.setUint32(offset + 4, data.length, true);
    bytes.set(data, offset + 8);
    offset += 8 + data.length + (data.length % 2);
  }
  return bytes;
}
describe("SVG ICO e RIFF", () => {
  it.each([() => svg(), () => blob(ico())])(
    "natureza sem dimensao unica %#",
    async (input) => {
      const result = await prepareIdentityImage(input(), { signal: signal() });
      expect(result.asset).not.toHaveProperty("width");
      expect(result.asset).not.toHaveProperty("height");
    },
  );
  it.each(["count", "table", "offset", "size", "zero"])(
    "ICO %s invalido",
    async (kind) => {
      let bytes = ico();
      const view = new DataView(bytes.buffer);
      if (kind === "count") view.setUint16(4, 0, true);
      if (kind === "table") bytes = bytes.slice(0, 21);
      if (kind === "offset") view.setUint32(18, 8, true);
      if (kind === "size") view.setUint32(14, 0xffffffff, true);
      if (kind === "zero") view.setUint32(14, 0, true);
      await errorCode(blob(bytes), "IDENTITY_IMAGE_FORMAT");
    },
  );
  it("SVG com dimensao natural excessiva falha e libera URL", async () => {
    decode.mockImplementation(async () => {
      images[0].naturalWidth = 8193;
    });
    await errorCode(svg(), "IDENTITY_IMAGE_DIMENSIONS");
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1);
  });
  it("SVG sem medida natural nao ganha dimensao inventada", async () => {
    decode.mockImplementation(async () => {
      images[0].naturalWidth = 0;
      images[0].naturalHeight = 0;
    });
    expect(
      (await prepareIdentityImage(svg(), { signal: signal() })).asset,
    ).not.toHaveProperty("width");
  });
  it.each(["truncated", "overflow", "chunk", "padding", "frames"])(
    "RIFF %s e recusado",
    async (kind) => {
      let bytes = riff([
        ["ANMF", new Uint8Array(1)],
        ["ANMF", new Uint8Array(1)],
      ]);
      const view = new DataView(bytes.buffer);
      if (kind === "truncated") bytes = bytes.slice(0, 11);
      if (kind === "overflow") view.setUint32(4, 0xffffffff, true);
      if (kind === "chunk") view.setUint32(16, 0xffffffff, true);
      if (kind === "padding") {
        bytes = bytes.slice(0, 21);
        new DataView(bytes.buffer).setUint32(4, 13, true);
      }
      await errorCode(blob(bytes), "IDENTITY_IMAGE_FORMAT");
    },
  );
  it("ANMF dentro de chunk desconhecido nao conta quadro", async () => {
    const webp = new Uint8Array(await sharp(png).webp().toBuffer());
    const unknown = riff([["TEST", new TextEncoder().encode("ANMFANMF!")]]);
    const combined = new Uint8Array(webp.length + unknown.length - 12);
    combined.set(webp);
    combined.set(unknown.slice(12), webp.length);
    new DataView(combined.buffer).setUint32(4, combined.length - 8, true);
    expect(
      (await prepareIdentityImage(blob(combined), { signal: signal() })).asset
        .width,
    ).toBe(32);
  });
});

describe("cancelamento prazo e erros fechados", () => {
  it("timeout null nao e omissao", async () => {
    await errorCode(blob(), "IDENTITY_IMAGE_INVALID", {
      signal: signal(),
      timeoutMs: null as unknown as number,
    });
  });
  it("libera listener e timer ao terminar", async () => {
    const controller = new AbortController();
    const add = vi.spyOn(controller.signal, "addEventListener");
    const remove = vi.spyOn(controller.signal, "removeEventListener");
    const clear = vi.spyOn(globalThis, "clearTimeout");
    await prepareIdentityImage(blob(), { signal: controller.signal });
    expect(remove).toHaveBeenCalledWith("abort", add.mock.calls[0][1]);
    expect(clear).toHaveBeenCalledTimes(1);
  });
  it("abortado antes de ler", async () => {
    const controller = new AbortController();
    controller.abort("SECRET");
    const input = blob();
    const read = vi.spyOn(input, "arrayBuffer");
    await errorCode(input, "IDENTITY_IMAGE_CANCELED", {
      signal: controller.signal,
    });
    expect(read).not.toHaveBeenCalled();
  });
  it("captura opcoes e le bytes somente uma vez", async () => {
    const pending = deferred<ArrayBuffer>();
    const input = blob();
    const read = vi
      .spyOn(input, "arrayBuffer")
      .mockReturnValue(pending.promise);
    const original = new AbortController();
    const options = { signal: original.signal, timeoutMs: 5000 };
    const result = prepareIdentityImage(input, options);
    options.signal = signal();
    options.timeoutMs = 0;
    original.abort();
    await expect(result).rejects.toMatchObject({
      code: "IDENTITY_IMAGE_CANCELED",
    });
    pending.resolve(new Uint8Array(png).buffer);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(read).toHaveBeenCalledTimes(1);
    expect(images).toHaveLength(0);
  });
  it.each(["read", "decode", "digest"])(
    "aborta durante %s sem sucesso tardio",
    async (stage) => {
      const controller = new AbortController();
      const pending = deferred<never>();
      const started = deferred<void>();
      const input = blob();
      const wait = () => {
        started.resolve();
        return pending.promise;
      };
      if (stage === "read")
        vi.spyOn(input, "arrayBuffer").mockImplementation(wait);
      if (stage === "decode") decode.mockImplementation(wait);
      if (stage === "digest")
        vi.stubGlobal("crypto", { subtle: { digest: wait } });
      const result = prepareIdentityImage(input, { signal: controller.signal });
      await started.promise;
      controller.abort();
      await expect(result).rejects.toMatchObject({
        code: "IDENTITY_IMAGE_CANCELED",
      });
      pending.reject(Error("LATE_SECRET"));
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(URL.revokeObjectURL).toHaveBeenCalledTimes(
        stage === "read" ? 0 : 1,
      );
      if (stage !== "read") expect(images[0].src).toBe("");
    },
  );
  it.each(["read", "decode", "digest"])("prazo durante %s", async (stage) => {
    const input = blob();
    const wait = () => new Promise<never>(() => {});
    if (stage === "read")
      vi.spyOn(input, "arrayBuffer").mockImplementation(wait);
    if (stage === "decode") decode.mockImplementation(wait);
    if (stage === "digest")
      vi.stubGlobal("crypto", { subtle: { digest: wait } });
    await errorCode(input, "IDENTITY_IMAGE_TIMEOUT", {
      signal: signal(),
      timeoutMs: 30,
    });
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(stage === "read" ? 0 : 1);
  });
  it("erro decode nativo nao vaza mensagem e solta recursos", async () => {
    decode.mockRejectedValue(Error("SECRET_NATIVE"));
    await errorCode(blob(), "IDENTITY_IMAGE_DECODE");
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1);
  });
  it("erro digest nativo nao vaza mensagem", async () => {
    vi.stubGlobal("crypto", {
      subtle: {
        digest: async () => {
          throw Error("SECRET");
        },
      },
    });
    await errorCode(blob(), "IDENTITY_IMAGE_INVALID");
  });
});

describe("fronteira da importacao tardia", () => {
  it.each(["cancel", "timeout"])(
    "%s durante import nao continua ao resolver tarde",
    async (kind) => {
      const pending = deferred<void>();
      const started = deferred<void>();
      vi.resetModules();
      vi.doMock("image-dimensions", async () => {
        started.resolve();
        await pending.promise;
        return {
          imageDimensionsFromData: () => {
            throw Error("LATE_READER_CALLED");
          },
        };
      });
      const { prepareIdentityImage: prepare } = await import(
        "@/lib/prepareIdentityImage"
      );
      const controller = new AbortController();
      const result = prepare(blob(), {
        signal: controller.signal,
        timeoutMs: 30,
      });
      const assertion = expect(result).rejects.toMatchObject({
        code:
          kind === "cancel"
            ? "IDENTITY_IMAGE_CANCELED"
            : "IDENTITY_IMAGE_TIMEOUT",
      });
      await started.promise;
      if (kind === "cancel") controller.abort();
      await assertion;
      pending.resolve();
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(images).toHaveLength(0);
    },
  );
  it.each([
    undefined,
    { type: "jpeg", width: 32, height: 16 },
    { type: "png", width: 1.5, height: 16 },
  ])("resultado de leitor inconsistente %#", async (value) => {
    vi.resetModules();
    vi.doMock("image-dimensions", () => ({
      imageDimensionsFromData: () => value,
    }));
    const { prepareIdentityImage: prepare } = await import(
      "@/lib/prepareIdentityImage"
    );
    await expect(prepare(blob(), { signal: signal() })).rejects.toMatchObject({
      code: "IDENTITY_IMAGE_DIMENSIONS",
    });
    expect(images).toHaveLength(0);
  });
});
