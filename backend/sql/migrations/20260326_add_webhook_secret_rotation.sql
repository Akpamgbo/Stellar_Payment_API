alter table merchants
add column if not exists webhook_secret_old text,
add column if not exists webhook_secret_expiry timestamptz;
