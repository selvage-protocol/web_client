# CI

The repository's four workflows. `ci.yml` is the node checks, on a pull request: `npm ci`,
`typecheck`, `build`, `scripts/check-dist.sh`, `test:ci` and the three script suites,
`scripts/test-bump-version.sh`, `scripts/test-release-plan.sh` and `scripts/test-relay-config.sh`,
and the `dry_run` guard, `scripts/check_dry_run_gating.py`. It runs in `node:22-trixie-slim`,
because the build shells out to ImageMagick 7's `magick` and the GitHub runner image ships
ImageMagick 6, and that job's install step carries Debian's `nginx-light` so the relay's generated
configuration is parsed there by an `nginx` rather than only read.

`scripts/check-dist.sh` is the build reproducing the committed `dist/`: every file the bundler
writes, byte for byte, and the six sized icons at their six sizes. The icons are the one part an
ImageMagick version decides, so `test/identity.test.ts` pins their bytes, on a machine that has the
`site` checkout beside this one.

`image.yml` is the image. On a pull request that changes what the image is built from, it runs
`docker build` and a hardened `docker run` with the assertions above (`scripts/container-smoke.sh`),
plus a rehearsal of the publish path against a registry on the runner's own loopback. On a `v*` tag
it publishes the three tags and reads the version and the page back off them.

`release.yml` is the button that cuts a release: a dispatch names `bump` (`patch`, `minor` or
`major`) and `dry_run`. It refuses unless the version `package.json` already carries has a tag on
the remote — the invariant that makes a second click safe rather than a second release — and refuses
a target tag that is already on the remote; `scripts/release-plan.sh` owns both refusals and
`scripts/test-release-plan.sh` covers them against real tag states. It then bumps with
`bump-version.sh`, runs `scripts/ci-local.sh checks` as the pull request's `ci.yml` would have,
commits as the owner and pushes to `main`, creates the tag and dispatches `image.yml` at it, and
finally waits for the tag to appear on `ghcr.io`, dispatches `deploy-prod.yml`, and waits for the
deploy's own run, failing the release unless it concludes `success`.
**A bump does not travel through a pull request**, and the reason is mechanical: an event created
with a workflow's own `GITHUB_TOKEN` starts no run, so a bump pull request would carry no checks at
all — the gate runs before the push instead. The tag is dispatched into `image.yml` for the same
reason.

`deploy-prod.yml` is this repository's half of the demo's deploy: it hands the box one
`SELVAGE_WEB_IMAGE=<tag>` line on stdin and nothing else, and the box leaves every line a request
does not name exactly as it is, so the server's container is not touched. Its job declares no
`environment:` — this repository's federated credential is pinned to the `main` ref subject and an
environment would present a different one, so the line would break the deploy rather than gate it —
and it refuses a `web_version` that is not a published tag. What it can verify afterwards is
`scripts/verify-page-deploy.sh`, which prints each read under the name of its weight: the registry's
digest for the tag is the check, the demo's page answering 200 on the origin is best effort and
cannot name the page build, and the public read is reported and never failed, because Cloudflare
serves a managed challenge to a programmatic client and an edge is not something a deploy can fix.

The container steps need a Docker daemon, so `scripts/ci-local.sh container` and both smoke scripts
are CI runs on a machine without one.
