# Firebase auth domain audit — 2026-08-16

The connected Firebase Console is signed in as `ragul6191@gmail.com`. The accessible Firebase project is named `caveworkers` and has an Authentication user list containing `ragul6191@gmail.com`, `ragulyogesh7@gmail.com`, and `qa@caveworkers.test`. Opening the requested project path for `caveworkers-505714` redirected to the Firebase home page because that project is not available as a Firebase project to the current account.

The active Firebase project has Authentication tabs for Users, Sign-in method, Templates, Usage, and Settings. This indicates the immediate `auth/unauthorized-domain` fix should be applied to the accessible Firebase project `caveworkers` by adding `mycaveworkers.ai.studio` to Authentication → Settings → Authorized domains. No authentication setting has been changed yet.

Source page: https://console.firebase.google.com/u/0/project/caveworkers/authentication/users
