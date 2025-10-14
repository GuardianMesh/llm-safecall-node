export interface LogEntry {
  timestamp: string;
  level: 'info' | 'error' | 'warn';
  event: string;
  data?: Record<string, any>;
}

export function logJson(event: string, data?: Record<string, any>, level: LogEntry['level'] = 'info') {
  const entry: LogEntry = {
    timestamp: new Date().toISOString(),
    level,
    event,
    data
  };

  if (process.env.NODE_ENV === 'test') {
    return entry;
  }

  console.log(JSON.stringify(entry));
  return entry;
}