G-SQUAD — USER APPLICATION

COPY 1 OF 3: PROJECT FOUNDATION, AUTHENTICATION, LAYOUT AND HOME PAGE

You are my full-stack developer. We are building G-Squad, a multi-user automated trading application.

Implement the user-facing application according to the requirements below. This is the first of three parts of the user-side specification.

Do not build the admin dashboard yet. The admin requirements will be provided separately later.

1. TECHNOLOGY STACK

Use:

- Next.js
- React
- Bootstrap
- PostgreSQL
- Prisma ORM

Do not use NestJS.

Inspect the existing repository before modifying files. Preserve working code and avoid unnecessary rewrites.

Use a modular, maintainable architecture with secure backend APIs, reusable components, database migrations, and responsive layouts.

2. VISUAL DESIGN

Application name: G-Squad.

Design requirements:

- Light background throughout the application.
- Deep or muted yellow as the primary accent color.
- White or light-colored cards.
- Dark, readable text.
- Rounded cards and buttons.
- Subtle borders and shadows.
- Clean spacing and typography.
- Responsive mobile-first layout.

Do not use a dark theme.

The application should look like a professional trading dashboard and work well on Android phones and desktop browsers.

3. REGISTRATION

Create a registration page with these fields:

1. Username.
2. Email.
3. Password.
4. Register button.

Requirements:

- All required fields must be validated on the server.
- Email addresses must be unique.
- Validate username format.
- Enforce a reasonable password policy.
- Hash passwords securely.
- Never store plaintext passwords.
- Prevent duplicate submissions.
- Show clear validation messages.

After successful registration, automatically generate a unique G-Squad account ID.

Example:

GSQ-57383893

Generate account IDs in the GSQ-XXXXXXXX format, where X represents a digit. Ensure uniqueness through database constraints and collision handling. Do not hard-code the example ID.

Each new user must receive an internal USD wallet with an initial balance of $0.00.

Do not create fake deposits, profits, or trading history during registration.

4. LOGIN

Create a login page containing:

- Email.
- Password.
- Login button.

Requirements:

- Authenticate credentials securely.
- Use secure session management.
- Protect authenticated pages and API endpoints.
- Prevent users from accessing another user's information.
- Display appropriate login errors without revealing whether an email is registered.
- Implement secure logout.

5. MAIN APPLICATION LAYOUT

The authenticated application must have a consistent header and bottom navigation.

Header

Left side:

- G-Squad logo.
- G-Squad name.

Right side:

- Small user profile icon.

The profile icon should provide access to the user's Settings page.

Bottom navigation

Include exactly four primary navigation buttons:

1. Home.
2. Deposit.
3. Withdraw.
4. Settings.

Show the selected navigation item clearly.

The navigation must be responsive and work across the authenticated application.

Transaction History must also be accessible, but it does not need to be a fifth primary bottom-navigation button.

6. HOME PAGE — ACCOUNT STATISTICS

The Home page must contain three main cards.

The first card displays:

- Balance.
- P/L.
- W.
- L.
- Rate.

Definitions:

Balance: The user's available internal USD wallet balance.

P/L: The user's recorded cumulative trading profit or loss.

W: The number of completed winning trades attributed to the user.

L: The number of completed losing trades attributed to the user.

Rate: The user's win rate.

Calculate win rate as:

Win Rate = Winning Trades / (Winning Trades + Losing Trades) × 100

If the user has no completed trades, display 0%.

Requirements:

- Retrieve values from authenticated backend endpoints.
- Format financial values consistently in USD.
- Never fabricate balances or trading statistics.
- Do not count pending trades as completed results.
- Update statistics when confirmed trading results become available.

7. HOME PAGE — START AND STOP BUTTONS

The second card must contain two buttons:

START

STOP

START activates the user's participation in automated trading.

STOP deactivates the user's participation in future trades.

Requirements:

- Submit authenticated backend requests.
- Display the current bot status.
- Prevent duplicate start or stop requests.
- Validate user eligibility and available funds on the backend.
- Show top-positioned popup notifications when the operation succeeds or fails.

G-Squad uses a centralized trading model. The actual Deriv account belongs to the administrator. Eligible users' stakes are combined into ONE trade through the central trading engine.

Do not create a separate Deriv trading account for each user.

Do not place a separate Deriv order for each user.

Users must not be allowed to change:

- Trading symbols.
- Trading strategy.
- Timeframe.
- Contract duration.
- Multiplier or recovery rules.
- The administrator's Deriv account configuration.

START and STOP control only the user's participation.

If a combined trade is already open, stopping must prevent future participation once the stop request takes effect. Do not claim an existing trade was cancelled unless it actually was.

If the central trading engine is not yet connected, show an honest unavailable or integration-pending state. Never simulate live trading.

8. HOME PAGE — TRADING CONSOLE

The third card must be a Trading Console with a height of exactly 150px.

It should display relevant trading-system events, such as:

- Bot started.
- Bot stopped.
- Waiting for a trading opportunity.
- Trading opportunity detected.
- Combined trade submitted.
- Trade result received.
- Trading service unavailable.
- Error or connection status.

Display only events supported by actual backend records.

Do not invent trade signals or report a successful trade without confirmation.

9. INTERNAL WALLET FOUNDATION

Every registered user has an internal USD wallet.

The wallet is separate from the administrator's Deriv account.

Use PostgreSQL and Prisma to create an appropriate wallet and financial ledger structure.

Requirements:

- Use fixed-precision monetary storage.
- Perform authoritative monetary calculations on the backend.
- Prevent unauthorized balance changes.
- Prevent duplicate financial transactions.
- Handle concurrent requests safely.
- Use database transactions for related financial operations.
- Keep auditable records of balance changes.
- Support available and reserved balances.
- Never trust a balance submitted by the frontend.

The wallet must support deposits, trading outcomes, and withdrawals through the workflows described in COPY 2.

10. SECURITY

Implement:

- Secure password hashing.
- Secure authentication and session handling.
- Server-side input validation.
- Authorization checks.
- Rate limiting for sensitive endpoints.
- Protection against unauthorized account access.
- Protection against duplicate financial processing.
- Secure handling of environment variables and secrets.

Never expose Plisio credentials, Deriv tokens, passwords, or private API keys to frontend JavaScript.

11. COMPLETION REQUIREMENTS

Implement the project foundation, authentication, application layout, Home page, trading controls, Trading Console, and wallet foundation.

Do not build the admin dashboard.

Do not claim real trading is operational until the authorized trading engine and Deriv integration are actually configured and tested.

After implementation, report what was completed and what remains to be integrated.

G-SQUAD — USER APPLICATION

COPY 2 OF 3: DEPOSITS, WITHDRAWALS AND TRANSACTION HISTORY

This is the second part of the G-Squad user-side specification.

Continue from COPY 1. Inspect the existing implementation before making changes. Reuse the existing project structure, authentication, database, and wallet models.

Do not build the admin dashboard yet.

1. DEPOSIT PAGE

Create a Deposit page for funding the user's internal G-Squad USD wallet.

The page must display a small warning note and a deposit form.

Required fields:

1. Deposit amount in USD.
2. Cryptocurrency selector.
3. Process button.

Supported deposit cryptocurrencies:

- BTC — Bitcoin.
- USDT — Tether.
- TRX — TRON.

Validate deposit amounts on the backend. Reject invalid or non-positive amounts.

2. PLISIO INTEGRATION

Use Plisio to generate cryptocurrency deposit instructions.

When a user clicks Process:

1. Authenticate the user.
2. Validate the requested amount and cryptocurrency.
3. Create a unique deposit request.
4. Request a payment invoice from Plisio through the backend.
5. Save the provider reference, amount, selected currency, payment status, and expiration information returned by Plisio.
6. Display the payment instructions returned by the provider.

Never expose Plisio API credentials in frontend code.

Never generate fake deposit addresses.

If Plisio does not successfully create an invoice, display an error and do not pretend the deposit is ready.

3. DEPOSIT INSTRUCTIONS PAGE

After a valid Plisio invoice is created, display:

- Deposit amount in USD.
- Selected cryptocurrency.
- Deposit address returned by Plisio.
- Payment instructions.
- Current payment status.
- Expiration time, if supplied by Plisio.
- An "I've Made Payments" button.

The user must be able to leave the page and return to the deposit later through Transaction History.

Preserve the original deposit reference so that reopening the transaction does not create another invoice unnecessarily.

4. I'VE MADE PAYMENTS BUTTON

When the user clicks "I've Made Payments":

- Send an authenticated request to the backend.
- Record that the user reports sending the payment.
- Update the status to indicate that verification or admin review is pending.
- Make the request available to the admin-side workflow that will be implemented later.

This button is not proof of payment.

Clicking it must never credit the user's internal wallet.

The balance must only be credited after the payment has been verified and the authorized admin approval process has completed.

Prevent repeated clicks from creating duplicate deposit requests.

5. DEPOSIT VERIFICATION AND APPROVAL

The intended workflow is:

1. User creates a deposit.
2. Plisio provides the deposit instructions.
3. User sends the cryptocurrency.
4. User clicks "I've Made Payments".
5. G-Squad verifies payment information through Plisio.
6. The deposit becomes available for admin review.
7. The admin must approve it before the user's internal wallet is credited.

The admin dashboard will be specified separately.

The user application must distinguish:

- Payment submitted by user.
- Payment confirmed by Plisio.
- Deposit awaiting admin approval.
- Deposit approved and credited.

A provider-confirmed payment must not be displayed as credited before the wallet update actually occurs.

A deposit that is unverified, failed, underpaid, or otherwise invalid must not be credited.

The backend must prevent duplicate wallet credits if a callback, webhook, or approval request is processed more than once.

6. DEPOSIT EXPIRATION

Use the expiration time returned by Plisio or the applicable configured provider rules.

If a deposit expires without confirmed payment:

- Mark it as expired.
- Remove it from the active pending-deposit list.
- Keep its transaction record.
- Allow the user to see its expired status in Transaction History.
- Do not credit the wallet.

Do not delete expired transactions permanently.

Do not expire a deposit merely because the user leaves the page or closes the application.

If a payment arrives late or its status is uncertain, reconcile it with Plisio before deciding whether it can be credited.

7. WITHDRAW PAGE

All withdrawals must use:

Currency: USDT.

Network: TRC20 (TRON).

Do not offer other withdrawal currencies or networks.

The Withdraw page must display:

- A warning note.
- Available internal wallet balance.
- Withdrawal amount in USD.
- USDT TRC20 destination address field.
- Request Withdrawal button.

The user must enter the wallet address where they want to receive their funds.

Clearly state that the address must support USDT on the TRON TRC20 network.

8. WITHDRAWAL VALIDATION

The backend must enforce the following rules.

Rule A: Zero balance

If the user has no available balance, reject the withdrawal and notify the user.

Rule B: Minimum amount

The minimum withdrawal amount is $1.00.

Reject withdrawal amounts below $1.00.

Rule C: Insufficient balance

Reject requests that exceed the user's available balance.

Rule D: Invalid amount

Reject zero, negative, malformed, or otherwise invalid monetary values.

Rule E: Missing address

Reject requests without a destination address.

Rule F: Address compatibility

Validate the address format as far as technically possible and clearly display the required TRON TRC20 network.

Address-format validation does not guarantee that the address belongs to the intended recipient or can receive the intended asset.

Require the user to confirm the destination details before submitting.

Rule G: Valid request

If all checks pass, create a withdrawal request for admin review.

9. WITHDRAWAL RESERVATION AND ACCOUNTING

When a valid withdrawal request is submitted:

- Reserve the requested amount or deduct it from the available balance through a controlled ledger transaction.
- Prevent those funds from being spent on trading.
- Prevent the same funds from being withdrawn twice.
- Record the withdrawal request.
- Display its pending status in Transaction History.

If the withdrawal is rejected or cancelled, release the reservation exactly once.

If the withdrawal succeeds, finalize the accounting without deducting the amount twice.

Do not allow the user to approve their own withdrawal.

Do not mark a withdrawal as paid merely because the admin approved it. Actual payment processing and confirmation must occur before the final Paid status is recorded.

10. WITHDRAWAL PROCESSING NOTICE

Display this notice on the Withdraw page:

"Withdrawal requests require admin review and approval. Once approved and processed, payments typically take 10–30 minutes to arrive. Actual processing times may vary depending on network conditions and payment-provider confirmation."

Do not guarantee that every payment will arrive within 30 minutes.

11. TRANSACTION HISTORY

Implement a Transaction History page or section accessible to authenticated users.

Users must be able to review deposits and withdrawals even after leaving the original payment page.

Each transaction should display:

- G-Squad transaction ID.
- Transaction type.
- Amount in USD.
- Cryptocurrency.
- Network, where applicable.
- Date and time.
- Current status.
- Provider reference, when available.
- Blockchain transaction ID, when available.
- View Details action.

Do not invent provider references or blockchain transaction IDs.

12. DEPOSIT STATUSES

Support appropriate statuses, including:

- Pending Payment.
- Awaiting Verification.
- Awaiting Admin Review.
- Payment Confirmed.
- Approved or Credited.
- Rejected.
- Expired.
- Failed.

Display clear labels to the user.

The application must distinguish payment confirmation from final wallet crediting.

13. WITHDRAWAL STATUSES

Support:

- Pending Review.
- Approved.
- Processing.
- Paid or Successful.
- Rejected.
- Failed.

Display only the status supported by the actual backend record.

14. TRANSACTION DETAILS

When a user opens a transaction, display appropriate details:

- Transaction ID.
- Type.
- Amount.
- Date and time.
- Status.
- Cryptocurrency.
- Network, where applicable.
- Payment or destination address, where appropriate.
- Provider reference.
- Blockchain transaction ID, if available.
- Relevant payment instructions.
- Expiration information, when applicable.

For a pending deposit, allow the user to reopen valid payment instructions.

Once a deposit expires, do not present the expired invoice as an active payment request.

Retain the expired record in Transaction History.

15. USER DATA ISOLATION

All transaction queries must be scoped to the authenticated user on the backend.

Never allow a user to access another user's transactions by changing a transaction ID, URL, or request parameter.

Use authorization checks on every transaction endpoint.

16. PAYMENT SECURITY

- Verify Plisio responses on the server.
- Validate payment references, amounts, and currencies.
- Handle callbacks and webhooks securely.
- Use idempotent processing.
- Prevent duplicate credits.
- Maintain auditable ledger entries.
- Use database transactions for financial updates.
- Never trust frontend payment status.
- Never trust the "I've Made Payments" button as payment evidence.

17. COMPLETION REQUIREMENTS

Implement the deposit page, Plisio integration boundary, payment instructions, deposit expiration handling, withdrawal page, USDT TRC20 validation, withdrawal reservations, Transaction History, and transaction details.

The user must be able to leave a deposit page and later review the deposit status.

Do not build the admin dashboard in this stage.

If an external payment integration cannot yet be completed, document what is missing and do not simulate successful real-money payments.

After implementation, report the endpoints, database changes, payment integration status, and tests performed.

G-SQUAD — USER APPLICATION

COPY 3 OF 3: SETTINGS, NOTIFICATIONS, SECURITY AND FINAL TESTING

This is the third and final part of the G-Squad user-side specification.

Continue from COPY 1 and COPY 2. Inspect the current repository and reuse the existing implementation.

Do not rebuild working features unnecessarily.

Do not build the admin dashboard yet.

1. SETTINGS PAGE

Create a Settings page displaying:

- User profile icon.
- Username.
- Account status.
- Membership or registration date.
- G-Squad account ID.
- Logout button at the bottom of the page.

Requirements:

- Load profile information from the authenticated backend.
- Use the actual saved account ID.
- Display the actual registration date.
- Display account status from the backend.
- Do not hard-code account information.
- Prevent users from accessing another user's profile.
- Securely terminate the user's session when Logout is clicked.
- Return the user to the login page after logout.

Do not expose passwords, session secrets, API keys, or other sensitive information.

2. ADVANCED TOP-POSITIONED POPUP NOTIFICATIONS

Implement a reusable notification system throughout the user application.

All popup notifications must appear at the TOP of the screen, never at the bottom.

Requirements:

- Modern professional design.
- Responsive positioning on mobile and desktop.
- Smooth entrance and exit animations.
- Appropriate icons.
- Clear titles and messages.
- Close button.
- Success, warning, error, and information variants.
- Suitable automatic dismissal for ordinary notifications.
- Accessible contrast and readable text.
- Avoid blocking essential controls.
- Handle multiple notifications without clutter.

Use a consistent design with the G-Squad light theme and muted yellow accent color.

Example notifications

Deposit success:

Title: Deposit Successful

Message: Your deposit has been credited to your G-Squad wallet.

Display this only after the backend confirms the wallet credit.

Deposit pending:

Title: Deposit Pending

Message: Your payment is awaiting verification and admin review.

Withdrawal rejected:

Title: Withdrawal Rejected

Message: Your withdrawal request was rejected. Check your transaction history for details.

Insufficient balance:

Title: Insufficient Balance

Message: Your available balance cannot cover this withdrawal.

Trading started:

Title: Bot Started

Message: Your account is now eligible to participate in automated trading.

Display this only after the backend confirms the user's trading participation status has changed.

Trading unavailable:

Title: Trading Unavailable

Message: The trading service is currently unavailable. Please try again later.

Never show a success notification for an operation that failed or remains unconfirmed.

Important transaction errors and outcomes must remain available through transaction details even after a popup disappears.

3. CONSISTENT APPLICATION DESIGN

Ensure all user-facing pages share the same design system.

Required:

- Light background.
- Deep or muted yellow accent.
- Consistent typography.
- Consistent card design.
- Consistent buttons and form fields.
- Responsive header.
- Four-button bottom navigation.
- Top-positioned notifications.
- Clear loading, error, success, and empty states.

Pages must work on Android mobile devices and desktop browsers.

Do not introduce a dark theme.

Do not create a fifth primary bottom-navigation button for Transaction History. Provide a separate accessible route through an appropriate existing page.

4. USER WALLET ACCOUNTING

Review the entire user application for financial consistency.

Requirements:

- Initial wallet balance is $0.00.
- Deposits are not credited until verified and approved through the authorized workflow.
- Withdrawals require available funds.
- The minimum withdrawal is $1.00.
- Withdrawal reservations prevent double spending.
- Rejected withdrawals release reservations exactly once.
- Completed withdrawals are not deducted twice.
- Trading results must come from the actual trading engine.
- No fake profit or loss may be recorded as real.
- Every balance-changing event must have an auditable ledger entry.

Use database transactions and appropriate locking or concurrency controls where necessary.

Do not allow users to modify balances through client requests.

5. TRADING INTEGRATION BOUNDARY

The application must be ready for integration with the centralized G-Squad trading engine.

The intended model is:

Multiple eligible users → Central trading engine → One combined trade on the administrator's Deriv account → Actual trade result → Allocation to participating users' internal wallets.

The administrator owns the Deriv account.

Regular users do not connect their own Deriv accounts.

The user application must not:

- Expose Deriv credentials.
- Let users configure the administrator's strategy.
- Create individual Deriv orders for each user.
- Claim a trade succeeded without execution confirmation.
- Claim a trade was cancelled unless cancellation was confirmed.

Do not enable real-money trading until the intended account/API arrangement has been verified as permitted by Deriv and applicable regulatory requirements.

6. PAYMENT INTEGRATION BOUNDARY

Deposits:

- Use Plisio.
- Support BTC, USDT, and TRX.
- Display real payment instructions returned by Plisio.
- Preserve transaction records.
- Require payment verification and admin approval before wallet crediting.

Withdrawals:

- USDT only.
- TRC20 (TRON) network only.
- Minimum $1.00.
- User must enter a destination address.
- Admin approval is required.
- Payment must be confirmed before marking a withdrawal as paid.

Do not invent gateway capabilities, payment addresses, transaction IDs, or successful payment states.

7. DATABASE AND API QUALITY

Review the PostgreSQL and Prisma implementation.

Requirements:

- Proper relational models.
- Unique account IDs and email addresses.
- Appropriate foreign keys.
- Fixed-precision financial storage.
- Database migrations.
- Server-side validation.
- Authentication and authorization.
- User-specific data isolation.
- Idempotent financial operations.
- Safe handling of concurrent requests.
- Auditable transaction records.
- Clear separation between user interface, backend services, payment integration, and trading integration.

Avoid duplicate wallet systems or conflicting financial records.

8. TESTING REQUIREMENTS

Test the following scenarios.

Authentication

- Register a new user.
- Reject duplicate email addresses.
- Generate a unique account ID.
- Log in with valid credentials.
- Reject invalid credentials.
- Protect authenticated routes.
- Log out successfully.

Home page

- Display the correct initial balance.
- Display correct trading statistics.
- Calculate win rate correctly.
- Handle zero completed trades.
- Start and stop user participation through the backend.
- Prevent duplicate start and stop operations.
- Display the Trading Console at 150px high.
- Avoid fabricated trading events.

Deposits

- Create a Plisio invoice.
- Display the correct address and instructions.
- Preserve the deposit after the user leaves the page.
- Submit the "I've Made Payments" action.
- Ensure this action does not credit the wallet.
- Display pending and confirmed states correctly.
- Handle expiration.
- Retain expired records in Transaction History.
- Prevent duplicate wallet credits.

Withdrawals

- Reject a zero-balance withdrawal.
- Reject amounts below $1.00.
- Reject requests exceeding available balance.
- Reject invalid destination addresses.
- Accept valid requests for admin review.
- Reserve funds correctly.
- Prevent double spending.
- Restore funds after rejection.
- Prevent duplicate processing.

Transaction History

- Display deposits and withdrawals.
- Display correct statuses.
- Preserve payment references.
- Display available blockchain transaction IDs.
- Prevent cross-user transaction access.
- Retain expired and rejected transaction records.

Notifications

- Confirm all popup notifications appear at the top.
- Verify they never appear at the bottom.
- Test success, warning, error, and information variants.
- Ensure failed operations never produce false success messages.
- Confirm mobile responsiveness.

Security

- Test unauthorized API requests.
- Test attempts to access another user's data.
- Test duplicate financial requests.
- Test concurrent withdrawal submissions.
- Test invalid monetary values.
- Confirm private API credentials are never exposed to the browser.

Do not claim a test passed unless it was actually executed.

9. FINAL ACCEPTANCE CRITERIA

The user application is ready for review when:

- Registration and login work securely.
- Account IDs are generated automatically.
- Every user has an internal USD wallet.
- The Home page displays Balance, P/L, W, L, and Rate.
- START and STOP controls exist.
- The Trading Console is 150px high.
- Deposits support BTC, USDT, and TRX through Plisio.
- Withdrawals use USDT TRC20 only.
- The minimum withdrawal is $1.00.
- Deposits and withdrawals appear in Transaction History.
- Users can return to pending deposits after leaving the payment page.
- Expired deposits disappear from active pending requests but remain in history.
- All notifications appear at the top of the screen.
- The Settings page displays the required profile information and Logout button.
- The interface uses a light theme with muted yellow accents.
- The backend protects authentication, wallet balances, and transaction records.
- No fake payments or trading results are shown as real.
- The application is ready for the separately specified admin dashboard and trading-engine integration.

10. FINAL DEVELOPER REPORT

After completing the user-side implementation, provide a concise report describing:

1. Features implemented.
2. Database models and migrations created.
3. API endpoints created.
4. Required environment variables.
5. Plisio integration status.
6. Trading-engine integration status.
7. Tests actually performed.
8. Known bugs or incomplete work.
9. Any external service configuration still required.

Do not build the admin dashboard yet. Its requirements will be supplied separately.

Do not change the defined user features without permission.

Implement the three user-side prompt parts as one consistent application, preserving all specified requirements.
