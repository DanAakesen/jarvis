FROM python:3.12.14-slim-bookworm

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PORT=8088

WORKDIR /app
COPY requirements.txt ./
RUN pip install --require-hashes -r requirements.txt \
    && useradd --create-home --uid 10001 agent
COPY *.py ./

USER agent
EXPOSE 8088
CMD ["python", "main.py"]
