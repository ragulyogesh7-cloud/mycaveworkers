import crypto from 'crypto';
import dotenv from 'dotenv';
import * as Sentry from '@sentry/node';

dotenv.config();

const SENTRY_DSN = (process.env.SENTRY_DSN || '').trim();
const SENTRY_ENVIRONMENT = (process.env.SENTRY_ENVIRONMENT || process.env.CAVEWORKERS_ENV || 'development').trim();
const SENTRY_RELEASE = (process.env.K_REVISION || process.env.SENTRY_RELEASE || 'local').trim();
const configuredTraceRate = Number(process.env.SENTRY_TRACES_SAMPLE_RATE || (SENTRY_ENVIRONMENT === 'production' ? '0.1' : '0'));
const SENTRY_TRACES_SAMPLE_RATE = Number.isFinite(configuredTraceRate) ? Math.min(Math.max(configuredTraceRate, 0), 1) : 0;

export const sentryEnabled = Boolean(SENTRY_DSN);

if (sentryEnabled) {
  Sentry.init({
    dsn: SENTRY_DSN,
    environment: SENTRY_ENVIRONMENT,
    release: SENTRY_RELEASE,
    sendDefaultPii: false,
    tracesSampleRate: SENTRY_TRACES_SAMPLE_RATE,
    beforeSend(event) {
      // Caveworkers is multi-tenant. Keep operational diagnostics, not identities,
      // request bodies, cookies, authorization headers, or runtime environment.
      if (event.request) {
        event.request = {
          method: event.request.method,
          url: event.request.url,
          query_string: undefined,
          data: undefined,
          cookies: undefined,
          headers: undefined,
        };
      }
      event.user = undefined;
      return event;
    },
  });
  console.log(JSON.stringify({ event: 'observability.initialized', provider: 'sentry', environment: SENTRY_ENVIRONMENT, release: SENTRY_RELEASE, traces_sample_rate: SENTRY_TRACES_SAMPLE_RATE }));
} else {
  console.log(JSON.stringify({ event: 'observability.disabled', provider: 'sentry', reason: 'SENTRY_DSN is not configured' }));
}

type SafeContextValue = string | number | boolean | undefined;
export type OperationalFailureContext = Record<string, SafeContextValue>;

function redact(value: string): string {
  return value
    .replace(/(bearer\s+)[^\s,;]+/gi, '$1[REDACTED]')
    .replace(/((?:api[_-]?key|token|secret|authorization|password)\s*[:=]\s*)[^\s,;]+/gi, '$1[REDACTED]')
    .replace(/(https?:\/\/)[^\s/@]+@/gi, '$1[REDACTED]@')
    .slice(0, 500);
}

function safeError(error: unknown): { name: string; message: string } {
  if (error instanceof Error) return { name: error.name || 'Error', message: redact(error.message || 'Unexpected error') };
  return { name: 'NonErrorRejection', message: redact(String(error || 'Unexpected error')) };
}

export function anonymizeIdentifier(value: string | number | undefined | null): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  return crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, 16);
}

export function reportOperationalFailure(component: string, error: unknown, context: OperationalFailureContext = {}): void {
  const normalizedContext = Object.fromEntries(Object.entries(context).filter(([, value]) => value !== undefined));
  const normalizedError = safeError(error);
  const payload = {
    event: 'operational_failure',
    component,
    ...normalizedContext,
    error_name: normalizedError.name,
    error_message: normalizedError.message,
  };
  console.error(JSON.stringify(payload));

  if (!sentryEnabled) return;
  Sentry.withScope((scope) => {
    scope.setTag('component', component);
    Object.entries(normalizedContext).forEach(([key, value]) => scope.setExtra(key, value));
    scope.setExtra('error_name', normalizedError.name);
    Sentry.captureException(error instanceof Error ? error : new Error(normalizedError.message));
  });
}

export { Sentry };
