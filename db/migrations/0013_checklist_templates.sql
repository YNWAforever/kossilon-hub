create table if not exists checklist_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  service_type text not null check (service_type in (
    'Annual Return — Private Ltd', 'Annual Return — Public Ltd',
    'Incorporation — HK Ltd', 'Change of Director', 'Deregistration'
  )),
  description text not null default '',
  active boolean not null default true,
  documents jsonb not null default '[]'::jsonb,
  reminders jsonb not null default '[]'::jsonb,
  risk_rules jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists checklist_templates_service_type_idx on checklist_templates (service_type) where active;

insert into checklist_templates (name, service_type, description, active, documents, reminders, risk_rules)
values
  (
    'Annual return — Private Ltd',
    'Annual Return — Private Ltd',
    'Standard checklist for a Hong Kong private limited company annual return (NAR1).',
    true,
    '[
      {"id": "doc-ar-priv-1", "label": "Signed NAR1 form", "required": true, "daysBeforeDue": 7},
      {"id": "doc-ar-priv-2", "label": "Register of members (updated)", "required": true, "daysBeforeDue": 14},
      {"id": "doc-ar-priv-3", "label": "Register of directors", "required": true, "daysBeforeDue": 14},
      {"id": "doc-ar-priv-4", "label": "Register of secretaries", "required": true, "daysBeforeDue": 14},
      {"id": "doc-ar-priv-5", "label": "Business registration certificate copy", "required": true, "daysBeforeDue": 30},
      {"id": "doc-ar-priv-6", "label": "Proof of registered office address", "required": true, "daysBeforeDue": 30},
      {"id": "doc-ar-priv-7", "label": "ID copies of all directors", "required": true, "daysBeforeDue": 30}
    ]'::jsonb,
    '[
      {"id": "rem-ar-priv-1", "label": "First reminder", "daysBeforeDue": 30, "channel": "WhatsApp"},
      {"id": "rem-ar-priv-2", "label": "Second reminder", "daysBeforeDue": 14, "channel": "WhatsApp"},
      {"id": "rem-ar-priv-3", "label": "Third reminder", "daysBeforeDue": 7, "channel": "WhatsApp"},
      {"id": "rem-ar-priv-4", "label": "Final reminder", "daysBeforeDue": 2, "channel": "WhatsApp"}
    ]'::jsonb,
    '[
      {"id": "risk-ar-priv-1", "label": "Deadline critical", "severity": "High", "trigger": "Deadline < 3 days & docs incomplete", "enabled": true},
      {"id": "risk-ar-priv-2", "label": "Client silent", "severity": "Medium", "trigger": "No client reply after 3 reminders", "enabled": true},
      {"id": "risk-ar-priv-3", "label": "Payment overdue", "severity": "Medium", "trigger": "Invoice unpaid > 14 days", "enabled": true}
    ]'::jsonb
  ),
  (
    'Annual return — Public Ltd',
    'Annual Return — Public Ltd',
    'Public company AR with auditor''s report and additional disclosures.',
    true,
    '[
      {"id": "doc-ar-pub-1", "label": "Signed NAR1 form", "required": true, "daysBeforeDue": 7},
      {"id": "doc-ar-pub-2", "label": "Audited financial statements", "required": true, "daysBeforeDue": 21},
      {"id": "doc-ar-pub-3", "label": "Auditor''s report", "required": true, "daysBeforeDue": 21},
      {"id": "doc-ar-pub-4", "label": "Register of members", "required": true, "daysBeforeDue": 14},
      {"id": "doc-ar-pub-5", "label": "Register of directors", "required": true, "daysBeforeDue": 14},
      {"id": "doc-ar-pub-6", "label": "Directors'' report", "required": true, "daysBeforeDue": 14}
    ]'::jsonb,
    '[
      {"id": "rem-ar-pub-1", "label": "First reminder", "daysBeforeDue": 45, "channel": "Email"},
      {"id": "rem-ar-pub-2", "label": "Second reminder", "daysBeforeDue": 21, "channel": "WhatsApp"},
      {"id": "rem-ar-pub-3", "label": "Final reminder", "daysBeforeDue": 7, "channel": "WhatsApp"}
    ]'::jsonb,
    '[
      {"id": "risk-ar-pub-1", "label": "Auditor delay", "severity": "High", "trigger": "Audit report outstanding < 21 days to due", "enabled": true},
      {"id": "risk-ar-pub-2", "label": "Deadline critical", "severity": "High", "trigger": "Deadline < 3 days & docs incomplete", "enabled": true}
    ]'::jsonb
  ),
  (
    'Incorporation — HK Ltd',
    'Incorporation — HK Ltd',
    'New Hong Kong private limited company incorporation.',
    true,
    '[
      {"id": "doc-incorp-1", "label": "NNC1 incorporation form", "required": true, "daysBeforeDue": 3},
      {"id": "doc-incorp-2", "label": "Articles of association", "required": true, "daysBeforeDue": 3},
      {"id": "doc-incorp-3", "label": "IRBR1 business registration notice", "required": true, "daysBeforeDue": 3},
      {"id": "doc-incorp-4", "label": "ID / passport of each director & shareholder", "required": true, "daysBeforeDue": 5},
      {"id": "doc-incorp-5", "label": "Proof of address for each director", "required": true, "daysBeforeDue": 5}
    ]'::jsonb,
    '[
      {"id": "rem-incorp-1", "label": "Docs kick-off", "daysBeforeDue": 7, "channel": "WhatsApp"},
      {"id": "rem-incorp-2", "label": "Signature reminder", "daysBeforeDue": 2, "channel": "WhatsApp"}
    ]'::jsonb,
    '[
      {"id": "risk-incorp-1", "label": "KYC incomplete", "severity": "High", "trigger": "Missing director ID > 3 days", "enabled": true}
    ]'::jsonb
  ),
  (
    'Change of director',
    'Change of Director',
    'Appointment or resignation of a company director (ND2A / ND2B).',
    true,
    '[
      {"id": "doc-cod-1", "label": "ND2A / ND2B form", "required": true, "daysBeforeDue": 5},
      {"id": "doc-cod-2", "label": "Board resolution", "required": true, "daysBeforeDue": 5},
      {"id": "doc-cod-3", "label": "Consent to act as director", "required": true, "daysBeforeDue": 5},
      {"id": "doc-cod-4", "label": "New director ID copy", "required": true, "daysBeforeDue": 5}
    ]'::jsonb,
    '[
      {"id": "rem-cod-1", "label": "Docs reminder", "daysBeforeDue": 7, "channel": "WhatsApp"}
    ]'::jsonb,
    '[
      {"id": "risk-cod-1", "label": "Statutory 15-day window", "severity": "High", "trigger": "Filing not submitted within 15 days of change", "enabled": true}
    ]'::jsonb
  ),
  (
    'Deregistration',
    'Deregistration',
    'Voluntary deregistration of a defunct solvent company (DR1).',
    false,
    '[
      {"id": "doc-dereg-1", "label": "DR1 deregistration form", "required": true, "daysBeforeDue": 14},
      {"id": "doc-dereg-2", "label": "IRD notice of no objection", "required": true, "daysBeforeDue": 30},
      {"id": "doc-dereg-3", "label": "Written consent from all directors", "required": true, "daysBeforeDue": 14}
    ]'::jsonb,
    '[
      {"id": "rem-dereg-1", "label": "IRD follow-up", "daysBeforeDue": 21, "channel": "Email"}
    ]'::jsonb,
    '[
      {"id": "risk-dereg-1", "label": "Outstanding tax", "severity": "High", "trigger": "IRD clearance not received", "enabled": true}
    ]'::jsonb
  )
on conflict (name) do nothing;
