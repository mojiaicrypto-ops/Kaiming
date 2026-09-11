/**
 * Migration 0001 — the complete per-Project schema.
 *
 * Source of truth: `docs/architecture/data.md` §2 (business fields) and §1 (types,
 * bounded arrays, per-project settings). The DDL repeats the documented
 * constraints instead of trusting application code: enum CHECKs, non-negative
 * numbers, `json_valid` on every JSON column, bounded arrays via
 * `json_array_length`, uniqueness for `message(conversation_id,seq)`,
 * `attempt(run_id,number)`, `command(operation,key)`, `lease(resource)` and
 * `feature_projection(revision,feature_id)`.
 *
 * `project_id` is present on every mutable row and its foreign key can only ever
 * point inside this database; "外键禁止跨项目" (`data.md` §1) therefore holds by
 * construction because one file holds exactly one project.
 */

/** Tables in creation order; `schema_migrations` is managed by the runner. */
export const SCHEMA_TABLES = [
  'project',
  'conversation',
  'message_body',
  'user_action',
  'message',
  'work',
  'requirement',
  'task',
  'assessment',
  'authorization',
  'decision',
  'discovery',
  'finding',
  'run',
  'attempt',
  'snapshot',
  'stage_result',
  'grant',
  'budget',
  'command',
  'event',
  'outbox',
  'tool_operation',
  'lease',
  'operation',
  'feature_projection',
  'attachment',
  'artifact',
] as const;
export type SchemaTable = (typeof SCHEMA_TABLES)[number];

/** Tables that reject UPDATE and DELETE; their rows are immutable facts. */
export const IMMUTABLE_TABLES = ['event', 'snapshot', 'user_action'] as const;

/** Shared column definitions for the five mutable-row columns (`data.md` §2). */
const ENTITY_COLUMNS = `
  id TEXT PRIMARY KEY NOT NULL CHECK (length(id) = 36),
  project_id TEXT NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  version INTEGER NOT NULL CHECK (version > 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL`;

const JSON_ARRAY_LIMIT = 'json_array_length({column}) <= 1000';

export const CORE_SCHEMA_SQL = `
CREATE TABLE project (
  id TEXT PRIMARY KEY NOT NULL CHECK (length(id) = 36),
  version INTEGER NOT NULL CHECK (version > 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  root TEXT NOT NULL UNIQUE,
  git_root TEXT,
  code_root TEXT NOT NULL,
  document_root TEXT NOT NULL,
  delivery_branch TEXT NOT NULL,
  trust TEXT NOT NULL CHECK (trust IN ('untrusted','trusted')),
  state TEXT NOT NULL CHECK (state IN ('open','closed')),
  head TEXT
);

CREATE TABLE conversation (${ENTITY_COLUMNS},
  title TEXT NOT NULL CHECK (length(title) > 0),
  focus_work_id TEXT,
  archived INTEGER NOT NULL CHECK (archived IN (0,1))
);

CREATE TABLE message_body (${ENTITY_COLUMNS},
  owner_kind TEXT NOT NULL CHECK (owner_kind IN ('user','agent','system')),
  owner_user_id TEXT,
  producer_run_id TEXT,
  mime TEXT NOT NULL CHECK (mime IN ('text/plain','text/markdown')),
  content_hash TEXT NOT NULL CHECK (length(content_hash) = 64),
  relative_blob_path TEXT NOT NULL CHECK (length(relative_blob_path) > 0),
  bytes INTEGER NOT NULL CHECK (bytes >= 0),
  CHECK (owner_kind <> 'user' OR owner_user_id IS NOT NULL),
  CHECK (owner_kind <> 'agent' OR producer_run_id IS NOT NULL),
  CHECK (owner_kind <> 'system' OR producer_run_id IS NULL)
);

CREATE TABLE user_action (${ENTITY_COLUMNS},
  actor_id TEXT NOT NULL,
  action TEXT NOT NULL CHECK (length(action) > 0),
  target_id TEXT,
  payload TEXT NOT NULL CHECK (json_valid(payload)),
  payload_hash TEXT NOT NULL CHECK (length(payload_hash) = 64)
);

CREATE TABLE message (${ENTITY_COLUMNS},
  conversation_id TEXT NOT NULL REFERENCES conversation(id),
  seq INTEGER NOT NULL CHECK (seq > 0),
  sender TEXT NOT NULL CHECK (sender IN ('user','chief','role','system')),
  role TEXT CHECK (role IS NULL OR role IN ('chief','product','planning','backend','frontend','review','test','settlement')),
  body_ref TEXT NOT NULL REFERENCES message_body(id),
  target_work_id TEXT,
  target_role TEXT CHECK (target_role IS NULL OR target_role IN ('chief','product','planning','backend','frontend','review','test','settlement')),
  state TEXT NOT NULL CHECK (state IN ('received','processing','processed','decision_required','failed')),
  result_refs TEXT NOT NULL CHECK (json_valid(result_refs) AND ${JSON_ARRAY_LIMIT.replace('{column}', 'result_refs')}),
  UNIQUE (conversation_id, seq)
);

CREATE TABLE requirement (${ENTITY_COLUMNS},
  work_id TEXT,
  title TEXT NOT NULL CHECK (length(title) > 0),
  goal TEXT NOT NULL CHECK (length(goal) > 0),
  lifecycle TEXT NOT NULL CHECK (lifecycle IN ('queued','active','completed','cancelled','archived')),
  previous_lifecycle TEXT CHECK (previous_lifecycle IS NULL OR previous_lifecycle IN ('queued','completed')),
  phase TEXT CHECK (phase IS NULL OR phase IN ('product','plan','execute','accept','settle')),
  product_ref TEXT CHECK (product_ref IS NULL OR json_valid(product_ref)),
  plan_ref TEXT CHECK (plan_ref IS NULL OR json_valid(plan_ref)),
  source_ref TEXT NOT NULL CHECK (json_valid(source_ref)),
  final_manifest_id TEXT,
  record_version INTEGER NOT NULL CHECK (record_version > 0),
  portable_ref TEXT NOT NULL CHECK (json_valid(portable_ref)),
  execution_availability TEXT NOT NULL CHECK (execution_availability IN ('local','needs_replan')),
  evidence_availability TEXT NOT NULL CHECK (evidence_availability IN ('full','summary_only'))
);

CREATE TABLE budget (${ENTITY_COLUMNS},
  work_id TEXT NOT NULL,
  token_limit INTEGER NOT NULL CHECK (token_limit >= 0),
  tokens_used INTEGER NOT NULL CHECK (tokens_used >= 0),
  tokens_reserved INTEGER NOT NULL CHECK (tokens_reserved >= 0),
  active_time_limit INTEGER NOT NULL CHECK (active_time_limit >= 0),
  active_time_used INTEGER NOT NULL CHECK (active_time_used >= 0),
  repair_limit INTEGER NOT NULL CHECK (repair_limit >= 0),
  repair_used INTEGER NOT NULL CHECK (repair_used >= 0),
  cost_known INTEGER NOT NULL CHECK (cost_known IN (0,1)),
  cost REAL CHECK (cost IS NULL OR cost >= 0),
  CHECK (tokens_used + tokens_reserved <= token_limit),
  CHECK (repair_used <= repair_limit)
);

CREATE TABLE work (${ENTITY_COLUMNS},
  intent TEXT NOT NULL CHECK (intent IN ('assist','artifact','document','delivery','operation')),
  purpose TEXT NOT NULL CHECK (length(purpose) > 0),
  level TEXT NOT NULL CHECK (level IN ('none','L1','L2','L3')),
  goal TEXT NOT NULL CHECK (length(goal) > 0),
  scope TEXT NOT NULL CHECK (json_valid(scope)),
  source_message_id TEXT,
  source_ref TEXT NOT NULL CHECK (json_valid(source_ref)),
  authorization_ref TEXT,
  requirement_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('queued','running','completed','blocked','paused','cancelling','cancelled','failed')),
  blocker_ids TEXT NOT NULL CHECK (json_valid(blocker_ids) AND ${JSON_ARRAY_LIMIT.replace('{column}', 'blocker_ids')}),
  base_revision TEXT,
  budget_id TEXT NOT NULL REFERENCES budget(id) DEFERRABLE INITIALLY DEFERRED,
  policy_revision INTEGER NOT NULL CHECK (policy_revision >= 0)
);

CREATE TABLE task (${ENTITY_COLUMNS},
  work_id TEXT NOT NULL REFERENCES work(id),
  requirement_id TEXT,
  plan_ref TEXT NOT NULL CHECK (json_valid(plan_ref)),
  role TEXT NOT NULL CHECK (role IN ('chief','product','planning','backend','frontend','review','test','settlement')),
  depends_on TEXT NOT NULL CHECK (json_valid(depends_on) AND ${JSON_ARRAY_LIMIT.replace('{column}', 'depends_on')}),
  dependency_revision TEXT,
  dependency_manifest_refs TEXT NOT NULL CHECK (json_valid(dependency_manifest_refs) AND ${JSON_ARRAY_LIMIT.replace('{column}', 'dependency_manifest_refs')}),
  scope TEXT NOT NULL CHECK (json_valid(scope)),
  stage TEXT NOT NULL CHECK (stage IN ('ready','develop','review','test','done')),
  acceptance_ids TEXT NOT NULL CHECK (json_valid(acceptance_ids) AND ${JSON_ARRAY_LIMIT.replace('{column}', 'acceptance_ids')}),
  worktree_id TEXT,
  latest_manifest_id TEXT
);

CREATE TABLE assessment (${ENTITY_COLUMNS},
  work_id TEXT NOT NULL REFERENCES work(id),
  intent TEXT NOT NULL CHECK (intent IN ('assist','artifact','document','delivery','operation')),
  level TEXT NOT NULL CHECK (level IN ('none','L1','L2','L3')),
  semantic_impact INTEGER NOT NULL CHECK (semantic_impact IN (0,1)),
  risk_flags TEXT NOT NULL CHECK (json_valid(risk_flags) AND ${JSON_ARRAY_LIMIT.replace('{column}', 'risk_flags')}),
  uncertainties TEXT NOT NULL CHECK (json_valid(uncertainties) AND ${JSON_ARRAY_LIMIT.replace('{column}', 'uncertainties')}),
  authorization_ref TEXT,
  policy_revision INTEGER NOT NULL CHECK (policy_revision >= 0),
  reason TEXT NOT NULL CHECK (length(reason) > 0)
);

CREATE TABLE authorization (${ENTITY_COLUMNS},
  source_ref TEXT NOT NULL CHECK (json_valid(source_ref)),
  work_id TEXT NOT NULL REFERENCES work(id),
  goal TEXT NOT NULL CHECK (length(goal) > 0),
  scope TEXT NOT NULL CHECK (json_valid(scope)),
  operations TEXT NOT NULL CHECK (json_valid(operations) AND ${JSON_ARRAY_LIMIT.replace('{column}', 'operations')}),
  accepted_at TEXT NOT NULL,
  revoked_at TEXT
);

CREATE TABLE decision (${ENTITY_COLUMNS},
  work_id TEXT NOT NULL REFERENCES work(id),
  kind TEXT NOT NULL CHECK (kind IN ('product','start','permission','risk','budget','recovery')),
  target_ref TEXT NOT NULL CHECK (json_valid(target_ref)),
  choices TEXT NOT NULL CHECK (json_valid(choices) AND ${JSON_ARRAY_LIMIT.replace('{column}', 'choices')}),
  state TEXT NOT NULL CHECK (state IN ('pending','accepted','rejected','expired')),
  choice TEXT,
  source_message_id TEXT,
  actor TEXT NOT NULL CHECK (actor = 'user'),
  effect_refs TEXT NOT NULL CHECK (json_valid(effect_refs) AND ${JSON_ARRAY_LIMIT.replace('{column}', 'effect_refs')})
);

CREATE TABLE discovery (${ENTITY_COLUMNS},
  work_id TEXT NOT NULL REFERENCES work(id),
  task_id TEXT REFERENCES task(id),
  kind TEXT NOT NULL CHECK (kind IN ('defect','technical_correction','product_change','followup','blocking_risk')),
  evidence_refs TEXT NOT NULL CHECK (json_valid(evidence_refs) AND ${JSON_ARRAY_LIMIT.replace('{column}', 'evidence_refs')}),
  impact_flags TEXT NOT NULL CHECK (json_valid(impact_flags) AND ${JSON_ARRAY_LIMIT.replace('{column}', 'impact_flags')}),
  route TEXT NOT NULL CHECK (length(route) > 0),
  state TEXT NOT NULL CHECK (state IN ('open','routed','resolved')),
  decision_id TEXT REFERENCES decision(id)
);

CREATE TABLE finding (${ENTITY_COLUMNS},
  work_id TEXT NOT NULL REFERENCES work(id),
  task_id TEXT REFERENCES task(id),
  review_run_id TEXT NOT NULL,
  manifest_id TEXT NOT NULL,
  target_kind TEXT NOT NULL CHECK (target_kind IN ('task','integration','document')),
  target_ref TEXT NOT NULL CHECK (json_valid(target_ref)),
  severity TEXT NOT NULL CHECK (severity IN ('P0','P1','P2','P3')),
  blocking INTEGER NOT NULL CHECK (blocking IN (0,1)),
  path TEXT,
  line INTEGER CHECK (line IS NULL OR line > 0),
  evidence_refs TEXT NOT NULL CHECK (json_valid(evidence_refs) AND ${JSON_ARRAY_LIMIT.replace('{column}', 'evidence_refs')}),
  description TEXT NOT NULL CHECK (length(description) > 0),
  state TEXT NOT NULL CHECK (state IN ('open','addressed','verified','accepted_risk')),
  resolution_ref TEXT,
  CHECK (target_kind <> 'task' OR task_id IS NOT NULL)
);

CREATE TABLE run (${ENTITY_COLUMNS},
  work_id TEXT NOT NULL REFERENCES work(id),
  task_id TEXT REFERENCES task(id),
  role TEXT NOT NULL CHECK (role IN ('chief','product','planning','backend','frontend','review','test','settlement')),
  purpose TEXT NOT NULL CHECK (purpose IN ('analysis','artifact','implementation','review','test','settlement','initialize','document','document_check','operation')),
  parent_run_id TEXT REFERENCES run(id),
  stage TEXT NOT NULL CHECK (length(stage) > 0),
  status TEXT NOT NULL CHECK (status IN ('queued','starting','running','waiting_permission','waiting_children','paused','interrupted','recovery_required','completed','failed','cancelled','timed_out','contract_violation')),
  required_child INTEGER NOT NULL CHECK (required_child IN (0,1)),
  join_policy TEXT NOT NULL CHECK (join_policy IN ('none','all')),
  child_ids TEXT NOT NULL CHECK (json_valid(child_ids) AND ${JSON_ARRAY_LIMIT.replace('{column}', 'child_ids')}),
  config_snapshot_id TEXT NOT NULL,
  context_snapshot_id TEXT NOT NULL,
  dispatch_snapshot_id TEXT NOT NULL,
  budget_allocation INTEGER NOT NULL CHECK (budget_allocation >= 0)
);

CREATE TABLE attempt (${ENTITY_COLUMNS},
  run_id TEXT NOT NULL REFERENCES run(id),
  number INTEGER NOT NULL CHECK (number > 0),
  status TEXT NOT NULL CHECK (status IN ('starting','running','stopped','completed','failed','lost')),
  owner_epoch INTEGER NOT NULL CHECK (owner_epoch >= 0),
  runner_id TEXT,
  heartbeat_at TEXT,
  session_ref TEXT CHECK (session_ref IS NULL OR json_valid(session_ref)),
  checkpoint_ref TEXT,
  manifest_id TEXT,
  UNIQUE (run_id, number)
);

CREATE TABLE snapshot (
  type TEXT NOT NULL CHECK (type IN ('context','config','verification','checkpoint','dispatch')),
  hash TEXT NOT NULL CHECK (length(hash) = 64),
  payload TEXT NOT NULL CHECK (json_valid(payload)),
  blob_path TEXT NOT NULL CHECK (length(blob_path) > 0),
  created_at TEXT NOT NULL,
  PRIMARY KEY (type, hash)
);

CREATE TABLE stage_result (${ENTITY_COLUMNS},
  task_id TEXT REFERENCES task(id),
  run_id TEXT NOT NULL REFERENCES run(id),
  attempt_id TEXT NOT NULL REFERENCES attempt(id),
  manifest_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('success','needs_input','failed')),
  summary TEXT NOT NULL CHECK (length(summary) > 0),
  artifact_refs TEXT NOT NULL CHECK (json_valid(artifact_refs) AND ${JSON_ARRAY_LIMIT.replace('{column}', 'artifact_refs')}),
  evidence_refs TEXT NOT NULL CHECK (json_valid(evidence_refs) AND ${JSON_ARRAY_LIMIT.replace('{column}', 'evidence_refs')}),
  changed_paths TEXT NOT NULL CHECK (json_valid(changed_paths) AND ${JSON_ARRAY_LIMIT.replace('{column}', 'changed_paths')}),
  finding_ids TEXT NOT NULL CHECK (json_valid(finding_ids) AND ${JSON_ARRAY_LIMIT.replace('{column}', 'finding_ids')}),
  unknowns TEXT NOT NULL CHECK (json_valid(unknowns) AND ${JSON_ARRAY_LIMIT.replace('{column}', 'unknowns')}),
  requested_actions TEXT NOT NULL CHECK (json_valid(requested_actions) AND ${JSON_ARRAY_LIMIT.replace('{column}', 'requested_actions')}),
  read_ledger_seq INTEGER NOT NULL CHECK (read_ledger_seq >= 0),
  read_ledger_hash TEXT NOT NULL CHECK (length(read_ledger_hash) = 64),
  check_result TEXT CHECK (check_result IS NULL OR json_valid(check_result))
);

CREATE TABLE grant (${ENTITY_COLUMNS},
  work_id TEXT REFERENCES work(id),
  run_id TEXT REFERENCES run(id),
  tool_operation_id TEXT,
  scope TEXT NOT NULL CHECK (scope IN ('once','run','work','project')),
  role TEXT NOT NULL CHECK (role IN ('chief','product','planning','backend','frontend','review','test','settlement')),
  stage TEXT NOT NULL CHECK (length(stage) > 0),
  operation TEXT NOT NULL CHECK (length(operation) > 0),
  targets TEXT NOT NULL CHECK (json_valid(targets) AND ${JSON_ARRAY_LIMIT.replace('{column}', 'targets')}),
  expires_at TEXT NOT NULL,
  limits TEXT NOT NULL CHECK (json_valid(limits)),
  decision_id TEXT NOT NULL REFERENCES decision(id),
  consumed_at TEXT,
  consumed_by_operation_id TEXT,
  input_hash TEXT CHECK (input_hash IS NULL OR length(input_hash) = 64),
  CHECK (scope <> 'once' OR (run_id IS NOT NULL AND tool_operation_id IS NOT NULL AND input_hash IS NOT NULL)),
  CHECK (scope <> 'run' OR run_id IS NOT NULL),
  CHECK (scope <> 'work' OR work_id IS NOT NULL)
);

CREATE TABLE command (${ENTITY_COLUMNS},
  subject TEXT NOT NULL CHECK (length(subject) > 0),
  operation TEXT NOT NULL CHECK (length(operation) > 0),
  key TEXT NOT NULL CHECK (length(key) BETWEEN 1 AND 128),
  payload_hash TEXT NOT NULL CHECK (length(payload_hash) = 64),
  state TEXT NOT NULL CHECK (state IN ('accepted','completed','rejected')),
  response TEXT NOT NULL CHECK (json_valid(response)),
  UNIQUE (operation, key)
);

CREATE TABLE event (
  cursor INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id TEXT NOT NULL,
  event_id TEXT NOT NULL CHECK (length(event_id) = 36),
  name TEXT NOT NULL CHECK (length(name) > 0),
  entity_id TEXT NOT NULL,
  entity_version INTEGER NOT NULL CHECK (entity_version >= 0),
  data TEXT NOT NULL CHECK (json_valid(data)),
  occurred_at TEXT NOT NULL
);

CREATE TABLE outbox (${ENTITY_COLUMNS},
  operation_id TEXT NOT NULL UNIQUE CHECK (length(operation_id) = 36),
  kind TEXT NOT NULL CHECK (length(kind) > 0),
  payload TEXT NOT NULL CHECK (json_valid(payload)),
  state TEXT NOT NULL CHECK (state IN ('pending','claimed','done')),
  attempts INTEGER NOT NULL CHECK (attempts >= 0),
  lease_until TEXT
);

CREATE TABLE tool_operation (${ENTITY_COLUMNS},
  work_id TEXT NOT NULL REFERENCES work(id),
  run_id TEXT NOT NULL REFERENCES run(id),
  attempt_id TEXT NOT NULL REFERENCES attempt(id),
  epoch INTEGER NOT NULL CHECK (epoch >= 0),
  tool_name TEXT NOT NULL CHECK (length(tool_name) > 0),
  input_hash TEXT NOT NULL CHECK (length(input_hash) = 64),
  args_ref TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('prepared','started','finished','unknown')),
  grant_id TEXT REFERENCES grant(id),
  result_ref TEXT,
  started_at TEXT,
  finished_at TEXT
);

CREATE TABLE lease (${ENTITY_COLUMNS},
  resource TEXT NOT NULL UNIQUE CHECK (length(resource) > 0),
  owner_attempt_id TEXT NOT NULL,
  epoch INTEGER NOT NULL CHECK (epoch >= 0),
  expires_at TEXT NOT NULL
);

CREATE TABLE operation (${ENTITY_COLUMNS},
  work_id TEXT REFERENCES work(id),
  requirement_id TEXT REFERENCES requirement(id),
  source_ref TEXT NOT NULL CHECK (json_valid(source_ref)),
  kind TEXT NOT NULL CHECK (kind IN ('initialize','integrate','settle','recover','backup','requirement_save','requirement_import')),
  state TEXT NOT NULL CHECK (length(state) > 0),
  expected_head TEXT,
  candidate_revision TEXT,
  step_results TEXT NOT NULL CHECK (json_valid(step_results)),
  error TEXT CHECK (error IS NULL OR json_valid(error))
);

CREATE TABLE feature_projection (${ENTITY_COLUMNS},
  revision TEXT NOT NULL CHECK (length(revision) > 0),
  feature_id TEXT NOT NULL CHECK (length(feature_id) > 0),
  document_path TEXT NOT NULL CHECK (length(document_path) > 0),
  document_hash TEXT NOT NULL CHECK (length(document_hash) = 64),
  fields TEXT NOT NULL CHECK (json_valid(fields)),
  relations TEXT NOT NULL CHECK (json_valid(relations)),
  state TEXT NOT NULL CHECK (state IN ('valid','stale')),
  UNIQUE (revision, feature_id)
);

CREATE TABLE attachment (${ENTITY_COLUMNS},
  conversation_id TEXT NOT NULL REFERENCES conversation(id),
  owner_user_id TEXT NOT NULL,
  mime TEXT NOT NULL CHECK (length(mime) > 0),
  state TEXT NOT NULL CHECK (state IN ('staged','bound','expired')),
  expires_at TEXT NOT NULL,
  bound_message_id TEXT,
  work_id TEXT,
  content_hash TEXT NOT NULL CHECK (length(content_hash) = 64),
  relative_blob_path TEXT NOT NULL CHECK (length(relative_blob_path) > 0),
  bytes INTEGER NOT NULL CHECK (bytes >= 0)
);

CREATE TABLE artifact (${ENTITY_COLUMNS},
  work_id TEXT NOT NULL REFERENCES work(id),
  run_id TEXT REFERENCES run(id),
  origin TEXT NOT NULL CHECK (origin IN ('agent','user')),
  attachment_id TEXT REFERENCES attachment(id),
  kind TEXT NOT NULL CHECK (kind IN ('explanation','product','plan','diff','review','test','settlement','decision','recovery','attachment','log','evidence')),
  artifact_version INTEGER NOT NULL CHECK (artifact_version > 0),
  content_hash TEXT NOT NULL CHECK (length(content_hash) = 64),
  relative_blob_path TEXT NOT NULL CHECK (length(relative_blob_path) > 0),
  mime TEXT NOT NULL CHECK (length(mime) > 0),
  bytes INTEGER NOT NULL CHECK (bytes >= 0),
  source_revision TEXT,
  validity TEXT NOT NULL CHECK (validity IN ('valid','invalid')),
  invalid_reason TEXT,
  acl TEXT NOT NULL CHECK (json_valid(acl) AND ${JSON_ARRAY_LIMIT.replace('{column}', 'acl')}),
  CHECK (origin <> 'agent' OR run_id IS NOT NULL),
  CHECK (origin <> 'user' OR (attachment_id IS NOT NULL AND run_id IS NULL)),
  CHECK (validity <> 'invalid' OR invalid_reason IS NOT NULL)
);

CREATE INDEX idx_event_cursor ON event(cursor);
CREATE INDEX idx_message_conversation ON message(conversation_id, seq);
CREATE INDEX idx_work_status ON work(status, updated_at);
CREATE INDEX idx_run_work ON run(work_id, status);
CREATE INDEX idx_attempt_run ON attempt(run_id, number);
CREATE INDEX idx_outbox_state ON outbox(state, lease_until);
CREATE INDEX idx_tool_operation_attempt ON tool_operation(attempt_id, state);
CREATE INDEX idx_grant_scope ON grant(scope, work_id, run_id);
CREATE INDEX idx_artifact_work ON artifact(work_id, kind);
CREATE INDEX idx_attachment_state ON attachment(state, expires_at);
CREATE INDEX idx_operation_kind ON operation(kind, state);
`;

/**
 * Guards that make immutability a database property, not a convention:
 * `data.md` §2 marks events, snapshots and user actions immutable, and
 * `reliability.md` §2 requires that evidence cannot be rewritten later.
 */
export const IMMUTABILITY_SQL = IMMUTABLE_TABLES.map(
  (table) => `
CREATE TRIGGER ${table}_no_update BEFORE UPDATE ON ${table}
BEGIN
  SELECT RAISE(ABORT, '${table} rows are immutable');
END;
CREATE TRIGGER ${table}_no_delete BEFORE DELETE ON ${table}
BEGIN
  SELECT RAISE(ABORT, '${table} rows are immutable');
END;`,
).join('\n');
