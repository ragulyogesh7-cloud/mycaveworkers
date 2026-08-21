export interface RegistryRemoteHeader {
  name: string;
  description?: string;
  isRequired?: boolean;
  isSecret?: boolean;
}

export interface RegistryRemote {
  type: string;
  url: string;
  headers: RegistryRemoteHeader[];
}

export interface RegistryServerResult {
  name: string;
  description: string;
  version: string;
  repository_url?: string;
  repository_source?: string;
  remotes: RegistryRemote[];
  directory_url: string;
  official_status?: string;
  published_at?: string;
  updated_at?: string;
}

export interface RegistrySearchResult {
  servers: RegistryServerResult[];
  next_cursor?: string;
  count: number;
}

interface RawRegistryResponse {
  servers?: Array<{ server?: any; _meta?: any }>;
  metadata?: { nextCursor?: string; count?: number };
}

const DEFAULT_REGISTRY_URL = 'https://registry.modelcontextprotocol.io/v0.1';
const DEFAULT_DIRECTORY_URL = 'https://mcp.directory';
const MAX_QUERY_LENGTH = 80;
const MAX_CURSOR_LENGTH = 256;
const MAX_PAGE_SIZE = 20;
const MAX_RESPONSE_BYTES = 2_000_000;
const REQUEST_TIMEOUT_MS = 8_000;

function cleanText(value: unknown, maxLength: number): string {
  return String(value || '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

function cleanUrl(value: unknown): string | undefined {
  const raw = String(value || '').trim();
  if (!raw || raw.length > 2_000) return undefined;
  try {
    const parsed = new URL(raw);
    if (!['http:', 'https:'].includes(parsed.protocol)) return undefined;
    return parsed.toString();
  } catch (_error) {
    return undefined;
  }
}

function directorySearchUrl(name: string): string {
  const base = process.env.MCP_DIRECTORY_URL || DEFAULT_DIRECTORY_URL;
  return `${base.replace(/\/$/, '')}/servers?search=${encodeURIComponent(name.slice(0, 120))}`;
}

function normalizeRemote(remote: any): RegistryRemote | null {
  const url = cleanUrl(remote?.url);
  const type = cleanText(remote?.type, 80);
  if (!url || !type || !['streamable-http', 'sse'].includes(type)) return null;
  const headers = Array.isArray(remote?.headers)
    ? remote.headers.slice(0, 30).map((header: any) => ({
      name: cleanText(header?.name, 120),
      description: cleanText(header?.description, 300) || undefined,
      isRequired: Boolean(header?.isRequired),
      isSecret: Boolean(header?.isSecret)
    })).filter((header: RegistryRemoteHeader) => header.name)
    : [];
  return { type, url, headers };
}

function normalizeServer(entry: { server?: any; _meta?: any }): RegistryServerResult | null {
  const server = entry?.server;
  const name = cleanText(server?.name, 180);
  if (!name) return null;
  const remotes = Array.isArray(server?.remotes)
    ? server.remotes.map(normalizeRemote).filter((remote: RegistryRemote | null): remote is RegistryRemote => Boolean(remote)).slice(0, 10)
    : [];
  const official = entry?._meta?.['io.modelcontextprotocol.registry/official'];
  return {
    name,
    description: cleanText(server?.description, 900) || 'No description provided by the publisher.',
    version: cleanText(server?.version, 80) || 'unknown',
    repository_url: cleanUrl(server?.repository?.url),
    repository_source: cleanText(server?.repository?.source, 40) || undefined,
    remotes,
    directory_url: directorySearchUrl(name),
    official_status: cleanText(official?.status, 40) || undefined,
    published_at: cleanText(official?.publishedAt, 80) || undefined,
    updated_at: cleanText(official?.updatedAt, 80) || undefined
  };
}

async function fetchJson(url: string): Promise<RawRegistryResponse> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: controller.signal
    });
    if (!response.ok) throw new Error(`MCP Registry returned HTTP ${response.status}.`);
    const contentLength = Number(response.headers.get('content-length') || 0);
    if (contentLength > MAX_RESPONSE_BYTES) throw new Error('MCP Registry response is too large.');
    const text = await response.text();
    if (Buffer.byteLength(text, 'utf8') > MAX_RESPONSE_BYTES) throw new Error('MCP Registry response is too large.');
    return JSON.parse(text) as RawRegistryResponse;
  } finally {
    clearTimeout(timeout);
  }
}

export async function searchMcpRegistry(query: string, cursor?: string, limit = 12): Promise<RegistrySearchResult> {
  const trimmedQuery = String(query || '').trim().slice(0, MAX_QUERY_LENGTH);
  if (!trimmedQuery) return { servers: [], count: 0 };
  const boundedLimit = Math.max(1, Math.min(MAX_PAGE_SIZE, Number(limit) || 12));
  const params = new URLSearchParams({ search: trimmedQuery, version: 'latest', limit: String(boundedLimit) });
  const boundedCursor = String(cursor || '').trim().slice(0, MAX_CURSOR_LENGTH);
  if (boundedCursor) params.set('cursor', boundedCursor);
  const base = (process.env.MCP_REGISTRY_URL || DEFAULT_REGISTRY_URL).replace(/\/$/, '');
  const payload = await fetchJson(`${base}/servers?${params.toString()}`);
  const servers = (payload.servers || []).map(normalizeServer).filter((server): server is RegistryServerResult => Boolean(server));
  return {
    servers,
    next_cursor: cleanText(payload.metadata?.nextCursor, MAX_CURSOR_LENGTH) || undefined,
    count: Number(payload.metadata?.count || servers.length)
  };
}

export async function getMcpRegistryServer(name: string): Promise<RegistryServerResult | null> {
  const normalizedName = String(name || '').trim().slice(0, 180);
  if (!normalizedName) return null;
  const base = (process.env.MCP_REGISTRY_URL || DEFAULT_REGISTRY_URL).replace(/\/$/, '');
  const payload = await fetchJson(`${base}/servers/${encodeURIComponent(normalizedName)}?version=latest`);
  if (Array.isArray(payload.servers) && payload.servers[0]) return normalizeServer(payload.servers[0]);
  return null;
}

export const MCP_REGISTRY_LIMITS = {
  maxQueryLength: MAX_QUERY_LENGTH,
  maxPageSize: MAX_PAGE_SIZE,
  timeoutMs: REQUEST_TIMEOUT_MS
};
