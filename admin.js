const requestList = document.getElementById("request-list");
const refreshButton = document.getElementById("refresh-requests");
const pendingCount = document.getElementById("pending-count");
const approvedCount = document.getElementById("approved-count");
const declinedCount = document.getElementById("declined-count");
const calendarFeedLink = document.getElementById("calendar-feed-link");
const copyFeedLinkButton = document.getElementById("copy-feed-link");
const feedStatus = document.getElementById("feed-status");
const feedPreviewList = document.getElementById("feed-preview-list");

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

function renderFeedPreview(requests) {
  if (!feedPreviewList) {
    return;
  }

  const approvedRequests = requests.filter((request) => request.status === "approved");

  if (!approvedRequests.length) {
    feedPreviewList.innerHTML = `
      <article class="admin-empty">
        <h2>No approved jobs yet</h2>
        <p>Approved requests will appear here and in the shared calendar feed.</p>
      </article>
    `;
    return;
  }

  feedPreviewList.innerHTML = approvedRequests
    .map(
      (request) => `
        <article class="feed-preview-card">
          <div class="feed-preview-card__top">
            <div>
              <p class="eyebrow">Included In Feed</p>
              <h3>${escapeHtml(request.name)}</h3>
            </div>
            <span class="status-badge status-badge--approved">Approved</span>
          </div>
          <div class="feed-preview-card__grid">
            <p><strong>Date:</strong> ${escapeHtml(formatDate(request.projectDate))}</p>
            <p><strong>Time:</strong> ${escapeHtml(formatTime(request.projectTime))}</p>
            <p><strong>Phone:</strong> ${escapeHtml(request.phone || "Not provided")}</p>
            <p><strong>Address:</strong> ${escapeHtml(`${request.address}, ${request.city}`)}</p>
          </div>
        </article>
      `
    )
    .join("");
}

function renderRequests(requests) {
  updateSummary(requests);
  renderFeedPreview(requests);

  if (!requests.length) {
    requestList.innerHTML = `
      <article class="admin-empty">
        <h2>No requests yet</h2>
        <p>Estimate requests submitted from the homepage will appear here.</p>
      </article>
    `;
    return;
  }

  requestList.innerHTML = requests
    .map((request) => {
      const statusClass = `status-badge status-badge--${request.status}`;
      const approvedDisabled = request.status === "approved" ? "disabled" : "";
      const declinedDisabled = request.status === "declined" ? "disabled" : "";

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
    if (!response.ok) {
      throw new Error("Unable to load requests.");
    }

    const data = await response.json();
    if (calendarFeedLink && data.calendarFeedUrl) {
      const absoluteFeedUrl = new URL(data.calendarFeedUrl, window.location.origin).toString();
      calendarFeedLink.href = absoluteFeedUrl;
      calendarFeedLink.textContent = "Open Calendar Feed";
      copyFeedLinkButton?.setAttribute("data-feed-url", absoluteFeedUrl);
    }
    renderRequests(data.requests ?? []);
  } catch (error) {
    requestList.innerHTML = `
      <article class="admin-empty">
        <h2>Dashboard unavailable</h2>
        <p>${escapeHtml(error.message)}</p>
      </article>
    `;
  }
}

async function copyFeedLink() {
  const feedUrl = copyFeedLinkButton?.getAttribute("data-feed-url");
  if (!feedUrl || !feedStatus) {
    return;
  }

  try {
    await navigator.clipboard.writeText(feedUrl);
    feedStatus.textContent = "Calendar feed link copied.";
  } catch {
    feedStatus.textContent = "Could not copy automatically. Open the feed and copy the URL from your browser.";
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

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || "Unable to update request.");
    }

    await loadRequests();
  } catch (error) {
    window.alert(error.message);
  }
}

requestList.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-id][data-status]");
  if (!button) {
    return;
  }

  updateRequestStatus(button.dataset.id, button.dataset.status);
});

refreshButton?.addEventListener("click", loadRequests);
copyFeedLinkButton?.addEventListener("click", copyFeedLink);

loadRequests();
