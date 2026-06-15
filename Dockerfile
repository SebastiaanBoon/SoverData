# Stage 1: Build UI
FROM node:20-slim AS ui-build
WORKDIR /app/ui
COPY soverdata/ui/package*.json ./
RUN npm install
COPY soverdata/ui/ ./
RUN npm run build

# Stage 2: Build App
FROM python:3.11-slim

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Set environment variables
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
ENV PYTHONPATH=/app
ENV PORT=8000

# Install dependencies from soverdata folder
COPY soverdata/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code from soverdata folder to root of container
COPY soverdata/ ./

# Keep a compatibility copy for App Service startup commands that point at
# /home/site/wwwroot/startup.sh even when running a custom Docker image.
RUN chmod +x /app/startup.sh \
    && mkdir -p /home/site/wwwroot \
    && cp /app/startup.sh /home/site/wwwroot/startup.sh \
    && chmod +x /home/site/wwwroot/startup.sh

# Copy built UI from stage 1
COPY --from=ui-build /app/ui/dist ./ui/dist

EXPOSE 8000

# Entry point for Claude branch: server.main:app
CMD ["bash", "/app/startup.sh"]
