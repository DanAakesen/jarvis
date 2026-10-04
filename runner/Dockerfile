FROM node:22.23.3-bookworm-slim AS tools
WORKDIR /opt/cli
COPY tools/package.json tools/package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

FROM python:3.12.14-slim-bookworm AS base
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    HOME=/home/runner \
    PATH=/opt/cli/node_modules/.bin:/usr/local/bin:$PATH
ARG GH_VERSION=2.98.0
RUN apt-get update \
    && apt-get install --no-install-recommends -y ca-certificates git curl \
    && rm -rf /var/lib/apt/lists/*
RUN curl --fail --silent --show-error --location \
      "https://github.com/cli/cli/releases/download/v${GH_VERSION}/gh_${GH_VERSION}_linux_amd64.tar.gz" -o /tmp/gh.tar.gz \
    && curl --fail --silent --show-error --location \
      "https://github.com/cli/cli/releases/download/v${GH_VERSION}/gh_${GH_VERSION}_checksums.txt" -o /tmp/gh-checksums.txt \
    && cd /tmp \
    && mv gh.tar.gz "gh_${GH_VERSION}_linux_amd64.tar.gz" \
    && grep " gh_${GH_VERSION}_linux_amd64.tar.gz$" gh-checksums.txt | sha256sum --check --strict \
    && tar --extract --gzip --file "gh_${GH_VERSION}_linux_amd64.tar.gz" --strip-components=2 \
        --directory /usr/local/bin "gh_${GH_VERSION}_linux_amd64/bin/gh" \
    && rm gh_*.tar.gz gh-checksums.txt \
    && gh version
COPY --from=tools /usr/local/bin/node /usr/local/bin/node
COPY --from=tools /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/npm
RUN ln -s ../lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm \
    && ln -s ../lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx
COPY --from=tools /opt/cli /opt/cli
RUN useradd --create-home --shell /bin/bash runner
WORKDIR /app
COPY requirements.txt ./
RUN pip install --require-hashes -r requirements.txt
COPY app.py github_token.py git_credential_helper.py ./
RUN mkdir -p /files/jarvis && chown -R runner:runner /app /home/runner /files
USER runner
EXPOSE 8088
CMD ["python", "app.py"]
