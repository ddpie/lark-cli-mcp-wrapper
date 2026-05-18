export interface LogEntry {
  timestamp: string;
  level: "info" | "warn" | "error";
  requestId?: string;
  tool?: string;
  duration?: number;
  status?: "success" | "error";
  message?: string;
}

export function log(entry: LogEntry): void {
  process.stderr.write(JSON.stringify(entry) + "\n");
}

export function logInfo(message: string, extra?: Partial<LogEntry>): void {
  log({ timestamp: new Date().toISOString(), level: "info", message, ...extra });
}

export function logError(message: string, extra?: Partial<LogEntry>): void {
  log({ timestamp: new Date().toISOString(), level: "error", message, ...extra });
}

export function logWarn(message: string, extra?: Partial<LogEntry>): void {
  log({ timestamp: new Date().toISOString(), level: "warn", message, ...extra });
}
