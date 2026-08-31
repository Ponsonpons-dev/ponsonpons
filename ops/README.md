# $POP ops

## Keeper (`keeper.mjs`)

Permissionless maintenance loop: retries graduations the crossing buy
couldn't finish (gas-starved auto-graduation), seeds pools for launches
stuck in `Swept`, and sweeps curve fee buckets so burns and escrow credits
land regularly. Everything it calls is callable by anyone. the keeper is a
convenience, not a trust assumption, and `AutoGraduationFailed` events plus
`Swept`-phase age are the metrics to alert on.

```bash
RPC_URL=... KEEPER_PRIVATE_KEY=0x... FACTORY=0x... INDEXER_URL=http://localhost:42069 \
  node keeper.mjs
```

Run under systemd/pm2/cron; it is stateless and safe to run in parallel
(second caller's tx just reverts harmlessly).

The hook's meme-side fee conversions (`sweepPoolFees` with a real
`minConversionQuoteOut`) are gated to the rotatable `feeSweepOperator` and
need price-aware sizing, run those from a separate operator process once
graduated pools accrue meaningful token-side fees. Quote-side pool sweeps
are creator-callable from the UI already.

## Monitoring checklist (Phase 4)

- `AutoGraduationFailed` events → keeper lag alert.
- Launches in `Swept` older than 1h → investigate before the 14-day rescue
  window ever matters.
- Indexer head vs chain head drift.
- Timelock queue: any queued operation is a 48h public notice, page on it.
- Sentry on the frontend; the indexer exposes Ponder's /health, /ready.
