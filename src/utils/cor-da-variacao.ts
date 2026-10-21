const cores = new Map(
  (
    "branco:ffffff,branca:ffffff,preto:171717,preta:171717,cinza:9ca3af,chumbo:4b5563,grafite:374151," +
    "azul:2563eb,azul marinho:172554,marinho:172554,azul bebe:bfdbfe,celeste:7dd3fc,azul royal:1d4ed8," +
    "verde:15803d,verde militar:4b5320,musgo:606c38,oliva:808000,menta:a7f3d0,vermelho:dc2626,vinho:722f37,bordo:800020," +
    "rosa:f9a8d4,rosa pink:db2777,pink:db2777,nude:d8b4a0,bege:dbc8a4,areia:ddcba4,creme:fffdd0,off white:f5f2e9," +
    "marrom:783f23,caramelo:af6f32,cafe:4b2e24,amarelo:facc15,mostarda:c49a16,laranja:ea580c,roxo:7e22ce,lilas:c4b5fd," +
    "lavanda:e6e6fa,dourado:d4af37,prata:c0c0c0,jeans:4b7399,terracota:b65d43"
  )
    .split(",")
    .map((par) => {
      const [nome, hex] = par.split(":");
      return [nome, `#${hex}`];
    }),
);

export function corDaVariacao(
  valor: string,
  hex?: string | null,
): string | null {
  if (hex && /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(hex)) return hex;
  const nome = valor
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
  return cores.get(nome) ?? null;
}
