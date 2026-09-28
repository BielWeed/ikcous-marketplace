// Temporário (28/09/2026): SÓ LEITURA. Abre cada loja nova pelo endereço
// público e confere que o porteiro entrega a ficha da loja certa.
const lojas = [
  ["Almeida Store", "almeidastore.vercel.app"],
  ["Brand Meliz", "brandmeliz.vercel.app"],
  ["Space Loja dos Kit", "spacelojadoskit.vercel.app"],
];
for (const [nome, host] of lojas) {
  for (const caminho of ["/", "/identidade.json", "/manifest.webmanifest"]) {
    const r = await fetch(`https://${host}${caminho}`, { redirect: "manual" });
    const texto = await r.text();
    const temNome = texto.includes(nome);
    const titulo = texto.match(/<title>([^<]*)<\/title>/)?.[1] ?? "";
    console.log(`${host}${caminho} → HTTP ${r.status} · ${texto.length} bytes · nome da loja: ${temNome ? "SIM" : "não"}${titulo ? ` · <title>${titulo}` : ""}`);
    if (caminho === "/identidade.json" && r.ok) console.log(`   ${texto.slice(0, 400)}`);
  }
}
