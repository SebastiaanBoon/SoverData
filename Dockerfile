FROM python:3.11-slim

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Set environment variables for better Python behavior in containers
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
ENV PYTHONPATH=/app
ENV PORT=8000

# Install dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY . .

# Ensure standard permissions and keep a compatibility copy for any stale
# App Service startup command that still points at /home/site/wwwroot/startup.sh.
RUN chmod +x startup.sh \
    && mkdir -p /home/site/wwwroot \
    && cp startup.sh /home/site/wwwroot/startup.sh \
    && chmod +x /home/site/wwwroot/startup.sh

# Azure App Service uses this port by default or via WEBSITES_PORT
EXPOSE 8000

# Start application using the same entrypoint Azure can call directly.
CMD ["bash", "/app/startup.sh"]
