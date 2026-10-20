/**
 * Migration 007: Refine audit_logs table to allow NULL merchant_id and add status column.
 * This allows logging failed login attempts where the merchant ID is not yet known.
 */

export async function up(knex) {
  // Add 'status' column and make 'merchant_id' nullable
  await knex.schema.alterTable("audit_logs", (t) => {
    t.text("status");
    t.uuid("merchant_id").nullable().alter();
  });
}

export async function down(knex) {
  // Revert: remove 'status' and make 'merchant_id' not nullable
  // Note: this may fail if there are rows with NULL merchant_id
  await knex.schema.alterTable("audit_logs", (t) => {
    t.uuid("merchant_id").notNullable().alter();
    t.dropColumn("status");
  });
}
