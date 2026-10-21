# Shield Leak

What a public observer can still infer from **Fhenix confidential tokens** on Ethereum and Arbitrum mainnet (live since 2026-10-21): public shield amounts, public claim amounts, confidential-transfer counterparties and timing. Static site for GitHub Pages; data refreshed by a GitHub Action from public RPCs and the Blockscout API. No backend, no wallet connection, no API keys, no secrets.

Live (after deploy): https://suhasdasari.github.io/shield-leak/

## Layout
```
index.html                      page (relative paths only)
assets/style.css, assets/app.js address/tx check, token board, link finder, exit hints
data/leaks.json                 generated snapshot (do not edit by hand)
data/seed_tokens.json           Fhenix token addresses seen on 2026-10-21 (extra discovery input, each verified by name())
scripts/refresh.py              indexer (Python 3.9+ stdlib only)
.github/workflows/refresh.yml   every 6 h + manual run; commits data/leaks.json
.nojekyll
```

## Run locally
```
python3 scripts/refresh.py        # ~5-7 min (Ethereum discovery via Blockscout is the slow part)
python3 -m http.server 8000       # open http://localhost:8000/
```

## Method
- **Token discovery:** any contract emitting ERC-7984 `ConfidentialTransfer(address,address,bytes32)` whose `name()` starts with "Fhenix". Arbitrum: `eth_getLogs` topic scan on arb1.arbitrum.io (30k-block chunks) from block 512,000,000. Ethereum: Blockscout topic0 search from block 26,150,000 plus `data/seed_tokens.json`, then per-token log history via Blockscout.
- **Shield:** `ConfidentialTransfer` from `0x0`; amount = underlying `Transfer` into the wrapper in that tx (ETH wrappers: tx value), floored to 6-decimal confidential precision.
- **Unshield:** `ConfidentialTransfer` to `0x0`. **Claim:** wrapper event `0x71c5a97e…` whose data is the decrypted amount (signature not published; meaning inferred from the tx pattern in Fhenix docs).
- **Link finder:** a claim whose exact amount equals an earlier shield on the same token; "unique amount" when only one address ever shielded it.

## Gaps
No USD pricing; no dual-mode ERC20Confidential tokens (fUSD, FIX) seen on mainnet yet, only FHERC20-style wrappers; contracts that never emitted `ConfidentialTransfer` are missed; address check uses the snapshot, not live state; encrypted balances and pending claims cannot be read. Volume is very thin in launch week.

## Deploy
Push to `suhasdasari/shield-leak`, then Settings → Pages → Deploy from branch `main` / root. Settings → Actions → General → Workflow permissions must allow **Read and write** (the workflow also declares `permissions: contents: write`). No secrets needed.

Corrections: https://github.com/suhasdasari/shield-leak/issues

Not financial advice. Built by Satoshi Drops 🪂 [@SatoshiDropsHQ](https://x.com/SatoshiDropsHQ)
