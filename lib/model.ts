// Token Launch Radar — the value model, the board builder and the farm plans.
//
// The board ranks pre-token protocols by an implied value that follows only from the
// snapshot's own figures: the protocol's TVL, its seven-day growth, and how long it has
// run with no token on record. No protocol name is ever special-cased: one function
// scores every row, and the same function is re-implemented in the dashboard so the page
// can recompute any row in front of the reader.
//
// The model, "radar-2":
//
//   growth    = clamp(change_7d, -50, +60) per cent; unreported growth counts as 0
//   growthMult = (1 + growth / 100) ^ GROWTH_POWER
//                Three more weeks at the observed weekly rate: a protocol growing
//                +10% a week is worth much more than one shrinking -10% a week, and
//                the power makes that gap visible instead of rounding it away.
//   maturity  = (1 - MATURITY_WEIGHT) + MATURITY_WEIGHT * age / (age + 365)
//                A saturating curve in days since first listing: a protocol that has
//                run two years with no token is a much more seasoned launch candidate
//                than one listed six weeks ago, but the curve flattens, so age alone
//                can never outrank size. Age unknown counts as 365 days.
//   implied   = max(1, round(tvl_usd * BASE_MULTIPLE * growthMult * maturity))
//                BASE_MULTIPLE is the fully-diluted-value-per-TVL multiple the board
//                claims: thirty cents of implied token value per dollar locked.
//
// The board covers the whole watchlist (the floor, never the ceiling) plus every other
// pre-token protocol the house's own watchlist rule would keep: no wrapped, staked or
// bridged product of a token that already trades, no exchange product, no versioned
// pool, no CEX. Protocols whose token already trades are set aside in the Live view
// with their market caps, never mixed into the ranking.
//
// Farm plans are derived from the protocol's own record too: its category picks the
// action, its first chain picks the gas and the bridge, its TVL picks the capital, its
// age picks the hold. Every step states what it costs and how long it takes.

/** One protocol as the sealed snapshot records it: exactly its ten fields. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole sealed snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's constants, stated in the dashboard and adjustable in its sandbox. */
export interface ModelConstants {
  /** Fully-diluted value per dollar of TVL. */
  base_multiple: number;
  /** How many more weeks the observed weekly rate is compounded. */
  growth_power: number;
  /** The lowest weekly growth the model believes, in per cent. */
  growth_floor: number;
  /** The highest weekly growth the model believes, in per cent. */
  growth_cap: number;
  /** How much of the maturity multiplier age can move, 0 to 1. */
  maturity_weight: number;
  /** The age, in days, that halves the maturity curve. */
  maturity_half_life_days: number;
  /** The age, in days, an unlisted protocol is scored at. */
  unknown_age_days: number;
}

export const MODEL: ModelConstants = {
  base_multiple: 0.3,
  growth_power: 3,
  growth_floor: -50,
  growth_cap: 60,
  maturity_weight: 0.55,
  maturity_half_life_days: 365,
  unknown_age_days: 365,
};

/** The model's version label: the dashboard names it. */
export const MODEL_VERSION = 'radar-2';

/** How many live-token protocols the Live view carries, by market cap. */
export const LIVE_ROWS = 24;

/** One row of board.json. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  model: {
    base_multiple: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** A board row in the compact form the dashboard reads from data.js. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  watchlist: boolean;
}

/** A live-token protocol: it already trades, so the board shows the market's own value. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** Everything the dashboard renders, from the snapshot. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  rows: RadarRow[];
  live: LiveRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;
const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** Whole days from `listedAt` to `asOf`, clamped at zero; null when the date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** The growth multiplier: the clamped weekly rate, compounded for `growth_power` weeks. */
export function growthMultiplier(change7d: number | null, model: ModelConstants): { pct: number; mult: number } {
  const pct = Math.min(model.growth_cap, Math.max(model.growth_floor, finite(change7d, 0)));
  return { pct, mult: Math.pow(1 + pct / 100, model.growth_power) };
}

/** The maturity multiplier: a saturating curve in the protocol's age with no token. */
export function maturityMultiplier(age: number | null, model: ModelConstants): number {
  const a = Math.max(0, age ?? model.unknown_age_days);
  return 1 - model.maturity_weight + model.maturity_weight * (a / (a + model.maturity_half_life_days));
}

/** The implied value and its parts for one protocol under `model`. */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  model: ModelConstants,
): { implied: number; growthPct: number; growthMult: number; maturityMult: number; age: number | null } {
  const age = ageDays(asOf, protocol.listed_at);
  const { pct, mult } = growthMultiplier(protocol.change_7d, model);
  const maturity = maturityMultiplier(age, model);
  const implied = Math.max(1, Math.round(protocol.tvl_usd * model.base_multiple * mult * maturity));
  return { implied, growthPct: pct, growthMult: mult, maturityMult: maturity, age };
}

/** Whether the snapshot records no token at all for a protocol. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** The house watchlist rule's exclusions, applied to protocols below the floor. */
const VERSIONED_NAME = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
const WRAPPED_OR_STAKED = /\b(wrapped|staked|staking)\b/i;
const EXCHANGE_NAMED = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/;
const WRAPPED_PRODUCT_CATEGORY = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);

/**
 * Whether a pre-token protocol is one the board may rank on its own record: not a
 * wrapped, staked or bridged product of a token that already trades, not an exchange
 * product, not a versioned pool, not a CEX. The watchlist itself is always ranked,
 * whatever its records say: the floor is never the ceiling, and the gate's coverage
 * row is never gambled.
 */
export function isRankable(p: SnapshotProtocol): boolean {
  if (!isPreToken(p)) return false;
  if (p.category !== null && WRAPPED_PRODUCT_CATEGORY.has(p.category)) return false;
  if (VERSIONED_NAME.test(p.name)) return false;
  if (WRAPPED_OR_STAKED.test(p.name)) return false;
  if (EXCHANGE_NAMED.test(p.name)) return false;
  return true;
}

/** The snapshot's protocol by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

/** The protocols the board ranks, strongest implied value first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const index = bySlug(snapshot.protocols);
  const chosen = new Map<string, SnapshotProtocol>();
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // The early radar: every other pre-token protocol the watchlist rule would keep,
  // whatever its TVL. A chosen protocol stays chosen.
  for (const p of snapshot.protocols) {
    if (!chosen.has(p.slug) && isRankable(p)) chosen.set(p.slug, p);
  }
  const scored = [...chosen.values()].map((p) => {
    const v = impliedValue(p, snapshot.as_of, model);
    return { p, ...v };
  });
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token',
    age_days: s.age,
    implied_value_usd: s.implied,
    model: {
      base_multiple: model.base_multiple,
      growth_pct: s.growthPct,
      growth_multiplier: round4(s.growthMult),
      maturity_multiplier: round4(s.maturityMult),
      age_days: s.age,
    },
    farm_steps: farmSteps(s.p, s.age).map(stepText),
  }));
}

// ---------------------------------------------------------------- farm plans

/** One farm step before it is flattened to its single string. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** A step as one string: its action, then its cost and time, inside the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** The protocol's first chain, or a neutral phrase when it names none. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** What one transaction on a chain costs, and how long a bridge to it takes. */
function chainCosts(chain: string): { gas: string; bridge: string; token: string } {
  switch (chain) {
    case 'Ethereum':
      return { gas: '$6-14', bridge: '15 minutes', token: 'ETH' };
    case 'Solana':
      return { gas: '$0.01-0.05', bridge: '2 minutes', token: 'SOL' };
    case 'Base':
      return { gas: '$0.10-0.40', bridge: '5 minutes', token: 'ETH' };
    case 'Arbitrum':
      return { gas: '$0.30-0.90', bridge: '10 minutes', token: 'ETH' };
    case 'Binance':
      return { gas: '$0.10-0.40', bridge: '5 minutes', token: 'BNB' };
    case 'Avalanche':
      return { gas: '$0.30-1.00', bridge: '5 minutes', token: 'AVAX' };
    case 'Optimism':
      return { gas: '$0.20-0.80', bridge: '10 minutes', token: 'ETH' };
    case 'Polygon':
      return { gas: '$0.05-0.25', bridge: '5 minutes', token: 'POL' };
    case 'Hyperliquid L1':
      return { gas: '$0.01-0.05', bridge: '2 minutes', token: 'HYPE' };
    case 'Tron':
      return { gas: '$1-3', bridge: '5 minutes', token: 'TRX' };
    case 'Bitcoin':
      return { gas: '$2-8', bridge: '30 minutes', token: 'BTC' };
    case 'Berachain':
      return { gas: '$0.10-0.50', bridge: '5 minutes', token: 'BERA' };
    case 'Unichain':
      return { gas: '$0.10-0.40', bridge: '5 minutes', token: 'ETH' };
    case 'Monad':
      return { gas: '$0.01-0.10', bridge: '2 minutes', token: 'MON' };
    case 'Plasma':
      return { gas: '$0.05-0.30', bridge: '5 minutes', token: 'XPL' };
    default:
      return { gas: '$0.50-2.00', bridge: '10 minutes', token: 'ETH' };
  }
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 1_000_000_000) return 250;
  if (p.tvl_usd >= 100_000_000) return 150;
  if (p.tvl_usd >= 20_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 45;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** The category's core action and its second qualifying action, in the farmer's words. */
function actionsFor(p: SnapshotProtocol, capital: number, chain: string): { main: string; second: string } {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('curator') || c.includes('allocator') || c.includes('cedefi')) {
    return {
      main: `Deposit $${capital} of USDC into a ${name} vault on ${chain} and keep the vault shares.`,
      second: `Allocate a second, smaller deposit into a different ${name} vault on ${chain}, so the activity spans two of its products.`,
    };
  }
  if (c.includes('rwa')) {
    return {
      main: `Mint $${capital} of the yield-bearing asset through ${name} on ${chain} and hold it.`,
      second: `Reinvest one distribution back into the same ${name} asset instead of withdrawing it, so the position compounds.`,
    };
  }
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) {
    return {
      main: `Supply $${capital} of USDC to ${name} on ${chain} and keep the supply position open.`,
      second: `Borrow $20 against the supply and repay it within a week, so the position shows both sides of the market.`,
    };
  }
  if (c.includes('dex')) {
    return {
      main: `Provide $${capital} of liquidity to ${name}'s main pool on ${chain} and keep the position open.`,
      second: `Swap $25 through ${name} on ${chain} once a week, routing through its own pool.`,
    };
  }
  if (c.includes('yield') || c.includes('farm') || c.includes('liquidity manager')) {
    return {
      main: `Deposit $${capital} of USDC into ${name}'s highest-TVL strategy on ${chain} and keep the shares.`,
      second: `Move half the position into a second ${name} strategy on ${chain} after two weeks, so two strategies carry your wallet.`,
    };
  }
  if (c.includes('bridge')) {
    return {
      main: `Bridge $${capital} of USDC to ${chain} through ${name} and use the bridged funds in its app.`,
      second: `Bridge $25 back through ${name} after a week, so the route is used in both directions.`,
    };
  }
  if (c.includes('staking') || c.includes('restak') || c.includes('anchor btc') || c.includes('decentralized btc')) {
    return {
      main: `Stake $${capital} of the chain's staking asset through ${name} on ${chain} and keep the receipt token.`,
      second: `Restake or redelegate $25 of the receipt through ${name} once, to show a second staking action.`,
    };
  }
  if (c.includes('derivative') || c.includes('basis trading') || c.includes('interest rate')) {
    return {
      main: `Deposit $${capital} of USDC as margin on ${name} and open one small hedged position.`,
      second: `Close the hedge and open a fresh one the following week, keeping the margin on the protocol.`,
    };
  }
  if (c.includes('prediction')) {
    return {
      main: `Fund $${capital} and place one market position on ${name}, backing the outcome you researched.`,
      second: `Place a second, smaller position on a different ${name} market the next week.`,
    };
  }
  if (c.includes('stable')) {
    return {
      main: `Mint or deposit $${capital} of the stable asset through ${name} on ${chain}.`,
      second: `Swap $25 of the stable asset through ${name} once, then hold the rest in the protocol.`,
    };
  }
  if (c.includes('insurance')) {
    return {
      main: `Buy $${capital} of cover from ${name} on ${chain} and keep the policy active.`,
      second: `Renew or top up the cover once before it lapses, so the policy never gaps.`,
    };
  }
  if (c.includes('payment')) {
    return {
      main: `Top up $${capital} through ${name} on ${chain} and pay one real bill or invoice with it.`,
      second: `Repeat one payment a week through ${name} instead of a single top-up.`,
    };
  }
  if (c.includes('governance')) {
    return {
      main: `Deposit $${capital} into ${name} on ${chain} and vote in its next governance round.`,
      second: `Vote again in the following round and keep the deposit in place.`,
    };
  }
  if (c === 'chain') {
    return {
      main: `Bridge $${capital} of USDC to ${name} and use it in one of the chain's own apps.`,
      second: `Make one swap or deposit on ${name} each week so the wallet stays active on the chain.`,
    };
  }
  if (c.includes('index')) {
    return {
      main: `Buy $${capital} of the index through ${name} on ${chain} and hold it.`,
      second: `Add $25 to the index position once, rebalancing instead of withdrawing.`,
    };
  }
  if (c.includes('otc')) {
    return {
      main: `List or fill a $${capital} order through ${name} on ${chain}.`,
      second: `Settle a second, smaller order the following week.`,
    };
  }
  if (c.includes('card')) {
    return {
      main: `Order the card from ${name}, load $${capital} onto it, and spend $25 on a real purchase.`,
      second: `Top up the card once a week and keep spending through it.`,
    };
  }
  return {
    main: `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`,
    second: `Make a second deposit of $25 two weeks later, so the activity spans more than one snapshot.`,
  };
}

/**
 * A protocol's farm plan: eight steps, each an action with a cost and a time. The plan
 * is derived from the protocol's own record (category, chains, TVL, age), never from a
 * hand-written list of names.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const { gas, bridge, token } = chainCosts(chain);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const actions = actionsFor(p, capital, chain);
  return [
    {
      text: `Open a fresh wallet that holds only the funds you plan to farm, and write its seed phrase on paper, never in a screenshot or a chat.`,
      cost: 'nothing to set up',
      time: '5 minutes',
    },
    {
      text: `Bridge $${capital} of USDC from your main wallet to ${chain} and keep $5 of ${token} in the wallet for fees.`,
      cost: `${gas} of gas`,
      time: bridge,
    },
    { text: actions.main, cost: `$${capital} of capital and about ${gas} of gas`, time: '15 minutes to set up' },
    { text: actions.second, cost: `$25 of capital and about ${gas} of gas`, time: '10 minutes' },
    {
      text: `Repeat one qualifying action each week, a deposit, a swap, a vote or a borrow, so the wallet shows steady activity.`,
      cost: `about ${gas} of gas a week`,
      time: '10 minutes a week',
    },
    {
      text: `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot.`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: `Before you withdraw, open the protocol's own points or rewards page from its official site and claim only from the link it publishes.`,
      cost: 'no fee to check, and never pay to claim',
      time: '10 minutes',
    },
    {
      text: `Write the wallet, the dates and every transaction hash in a farm log, and unwind by withdrawing in two parts so a failed exit cannot trap the full position.`,
      cost: `about ${gas} of gas to exit`,
      time: '10 minutes to unwind',
    },
  ];
}

/** The live-token protocols, by market cap, for the dashboard's Live token view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
}

/** A board row's compact form for data.js, with the farm plan generated in the page. */
export function radarRow(row: BoardRow, watchlist: Set<string>): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
    watchlist: watchlist.has(row.slug),
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const watchlist = new Set(snapshot.watchlist);
  const early = board.filter((r) => !watchlist.has(r.slug)).length;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    rows: board.map((r) => radarRow(r, watchlist)),
    live,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  if (board.length < 100) return `the board holds ${board.length} rows, fewer than the gate's 100`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) {
      const t = s.trim();
      if (t.length < 20 || t.length > 600) return `${r.slug} has a farm step of ${t.length} characters`;
    }
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
