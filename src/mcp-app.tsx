import type { McpUiHostContext } from "@modelcontextprotocol/ext-apps";
import { useApp } from "@modelcontextprotocol/ext-apps/react";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { StrictMode, useCallback, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import "./global.css";

// --- Types ---

interface CalendarEvent {
  id: string;
  title: string;
  startTime: string;
  endTime: string;
  location?: string;
  attendees: string[];
  isAllDay: boolean;
  meetLink?: string;
}

interface Email {
  id: string;
  from: string;
  subject: string;
  snippet: string;
  date: string;
  isStarred: boolean;
  labels: string[];
  threadId: string;
}

interface DriveDoc {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime: string;
  modifiedBy: string;
  webViewLink: string;
  iconType: "doc" | "sheet" | "slide" | "pdf" | "folder" | "other";
}

interface DailyBriefing {
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

// --- Helpers ---

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function formatDate(dateStr: string): string {
  return new Date(dateStr + "T00:00:00").toLocaleDateString([], {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

function extractSenderName(from: string): string {
  const match = from.match(/^([^<]+)/);
  return match ? match[1].trim() : from;
}

function senderInitial(from: string): string {
  const name = extractSenderName(from);
  return name.charAt(0).toUpperCase();
}

function parseBriefing(result: CallToolResult): DailyBriefing | null {
  for (const c of result.content || []) {
    if (c.type !== "text") continue;
    try {
      const parsed = JSON.parse(c.text);
      if (parsed && typeof parsed === "object" && "calendar" in parsed) return parsed;
    } catch { /* not JSON, skip */ }
  }
  return null;
}

// --- Icons ---

function CalendarIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
    </svg>
  );
}

function MailIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="4" width="20" height="16" rx="2" />
      <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
    </svg>
  );
}

function FileIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
      <path d="M14 2v4a2 2 0 0 0 2 2h4" />
    </svg>
  );
}

function VideoIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
      <path d="M15 10.5V6.5a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1v11a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1v-4l4.89 3.26A.5.5 0 0 0 21 16.5v-9a.5.5 0 0 0-.78-.41L15 10.5Z" />
    </svg>
  );
}

function RefreshIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
      <path d="M3 3v5h5" />
      <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" />
      <path d="M21 21v-5h-5" />
    </svg>
  );
}

function StarIcon({ filled }: { filled: boolean }) {
  if (!filled) return null;
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="#f59e0b" stroke="none">
      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
    </svg>
  );
}

function GoogleIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 48 48">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
    </svg>
  );
}

const docColors: Record<string, string> = {
  doc: "#4285f4", sheet: "#0f9d58", slide: "#f4b400", pdf: "#ea4335", folder: "#5f6368", other: "#5f6368",
};
const docLabels: Record<string, string> = {
  doc: "Doc", sheet: "Sheet", slide: "Slides", pdf: "PDF", folder: "Folder", other: "File",
};

// --- Components ---

function ConnectScreen({ authUrl }: { authUrl?: string }) {
  return (
    <div style={{
      display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
      minHeight: "100vh", padding: 32, gap: 32, textAlign: "center",
    }}>
      <div style={{
        width: 80, height: 80, borderRadius: 20,
        background: "linear-gradient(135deg, var(--color-blue-soft), var(--color-green-soft))",
        display: "flex", alignItems: "center", justifyContent: "center",
        border: "1px solid var(--color-border)",
      }}>
        <CalendarIcon size={36} />
      </div>
      <div>
        <h1 style={{ fontSize: "1.5rem", fontWeight: 700, marginBottom: 8 }}>Daily Briefing</h1>
        <p style={{ color: "var(--color-text-secondary)", maxWidth: 360, lineHeight: 1.6 }}>
          Connect your Google account to see today's calendar, unread emails, and recent docs — all in one place.
        </p>
      </div>
      {authUrl ? (
        <a
          href={authUrl}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            display: "inline-flex", alignItems: "center", gap: 10,
            padding: "12px 28px", borderRadius: 12, fontSize: "0.95rem", fontWeight: 600,
            background: "var(--color-text-primary)", color: "var(--color-background-primary)",
            textDecoration: "none", boxShadow: "var(--shadow-md)",
            transition: "transform 0.15s, box-shadow 0.15s",
          }}
        >
          <GoogleIcon />
          Connect Google Account
        </a>
      ) : (
        <div style={{
          background: "var(--color-amber-soft)", border: "1px solid var(--color-amber)",
          borderRadius: 12, padding: "14px 20px", maxWidth: 400, fontSize: "0.85rem",
          color: "var(--color-text-secondary)", lineHeight: 1.6,
        }}>
          <strong style={{ color: "var(--color-text-primary)" }}>Setup required</strong><br />
          Set <code style={{ background: "var(--color-background-tertiary)", padding: "1px 5px", borderRadius: 4, fontSize: "0.8rem" }}>GOOGLE_CLIENT_ID</code> and{" "}
          <code style={{ background: "var(--color-background-tertiary)", padding: "1px 5px", borderRadius: 4, fontSize: "0.8rem" }}>GOOGLE_CLIENT_SECRET</code>{" "}
          environment variables, then restart the server.
        </div>
      )}
      <div style={{
        display: "flex", gap: 24, color: "var(--color-text-tertiary)", fontSize: "0.8rem",
      }}>
        <span style={{ display: "flex", alignItems: "center", gap: 4 }}><CalendarIcon size={13} /> Calendar</span>
        <span style={{ display: "flex", alignItems: "center", gap: 4 }}><MailIcon size={13} /> Gmail</span>
        <span style={{ display: "flex", alignItems: "center", gap: 4 }}><FileIcon size={13} /> Drive</span>
      </div>
    </div>
  );
}

function StatCard({ value, label, color }: { value: string; label: string; color: string }) {
  return (
    <div style={{
      flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 2, padding: "12px 0",
    }}>
      <span style={{ fontSize: "1.35rem", fontWeight: 700, color, lineHeight: 1 }}>{value}</span>
      <span style={{ fontSize: "0.7rem", color: "var(--color-text-tertiary)", textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 500 }}>{label}</span>
    </div>
  );
}

function NextMeetingCard({ event }: { event: CalendarEvent }) {
  return (
    <div style={{
      background: "var(--color-blue-soft)",
      border: "1px solid var(--color-blue-border)",
      borderRadius: "var(--radius-md)", padding: "16px 18px",
      display: "flex", justifyContent: "space-between", alignItems: "center",
    }}>
      <div>
        <div style={{ fontSize: "0.7rem", fontWeight: 600, color: "var(--color-blue)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>
          Up Next
        </div>
        <div style={{ fontWeight: 600, fontSize: "1.05rem" }}>{event.title}</div>
        <div style={{ fontSize: "0.82rem", color: "var(--color-text-secondary)", marginTop: 2 }}>
          {formatTime(event.startTime)} - {formatTime(event.endTime)}
          {event.location && <> &middot; {event.location}</>}
        </div>
      </div>
      {event.meetLink && (
        <div style={{
          background: "var(--color-blue)", color: "#fff", borderRadius: 8,
          padding: "8px 14px", fontSize: "0.8rem", fontWeight: 600,
          display: "flex", alignItems: "center", gap: 5, flexShrink: 0,
        }}>
          <VideoIcon /> Join
        </div>
      )}
    </div>
  );
}

function SectionHeader({ icon, title, count, countLabel, color }: {
  icon: React.ReactNode; title: string; count: number; countLabel: string; color: string;
}) {
  return (
    <div style={{
      display: "flex", justifyContent: "space-between", alignItems: "center",
      padding: "14px 18px", background: "var(--color-background-secondary)",
      borderBottom: "1px solid var(--color-border)",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 600, fontSize: "0.9rem", color }}>
        {icon}
        {title}
      </div>
      <span style={{
        fontSize: "0.72rem", color: "var(--color-text-tertiary)", fontWeight: 500,
        background: "var(--color-background-tertiary)", padding: "2px 8px", borderRadius: 6,
      }}>
        {count} {countLabel}
      </span>
    </div>
  );
}

function CalendarSection({ events, onItemClick }: {
  events: CalendarEvent[];
  onItemClick: (type: string, id: string, label: string) => void;
}) {
  if (events.length === 0) return null;
  return (
    <section style={sectionStyle}>
      <SectionHeader icon={<CalendarIcon />} title="Calendar" count={events.length} countLabel="events" color="var(--color-blue)" />
      <div>
        {events.map((event, i) => (
          <div
            key={event.id}
            onClick={() => onItemClick("calendar", event.id, event.title)}
            style={{
              display: "flex", gap: 14, padding: "13px 18px", cursor: "pointer",
              borderBottom: i < events.length - 1 ? "1px solid var(--color-border-light)" : "none",
              transition: "background 0.12s",
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = "var(--color-background-hover)")}
            onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
          >
            <div style={{
              minWidth: 48, display: "flex", flexDirection: "column", alignItems: "center",
              gap: 1, paddingTop: 2,
            }}>
              <span style={{ fontSize: "0.75rem", fontWeight: 600, fontFamily: "var(--font-mono)", color: "var(--color-blue)" }}>
                {formatTime(event.startTime)}
              </span>
              <span style={{ fontSize: "0.65rem", color: "var(--color-text-tertiary)" }}>
                {formatTime(event.endTime)}
              </span>
            </div>
            <div style={{
              width: 3, borderRadius: 2, background: "var(--color-blue)", opacity: 0.5,
              flexShrink: 0, alignSelf: "stretch",
            }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 500, marginBottom: 2 }}>{event.title}</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, fontSize: "0.78rem", color: "var(--color-text-secondary)" }}>
                {event.location && <span>{event.location}</span>}
                {event.attendees.length > 0 && (
                  <span>{event.attendees.length} attendee{event.attendees.length !== 1 ? "s" : ""}</span>
                )}
                {event.meetLink && (
                  <span style={{ color: "var(--color-blue)", display: "flex", alignItems: "center", gap: 3, fontWeight: 500 }}>
                    <VideoIcon /> Meet
                  </span>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function EmailSection({ emails, onItemClick }: {
  emails: Email[];
  onItemClick: (type: string, id: string, label: string) => void;
}) {
  if (emails.length === 0) return null;

  const avatarColors = ["#4285f4", "#ea4335", "#fbbc04", "#34a853", "#7c3aed", "#ec4899", "#f97316", "#06b6d4"];

  return (
    <section style={sectionStyle}>
      <SectionHeader icon={<MailIcon />} title="Gmail" count={emails.length} countLabel="unread" color="var(--color-red)" />
      <div>
        {emails.map((email, i) => (
          <div
            key={email.id}
            onClick={() => onItemClick("email", email.id, email.subject)}
            style={{
              display: "flex", gap: 12, padding: "13px 18px", cursor: "pointer",
              borderBottom: i < emails.length - 1 ? "1px solid var(--color-border-light)" : "none",
              transition: "background 0.12s",
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = "var(--color-background-hover)")}
            onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
          >
            <div style={{
              width: 34, height: 34, borderRadius: 10, flexShrink: 0,
              background: avatarColors[i % avatarColors.length] + "18",
              color: avatarColors[i % avatarColors.length],
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: "0.82rem", fontWeight: 700,
            }}>
              {senderInitial(email.from)}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 1 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 4, fontWeight: 500, fontSize: "0.85rem" }}>
                  {extractSenderName(email.from)}
                  <StarIcon filled={email.isStarred} />
                </div>
                <span style={{ fontSize: "0.7rem", color: "var(--color-text-tertiary)", flexShrink: 0 }}>
                  {timeAgo(email.date)}
                </span>
              </div>
              <div style={{ fontWeight: 600, fontSize: "0.88rem", marginBottom: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {email.subject}
              </div>
              <div style={{ fontSize: "0.78rem", color: "var(--color-text-secondary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {email.snippet}
              </div>
              {email.labels.filter((l) => l !== "Inbox").length > 0 && (
                <div style={{ display: "flex", gap: 4, marginTop: 6 }}>
                  {email.labels.filter((l) => l !== "Inbox").map((label) => (
                    <span key={label} style={{
                      fontSize: "0.68rem", background: "var(--color-background-tertiary)",
                      padding: "1px 7px", borderRadius: 5, color: "var(--color-text-secondary)", fontWeight: 500,
                    }}>
                      {label}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function DriveSection({ docs, onItemClick }: {
  docs: DriveDoc[];
  onItemClick: (type: string, id: string, label: string) => void;
}) {
  if (docs.length === 0) return null;
  return (
    <section style={sectionStyle}>
      <SectionHeader icon={<FileIcon />} title="Drive" count={docs.length} countLabel="recent" color="var(--color-green)" />
      <div>
        {docs.map((doc, i) => (
          <div
            key={doc.id}
            onClick={() => onItemClick("drive", doc.id, doc.name)}
            style={{
              display: "flex", alignItems: "center", gap: 12, padding: "11px 18px", cursor: "pointer",
              borderBottom: i < docs.length - 1 ? "1px solid var(--color-border-light)" : "none",
              transition: "background 0.12s",
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = "var(--color-background-hover)")}
            onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
          >
            <div style={{
              width: 34, height: 34, borderRadius: 8, flexShrink: 0,
              background: docColors[doc.iconType] + "14",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: "0.65rem", fontWeight: 700, color: docColors[doc.iconType],
              textTransform: "uppercase", letterSpacing: "0.02em",
            }}>
              {docLabels[doc.iconType]}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: "0.9rem" }}>
                {doc.name}
              </div>
              <div style={{ fontSize: "0.75rem", color: "var(--color-text-tertiary)", marginTop: 1 }}>
                {doc.modifiedBy} &middot; {timeAgo(doc.modifiedTime)}
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

// --- Main App ---

function DailyBriefingApp() {
  const [briefing, setBriefing] = useState<DailyBriefing | null>(null);
  const [hostContext, setHostContext] = useState<McpUiHostContext | undefined>();
  const [refreshing, setRefreshing] = useState(false);

  const { app, error } = useApp({
    appInfo: { name: "Daily Briefing", version: "1.0.0" },
    capabilities: {},
    onAppCreated: (app) => {
      app.ontoolinput = async () => {};
      app.ontoolresult = async (result) => {
        const data = parseBriefing(result);
        if (data) setBriefing(data);
      };
      app.ontoolcancelled = () => {};
      app.onerror = console.error;
      app.onhostcontextchanged = (params) => {
        setHostContext((prev) => ({ ...prev, ...params }));
      };
      app.onteardown = async () => ({});
    },
  });

  useEffect(() => {
    if (app) setHostContext(app.getHostContext());
  }, [app]);

  const handleItemClick = useCallback(
    async (type: string, id: string, label: string) => {
      if (!app) return;
      try {
        await app.sendMessage({
          role: "user",
          content: [{
            type: "text",
            text: `Tell me more about this ${type} item: "${label}" (id: ${id}). Summarize it and suggest actions I should take.`,
          }],
        });
      } catch { /* host may not support sendMessage */ }
    },
    [app]
  );

  const handleRefresh = useCallback(async () => {
    if (!app || refreshing) return;
    setRefreshing(true);
    try {
      const result = await app.callServerTool({ name: "daily-briefing", arguments: {} });
      const data = parseBriefing(result);
      if (data) setBriefing(data);
    } catch (e) {
      console.error("Refresh failed:", e);
    } finally {
      setRefreshing(false);
    }
  }, [app, refreshing]);

  const safeArea = useMemo(() => ({
    paddingTop: hostContext?.safeAreaInsets?.top,
    paddingRight: hostContext?.safeAreaInsets?.right,
    paddingBottom: hostContext?.safeAreaInsets?.bottom,
    paddingLeft: hostContext?.safeAreaInsets?.left,
  }), [hostContext]);

  if (error)
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", color: "var(--color-red)", padding: 24 }}>
        <strong>Error:</strong>&nbsp;{error.message}
      </div>
    );
  if (!app)
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", color: "var(--color-text-tertiary)" }}>
        <div style={{
          width: 20, height: 20, border: "2px solid var(--color-border)",
          borderTopColor: "var(--color-blue)", borderRadius: "50%",
          animation: "spin 0.8s linear infinite",
        }} />
        <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
      </div>
    );
  if (!briefing)
    return (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100vh", gap: 12, color: "var(--color-text-tertiary)" }}>
        <div style={{
          width: 24, height: 24, border: "2.5px solid var(--color-border)",
          borderTopColor: "var(--color-blue)", borderRadius: "50%",
          animation: "spin 0.8s linear infinite",
        }} />
        <span style={{ fontSize: "0.85rem" }}>Loading your briefing...</span>
        <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
      </div>
    );

  if (!briefing.authenticated) {
    return <ConnectScreen authUrl={briefing.authUrl} />;
  }

  return (
    <main style={{ maxWidth: 600, margin: "0 auto", padding: "24px 16px 40px", display: "flex", flexDirection: "column", gap: 16, ...safeArea }}>
      {/* Header */}
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 4 }}>
        <div>
          <h1 style={{ fontSize: "1.6rem", fontWeight: 700, lineHeight: 1.15, margin: 0, letterSpacing: "-0.02em" }}>
            {briefing.greeting}
          </h1>
          <p style={{ fontSize: "0.82rem", color: "var(--color-text-secondary)", marginTop: 4 }}>
            {formatDate(briefing.date)}
          </p>
        </div>
        <button
          onClick={handleRefresh}
          disabled={refreshing}
          style={{
            background: "var(--color-background-secondary)", border: "1px solid var(--color-border)",
            borderRadius: "var(--radius-sm)", padding: 8, color: "var(--color-text-secondary)",
            display: "flex", alignItems: "center", justifyContent: "center",
            transition: "all 0.15s", opacity: refreshing ? 0.5 : 1,
          }}
          title="Refresh"
        >
          <span style={{ display: "flex", animation: refreshing ? "spin 1s linear infinite" : "none" }}>
            <RefreshIcon />
          </span>
        </button>
      </header>

      {/* Stats */}
      <div style={{
        display: "flex", background: "var(--color-background-secondary)",
        border: "1px solid var(--color-border)", borderRadius: "var(--radius-md)",
        boxShadow: "var(--shadow-sm)",
      }}>
        <StatCard value={String(briefing.summary.totalMeetings)} label="Meetings" color="var(--color-blue)" />
        <div style={{ width: 1, background: "var(--color-border)", margin: "10px 0" }} />
        <StatCard value={`${briefing.summary.busyHours}h`} label="Busy" color="var(--color-amber)" />
        <div style={{ width: 1, background: "var(--color-border)", margin: "10px 0" }} />
        <StatCard value={String(briefing.summary.totalEmails)} label="Emails" color="var(--color-red)" />
        <div style={{ width: 1, background: "var(--color-border)", margin: "10px 0" }} />
        <StatCard value={String(briefing.summary.totalDocs)} label="Docs" color="var(--color-green)" />
      </div>

      {/* Next Meeting */}
      {briefing.summary.nextMeeting && (
        <NextMeetingCard event={briefing.summary.nextMeeting} />
      )}

      {/* Sections */}
      <CalendarSection events={briefing.calendar} onItemClick={handleItemClick} />
      <EmailSection emails={briefing.emails} onItemClick={handleItemClick} />
      <DriveSection docs={briefing.drive} onItemClick={handleItemClick} />

      <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
    </main>
  );
}

const sectionStyle: React.CSSProperties = {
  borderRadius: "var(--radius-md)",
  border: "1px solid var(--color-border)",
  overflow: "hidden",
  boxShadow: "var(--shadow-sm)",
};

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <DailyBriefingApp />
  </StrictMode>
);
