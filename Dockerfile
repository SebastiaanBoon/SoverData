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

# Ensure standard permissions
RUN chmod +x startup.sh

# Azure App Service uses this port by default or via WEBSITES_PORT
EXPOSE 8000

# Start application using uvicorn
CMD ["python", "-m", "uvicorn", "server.api.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
