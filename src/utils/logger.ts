export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const SENSITIVE_KEY = /token|password|passwd|secret|authorization|credential|apikey/i;

/** Remove credenciais embutidas em URLs (ws://user:pass@host). */
export function redactUrl(url: string): string {
  return url.replace(/\/\/([^/@\s]+)@/, '//***@');
}

/** Copia o objeto mascarando chaves sensiveis. */
export function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SENSITIVE_KEY.test(k) ? '***' : redact(v);
    }
    return out;
  }
  return value;
}

export type Sink = (line: string, level: LogLevel) => void;

const defaultSink: Sink = (line, level) => {
  (level === 'error' ? console.error : console.log)(line);
};

export class Logger {
  constructor(
    private readonly chargePointId: string,
    private level: LogLevel = 'info',
    private readonly sink: Sink = defaultSink,
  ) {}

  setLevel(level: LogLevel): void {
    this.level = level;
  }

  private write(level: LogLevel, message: string, meta?: unknown): void {
    if (ORDER[level] < ORDER[this.level]) return;
    const ts = new Date().toISOString();
    let line = `[${ts}] [${this.chargePointId}] ${level.toUpperCase().padEnd(5)} ${message}`;
    if (meta !== undefined) line += ` ${JSON.stringify(redact(meta))}`;
    this.sink(line, level);
  }

  debug(message: string, meta?: unknown): void {
    this.write('debug', message, meta);
  }
  info(message: string, meta?: unknown): void {
    this.write('info', message, meta);
  }
  warn(message: string, meta?: unknown): void {
    this.write('warn', message, meta);
  }
  error(message: string, meta?: unknown): void {
    this.write('error', message, meta);
  }
}
