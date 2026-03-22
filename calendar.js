const logoutButton = document.getElementById("logout-button");
const calendarGrid = document.getElementById("calendar-grid");
const calendarMonthLabel = document.getElementById("calendar-month-label");
const calendarPrev = document.getElementById("calendar-prev");
const calendarNext = document.getElementById("calendar-next");
const calendarModal = document.getElementById("calendar-modal");
const calendarModalContent = document.getElementById("calendar-modal-content");
const calendarModalClose = document.getElementById("calendar-modal-close");

const weekdayLabels = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
let visibleMonth = new Date();
visibleMonth = new Date(visibleMonth.getFullYear(), visibleMonth.getMonth(), 1);
let latestRequests = [];
let selectedDateKey = "";
let expandedRequestId = "";

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
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

function formatLongDate(value) {
  if (!value) {
    return "Unknown date";
  }

  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString(undefined, {
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric",
      });
}

function getApprovedRequests(requests) {
  return requests.filter((request) => request.status === "approved");
}

function groupApprovedRequestsByDate(requests) {
  return getApprovedRequests(requests).reduce((groups, request) => {
    const key = request.projectDate || "unknown";
    if (!groups[key]) {
      groups[key] = [];
    }
    groups[key].push(request);
    groups[key].sort((left, right) => String(left.projectTime).localeCompare(String(right.projectTime)));
    return groups;
  }, {});
}

function renderSelectedDay(dateKey, groupedRequests) {
  if (!calendarModalContent) {
    return;
  }

  const requests = groupedRequests[dateKey] || [];

  if (!dateKey) {
    calendarModalContent.innerHTML = `
      <p class="eyebrow">Selected Day</p>
      <h3>Choose a date on the calendar</h3>
      <p class="section-copy">
        Click any day with a scheduled job to review its approved requests here.
      </p>
    `;
    return;
  }

  if (!requests.length) {
    calendarModalContent.innerHTML = `
      <p class="eyebrow">Selected Day</p>
      <h3>${escapeHtml(formatLongDate(dateKey))}</h3>
      <p class="section-copy">
        No approved jobs are scheduled for this day yet.
      </p>
    `;
    return;
  }

  calendarModalContent.innerHTML = `
    <p class="eyebrow">Selected Day</p>
    <h3>${escapeHtml(formatLongDate(dateKey))}</h3>
    <div class="calendar-selected__list">
      ${requests
        .map(
          (request) => `
            <article class="calendar-job-card ${expandedRequestId === request.id ? "calendar-job-card--expanded" : ""}">
              <button class="calendar-job-card__summary" type="button" data-request-id="${escapeHtml(request.id)}">
                <div class="calendar-job-card__top">
                  <div>
                    <h4>${escapeHtml(request.address)}</h4>
                    <p>${escapeHtml(request.city)}</p>
                  </div>
                  <span class="status-badge status-badge--approved">Approved</span>
                </div>
                <div class="calendar-job-card__grid">
                  <p><strong>Time:</strong> ${escapeHtml(formatTime(request.projectTime))}</p>
                  <p><strong>Customer:</strong> ${escapeHtml(request.name)}</p>
                  <p><strong>Phone:</strong> ${escapeHtml(request.phone || "Not provided")}</p>
                  <p><strong>Email:</strong> ${escapeHtml(request.email)}</p>
                </div>
              </button>
              <div class="calendar-job-card__details ${expandedRequestId === request.id ? "calendar-job-card__details--open" : ""}">
                <div>
                  <p class="eyebrow">Job Details</p>
                  <h4>${escapeHtml(request.name)}</h4>
                  <p>${escapeHtml(formatTime(request.projectTime))}</p>
                </div>
                <div class="calendar-job-card__grid">
                  <p><strong>Phone:</strong> ${escapeHtml(request.phone || "Not provided")}</p>
                  <p><strong>Email:</strong> ${escapeHtml(request.email)}</p>
                  <p><strong>Address:</strong> ${escapeHtml(request.address)}</p>
                  <p><strong>City:</strong> ${escapeHtml(request.city)}</p>
                </div>
                <div class="request-card__details">
                  <strong>Project details</strong>
                  <p>${escapeHtml(request.details)}</p>
                </div>
              </div>
            </article>
          `
        )
        .join("")}
    </div>
  `;

  calendarModalContent.querySelectorAll(".calendar-job-card__summary[data-request-id]").forEach((button) => {
    button.addEventListener("click", () => {
      const requestId = button.getAttribute("data-request-id") || "";
      expandedRequestId = expandedRequestId === requestId ? "" : requestId;
      renderSelectedDay(dateKey, groupedRequests);
    });
  });
}

function openCalendarModal() {
  if (!calendarModal) {
    return;
  }

  calendarModal.hidden = false;
  document.body.classList.add("modal-open");
}

function closeCalendarModal() {
  if (!calendarModal) {
    return;
  }

  calendarModal.hidden = true;
  document.body.classList.remove("modal-open");
}

function renderCalendar(requests) {
  if (!calendarGrid || !calendarMonthLabel) {
    return;
  }

  const groupedRequests = groupApprovedRequestsByDate(requests);
  const firstDay = new Date(visibleMonth.getFullYear(), visibleMonth.getMonth(), 1);
  const lastDay = new Date(visibleMonth.getFullYear(), visibleMonth.getMonth() + 1, 0);
  const startOffset = firstDay.getDay();
  const totalDays = lastDay.getDate();
  const cells = [];

  calendarMonthLabel.textContent = visibleMonth.toLocaleDateString(undefined, {
    month: "long",
    year: "numeric",
  });

  weekdayLabels.forEach((label) => {
    cells.push(`<div class="calendar-grid__weekday">${label}</div>`);
  });

  for (let index = 0; index < startOffset; index += 1) {
    cells.push(`<div class="calendar-day calendar-day--empty" aria-hidden="true"></div>`);
  }

  for (let day = 1; day <= totalDays; day += 1) {
    const date = new Date(visibleMonth.getFullYear(), visibleMonth.getMonth(), day);
    const dateKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    const dayRequests = groupedRequests[dateKey] || [];
    const isSelected = dateKey === selectedDateKey;

    cells.push(`
      <button
        class="calendar-day ${dayRequests.length ? "calendar-day--has-jobs" : ""} ${isSelected ? "calendar-day--selected" : ""}"
        type="button"
        data-date="${dateKey}"
        aria-pressed="${isSelected ? "true" : "false"}"
      >
        <span class="calendar-day__number">${day}</span>
        <span class="calendar-day__count">${dayRequests.length ? `${dayRequests.length} job${dayRequests.length === 1 ? "" : "s"}` : "Open"}</span>
        <div class="calendar-day__jobs">
          ${dayRequests
            .slice(0, 3)
            .map(
              (request) => `
                <span class="calendar-day__job">${escapeHtml(formatTime(request.projectTime))} ${escapeHtml(request.name)}</span>
              `
            )
            .join("")}
        </div>
      </button>
    `);
  }

  calendarGrid.innerHTML = cells.join("");

  const firstApprovedDate = Object.keys(groupedRequests)
    .filter((dateKey) => dateKey.startsWith(`${visibleMonth.getFullYear()}-${String(visibleMonth.getMonth() + 1).padStart(2, "0")}`))
    .sort()[0];

  const visibleMonthPrefix = `${visibleMonth.getFullYear()}-${String(visibleMonth.getMonth() + 1).padStart(2, "0")}`;
  if (!selectedDateKey || !selectedDateKey.startsWith(visibleMonthPrefix)) {
    selectedDateKey = firstApprovedDate || `${visibleMonthPrefix}-01`;
  }

  const selectedRequests = groupedRequests[selectedDateKey] || [];
  if (!selectedRequests.some((request) => request.id === expandedRequestId)) {
    expandedRequestId = selectedRequests[0]?.id || "";
  }

  calendarGrid.querySelectorAll(".calendar-day[data-date]").forEach((button) => {
    button.addEventListener("click", () => {
      selectedDateKey = button.dataset.date || "";
      const nextRequests = groupedRequests[selectedDateKey] || [];
      expandedRequestId = nextRequests[0]?.id || "";
      renderSelectedDay(selectedDateKey, groupedRequests);
      openCalendarModal();
    });
  });
}

async function loadCalendar() {
  if (calendarGrid) {
    calendarGrid.innerHTML = `
      <article class="admin-empty">
        <h2>Loading calendar</h2>
        <p>Please wait while the schedule view is prepared.</p>
      </article>
    `;
  }

  try {
    const response = await fetch("/api/requests");
    if (response.status === 401) {
      window.location.href = "/login.html";
      return;
    }

    if (!response.ok) {
      throw new Error("Unable to load calendar.");
    }

    const data = await response.json();
    latestRequests = data.requests ?? [];
    renderCalendar(latestRequests);
  } catch (error) {
    if (calendarGrid) {
      calendarGrid.innerHTML = `
        <article class="admin-empty">
          <h2>Calendar unavailable</h2>
          <p>${escapeHtml(error.message)}</p>
        </article>
      `;
    }
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

function changeMonth(offset) {
  visibleMonth = new Date(visibleMonth.getFullYear(), visibleMonth.getMonth() + offset, 1);
  renderCalendar(latestRequests);
}

logoutButton?.addEventListener("click", logout);
calendarPrev?.addEventListener("click", () => changeMonth(-1));
calendarNext?.addEventListener("click", () => changeMonth(1));
calendarModalClose?.addEventListener("click", closeCalendarModal);
calendarModal?.addEventListener("click", (event) => {
  if (event.target instanceof HTMLElement && event.target.hasAttribute("data-close-calendar-modal")) {
    closeCalendarModal();
  }
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    closeCalendarModal();
  }
});

loadCalendar();
