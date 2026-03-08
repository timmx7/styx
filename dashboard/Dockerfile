FROM node:20-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

ENV NEXT_PUBLIC_API_URL=http://localhost:8000

ARG NEXT_PUBLIC_SKIP_AUTH=false
ENV NEXT_PUBLIC_SKIP_AUTH=${NEXT_PUBLIC_SKIP_AUTH}

RUN npm run build

FROM node:20-alpine AS runner

# Security: create non-root user
RUN addgroup --system --gid 1001 appuser && \
    adduser --system --uid 1001 appuser

WORKDIR /app

ENV NODE_ENV=production

COPY --from=builder --chown=appuser:appuser /app/.next/standalone ./
COPY --from=builder --chown=appuser:appuser /app/.next/static ./.next/static
# public/ may be empty but must exist for Next.js standalone
RUN mkdir -p ./public && chown appuser:appuser ./public
COPY --from=builder --chown=appuser:appuser /app/public/ ./public/

# Security: run as non-root user
USER appuser

EXPOSE 3000

CMD ["node", "server.js"]
