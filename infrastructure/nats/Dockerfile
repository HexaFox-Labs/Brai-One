FROM nats:2.14.3-alpine@sha256:c11af972c99ae542de8925e6a7d9c533aa1eb039660420d2074beed6089b3bf0

RUN mkdir -p /data/jetstream \
  && chown -R 65534:65534 /data

COPY --chown=65534:65534 --chmod=0444 infrastructure/nats/nats-server.conf /etc/nats/nats-server.conf

USER 65534:65534
