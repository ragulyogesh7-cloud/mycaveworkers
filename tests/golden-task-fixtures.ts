export type GoldenTaskCase = {
  id: string;
  prompt: string;
  expected_employee: string;
  expected_name: string;
  category: string;
};

export const GOLDEN_TASK_CASES: GoldenTaskCase[] = [
  { id: 'sarah-onboarding', prompt: 'Sarah, coordinate the onboarding plan for our new operations hire and assign owners.', expected_employee: 'sarah', expected_name: 'Sarah', category: 'people_operations' },
  { id: 'sarah-policy', prompt: 'Sarah, prepare a concise employee policy update for the management team.', expected_employee: 'sarah', expected_name: 'Sarah', category: 'people_operations' },
  { id: 'david-analysis', prompt: 'David, analyze this month’s sales data and summarize the three largest drivers.', expected_employee: 'david', expected_name: 'David', category: 'analytics' },
  { id: 'david-dashboard', prompt: 'David, build a KPI comparison from the quarterly spreadsheet and flag anomalies.', expected_employee: 'david', expected_name: 'David', category: 'analytics' },
  { id: 'alex-operations', prompt: 'Alex, create an operations handoff with owners, deadlines, and escalation paths.', expected_employee: 'alex', expected_name: 'Alex', category: 'operations' },
  { id: 'alex-process', prompt: 'Alex, turn our recurring service process into a practical SOP.', expected_employee: 'alex', expected_name: 'Alex', category: 'operations' },
  { id: 'mike-engineering', prompt: 'Mike, inspect the GitHub deployment incident and prepare an engineering response plan.', expected_employee: 'mike', expected_name: 'Mike', category: 'engineering' },
  { id: 'mike-release', prompt: 'Mike, review the release checklist and identify the highest-risk technical gaps.', expected_employee: 'mike', expected_name: 'Mike', category: 'engineering' },
  { id: 'emma-success', prompt: 'Emma, draft a customer success follow-up for an account at risk of churn.', expected_employee: 'emma', expected_name: 'Emma', category: 'customer_success' },
  { id: 'emma-support', prompt: 'Emma, organize the customer feedback into themes and propose next actions.', expected_employee: 'emma', expected_name: 'Emma', category: 'customer_success' },
  { id: 'arav-hr', prompt: 'Arav, prepare an employee engagement pulse survey and a follow-up plan.', expected_employee: 'arav', expected_name: 'Arav', category: 'people_operations' },
  { id: 'arav-recruiting', prompt: 'Arav, create a structured interview scorecard for our next hiring round.', expected_employee: 'arav', expected_name: 'Arav', category: 'recruiting' },
  { id: 'olivia-sales', prompt: 'Olivia, qualify this sales pipeline and recommend the next action for each opportunity.', expected_employee: 'olivia', expected_name: 'Olivia', category: 'sales' },
  { id: 'olivia-proposal', prompt: 'Olivia, draft a proposal outline for a high-intent enterprise prospect.', expected_employee: 'olivia', expected_name: 'Olivia', category: 'sales' },
  { id: 'maya-marketing', prompt: 'Maya, design a two-week growth campaign with channels, messages, and success metrics.', expected_employee: 'maya', expected_name: 'Maya', category: 'marketing' },
  { id: 'maya-content', prompt: 'Maya, turn the product launch notes into a content distribution plan.', expected_employee: 'maya', expected_name: 'Maya', category: 'marketing' },
  { id: 'priya-finance', prompt: 'Priya, reconcile the monthly expense report and identify unusual variances.', expected_employee: 'priya', expected_name: 'Priya', category: 'finance' },
  { id: 'priya-budget', prompt: 'Priya, prepare a cash-flow forecast and call out the main assumptions.', expected_employee: 'priya', expected_name: 'Priya', category: 'finance' },
  { id: 'iris-security', prompt: 'Iris, review our access-control posture and produce a prioritized security checklist.', expected_employee: 'iris', expected_name: 'Iris', category: 'security' },
  { id: 'iris-incident', prompt: 'Iris, investigate the suspicious login pattern and outline a containment plan.', expected_employee: 'iris', expected_name: 'Iris', category: 'security' }
];
