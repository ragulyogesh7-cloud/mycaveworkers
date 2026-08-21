// Shared CSRF helper. The server sets a readable cw_csrf cookie; every
// state-changing request must echo it back in the X-CSRF-Token header.
(function () {
  function readCookie(name) {
    const match = document.cookie.match(new RegExp('(^|;\\s*)' + name + '=([^;]*)'));
    return match ? decodeURIComponent(match[2]) : '';
  }

  function csrfToken() {
    return readCookie('cw_csrf');
  }

  const UNSAFE = /^(POST|PUT|PATCH|DELETE)$/i;

  // Wrap fetch so existing call sites gain protection without changes.
  const originalFetch = window.fetch.bind(window);
  window.fetch = function (input, init) {
    const options = init ? Object.assign({}, init) : {};
    const method = (options.method || (typeof input === 'object' && input && input.method) || 'GET').toUpperCase();
    const url = typeof input === 'string' ? input : (input && input.url) || '';
    const sameOrigin = !/^https?:\/\//i.test(url) || url.startsWith(window.location.origin);

    if (UNSAFE.test(method) && sameOrigin) {
      const headers = new Headers(options.headers || (typeof input === 'object' && input && input.headers) || {});
      const token = csrfToken();
      if (token && !headers.has('X-CSRF-Token')) headers.set('X-CSRF-Token', token);
      options.headers = headers;
      options.credentials = options.credentials || 'same-origin';
    }
    return originalFetch(input, options);
  };

  window.csrfToken = csrfToken;
})();
