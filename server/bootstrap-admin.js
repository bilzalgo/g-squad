import { randomUUID } from 'node:crypto';
import { getPool, withTransaction } from './db.js';
import { hashToken, newToken, requireEncryptionKey } from './security.js';

const firstId = process.env.CEO_ONE_ID?.trim();
const secondId = process.env.CEO_TWO_ID?.trim();
if (!firstId || !secondId || firstId === secondId) {
  throw new Error('Set two distinct CEO_ONE_ID and CEO_TWO_ID values before bootstrapping.');
}
if (!/^[A-Za-z0-9_-]{3,40}$/.test(firstId) || !/^[A-Za-z0-9_-]{3,40}$/.test(secondId)) {
  throw new Error('CEO account IDs must contain 3-40 letters, numbers, underscores, or hyphens.');
}
requireEncryptionKey();

const firstEnrollmentToken = newToken(24);
const secondEnrollmentToken = newToken(24);
const pool = getPool();
try {
  await withTransaction(async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(71350421)');
    const { rows } = await client.query("SELECT count(*)::int AS count FROM admin_accounts WHERE role = 'CEO'");
    if (rows[0].count !== 0) throw new Error('CEO initialization has already been performed.');
    for (const [accountId, enrollmentToken] of [
      [firstId, firstEnrollmentToken],
      [secondId, secondEnrollmentToken],
    ]) {
      await client.query(
        `INSERT INTO admin_accounts
           (id, account_id, display_name, role, status, enrollment_token_hash, enrollment_expires_at)
         VALUES ($1, $2, $2, 'CEO', 'enrollment_pending', $3, now() + interval '24 hours')`,
        [randomUUID(), accountId, hashToken(enrollmentToken)],
      );
    }
    await client.query(
      `INSERT INTO audit_logs (actor_label, actor_role, action_type, details, result, request_id)
       VALUES ('SYSTEM:bootstrap', 'SYSTEM', 'admin.ceo.bootstrap', $1, 'success', $2)`,
      [JSON.stringify({ accountIds: [firstId, secondId], status: 'enrollment_pending' }), randomUUID()],
    );
  });
  process.stdout.write([
    'CEO accounts created in enrollment-pending state. Setup codes expire in 24 hours and are shown once.',
    `${firstId} setup code: ${firstEnrollmentToken}`,
    `${secondId} setup code: ${secondEnrollmentToken}`,
    'Each CEO enters their own account ID in the app, continues, then chooses "First time? Set up authenticator" and enters their one-time setup code.',
    'The app will show a one-time authenticator secret/URI. Add it to Google Authenticator and verify its current six-digit code to activate the account.',
    '',
  ].join('\n'));
} finally {
  await pool.end();
}
