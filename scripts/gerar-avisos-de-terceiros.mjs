/* eslint-disable security/detect-non-literal-fs-filename -- caminhos locais do inventário npm e arquivos fixos do projeto */
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { licencasVerificadas } from "./avisos-de-terceiros-licencas.mjs";

const raiz = new URL("../", import.meta.url);
const destino = new URL("public/THIRD_PARTY_NOTICES.txt", raiz);
const ler = (arquivo) => readFileSync(arquivo, "utf8").replace(/\r\n/g, "\n");
const json = (arquivo) => JSON.parse(ler(arquivo));

// --check não descobre transitivas novas no bundle; revise a lista quando o
// empacotamento mudar. Para atualizar o inventário, usar os IDs de chunk.modules
// com renderedLength > 0 no generateBundle do Vite (modo fixture), incluindo
// os chunks sob demanda. Inclui também o CSS do Tailwind e o workbox-core,
// já incorporado pelo workbox-window conforme seu source map.
const transitivas = `
@floating-ui/core
@floating-ui/dom
@floating-ui/react-dom
@floating-ui/utils
@radix-ui/number
@radix-ui/primitive
@radix-ui/react-alert-dialog/node_modules/@radix-ui/react-slot
@radix-ui/react-arrow
@radix-ui/react-avatar/node_modules/@radix-ui/react-context
@radix-ui/react-avatar/node_modules/@radix-ui/react-primitive
@radix-ui/react-collection
@radix-ui/react-collection/node_modules/@radix-ui/react-slot
@radix-ui/react-compose-refs
@radix-ui/react-context
@radix-ui/react-dialog/node_modules/@radix-ui/react-slot
@radix-ui/react-direction
@radix-ui/react-dismissable-layer
@radix-ui/react-focus-guards
@radix-ui/react-focus-scope
@radix-ui/react-id
@radix-ui/react-label/node_modules/@radix-ui/react-primitive
@radix-ui/react-menu
@radix-ui/react-menu/node_modules/@radix-ui/react-slot
@radix-ui/react-popper
@radix-ui/react-portal
@radix-ui/react-presence
@radix-ui/react-primitive
@radix-ui/react-primitive/node_modules/@radix-ui/react-slot
@radix-ui/react-roving-focus
@radix-ui/react-select/node_modules/@radix-ui/react-slot
@radix-ui/react-use-callback-ref
@radix-ui/react-use-controllable-state
@radix-ui/react-use-escape-keydown
@radix-ui/react-use-is-hydrated
@radix-ui/react-use-layout-effect
@radix-ui/react-use-previous
@radix-ui/react-use-size
@radix-ui/react-visually-hidden
@supabase/auth-js
@supabase/functions-js
@supabase/phoenix
@supabase/postgrest-js
@supabase/realtime-js
@supabase/storage-js
aria-hidden
d3-array
d3-path
d3-scale
d3-shape
decimal.js-light
embla-carousel
embla-carousel-reactive-utils
eventemitter3
fast-equals
get-nonce
iceberg-js
internmap
js-base64
motion-dom
motion-utils
prop-types
querystringify
react-is
react-remove-scroll
react-remove-scroll-bar
react-smooth
react-style-singleton
recharts-scale
requires-port
scheduler
tailwindcss
tiny-invariant
tslib
url-parse
use-callback-ref
use-sidecar
use-sync-external-store
workbox-core
workbox-window
`
  .trim()
  .split("\n");

function pastasDosPacotes() {
  const { dependencies } = json(new URL("package.json", raiz));
  // Tipos são apagados pelo compilador; demais dependências diretas são
  // incluídas por padrão, inclusive as novas ainda não auditadas no bundle.
  const diretas = Object.keys(dependencies).filter(
    (nome) => nome !== "@types/canvas-confetti",
  );
  return [...new Set([...diretas, ...transitivas])].sort();
}

function textosDaPasta(pasta) {
  const nomes = readdirSync(pasta).sort();
  const arquivo = nomes.find((nome) =>
    /^licen[cs]e(?:\.md|\.txt)?$/i.test(nome),
  );
  const licenca = arquivo ? ler(new URL(arquivo, pasta)).trim() : "";
  return {
    licenca,
    avisos: nomes
      .filter((nome) =>
        /^(?:notice|copyrightnotice|copyright)(?:\.md|\.txt)?$/i.test(nome),
      )
      .map((nome) => ler(new URL(nome, pasta)).trim())
      // Alguns pacotes (tslib) repetem LICENSE dentro de CopyrightNotice.
      .filter((aviso) => aviso.replace(/^[/*\s]+|[/*\s]+$/g, "") !== licenca),
  };
}

function copyrightDoPacote(pacote, licenca) {
  const linhas = licenca.split("\n");
  const copyrights = linhas
    .filter(
      (linha) =>
        /^\s*(?:copyright\s|©|all rights reserved\.?\s*$)/i.test(linha) &&
        !/^\s*copyright (?:holders?\b|owners?\b)/i.test(linha) &&
        !linha.includes("[yyyy]"),
    )
    .map((linha) => linha.trim());
  if (pacote.name === "lodash-es") return licenca.split("\n\n====")[0];
  if (pacote.name === "dompurify") {
    const banner = ler(
      new URL("node_modules/dompurify/dist/purify.es.mjs", raiz),
    ).split("\n")[0];
    return banner.split(" | ")[1] ?? banner;
  }
  return copyrights.join("\n");
}

function lerPacotes() {
  const { packages } = json(new URL("package-lock.json", raiz));
  const fixados = new Map(Object.entries(packages));
  const porIdentidade = new Map();
  for (const caminho of pastasDosPacotes()) {
    const local = `node_modules/${caminho}`;
    const pasta = new URL(`${local}/`, raiz);
    const pacote = json(new URL("package.json", pasta));
    if (fixados.get(local)?.version !== pacote.version) {
      throw new Error(
        `${local}: versão instalada diferente do lockfile; confira a instalação e o inventário.`,
      );
    }
    const id = `${pacote.name}@${pacote.version}`;
    const { licenca, avisos } = textosDaPasta(pasta);
    const excecao = licenca ? undefined : licencasVerificadas.get(id);
    const texto = licenca || excecao?.texto;
    if (!texto) throw new Error(`${id}: sem LICENSE nem exceção verificada.`);
    const creditos = [
      excecao?.ressalva,
      excecao && `LICENSE upstream: ${excecao.fonte}`,
      copyrightDoPacote(pacote, texto),
      ...avisos,
    ].filter(Boolean);
    const atual = porIdentidade.get(id);
    // Instâncias da mesma versão podem estar em caminhos aninhados no npm.
    if (atual) {
      for (const credito of creditos) atual.creditos.add(credito);
      continue;
    }
    const spdx = pacote.license;
    const aplicada = spdx === "(MPL-2.0 OR Apache-2.0)" ? "Apache-2.0" : spdx;
    porIdentidade.set(id, {
      id,
      spdx,
      licencas: pacote.name === "lucide-react" ? [aplicada, "MIT"] : [aplicada],
      creditos: new Set(creditos),
    });
  }
  return [...porIdentidade.keys()].sort().map((id) => porIdentidade.get(id));
}

function termos(pacote, inicio) {
  const { licenca } = textosDaPasta(new URL(`node_modules/${pacote}/`, raiz));
  const posicao = licenca.indexOf(inicio);
  if (posicao === -1)
    throw new Error(`Texto esperado não encontrado em ${pacote}.`);
  return licenca.slice(posicao);
}

function gerar() {
  const pacotes = lerPacotes();
  // O README do npm distingue o wrapper MIT da implementação C++ Apache.
  // As atribuições nativas são específicas deste binário, não do wrapper JS.
  if (!pacotes.some(({ id }) => id === "zxing-wasm@3.1.5"))
    throw new Error(
      "Atualize os avisos do código nativo para a versão instalada de zxing-wasm.",
    );

  const nativos = [
    "ZXing-C++ (embutido no WASM leitor de zxing-wasm@3.1.5)",
    "ZXingWasm.cpp (ponte C++ de zxing-wasm@3.1.5)",
  ];
  const textos = {
    "0BSD": termos("tslib", "Permission to use"),
    "Apache-2.0": termos("dompurify", "Apache License"),
    "BSD-3-Clause": termos("js-base64", "Redistribution and use"),
    ISC: termos("canvas-confetti", "Permission to use"),
    MIT: termos("react", "Permission is hereby granted"),
  };
  for (const { id, licencas } of pacotes) {
    for (const spdx of licencas) {
      if (!Object.hasOwn(textos, spdx))
        throw new Error(`${id}: adicione o texto integral da licença ${spdx}.`);
    }
  }

  const inventario = pacotes.map(({ id, spdx, licencas, creditos }) =>
    [
      `${id} — ${spdx}`,
      spdx !== licencas[0]
        ? `Licença utilizada nesta distribuição: ${licencas[0]}.`
        : "",
      licencas.length > 1 ? "Partes derivadas de Feather: MIT." : "",
      ...creditos,
    ]
      .filter(Boolean)
      .join("\n"),
  );
  const pastaZxing = new URL("node_modules/zxing-wasm/", raiz);
  const zxing = [
    "Código nativo no leitor de códigos de barras",
    `${nativos[0]} — Apache-2.0`,
    "https://github.com/zxing-cpp/zxing-cpp/tree/2ecec3f5be0ee803f6e14a5a2c7028c0cfe525b4",
    "Copyright 2019 Axel Waggershauser (core/src/ReadBarcode.cpp).",
    "Copyright 2016 Nu-book Inc. (core/src/Barcode.cpp e core/src/qrcode/QRDecoder.cpp).",
    "Copyright 2016 ZXing authors (core/src/Barcode.cpp e core/src/qrcode/QRDecoder.cpp).",
    "Consulte os demais avisos nas fontes upstream.",
    ...textosDaPasta(pastaZxing).avisos,
    "",
    `${nativos[1]} — Apache-2.0`,
    "https://github.com/Sec-ant/zxing-wasm/blob/v3.1.5/src/cpp/ZXingWasm.cpp",
    "Copyright 2016 Nu-book Inc.",
    "Copyright 2023 Axel Waggershauser",
    "Copyright 2023 Ze-Zheng Wu",
  ].join("\n");
  const licencas = Object.entries(textos)
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([spdx, texto]) => {
      const ids = pacotes
        .filter((p) => p.licencas.includes(spdx))
        .map((p) => p.id);
      if (spdx === "Apache-2.0") ids.push(...nativos);
      return [spdx, `Aplica-se a: ${ids.join(", ")}`, "", texto].join("\n");
    });
  const inter = ler(new URL("src/assets/fonts/OFL.txt", raiz)).trim();
  return `${[
    "IKCOUS Marketplace — Avisos de terceiros\n\nLicenças e atribuições dos componentes de terceiros distribuídos no aplicativo web.\nArquivo gerado por scripts/gerar-avisos-de-terceiros.mjs.",
    "O --check confere os pacotes conhecidos; não detecta novas transitivas no bundle. O inventário deve ser revisto quando o empacotamento mudar.",
    `Pacotes do navegador\n\n${inventario.join("\n\n")}`,
    zxing,
    ...licencas,
    `Inter — OFL-1.1\n\n${inter}`,
  ].join(
    "\n\n==============================================================================\n\n",
  )}\n`;
}

try {
  const esperado = gerar();
  if (process.argv[2] === "--check") {
    if (!existsSync(destino) || ler(destino) !== esperado) {
      console.error(
        "THIRD_PARTY_NOTICES.txt desatualizado. Rode: node scripts/gerar-avisos-de-terceiros.mjs",
      );
      process.exitCode = 1;
    }
  } else if (process.argv.length === 2) {
    writeFileSync(destino, esperado);
  } else {
    throw new Error(
      "Uso: node scripts/gerar-avisos-de-terceiros.mjs [--check]",
    );
  }
} catch (erro) {
  console.error(erro.message);
  process.exitCode = 1;
}
