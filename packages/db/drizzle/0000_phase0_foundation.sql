CREATE TABLE IF NOT EXISTS `app_meta` (
  `key` text PRIMARY KEY NOT NULL,
  `value` text NOT NULL,
  `updated_at` integer NOT NULL
);

INSERT OR IGNORE INTO `app_meta` (`key`, `value`, `updated_at`)
VALUES ('schema_version', 'phase0', unixepoch());
