# MCP OAuth gateway for self-hosted Hindsight (#10). Stdlib + FastAPI; opaque
# gateway tokens, PKCE S256 via hashlib — no hand-rolled crypto.
FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY app.py .
EXPOSE 8080
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8080"]
