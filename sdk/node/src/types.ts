import { ClientOptions } from 'openai';

export interface StyxOptions extends Omit<ClientOptions, 'apiKey'> {
    /**
     * Your Styx API Key.
     * Defaults to process.env['STYX_API_KEY'].
     */
    apiKey?: string;

    /**
     * The Styx Router endpoint.
     * Defaults to process.env['STYX_BASE_URL'] or 'https://api.styx.com/v1' 
     * (currently 'http://localhost:8080/v1' for local dev).
     */
    baseURL?: string;

    /**
     * Optional: Specific Project ID to use. 
     * Usually bound directly to the API Key, but can be overridden if allowed.
     */
    projectId?: string;

    /**
     * Optional: Manually force a target provider (e.g., 'openai', 'anthropic').
     * If omitted, Styx will use the project's default routing strategy.
     */
    targetProvider?: 'openai' | 'anthropic' | string;

    /**
     * Optional: Routing strategy for this specific client instance.
     */
    routingStrategy?: 'cost_optimized' | 'latency_optimized' | 'round_robin' | 'fallback_only';

    /**
     * Optional: Identifier for the end-user making the request.
     * Useful for analytics and cost-tracking per user.
     */
    endUserId?: string;
}
