/**
 * balanceDiscovery.ts
 *
 * "Which ERC20s does the router hold right now?" answered by indexed
 * balance APIs, without log indexing and without a candidate list.
 *
 * WHY
 *
 * The router takes fees in whatever token the user SELLS (BaseAggregator.sol
 * _fillQuoteTokenToToken keeps `feeAmount` of sellToken), and there is no
 * token whitelist on the contract. So the set of fee tokens is open-ended,
 * and a multicall over a candidate list can only ever find tokens someone
 * thought to put on the list. A balance API answers the real question
 * directly: every token the address holds, whether or not we have heard of it.
 *
 * PROVIDERS (both verified 2026-10-22 against the live router)
 *
 *   alchemy  Portfolio API, POST api.g.alchemy.com/data/v1/<key>/assets/tokens/by-address.
 *            Gated separately from Alchemy RPC: it answers on monad, robinhood
 *            and hyperevm even where the RPC endpoint says "not enabled".
 *   ankr     ankr_getAccountBalance (Advanced API, Freemium key). Narrower,
 *            and every chain it has is also on Alchemy, so it is a second
 *            opinion: when both answer, the union is used.
 *
 * Network ids are NOT derivable (`hyperevm` is `hyperliquid-mainnet`, `avax`
 * is ankr `avalanche`). Every entry below was verified by a live call; chains
 * absent from both tables have no discovery and fall back to the curated list.
 *
 * FAILURE SEMANTICS
 *
 * Never throws. A chain is `covered` only if at least one provider returned a
 * COMPLETE answer (every page). A provider that failed mid-pagination counts
 * as failed, not as a short list: a short list would read exactly like a
 * router holding less, which is the failure this whole module exists to fix.
 */
import { toChecksum } from "./address";

/** Alchemy Portfolio API network ids, by hardhat network name. */
export const ALCHEMY_PORTFOLIO_NETWORK: Record<string, string> = {
  mainnet: "eth-mainnet",
  op: "opt-mainnet",
  arbitrum: "arb-mainnet",
  base: "base-mainnet",
  bsc: "bnb-mainnet",
  polygon: "polygon-mainnet",
  avax: "avax-mainnet",
  linea: "linea-mainnet",
  worldchain: "worldchain-mainnet",
  unichain: "unichain-mainnet",
  celo: "celo-mainnet",
  gnosis: "gnosis-mainnet",
  rootstock: "rootstock-mainnet",
  scroll: "scroll-mainnet",
  monad: "monad-mainnet",
  robinhood: "robinhood-mainnet",
  hyperevm: "hyperliquid-mainnet",
  gensyn: "gensyn-mainnet",
};

/**
 * Ankr Advanced API blockchain names, by hardhat network name. The Freemium
 * key rejects every other chain ("is not allowed"), including ones Ankr serves
 * plain RPC for (celo, xdc, monad, filecoin, ...).
 */
export const ANKR_BLOCKCHAIN: Record<string, string> = {
  mainnet: "eth",
  op: "optimism",
  arbitrum: "arbitrum",
  base: "base",
  bsc: "bsc",
  polygon: "polygon",
  avax: "avalanche",
  gnosis: "gnosis",
  linea: "linea",
  scroll: "scroll",
};

export type DiscoveryProviderName = "alchemy" | "ankr";

export type DiscoveryStatus =
  /** At least one provider returned a complete answer. */
  | "covered"
  /** Supported, but every provider that supports it failed this run. */
  | "failed"
  /** No provider supports this chain (or no API key configured). */
  | "unsupported";

export interface DiscoveryChainResult {
  network: string;
  status: DiscoveryStatus;
  /** Providers whose answer was complete and is included in `balances`. */
  providers: DiscoveryProviderName[];
  /** Checksummed ERC20 -> non-zero raw balance. Native is never included. */
  balances: Map<string, bigint>;
  warnings: string[];
}

export interface DiscoveryTarget {
  network: string;
  /** The router address on that chain. */
  router: string;
}

type FetchFn = typeof fetch;

export interface DiscoveryOpts {
  alchemyKey?: string;
  ankrKey?: string;
  fetchFn?: FetchFn;
  timeoutMs?: number;
  /** Stop paginating after this many pages and treat the answer as incomplete. */
  maxPages?: number;
  /** ms to wait before retrying a rate-limited request. */
  backoffMs?: number;
  retries?: number;
}

interface ProviderAnswer {
  ok: boolean;
  balances: Map<string, bigint>;
  error?: string;
}

const DEFAULT_MAX_PAGES = 50;

function parseRaw(v: unknown): bigint | null {
  if (typeof v !== "string" || v === "") return null;
  try {
    return BigInt(v);
  } catch {
    return null;
  }
}

async function postJson(
  url: string,
  body: unknown,
  opts: DiscoveryOpts,
  isRateLimited: (status: number, json: unknown) => boolean,
): Promise<{ status: number; json: unknown }> {
  const fetchFn = opts.fetchFn ?? fetch;
  const retries = opts.retries ?? 3;
  let last: { status: number; json: unknown } = { status: 0, json: null };
  for (let attempt = 0; attempt <= retries; attempt++) {
    const res = await fetchFn(url, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(opts.timeoutMs ?? 30_000),
    });
    let json: unknown = null;
    try {
      json = await res.json();
    } catch {
      json = null;
    }
    last = { status: res.status, json };
    if (!isRateLimited(res.status, json) || attempt === retries) return last;
    await new Promise((r) => setTimeout(r, opts.backoffMs ?? 11_000));
  }
  return last;
}

function errText(e: unknown): string {
  return String((e as Error)?.message ?? e).slice(0, 120);
}

/** One chain from Alchemy's Portfolio API, following every page. */
export async function alchemyHoldings(
  network: string,
  router: string,
  opts: DiscoveryOpts,
): Promise<ProviderAnswer> {
  const balances = new Map<string, bigint>();
  const net = ALCHEMY_PORTFOLIO_NETWORK[network];
  const key = opts.alchemyKey;
  if (!net || !key) return { ok: false, balances, error: "unsupported" };
  const url = `https://api.g.alchemy.com/data/v1/${key}/assets/tokens/by-address`;
  let pageKey: string | undefined;
  const maxPages = opts.maxPages ?? DEFAULT_MAX_PAGES;
  try {
    for (let page = 0; ; page++) {
      if (page >= maxPages) return { ok: false, balances, error: `more than ${maxPages} pages` };
      const { status, json } = await postJson(
        url,
        {
          addresses: [{ address: router, networks: [net] }],
          withMetadata: false,
          withPrices: false,
          includeNativeTokens: false,
          ...(pageKey ? { pageKey } : {}),
        },
        opts,
        (s) => s === 429,
      );
      const data = (json as { data?: { tokens?: unknown[]; pageKey?: string } } | null)?.data;
      if (status !== 200 || !data || !Array.isArray(data.tokens)) {
        const msg = (json as { error?: { message?: string } } | null)?.error?.message;
        return { ok: false, balances, error: `HTTP ${status}${msg ? ` ${msg.slice(0, 80)}` : ""}` };
      }
      for (const t of data.tokens as { tokenAddress?: string | null; tokenBalance?: string; error?: unknown }[]) {
        if (t.error) return { ok: false, balances, error: `token entry error: ${String(t.error).slice(0, 80)}` };
        if (!t.tokenAddress) continue; // native
        const a = toChecksum(t.tokenAddress);
        const bal = parseRaw(t.tokenBalance);
        if (a && bal !== null && bal > 0n) balances.set(a, bal);
      }
      if (!data.pageKey) return { ok: true, balances };
      pageKey = data.pageKey;
    }
  } catch (e) {
    return { ok: false, balances, error: errText(e) };
  }
}

/**
 * Ankr, one call per router address across every Ankr chain that address is
 * deployed on. Returns per-network answers.
 */
export async function ankrHoldings(
  router: string,
  networks: string[],
  opts: DiscoveryOpts,
): Promise<Map<string, ProviderAnswer>> {
  const out = new Map<string, ProviderAnswer>();
  const byChain = new Map<string, string>(); // ankr name -> network
  for (const n of networks) if (ANKR_BLOCKCHAIN[n]) byChain.set(ANKR_BLOCKCHAIN[n], n);
  if (byChain.size === 0) return out;
  const fail = (error: string) => {
    for (const n of byChain.values()) out.set(n, { ok: false, balances: new Map(), error });
    return out;
  };
  if (!opts.ankrKey) return fail("unsupported");
  const url = `https://rpc.ankr.com/multichain/${opts.ankrKey}`;
  const per = new Map<string, Map<string, bigint>>([...byChain.values()].map((n) => [n, new Map()]));
  let pageToken: string | undefined;
  const maxPages = opts.maxPages ?? DEFAULT_MAX_PAGES;
  try {
    for (let page = 0; ; page++) {
      if (page >= maxPages) return fail(`more than ${maxPages} pages`);
      const { status, json } = await postJson(
        url,
        {
          jsonrpc: "2.0",
          id: 1,
          method: "ankr_getAccountBalance",
          params: {
            walletAddress: router,
            blockchain: [...byChain.keys()],
            onlyWhitelisted: false,
            pageSize: 1000,
            ...(pageToken ? { pageToken } : {}),
          },
        },
        opts,
        (s, j) => s === 429 || /too many requests|rate limit/i.test(String((j as { error?: { message?: string } })?.error?.message ?? "")),
      );
      const body = json as {
        result?: { assets?: unknown[]; nextPageToken?: string };
        error?: { message?: string };
      } | null;
      if (status !== 200 || !body?.result || !Array.isArray(body.result.assets)) {
        return fail(`HTTP ${status}${body?.error?.message ? ` ${body.error.message.slice(0, 80)}` : ""}`);
      }
      for (const a of body.result.assets as {
        blockchain?: string;
        tokenType?: string;
        contractAddress?: string;
        balanceRawInteger?: string;
      }[]) {
        if (a.tokenType !== "ERC20") continue;
        const n = a.blockchain ? byChain.get(a.blockchain) : undefined;
        const t = toChecksum(a.contractAddress);
        const bal = parseRaw(a.balanceRawInteger);
        if (n && t && bal !== null && bal > 0n) per.get(n)!.set(t, bal);
      }
      if (!body.result.nextPageToken) break;
      pageToken = body.result.nextPageToken;
    }
  } catch (e) {
    return fail(errText(e));
  }
  for (const [n, balances] of per) out.set(n, { ok: true, balances });
  return out;
}

/** Is any discovery provider able to look at this chain at all? */
export function discoverySupported(network: string): boolean {
  return ALCHEMY_PORTFOLIO_NETWORK[network] !== undefined || ANKR_BLOCKCHAIN[network] !== undefined;
}

/**
 * Holdings for every target. Never throws.
 *
 * When both providers answer for a chain, balances are UNIONED (an index can
 * lag a new token; the other may have it). The raw balance kept is the larger
 * of the two; it is only used to decide what to look at -- every token found
 * is re-read on chain before anything uses its balance.
 */
export async function discoverHoldings(
  targets: DiscoveryTarget[],
  opts: DiscoveryOpts = {},
): Promise<Map<string, DiscoveryChainResult>> {
  // An explicit "" disables a provider (tests); undefined falls back to .env.
  const o: DiscoveryOpts = {
    ...opts,
    alchemyKey: (opts.alchemyKey ?? process.env.ALCHEMY_API_KEY?.trim()) || undefined,
    ankrKey: (opts.ankrKey ?? process.env.ANKR_FREEMIUM_API_KEY?.trim()) || undefined,
  };

  // Ankr: one request per distinct router address (routers are usually the
  // same CREATE2 address everywhere, so this is normally one request).
  const byRouter = new Map<string, string[]>();
  for (const t of targets) {
    const r = toChecksum(t.router);
    if (!r) continue;
    if (!byRouter.has(r)) byRouter.set(r, []);
    byRouter.get(r)!.push(t.network);
  }
  const ankr = new Map<string, ProviderAnswer>();
  for (const [router, nets] of byRouter) {
    for (const [n, a] of await ankrHoldings(router, nets, o)) ankr.set(n, a);
  }

  // Alchemy: one network per request, sequentially. ~20 chains, a handful of
  // pages each; concurrency buys little and invites 429s.
  const out = new Map<string, DiscoveryChainResult>();
  for (const t of targets) {
    const warnings: string[] = [];
    const providers: DiscoveryProviderName[] = [];
    const balances = new Map<string, bigint>();
    let supported = 0;
    const merge = (name: DiscoveryProviderName, a: ProviderAnswer | undefined) => {
      if (!a || a.error === "unsupported") return;
      supported++;
      if (!a.ok) {
        warnings.push(`${t.network}: ${name} balance API failed (${a.error ?? "unknown"})`);
        return;
      }
      providers.push(name);
      for (const [tok, bal] of a.balances) {
        const prev = balances.get(tok);
        if (prev === undefined || bal > prev) balances.set(tok, bal);
      }
    };
    const router = toChecksum(t.router);
    merge("alchemy", router ? await alchemyHoldings(t.network, router, o) : undefined);
    merge("ankr", ankr.get(t.network));
    const status: DiscoveryStatus = providers.length ? "covered" : supported ? "failed" : "unsupported";
    out.set(t.network, { network: t.network, status, providers, balances, warnings });
  }
  return out;
}
