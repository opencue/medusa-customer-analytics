import { Migration } from "@medusajs/framework/mikro-orm/migrations"

export class Migration20261125090000 extends Migration {
  override async up(): Promise<void> {
    this.addSql('alter table "checkout_journey" add column "returned_at" timestamptz null;')
  }

  override async down(): Promise<void> {
    this.addSql('alter table "checkout_journey" drop column "returned_at";')
  }
}
