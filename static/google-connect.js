/**
 * Caveworkers Google Workspace Connector
 * Handles interactive Google Auth popup and OAuth token ingestion
 */
(function() {
  let firebaseAuthInstance = null;

  async function getFirebaseAuth() {
    if (firebaseAuthInstance) return firebaseAuthInstance;
    let config = window.FIREBASE_CONFIG;
    if (!config || !config.apiKey) {
      try {
        const res = await fetch('/api/firebase-config');
        if (res.ok) {
          config = await res.json();
          window.FIREBASE_CONFIG = config;
        }
      } catch (_e) {}
    }

    try {
      const { initializeApp, getApps, getApp } = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js');
      const { getAuth, GoogleAuthProvider, signInWithPopup } = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js');
      
      const app = getApps().length ? getApp() : initializeApp(config || {
        apiKey: "AIzaSyAAij-DDz9lf4CELdTQBVaXv0G0LpQy2OA",
        authDomain: "caveworkers.firebaseapp.com",
        projectId: "caveworkers"
      });
      
      const auth = getAuth(app);
      firebaseAuthInstance = { auth, GoogleAuthProvider, signInWithPopup };
      return firebaseAuthInstance;
    } catch (err) {
      console.warn('Firebase Auth client load error:', err);
      return null;
    }
  }

  function getScopesForService(service, gmailSendEnabled) {
    const s = String(service || '').toLowerCase();
    if (s === 'gmail' || s === 'google_gmail') {
      const scopes = ['https://www.googleapis.com/auth/gmail.readonly'];
      if (gmailSendEnabled) scopes.push('https://www.googleapis.com/auth/gmail.send');
      return scopes;
    }
    if (s === 'drive' || s === 'google_drive') {
      return ['https://www.googleapis.com/auth/drive.file'];
    }
    if (s === 'sheets' || s === 'google_sheets') {
      return ['https://www.googleapis.com/auth/spreadsheets'];
    }
    return ['https://www.googleapis.com/auth/gmail.readonly', 'https://www.googleapis.com/auth/drive.file', 'https://www.googleapis.com/auth/spreadsheets'];
  }

  window.CaveworkersGoogleConnect = async function(options) {
    const { employeeId, connectionId, service, gmailSendEnabled = false, isDirectStartPage = false } = options || {};
    if (!employeeId || !connectionId) throw new Error('Employee ID and Connection ID are required.');

    const scopes = getScopesForService(service, gmailSendEnabled);
    const fb = await getFirebaseAuth();
    
    if (fb) {
      try {
        const provider = new fb.GoogleAuthProvider();
        scopes.forEach(scope => provider.addScope(scope));
        provider.setCustomParameters({ prompt: 'select_account', access_type: 'offline' });
        
        const result = await fb.signInWithPopup(fb.auth, provider);
        const credential = fb.GoogleAuthProvider.credentialFromResult(result);
        const accessToken = credential?.accessToken || (await result.user?.getIdToken());
        const userEmail = result.user?.email || '';

        if (accessToken) {
          const csrfToken = document.cookie.match(/cw_csrf=([^;]+)/)?.[1] || '';
          const saveRes = await fetch(`/api/employees/${encodeURIComponent(employeeId)}/mcp-connections/${encodeURIComponent(connectionId)}/google/token`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-CSRF-Token': csrfToken
            },
            body: JSON.stringify({
              access_token: accessToken,
              email: userEmail,
              scopes,
              gmail_send_enabled: Boolean(gmailSendEnabled)
            })
          });

          if (!saveRes.ok) {
            const errData = await saveRes.json().catch(() => ({}));
            throw new Error(errData.error || 'Failed to persist Google token.');
          }

          const savedData = await saveRes.json();
          return { ok: true, connection: savedData.connection, email: userEmail };
        }
      } catch (fbErr) {
        if (fbErr.code === 'auth/popup-closed-by-user') {
          throw new Error('Google sign-in popup was closed before completing authorization.');
        }
        if (fbErr.code === 'auth/cancelled-popup-request') {
          throw new Error('Sign-in request was superseded by another window.');
        }
        console.warn('Firebase popup OAuth error:', fbErr);
        if (isDirectStartPage) {
          throw new Error(fbErr.message || 'Google authorization could not be completed.');
        }
      }
    }

    if (!isDirectStartPage) {
      // Fallback: server-side OAuth start redirect
      const sName = service === 'google_gmail' ? 'gmail' : service === 'google_drive' ? 'drive' : service === 'google_sheets' ? 'sheets' : service;
      window.location.assign(`/api/employees/${encodeURIComponent(employeeId)}/mcp-connections/${encodeURIComponent(connectionId)}/google/start?service=${encodeURIComponent(sName)}&return_to=${encodeURIComponent(window.location.pathname)}`);
      return { redirecting: true };
    }

    throw new Error('Google authentication service is currently unavailable. Please verify connection in Settings.');
  };
})();
