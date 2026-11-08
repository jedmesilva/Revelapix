import pg from "pg";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is required to seed chance plans.");
}

const plans = [
  { id: "chance-pack-1", chances: 1, priceCents: 500, sortOrder: 10 },
  { id: "chance-pack-5", chances: 5, priceCents: 2000, sortOrder: 20 },
  { id: "chance-pack-10", chances: 10, priceCents: 3500, sortOrder: 30 },
  { id: "chance-pack-25", chances: 25, priceCents: 7500, sortOrder: 40 },
];

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

try {
  let inserted = 0;
  for (const plan of plans) {
    const result = await pool.query(
      `INSERT INTO revela_chance_plans (id, chances, price_cents, is_active, sort_order)
       VALUES ($1, $2, $3, true, $4)
       ON CONFLICT (id) DO NOTHING`,
      [plan.id, plan.chances, plan.priceCents, plan.sortOrder],
    );
    inserted += result.rowCount ?? 0;
  }
  process.stdout.write(`Chance plans seeded. New rows: ${inserted}.\n`);
} finally {
  await pool.end();
}
