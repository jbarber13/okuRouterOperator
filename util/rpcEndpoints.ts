/**
 * rpcEndpoints.ts
 *
 * Curated per-chain general-RPC endpoints.
 *
 * These are the endpoints used for balance reads, historical (archive) state,
 * and transaction broadcast. They are consulted BEFORE Alchemy, because
 * Alchemy's free tier is not uniformly the best option on these chains and on
 * several it is materially worse.
 *
 * Explicit `<NET>_URL` env vars still win over everything here, so any entry
 * can be overridden per-run without a code change.
 *
 * WHAT USED TO BE HERE
 *
 * A second, parallel map of `eth_getLogs` endpoints, because fee discovery
 * walked `OrderFilled` history and the largest block span an endpoint would
 * serve directly bounded how much of that history was visible. Alchemy capped
 * getLogs at 10 blocks, which on 2026-09-29 reduced arbitrum to zero
 * discovered assets while the router held 34, and reported avax as $0.00 while
 * it held USDC 1,173.
 *
 * Discovery no longer reads logs at all -- it reads balances for a candidate
 * token list -- so that entire apparatus, and the class of failure it existed
 * to work around, is gone.
 *
 * Keeping this current
 * --------------------
 * These values were measured, not assumed. Endpoints degrade over time;
 * re-probe before trusting a number here that matters.
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
  "xdc", // archive depth 10 -> 1,000,000
  "goat", // archive depth 128 -> 1,000,000
  // `monad` deliberately absent: Ankr's archive depth there is 100,000 vs
  // 1,000,000 on the chain-config endpoint, so Ankr would be a downgrade.
]);

export interface ChainEndpoints {
  /** General JSON-RPC (reads, archive state, broadcast). */
  rpc?: string;
}

/**
 * Non-Ankr curated endpoints, measured as the best available per chain.
 *
 * Only set where the default resolution would otherwise pick something with
 * worse archive depth or reliability.
 */
const CURATED: Record<string, ChainEndpoints> = {
  // Alchemy is a poorer general endpoint than the official public one on each
  // of these, so the curated entry takes precedence.
  op: { rpc: "https://mainnet.optimism.io" },
  scroll: { rpc: "https://rpc.scroll.io" },
  linea: { rpc: "https://rpc.linea.build" },
  mantle: { rpc: "https://rpc.mantle.xyz" },

  // NOT the official https://mainnet.unichain.org, deliberately.
  //
  // That endpoint returns a pending nonce LOWER than its latest nonce for an
  // address with no mempool backlog -- an impossible state. Observed twice,
  // 2026-09-30 and 2026-10-02: latest 59, pending 55. ethers takes the
  // pending value when building a transaction, so it signs with an
  // already-mined nonce and the broadcast fails with "nonce has already been
  // used". It is not a transient blip and it is not a gas or funding
  // problem; it stops every write to unichain while reads look perfectly
  // healthy, which is what makes it expensive to diagnose.
  //
  // publicnode and drpc both report pending == latest == 59 for the same
  // address at the same block, so the fault is specific to the official
  // endpoint rather than to the chain.
  unichain: { rpc: "https://unichain-rpc.publicnode.com" },
};

/**
 * Chains whose best available endpoint serves only shallow historical state.
 *
 * `fees:account` reconciles a sweep by reading balances immediately before
 * and after the execution block. Where archive depth is shallow, that read
 * fails and the accounting degrades to event-derived amounts only -- which a
 * fee-on-transfer token can overstate. Observed live on bsc during the
 * 2026-09-29 sweep; bsc is now fixed via Ankr, but these are not.
 *
 * This is the one place historical state still matters: discovery no longer
 * reads the past at all.
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

/** True when this network is served by Ankr under the configured key. */
export function isAnkrEntitled(network: string): boolean {
  return ANKR_SLUGS[network] !== undefined;
}

/** Exposed for tests and for `fees:scan --help`-style diagnostics. */
export const _internal = { ANKR_SLUGS, ANKR_FOR_RPC, CURATED };
