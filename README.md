# G-Squad Admin

Responsive administrative console built with Node.js, React, Bootstrap, and Neon PostgreSQL. The Node server uses its built-in HTTP module; there is no Express, Next.js, Prisma, separate API service, demo data, or seeded financial activity.

## Run locally

Requirements: Node.js 24 or newer and a Neon PostgreSQL database.

1. Install packages with `npm install`.
2. Copy `.env.example` to `.env` and configure:
   - `DATABASE_URL`: Neon connection string for the server only.
   - `TOTP_ENCRYPTION_KEY`: a persistent base64-encoded 32-byte key. Generate one with `openssl rand -base64 32`; keep it in a secrets manager and back it up securely. Losing it makes authenticator secrets unrecoverable.
   - `APP_ORIGIN`: required in production; set the exact public origin, such as `https://admin.example.com`.
   - `CEO_ONE_ID` and `CEO_TWO_ID`: two distinct initial admin account identifiers used only by the bootstrap command.
3. Apply the schema: `npm run db:migrate`.
4. Create the two CEO identities: `npm run admin:bootstrap`. They start enrollment-pending. The command prints a unique one-time setup code for each CEO; give it only to its named CEO and securely remove terminal history/logs containing the codes. Bootstrap cannot be repeated after CEO identities exist; no HTTP route can create a CEO.
5. Start the development app: `npm run dev`. It starts the native Node API on port 3000 and Vite on port 5173. Open the Vite URL.
6. For production, run `npm run build`, set `NODE_ENV=production`, set `APP_ORIGIN` and `PORT`, then run `npm start` behind HTTPS. Production cookies are marked Secure.

## Deploy to Heroku

Deploy from the repository root. Heroku uses the `web` process in `Procfile`, installs the Node 24 runtime declared in `package.json`, and runs the production build to create the frontend in `dist/`.

1. Create a Heroku app and configure its Config Vars: `DATABASE_URL` (Neon connection string), `TOTP_ENCRYPTION_KEY` (persistent base64-encoded 32-byte key), `APP_ORIGIN` (the exact public HTTPS origin, such as `https://your-app.herokuapp.com`), and `NODE_ENV=production`. Do not commit these values. Heroku sets `PORT` for the web process; do not set it manually.
2. Deploy the repository root to Heroku. Confirm the web process starts and the app URL returns the G-Squad Admin sign-in page.
3. Apply the database schema once with `heroku run npm run db:migrate -a your-app-name`.
4. For first-time setup only, set `CEO_ONE_ID` and `CEO_TWO_ID` as Heroku Config Vars, then run `heroku run npm run admin:bootstrap -a your-app-name`. Securely deliver each printed one-time setup code to its named CEO, then remove both identifier Config Vars. Never put setup codes in source control or deployment logs.

The admin page can load before a database is configured, but sign-in and admin operations require a reachable Neon database and the migrations. Use Heroku logs to diagnose a failed web process; do not expose secrets when sharing logs.

The migration is safe to reapply. The database trigger enforces a maximum of two CEO identities, including enrollment-pending and deactivated CEO records. Staff accounts are created by a CEO in the dashboard; the displayed enrollment code is single-use and expires after 24 hours. CEO and staff setup codes expire after 24 hours. Setup requires the account ID and one-time code, then the user registers Google Authenticator and verifies a current six-digit code before the account becomes active. Routine login then uses the account ID and a fresh six-digit authenticator code.

## First CEO login

There is no default username/password and no public registration. Configure `DATABASE_URL`, `TOTP_ENCRYPTION_KEY`, `CEO_ONE_ID`, and `CEO_TWO_ID` in `.env`, then run `npm run db:migrate` followed by `npm run admin:bootstrap` exactly once. Bootstrap creates two enrollment-pending CEO identities and prints one one-time setup code for each. In the app, each CEO enters their own account ID and continues, chooses **First time? Set up authenticator**, and enters only the setup code printed on that CEO's line (surrounding whitespace is ignored). The setup code is required before the authenticator secret or provisioning URI is displayed; the CEO adds it to Google Authenticator and verifies a current six-digit code. Verification activates the CEO account. The CEO can then sign in with the account ID and a fresh six-digit authenticator code. Setup codes expire after 24 hours and are printed only once. If the code is rejected, confirm the account ID matches its line, that the app and bootstrap command use the same database, and that the code has not expired or been used to finish enrollment. If bootstrap has already run, it will not print setup codes again; use the authenticator already enrolled or the authorized recovery process. Staff enter their account ID, continue, choose **First time? Set up authenticator**, and use the one-time enrollment code supplied by their CEO before enrolling with Google Authenticator and signing in with their six-digit code.

## What is implemented

- Responsive light-theme React/Bootstrap admin console using `6819650.png`.
- Native Node HTTP server, same-origin checks for state-changing requests, CSRF tokens, HTTP-only sessions, expiry and server-side session-version revocation.
- TOTP-only CEO/staff login, AES-256-GCM encryption of stored authenticator secrets, replay rejection, persistent login throttling, single-use staff enrollment, CEO-controlled authenticator replacement, and staff action history.
- CEO investor suspension/reactivation and wallet adjustments using row locks, fixed-precision database arithmetic, idempotency keys, append-only ledger entries, and audit records.
- Searchable investor profiles with username, email, phone, and country fields; audited profile changes; and CEO deletion/anonymization guarded against open obligations and non-zero balances while preserving financial and audit history.
- Permission-gated customer-support account lookup, internal notes, CEO escalation notifications, and audited access. No external ticket inbox is represented as connected.
- Staff payment proposals, CEO decisions, transaction-fingerprint checks, audited final actions, verified-deposit-only credits, and safe withdrawal reservation release on rejection.
- Neon schema for administrative identities, investors, wallets and append-only ledger records, deposits, withdrawals, approvals, trades, settings, notifications, sessions, and append-only audit records.
- Database-backed dashboard statistics, investor/transaction/approval/trading/audit read views, and clear empty or unavailable states.
- CEO-only audit search by identity/action/transaction, role/action/date filters, audit-access records, and formula-safe CSV exports.
- CEO-only audited dashboard announcements and validated trading-configuration drafts covering strategy notes, permitted markets/contracts, and recovery settings. Draft settings are not connected to an execution engine.
- Persistent, account-scoped notifications for CEO decisions and escalated support notes; dashboard outcomes distinguish completed, rejected, pending, and reserved amounts.
- The supplied logo, light surfaces, muted yellow accents, responsive mobile navigation, validation feedback, and top-positioned notifications.
- Unit tests for authenticator code verification, enrollment URI generation, investor-profile validation, and application-setting validation (`npm test`).

## External integration boundaries

Deposit invoices, server-side provider status checks, webhook verification, and approval-gated wallet credits are implemented, subject to valid server-side Plisio credentials and account eligibility. Payment queues and investor-profile histories are paginated. Investor deletion uses audited anonymization after outstanding obligations are resolved; immutable financial and audit history is preserved. The support screen records internal notes and CEO escalations; it is not a customer-facing ticketing system. CEOs can save an audited trading-configuration draft, but the draft does not configure a provider or control an execution engine. Payment credentials remain server-side environment configuration. Plisio withdrawals can be submitted and reconciled only when the server-side payout kill switch is explicitly enabled and the merchant configuration has been verified. Deriv account status can be checked from the server, but live trade execution remains disabled pending verified provider permissions, trading rules and limits, operational risk controls, and applicable legal/regulatory authorization. No results or balances are fabricated.

Audit and ledger rows reject ordinary SQL updates/deletes through database triggers. This is not a claim of protection from database-owner actions, privileged migrations, or infrastructure compromise; production still needs restricted database roles, backups, and an operational security review.