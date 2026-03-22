const requestList = document.getElementById("request-list");
const refreshButton = document.getElementById("refresh-requests");
const pendingCount = document.getElementById("pending-count");
const approvedCount = document.getElementById("approved-count");
const declinedCount = document.getElementById("declined-count");
const logoutButton = document.getElementById("logout-button");
const requestListTitle = document.getElementById("request-list-title");
const requestListCopy = document.getElementById("request-list-copy");
const summaryFilters = Array.from(document.querySelectorAll("[data-filter-status]"));

let latestRequests = [];
let activeFilterStatus = "";

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function formatDate(value) {
  if (!value) {
    return "Not provided";
  }

  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString(undefined, {
        year: "numeric",
        month: "long",
        day: "numeric",
      });
}

function formatTime(value) {
  if (!value) {
    return "Not provided";
  }

  const [hours, minutes] = String(value).split(":");
  const date = new Date();
  date.setHours(Number(hours || 0), Number(minutes || 0), 0, 0);

  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleTimeString(undefined, {
        hour: "numeric",
        minute: "2-digit",
      });
}

function updateSummary(requests) {
  pendingCount.textContent = requests.filter((request) => request.status === "pending").length;
  approvedCount.textContent = requests.filter((request) => request.status === "approved").length;
  declinedCount.textContent = requests.filter((request) => request.status === "declined").length;
}

function updateFilterUi() {
  const titleMap = {
    pending: "Pending requests",
    approved: "Approved requests",
    declined: "Declined requests",
  };

  const copyMap = {
    pending: "Only pending requests are shown below.",
    approved: "Only approved requests are shown below.",
    declined: "Only declined requests are shown below.",
  };

  if (requestListTitle) {
    requestListTitle.textContent = activeFilterStatus ? titleMap[activeFilterStatus] : "All requests";
  }

  if (requestListCopy) {
    requestListCopy.textContent = activeFilterStatus
      ? copyMap[activeFilterStatus]
      : "Every request is shown below. Click a status card above to focus on one type.";
  }

  summaryFilters.forEach((button) => {
    const isActive = button.getAttribute("data-filter-status") === activeFilterStatus;
    button.setAttribute("aria-pressed", String(isActive));
    button.classList.toggle("summary-filter--active", isActive);
  });
}

function getVisibleRequests() {
  if (!activeFilterStatus) {
    return latestRequests;
  }

  return latestRequests.filter((request) => request.status === activeFilterStatus);
}

function renderRequests() {
  const requests = getVisibleRequests();
  updateFilterUi();

  if (!requests.length) {
    requestList.innerHTML = `
      <article class="admin-empty">
        <h2>No matching requests</h2>
        <p>There are no requests in this status right now.</p>
      </article>
    `;
    return;
  }

  requestList.innerHTML = requests
    .map((request) => {
      const statusClass = `status-badge status-badge--${request.status}`;
      const approvedDisabled = request.status === "approved" ? "disabled" : "";
      const declinedDisabled = request.status === "declined" ? "disabled" : "";
      const showUndo = request.status === "approved" || request.status === "declined";

      return `
        <article class="request-card">
          <div class="request-card__top">
            <div>
              <p class="eyebrow">Request #${escapeHtml(request.id)}</p>
              <h2>${escapeHtml(request.name)}</h2>
            </div>
            <span class="${statusClass}">${escapeHtml(request.status)}</span>
          </div>

          <div class="request-card__grid">
            <p><strong>Email:</strong> ${escapeHtml(request.email)}</p>
            <p><strong>Phone:</strong> ${escapeHtml(request.phone || "Not provided")}</p>
            <p><strong>City:</strong> ${escapeHtml(request.city)}</p>
            <p><strong>Address:</strong> ${escapeHtml(request.address)}</p>
            <p><strong>Requested date:</strong> ${escapeHtml(formatDate(request.projectDate))}</p>
            <p><strong>Requested time:</strong> ${escapeHtml(formatTime(request.projectTime))}</p>
            <p><strong>Calendar file:</strong> ${request.calendarEventLink ? "Ready" : "Not created"}</p>
            <p><strong>Submitted:</strong> ${escapeHtml(new Date(request.createdAt).toLocaleString())}</p>
            <p><strong>Last updated:</strong> ${escapeHtml(new Date(request.updatedAt).toLocaleString())}</p>
          </div>

          <div class="request-card__details">
            <strong>Project details</strong>
            <p>${escapeHtml(request.details)}</p>
          </div>

          ${
            request.calendarEventLink
              ? `
                <div class="request-card__details">
                  <strong>Calendar file</strong>
                  <p><a href="${escapeHtml(request.calendarEventLink)}" download>Download .ics calendar file</a></p>
                </div>
              `
              : ""
          }

          <div class="request-card__actions">
            <button class="button button--primary" data-id="${escapeHtml(request.id)}" data-status="approved" ${approvedDisabled}>
              Approve
            </button>
            <button class="button button--ghost" data-id="${escapeHtml(request.id)}" data-status="declined" ${declinedDisabled}>
              Decline
            </button>
            ${
              showUndo
                ? `
                  <button class="button button--ghost" data-id="${escapeHtml(request.id)}" data-status="pending">
                    Undo to Pending
                  </button>
                `
                : ""
            }
          </div>
        </article>
      `;
    })
    .join("");
}

async function loadRequests() {
  requestList.innerHTML = `
    <article class="admin-empty">
      <h2>Loading requests</h2>
      <p>Please wait while the dashboard refreshes.</p>
    </article>
  `;

  try {
    const response = await fetch("/api/requests");
    if (response.status === 401) {
      window.location.href = "/login.html";
      return;
    }

    if (!response.ok) {
      throw new Error("Unable to load requests.");
    }

    const data = await response.json();
    latestRequests = data.requests ?? [];
    updateSummary(latestRequests);
    renderRequests();
  } catch (error) {
    requestList.innerHTML = `
      <article class="admin-empty">
        <h2>Dashboard unavailable</h2>
        <p>${escapeHtml(error.message)}</p>
      </article>
    `;
  }
}

async function updateRequestStatus(id, status) {
  try {
    const response = await fetch(`/api/requests/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ status }),
    });

    if (response.status === 401) {
      window.location.href = "/login.html";
      return;
    }

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || "Unable to update request.");
    }

    const data = await response.json().catch(() => ({}));
    if (data.email?.warning) {
      window.alert(data.email.warning);
    }

    await loadRequests();
  } catch (error) {
    window.alert(error.message);
  }
}

async function logout() {
  try {
    await fetch("/api/admin/logout", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: "{}",
    });
  } finally {
    window.location.href = "/login.html";
  }
}

requestList.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-id][data-status]");
  if (!button) {
    return;
  }

  updateRequestStatus(button.dataset.id, button.dataset.status);
});

summaryFilters.forEach((button) => {
  button.addEventListener("click", () => {
    const nextStatus = button.getAttribute("data-filter-status") || "";
    activeFilterStatus = activeFilterStatus === nextStatus ? "" : nextStatus;
    renderRequests();
  });
});

refreshButton?.addEventListener("click", loadRequests);
logoutButton?.addEventListener("click", logout);

loadRequests();
