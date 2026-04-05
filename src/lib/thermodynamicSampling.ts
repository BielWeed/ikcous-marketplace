/**
 * Thermodynamic Sampling Engine (Generation 18)
 * 
 * Implements thermodynamic computing principles for optimization.
 * Based on Extropic's p-bit (probabilistic bit) architecture.
 * 
 * Core Concepts:
 * - Thermodynamic Annealing: Gradual cooling to find optimal states
 * - Energy Landscape: State space exploration via energy minimization
 * - Boltzmann Distribution: Probability of states based on energy
 * - p-bits: Stochastic units that fluctuate based on temperature
 */

export interface ThermodynamicState {
    productId: string;
    productName: string;
    currentMin: number;
    proposedMin: number;
    energy: number; // Lower is better
    probability: number; // Boltzmann probability
}

export interface AnnealingConfig {
    initialTemperature: number; // Starting temperature (high = more exploration)
    finalTemperature: number; // Ending temperature (low = exploitation)
    coolingRate: number; // How fast to cool (0-1)
    iterations: number; // Number of annealing steps
}

/**
 * Calculate energy of a state
 * Lower energy = better configuration
 * 
 * Energy function considers:
 * - Stock-out risk (running out of stock)
 * - Holding cost (excess inventory)
 * - Velocity mismatch (deviation from optimal)
 */
export function calculateEnergy(
    currentMin: number,
    velocity: number,
    targetDays: number = 7
): number {
    const optimalMin = Math.ceil(velocity * targetDays);

    // Stock-out risk: penalty for being below optimal
    const stockoutRisk = Math.max(0, optimalMin - currentMin) ** 2;

    // Holding cost: penalty for excess inventory
    const holdingCost = Math.max(0, currentMin - optimalMin) ** 1.5;

    // Velocity mismatch: general deviation penalty
    const mismatch = Math.abs(currentMin - optimalMin);

    // Combined energy (weighted)
    return (stockoutRisk * 2.0) + (holdingCost * 0.5) + (mismatch * 0.3);
}

/**
 * Boltzmann probability
 * P(state) ∝ exp(-Energy / Temperature)
 * 
 * Higher temperature = more random exploration
 * Lower temperature = focus on low-energy states
 */
export function boltzmannProbability(
    energy: number,
    temperature: number
): number {
    if (temperature <= 0) return energy === 0 ? 1 : 0;
    return Math.exp(-energy / temperature);
}

/**
 * Simulate p-bit flip
 * Stochastic binary unit that fluctuates based on energy and temperature
 * 
 * Returns true if we should accept a state transition
 */
export function pbitFlip(
    currentEnergy: number,
    proposedEnergy: number,
    temperature: number
): boolean {
    // Always accept if proposed state has lower energy
    if (proposedEnergy < currentEnergy) return true;

    // Metropolis-Hastings criterion for uphill moves
    const deltaE = proposedEnergy - currentEnergy;
    const acceptanceProbability = Math.exp(-deltaE / temperature);

    return Math.random() < acceptanceProbability;
}

/**
 * Generate neighbor state (small perturbation)
 * Explores nearby configurations in the state space
 */
export function generateNeighbor(
    currentMin: number,
    temperature: number
): number {
    // Perturbation magnitude scales with temperature
    const maxPerturbation = Math.ceil(temperature * 5);
    const perturbation = Math.floor(Math.random() * (2 * maxPerturbation + 1)) - maxPerturbation;

    // Ensure we stay in valid range
    const newMin = Math.max(1, currentMin + perturbation);

    return newMin;
}

/**
 * Thermodynamic Annealing
 * Gradually cool the system to find low-energy (optimal) states
 */
export function thermodynamicAnneal(
    productId: string,
    productName: string,
    currentMin: number,
    velocity: number,
    config: AnnealingConfig
): ThermodynamicState {
    let temperature = config.initialTemperature;
    let bestMin = currentMin;
    let bestEnergy = calculateEnergy(currentMin, velocity);

    // Annealing loop
    for (let i = 0; i < config.iterations; i++) {
        // Generate neighbor state
        const proposedMin = generateNeighbor(bestMin, temperature);
        const proposedEnergy = calculateEnergy(proposedMin, velocity);

        // Decide whether to accept the new state (p-bit flip)
        if (pbitFlip(bestEnergy, proposedEnergy, temperature)) {
            bestMin = proposedMin;
            bestEnergy = proposedEnergy;
        }

        // Cool down (exponential cooling schedule)
        temperature *= config.coolingRate;

        // Ensure we don't go below final temperature
        temperature = Math.max(temperature, config.finalTemperature);
    }

    // Calculate final Boltzmann probability
    const probability = boltzmannProbability(bestEnergy, config.finalTemperature);

    return {
        productId,
        productName,
        currentMin,
        proposedMin: bestMin,
        energy: bestEnergy,
        probability
    };
}

/**
 * Batch thermodynamic optimization
 * Run annealing for multiple products in parallel
 */
export function batchThermodynamicOptimization(
    products: Array<{
        id: string;
        name: string;
        currentMin: number;
        velocity: number;
    }>,
    config?: Partial<AnnealingConfig>
): ThermodynamicState[] {
    const defaultConfig: AnnealingConfig = {
        initialTemperature: 10.0, // High initial temperature for exploration
        finalTemperature: 0.1, // Low final temperature for exploitation
        coolingRate: 0.95, // Gradual cooling
        iterations: 100, // Number of annealing steps
        ...config
    };

    return products.map(product =>
        thermodynamicAnneal(
            product.id,
            product.name,
            product.currentMin,
            product.velocity,
            defaultConfig
        )
    ).filter(state => {
        // Only return states that actually suggest changes
        return state.proposedMin !== state.currentMin;
    }).sort((a, b) => {
        // Sort by energy (lowest first = best solutions)
        return a.energy - b.energy;
    });
}

/**
 * Thermodynamic Sampling Engine
 * Maintains state and provides optimization interface
 */
export class ThermodynamicSamplingEngine {
    private config: AnnealingConfig;
    private lastSamples: ThermodynamicState[] = [];

    constructor(config?: Partial<AnnealingConfig>) {
        this.config = {
            initialTemperature: 10.0,
            finalTemperature: 0.1,
            coolingRate: 0.95,
            iterations: 100,
            ...config
        };
    }

    /**
     * Run optimization for a batch of products
     */
    optimize(products: Array<{
        id: string;
        name: string;
        currentMin: number;
        velocity: number;
    }>): ThermodynamicState[] {
        this.lastSamples = batchThermodynamicOptimization(products, this.config);
        return this.lastSamples;
    }

    /**
     * Get last optimization results
     */
    getLastSamples(): ThermodynamicState[] {
        return [...this.lastSamples];
    }

    /**
     * Update annealing configuration
     */
    updateConfig(config: Partial<AnnealingConfig>) {
        this.config = { ...this.config, ...config };
    }

    /**
     * Get current configuration
     */
    getConfig(): AnnealingConfig {
        return { ...this.config };
    }
}
