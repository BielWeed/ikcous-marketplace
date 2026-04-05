/**
 * AI Resource Predictor — The Instinct
 * Camada 1 da v25.0 OMEGA.
 * Realiza inferência estatística local para prever a necessidade de recursos (estáticos e API).
 */

interface ResourceWeight {
    url: string;
    weight: number;
}

export class AIResourcePredictor {
    private static instance: AIResourcePredictor;
    private modelWeights: Record<string, Record<string, number>> = {};

    private constructor() {
        this.loadWeights();
    }

    public static getInstance(): AIResourcePredictor {
        if (!AIResourcePredictor.instance) {
            AIResourcePredictor.instance = new AIResourcePredictor();
        }
        return AIResourcePredictor.instance;
    }

    private loadWeights() {
        try {
            const stored = localStorage.getItem('omega_ai_weights');
            if (stored) this.modelWeights = JSON.parse(stored);
        } catch (e) {
            console.warn('[AI-OMEGA] Failed to load model weights:', e);
        }
    }

    public trackInteraction(view: string, resourceUrl: string) {
        if (!this.modelWeights[view]) this.modelWeights[view] = {};
        this.modelWeights[view][resourceUrl] = (this.modelWeights[view][resourceUrl] || 0) + 1;

        // Salva periodicamente
        localStorage.setItem('omega_ai_weights', JSON.stringify(this.modelWeights));
    }

    public predictResources(currentView: string): ResourceWeight[] {
        const viewWeights = this.modelWeights[currentView];
        if (!viewWeights) return [];

        return Object.entries(viewWeights)
            .map(([url, weight]) => ({ url, weight }))
            .sort((a, b) => b.weight - a.weight)
            .slice(0, 5); // Retorna os 5 recursos mais prováveis
    }
}
