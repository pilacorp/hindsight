# A Hindsight API image with the NDA multi-user extension in it.
#
# Extensions are not bundled with the server and not published to PyPI: ship one
# by copying it into an image built on top of Hindsight. The extension needs no
# third-party dependency beyond the server itself (asyncpg, FastAPI and Pydantic
# are already in the API image), so there is nothing to pip install.
#
# Build from the repository root (the extension sources must be in context):
#   docker build -f hindsight-extensions/nda-multiuser/Dockerfile \
#     --build-arg HINDSIGHT_IMAGE=ghcr.io/vectorize-io/hindsight-api:1.0.0-slim \
#     -t hindsight-api-nda .
#
# Run with the tenant and HTTP extensions enabled:
#   docker run -p 8888:8888 \
#     -e HINDSIGHT_API_DATABASE_URL=postgresql://... \
#     -e HINDSIGHT_API_TENANT_KEY_PEPPER=... \
#     -e HINDSIGHT_API_LLM_PROVIDER=openrouter -e HINDSIGHT_API_LLM_API_KEY=... \
#     -e HINDSIGHT_API_LLM_MODEL=openai/gpt-oss-20b \
#     -e HINDSIGHT_API_TENANT_EXTENSION=nda_hindsight_multiuser.tenant:NdaTenantExtension \
#     -e HINDSIGHT_API_HTTP_EXTENSION=nda_hindsight_multiuser.http:NdaHttpExtension \
#     hindsight-api-nda
#
# Bootstrap the first admin key once (prints it once):
#   docker exec <container> /app/api/.venv/bin/python -m nda_hindsight_multiuser.cli \
#     create-admin --name ops
ARG HINDSIGHT_IMAGE=ghcr.io/vectorize-io/hindsight-api:1.0.0-slim
FROM ${HINDSIGHT_IMAGE}

# /app/extensions is ours — the image does not use it — so this cannot shadow
# anything the server ships.
COPY hindsight-extensions/nda-multiuser/nda_hindsight_multiuser \
     /app/extensions/nda_hindsight_multiuser
ENV PYTHONPATH=/app/extensions

# Fail the build, not the first request, if the extension is not importable
# from the interpreter the server actually runs.
RUN /app/api/.venv/bin/python -c "import nda_hindsight_multiuser.tenant, nda_hindsight_multiuser.http, nda_hindsight_multiuser.cli"
