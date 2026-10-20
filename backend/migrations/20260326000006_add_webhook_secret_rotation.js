/**
 * Migration 006: Add webhook secret rotation fields to merchants.
 * - webhook_secret_old stores the previous secret during grace window.
 * - webhook_secret_expiry stores when the old secret stops being accepted.
 */

export async function up(knex) {
  await knex.raw(
    "alter table merchants add column if not exists webhook_secret_old text"
  );

  await knex.raw(
    "alter table merchants add column if not exists webhook_secret_expiry timestamptz"
  );
}

export async function down(knex) {
  await knex.schema.alterTable("merchants", (t) => {
    t.dropColumn("webhook_secret_old");
    t.dropColumn("webhook_secret_expiry");
  });
}
