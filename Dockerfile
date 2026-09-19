FROM python:3.11-slim

WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

COPY server/requirements.txt /app/server/requirements.txt
RUN python -m pip install --upgrade pip \
 && python -m pip install -r /app/server/requirements.txt

COPY . /app

EXPOSE 8080

CMD ["sh", "-c", "cd /app/server && uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8080}"]
