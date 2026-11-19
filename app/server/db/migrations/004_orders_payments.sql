-- 004_orders_payments: what is bought online and what the payment provider reported
-- (docs/superpowers/plans/2026-11-17-booking-plan-update.md, section 2.10). Money is integer cents.

create table orders (
  id            text primary key,
  account_id    text not null references accounts (id),
  product_kind  text not null check (product_kind in ('pack', 'waitlist_offer')),
  pack_id       text references packs (id),
  amount_cents  integer not null check (amount_cents >= 0),
  status        text not null default 'pending'
                check (status in ('pending', 'paid', 'failed', 'expired', 'refunded')),
  created_at    timestamptz not null default now(),
  expires_at    timestamptz not null,
  check ((product_kind = 'pack') = (pack_id is not null))
);
create index orders_account on orders (account_id);
-- Two presses of "buy the offer" at once: one order wins. An expired or failed one lets the account try again.
create unique index orders_one_open_offer on orders (account_id)
  where product_kind = 'waitlist_offer' and status in ('pending', 'paid');

create table payments (
  id                 text primary key,
  order_id           text not null references orders (id),
  provider_ref       text not null unique,
  amount_cents       integer not null check (amount_cents >= 0),
  status             text not null check (status in ('succeeded', 'failed', 'refunded')),
  paid_at            timestamptz,
  fiscal_receipt_ref text,  -- empty until the fiscalization answer
  created_at         timestamptz not null default now()
);
-- A second "paid" message for the same order cannot grant twice, even if the handler is wrong.
create unique index payments_one_success_per_order on payments (order_id) where status = 'succeeded';

-- Every provider callback as it arrived. Evidence when something disagrees, so it is never changed.
create table payment_events (
  id           bigserial primary key,
  provider_ref text,
  body         text not null,
  received_at  timestamptz not null default now()
);
create function payment_events_append_only() returns trigger language plpgsql as $$
begin
  raise exception 'payment_events is append-only';
end $$;
create trigger payment_events_no_change before update or delete on payment_events
  for each row execute function payment_events_append_only();

alter table passes add constraint passes_order_fk foreign key (order_id) references orders (id);
