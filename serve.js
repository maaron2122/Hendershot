const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const root = __dirname;
const port = Number(process.env.PORT || 8000);
const host = process.env.HOST || "0.0.0.0";
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

const sessions = new Map();
const startupSecret = crypto.randomBytes(32).toString("hex");
const sessionSecret = process.env.SESSION_SECRET || startupSecret;
const calendarFeedToken =
  process.env.CALENDAR_FEED_TOKEN || crypto.createHash("sha256").update(sessionSecret).digest("hex").slice(0, 32);
const configuredPasswordHash = String(process.env.ADMIN_PASSWORD_HASH || "").trim().toLowerCase();
const configuredPasswordPlain = String(process.env.ADMIN_PASSWORD || "").trim();
const generatedAdminPassword = configuredPasswordHash || configuredPasswordPlain
  ? ""
  : crypto.randomBytes(9).toString("base64url");

if (generatedAdminPassword) {
  console.log(`Temporary admin password: ${generatedAdminPassword}`);
  console.log("Set ADMIN_PASSWORD or ADMIN_PASSWORD_HASH in your host environment to make admin access persistent.");
}

function ensureStorage() {
  if (!fs.existsSync(requestsFile)) {
    fs.writeFileSync(requestsFile, "[]", "utf8");
  }

  if (!fs.existsSync(calendarDir)) {
    fs.mkdirSync(calendarDir, { recursive: true });
  }
}

function getAdminPasswordHash() {
  if (configuredPasswordHash) {
    return configuredPasswordHash;
  }

  const password = configuredPasswordPlain || generatedAdminPassword;
  return crypto.createHash("sha256").update(password).digest("hex");
}

function setSecurityHeaders(res) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "same-origin");
  res.setHeader("Permissions-Policy", "geolocation=(), microphone=(), camera=()");
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"
  );
}

function sendJson(res, statusCode, payload) {
  setSecurityHeaders(res);
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
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

function escapeIcsText(value) {
  return String(value ?? "")
    .replaceAll("\\", "\\\\")
    .replaceAll(";", "\\;")
    .replaceAll(",", "\\,")
    .replaceAll("\r\n", "\\n")
    .replaceAll("\n", "\\n");
}

function buildCalendarEventLines(request) {
  const updatedDate = new Date(request.updatedAt || request.createdAt || Date.now());
  const startDate = new Date(`${request.projectDate}T${request.projectTime || "08:00"}:00`);
  const endDate = new Date(startDate);
  endDate.setHours(endDate.getHours() + 1);

  const summary = "Hendershot Concrete Job";
  const description = [
    "Approved estimate request",
    `Address: ${request.address}, ${request.city}`,
    `Scheduled date: ${request.projectDate}`,
    `Scheduled time: ${request.projectTime}`,
  ].join("\n");

  return [
    "BEGIN:VEVENT",
    `UID:${request.id}@hendershotconcrete.local`,
    `DTSTAMP:${formatUtcStamp(updatedDate)}`,
    `SUMMARY:${escapeIcsText(summary)}`,
    `DESCRIPTION:${escapeIcsText(description)}`,
    `LOCATION:${escapeIcsText(`${request.address}, ${request.city}`)}`,
    `DTSTART:${formatUtcStamp(startDate)}`,
    `DTEND:${formatUtcStamp(endDate)}`,
    "STATUS:CONFIRMED",
    "END:VEVENT",
  ];
}

function createIcsContents(request) {
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Hendershot Concrete LLC//Request Calendar//EN",
    "CALSCALE:GREGORIAN",
    ...buildCalendarEventLines(request),
    "END:VCALENDAR",
    "",
  ].join("\r\n");
}

function createCalendarFeed(requests) {
  const approvedRequests = requests
    .map(sanitizeRequest)
    .filter((request) => request.status === "approved");

  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Hendershot Concrete LLC//Approved Requests Feed//EN",
    "CALSCALE:GREGORIAN",
    ...approvedRequests.flatMap((request) => buildCalendarEventLines(request)),
    "END:VCALENDAR",
    "",
  ].join("\r\n");
}

function ensureCalendarFile(request) {
  ensureStorage();
  const fileName = `request-${request.id}.ics`;
  const filePath = path.join(calendarDir, fileName);
  fs.writeFileSync(filePath, createIcsContents(request), "utf8");

  return {
    id: request.id,
    link: `/calendar-events/${fileName}`,
    syncedAt: new Date().toISOString(),
  };
}

function parseCookies(req) {
  const header = req.headers.cookie || "";
  const pairs = header.split(/;\s*/).filter(Boolean);
  const cookies = {};

  for (const pair of pairs) {
    const separatorIndex = pair.indexOf("=");
    if (separatorIndex === -1) {
      continue;
    }

    const key = pair.slice(0, separatorIndex).trim();
    const value = pair.slice(separatorIndex + 1).trim();
    cookies[key] = decodeURIComponent(value);
  }

  return cookies;
}

function createSession(req) {
  const token = crypto.randomBytes(24).toString("hex");
  sessions.set(token, {
    createdAt: Date.now(),
    ip: req.socket.remoteAddress || "",
  });
  return token;
}

function isSecureRequest(req) {
  return req.headers["x-forwarded-proto"] === "https" || req.socket.encrypted;
}

function setSessionCookie(req, res, token) {
  const cookieParts = [
    `admin_session=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=43200",
  ];

  if (isSecureRequest(req)) {
    cookieParts.push("Secure");
  }

  res.setHeader("Set-Cookie", cookieParts.join("; "));
}

function clearSessionCookie(req, res) {
  const cookieParts = [
    "admin_session=",
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=0",
  ];

  if (isSecureRequest(req)) {
    cookieParts.push("Secure");
  }

  res.setHeader("Set-Cookie", cookieParts.join("; "));
}

function getSession(req) {
  const cookies = parseCookies(req);
  const token = cookies.admin_session;
  if (!token) {
    return null;
  }

  const session = sessions.get(token);
  return session ? { token, session } : null;
}

function requireAdmin(req, res) {
  const activeSession = getSession(req);
  if (!activeSession) {
    sendJson(res, 401, { error: "Admin login required." });
    return null;
  }

  return activeSession;
}

function redirect(res, location) {
  setSecurityHeaders(res);
  res.writeHead(302, {
    Location: location,
    "Cache-Control": "no-store",
  });
  res.end();
}

function serveStatic(req, res, pathname) {
  const requestedPath = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  let filePath = path.resolve(root, requestedPath);

  if (!filePath.startsWith(root)) {
    setSecurityHeaders(res);
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
    filePath = path.join(filePath, "index.html");
  }

  fs.readFile(filePath, (error, data) => {
    if (error) {
      setSecurityHeaders(res);
      res.writeHead(404);
      res.end("Not found");
      return;
    }

    const extension = path.extname(filePath).toLowerCase();
    setSecurityHeaders(res);
    res.writeHead(200, {
      "Content-Type": mimeTypes[extension] || "application/octet-stream",
      "Cache-Control": extension === ".html" ? "no-store" : "public, max-age=300",
    });
    res.end(data);
  });
}

http
  .createServer(async (req, res) => {
    const pathname = decodeURIComponent((req.url || "/").split("?")[0]);
    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

    if (req.method === "GET" && pathname === "/login.html") {
      serveStatic(req, res, pathname);
      return;
    }

    if (req.method === "POST" && pathname === "/api/admin/login") {
      try {
        const payload = await readRequestBody(req);
        const password = String(payload.password || "");
        const submittedHash = crypto.createHash("sha256").update(password).digest("hex");

        if (submittedHash !== getAdminPasswordHash()) {
          sendJson(res, 401, { error: "Invalid password." });
          return;
        }

        const token = createSession(req);
        setSessionCookie(req, res, token);
        sendJson(res, 200, { ok: true });
      } catch (error) {
        sendJson(res, 400, { error: error.message || "Unable to log in." });
      }
      return;
    }

    if (req.method === "POST" && pathname === "/api/admin/logout") {
      const activeSession = getSession(req);
      if (activeSession) {
        sessions.delete(activeSession.token);
      }

      clearSessionCookie(req, res);
      sendJson(res, 200, { ok: true });
      return;
    }

    if (req.method === "GET" && pathname === "/admin.html") {
      if (!getSession(req)) {
        redirect(res, "/login.html");
        return;
      }

      serveStatic(req, res, pathname);
      return;
    }

    if (req.method === "GET" && pathname === "/calendar-feed.ics") {
      const suppliedToken = String(url.searchParams.get("token") || "");
      if (suppliedToken !== calendarFeedToken) {
        setSecurityHeaders(res);
        res.writeHead(404);
        res.end("Not found");
        return;
      }

      const requests = readRequests();
      setSecurityHeaders(res);
      res.writeHead(200, {
        "Content-Type": mimeTypes[".ics"],
        "Cache-Control": "no-store",
      });
      res.end(createCalendarFeed(requests));
      return;
    }

    if (req.method === "GET" && pathname === "/api/requests") {
      if (!requireAdmin(req, res)) {
        return;
      }

      const requests = readRequests()
        .map(sanitizeRequest)
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

      sendJson(res, 200, {
        requests,
        calendarMode: "ics",
        calendarFeedUrl: `/calendar-feed.ics?token=${calendarFeedToken}`,
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
      if (!requireAdmin(req, res)) {
        return;
      }

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
  .listen(port, host, () => {
    console.log(`Preview server running at http://${host}:${port}`);
  });
