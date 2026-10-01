/**
 * dryRunDiscovery.ts
 *
 * Audit tool: how much is list-based discovery missing?
 *
 * WHY THIS EXISTS
 *
 * Discovery is now "read `balanceOf` for every token on a published list".
 * That is fast and has no RPC-range failure modes, but it cannot find a token
 * nobody ever listed -- and the router accepts ANY ERC20 as `tokenIn`, since
 * the only on-chain allowlist is of aggregator targets, not tokens. Measured
 * on base before the pivot, 63 of 300 distinct `tokenIn` addresses (21%)
 * appeared in no list.
 *
 * Without something like this, that gap is unfalsifiable: a scan that misses
 * an asset produces the same clean output as one that finds everything. This
 * script walks real `OrderFilled` history and reports what the list-based path
 * would not have found.
 *
 * IT IS NOT A FALLBACK. Nothing in `fees:scan` or `fees:cycle` imports it, and
 * it deliberately carries its own copy of the log-walking code rather than
 * exporting one for production to reach for. Run it occasionally; act on it by
 * adding addresses to data/known-fee-assets.json.
 *
 * Usage:
 *   npx hardhat run scripts/dryRunDiscovery.ts
 *
 * Env:
 *   AUDIT_ONLY    comma-separated network names (default: all deployed)
 *   AUDIT_RANGE   starting getLogs block span to probe down from (default 10000000)
 */
import hre from "hardhat";
import { id, getAddress, type JsonRpcProvider } from "ethers";
import { listSafeChains, makeProvider, mapLimit } from "../util/safeChains";
import { NETWORK_CONFIGS } from "../util/deploymentConfig";
import { toChecksum } from "../util/address";
import { indexByChain, loadKnownFeeAssets, loadOkuTokenList } from "../util/tokenUniverse";
import { multicallAddressFor, probeBalances } from "../util/balanceProbe";

/** OrderFilled(address,address,address,address,uint256,uint256,uint256,address) */
const ORDER_FILLED = id(
  "OrderFilled(address,address,address,address,uint256,uint256,uint256,address)",
);

const RANGE_PROBES = [10_000_000, 1_000_000, 100_000, 10_000, 2_000, 1_000, 500, 200, 100, 50, 10];

/** Largest block span this endpoint will serve, or 0 if it refuses all of them. */
async function probeLogRange(
  provider: JsonRpcProvider,
  address: string,
  latest: number,
  start: number,
): Promise<number> {
  for (const span of RANGE_PROBES) {
    if (span > start) continue;
    try {
      await provider.getLogs({
        address,
        fromBlock: Math.max(0, latest - span + 1),
        toBlock: latest,
      });
      return span;
    } catch {
      // Refused: try a smaller window.
    }
  }
  return 0;
}

/** Every distinct tokenIn ever seen, walking the whole history we can reach. */
async function distinctTokenIn(
  provider: JsonRpcProvider,
  router: string,
  latest: number,
  range: number,
): Promise<{ tokens: Set<string>; events: number; refused: number }> {
  const tokens = new Set<string>();
  let events = 0;
  let refused = 0;
  for (let start = 0; start <= latest; start += range) {
    const end = Math.min(start + range - 1, latest);
    try {
      const logs = await provider.getLogs({
        address: router,
        fromBlock: start,
        toBlock: end,
        topics: [ORDER_FILLED],
      });
      for (const log of logs) {
        events++;
        // tokenIn is the first non-indexed field. Zero means ETH -> token,
        // where the fee is native and there is no ERC20 to record.
        const tokenIn = `0x${log.data.slice(26, 66)}`;
        if (!/^0x0{40}$/.test(tokenIn)) tokens.add(getAddress(tokenIn));
      }
    } catch {
      refused++;
    }
  }
  return { tokens, events, refused };
}

interface Row {
  network: string;
  chainId: number;
  status: string;
  events: number;
  tokenIn: number;
  unlisted: number;
  unseeded: number;
  heldUnlisted: number;
  missing: string[];
}

async function main(): Promise<void> {
  const only = process.env.AUDIT_ONLY?.trim()
    ? new Set(process.env.AUDIT_ONLY.split(",").map((s) => s.trim()))
    : undefined;
  const startRange = Number(process.env.AUDIT_RANGE ?? 10_000_000);

  const chains = listSafeChains(hre, only).filter((c) => c.router);
  const list = await loadOkuTokenList();
  const byChain = indexByChain(list.tokens);
  const seed = loadKnownFeeAssets();

  console.log(
    `Auditing list-based discovery on ${chains.length} chain(s) against real OrderFilled ` +
      `history.\nThis walks logs and is SLOW. It is a measurement, not part of any scan.\n`,
  );

  const rows = await mapLimit(chains, 4, async (chain): Promise<Row> => {
    const base: Row = {
      network: chain.network,
      chainId: chain.chainId,
      status: "ok",
      events: 0,
      tokenIn: 0,
      unlisted: 0,
      unseeded: 0,
      heldUnlisted: 0,
      missing: [],
    };
    if (!chain.rpcUrl) return { ...base, status: "no-rpc" };

    const provider = makeProvider(chain.rpcUrl, chain.chainId);
    try {
      const latest = await provider.getBlockNumber();
      const range = await probeLogRange(provider, chain.router!, latest, startRange);
      if (range === 0) return { ...base, status: "no-logs" };

      const { tokens, events, refused } = await distinctTokenIn(
        provider,
        chain.router!,
        latest,
        range,
      );
      base.events = events;
      base.tokenIn = tokens.size;
      if (refused > 0) base.status = `partial(${refused} refused)`;

      const listed = byChain.get(chain.chainId) ?? new Set<string>();
      const seeded = seed.get(chain.chainId) ?? new Set<string>();
      const unlisted = [...tokens].filter((t) => !listed.has(t));
      const unseeded = unlisted.filter((t) => !seeded.has(t));
      base.unlisted = unlisted.length;
      base.unseeded = unseeded.length;

      // The number that actually matters: of the tokens our candidate set
      // would never ask about, how many is the router holding right now?
      if (unseeded.length) {
        const cfg = NETWORK_CONFIGS[chain.network];
        const probe = await probeBalances(provider, chain.router!, unseeded, {
          multicall: multicallAddressFor(cfg),
        });
        base.heldUnlisted = probe.balances.size;
        base.missing = [...probe.balances.keys()].map((t) => toChecksum(t) ?? t);
      }
      return base;
    } catch (e) {
      return { ...base, status: `error: ${String((e as Error).message).slice(0, 40)}` };
    } finally {
      provider.destroy();
    }
  });

  rows.sort((a, b) => b.heldUnlisted - a.heldUnlisted || a.chainId - b.chainId);

  const l = (v: unknown, n: number) => String(v ?? "").padEnd(n);
  const p = (v: unknown, n: number) => String(v ?? "").padStart(n);
  console.log(
    `${l("network", 12)} ${p("events", 8)} ${p("tokenIn", 8)} ${p("unlisted", 9)} ` +
      `${p("unseeded", 9)} ${p("HELD", 5)}  status`,
  );
  console.log("-".repeat(80));
  let tHeld = 0;
  let tUnseeded = 0;
  let tTokenIn = 0;
  for (const r of rows) {
    tHeld += r.heldUnlisted;
    tUnseeded += r.unseeded;
    tTokenIn += r.tokenIn;
    console.log(
      `${l(r.network, 12)} ${p(r.events, 8)} ${p(r.tokenIn, 8)} ${p(r.unlisted, 9)} ` +
        `${p(r.unseeded, 9)} ${p(r.heldUnlisted || "", 5)}  ${r.status}`,
    );
  }
  console.log("-".repeat(80));
  console.log(
    `${l("TOTAL", 12)} ${p("", 8)} ${p(tTokenIn, 8)} ${p("", 9)} ${p(tUnseeded, 9)} ${p(tHeld, 5)}`,
  );

  console.log("");
  console.log(`Distinct tokenIn ever seen        : ${tTokenIn}`);
  console.log(`  ...in neither the list nor seed : ${tUnseeded}  <- invisible to fees:scan`);
  console.log(`  ...of those, HELD right now     : ${tHeld}  <- value being left behind`);

  const withMissing = rows.filter((r) => r.missing.length);
  if (withMissing.length) {
    console.log("\nAdd these to data/known-fee-assets.json to make them visible again:\n");
    for (const r of withMissing) {
      console.log(`  "${r.chainId}": [   // ${r.network}`);
      for (const a of r.missing) console.log(`    "${a}",`);
      console.log("  ],");
    }
  } else {
    console.log("\nNothing held is invisible to the candidate set.");
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
