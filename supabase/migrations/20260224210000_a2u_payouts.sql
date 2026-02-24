create table if not exists public.pi_a2u_payouts (
  payment_id text primary key,
  pi_uid text,
  amount numeric,
  memo text,
  txid text,
  status text,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists pi_a2u_payouts_status_idx on public.pi_a2u_payouts (status);

alter table public.pi_a2u_payouts enable row level security;
