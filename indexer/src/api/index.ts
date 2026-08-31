import { db } from "ponder:api";
import schema from "ponder:schema";
import { Hono } from "hono";
import { client, desc, eq, graphql } from "ponder";

/**
 * $POP indexer API.
 * - /graphql, full GraphQL over the schema (explorer UI in dev).
 * - /sql/*, @ponder/client endpoint with **live queries** over SSE: the
 *   frontend subscribes with `client.live(...)` for real-time trades,
 *   prices, and progress bars without polling.
 * - A few hot REST endpoints for the frontend's initial paints.
 */
const app = new Hono();

app.use("/sql/*", client({ db, schema }));
app.use("/graphql", graphql({ db, schema }));
app.use("/", graphql({ db, schema }));

// Latest trades for a launch (trades feed initial paint).
app.get("/launches/:token/trades", async (c) => {
  const token = c.req.param("token").toLowerCase() as `0x${string}`;
  const rows = await db
    .select()
    .from(schema.trade)
    .where(eq(schema.trade.token, token))
    .orderBy(desc(schema.trade.timestamp))
    .limit(100);
  return c.json(rows.map(serialize));
});

// OHLC candles for the chart.
app.get("/launches/:token/candles/:interval", async (c) => {
  const token = c.req.param("token").toLowerCase() as `0x${string}`;
  const interval = Number(c.req.param("interval"));
  const rows = await db
    .select()
    .from(schema.candle)
    .where(eq(schema.candle.token, token))
    .orderBy(desc(schema.candle.bucketStart))
    .limit(500);
  return c.json(rows.filter((r) => r.interval === interval).map(serialize));
});

// Quote-token leaderboard: the burn flywheel scoreboard.
app.get("/quotes", async (c) => {
  const rows = await db.select().from(schema.quote).orderBy(desc(schema.quote.totalBurned));
  return c.json(rows.map(serialize));
});

// Top holders for a launch.
app.get("/launches/:token/holders", async (c) => {
  const token = c.req.param("token").toLowerCase() as `0x${string}`;
  const rows = await db
    .select()
    .from(schema.holder)
    .where(eq(schema.holder.token, token))
    .orderBy(desc(schema.holder.balance))
    .limit(50);
  return c.json(rows.map(serialize));
});

function serialize(row: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(row).map(([k, v]) => [k, typeof v === "bigint" ? v.toString() : v]),
  );
}

export default app;
