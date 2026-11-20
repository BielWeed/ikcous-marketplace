// @vitest-environment jsdom
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  upload: vi.fn(),
  abre: vi.fn(),
  remove: vi.fn(),
  success: vi.fn(),
  dismiss: vi.fn(),
}));
vi.mock("@/hooks/useProducts", () => ({
  useProducts: () => ({
    addProduct: vi.fn(),
    updateProduct: vi.fn(),
    upsertVariants: vi.fn(),
    deleteVariants: vi.fn(),
    uploadProductImages: mocks.upload,
    fetchProduct: vi.fn(),
  }),
}));
vi.mock("@/hooks/useCategories", () => ({
  useCategories: () => ({ categories: [], addCategory: vi.fn() }),
}));
vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: { shippingCoverage: "national" } }),
}));
vi.mock("@/lib/supabase", () => ({
  supabase: {
    rpc: vi.fn().mockResolvedValue({ data: [], error: null }),
    storage: { from: () => ({ remove: mocks.remove }) },
  },
}));
vi.mock("@/lib/imagem-abre", () => ({ imagemAbre: mocks.abre }));
vi.mock("sonner", () => ({
  toast: {
    info: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    loading: vi.fn(() => "envio"),
    success: mocks.success,
    dismiss: mocks.dismiss,
  },
}));

// @ts-expect-error flag interna do React.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let raiz: Root;
let hospedeiro: HTMLDivElement;
let desmontou: boolean;
const BASE = "https://loja.supabase.co/storage/v1/object/public/products/";
const CAMINHO = "11111111-1111-4111-8111-aaaaaaaaaaaa.jpg";
function adiar<T>() {
  let resolver!: (valor: T) => void;
  const promessa = new Promise<T>((r) => {
    resolver = r;
  });
  return { promessa, resolver };
}
async function drenar() {
  await act(async () => {
    for (let i = 0; i < 30; i++) await Promise.resolve();
  });
}
function sair() {
  act(() => raiz.unmount());
  desmontou = true;
}
beforeEach(async () => {
  vi.resetAllMocks();
  vi.stubEnv("VITE_SUPABASE_URL", "https://loja.supabase.co");
  mocks.abre.mockResolvedValue(true);
  mocks.remove.mockResolvedValue({ data: [], error: null });
  mocks.upload.mockResolvedValue([BASE + CAMINHO]);
  vi.spyOn(console, "error").mockImplementation(() => {});
  const armazem = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (c: string) => armazem.get(c) ?? null,
    setItem: (c: string, v: string) => {
      armazem.set(c, v);
    },
    removeItem: (c: string) => {
      armazem.delete(c);
    },
  });
  desmontou = false;
  hospedeiro = document.createElement("div");
  document.body.append(hospedeiro);
  raiz = createRoot(hospedeiro);
  const { AdminProductFormView } = await import(
    "@/views/admin/AdminProductFormView"
  );
  await act(async () =>
    raiz.render(
      <AdminProductFormView onNavigate={vi.fn()} onSetDirty={vi.fn()} />,
    ),
  );
});
afterEach(() => {
  if (!desmontou) sair();
  hospedeiro.remove();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});
async function enviarTres() {
  const input = document.getElementById(
    "product-image-upload",
  ) as HTMLInputElement;
  Object.defineProperty(input, "files", {
    value: ["a.jpg", "b.jpg", "c.jpg"].map(
      (nome) => new File(["x"], nome, { type: "image/jpeg" }),
    ),
  });
  await act(async () =>
    input.dispatchEvent(new Event("change", { bubbles: true })),
  );
  await drenar();
}

it("sair durante o primeiro envio impede os outros dois e limpa só o upload tardio", async () => {
  const envio = adiar<string[]>();
  mocks.upload.mockReturnValueOnce(envio.promessa);
  await enviarTres();
  expect(mocks.upload).toHaveBeenCalledTimes(1);
  sair();
  envio.resolver([BASE + CAMINHO]);
  await drenar();
  expect(mocks.upload).toHaveBeenCalledTimes(1);
  expect(mocks.abre).toHaveBeenCalledTimes(1);
  expect(mocks.success).not.toHaveBeenCalled();
  expect(mocks.remove).toHaveBeenCalledExactlyOnceWith([CAMINHO]);
});

it("sair depois da primeira foto aceita não apaga a aceita nem envia a segunda em compressão", async () => {
  const leitura = adiar<boolean>();
  mocks.abre.mockResolvedValueOnce(true).mockReturnValueOnce(leitura.promessa);
  await enviarTres();
  expect(mocks.upload).toHaveBeenCalledTimes(1);
  expect(mocks.abre).toHaveBeenCalledTimes(2);
  sair();
  leitura.resolver(true);
  await drenar();
  expect(mocks.upload).toHaveBeenCalledTimes(1);
  expect(mocks.abre).toHaveBeenCalledTimes(2);
  expect(mocks.success).not.toHaveBeenCalled();
  expect(mocks.remove).not.toHaveBeenCalled();
});

it("controle: permanecer no formulário envia as três e avisa sucesso", async () => {
  await enviarTres();
  expect(mocks.upload).toHaveBeenCalledTimes(3);
  expect(mocks.success).toHaveBeenCalledExactlyOnceWith(
    "Fotos enviadas com sucesso",
    { id: "envio" },
  );
  expect(mocks.remove).not.toHaveBeenCalled();
});
