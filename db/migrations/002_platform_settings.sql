-- Single-row, admin-editable platform configuration (no deploy needed to change).
CREATE TABLE platform_settings (
  id                     smallint PRIMARY KEY DEFAULT 1,
  fee_percent            numeric(5,2) NOT NULL DEFAULT 10 CHECK (fee_percent >= 0 AND fee_percent <= 100),
  price_min_cents        integer NOT NULL DEFAULT 100   CHECK (price_min_cents >= 100),
  price_max_cents        integer NOT NULL DEFAULT 50000 CHECK (price_max_cents <= 50000),
  max_image_size_bytes   bigint  NOT NULL DEFAULT 15728640   CHECK (max_image_size_bytes > 0),   -- 15 MiB
  max_video_size_bytes   bigint  NOT NULL DEFAULT 524288000  CHECK (max_video_size_bytes > 0),   -- 500 MiB (videos: future)
  max_files_per_drop     integer NOT NULL DEFAULT 20 CHECK (max_files_per_drop > 0),
  allowed_image_mimes    text[]  NOT NULL DEFAULT ARRAY['image/jpeg','image/png','image/webp'],
  updated_at             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT platform_settings_singleton CHECK (id = 1),
  CONSTRAINT platform_settings_price_order CHECK (price_min_cents <= price_max_cents)
);
INSERT INTO platform_settings (id) VALUES (1);
