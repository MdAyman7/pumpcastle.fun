/**
 * codex.ts
 *
 * Server-side Codex SDK wrapper for fetching real token data.
 * Uses the @codex-data/sdk to query Solana token information
 * and maps it into our TokenData interface.
 */

import { Codex } from "@codex-data/sdk";
import { CODEX_API_KEY } from "$env/static/private";
import type { TokenData, ExchangeListing } from "$lib/types";

// Singleton SDK instance
let codexInstance: Codex | null = null;

function getCodex(): Codex {
  if (!codexInstance) {
    codexInstance = new Codex(CODEX_API_KEY);
  }
  return codexInstance;
}

// Known CEX exchange names → tier mapping
const CEX_MAJOR: Set<string> = new Set([
  "Binance",
  "Coinbase",
  "Kraken",
  "OKX",
  "Bybit",
  "Crypto.com",
  "KuCoin",
  "Bitfinex",
  "Gate.io",
  "HTX",
]);

const CEX_SMALL: Set<string> = new Set([
  "MEXC",
  "Bitget",
  "BingX",
  "CoinEx",
  "LBank",
  "Phemex",
  "AscendEX",
  "BitMart",
  "Deepcoin",
]);

// Solana network ID used by Codex — ONLY supported network
export const SOLANA_CODEX_NETWORK_ID = 1399811149;

/**
 * Classify a Codex exchange entry into our tier system.
 * On-chain DEX pools (Raydium, Jupiter, Orca, Meteora, PumpSwap, etc.) → 'dex'
 * Known major CEX names → 'cex_major'
 * Known small CEX names → 'cex_small'
 * Unknown → 'dex' (default, since Codex mostly returns on-chain exchanges)
 */
function classifyExchange(name: string): ExchangeListing["tier"] {
  if (CEX_MAJOR.has(name)) return "cex_major";
  if (CEX_SMALL.has(name)) return "cex_small";
  return "dex";
}

/**
 * Deduplicate exchanges by base name.
 * Codex returns variants like "Raydium", "Raydium CLMM", "Raydium CPMM" —
 * we collapse these into a single "Raydium" entry for castle display.
 */
function deduplicateExchanges(exchanges: ExchangeListing[]): ExchangeListing[] {
  const seen = new Map<string, ExchangeListing>();
  for (const ex of exchanges) {
    // Extract base name (strip version suffixes like "CLMM", "CPMM", "V2", "DAMM")
    const baseName = ex.name
      .replace(/\s+(CLMM|CPMM|DAMM|AMM|V\d+)$/i, "")
      .trim();

    if (!seen.has(baseName)) {
      seen.set(baseName, { name: baseName, tier: ex.tier });
    } else {
      // Keep the higher tier if there's a conflict
      const existing = seen.get(baseName)!;
      const tierRank = { cex_major: 3, cex_small: 2, dex: 1 };
      if (tierRank[ex.tier] > tierRank[existing.tier]) {
        seen.set(baseName, { name: baseName, tier: ex.tier });
      }
    }
  }
  return Array.from(seen.values());
}

/**
 * Fetch token data from Codex API and map to our TokenData interface.
 * Only supports Solana tokens launched via pump.fun.
 * Returns null if the token is not found or the API call fails.
 * Throws an error with a descriptive message if the token is not a pump.fun token.
 */
export async function fetchCodexToken(
  address: string,
  skipPumpFunCheck = false,
): Promise<TokenData | null> {
  try {
    const codex = getCodex();

    const res = await codex.queries.filterTokens({
      tokens: [address],
    });

    const result = res?.filterTokens?.results?.[0];
    if (!result) return null;

    const tokenInfo = result.token;

    // Validate pump.fun — skip when the caller already knows it's a pump.fun token
    // (e.g. tokens already on the map came from the pump.fun-filtered discover query)
    if (!skipPumpFunCheck) {
      const launchpadName = tokenInfo?.launchpad?.name?.toLowerCase() ?? "";
      const isPumpFunLaunchpad =
        launchpadName.includes("pump") ||
        launchpadName.includes("pumpfun") ||
        launchpadName.includes("pump.fun");

      // Also check exchanges for PumpSwap / Pump.fun presence (graduated tokens may
      // no longer carry the launchpad field but still trade on PumpSwap)
      const exchangeNames: string[] = (tokenInfo?.exchanges ?? []).map(
        (e: any) => (e.name ?? "").toLowerCase(),
      );
      const isPumpFunExchange = exchangeNames.some(
        (n: string) =>
          n.includes("pump") ||
          n.includes("pumpswap") ||
          n.includes("pump.fun"),
      );

      if (!isPumpFunLaunchpad && !isPumpFunExchange) {
        throw new Error("NOT_PUMP_FUN");
      }
    }

    // Parse numeric fields safely
    const marketCap = parseFloat(result.marketCap ?? "0") || 0;
    const volume24h = parseFloat(result.volume24 ?? "0") || 0;
    const liquidity = parseFloat(result.liquidity ?? "0") || 0;
    const priceChange24h = parseFloat(result.change24 ?? "0") * 100; // Codex returns as decimal ratio
    const priceChange1h =
      result.change1 != null ? parseFloat(result.change1) * 100 : undefined;
    const high24 =
      result.high24 != null ? parseFloat(result.high24) : undefined;
    const low24 = result.low24 != null ? parseFloat(result.low24) : undefined;
    const holders = result.holders ?? 0;
    const txnCount24 = result.txnCount24 ?? 0;
    const uniqueTransactions24 = result.uniqueTransactions24 ?? 0;
    const buyCount24 =
      result.buyCount24 != null ? result.buyCount24 : undefined;
    const sellCount24 =
      result.sellCount24 != null ? result.sellCount24 : undefined;
    const walletAgeAvg =
      result.walletAgeAvg != null ? parseFloat(result.walletAgeAvg) : undefined;
    const walletAgeStd =
      result.walletAgeStd != null ? parseFloat(result.walletAgeStd) : undefined;
    const devHeldPercentage =
      result.devHeldPercentage != null ? result.devHeldPercentage : undefined;
    const insiderHeldPercentage =
      result.insiderHeldPercentage != null
        ? result.insiderHeldPercentage
        : undefined;
    const sniperCount =
      result.sniperCount != null ? result.sniperCount : undefined;

    // Compute previous volume from volumeChange24h
    const volumeChange = parseFloat(result.volumeChange24 ?? "0") || 0;
    const previousVolume24h =
      volumeChange !== 0 ? volume24h / (1 + volumeChange) : volume24h;

    // ATH: Codex provides high24 as the 24h high price, but for ATH market cap
    // we approximate from circulating market cap (the API doesn't directly give ATH mcap).
    // Use a conservative estimate: if change24 is negative, the token was higher recently.
    // For a proper ATH, we'd need historical data. For now, use market cap / (1 - |priceChange|/100)
    // as a rough upper bound, capped at 2x current.
    let athMarketCap = marketCap;
    if (result.circulatingMarketCap) {
      athMarketCap = parseFloat(result.circulatingMarketCap) || marketCap;
    }
    // If current market cap is less than circulating, token has fallen from ATH
    // We'll use the max of marketCap and circulatingMarketCap as a rough ATH proxy
    athMarketCap = Math.max(athMarketCap, marketCap);

    // Graduation: check launchpad data
    const launchpad = tokenInfo?.launchpad;
    const isGraduated = launchpad?.completed ?? marketCap > 1_000_000;
    const graduatedAt = launchpad?.completedAt
      ? launchpad.completedAt * 1000 // Codex returns Unix seconds
      : isGraduated
        ? Date.now() - 1000 * 60 * 60 * 24 * 30
        : null;

    // Scam flag (available on result directly or on tokenInfo)
    const isScam =
      result.isScam ??
      tokenInfo?.isScam ??
      tokenInfo?.info?.isScam ??
      undefined;

    // Created at
    const createdAt = (result.createdAt ?? tokenInfo?.createdAt ?? 0) * 1000; // seconds → ms

    // Last trade timestamp
    const lastTradeTimestamp =
      (result.lastTransaction ?? Math.floor(Date.now() / 1000)) * 1000;

    // Exchange listings
    const rawExchanges: ExchangeListing[] = (tokenInfo?.exchanges ?? []).map(
      (ex: any) => ({
        name: ex.name ?? "Unknown",
        tier: classifyExchange(ex.name ?? ""),
      }),
    );
    const exchanges = deduplicateExchanges(rawExchanges);

    // Image URL
    const imageUrl =
      tokenInfo?.info?.imageSmallUrl ??
      tokenInfo?.info?.imageLargeUrl ??
      tokenInfo?.info?.imageThumbUrl ??
      undefined;

    // Token name and symbol (Codex sometimes has trailing spaces)
    const name = (
      tokenInfo?.info?.name ??
      tokenInfo?.name ??
      `Token${address.slice(0, 4)}`
    ).trim();
    const symbol = (
      tokenInfo?.info?.symbol ??
      tokenInfo?.symbol ??
      address.slice(0, 4).toUpperCase()
    ).trim();

    return {
      address,
      name,
      symbol,
      imageUrl,
      marketCap,
      athMarketCap,
      priceChange24h,
      priceChange1h,
      high24,
      low24,
      volume24h,
      previousVolume24h: Math.max(0, previousVolume24h),
      txnCount24,
      uniqueTransactions24,
      buyCount24,
      sellCount24,
      walletAgeAvg,
      walletAgeStd,
      devHeldPercentage,
      insiderHeldPercentage,
      sniperCount,
      isScam,
      lastTradeTimestamp,
      holders,
      liquidity,
      createdAt: createdAt || Date.now() - 1000 * 60 * 60 * 24 * 30,
      isGraduated,
      graduatedAt,
      exchanges,
    };
  } catch (err: any) {
    // Re-throw NOT_PUMP_FUN so the API layer can return a clear message
    if (err?.message === "NOT_PUMP_FUN") throw err;
    console.error(`[Codex] Failed to fetch token ${address}:`, err);
    return null;
  }
}

/**
 * Fetch multiple tokens in a batch.
 * Returns a Map of address → TokenData (only includes successfully fetched tokens).
 */
export async function fetchCodexTokens(
  addresses: string[],
): Promise<Map<string, TokenData>> {
  const results = new Map<string, TokenData>();

  // Codex filterTokens supports querying multiple tokens at once
  try {
    const codex = getCodex();

    const res = await codex.queries.filterTokens({
      tokens: addresses,
    });

    const items = res?.filterTokens?.results ?? [];
    for (const result of items) {
      const address = result?.token?.address;
      if (!address) continue;

      // Re-use the single-token adapter logic
      const tokenData = await adaptCodexResult(result, address);
      if (tokenData) {
        results.set(address, tokenData);
      }
    }
  } catch (err) {
    console.error("[Codex] Batch fetch failed:", err);
    // Fallback: try fetching individually
    const individual = await Promise.allSettled(
      addresses.map((addr) => fetchCodexToken(addr)),
    );
    for (const result of individual) {
      if (result.status === "fulfilled" && result.value) {
        results.set(result.value.address, result.value);
      }
    }
  }

  return results;
}

/**
 * Adapt a single Codex filterTokens result item to TokenData.
 * This is the shared logic extracted from fetchCodexToken.
 */
function adaptCodexResult(
  result: any,
  address: string,
  skipPumpFunCheck = false,
): TokenData | null {
  try {
    // Validate pump.fun — PumpCastle only supports pump.fun tokens
    // Skip when results already come from a pump.fun-filtered query (e.g. discover endpoint)
    if (!skipPumpFunCheck) {
      const tokenInfoCheck = result.token;
      const launchpadNameCheck =
        tokenInfoCheck?.launchpad?.name?.toLowerCase() ?? "";
      const isPumpFunLaunchpad =
        launchpadNameCheck.includes("pump") ||
        launchpadNameCheck.includes("pumpfun") ||
        launchpadNameCheck.includes("pump.fun");

      // Also check exchanges for PumpSwap / Pump.fun (graduated tokens may not carry launchpad field)
      const exchangeNamesCheck: string[] = (
        tokenInfoCheck?.exchanges ?? []
      ).map((e: any) => (e.name ?? "").toLowerCase());
      const isPumpFunExchange = exchangeNamesCheck.some(
        (n: string) =>
          n.includes("pump") ||
          n.includes("pumpswap") ||
          n.includes("pump.fun"),
      );

      if (!isPumpFunLaunchpad && !isPumpFunExchange) return null;
    }

    const marketCap = parseFloat(result.marketCap ?? "0") || 0;
    const volume24h = parseFloat(result.volume24 ?? "0") || 0;
    const liquidity = parseFloat(result.liquidity ?? "0") || 0;
    const priceChange24h = parseFloat(result.change24 ?? "0") * 100;
    const priceChange1h =
      result.change1 != null ? parseFloat(result.change1) * 100 : undefined;
    const high24 =
      result.high24 != null ? parseFloat(result.high24) : undefined;
    const low24 = result.low24 != null ? parseFloat(result.low24) : undefined;
    const holders = result.holders ?? 0;
    const txnCount24 = result.txnCount24 ?? 0;
    const uniqueTransactions24 = result.uniqueTransactions24 ?? 0;
    const buyCount24 =
      result.buyCount24 != null ? result.buyCount24 : undefined;
    const sellCount24 =
      result.sellCount24 != null ? result.sellCount24 : undefined;
    const walletAgeAvg =
      result.walletAgeAvg != null ? parseFloat(result.walletAgeAvg) : undefined;
    const walletAgeStd =
      result.walletAgeStd != null ? parseFloat(result.walletAgeStd) : undefined;
    const devHeldPercentage =
      result.devHeldPercentage != null ? result.devHeldPercentage : undefined;
    const insiderHeldPercentage =
      result.insiderHeldPercentage != null
        ? result.insiderHeldPercentage
        : undefined;
    const sniperCount =
      result.sniperCount != null ? result.sniperCount : undefined;

    const tokenInfo = result.token;
    const isScam =
      result.isScam ??
      tokenInfo?.isScam ??
      tokenInfo?.info?.isScam ??
      undefined;

    const volumeChange = parseFloat(result.volumeChange24 ?? "0") || 0;
    const previousVolume24h =
      volumeChange !== 0 ? volume24h / (1 + volumeChange) : volume24h;

    let athMarketCap = marketCap;
    if (result.circulatingMarketCap) {
      athMarketCap = parseFloat(result.circulatingMarketCap) || marketCap;
    }
    athMarketCap = Math.max(athMarketCap, marketCap);

    const launchpad = tokenInfo?.launchpad;
    const isGraduated = launchpad?.completed ?? marketCap > 1_000_000;
    const graduatedAt = launchpad?.completedAt
      ? launchpad.completedAt * 1000
      : isGraduated
        ? Date.now() - 1000 * 60 * 60 * 24 * 30
        : null;

    const createdAt = (result.createdAt ?? tokenInfo?.createdAt ?? 0) * 1000;
    const lastTradeTimestamp =
      (result.lastTransaction ?? Math.floor(Date.now() / 1000)) * 1000;

    const rawExchanges: ExchangeListing[] = (tokenInfo?.exchanges ?? []).map(
      (ex: any) => ({
        name: ex.name ?? "Unknown",
        tier: classifyExchange(ex.name ?? ""),
      }),
    );
    const exchanges = deduplicateExchanges(rawExchanges);

    const imageUrl =
      tokenInfo?.info?.imageSmallUrl ??
      tokenInfo?.info?.imageLargeUrl ??
      tokenInfo?.info?.imageThumbUrl ??
      undefined;

    const name = (
      tokenInfo?.info?.name ??
      tokenInfo?.name ??
      `Token${address.slice(0, 4)}`
    ).trim();
    const symbol = (
      tokenInfo?.info?.symbol ??
      tokenInfo?.symbol ??
      address.slice(0, 4).toUpperCase()
    ).trim();

    return {
      address,
      name,
      symbol,
      imageUrl,
      marketCap,
      athMarketCap,
      priceChange24h,
      priceChange1h,
      high24,
      low24,
      volume24h,
      previousVolume24h: Math.max(0, previousVolume24h),
      txnCount24,
      uniqueTransactions24,
      buyCount24,
      sellCount24,
      walletAgeAvg,
      walletAgeStd,
      devHeldPercentage,
      insiderHeldPercentage,
      sniperCount,
      isScam,
      lastTradeTimestamp,
      holders,
      liquidity,
      createdAt: createdAt || Date.now() - 1000 * 60 * 60 * 24 * 30,
      isGraduated,
      graduatedAt,
      exchanges,
    };
  } catch {
    return null;
  }
}

/**
 * Fetch top pump.fun tokens sorted by market cap.
 * Uses Codex filterTokens with launchpadName filter, network filter,
 * sorted by marketCap DESC, limited to `limit` results.
 * Returns an array of TokenData (only successfully parsed tokens).
 */
export async function fetchTopPumpFunTokens(
  limit: number = 100,
): Promise<TokenData[]> {
  try {
    const codex = getCodex();

    console.log(`[Codex] Fetching top ${limit} pump.fun tokens...`);
    const startTime = Date.now();

    const res = await codex.queries.filterTokens({
      filters: {
        network: [SOLANA_CODEX_NETWORK_ID],
        launchpadName: ["Pump.fun"],
        liquidity: { gt: 1000 },
      },
      statsType: "UNFILTERED" as any,
      rankings: [
        {
          attribute: "marketCap" as any,
          direction: "DESC" as any,
        },
      ],
      limit,
    });

    const elapsed = Date.now() - startTime;
    const count = res?.filterTokens?.count ?? 0;
    const items = res?.filterTokens?.results ?? [];
    console.log(
      `[Codex] API responded in ${elapsed}ms — count: ${count}, results: ${items.length}`,
    );

    const tokens: TokenData[] = [];

    for (const result of items) {
      const address = result?.token?.address;
      if (!address) continue;

      // Skip pump.fun check since we already filtered by launchpadName
      const tokenData = adaptCodexResult(result, address, true);
      if (tokenData) {
        tokens.push(tokenData);
      }
    }

    console.log(
      `[Codex] Parsed ${tokens.length} tokens out of ${items.length} results`,
    );
    return tokens;
  } catch (err) {
    console.error("[Codex] Failed to fetch top pump.fun tokens:", err);
    return [];
  }
}
