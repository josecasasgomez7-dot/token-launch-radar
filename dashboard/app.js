// Token Radar's dashboard. It reads window.RADAR (written beside dashboard/ by main.ts)
// and renders the ranked board, filters, a live model sandbox, a per-protocol detail view
// with the model's own inputs and the protocol's farm plan. No network: every byte it
// shows is in data.js. The page re-implements the model's two derivations — implied
// value and farm plans — from the same inputs, so a reader can check board.json's
// numbers instead of taking them on trust.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var app = document.getElementById('board');
  var PUBLISHED = { base: DATA.model.base_multiple, power: DATA.model.growth_power, maturity: DATA.model.maturity_weight };
  var state = { q: '', category: 'all', chain: 'all', scope: 'all', tab: 'pre', sort: 'implied', dir: -1, selected: null, sandbox: { base: PUBLISHED.base, power: PUBLISHED.power, maturity: PUBLISHED.maturity } };

  var usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usd.format(n);
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }
  function clamp(n, lo, hi) { return Math.min(hi, Math.max(lo, n)); }

  // The model in one function, the same arithmetic lib/model.ts runs: TVL times a base
  // multiple, times the weekly growth rate compounded, times a saturating age curve.
  function impliedOf(row, p) {
    var growth = clamp(row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d, DATA.model.growth_floor, DATA.model.growth_cap);
    var growthMult = Math.pow(1 + growth / 100, p.power);
    var age = row.age_days === null || row.age_days === undefined ? DATA.model.unknown_age_days : row.age_days;
    var maturity = (1 - p.maturity) + p.maturity * (Math.max(0, age) / (Math.max(0, age) + DATA.model.maturity_half_life_days));
    return { value: Math.max(1, Math.round(row.tvl_usd * p.base * growthMult * maturity)), growthMult: growthMult, maturity: maturity, growthPct: growth };
  }
  function sandboxActive() {
    return state.sandbox.base !== PUBLISHED.base || state.sandbox.power !== PUBLISHED.power || state.sandbox.maturity !== PUBLISHED.maturity;
  }

  // The farm plan is the same derivation main.ts writes to board.json: category picks the
  // action, the first chain picks the gas and the bridge, TVL picks the capital, age picks
  // the hold. No name is special-cased.
  function chainOf(p) { return p.chains && p.chains.length > 0 ? p.chains[0] : 'its main chain'; }
  function chainCosts(chain) {
    switch (chain) {
      case 'Ethereum': return { gas: '$6-14', bridge: '15 minutes', token: 'ETH' };
      case 'Solana': return { gas: '$0.01-0.05', bridge: '2 minutes', token: 'SOL' };
      case 'Base': return { gas: '$0.10-0.40', bridge: '5 minutes', token: 'ETH' };
      case 'Arbitrum': return { gas: '$0.30-0.90', bridge: '10 minutes', token: 'ETH' };
      case 'Binance': return { gas: '$0.10-0.40', bridge: '5 minutes', token: 'BNB' };
      case 'Avalanche': return { gas: '$0.30-1.00', bridge: '5 minutes', token: 'AVAX' };
      case 'Optimism': return { gas: '$0.20-0.80', bridge: '10 minutes', token: 'ETH' };
      case 'Polygon': return { gas: '$0.05-0.25', bridge: '5 minutes', token: 'POL' };
      case 'Hyperliquid L1': return { gas: '$0.01-0.05', bridge: '2 minutes', token: 'HYPE' };
      case 'Tron': return { gas: '$1-3', bridge: '5 minutes', token: 'TRX' };
      case 'Bitcoin': return { gas: '$2-8', bridge: '30 minutes', token: 'BTC' };
      case 'Berachain': return { gas: '$0.10-0.50', bridge: '5 minutes', token: 'BERA' };
      case 'Unichain': return { gas: '$0.10-0.40', bridge: '5 minutes', token: 'ETH' };
      case 'Monad': return { gas: '$0.01-0.10', bridge: '2 minutes', token: 'MON' };
      case 'Plasma': return { gas: '$0.05-0.30', bridge: '5 minutes', token: 'XPL' };
      default: return { gas: '$0.50-2.00', bridge: '10 minutes', token: 'ETH' };
    }
  }
  function capitalFor(p) {
    if (p.tvl_usd >= 1e9) return 250;
    if (p.tvl_usd >= 1e8) return 150;
    if (p.tvl_usd >= 2e7) return 100;
    return 50;
  }
  function holdDaysFor(age) {
    if (age === null || age === undefined) return 45;
    if (age < 180) return 60;
    if (age < 365) return 45;
    return 30;
  }
  function actionsFor(p, capital, chain) {
    var c = (p.category || '').toLowerCase();
    var name = p.name;
    if (c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0 || c.indexOf('cedefi') >= 0) return { main: 'Deposit $' + capital + ' of USDC into a ' + name + ' vault on ' + chain + ' and keep the vault shares.', second: 'Allocate a second, smaller deposit into a different ' + name + ' vault on ' + chain + ', so the activity spans two of its products.' };
    if (c.indexOf('rwa') >= 0) return { main: 'Mint $' + capital + ' of the yield-bearing asset through ' + name + ' on ' + chain + ' and hold it.', second: 'Reinvest one distribution back into the same ' + name + ' asset instead of withdrawing it, so the position compounds.' };
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0) return { main: 'Supply $' + capital + ' of USDC to ' + name + ' on ' + chain + ' and keep the supply position open.', second: 'Borrow $20 against the supply and repay it within a week, so the position shows both sides of the market.' };
    if (c.indexOf('dex') >= 0) return { main: 'Provide $' + capital + ' of liquidity to ' + name + "'s main pool on " + chain + ' and keep the position open.', second: 'Swap $25 through ' + name + ' on ' + chain + ' once a week, routing through its own pool.' };
    if (c.indexOf('yield') >= 0 || c.indexOf('farm') >= 0 || c.indexOf('liquidity manager') >= 0) return { main: 'Deposit $' + capital + ' of USDC into ' + name + "'s highest-TVL strategy on " + chain + ' and keep the shares.', second: 'Move half the position into a second ' + name + ' strategy on ' + chain + ' after two weeks, so two strategies carry your wallet.' };
    if (c.indexOf('bridge') >= 0) return { main: 'Bridge $' + capital + ' of USDC to ' + chain + ' through ' + name + ' and use the bridged funds in its app.', second: 'Bridge $25 back through ' + name + ' after a week, so the route is used in both directions.' };
    if (c.indexOf('staking') >= 0 || c.indexOf('restak') >= 0 || c.indexOf('anchor btc') >= 0 || c.indexOf('decentralized btc') >= 0) return { main: "Stake $" + capital + " of the chain's staking asset through " + name + ' on ' + chain + ' and keep the receipt token.', second: 'Restake or redelegate $25 of the receipt through ' + name + ' once, to show a second staking action.' };
    if (c.indexOf('derivative') >= 0 || c.indexOf('basis trading') >= 0 || c.indexOf('interest rate') >= 0) return { main: 'Deposit $' + capital + ' of USDC as margin on ' + name + ' and open one small hedged position.', second: 'Close the hedge and open a fresh one the following week, keeping the margin on the protocol.' };
    if (c.indexOf('prediction') >= 0) return { main: 'Fund $' + capital + ' and place one market position on ' + name + ', backing the outcome you researched.', second: 'Place a second, smaller position on a different ' + name + ' market the next week.' };
    if (c.indexOf('stable') >= 0) return { main: 'Mint or deposit $' + capital + ' of the stable asset through ' + name + ' on ' + chain + '.', second: 'Swap $25 of the stable asset through ' + name + ' once, then hold the rest in the protocol.' };
    if (c.indexOf('insurance') >= 0) return { main: 'Buy $' + capital + ' of cover from ' + name + ' on ' + chain + ' and keep the policy active.', second: 'Renew or top up the cover once before it lapses, so the policy never gaps.' };
    if (c.indexOf('payment') >= 0) return { main: 'Top up $' + capital + ' through ' + name + ' on ' + chain + ' and pay one real bill or invoice with it.', second: 'Repeat one payment a week through ' + name + ' instead of a single top-up.' };
    if (c.indexOf('governance') >= 0) return { main: 'Deposit $' + capital + ' into ' + name + ' on ' + chain + ' and vote in its next governance round.', second: 'Vote again in the following round and keep the deposit in place.' };
    if (c === 'chain') return { main: 'Bridge $' + capital + ' of USDC to ' + name + " and use it in one of the chain's own apps.", second: 'Make one swap or deposit on ' + name + ' each week so the wallet stays active on the chain.' };
    if (c.indexOf('index') >= 0) return { main: 'Buy $' + capital + ' of the index through ' + name + ' on ' + chain + ' and hold it.', second: 'Add $25 to the index position once, rebalancing instead of withdrawing.' };
    if (c.indexOf('otc') >= 0) return { main: 'List or fill a $' + capital + ' order through ' + name + ' on ' + chain + '.', second: 'Settle a second, smaller order the following week.' };
    if (c.indexOf('card') >= 0) return { main: 'Order the card from ' + name + ', load $' + capital + ' onto it, and spend $25 on a real purchase.', second: 'Top up the card once a week and keep spending through it.' };
    return { main: 'Deposit $' + capital + ' of USDC into ' + name + ' on ' + chain + ' and keep the position open.', second: 'Make a second deposit of $25 two weeks later, so the activity spans more than one snapshot.' };
  }
  function stepText(step) {
    var s = step.text + ' Cost: ' + step.cost + '. Time: ' + step.time + '.';
    if (s.length > 600) s = s.slice(0, 596) + '...';
    if (s.length < 20) s = s + " Hold the position and check the protocol's own page.";
    return s;
  }
  function farmSteps(p) {
    var chain = chainOf(p);
    var cc = chainCosts(chain);
    var capital = capitalFor(p);
    var hold = holdDaysFor(p.age_days);
    var a = actionsFor(p, capital, chain);
    return [
      { text: 'Open a fresh wallet that holds only the funds you plan to farm, and write its seed phrase on paper, never in a screenshot or a chat.', cost: 'nothing to set up', time: '5 minutes' },
      { text: 'Bridge $' + capital + ' of USDC from your main wallet to ' + chain + ' and keep $5 of ' + cc.token + ' in the wallet for fees.', cost: cc.gas + ' of gas', time: cc.bridge },
      { text: a.main, cost: '$' + capital + ' of capital and about ' + cc.gas + ' of gas', time: '15 minutes to set up' },
      { text: a.second, cost: '$25 of capital and about ' + cc.gas + ' of gas', time: '10 minutes' },
      { text: 'Repeat one qualifying action each week, a deposit, a swap, a vote or a borrow, so the wallet shows steady activity.', cost: 'about ' + cc.gas + ' of gas a week', time: '10 minutes a week' },
      { text: 'Hold the position for at least ' + hold + ' days so the activity is counted in more than one snapshot.', cost: 'the $' + capital + ' stays in the position', time: hold + ' days' },
      { text: "Before you withdraw, open the protocol's own points or rewards page from its official site and claim only from the link it publishes.", cost: 'no fee to check, and never pay to claim', time: '10 minutes' },
      { text: 'Write the wallet, the dates and every transaction hash in a farm log, and unwind by withdrawing in two parts so a failed exit cannot trap the full position.', cost: 'about ' + cc.gas + ' of gas to exit', time: '10 minutes to unwind' }
    ].map(stepText);
  }

  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
        else if (k === 'html') node.innerHTML = attrs[k];
        else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
        else if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined) continue;
      if (Array.isArray(child)) child.forEach(function (c) { if (c) node.appendChild(c); });
      else if (typeof child === 'string') node.appendChild(document.createTextNode(child));
      else node.appendChild(child);
    }
    return node;
  }

  function readHash() {
    var hash = window.location.hash.replace(/^#/, '');
    if (!hash) return;
    var params = new URLSearchParams(hash);
    if (params.get('q')) state.q = params.get('q');
    if (params.get('category')) state.category = params.get('category');
    if (params.get('chain')) state.chain = params.get('chain');
    if (params.get('scope')) state.scope = params.get('scope');
    if (params.get('p')) state.selected = params.get('p');
  }
  function writeHash() {
    var params = new URLSearchParams();
    if (state.q) params.set('q', state.q);
    if (state.category !== 'all') params.set('category', state.category);
    if (state.chain !== 'all') params.set('chain', state.chain);
    if (state.scope !== 'all') params.set('scope', state.scope);
    if (state.selected) params.set('p', state.selected);
    var next = params.toString();
    if (next) window.history.replaceState(null, '', '#' + next);
    else window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }

  function filteredRows() {
    var q = state.q.trim().toLowerCase();
    return DATA.rows.filter(function (r) {
      if (state.category !== 'all' && (r.category || 'Other') !== state.category) return false;
      if (state.chain !== 'all' && (!r.chains || r.chains.indexOf(state.chain) < 0)) return false;
      if (state.scope === 'watchlist' && !r.watchlist) return false;
      if (state.scope === 'early' && r.watchlist) return false;
      if (!q) return true;
      var hay = [r.name, r.slug, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  }
  function sortedRows(list) {
    var key = state.sort;
    var sb = state.sandbox;
    return list.slice().sort(function (a, b) {
      var av, bv;
      if (key === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
      else if (key === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
      else if (key === 'growth') { av = a.change_7d === null ? -Infinity : a.change_7d; bv = b.change_7d === null ? -Infinity : b.change_7d; }
      else if (key === 'age') { av = a.age_days === null ? Infinity : a.age_days; bv = b.age_days === null ? Infinity : b.age_days; }
      else { av = impliedOf(a, sb).value; bv = impliedOf(b, sb).value; }
      if (av < bv) return -state.dir;
      if (av > bv) return state.dir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }

  function header() {
    return el('header', { class: 'top' },
      el('div', { class: 'brand' }, el('span', { class: 'mark' }), el('span', { class: 'brand-name', text: 'Token Radar' })),
      el('div', { class: 'top-meta' },
        el('span', { text: 'Snapshot ' + DATA.as_of }),
        el('span', { text: 'DefiLlama protocol index' }),
        el('span', { text: DATA.model_version + ' model' })
      )
    );
  }

  function lede() {
    var top = DATA.rows[0];
    return el('section', { class: 'lede' },
      el('div', null,
        el('h1', { text: DATA.watchlist_size + ' watchlist protocols, ranked by implied value' }),
        el('p', null, 'The watchlist is the floor: every protocol with at least $', el('b', { text: Math.round(DATA.floor_usd / 1e6) + 'M' }), ' of TVL and no token on record. The early radar adds ', el('b', { text: String(DATA.early_size) }), ' pre-token protocols below that floor — every one the watchlist rule would keep, no wrapped or staked product of a token that already trades. Implied value is a model, not a promise.')
      ),
      el('div', { class: 'facts' },
        el('div', { class: 'fact' }, el('span', { text: 'Watchlist covered' }), el('b', { text: DATA.watchlist_size + ' / ' + DATA.watchlist_size })),
        el('div', { class: 'fact' }, el('span', { text: 'Pre-token rows scored' }), el('b', { text: String(DATA.board_size) })),
        el('div', { class: 'fact' }, el('span', { text: 'Top implied value' }), el('b', { text: top ? fmtUsd(top.implied_value_usd) : 'n/a' })),
        el('div', { class: 'fact' }, el('span', { text: 'Live-token protocols set aside' }), el('b', { text: String(DATA.live_size) }))
      )
    );
  }

  function categoryBars() {
    var sums = {};
    DATA.rows.forEach(function (r) {
      var c = r.category || 'Other';
      sums[c] = (sums[c] || 0) + r.implied_value_usd;
    });
    var top = Object.keys(sums).map(function (c) { return { c: c, v: sums[c] }; })
      .sort(function (a, b) { return b.v - a.v; }).slice(0, 6);
    var max = top.length ? top[0].v : 1;
    return el('div', { class: 'bars' }, top.map(function (t) {
      return el('div', { class: 'bar-card' },
        el('span', { class: 'cat', text: t.c }),
        el('span', { class: 'val', text: fmtUsd(t.v) }),
        el('div', { class: 'bar-track' }, el('i', { style: 'width:' + Math.max(4, Math.round((t.v / max) * 100)) + '%' }))
      );
    }));
  }

  function controls() {
    var categories = Array.from(new Set(DATA.rows.map(function (r) { return r.category || 'Other'; }))).sort();
    var chains = Array.from(new Set(DATA.rows.reduce(function (acc, r) { return acc.concat(r.chains || []); }, []))).sort();
    var search = el('input', { type: 'search', id: 'q', placeholder: 'Search name, category or chain', value: state.q, 'aria-label': 'Search the board' });
    search.addEventListener('input', function () { state.q = search.value; writeHash(); render(); });
    var catSel = el('select', { id: 'category', 'aria-label': 'Filter by category' },
      el('option', { value: 'all', text: 'All categories' }),
      categories.map(function (c) { return el('option', { value: c, text: c, selected: c === state.category ? 'selected' : null }); })
    );
    catSel.addEventListener('change', function () { state.category = catSel.value; writeHash(); render(); });
    var chainSel = el('select', { id: 'chain', 'aria-label': 'Filter by chain' },
      el('option', { value: 'all', text: 'All chains' }),
      chains.map(function (c) { return el('option', { value: c, text: c, selected: c === state.chain ? 'selected' : null }); })
    );
    chainSel.addEventListener('change', function () { state.chain = chainSel.value; writeHash(); render(); });
    var scopeSel = el('select', { id: 'scope', 'aria-label': 'Filter by watchlist' },
      el('option', { value: 'all', text: 'Watchlist + early' }),
      el('option', { value: 'watchlist', text: 'Watchlist only', selected: state.scope === 'watchlist' ? 'selected' : null }),
      el('option', { value: 'early', text: 'Early only', selected: state.scope === 'early' ? 'selected' : null })
    );
    scopeSel.addEventListener('change', function () { state.scope = scopeSel.value; writeHash(); render(); });
    var pre = el('button', { type: 'button', 'aria-pressed': state.tab === 'pre' ? 'true' : 'false', text: 'Pre-token', onclick: function () { state.tab = 'pre'; render(); } });
    var live = el('button', { type: 'button', 'aria-pressed': state.tab === 'live' ? 'true' : 'false', text: 'Live token', onclick: function () { state.tab = 'live'; render(); } });
    return el('div', { class: 'controls' },
      el('div', { class: 'field' }, el('label', { for: 'q', text: 'Search' }), search),
      el('div', { class: 'field' }, el('label', { for: 'category', text: 'Category' }), catSel),
      el('div', { class: 'field' }, el('label', { for: 'chain', text: 'Chain' }), chainSel),
      el('div', { class: 'field' }, el('label', { for: 'scope', text: 'Board' }), scopeSel),
      el('div', { class: 'field' }, el('span', { class: 'sub', text: 'Token status' }), el('div', { class: 'tabs' }, pre, live)),
      el('span', { class: 'count', text: state.tab === 'pre' ? filteredRows().length + ' rows shown' : DATA.live.length + ' live-token protocols' })
    );
  }

  function sortHeader(key, label) {
    return el('th', { scope: 'col' },
      el('button', { type: 'button', onclick: function () { if (state.sort === key) state.dir = -state.dir; else { state.sort = key; state.dir = -1; } render(); } },
        label,
        state.sort === key ? el('span', { 'aria-hidden': 'true', text: state.dir < 0 ? ' v' : ' ^' }) : null
      )
    );
  }

  function boardTable() {
    var list = sortedRows(filteredRows());
    if (list.length === 0) {
      return el('div', { class: 'panel' }, el('div', { class: 'empty' },
        el('h2', { text: 'No protocol matches that filter' }),
        el('p', { text: 'Clear the search or pick another category to see the board again.' }),
        el('button', { class: 'button', type: 'button', text: 'Clear filters', onclick: function () { state.q = ''; state.category = 'all'; state.chain = 'all'; state.scope = 'all'; writeHash(); render(); } })
      ));
    }
    var max = 1;
    list.forEach(function (r) { var v = impliedOf(r, state.sandbox).value; if (v > max) max = v; });
    var tbody = el('tbody');
    list.forEach(function (r) {
      var growth = r.change_7d === null ? 'n/a' : fmtPct(r.change_7d);
      var growthClass = r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg';
      var val = impliedOf(r, state.sandbox).value;
      var tr = el('tr', {
        'data-selected': state.selected === r.slug ? 'true' : 'false',
        tabindex: '0',
        onclick: function () { openDetail(r.slug); },
        onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } }
      },
        el('td', { class: 'num', text: String(r.rank) }),
        el('td', null, el('div', { class: 'name' },
          el('b', { text: r.name }),
          el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') })
        )),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + growthClass, text: growth }),
        el('td', { class: 'num', text: fmtAge(r.age_days) }),
        el('td', null, el('div', { class: 'implied' },
          el('div', { class: 'vbar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(3, Math.round((val / max) * 100)) + '%' })),
          el('span', { class: 'num', text: fmtUsd(val) })
        )),
        el('td', null, el('span', { class: 'badge' + (r.watchlist ? ' watch' : ''), text: r.watchlist ? 'watchlist' : 'early' }))
      );
      tbody.appendChild(tr);
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Pre-token protocols, strongest implied value first. Select a row for its model and farm plan.' }),
          el('thead', null, el('tr', null,
            sortHeader('implied', 'Rank'),
            sortHeader('name', 'Protocol'),
            sortHeader('tvl', 'TVL'),
            sortHeader('growth', '7d'),
            sortHeader('age', 'Age'),
            sortHeader('implied', 'Implied value'),
            el('th', { scope: 'col', text: 'Board' })
          )),
          tbody
        )
      )
    );
  }

  function liveTable() {
    var tbody = el('tbody');
    DATA.live.forEach(function (r) {
      tbody.appendChild(el('tr', null,
        el('td', { class: 'num', text: 'live' }),
        el('td', null, el('div', { class: 'name' }, el('b', { text: r.name }), el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') }))),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + (r.change_7d !== null && r.change_7d >= 0 ? 'pos' : 'neg'), text: fmtPct(r.change_7d) }),
        el('td', { class: 'num', text: fmtUsd(r.mcap_usd) }),
        el('td', null, el('span', { class: 'badge live', text: 'already trades' }))
      ));
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Token live: these protocols already trade, so their market cap is a fact, not a model. They are set aside from the pre-token ranking.' }),
          el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Status' }), el('th', { scope: 'col', text: 'Protocol' }), el('th', { scope: 'col', text: 'TVL' }), el('th', { scope: 'col', text: '7d' }), el('th', { scope: 'col', text: 'Market cap' }), el('th', { scope: 'col', text: 'Token' }))),
          tbody
        )
      )
    );
  }

  function modelPanel() {
    var m = DATA.model;
    return el('section', { class: 'panel model' },
      el('h2', { text: 'How implied value is computed' }),
      el('p', { class: 'sub', text: 'One function scores every row, from the snapshot figures alone. No protocol name is special-cased, and no row is hand-picked.' }),
      el('div', { class: 'formula' },
        'implied = round( tvl_usd x ' + m.base_multiple + ' x (1 + clamp(change_7d, ' + m.growth_floor + ', ' + m.growth_cap + ') / 100) ^ ' + m.growth_power + ' x (' + (1 - m.maturity_weight).toFixed(2) + ' + ' + m.maturity_weight + ' x age_days / (age_days + ' + m.maturity_half_life_days + ')) )'
      ),
      el('p', { class: 'sub', text: 'TVL and seven-day growth come from the snapshot. Age is the time since the protocol was first listed — the best record of how long it has run with no token; an unlisted age uses ' + m.unknown_age_days + ' days. Growth is compounded for ' + m.growth_power + ' weeks at the observed weekly rate, so a protocol growing 10% a week is worth far more than one shrinking 10% a week. The early radar is every pre-token protocol the watchlist rule would keep, and the live-token protocols are set aside with their market caps shown.' })
    );
  }

  function sandboxPanel() {
    var sb = state.sandbox;
    function slider(id, label, value, min, max, step, fmt, oninput) {
      var input = el('input', { type: 'range', id: id, min: String(min), max: String(max), step: String(step), value: String(value), 'aria-label': label });
      input.addEventListener('input', function () { oninput(parseFloat(input.value)); render(); });
      return el('div', { class: 'slider' }, el('label', { for: id }, el('span', { text: label }), el('b', { text: fmt(value) })), input);
    }
    var panel = el('section', { class: 'panel sandbox' },
      el('h2', { text: 'Model sandbox — try the model yourself' }),
      el('div', { class: 'sliders' },
        slider('sb-base', 'Base multiple (FDV per $ of TVL)', sb.base, 0.1, 0.5, 0.01, function (v) { return v.toFixed(2) + 'x'; }, function (v) { state.sandbox.base = v; }),
        slider('sb-power', 'Growth power (weeks compounded)', sb.power, 1, 4, 0.5, function (v) { return v.toFixed(1) + ' wk'; }, function (v) { state.sandbox.power = v; }),
        slider('sb-mat', 'Maturity weight (how much age moves value)', sb.maturity, 0, 1, 0.05, function (v) { return Math.round(v * 100) + '%'; }, function (v) { state.sandbox.maturity = v; })
      ),
      el('p', { class: 'sandbox-note', text: sandboxActive() ? 'Sandbox active: the board above shows your recomputed values and re-sorts. board.json keeps the published radar-2 model, so the entry stays reproducible.' : 'Move a slider to recompute every row live. The published model is base 0.30x, growth power 3, maturity weight 55%.' }),
      sandboxActive() ? el('button', { class: 'button', type: 'button', text: 'Reset to the published model', onclick: function () { state.sandbox = { base: PUBLISHED.base, power: PUBLISHED.power, maturity: PUBLISHED.maturity }; render(); } }) : null
    );
    return panel;
  }

  var dialog = el('dialog', { class: 'detail', id: 'detail', 'aria-labelledby': 'detail-title' });
  dialog.addEventListener('close', function () { state.selected = null; writeHash(); });

  function openDetail(slug) {
    var row = DATA.rows.filter(function (r) { return r.slug === slug; })[0];
    if (!row) return;
    state.selected = slug;
    writeHash();
    dialog.textContent = '';
    var calc = impliedOf(row, PUBLISHED);
    var steps = farmSteps(row);
    dialog.appendChild(el('div', { class: 'detail-head' },
      el('div', null,
        el('span', { class: 'brand-name', text: 'Rank ' + row.rank + ' of ' + DATA.board_size + ' · ' + (row.watchlist ? 'watchlist' : 'early radar') }),
        el('h2', { id: 'detail-title', text: row.name }),
        el('p', { class: 'sub', text: (row.category || 'Other') + ' on ' + (row.chains && row.chains.length ? row.chains.join(', ') : 'an unnamed chain') })
      ),
      el('button', { class: 'close', type: 'button', 'aria-label': 'Close details', text: 'Close', onclick: function () { dialog.close(); } })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Implied value' }),
      el('div', { class: 'equation' },
        el('div', null, el('span', { text: 'TVL' }), el('b', { class: 'num', text: fmtUsd(row.tvl_usd) })),
        el('div', null, el('span', { text: 'Seven-day growth' }), el('b', { class: 'num', text: fmtPct(row.change_7d) })),
        el('div', null, el('span', { text: 'Age with no token' }), el('b', { class: 'num', text: fmtAge(row.age_days) })),
        el('div', null, el('span', { text: 'Growth multiplier' }), el('b', { class: 'num', text: String(calc.growthMult.toFixed(4)) })),
        el('div', null, el('span', { text: 'Maturity multiplier' }), el('b', { class: 'num', text: String(calc.maturity.toFixed(4)) })),
        el('div', null, el('span', { text: 'Implied value' }), el('b', { class: 'num', text: fmtUsd(row.implied_value_usd) }))
      ),
      el('p', { class: 'sub', text: 'Model ' + DATA.model_version + ': the same function scores every protocol. The page recomputes this row as ' + fmtUsd(calc.value) + (calc.value === row.implied_value_usd ? ', the same number board.json carries.' : ', which differs from the board: the data would be stale.') + ' This is an estimate, not a price, and the protocol records no token — that is what its DefiLlama record says, not proof it has none.' })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Farm plan' }),
      el('ol', { class: 'steps' }, steps.map(function (s) {
        var at = s.indexOf(' Cost: ');
        var action = at >= 0 ? s.slice(0, at) : s;
        var tail = at >= 0 ? s.slice(at + 1) : '';
        return el('li', null, el('b', { text: action }), el('span', { class: 'cost', text: tail }));
      }))
    ));
    if (typeof dialog.showModal === 'function') {
      if (!dialog.open) dialog.showModal();
    } else {
      dialog.setAttribute('open', '');
    }
  }

  function render() {
    app.textContent = '';
    var shell = el('div', { class: 'shell' });
    shell.appendChild(header());
    shell.appendChild(lede());
    shell.appendChild(categoryBars());
    shell.appendChild(controls());
    shell.appendChild(state.tab === 'pre' ? boardTable() : liveTable());
    if (state.tab === 'pre') {
      shell.appendChild(sandboxPanel());
      shell.appendChild(modelPanel());
    }
    app.appendChild(shell);
    app.setAttribute('aria-busy', 'false');
    if (!dialog.isConnected) app.appendChild(dialog);
    if (state.selected) openDetail(state.selected);
  }

  readHash();
  render();
  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && dialog.open) dialog.close();
  });
})();
