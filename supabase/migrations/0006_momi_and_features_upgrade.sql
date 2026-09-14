-- 0006_momi_and_features_upgrade.sql
-- momi小助手、AI记忆库、头像配置与时光胶囊安全补丁 (提示词3)

CREATE TABLE IF NOT EXISTS public.momi_assistant_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  couple_id varchar NOT NULL DEFAULT 'momo_and_baomi',
  sender varchar NOT NULL,
  content text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_momi_assistant_messages_lookup
  ON public.momi_assistant_messages (couple_id, created_at ASC);

ALTER TABLE public.momi_assistant_messages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all on momi_assistant_messages" ON public.momi_assistant_messages;
CREATE POLICY "Allow all on momi_assistant_messages"
  ON public.momi_assistant_messages FOR ALL TO anon, authenticated
  USING (true) WITH CHECK (true);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'momi_assistant_messages'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.momi_assistant_messages;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.momi_memory (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  couple_id varchar NOT NULL DEFAULT 'momo_and_baomi',
  user_id varchar NOT NULL,
  memory_type varchar NOT NULL,
  content text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_momi_memory_lookup
  ON public.momi_memory (couple_id, user_id);

ALTER TABLE public.momi_memory ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all on momi_memory" ON public.momi_memory;
CREATE POLICY "Allow all on momi_memory"
  ON public.momi_memory FOR ALL TO anon, authenticated
  USING (true) WITH CHECK (true);

CREATE TABLE IF NOT EXISTS public.user_profiles (
  user_id varchar PRIMARY KEY,
  avatar_url text,
  nickname varchar(50),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all on user_profiles" ON public.user_profiles;
CREATE POLICY "Allow all on user_profiles"
  ON public.user_profiles FOR ALL TO anon, authenticated
  USING (true) WITH CHECK (true);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'user_profiles'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.user_profiles;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.app_config (
  key varchar PRIMARY KEY,
  value text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.app_config ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow all on app_config" ON public.app_config;
CREATE POLICY "Allow all on app_config"
  ON public.app_config FOR ALL TO anon, authenticated
  USING (true) WITH CHECK (true);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'app_config'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.app_config;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'time_capsules' AND column_name = 'opened_at'
  ) THEN
    ALTER TABLE public.time_capsules ADD COLUMN opened_at timestamptz DEFAULT NULL;
  END IF;
END $$;

UPDATE public.time_capsules
SET opened_at = created_at
WHERE (is_opened = true OR is_read = true) AND opened_at IS NULL;

INSERT INTO storage.buckets (id, name, public)
VALUES ('avatars', 'avatars', true)
ON CONFLICT (id) DO UPDATE SET public = true;

DROP POLICY IF EXISTS "Allow all on avatars" ON storage.objects;
CREATE POLICY "Allow all on avatars"
  ON storage.objects FOR ALL TO anon, authenticated
  USING (bucket_id = 'avatars')
  WITH CHECK (bucket_id = 'avatars');
