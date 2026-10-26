PROJECT: G-SQUAD ADMIN DASHBOARD — PART 1 OF 4

Build the administrative side of G-Squad, an automated trading application with investor accounts, internal wallets, deposits, withdrawals, trading management, and staff operations.

IMPORTANT: Follow these requirements exactly. Do not remove features, invent permissions, or replace the selected technology stack.

1. APPROVED TECHNOLOGY STACK

Use only the following technologies:

- Node.js for server-side processing.
- React for the user interface.
- Bootstrap for styling and responsive layouts.
- Neon DB (PostgreSQL) for the database.

STRICT RESTRICTIONS:

- Do not use Express.
- Do not use NestJS.
- Do not introduce Next.js or another framework without authorization.
- Do not create a separate API service.
- Do not expose database credentials or privileged operations to the browser.
- Use secure server-side request handling with Node.js. Database operations, authentication, authorization, and financial changes must never be performed solely in client-side React code.
- Use only the additional libraries strictly required to implement the approved stack securely.

2. APPLICATION DESIGN

Create a professional, responsive admin dashboard optimized for mobile phones and desktop computers.

Design requirements:

- Light background throughout.
- Deep, muted yellow for primary buttons and accents.
- White or light-colored cards.
- Dark, readable text.
- Clean navigation, subtle borders, and professional spacing.
- No dark theme.
- Loading indicators, confirmation dialogs, validation messages, empty states, and error handling.
- Modern notifications displayed at the TOP of the screen.

The admin interface must be visually consistent across every page.

3. USER ROLES

The application must support exactly these administrative roles:

A. CEO

- Exactly TWO authorized CEO accounts may exist.
- Both CEOs have full application access.
- Both CEOs can manage investors, staff, payments, trading settings, reports, and application configuration.
- No user interface or normal account-creation process may create a third CEO.
- CEO privileges must be enforced on the server, not just hidden in the interface.

B. STAFF

- There may be as many staff accounts as the CEO requires.
- Staff permissions are assigned and controlled by the CEO.
- Staff can access only authorized pages and actions.
- Staff must not be able to grant themselves permissions or create CEO accounts.
- Staff must not bypass mandatory CEO approval workflows.

4. CEO ACCOUNT INITIALIZATION

Provide a secure initial setup process for establishing the two authorized CEO accounts.

Requirements:

- Do not allow public CEO registration.
- Protect initial setup against unauthorized access and repeated execution.
- Enforce a database-level or transaction-safe maximum of two active CEO identities.
- Prevent ordinary staff-management actions from accidentally creating a third CEO.
- Preserve both CEO identities and their audit history.
- Any CEO account recovery process must be securely controlled and audited.

5. GOOGLE AUTHENTICATOR-ONLY ADMIN LOGIN

Neither CEO nor staff should use an email-and-password form for routine admin login.

Use Google Authenticator-compatible TOTP authentication.

Requirements:

- Each CEO and staff member must have an individually registered authenticator identity.
- The login interface must let the person identify their registered account without requiring email and password.
- Verify the submitted six-digit authenticator code against that specific account.
- Codes must be time-limited, verified securely, and protected against repeated guessing and replay.
- Never store authenticator secrets in plaintext.
- Never log authenticator codes or enrollment secrets.
- Reject login for suspended, revoked, disabled, or unauthorized accounts.
- Enforce server-side session expiration and secure logout.

IMPORTANT: A six-digit Google Authenticator code does not identify an account by itself. Account identification must therefore be securely bound to the correct registered account.

6. STAFF ACCOUNT CREATION AND AUTHENTICATOR ENROLLMENT

When a CEO creates a staff account:

1. The CEO enters the required staff information.
2. The CEO assigns the staff member's permissions.
3. The system creates an individually identifiable staff account.
4. The system generates a unique, single-use, expiring enrollment code.
5. The staff member uses the authorized enrollment process to register Google Authenticator.
6. The system verifies a valid authenticator code before completing enrollment.
7. The system invalidates the enrollment code after successful use or expiration.

Enrollment requirements:

- Never expose the TOTP secret or QR enrollment information to unauthorized users.
- Enrollment codes must be securely generated, stored, and verified.
- Provide an expiration and controlled regeneration process.
- Record enrollment, failed enrollment attempts, and authenticator replacement in the audit log.

7. STAFF ACCESS REVOCATION

The CEO can immediately revoke any staff member's dashboard access.

When access is revoked:

- Invalidate active sessions.
- Reject subsequent login attempts.
- Prevent further privileged operations.
- Preserve the account and all historical records.
- Record the CEO identity, affected staff identity, time, and reason.

Restoring access requires an authorized CEO action. If the authenticator must be replaced, require secure re-enrollment.

8. PART 1 ACCEPTANCE CRITERIA

Part 1 is complete only when:

- Exactly two CEO accounts are enforced.
- Staff accounts can be created without a fixed numerical limit.
- CEO and staff routine login uses Google Authenticator only.
- Enrollment and recovery are securely implemented.
- Revoked accounts cannot access the dashboard.
- All permissions are enforced server-side.
- The approved technology stack and light theme are followed.

Continue with Part 2.

PROJECT: G-SQUAD ADMIN DASHBOARD — PART 2 OF 4

Continue the existing G-Squad admin project from Part 1. Do not rebuild the application from scratch or change the approved technology stack.

Use Node.js, React, Bootstrap, and Neon DB only. Do not use Express, NestJS, Next.js, or a separate API service.

1. CEO DASHBOARD

Create a comprehensive CEO dashboard that provides an overview of the entire application.

Display relevant information such as:

- Total investor accounts.
- Active and suspended investors.
- Total staff accounts.
- Active and revoked staff accounts.
- Pending deposits.
- Pending withdrawals.
- Deposits awaiting CEO decisions.
- Withdrawals awaiting CEO decisions.
- Completed and rejected transactions.
- Internal wallet liabilities and outstanding payment obligations.
- Trading engine status.
- Recent trading activity and available performance statistics.
- Recent security events.
- Recent administrative actions.

All statistics must come from real database records or verified integrations.

Do not display fabricated users, transactions, profits, trading results, or payment confirmations.

2. CEO FULL ACCESS

Both authorized CEOs must have full administrative access to:

- Investor management.
- Staff management.
- Deposits and withdrawals.
- CEO approval requests.
- Internal wallet adjustments.
- Trading configuration.
- Trading activity and performance reports.
- Application settings.
- Activity logs and security records.
- Authorized integration configuration.

CEO access does not mean bypassing transaction integrity, payment verification, authentication safeguards, or required audit logging.

3. STAFF MANAGEMENT PAGE

Create a dedicated staff-management section.

The CEO must be able to:

- Create staff accounts.
- View staff profiles.
- Assign permissions.
- Change permissions.
- Suspend staff accounts.
- Reactivate staff accounts.
- Revoke dashboard access.
- Restore access.
- Initiate authenticator replacement and re-enrollment.
- Deactivate staff accounts.
- Initiate staff account deletion where appropriate.
- Review each staff member's action history.

Every staff member must have an individual account. Never allow shared staff identities.

The CEO must be able to identify exactly which account performed a recorded action.

4. STAFF PERMISSIONS

Support permission-based staff access.

At minimum, provide the following permission groups:

A. Payment Operations

- View deposit requests.
- Review payment information.
- Check payment status through the authorized payment-provider integration.
- Submit proposed approval or rejection decisions to the CEO.
- Execute only actions authorized by the CEO.

B. Customer Service

- View permitted investor information.
- Review permitted transaction information.
- Respond to customer issues.
- Add support notes.
- Escalate issues to the CEO.

Customer-service staff must not receive financial adjustment or payment-processing permissions unless explicitly authorized by the CEO.

The CEO must be able to customize permissions. However, customized permissions must never override mandatory CEO approval rules or security restrictions.

5. INVESTOR ACCOUNT MANAGEMENT

Create an investor-management page with search, filters, account details, and action history.

The CEO must be able to:

- Search investors by name or account ID.
- View account status and date joined.
- View wallet balance and transaction history.
- View deposit and withdrawal records.
- View available trading history.
- Suspend and reactivate accounts.
- Edit permitted account information.
- Initiate account deletion or deactivation.
- Add money to the internal wallet.
- Deduct money from the internal wallet.

Use confirmation dialogs for sensitive actions.

Before a wallet adjustment, require the CEO to enter the amount and a reason.

Display the existing balance and the resulting balance before final confirmation.

6. ADD MONEY AND DEDUCT MONEY

Implement a secure wallet-adjustment workflow.

For each adjustment:

- Identify the affected investor.
- Record the amount.
- Record the previous balance.
- Record the resulting balance.
- Record the CEO account performing the adjustment.
- Record the reason.
- Generate a unique transaction reference.
- Create an immutable ledger entry.
- Record the adjustment in the audit log.

Prevent duplicate adjustments and concurrent balance corruption.

Never change a balance directly without a corresponding ledger entry.

Reject invalid amounts and adjustments that violate configured wallet rules.

Do not silently rewrite previous transactions to correct an error. Corrections must be represented by additional ledger entries.

7. ACCOUNT SUSPENSION AND DELETION

Suspended accounts must be prevented from performing restricted activities.

Deleting or deactivating an account must not erase financial records, required transaction histories, or audit evidence.

Use a safe deletion workflow:

- Confirm the target account.
- Check outstanding financial obligations and transactions.
- Preserve required historical records.
- Record the CEO's action and reason.
- Apply the appropriate deletion, deactivation, or anonymization process.

Do not allow a normal account-management action to remove the last valid route to administrative access.

8. STAFF ACTION HISTORY

The CEO must be able to open a staff member's profile and view:

- Actions performed.
- Transactions reviewed.
- Approval requests submitted.
- CEO decisions received.
- Payments processed.
- Account changes.
- Permission changes.
- Login and security events.
- Access revocation and restoration events.

Each record must link to the relevant account, transaction, or approval request whenever applicable.

9. PART 2 ACCEPTANCE CRITERIA

Part 2 is complete only when:

- Both CEOs can access the full dashboard.
- The CEO can manage investor and staff accounts.
- Staff permissions are enforced.
- Wallet adjustments are ledger-based and auditable.
- Account suspension and revocation take effect securely.
- Financial and audit history is preserved.
- Dashboard information reflects actual application data.

Continue with Part 3.

PROJECT: G-SQUAD ADMIN DASHBOARD — PART 3 OF 4

Continue the existing G-Squad project. Preserve the requirements from Parts 1 and 2.

Use the approved stack only: Node.js, React, Bootstrap, and Neon DB. Do not use Express, NestJS, Next.js, or a separate API service.

This part defines payment operations and the mandatory CEO authorization workflow.

1. DEPOSIT MANAGEMENT

Create a deposit-management page that allows authorized staff and CEOs to review investor deposit requests.

Display:

- G-Squad transaction ID.
- Investor name and account ID.
- Requested deposit amount in USD.
- Selected cryptocurrency.
- Payment-provider reference.
- Invoice or payment address, when available.
- Payment verification status.
- Request creation time.
- Invoice expiration time, when provided.
- Assigned staff member, if applicable.
- Current processing status.

The intended deposit currencies are BTC, USDT, and TRX, subject to the configured provider's actual supported currencies and eligibility.

2. PLISIO INTEGRATION

Integrate Plisio for deposit processing, subject to provider eligibility and approval.

Requirements:

- Create actual payment invoices through the authorized integration.
- Store genuine provider references.
- Verify payments through trusted server-side provider responses.
- Validate payment status, amount, currency, and reference.
- Verify webhook authenticity using the provider's supported security mechanism.
- Handle duplicate, delayed, failed, expired, underpaid, and uncertain payments.
- Never trust a browser message or a user clicking "I've Made Payments" as proof of payment.
- Never invent payment addresses, transaction IDs, or successful confirmations.

The staff interface must provide a CHECK action that requests the current payment status from Plisio and displays the genuine result and reference when available.

A confirmed provider payment does not automatically authorize a wallet credit.

3. MANDATORY CEO APPROVAL WORKFLOW

This workflow is compulsory for staff deposit and withdrawal decisions.

STEP 1 — Request arrives:
A deposit or withdrawal request appears in the relevant dashboard.

STEP 2 — Staff reviews:
Authorized staff reviews the request and checks the relevant payment information.

STEP 3 — Staff submits a proposal:
Staff chooses a proposed action:

- Request authorization to approve.
- Request authorization to reject.

Staff must provide a reason when required and submit the request to the CEO.

STEP 4 — CEO reviews:
The CEO receives an approval request showing:

- Investor and transaction details.
- Staff member's identity.
- Proposed action.
- Supporting payment information.
- Payment verification status.
- Staff notes and reason.

STEP 5 — CEO decides:
The CEO can:

- Approve the proposed action.
- Reject the proposed action.
- Request additional information.

STEP 6 — Decision returns to staff:
The system records the CEO's decision and notifies the relevant staff member.

STEP 7 — Staff performs the authorized action:
If the CEO approves the proposed action, staff can execute that action.

If the CEO rejects the proposed action, staff cannot execute it.

If the CEO requests more information, staff must respond and resubmit the request for a new decision.

STEP 8 — Final result is recorded:
The system records the action taken, the resulting status, and all relevant identities and timestamps.

4. APPROVAL REQUEST PROTECTION

Every approval request must contain:

- A unique request ID.
- The related transaction ID.
- The requesting staff member's identity.
- The exact proposed action.
- The relevant amount and transaction details.
- The CEO decision.
- The CEO's identity.
- The decision timestamp.
- The final staff action and timestamp.

A CEO decision applies only to the specific request and proposed action that was reviewed.

If staff changes the amount, destination, transaction, or material request details after authorization, the previous approval must no longer authorize the changed action. A new CEO decision is required.

Only authorized, authenticated CEOs may make CEO decisions.

5. DEPOSIT PROCESSING RULES

The staff deposit interface should provide:

- CHECK
- REQUEST APPROVAL
- APPROVE, available only after the CEO authorizes that exact proposed action
- REJECT, available only after the CEO authorizes that exact proposed action

The CEO must be able to review and approve or reject proposed actions.

Before crediting an investor's internal wallet:

- Verify the genuine payment through Plisio.
- Confirm the required payment conditions.
- Confirm that the exact deposit approval is valid.
- Ensure the payment has not already been credited.
- Record the wallet ledger entry and transaction status atomically.

If the payment is unverified, failed, invalid, or otherwise ineligible, do not credit the wallet.

Keep expired, rejected, and failed deposits in transaction history. Do not permanently delete them simply because they are no longer active.

6. WITHDRAWAL MANAGEMENT

Withdrawal requirements:

- Cryptocurrency: USDT only.
- Network: TRC20 on the TRON network only.
- Minimum withdrawal: $1.00.
- The request must not exceed the investor's available balance.
- Validate the destination address and clearly identify the required network.
- Reject requests with insufficient available funds.
- Reserve the requested amount so it cannot be spent or withdrawn twice.

The staff dashboard must provide:

- CHECK, where supported by the actual payment mechanism.
- REQUEST APPROVAL.
- APPROVE, after CEO authorization.
- REJECT, after CEO authorization.

The CEO must be able to review and authorize or reject proposed withdrawal actions.

After the CEO authorizes a withdrawal, staff can perform the authorized action.

Do not mark a withdrawal as paid merely because the CEO authorized it. Record it as paid only after the payment mechanism confirms the actual successful transfer.

7. WITHDRAWAL ACCOUNTING

Use clear withdrawal states such as:

- Pending Review.
- Awaiting CEO Decision.
- CEO Approved.
- CEO Rejected.
- Processing.
- Paid.
- Failed.
- Cancelled, where permitted.

Reserve funds using an atomic database transaction.

When a withdrawal is rejected, release its reservation exactly once.

When a withdrawal is paid, reconcile the reservation and ledger without double-debiting the investor.

Prevent duplicate submissions and repeated processing with idempotency controls and unique transaction references.

8. NOTIFICATIONS

Send notifications when:

- A deposit or withdrawal request arrives.
- Staff submits a decision request.
- The CEO approves, rejects, or requests information.
- Staff completes the authorized action.
- A transaction fails or requires investigation.

Notifications must display accurate statuses and link to the relevant transaction.

Use the application's agreed light theme and top-of-screen notification design.

9. PART 3 ACCEPTANCE CRITERIA

Part 3 is complete only when:

- The CEO approval workflow is enforced server-side.
- Staff cannot execute an action before authorization.
- Staff cannot execute an action rejected by the CEO.
- Plisio payment status is genuinely verified.
- Wallet credits and debits cannot be duplicated.
- Withdrawals cannot spend reserved funds twice.
- All payment actions are auditable.
- Transaction states accurately reflect what actually happened.

Continue with Part 4.

PROJECT: G-SQUAD ADMIN DASHBOARD — PART 4 OF 4

Complete the G-Squad admin dashboard using all requirements from Parts 1, 2, and 3.

Do not change the approved stack: Node.js, React, Bootstrap, and Neon DB.

Do not use Express, NestJS, Next.js, or a separate API service.

1. MANDATORY ACTIVITY AUDIT LOG

Every important application action must be attributable to the authenticated account that performed it.

Record actions by:

- CEO.
- Staff.
- Investor.
- Automated application processes, using a distinct system identity.

For each applicable action, record:

- Actor account ID.
- Actor name or display label.
- Actor role.
- Action type.
- Affected account.
- Related transaction or approval request.
- Timestamp.
- Previous value and new value, when relevant.
- Reason or notes, where applicable.
- Success or failure result.
- Relevant request or event reference.

Examples of actions that must be logged:

- Login and logout events.
- Failed login and denied access attempts.
- Authenticator enrollment and replacement.
- Staff account creation.
- Staff permission changes.
- Account suspension and reactivation.
- Access revocation and restoration.
- Investor account edits.
- Wallet credits and debits.
- Deposit checks and decisions.
- Withdrawal decisions and processing.
- CEO approval requests and responses.
- Trading configuration changes.
- Changes to important application settings.
- Audit-log access and exports.
- Failed or blocked privileged operations.

Use authenticated server-side identity. Never trust an actor ID supplied by the browser as proof of who performed an action.

2. AUDIT LOG DASHBOARD

Create a dedicated Activity Logs page for the CEO.

Features:

- Search by actor name or account ID.
- Filter by role.
- Filter by action type.
- Filter by date and time.
- Search by investor account.
- Search by transaction ID.
- Search by approval request ID.
- View action details.
- Export permitted audit reports.

The CEO must be able to investigate what happened, who performed the action, and when it occurred.

3. AUDIT LOG INTEGRITY

Audit records must be protected from unauthorized changes.

Requirements:

- Staff cannot modify or delete audit entries.
- Do not provide a normal dashboard button that silently erases audit history.
- Historical corrections must create additional auditable entries.
- Protect logs from unauthorized database operations.
- Record sensitive access to logs.
- Apply appropriate backups, retention rules, and access restrictions.
- Preserve required financial records even after an account is deactivated or deleted.

Do not claim that logs are tamper-proof unless the implemented storage and access controls actually provide that guarantee.

4. TRADING MANAGEMENT

Provide the CEO with a trading-management section.

The CEO must be able to view and manage authorized trading configuration, including:

- Trading engine status.
- Authorized Deriv account configuration.
- Available strategy settings.
- Permitted market and contract settings.
- Trade execution history.
- Winning and losing trade records.
- Trading profit/loss reports.
- Recovery or multiplier settings, if enabled.
- Trading errors and service status.

Ordinary investors must not be able to change CEO-controlled trading settings.

Staff must not receive trading-management permissions unless explicitly assigned by the CEO.

Do not fabricate live trade results or display simulated activity as real trading.

If the trading engine or Deriv integration is not connected, clearly show that the integration is unavailable or pending.

IMPORTANT: The proposed centralized, admin-owned Deriv trading model must not be activated for real-money trading until the relevant account permissions, provider requirements, and applicable legal or regulatory authorizations have been confirmed.

5. APPLICATION SETTINGS

Provide a CEO-only settings area for authorized application-wide configuration.

Include appropriate controls for:

- Staff permissions.
- Security settings.
- Payment integration configuration.
- Notification settings.
- Trading integration status.
- Application operational settings.

Protect sensitive credentials and integration secrets. Never expose secrets to React, the browser, client-side logs, or ordinary staff accounts.

Changes to important settings must be audited.

6. DATABASE AND TRANSACTION INTEGRITY

Use Neon DB (PostgreSQL) to persist application records.

Design appropriate relationships and constraints for:

- CEO and staff identities.
- Investor accounts.
- Roles and permissions.
- Authenticator registrations.
- Enrollment codes.
- Sessions and revocation.
- Wallets and ledger entries.
- Deposits and withdrawals.
- CEO approval requests.
- Payment-provider references.
- Trading records.
- Audit logs.
- Notifications.

Use database transactions for operations that must succeed or fail together.

Implement:

- Unique constraints for critical identifiers.
- Appropriate foreign keys.
- Safe monetary precision.
- Idempotency for financial operations.
- Concurrency protection.
- Server-side input validation.
- Secure database access.
- Safe error handling.
- Database migrations and backups.

Never allow frontend code to directly modify privileged database records.

7. GENERAL SECURITY

Implement appropriate protections, including:

- Server-side role and permission checks.
- Secure session handling.
- Login rate limiting.
- CSRF protection where applicable.
- Protection against SQL injection.
- Input validation.
- Secure authenticator secret storage.
- Session invalidation after access revocation.
- Protection against repeated financial submissions.
- Sensitive-action confirmation.
- Safe handling of integration credentials.
- Consistent audit logging.

Do not hard-code secrets into source code or commit them to a public repository.

8. REQUIRED TESTING

Test the following scenarios before declaring the application complete.

CEO ACCOUNT TESTS:

- Exactly two authorized CEO identities can exist.
- A third CEO cannot be created.
- Both authorized CEOs can access the full dashboard.
- CEO actions are recorded.

AUTHENTICATION TESTS:

- CEO and staff routine login uses Google Authenticator only.
- Invalid or expired codes are rejected.
- Enrollment codes cannot be reused.
- Revoked staff cannot log in.
- Revoked sessions cannot continue privileged operations.
- Authenticator recovery and replacement follow the authorized process.

PERMISSION TESTS:

- Staff cannot access unauthorized pages or actions.
- Staff cannot grant themselves CEO permissions.
- Staff cannot bypass mandatory CEO approval.
- Customer-service permissions do not automatically grant financial permissions.

PAYMENT TESTS:

- Staff cannot execute a proposed action before CEO authorization.
- A CEO rejection prevents execution of the proposed action.
- A changed proposal requires a new decision.
- An unverified deposit cannot credit the wallet.
- A duplicate deposit cannot be credited twice.
- A withdrawal cannot spend reserved funds twice.
- A rejected withdrawal releases its reservation exactly once.
- A withdrawal is not marked paid without genuine payment confirmation.

AUDIT TESTS:

- Every important action identifies the correct actor.
- Wallet changes are recorded in the ledger and audit log.
- Staff cannot edit historical audit records.
- Account deactivation does not erase required financial history.

9. FINAL DELIVERY REQUIREMENTS

Build the admin dashboard as a functional application, not merely a collection of static screens.

Provide:

- Responsive React pages styled with Bootstrap.
- Secure Node.js server-side processing.
- Neon DB schema and migrations.
- Working authentication and authorization.
- Functional CEO and staff dashboards.
- Staff creation and permission management.
- Google Authenticator enrollment and login.
- CEO approval workflows.
- Deposit and withdrawal management.
- Investor account controls.
- Wallet adjustment workflows.
- Activity Logs.
- Trading-management screens.
- Clear integration status and error messages.
- Setup and deployment instructions.

Do not fake integrations or claim an operation works if it has not been implemented and tested.

Before modifying an existing project, inspect its current structure and preserve working features that comply with these requirements. Do not replace existing project files unnecessarily.

If a requirement cannot be implemented safely with the approved technology stack, explain the specific limitation and request authorization before introducing another framework or service.

FINAL ACCEPTANCE CONDITION:

The application must enforce the CEO's full authority, the staff permission model, Google Authenticator-only routine admin login, mandatory CEO authorization for staff payment decisions, secure financial processing, and comprehensive accountability through audit logs.
