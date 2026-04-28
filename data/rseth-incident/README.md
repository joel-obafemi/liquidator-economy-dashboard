# rsETH Liquidation Vacuum — CSV exports

Snapshots of the data shown on `/research/rseth-incident` in the
Liquidator Economy Terminal dashboard. Sourced from the production API
at https://liquidator-economy-dashboard.vercel.app.

## Files

| File | Description |
|---|---|
| `01_headline_kpis.csv` | Event window vs. all-time baseline metrics |
| `02_top_50_bots_event_window_participation.csv` | Top-50 Aave V3 + Morpho liquidators with rsETH-window flags |
| `03_historical_rseth_pairs.csv` | Per-protocol-pair history of rsETH liquidations |
| `04_daily_timeline_pre_event_through_post_event.csv` | Daily counts ±30 days around the event window |
| `05_system_wide_event_window_breakdown.csv` | Number of liquidations per protocol during the event window (any asset) |
| `06_hourly_bad_debt_formation_aave_v3.csv` | Hourly aggregates of rsETH-collateral users on Aave V3 (bad debt formation) — empty until snapshot scan completes |

## Definitions

- **Event window**: 2026-04-18 00:00 UTC → 2026-04-25 23:59 UTC (the 7 days following the rsETH depeg)
- **Bad debt** (USD): `max(0, total_debt_usd − total_collateral_usd)` summed over underwater positions
- **Active users**: addresses with non-zero collateral or debt on Aave V3 at the snapshot block
- **Underwater users**: subset of active users with debt > collateral
- **Aave V3 base unit**: divided by 1e8 to get USD

## How the hourly curve is computed

For every hour in the analysis window (2026-04-17 12:00 → 2026-04-26 00:00 UTC),
`scripts/snapshot-rseth-aave.ts`:
1. Resolves the corresponding archive block via a binary search anchor + 300-blocks/hour estimate.
2. Calls `Pool.getUserAccountData(user)` on Aave V3 mainnet (`0x87870bca3f3fd6335c3f4ce8392d69350b4fa4e2`)
   at that block for every address that has ever held aRsETH (`0x2d62109243b87c4ba3ee7ba1d91b0dd0a074d7b1`).
3. Aggregates totalCollateralBase, totalDebtBase, and the residual bad debt.

Calls are issued via Alchemy archive RPC, batched 10 per request with a
1-second inter-batch delay to stay under the free-tier 330 CU/sec cap.
