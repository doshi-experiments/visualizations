# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Sheet E-03 at visualizations.rishabhdoshi.com: four canvas/WebGL physics exhibits (Growth Cage, Silk, Divergence, Harmonograph). Static ES modules in `public/`, no build step; Cloudflare uploads `public/` as-is on push to `main`. `README.md` explains each exhibit's physics and the easy-to-get-wrong parts. Author commits as `doshi-experiments <311927837+doshi-experiments@users.noreply.github.com>`.

## Never publish PII or sensitive information

Nothing personal or sensitive goes to GitHub, under any circumstances, without Rishabh's direct approval of that specific content. That covers files, commit messages, branch names, pull requests, issues, comments, release notes, screenshots and test fixtures, and it applies even while a repository is private: every repository on this account is public or will be.

- Personal data: names other than Rishabh's public name (household members, pets, friends), email addresses, phone numbers, home addresses, the city or neighbourhood the household lives in, dates of birth, health or care providers.
- Financial data: account or card numbers, balances, real transactions, statements, payees and merchant strings, amounts and dates from real data, which banks or cards are held, anything from bank exports or Actual Budget.
- Secrets and infrastructure: `.env` contents, API keys, tokens, passwords, private hostnames and IP addresses, Tailscale names, Home Assistant entity names and user ids, chat ids.
- Anything copied from a real export, inbox, database or log. A file named "example" or "sample" must be invented, not trimmed from real data.

Commit identity: author and commit only as `doshi-experiments <311927837+doshi-experiments@users.noreply.github.com>`. Run `git config user.email` before the first commit in any checkout, and never put a personal address in a `Co-authored-by` trailer.

Commit messages and pull request text are as public as the code. Describe what changed and why, not the real data that prompted it: no real merchants, amounts, transaction dates, account names or people, even as examples.

Use synthetic fixtures instead. Before every commit and push, check the staged diff, any new untracked files and the message itself for this kind of content. If something looks sensitive, or you are unsure, stop and ask; do not commit it, push it or open a pull request with it. Earlier approval of a different change does not cover this one. Git history is permanent: a leak can only be removed by rewriting history and recreating the repository.

## Commands

```sh
npx wrangler dev                  # or: python3 -m http.server --directory public
```

Open `/#growth?debug` (any exhibit id: `growth`, `silk`, `chaos`, `harmonograph`) to expose `window.__e03`. Use `step(ms)` for reproducible checks; equal wall-clock is not equal simulated time. CI re-verifies `public/design-system/release.json`; the design-system repository's `check-visualizations.mjs` drives every exhibit in a browser.

## Architecture

- `public/js/shell.js` documents the exhibit contract at its top. To add an exhibit, write one module in `public/js/` that default-exports that contract and register it in `public/js/boot.js`. Tabs, controls, telemetry and the chart all derive from the contract.
- `public/index.html` holds the page's styles: Felt pills for tabs and buttons, raised panels, pressed-in selects, stitched dividers.
- Dependencies (Matter.js, perfect-freehand) are vendored and pinned in `public/vendor/`; never load from a CDN.

## Invariants that are easy to break

- Divergence and Harmonograph use custom RK4 on purpose, not a physics engine.
- Measure before asserting physics results: the Growth Cage's growth exponent measures below 1, not the N² most people predict.
- Selected tabs, primary buttons and the progress bar use `--ds-action-gradient` with `--ds-action-text`; sliders and toggles use solid `--ds-action-primary` via `accent-color`; text in the signal colour uses `--ds-action-link`. Canvas labels draw in Host Grotesk.
- Never edit `public/design-system/`; upgrade through the design-system repository's central rollout. `prepaint.js` must load before styles, and the `sheet-theme` cookie name and scope must not change.
