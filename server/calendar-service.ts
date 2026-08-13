import { createHash } from "node:crypto";
import { type CalendarProvider } from "@shared/schema";
import { storage } from "./storage";
import { resolveUserOAuthToken } from "./connector-service";

export type PublicCalendarProvider = Pick<CalendarProvider, "id" | "provider" | "label" | "enabled" | "createdAt">;

export function toPublicCalendarProvider(provider: CalendarProvider): PublicCalendarProvider {
  return {
    id: provider.id,
    provider: provider.provider,
    label: provider.label,
    enabled: provider.enabled,
    createdAt: provider.createdAt,
  };
}

export type CalendarProviderType = "google_calendar" | "outlook" | "ical_download" | "custom_api" | "caldav_nextcloud";

export interface ParsedEvent {
  title: string;
  description?: string;
  location?: string;
  startDate: string;
  startTime?: string;
  endDate?: string;
  endTime?: string;
  allDay?: boolean;
  recurrence?: string;
  attendees?: string[];
}

export function parseEventJson(content: string): ParsedEvent[] {
  const events: ParsedEvent[] = [];

  const jsonMatch = content.match(/```json\s*([\s\S]*?)```/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[1]);
      const arr = Array.isArray(parsed) ? parsed : parsed.events || [parsed];
      for (const e of arr) {
        if (e.title && e.startDate) {
          events.push({
            title: e.title,
            description: e.description || "",
            location: e.location || "",
            startDate: e.startDate,
            startTime: e.startTime || "",
            endDate: e.endDate || e.startDate,
            endTime: e.endTime || "",
            allDay: e.allDay ?? !e.startTime,
            recurrence: e.recurrence || "",
            attendees: e.attendees || [],
          });
        }
      }
    } catch {}
  }

  if (events.length === 0) {
    try {
      const parsed = JSON.parse(content);
      const arr = Array.isArray(parsed) ? parsed : parsed.events || [parsed];
      for (const e of arr) {
        if (e.title && e.startDate) {
          events.push({
            title: e.title,
            description: e.description || "",
            location: e.location || "",
            startDate: e.startDate,
            startTime: e.startTime || "",
            endDate: e.endDate || e.startDate,
            endTime: e.endTime || "",
            allDay: e.allDay ?? !e.startTime,
            recurrence: e.recurrence || "",
            attendees: e.attendees || [],
          });
        }
      }
    } catch {}
  }

  return events;
}

function padZero(n: number): string {
  return n.toString().padStart(2, "0");
}

function formatIcsDate(dateStr: string, timeStr?: string): string {
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) {
    const today = new Date();
    return `${today.getFullYear()}${padZero(today.getMonth() + 1)}${padZero(today.getDate())}`;
  }

  const year = d.getFullYear();
  const month = padZero(d.getMonth() + 1);
  const day = padZero(d.getDate());

  if (timeStr) {
    const timeParts = timeStr.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?/i);
    if (timeParts) {
      let hours = parseInt(timeParts[1]);
      const mins = parseInt(timeParts[2]);
      const secs = timeParts[3] ? parseInt(timeParts[3]) : 0;
      const ampm = timeParts[4];
      if (ampm) {
        if (ampm.toUpperCase() === "PM" && hours < 12) hours += 12;
        if (ampm.toUpperCase() === "AM" && hours === 12) hours = 0;
      }
      return `${year}${month}${day}T${padZero(hours)}${padZero(mins)}${padZero(secs)}`;
    }
  }

  return `${year}${month}${day}`;
}

function escapeIcsText(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
}

function generateUid(): string {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}@promptforms.ai`;
}

export function generateIcsContent(events: ParsedEvent[]): string {
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//promptforms//Calendar Event//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
  ];

  for (const event of events) {
    lines.push("BEGIN:VEVENT");
    lines.push(`UID:${generateUid()}`);
    lines.push(`DTSTAMP:${formatIcsDate(new Date().toISOString())}T000000Z`);

    if (event.allDay || !event.startTime) {
      lines.push(`DTSTART;VALUE=DATE:${formatIcsDate(event.startDate)}`);
      if (event.endDate) {
        const end = new Date(event.endDate);
        end.setDate(end.getDate() + 1);
        lines.push(`DTEND;VALUE=DATE:${formatIcsDate(end.toISOString())}`);
      }
    } else {
      lines.push(`DTSTART:${formatIcsDate(event.startDate, event.startTime)}`);
      if (event.endDate && event.endTime) {
        lines.push(`DTEND:${formatIcsDate(event.endDate, event.endTime)}`);
      } else if (event.endTime) {
        lines.push(`DTEND:${formatIcsDate(event.startDate, event.endTime)}`);
      }
    }

    lines.push(`SUMMARY:${escapeIcsText(event.title)}`);
    if (event.description) {
      lines.push(`DESCRIPTION:${escapeIcsText(event.description)}`);
    }
    if (event.location) {
      lines.push(`LOCATION:${escapeIcsText(event.location)}`);
    }
    if (event.attendees) {
      for (const attendee of event.attendees) {
        if (attendee.includes("@")) {
          lines.push(`ATTENDEE;CN=${attendee}:mailto:${attendee}`);
        }
      }
    }
    lines.push("END:VEVENT");
  }

  lines.push("END:VCALENDAR");
  return lines.join("\r\n");
}

export function generateGoogleCalendarUrl(event: ParsedEvent): string {
  const base = "https://calendar.google.com/calendar/r/eventedit";
  const params = new URLSearchParams();

  params.set("text", event.title);

  if (event.allDay || !event.startTime) {
    const start = formatIcsDate(event.startDate).replace(/T.*/, "");
    let end = start;
    if (event.endDate) {
      const endD = new Date(event.endDate);
      endD.setDate(endD.getDate() + 1);
      end = formatIcsDate(endD.toISOString()).replace(/T.*/, "");
    }
    params.set("dates", `${start}/${end}`);
  } else {
    const start = formatIcsDate(event.startDate, event.startTime);
    let end = start;
    if (event.endTime) {
      end = formatIcsDate(event.endDate || event.startDate, event.endTime);
    }
    params.set("dates", `${start}/${end}`);
  }

  if (event.description) params.set("details", event.description);
  if (event.location) params.set("location", event.location);

  return `${base}?${params.toString()}`;
}

export function generateOutlookCalendarUrl(event: ParsedEvent): string {
  const base = "https://outlook.live.com/calendar/0/action/compose";
  const params = new URLSearchParams();

  params.set("subject", event.title);
  params.set("rru", "addevent");

  if (event.startDate) {
    const d = new Date(event.startDate);
    if (event.startTime) {
      const tp = event.startTime.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?/i);
      if (tp) {
        let h = parseInt(tp[1]);
        const ampm = tp[4];
        if (ampm?.toUpperCase() === "PM" && h < 12) h += 12;
        if (ampm?.toUpperCase() === "AM" && h === 12) h = 0;
        d.setHours(h, parseInt(tp[2]), 0);
      }
    }
    params.set("startdt", d.toISOString());
    if (event.endDate && event.endTime) {
      const e = new Date(event.endDate);
      const tp2 = event.endTime.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?/i);
      if (tp2) {
        let h = parseInt(tp2[1]);
        const ampm = tp2[4];
        if (ampm?.toUpperCase() === "PM" && h < 12) h += 12;
        if (ampm?.toUpperCase() === "AM" && h === 12) h = 0;
        e.setHours(h, parseInt(tp2[2]), 0);
      }
      params.set("enddt", e.toISOString());
    }
  }

  if (event.allDay) params.set("allday", "true");
  if (event.description) params.set("body", event.description);
  if (event.location) params.set("location", event.location);

  return `${base}?${params.toString()}`;
}

export async function getAllCalendarProviders(userId: string): Promise<CalendarProvider[]> {
  const providers = await storage.calendarProviders.getByUser(userId);
  providers.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  return providers;
}

export async function addCalendarProvider(userId: string, provider: CalendarProviderType, label: string, config: any): Promise<CalendarProvider> {
  return await storage.calendarProviders.create({
    id: "",
    userId,
    provider,
    label,
    config,
    enabled: 1,
    createdAt: new Date().toISOString()
  });
}

export async function updateCalendarProvider(id: string, userId: string, updates: { enabled?: number; label?: string; config?: any }): Promise<CalendarProvider | null> {
  const existing = await storage.calendarProviders.get(id);
  if (!existing || existing.userId !== userId) return null;

  return await storage.calendarProviders.update(id, updates);
}

export async function removeCalendarProvider(id: string, userId: string): Promise<boolean> {
  const existing = await storage.calendarProviders.get(id);
  if (!existing || existing.userId !== userId) return false;

  return await storage.calendarProviders.delete(id);
}

export function buildGoogleEventBody(event: ParsedEvent, requestedTimeZone?: string): Record<string, unknown> {
  const timeZone = normalizeTimeZone(requestedTimeZone);
  const body: Record<string, unknown> = { summary: event.title };
  if (event.description) body.description = event.description;
  if (event.location) body.location = event.location;

  if (event.allDay || !event.startTime) {
    const startDate = event.startDate;
    const exclusiveEnd = new Date(`${event.endDate || startDate}T00:00:00`);
    exclusiveEnd.setDate(exclusiveEnd.getDate() + 1);
    body.start = { date: startDate };
    body.end = { date: exclusiveEnd.toISOString().slice(0, 10) };
  } else {
    const start = parseLocalEventDateTime(event.startDate, event.startTime);
    const end = event.endTime
      ? parseLocalEventDateTime(event.endDate || event.startDate, event.endTime)
      : addMinutesToLocalDateTime(start, 60);
    body.start = { dateTime: start, timeZone };
    body.end = { dateTime: end, timeZone };
  }

  if (event.attendees?.length) {
    body.attendees = event.attendees
      .filter((email) => email.includes("@"))
      .map((email) => ({ email }));
  }
  if (event.recurrence) body.recurrence = [event.recurrence];

  // Google accepts lowercase base32hex IDs. A deterministic ID makes a retry
  // idempotent, so an interrupted request cannot create the same event twice.
  const digest = createHash("sha256")
    .update(JSON.stringify(body))
    .digest("hex");
  body.id = digest.slice(0, 32);
  return body;
}

function parseLocalEventDateTime(date: string, time: string): string {
  const match = String(time).trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?$/i);
  if (!match) throw new Error("Invalid event time.");
  let hours = Number(match[1]);
  const minutes = Number(match[2]);
  const seconds = Number(match[3] || 0);
  const meridiem = match[4]?.toUpperCase();
  if (meridiem === "PM" && hours < 12) hours += 12;
  if (meridiem === "AM" && hours === 12) hours = 0;
  if (hours > 23 || minutes > 59 || seconds > 59) throw new Error("Invalid event time.");

  const parsed = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) throw new Error("Invalid event date.");
  return `${date}T${padZero(hours)}:${padZero(minutes)}:${padZero(seconds)}`;
}

function addMinutesToLocalDateTime(value: string, minutes: number): string {
  const parsed = new Date(`${value}Z`);
  if (Number.isNaN(parsed.getTime())) throw new Error("Invalid event date.");
  parsed.setUTCMinutes(parsed.getUTCMinutes() + minutes);
  return parsed.toISOString().slice(0, 19);
}

function normalizeTimeZone(value?: string): string {
  const candidate = String(value || "UTC").trim();
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: candidate }).format();
    return candidate;
  } catch {
    return "UTC";
  }
}

async function createGoogleCalendarEvent(event: ParsedEvent, accessToken: string): Promise<boolean> {
  try {
    const body: any = {
      summary: event.title,
    };
    if (event.description) body.description = event.description;
    if (event.location) body.location = event.location;

    if (event.allDay || !event.startTime) {
      body.start = { date: event.startDate };
      body.end = { date: event.endDate || event.startDate };
    } else {
      const startDt = new Date(`${event.startDate}T${event.startTime}`);
      body.start = { dateTime: startDt.toISOString() };
      if (event.endTime) {
        const endDt = new Date(`${event.endDate || event.startDate}T${event.endTime}`);
        body.end = { dateTime: endDt.toISOString() };
      } else {
        const endDt = new Date(startDt.getTime() + 60 * 60 * 1000);
        body.end = { dateTime: endDt.toISOString() };
      }
    }

    if (event.attendees?.length) {
      body.attendees = event.attendees.filter(a => a.includes('@')).map(email => ({ email }));
    }

    const res = await fetch('https://www.googleapis.com/calendar/v3/calendars/primary/events', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function createCalDAVEvent(event: ParsedEvent, config: { caldavUrl: string; username: string; password: string }): Promise<boolean> {
  try {
    const uid = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}@aiforms`;
    const icsContent = generateIcsContent([event]);
    const singleEvent = icsContent.replace(/UID:.*\r?\n/, `UID:${uid}\r\n`);
    const calUrl = config.caldavUrl.replace(/\/$/, "");
    const eventUrl = `${calUrl}/${uid}.ics`;

    const res = await fetch(eventUrl, {
      method: "PUT",
      headers: {
        "Content-Type": "text/calendar; charset=utf-8",
        Authorization: "Basic " + Buffer.from(`${config.username}:${config.password}`).toString("base64"),
      },
      body: singleEvent,
    });
    return res.ok || res.status === 201;
  } catch {
    return false;
  }
}

export async function exportToCalendarProvider(provider: CalendarProvider, events: ParsedEvent[], userId: string, timeZone?: string): Promise<{ success: boolean; error?: string; urls?: string[]; created?: number }> {
  const config = provider.config as any;

  switch (provider.provider) {
    case "google_calendar": {
      if (config.useOAuth) {
        try {
          const { token } = await resolveUserOAuthToken(userId, "google_calendar");
          let created = 0;
          for (const event of events) {
            if (await createGoogleCalendarEvent(event, token)) created++;
          }
          return { success: true, created };
        } catch (err: any) {
          return { success: false, error: `Google Calendar error: ${err.message}` };
        }
      }
      const urls = events.map(e => generateGoogleCalendarUrl(e));
      return { success: true, urls };
    }
    case "outlook": {
      const urls = events.map(e => generateOutlookCalendarUrl(e));
      return { success: true, urls };
    }
    case "caldav_nextcloud": {
      if (!config?.caldavUrl || !config?.username || !config?.password) {
        return { success: false, error: "CalDAV URL, username, and password are required" };
      }
      try {
        let created = 0;
        for (const event of events) {
          if (await createCalDAVEvent(event, config)) created++;
        }
        return { success: true, created };
      } catch (err: any) {
        return { success: false, error: err.message };
      }
    }
    case "custom_api": {
      if (!config?.webhookUrl) {
        return { success: false, error: "Webhook URL not configured" };
      }
      try {
        const res = await fetch(config.webhookUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
          },
          body: JSON.stringify({ events }),
        });
        if (!res.ok) {
          return { success: false, error: `API returned ${res.status}` };
        }
        return { success: true };
      } catch (err: any) {
        return { success: false, error: err.message };
      }
    }
    default:
      return { success: false, error: "Unknown provider type" };
  }
}
