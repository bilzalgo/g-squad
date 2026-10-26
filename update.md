Improve and redesign the entire G-Squad Admin Dashboard UI across EVERY page. Make the application clean, professional, compact, consistent, and fully responsive on Android phones, tablets, and desktop screens.

1. Clean Page Layout and Action Buttons

- Do not display the Create Staff Account form directly below the Staff Accounts list.
- Display the staff list on its own page with a clearly visible "+ Add Staff" button.
- When clicked, open a separate page, modal, or slide-out panel containing the staff creation form.
- Apply this same design pattern throughout the entire application. Keep lists, tables, and dashboard content separate from creation and editing forms.
- Use pop-up modals, slide-out panels, or separate pages for actions such as creating, editing, approving, rejecting, and configuring records.
- Remove unnecessary buttons and duplicated actions. Use clean action menus, dropdowns, or three-dot menus where appropriate.
- Keep only the most important actions visible.

2. Left Sidebar Navigation

- Replace the current large collection of navigation buttons with a professional left-side sidebar.
- Organize all existing sections into logical navigation groups, including Overview, Investors, Staff, Deposits, Withdrawals, Approvals, Customer Support, Trading, Activity Logs, and Settings.
- Use small, consistent icons and compact labels.
- Highlight the currently active page.
- Keep the sidebar fixed on desktop, with an option to collapse it.
- On mobile, hide the sidebar by default and open it through a hamburger menu. Close it after navigation or when the user taps outside it.
- Do not remove any existing pages or navigation functionality.

3. App Header

- Create a consistent application header across every admin page.
- Include the G-Squad logo or application name, current page title, sidebar toggle, and appropriate account/profile and notification controls.
- Keep the header properly aligned and fixed at the top while scrolling.
- Ensure page content never overlaps the header or sidebar.
- Use the same header design throughout the application.

4. Design and Typography

- Keep the existing light-theme preference.
- Use a white or light background, subtle borders, clean cards, and deep yellow accents for primary buttons and highlights.
- Preserve the current compact font size because I like the small, professional appearance.
- Use consistent spacing, margins, padding, button sizes, form fields, and card styles.
- Avoid oversized headings, excessive whitespace, unnecessary cards, and crowded layouts.
- Make the interface look like a modern financial administration dashboard.

5. Fixed Layout and Responsive Tables

- Convert all history, transaction, activity, investor, staff, deposit, withdrawal, approval, and other appropriate list views into properly structured tables.
- Use consistent table headings, compact rows, clear status badges, and appropriately sized action controls.
- Keep the table header sticky within its own table container where appropriate.
- Keep the application header and sidebar independent of the table scrolling area.
- Give tables a properly calculated height based on the available screen space.
- On desktop, allow the table body to scroll vertically inside its designated container without moving the application header or table heading.
- On mobile, adapt tables to the available width. Use horizontal scrolling inside the table container only when necessary, or an appropriate compact mobile layout.
- Prevent tables from overflowing into the sidebar, header, or surrounding cards.
- Ensure dropdown menus and action buttons are not clipped by table containers.
- Use pagination for large datasets rather than loading unlimited rows onto one page.
- Apply these rules consistently to all applicable list and history pages.

6. Mobile Optimization and Zoom

- Make the entire application fit properly on mobile screens, including my Android phone.
- Prevent accidental horizontal page overflow and elements extending beyond the screen.
- Keep the small typography and compact layout consistent across devices.
- Make touch targets usable without making the entire interface oversized.
- Set up the correct responsive viewport configuration.
- If disabling pinch-to-zoom is implemented, understand that it can reduce accessibility; prioritize a responsive layout that does not require zooming rather than unnecessarily preventing users from enlarging text.

7. Forms and Modals

- Every creation or editing form should open separately from its corresponding list.
- Use clear labels, compact input fields, validation messages, and consistent Save, Cancel, Approve, or Reject actions where applicable.
- Ensure forms fit within the available viewport height.
- On mobile, use full-width forms and properly sized modals or slide-out panels.
- Never allow forms to push other dashboard sections into a crowded layout.

8. Preserve All Existing Functionality

- Do not change the existing database schema, authentication system, business rules, permissions, approval workflows, or backend functionality.
- Preserve the two CEO accounts, authenticator-based login, staff permissions, and CEO approval requirements for staff deposit and withdrawal decisions.
- Keep all existing functionality working while improving the interface.
- Do not remove features or create duplicate pages.
- Reuse existing components where possible and create shared layout, table, modal, sidebar, and header components to maintain consistency.
- Do not introduce unnecessary frameworks, backend services, APIs, or dependencies.

9. Final Implementation and Testing

- Inspect the entire existing project before making changes.
- Identify every page that needs layout improvements.
- Implement the redesign consistently across all pages, not just the Staff page.
- Test navigation, forms, modals, dropdowns, tables, scrolling, authentication, and permissions.
- Test the layout on small Android screens, tablets, and desktop screens.
- Fix all overlapping elements, broken layouts, horizontal page overflow, clipped menus, and inconsistent spacing.
- Ensure the application builds successfully and remains deployable on Heroku.

Final goal: Transform G-Squad into a clean, compact, professional admin dashboard with a fixed application header, left-side navigation, mobile-friendly sidebar, separate creation forms, fewer unnecessary buttons, and properly contained tables. Apply the improvements across the entire application while preserving every existing feature and business rule.
