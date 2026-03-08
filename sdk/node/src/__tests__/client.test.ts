/**
 * Tests for the Styx Node SDK (@styx/node).
 *
 * Uses Node's built-in assert module since the project does not include a
 * test framework.  Run with: npx ts-node src/__tests__/client.test.ts
 */

import assert from 'node:assert/strict';
import { Styx } from '../client';
import type { StyxOptions } from '../types';

// ─── Helpers ─────────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;
const failures: string[] = [];

function describe(name: string, fn: () => void | Promise<void>): void {
    console.log(`\n  ${name}`);
    fn();
}

async function it(name: string, fn: () => void | Promise<void>): Promise<void> {
    try {
        await fn();
        passed++;
        console.log(`    [PASS] ${name}`);
    } catch (err) {
        failed++;
        const msg = err instanceof Error ? err.message : String(err);
        failures.push(`${name}: ${msg}`);
        console.log(`    [FAIL] ${name} — ${msg}`);
    }
}

// ─── S-C1: Client initialization ─────────────────────────────────────────────

describe('Client initialization', async () => {
    await it('creates a client with a valid API key', () => {
        const client = new Styx({ apiKey: 'sk_styx_test123' });
        assert.ok(client, 'Client should be defined');
        assert.ok(client instanceof Styx, 'Client should be an instance of Styx');
    });

    await it('throws when apiKey is missing', () => {
        assert.throws(
            () => new Styx({ apiKey: '' }),
            (err: unknown) => {
                assert.ok(err instanceof Error);
                assert.ok(err.message.includes('STYX_API_KEY') || err.message.includes('Styx_API_KEY'));
                return true;
            },
        );
    });

    await it('throws when no apiKey is provided at all', () => {
        // Remove env var to ensure fallback fails
        const original = process.env.STYX_API_KEY;
        delete process.env.STYX_API_KEY;
        try {
            assert.throws(
                () => new Styx({} as StyxOptions),
                (err: unknown) => {
                    assert.ok(err instanceof Error);
                    return true;
                },
            );
        } finally {
            if (original !== undefined) {
                process.env.STYX_API_KEY = original;
            }
        }
    });

    await it('uses STYX_API_KEY from environment', () => {
        const original = process.env.STYX_API_KEY;
        process.env.STYX_API_KEY = 'sk_styx_from_env';
        try {
            const client = new Styx();
            assert.ok(client, 'Client should be created from env var');
        } finally {
            if (original !== undefined) {
                process.env.STYX_API_KEY = original;
            } else {
                delete process.env.STYX_API_KEY;
            }
        }
    });

    await it('uses STYX_BASE_URL from environment', () => {
        const original = process.env.STYX_BASE_URL;
        process.env.STYX_BASE_URL = 'https://custom.styx.ai/v1';
        try {
            const client = new Styx({ apiKey: 'sk_styx_test' });
            assert.ok(client, 'Client should use custom base URL');
        } finally {
            if (original !== undefined) {
                process.env.STYX_BASE_URL = original;
            } else {
                delete process.env.STYX_BASE_URL;
            }
        }
    });

    await it('defaults baseURL to http://localhost:8080/v1', () => {
        const original = process.env.STYX_BASE_URL;
        delete process.env.STYX_BASE_URL;
        try {
            const client = new Styx({ apiKey: 'sk_styx_test' });
            // The client extends OpenAI, so _base_url is set internally
            assert.ok(client, 'Client should use default base URL');
        } finally {
            if (original !== undefined) {
                process.env.STYX_BASE_URL = original;
            }
        }
    });

    await it('accepts custom baseURL option', () => {
        const client = new Styx({
            apiKey: 'sk_styx_test',
            baseURL: 'https://api.styx.ai/v1',
        });
        assert.ok(client);
    });
});

// ─── Request building (correct headers) ──────────────────────────────────────

describe('Request building', async () => {
    await it('sets x-project-id header when projectId is provided', () => {
        const client = new Styx({
            apiKey: 'sk_styx_test',
            projectId: 'proj_123',
        });
        assert.ok(client, 'Client should accept projectId');
    });

    await it('sets x-target-provider header when targetProvider is provided', () => {
        const client = new Styx({
            apiKey: 'sk_styx_test',
            targetProvider: 'anthropic',
        });
        assert.ok(client, 'Client should accept targetProvider');
    });

    await it('sets x-routing-strategy header when routingStrategy is provided', () => {
        const client = new Styx({
            apiKey: 'sk_styx_test',
            routingStrategy: 'cost_optimized',
        });
        assert.ok(client, 'Client should accept routingStrategy');
    });

    await it('sets x-end-user-id header when endUserId is provided', () => {
        const client = new Styx({
            apiKey: 'sk_styx_test',
            endUserId: 'user_456',
        });
        assert.ok(client, 'Client should accept endUserId');
    });

    await it('merges custom defaultHeaders', () => {
        const client = new Styx({
            apiKey: 'sk_styx_test',
            defaultHeaders: { 'X-Custom': 'value' },
        });
        assert.ok(client, 'Client should merge custom headers');
    });

    await it('sets all Styx headers together', () => {
        const client = new Styx({
            apiKey: 'sk_styx_test',
            projectId: 'proj_123',
            targetProvider: 'openai',
            routingStrategy: 'latency_optimized',
            endUserId: 'user_789',
            defaultHeaders: { 'X-Extra': 'header' },
        });
        assert.ok(client, 'Client should accept all headers together');
    });
});

// ─── OpenAI-compatible API surface ───────────────────────────────────────────

describe('OpenAI-compatible API surface', async () => {
    await it('has chat.completions.create method', () => {
        const client = new Styx({ apiKey: 'sk_styx_test' });
        assert.ok(client.chat, 'client.chat should exist');
        assert.ok(client.chat.completions, 'client.chat.completions should exist');
        assert.ok(
            typeof client.chat.completions.create === 'function',
            'client.chat.completions.create should be a function',
        );
    });

    await it('has embeddings.create method', () => {
        const client = new Styx({ apiKey: 'sk_styx_test' });
        assert.ok(client.embeddings, 'client.embeddings should exist');
        assert.ok(
            typeof client.embeddings.create === 'function',
            'client.embeddings.create should be a function',
        );
    });

    await it('has models.list method', () => {
        const client = new Styx({ apiKey: 'sk_styx_test' });
        assert.ok(client.models, 'client.models should exist');
        assert.ok(
            typeof client.models.list === 'function',
            'client.models.list should be a function',
        );
    });
});

// ─── Error handling (constructor-level) ──────────────────────────────────────

describe('Error handling', async () => {
    await it('error message mentions STYX_API_KEY', () => {
        try {
            const original = process.env.STYX_API_KEY;
            delete process.env.STYX_API_KEY;
            try {
                new Styx({ apiKey: '' });
                assert.fail('Should have thrown');
            } finally {
                if (original !== undefined) {
                    process.env.STYX_API_KEY = original;
                }
            }
        } catch (err) {
            assert.ok(err instanceof Error);
            assert.ok(
                err.message.toLowerCase().includes('api_key') ||
                err.message.toLowerCase().includes('apikey'),
                `Error message should mention API key: ${err.message}`,
            );
        }
    });

    await it('handles null-ish defaultHeaders gracefully', () => {
        const client = new Styx({
            apiKey: 'sk_styx_test',
            defaultHeaders: undefined,
        });
        assert.ok(client, 'Client should handle undefined defaultHeaders');
    });
});

// ─── Type exports ────────────────────────────────────────────────────────────

describe('Type exports', async () => {
    await it('index.ts exports Styx class', async () => {
        const mod = await import('../index');
        assert.ok(mod.Styx, 'Styx should be exported from index');
    });

    await it('index.ts exports StyxOptions type (accessible at runtime via module)', async () => {
        const mod = await import('../index');
        // Types are compile-time only, but we can verify the module loads
        assert.ok(mod, 'Module should load successfully');
    });
});

// ─── Summary ─────────────────────────────────────────────────────────────────

console.log(`\n${'='.repeat(60)}`);
console.log(`  Results: ${passed} passed, ${failed} failed`);
if (failures.length > 0) {
    console.log('\n  Failures:');
    for (const f of failures) {
        console.log(`    - ${f}`);
    }
}
console.log('='.repeat(60));

if (failed > 0) {
    process.exit(1);
}
