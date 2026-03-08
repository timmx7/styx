import OpenAI from 'openai';
import { StyxOptions } from './types';

export class Styx extends OpenAI {
    /**
     * Initializes a new Styx client, which extends the official OpenAI Node.js SDK.
     * By default, it bridges all calls through the Styx gateway.
     *
     * @param options Configuration options for Styx
     */
    constructor(options: StyxOptions = {}) {
        // 1. Ensure the baseURL points to the Styx Router
        const baseURL = options.baseURL || process.env.STYX_BASE_URL || 'https://api.styx.ai/v1';

        // 2. Extract the Styx Key
        const apiKey = options.apiKey || process.env.STYX_API_KEY;

        if (!apiKey) {
            throw new Error(
                "The Styx_API_KEY environment variable is missing or empty; either provide it, or instantiate the Styx client with an apiKey option, like new Styx({ apiKey: 'My API Key' })."
            );
        }

        // 3. Set up custom headers natively supported by Styx
        const defaultHeaders: Record<string, string> = {};

        // Copy existing string headers if any
        if (options.defaultHeaders && typeof options.defaultHeaders === 'object' && !Array.isArray(options.defaultHeaders)) {
            Object.entries(options.defaultHeaders).forEach(([k, v]) => {
                if (typeof v === 'string') {
                    defaultHeaders[k] = v;
                }
            });
        }

        if (options.projectId) {
            defaultHeaders['x-project-id'] = options.projectId;
        }

        if (options.routingStrategy) {
            defaultHeaders['x-routing-strategy'] = options.routingStrategy;
        }

        if (options.targetProvider) {
            defaultHeaders['x-target-provider'] = options.targetProvider;
        }

        // Support the End-User-Id header for upcoming Analytics/Cost Tracking features
        if (options.endUserId) {
            defaultHeaders['x-end-user-id'] = options.endUserId;
        }

        // 4. Initialize the parent OpenAI class
        super({
            apiKey: apiKey,
            baseURL: baseURL,
            defaultHeaders: defaultHeaders,
            fetch: options.fetch,
            dangerouslyAllowBrowser: options.dangerouslyAllowBrowser,
        });
    }
}
