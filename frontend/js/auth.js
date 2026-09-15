/**
 * Authentication: register/login forms, token storage, and page guards.
 *
 * Token storage uses localStorage. This is a portfolio/MVP-scoped choice —
 * it's simple and works well for a single-user local demo; a production
 * deployment handling sensitive data would weigh httpOnly cookies instead
 * to reduce XSS exposure. Documented here rather than silently assumed.
 */

const Auth = {
  getUser() {
    const raw = localStorage.getItem("dms_user");
    return raw ? JSON.parse(raw) : null;
  },

  isLoggedIn() {
    return Boolean(Api.getToken());
  },

  setSession(token, user) {
    localStorage.setItem("dms_token", token);
    localStorage.setItem("dms_user", JSON.stringify(user));
  },

  logout() {
    localStorage.removeItem("dms_token");
    localStorage.removeItem("dms_user");
    location.href = "login.html";
  },

  /** Call at the top of protected pages (dashboard/history/analytics). */
  requireAuth() {
    if (!this.isLoggedIn()) {
      location.href = "login.html";
    }
  },

  /** Call on login/register pages so an already-authed user skips straight to the dashboard. */
  redirectIfAuthed() {
    if (this.isLoggedIn()) {
      location.href = "dashboard.html";
    }
  },
};

function showFormError(formEl, message) {
  let notice = formEl.querySelector(".notice--error");
  if (!notice) {
    notice = document.createElement("div");
    notice.className = "notice notice--error";
    formEl.prepend(notice);
  }
  notice.textContent = message;
  notice.classList.remove("hidden");
}

function clearFormError(formEl) {
  const notice = formEl.querySelector(".notice--error");
  if (notice) notice.classList.add("hidden");
}

document.addEventListener("DOMContentLoaded", () => {
  const params = new URLSearchParams(location.search);

  // ---- Register form ----
  const registerForm = document.getElementById("register-form");
  if (registerForm) {
    Auth.redirectIfAuthed();
    registerForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      clearFormError(registerForm);
      const submitBtn = registerForm.querySelector('button[type="submit"]');
      submitBtn.disabled = true;
      submitBtn.textContent = "Creating account...";

      const email = document.getElementById("reg-email").value.trim();
      const username = document.getElementById("reg-username").value.trim();
      const password = document.getElementById("reg-password").value;

      try {
        const result = await Api.post("/auth/register", { email, username, password }, { auth: false });
        Auth.setSession(result.access_token, result.user);
        location.href = "dashboard.html";
      } catch (err) {
        showFormError(registerForm, err.message);
        submitBtn.disabled = false;
        submitBtn.textContent = "Create account";
      }
    });
  }

  // ---- Login form ----
  const loginForm = document.getElementById("login-form");
  if (loginForm) {
    Auth.redirectIfAuthed();
    if (params.get("expired")) {
      showFormError(loginForm, "Your session expired. Please log in again.");
    }
    loginForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      clearFormError(loginForm);
      const submitBtn = loginForm.querySelector('button[type="submit"]');
      submitBtn.disabled = true;
      submitBtn.textContent = "Signing in...";

      const email = document.getElementById("login-email").value.trim();
      const password = document.getElementById("login-password").value;

      try {
        const result = await Api.post("/auth/login", { email, password }, { auth: false });
        Auth.setSession(result.access_token, result.user);
        location.href = "dashboard.html";
      } catch (err) {
        showFormError(loginForm, err.message);
        submitBtn.disabled = false;
        submitBtn.textContent = "Sign in";
      }
    });
  }

  // ---- Navbar user info + logout (present on every authenticated page) ----
  const usernameEl = document.querySelector("[data-navbar-username]");
  if (usernameEl) {
    const user = Auth.getUser();
    if (user) usernameEl.textContent = user.username;
  }
  const logoutBtn = document.querySelector("[data-logout]");
  if (logoutBtn) {
    logoutBtn.addEventListener("click", () => Auth.logout());
  }
});
