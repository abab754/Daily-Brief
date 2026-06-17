import {
  registerAppResource,
  registerAppTool,
  RESOURCE_MIME_TYPE,
} from "@modelcontextprotocol/ext-apps/server";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type {
  CallToolResult,
  ReadResourceResult,
} from "@modelcontextprotocol/sdk/types.js";
import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { buildBriefing, getAuthUrl, isAuthenticated } from "./google-api.js";
import type { DailyBriefing } from "./google-api.js";

const DIST_DIR = import.meta.filename.endsWith(".ts")
  ? path.join(import.meta.dirname, "dist")
  : import.meta.dirname;

function formatTextSummary(briefing: DailyBriefing): string {
  if (!briefing.authenticated) {
    const authUrl = getAuthUrl();
    if (!authUrl) {
      return "Google API not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET environment variables.";
    }
    return `You need to connect your Google account first.\nVisit: ${authUrl}`;
  }

  return [
    `${briefing.greeting}! Here's your briefing for ${briefing.date}:`,
    "",
    `Meetings today: ${briefing.summary.totalMeetings} (${briefing.summary.busyHours}h busy)`,
    briefing.summary.nextMeeting
      ? `Next up: ${briefing.summary.nextMeeting.title} at ${new Date(briefing.summary.nextMeeting.startTime).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
      : "No more meetings today!",
    "",
    `Emails needing action: ${briefing.summary.totalEmails}`,
    ...briefing.emails
      .slice(0, 3)
      .map((e) => `  - ${e.subject} (from ${e.from.split("<")[0].trim()})`),
    "",
    `Recently modified docs: ${briefing.summary.totalDocs}`,
    ...briefing.drive
      .slice(0, 3)
      .map((d) => `  - ${d.name} (by ${d.modifiedBy})`),
  ].join("\n");
}

export function createServer(googleUserId: string | null): McpServer {
  const server = new McpServer({
    name: "Daily Briefing Builder",
    version: "1.0.0",
  });

  const resourceUri = "ui://daily-briefing/mcp-app.html";

  registerAppTool(
    server,
    "daily-briefing",
    {
      title: "Daily Briefing",
      description:
        "Shows your daily briefing: today's calendar events, unread emails needing action, and recently modified Drive docs.",
      inputSchema: {},
      _meta: { ui: { resourceUri } },
    },
    async (): Promise<CallToolResult> => {
      const briefing = await buildBriefing(googleUserId);
      const authUrl = !briefing.authenticated ? getAuthUrl() : undefined;
      const payload = { ...briefing, authUrl };

      return {
        content: [
          { type: "text", text: formatTextSummary(briefing) },
          { type: "text", text: JSON.stringify(payload) },
        ],
      };
    }
  );

  registerAppTool(
    server,
    "briefing-item-detail",
    {
      title: "Briefing Item Detail",
      description:
        "Get details about a specific calendar event, email, or drive doc from the daily briefing.",
      inputSchema: {
        itemType: z.enum(["calendar", "email", "drive"]).describe("Type of item"),
        itemId: z.string().describe("ID of the item"),
      },
      _meta: { ui: { resourceUri } },
    },
    async (args): Promise<CallToolResult> => {
      const briefing = await buildBriefing(googleUserId);

      let detail: string;
      if (args.itemType === "calendar") {
        const event = briefing.calendar.find((e) => e.id === args.itemId);
        detail = event ? JSON.stringify(event, null, 2) : "Event not found";
      } else if (args.itemType === "email") {
        const email = briefing.emails.find((e) => e.id === args.itemId);
        detail = email ? JSON.stringify(email, null, 2) : "Email not found";
      } else {
        const doc = briefing.drive.find((d) => d.id === args.itemId);
        detail = doc ? JSON.stringify(doc, null, 2) : "Doc not found";
      }

      return {
        content: [{ type: "text", text: detail }],
      };
    }
  );

  registerAppTool(
    server,
    "check-auth",
    {
      title: "Check Auth Status",
      description: "Check if Google account is connected",
      inputSchema: {},
      _meta: { ui: { resourceUri, visibility: ["app"] } },
    },
    async (): Promise<CallToolResult> => {
      const authenticated = isAuthenticated(googleUserId);
      const authUrl = !authenticated ? getAuthUrl() : undefined;
      return {
        content: [{ type: "text", text: JSON.stringify({ authenticated, authUrl }) }],
      };
    }
  );

  registerAppResource(
    server,
    resourceUri,
    resourceUri,
    { mimeType: RESOURCE_MIME_TYPE },
    async (): Promise<ReadResourceResult> => {
      const html = await fs.readFile(
        path.join(DIST_DIR, "mcp-app.html"),
        "utf-8"
      );
      return {
        contents: [{ uri: resourceUri, mimeType: RESOURCE_MIME_TYPE, text: html }],
      };
    }
  );

  return server;
}
