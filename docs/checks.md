# Checks

`check:types` is live, and tests a deployment rather than the local static server. It defaults to
the demo page and takes another base as an argument, `npm run check:types -- http://127.0.0.1:8081`;
a plain static server answers the `.map` files as `application/octet-stream` and fails that check,
which is about the serving layer the page is deployed behind. Against the page-only image the same
script is what `scripts/check-page.sh` runs, together with the served bytes and headers.

`scripts/check_dry_run_gating.py` is the one check here that is not Node's. It reads
`.github/workflows` back and refuses a workflow that declares a `dry_run` input and leaves a step
below its plan step without a condition that excludes a dry run — `release.yml` and
`deploy-prod.yml` both declare one, and `actionlint` cannot see the condition a step does *not*
carry. `scripts/ci-local.sh checks` runs it, and its own suite, on the host's `python3` where that
already imports PyYAML and through a venv under `.tmp/` where it does not; `ci.yml`'s container
installs Debian's `python3-yaml` for the same two files, and so does `release.yml`'s release job,
whose gate before the bump reaches `main` is `scripts/ci-local.sh checks`. The two install steps
carry the same packages, `nginx-light` among them, for that same reason.
