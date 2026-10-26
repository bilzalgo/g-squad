import { createServer } from 'node:http';
import { createReadStream, existsSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { query, withTransaction } from './db.js';
import {
  decryptSecret,
  encryptSecret,
  hashToken,
  newToken,
  parseCookies,
  permissions,
} from './security.js';
import { generateTotpSecret, provisioningUri, verifyTotp } from './totp.js';
import { getDerivStatus } from './providers/deriv.js';
import { applicationSettings, normalizeInvestorProfile, normalizeSettingValue } from './admin-config.js';
import {
  normalizePlisioInvoice,
  normalizePlisioOperation,
  plisioRequest,
  quotePlisioWithdrawal,
  verifyPlisioCallback,
} from './providers/plisio.js';

const port = Number(process.env.PORT || 3000);
const isProduction = process.env.NODE_ENV === 'production';
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const staticRoot = resolve(projectRoot, 'dist');
const sessionCookie = 'gs_admin_session';
const csrfCookie = 'gs_admin_csrf';
const sessionDurationHours = 8;

const server = createServer(async (request, response) => {
  const requestId = randomUUID();
  setSecurityHeaders(response);

  try {
    const url = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`);
    if (url.pathname.startsWith('/api/')) {
      await handleApi(request, response, url, requestId);
      return;
    }
    await serveFrontend(request, response, url.pathname);
  } catch (error) {
    console.error(`[${requestId}] Request failed: ${safeErrorMessage(error)}`);
    sendJson(response, error.status || 500, {
      error: error.status ? error.message : 'The request could not be completed.',
      requestId,
    });
  }
});

server.listen(port, () => {
  console.log(`G-Squad admin server listening on port ${port}.`);
});

async function handleApi(request, response, url, requestId) {
  if (request.method === 'OPTIONS') {
    response.writeHead(204, { Allow: 'GET, POST, PATCH, OPTIONS' });
    response.end();
    return;
  }
  const path = url.pathname;
  if (path === '/api/health' && request.method === 'GET') {
    let database = 'unavailable';
    try {
      await query('SELECT 1');
      database = 'connected';
    } catch {
      database = process.env.DATABASE_URL ? 'unavailable' : 'not_configured';
    }
    sendJson(response, 200, {
      status: database === 'connected' ? 'ready' : 'setup_required',
      database,
    });
    return;
  }
  if (path === '/api/webhooks/plisio' && request.method === 'POST') {
    await handlePlisioWebhook(request, response, requestId);
    return;
  }
  if (['POST', 'PATCH', 'DELETE'].includes(request.method)) validateOrigin(request);

  if (path === '/api/auth/login' && request.method === 'POST') {
    await login(request, response, requestId);
    return;
  }
  if (path === '/api/auth/session' && request.method === 'GET') {
    await currentSession(request, response);
    return;
  }
  if (path === '/api/auth/logout' && request.method === 'POST') {
    const session = await authenticate(request);
    requireCsrf(request, session);
    await query('DELETE FROM admin_sessions WHERE token_hash = $1', [session.tokenHash]);
    await addAudit(session.account, 'admin.logout', {}, 'success', requestId);
    clearCookies(response);
    sendJson(response, 200, { ok: true });
    return;
  }
  if (path === '/api/enrollment/start' && request.method === 'POST') {
    await startEnrollment(request, response);
    return;
  }
  if (path === '/api/enrollment/complete' && request.method === 'POST') {
    await completeEnrollment(request, response, requestId);
    return;
  }

  const session = await authenticate(request);
  if (request.method !== 'GET') requireCsrf(request, session);
  const route = `${request.method} ${path}`;

  if (route === 'GET /api/dashboard') {
    requireAnyPermission(session.account, ['dashboard:read']);
    await getDashboard(response);
  } else if (route === 'GET /api/notifications') {
    const { rows } = await query(
      `SELECT id, message, related_type AS "relatedType", related_id AS "relatedId",
              read_at AS "readAt", created_at AS "createdAt"
       FROM notifications
       WHERE account_id = $1
       ORDER BY created_at DESC
       LIMIT 50`,
      [session.account.id],
    );
    sendJson(response, 200, { notifications: rows });
  } else if (/^POST \/api\/notifications\/[0-9a-f-]+\/read$/.test(route)) {
    const notificationId = path.split('/')[3];
    if (!isUuid(notificationId)) throw new HttpError(400, 'Notification ID is invalid.');
    const { rowCount } = await query(
      `UPDATE notifications SET read_at = COALESCE(read_at, now())
       WHERE id = $1 AND account_id = $2`,
      [notificationId, session.account.id],
    );
    if (!rowCount) throw new HttpError(404, 'Notification was not found.');
    sendJson(response, 200, { ok: true });
  } else if (route === 'GET /api/staff') {
    requireCeo(session.account);
    const { rows } = await query(
      `SELECT account_id AS "accountId", display_name AS "displayName", role, status, permissions,
              created_at AS "createdAt", updated_at AS "updatedAt"
       FROM admin_accounts WHERE role = 'STAFF' ORDER BY created_at DESC LIMIT 250`,
    );
    sendJson(response, 200, { staff: rows });
  } else if (/^GET \/api\/staff\/[A-Za-z0-9_-]+\/activity$/.test(route)) {
    requireCeo(session.account);
    await getStaffActivity(response, path.split('/')[3], session.account, requestId);
  } else if (route === 'POST /api/staff') {
    requireCeo(session.account);
    await createStaff(request, response, session.account, requestId);
  } else if (/^PATCH \/api\/staff\/[A-Za-z0-9_-]+$/.test(route)) {
    requireCeo(session.account);
    await updateStaff(request, response, session.account, path.split('/').at(-1), requestId);
  } else if (route === 'GET /api/support/investors') {
    requireAnyPermission(session.account, ['support:read', 'support:respond']);
    const search = (url.searchParams.get('q') || '').trim().slice(0, 100);
    const { rows } = await query(
      `SELECT account_id AS "accountId", display_name AS "displayName", status
       FROM investors
       WHERE $1 = '' OR account_id ILIKE '%' || $1 || '%' OR display_name ILIKE '%' || $1 || '%'
       ORDER BY display_name, account_id LIMIT 500`,
      [search],
    );
    sendJson(response, 200, { investors: rows });
  } else if (route === 'GET /api/support/notes') {
    requireAnyPermission(session.account, ['support:read', 'support:respond']);
    const accountId = (url.searchParams.get('accountId') || '').trim();
    if (!accountId) {
      sendJson(response, 200, { notes: [] });
      return;
    }
    const { rows } = await query(
      `SELECT n.id, n.note, n.escalated, n.created_at AS "createdAt",
              a.account_id AS "authorAccountId", a.display_name AS "authorName"
       FROM support_notes n
       JOIN investors i ON i.id = n.investor_id
       JOIN admin_accounts a ON a.id = n.author_account_id
       WHERE i.account_id = $1
       ORDER BY n.created_at DESC, n.id DESC LIMIT 250`,
      [accountId],
    );
    await addAudit(session.account, 'support.notes.viewed', { investorAccountId: accountId }, 'success', requestId, {
      affectedAccountId: accountId,
    });
    sendJson(response, 200, { notes: rows });
  } else if (/^POST \/api\/support\/investors\/[A-Za-z0-9_-]+\/notes$/.test(route)) {
    requireAnyPermission(session.account, ['support:respond']);
    await createSupportNote(request, response, session.account, path.split('/')[4], requestId);
  } else if (route === 'GET /api/investors') {
    requireAnyPermission(session.account, ['investors:read', 'investors:manage']);
    const { rows } = await query(
      `SELECT i.account_id AS "accountId", i.display_name AS "displayName",
              i.username, i.email, i.phone, i.country, i.anonymized_at AS "anonymizedAt", i.status,
              i.created_at AS "createdAt", COALESCE(w.available_balance, 0)::text AS "availableBalance",
              COALESCE(w.reserved_balance, 0)::text AS "reservedBalance"
       FROM investors i LEFT JOIN wallets w ON w.investor_id = i.id
       ORDER BY i.created_at DESC LIMIT 250`,
    );
    sendJson(response, 200, { investors: rows });
  } else if (/^GET \/api\/investors\/[A-Za-z0-9_-]+$/.test(route)) {
    requireAnyPermission(session.account, ['investors:read', 'investors:manage']);
    await getInvestorDetails(response, path.split('/').at(-1), session.account, requestId, url);
  } else if (/^PATCH \/api\/investors\/[A-Za-z0-9_-]+$/.test(route)) {
    requireCeo(session.account);
    await updateInvestor(request, response, session.account, path.split('/').at(-1), requestId);
  } else if (/^POST \/api\/investors\/[A-Za-z0-9_-]+\/wallet-adjustments$/.test(route)) {
    requireCeo(session.account);
    await adjustWallet(request, response, session.account, path.split('/')[3], requestId);
  } else if (/^POST \/api\/transactions\/(deposit|withdrawal)\/[0-9a-f-]+\/approval-requests$/.test(route)) {
    requireAnyPermission(session.account, ['payments:review']);
    await createApprovalRequest(request, response, session.account, path.split('/')[3], path.split('/')[4], requestId);
  } else if (route === 'POST /api/deposits') {
    requireAnyPermission(session.account, ['payments:review']);
    await createDeposit(request, response, session.account, requestId);
  } else if (/^POST \/api\/deposits\/[0-9a-f-]+\/check$/.test(route)) {
    requireAnyPermission(session.account, ['payments:review']);
    await checkDeposit(response, path.split('/')[3], session.account, requestId);
  } else if (route === 'POST /api/withdrawals') {
    requireAnyPermission(session.account, ['payments:review']);
    await createWithdrawal(request, response, session.account, requestId);
  } else if (/^POST \/api\/withdrawals\/[0-9a-f-]+\/check$/.test(route)) {
    requireAnyPermission(session.account, ['payments:review', 'payments:execute']);
    await checkWithdrawal(response, path.split('/')[3], session.account, requestId);
  } else if (route === 'GET /api/transactions') {
    requireAnyPermission(session.account, ['payments:read', 'payments:review']);
    await getTransactions(response, url.searchParams.get('kind'), url.searchParams.get('page'));
  } else if (route === 'GET /api/payment-investors') {
    requireAnyPermission(session.account, ['payments:read', 'payments:review']);
    const { rows } = await query(
      `SELECT i.account_id AS "accountId", i.display_name AS "displayName",
              COALESCE(w.available_balance, 0)::text AS "availableBalance"
       FROM investors i LEFT JOIN wallets w ON w.investor_id = i.id
       WHERE i.status = 'active' ORDER BY i.display_name, i.account_id LIMIT 500`,
    );
    sendJson(response, 200, { investors: rows });
  } else if (/^POST \/api\/approvals\/[0-9a-f-]+\/decision$/.test(route)) {
    requireCeo(session.account);
    await decideApproval(request, response, session.account, path.split('/')[3], requestId);
  } else if (/^POST \/api\/approvals\/[0-9a-f-]+\/execute$/.test(route)) {
    requireAnyPermission(session.account, ['payments:execute']);
    await executeApproval(response, session.account, path.split('/')[3], requestId);
  } else if (route === 'GET /api/audit/export') {
    requireCeo(session.account);
    await exportAudit(response, url, session.account, requestId);
  } else if (route === 'GET /api/approvals') {
    requireAnyPermission(session.account, ['payments:review', 'payments:execute', 'staff:manage']);
    const { rows } = await query(
      `SELECT ar.id, ar.transaction_type AS "transactionType", ar.transaction_id AS "transactionId",
              ar.requested_by AS "requestedById", requester.account_id AS "requestedBy",
              requester.display_name AS "requesterName", ar.proposed_action AS "proposedAction",
              ar.reason, ar.status, ar.decided_at AS "decidedAt",
              ar.decision_reason AS "decisionReason", ar.created_at AS "createdAt",
              CASE WHEN ar.transaction_type = 'deposit' THEN (
                SELECT jsonb_build_object(
                  'investorAccountId', i.account_id, 'investorName', i.display_name,
                  'amountUsd', d.amount_usd::text, 'currency', d.currency,
                  'status', d.status, 'providerReference', d.provider_reference,
                  'providerStatus', d.provider_status
                ) FROM deposits d JOIN investors i ON i.id = d.investor_id WHERE d.id = ar.transaction_id
              ) ELSE (
                SELECT jsonb_build_object(
                  'investorAccountId', i.account_id, 'investorName', i.display_name,
                  'amountUsd', w.amount_usd::text, 'currency', w.currency,
                  'network', w.network, 'destination', w.destination, 'status', w.status
                ) FROM withdrawals w JOIN investors i ON i.id = w.investor_id WHERE w.id = ar.transaction_id
              ) END AS "transactionDetails"
       FROM approval_requests ar
       JOIN admin_accounts requester ON requester.id = ar.requested_by
       WHERE ($1::boolean OR ar.requested_by = $2)
       ORDER BY ar.created_at DESC LIMIT 250`,
      [session.account.role === 'CEO', session.account.id],
    );
    sendJson(response, 200, { approvals: rows });
  } else if (route === 'GET /api/audit') {
    requireCeo(session.account);
    await readAudit(response, url, session.account, requestId);
  } else if (route === 'GET /api/trading') {
    requireAnyPermission(session.account, ['trading:read', 'trading:manage', 'staff:manage']);
    const { rows } = await query(
      `SELECT id, external_reference AS "externalReference", status, profit_loss AS "profitLoss",
              created_at AS "createdAt" FROM trades ORDER BY created_at DESC LIMIT 100`,
    );
    sendJson(response, 200, {
      integration: await getDerivStatus(),
      message: 'Live trade execution is disabled. No orders are sent to Deriv.',
      trades: rows,
    });
  } else if (route === 'GET /api/settings') {
    requireCeo(session.account);
    const { rows } = await query(
      `SELECT key, value, updated_at AS "updatedAt" FROM app_settings
       WHERE key = ANY($1::text[]) ORDER BY key`,
      [applicationSettings.map(({ key }) => key)],
    );
    const storedSettings = new Map(rows.map((row) => [row.key, row]));
    sendJson(response, 200, {
      settings: applicationSettings.map((setting) => ({
        ...setting,
        value: storedSettings.get(setting.key)?.value ?? setting.defaultValue,
        updatedAt: storedSettings.get(setting.key)?.updatedAt ?? null,
      })),
      integrations: {
        plisio: process.env.PLISIO_API_KEY ? 'configured' : 'not_configured',
        deriv: process.env.DERIV_APP_ID && process.env.DERIV_API_TOKEN ? 'configured' : 'not_configured',
      },
      note: 'Only non-secret application preferences are editable here. Integration credentials remain server-side; live trading remains disabled.',
    });
  } else if (/^PATCH \/api\/settings\/[a-z_]+$/.test(route)) {
    requireCeo(session.account);
    await updateApplicationSetting(request, response, session.account, path.split('/').at(-1), requestId);
  } else {
    sendJson(response, 404, { error: 'This API route is not available.' });
  }
}

async function createSupportNote(request, response, actor, accountId, requestId) {
  const body = await readJson(request);
  const note = typeof body.note === 'string' ? body.note.trim() : '';
  if (body.escalated !== undefined && typeof body.escalated !== 'boolean') {
    throw new HttpError(400, 'Escalation must be enabled or disabled.');
  }
  const escalated = body.escalated ?? false;
  if (!note || note.length > 4000) {
    throw new HttpError(400, 'Support notes must contain between 1 and 4000 characters.');
  }
  const { rows } = await withTransaction(async (client) => {
    const { rows: investors } = await client.query(
      'SELECT id FROM investors WHERE account_id = $1 FOR UPDATE',
      [accountId],
    );
    const investor = investors[0];
    if (!investor) throw new HttpError(404, 'Investor account was not found.');
    const { rows: saved } = await client.query(
      `INSERT INTO support_notes (investor_id, author_account_id, note, escalated)
       VALUES ($1, $2, $3, $4)
       RETURNING id, note, escalated, created_at AS "createdAt"`,
      [investor.id, actor.id, note, escalated],
    );
    await writeAudit(client, actor, escalated ? 'support.note.escalated' : 'support.note.created', {
      supportNoteId: saved[0].id,
      noteLength: note.length,
      escalated,
    }, 'success', requestId, { affectedAccountId: accountId });
    if (escalated) {
      await client.query(
        `INSERT INTO notifications (account_id, message, related_type, related_id)
         SELECT id, $1, 'support_note', $2 FROM admin_accounts
         WHERE role = 'CEO' AND status = 'active'`,
        [`A support issue for investor ${accountId} was escalated by ${actor.displayName}.`, saved[0].id],
      );
    }
    return { rows: saved };
  });
  sendJson(response, 201, { note: rows[0] });
}

async function login(request, response, requestId) {
  const body = await readJson(request);
  const accountId = typeof body.accountId === 'string' ? body.accountId.trim() : '';
  const code = typeof body.code === 'string' ? body.code : '';
  if (!/^[A-Za-z0-9_-]{3,40}$/.test(accountId) || !/^\d{6}$/.test(code)) {
    sendJson(response, 400, { error: 'Enter your admin account ID and six-digit authenticator code.' });
    return;
  }

  const address = request.socket.remoteAddress || 'unknown';
  const identityKey = hashToken(`identity:${accountId.toLowerCase()}`);
  const addressKey = hashToken(`address:${address}`);
  const limiterKeys = [identityKey, addressKey];
  const attempt = await query(
    `SELECT locked_until FROM auth_login_attempts
     WHERE identity_key = ANY($1::text[]) AND locked_until > now()`,
    [limiterKeys],
  );
  if (attempt.rows.length) {
    sendJson(response, 429, { error: 'Too many attempts. Try again later.' });
    return;
  }

  const { rows } = await query(
    `SELECT id, account_id AS "accountId", display_name AS "displayName", role, status,
            permissions, totp_secret_encrypted AS "totpSecret", last_totp_counter AS "lastCounter",
            session_version AS "sessionVersion"
     FROM admin_accounts WHERE account_id = $1`,
    [accountId],
  );
  const account = rows[0];
  let counter = null;
  if (account?.status === 'active' && account.totpSecret) {
    try {
      counter = verifyTotp(decryptSecret(account.totpSecret), code);
    } catch (error) {
      console.error(`TOTP verification configuration error: ${safeErrorMessage(error)}`);
      sendJson(response, 503, { error: 'Authenticator verification is temporarily unavailable.' });
      return;
    }
  }
  if (!account || account.status !== 'active' || counter === null) {
    const attempts = [];
    for (const limiterKey of limiterKeys) {
      const { rows: values } = await query(
        `INSERT INTO auth_login_attempts (identity_key, failed_count, window_started_at, locked_until)
         VALUES ($1, 1, now(), NULL)
         ON CONFLICT (identity_key) DO UPDATE SET
           failed_count = CASE
             WHEN auth_login_attempts.window_started_at < now() - interval '15 minutes' THEN 1
             ELSE auth_login_attempts.failed_count + 1
           END,
           window_started_at = CASE
             WHEN auth_login_attempts.window_started_at < now() - interval '15 minutes' THEN now()
             ELSE auth_login_attempts.window_started_at
           END,
           locked_until = CASE
             WHEN auth_login_attempts.window_started_at < now() - interval '15 minutes' THEN NULL
             WHEN auth_login_attempts.failed_count + 1 >= 5 THEN now() + interval '15 minutes'
             ELSE auth_login_attempts.locked_until
           END
         RETURNING failed_count, locked_until`,
        [limiterKey],
      );
      attempts.push(values[0]);
    }
    await addAudit(account || null, 'admin.login.failed', { accountId }, 'failure', requestId);
    const locked = attempts.some((value) => value.failed_count >= 5);
    sendJson(response, locked ? 429 : 401, {
      error: locked
        ? 'Too many attempts. Try again later.'
        : 'Account ID or authenticator code is incorrect.',
    });
    return;
  }

  const sessionToken = newToken();
  const csrfToken = newToken(24);
  try {
    await withTransaction(async (client) => {
      const updated = await client.query(
        `UPDATE admin_accounts SET last_totp_counter = $2
         WHERE id = $1 AND status = 'active'
           AND (last_totp_counter IS NULL OR last_totp_counter < $2)
         RETURNING id`,
        [account.id, counter],
      );
      if (updated.rowCount !== 1) throw new Error('Authenticator code has already been used.');
      await client.query(
        `INSERT INTO admin_sessions (token_hash, account_id, account_version, csrf_hash, expires_at)
         VALUES ($1, $2, $3, $4, now() + interval '${sessionDurationHours} hours')`,
        [hashToken(sessionToken), account.id, account.sessionVersion, hashToken(csrfToken)],
      );
      await client.query('DELETE FROM auth_login_attempts WHERE identity_key = $1', [identityKey]);
      await writeAudit(client, account, 'admin.login.success', {}, 'success', requestId);
    });
  } catch (error) {
    if (error.message.includes('already been used')) {
      sendJson(response, 401, { error: 'That authenticator code has already been used. Wait for a new code.' });
      return;
    }
    throw error;
  }
  setCookie(response, sessionCookie, sessionToken, { httpOnly: true, maxAge: sessionDurationHours * 60 * 60 });
  setCookie(response, csrfCookie, csrfToken, { httpOnly: false, maxAge: sessionDurationHours * 60 * 60 });
  sendJson(response, 200, { account: publicAccount(account), csrfToken });
}

async function currentSession(request, response) {
  try {
    const session = await authenticate(request);
    const csrfToken = parseCookies(request.headers.cookie)[csrfCookie];
    sendJson(response, 200, {
      account: publicAccount(session.account),
      csrfToken: csrfToken || null,
    });
  } catch (error) {
    if (error.status !== 401) throw error;
    clearCookies(response);
    sendJson(response, 200, { account: null, csrfToken: null });
  }
}

async function startEnrollment(request, response) {
  const body = await readJson(request);
  const accountId = typeof body.accountId === 'string' ? body.accountId.trim() : '';
  const token = typeof body.enrollmentToken === 'string' ? body.enrollmentToken.trim() : '';
  if (!token || token.length > 100) {
    sendJson(response, 400, { error: 'Enter the account ID and valid enrollment code.' });
    return;
  }
  const secret = generateTotpSecret();
  const { rows } = await query(
    `UPDATE admin_accounts
     SET totp_secret_encrypted = $3, updated_at = now()
     WHERE account_id = $1 AND role IN ('CEO', 'STAFF') AND status = 'enrollment_pending'
       AND enrollment_token_hash = $2 AND enrollment_expires_at > now()
     RETURNING account_id, role`,
    [accountId, hashToken(token), encryptSecret(secret)],
  );
  if (rows.length !== 1) {
    await addAudit(null, 'admin.authenticator.enrollment.failed', { accountId }, 'failure', randomUUID());
    sendJson(response, 400, {
      error: 'Enrollment code is invalid, expired, or already used. Ask an administrator to issue a fresh code.',
    });
    return;
  }
  await addAudit(null, `${rows[0].role.toLowerCase()}.authenticator.setup_started`, { accountId }, 'success', randomUUID());
  sendJson(response, 200, {
    secret,
    provisioningUri: provisioningUri(secret, accountId),
    message: 'Add this account to Google Authenticator. This setup secret is shown once; verify a current code to activate the account.',
  });
}

async function completeEnrollment(request, response, requestId) {
  const body = await readJson(request);
  const accountId = typeof body.accountId === 'string' ? body.accountId.trim() : '';
  const token = typeof body.enrollmentToken === 'string' ? body.enrollmentToken.trim() : '';
  const code = typeof body.code === 'string' ? body.code : '';
  if (!token || token.length > 100 || !/^\d{6}$/.test(code)) {
    sendJson(response, 400, { error: 'Enter the enrollment code and six-digit authenticator code.' });
    return;
  }
  const completed = await withTransaction(async (client) => {
    const { rows } = await client.query(
      `SELECT id, account_id AS "accountId", display_name AS "displayName", role,
              totp_secret_encrypted AS secret
       FROM admin_accounts WHERE account_id = $1 AND role IN ('CEO', 'STAFF') AND status = 'enrollment_pending'
         AND enrollment_token_hash = $2 AND enrollment_expires_at > now() FOR UPDATE`,
      [accountId, hashToken(token)],
    );
    const account = rows[0];
    if (!account?.secret) return false;
    const counter = verifyTotp(decryptSecret(account.secret), code);
    if (counter === null) return false;
    const { rowCount } = await client.query(
      `UPDATE admin_accounts SET status = 'active', enrollment_token_hash = NULL,
        enrollment_expires_at = NULL, last_totp_counter = $2, updated_at = now()
       WHERE id = $1 AND status = 'enrollment_pending'`,
      [account.id, counter],
    );
    if (rowCount === 1) {
      await writeAudit(client, account, `${account.role.toLowerCase()}.authenticator.enrolled`, {}, 'success', requestId);
    }
    return rowCount === 1;
  });
  if (!completed) {
    await addAudit(null, 'admin.authenticator.enrollment.failed', { accountId }, 'failure', requestId);
    sendJson(response, 400, {
      error: 'Enrollment code is invalid or expired, or the authenticator code is incorrect. If the setup code expired, ask an administrator to issue a fresh one.',
    });
    return;
  }
  sendJson(response, 200, { ok: true, message: 'Authenticator enrolled. You can now sign in.' });
}

async function createStaff(request, response, actor, requestId) {
  const body = await readJson(request);
  const displayName = typeof body.displayName === 'string' ? body.displayName.trim() : '';
  const selectedPermissions = body.permissions;
  if (displayName.length < 2 || displayName.length > 80) {
    sendJson(response, 400, { error: 'Display name must be between 2 and 80 characters.' });
    return;
  }
  if (!Array.isArray(selectedPermissions) || selectedPermissions.some((item) => !permissions.includes(item))) {
    sendJson(response, 400, { error: 'Select only valid staff permissions.' });
    return;
  }
  const accountId = `GSQ-${randomUUID().replaceAll('-', '').toUpperCase()}`;
  const enrollmentToken = newToken(24);
  const created = await withTransaction(async (client) => {
    const { rows } = await client.query(
      `INSERT INTO admin_accounts (account_id, display_name, role, status, permissions,
        enrollment_token_hash, enrollment_expires_at)
       VALUES ($1, $2, 'STAFF', 'enrollment_pending', $3, $4, now() + interval '24 hours')
       RETURNING account_id AS "accountId", display_name AS "displayName", role, status,
         permissions, created_at AS "createdAt"`,
      [accountId, displayName, [...new Set(selectedPermissions)], hashToken(enrollmentToken)],
    );
    await writeAudit(client, actor, 'staff.created', { accountId, permissions: [...new Set(selectedPermissions)] }, 'success', requestId, {
      affectedAccountId: accountId,
    });
    return rows[0];
  });
  sendJson(response, 201, {
    staff: created,
    enrollmentToken,
    enrollmentExpiresInHours: 24,
    warning: 'Copy this one-time code and deliver it to the staff member through a secure channel. It will not be shown again.',
  });
}

async function updateStaff(request, response, actor, accountId, requestId) {
  const body = await readJson(request);
  const action = body.action;
  const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
  if (!['revoke', 'restore', 'suspend', 'deactivate', 'permissions', 'replace_authenticator'].includes(action)) {
    sendJson(response, 400, { error: 'Choose a supported staff account action.' });
    return;
  }
  if (reason.length < 3 || reason.length > 500) {
    sendJson(response, 400, { error: 'Provide a reason between 3 and 500 characters.' });
    return;
  }
  if (action === 'permissions' && (!Array.isArray(body.permissions)
    || body.permissions.some((item) => !permissions.includes(item)))) {
    sendJson(response, 400, { error: 'Select only valid staff permissions.' });
    return;
  }
  const statusByAction = {
    revoke: 'revoked',
    restore: 'active',
    suspend: 'suspended',
    deactivate: 'deactivated',
  };
  const enrollmentToken = action === 'replace_authenticator' ? newToken(24) : null;
  const result = await withTransaction(async (client) => {
    const { rows } = await client.query(
      `SELECT account_id AS "accountId", display_name AS "displayName", status, permissions
       FROM admin_accounts WHERE account_id = $1 AND role = 'STAFF' FOR UPDATE`,
      [accountId],
    );
    const before = rows[0];
    if (!before) return null;
    if (action === 'replace_authenticator' && !['active', 'enrollment_pending'].includes(before.status)) {
      throw new HttpError(409, 'Restore the staff account before replacing its authenticator.');
    }
    const newPermissions = action === 'permissions' ? [...new Set(body.permissions)] : before.permissions;
    const nextStatus = action === 'replace_authenticator' ? 'enrollment_pending' : statusByAction[action] || before.status;
    const { rows: changed } = await client.query(
      `UPDATE admin_accounts SET status = $2, permissions = $3,
        totp_secret_encrypted = CASE WHEN $4 THEN NULL ELSE totp_secret_encrypted END,
        last_totp_counter = CASE WHEN $4 THEN NULL ELSE last_totp_counter END,
        enrollment_token_hash = CASE WHEN $4 THEN $5 ELSE enrollment_token_hash END,
        enrollment_expires_at = CASE WHEN $4 THEN now() + interval '24 hours' ELSE enrollment_expires_at END,
        session_version = session_version + CASE WHEN status <> $2 OR $4 THEN 1 ELSE 0 END,
        updated_at = now() WHERE account_id = $1
       RETURNING account_id AS "accountId", display_name AS "displayName", status, permissions`,
      [accountId, nextStatus, newPermissions, action === 'replace_authenticator', enrollmentToken ? hashToken(enrollmentToken) : null],
    );
    const staff = changed[0];
    await writeAudit(client, actor, `staff.${action}`, { before, after: staff, reason }, 'success', requestId, {
      affectedAccountId: accountId,
    });
    return staff;
  });
  if (!result) {
    sendJson(response, 404, { error: 'Staff account was not found.' });
    return;
  }
  sendJson(response, 200, {
    staff: result,
    ...(enrollmentToken ? {
      enrollmentToken,
      enrollmentExpiresInHours: 24,
      warning: 'Deliver this one-time enrollment code through a secure channel. It will not be shown again.',
    } : {}),
  });
}

async function getStaffActivity(response, accountId, actor, requestId) {
  const { rows } = await query(
    `SELECT a.account_id AS "accountId", a.display_name AS "displayName"
     FROM admin_accounts a WHERE a.account_id = $1 AND a.role = 'STAFF'`,
    [accountId],
  );
  const staff = rows[0];
  if (!staff) {
    sendJson(response, 404, { error: 'Staff account was not found.' });
    return;
  }
  await addAudit(actor, 'staff.activity.viewed', { accountId }, 'success', requestId);
  const { rows: events } = await query(
    `SELECT id, actor_account_id AS "actorAccountId", actor_label AS "actorLabel",
            actor_role AS "actorRole", action_type AS "actionType",
            affected_account_id AS "affectedAccountId", transaction_id AS "transactionId",
            approval_request_id AS "approvalRequestId", details, result, request_id AS "requestId",
            created_at AS "createdAt"
     FROM audit_logs
     WHERE actor_account_id = (SELECT id FROM admin_accounts WHERE account_id = $1 AND role = 'STAFF')
        OR affected_account_id = $1
        OR details->>'accountId' = $1
        OR details->'before'->>'accountId' = $1
     ORDER BY created_at DESC LIMIT 250`,
    [accountId],
  );
  sendJson(response, 200, { staff, events });
}

async function updateInvestor(request, response, actor, accountId, requestId) {
  const body = await readJson(request);
  const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
  const action = body.action;
  if (!['suspend', 'reactivate', 'deactivate', 'delete', 'edit_name', 'edit_profile'].includes(action)) {
    sendJson(response, 400, { error: 'Choose a supported investor account action.' });
    return;
  }
  if (reason.length < 3 || reason.length > 500) {
    sendJson(response, 400, { error: 'Provide a reason between 3 and 500 characters.' });
    return;
  }
  let profile = null;
  if (action === 'edit_name' || action === 'edit_profile') {
    try {
      profile = normalizeInvestorProfile(body);
    } catch (error) {
      throw new HttpError(400, error.message);
    }
  }
  const statusByAction = { suspend: 'suspended', reactivate: 'active', deactivate: 'deactivated', delete: 'deactivated' };
  let investor;
  try {
    investor = await withTransaction(async (client) => {
    const { rows: currentRows } = await client.query(
      `SELECT id, status, display_name AS "displayName", username, email, phone, country,
              anonymized_at AS "anonymizedAt"
       FROM investors WHERE account_id = $1 FOR UPDATE`,
      [accountId],
    );
    const current = currentRows[0];
    if (!current) return null;
    if (current.anonymizedAt) {
      throw new HttpError(409, 'An anonymized investor account cannot be changed again.');
    }
    if (['deactivate', 'delete'].includes(action)) {
      const { rows: walletRows } = await client.query(
        `SELECT available_balance::text AS available, reserved_balance::text AS reserved
         FROM wallets WHERE investor_id = $1 FOR UPDATE`,
        [current.id],
      );
      const wallet = walletRows[0];
      const { rows: obligations } = await client.query(
        `SELECT
           (SELECT count(*)::int FROM deposits
            WHERE investor_id = $1 AND status IN ('pending', 'payment_reported', 'payment_confirmed', 'awaiting_ceo', 'approved')) +
           (SELECT count(*)::int FROM withdrawals
            WHERE investor_id = $1 AND status IN ('pending_review', 'awaiting_ceo', 'ceo_approved', 'processing')) AS count`,
        [current.id],
      );
      if ((wallet && (moneyInCents(wallet.available) !== 0n || moneyInCents(wallet.reserved) !== 0n))
        || obligations[0].count > 0) {
        throw new HttpError(409, 'This investor has a non-zero wallet balance or outstanding transactions. Resolve those obligations before deactivation or anonymization.');
      }
    }
    const nextStatus = statusByAction[action] || current.status;
    const anonymize = action === 'delete';
    const updateFullProfile = action === 'edit_profile';
    const nextDisplayName = profile?.displayName || (anonymize ? 'Deleted investor' : current.displayName);
    const { rows } = await client.query(
      `UPDATE investors SET status = $2, display_name = $3,
         username = CASE WHEN $4 THEN $5 WHEN $9 THEN NULL ELSE username END,
         email = CASE WHEN $4 THEN $6 WHEN $9 THEN NULL ELSE email END,
         phone = CASE WHEN $4 THEN $7 WHEN $9 THEN NULL ELSE phone END,
         country = CASE WHEN $4 THEN $8 WHEN $9 THEN NULL ELSE country END,
         anonymized_at = CASE WHEN $9 THEN COALESCE(anonymized_at, now()) ELSE anonymized_at END,
         updated_at = now()
       WHERE account_id = $1
       RETURNING id, account_id AS "accountId", display_name AS "displayName",
         username, email, phone, country, status, anonymized_at AS "anonymizedAt"`,
      [
        accountId, nextStatus, nextDisplayName, updateFullProfile,
        profile?.username ?? null, profile?.email ?? null, profile?.phone ?? null, profile?.country ?? null,
        anonymize,
      ],
    );
    const updated = rows[0];
    await writeAudit(client, actor, `investor.${action}`, {
      accountId,
      previousStatus: current.status,
      status: nextStatus,
      ...(updateFullProfile ? {
        previousProfile: {
          displayName: current.displayName, username: current.username, email: current.email,
          phone: current.phone, country: current.country,
        },
        profile: {
          displayName: updated.displayName, username: updated.username, email: updated.email,
          phone: updated.phone, country: updated.country,
        },
      } : anonymize ? {
        anonymizedFields: ['displayName', 'username', 'email', 'phone', 'country'],
      } : {
        previousDisplayName: current.displayName,
        displayName: nextDisplayName,
      }),
      reason,
    }, 'success', requestId, { affectedAccountId: accountId });
    return updated;
    });
  } catch (error) {
    if (error.code === '23505') throw new HttpError(409, 'That username or email is already assigned to another investor.');
    throw error;
  }
  if (!investor) {
    sendJson(response, 404, { error: 'Investor account was not found.' });
    return;
  }
  sendJson(response, 200, { investor });
}

async function updateApplicationSetting(request, response, actor, key, requestId) {
  const body = await readJson(request);
  const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
  if (reason.length < 3 || reason.length > 500) {
    throw new HttpError(400, 'Provide a reason between 3 and 500 characters.');
  }
  let value;
  try {
    value = normalizeSettingValue(key, body.value);
  } catch (error) {
    throw new HttpError(400, error.message);
  }
  const setting = await withTransaction(async (client) => {
    await client.query(
      `SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`,
      [`application-setting:${key}`],
    );
    const { rows: previousRows } = await client.query(
      `SELECT value FROM app_settings WHERE key = $1 FOR UPDATE`,
      [key],
    );
    const previousValue = previousRows[0]?.value
      ?? applicationSettings.find((item) => item.key === key)?.defaultValue;
    const { rows } = await client.query(
      `INSERT INTO app_settings (key, value, updated_by, updated_at)
       VALUES ($1, $2::jsonb, $3, now())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value,
         updated_by = EXCLUDED.updated_by, updated_at = now()
       RETURNING key, value, updated_at AS "updatedAt"`,
      [key, JSON.stringify(value), actor.id],
    );
    await writeAudit(client, actor, 'settings.updated', {
      key, previousValue, value, reason,
    }, 'success', requestId);
    return rows[0];
  });
  sendJson(response, 200, { setting });
}

async function createApprovalRequest(request, response, actor, transactionType, transactionId, requestId) {
  if (actor.role !== 'STAFF') throw new HttpError(403, 'CEO transaction actions do not use staff approval requests.');
  if (!isUuid(transactionId)) throw new HttpError(400, 'Transaction ID is invalid.');
  const body = await readJson(request);
  const proposedAction = body.proposedAction;
  const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
  if (!['approve', 'reject'].includes(proposedAction)) {
    throw new HttpError(400, 'Choose whether to request authorization to approve or reject.');
  }
  if (reason.length < 3 || reason.length > 500) {
    throw new HttpError(400, 'Provide a reason between 3 and 500 characters.');
  }

  const approval = await withTransaction(async (client) => {
    const transaction = await loadTransaction(client, transactionType, transactionId);
    if (!transaction) throw new HttpError(404, 'The transaction was not found.');
    if (transactionType === 'deposit') {
      const eligible = ['pending', 'payment_reported', 'payment_confirmed', 'awaiting_ceo'].includes(transaction.status);
      if (!eligible) throw new HttpError(409, 'This deposit is no longer eligible for review.');
      if (proposedAction === 'approve'
        && (transaction.status !== 'payment_confirmed' || transaction.providerStatus !== 'verified')) {
        throw new HttpError(409, 'A deposit can be proposed for approval only after trusted provider verification.');
      }
    } else if (!['pending_review', 'awaiting_ceo'].includes(transaction.status)) {
      throw new HttpError(409, 'This withdrawal is no longer eligible for review.');
    }

    const { rows: existing } = await client.query(
      `SELECT id FROM approval_requests
       WHERE transaction_type = $1 AND transaction_id = $2 AND status IN ('pending', 'approved')
       LIMIT 1 FOR UPDATE`,
      [transactionType, transactionId],
    );
    if (existing.length) throw new HttpError(409, 'An active approval request already exists for this transaction.');

    const fingerprint = transactionFingerprint(transaction);
    const { rows } = await client.query(
      `INSERT INTO approval_requests
         (transaction_type, transaction_id, requested_by, proposed_action, proposal_fingerprint, reason)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, created_at AS "createdAt"`,
      [transactionType, transactionId, actor.id, proposedAction, fingerprint, reason],
    );
    const created = rows[0];
    await client.query(
      `INSERT INTO notifications (account_id, message, related_type, related_id)
       SELECT id, $1, 'approval_request', $2 FROM admin_accounts
       WHERE role = 'CEO' AND status = 'active'`,
      [`${actor.displayName} submitted a ${proposedAction} proposal for a ${transactionType}.`, created.id],
    );
    await writeAudit(client, actor, 'payment.approval.requested', {
      transactionType, transactionId, proposedAction, reason,
    }, 'success', requestId, { transactionId, approvalRequestId: created.id, affectedAccountId: transaction.investorAccountId });
    return created;
  });
  sendJson(response, 201, { approval });
}

const plisioCurrencies = { BTC: 'BTC', USDT: 'USDT_TRX', TRX: 'TRX' };

async function createDeposit(request, response, actor, requestId) {
  if (!process.env.PLISIO_API_KEY) throw new HttpError(503, 'Plisio is not configured on the server.');
  const callbackOrigin = process.env.APP_ORIGIN;
  if (!callbackOrigin || new URL(callbackOrigin).protocol !== 'https:') {
    throw new HttpError(503, 'Set the public HTTPS APP_ORIGIN before creating payment invoices.');
  }
  const body = await readJson(request);
  const accountId = typeof body.investorAccountId === 'string' ? body.investorAccountId.trim() : '';
  const amount = typeof body.amountUsd === 'string' ? body.amountUsd.trim() : '';
  const currency = typeof body.currency === 'string' ? body.currency.toUpperCase() : '';
  const idempotencyKey = request.headers['idempotency-key'];
  if (!/^(?:0|[1-9]\d{0,11})(?:\.\d{1,2})?$/.test(amount) || moneyInCents(amount) <= 0n) {
    throw new HttpError(400, 'Enter a positive USD amount with no more than two decimal places.');
  }
  if (!plisioCurrencies[currency]) throw new HttpError(400, 'Choose BTC, USDT (TRC20), or TRX.');
  if (typeof idempotencyKey !== 'string' || !isUuid(idempotencyKey)) {
    throw new HttpError(400, 'A valid idempotency key is required.');
  }
  const fingerprint = hashToken(JSON.stringify({ accountId, amount: normalizeUsd(amount), currency }));
  const deposit = await withTransaction(async (client) => {
    const { rows: priorRows } = await client.query(
      `SELECT id, investor_id AS "investorId", amount_usd::text AS "amountUsd", currency,
              provider_invoice_id AS "invoiceId", invoice_url AS "invoiceUrl",
              invoice_address AS "invoiceAddress", expires_at AS "expiresAt",
              request_fingerprint AS fingerprint
       FROM deposits WHERE idempotency_key = $1 FOR UPDATE`,
      [idempotencyKey],
    );
    if (priorRows[0]) {
      if (priorRows[0].fingerprint !== fingerprint) throw new HttpError(409, 'This idempotency key was already used for a different deposit.');
      return { ...priorRows[0], replayed: true };
    }
    const { rows: investors } = await client.query(
      `SELECT i.id FROM investors i
       WHERE i.account_id = $1 AND i.status = 'active' FOR UPDATE`,
      [accountId],
    );
    if (!investors[0]) throw new HttpError(404, 'Active investor account was not found.');
    const { rows } = await client.query(
      `INSERT INTO deposits
         (investor_id, amount_usd, currency, status, idempotency_key, request_fingerprint)
       VALUES ($1, $2::numeric, $3, 'pending', $4, $5)
       RETURNING id, investor_id AS "investorId", amount_usd::text AS "amountUsd", currency,
         provider_invoice_id AS "invoiceId", invoice_url AS "invoiceUrl",
         invoice_address AS "invoiceAddress", expires_at AS "expiresAt"`,
      [investors[0].id, normalizeUsd(amount), currency, idempotencyKey, fingerprint],
    );
    const created = rows[0];
    await writeAudit(client, actor, 'deposit.invoice.requested', {
      investorAccountId: accountId, amountUsd: created.amountUsd, currency,
    }, 'success', requestId, { transactionId: created.id, affectedAccountId: accountId });
    return { ...created, replayed: false };
  });

  if (deposit.invoiceId) {
    sendJson(response, 200, { deposit, replayed: true });
    return;
  }

  try {
    const invoice = normalizePlisioInvoice(await plisioRequest('/invoices/new', {
      source_currency: 'USD',
      source_amount: deposit.amountUsd,
      currency: plisioCurrencies[currency],
      allowed_psys_cids: plisioCurrencies[currency],
      order_name: `G-Squad deposit ${deposit.id}`,
      order_number: deposit.id,
      description: `G-Squad investor deposit ${accountId}`,
      callback_url: `${new URL(callbackOrigin).origin}/api/webhooks/plisio`,
      expire_min: 30,
      return_existing: 1,
    }), { allowMissingStatus: true });
    if (invoice.orderNumber !== deposit.id || !invoice.invoiceUrl) {
      throw new Error('Plisio returned an invoice that did not match the deposit request.');
    }
    const { rows } = await query(
      `UPDATE deposits SET provider_invoice_id = $2, provider_reference = $2,
         invoice_url = $3, invoice_address = NULLIF($4, ''), expires_at = $5::timestamptz,
         provider_currency = $6, provider_status = 'pending',
         provider_payload = $7::jsonb, updated_at = now()
       WHERE id = $1
       RETURNING id, amount_usd::text AS "amountUsd", currency, status,
         provider_invoice_id AS "invoiceId", invoice_url AS "invoiceUrl",
         invoice_address AS "invoiceAddress", expires_at AS "expiresAt"`,
      [
        deposit.id, invoice.id, invoice.invoiceUrl, invoice.walletHash || null,
        invoice.expireAt || null, invoice.currency || plisioCurrencies[currency],
        JSON.stringify({ status: invoice.providerStatus, orderNumber: invoice.orderNumber }),
      ],
    );
    await addAudit(actor, 'deposit.invoice.created', {
      investorAccountId: accountId, provider: 'Plisio', currency,
    }, 'success', requestId);
    sendJson(response, 201, { deposit: rows[0], replayed: deposit.replayed });
  } catch (error) {
    await addAudit(actor, 'deposit.invoice.failed', {
      depositId: deposit.id, error: error.message,
    }, 'failure', requestId);
    throw new HttpError(error.providerStatus ? 502 : 503, error.message || 'Plisio invoice creation failed.');
  }
}

async function checkDeposit(response, depositId, actor, requestId) {
  if (!isUuid(depositId)) throw new HttpError(400, 'Deposit ID is invalid.');
  if (!process.env.PLISIO_API_KEY) throw new HttpError(503, 'Plisio is not configured on the server.');
  const { rows } = await query(
    `SELECT d.id, d.investor_id AS "investorId", i.account_id AS "investorAccountId",
            d.amount_usd::text AS "amountUsd", d.currency, d.status,
            d.provider_invoice_id AS "invoiceId"
     FROM deposits d JOIN investors i ON i.id = d.investor_id WHERE d.id = $1`,
    [depositId],
  );
  const deposit = rows[0];
  if (!deposit) throw new HttpError(404, 'Deposit was not found.');
  if (!deposit.invoiceId) throw new HttpError(409, 'This deposit has no Plisio invoice to check.');
  try {
    const result = await verifyAndRecordPlisioInvoice(deposit, actor, requestId);
    sendJson(response, 200, { deposit: result });
  } catch (error) {
    await addAudit(actor, 'deposit.provider_check.failed', {
      depositId, error: error.message,
    }, 'failure', requestId);
    throw new HttpError(error.providerStatus ? 502 : 503, error.message || 'Plisio status could not be checked.');
  }
}

async function handlePlisioWebhook(request, response, requestId) {
  if (!process.env.PLISIO_API_KEY) throw new HttpError(503, 'Plisio webhook verification is not configured.');
  const payload = await readJson(request);
  if (!verifyPlisioCallback(payload, process.env.PLISIO_API_KEY)) {
    await addAudit(null, 'deposit.webhook.rejected', { reason: 'signature_invalid' }, 'denied', requestId);
    throw new HttpError(401, 'Webhook signature is invalid.');
  }
  const invoiceId = [payload.txn_id, payload.id, payload.invoice_id]
    .find((value) => typeof value === 'string' && value.length <= 200);
  if (!invoiceId) throw new HttpError(400, 'Webhook invoice reference is missing.');
  const eventId = hashToken(JSON.stringify(payload));
  const inserted = await query(
    `INSERT INTO provider_webhook_events (provider, event_id, payload)
     VALUES ('plisio', $1, $2::jsonb) ON CONFLICT DO NOTHING RETURNING event_id`,
    [eventId, JSON.stringify(payload)],
  );
  if (!inserted.rowCount) {
    const { rows: prior } = await query(
      `SELECT processed_at AS "processedAt" FROM provider_webhook_events
       WHERE provider = 'plisio' AND event_id = $1`,
      [eventId],
    );
    if (prior[0]?.processedAt) {
      sendJson(response, 200, { ok: true, duplicate: true });
      return;
    }
  }
  const { rows } = await query(
    `SELECT d.id, d.investor_id AS "investorId", i.account_id AS "investorAccountId",
            d.amount_usd::text AS "amountUsd", d.currency, d.status,
            d.provider_invoice_id AS "invoiceId"
     FROM deposits d JOIN investors i ON i.id = d.investor_id
     WHERE d.provider_invoice_id = $1`,
    [invoiceId],
  );
  if (rows[0]) {
    try {
      await verifyAndRecordPlisioInvoice(rows[0], null, requestId);
    } catch (error) {
      throw new HttpError(503, 'Provider notification was received, but invoice status could not be verified. Plisio will need to retry.');
    }
  }
  await query(
    `UPDATE provider_webhook_events SET processed_at = now() WHERE provider = 'plisio' AND event_id = $1`,
    [eventId],
  );
  sendJson(response, 200, { ok: true });
}

async function verifyAndRecordPlisioInvoice(deposit, actor, requestId) {
  const invoice = normalizePlisioInvoice(await plisioRequest(`/invoices/${encodeURIComponent(deposit.invoiceId)}`));
  const actual = invoice.amountUsd ? moneyInCents(invoice.amountUsd) : null;
  const expected = moneyInCents(deposit.amountUsd);
  const expectedCurrency = plisioCurrencies[deposit.currency];
  const currencyMatches = invoice.currency === expectedCurrency
    || (deposit.currency === 'USDT' && invoice.currency === 'USDT');
  const verified = invoice.id === deposit.invoiceId
    && invoice.orderNumber === deposit.id
    && invoice.status === 'confirmed'
    && actual === expected
    && currencyMatches;
  const nextStatus = verified ? 'payment_confirmed'
    : invoice.status === 'expired' ? 'expired'
      : invoice.status === 'failed' ? 'failed'
        : 'payment_reported';
  const providerStatus = verified ? 'verified'
    : invoice.status === 'unknown' ? 'unknown'
      : invoice.status === 'confirmed' ? 'mismatch'
        : invoice.providerStatus || invoice.status;
  const { rows } = await withTransaction(async (client) => {
    const { rows: changed } = await client.query(
      `UPDATE deposits SET status = CASE
           WHEN status = 'credited' THEN status
           WHEN status IN ('rejected', 'failed', 'expired') THEN status
           ELSE $2
         END,
         provider_status = $3, provider_amount = $4, provider_currency = $5,
         provider_payload = $6::jsonb, updated_at = now()
       WHERE id = $1
       RETURNING id, amount_usd::text AS "amountUsd", currency, status,
         provider_status AS "providerStatus", provider_amount AS "providerAmount",
         provider_currency AS "providerCurrency", invoice_url AS "invoiceUrl",
         invoice_address AS "invoiceAddress", expires_at AS "expiresAt"`,
      [
        deposit.id, nextStatus, providerStatus, invoice.amountUsd, invoice.currency,
        JSON.stringify({ status: invoice.providerStatus, orderNumber: invoice.orderNumber, invoiceId: invoice.id }),
      ],
    );
    const action = verified ? 'deposit.provider_payment.verified' : 'deposit.provider_payment.checked';
    await writeAudit(client, actor, action, {
      depositId: deposit.id,
      providerStatus,
      verified,
      amountMatches: actual === expected,
      currencyMatches,
      providerStatusRaw: invoice.providerStatus,
    }, verified ? 'success' : 'failure', requestId, {
      transactionId: deposit.id, affectedAccountId: deposit.investorAccountId,
    });
    if (verified) {
      await client.query(
        `INSERT INTO notifications (account_id, message, related_type, related_id)
         SELECT id, $1, 'deposit', $2 FROM admin_accounts WHERE role = 'CEO' AND status = 'active'`,
        [`Plisio verified deposit ${deposit.id}; CEO authorization is still required before wallet credit.`, deposit.id],
      );
    }
    return changed;
  });
  return rows[0];
}

async function createWithdrawal(request, response, actor, requestId) {
  const body = await readJson(request);
  const accountId = typeof body.investorAccountId === 'string' ? body.investorAccountId.trim() : '';
  const amount = typeof body.amountUsd === 'string' ? body.amountUsd.trim() : '';
  const destination = typeof body.destination === 'string' ? body.destination.trim() : '';
  const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
  const idempotencyKey = request.headers['idempotency-key'];
  if (!/^(?:0|[1-9]\d{0,11})(?:\.\d{1,2})?$/.test(amount) || moneyInCents(amount) < 100n) {
    throw new HttpError(400, 'The minimum withdrawal is $1.00; use no more than two decimal places.');
  }
  if (!/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(destination)) {
    throw new HttpError(400, 'Enter a valid TRON address for the USDT TRC20 network.');
  }
  if (reason.length < 3 || reason.length > 500) throw new HttpError(400, 'Provide a reason between 3 and 500 characters.');
  if (typeof idempotencyKey !== 'string' || !isUuid(idempotencyKey)) throw new HttpError(400, 'A valid idempotency key is required.');
  if (!process.env.PLISIO_API_KEY) throw new HttpError(503, 'Plisio is not configured. No withdrawal funds were reserved.');
  const fingerprint = hashToken(JSON.stringify({
    accountId, amount: normalizeUsd(amount), destination, currency: 'USDT', network: 'TRC20',
  }));
  const { rows: existingRows } = await query(
    `SELECT id, amount_usd::text AS "amountUsd", status, destination,
            provider_amount AS "providerAmount", provider_currency AS "providerCurrency",
            provider_fee AS "providerFee", payout_quote_expires_at AS "quoteExpiresAt",
            request_fingerprint AS fingerprint
     FROM withdrawals WHERE idempotency_key = $1`,
    [idempotencyKey],
  );
  if (existingRows[0]) {
    if (existingRows[0].fingerprint !== fingerprint) throw new HttpError(409, 'This idempotency key was already used for a different withdrawal.');
    sendJson(response, 200, { withdrawal: { ...existingRows[0], replayed: true } });
    return;
  }
  let quote;
  try {
    quote = await quotePlisioWithdrawal(normalizeUsd(amount), destination);
  } catch (error) {
    throw new HttpError(503, `A trusted USDT TRC20 payout quote is unavailable. No withdrawal funds were reserved. ${error.message}`);
  }
  const withdrawal = await withTransaction(async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`withdrawal:${idempotencyKey}`]);
    const { rows: priorRows } = await client.query(
      `SELECT id, amount_usd::text AS "amountUsd", status, destination,
              provider_amount AS "providerAmount", provider_fee AS "providerFee",
              request_fingerprint AS fingerprint
       FROM withdrawals WHERE idempotency_key = $1 FOR UPDATE`,
      [idempotencyKey],
    );
    if (priorRows[0]) {
      if (priorRows[0].fingerprint !== fingerprint) throw new HttpError(409, 'This idempotency key was already used for a different withdrawal.');
      return { ...priorRows[0], replayed: true };
    }
    const { rows: wallets } = await client.query(
      `SELECT i.id AS "investorId", i.status AS "investorStatus",
              w.available_balance::text AS "availableBalance", w.reserved_balance::text AS "reservedBalance"
       FROM investors i JOIN wallets w ON w.investor_id = i.id
       WHERE i.account_id = $1 FOR UPDATE OF i, w`,
      [accountId],
    );
    const wallet = wallets[0];
    if (!wallet || wallet.investorStatus !== 'active') throw new HttpError(404, 'Active investor wallet was not found.');
    const { rows: reserved } = await client.query(
      `UPDATE wallets SET available_balance = available_balance - $2::numeric,
         reserved_balance = reserved_balance + $2::numeric, updated_at = now()
       WHERE investor_id = $1 AND available_balance >= $2::numeric
       RETURNING available_balance::text AS "availableBalance", reserved_balance::text AS "reservedBalance"`,
      [wallet.investorId, normalizeUsd(amount)],
    );
    if (!reserved[0]) throw new HttpError(409, 'The investor has insufficient available balance.');
    const { rows } = await client.query(
      `INSERT INTO withdrawals
         (investor_id, amount_usd, destination, currency, network, status, idempotency_key,
          request_fingerprint, provider_amount, provider_currency, provider_fee, payout_quote_expires_at)
       VALUES ($1, $2::numeric, $3, 'USDT', 'TRC20', 'pending_review', $4, $5, $6, $7, $8, now() + interval '2 minutes')
       RETURNING id, amount_usd::text AS "amountUsd", status, destination, currency, network,
         provider_amount AS "providerAmount", provider_currency AS "providerCurrency",
         provider_fee AS "providerFee", payout_quote_expires_at AS "quoteExpiresAt"`,
      [
        wallet.investorId, normalizeUsd(amount), destination, idempotencyKey, fingerprint,
        quote.providerAmount, quote.toCurrency, quote.providerFee,
      ],
    );
    const created = rows[0];
    await client.query(
      `INSERT INTO wallet_ledger
         (investor_id, amount_usd, available_after, reserved_after, entry_type, reference,
          idempotency_key, request_fingerprint, actor_account_id, reason)
       VALUES ($1, $2::numeric, $3::numeric, $4::numeric, 'withdrawal_reserve', $5, $6, $7, $8, $9)`,
      [
        wallet.investorId, `-${normalizeUsd(amount)}`, reserved[0].availableBalance, reserved[0].reservedBalance,
        `GSQ-WDR-RES-${created.id}`, idempotencyKey, fingerprint, actor.id, reason,
      ],
    );
    await client.query(
      `INSERT INTO notifications (account_id, message, related_type, related_id)
       SELECT id, $1, 'withdrawal', $2 FROM admin_accounts
       WHERE role = 'CEO' AND status = 'active'`,
      [`A USDT TRC20 withdrawal request requires review for investor ${accountId}.`, created.id],
    );
    await writeAudit(client, actor, 'withdrawal.requested', {
      investorAccountId: accountId, amountUsd: normalizeUsd(amount), destination, reason,
      providerAmount: quote.providerAmount, providerCurrency: quote.toCurrency,
      providerFee: quote.providerFee, quoteExpiresInSeconds: 120,
      previousAvailable: wallet.availableBalance, availableAfter: reserved[0].availableBalance,
      reservedAfter: reserved[0].reservedBalance,
    }, 'success', requestId, { transactionId: created.id, affectedAccountId: accountId });
    return { ...created, availableBalance: reserved[0].availableBalance, reservedBalance: reserved[0].reservedBalance, replayed: false };
  });
  sendJson(response, withdrawal.replayed ? 200 : 201, { withdrawal });
}

async function checkWithdrawal(response, withdrawalId, actor, requestId) {
  if (!isUuid(withdrawalId)) throw new HttpError(400, 'Withdrawal ID is invalid.');
  const { rows } = await query(
    `SELECT id, provider_reference AS "providerReference"
     FROM withdrawals WHERE id = $1`,
    [withdrawalId],
  );
  if (!rows[0]) throw new HttpError(404, 'Withdrawal was not found.');
  if (!rows[0].providerReference) {
    throw new HttpError(409, 'No Plisio operation reference is recorded. This payout requires manual provider reconciliation and must not be retried automatically.');
  }
  const result = await syncPlisioWithdrawal(withdrawalId, actor, requestId);
  sendJson(response, 200, { withdrawal: result });
}

async function syncPlisioWithdrawal(withdrawalId, actor, requestId) {
  const { rows } = await query(
    `SELECT id, amount_usd::text AS "amountUsd", destination, status,
            provider_reference AS "providerReference", provider_amount AS "providerAmount",
            provider_currency AS "providerCurrency", provider_status AS "providerStatus"
     FROM withdrawals WHERE id = $1`,
    [withdrawalId],
  );
  const withdrawal = rows[0];
  if (!withdrawal) throw new HttpError(404, 'Withdrawal was not found.');
  if (withdrawal.status === 'paid' || withdrawal.status === 'failed' || withdrawal.status === 'ceo_rejected') {
    return { id: withdrawal.id, status: withdrawal.status, providerStatus: withdrawal.providerStatus || withdrawal.status };
  }
  if (!withdrawal.providerReference) throw new HttpError(409, 'Withdrawal has no provider operation reference.');
  let data;
  try {
    data = await plisioRequest(`/operations/${encodeURIComponent(withdrawal.providerReference)}`);
  } catch (error) {
    throw new HttpError(503, `Plisio status could not be checked. The reserved funds remain unchanged. ${error.message}`);
  }
  const operation = normalizePlisioOperation(data);
  const matches = operation.id === withdrawal.providerReference
    && operation.destination === withdrawal.destination
    && decimalEqual(operation.amount, withdrawal.providerAmount)
    && ['USDT', 'USDT_TRX'].includes(operation.currency);
  const providerStatus = matches ? operation.providerStatus : 'mismatch';
  const outcome = matches ? operation.status : 'unknown';
  const updated = await withTransaction(async (client) => {
    const { rows: currentRows } = await client.query(
      `SELECT id, investor_id AS "investorId", amount_usd::text AS "amountUsd", destination, status,
              provider_reference AS "providerReference", provider_amount AS "providerAmount"
       FROM withdrawals WHERE id = $1 FOR UPDATE`,
      [withdrawalId],
    );
    const current = currentRows[0];
    if (!current) throw new HttpError(404, 'Withdrawal was not found.');
    if (current.providerReference !== operation.id) throw new HttpError(409, 'Provider operation reference changed.');
    if (current.status === 'paid' || current.status === 'failed' || current.status === 'ceo_rejected') return current;
    if (!matches) {
      await client.query(
        `UPDATE withdrawals SET provider_status = 'mismatch', provider_payload = $2::jsonb, updated_at = now()
         WHERE id = $1`,
        [withdrawalId, JSON.stringify({ operationId: operation.id, providerStatus: operation.providerStatus })],
      );
      await writeAudit(client, actor, 'withdrawal.provider_status.mismatch', {
        withdrawalId, providerOperationId: operation.id,
      }, 'failure', requestId, { transactionId: withdrawalId });
      return { ...current, status: current.status, providerStatus: 'mismatch' };
    }
    if (outcome === 'confirmed' || outcome === 'failed') {
      const { rows: walletRows } = await client.query(
        `UPDATE wallets SET
           available_balance = available_balance + CASE WHEN $2 = 'failed' THEN $3::numeric ELSE 0 END,
           reserved_balance = reserved_balance - $3::numeric,
           updated_at = now()
         WHERE investor_id = $1 AND reserved_balance >= $3::numeric
         RETURNING available_balance::text AS "availableBalance", reserved_balance::text AS "reservedBalance"`,
        [current.investorId, outcome, current.amountUsd],
      );
      const wallet = walletRows[0];
      if (!wallet) throw new HttpError(409, 'Withdrawal reservation is missing; provider confirmation was recorded but wallet reconciliation failed.');
      const nextStatus = outcome === 'confirmed' ? 'paid' : 'failed';
      const { rows: changed } = await client.query(
        `UPDATE withdrawals SET status = $2, provider_status = $3,
           provider_payload = $4::jsonb, updated_at = now()
         WHERE id = $1 AND status IN ('processing', 'ceo_approved')
         RETURNING id, amount_usd::text AS "amountUsd", status,
           provider_reference AS "providerReference", provider_status AS "providerStatus"`,
        [withdrawalId, nextStatus, operation.providerStatus, JSON.stringify({
          transactionIds: operation.transactionIds, transactionUrl: operation.transactionUrl,
        })],
      );
      if (changed.length !== 1) throw new HttpError(409, 'Withdrawal changed during provider reconciliation.');
      const ledgerAmount = outcome === 'confirmed' ? `-${current.amountUsd}` : current.amountUsd;
      await client.query(
        `INSERT INTO wallet_ledger
           (investor_id, amount_usd, available_after, reserved_after, entry_type, reference,
            idempotency_key, request_fingerprint, actor_account_id, reason)
         VALUES ($1, $2::numeric, $3::numeric, $4::numeric, $5, $6, $7, $8, $9, $10)`,
        [
          current.investorId, ledgerAmount, wallet.availableBalance, wallet.reservedBalance,
          outcome === 'confirmed' ? 'withdrawal_paid' : 'withdrawal_failed_release',
          `GSQ-WDR-${nextStatus.toUpperCase()}-${withdrawalId}`,
          `${withdrawalId}:${nextStatus}`, hashToken(`${withdrawalId}:${nextStatus}`),
          actor?.id || null, `Plisio ${operation.providerStatus} for withdrawal ${withdrawalId}`,
        ],
      );
      await client.query(
        `INSERT INTO notifications (account_id, message, related_type, related_id)
         SELECT id, $1, 'withdrawal', $2 FROM admin_accounts
         WHERE role = 'CEO' AND status = 'active'`,
        [`Plisio reported withdrawal ${withdrawalId} as ${nextStatus}.`, withdrawalId],
      );
      await writeAudit(client, actor, `withdrawal.provider.${nextStatus}`, {
        withdrawalId, providerOperationId: operation.id,
        providerStatus: operation.providerStatus, transactionIds: operation.transactionIds,
      }, 'success', requestId, { transactionId: withdrawalId });
      return changed[0];
    }
    await client.query(
      `UPDATE withdrawals SET provider_status = $2, provider_payload = $3::jsonb, updated_at = now()
       WHERE id = $1`,
      [withdrawalId, operation.providerStatus, JSON.stringify({
        transactionIds: operation.transactionIds, transactionUrl: operation.transactionUrl,
      })],
    );
    return { ...current, providerStatus: operation.providerStatus };
  });
  return { ...updated, providerStatus: outcome === 'unknown' ? providerStatus : outcome };
}

function decimalEqual(left, right) {
  const normalize = (value) => {
    const text = String(value || '');
    if (!/^\d{1,18}(?:\.\d{1,12})?$/.test(text)) return null;
    const [whole, fraction = ''] = text.split('.');
    return BigInt(whole) * 1_000_000_000_000n + BigInt(fraction.padEnd(12, '0'));
  };
  const first = normalize(left);
  const second = normalize(right);
  return first !== null && second !== null && first === second;
}

function normalizeUsd(value) {
  const [whole, fraction = ''] = String(value).split('.');
  return `${whole}.${fraction.padEnd(2, '0')}`;
}

async function decideApproval(request, response, actor, approvalId, requestId) {
  if (!isUuid(approvalId)) throw new HttpError(400, 'Approval request ID is invalid.');
  const body = await readJson(request);
  const decision = body.decision;
  const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
  if (!['approve', 'reject', 'more_information'].includes(decision)) {
    throw new HttpError(400, 'Choose approve, reject, or request more information.');
  }
  if (reason.length < 3 || reason.length > 500) {
    throw new HttpError(400, 'Provide a decision reason between 3 and 500 characters.');
  }

  const approval = await withTransaction(async (client) => {
    const { rows } = await client.query(
      `SELECT id, transaction_type AS "transactionType", transaction_id AS "transactionId",
              requested_by AS "requestedById", proposed_action AS "proposedAction",
              proposal_fingerprint AS fingerprint, status, requester.account_id AS "requestedByAccountId"
       FROM approval_requests ar
       JOIN admin_accounts requester ON requester.id = ar.requested_by
       WHERE ar.id = $1 FOR UPDATE OF ar`,
      [approvalId],
    );
    const current = rows[0];
    if (!current) throw new HttpError(404, 'Approval request was not found.');
    if (current.status !== 'pending') throw new HttpError(409, 'This approval request has already been decided.');
    const transaction = await loadTransaction(client, current.transactionType, current.transactionId);
    if (!transaction || transactionFingerprint(transaction) !== current.fingerprint) {
      const staleReason = 'Invalidated because transaction details changed after submission.';
      await client.query(
        `UPDATE approval_requests SET status = 'rejected', decided_by = $2,
           decision_reason = $3, decided_at = now()
         WHERE id = $1 AND status = 'pending'`,
        [approvalId, actor.id, staleReason],
      );
      await writeAudit(client, actor, 'payment.approval.invalidated', {
        transactionType: current.transactionType, transactionId: current.transactionId,
      }, 'denied', requestId, {
        transactionId: current.transactionId, approvalRequestId: approvalId,
        affectedAccountId: transaction?.investorAccountId,
      });
      return { stale: true };
    }
    const status = decision === 'more_information' ? 'more_information' : decision === 'approve' ? 'approved' : 'rejected';
    const { rows: updated } = await client.query(
      `UPDATE approval_requests SET status = $2, decided_by = $3,
         decision_reason = $4, decided_at = now()
       WHERE id = $1 AND status = 'pending'
       RETURNING id, status, requested_by AS "requestedById"`,
      [approvalId, status, actor.id, reason],
    );
    await client.query(
      `INSERT INTO notifications (account_id, message, related_type, related_id)
       VALUES ($1, $2, 'approval_request', $3)`,
      [
        current.requestedById,
        `Your ${current.transactionType} proposal was ${decision === 'more_information' ? 'returned for more information' : decision === 'approve' ? 'authorized by a CEO' : 'not authorized by a CEO'}.`,
        approvalId,
      ],
    );
    await writeAudit(client, actor, 'payment.approval.decided', {
      transactionType: current.transactionType,
      transactionId: current.transactionId,
      proposedAction: current.proposedAction,
      decision,
      reason,
      requestedBy: current.requestedByAccountId,
    }, 'success', requestId, {
      transactionId: current.transactionId,
      approvalRequestId: approvalId,
      affectedAccountId: current.requestedByAccountId,
    });
    return updated[0];
  });
  if (approval.stale) {
    sendJson(response, 409, { error: 'Transaction details changed after submission. The request was invalidated; staff must submit a new request.' });
    return;
  }
  sendJson(response, 200, { approval });
}

async function executeApproval(response, actor, approvalId, requestId) {
  if (actor.role !== 'STAFF') throw new HttpError(403, 'This action is restricted to authorized staff.');
  if (!isUuid(approvalId)) throw new HttpError(400, 'Approval request ID is invalid.');
  const payoutQuote = await getApprovedWithdrawalQuote(approvalId);
  const result = await withTransaction(async (client) => {
    const { rows } = await client.query(
      `SELECT id, transaction_type AS "transactionType", transaction_id AS "transactionId",
              requested_by AS "requestedById", proposed_action AS "proposedAction",
              proposal_fingerprint AS fingerprint, status
       FROM approval_requests WHERE id = $1 FOR UPDATE`,
      [approvalId],
    );
    const approval = rows[0];
    if (!approval) throw new HttpError(404, 'Approval request was not found.');
    if (approval.requestedById !== actor.id) throw new HttpError(403, 'Only the staff member who submitted this request can execute it.');
    if (approval.status !== 'approved') throw new HttpError(409, 'This proposal has not been authorized for execution.');

    const transaction = await loadTransaction(client, approval.transactionType, approval.transactionId);
    if (!transaction || transactionFingerprint(transaction) !== approval.fingerprint) {
      await client.query(
        `UPDATE approval_requests SET status = 'rejected',
           decision_reason = 'Invalidated because transaction details changed after CEO authorization.'
         WHERE id = $1 AND status = 'approved'`,
        [approvalId],
      );
      await writeAudit(client, actor, 'payment.approval.invalidated', {
        transactionType: approval.transactionType, transactionId: approval.transactionId,
      }, 'denied', requestId, {
        transactionId: approval.transactionId, approvalRequestId: approvalId,
        affectedAccountId: transaction?.investorAccountId,
      });
      return { stale: true };
    }
    if (payoutQuote && (
      payoutQuote.providerAmount !== transaction.providerAmount
      || payoutQuote.providerFee !== transaction.providerFee
    )) {
      await client.query(
        `UPDATE withdrawals SET provider_amount = $2, provider_fee = $3,
           payout_quote_expires_at = now() + interval '2 minutes', updated_at = now()
         WHERE id = $1`,
        [approval.transactionId, payoutQuote.providerAmount, payoutQuote.providerFee],
      );
      await client.query(
        `UPDATE approval_requests SET status = 'rejected',
           decision_reason = 'Invalidated because the Plisio payout quote changed.'
         WHERE id = $1 AND status = 'approved'`,
        [approvalId],
      );
      await writeAudit(client, actor, 'withdrawal.quote.changed', {
        withdrawalId: approval.transactionId,
        previousAmount: transaction.providerAmount,
        currentAmount: payoutQuote.providerAmount,
        previousFee: transaction.providerFee,
        currentFee: payoutQuote.providerFee,
      }, 'denied', requestId, {
        transactionId: approval.transactionId, approvalRequestId: approvalId,
        affectedAccountId: transaction.investorAccountId,
      });
      return { staleQuote: true };
    }

    let finalStatus;
    let payout = null;
    if (approval.transactionType === 'deposit') {
      if (approval.proposedAction === 'approve') {
        if (transaction.status !== 'payment_confirmed' || transaction.providerStatus !== 'verified') {
          throw new HttpError(409, 'The payment provider has not verified this deposit. No wallet credit was made.');
        }
        const { rows: walletRows } = await client.query(
          `UPDATE wallets SET available_balance = available_balance + $2::numeric, updated_at = now()
           WHERE investor_id = $1
           RETURNING available_balance::text AS "availableBalance", reserved_balance::text AS "reservedBalance"`,
          [transaction.investorId, transaction.amountUsd],
        );
        const wallet = walletRows[0];
        if (!wallet) throw new HttpError(409, 'The investor wallet was not found. No deposit was credited.');
        finalStatus = 'credited';
        const { rowCount } = await client.query(
          `UPDATE deposits SET status = 'credited', updated_at = now()
           WHERE id = $1 AND status = 'payment_confirmed' AND provider_status = 'verified'`,
          [approval.transactionId],
        );
        if (rowCount !== 1) throw new HttpError(409, 'The deposit changed during processing. No credit was made.');
        const reference = `GSQ-DEP-${randomUUID().replaceAll('-', '').toUpperCase()}`;
        await client.query(
          `INSERT INTO wallet_ledger
             (investor_id, amount_usd, available_after, reserved_after, entry_type, reference,
              idempotency_key, request_fingerprint, actor_account_id, reason)
           VALUES ($1, $2::numeric, $3::numeric, $4::numeric, 'deposit_credit', $5, $6, $7, $8, $9)`,
          [
            transaction.investorId, transaction.amountUsd, wallet.availableBalance, wallet.reservedBalance,
            reference, approval.id, approval.fingerprint, actor.id, `Verified deposit ${approval.transactionId}`,
          ],
        );
      } else {
        const { rowCount } = await client.query(
          `UPDATE deposits SET status = 'rejected', updated_at = now()
           WHERE id = $1 AND status IN ('pending', 'payment_reported', 'payment_confirmed', 'awaiting_ceo')`,
          [approval.transactionId],
        );
        if (rowCount !== 1) throw new HttpError(409, 'The deposit is no longer eligible for rejection.');
        finalStatus = 'rejected';
      }
    } else if (approval.proposedAction === 'approve') {
      if (!['pending_review', 'awaiting_ceo'].includes(transaction.status)) {
        throw new HttpError(409, 'The withdrawal is no longer awaiting processing.');
      }
      const { rows: walletRows } = await client.query(
        `SELECT reserved_balance::text AS "reservedBalance"
         FROM wallets WHERE investor_id = $1 FOR UPDATE`,
        [transaction.investorId],
      );
      if (!walletRows[0] || moneyInCents(walletRows[0].reservedBalance) < moneyInCents(transaction.amountUsd)) {
        throw new HttpError(409, 'The withdrawal reservation is unavailable. No payment was initiated.');
      }
      const { rowCount } = await client.query(
        `UPDATE withdrawals SET status = 'processing', provider_status = 'submitting',
           payout_started_at = now(), updated_at = now()
         WHERE id = $1 AND status IN ('pending_review', 'awaiting_ceo')`,
        [approval.transactionId],
      );
      if (rowCount !== 1) throw new HttpError(409, 'The withdrawal changed during processing.');
      finalStatus = 'processing';
      payout = {
        withdrawalId: approval.transactionId,
        amount: transaction.providerAmount,
        destination: transaction.destination,
        currency: transaction.providerCurrency,
      };
    } else {
      const { rows: walletRows } = await client.query(
        `UPDATE wallets SET
           available_balance = available_balance + $2::numeric,
           reserved_balance = reserved_balance - $2::numeric,
           updated_at = now()
         WHERE investor_id = $1 AND reserved_balance >= $2::numeric
         RETURNING available_balance::text AS "availableBalance", reserved_balance::text AS "reservedBalance"`,
        [transaction.investorId, transaction.amountUsd],
      );
      const wallet = walletRows[0];
      if (!wallet) throw new HttpError(409, 'The withdrawal reservation could not be released safely.');
      const { rowCount } = await client.query(
        `UPDATE withdrawals SET status = 'ceo_rejected', updated_at = now()
         WHERE id = $1 AND status IN ('pending_review', 'awaiting_ceo')`,
        [approval.transactionId],
      );
      if (rowCount !== 1) throw new HttpError(409, 'The withdrawal changed during processing.');
      const reference = `GSQ-WDR-REL-${randomUUID().replaceAll('-', '').toUpperCase()}`;
      await client.query(
        `INSERT INTO wallet_ledger
           (investor_id, amount_usd, available_after, reserved_after, entry_type, reference,
            idempotency_key, request_fingerprint, actor_account_id, reason)
         VALUES ($1, $2::numeric, $3::numeric, $4::numeric, 'withdrawal_release', $5, $6, $7, $8, $9)`,
        [
          transaction.investorId, transaction.amountUsd, wallet.availableBalance, wallet.reservedBalance,
          reference, approval.id, approval.fingerprint, actor.id, `Rejected withdrawal ${approval.transactionId}`,
        ],
      );
      finalStatus = 'ceo_rejected';
    }

    await client.query(
      `UPDATE approval_requests SET status = 'executed', final_action_by = $2, final_action_at = now()
       WHERE id = $1 AND status = 'approved'`,
      [approvalId, actor.id],
    );
    await writeAudit(client, actor, 'payment.approval.executed', {
      transactionType: approval.transactionType,
      transactionId: approval.transactionId,
      proposedAction: approval.proposedAction,
      finalStatus,
    }, 'success', requestId, {
      transactionId: approval.transactionId,
      approvalRequestId: approvalId,
      affectedAccountId: transaction.investorAccountId,
    });
    await client.query(
      `INSERT INTO notifications (account_id, message, related_type, related_id)
       SELECT id, $1, 'approval_request', $2 FROM admin_accounts
       WHERE role = 'CEO' AND status = 'active'`,
      [`${actor.displayName} executed the authorized ${approval.proposedAction} action for a ${approval.transactionType}.`, approvalId],
    );
    return {
      approvalId, transactionType: approval.transactionType, transactionId: approval.transactionId,
      status: finalStatus, payout,
    };
  });
  if (result.staleQuote) {
    sendJson(response, 409, { error: 'The provider payout quote changed. The approval was invalidated; staff must submit a new request.' });
    return;
  }
  if (result.stale) {
    sendJson(response, 409, { error: 'Transaction details changed after authorization. The approval was invalidated and cannot be executed.' });
    return;
  }
  let payoutStatus = null;
  if (result.payout) payoutStatus = await initiatePlisioWithdrawal(result.payout, actor, approvalId, requestId);
  sendJson(response, 200, {
    result: { ...result, payout: undefined, providerStatus: payoutStatus },
    note: payoutStatus === 'confirmed'
      ? 'Plisio confirmed the payout.'
      : result.payout
        ? 'Payout submitted to Plisio. It remains processing until provider confirmation; check status before further action.'
        : undefined,
  });
}

async function getApprovedWithdrawalQuote(approvalId) {
  const { rows } = await query(
    `SELECT ar.transaction_type AS "transactionType", ar.proposed_action AS "proposedAction",
            ar.status AS "approvalStatus", w.amount_usd::text AS "amountUsd", w.destination,
            w.status AS "withdrawalStatus"
     FROM approval_requests ar
     JOIN withdrawals w ON ar.transaction_type = 'withdrawal' AND w.id = ar.transaction_id
     WHERE ar.id = $1`,
    [approvalId],
  );
  const approval = rows[0];
  if (!approval || approval.transactionType !== 'withdrawal' || approval.proposedAction !== 'approve') return null;
  if (approval.approvalStatus !== 'approved') throw new HttpError(409, 'This withdrawal proposal has not been authorized.');
  if (approval.withdrawalStatus !== 'pending_review' && approval.withdrawalStatus !== 'awaiting_ceo') {
    throw new HttpError(409, 'This withdrawal is no longer awaiting processing.');
  }
  if (process.env.PLISIO_WITHDRAWALS_ENABLED !== 'true') {
    throw new HttpError(503, 'Plisio payouts are disabled. Set PLISIO_WITHDRAWALS_ENABLED=true only after verifying the merchant payout wallet and operational controls.');
  }
  if (!process.env.PLISIO_API_KEY) throw new HttpError(503, 'Plisio is not configured.');
  try {
    return await quotePlisioWithdrawal(approval.amountUsd, approval.destination);
  } catch (error) {
    throw new HttpError(503, `A fresh Plisio payout quote is unavailable; no payout was initiated. ${error.message}`);
  }
}

async function initiatePlisioWithdrawal(payout, actor, approvalId, requestId) {
  let data;
  try {
    data = await plisioRequest('/operations/withdraw', {
      psys_cid: 'USDT_TRX',
      to: payout.destination,
      amount: payout.amount,
      type: 'cash_out',
      feePlan: 'normal',
    });
  } catch (error) {
    await query(
      `UPDATE withdrawals SET provider_status = 'unknown', updated_at = now() WHERE id = $1`,
      [payout.withdrawalId],
    );
    await addAudit(actor, 'withdrawal.provider.submission_unknown', {
      withdrawalId: payout.withdrawalId,
      reason: 'Provider response was unavailable; the payout must be reconciled before retry.',
    }, 'failure', requestId);
    return 'unknown';
  }
  let operation;
  try {
    operation = normalizePlisioOperation(data);
  } catch (error) {
    await query(
      `UPDATE withdrawals SET provider_status = 'unknown', provider_payload = $2::jsonb,
         updated_at = now() WHERE id = $1`,
      [payout.withdrawalId, JSON.stringify({ reason: 'invalid_provider_response' })],
    );
    await addAudit(actor, 'withdrawal.provider_response.invalid', {
      withdrawalId: payout.withdrawalId, reason: error.message,
    }, 'failure', requestId);
    return 'unknown';
  }
  const matches = operation.destination === payout.destination
    && decimalEqual(operation.amount, payout.amount)
    && ['USDT', 'USDT_TRX'].includes(operation.currency);
  await query(
    `UPDATE withdrawals SET provider_reference = $2, provider_status = $3,
       provider_payload = $4::jsonb, updated_at = now() WHERE id = $1`,
    [
      payout.withdrawalId, operation.id, matches ? operation.providerStatus : 'mismatch',
      JSON.stringify({ status: operation.providerStatus, amount: operation.amount, currency: operation.currency }),
    ],
  );
  if (!matches) {
    await addAudit(actor, 'withdrawal.provider_response.mismatch', {
      withdrawalId: payout.withdrawalId, providerOperationId: operation.id,
    }, 'failure', requestId);
    return 'mismatch';
  }
  await addAudit(actor, 'withdrawal.provider.submitted', {
    withdrawalId: payout.withdrawalId, providerOperationId: operation.id,
    providerAmount: operation.amount, providerCurrency: operation.currency,
  }, 'success', requestId);
  try {
    return (await syncPlisioWithdrawal(payout.withdrawalId, actor, requestId)).providerStatus;
  } catch (error) {
    await addAudit(actor, 'withdrawal.provider.status_unavailable', {
      withdrawalId: payout.withdrawalId, providerOperationId: operation.id, reason: error.message,
    }, 'failure', requestId);
    return 'status_unavailable';
  }
}

async function loadTransaction(client, type, id) {
  const table = type === 'deposit' ? 'deposits' : type === 'withdrawal' ? 'withdrawals' : null;
  if (!table) throw new HttpError(400, 'Unsupported transaction type.');
  const specificFields = type === 'deposit'
    ? `t.currency, t.provider_reference AS "providerReference", t.provider_status AS "providerStatus"`
    : `t.currency, t.network, t.destination, t.provider_amount AS "providerAmount",
       t.provider_currency AS "providerCurrency", t.provider_fee AS "providerFee"`;
  const { rows } = await client.query(
    `SELECT t.id, t.investor_id AS "investorId", i.account_id AS "investorAccountId",
            i.display_name AS "investorName", t.amount_usd::text AS "amountUsd",
            t.status, ${specificFields}
     FROM ${table} t JOIN investors i ON i.id = t.investor_id
     WHERE t.id = $1 FOR UPDATE OF t`,
    [id],
  );
  return rows[0] || null;
}

function transactionFingerprint(transaction) {
  return hashToken(JSON.stringify(transaction));
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function moneyInCents(value) {
  const [whole, fraction = ''] = String(value).split('.');
  return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
}

async function adjustWallet(request, response, actor, accountId, requestId) {
  const body = await readJson(request);
  const amount = typeof body.amount === 'string' ? body.amount.trim() : '';
  const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
  const operation = body.operation;
  const idempotencyKey = request.headers['idempotency-key'];
  if (!['credit', 'debit'].includes(operation)) {
    await rejectWalletAdjustment(response, actor, accountId, operation, amount, reason, requestId, 400, 'Choose credit or debit.');
    return;
  }
  if (!/^(?:0|[1-9]\d{0,17})(?:\.\d{1,2})?$/.test(amount) || Number(amount) <= 0) {
    await rejectWalletAdjustment(response, actor, accountId, operation, amount, reason, requestId, 400, 'Enter a positive USD amount with no more than two decimal places.');
    return;
  }
  if (reason.length < 3 || reason.length > 500) {
    await rejectWalletAdjustment(response, actor, accountId, operation, amount, reason, requestId, 400, 'Provide a reason between 3 and 500 characters.');
    return;
  }
  if (typeof idempotencyKey !== 'string' || !/^[0-9a-f-]{36}$/i.test(idempotencyKey)) {
    await rejectWalletAdjustment(response, actor, accountId, operation, amount, reason, requestId, 400, 'A valid idempotency key is required. Please retry the action.');
    return;
  }

  const fingerprint = hashToken(JSON.stringify({ accountId, amount, operation, reason }));
  let result;
  try {
    result = await withTransaction(async (client) => {
      await client.query(
        `SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`,
        [`${actor.id}:${idempotencyKey}`],
      );
      const { rows: priorRows } = await client.query(
        `SELECT reference, amount_usd::text AS amount, available_after::text AS "availableBalance",
                reserved_after::text AS "reservedBalance", request_fingerprint AS fingerprint
         FROM wallet_ledger WHERE actor_account_id = $1 AND idempotency_key = $2`,
        [actor.id, idempotencyKey],
      );
      const prior = priorRows[0];
      if (prior) {
        if (prior.fingerprint !== fingerprint) throw new HttpError(409, 'This idempotency key was already used for a different adjustment.');
        const { reference, amount: recordedAmount, availableBalance, reservedBalance } = prior;
        const adjustment = { reference, amount: recordedAmount, availableBalance, reservedBalance };
        return { adjustment, replayed: true };
      }

      const { rows: walletRows } = await client.query(
        `SELECT w.investor_id, i.anonymized_at AS "anonymizedAt",
                w.available_balance::text AS "availableBalance",
                w.reserved_balance::text AS "reservedBalance"
         FROM wallets w JOIN investors i ON i.id = w.investor_id
         WHERE i.account_id = $1 FOR UPDATE OF i, w`,
        [accountId],
      );
      const wallet = walletRows[0];
      if (!wallet) throw new HttpError(404, 'Investor wallet was not found.');
      if (wallet.anonymizedAt) throw new HttpError(409, 'An anonymized investor account cannot receive wallet adjustments.');
      const signedAmount = operation === 'credit' ? amount : `-${amount}`;
      const { rows: updatedRows } = await client.query(
        `UPDATE wallets SET available_balance = available_balance + $2::numeric, updated_at = now()
         WHERE investor_id = $1 AND available_balance + $2::numeric >= 0
         RETURNING available_balance::text AS "availableBalance", reserved_balance::text AS "reservedBalance"`,
        [wallet.investor_id, signedAmount],
      );
      const updated = updatedRows[0];
      if (!updated) throw new HttpError(409, 'The wallet does not have enough available funds for this debit.');
      const reference = `GSQ-ADJ-${randomUUID().replaceAll('-', '').toUpperCase()}`;
      const { rows: ledgerRows } = await client.query(
        `INSERT INTO wallet_ledger
           (investor_id, amount_usd, available_after, reserved_after, entry_type, reference,
            idempotency_key, request_fingerprint, actor_account_id, reason)
         VALUES ($1, $2::numeric, $3::numeric, $4::numeric, $5, $6, $7, $8, $9, $10)
         RETURNING reference, amount_usd::text AS amount, available_after::text AS "availableBalance",
           reserved_after::text AS "reservedBalance"`,
        [
          wallet.investor_id,
          signedAmount,
          updated.availableBalance,
          updated.reservedBalance,
          `admin_${operation}`,
          reference,
          idempotencyKey,
          fingerprint,
          actor.id,
          reason,
        ],
      );
      await writeAudit(client, actor, `wallet.${operation}`, {
        investorAccountId: accountId,
        amount: signedAmount,
        previousBalance: wallet.availableBalance,
        resultingBalance: updated.availableBalance,
        reference,
        reason,
      }, 'success', requestId);
      return { adjustment: ledgerRows[0], replayed: false };
    });
  } catch (error) {
    await addAudit(actor, 'wallet.adjustment.failed', {
      investorAccountId: accountId,
      operation,
      amount,
      reason,
      error: error.status ? error.message : 'The adjustment transaction failed.',
    }, 'failure', requestId);
    throw error;
  }
  sendJson(response, 200, result);
}

async function rejectWalletAdjustment(response, actor, accountId, operation, amount, reason, requestId, status, message) {
  await addAudit(actor, 'wallet.adjustment.rejected', {
    investorAccountId: accountId,
    operation,
    amount: amount.slice(0, 40),
    reason: reason.slice(0, 500),
    error: message,
  }, 'denied', requestId);
  sendJson(response, status, { error: message, requestId });
}

async function getDashboard(response) {
  const { rows } = await query(
    `SELECT
       (SELECT count(*)::int FROM investors) AS "totalInvestors",
       (SELECT count(*)::int FROM investors WHERE status = 'active') AS "activeInvestors",
       (SELECT count(*)::int FROM investors WHERE status = 'suspended') AS "suspendedInvestors",
       (SELECT count(*)::int FROM admin_accounts WHERE role = 'STAFF') AS "totalStaff",
       (SELECT count(*)::int FROM admin_accounts WHERE role = 'STAFF' AND status = 'active') AS "activeStaff",
       (SELECT count(*)::int FROM admin_accounts WHERE role = 'STAFF' AND status IN ('revoked', 'suspended')) AS "revokedStaff",
       (SELECT count(*)::int FROM deposits WHERE status IN ('pending', 'payment_reported', 'payment_confirmed', 'awaiting_ceo')) AS "pendingDeposits",
       (SELECT count(*)::int FROM withdrawals WHERE status IN ('pending_review', 'awaiting_ceo', 'ceo_approved', 'processing')) AS "pendingWithdrawals",
       (SELECT count(*)::int FROM approval_requests WHERE status = 'pending') AS "pendingApprovals",
       (SELECT count(*)::int FROM approval_requests
         WHERE status = 'pending' AND transaction_type = 'deposit') AS "approvalsForDeposits",
       (SELECT count(*)::int FROM approval_requests
         WHERE status = 'pending' AND transaction_type = 'withdrawal') AS "approvalsForWithdrawals",
       (SELECT count(*)::int FROM deposits WHERE status = 'credited') +
         (SELECT count(*)::int FROM withdrawals WHERE status = 'paid') AS "completedTransactions",
       (SELECT count(*)::int FROM deposits WHERE status IN ('rejected', 'failed', 'expired')) +
         (SELECT count(*)::int FROM withdrawals WHERE status IN ('ceo_rejected', 'failed', 'cancelled')) AS "rejectedTransactions",
       (SELECT COALESCE(sum(available_balance + reserved_balance), 0)::text FROM wallets) AS "walletLiabilities",
       (SELECT COALESCE(sum(reserved_balance), 0)::text FROM wallets) AS "reservedWalletBalance",
       (SELECT count(*)::int FROM trades) AS "recordedTrades",
       (SELECT count(*)::int FROM audit_logs WHERE created_at > now() - interval '24 hours'
         AND result IN ('failure', 'denied')) AS "securityEvents24h"`,
  );
  const { rows: recentAudit } = await query(
    `SELECT id, actor_label AS "actorLabel", actor_role AS "actorRole", action_type AS "actionType",
            result, created_at AS "createdAt"
     FROM audit_logs ORDER BY created_at DESC LIMIT 8`,
  );
  const { rows: settingRows } = await query(
    `SELECT key, value FROM app_settings WHERE key = ANY($1::text[])`,
    [['dashboard_notice_enabled', 'dashboard_notice']],
  );
  const dashboardSettings = Object.fromEntries(settingRows.map((setting) => [setting.key, setting.value]));
  sendJson(response, 200, {
    metrics: rows[0],
    trading: { status: 'unavailable', message: 'Trading engine is not connected.' },
    notice: {
      enabled: dashboardSettings.dashboard_notice_enabled ?? false,
      message: dashboardSettings.dashboard_notice ?? '',
    },
    recentAudit,
  });
}

async function getTransactions(response, kind, requestedPage) {
  if (kind && !['deposit', 'withdrawal'].includes(kind)) {
    sendJson(response, 400, { error: 'Transaction type must be deposit or withdrawal.' });
    return;
  }
  const pageSize = kind ? 50 : 250;
  if (requestedPage !== null && !/^[1-9]\d{0,6}$/.test(requestedPage)) {
    sendJson(response, 400, { error: 'Page must be a positive whole number.' });
    return;
  }
  let page = requestedPage === null ? 1 : Number(requestedPage);
  if (page > 1_000_000) {
    sendJson(response, 400, { error: 'Page must be a positive whole number.' });
    return;
  }
  const transactions = [];
  let total = 0;
  if (kind) {
    const table = kind === 'deposit' ? 'deposits' : 'withdrawals';
    const { rows } = await query(`SELECT count(*)::int AS total FROM ${table}`);
    total = rows[0].total;
    page = Math.min(page, Math.max(1, Math.ceil(total / pageSize)));
  }
  const offset = (page - 1) * pageSize;
  if (!kind || kind === 'deposit') {
    const { rows } = await query(
      `SELECT d.id, 'deposit' AS kind, i.account_id AS "investorAccountId", i.display_name AS "investorName",
              d.amount_usd::text AS "amountUsd", d.currency, d.status, d.provider_reference AS "providerReference",
              d.provider_status AS "providerStatus", d.created_at AS "createdAt",
              d.provider_invoice_id AS "providerInvoiceId", d.invoice_url AS "invoiceUrl",
              d.invoice_address AS "invoiceAddress", d.expires_at AS "expiresAt",
              (SELECT jsonb_build_object('id', ar.id, 'status', ar.status, 'proposedAction', ar.proposed_action)
               FROM approval_requests ar WHERE ar.transaction_type = 'deposit' AND ar.transaction_id = d.id
               ORDER BY ar.created_at DESC LIMIT 1) AS approval
       FROM deposits d JOIN investors i ON i.id = d.investor_id
       ORDER BY d.created_at DESC, d.id DESC${kind ? ' LIMIT $1 OFFSET $2' : ' LIMIT 250'}`,
      kind ? [pageSize, offset] : [],
    );
    transactions.push(...rows);
  }
  if (!kind || kind === 'withdrawal') {
    const { rows } = await query(
      `SELECT w.id, 'withdrawal' AS kind, i.account_id AS "investorAccountId", i.display_name AS "investorName",
              w.amount_usd::text AS "amountUsd", w.currency, w.network, w.destination,
              w.status, w.provider_reference AS "providerReference", w.provider_status AS "providerStatus",
              w.provider_amount AS "providerAmount", w.provider_currency AS "providerCurrency",
              w.provider_fee AS "providerFee", w.payout_quote_expires_at AS "quoteExpiresAt",
              w.created_at AS "createdAt",
              (SELECT jsonb_build_object('id', ar.id, 'status', ar.status, 'proposedAction', ar.proposed_action)
               FROM approval_requests ar WHERE ar.transaction_type = 'withdrawal' AND ar.transaction_id = w.id
               ORDER BY ar.created_at DESC LIMIT 1) AS approval
       FROM withdrawals w JOIN investors i ON i.id = w.investor_id
       ORDER BY w.created_at DESC, w.id DESC${kind ? ' LIMIT $1 OFFSET $2' : ' LIMIT 250'}`,
      kind ? [pageSize, offset] : [],
    );
    transactions.push(...rows);
  }
  transactions.sort((left, right) => new Date(right.createdAt) - new Date(left.createdAt));
  sendJson(response, 200, {
    transactions: transactions.slice(0, pageSize),
    pagination: {
      page,
      pageSize,
      total: kind ? total : transactions.length,
      totalPages: kind ? Math.max(1, Math.ceil(total / pageSize)) : 1,
    },
  });
}

async function getInvestorDetails(response, accountId, actor, requestId, url) {
  const { rows: investors } = await query(
    `SELECT i.id, i.account_id AS "accountId", i.display_name AS "displayName", i.status,
            i.username, i.email, i.phone, i.country, i.anonymized_at AS "anonymizedAt",
            i.created_at AS "createdAt", i.updated_at AS "updatedAt",
            COALESCE(w.available_balance, 0)::text AS "availableBalance",
            COALESCE(w.reserved_balance, 0)::text AS "reservedBalance"
     FROM investors i LEFT JOIN wallets w ON w.investor_id = i.id
     WHERE i.account_id = $1`,
    [accountId],
  );
  const investor = investors[0];
  if (!investor) {
    sendJson(response, 404, { error: 'Investor account was not found.' });
    return;
  }
  await addAudit(actor, 'investor.profile.viewed', { accountId }, 'success', requestId);
  const pageSize = 50;
  const pages = {
    deposits: readPageParam(url, 'depositsPage'),
    withdrawals: readPageParam(url, 'withdrawalsPage'),
    ledger: readPageParam(url, 'ledgerPage'),
    activity: readPageParam(url, 'activityPage'),
  };
  const { rows: countRows } = await query(
    `SELECT
       (SELECT count(*)::int FROM deposits WHERE investor_id = $1) AS deposits,
       (SELECT count(*)::int FROM withdrawals WHERE investor_id = $1) AS withdrawals,
       (SELECT count(*)::int FROM wallet_ledger WHERE investor_id = $1) AS ledger,
       (SELECT count(*)::int FROM audit_logs
        WHERE affected_account_id = $2 OR details->>'accountId' = $2
           OR details->>'investorAccountId' = $2) AS activity`,
    [investor.id, accountId],
  );
  const historyPagination = Object.fromEntries(Object.entries(pages).map(([key, page]) => {
    const total = countRows[0][key];
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const currentPage = Math.min(page, totalPages);
    return [key, { page: currentPage, pageSize, total, totalPages }];
  }));
  const [deposits, withdrawals, ledger, activity] = await Promise.all([
    query(
      `SELECT id, amount_usd::text AS "amountUsd", currency, status,
              provider_reference AS "providerReference", provider_status AS "providerStatus",
              created_at AS "createdAt"
       FROM deposits WHERE investor_id = $1 ORDER BY created_at DESC, id DESC LIMIT $2 OFFSET $3`,
      [investor.id, pageSize, (historyPagination.deposits.page - 1) * pageSize],
    ),
    query(
      `SELECT id, amount_usd::text AS "amountUsd", currency, network, destination, status,
              provider_reference AS "providerReference", created_at AS "createdAt"
       FROM withdrawals WHERE investor_id = $1 ORDER BY created_at DESC, id DESC LIMIT $2 OFFSET $3`,
      [investor.id, pageSize, (historyPagination.withdrawals.page - 1) * pageSize],
    ),
    query(
      `SELECT l.reference, l.amount_usd::text AS amount, l.available_after::text AS "availableAfter",
              l.reserved_after::text AS "reservedAfter", l.entry_type AS "entryType", l.reason,
              a.display_name AS actor, l.created_at AS "createdAt"
       FROM wallet_ledger l LEFT JOIN admin_accounts a ON a.id = l.actor_account_id
       WHERE l.investor_id = $1 ORDER BY l.created_at DESC, l.id DESC LIMIT $2 OFFSET $3`,
      [investor.id, pageSize, (historyPagination.ledger.page - 1) * pageSize],
    ),
    query(
      `SELECT id, actor_label AS "actorLabel", actor_role AS "actorRole",
              action_type AS "actionType", transaction_id AS "transactionId",
              approval_request_id AS "approvalRequestId", details, result, created_at AS "createdAt"
       FROM audit_logs
       WHERE affected_account_id = $1 OR details->>'accountId' = $1
          OR details->>'investorAccountId' = $1
       ORDER BY created_at DESC, id DESC LIMIT $2 OFFSET $3`,
      [accountId, pageSize, (historyPagination.activity.page - 1) * pageSize],
    ),
  ]);
  sendJson(response, 200, {
    investor,
    deposits: deposits.rows,
    withdrawals: withdrawals.rows,
    ledger: ledger.rows,
    activity: activity.rows,
    historyPagination,
    trading: { available: false, message: 'No investor-linked trading records are available.' },
  });
}

function readPageParam(url, key) {
  const value = url.searchParams.get(key);
  if (value === null) return 1;
  if (!/^[1-9]\d{0,6}$/.test(value) || Number(value) > 1_000_000) {
    throw new HttpError(400, `${key} must be a positive whole number.`);
  }
  return Number(value);
}

async function readAudit(response, url, actor, requestId) {
  const events = await queryAuditEvents(url, 500);
  const { search, role, action, from, to } = auditFilters(url);
  await addAudit(actor, 'audit.logs.viewed', { filters: { query: search, role, action, from, to } }, 'success', requestId);
  sendJson(response, 200, { events });
}

async function exportAudit(response, url, actor, requestId) {
  const events = await queryAuditEvents(url, 5000);
  const { search, role, action, from, to } = auditFilters(url);
  await addAudit(actor, 'audit.logs.exported', { filters: { query: search, role, action, from, to }, exportedCount: events.length }, 'success', requestId);
  const headers = ['id', 'actorAccountId', 'actorLabel', 'actorRole', 'actionType', 'affectedAccountId', 'transactionId', 'approvalRequestId', 'details', 'result', 'requestId', 'createdAt'];
  const lines = [headers.map(csvCell).join(',')];
  for (const event of events) lines.push(headers.map((key) => csvCell(
    key === 'details' ? JSON.stringify(event[key]) : event[key],
  )).join(','));
  response.writeHead(200, {
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': 'attachment; filename="g-squad-audit.csv"',
    'Cache-Control': 'no-store',
  });
  response.end(lines.join('\r\n'));
}

async function queryAuditEvents(url, limit) {
  const { search, role, action, from, to } = auditFilters(url);
  const { rows } = await query(
    `SELECT id, actor_account_id AS "actorAccountId", actor_label AS "actorLabel",
            actor_role AS "actorRole", action_type AS "actionType",
            affected_account_id AS "affectedAccountId", transaction_id AS "transactionId",
            approval_request_id AS "approvalRequestId", details, result, request_id AS "requestId",
            created_at AS "createdAt"
     FROM audit_logs
     WHERE ($1 = '' OR actor_label ILIKE '%' || $1 || '%' OR actor_account_id::text ILIKE '%' || $1 || '%'
       OR affected_account_id ILIKE '%' || $1 || '%' OR transaction_id ILIKE '%' || $1 || '%'
       OR approval_request_id ILIKE '%' || $1 || '%' OR action_type ILIKE '%' || $1 || '%')
       AND ($2 = '' OR actor_role = $2)
       AND ($3 = '' OR action_type ILIKE '%' || $3 || '%')
       AND ($4::timestamptz IS NULL OR created_at >= $4::timestamptz)
       AND ($5::timestamptz IS NULL OR created_at <= $5::timestamptz)
     ORDER BY created_at DESC LIMIT ${limit}`,
    [search, role, action, from, to],
  );
  return rows;
}

function auditFilters(url) {
  const search = (url.searchParams.get('q') || '').trim().slice(0, 100);
  const role = url.searchParams.get('role') || '';
  const action = (url.searchParams.get('action') || '').trim().slice(0, 100);
  const fromInput = (url.searchParams.get('from') || '').trim();
  const toInput = (url.searchParams.get('to') || '').trim();
  if (role && !['CEO', 'STAFF', 'INVESTOR', 'SYSTEM', 'ANONYMOUS'].includes(role)) {
    throw new HttpError(400, 'Select a supported actor role.');
  }
  const fromDate = parseAuditDate(fromInput);
  const toDate = parseAuditDate(toInput);
  if (fromInput && !fromDate || toInput && !toDate) {
    throw new HttpError(400, 'Enter valid audit date and time filters.');
  }
  if (fromDate && toDate && fromDate > toDate) {
    throw new HttpError(400, 'The start date must be before the end date.');
  }
  return {
    search, role, action,
    from: fromDate?.toISOString() || null,
    to: toDate?.toISOString() || null,
  };
}

function parseAuditDate(value) {
  if (!value) return null;
  if (value.length > 50) return null;
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? null : new Date(timestamp);
}

function csvCell(value) {
  let content = value === null || value === undefined ? '' : String(value);
  if (/^[\t\r ]*[=+\-@]/.test(content)) content = `'${content}`;
  return `"${content.replaceAll('"', '""')}"`;
}

async function authenticate(request) {
  const cookies = parseCookies(request.headers.cookie);
  const token = cookies[sessionCookie];
  if (!token) throw new HttpError(401, 'Authentication required.');
  const { rows } = await query(
    `SELECT s.token_hash AS "tokenHash", s.csrf_hash AS "csrfHash",
            a.id, a.account_id AS "accountId", a.display_name AS "displayName", a.role,
            a.permissions, a.status, a.session_version AS "sessionVersion",
            s.account_version AS "accountVersion"
     FROM admin_sessions s JOIN admin_accounts a ON a.id = s.account_id
     WHERE s.token_hash = $1 AND s.expires_at > now()`,
    [hashToken(token)],
  );
  const session = rows[0];
  if (!session || session.accountVersion !== session.sessionVersion || session.status !== 'active') {
    throw new HttpError(401, 'Session expired or access revoked.');
  }
  return { ...session, account: session };
}

function requireCsrf(request, session) {
  const supplied = request.headers['x-csrf-token'];
  if (typeof supplied !== 'string' || !equalHashValue(hashToken(supplied), session.csrfHash)) {
    throw new HttpError(403, 'Request verification failed. Refresh and try again.');
  }
}

function equalHashValue(a, b) {
  const left = Buffer.from(a, 'hex');
  const right = Buffer.from(b, 'hex');
  return left.length === right.length && timingSafeEqual(left, right);
}

function requireCeo(account) {
  if (account.role !== 'CEO') throw new HttpError(403, 'This action is restricted to a CEO.');
}

function requireAnyPermission(account, required) {
  if (account.role === 'CEO') return;
  const grants = new Set(account.permissions || []);
  if (!required.some((permission) => grants.has(permission))) {
    throw new HttpError(403, 'Your account does not have permission to perform this action.');
  }
}

function publicAccount(account) {
  return {
    accountId: account.accountId,
    displayName: account.displayName,
    role: account.role,
    permissions: account.role === 'CEO' ? ['*'] : account.permissions,
  };
}

async function addAudit(account, action, details, result, requestId, related = {}) {
  await query(
    `INSERT INTO audit_logs
       (actor_account_id, actor_label, actor_role, action_type, details, result, request_id, affected_account_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      account?.id || null,
      account?.displayName || account?.accountId || 'ANONYMOUS',
      account?.role || 'ANONYMOUS',
      action,
      JSON.stringify(details),
      result,
      requestId,
      related.affectedAccountId || null,
    ],
  );
}

async function writeAudit(client, account, action, details, result, requestId, related = {}) {
  await client.query(
    `INSERT INTO audit_logs
       (actor_account_id, actor_label, actor_role, action_type, details, result, request_id,
        affected_account_id, transaction_id, approval_request_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [
      account?.id || null,
      account?.displayName || account?.accountId || 'SYSTEM',
      account?.role || 'SYSTEM',
      action,
      JSON.stringify(details),
      result,
      requestId,
      related.affectedAccountId || null,
      related.transactionId || null,
      related.approvalRequestId || null,
    ],
  );
}

function validateOrigin(request) {
  const origin = request.headers.origin;
  const configured = process.env.APP_ORIGIN;
  if (!origin) throw new HttpError(403, 'A trusted application origin is required.');
  try {
    const received = new URL(origin);
    if (configured) {
      if (received.origin !== new URL(configured).origin) throw new Error('origin mismatch');
    } else if (isProduction || !['http://localhost:5173', 'http://127.0.0.1:5173'].includes(received.origin)) {
      throw new Error('origin is not configured');
    }
  } catch {
    throw new HttpError(403, 'Request origin is not allowed.');
  }
}

async function readJson(request) {
  let body = '';
  for await (const chunk of request) {
    body += chunk.toString();
    if (Buffer.byteLength(body, 'utf8') > 16_384) throw new HttpError(413, 'Request body is too large.');
  }
  try {
    const parsed = JSON.parse(body || '{}');
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Invalid body');
    return parsed;
  } catch {
    throw new HttpError(400, 'Request body must be a valid JSON object.');
  }
}

async function serveFrontend(request, response, pathname) {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    sendJson(response, 405, { error: 'Method not allowed.' });
    return;
  }
  if (!existsSync(staticRoot)) {
    sendJson(response, 503, { error: 'Frontend build is missing. Run npm run build.' });
    return;
  }
  const requestedPath = pathname === '/' ? '/index.html' : pathname;
  let file = resolve(staticRoot, `.${requestedPath}`);
  if (!file.startsWith(`${staticRoot}${sep}`) || !existsSync(file) || (await stat(file)).isDirectory()) {
    file = resolve(staticRoot, 'index.html');
  }
  if (!existsSync(file)) {
    sendJson(response, 404, { error: 'Page not found.' });
    return;
  }
  const types = {
    '.css': 'text/css; charset=utf-8',
    '.html': 'text/html; charset=utf-8',
    '.ico': 'image/x-icon',
    '.js': 'text/javascript; charset=utf-8',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
  };
  response.writeHead(200, { 'Content-Type': types[extname(file)] || 'application/octet-stream' });
  if (request.method === 'HEAD') response.end();
  else createReadStream(file).pipe(response);
}

function setSecurityHeaders(response) {
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('X-Frame-Options', 'DENY');
  response.setHeader('Referrer-Policy', 'no-referrer');
  response.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  response.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'");
  if (isProduction) response.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
}

function setCookie(response, name, value, { httpOnly, maxAge }) {
  const flags = [
    `${name}=${encodeURIComponent(value)}`,
    'Path=/',
    'SameSite=Strict',
    `Max-Age=${maxAge}`,
  ];
  if (httpOnly) flags.push('HttpOnly');
  if (isProduction) flags.push('Secure');
  response.setHeader('Set-Cookie', [...(response.getHeader('Set-Cookie') || []), flags.join('; ')]);
}

function clearCookies(response) {
  const secure = isProduction ? '; Secure' : '';
  response.setHeader('Set-Cookie', [
    `${sessionCookie}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure}`,
    `${csrfCookie}=; Path=/; SameSite=Strict; Max-Age=0${secure}`,
  ]);
}

function sendJson(response, status, body) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(body));
}

function safeErrorMessage(error) {
  return process.env.NODE_ENV === 'production' ? 'internal error' : error.message || 'unknown error';
}

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
