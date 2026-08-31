# $POP indexer

[Ponder](https://ponder.sh) app indexing the $POP launchpad on Robinhood
Chain (4663) into Postgres, serving GraphQL + live SSE queries + hot REST
endpoints for the frontend.

## What it tracks

- **launches**: full metadata, per-launch fee/cashback config, live price
  (quote-per-token, 1e18-scaled), curve progress, volume, trade count,
  holder count, burned quote, creator fees, graduation phase/pool/position.
- **trades**: every curve buy/sell (with fee, creator fee, rebate) and
  every post-graduation V4 pool swap (via the canonical PoolManager `Swap`
  event filtered to $POP pool ids), unified in one feed.
- **candles**: 1m/15m/1h/1d OHLCV in quote terms, for lightweight-charts.
- **holders**: balances from launch-token transfers (dynamic factory
  pattern), top-holder queries.
- **quotes**: the registry's listed quote tokens with the leaderboard the
  whole product is pitched on: launches, graduations, volume, and **total
  quote burned** per quote community, plus re-peg history.
- **creator stats**: fees earned, rebates and burns funded, per creator ×
  quote.

## Run

```bash
cp .env.example .env      # fill addresses from ../contracts/deployments/4663.json
npm install
npm run dev               # embedded PGlite + hot reload + GraphQL explorer

# production
docker compose up -d      # Postgres + indexer on :42069
```

## API

- `GET /graphql`: GraphQL over the whole schema.
- `/sql/*`: `@ponder/client` endpoint; the frontend uses `client.live()`
  for real-time trades/price/progress over SSE (no websocket infra needed).
- `GET /launches/:token/trades` · `GET /launches/:token/candles/:interval`
  · `GET /launches/:token/holders` · `GET /quotes`: hot paths for initial
  page paints.

Prices are stored in quote terms only. ETH/USD conversion belongs to the
API/frontend layer (quote→ETH via the registry adapter's TWAP, ETH→USD via
any price API) so the on-chain-derived data stays assumption-free.
