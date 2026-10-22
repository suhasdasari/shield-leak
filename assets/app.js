(async function () {
  const $ = (id) => document.getElementById(id);
  const D = await fetch('data/leaks.json', { cache: 'no-store' }).then(r => r.json());
  const EXP = { ethereum: 'https://etherscan.io', arbitrum: 'https://arbiscan.io' };
  const CH = { ethereum: 'Ethereum', arbitrum: 'Arbitrum' };
  const fmtAmt = (u) => u == null ? 'unknown' : (u / 1e6).toLocaleString(undefined, { maximumFractionDigits: 6 });
  const fmtT = (t) => new Date(t * 1000).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  const short = (a) => a.slice(0, 6) + '…' + a.slice(-4);
  const aLink = (c, a) => `<a class="mono" href="${EXP[c]}/address/${a}" target="_blank" rel="noopener">${short(a)}</a>`;
  const tLink = (c, t) => `<a class="mono" href="${EXP[c]}/tx/${t}" target="_blank" rel="noopener">${short(t)}</a>`;
  const esc = (s) => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const tkey = (e) => e.chain + ':' + e.token;
  const E = D.events;

  // ---- link analysis ----
  const shieldsBy = {};
  E.filter(e => e.kind === 'shield').forEach(e => (shieldsBy[tkey(e)] ||= []).push(e));
  const links = [];
  E.filter(e => e.kind === 'claim' && e.amount).forEach(c => {
    const prior = (shieldsBy[tkey(c)] || []).filter(s => s.amount === c.amount && s.time <= c.time);
    const self = (shieldsBy[tkey(c)] || []).some(s => s.address === c.address && s.time <= c.time);
    const shielders = [...new Set(prior.map(s => s.address))];
    links.push({ c, prior, shielders, self, unique: shielders.length === 1 });
  });
  const linked = links.filter(l => l.prior.length);
  const uniq = links.filter(l => l.unique);
  const selfRT = links.filter(l => l.self);

  // ---- headline ----
  const addrs = new Set(); E.forEach(e => { addrs.add(e.address); if (e.counterparty) addrs.add(e.counterparty); });
  const cnt = (k) => E.filter(e => e.kind === k).length;
  const gen = new Date(D.generated_at);
  $('headline').innerHTML = [
    [addrs.size, 'distinct addresses ever touching a Fhenix confidential token (both chains)'],
    [cnt('shield') + ' / ' + cnt('claim'), 'public shields / public payouts indexed'],
    [links.length ? Math.round(100 * linked.length / links.length) + '%' : 'n/a', `of payouts (${linked.length} of ${links.length}) exactly match an earlier shield amount on the same token`],
    [cnt('transfer'), 'confidential transfers (amount hidden, both parties visible)'],
  ].map(([b, s]) => `<div class="stat"><b>${b}</b><span>${s}</span></div>`).join('');

  $('notice').innerHTML = `<b>Launch-week data, thin volume.</b> Fhenix mainnet went live on 21 Oct 2026 with a permissioned allowlist. This snapshot holds <b>${E.length}</b> on-chain events across <b>${D.tokens.length}</b> token contracts, so every number here is small and will move quickly. Snapshot: ${fmtT(Date.parse(D.generated_at) / 1000)} (your local time) · Ethereum block ${D.chains.ethereum.head_block.toLocaleString()} · Arbitrum block ${D.chains.arbitrum.head_block.toLocaleString()}.`;

  // ---- token board ----
  const toks = [...D.tokens].sort((a, b) => (b.stats.shields + b.stats.claims) - (a.stats.shields + a.stats.claims));
  $('board').innerHTML = `<tr><th>Token</th><th>Chain</th><th>Contract</th><th class="n">Crowd</th><th class="n">Shields</th><th class="n">Unshields</th><th class="n">Claims</th><th class="n">Conf. transfers</th><th class="n">Shielded</th><th class="n">Claimed</th><th class="n">Claims matching a shield</th><th>Last activity</th></tr>` +
    toks.map(t => {
      const s = t.stats, L = links.filter(l => l.c.chain === t.chain && l.c.token === t.address);
      const m = L.filter(l => l.prior.length).length;
      return `<tr><td>${esc(t.symbol)}</td><td>${CH[t.chain]}</td><td>${aLink(t.chain, t.address)}</td><td class="n">${s.unique_shielders}</td><td class="n">${s.shields}</td><td class="n">${s.unshields}</td><td class="n">${s.claims}</td><td class="n">${s.transfers}</td><td class="n">${fmtAmt(s.total_shielded)}</td><td class="n">${fmtAmt(s.total_claimed)}</td><td class="n">${L.length ? m + ' / ' + L.length : '–'}</td><td>${s.last_event ? fmtT(s.last_event) : 'no activity'}</td></tr>`;
    }).join('');

  // ---- link finder ----
  const sym = (e) => e.symbol + ' (' + CH[e.chain] + ')';
  $('links').innerHTML = linked.length ? `<p>${uniq.length} unique-amount matches · ${selfRT.length} payouts to an address that had itself shielded on that token earlier.</p><div class="scroll"><table><tr><th>Token</th><th>Claim tx</th><th>Claimed to</th><th class="n">Amount</th><th>Earlier shield(s) of that exact amount</th><th>Flag</th></tr>` +
    linked.map(l => `<tr><td>${sym(l.c)}</td><td>${tLink(l.c.chain, l.c.tx)}</td><td>${aLink(l.c.chain, l.c.address)}</td><td class="n">${fmtAmt(l.c.amount)}</td><td>${l.prior.map(s => tLink(s.chain, s.tx) + ' by ' + aLink(s.chain, s.address)).join('<br>')}</td><td>${l.unique ? '<span class="flag">unique amount</span>' : l.shielders.length + ' shielders'}${l.self ? ' · same address' : ''}</td></tr>`).join('') + '</table></div>'
    : '<p class="muted">No payout yet matches an earlier shield amount.</p>';

  // ---- exit planner ----
  $('exit').innerHTML = toks.filter(t => t.stats.shields).map(t => {
    const amts = {}; (shieldsBy[t.chain + ':' + t.address] || []).forEach(s => { if (s.amount) (amts[s.amount] ||= new Set()).add(s.address); });
    const rows = Object.entries(amts).sort((a, b) => b[1].size - a[1].size).slice(0, 5);
    return `<div class="box"><b>${sym({ symbol: t.symbol, chain: t.chain })}</b> <span class="muted mono small">${short(t.address)}</span> · crowd ${t.stats.unique_shielders}: ` +
      rows.map(([a, s]) => `${fmtAmt(+a)} <span class="muted">(${s.size} addr)</span>`).join(', ') + '</div>';
  }).join('');

  // ---- method ----
  const other = D.other_erc7984 || [];
  $('method').innerHTML = `<ul>
<li>Indexed with public RPCs (Arbitrum: arb1.arbitrum.io; Ethereum: Blockscout API plus public RPC) from Ethereum block ${D.chains.ethereum.scan_from_block.toLocaleString()} and Arbitrum block ${D.chains.arbitrum.scan_from_block.toLocaleString()} to the snapshot heads above. Refreshed by a GitHub Action.</li>
<li>Shield = <code>ConfidentialTransfer</code> from the zero address; amount read from the underlying token's <code>Transfer</code> into the wrapper in the same tx (ETH wrappers: tx value), floored to 6-decimal precision.</li>
<li>Unshield = <code>ConfidentialTransfer</code> to the zero address. Payout = the wrapper's payout event, which carries the decrypted amount. Its event signature is not published; meaning is inferred from the tx pattern in Fhenix docs.</li>
<li><b>Gaps:</b> no USD pricing (amounts are token units); dual-mode ERC20Confidential tokens (e.g. fUSD, FIX) were not found on mainnet in this window, only FHERC20-style wrappers; contracts that never emitted <code>ConfidentialTransfer</code> are missed; the address check covers only this snapshot, not live chain state; pending unshield payouts and encrypted balances cannot be read; ${other.length} other ERC-7984 confidential token contracts (mostly Zama-style "Confidential …" wrappers) were seen and excluded.</li>
<li>Bounds shown for an address are "shielded in minus paid out" from public events. Confidential transfers in or out change the real balance by hidden amounts, so the bound is flagged as loose whenever they exist.</li></ul>`;

  // ---- checker ----
  function check(q) {
    q = q.trim().toLowerCase();
    const out = $('result');
    if (/^0x[0-9a-f]{64}$/.test(q)) {
      const ev = E.filter(e => e.tx === q);
      if (!ev.length) { out.innerHTML = '<div class="box">This transaction is not a Fhenix confidential-token event in the current snapshot.</div>'; return; }
      out.innerHTML = '<div class="box">' + ev.map(e => describe(e)).join('<br>') + '</div>';
      return;
    }
    if (!/^0x[0-9a-f]{40}$/.test(q)) { out.innerHTML = '<div class="box">Paste a 0x address (40 hex chars) or tx hash (64 hex chars).</div>'; return; }
    const ev = E.filter(e => e.address === q || e.counterparty === q);
    if (!ev.length) { out.innerHTML = '<div class="box">No Fhenix confidential-token activity for this address in the current snapshot.</div>'; return; }
    const by = {};
    ev.forEach(e => (by[tkey(e)] ||= []).push(e));
    out.innerHTML = Object.values(by).map(list => {
      const t = list[0];
      const sIn = list.filter(e => e.kind === 'shield' && e.address === q).reduce((a, e) => a + (e.amount || 0), 0);
      const cOut = list.filter(e => e.kind === 'claim' && e.address === q).reduce((a, e) => a + (e.amount || 0), 0);
      const tIn = list.filter(e => e.kind === 'transfer' && e.counterparty === q).length;
      const tOut = list.filter(e => e.kind === 'transfer' && e.address === q).length;
      const pend = list.filter(e => e.kind === 'unshield' && e.address === q).length - list.filter(e => e.kind === 'claim' && e.address === q).length;
      const myLinks = links.filter(l => l.c.address === q && tkey(l.c) === tkey(t) && l.prior.length);
      const counter = [...new Set(list.filter(e => e.kind === 'transfer').map(e => e.address === q ? e.counterparty : e.address))];
      return `<div class="box"><b>${sym(t)}</b> ${aLink(t.chain, t.token)}
<p>An observer can see: <b>${fmtAmt(sIn)}</b> shielded in, <b>${fmtAmt(cOut)}</b> paid out, so the public estimate of the remaining encrypted balance is <b>${fmtAmt(sIn - cOut)}</b>${tIn + tOut ? ` <span class="flag">(loose: ${tIn} confidential transfer(s) in, ${tOut} out with hidden amounts)</span>` : ' (no confidential transfers, so this estimate is exact unless a claim is pending)'}.${pend > 0 ? ` ${pend} unshield(s) not yet claimed.` : ''}</p>
${counter.length ? `<p>Visible counterparties: ${counter.map(c => aLink(t.chain, c)).join(', ')}</p>` : ''}
${myLinks.length ? `<p class="flag">${myLinks.length} payout(s) to this address exactly match an earlier shield amount on this token${myLinks.some(l => l.unique) ? ', at least one from a single shielder' : ''}.</p>` : ''}
<table><tr><th>Time</th><th>Event</th><th class="n">Amount</th><th>Tx</th></tr>${list.map(e => `<tr><td>${fmtT(e.time)}</td><td class="k-${e.kind}">${label(e, q)}</td><td class="n">${e.kind === 'shield' || e.kind === 'claim' ? fmtAmt(e.amount) : (e.kind === 'unshield' ? 'revealed at claim' : 'hidden')}</td><td>${tLink(e.chain, e.tx)}</td></tr>`).join('')}</table></div>`;
    }).join('');
  }
  function label(e, q) {
    if (e.kind === 'transfer') return e.address === q ? 'sent to ' + short(e.counterparty) : 'received from ' + short(e.address);
    return e.kind;
  }
  function describe(e) {
    const base = `${sym(e)} · ${fmtT(e.time)} · `;
    if (e.kind === 'shield') return base + `shield by ${aLink(e.chain, e.address)}, public amount ${fmtAmt(e.amount)}`;
    if (e.kind === 'claim') return base + `payout to ${aLink(e.chain, e.address)}, public amount ${fmtAmt(e.amount)}`;
    if (e.kind === 'unshield') return base + `unshield request by ${aLink(e.chain, e.address)}; amount revealed when paid out`;
    return base + `confidential transfer ${aLink(e.chain, e.address)} → ${aLink(e.chain, e.counterparty)}; amount hidden, parties and time public`;
  }
  $('check').addEventListener('submit', (ev) => { ev.preventDefault(); check($('q').value); history.replaceState(null, '', '#' + $('q').value.trim()); });
  if (location.hash.length > 3) { $('q').value = location.hash.slice(1); check($('q').value); }
})();
