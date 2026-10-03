FROM python:3.13-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PORT=8088

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt \
    && useradd --create-home --uid 10001 agent
COPY *.py ./

USER agent
EXPOSE 8088
CMD ["python", "main.py"]
