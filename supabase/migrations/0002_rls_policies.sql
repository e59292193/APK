-- ═══════════════════════════════════════════════════════
-- 0002: RLS 收紧 —— 删除全部 Allow all 策略，按业务参与者重建
--
-- ⚠️ 执行时机：两台手机都已安装使用 Supabase Auth 登录的新 APK 之后。
--   执行后：匿名（anon）请求不再能读写任何业务表；
--   旧 APK（本地口令登录、anon 请求）将立即无法读写数据。
--
-- 幂等：可重复执行（DROP POLICY IF EXISTS + CREATE POLICY）。
-- 回滚：见文件末尾。
-- ═══════════════════════════════════════════════════════

-- 通用：删除各表既有 Allow all 类策略（按名字前缀匹配兜底）
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT schemaname, tablename, policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND (policyname LIKE 'Allow all%'
        OR policyname LIKE 'allow all%')
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I.%I', r.policyname, r.schemaname, r.tablename);
  END LOOP;
END $$;

-- ─── 0. 聊天消息 ───────────────────────────────────────
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "messages member select" ON public.messages;
CREATE POLICY "messages member select" ON public.messages
  FOR SELECT TO authenticated USING (public.is_app_member());
DROP POLICY IF EXISTS "messages member insert" ON public.messages;
CREATE POLICY "messages member insert" ON public.messages
  FOR INSERT TO authenticated WITH CHECK (user_id = public.current_app_user());
DROP POLICY IF EXISTS "messages author update" ON public.messages;
CREATE POLICY "messages author update" ON public.messages
  FOR UPDATE TO authenticated USING (user_id = public.current_app_user())
  WITH CHECK (user_id = public.current_app_user());
DROP POLICY IF EXISTS "messages author delete" ON public.messages;
CREATE POLICY "messages author delete" ON public.messages
  FOR DELETE TO authenticated USING (user_id = public.current_app_user());

-- ─── 1. 打卡主题（双方共建）────────────────────────────
ALTER TABLE public.checkin_themes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "checkin_themes member all" ON public.checkin_themes;
CREATE POLICY "checkin_themes member all" ON public.checkin_themes
  FOR ALL TO authenticated
  USING (public.is_app_member())
  WITH CHECK (creator_id = public.current_app_user() OR partner_id = public.current_app_user());

-- ─── 2. 打卡记录（本人写，双方读）──────────────────────
ALTER TABLE public.checkin_records ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "checkin_records member select" ON public.checkin_records;
CREATE POLICY "checkin_records member select" ON public.checkin_records
  FOR SELECT TO authenticated USING (public.is_app_member());
DROP POLICY IF EXISTS "checkin_records own write" ON public.checkin_records;
CREATE POLICY "checkin_records own write" ON public.checkin_records
  FOR ALL TO authenticated
  USING (user_id = public.current_app_user())
  WITH CHECK (user_id = public.current_app_user());

-- ─── 3. 时光胶囊（双方读，创建者写；已读标记双方可更新）──
ALTER TABLE public.time_capsules ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "time_capsules member select" ON public.time_capsules;
CREATE POLICY "time_capsules member select" ON public.time_capsules
  FOR SELECT TO authenticated USING (public.is_app_member());
DROP POLICY IF EXISTS "time_capsules creator insert" ON public.time_capsules;
CREATE POLICY "time_capsules creator insert" ON public.time_capsules
  FOR INSERT TO authenticated WITH CHECK (creator_id = public.current_app_user());
DROP POLICY IF EXISTS "time_capsules member update" ON public.time_capsules;
CREATE POLICY "time_capsules member update" ON public.time_capsules
  FOR UPDATE TO authenticated
  USING (public.is_app_member()) WITH CHECK (public.is_app_member());
DROP POLICY IF EXISTS "time_capsules creator delete" ON public.time_capsules;
CREATE POLICY "time_capsules creator delete" ON public.time_capsules
  FOR DELETE TO authenticated USING (creator_id = public.current_app_user());

-- ─── 4. 愿望清单（双方共同管理）────────────────────────
ALTER TABLE public.wishes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "wishes member all" ON public.wishes;
CREATE POLICY "wishes member all" ON public.wishes
  FOR ALL TO authenticated
  USING (public.is_app_member())
  WITH CHECK (creator_id = public.current_app_user() OR public.is_app_member());

-- ─── 5. 纪念日（双方共同管理）─────────────────────────
ALTER TABLE public.anniversaries ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "anniversaries member all" ON public.anniversaries;
CREATE POLICY "anniversaries member all" ON public.anniversaries
  FOR ALL TO authenticated
  USING (public.is_app_member())
  WITH CHECK (public.is_app_member());

-- ─── 6. 旅程与手账（双方共同管理）──────────────────────
ALTER TABLE public.trips ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "trips member all" ON public.trips;
CREATE POLICY "trips member all" ON public.trips
  FOR ALL TO authenticated
  USING (public.is_app_member()) WITH CHECK (public.is_app_member());

ALTER TABLE public.trip_entries ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "trip_entries member all" ON public.trip_entries;
CREATE POLICY "trip_entries member all" ON public.trip_entries
  FOR ALL TO authenticated
  USING (public.is_app_member()) WITH CHECK (public.is_app_member());

-- ─── 7. 五子棋（仅对局双方）───────────────────────────
ALTER TABLE public.gomoku_games ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "gomoku_games participants select" ON public.gomoku_games;
CREATE POLICY "gomoku_games participants select" ON public.gomoku_games
  FOR SELECT TO authenticated
  USING (creator_id = public.current_app_user() OR invitee_id = public.current_app_user());
DROP POLICY IF EXISTS "gomoku_games creator insert" ON public.gomoku_games;
CREATE POLICY "gomoku_games creator insert" ON public.gomoku_games
  FOR INSERT TO authenticated
  WITH CHECK (creator_id = public.current_app_user());
DROP POLICY IF EXISTS "gomoku_games participants update" ON public.gomoku_games;
CREATE POLICY "gomoku_games participants update" ON public.gomoku_games
  FOR UPDATE TO authenticated
  USING (creator_id = public.current_app_user() OR invitee_id = public.current_app_user())
  WITH CHECK (creator_id = public.current_app_user() OR invitee_id = public.current_app_user());
DROP POLICY IF EXISTS "gomoku_games participants delete" ON public.gomoku_games;
CREATE POLICY "gomoku_games participants delete" ON public.gomoku_games
  FOR DELETE TO authenticated
  USING (creator_id = public.current_app_user() OR invitee_id = public.current_app_user());

ALTER TABLE public.gomoku_manual_wins ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "gomoku_manual_wins member all" ON public.gomoku_manual_wins;
CREATE POLICY "gomoku_manual_wins member all" ON public.gomoku_manual_wins
  FOR ALL TO authenticated
  USING (public.is_app_member()) WITH CHECK (user_id = public.current_app_user());

-- ─── 8. 你画我猜 ──────────────────────────────────────
ALTER TABLE public.drawguess_games ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "drawguess_games participants select" ON public.drawguess_games;
CREATE POLICY "drawguess_games participants select" ON public.drawguess_games
  FOR SELECT TO authenticated
  USING (creator_id = public.current_app_user() OR invitee_id = public.current_app_user());
DROP POLICY IF EXISTS "drawguess_games creator insert" ON public.drawguess_games;
CREATE POLICY "drawguess_games creator insert" ON public.drawguess_games
  FOR INSERT TO authenticated WITH CHECK (creator_id = public.current_app_user());
DROP POLICY IF EXISTS "drawguess_games participants update" ON public.drawguess_games;
CREATE POLICY "drawguess_games participants update" ON public.drawguess_games
  FOR UPDATE TO authenticated
  USING (creator_id = public.current_app_user() OR invitee_id = public.current_app_user())
  WITH CHECK (creator_id = public.current_app_user() OR invitee_id = public.current_app_user());
DROP POLICY IF EXISTS "drawguess_games participants delete" ON public.drawguess_games;
CREATE POLICY "drawguess_games participants delete" ON public.drawguess_games
  FOR DELETE TO authenticated
  USING (creator_id = public.current_app_user() OR invitee_id = public.current_app_user());

ALTER TABLE public.drawguess_gallery ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "drawguess_gallery member all" ON public.drawguess_gallery;
CREATE POLICY "drawguess_gallery member all" ON public.drawguess_gallery
  FOR ALL TO authenticated
  USING (public.is_app_member()) WITH CHECK (public.is_app_member());

-- 私房词库：严格个人私有
ALTER TABLE public.drawguess_custom_words ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "drawguess_custom_words own all" ON public.drawguess_custom_words;
CREATE POLICY "drawguess_custom_words own all" ON public.drawguess_custom_words
  FOR ALL TO authenticated
  USING (user_id = public.current_app_user())
  WITH CHECK (user_id = public.current_app_user());

-- 信号队列：双方读写（轮询消费）
ALTER TABLE public.drawguess_signals ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "drawguess_signals member select" ON public.drawguess_signals;
CREATE POLICY "drawguess_signals member select" ON public.drawguess_signals
  FOR SELECT TO authenticated USING (public.is_app_member());
DROP POLICY IF EXISTS "drawguess_signals member insert" ON public.drawguess_signals;
CREATE POLICY "drawguess_signals member insert" ON public.drawguess_signals
  FOR INSERT TO authenticated WITH CHECK (sender_id = public.current_app_user());
DROP POLICY IF EXISTS "drawguess_signals member delete" ON public.drawguess_signals;
CREATE POLICY "drawguess_signals member delete" ON public.drawguess_signals
  FOR DELETE TO authenticated USING (public.is_app_member());

ALTER TABLE public.drawguess_stats ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "drawguess_stats member select" ON public.drawguess_stats;
CREATE POLICY "drawguess_stats member select" ON public.drawguess_stats
  FOR SELECT TO authenticated USING (public.is_app_member());
DROP POLICY IF EXISTS "drawguess_stats own write" ON public.drawguess_stats;
CREATE POLICY "drawguess_stats own write" ON public.drawguess_stats
  FOR ALL TO authenticated
  USING (user_id = public.current_app_user())
  WITH CHECK (user_id = public.current_app_user());

-- ─── 9. 小纸条 & 语音信箱（收发双方；claim/consume 走 0003 的 RPC）──
ALTER TABLE public.ephemeral_notes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "ephemeral_notes parties select" ON public.ephemeral_notes;
CREATE POLICY "ephemeral_notes parties select" ON public.ephemeral_notes
  FOR SELECT TO authenticated
  USING (sender_id = public.current_app_user() OR receiver_id = public.current_app_user());
DROP POLICY IF EXISTS "ephemeral_notes sender insert" ON public.ephemeral_notes;
CREATE POLICY "ephemeral_notes sender insert" ON public.ephemeral_notes
  FOR INSERT TO authenticated
  WITH CHECK (sender_id = public.current_app_user()
          AND receiver_id <> public.current_app_user());
-- update/delete 不开放：领取与消费只经 SECURITY DEFINER RPC

ALTER TABLE public.ephemeral_voice_messages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "ephemeral_voice_messages parties select" ON public.ephemeral_voice_messages;
CREATE POLICY "ephemeral_voice_messages parties select" ON public.ephemeral_voice_messages
  FOR SELECT TO authenticated
  USING (sender_id = public.current_app_user() OR receiver_id = public.current_app_user());
DROP POLICY IF EXISTS "ephemeral_voice_messages sender insert" ON public.ephemeral_voice_messages;
CREATE POLICY "ephemeral_voice_messages sender insert" ON public.ephemeral_voice_messages
  FOR INSERT TO authenticated
  WITH CHECK (sender_id = public.current_app_user()
          AND receiver_id <> public.current_app_user());

-- 验证（SQL Editor 以 postgres 执行，postgres 绕过 RLS 属正常；
-- 真正的权限验证用 REST 匿名请求，见 README）：
--   select tablename, policyname from pg_policies where schemaname='public' order by 1;
--
-- 回滚（恢复原 Allow all，仅应急）：
--   对每张表执行：
--   drop policy if exists "<对应策略>" on <表>;
--   create policy "Allow all on <表>" on <表> for all using (true) with check (true);
