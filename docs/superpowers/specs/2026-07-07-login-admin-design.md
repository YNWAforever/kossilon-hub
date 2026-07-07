# Login and Admin Prototype Design

## Context

Kossilon Hub is currently an internal company secretary operating system with dashboard, enquiries, clients, annual returns, documents, payments, WhatsApp, tasks, teams, and settings routes. The app has no authentication boundary today: the root shell always renders the sidebar and top bar, and `TopBar` reads a static `currentUser` from mock data.

The approved first phase is a prototype login and minimal admin console:

- Use a local in-app demo session, not production authentication.
- Protect the whole app: unauthenticated users go to `/login`.
- Add minimal admin functions covering both user/role management and key system settings.
- Keep the auth boundary replaceable so a future real auth provider can reuse the route and UI structure.

## Goals

- Add a usable `/login` page for internal demo and workflow validation.
- Persist a prototype session in the browser so refreshes keep the user signed in.
- Protect all app routes except `/login`.
- Add an `/admin` route for admin users.
- Show a role-aware app shell and top bar using the active session user.
- Provide minimal admin controls for demo users, roles, system settings, and configuration status.
- Make the session API narrow and testable.

## Non-Goals

- No production password hashing, secure cookies, MFA, email verification, or OAuth provider.
- No database user table or auth migrations in this phase.
- No server-function authorization enforcement beyond clearly documented prototype role checks.
- No broad redesign of the existing dashboard, settings, annual-return, or WhatsApp workflows.

## Recommended Approach

Use a local "Demo Session Guard" adapter. The adapter owns demo users, role metadata, login/logout helpers, browser persistence, and role checks. It exposes a small interface that can later be swapped for real auth.

This is the best fit for the current app because much of the product surface is still frontend-heavy and mock-data driven. It gives immediate internal usability without pretending prototype auth is production security.

## Routes and Navigation

### `/login`

The login route is public. It renders a focused operational login page with:

- Kossilon brand and "CoSec OS" positioning.
- Email and password fields for demo credentials.
- Quick demo identity buttons for Admin and Staff.
- Inline error state for invalid demo credentials.
- Redirect to the requested route after successful login, or `/` by default.

If an authenticated user opens `/login`, redirect them to `/`.

### Protected App Routes

All existing app routes are protected by the root component or a small guard component:

- If no active session exists, redirect to `/login`.
- Preserve the intended path where possible for post-login redirect.
- Render the normal app shell only after the session is known.

### `/admin`

The admin route is added to the sidebar and visible to authenticated users. Admin users get the full console. Non-admin users see a clear access-limited state, not a broken page.

The route has three compact sections:

- **Users:** demo staff list, role, team, active/inactive status, last login, and demo identity switching.
- **System Settings:** company profile summary, service packages summary, WhatsApp/API connection status, and annual-return actor configuration guidance.
- **Audit Preview:** read-only recent admin activity examples that establish the future audit-log shape.

## Session and Roles

Create a `src/features/auth` module with a small local adapter:

- `demoUsers`: fixed list of prototype identities.
- `getStoredSession()`: reads browser session from local storage.
- `loginWithCredentials(email, password)`: validates against demo users.
- `loginAsDemoUser(userId)`: signs in via a quick-select action.
- `logout()`: clears browser session.
- `isAdmin(user)`: checks whether the user has admin permissions.

Suggested demo roles:

- `Admin`: can access `/admin` and switch demo identities.
- `Manager`: can use the app but sees restricted admin access.
- `Staff`: can use the app but sees restricted admin access.

The stored session should include only non-sensitive prototype metadata:

- user id
- name
- email
- role
- initials
- team
- signed-in timestamp

No real secrets should be stored.

## App Shell Changes

The root app shell should become session-aware:

- If the active route is `/login`, render login without sidebar/top bar.
- For protected routes, require an active session before rendering `AppSidebar`, `TopBar`, and page content.
- Pass the active user through a light session hook or context.

`TopBar` should stop reading the static `currentUser` directly. It should display:

- active user initials
- active user name
- active user role
- sign-out action

`AppSidebar` should add an `Admin` nav item, preferably near Settings, using a standard icon.

## Admin UI Behavior

The first admin UI should be useful but intentionally narrow:

- User rows show status, role, team, and last login.
- Admin can click "Sign in as" for demo identity testing.
- Role/status controls may update local state only for this prototype.
- System settings cards summarize existing settings concepts rather than duplicating all of `Settings`.
- Annual-return actor configuration should explain whether the current browser/session identity is only a prototype and does not configure server-side `KOSSILON_ANNUAL_RETURN_ACTOR_ID`.

This keeps the admin route operational while avoiding a misleading production-security surface.

## Error Handling

- Invalid login credentials show inline form feedback.
- Expired or missing local session redirects to `/login`.
- Corrupt local session data is cleared and treated as signed out.
- Non-admin access to `/admin` shows a restricted state with a link back to Dashboard.
- Auth storage should tolerate `localStorage` unavailability by treating the user as signed out.

## Testing

Add focused unit tests for:

- demo login succeeds with valid credentials.
- login fails with invalid credentials.
- demo sign-in stores expected user metadata.
- logout clears the session.
- corrupt stored session is ignored.
- admin role checks distinguish Admin from Manager/Staff.

Add route or component tests where practical for:

- app shell redirects unauthenticated users to `/login`.
- login page routes authenticated users back to the dashboard.
- admin page shows full console for Admin and restricted state for Staff.

Manual verification should include:

- `/` redirects to `/login` when signed out.
- demo Admin can sign in and open `/admin`.
- demo Staff can sign in and sees restricted `/admin`.
- sign out returns to `/login`.
- refresh preserves the prototype session.

## Future Production Auth Path

This phase intentionally keeps auth local and replaceable. A later production phase can replace the local adapter with real auth while preserving:

- `/login` route structure
- app shell guard
- active user context
- role checks
- admin route layout

At that point, server functions that mutate company, annual-return, WhatsApp, or admin state should enforce real authorization server-side.
