export type DirectoryCategory =
  | 'Productivity'
  | 'Communication'
  | 'Design'
  | 'Development'
  | 'CRM & Sales'
  | 'Project Management'
  | 'Finance'
  | 'Knowledge';

export type DirectoryConnectionMode = 'google_oauth' | 'mcp_registry' | 'api_key';

export interface ConnectorDirectoryEntry {
  id: string;
  name: string;
  short_name: string;
  description: string;
  category: DirectoryCategory;
  icon_label: string;
  icon_tone: string;
  verified: boolean;
  featured: boolean;
  connection_mode: DirectoryConnectionMode;
  connection_type?: 'google_gmail' | 'google_sheets' | 'streamable_http';
  registry_name?: string;
  default_access_level: 'read_only' | 'requires_approval' | 'read_write';
  supported_actions: string[];
  keywords: string[];
  recommended_employee_ids: string[];
  setup_copy: string;
}

export const CONNECTOR_DIRECTORY: ConnectorDirectoryEntry[] = [
  {
    id: 'google-drive', name: 'Google Drive', short_name: 'Drive', description: 'Search, read, and upload workspace files instantly.', category: 'Productivity', icon_label: 'D', icon_tone: 'drive', verified: true, featured: true,
    connection_mode: 'google_oauth', connection_type: 'google_sheets', default_access_level: 'requires_approval',
    supported_actions: ['Search files', 'Read documents', 'Upload files'], keywords: ['google', 'drive', 'files', 'documents', 'storage'], recommended_employee_ids: ['david', 'emma', 'arav', 'maya', 'iris'], setup_copy: 'Connect your Google Workspace once, then grant only the employees who need Drive.'
  },
  {
    id: 'gmail', name: 'Gmail', short_name: 'Gmail', description: 'Draft replies, summarize threads, and send approved email.', category: 'Communication', icon_label: 'M', icon_tone: 'gmail', verified: true, featured: true,
    connection_mode: 'google_oauth', connection_type: 'google_gmail', default_access_level: 'requires_approval',
    supported_actions: ['Search threads', 'Draft messages', 'Send with approval'], keywords: ['google', 'gmail', 'email', 'inbox', 'messages'], recommended_employee_ids: ['sarah', 'emma', 'olivia', 'maya', 'iris'], setup_copy: 'Connect Gmail with least-privilege scopes. Sending remains approval-gated by default.'
  },
  {
    id: 'google-calendar', name: 'Google Calendar', short_name: 'Calendar', description: 'Manage schedules and coordinate meetings with context.', category: 'Productivity', icon_label: '31', icon_tone: 'calendar', verified: true, featured: true,
    connection_mode: 'google_oauth', connection_type: 'google_sheets', default_access_level: 'requires_approval',
    supported_actions: ['Find availability', 'Draft events', 'Create approved events'], keywords: ['google', 'calendar', 'schedule', 'meetings', 'availability'], recommended_employee_ids: ['sarah', 'alex', 'emma', 'olivia'], setup_copy: 'Connect Calendar, choose the employees who can coordinate time, and keep event creation reviewable.'
  },
  {
    id: 'canva', name: 'Canva', short_name: 'Canva', description: 'Search, create, autofill, and export campaign designs.', category: 'Design', icon_label: 'C', icon_tone: 'canva', verified: true, featured: true,
    connection_mode: 'mcp_registry', registry_name: 'Canva', default_access_level: 'requires_approval',
    supported_actions: ['Find templates', 'Create design drafts', 'Export approved assets'], keywords: ['canva', 'design', 'creative', 'templates', 'assets'], recommended_employee_ids: ['maya'], setup_copy: 'Select the official Canva MCP remote during setup, then assign Maya or another approved specialist.'
  },
  {
    id: 'notion', name: 'Notion', short_name: 'Notion', description: 'Connect your workspace to search and update internal knowledge.', category: 'Knowledge', icon_label: 'N', icon_tone: 'notion', verified: true, featured: true,
    connection_mode: 'mcp_registry', registry_name: 'Notion', default_access_level: 'read_write',
    supported_actions: ['Search pages', 'Read knowledge', 'Draft updates'], keywords: ['notion', 'wiki', 'knowledge', 'docs', 'roadmap'], recommended_employee_ids: ['david', 'alex', 'mike', 'emma', 'arav', 'maya', 'iris'], setup_copy: 'Connect the workspace once and use tool-level grants to decide who can read or update pages.'
  },
  {
    id: 'microsoft-365', name: 'Microsoft 365', short_name: 'M365', description: 'Access approved Microsoft 365 files, mail, and calendars.', category: 'Productivity', icon_label: 'MS', icon_tone: 'microsoft', verified: true, featured: true,
    connection_mode: 'mcp_registry', registry_name: 'Microsoft 365', default_access_level: 'requires_approval',
    supported_actions: ['Search files', 'Read mail', 'Draft calendar changes'], keywords: ['microsoft', 'office', 'outlook', 'sharepoint', 'onedrive'], recommended_employee_ids: ['sarah', 'alex', 'emma', 'arav'], setup_copy: 'Choose the tenant-approved Microsoft 365 remote and keep write actions reviewable.'
  },
  {
    id: 'figma', name: 'Figma', short_name: 'Figma', description: 'Generate diagrams and turn design context into better work.', category: 'Design', icon_label: 'F', icon_tone: 'figma', verified: true, featured: false,
    connection_mode: 'mcp_registry', registry_name: 'Figma', default_access_level: 'read_only',
    supported_actions: ['Read files', 'Inspect designs', 'Create design briefs'], keywords: ['figma', 'design', 'prototype', 'ui', 'ux'], recommended_employee_ids: ['maya', 'mike'], setup_copy: 'Connect the approved Figma MCP remote and start with read-only design context.'
  },
  {
    id: 'atlassian', name: 'Atlassian Jira', short_name: 'Jira', description: 'Access Jira and Confluence for delivery planning and knowledge.', category: 'Project Management', icon_label: 'A', icon_tone: 'atlassian', verified: true, featured: false,
    connection_mode: 'mcp_registry', registry_name: 'Atlassian', default_access_level: 'requires_approval',
    supported_actions: ['Search issues', 'Draft tickets', 'Update approved work'], keywords: ['atlassian', 'jira', 'confluence', 'issues', 'sprint'], recommended_employee_ids: ['mike', 'alex', 'sarah'], setup_copy: 'Connect Jira and Confluence, then assign technical and operations access separately.'
  },
  {
    id: 'slack', name: 'Slack', short_name: 'Slack', description: 'Send messages, create canvases, and fetch workspace context.', category: 'Communication', icon_label: 'S', icon_tone: 'slack', verified: true, featured: false,
    connection_mode: 'mcp_registry', registry_name: 'Slack', default_access_level: 'requires_approval',
    supported_actions: ['Search messages', 'Draft updates', 'Post with approval'], keywords: ['slack', 'chat', 'messages', 'channels', 'alerts'], recommended_employee_ids: ['sarah', 'alex', 'mike', 'emma', 'iris'], setup_copy: 'Connect Slack and require approval before external or broad channel messages.'
  },
  {
    id: 'hubspot', name: 'HubSpot', short_name: 'HubSpot', description: 'Keep customer and pipeline context available to the revenue team.', category: 'CRM & Sales', icon_label: 'H', icon_tone: 'hubspot', verified: true, featured: false,
    connection_mode: 'mcp_registry', registry_name: 'HubSpot', default_access_level: 'requires_approval',
    supported_actions: ['Search contacts', 'Review deals', 'Draft follow-ups'], keywords: ['hubspot', 'crm', 'sales', 'leads', 'pipeline'], recommended_employee_ids: ['olivia', 'emma', 'maya'], setup_copy: 'Connect HubSpot with read-first grants. Contact updates and outreach stay reviewable.'
  },
  {
    id: 'linear', name: 'Linear', short_name: 'Linear', description: 'Coordinate issues, cycles, projects, and technical handoffs.', category: 'Project Management', icon_label: 'L', icon_tone: 'linear', verified: true, featured: false,
    connection_mode: 'mcp_registry', registry_name: 'Linear', default_access_level: 'requires_approval',
    supported_actions: ['Search issues', 'Plan cycles', 'Draft issue updates'], keywords: ['linear', 'issues', 'cycles', 'roadmap', 'engineering'], recommended_employee_ids: ['mike', 'alex', 'sarah'], setup_copy: 'Connect Linear and let Mike or Alex prepare updates before changes are made.'
  },
  {
    id: 'monday', name: 'monday.com', short_name: 'monday', description: 'Coordinate projects, owners, timelines, and operational follow-up.', category: 'Project Management', icon_label: 'M', icon_tone: 'monday', verified: true, featured: false,
    connection_mode: 'mcp_registry', registry_name: 'monday.com', default_access_level: 'requires_approval',
    supported_actions: ['Read boards', 'Draft updates', 'Update approved items'], keywords: ['monday', 'boards', 'projects', 'tasks', 'operations'], recommended_employee_ids: ['alex', 'sarah', 'emma'], setup_copy: 'Connect the workspace and use approval-gated updates for shared boards.'
  },
  {
    id: 'github', name: 'GitHub', short_name: 'GitHub', description: 'Read repositories, issues, pull requests, and approved code changes.', category: 'Development', icon_label: 'GH', icon_tone: 'github', verified: true, featured: true,
    connection_mode: 'mcp_registry', registry_name: 'GitHub', default_access_level: 'requires_approval',
    supported_actions: ['Read repositories', 'Review issues and PRs', 'Create approved changes'], keywords: ['github', 'git', 'repository', 'pull request', 'code', 'ci'], recommended_employee_ids: ['mike', 'iris'], setup_copy: 'Connect GitHub with repository-level access. Write actions remain approval-gated unless explicitly enabled.'
  },
  {
    id: 'google-sheets', name: 'Google Sheets', short_name: 'Sheets', description: 'Read and update operational spreadsheets with traceable evidence.', category: 'Finance', icon_label: 'S', icon_tone: 'sheets', verified: true, featured: false,
    connection_mode: 'google_oauth', connection_type: 'google_sheets', default_access_level: 'requires_approval',
    supported_actions: ['Read ranges', 'Prepare updates', 'Write approved changes'], keywords: ['google', 'sheets', 'spreadsheet', 'finance', 'data'], recommended_employee_ids: ['david', 'olivia', 'maya', 'priya'], setup_copy: 'Connect Sheets and assign access to the employee who owns the workflow.'
  },
  {
    id: 'custom-mcp', name: 'Custom MCP server', short_name: 'Custom', description: 'Connect a private or proprietary MCP endpoint your business controls.', category: 'Development', icon_label: 'MCP', icon_tone: 'custom', verified: false, featured: false,
    connection_mode: 'api_key', default_access_level: 'requires_approval',
    supported_actions: ['Discover tools', 'Grant read access', 'Approve write actions'], keywords: ['custom', 'mcp', 'private', 'proprietary', 'internal'], recommended_employee_ids: [], setup_copy: 'Use an HTTPS MCP endpoint, configure authentication, and review discovered tools before granting access.'
  }
];

export function getConnectorDirectoryEntry(id: string): ConnectorDirectoryEntry | undefined {
  return CONNECTOR_DIRECTORY.find((entry) => entry.id === id);
}

export function searchConnectorDirectory(query = '', category = ''): ConnectorDirectoryEntry[] {
  const normalizedQuery = query.trim().toLowerCase();
  const normalizedCategory = category.trim().toLowerCase();
  return CONNECTOR_DIRECTORY.filter((entry) => {
    const categoryMatches = !normalizedCategory || entry.category.toLowerCase() === normalizedCategory;
    if (!categoryMatches) return false;
    if (!normalizedQuery) return true;
    const haystack = [entry.name, entry.short_name, entry.description, entry.category, ...entry.keywords].join(' ').toLowerCase();
    return haystack.includes(normalizedQuery);
  });
}

export function connectorDirectoryPublicView(entry: ConnectorDirectoryEntry) {
  return {
    id: entry.id,
    name: entry.name,
    short_name: entry.short_name,
    description: entry.description,
    category: entry.category,
    icon_label: entry.icon_label,
    icon_tone: entry.icon_tone,
    verified: entry.verified,
    featured: entry.featured,
    connection_mode: entry.connection_mode,
    connection_type: entry.connection_type,
    registry_name: entry.registry_name,
    default_access_level: entry.default_access_level,
    supported_actions: entry.supported_actions,
    keywords: entry.keywords,
    recommended_employee_ids: entry.recommended_employee_ids,
    setup_copy: entry.setup_copy
  };
}

export const CONNECTOR_DIRECTORY_CATEGORIES = Array.from(new Set(CONNECTOR_DIRECTORY.map((entry) => entry.category)));
// Keep this count derived from the curated catalog; never copy a marketplace or screenshot total into the product UI.
export const CONNECTOR_DIRECTORY_COUNT = CONNECTOR_DIRECTORY.length;
