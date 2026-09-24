/* Frontend configuration.
 *
 * apiBase – where the backend (server/server.js) is reachable.
 *   ''                                   -> same address the page was loaded from
 *                                           (use this when the Node server serves the app itself, e.g. http://localhost:3000)
 *   'https://api.datacaresoftech.com'    -> separate backend (use this when the frontend is hosted on Vercel)
 *
 * The backend must be HTTPS when the frontend is served over HTTPS (Vercel always is).
 */
window.APP_CONFIG = {
  apiBase: ''
};
