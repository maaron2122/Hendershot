const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const root = __dirname;
const port = Number(process.env.PORT || 8000);
const host = process.env.HOST || "0.0.0.0";
const requestsFile = path.join(root, "requests.json");
const calendarDir = path.join(root, "calendar-events");
const envFile = path.join(root, ".env");

loadEnvFile(envFile);

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
const resendApiKey = String(process.env.RESEND_API_KEY || "").trim();
const emailFrom = String(process.env.EMAIL_FROM || "").trim();
const businessName = String(process.env.BUSINESS_NAME || "Hendershot Concrete LLC").trim();
const businessPhone = String(process.env.BUSINESS_PHONE || "").trim();
const businessReplyEmail = String(process.env.BUSINESS_REPLY_EMAIL || "").trim();

if (generatedAdminPassword) {
  console.log(`Temporary admin password: ${generatedAdminPassword}`);
  console.log("Set ADMIN_PASSWORD or ADMIN_PASSWORD_HASH in your host environment to make admin access persistent.");
}

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return;
  }

  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }

    const separatorIndex = line.indexOf("=");
    if (separatorIndex === -1) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    const value = line.slice(separatorIndex + 1).trim().replace(/^"(.*)"$/, "$1");

    if (key && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
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

function escapeHtmlText(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
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

function isEmailConfigured() {
  return Boolean(resendApiKey && emailFrom);
}

function buildStatusEmail(request, status) {
  const formattedDate = request.projectDate;
  const formattedTime = request.projectTime;
  const safeName = escapeHtmlText(request.name);
  const safeDate = escapeHtmlText(formattedDate);
  const safeTime = escapeHtmlText(formattedTime);
  const safeAddress = escapeHtmlText(request.address);
  const safeCity = escapeHtmlText(request.city);
  const safeBusinessName = escapeHtmlText(businessName);
  const safeBusinessPhone = escapeHtmlText(businessPhone);
  const safeBusinessReplyEmail = escapeHtmlText(businessReplyEmail);
  const contactLines = [
    businessPhone ? `<div><strong>Phone:</strong> ${safeBusinessPhone}</div>` : "",
    businessReplyEmail ? `<div><strong>Email:</strong> ${safeBusinessReplyEmail}</div>` : "",
  ]
    .filter(Boolean)
    .join("");

  const emailShell = (accent, label, title, intro, body, closing) => `
    <div style="margin:0; padding:32px 16px; background:#f4efe8; font-family:Arial, sans-serif; color:#1f1f1f;">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:680px; margin:0 auto; border-collapse:collapse;">
        <tr>
          <td style="padding:0;">
            <div style="background:#1e1a18; color:#f7f1e8; border-radius:24px 24px 0 0; padding:24px 28px; border-bottom:4px solid ${accent};">
              <div style="font-size:12px; letter-spacing:0.18em; text-transform:uppercase; color:#dec4a1; margin-bottom:10px;">${safeBusinessName}</div>
              <div style="font-size:28px; line-height:1.15; font-weight:700; margin:0 0 8px;">${title}</div>
              <div style="font-size:14px; color:#d5c7b4;">${label}</div>
            </div>
            <div style="background:#ffffff; border:1px solid #e7ddd1; border-top:0; border-radius:0 0 24px 24px; padding:28px;">
              <p style="margin:0 0 16px; font-size:16px;">Hello ${safeName},</p>
              <p style="margin:0 0 18px; font-size:15px; line-height:1.7;">${intro}</p>
              <div style="background:#f8f4ee; border:1px solid #eadfce; border-radius:18px; padding:18px 20px; margin:0 0 18px;">
                <p style="margin:0 0 8px; font-size:13px; text-transform:uppercase; letter-spacing:0.12em; color:#9b7a5d;">Requested Visit</p>
                <p style="margin:0 0 6px; font-size:15px;"><strong>Date:</strong> ${safeDate}</p>
                <p style="margin:0 0 6px; font-size:15px;"><strong>Time:</strong> ${safeTime}</p>
                <p style="margin:0; font-size:15px;"><strong>Address:</strong> ${safeAddress}, ${safeCity}</p>
              </div>
              <div style="font-size:15px; line-height:1.7; margin:0 0 18px;">${body}</div>
              <p style="margin:0; font-size:15px; line-height:1.7;">${closing}</p>
              <p style="margin:18px 0 0; font-size:15px; line-height:1.7;">${safeBusinessName}</p>
              ${
                contactLines
                  ? `
                    <div style="margin-top:12px; padding-top:12px; border-top:1px solid #eadfce; font-size:14px; line-height:1.8; color:#5c4c3d;">
                      ${contactLines}
                    </div>
                  `
                  : ""
              }
            </div>
          </td>
        </tr>
      </table>
    </div>
  `;

  if (status === "approved") {
    return {
      subject: `${businessName}: Your requested date is approved`,
      html: emailShell(
        "#3f7f5f",
        "Approved Request",
        "Your requested date has been approved",
        "We reviewed your request and your selected date is confirmed on our schedule.",
        `
          <p style="margin:0 0 12px;">We look forward to working with you and will continue preparing for your project.</p>
          <p style="margin:0;">If anything changes before the scheduled date, we will reach out directly.</p>
        `,
        "Thank you for choosing us."
      ),
    };
  }

  return {
    subject: `${businessName}: Your requested date is unavailable`,
    html: emailShell(
      "#b9652c",
      "Schedule Update",
      "Your requested date did not work",
      "We reviewed your request, and the date you selected is not available on our schedule.",
      `
        <p style="margin:0 0 12px;">We will be reaching out to you to find a better time that works for your project.</p>
        <p style="margin:0;">Your request is still in our system, and we will follow up as soon as possible.</p>
      `,
      "Thank you for your patience and flexibility."
    ),
  };
}

async function sendStatusEmail(request, status) {
  if (!isEmailConfigured()) {
    return {
      sent: false,
      warning: "Email notifications are not configured. Set RESEND_API_KEY and EMAIL_FROM to enable them.",
    };
  }

  const email = buildStatusEmail(request, status);
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${resendApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: emailFrom,
      to: [request.email],
      subject: email.subject,
      html: email.html,
    }),
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    return {
      sent: false,
      warning: data.message || "The status changed, but the email notification could not be sent.",
    };
  }

  return {
    sent: true,
    id: data.id || "",
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

    if (req.method === "GET" && (pathname === "/admin.html" || pathname === "/calendar.html")) {
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

        if (!["pending", "approved", "declined"].includes(nextStatus)) {
          sendJson(res, 400, { error: "status must be pending, approved, or declined." });
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

        if (nextStatus === "pending") {
          request.calendarEventId = "";
          request.calendarEventLink = "";
          request.calendarSyncedAt = "";
        }

        request.status = nextStatus;
        request.updatedAt = new Date().toISOString();
        writeRequests(requests);

        let emailResult = { sent: false };
        if (nextStatus === "approved" || nextStatus === "declined") {
          emailResult = await sendStatusEmail(request, nextStatus);
        }

        sendJson(res, 200, { request, email: emailResult });
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
