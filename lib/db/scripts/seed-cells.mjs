import pg from "pg";

const { Pool } = pg;
const CELL_COUNT = 1_000_000;

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is required to seed the cell board.");
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });

try {
  const inserted = await pool.query(`
    INSERT INTO revela_cells (id, prize_value_cents, prize_kind)
    SELECT
      id,
      590 + ((id * 37) % 95) * 100,
      CASE (id % 7)
        WHEN 0 THEN 'image'::revela_prize_kind
        WHEN 1 THEN 'stat'::revela_prize_kind
        WHEN 2 THEN 'icon'::revela_prize_kind
        WHEN 3 THEN 'stat'::revela_prize_kind
        WHEN 4 THEN 'image'::revela_prize_kind
        WHEN 5 THEN 'stat'::revela_prize_kind
        ELSE 'image'::revela_prize_kind
      END
    FROM generate_series(0, 999999) AS cells(id)
    ON CONFLICT (id) DO NOTHING
  `);
  const verification = await pool.query(
    "SELECT count(*)::int AS total FROM revela_cells WHERE id >= 0 AND id < 1000000",
  );
  const total = verification.rows[0]?.total;
  if (total !== CELL_COUNT) {
    throw new Error(`Cell seed verification failed: expected ${CELL_COUNT}, found ${total}.`);
  }
  process.stdout.write(
    `Cell board ready: ${total.toLocaleString("en-US")} rows (${inserted.rowCount ?? 0} inserted).\n`,
  );
} finally {
  await pool.end();
}
