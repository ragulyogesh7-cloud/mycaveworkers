# Live Firebase 503 diagnosis

Date: 2026-08-17

The public endpoint `https://mycaveworkers.ai.studio/api/health` is reachable and returns HTTP 200, but its components report `firebase: unconfigured` and `google_oauth: unconfigured`. The login page posts the Firebase ID token to `/api/session-login`; the backend returns HTTP 503 with `Google sign-in is not configured on this server.` whenever `firebaseAuth` or `firestoreDb` is not initialized.

The repository already contains the Firebase Admin ADC initialization path. It initializes Firebase Admin when `FIREBASE_PROJECT_ID` is set, using Cloud Run Application Default Credentials without committing a private service-account key. The browser Firebase configuration currently falls back to the existing Firebase project `caveworkers` (`caveworkers.firebaseapp.com`, project ID `caveworkers`, existing API key/app ID), and the authorized domain `mycaveworkers.ai.studio` was added to that Firebase project's Authentication settings.

For the current deployment, the safest alignment is to keep Firebase Authentication and Firestore in the existing Firebase project `caveworkers`, set Cloud Run `FIREBASE_PROJECT_ID=caveworkers`, and grant the Cloud Run runtime service account Firebase/Firestore access in that project. The separate owned Google Cloud project `caveworkers-505714` remains the Cloud Run and Google OAuth project. Setting `FIREBASE_PROJECT_ID=caveworkers-505714` without matching Firebase web configuration and cross-project permissions would create a project mismatch.

Required runtime values for the next revision include `FIREBASE_PROJECT_ID=caveworkers`, `GOOGLE_OAUTH_CLIENT_ID=1097207758345-vfj1li11iesccsi9iqdmsrh4bte47ver.apps.googleusercontent.com`, `GOOGLE_OAUTH_REDIRECT_URI=https://mycaveworkers.ai.studio/api/google/oauth/callback`, `PUBLIC_APP_URL=https://mycaveworkers.ai.studio`, `ALLOWED_ORIGINS=https://mycaveworkers.ai.studio`, `COOKIE_SECURE=true`, `CAVEWORKERS_ENV=production`, `SMTP_ENABLED=false`, and Secret Manager references for the OAuth client secret, OAuth state secret, and stable MCP token encryption key.

The browser session is currently unauthenticated at the Google sign-in page, so Cloud Run/Firebase Console mutations cannot yet be applied until the account owner signs in through the already-open browser.


## Live login-page evidence

The deployed login page at `https://mycaveworkers.ai.studio/login` renders a complete Firebase web configuration for the existing `caveworkers` Firebase project: `authDomain=caveworkers.firebaseapp.com`, `projectId=caveworkers`, the existing API key, storage bucket, messaging sender ID, and web app ID. The page’s client code correctly initializes Firebase Auth, opens Google sign-in, obtains an ID token, and posts it to `/api/session-login`.

This means the login screen’s client configuration is not missing. The remaining failure is the live server’s missing Firebase Admin/Firestore runtime initialization, which is why the server returns HTTP 503 after the browser obtains an ID token.


## Account chooser reproduction

On 2026-08-17, the live login button was clicked. The page changed from `Continue with Google` to `Signing in securely...` and remained there; no Google account chooser appeared and no visible error was rendered. The browser console contained no output. This indicates the client promise is not reaching a completed Firebase Auth result in the current browser context, consistent with a blocked or non-rendered popup/redirect path, but it does not yet distinguish browser popup blocking from Firebase configuration.
