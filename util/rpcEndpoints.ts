/**
 * rpcEndpoints.ts
 *
 * Curated per-chain RPC endpoints, split into two independent choices:
 *
 *   - `rpc`  — general JSON-RPC: balance reads, historical (archive) state,
 *              and transaction broadcast.
 *   - `logs` — the `eth_getLogs` endpoint used for fee-asset discovery.
 *
 * Why these are separate
 * ----------------------
 * They have different winners. On `xdc` and `goat` the public endpoint serves
 * a far wider `eth_getLogs` range than Ankr, while Ankr serves archive state
 * that the public endpoint does not (xdc: 10 blocks deep vs 1,000,000). Being
 * forced to pick one endpoint for both would mean giving up discovery depth to
 * get archive depth, or the reverse.
 *
 * Why this file exists at all
 * ---------------------------
 * Fee-asset discovery walks `OrderFilled` history, so the largest block span
 * an endpoint accepts for `eth_getLogs` directly bounds how much of the fee
 * history is visible. Before this map, `hardhat.config.ts` resolved endpoints
 * as `env var -> Alchemy -> curated public -> chain-config`, which put Alchemy
 * FIRST on every chain it supports.
 *
 * Alchemy's free tier caps `eth_getLogs` at **10 blocks**. Measured against
 * the router on each chain, that produced:
 *
 *     chain      Alchemy    official public endpoint
 *     base            10    10,000,000  (via Ankr)
 *     arbitrum        10    10,000,000  (via Ankr)
 *     avax            10    10,000,000  (via Ankr)
 *     op              10     1,000,000  (https://mainnet.optimism.io)
 *     scroll          10    10,000,000  (https://rpc.scroll.io)
 *     linea           10        10,000  (https://rpc.linea.build)
 *     mantle          10        10,000  (https://rpc.mantle.xyz)
 *     unichain        10        10,000  (https://mainnet.unichain.org)
 *
 * The consequence was not theoretical. On the 2026-09-29 sweep, avax
 * discovered ONE token and reported $0.00, while the router actually held
 * nine tokens including USDC 1,173. Arbitrum discovered zero and swept only
 * the hardcoded WETH/WBTC/USDC fallback, leaving 33 tokens behind.
 *
 * So the curated map is consulted BEFORE Alchemy. Explicit `<NET>_URL` /
 * `<NET>_LOGS_URL` env vars still win over everything, so any endpoint here
 * can be overridden per-run without a code change.
 *
 * Keeping this current
 * --------------------
 * These values were measured, not assumed -- each is the best result from
 * probing several candidates per chain with the same ladder
 * `util/feeScan.ts:probeLogRange` uses. Endpoints degrade over time; re-probe
 * before trusting a number here that matters.
 */

/**
 * Ankr chain slugs for the chains our API key is entitled to.
 *
 * Verified empirically against the key in `ANKR_FREEMIUM_API_KEY`: keyless
 * requests are rejected ("Unauthorized"), a deliberately invalid key returns
 * 401, and these return 200 -- so the key is genuinely authenticating rather
 * than falling through to a public tier.
 *
 * Note the `_mainnet` suffix on four of them. The bare slug 403s for those;
 * this is Ankr's naming, not a typo.
 *
 * NOT entitled on the Freemium plan (all return 403, confirmed against the
 * Ankr dashboard as Premium-gated):
 *   linea, op, mantle, telos, sei, scroll, zerog
 * Not offered by Ankr on any plan:
 *   rootstock, unichain, boba, worldchain, hyperevm, pharos, robinhood,
 *   saga, nibiru, plasma, hemi, bob, gensyn
 *
 * A Premium upgrade ($10 PAYG minimum) would unlock the first group, but the
 * public endpoints in CURATED below already match or beat Ankr on every one
 * of those chains for log range, so the upgrade buys reliability rather than
 * reach.
 */
const ANKR_SLUGS: Record<string, string> = {
  mainnet: "eth",
  bsc: "bsc",
  polygon: "polygon",
  base: "base",
  arbitrum: "arbitrum",
  avax: "avalanche",
  gnosis: "gnosis",
  celo: "celo",
  filecoin: "filecoin",
  xdc: "xdc",
  monad: "monad_mainnet",
  redbelly: "redbelly_mainnet",
  goat: "goat_mainnet",
  etherlink: "etherlink_mainnet",
};

/** Which chains should prefer Ankr for general RPC (archive state, reads). */
const ANKR_FOR_RPC = new Set([
  "mainnet",
  "bsc", // archive depth 10 -> 1,000,000; this is why fees:account degraded on bsc
  "polygon", // archive depth 128 -> 1,000,000
  "base",
  "arbitrum",
  "avax",
  "gnosis",
  "celo",
  "filecoin",
  "redbelly",
  "etherlink",
  "xdc", // archive depth 10 -> 1,000,000 (but NOT for logs; see below)
  "goat", // archive depth 128 -> 1,000,000 (but NOT for logs; see below)
  // `monad` deliberately absent: Ankr's archive depth there is 100,000 vs
  // 1,000,000 on the chain-config endpoint, so Ankr would be a downgrade.
]);

/** Which chains should prefer Ankr for eth_getLogs. */
const ANKR_FOR_LOGS = new Set([
  "mainnet", // 100 -> 10,000,000
  "bsc", // 10,000 -> 10,000,000
  "polygon", // 10,000 -> 10,000,000
  "base", // 10 -> 10,000,000
  "arbitrum", // 10 -> 10,000,000
  "avax", // 10 -> 10,000,000
  "redbelly", // 100 -> 2,000
  "etherlink", // 500 -> 1,000
  // Deliberately absent, because the incumbent endpoint is strictly better:
  //   xdc   public 10,000     vs Ankr 2,000
  //   goat  public 10,000,000 vs Ankr 2,000
  //   monad both 100
  //   gnosis public 10,000,000 vs Ankr 10,000,000 (equal; no reason to move)
  //   celo/filecoin equal
]);

export interface ChainEndpoints {
  /** General JSON-RPC (reads, archive state, broadcast). */
  rpc?: string;
  /** eth_getLogs endpoint for fee-asset discovery. */
  logs?: string;
}

/**
 * Non-Ankr curated endpoints, measured as the best available per chain.
 *
 * `logs` is only set where it beats what the default resolution would pick.
 * `rpc` is only set where the default would pick something with worse archive
 * depth or reliability.
 */
const CURATED: Record<string, ChainEndpoints> = {
  // --- Alchemy was capping eth_getLogs at 10 blocks on all of these ---
  op: { rpc: "https://mainnet.optimism.io", logs: "https://mainnet.optimism.io" }, // logs 10 -> 1,000,000
  scroll: { rpc: "https://rpc.scroll.io", logs: "https://rpc.scroll.io" }, // logs 10 -> 10,000,000
  linea: { rpc: "https://rpc.linea.build", logs: "https://rpc.linea.build" }, // logs 10 -> 10,000
  mantle: { rpc: "https://rpc.mantle.xyz", logs: "https://rpc.mantle.xyz" }, // logs 10 -> 10,000
  unichain: { rpc: "https://mainnet.unichain.org", logs: "https://mainnet.unichain.org" }, // logs 10 -> 10,000

  // --- the general/logs split (see ANKR_FOR_RPC vs ANKR_FOR_LOGS) ---
  //
  // These MUST be set explicitly rather than left undefined. `resolveLogsRpc`
  // falls back to the chain's general RPC when there is no logs entry, and
  // the general RPC for these two is now Ankr -- so omitting them would route
  // discovery through Ankr's narrower window and silently undo the split.
  //   xdc:  public 10,000     vs Ankr 2,000
  //   goat: public 10,000,000 vs Ankr 2,000
  xdc: { logs: "https://rpc.xdcrpc.com" },
  goat: { logs: "https://rpc.goat.network" },

  // --- better than the incumbent public endpoint ---
  worldchain: { logs: "https://480.rpc.thirdweb.com" }, // logs 100 -> 1,000
  hyperevm: { logs: "https://rpc.hypurrscan.io" }, // logs 100 -> 1,000 (drpc gave 100, official 500)
  sei: { logs: "https://evm-rpc.sei-apis.com" }, // 2,000, and full archive unlike publicnode
  boba: { logs: "https://mainnet.boba.network" }, // 10,000,000
  bob: { logs: "https://rpc.gobob.xyz" }, // 10,000,000
  hemi: { logs: "https://rpc.hemi.network/rpc" }, // 1,000,000
  telos: { logs: "https://rpc.telos.net" }, // 100,000
  zerog: { logs: "https://evmrpc.0g.ai" }, // 100,000
  plasma: { logs: "https://rpc.plasma.to" }, // 10,000
  saga: { logs: "https://sagaevm.jsonrpc.sagarpc.io" }, // 10,000 (archive only 1,000)
  nibiru: { logs: "https://evm-rpc.nibiru.fi" }, // 10,000 (archive only 1,000)
};

/**
 * Chains where no endpoint we could find serves `eth_getLogs` at all.
 *
 * Discovery is impossible on these: the scan falls back to the hardcoded
 * well-known token set (WETH/WBTC/USDC) plus the native balance, and any
 * other asset the router holds is invisible. This is a real, permanent gap
 * until a logs-capable endpoint exists, and it is recorded here so it can be
 * reported honestly instead of being mistaken for "this chain has no fees".
 *
 * Probed and refused: public-node.rsk.co, rootstock.drpc.org, mycrypto.rsk.co.
 */
export const NO_LOGS_ENDPOINT = new Set(["rootstock"]);

/**
 * Chains whose best available endpoint serves only shallow historical state.
 *
 * `fees:account` reconciles a sweep by reading balances immediately before
 * and after the execution block. Where archive depth is shallow, that read
 * fails and the accounting degrades to event-derived amounts only -- which a
 * fee-on-transfer token can overstate. Observed live on bsc during the
 * 2026-09-29 sweep; bsc is now fixed via Ankr, but these are not.
 *
 * Depth measured with eth_getBalance against the router, in blocks below head.
 */
export const SHALLOW_ARCHIVE: Record<string, number> = {
  filecoin: 1000, // Ankr and public both 1,000
  saga: 1000,
  nibiru: 1000,
  robinhood: 1000,
};

/** Build the Ankr URL for a network, if entitled and a key is configured. */
export function ankrUrl(network: string): string | undefined {
  const slug = ANKR_SLUGS[network];
  if (!slug) return undefined;
  const key = process.env.ANKR_FREEMIUM_API_KEY?.trim();
  if (!key) return undefined;
  return `https://rpc.ankr.com/${slug}/${key}`;
}

/**
 * Curated general-RPC endpoint for a network, or undefined to let the
 * caller's existing fallback chain decide.
 */
export function curatedRpc(network: string): string | undefined {
  if (ANKR_FOR_RPC.has(network)) {
    const a = ankrUrl(network);
    if (a) return a;
  }
  return CURATED[network]?.rpc;
}

/**
 * Curated eth_getLogs endpoint for a network, or undefined to fall back to
 * the general RPC.
 */
export function curatedLogsRpc(network: string): string | undefined {
  if (ANKR_FOR_LOGS.has(network)) {
    const a = ankrUrl(network);
    if (a) return a;
  }
  return CURATED[network]?.logs;
}

/** True when this network is served by Ankr under the configured key. */
export function isAnkrEntitled(network: string): boolean {
  return ANKR_SLUGS[network] !== undefined;
}

/** Exposed for tests and for `fees:scan --help`-style diagnostics. */
export const _internal = { ANKR_SLUGS, ANKR_FOR_RPC, ANKR_FOR_LOGS, CURATED };
