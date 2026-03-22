const loginForm = document.getElementById("login-form");
const loginStatus = document.getElementById("login-status");

if (loginForm && loginStatus) {
  loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    if (!loginForm.checkValidity()) {
      loginStatus.textContent = "Enter the admin password to continue.";
      return;
    }

    const formData = new FormData(loginForm);
    const password = formData.get("password");

    loginStatus.textContent = "Signing in...";

    try {
      const response = await fetch("/api/admin/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ password }),
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(data.error || "Unable to sign in.");
      }

      window.location.href = "/admin.html";
    } catch (error) {
      loginStatus.textContent = error.message;
    }
  });
}
