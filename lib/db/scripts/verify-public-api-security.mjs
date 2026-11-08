import pg from "pg";

const { Pool } = pg;
const protectedRoles = ["anon", "authenticated", "service_role"];
const tablePrivileges = ["SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE", "REFERENCES", "TRIGGER"];
const sequencePrivileges = ["USAGE", "SELECT", "UPDATE"];

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is required to verify public API security.");
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

try {
  const { rows } = await pool.query(`
    SELECT
      c.relname AS table_name,
      c.relrowsecurity AS rls_enabled,
      c.relforcerowsecurity AS rls_forced,
      (
        SELECT count(*)
        FROM pg_policies p
        WHERE p.schemaname = n.nspname AND p.tablename = c.relname
      )::int AS policy_count,
      ${protectedRoles.map((role) => `
        (${tablePrivileges.map((privilege) =>
    `NOT has_table_privilege('${role}', c.oid, '${privilege}')`,
  ).join(" AND ")}) AS ${role}_blocked`).join(",")}
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind IN ('r', 'p')
      AND left(c.relname, 7) = 'revela_'
    ORDER BY c.relname
  `);

  if (rows.length === 0) {
    throw new Error("No public.revela_* tables were found.");
  }

  const insecureTables = rows.filter((row) =>
    !row.rls_enabled
    || !row.rls_forced
    || row.policy_count !== 0
    || protectedRoles.some((role) => !row[`${role}_blocked`]),
  );
  if (insecureTables.length > 0) {
    throw new Error(
      `Public API security check failed for: ${insecureTables.map((row) => row.table_name).join(", ")}`,
    );
  }

  const { rows: sequences } = await pool.query(`
    SELECT
      c.relname AS sequence_name,
      ${protectedRoles.map((role) => `
        (${sequencePrivileges.map((privilege) =>
    `NOT has_sequence_privilege('${role}', c.oid, '${privilege}')`,
  ).join(" AND ")}) AS ${role}_blocked`).join(",")}
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'S'
    ORDER BY c.relname
  `);
  const insecureSequences = sequences.filter((sequence) =>
    protectedRoles.some((role) => !sequence[`${role}_blocked`]),
  );
  if (insecureSequences.length > 0) {
    throw new Error(
      `Public API security check failed for sequences: ${insecureSequences.map((row) => row.sequence_name).join(", ")}`,
    );
  }

  const { rows: functions } = await pool.query(`
    SELECT
      p.proname AS function_name,
      ${protectedRoles.map((role) =>
    `NOT has_function_privilege('${role}', p.oid, 'EXECUTE') AS ${role}_blocked`,
  ).join(",")}
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
    ORDER BY p.proname
  `);
  const insecureFunctions = functions.filter((routine) =>
    protectedRoles.some((role) => !routine[`${role}_blocked`]),
  );
  if (insecureFunctions.length > 0) {
    throw new Error(
      `Public API security check failed for functions: ${insecureFunctions.map((row) => row.function_name).join(", ")}`,
    );
  }

  const { rows: schemaAccess } = await pool.query(`
    SELECT r.rolname, has_schema_privilege(r.rolname, 'public', 'CREATE') AS can_create
    FROM pg_roles r
    WHERE r.rolname = ANY($1::text[])
  `, [protectedRoles]);
  const rolesWithCreate = schemaAccess.filter((role) => role.can_create);
  if (rolesWithCreate.length > 0 || schemaAccess.length !== protectedRoles.length) {
    throw new Error(
      `Public API security check failed for schema CREATE access: ${rolesWithCreate.map((row) => row.rolname).join(", ") || "a protected role is missing"}`,
    );
  }

  const { rows: defaults } = await pool.query(`
    SELECT EXISTS (
      SELECT 1
      FROM pg_default_acl d
      CROSS JOIN LATERAL aclexplode(d.defaclacl) acl
      LEFT JOIN pg_roles grantee ON grantee.oid = acl.grantee
      WHERE d.defaclrole = (SELECT oid FROM pg_roles WHERE rolname = 'postgres')
        AND (d.defaclnamespace = 0 OR d.defaclnamespace = 'public'::regnamespace)
        AND (acl.grantee = 0 OR grantee.rolname = ANY($1::text[]))
    ) AS has_public_role_defaults
  `, [protectedRoles]);

  if (defaults[0]?.has_public_role_defaults) {
    throw new Error("Public API security check failed: postgres has broad default privileges.");
  }

  process.stdout.write(
    `Public API security verified for ${rows.length} Revela tables, ${sequences.length} sequences, and ${functions.length} functions; anon, authenticated, and service_role are blocked.\n`,
  );
} finally {
  await pool.end();
}
