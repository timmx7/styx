# Billing Guide

Styx supports two billing modes. You choose once during onboarding; the choice is permanent for your account.

## Billing Modes at a Glance

| | **Charon** (BYOK) | **Achilles** (Managed) |
|---|---|---|
| API keys | You bring your own | Styx provides them |
| Pricing model | Fixed monthly fee for request quota | Credit-based, pay per token |
| Provider markup | 0% | 30% over raw cost |
| Best for | Teams with existing provider contracts | Fast setup, no provider accounts |
| Enforcement | 429 when quota exceeded | 402 when credits run out |

---

## Charon Mode (BYOK Gateway)

In Charon mode, you bring your own API keys for each AI provider. Styx charges a flat monthly fee based on your request volume.

### Plans

| Plan | Price | Request Limit | Features |
|------|-------|--------------|----------|
| **Shade** | Free | 10,000/month | BYOK, community support |
| **Obol** | $29/month | 100,000/month | Smart routing, email support |
| **Ferryman** | $99/month | 1,000,000/month | Routing + semantic cache, priority support |
| **Titan** | $499/month | Unlimited | Full features, dedicated support, SLA |

### How Quota Works

- Each API request through the proxy counts as 1 request
- Cached responses (semantic cache hits) still count toward quota
- Quota resets monthly on your billing cycle date
- At 80% usage, you receive an alert (email/Slack)
- At 100%, requests return HTTP 429 until the next cycle or upgrade

### Setting Up

1. Choose Charon during onboarding
2. You're automatically on the Shade (free) plan
3. Add your provider API keys via the dashboard or API
4. Upgrade plans via Stripe Checkout when you need more quota

---

## Achilles Mode (Managed Keys)

In Achilles mode, Styx manages the provider API keys. You buy credits and pay per token used, with a 30% markup over the raw provider cost.

### Plans

| Plan | Price | Monthly Credits | Features |
|------|-------|----------------|----------|
| **Spark** | $10/month | $100 in credits | Smart routing, email support |
| **Blaze** | $50/month | $600 in credits | Routing + cache, priority support |
| **Inferno** | $200/month | $3,000 in credits | Full features, dedicated support, SLA |

### How Credits Work

- Credits are denominated in cents (1 credit = $0.01)
- Each request deducts credits based on actual token usage
- Cost = (input_tokens * input_price + output_tokens * output_price) * 1.30
- Monthly credits from your plan are added at the start of each billing cycle
- Unused credits do NOT roll over
- You can purchase additional credit packs at any time

### Credit Packs (Top-Up)

| Pack | Price | Credits Added |
|------|-------|---------------|
| Small | $10 | $10 in credits |
| Medium | $50 | $50 in credits |
| Large | $200 | $200 in credits |

Purchased credits stack on top of monthly plan credits.

### Model Pricing

Pricing is based on the underlying provider cost plus 30% markup. View current pricing:

```bash
curl http://localhost:8000/api/pricing/models
```

Example pricing (per million tokens):

| Model | Input | Output |
|-------|-------|--------|
| gpt-4o | $3.25 | $13.00 |
| gpt-4o-mini | $0.20 | $0.78 |
| claude-sonnet-4 | $3.90 | $19.50 |
| gemini-1.5-pro | $1.63 | $6.50 |

*(Prices include 30% markup. Check `/api/pricing/models` for current rates.)*

---

## Stripe Integration

Styx uses Stripe for all payment processing.

### Checkout Flow

1. User selects a plan or credit pack
2. Backend creates a Stripe Checkout Session
3. User is redirected to Stripe's hosted checkout page
4. After payment, Stripe sends a webhook to `/api/billing/webhook`
5. Backend activates the subscription or credits the account

### Customer Portal

Users can manage their subscription (upgrade, downgrade, cancel, update payment method) via the Stripe Customer Portal:

```bash
curl -X POST http://localhost:8000/api/billing/create-portal \
  -H "Authorization: Bearer TOKEN"
# Returns: { "portal_url": "https://billing.stripe.com/..." }
```

### Webhook Events

Styx handles these Stripe events:

| Event | Action |
|-------|--------|
| `checkout.session.completed` | Activate subscription or add credits |
| `invoice.payment_succeeded` | Reset monthly quota (Charon) or add monthly credits (Achilles) |
| `invoice.payment_failed` | Send alert, grace period |
| `customer.subscription.updated` | Update plan limits |
| `customer.subscription.deleted` | Downgrade to free/inactive |

Webhooks are idempotent (deduplicated via Redis for 24 hours).

---

## Budget Controls

Independent of billing mode, you can set per-project budgets:

```bash
curl -X PUT http://localhost:8000/api/budget/PROJECT_ID \
  -H "Authorization: Bearer TOKEN" \
  -d '{"monthly_budget_cents": 10000, "alert_threshold_pct": 80}'
```

When a project's spend reaches the alert threshold, notifications are sent. When the budget is exceeded, requests for that project are blocked.

---

## Alerts

Styx sends alerts for billing events:

| Alert Type | Trigger |
|-----------|---------|
| `quota_80pct` | Charon: 80% of monthly request quota used |
| `credits_low` | Achilles: balance below $2.00 |
| `payment_failed` | Stripe payment failed |
| `renewal_success` | Monthly subscription renewed |
| `budget_exceeded` | Project budget limit reached |

Alerts appear in the dashboard and can be sent via email and Slack webhooks.

---

## Setting Up Stripe (Self-Hosted)

If you're self-hosting Styx, set up Stripe products:

```bash
# 1. Set your Stripe key
export STRIPE_SECRET_KEY=sk_test_xxx

# 2. Run the setup script (idempotent, safe to re-run)
python scripts/stripe_setup.py

# 3. Copy the output price IDs to your .env file

# 4. Set up the webhook in Stripe Dashboard
#    URL: https://api.yourdomain.com/api/billing/webhook
#    Events: checkout.session.completed, customer.subscription.*,
#            invoice.payment_succeeded, invoice.payment_failed
```

See [Self-Hosting Guide](./self-hosting.md) for full setup instructions.
