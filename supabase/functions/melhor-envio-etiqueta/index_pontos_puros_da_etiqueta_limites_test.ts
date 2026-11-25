// @ts-nocheck
/**
 * Caça por mutação (25/11/2026) nas funções PURAS de `melhor-envio-etiqueta/
 * index.ts` — a function que COMPRA a etiqueta com o saldo real da conta da
 * lojista no Melhor Envio (dinheiro). Depois de `index_test.ts` ainda
 * sobreviviam defeitos de UMA linha:
 *
 *   * `normalizarCheckout`: `paid` SEM `purchase.id` NÃO é compra confirmada, e
 *     a frase da falha muda conforme haja status ou não;
 *   * `normalizarTracking`: o `tracking` vence o `melhorenvio_tracking`, e só
 *     pontuação não é código;
 *   * `classificarVinculoReverso`: a reserva da devolução vence em MAIS de 10
 *     minutos (nem 9:59, nem exatamente 10:00), e carimbo zero, negativo ou
 *     ilegível NUNCA vence (não se toma a reserva de outra chamada);
 *   * `validadeDoCodigoDePostagem`: 7 dias, e "expirado" só DEPOIS do instante;
 *   * `erroDePedidoParaEtiqueta` (caixa do status) e `erroDeServicoParaEtiqueta`
 *     (prefixos `superfrete-`/`frenet-` com o traço);
 *   * `montarProdutosEVolumes`: o valor declarado é o VENDIDO no pedido (preço
 *     ausente ou ilegível cai para o do catálogo, nunca para NaN), quantidade
 *     ausente conta 1, o peso é o da linha inteira e as unidades empilham pelo
 *     menor lado (altura, largura, comprimento, nessa ordem de empate);
 *   * `volumesDoCarrinhoParaOServico`: só Jadlog (ids 3 e 4) aceita vários
 *     volumes; os outros vão em UM pacote com as medidas arredondadas PARA CIMA;
 *   * `analisarOpcaoMelhorEnvio` e `extrairEnderecoDoPedido` (qual fonte vence);
 *   * `montarRemetente`: a empresa que TEM CNPJ vence a primeira da lista, o
 *     endereço padrão vence o primeiro, e os valores de reserva (`Loja`,
 *     `0000000000`, `S/N`) quando o ME não manda nome, telefone ou número.
 *
 * Valores inventados (`@fixture.invalid`, CNPJ e CPF de teste); sem rede.
 */
import { assertEquals } from "https://deno.land/std@0.177.0/testing/asserts.ts"
import {
    analisarOpcaoMelhorEnvio,
    classificarCheckoutDaReversa,
    classificarVinculoReverso,
    consolidarVolumesEmUm,
    erroDeAgenciaObrigatoria,
    erroDePedidoParaEtiqueta,
    erroDeServicoParaEtiqueta,
    extrairEnderecoDoPedido,
    extrairServiceIdDaOpcao,
    montarProdutosEVolumes,
    montarRemetente,
    normalizarCheckout,
    normalizarCodigoDePostagem,
    normalizarTracking,
    servicoExigeVolumeUnico,
    validadeDoCodigoDePostagem,
    volumesDoCarrinhoParaOServico,
} from "./index.ts"

const SEM_CONFIRMAR = "O Melhor Envio não confirmou a compra da etiqueta. Confira o saldo da sua conta no Melhor Envio."
const naoFechou = (status: string) =>
    `O Melhor Envio não fechou a compra da etiqueta (status "${status}"). Confira o saldo da sua conta no Melhor Envio.`

// ── checkout da ida ────────────────────────────────────────────────────

Deno.test("normalizarCheckout - só `paid` COM id é compra feita (caixa e espaço do status não importam)", () => {
    assertEquals(normalizarCheckout({ purchase: { id: "compra-1", status: "paid" } }), { pago: true, purchaseId: "compra-1" })
    assertEquals(normalizarCheckout({ purchase: { id: "compra-1", status: " PAID " } }), { pago: true, purchaseId: "compra-1" })
    assertEquals(normalizarCheckout({ purchase: { id: "compra-1", status: "Paid" } }), { pago: true, purchaseId: "compra-1" })
})

Deno.test("normalizarCheckout - `paid` SEM id, status de saldo e resposta vazia NÃO são compra feita, cada um com a frase certa", () => {
    // pago sem id: não confirma (e a frase não cita o status "paid")
    assertEquals(normalizarCheckout({ purchase: { status: "paid" } }), { pago: false, erro: SEM_CONFIRMAR })
    assertEquals(normalizarCheckout({ purchase: { id: "", status: "paid" } }), { pago: false, erro: SEM_CONFIRMAR })
    assertEquals(normalizarCheckout({ purchase: { id: null, status: " PAID " } }), { pago: false, erro: SEM_CONFIRMAR })
    // status que não fechou: cita o status em minúsculo e aparado
    assertEquals(normalizarCheckout({ purchase: { id: "compra-1", status: "pending" } }), { pago: false, erro: naoFechou("pending") })
    assertEquals(normalizarCheckout({ purchase: { status: " BLOCKED " } }), { pago: false, erro: naoFechou("blocked") })
    assertEquals(normalizarCheckout({ purchase: { id: "compra-1", status: "canceled" } }), { pago: false, erro: naoFechou("canceled") })
    // sem status e sem compra
    assertEquals(normalizarCheckout({ purchase: { id: "compra-1" } }), { pago: false, erro: SEM_CONFIRMAR })
    assertEquals(normalizarCheckout({ purchase: { id: "compra-1", status: "   " } }), { pago: false, erro: SEM_CONFIRMAR })
    assertEquals(normalizarCheckout({ purchase: null }), { pago: false, erro: SEM_CONFIRMAR })
    assertEquals(normalizarCheckout({}), { pago: false, erro: SEM_CONFIRMAR })
    assertEquals(normalizarCheckout(null), { pago: false, erro: SEM_CONFIRMAR })
    assertEquals(normalizarCheckout(undefined), { pago: false, erro: SEM_CONFIRMAR })
})

// ── rastreio ──────────────────────────────────────────────────────────

Deno.test("normalizarTracking - `tracking` vence `melhorenvio_tracking`; só pontuação cai para o outro; número vale; nada vira null", () => {
    const de = (entrada: unknown) => normalizarTracking({ "etiqueta-1": entrada }, "etiqueta-1")
    assertEquals(de({ tracking: "br123456789br", status: "posted" }), { tracking: "BR123456789BR", status: "posted" })
    assertEquals(de({ tracking: "AA1", melhorenvio_tracking: "BB2" }), { tracking: "AA1", status: null })
    assertEquals(de({ tracking: "---", melhorenvio_tracking: "bb2" }), { tracking: "BB2", status: null })
    assertEquals(de({ tracking: "", melhorenvio_tracking: "bb2" }), { tracking: "BB2", status: null })
    assertEquals(de({ tracking: null, melhorenvio_tracking: "bb2" }), { tracking: "BB2", status: null })
    assertEquals(de({ tracking: 12345 }), { tracking: "12345", status: null })
    assertEquals(de({ tracking: {}, melhorenvio_tracking: ["x"] }), { tracking: null, status: null })
    assertEquals(de({ tracking: "---", melhorenvio_tracking: "..." , status: "pending" }), { tracking: null, status: "pending" })
    assertEquals(de({}), { tracking: null, status: null })
    assertEquals(de(null), { tracking: null, status: null })
    assertEquals(normalizarTracking({ "outra": { tracking: "AA1" } }, "etiqueta-1"), { tracking: null, status: null })
    assertEquals(normalizarTracking(null, "etiqueta-1"), { tracking: null, status: null })
    assertEquals(normalizarTracking(undefined, "etiqueta-1"), { tracking: null, status: null })
})

// ── devolução: reserva, checkout e código de postagem ─────────────────────────────

Deno.test("classificarVinculoReverso - livre, vinculado a um envio, ou reservado (vence em MAIS de 10 minutos; carimbo zero, negativo ou ilegível nunca vence)", () => {
    const agora = 2_000_000_000
    for (const livre of [null, undefined, ""]) {
        assertEquals(classificarVinculoReverso(livre, agora), { tipo: "livre" }, String(livre))
    }
    assertEquals(classificarVinculoReverso("ME-ENVIO-1", agora), { tipo: "vinculado", meId: "ME-ENVIO-1" })
    const reserva = (marcadaEm: number | string) => `reservando:${marcadaEm}:uuid-fixture`
    const marca = agora - 10 * 60 * 1000
    // exatamente 10 min não venceu; 1 ms depois venceu
    assertEquals(classificarVinculoReverso(reserva(marca), agora), { tipo: "reservado", vencido: false })
    assertEquals(classificarVinculoReverso(reserva(marca - 1), agora), { tipo: "reservado", vencido: true })
    assertEquals(classificarVinculoReverso(reserva(marca + 1), agora), { tipo: "reservado", vencido: false })
    assertEquals(classificarVinculoReverso(reserva(agora - 9 * 60 * 1000 - 59_000), agora), { tipo: "reservado", vencido: false })
    assertEquals(classificarVinculoReverso(reserva(agora - 11 * 60 * 1000), agora), { tipo: "reservado", vencido: true })
    // sem carimbo legível: nunca vence
    for (const ruim of [0, -5, "abc", "", "1e999999", "NaN"]) {
        assertEquals(classificarVinculoReverso(reserva(ruim), agora), { tipo: "reservado", vencido: false }, String(ruim))
    }
    assertEquals(classificarVinculoReverso("reservando:", agora), { tipo: "reservado", vencido: false })
    // o prefixo é exato: sem os dois pontos é um id de envio
    assertEquals(classificarVinculoReverso("reservando", agora), { tipo: "vinculado", meId: "reservando" })
})

Deno.test("classificarCheckoutDaReversa - pago só com `paid` e id; recusado só com status conhecido de não pago; o resto é indeterminado", () => {
    assertEquals(classificarCheckoutDaReversa({ purchase: { id: "c1", status: "paid" } }), { tipo: "pago" })
    assertEquals(classificarCheckoutDaReversa({ purchase: { id: "c1", status: " PAID " } }), { tipo: "pago" })
    assertEquals(classificarCheckoutDaReversa({ purchase: { status: "paid" } }), { tipo: "indeterminado" })
    assertEquals(classificarCheckoutDaReversa({ purchase: { id: "", status: "paid" } }), { tipo: "indeterminado" })
    for (const status of ["pending", "blocked", "canceled"]) {
        assertEquals(classificarCheckoutDaReversa({ purchase: { id: "c1", status } }), { tipo: "recusado", status })
        assertEquals(classificarCheckoutDaReversa({ purchase: { status: ` ${status.toUpperCase()} ` } }), { tipo: "recusado", status })
    }
    for (const outro of [
        { purchase: { id: "c1", status: "cancelled" } }, { purchase: { id: "c1", status: "refused" } },
        { purchase: { id: "c1", status: "" } }, { purchase: { id: "c1", status: 5 } }, { purchase: { id: "c1" } },
        { purchase: "paid" }, { purchase: null }, { purchase: [] }, {}, [], [{ purchase: { status: "paid", id: "x" } }], "texto", null, undefined, 5,
    ]) {
        assertEquals(classificarCheckoutDaReversa(outro), { tipo: "indeterminado" }, JSON.stringify(outro))
    }
})

Deno.test("normalizarCodigoDePostagem - só o campo `tracking`, aparado; o código interno do ME e o que não é texto não valem", () => {
    assertEquals(normalizarCodigoDePostagem({ "me-1": { tracking: "  ab123 " } }, "me-1"), "ab123")
    assertEquals(normalizarCodigoDePostagem({ "me-1": { tracking: "   " } }, "me-1"), null)
    assertEquals(normalizarCodigoDePostagem({ "me-1": { tracking: 5 } }, "me-1"), null)
    assertEquals(normalizarCodigoDePostagem({ "me-1": { melhorenvio_tracking: "INTERNO" } }, "me-1"), null)
    assertEquals(normalizarCodigoDePostagem({ "me-1": "texto" }, "me-1"), null)
    assertEquals(normalizarCodigoDePostagem({ "me-2": { tracking: "x" } }, "me-1"), null)
    assertEquals(normalizarCodigoDePostagem("texto", "me-1"), null)
    assertEquals(normalizarCodigoDePostagem(null, "me-1"), null)
    assertEquals(normalizarCodigoDePostagem(undefined, "me-1"), null)
})

Deno.test("validadeDoCodigoDePostagem - 7 dias a partir da geração; expira só DEPOIS do instante; data ausente ou ilegível dá null", () => {
    const gerado = "2026-11-01T00:00:00.000Z"
    const fim = Date.parse("2026-11-08T00:00:00.000Z")
    assertEquals(validadeDoCodigoDePostagem(gerado, fim - 1), { validade_ate: "2026-11-08T00:00:00.000Z", expirado: false })
    assertEquals(validadeDoCodigoDePostagem(gerado, fim), { validade_ate: "2026-11-08T00:00:00.000Z", expirado: false })
    assertEquals(validadeDoCodigoDePostagem(gerado, fim + 1), { validade_ate: "2026-11-08T00:00:00.000Z", expirado: true })
    for (const ruim of [null, undefined, 123, {}, "", "lixo", "2026-13-45"]) {
        assertEquals(validadeDoCodigoDePostagem(ruim, fim), null, String(ruim))
    }
})

// ── portões antes de gastar saldo ───────────────────────────────────────────

Deno.test("erroDePedidoParaEtiqueta - cancelado, entregue e devolvido não etiquetam, em qualquer caixa; os outros passam", () => {
    assertEquals(erroDePedidoParaEtiqueta({ status: "CANCELLED" }), 'Pedido com status "cancelled" não gera etiqueta de envio.')
    assertEquals(erroDePedidoParaEtiqueta({ status: "Delivered" }), 'Pedido com status "delivered" não gera etiqueta de envio.')
    assertEquals(erroDePedidoParaEtiqueta({ status: "RETURNED" }), 'Pedido com status "returned" não gera etiqueta de envio.')
    for (const ok of ["processing", "shipped", "pending", "", null, undefined]) {
        assertEquals(erroDePedidoParaEtiqueta({ status: ok }), null, String(ok))
    }
    assertEquals(erroDePedidoParaEtiqueta({}), null)
    assertEquals(erroDePedidoParaEtiqueta(null), null)
})

Deno.test("erroDeServicoParaEtiqueta - SuperFrete e Frenet só com o TRAÇO do prefixo (sem ele cai no ramo que deixa escolher o serviço); retirada, entrega local e frete fixo", () => {
    const de = (opcao: unknown, ...frete: unknown[]) => erroDeServicoParaEtiqueta(opcao, frete.length > 0 ? frete[0] : 10)
    assertEquals(de("superfrete-1").podeEscolherServico, false)
    assertEquals(de("frenet-sedex").podeEscolherServico, false)
    assertEquals(de("superfrete-1").mensagem.includes("SuperFrete"), true)
    assertEquals(de("frenet-sedex").mensagem.includes("Frenet"), true)
    // sem o traço: não é opção dessas transportadoras
    assertEquals(de("superfrete").podeEscolherServico, true)
    assertEquals(de("superfreteX").podeEscolherServico, true)
    assertEquals(de("frenet").podeEscolherServico, true)
    assertEquals(de("frenetico-1").podeEscolherServico, true)
    assertEquals(de("store-pickup").podeEscolherServico, false)
    assertEquals(de("local-delivery").podeEscolherServico, false)
    assertEquals(de("flat-fee-1", 0).podeEscolherServico, true)
    assertEquals(de("flat-fee-1", 0).mensagem.includes("taxa de frete fixa"), true)
    // sem opção: frete grátis (0, vazio, texto) ou frete cobrado
    for (const frete of [0, "0", "", null, undefined, "abc", -5]) {
        assertEquals(de(null, frete).mensagem.includes("frete grátis"), true, String(frete))
        assertEquals(de(null, frete).podeEscolherServico, true, String(frete))
    }
    assertEquals(de(null, 10).mensagem.includes("não registrou um serviço"), true)
    assertEquals(de(null, "12.5").mensagem.includes("não registrou um serviço"), true)
    assertEquals(de(undefined, 0.01).mensagem.includes("não registrou um serviço"), true)
})

Deno.test("erroDeAgenciaObrigatoria - só os ids 12, 15, 16 e 22 exigem agência de coleta", () => {
    for (const id of ["12", "15", "16", "22"]) {
        assertEquals(erroDeAgenciaObrigatoria(id), "Esta transportadora exige agência de coleta — gere esta etiqueta no site do Melhor Envio.", id)
    }
    for (const id of ["1", "2", "3", "11", "13", "14", "17", "21", "23", "122", "", "012"]) {
        assertEquals(erroDeAgenciaObrigatoria(id), null, id)
    }
})

// ── remetente (dado da conta do ME que vai na etiqueta) ───────────────────────────

const ENDERECO_PADRAO = {
    address: "Rua B", number: "20", complement: "Sala 1", district: "Bairro B",
    postal_code: "38500-000", is_default: true, city: { city: "Monte Carmelo", state_abbr: "MG" },
}
const ENDERECO_OUTRO = {
    address: "Rua A", number: "10", district: "Centro",
    postal_code: "01310-100", is_default: false, city: { city: "São Paulo", state_abbr: "SP" },
}

Deno.test("montarRemetente - empresa COM CNPJ vence a primeira da lista, endereço padrão vence o primeiro, CEP só com dígitos", () => {
    const remetente = montarRemetente({
        name: "Nome da Conta", email: "loja@fixture.invalid", phone: "11900000000", document: "52998224725",
        companies: [{ name: "Sem CNPJ", document: "11111111111" }, { name: "Empresa Fixture", company_document: "00000000000191", phone: "1130000000" }],
        addresses: [ENDERECO_OUTRO, ENDERECO_PADRAO],
    })
    assertEquals(remetente, {
        name: "Empresa Fixture",
        company_document: "00000000000191",
        document: undefined,
        phone: "1130000000",
        address: "Rua B",
        complement: "Sala 1",
        number: "20",
        district: "Bairro B",
        city: "Monte Carmelo",
        state_abbr: "MG",
        country_id: "BR",
        postal_code: "38500000",
        email: "loja@fixture.invalid",
    })
    // sem nenhuma empresa com CNPJ, vale a primeira
    const semCnpj = montarRemetente({
        companies: [{ name: "Primeira", document: "52998224725" }, { name: "Segunda", document: "11111111111" }],
        addresses: [ENDERECO_PADRAO],
    })
    assertEquals(semCnpj.name, "Primeira")
    assertEquals(semCnpj.document, "52998224725")
    assertEquals(semCnpj.company_document, undefined)
    // sem endereço padrão, vale o primeiro
    assertEquals(montarRemetente({ document: "52998224725", addresses: [ENDERECO_OUTRO, { ...ENDERECO_PADRAO, is_default: false }] }).address, "Rua A")
    // CNPJ que não é texto não vai em `company_document`
    assertEquals(montarRemetente({ companies: [{ company_document: 191 }], addresses: [ENDERECO_PADRAO] }).company_document, undefined)
})

Deno.test("montarRemetente - pessoa física com dados faltando usa os valores de reserva ('Loja', '0000000000', 'S/N') e a cidade/UF de qualquer formato do ME", () => {
    const minimo = montarRemetente({
        document: "52998224725",
        addresses: [{ postal_code: "38500000", city: "Monte Carmelo", state: "MG" }],
    })
    assertEquals(minimo, {
        name: "Loja",
        company_document: undefined,
        document: "52998224725",
        phone: "0000000000",
        address: "",
        complement: null,
        number: "S/N",
        district: "",
        city: "Monte Carmelo",
        state_abbr: "MG",
        country_id: "BR",
        postal_code: "38500000",
        email: null,
    })
    assertEquals(montarRemetente({ name: "Fulano", document: "x", addresses: [{ postal_code: "38500000", city_name: "Uberaba", state_abbr: "MG" }] }).city, "Uberaba")
    assertEquals(montarRemetente({ name: "Fulano", document: "x", addresses: [{ postal_code: "38500000", city_name: "Uberaba", state_abbr: "MG" }] }).name, "Fulano")
    // o nome cai para o logradouro antes de 'Loja'
    assertEquals(montarRemetente({ document: "x", addresses: [{ address: "Rua X", postal_code: "38500000", city: "C", state: "MG" }] }).name, "Rua X")
    // o telefone cai da empresa para a conta e dela para o endereço
    assertEquals(montarRemetente({ document: "x", phone: "3400000000", addresses: [{ phone: "3500000000", postal_code: "38500000", city: "C", state: "MG" }] }).phone, "3400000000")
    assertEquals(montarRemetente({ document: "x", addresses: [{ phone: "3500000000", postal_code: "38500000", city: "C", state: "MG" }] }).phone, "3500000000")
})

Deno.test("montarRemetente - sem documento, CEP de 8 dígitos, cidade ou UF recusa (null) em vez de comprar etiqueta com remetente incompleto", () => {
    const base = { document: "52998224725", addresses: [{ postal_code: "38500000", city: "Monte Carmelo", state: "MG" }] }
    assertEquals(montarRemetente(base) !== null, true)
    assertEquals(montarRemetente(null), null)
    assertEquals(montarRemetente(undefined), null)
    assertEquals(montarRemetente({}), null)
    assertEquals(montarRemetente({ ...base, document: "" }), null)
    for (const cep of ["3850000", "385000000", "abc", "", "3850-0000 1"]) {
        assertEquals(montarRemetente({ ...base, addresses: [{ ...base.addresses[0], postal_code: cep }] }), null, cep)
    }
    assertEquals(montarRemetente({ ...base, addresses: [{ ...base.addresses[0], city: "" }] }), null)
    assertEquals(montarRemetente({ ...base, addresses: [{ ...base.addresses[0], state: "" }] }), null)
    assertEquals(montarRemetente({ ...base, addresses: [] }), null)
})

// ── produtos e volumes da etiqueta (peso e valor declarado) ─────────────────────

const CATALOGO = [{ id: "p1", nome: "Camiseta Fixture", preco_venda: 50, peso_kg: 0.5, largura_cm: 20, altura_cm: 10, comprimento_cm: 30 }]

Deno.test("montarProdutosEVolumes - valor declarado é o VENDIDO; preço ausente, nulo ou ilegível cai para o do catálogo (nunca NaN); sem catálogo, 0", () => {
    const valorDe = (item: Record<string, unknown>, catalogo = CATALOGO) =>
        montarProdutosEVolumes([{ product_id: "p1", quantity: 1, ...item }], catalogo).products[0].unitary_value
    assertEquals(valorDe({ price: 40 }), 40)
    assertEquals(valorDe({ price: "12.5" }), 12.5)
    assertEquals(valorDe({ price: 0 }), 0)
    assertEquals(valorDe({ price: null }), 50)
    assertEquals(valorDe({}), 50)
    assertEquals(valorDe({ price: "abc" }), 50)
    assertEquals(valorDe({ price: Number.NaN }), 50)
    assertEquals(valorDe({ price: Number.POSITIVE_INFINITY }), 50)
    assertEquals(valorDe({ product_id: "zz", price: null }), 0)
    assertEquals(valorDe({ product_id: "zz", price: 9 }), 9)
    assertEquals(valorDe({ price: null }, [{ ...CATALOGO[0], preco_venda: null }]), 0)
})

Deno.test("montarProdutosEVolumes - nome do catálogo ('Produto' sem ele); quantidade ausente ou zero conta 1; peso é o da linha inteira", () => {
    const um = montarProdutosEVolumes([{ product_id: "p1", price: 40 }], CATALOGO)
    assertEquals(um.products, [{ name: "Camiseta Fixture", quantity: 1, unitary_value: 40 }])
    assertEquals(um.volumes, [{ weight: 0.5, width: 20, height: 10, length: 30 }])
    assertEquals(montarProdutosEVolumes([{ product_id: "p1", quantity: 0 }], CATALOGO).products[0].quantity, 1)
    assertEquals(montarProdutosEVolumes([{ product_id: "p1", quantity: "4" }], CATALOGO).products[0].quantity, 4)
    const tres = montarProdutosEVolumes([{ product_id: "p1", quantity: 3, price: 40 }], CATALOGO)
    assertEquals(tres.volumes, [{ weight: 1.5, width: 20, height: 30, length: 30 }])
    // sem o produto no catálogo: nome e medidas padrão (0,3 kg; 15 cm), empilhando pela altura no empate
    const desconhecido = montarProdutosEVolumes([{ product_id: "zz", quantity: 2, price: 9 }], CATALOGO)
    assertEquals(desconhecido.products, [{ name: "Produto", quantity: 2, unitary_value: 9 }])
    assertEquals(desconhecido.volumes, [{ weight: 0.6, width: 15, height: 30, length: 15 }])
    assertEquals(montarProdutosEVolumes([{ product_id: "p1", quantity: 1 }], [{ ...CATALOGO[0], nome: "" }]).products[0].name, "Produto")
    assertEquals(montarProdutosEVolumes([], CATALOGO), { products: [], volumes: [] })
    assertEquals(montarProdutosEVolumes(null, CATALOGO), { products: [], volumes: [] })
})

Deno.test("montarProdutosEVolumes - as unidades empilham pelo MENOR lado (empate: altura, largura, comprimento); sem empilhar mantém a medida de uma unidade", () => {
    const de = (largura: number, altura: number, comprimento: number, quantity: number, opcoes = {}) =>
        montarProdutosEVolumes(
            [{ product_id: "p1", quantity }],
            [{ id: "p1", preco_venda: 1, peso_kg: 1, largura_cm: largura, altura_cm: altura, comprimento_cm: comprimento }],
            opcoes,
        ).volumes[0]
    assertEquals(de(10, 10, 10, 2), { weight: 2, width: 10, height: 20, length: 10 }) // empate total: altura
    assertEquals(de(5, 10, 10, 2), { weight: 2, width: 10, height: 10, length: 10 }) // largura menor
    assertEquals(de(10, 10, 5, 3), { weight: 3, width: 10, height: 10, length: 15 }) // comprimento menor
    assertEquals(de(5, 5, 10, 2), { weight: 2, width: 5, height: 10, length: 10 }) // empate largura x altura: altura
    assertEquals(de(5, 10, 5, 2), { weight: 2, width: 10, height: 10, length: 5 }) // empate largura x comprimento: largura
    assertEquals(de(20, 10, 30, 3, { empilharQuantidade: false }), { weight: 3, width: 20, height: 10, length: 30 })
    assertEquals(de(20, 10, 30, 3, { empilharQuantidade: true }), { weight: 3, width: 20, height: 30, length: 30 })
    // uma unidade (ou quantidade ilegível): a medida sai como está, sem arredondar
    assertEquals(de(12.3456, 5.4321, 9.8765, 1), { weight: 1, width: 12.3456, height: 5.4321, length: 9.8765 })
    const ilegivel = de(20, 10, 30, "abc" as unknown as number)
    assertEquals([ilegivel.width, ilegivel.height, ilegivel.length], [20, 10, 30])
})

Deno.test("consolidarVolumesEmUm - peso somado e a MAIOR largura, altura e comprimento; vazio ou ausente dá null", () => {
    assertEquals(consolidarVolumesEmUm([]), null)
    assertEquals(consolidarVolumesEmUm(null), null)
    assertEquals(consolidarVolumesEmUm(undefined), null)
    assertEquals(
        consolidarVolumesEmUm([
            { weight: 1.234, width: 10, height: 5, length: 20 },
            { weight: 0.8, width: 8, height: 12, length: 15 },
            { weight: 0.5, width: 30, height: 1, length: 40 },
        ]),
        { weight: 2.534, width: 30, height: 12, length: 40 },
    )
    assertEquals(consolidarVolumesEmUm([{ weight: 0.1, width: 7, height: 8, length: 9 }]), { weight: 0.1, width: 7, height: 8, length: 9 })
    // soma de pesos com ponto flutuante: 0,1 + 0,2 = 0,3 (3 casas)
    assertEquals(consolidarVolumesEmUm([{ weight: 0.1, width: 1, height: 1, length: 1 }, { weight: 0.2, width: 1, height: 1, length: 1 }])?.weight, 0.3)
})

Deno.test("volumesDoCarrinhoParaOServico - só Jadlog (3 e 4) mantém vários volumes; os outros vão em UM pacote com as medidas arredondadas para CIMA", () => {
    const volumes = [
        { weight: 1.2, width: 10.2, height: 5, length: 20.01 },
        { weight: 0.8, width: 8, height: 5.5, length: 15 },
    ]
    assertEquals(volumesDoCarrinhoParaOServico("3", volumes), volumes)
    assertEquals(volumesDoCarrinhoParaOServico("4", volumes), volumes)
    assertEquals(volumesDoCarrinhoParaOServico("1", volumes), [{ weight: 2, width: 11, height: 6, length: 21 }])
    assertEquals(volumesDoCarrinhoParaOServico("2", volumes), [{ weight: 2, width: 11, height: 6, length: 21 }])
    assertEquals(volumesDoCarrinhoParaOServico("17", volumes), [{ weight: 2, width: 11, height: 6, length: 21 }])
    // medida já inteira não sobe; sem volumes, lista vazia
    assertEquals(volumesDoCarrinhoParaOServico("1", [{ weight: 1, width: 10, height: 5, length: 20 }]), [{ weight: 1, width: 10, height: 5, length: 20 }])
    assertEquals(volumesDoCarrinhoParaOServico("1", []), [])
    assertEquals(volumesDoCarrinhoParaOServico("1", null), [])
    // id que não é de dígitos (ou ausente) não mexe nos volumes
    for (const outro of [null, undefined, 1, "", "abc", "melhor-envio-1"]) {
        assertEquals(volumesDoCarrinhoParaOServico(outro, volumes), volumes, String(outro))
    }
})

Deno.test("servicoExigeVolumeUnico - só id numérico em TEXTO que não seja 3 nem 4", () => {
    for (const exige of ["1", "2", "12", "17", "03", "33", "40"]) assertEquals(servicoExigeVolumeUnico(exige), true, exige)
    for (const nao of ["3", "4", 1, 3, 4, "", " 1", "1 ", "abc", "1a", null, undefined, {}, ["1"]]) {
        assertEquals(servicoExigeVolumeUnico(nao), false, String(nao))
    }
})

Deno.test("analisarOpcaoMelhorEnvio e extrairServiceIdDaOpcao - captura COMPLETA `melhor-envio-<dígitos>[-ss]`; qualquer outro formato é null", () => {
    assertEquals(analisarOpcaoMelhorEnvio("melhor-envio-1"), { id: "1", semSeguro: false })
    assertEquals(analisarOpcaoMelhorEnvio("melhor-envio-1-ss"), { id: "1", semSeguro: true })
    assertEquals(analisarOpcaoMelhorEnvio("melhor-envio-17-ss"), { id: "17", semSeguro: true })
    assertEquals(analisarOpcaoMelhorEnvio("melhor-envio-123"), { id: "123", semSeguro: false })
    for (const ruim of [
        "melhor-envio-", "melhor-envio-1-x", "melhor-envio-1-ss-ss", "melhor-envio-1ss", " melhor-envio-1", "melhor-envio-1 ", "melhor-envio-1\n",
        "Melhor-Envio-1", "xmelhor-envio-1", "melhor-envio-a", "melhor-envio--1", "superfrete-1", "frenet-1", "local-delivery", "", null, undefined, 3, {},
    ]) {
        assertEquals(analisarOpcaoMelhorEnvio(ruim), null, JSON.stringify(ruim))
        assertEquals(extrairServiceIdDaOpcao(ruim), null, JSON.stringify(ruim))
    }
    assertEquals(extrairServiceIdDaOpcao("melhor-envio-2-ss"), "2")
})

Deno.test("extrairEnderecoDoPedido - o retrato `addressData` vence o `address` objeto, que vence a raiz; CEP de 8 dígitos, cidade, rua e número obrigatórios", () => {
    const snapshot = { cep: "38500-000", street: "Rua do Retrato", number: "1", city: "Monte Carmelo", neighborhood: "Centro", state: "MG", complement: "Fundos" }
    const atual = { cep: "01310100", street: "Rua Atual", number: "2", city: "São Paulo", state: "SP" }
    const esperadoSnapshot = { cep: "38500000", street: "Rua do Retrato", number: "1", complement: "Fundos", district: "Centro", city: "Monte Carmelo", state: "MG" }
    assertEquals(extrairEnderecoDoPedido({ addressData: snapshot, address: atual }), esperadoSnapshot)
    assertEquals(extrairEnderecoDoPedido({ address: atual })?.street, "Rua Atual")
    // endereço como texto na raiz
    assertEquals(
        extrairEnderecoDoPedido({ address: "Rua da Raiz", number: "7", cep: "38.500-000", city: "Monte Carmelo", state: "MG" }),
        { cep: "38500000", street: "Rua da Raiz", number: "7", complement: "", district: "", city: "Monte Carmelo", state: "MG" },
    )
    // o que o retrato não traz cai para a raiz de `customer_data` (cep, número, cidade, complemento, bairro, UF)
    assertEquals(
        extrairEnderecoDoPedido({ address: { street: "Rua Parcial" }, cep: "38500-000", number: "9", city: "Monte Carmelo", complement: "Casa", neighborhood: "Centro", state: "MG" }),
        { cep: "38500000", street: "Rua Parcial", number: "9", complement: "Casa", district: "Centro", city: "Monte Carmelo", state: "MG" },
    )
    // o que falta recusa
    for (const campo of ["cep", "street", "number", "city"]) {
        assertEquals(extrairEnderecoDoPedido({ addressData: { ...snapshot, [campo]: "" } }), null, campo)
    }
    assertEquals(extrairEnderecoDoPedido({ addressData: { ...snapshot, cep: "3850000" } }), null)
    assertEquals(extrairEnderecoDoPedido({ addressData: { ...snapshot, cep: "385000000" } }), null)
    assertEquals(extrairEnderecoDoPedido(null), null)
    assertEquals(extrairEnderecoDoPedido(undefined), null)
    assertEquals(extrairEnderecoDoPedido({}), null)
})
