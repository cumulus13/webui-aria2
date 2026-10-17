# build stage: compiles src/ into docs/ (node-sass 4 in package-lock.json needs Node 10)
FROM node:10 AS webui-builder
WORKDIR /build
COPY package.json package-lock.json webpack.config.js postcss.config.js ./
RUN npm ci --no-audit --no-fund
COPY src ./src
RUN npx webpack -p

FROM debian:bookworm-slim

ARG GOREMAN_VERSION=v0.3.19

# less priviledge user, the id should map the user the downloaded files belongs to
RUN groupadd -r dummy && useradd -r -g dummy dummy -u 1000

# webui + aria2 (+ gosu to drop privileges)
RUN apt-get update \
	&& apt-get install -y --no-install-recommends aria2 busybox curl ca-certificates gosu \
	&& rm -rf /var/lib/apt/lists/*

COPY --from=webui-builder /build/docs /webui-aria2

# goreman supervisor install (pinned, override with --build-arg GOREMAN_VERSION=...)
RUN curl -fsSL "https://github.com/mattn/goreman/releases/download/${GOREMAN_VERSION}/goreman_${GOREMAN_VERSION}_linux_amd64.tar.gz" -o /tmp/goreman.tar.gz \
  && tar -xzf /tmp/goreman.tar.gz -C /tmp \
  && mv /tmp/goreman_*/goreman /usr/local/bin/goreman \
  && rm -rf /tmp/goreman*

# goreman setup
RUN printf 'web: gosu dummy /bin/busybox httpd -f -p 8080 -h /webui-aria2\nbackend: gosu dummy /usr/bin/aria2c --enable-rpc --rpc-listen-all --dir=/downloads\n' > /Procfile

WORKDIR /

# aria2 downloads directory
VOLUME /downloads

# aria2 RPC port, map as-is or reconfigure webui
EXPOSE 6800/tcp

# webui static content web server, map wherever is convenient
EXPOSE 8080/tcp

CMD ["start"]
ENTRYPOINT ["/usr/local/bin/goreman"]
