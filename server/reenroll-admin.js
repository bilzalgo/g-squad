import { randomUUID } from 'node:crypto';
import { getPool, withTransaction } from './db.js';
import { hashToken, newToken } from './security.js';

const accountId = process.argv[2]?.trim();
if (!accountId || !/^[A-Za-z0-9_-]{3,40}$/.test(accountId)) {
  throw new Error('Usage: npm run admin:reenroll -- ACCOUNT_ID');
}

const enrollmentToken = newToken(24);
const pool = getPool();
try {
  const account = await withTransaction(async (client) => {
    const { rows } = await client.query(
      `SELECT id, account_id AS "accountId", role, status
       FROM admin_accounts WHERE account_id = $1 FOR UPDATE`,
      [accountId],
    );
    const existing = rows[0];
    if (!existing) throw new Error(`Admin account "${accountId}" was not found.`);
    if (existing.status !== 'enrollment_pending') {
      throw new Error(`Admin account "${accountId}" is not pending enrollment.`);
    }

    const { rows: updated } = await client.query(
      `UPDATE admin_accounts SET enrollment_token_hash = $2,
         enrollment_expires_at = now() + interval '24 hours',
         totp_secret_encrypted = NULL, last_totp_counter = NULL, updated_at = now()
       WHERE id = $1
       RETURNING account_id AS "accountId", role`,
      [existing.id, hashToken(enrollmentToken)],
    );
    await client.query(
      `INSERT INTO audit_logs
         (actor_label, actor_role, action_type, affected_account_id, details, result, request_id)
       VALUES ('SYSTEM:reenroll', 'SYSTEM', 'admin.enrollment.reissued', $1, $2, 'success', $3)`,
      [
        accountId,
        JSON.stringify({ role: updated[0].role, status: 'enrollment_pending' }),
        randomUUID(),
      ],
    );
    return updated[0];
  });

  process.stdout.write([
    `A new enrollment code was created for ${account.role} account ${account.accountId}.`,
    'It replaces any earlier code and expires in 24 hours. Deliver it through a secure channel.',
    `Enrollment code: ${enrollmentToken}`,
    '',
  ].join('\n'));
} finally {
  await pool.end();
}
