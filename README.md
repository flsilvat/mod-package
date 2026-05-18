# Mod Package — Technical Order Builder

An internal tool for capturing an aircraft modification package — its Service
Bulletin, drawings, materials and tasks — seeing how it all connects, and
producing the data needed to set up the order in SAP.

**Stack:** React + Vite (frontend) · Firebase Firestore + Auth (database and
sign-in) · GitHub Pages (hosting). The data model is documented in
[`SCHEMA.md`](./SCHEMA.md).

This version has the **foundation, the Aircraft entity, and sign-in** with two
roles — *admin* (can change data) and *viewer* (read-only).

---

## Prerequisites

- **Node.js 20+** — check with `node -v`.
- A **Google account** (for Firebase).
- A **GitHub account** (for hosting).

---

## Step 1 — Create the Firebase project

1. Go to <https://console.firebase.google.com> and **Add project**. Give it a
   name (e.g. `mod-package`). Google Analytics can be turned off.
2. Open **Build > Firestore Database > Create database**. Choose a location,
   and start in test mode (the real rules go in at Step 2).
3. On the project home, click the **`</>` (Web)** icon to register a web app.
   Give it a nickname; you do **not** need Firebase Hosting.
4. Firebase shows a `firebaseConfig` object — keep that tab open, you need
   those six values shortly.

## Step 2 — Set up sign-in

1. Open **Build > Authentication > Get started**, and enable the
   **Email/Password** provider.
2. Go to the **Users** tab, **Add user**, and create your own account
   (your email + a password). This is your admin login.
3. Back in **Firestore Database**, create a collection called `userRoles`.
   Add one document:
   - **Document ID** = your email, lowercase (e.g. `jane.smith@example.com`)
   - **Field** `role` (string) = `admin`
4. Open the Firestore **Rules** tab, paste in the contents of
   [`firestore.rules`](./firestore.rules), and **Publish**.

> To add other people later: create their account under Authentication, then
> add a `userRoles` document with their email as the ID and `role` set to
> `admin` or `viewer`.

## Step 3 — Run it locally

```bash
# from the project folder
cp .env.example .env
```

Open `.env` and paste in the six values from your `firebaseConfig`:

| firebaseConfig field | .env variable                       |
| -------------------- | ----------------------------------- |
| `apiKey`             | `VITE_FIREBASE_API_KEY`             |
| `authDomain`         | `VITE_FIREBASE_AUTH_DOMAIN`         |
| `projectId`          | `VITE_FIREBASE_PROJECT_ID`          |
| `storageBucket`      | `VITE_FIREBASE_STORAGE_BUCKET`      |
| `messagingSenderId`  | `VITE_FIREBASE_MESSAGING_SENDER_ID` |
| `appId`              | `VITE_FIREBASE_APP_ID`              |

Then:

```bash
npm install
npm run dev
```

Open the URL it prints, sign in with the admin account from Step 2, and add an
aircraft.

## Step 4 — Deploy to GitHub Pages

1. Push this project to a GitHub repository's `main` branch.
2. In the repo: **Settings > Secrets and variables > Actions > New repository
   secret**. Add the same six variables from Step 3.
3. In **Settings > Pages**, set **Source** to **GitHub Actions**.
4. In the Firebase console, open **Authentication > Settings > Authorized
   domains** and add your GitHub Pages domain (e.g. `yourname.github.io`) —
   sign-in is blocked on any domain not listed here.
5. Push any commit to `main`. The workflow builds and publishes the app; the
   live URL appears under the Actions run and in Settings > Pages.

---

## Making changes

Work in small, self-contained commits. The version number lives in
`package.json` and follows semantic versioning — bump it in the **same commit**
as the change:

- **patch** (0.2.0 → 0.2.1) — a fix or a small tweak
- **minor** (0.2.0 → 0.3.0) — a new feature or entity
- **major** (0.x → 1.0.0) — a large milestone or a breaking change

Write the commit message as a short imperative summary (`Add…`, `Fix…`,
`Update…`), with bullet points underneath if there's detail worth keeping:

```bash
git add -A
git commit -m "Add materials entity with kit nesting

- Materials page: create, list and delete
- Kit components stored as nested material references
- Recursive bill-of-materials view"
git push
```

Every push to `main` triggers the deploy workflow automatically.

---

## Project structure

```
src/
  main.jsx                 app entry (AuthProvider + HashRouter)
  App.jsx                  routes + sign-in / access gate
  firebase.js              Firebase init — exports db and auth
  index.css                theme and styles
  lib/collections.js       Firestore collection names
  lib/auth.jsx             auth context — current user and role
  lib/materials.js         kit recursion + cycle-guard helpers
  lib/drawings.js          drawing-reference recursion helpers
  lib/batch.js             bulk-input parsing helpers
  components/Layout.jsx    app shell — header, nav, user chip
  components/NoAccess.jsx  shown to signed-in users with no role
  components/BatchInput.jsx  reusable bulk-add panel
  components/FilterBar.jsx   reusable table quick-filter
  components/MultiSelect.jsx  searchable checkbox link picker
  components/SBDetail.jsx    expanded Service Bulletin view
  components/GTLDetail.jsx   expanded GTL view — operations & aircraft
  pages/HomePage.jsx       overview
  pages/LoginPage.jsx      email / password sign-in
  pages/AircraftPage.jsx   the Aircraft entity
  pages/MaterialsPage.jsx  the Materials entity — parts and kits
  pages/DrawingsPage.jsx   the Drawings entity — materials & aircraft links
  pages/ServiceBulletinsPage.jsx  Service Bulletins — configs, drawings, materials
  pages/GTLsPage.jsx       the GTL entity — operations and aircraft
SCHEMA.md                  the full data model
firestore.rules            security rules — publish these in the console
```

---

## What's next

1. **HTLs** — the recursive task-list tree that nests GTLs and other HTLs.
2. Then Technical Orders + TO Parts, and the SAP export.
