# Hindsight API image with BOTH NDA extensions (#10):
#   - supabase-tenant (verifies the Supabase JWT → schema per user)
#   - nda-oauth (serves MCP OAuth 2.1 so agents log in via Supabase, no gateway)
# Build from the repo root:
#   docker build -f hindsight-extensions/nda-oauth/Dockerfile \
#     --build-arg HINDSIGHT_IMAGE=ghcr.io/vectorize-io/hindsight-api:1.0.0-slim \
#     -t hindsight-api-supabase:dev .
ARG HINDSIGHT_IMAGE=ghcr.io/vectorize-io/hindsight-api:1.0.0-slim
FROM ${HINDSIGHT_IMAGE}

RUN uv pip install --python /app/api/.venv/bin/python --no-cache \
      'PyJWT[crypto]>=2.12.0' \
      'aiohttp>=3.14.3'

COPY hindsight-extensions/supabase-tenant/hindsight_ext_supabase_tenant \
     /app/extensions/hindsight_ext_supabase_tenant
COPY hindsight-extensions/nda-oauth/nda_oauth \
     /app/extensions/nda_oauth
ENV PYTHONPATH=/app/extensions

# Fail the build if either extension is not importable by the server interpreter.
RUN /app/api/.venv/bin/python -c "import hindsight_ext_supabase_tenant, nda_oauth.extension"
