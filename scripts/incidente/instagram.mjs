// Temporário (28/09/2026): SÓ LEITURA. Testa se o runner do GitHub consegue ler
// o perfil PÚBLICO do Instagram (os 12 posts mais recentes) para montar o
// catálogo de lojas novas a partir do Instagram do cliente. Não loga nada além
// de contagens e trechos de legenda públicos.
const perfis = (process.env.PERFIS ?? "")
  .split(",")
  .map((p) => p.trim().replace(/^@/, ""))
  .filter(Boolean);

for (const perfil of perfis) {
  const r = await fetch(
    `https://i.instagram.com/api/v1/users/web_profile_info/?username=${encodeURIComponent(perfil)}`,
    {
      headers: {
        "x-ig-app-id": "936619743392459",
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36",
        Accept: "application/json",
      },
    },
  );
  const texto = await r.text();
  console.log(`\n== @${perfil}: HTTP ${r.status} (${texto.length} bytes)`);
  if (!r.ok) {
    console.log(texto.slice(0, 200));
    continue;
  }
  const usuario = JSON.parse(texto)?.data?.user;
  const midia = usuario?.edge_owner_to_timeline_media;
  console.log(`posts=${midia?.count} nesta página=${midia?.edges?.length} tem_mais=${midia?.page_info?.has_next_page}`);
  for (const { node } of (midia?.edges ?? []).slice(0, 3)) {
    const legenda = node.edge_media_to_caption?.edges?.[0]?.node?.text ?? "";
    console.log(`- ${node.__typename} foto=${Boolean(node.display_url)} legenda="${legenda.slice(0, 80).replace(/\s+/g, " ")}"`);
  }
}
