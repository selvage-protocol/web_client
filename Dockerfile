# syntax=docker/dockerfile:1
#
# selvage-web — the browser client's page on an origin of its own, for a
# deployment that puts the page in front of one or more `selvaged` instances
# instead of sharing one listener with a server.
#
# One origin is the default and stays it: `selvaged --serve-page` answers the
# page, `/meta` and `/session` together, which is what makes a single terminator
# enough for TLS and what lets the page's advisory `/meta` read land. This image
# is the second shape. The README owns the choice between them and says plainly
# what the second one costs — a `?server=` in every link, because the socket is
# not CORS-bound while `/meta` is a cross-origin read the page then skips.
#
# The bundle is the `dist/` committed in this repository, copied rather than
# rebuilt here. The reference server's image clones this repository at a pinned
# revision and runs `npm ci && npm run build` inside its own build, and its round
# recorded that the two are byte-identical; the `checks` job in
# .github/workflows/ci.yml re-proves that on every pull request (`npm run build`, then
# `scripts/check-dist.sh` against the commit's own copy), so what this COPY takes is the
# reviewed bytes. What a rebuild inside the image would add is nothing the checks job
# does not already assert, and it would add a node toolchain, a fetch and ImageMagick 7
# to this build for it. A page that must be built somewhere else is served by mounting a
# `dist/` over `/usr/share/nginx/html` instead, which needs no command override.
#
# The runtime is `nginxinc/nginx-unprivileged`, nginx with two changes of its own:
# it runs as uid 101 and it listens on 8080, so nothing in the image needs a
# capability or a privileged port. Its third-party surface is one well-known base
# image and no plugin; the alternatives a static page could run on (a language's
# `http.server`, or the busybox one) each need a MIME table written into the build
# or answer the wrong type for a `.map`, and the point of this image is that it
# answers what the reference deployment answers. `packaging/nginx.conf` and
# `packaging/default.conf` replace the base's configuration with the media-type
# table, the cache policy and the page's policy that
# `reference_server`'s `crates/selvaged/src/page.rs` decides for the one-origin
# deployment, and they move nginx's writable paths — the pid file and its five
# temp directories — onto `/dev/shm`, the tmpfs the container runtime mounts
# itself. That is what lets this image run under `--read-only` with every
# capability dropped and nothing mounted at all, which scripts/container-smoke.sh
# asserts against the daemon's own record of the container.
FROM nginxinc/nginx-unprivileged:1.30-alpine-slim

# The version comes from package.json in the release path
# (`scripts/release-tags.sh`), and the revision is the commit the image was built
# from. Both are read back off the image by `scripts/assert-image-page.sh`, so a
# tag cannot name a bundle it does not carry.
ARG VERSION=dev
ARG REVISION=unknown

# nginx is BSD-2-Clause and this repository's own licence is the pair below; the
# page's dependencies travel in the bundle itself under their own licences.
LABEL org.opencontainers.image.title="selvage-web" \
      org.opencontainers.image.description="The Selvage browser client's page, served on an origin of its own" \
      org.opencontainers.image.source="https://github.com/selvage-protocol/web_client" \
      org.opencontainers.image.licenses="MIT OR Apache-2.0" \
      org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.revision="${REVISION}"

COPY --chown=101:101 packaging/nginx.conf /etc/nginx/nginx.conf
COPY --chown=101:101 packaging/default.conf /etc/nginx/conf.d/default.conf
COPY --chown=101:101 dist/ /usr/share/nginx/html/
COPY --chown=101:101 LICENSE-MIT LICENSE-APACHE /licenses/

EXPOSE 8080
