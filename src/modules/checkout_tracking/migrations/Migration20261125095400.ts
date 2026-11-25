import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20261125095400 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table "checkout_journey" add column "confirmed_returned_at" timestamptz null;`);
    this.addSql(`create table if not exists "checkout_cart_add" ("id" text not null, "cart_id" text not null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "checkout_cart_add_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_checkout_cart_add_deleted_at" ON "checkout_cart_add" ("deleted_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_checkout_cart_add_created_at" ON "checkout_cart_add" ("created_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_checkout_cart_add_cart_id_created_at" ON "checkout_cart_add" ("cart_id", "created_at") WHERE deleted_at IS NULL;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table "checkout_cart_add";`);
    this.addSql(`alter table "checkout_journey" drop column "confirmed_returned_at";`);
  }

}
