import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260803181441 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "checkout_journey" drop constraint if exists "checkout_journey_cart_id_unique";`);
    this.addSql(`create table if not exists "checkout_journey" ("id" text not null, "cart_id" text not null, "stage" text not null default 'cart', "locale" text null, "device" text null, "last_path" text null, "stage_at" jsonb null, "first_seen_at" timestamptz not null, "last_seen_at" timestamptz not null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "checkout_journey_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_checkout_journey_deleted_at" ON "checkout_journey" ("deleted_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_checkout_journey_cart_id_unique" ON "checkout_journey" ("cart_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_checkout_journey_last_seen_at" ON "checkout_journey" ("last_seen_at") WHERE deleted_at IS NULL;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "checkout_journey" cascade;`);
  }

}
