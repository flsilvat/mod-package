# Mod Package — Technical Order Builder

An internal tool for capturing an aircraft modification package — its Service
Bulletin, drawings, materials and tasks — seeing how it all connects, and
producing the data needed to set up the order in SAP.

**Stack:** React + Vite (frontend) · Firebase Firestore (database) ·
GitHub Pages (hosting). The data model is documented in [`SCHEMA.md`](./SCHEMA.md).

This first version is the **foundation plus the Aircraft entity** — enough to
prove the whole stack works end to end. Other entities follow.

---

## Prerequisites

- **Node.js 20+** — check with `node -v`.
- A **Google account** (for Firebase).
- A **GitHub account** (for hosting).

---

## Step 1 — Create the Firebase project

1. Go to <https://console.firebase.google.com> and **Add project**. Give it a
   name (e.g. `mod-package`). Google Analytics can be turned off.
2. Inside the project, open **Build > Firestore Database > Create database**.
   Choose a location, and start in **test mode** for now.
3. Back on the project home, click the **`</>` (Web)** icon to register a web
   app. Give it a nickname; you do **not** need Firebase Hosting.
4. Firebase shows you a `firebaseConfig` object. Keep that tab open — you need
   those six values next.

## Step 2 — Run it locally

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

Open the URL it prints. Go to **Aircraft**, add one, and it should appear in
the list — and in your Firestore database in the Firebase console.

## Step 3 — Deploy to GitHub Pages

1. Create a new GitHub repository and push this project to its `main` branch.
2. In the repo: **Settings > Secrets and variables > Actions > New repository
   secret**. Add the same six variables from Step 2 (same names, same values).
3. In **Settings > Pages**, set **Source** to **GitHub Actions**.
4. Push any commit to `main`. The workflow in `.github/workflows/deploy.yml`
   builds the app and publishes it. The live URL appears under the Actions run
   and in Settings > Pages.

> The build step reads the secrets, so the deployed site talks to the same
> Firebase project as your local copy.

---

## Project structure

```
src/
  main.jsx              app entry (HashRouter)
  App.jsx               routes
  firebase.js           Firebase init, exports the db handle
  index.css             theme and styles
  lib/collections.js    Firestore collection names (single source of truth)
  components/Layout.jsx app shell — header and navigation
  pages/HomePage.jsx    overview
  pages/AircraftPage.jsx   the Aircraft entity (create / list / delete)
SCHEMA.md               the full data model
firestore.rules         development security rules
```

---

## What's next

1. **Authentication** — the Firestore rules are wide open right now (see
   `firestore.rules`). Adding Firebase Auth so coworkers sign in, and locking
   the rules down, is the next step — do this before putting in real data.
2. **Materials** — the next entity, including the kit-within-kit nesting.
3. Then Drawings, Service Bulletins and their configs, the Technical Order,
   and finally the SAP export.
