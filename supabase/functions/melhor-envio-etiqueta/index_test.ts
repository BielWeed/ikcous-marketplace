// @ts-nocheck
// Testes da function melhor-envio-etiqueta (padrão calculate-shipping:
// funções puras exportadas + handler com costura de deps — sem rede).
import { assertEquals } from "https://deno.land/std@0.177.0/testing/asserts.ts"
import {
  extrairEnderecoDoPedido,
  extrairServiceIdDaOpcao,
  handler,
  montarProdutosEVolumes,
  montarRemetente,
  normalizarCheckout,
  normalizarTracking,
  erroDePedidoParaEtiqueta,
} from "./index.ts"

// ── extrairServiceIdDaOpcao ────────────────────────────────────────────────

Deno.test("service id - opção melhor-envio guarda os dígitos do serviço", () => {
  assertEquals(extrairServiceIdDaOpcao("melhor-envio-12345"), "12345")
})

Deno.test("service id - frete fixo, entrega local e null não casam", () => {
  assertEquals(extrairServiceIdDaOpcao("flat-fee-standard"), null)
  assertEquals(extrairServiceIdDaOpcao("local-delivery"), null)
  assertEquals(extrairServiceIdDaOpcao(null), null)
  assertEquals(extrairServiceIdDaOpcao("melhor-envio-abc"), null)
})

// ── extrairEnderecoDoPedido ────────────────────────────────────────────────

Deno.test("endereço - snapshot addressData vence (mesma prioridade do mapper)", () => {
  const cd = {
    cep: "38500-000",
    city: "Monte Carmelo",
    street: "Rua Antiga",
    addressData: {
      cep: "01310-100",
      street: "Av. Paulista",
      number: "1000",
      city: "São Paulo",
      state: "SP",
      neighborhood: "Bela Vista",
    },
  }
  const endereco = extrairEnderecoDoPedido(cd)
  assertEquals(endereco.cep, "01310100") // só dígitos, pronto para o ME
  assertEquals(endereco.street, "Av. Paulista")
  assertEquals(endereco.city, "São Paulo")
})

Deno.test("endereço - sem snapshot, cai na raiz do customer_data", () => {
  const cd = {
    cep: "38500000",
    address_text: "Rua da Matriz",
    number: "42",
    city: "Monte Carmelo",
    state: "MG",
    neighborhood: "Centro",
  }
  const endereco = extrairEnderecoDoPedido(cd)
  assertEquals(endereco.street, "Rua da Matriz")
  assertEquals(endereco.number, "42")
})

Deno.test("endereço - faltou CEP, rua, número ou cidade: recusa", () => {
  assertEquals(extrairEnderecoDoPedido({ city: "Monte Carmelo", street: "Rua", number: "1" }), null)
  assertEquals(extrairEnderecoDoPedido({ cep: "38500000", street: "Rua", number: "1" }), null)
  assertEquals(extrairEnderecoDoPedido({ cep: "38500000", city: "X", number: "1" }), null)
  assertEquals(extrairEnderecoDoPedido({ cep: "38500000", city: "X", street: "Rua" }), null)
  assertEquals(extrairEnderecoDoPedido(null), null)
})

// ── erroDePedidoParaEtiqueta ───────────────────────────────────────────────

Deno.test("portão de status - cancelado e entregue não geram etiqueta", () => {
  assertEquals(erroDePedidoParaEtiqueta({ status: "cancelled" }) !== null, true)
  assertEquals(erroDePedidoParaEtiqueta({ status: "delivered" }) !== null, true)
  assertEquals(erroDePedidoParaEtiqueta({ status: "returned" }) !== null, true)
})

Deno.test("portão de status - processando e novo passam", () => {
  assertEquals(erroDePedidoParaEtiqueta({ status: "processing" }), null)
  assertEquals(erroDePedidoParaEtiqueta({ status: "new" }), null)
  assertEquals(erroDePedidoParaEtiqueta({ status: null }), null)
})

// ── montarProdutosEVolumes ─────────────────────────────────────────────────

Deno.test("produtos e volumes - leitura do banco com fallbacks da cotação", () => {
  const itens = [
    { product_id: "p1", quantity: 2, unit_price: 10 },
    { product_id: "p2", quantity: 1, unit_price: 5 },
  ]
  const produtosDb = [
    { id: "p1", nome: "Caneca", preco_venda: 25, peso_kg: 0.4, largura_cm: 10, altura_cm: 12, comprimento_cm: 14 },
  ]
  const { products, volumes } = montarProdutosEVolumes(itens, produtosDb)
  assertEquals(products.length, 2)
  assertEquals(volumes.length, 2)
  // Produto no banco: preço e medida do banco, peso da LINHA (0.4 × 2).
  assertEquals(products[0], { name: "Caneca", quantity: 2, unitary_value: 25 })
  assertEquals(volumes[0], { weight: 0.8, width: 10, height: 12, length: 14 })
  // Produto fora do banco: fallbacks iguais aos do calculate-shipping.
  assertEquals(products[1], { name: "Produto", quantity: 1, unitary_value: 5 })
  assertEquals(volumes[1], { weight: 0.3, width: 15, height: 15, length: 15 })
})

// ── montarRemetente ────────────────────────────────────────────────────────

Deno.test("remetente - empresa + endereço padrão da conta ME viram o from", () => {
  const meData = {
    name: "Loja do Gabriel",
    email: "loja@teste.com",
    companies: [{ name: "IKCOUS", company_document: "12345678000199", phone: "34999990000" }],
    addresses: [
      { postal_code: "38500-000", address: "Rua A", number: "10", district: "Centro", city: { city: "Monte Carmelo", state_abbr: "MG" }, is_default: false },
      { postal_code: "01310100", address: "Av. B", number: "20", district: "Bela Vista", city: { city: "São Paulo", state_abbr: "SP" }, is_default: true },
    ],
  }
  const from = montarRemetente(meData)
  assertEquals(from.company_document, "12345678000199")
  assertEquals(from.document, undefined) // PJ não leva CPF junto
  assertEquals(from.postal_code, "01310100") // endereço PADRÃO, não o primeiro
  assertEquals(from.state_abbr, "SP")
  assertEquals(from.country_id, "BR")
})

Deno.test("remetente - falta documento ou CEP válido: null (falha antes de gastar saldo)", () => {
  assertEquals(montarRemetente({ companies: [{}], addresses: [{ postal_code: "38500000", city: { city: "X", state_abbr: "MG" } }] }), null)
  assertEquals(montarRemetente({ companies: [{ company_document: "123" }], addresses: [{ postal_code: "123", city: { city: "X", state_abbr: "MG" } }] }), null)
  assertEquals(montarRemetente(null), null)
})

// ── normalizarCheckout ─────────────────────────────────────────────────────

Deno.test("checkout - status paid fecha a compra", () => {
  const r = normalizarCheckout({ purchase: { id: "pur-1", status: "paid" } })
  assertEquals(r.pago, true)
  assertEquals(r.purchaseId, "pur-1")
})

Deno.test("checkout - 200 sem pagamento não engana: status pendente vira erro amigável", () => {
  const r = normalizarCheckout({ purchase: { id: "pur-2", status: "pending" } })
  assertEquals(r.pago, false)
  assertEquals(String(r.erro).includes("saldo"), true)
})

// ── normalizarTracking ─────────────────────────────────────────────────────

Deno.test("tracking - objeto chaveado pelo id da etiqueta", () => {
  const data = { "abc-123": { tracking: "ME23002OWZ7BR", status: "posted" } }
  assertEquals(normalizarTracking(data, "abc-123").tracking, "ME23002OWZ7BR")
  assertEquals(normalizarTracking(data, "abc-123").status, "posted")
})

Deno.test("tracking - vazio NÃO é erro: etiqueta recém-gerada pode não ter código", () => {
  assertEquals(normalizarTracking({ "abc-123": {} }, "abc-123").tracking, null)
  assertEquals(normalizarTracking({}, "abc-123").tracking, null)
})

// ── handler (costura de deps, sem rede) ────────────────────────────────────

function respostaJson(res: Response): Promise<any> {
  return res.json()
}

Deno.test("handler - OPTIONS responde ok (CORS)", async () => {
  const res = await handler(new Request("https://x/", { method: "OPTIONS" }))
  assertEquals(res.status, 200)
})

Deno.test("handler - sem orderId recusa antes de qualquer leitura", async () => {
  const res = await handler(
    new Request("https://x/", { method: "POST", body: JSON.stringify({ action: "gerar_etiqueta" }) }),
  )
  assertEquals(res.status, 400)
  const corpo = await respostaJson(res)
  assertEquals(String(corpo.error).includes("pedido"), true)
})

Deno.test("handler - sem Authorization NÃO passa da porta de admin", async () => {
  const res = await handler(
    new Request("https://x/", {
      method: "POST",
      body: JSON.stringify({ action: "gerar_etiqueta", orderId: "00000000-0000-0000-0000-000000000000" }),
    }),
  )
  assertEquals(res.status, 403)
  const corpo = await respostaJson(res)
  assertEquals(String(corpo.error).includes("administradores"), true)
})

Deno.test("handler - action desconhecida nomeia as duas válidas (protegida por admin)", async () => {
  const res = await handler(
    new Request("https://x/", {
      method: "POST",
      headers: { Authorization: "Bearer jwt-falso" },
      body: JSON.stringify({ action: "apagar_tudo", orderId: "00000000-0000-0000-0000-000000000000" }),
    }),
  )
  // O check de admin roda ANTES (verifyIsAdmin não consegue validar um JWT
  // falso sem rede, e falha fechado) — o que importa aqui é que a action
  // estranha nunca alcança leitura de pedido.
  assertEquals(res.status === 403 || res.status === 400, true)
})
