// Firebase Admin SDK bootstrap
// ----------------------------------------------------------------------------
// Loads credentials from either:
//   1. GOOGLE_APPLICATION_CREDENTIALS     → absolute path to service-account JSON
//   2. FIREBASE_SERVICE_ACCOUNT           → the full JSON as a single-line string
//   3. FIREBASE_PROJECT_ID / FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY triple
//
// See README.md ("Firebase setup") for step-by-step instructions.
require('dotenv').config();

const admin = require('firebase-admin');

function buildCredential() {
  // Option 1: path to a service-account JSON file on disk
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    return admin.credential.applicationDefault();
  }

  // Option 2: the entire JSON pasted into a single env var
  if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    try {
      const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
      return admin.credential.cert(sa);
    } catch (err) {
      throw new Error(
        'FIREBASE_SERVICE_ACCOUNT is not valid JSON: ' + err.message
      );
    }
  }

  // Option 3: three discrete env vars
  const { FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY } =
    process.env;
  if (FIREBASE_PROJECT_ID && FIREBASE_CLIENT_EMAIL && FIREBASE_PRIVATE_KEY) {
    return admin.credential.cert({
      projectId: FIREBASE_PROJECT_ID,
      clientEmail: FIREBASE_CLIENT_EMAIL,
      // Newlines in the PEM key survive `.env` files as literal "\n"; unescape.
      privateKey: FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
    });
  }

  throw new Error(
    'Firebase credentials missing. Set GOOGLE_APPLICATION_CREDENTIALS, ' +
      'FIREBASE_SERVICE_ACCOUNT, or the FIREBASE_PROJECT_ID/CLIENT_EMAIL/PRIVATE_KEY trio. ' +
      'See README.md → "Firebase setup".'
  );
}

if (!admin.apps.length) {
  admin.initializeApp({
    credential: buildCredential(),
    projectId:
      process.env.FIREBASE_PROJECT_ID ||
      (process.env.FIREBASE_SERVICE_ACCOUNT &&
        JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT).project_id),
  });
}

const firestore = admin.firestore();
firestore.settings({ ignoreUndefinedProperties: true });

module.exports = { admin, firestore };
