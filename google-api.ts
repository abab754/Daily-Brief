import { google } from "googleapis";
import type { OAuth2Client } from "google-auth-library";
import { saveUserTokens, getUserTokens } from "./token-store.js";

// --- Types ---

export interface CalendarEvent {
  id: string;
  title: string;
  startTime: string;
  endTime: string;
  location?: string;
  attendees: string[];
  isAllDay: boolean;
  meetLink?: string;
}

export interface Email {
  id: string;
  from: string;
  subject: string;
  snippet: string;
  date: string;
  isStarred: boolean;
  labels: string[];
  threadId: string;
}

export interface DriveDoc {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime: string;
  modifiedBy: string;
  webViewLink: string;
  iconType: "doc" | "sheet" | "slide" | "pdf" | "folder" | "other";
}

export interface DailyBriefing {
  date: string;
  greeting: string;
  calendar: CalendarEvent[];
  emails: Email[];
  drive: DriveDoc[];
  authenticated: boolean;
  authUrl?: string;
  userName?: string;
  summary: {
    totalMeetings: number;
    totalEmails: number;
    totalDocs: number;
    nextMeeting?: CalendarEvent;
    busyHours: number;
  };
}

// --- OAuth2 Setup ---

const SCOPES = [
  "https://www.googleapis.com/auth/calendar.readonly",
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/drive.metadata.readonly",
  "https://www.googleapis.com/auth/userinfo.profile",
  "https://www.googleapis.com/auth/userinfo.email",
];

export function isConfigured(): boolean {
  return !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

function createOAuth2Client(): OAuth2Client | null {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI || "http://localhost:3001/auth/google/callback";
  if (!clientId || !clientSecret) return null;
  return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
}

export function getAuthUrl(state?: string): string | null {
  const client = createOAuth2Client();
  if (!client) return null;
  return client.generateAuthUrl({
    access_type: "offline",
    scope: SCOPES,
    prompt: "consent",
    state,
  });
}

export async function handleAuthCallback(code: string): Promise<{
  googleUserId: string;
  email: string;
  displayName?: string;
}> {
  const client = createOAuth2Client();
  if (!client) throw new Error("Google OAuth not configured");

  const { tokens } = await client.getToken(code);
  client.setCredentials(tokens);

  // Get user info
  const oauth2 = google.oauth2({ version: "v2", auth: client });
  const userInfo = await oauth2.userinfo.get();
  const googleUserId = userInfo.data.id!;
  const email = userInfo.data.email!;
  const displayName = userInfo.data.given_name || userInfo.data.name || undefined;

  // Store encrypted tokens
  saveUserTokens(googleUserId, email, displayName, {
    accessToken: tokens.access_token!,
    refreshToken: tokens.refresh_token || undefined,
    expiryDate: tokens.expiry_date || undefined,
  });

  return { googleUserId, email, displayName };
}

export function isAuthenticated(googleUserId: string | null): boolean {
  if (!googleUserId) return false;
  return getUserTokens(googleUserId) !== null;
}

function getAuthedClientForUser(googleUserId: string): OAuth2Client | null {
  const record = getUserTokens(googleUserId);
  if (!record) return null;

  const client = createOAuth2Client();
  if (!client) return null;

  client.setCredentials({
    access_token: record.tokens.accessToken,
    refresh_token: record.tokens.refreshToken,
    expiry_date: record.tokens.expiryDate,
  });

  // Persist refreshed tokens when they auto-renew
  client.on("tokens", (newTokens) => {
    try {
      saveUserTokens(googleUserId, record.email, record.displayName, {
        accessToken: newTokens.access_token || record.tokens.accessToken,
        refreshToken: newTokens.refresh_token || record.tokens.refreshToken,
        expiryDate: newTokens.expiry_date || record.tokens.expiryDate,
      });
    } catch (e) {
      console.error("Failed to persist refreshed tokens:", e);
    }
  });

  return client;
}

// --- Google API Fetchers ---

async function fetchCalendarEvents(googleUserId: string): Promise<CalendarEvent[]> {
  const auth = getAuthedClientForUser(googleUserId);
  if (!auth) return [];
  const calendar = google.calendar({ version: "v3", auth });

  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const endOfDay = new Date(startOfDay.getTime() + 24 * 60 * 60 * 1000);

  const res = await calendar.events.list({
    calendarId: "primary",
    timeMin: startOfDay.toISOString(),
    timeMax: endOfDay.toISOString(),
    singleEvents: true,
    orderBy: "startTime",
    maxResults: 20,
  });

  return (res.data.items || []).map((event) => {
    const isAllDay = !event.start?.dateTime;
    return {
      id: event.id || "",
      title: event.summary || "(No title)",
      startTime: event.start?.dateTime || event.start?.date || "",
      endTime: event.end?.dateTime || event.end?.date || "",
      location: event.location || undefined,
      attendees: (event.attendees || [])
        .filter((a) => !a.self)
        .map((a) => a.displayName || a.email || "")
        .slice(0, 10),
      isAllDay,
      meetLink: event.hangoutLink || event.conferenceData?.entryPoints?.[0]?.uri || undefined,
    };
  });
}

async function fetchEmails(googleUserId: string): Promise<Email[]> {
  const auth = getAuthedClientForUser(googleUserId);
  if (!auth) return [];
  const gmail = google.gmail({ version: "v1", auth });

  const res = await gmail.users.messages.list({
    userId: "me",
    q: "is:unread in:inbox",
    maxResults: 10,
  });

  const messages = res.data.messages || [];
  const emails: Email[] = [];

  for (const msg of messages.slice(0, 8)) {
    const detail = await gmail.users.messages.get({
      userId: "me",
      id: msg.id!,
      format: "metadata",
      metadataHeaders: ["From", "Subject", "Date"],
    });

    const headers = detail.data.payload?.headers || [];
    const getHeader = (name: string) =>
      headers.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value || "";

    const labelIds = detail.data.labelIds || [];

    emails.push({
      id: detail.data.id || "",
      from: getHeader("From"),
      subject: getHeader("Subject") || "(No subject)",
      snippet: detail.data.snippet || "",
      date: getHeader("Date")
        ? new Date(getHeader("Date")).toISOString()
        : new Date(parseInt(detail.data.internalDate || "0")).toISOString(),
      isStarred: labelIds.includes("STARRED"),
      labels: labelIds
        .filter((l) => !["UNREAD", "INBOX", "CATEGORY_PRIMARY", "CATEGORY_UPDATES", "CATEGORY_SOCIAL", "CATEGORY_PROMOTIONS"].includes(l))
        .map((l) => l.replace(/^CATEGORY_/, "").replace(/_/g, " "))
        .map((l) => l.charAt(0) + l.slice(1).toLowerCase()),
      threadId: detail.data.threadId || "",
    });
  }

  return emails;
}

async function fetchDriveDocs(googleUserId: string): Promise<DriveDoc[]> {
  const auth = getAuthedClientForUser(googleUserId);
  if (!auth) return [];
  const drive = google.drive({ version: "v3", auth });

  const res = await drive.files.list({
    q: "trashed = false",
    orderBy: "modifiedTime desc",
    pageSize: 10,
    fields: "files(id, name, mimeType, modifiedTime, lastModifyingUser, webViewLink)",
  });

  return (res.data.files || []).map((file) => {
    let iconType: DriveDoc["iconType"] = "other";
    const mime = file.mimeType || "";
    if (mime.includes("document")) iconType = "doc";
    else if (mime.includes("spreadsheet")) iconType = "sheet";
    else if (mime.includes("presentation")) iconType = "slide";
    else if (mime.includes("pdf")) iconType = "pdf";
    else if (mime.includes("folder")) iconType = "folder";

    return {
      id: file.id || "",
      name: file.name || "",
      mimeType: mime,
      modifiedTime: file.modifiedTime || "",
      modifiedBy: file.lastModifyingUser?.displayName || "Unknown",
      webViewLink: file.webViewLink || "",
      iconType,
    };
  });
}

async function fetchUserName(googleUserId: string): Promise<string> {
  const record = getUserTokens(googleUserId);
  return record?.displayName || "";
}

// --- Briefing Builder ---

function getTodayStr(): string {
  return new Date().toISOString().split("T")[0];
}

function getGreeting(name?: string): string {
  const hour = new Date().getHours();
  let greet: string;
  if (hour < 12) greet = "Good morning";
  else if (hour < 17) greet = "Good afternoon";
  else greet = "Good evening";
  return name ? `${greet}, ${name}` : greet;
}

export async function buildBriefing(googleUserId: string | null): Promise<DailyBriefing> {
  if (!googleUserId || !isAuthenticated(googleUserId)) {
    return {
      date: getTodayStr(),
      greeting: getGreeting(),
      calendar: [],
      emails: [],
      drive: [],
      authenticated: false,
      summary: {
        totalMeetings: 0,
        totalEmails: 0,
        totalDocs: 0,
        busyHours: 0,
      },
    };
  }

  const [calendar, emails, drive, userName] = await Promise.all([
    fetchCalendarEvents(googleUserId).catch((e) => {
      console.error("Calendar fetch error:", e.message);
      return [] as CalendarEvent[];
    }),
    fetchEmails(googleUserId).catch((e) => {
      console.error("Gmail fetch error:", e.message);
      return [] as Email[];
    }),
    fetchDriveDocs(googleUserId).catch((e) => {
      console.error("Drive fetch error:", e.message);
      return [] as DriveDoc[];
    }),
    fetchUserName(googleUserId).catch(() => undefined),
  ]);

  const now = new Date();
  const nextMeeting = calendar.find((e) => !e.isAllDay && new Date(e.startTime) > now);

  const busyMinutes = calendar
    .filter((e) => !e.isAllDay)
    .reduce((sum, e) => {
      const start = new Date(e.startTime).getTime();
      const end = new Date(e.endTime).getTime();
      return sum + (end - start) / 60000;
    }, 0);

  return {
    date: getTodayStr(),
    greeting: getGreeting(userName),
    calendar,
    emails,
    drive,
    authenticated: true,
    userName,
    summary: {
      totalMeetings: calendar.length,
      totalEmails: emails.length,
      totalDocs: drive.length,
      nextMeeting,
      busyHours: Math.round((busyMinutes / 60) * 10) / 10,
    },
  };
}
