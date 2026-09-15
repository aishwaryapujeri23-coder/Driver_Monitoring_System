/**
 * Thin fetch wrapper: attaches the JWT (if present), normalizes errors, and
 * treats an expired/invalid token uniformly (redirects to login).
 */

const Api = (() => {
  const BASE = window.APP_CONFIG.API_BASE;

  function getToken() {
    return localStorage.getItem("dms_token");
  }

  async function request(path, { method = "GET", body, auth = true } = {}) {
    const headers = { "Content-Type": "application/json" };
    if (auth) {
      const token = getToken();
      if (token) headers["Authorization"] = `Bearer ${token}`;
    }

    let response;
    try {
      response = await fetch(`${BASE}${path}`, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
    } catch (networkErr) {
      throw new ApiError(
        "Cannot reach the server. Is the backend running? " +
          "(uvicorn app.main:app --reload)",
        0
      );
    }

    if (response.status === 401 && auth) {
      localStorage.removeItem("dms_token");
      localStorage.removeItem("dms_user");
      if (!location.pathname.endsWith("login.html") && !location.pathname.endsWith("/")) {
        location.href = "login.html?expired=1";
      }
      throw new ApiError("Session expired — please log in again.", 401);
    }

    let data = null;
    const text = await response.text();
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = null;
      }
    }

    if (!response.ok) {
      const message = (data && (data.detail || data.message)) || `Request failed (${response.status})`;
      throw new ApiError(typeof message === "string" ? message : JSON.stringify(message), response.status);
    }

    return data;
  }

  class ApiError extends Error {
    constructor(message, status) {
      super(message);
      this.status = status;
    }
  }

  return {
    get: (path, opts) => request(path, { ...opts, method: "GET" }),
    post: (path, body, opts) => request(path, { ...opts, method: "POST", body }),
    put: (path, body, opts) => request(path, { ...opts, method: "PUT", body }),
    ApiError,
    getToken,
  };
})();
