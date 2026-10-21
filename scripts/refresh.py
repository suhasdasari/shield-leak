#!/usr/bin/env python3
"""Shield Leak data refresh.

Scans Ethereum and Arbitrum One with public RPCs for Fhenix confidential tokens
(contracts emitting ERC-7984 ConfidentialTransfer whose name() starts with
"Fhenix"), then indexes shields, unshield requests, claims and confidential
transfers. Writes data/leaks.json. Standard library only. No API keys.
"""
import json, os, sys, time, urllib.request, datetime, collections

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "data", "leaks.json")

# topic0 hashes (keccak256 of the signature)
CT = "0x67500e8d0ed826d2194f514dd0d8124f35648ab6e3fb5e6ed867134cffe661e9"   # ConfidentialTransfer(address,address,bytes32)
XFER = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef" # Transfer(address,address,uint256)
# Observed on Fhenix wrappers (signatures not published; meaning inferred from
# the tx pattern described in Fhenix docs: unshield emits CT(user,0,h) + this;
# claim emits this with the decrypted amount in data).
UNSHIELD = "0x5e4a739deb052871d39ea9aa5d20fea3897a302b54a1d1f423af763b0b257f6d"
CLAIM = "0x71c5a97e83f9bb605c7c5b142e774e5cf1b994d38189faa56224b7c58041db50"
ZERO = "0x" + "0" * 40

CHAINS = {
    "ethereum": {
        "id": 1, "explorer": "https://etherscan.io",
        "rpcs": ["https://rpc.flashbots.net", "https://eth.drpc.org", "https://ethereum-rpc.publicnode.com"],
        "start": 26150000, "step": 15000,
        "blockscout": "https://eth.blockscout.com/api",
    },
    "arbitrum": {
        "id": 42161, "explorer": "https://arbiscan.io",
        "rpcs": ["https://arb1.arbitrum.io/rpc", "https://arbitrum-one-rpc.publicnode.com"],
        "start": 512000000, "step": 30000,
    },
}

def rpc(chain, method, params, tries=6):
    err = None
    for i in range(tries):
        for url in CHAINS[chain]["rpcs"]:
            try:
                req = urllib.request.Request(url, json.dumps({"jsonrpc": "2.0", "id": 1, "method": method, "params": params}).encode(),
                                             {"content-type": "application/json", "user-agent": "Mozilla/5.0 shield-leak"})
                r = json.load(urllib.request.urlopen(req, timeout=90))
                if "error" in r:
                    err = r["error"]; continue
                if r.get("result") is None and method != "eth_call":
                    err = "null result (pruned node?)"; continue
                return r["result"]
            except Exception as e:
                err = e
        time.sleep(1 + i)
    raise RuntimeError(f"{chain} {method} failed: {err}")

def addr(t): return "0x" + t[-40:]
def dstr(h):
    try:
        b = bytes.fromhex(h[2:]); n = int.from_bytes(b[32:64], "big"); return b[64:64 + n].decode()
    except Exception: return ""
def call(chain, to, data):
    try: return rpc(chain, "eth_call", [{"to": to, "data": data}, "latest"], tries=2)
    except Exception: return None

def blockscout(chain, params, frm, to):
    """Blockscout etherscan-style getLogs; splits the range when it hits the 1000-row cap."""
    base = CHAINS[chain]["blockscout"]
    q = "&".join(f"{k}={v}" for k, v in params.items())
    url = f"{base}?module=logs&action=getLogs&fromBlock={frm}&toBlock={to}&{q}"
    for i in range(4):
        try:
            req = urllib.request.Request(url, headers={"user-agent": "Mozilla/5.0 shield-leak"})
            d = json.load(urllib.request.urlopen(req, timeout=120)); break
        except Exception as e:
            if i == 3: raise
            time.sleep(3 * (i + 1))
    res = d.get("result") or []
    if not isinstance(res, list): raise RuntimeError(f"blockscout: {d}")
    if len(res) >= 1000 and to > frm:
        mid = (frm + to) // 2
        return blockscout(chain, params, frm, mid) + blockscout(chain, params, mid + 1, to)
    for l in res:
        l["topics"] = [t for t in l["topics"] if t]
        if l.get("logIndex") in ("0x", "", None): l["logIndex"] = "0x0"
    return res

SEEDS = os.path.join(ROOT, "data", "seed_tokens.json")

def scan_blockscout(chain):
    """Ethereum path: public RPC getLogs without an address filter is unreliable,
    so discover emitters via Blockscout topic0 search plus seed addresses, then
    pull each token's full log history by address."""
    c = CHAINS[chain]
    head = int(rpc(chain, "eth_blockNumber", []), 16)
    cand = set()
    b = c["start"]
    while b <= head:
        e = min(b + c["step"] - 1, head)
        for l in blockscout(chain, {"topic0": CT}, b, e): cand.add(l["address"].lower())
        b = e + 1
    if os.path.exists(SEEDS):
        cand |= {a.lower() for a in json.load(open(SEEDS)).get(chain, [])}
    return head, cand

def token_logs(chain, a, head):
    return [l for l in blockscout(chain, {"address": a}, CHAINS[chain]["start"], head)
            if l["topics"] and l["topics"][0] in (CT, UNSHIELD, CLAIM)]

def scan(chain):
    c = CHAINS[chain]
    head = int(rpc(chain, "eth_blockNumber", []), 16)
    logs, b, step = [], c["start"], c["step"]
    while b <= head:
        e = min(b + step - 1, head)
        try:
            logs += rpc(chain, "eth_getLogs", [{"fromBlock": hex(b), "toBlock": hex(e), "topics": [[CT, UNSHIELD, CLAIM]]}], tries=2)
            b = e + 1
        except RuntimeError:
            if step <= 500: raise
            step //= 2
    return head, logs

def main():
    now = datetime.datetime.now(datetime.timezone.utc)
    out = {"generated_at": now.strftime("%Y-%m-%dT%H:%M:%SZ"), "chains": {}, "tokens": [], "events": [], "other_erc7984": []}
    for chain, c in CHAINS.items():
        if c.get("blockscout"):
            head, cand = scan_blockscout(chain); logs = []; emitters = sorted(cand)
        else:
            head, logs = scan(chain)
            emitters = sorted({l["address"].lower() for l in logs if l["topics"][0] == CT})
        meta = {}
        for a in emitters:
            name = dstr(call(chain, a, "0x06fdde03") or "0x")
            sym = dstr(call(chain, a, "0x95d89b41") or "0x")
            if not name.startswith("Fhenix"):
                n = sum(1 for l in logs if l["address"].lower() == a and l["topics"][0] == CT) if logs else None
                out["other_erc7984"].append({"chain": chain, "address": a, "name": name, "symbol": sym, "events": n}); continue
            u = call(chain, a, "0x6f307dc3")  # underlying()
            und = addr(u) if u and len(u) >= 66 and int(u, 16) else None
            udec = 18
            if und:
                d = call(chain, und, "0x313ce567"); udec = int(d, 16) if d and d != "0x" else 18
            if c.get("blockscout"): logs += token_logs(chain, a, head)
            meta[a] = {"chain": chain, "address": a, "name": name, "symbol": sym, "underlying": und,
                       "underlying_decimals": udec, "rate": 10 ** max(udec - 6, 0)}
        blocks = {}
        def ts(bn):
            if bn not in blocks: blocks[bn] = int(rpc(chain, "eth_getBlockByNumber", [hex(bn), False])["timestamp"], 16)
            return blocks[bn]
        for l in logs:
            a = l["address"].lower()
            if a not in meta: continue
            m, t = meta[a], l["topics"]; bn = int(l["blockNumber"], 16); tx = l["transactionHash"]
            ev = {"chain": chain, "token": a, "symbol": m["symbol"], "block": bn, "time": ts(bn), "tx": tx, "log": int(l["logIndex"], 16)}
            if t[0] == CT:
                fr, to = addr(t[1]), addr(t[2])
                if fr == ZERO:
                    amt = None
                    try:
                        if m["underlying"]:
                            rc = rpc(chain, "eth_getTransactionReceipt", [tx])
                            inn = sum(int(x["data"], 16) for x in rc["logs"] if x["address"].lower() == m["underlying"] and x["topics"][0] == XFER and len(x["topics"]) == 3 and addr(x["topics"][2]) == a)
                            outn = sum(int(x["data"], 16) for x in rc["logs"] if x["address"].lower() == m["underlying"] and x["topics"][0] == XFER and len(x["topics"]) == 3 and addr(x["topics"][1]) == a)
                            amt = (inn - outn) // m["rate"]
                        else:
                            txo = rpc(chain, "eth_getTransactionByHash", [tx]); amt = int(txo["value"], 16) // m["rate"]
                    except Exception: amt = None
                    ev.update(kind="shield", address=to, amount=amt)
                elif to == ZERO:
                    ev.update(kind="unshield", address=fr, handle=t[3])
                else:
                    ev.update(kind="transfer", address=fr, counterparty=to)
            elif t[0] == UNSHIELD:
                continue  # duplicate of the CT burn
            elif t[0] == CLAIM:
                ev.update(kind="claim", address=addr(t[1]), handle=t[3] if len(t) > 3 else None, amount=int(l["data"][:66], 16))
            out["events"].append(ev)
        out["chains"][chain] = {"chain_id": c["id"], "head_block": head, "head_time": ts(head), "scan_from_block": c["start"], "explorer": c["explorer"]}
        out["tokens"] += list(meta.values())
        print(chain, "head", head, "logs", len(logs), "fhenix tokens", len(meta), file=sys.stderr)
    out["events"].sort(key=lambda e: (e["time"], e["log"]))
    # per-token stats
    for tk in out["tokens"]:
        E = [e for e in out["events"] if e["token"] == tk["address"] and e["chain"] == tk["chain"]]
        sh = [e for e in E if e["kind"] == "shield"]; cl = [e for e in E if e["kind"] == "claim"]
        shield_amts = collections.Counter(e["amount"] for e in sh if e["amount"])
        linkable = sum(1 for e in cl if e["amount"] and shield_amts.get(e["amount"], 0) > 0 and len({s["address"] for s in sh if s["amount"] == e["amount"]}) <= 1)
        tk["stats"] = {
            "shields": len(sh), "unshields": sum(1 for e in E if e["kind"] == "unshield"), "claims": len(cl),
            "transfers": sum(1 for e in E if e["kind"] == "transfer"),
            "unique_shielders": len({e["address"] for e in sh}),
            "unique_addresses": len({e["address"] for e in E} | {e.get("counterparty") for e in E if e.get("counterparty")}),
            "total_shielded": sum(e["amount"] or 0 for e in sh), "total_claimed": sum(e["amount"] or 0 for e in cl),
            "claims_matching_single_shielder_amount": linkable,
            "first_event": E[0]["time"] if E else None, "last_event": E[-1]["time"] if E else None,
        }
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    json.dump(out, open(OUT, "w"), indent=1)
    print("wrote", OUT, len(out["events"]), "events", file=sys.stderr)

if __name__ == "__main__":
    main()
