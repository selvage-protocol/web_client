# Checks

The commands live in the README's [Running it](../README.md#running-it) section; this is what each
one covers.

`typecheck` covers `src/`, which is all `tsconfig.json` includes.

`test` runs the suite with a fake editor standing in for Monaco: the adapter, languages, follow, the
room's faces and the menu behind them, the empty pane, grants, tree refresh, share links, the join
card, mobile, identity, and the serve-types contract. `identity` reads files outside this repository:
one of its tests compares the marks with the `site` checkout beside this one, and it reads this
repository's own git directory to find that sibling from a worktree as well as from a checkout. Where
there is no sibling (a single-repository CI job) that one test skips with the reason and the rest of
the file runs, icons and clock chunks included. `test:ci`, `scripts/test-ci.mjs`, is that suite; it
names no exclusions, and the checks that need something live, `check:types` (a deployed page) and the
proofs (a `selvaged`), run locally only.

`check:types` is live, and tests a deployment rather than the local static server. It defaults to the
demo page and takes another base as an argument, `npm run check:types -- http://127.0.0.1:8081`; a
plain static server answers the `.map` files as `application/octet-stream` and fails that check, which
is about the serving layer the page is deployed behind. Against the page-only image the same script is
what `scripts/check-page.sh` runs, together with the served bytes and headers.

`scripts/check_dry_run_gating.py` is the one check here that is not Node's. It reads
`.github/workflows` back and refuses a workflow that declares a `dry_run` input and leaves a step
below its plan step without a condition that excludes a dry run. `release.yml` and `deploy-prod.yml`
both declare one, and `actionlint` cannot see the condition a step does *not* carry.
`scripts/ci-local.sh checks` runs it, and its own suite, on the host's `python3` where that already
imports PyYAML and through a venv under `.tmp/` where it does not; `ci.yml`'s container installs
Debian's `python3-yaml` for the same two files, and so does `release.yml`'s release job, whose gate
before the bump reaches `main` is `scripts/ci-local.sh checks`. The two install steps carry the same
packages, `nginx-light` among them, for that same reason.
