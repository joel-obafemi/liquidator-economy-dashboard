import Link from "next/link"

export const metadata = {
  title: "Methodology | Liquidator Economy",
  description: "How we collect, calculate, and present liquidation data from Aave V3, SparkLend, Morpho Blue, and Fluid.",
}

export default function MethodologyPage() {
  return (
    <main className="max-w-[900px] mx-auto px-6 py-8 space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-semibold text-text-primary">Methodology</h1>
        <p className="text-[12px] text-text-secondary mt-2 leading-relaxed">
          Transparency is the foundation of credible research. This page documents
          exactly how the Liquidator Economy dashboard collects, prices, and aggregates
          liquidation data from Aave V3, SparkLend, Morpho Blue, and Fluid on Ethereum
          mainnet, so you can verify, reproduce, or critique every number we publish.
        </p>
      </div>

      {/* Section 1: Data Sources */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-accent">1. Data Sources</h2>
        <div className="tui-card bg-card-bg border border-card-border rounded p-4 text-[12px] text-text-secondary leading-relaxed space-y-3">
          <p>
            All raw event data is read directly from the Ethereum mainnet via public
            JSON-RPC nodes. We do not depend on any centralized indexer like Dune,
            The Graph, or a third-party API for the underlying liquidation data.
          </p>
          <div>
            <p className="text-text-primary font-medium mb-1">Indexed contracts</p>
            <ul className="space-y-1 ml-4 font-mono text-[11px]">
              <li>
                <span className="text-text-tertiary">Aave V3 Pool:</span>{" "}
                <a
                  href="https://etherscan.io/address/0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-accent hover:underline"
                >
                  0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2
                </a>
              </li>
              <li>
                <span className="text-text-tertiary">SparkLend Pool:</span>{" "}
                <a
                  href="https://etherscan.io/address/0xC13e21B648A5Ee794902342038FF3aDAB66BE987"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-accent hover:underline"
                >
                  0xC13e21B648A5Ee794902342038FF3aDAB66BE987
                </a>
              </li>
              <li>
                <span className="text-text-tertiary">Morpho Blue:</span>{" "}
                <a
                  href="https://etherscan.io/address/0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-accent hover:underline"
                >
                  0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb
                </a>
              </li>
              <li>
                <span className="text-text-tertiary">Fluid Vault Factory:</span>{" "}
                <a
                  href="https://etherscan.io/address/0x324c5Dc1fC42c7a4D43d92df1eBA58a54d13Bf2d"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-accent hover:underline"
                >
                  0x324c5Dc1fC42c7a4D43d92df1eBA58a54d13Bf2d
                </a>
              </li>
            </ul>
          </div>
          <div>
            <p className="text-text-primary font-medium mb-1">Indexed events</p>
            <p>
              Aave V3 and SparkLend share an identical{" "}
              <code className="text-accent font-mono">LiquidationCall</code> event
              (Spark is an Aave V3 fork):
            </p>
            <pre className="bg-[var(--background)] border border-card-border rounded p-3 mt-2 overflow-x-auto text-[10px] font-mono text-text-primary">
{`event LiquidationCall(
  address indexed collateralAsset,
  address indexed debtAsset,
  address indexed user,        // borrower
  uint256 debtToCover,
  uint256 liquidatedCollateralAmount,
  address liquidator,
  bool receiveAToken
)`}
            </pre>
            <p className="mt-3">
              Morpho Blue uses a different shape. Each liquidation carries a bytes32
              market ID rather than token addresses. We call{" "}
              <code className="text-accent font-mono">idToMarketParams(id)</code> on the
              Morpho contract once per market to resolve the loan/collateral tokens,
              oracle, and LLTV, then cache the result:
            </p>
            <pre className="bg-[var(--background)] border border-card-border rounded p-3 mt-2 overflow-x-auto text-[10px] font-mono text-text-primary">
{`event Liquidate(
  bytes32 indexed id,          // market id, resolves to tokens
  address indexed caller,       // liquidator
  address indexed borrower,
  uint256 repaidAssets,
  uint256 repaidShares,
  uint256 seizedAssets,
  uint256 badDebtAssets,        // unique to Morpho: socialised bad debt
  uint256 badDebtShares
)`}
            </pre>
            <p className="mt-3">
              Morpho also uniquely tracks <span className="text-text-primary font-medium">bad debt</span>
              , which is the portion of a liquidation the liquidator couldn&apos;t cover
              and which gets socialised among lenders. Aave and Spark can&apos;t have
              bad debt by design (they always require excess collateral).
            </p>
            <p className="mt-3">
              Fluid has a different architecture still. Rather than a single pool contract,
              Fluid deploys a separate vault contract for every collateral/debt pair. We
              discover vault addresses by scanning the factory&apos;s{" "}
              <code className="text-accent font-mono">NewPositionMinted</code> event
              (the{" "}
              <code className="text-accent font-mono">minter</code> field is the vault
              address), then call{" "}
              <code className="text-accent font-mono">constantsView()</code> on each vault
              to resolve its supply and borrow tokens. Each vault emits its own{" "}
              <code className="text-accent font-mono">LogLiquidate</code> event:
            </p>
            <pre className="bg-[var(--background)] border border-card-border rounded p-3 mt-2 overflow-x-auto text-[10px] font-mono text-text-primary">
{`event LogLiquidate(
  address liquidator_,
  uint256 actualColAmt_,   // collateral seized from the vault
  uint256 actualDebtAmt_,  // debt repaid on the vault's behalf
  address to_              // recipient of the seized collateral
)`}
            </pre>
          </div>
          <div>
            <p className="text-text-primary font-medium mb-1">Block range</p>
            <p>
              Aave V3 from block 16,291,127 (Jan 27, 2023). SparkLend from block
              17,185,580 (May 2023). Morpho Blue from block 18,883,124 (Dec 27, 2023).
              Fluid from block ~19,500,000 (April 2024). All protocols are continuously
              indexed up to the current block.
            </p>
          </div>
        </div>
      </section>

      {/* Section 2: Pricing */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-accent">2. Pricing: On-Chain Oracles</h2>
        <div className="tui-card bg-card-bg border border-card-border rounded p-4 text-[12px] text-text-secondary leading-relaxed space-y-3">
          <p>
            <span className="text-text-primary font-medium">We do not use market price APIs.</span>{" "}
            Every USD value on this dashboard is computed from the protocol&apos;s own price oracle
            at the exact block of the liquidation. This is the same price the protocol
            itself used to authorize the liquidation.
          </p>
          <div>
            <p className="text-text-primary font-medium mb-1">Oracle contracts</p>
            <ul className="space-y-1 ml-4 font-mono text-[11px]">
              <li>
                <span className="text-text-tertiary">Aave V3 Oracle:</span>{" "}
                <a
                  href="https://etherscan.io/address/0x54586bE62E3c3580375aE3723C145253060Ca0C2"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-accent hover:underline"
                >
                  0x54586bE62E3c3580375aE3723C145253060Ca0C2
                </a>
              </li>
              <li>
                <span className="text-text-tertiary">SparkLend Oracle:</span>{" "}
                <a
                  href="https://etherscan.io/address/0x8105f69D9C41644c6A0803fDA7D03Aa70996cFD9"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-accent hover:underline"
                >
                  0x8105f69D9C41644c6A0803fDA7D03Aa70996cFD9
                </a>
              </li>
            </ul>
          </div>
          <p>
            For every Aave V3 and SparkLend liquidation event, we call{" "}
            <code className="text-accent font-mono">getAssetsPrices(address[])</code> on
            the relevant oracle <span className="text-text-primary font-medium">at the
            historical block number</span> of the liquidation. The oracle returns
            USD prices with 8 decimals of precision, sourced from Chainlink feeds
            (and Chronicle/RedStone aggregators on Spark).
          </p>
          <p>
            Because we read prices at the exact block, our numbers reflect the
            on-chain reality at the moment the liquidation happened. Not a market
            average, not a delayed price feed, not an interpolation.
          </p>
          <p>
            <span className="text-text-primary font-medium">Morpho Blue pricing:</span>{" "}
            Morpho uses a separate oracle per market, so we first attempt to price every
            Morpho liquidation using the Aave V3 oracle (which covers the majority of
            tokens used as Morpho collateral/debt). For tokens the Aave oracle
            doesn&apos;t support (e.g. Pendle PT tokens, exotic LRTs, isolated pool
            stablecoins), we fall back to <a href="https://defillama.com/docs/api"
            target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">
            DeFiLlama&apos;s historical prices API</a> with the block timestamp rounded
            to the nearest hour, and a 6-hour search window. These prices are cached in
            our database to ensure reproducibility.
          </p>
        </div>
      </section>

      {/* Section 3: Profit Calculation */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-accent">3. Profit Calculation</h2>
        <div className="tui-card bg-card-bg border border-card-border rounded p-4 text-[12px] text-text-secondary leading-relaxed space-y-3">
          <p>
            We track two profit numbers for every liquidation: <span className="text-text-primary font-medium">gross profit</span>{" "}
            (the liquidation bonus before any costs) and <span className="text-text-primary font-medium">net profit</span>{" "}
            (what the liquidator actually keeps after gas).
          </p>

          <div>
            <p className="text-text-primary font-medium mb-1">Gross profit</p>
            <pre className="bg-[var(--background)] border border-card-border rounded p-3 overflow-x-auto text-[10px] font-mono text-text-primary">
{`collateral_usd = (liquidatedCollateralAmount / 10^collateral_decimals) * oracle_price
debt_usd       = (debtToCover / 10^debt_decimals) * oracle_price
gross_profit   = collateral_usd - debt_usd`}
            </pre>
            <p className="mt-2">
              Token decimals are read on-chain from each ERC20 contract&apos;s{" "}
              <code className="text-accent font-mono">decimals()</code> function and
              cached in our database. We do not hardcode 1e18. USDC uses 6, WBTC uses
              8, etc.
            </p>
          </div>

          <div>
            <p className="text-text-primary font-medium mb-1">Net profit</p>
            <pre className="bg-[var(--background)] border border-card-border rounded p-3 overflow-x-auto text-[10px] font-mono text-text-primary">
{`gas_cost_eth = gasUsed * effectiveGasPrice / 1e18
gas_cost_usd = gas_cost_eth * eth_price_at_block
net_profit   = gross_profit - gas_cost_usd`}
            </pre>
            <p className="mt-2">
              Gas data is fetched from the transaction receipt
              (<code className="text-accent font-mono">eth_getTransactionReceipt</code>)
              for each liquidation. ETH price for converting gas to USD is read from
              the Aave oracle at the same block.
            </p>
          </div>

          <div>
            <p className="text-text-primary font-medium mb-1">Liquidation bonus efficiency (per asset)</p>
            <pre className="bg-[var(--background)] border border-card-border rounded p-3 overflow-x-auto text-[10px] font-mono text-text-primary">
{`avg_bonus_pct = AVG((collateral_usd - debt_usd) / debt_usd) * 100`}
            </pre>
            <p className="mt-2">
              The bonus efficiency table on the Insights page shows the average
              effective liquidation bonus extracted per collateral asset. This will
              usually be slightly below the protocol&apos;s configured bonus (typically
              5–10%) because liquidators sometimes liquidate less than the maximum
              allowed amount.
            </p>
          </div>
        </div>
      </section>

      {/* Section 4: Deduplication and Integrity */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-accent">4. Deduplication &amp; Integrity</h2>
        <div className="tui-card bg-card-bg border border-card-border rounded p-4 text-[12px] text-text-secondary leading-relaxed space-y-3">
          <p>
            A single Ethereum transaction can contain multiple liquidation events
            (when one liquidator atomically liquidates several positions). To
            distinguish unique events from duplicates we use a composite key:
          </p>
          <pre className="bg-[var(--background)] border border-card-border rounded p-3 overflow-x-auto text-[10px] font-mono text-text-primary">
{`UNIQUE (tx_hash, collateral_asset, debt_asset, borrower, debt_to_cover)`}
          </pre>
          <p>
            This guarantees one row per real liquidation while still allowing legitimate
            multi-position liquidations within a single transaction.
          </p>
          <p>
            Scan progress is checkpointed in a{" "}
            <code className="text-accent font-mono">scan_state</code> table after every
            batch flush, so an interrupted scan resumes from the last completed block
            and never double-counts.
          </p>
        </div>
      </section>

      {/* Section 5: Cascade detection */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-accent">5. Cascade Detection</h2>
        <div className="tui-card bg-card-bg border border-card-border rounded p-4 text-[12px] text-text-secondary leading-relaxed space-y-3">
          <p>
            A &quot;cascade&quot; on this dashboard is defined as any block containing
            two or more liquidation events. Cascades typically reflect chain reactions
            during volatile market moves where one liquidation pushes other positions
            below their health factor.
          </p>
          <pre className="bg-[var(--background)] border border-card-border rounded p-3 overflow-x-auto text-[10px] font-mono text-text-primary">
{`Cascade blocks      : COUNT blocks with >= 2 liquidations
Major cascade blocks: COUNT blocks with >= 5 liquidations
Cascade events      : SUM of events that occurred in cascade blocks`}
          </pre>
        </div>
      </section>

      {/* Section 6: Rekt Map & ETH Price Data */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-accent">6. Rekt Map &amp; ETH Price Overlay</h2>
        <div className="tui-card bg-card-bg border border-card-border rounded p-4 text-[12px] text-text-secondary leading-relaxed space-y-3">
          <p>
            The Rekt Map correlates daily liquidation volume with ETH price to
            reveal how market crashes drive liquidation cascades. It identifies the
            10 worst liquidation days (&quot;Rekt Days&quot;) by total collateral seized.
          </p>
          <div>
            <p className="text-text-primary font-medium mb-1">Daily aggregation</p>
            <pre className="bg-[var(--background)] border border-card-border rounded p-3 overflow-x-auto text-[10px] font-mono text-text-primary">
{`-- Each day: event count, total volume, profit, biggest single liq,
-- unique liquidators, unique borrowers, top protocol by volume
GROUP BY DATE(TO_TIMESTAMP(block_timestamp))`}
            </pre>
          </div>
          <div>
            <p className="text-text-primary font-medium mb-1">ETH price source</p>
            <p>
              ETH prices come from our{" "}
              <code className="text-accent font-mono">price_cache</code> table,
              which stores hourly WETH prices fetched from DeFiLlama&apos;s historical
              prices API. We average these hourly prices per day and LEFT JOIN them
              onto the daily liquidation data. Days with no cached price show as gaps
              in the ETH price line.
            </p>
          </div>
          <div>
            <p className="text-text-primary font-medium mb-1">ETH day-over-day change</p>
            <p>
              For each Rekt Day in the &quot;Hall of Rekt&quot; table, we compute the
              ETH price change as a percentage relative to the previous day&apos;s
              average ETH price. This is calculated server-side by iterating the
              sorted daily array.
            </p>
          </div>
          <div>
            <p className="text-text-primary font-medium mb-1">Top 10 ranking</p>
            <pre className="bg-[var(--background)] border border-card-border rounded p-3 overflow-x-auto text-[10px] font-mono text-text-primary">
{`ROW_NUMBER() OVER (ORDER BY total_volume DESC) as rekt_rank
-- Days with rekt_rank <= 10 are marked as is_top_rekt = true`}
            </pre>
          </div>
        </div>
      </section>

      {/* Section 7: Cross-Protocol Overlap */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-accent">7. Cross-Protocol Bot Overlap</h2>
        <div className="tui-card bg-card-bg border border-card-border rounded p-4 text-[12px] text-text-secondary leading-relaxed space-y-3">
          <p>
            The overlap matrix on the Insights page answers: &quot;Do the same
            liquidator addresses operate across multiple protocols?&quot; This
            reveals shared infrastructure — bots that go where the profit is.
          </p>
          <div>
            <p className="text-text-primary font-medium mb-1">Pairwise overlap detection</p>
            <pre className="bg-[var(--background)] border border-card-border rounded p-3 overflow-x-auto text-[10px] font-mono text-text-primary">
{`-- Self-join: find liquidators active on BOTH protocol A and B
-- a.protocol < b.protocol prevents double-counting pairs
FROM liquidator_proto a
JOIN liquidator_proto b
  ON a.liquidator = b.liquidator
  AND a.protocol < b.protocol`}
            </pre>
            <p className="mt-2">
              The diagonal of the matrix shows total unique liquidators per protocol.
              Off-diagonal cells show the count of addresses active on <span className="text-text-primary font-medium">both</span>{" "}
              protocols. Hover tooltips show combined volume and profit for
              shared liquidators.
            </p>
          </div>
          <div>
            <p className="text-text-primary font-medium mb-1">Multi-protocol activity breakdown</p>
            <p>
              We also count how many liquidators operate on exactly 1, 2, 3, or all
              4 protocols. This uses{" "}
              <code className="text-accent font-mono">array_length(array_agg(DISTINCT protocol), 1)</code>{" "}
              per liquidator address.
            </p>
          </div>
        </div>
      </section>

      {/* Section 8: Derived Metrics */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-accent">8. Derived Metrics &amp; Chart Methodology</h2>
        <div className="tui-card bg-card-bg border border-card-border rounded p-4 text-[12px] text-text-secondary leading-relaxed space-y-3">
          <div>
            <p className="text-text-primary font-medium mb-1">Liquidation size distribution</p>
            <p>
              Individual liquidation events are bucketed by their collateral
              seized amount (USD) into 8 ranges: $0–$100, $100–$1K, $1K–$10K,
              $10K–$50K, $50K–$100K, $100K–$500K, $500K–$1M, and $1M+.
            </p>
          </div>
          <div>
            <p className="text-text-primary font-medium mb-1">Monthly profit (gross profit flooring)</p>
            <p>
              The monthly profit chart sums{" "}
              <code className="text-accent font-mono">GREATEST(gross_profit_usd, 0)</code>{" "}
              per event. Negative gross profit values (which occur when{" "}
              <code className="text-accent font-mono">collateral_usd &lt; debt_usd</code>{" "}
              due to oracle timing mismatches) are floored to zero so they don&apos;t
              distort the monthly aggregate. This is a conservative choice — the
              alternative would be to subtract these losses, which would
              understate liquidator earnings.
            </p>
          </div>
          <div>
            <p className="text-text-primary font-medium mb-1">Profit concentration snapshot</p>
            <p>
              Liquidators are ranked by total gross profit and grouped into tiers:
              Top 5, Top 6–10, Top 11–20, Top 21–50, and Everyone Else. This shows
              what share of total liquidation profit each tier captures.
            </p>
          </div>
          <div>
            <p className="text-text-primary font-medium mb-1">Concentration over time</p>
            <p>
              The Top 5 profit share is computed monthly. For each month, we rank
              all active liquidators by gross profit and compute what percentage
              the top 5 capture. Months with fewer than 5 active liquidators are
              excluded. Months where total profit is zero or negative show 100%
              concentration (trivially true).
            </p>
          </div>
          <div>
            <p className="text-text-primary font-medium mb-1">Gas strategy comparison</p>
            <p>
              For the top 20 liquidators by gross profit (with at least 5 gas-traced
              events), we compute average gas price (gwei), average gas cost (USD),
              total gas spent, and profit margin after gas. This reveals whether
              top bots outperform by paying higher gas for faster inclusion or by
              optimising gas efficiency.
            </p>
          </div>
          <div>
            <p className="text-text-primary font-medium mb-1">Collateral-debt pair treemap</p>
            <p>
              The top 30 collateral/debt pairs (by total volume, minimum 2 events)
              are displayed as a treemap where each cell&apos;s area is proportional
              to total liquidation volume for that pair.
            </p>
          </div>
        </div>
      </section>

      {/* Section 9: Limitations */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-accent">9. Known Limitations</h2>
        <div className="tui-card bg-card-bg border border-card-border rounded p-4 text-[12px] text-text-secondary leading-relaxed space-y-3">
          <ul className="space-y-2 ml-4 list-disc">
            <li>
              <span className="text-text-primary font-medium">Flashloan fees not deducted.</span>{" "}
              Many liquidators use flashloans to source the debt token. The flashloan fee
              (typically 0.05–0.09%) is a real cost that is not currently subtracted
              from net profit. Future versions may detect and account for it.
            </li>
            <li>
              <span className="text-text-primary font-medium">Swap slippage not deducted.</span>{" "}
              After seizing collateral, most liquidators swap it back into the debt
              token (or stables) and incur DEX slippage and fees. We do not track this.
              Reported net profit is therefore an upper bound.
            </li>
            <li>
              <span className="text-text-primary font-medium">Gas data coverage.</span>{" "}
              A small share of historical transaction receipts cannot be fetched from
              free public RPCs (timeouts on very old txs). Coverage is shown on the
              Insights page; events without gas data are excluded from net-profit charts
              but still appear in gross-profit aggregates.
            </li>
            <li>
              <span className="text-text-primary font-medium">MEV detection not yet implemented.</span>{" "}
              We do not currently flag whether a liquidation went through Flashbots or
              another private mempool. This is on the roadmap.
            </li>
            <li>
              <span className="text-text-primary font-medium">Bot clustering not yet implemented.</span>{" "}
              What looks like dozens of independent liquidators may actually be a small
              number of operators running multiple bots. Wallet clustering by funding
              source is on the roadmap.
            </li>
            <li>
              <span className="text-text-primary font-medium">Morpho bad debt is tracked but not yet visualised.</span>{" "}
              Unlike Aave and Spark, Morpho Blue can end up in a state where the
              liquidator couldn&apos;t fully cover a position. The remainder is
              &ldquo;socialised&rdquo; as bad debt across that market&apos;s lenders. We
              store this as <code className="text-accent font-mono">bad_debt_assets</code>{" "}
              and <code className="text-accent font-mono">bad_debt_usd</code> per event
              but don&apos;t yet surface it on the charts. A dedicated bad debt view is
              on the roadmap.
            </li>
            <li>
              <span className="text-text-primary font-medium">Morpho exotic tokens may have less reliable pricing.</span>{" "}
              Some Morpho markets use tokens (Pendle PTs, niche LRTs, isolated pool
              stablecoins) that the Aave oracle doesn&apos;t support. For these we fall
              back to DeFiLlama historical prices, which have a ~1-hour granularity
              and can miss very short-lived price spikes. This can slightly skew net
              profit for liquidations in those specific markets.
            </li>
            <li>
              <span className="text-text-primary font-medium">Fluid Smart Vaults (T2/T3/T4) are not yet covered.</span>{" "}
              Fluid ships four vault types: T1 uses direct ERC20 collateral and debt,
              while T2, T3, and T4 use &ldquo;smart collateral&rdquo; or &ldquo;smart debt&rdquo;
              powered by Fluid&apos;s DEX. The pricing logic for smart vaults requires
              aggregating multiple underlying pool positions, which our first iteration
              doesn&apos;t support. We mark these vaults as unresolved and skip their
              liquidations. Adding T2/T3/T4 coverage is on the roadmap.
            </li>
            <li>
              <span className="text-text-primary font-medium">Ethereum mainnet only.</span>{" "}
              L2 deployments (Aave on Arbitrum, Optimism, Base, etc.) and other
              lending protocols (Compound V3, Venus, etc.) are not yet indexed.
            </li>
          </ul>
        </div>
      </section>

      {/* Section 10: Tech Stack */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-accent">10. Tech Stack</h2>
        <div className="tui-card bg-card-bg border border-card-border rounded p-4 text-[12px] text-text-secondary leading-relaxed">
          <ul className="grid grid-cols-2 gap-y-2 gap-x-6 ml-4 list-disc">
            <li><span className="text-text-primary">RPC client:</span> Viem (with public RPC fallbacks)</li>
            <li><span className="text-text-primary">Database:</span> PostgreSQL (Neon serverless)</li>
            <li><span className="text-text-primary">Frontend:</span> Next.js 14 App Router</li>
            <li><span className="text-text-primary">Charts:</span> Recharts (SVG-based)</li>
            <li><span className="text-text-primary">Styling:</span> Tailwind CSS</li>
            <li><span className="text-text-primary">Language:</span> TypeScript</li>
            <li><span className="text-text-primary">Screenshots:</span> html-to-image (SVG-native, 2x retina)</li>
            <li><span className="text-text-primary">Hosting:</span> Vercel</li>
          </ul>
        </div>
      </section>

      {/* Footer note */}
      <div className="border-t border-card-border pt-6 text-[11px] text-text-tertiary leading-relaxed">
        <p>
          Found a bug or have a methodology question? The dashboard is open research.
          We want it to be correct. Reach out and we&apos;ll investigate any discrepancy.
        </p>
        <p className="mt-2">
          <Link href="/" className="text-accent hover:underline">← Back to dashboard</Link>
        </p>
      </div>
    </main>
  )
}
