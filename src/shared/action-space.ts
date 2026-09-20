import { GOAL_DONE_RULES, NEXT_ACTION_RULES, STUCK_RULES, TARGET_RULES } from './prompts';
import {
  JevQuestions,
  JevRequest,
  ObservedElement,
  PageAction,
  PageSnapshot,
  RecentAction,
  RunProgressState,
} from './types';

export interface LoopContext {
  warning?: string;
  suppressedTargetIds?: string[];
}

export interface ActionSpaceResult {
  elements: ObservedElement[];
  targets: Record<string, Record<string, PageAction>>;
  controls: Record<string, PageAction>;
  operations: Record<string, string>;
  questions: JevQuestions;
}

const OP_BY_KIND: Record<string, string> = {
  click: 'CLICK',
  fill: 'TYPE_TEXT',
  select: 'SELECT',
};

const OP_LABELS: Record<string, string> = {
  CLICK: 'Click an element, button, menu option, autocomplete suggestion, or calendar day.',
  TYPE_TEXT:
    'Enter or replace text in an editable field. A small LLM will supply the value from the goal.',
  SELECT: 'Select an observed dropdown value.',
};

/**
 * One index per observed element; each operation has its own valid target choices.
 * Controls (scroll/wait) come from the snapshot, so a scroll that cannot move is never offered.
 */
export function buildActionSpace(
  actions: PageAction[],
  goal: string,
  loopContext?: LoopContext
): ActionSpaceResult {
  const elements: ObservedElement[] = [];
  const targets: Record<string, Record<string, PageAction>> = {};
  const controls: Record<string, PageAction> = {};
  const indices: Record<number, string> = {};

  for (const action of actions) {
    const operation = OP_BY_KIND[action.kind];
    if (!operation) {
      controls[action.id.toUpperCase()] = action;
      continue;
    }
    const node = action.node;
    if (node === undefined) continue;

    if (!(node in indices)) {
      const index = String(elements.length + 1);
      indices[node] = index;

      const element: ObservedElement = {
        index,
        label: action.label.split(' → ')[0],
        operations: [],
      };
      if (action.role) element.role = action.role;
      if (action.href) element.href = action.href;
      if (action.section) element.section = action.section;
      if (action.value) element.value = action.value;
      if (action.checked !== undefined) element.checked = action.checked;
      if (action.selected !== undefined) element.selected = action.selected;
      if (action.expanded !== undefined) element.expanded = action.expanded;
      if (action.kind === 'select') {
        element.value = action.current_value || '';
        element.options = [];
      }
      elements.push(element);
    }

    const index = indices[node];
    const group = (targets[operation] = targets[operation] || {});
    const element = elements[parseInt(index, 10) - 1];
    if (!element.operations.includes(operation)) {
      element.operations.push(operation);
    }

    let targetKey = index;
    if (action.kind === 'select') {
      element.options = element.options || [];
      targetKey = `${index}:${element.options.length + 1}`;
      element.options.push({ index: targetKey, label: action.label, value: action.value || '' });
    }
    group[targetKey] = action;
  }

  // Drop targets that repeatedly produced no change, as long as alternatives remain.
  const suppressed = new Set(loopContext?.suppressedTargetIds || []);
  if (suppressed.size > 0) {
    for (const group of Object.values(targets)) {
      const keys = Object.keys(group);
      if (keys.some((k) => !suppressed.has(group[k].id))) {
        for (const k of keys) {
          if (suppressed.has(group[k].id)) delete group[k];
        }
      }
    }
  }

  const operations: Record<string, string> = {};
  for (const key of Object.keys(targets)) operations[key] = OP_LABELS[key];
  for (const [key, value] of Object.entries(controls)) operations[key] = value.label;
  operations.DONE = 'Every requirement is visibly satisfied.';
  operations.BLOCKED = 'No supported operation can progress.';

  const instructions: Record<string, any> = { goal, rules: NEXT_ACTION_RULES };
  if (loopContext?.warning) instructions.ineffective_action_alert = loopContext.warning;

  const questions: JevQuestions = {
    operation: { type: 'choice', criteria: operations, instructions },
    goal_done: { type: 'noul', instructions: GOAL_DONE_RULES },
    stuck: { type: 'noul', instructions: STUCK_RULES },
  };

  for (const [operation, candidates] of Object.entries(targets)) {
    const criteria: Record<string, any> = {};
    for (const [idx, a] of Object.entries(candidates)) {
      criteria[idx] = {
        element: `[${idx}] ${a.label}`,
        current_value: a.current_value || a.value || '',
        ...(a.role ? { role: a.role } : {}),
        ...(a.href ? { href: a.href } : {}),
        ...(a.section ? { section: a.section } : {}),
        ...(a.checked ? { checked: a.checked } : {}),
        ...(a.selected ? { selected: a.selected } : {}),
        ...(a.expanded ? { expanded: a.expanded } : {}),
      };
    }
    questions[`${operation.toLowerCase()}_target`] = {
      type: 'choice',
      criteria,
      instructions: {
        goal,
        operation,
        rules: [NEXT_ACTION_RULES, TARGET_RULES],
        ...(loopContext?.warning ? { notice: loopContext.warning } : {}),
      },
    };
  }

  return { elements, targets, controls, operations, questions };
}

export function buildJevRequest(
  model: string,
  snapshot: PageSnapshot,
  goal: string,
  history: RecentAction[],
  loopContext?: LoopContext,
  run?: RunProgressState
): { request: JevRequest; actionSpace: ActionSpaceResult } {
  const actionSpace = buildActionSpace(snapshot.actions, goal, loopContext);

  const request: JevRequest = {
    model,
    state: {
      task: goal,
      page: {
        url: snapshot.url,
        title: snapshot.title,
        text: snapshot.text.slice(0, 6000),
      },
      elements: actionSpace.elements,
      recent_actions: history.slice(-10).map((h) => ({
        step: h.step,
        action: h.action,
        kind: h.kind,
        text: h.text,
        outcome: h.outcome ?? (h.page_changed === undefined ? 'pending' : h.page_changed ? 'page changed' : 'no visible change'),
        url: h.url,
        page_changed: h.page_changed ?? false,
      })),
      ...(run ? { run } : {}),
    },
    questions: actionSpace.questions,
  };

  return { request, actionSpace };
}

export { validateChoiceAnswer, ROUNDING_TOLERANCE } from 'jev-dev-kit';
export type { JevChoiceAnswer as ValidatedChoice } from 'jev-dev-kit';
