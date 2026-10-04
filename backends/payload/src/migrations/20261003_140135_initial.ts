import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-sqlite'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.run(sql`CREATE TABLE \`admins_sessions\` (
  	\`_order\` integer NOT NULL,
  	\`_parent_id\` text(36) NOT NULL,
  	\`id\` text PRIMARY KEY NOT NULL,
  	\`created_at\` text,
  	\`expires_at\` text NOT NULL,
  	FOREIGN KEY (\`_parent_id\`) REFERENCES \`admins\`(\`id\`) ON UPDATE no action ON DELETE cascade
  );
  `)
  await db.run(sql`CREATE INDEX \`admins_sessions_order_idx\` ON \`admins_sessions\` (\`_order\`);`)
  await db.run(sql`CREATE INDEX \`admins_sessions_parent_id_idx\` ON \`admins_sessions\` (\`_parent_id\`);`)
  await db.run(sql`CREATE TABLE \`admins\` (
  	\`id\` text(36) PRIMARY KEY NOT NULL,
  	\`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	\`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	\`email\` text NOT NULL,
  	\`reset_password_token\` text,
  	\`reset_password_expiration\` text,
  	\`salt\` text,
  	\`hash\` text,
  	\`reset_password_requested_at\` text,
  	\`login_attempts\` numeric DEFAULT 0,
  	\`lock_until\` text
  );
  `)
  await db.run(sql`CREATE INDEX \`admins_updated_at_idx\` ON \`admins\` (\`updated_at\`);`)
  await db.run(sql`CREATE INDEX \`admins_created_at_idx\` ON \`admins\` (\`created_at\`);`)
  await db.run(sql`CREATE UNIQUE INDEX \`admins_email_idx\` ON \`admins\` (\`email\`);`)
  await db.run(sql`CREATE TABLE \`users_sessions\` (
  	\`_order\` integer NOT NULL,
  	\`_parent_id\` text(36) NOT NULL,
  	\`id\` text PRIMARY KEY NOT NULL,
  	\`created_at\` text,
  	\`expires_at\` text NOT NULL,
  	FOREIGN KEY (\`_parent_id\`) REFERENCES \`users\`(\`id\`) ON UPDATE no action ON DELETE cascade
  );
  `)
  await db.run(sql`CREATE INDEX \`users_sessions_order_idx\` ON \`users_sessions\` (\`_order\`);`)
  await db.run(sql`CREATE INDEX \`users_sessions_parent_id_idx\` ON \`users_sessions\` (\`_parent_id\`);`)
  await db.run(sql`CREATE TABLE \`users\` (
  	\`id\` text(36) PRIMARY KEY NOT NULL,
  	\`display_name\` text NOT NULL,
  	\`group_mutation_version\` numeric DEFAULT 0,
  	\`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	\`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	\`email\` text NOT NULL,
  	\`reset_password_token\` text,
  	\`reset_password_expiration\` text,
  	\`salt\` text,
  	\`hash\` text,
  	\`reset_password_requested_at\` text,
  	\`login_attempts\` numeric DEFAULT 0,
  	\`lock_until\` text
  );
  `)
  await db.run(sql`CREATE INDEX \`users_updated_at_idx\` ON \`users\` (\`updated_at\`);`)
  await db.run(sql`CREATE INDEX \`users_created_at_idx\` ON \`users\` (\`created_at\`);`)
  await db.run(sql`CREATE UNIQUE INDEX \`users_email_idx\` ON \`users\` (\`email\`);`)
  await db.run(sql`CREATE TABLE \`groups\` (
  	\`id\` text(36) PRIMARY KEY NOT NULL,
  	\`owner_id\` text(36) NOT NULL,
  	\`name\` text NOT NULL,
  	\`rank\` text NOT NULL,
  	\`sharing_enabled\` integer DEFAULT false,
  	\`share_version\` numeric DEFAULT 0,
  	\`revision\` numeric DEFAULT 1 NOT NULL,
  	\`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	\`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	FOREIGN KEY (\`owner_id\`) REFERENCES \`users\`(\`id\`) ON UPDATE no action ON DELETE set null
  );
  `)
  await db.run(sql`CREATE INDEX \`groups_owner_idx\` ON \`groups\` (\`owner_id\`);`)
  await db.run(sql`CREATE INDEX \`groups_rank_idx\` ON \`groups\` (\`rank\`);`)
  await db.run(sql`CREATE INDEX \`groups_revision_idx\` ON \`groups\` (\`revision\`);`)
  await db.run(sql`CREATE INDEX \`groups_updated_at_idx\` ON \`groups\` (\`updated_at\`);`)
  await db.run(sql`CREATE INDEX \`groups_created_at_idx\` ON \`groups\` (\`created_at\`);`)
  await db.run(sql`CREATE TABLE \`_groups_v\` (
  	\`id\` text(36) PRIMARY KEY NOT NULL,
  	\`parent_id\` text(36),
  	\`version_owner_id\` text(36) NOT NULL,
  	\`version_name\` text NOT NULL,
  	\`version_rank\` text NOT NULL,
  	\`version_sharing_enabled\` integer DEFAULT false,
  	\`version_share_version\` numeric DEFAULT 0,
  	\`version_revision\` numeric DEFAULT 1 NOT NULL,
  	\`version_updated_at\` text,
  	\`version_created_at\` text,
  	\`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	\`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	FOREIGN KEY (\`parent_id\`) REFERENCES \`groups\`(\`id\`) ON UPDATE no action ON DELETE set null,
  	FOREIGN KEY (\`version_owner_id\`) REFERENCES \`users\`(\`id\`) ON UPDATE no action ON DELETE set null
  );
  `)
  await db.run(sql`CREATE INDEX \`_groups_v_parent_idx\` ON \`_groups_v\` (\`parent_id\`);`)
  await db.run(sql`CREATE INDEX \`_groups_v_version_version_owner_idx\` ON \`_groups_v\` (\`version_owner_id\`);`)
  await db.run(sql`CREATE INDEX \`_groups_v_version_version_rank_idx\` ON \`_groups_v\` (\`version_rank\`);`)
  await db.run(sql`CREATE INDEX \`_groups_v_version_version_revision_idx\` ON \`_groups_v\` (\`version_revision\`);`)
  await db.run(sql`CREATE INDEX \`_groups_v_version_version_updated_at_idx\` ON \`_groups_v\` (\`version_updated_at\`);`)
  await db.run(sql`CREATE INDEX \`_groups_v_version_version_created_at_idx\` ON \`_groups_v\` (\`version_created_at\`);`)
  await db.run(sql`CREATE INDEX \`_groups_v_created_at_idx\` ON \`_groups_v\` (\`created_at\`);`)
  await db.run(sql`CREATE INDEX \`_groups_v_updated_at_idx\` ON \`_groups_v\` (\`updated_at\`);`)
  await db.run(sql`CREATE TABLE \`bookmarks\` (
  	\`id\` text(36) PRIMARY KEY NOT NULL,
  	\`owner_id\` text(36) NOT NULL,
  	\`group_id\` text(36) NOT NULL,
  	\`kind\` text NOT NULL,
  	\`position\` text NOT NULL,
  	\`url\` text,
  	\`title\` text,
  	\`description\` text,
  	\`favicon\` text,
  	\`preview_image\` text,
  	\`video_provider\` text,
  	\`video_i_d\` text,
  	\`text\` text,
  	\`caption\` text,
  	\`revision\` numeric DEFAULT 1 NOT NULL,
  	\`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	\`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	FOREIGN KEY (\`owner_id\`) REFERENCES \`users\`(\`id\`) ON UPDATE no action ON DELETE set null,
  	FOREIGN KEY (\`group_id\`) REFERENCES \`groups\`(\`id\`) ON UPDATE no action ON DELETE set null
  );
  `)
  await db.run(sql`CREATE INDEX \`bookmarks_owner_idx\` ON \`bookmarks\` (\`owner_id\`);`)
  await db.run(sql`CREATE INDEX \`bookmarks_group_idx\` ON \`bookmarks\` (\`group_id\`);`)
  await db.run(sql`CREATE INDEX \`bookmarks_position_idx\` ON \`bookmarks\` (\`position\`);`)
  await db.run(sql`CREATE INDEX \`bookmarks_revision_idx\` ON \`bookmarks\` (\`revision\`);`)
  await db.run(sql`CREATE INDEX \`bookmarks_updated_at_idx\` ON \`bookmarks\` (\`updated_at\`);`)
  await db.run(sql`CREATE INDEX \`bookmarks_created_at_idx\` ON \`bookmarks\` (\`created_at\`);`)
  await db.run(sql`CREATE TABLE \`bookmarks_rels\` (
  	\`id\` integer PRIMARY KEY NOT NULL,
  	\`order\` integer,
  	\`parent_id\` text(36) NOT NULL,
  	\`path\` text NOT NULL,
  	\`assets_id\` text(36),
  	FOREIGN KEY (\`parent_id\`) REFERENCES \`bookmarks\`(\`id\`) ON UPDATE no action ON DELETE cascade,
  	FOREIGN KEY (\`assets_id\`) REFERENCES \`assets\`(\`id\`) ON UPDATE no action ON DELETE cascade
  );
  `)
  await db.run(sql`CREATE INDEX \`bookmarks_rels_order_idx\` ON \`bookmarks_rels\` (\`order\`);`)
  await db.run(sql`CREATE INDEX \`bookmarks_rels_parent_idx\` ON \`bookmarks_rels\` (\`parent_id\`);`)
  await db.run(sql`CREATE INDEX \`bookmarks_rels_path_idx\` ON \`bookmarks_rels\` (\`path\`);`)
  await db.run(sql`CREATE INDEX \`bookmarks_rels_assets_id_idx\` ON \`bookmarks_rels\` (\`assets_id\`);`)
  await db.run(sql`CREATE TABLE \`_bookmarks_v\` (
  	\`id\` text(36) PRIMARY KEY NOT NULL,
  	\`parent_id\` text(36),
  	\`version_owner_id\` text(36) NOT NULL,
  	\`version_group_id\` text(36) NOT NULL,
  	\`version_kind\` text NOT NULL,
  	\`version_position\` text NOT NULL,
  	\`version_url\` text,
  	\`version_title\` text,
  	\`version_description\` text,
  	\`version_favicon\` text,
  	\`version_preview_image\` text,
  	\`version_video_provider\` text,
  	\`version_video_i_d\` text,
  	\`version_text\` text,
  	\`version_caption\` text,
  	\`version_revision\` numeric DEFAULT 1 NOT NULL,
  	\`version_updated_at\` text,
  	\`version_created_at\` text,
  	\`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	\`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	FOREIGN KEY (\`parent_id\`) REFERENCES \`bookmarks\`(\`id\`) ON UPDATE no action ON DELETE set null,
  	FOREIGN KEY (\`version_owner_id\`) REFERENCES \`users\`(\`id\`) ON UPDATE no action ON DELETE set null,
  	FOREIGN KEY (\`version_group_id\`) REFERENCES \`groups\`(\`id\`) ON UPDATE no action ON DELETE set null
  );
  `)
  await db.run(sql`CREATE INDEX \`_bookmarks_v_parent_idx\` ON \`_bookmarks_v\` (\`parent_id\`);`)
  await db.run(sql`CREATE INDEX \`_bookmarks_v_version_version_owner_idx\` ON \`_bookmarks_v\` (\`version_owner_id\`);`)
  await db.run(sql`CREATE INDEX \`_bookmarks_v_version_version_group_idx\` ON \`_bookmarks_v\` (\`version_group_id\`);`)
  await db.run(sql`CREATE INDEX \`_bookmarks_v_version_version_position_idx\` ON \`_bookmarks_v\` (\`version_position\`);`)
  await db.run(sql`CREATE INDEX \`_bookmarks_v_version_version_revision_idx\` ON \`_bookmarks_v\` (\`version_revision\`);`)
  await db.run(sql`CREATE INDEX \`_bookmarks_v_version_version_updated_at_idx\` ON \`_bookmarks_v\` (\`version_updated_at\`);`)
  await db.run(sql`CREATE INDEX \`_bookmarks_v_version_version_created_at_idx\` ON \`_bookmarks_v\` (\`version_created_at\`);`)
  await db.run(sql`CREATE INDEX \`_bookmarks_v_created_at_idx\` ON \`_bookmarks_v\` (\`created_at\`);`)
  await db.run(sql`CREATE INDEX \`_bookmarks_v_updated_at_idx\` ON \`_bookmarks_v\` (\`updated_at\`);`)
  await db.run(sql`CREATE TABLE \`_bookmarks_v_rels\` (
  	\`id\` integer PRIMARY KEY NOT NULL,
  	\`order\` integer,
  	\`parent_id\` text(36) NOT NULL,
  	\`path\` text NOT NULL,
  	\`assets_id\` text(36),
  	FOREIGN KEY (\`parent_id\`) REFERENCES \`_bookmarks_v\`(\`id\`) ON UPDATE no action ON DELETE cascade,
  	FOREIGN KEY (\`assets_id\`) REFERENCES \`assets\`(\`id\`) ON UPDATE no action ON DELETE cascade
  );
  `)
  await db.run(sql`CREATE INDEX \`_bookmarks_v_rels_order_idx\` ON \`_bookmarks_v_rels\` (\`order\`);`)
  await db.run(sql`CREATE INDEX \`_bookmarks_v_rels_parent_idx\` ON \`_bookmarks_v_rels\` (\`parent_id\`);`)
  await db.run(sql`CREATE INDEX \`_bookmarks_v_rels_path_idx\` ON \`_bookmarks_v_rels\` (\`path\`);`)
  await db.run(sql`CREATE INDEX \`_bookmarks_v_rels_assets_id_idx\` ON \`_bookmarks_v_rels\` (\`assets_id\`);`)
  await db.run(sql`CREATE TABLE \`assets\` (
  	\`id\` text(36) PRIMARY KEY NOT NULL,
  	\`owner_id\` text(36) NOT NULL,
  	\`group_id\` text(36) NOT NULL,
  	\`alt\` text,
  	\`prefix\` text DEFAULT 'quikmarq-payload/uploads',
  	\`_objectkey\` text,
  	\`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	\`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	\`url\` text,
  	\`thumbnail_u_r_l\` text,
  	\`filename\` text,
  	\`mime_type\` text,
  	\`filesize\` numeric,
  	\`width\` numeric,
  	\`height\` numeric,
  	\`focal_x\` numeric,
  	\`focal_y\` numeric,
  	\`sizes_thumb_url\` text,
  	\`sizes_thumb_width\` numeric,
  	\`sizes_thumb_height\` numeric,
  	\`sizes_thumb_mime_type\` text,
  	\`sizes_thumb_filesize\` numeric,
  	\`sizes_thumb_filename\` text,
  	FOREIGN KEY (\`owner_id\`) REFERENCES \`users\`(\`id\`) ON UPDATE no action ON DELETE set null,
  	FOREIGN KEY (\`group_id\`) REFERENCES \`groups\`(\`id\`) ON UPDATE no action ON DELETE set null
  );
  `)
  await db.run(sql`CREATE INDEX \`assets_owner_idx\` ON \`assets\` (\`owner_id\`);`)
  await db.run(sql`CREATE INDEX \`assets_group_idx\` ON \`assets\` (\`group_id\`);`)
  await db.run(sql`CREATE INDEX \`assets_updated_at_idx\` ON \`assets\` (\`updated_at\`);`)
  await db.run(sql`CREATE INDEX \`assets_created_at_idx\` ON \`assets\` (\`created_at\`);`)
  await db.run(sql`CREATE UNIQUE INDEX \`assets_filename_idx\` ON \`assets\` (\`filename\`);`)
  await db.run(sql`CREATE INDEX \`assets_sizes_thumb_sizes_thumb_filename_idx\` ON \`assets\` (\`sizes_thumb_filename\`);`)
  await db.run(sql`CREATE TABLE \`payload_kv\` (
  	\`id\` text(36) PRIMARY KEY NOT NULL,
  	\`key\` text NOT NULL,
  	\`data\` text NOT NULL
  );
  `)
  await db.run(sql`CREATE UNIQUE INDEX \`payload_kv_key_idx\` ON \`payload_kv\` (\`key\`);`)
  await db.run(sql`CREATE TABLE \`payload_locked_documents\` (
  	\`id\` text(36) PRIMARY KEY NOT NULL,
  	\`global_slug\` text,
  	\`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	\`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
  );
  `)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_global_slug_idx\` ON \`payload_locked_documents\` (\`global_slug\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_updated_at_idx\` ON \`payload_locked_documents\` (\`updated_at\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_created_at_idx\` ON \`payload_locked_documents\` (\`created_at\`);`)
  await db.run(sql`CREATE TABLE \`payload_locked_documents_rels\` (
  	\`id\` integer PRIMARY KEY NOT NULL,
  	\`order\` integer,
  	\`parent_id\` text(36) NOT NULL,
  	\`path\` text NOT NULL,
  	\`admins_id\` text(36),
  	\`users_id\` text(36),
  	\`groups_id\` text(36),
  	\`bookmarks_id\` text(36),
  	\`assets_id\` text(36),
  	FOREIGN KEY (\`parent_id\`) REFERENCES \`payload_locked_documents\`(\`id\`) ON UPDATE no action ON DELETE cascade,
  	FOREIGN KEY (\`admins_id\`) REFERENCES \`admins\`(\`id\`) ON UPDATE no action ON DELETE cascade,
  	FOREIGN KEY (\`users_id\`) REFERENCES \`users\`(\`id\`) ON UPDATE no action ON DELETE cascade,
  	FOREIGN KEY (\`groups_id\`) REFERENCES \`groups\`(\`id\`) ON UPDATE no action ON DELETE cascade,
  	FOREIGN KEY (\`bookmarks_id\`) REFERENCES \`bookmarks\`(\`id\`) ON UPDATE no action ON DELETE cascade,
  	FOREIGN KEY (\`assets_id\`) REFERENCES \`assets\`(\`id\`) ON UPDATE no action ON DELETE cascade
  );
  `)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_order_idx\` ON \`payload_locked_documents_rels\` (\`order\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_parent_idx\` ON \`payload_locked_documents_rels\` (\`parent_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_path_idx\` ON \`payload_locked_documents_rels\` (\`path\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_admins_id_idx\` ON \`payload_locked_documents_rels\` (\`admins_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_users_id_idx\` ON \`payload_locked_documents_rels\` (\`users_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_groups_id_idx\` ON \`payload_locked_documents_rels\` (\`groups_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_bookmarks_id_idx\` ON \`payload_locked_documents_rels\` (\`bookmarks_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_locked_documents_rels_assets_id_idx\` ON \`payload_locked_documents_rels\` (\`assets_id\`);`)
  await db.run(sql`CREATE TABLE \`payload_preferences\` (
  	\`id\` text(36) PRIMARY KEY NOT NULL,
  	\`key\` text,
  	\`value\` text,
  	\`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	\`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
  );
  `)
  await db.run(sql`CREATE INDEX \`payload_preferences_key_idx\` ON \`payload_preferences\` (\`key\`);`)
  await db.run(sql`CREATE INDEX \`payload_preferences_updated_at_idx\` ON \`payload_preferences\` (\`updated_at\`);`)
  await db.run(sql`CREATE INDEX \`payload_preferences_created_at_idx\` ON \`payload_preferences\` (\`created_at\`);`)
  await db.run(sql`CREATE TABLE \`payload_preferences_rels\` (
  	\`id\` integer PRIMARY KEY NOT NULL,
  	\`order\` integer,
  	\`parent_id\` text(36) NOT NULL,
  	\`path\` text NOT NULL,
  	\`admins_id\` text(36),
  	\`users_id\` text(36),
  	FOREIGN KEY (\`parent_id\`) REFERENCES \`payload_preferences\`(\`id\`) ON UPDATE no action ON DELETE cascade,
  	FOREIGN KEY (\`admins_id\`) REFERENCES \`admins\`(\`id\`) ON UPDATE no action ON DELETE cascade,
  	FOREIGN KEY (\`users_id\`) REFERENCES \`users\`(\`id\`) ON UPDATE no action ON DELETE cascade
  );
  `)
  await db.run(sql`CREATE INDEX \`payload_preferences_rels_order_idx\` ON \`payload_preferences_rels\` (\`order\`);`)
  await db.run(sql`CREATE INDEX \`payload_preferences_rels_parent_idx\` ON \`payload_preferences_rels\` (\`parent_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_preferences_rels_path_idx\` ON \`payload_preferences_rels\` (\`path\`);`)
  await db.run(sql`CREATE INDEX \`payload_preferences_rels_admins_id_idx\` ON \`payload_preferences_rels\` (\`admins_id\`);`)
  await db.run(sql`CREATE INDEX \`payload_preferences_rels_users_id_idx\` ON \`payload_preferences_rels\` (\`users_id\`);`)
  await db.run(sql`CREATE TABLE \`payload_migrations\` (
  	\`id\` text(36) PRIMARY KEY NOT NULL,
  	\`name\` text,
  	\`batch\` numeric,
  	\`updated_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
  	\`created_at\` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
  );
  `)
  await db.run(sql`CREATE INDEX \`payload_migrations_updated_at_idx\` ON \`payload_migrations\` (\`updated_at\`);`)
  await db.run(sql`CREATE INDEX \`payload_migrations_created_at_idx\` ON \`payload_migrations\` (\`created_at\`);`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.run(sql`DROP TABLE \`admins_sessions\`;`)
  await db.run(sql`DROP TABLE \`admins\`;`)
  await db.run(sql`DROP TABLE \`users_sessions\`;`)
  await db.run(sql`DROP TABLE \`users\`;`)
  await db.run(sql`DROP TABLE \`groups\`;`)
  await db.run(sql`DROP TABLE \`_groups_v\`;`)
  await db.run(sql`DROP TABLE \`bookmarks\`;`)
  await db.run(sql`DROP TABLE \`bookmarks_rels\`;`)
  await db.run(sql`DROP TABLE \`_bookmarks_v\`;`)
  await db.run(sql`DROP TABLE \`_bookmarks_v_rels\`;`)
  await db.run(sql`DROP TABLE \`assets\`;`)
  await db.run(sql`DROP TABLE \`payload_kv\`;`)
  await db.run(sql`DROP TABLE \`payload_locked_documents\`;`)
  await db.run(sql`DROP TABLE \`payload_locked_documents_rels\`;`)
  await db.run(sql`DROP TABLE \`payload_preferences\`;`)
  await db.run(sql`DROP TABLE \`payload_preferences_rels\`;`)
  await db.run(sql`DROP TABLE \`payload_migrations\`;`)
}
