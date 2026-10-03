FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    HOME=/home/runner

ARG GH_VERSION=2.98.0

RUN apt-get update \
    && apt-get install --no-install-recommends -y ca-certificates git curl nodejs npm \
    && rm -rf /var/lib/apt/lists/*

# `gh` uses GH_TOKEN for non-interactive PR creation. Git itself is configured
# at task start with an environment-backed credential helper, so no token is
# baked into this layer or passed on a command line.
RUN curl --fail --silent --show-error --location \
    "https://github.com/cli/cli/releases/download/v${GH_VERSION}/gh_${GH_VERSION}_linux_amd64.tar.gz" \
    --output /tmp/gh.tar.gz \
    && tar --extract --gzip --file /tmp/gh.tar.gz --strip-components=2 \
        --directory /usr/local/bin "gh_${GH_VERSION}_linux_amd64/bin/gh" \
    && rm /tmp/gh.tar.gz \
    && gh version

# The CLIs are public tools; credentials are deliberately not part of this layer.
RUN npm install --global @github/copilot @openai/codex @agentclientprotocol/codex-acp \
    && npm cache clean --force

RUN useradd --create-home --shell /bin/bash runner
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY app.py .
RUN mkdir -p /files/jarvis && chown -R runner:runner /app /home/runner /files
USER runner

EXPOSE 8088
CMD ["python", "app.py"]
