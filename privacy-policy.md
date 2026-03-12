# Privacy Policy

**Last updated: March 2026**

## Overview

Styx is an open-source AI API gateway. This privacy policy describes how data is handled when you use the Styx MCP connector through Claude or other MCP-compatible clients.

## Data We Collect

When you connect Styx to Claude via the MCP connector, Styx processes:

- **API requests**: Prompts and completions routed through the gateway, processed in transit and not stored beyond your configured caching duration
- **Usage metadata**: Request counts, token counts, latency metrics, and cost estimates per provider and model
- **API key information**: Keys you create within Styx for managing access
- **Authentication tokens**: OAuth tokens used to authenticate your session

## How We Use Your Data

- Route your AI API requests to the configured providers
- Compute usage analytics and cost tracking
- Enforce rate limits and caching policies you configure
- Authenticate your identity via OAuth

We do not use your data for training AI models or any purpose beyond operating the gateway.

## Data Storage and Retention

- **Self-hosted**: When you self-host Styx, all data remains on your infrastructure. We have no access to it.
- **Cached responses**: Retained according to your configured cache TTL and automatically purged after expiration.
- **Usage logs**: Retained for the duration you configure in your Styx instance settings.

## Third-Party Sharing

Styx routes requests to third-party AI providers (OpenAI, Anthropic, Google, Mistral, etc.) based on your configuration. Each provider's own privacy policy applies to data they receive.

We do not sell, share, or transfer your data to any other third parties.

## Data Security

- All communication with the MCP server occurs over HTTPS
- OAuth 2.0 is used for authentication
- API keys are stored encrypted at rest

## Your Rights

- Delete your data at any time by removing it from your self-hosted Styx instance
- Revoke OAuth access at any time through your connector settings
- Disconnect the Styx connector from Claude at any time

## Contact

For privacy questions or concerns:
- Email: privacy@styxhq.com
- GitHub: https://github.com/styx-hq/styx/issues

## Changes

We may update this policy from time to time. Changes will be posted on this page with an updated date.
