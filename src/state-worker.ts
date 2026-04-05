/**
 * State Worker — The Brain (Off-Main-Thread)
 * Camada 1 da v24.0 APOTHEOSIS.
 * Move a lógica intensiva de dados para fora da UI Thread.
 * Gerencia filtragem, ordenação e lógica de negócios pesada.
 */

const state = {
    products: [],
    cart: [],
    filters: {}
};

self.onmessage = (event) => {
    const { type, payload } = event.data;

    switch (type) {
        case 'INIT_PRODUCTS':
            state.products = payload;
            console.log('[State-Worker] Products synchronized.');
            break;

        case 'PROCESS_FILTERS':
            // Simulação de filtragem pesada de milhares de itens
            console.log('[State-Worker] Processing heavy filters...');
            const filtered = state.products.filter((p: any) =>
                p.name.toLowerCase().includes(payload.query.toLowerCase())
            );
            self.postMessage({ type: 'FILTERS_PROCESSED', payload: filtered });
            break;

        case 'CALC_TOTALS':
            // Cálculo de impostos, descontos e frete assíncrono
            const total = payload.reduce((acc: number, item: any) => acc + (item.price * item.quantity), 0);
            self.postMessage({ type: 'TOTALS_CALCULATED', payload: total });
            break;

        default:
            break;
    }
};
