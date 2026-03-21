const http = require("http");
const fs = require("fs");
const path = require("path");

const root = __dirname;
const port = 8000;
const requestsFile = path.join(root, "requests.json");
const calendarDir = path.join(root, "calendar-events");

const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ics": "text/calendar; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
};

function ensureStorage() {
  if (!fs.existsSync(requestsFile)) {
    fs.writeFileSync(requestsFile, "[]", "utf8");
  }

  if (!fs.existsSync(calendarDir)) {
    fs.mkdirSync(calendarDir, { recursive: true });
  }
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
  });
  res.end(JSON.stringify(payload));
}

function readRequests() {
  ensureStorage();
  const fileContents = fs.readFileSync(requestsFile, "utf8");
  const parsed = JSON.parse(fileContents || "[]");
  return Array.isArray(parsed) ? parsed : [];
}

function writeRequests(requests) {
  ensureStorage();
  fs.writeFileSync(requestsFile, JSON.stringify(requests, null, 2), "utf8");
}

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";

    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) {
        reject(new Error("Request body too large."));
        req.destroy();
      }
    });

    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(new Error("Invalid JSON."));
      }
    });

    req.on("error", reject);
  });
}

function validateRequest(payload) {
  const fields = ["name", "email", "phone", "city", "address", "projectDate", "projectTime", "details"];

  for (const field of fields) {
    if (!String(payload[field] ?? "").trim()) {
      return `${field} is required.`;
    }
  }

  return null;
}

function sanitizeRequest(request) {
  return {
    id: String(request.id || ""),
    name: String(request.name || "").trim(),
    email: String(request.email || "").trim(),
    phone: String(request.phone || "").trim(),
    city: String(request.city || "").trim(),
    address: String(request.address || "").trim(),
    projectDate: String(request.projectDate || "").trim(),
    projectTime: String(request.projectTime || "").trim(),
    details: String(request.details || "").trim(),
    status: String(request.status || "pending").trim().toLowerCase(),
    createdAt: String(request.createdAt || new Date().toISOString()),
    updatedAt: String(request.updatedAt || new Date().toISOString()),
    calendarEventId: String(request.calendarEventId || ""),
    calendarEventLink: String(request.calendarEventLink || ""),
    calendarSyncedAt: String(request.calendarSyncedAt || ""),
  };
}

function padNumber(value) {
  return String(value).padStart(2, "0");
}

function formatUtcStamp(date) {
  return [
    date.getUTCFullYear(),
    padNumber(date.getUTCMonth() + 1),
    padNumber(date.getUTCDate()),
    "T",
    padNumber(date.getUTCHours()),
    padNumber(date.getUTCMinutes()),
    padNumber(date.getUTCSeconds()),
    "Z",
  ].join("");
}

function formatAllDayDate(value) {
  return value.replaceAll("-", "");
}

function escapeIcsText(value) {
  return String(value ?? "")
    .replaceAll("\\", "\\\\")
    .replaceAll(";", "\\;")
    .replaceAll(",", "\\,")
    .replaceAll("\r\n", "\\n")
    .replaceAll("\n", "\\n");
}

function createIcsContents(request) {
  const uid = `${request.id}@hendershotconcrete.local`;
  const createdAt = new Date(request.updatedAt || request.createdAt || Date.now());
  const timePart = request.projectTime || "08:00";
  const startDate = new Date(`${request.projectDate}T${timePart}:00`);
  const endDate = new Date(startDate);
  endDate.setHours(endDate.getHours() + 1);

  const summary = `Hendershot Concrete Job: ${request.name}`;
  const location = `${request.address}, ${request.city}`;
  const description = [
    `Customer: ${request.name}`,
    `Email: ${request.email}`,
    `Phone: ${request.phone}`,
    `Address: ${request.address}`,
    `City: ${request.city}`,
    `Requested date: ${request.projectDate}`,
    `Requested time: ${request.projectTime}`,
    "",
    "Project details:",
    request.details,
  ].join("\n");

  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Hendershot Concrete LLC//Request Calendar//EN",
    "CALSCALE:GREGORIAN",
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `DTSTAMP:${formatUtcStamp(createdAt)}`,
    `SUMMARY:${escapeIcsText(summary)}`,
    `DESCRIPTION:${escapeIcsText(description)}`,
    `LOCATION:${escapeIcsText(location)}`,
    `DTSTART:${formatUtcStamp(startDate)}`,
    `DTEND:${formatUtcStamp(endDate)}`,
    "STATUS:CONFIRMED",
    "END:VEVENT",
    "END:VCALENDAR",
    "",
  ].join("\r\n");
}

function createCalendarFeed(requests) {
  const approvedRequests = requests
    .map(sanitizeRequest)
    .filter((request) => request.status === "approved");

  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Hendershot Concrete LLC//Approved Requests Feed//EN",
    "CALSCALE:GREGORIAN",
  ];

  for (const request of approvedRequests) {
    const createdAt = new Date(request.updatedAt || request.createdAt || Date.now());
    const timePart = request.projectTime || "08:00";
    const startDate = new Date(`${request.projectDate}T${timePart}:00`);
    const endDate = new Date(startDate);
    endDate.setHours(endDate.getHours() + 1);

    const description = [
      `Customer: ${request.name}`,
      `Email: ${request.email}`,
      `Phone: ${request.phone}`,
      `Address: ${request.address}`,
      `City: ${request.city}`,
      `Requested date: ${request.projectDate}`,
      `Requested time: ${request.projectTime}`,
      "",
      "Project details:",
      request.details,
    ].join("\n");

    lines.push(
      "BEGIN:VEVENT",
      `UID:${request.id}@hendershotconcrete.local`,
      `DTSTAMP:${formatUtcStamp(createdAt)}`,
      `SUMMARY:${escapeIcsText(`Hendershot Concrete Job: ${request.name}`)}`,
      `DESCRIPTION:${escapeIcsText(description)}`,
      `LOCATION:${escapeIcsText(`${request.address}, ${request.city}`)}`,
      `DTSTART:${formatUtcStamp(startDate)}`,
      `DTEND:${formatUtcStamp(endDate)}`,
      "STATUS:CONFIRMED",
      "END:VEVENT"
    );
  }

  lines.push("END:VCALENDAR", "");
  return lines.join("\r\n");
}

function ensureCalendarFile(request) {
  ensureStorage();
  const fileName = `request-${request.id}.ics`;
  const filePath = path.join(calendarDir, fileName);
  const fileContents = createIcsContents(request);
  fs.writeFileSync(filePath, fileContents, "utf8");

  return {
    id: request.id,
    link: `/calendar-events/${fileName}`,
    syncedAt: new Date().toISOString(),
  };
}

function serveStatic(req, res, pathname) {
  const requestedPath = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  let filePath = path.resolve(root, requestedPath);

  if (!filePath.startsWith(root)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
    filePath = path.join(filePath, "index.html");
  }

  fs.readFile(filePath, (error, data) => {
    if (error) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }

    const extension = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      "Content-Type": mimeTypes[extension] || "application/octet-stream",
    });
    res.end(data);
  });
}

http
  .createServer(async (req, res) => {
    const pathname = decodeURIComponent((req.url || "/").split("?")[0]);

    if (req.method === "GET" && pathname === "/calendar-feed.ics") {
      const requests = readRequests();
      res.writeHead(200, {
        "Content-Type": mimeTypes[".ics"],
        "Cache-Control": "no-store",
      });
      res.end(createCalendarFeed(requests));
      return;
    }

    if (req.method === "GET" && pathname === "/api/requests") {
      const requests = readRequests()
        .map(sanitizeRequest)
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

      sendJson(res, 200, {
        requests,
        calendarMode: "ics",
        calendarFeedUrl: "/calendar-feed.ics",
      });
      return;
    }

    if (req.method === "POST" && pathname === "/api/requests") {
      try {
        const payload = await readRequestBody(req);
        const validationError = validateRequest(payload);

        if (validationError) {
          sendJson(res, 400, { error: validationError });
          return;
        }

        const timestamp = new Date().toISOString();
        const requests = readRequests().map(sanitizeRequest);
        const request = {
          id: Date.now().toString(),
          name: String(payload.name).trim(),
          email: String(payload.email).trim(),
          phone: String(payload.phone).trim(),
          city: String(payload.city).trim(),
          address: String(payload.address).trim(),
          projectDate: String(payload.projectDate).trim(),
          projectTime: String(payload.projectTime).trim(),
          details: String(payload.details).trim(),
          status: "pending",
          createdAt: timestamp,
          updatedAt: timestamp,
          calendarEventId: "",
          calendarEventLink: "",
          calendarSyncedAt: "",
        };

        requests.push(request);
        writeRequests(requests);
        sendJson(res, 201, { request });
      } catch (error) {
        sendJson(res, 400, { error: error.message || "Unable to save request." });
      }
      return;
    }

    if (req.method === "PATCH" && pathname.startsWith("/api/requests/")) {
      try {
        const id = pathname.split("/").pop();
        const payload = await readRequestBody(req);
        const nextStatus = String(payload.status || "").trim().toLowerCase();

        if (!["approved", "declined"].includes(nextStatus)) {
          sendJson(res, 400, { error: "status must be approved or declined." });
          return;
        }

        const requests = readRequests().map(sanitizeRequest);
        const request = requests.find((item) => item.id === id);

        if (!request) {
          sendJson(res, 404, { error: "Request not found." });
          return;
        }

        if (nextStatus === "approved") {
          const calendarEvent = ensureCalendarFile(request);
          request.calendarEventId = calendarEvent.id;
          request.calendarEventLink = calendarEvent.link;
          request.calendarSyncedAt = calendarEvent.syncedAt;
        }

        request.status = nextStatus;
        request.updatedAt = new Date().toISOString();
        writeRequests(requests);

        sendJson(res, 200, { request });
      } catch (error) {
        sendJson(res, 400, { error: error.message || "Unable to update request." });
      }
      return;
    }

    serveStatic(req, res, pathname);
  })
  .listen(port, "127.0.0.1", () => {
    console.log(`Preview server running at http://127.0.0.1:${port}`);
  });
