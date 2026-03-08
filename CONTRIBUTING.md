# Contributing to Styx

Thanks for your interest in contributing to Styx! 🎉

## Getting Started

1. Fork the repo
2. Clone your fork: `git clone https://github.com/YOUR_USERNAME/styx.git`
3. Create a branch: `git checkout -b feat/my-feature`
4. Make your changes
5. Run tests:
   - Go: `cd router && go test ./... -v`
   - Python: `cd backend && pytest`
   - Dashboard: `cd dashboard && npm run build`
6. Commit with conventional commits: `feat: add X` / `fix: resolve Y`
7. Push and open a PR

## Development Setup

The fastest path (no external accounts needed):

```bash
./setup.sh              # select "Dev mode" when prompted
docker compose up -d --build
```

Or manually:

```bash
cp .env.example .env
# Set SKIP_AUTH=true and NEXT_PUBLIC_SKIP_AUTH=true for dev mode (no Supabase needed)
# OR: configure SUPABASE_URL / SUPABASE_ANON_KEY for full auth
# Add at least one AI provider key (OPENAI_API_KEY recommended)
docker compose up -d --build
```

The dashboard is at http://localhost:3000, the API gateway at http://localhost:8080, and the backend at http://localhost:8000. In dev mode (`SKIP_AUTH=true`) you are logged in automatically — no account creation needed.

## Project Structure

- `router/` — Go reverse proxy (performance-critical path)
- `backend/` — Python FastAPI (auth, billing, business logic)
- `dashboard/` — Next.js + Tailwind (web UI)
- `classifier/` — ML request classifier
- `cache-service/` — Semantic cache (Qdrant + embeddings)
- `sdk/` — Python & Node.js client SDKs
- `packages/` — MCP server, gateway CLI
- `infra/` — Docker, Helm, k6 load tests

## Guidelines

- **Write tests** for new features
- **Keep PRs focused** — one feature/fix per PR
- **Update docs** if you change user-facing behavior
- **Follow commit convention**: `feat(router): add X`, `fix(backend): resolve Y`
- **Be kind** in code reviews

## Code Style

- **Go**: `gofmt`, standard library preferred, `slog` for logging
- **Python**: Type hints everywhere, FastAPI + Pydantic, `logging` module
- **TypeScript**: Strict mode, Tailwind CSS, no CSS modules

## Need Help?

Open an issue or start a discussion. We're happy to help!
