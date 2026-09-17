# momi-chat-worker 部署与验证

> 状态：仓库已包含 worker 代码，但**尚未部署，也未修改线上 Supabase**。
> 所有命令中的值都是占位符；不要把真实 secret、service-role key 或模型密钥提交到 Git。

## 作用

`momi-chat-worker` 从 `momi_chat_jobs` 原子领取任务，在 App 页面关闭或进程被杀后继续生成 momi 回复：

1. `claim_momi_chat_job`：`SKIP LOCKED` + lease 领取一条任务；过期 `processing` lease 可由下一次 claim 回收。
2. 回查同一 couple 的 canonical user message。
3. 读取短期历史与经过硬过滤的可信记忆；历史 assistant 文案事实权重为 0。
4. 调用服务端配置的 OpenAI-compatible HTTPS 接口。
5. `complete_momi_chat_job`：以 `momi-chat:<source client_message_id>` 幂等写入唯一回复。
6. 失败时调用 `fail_momi_chat_job`，最多 5 次并指数退避。

移动端不调用该函数，也不保存 worker secret、service-role key 或模型 API key。

## 前置条件

正式迁移以 `supabase/migrations` 为唯一部署来源。先备份数据库，再**按顺序**执行：

1. `supabase/migrations/0007_momi_v5_memory_history.sql`
2. `supabase/migrations/0008_momi_v5_atomic_rpc.sql`

全新或迁移历史完整的环境可由 Supabase CLI 应用待执行迁移；已有手工迁移历史的项目，应先核对记录，再在 SQL Editor 逐份执行上述文件。`src/lib/momi_v5_*.sql` 是旧兼容副本，不得替代正式迁移。两份正式 SQL 当前仍只是仓库文件；没有自动应用到线上。

只做结构检查（不输出消息正文）：

```sql
select to_regclass('public.momi_chat_jobs') is not null as has_jobs;
select proname
from pg_proc
where proname in (
  'claim_momi_chat_job',
  'complete_momi_chat_job',
  'fail_momi_chat_job'
)
order by proname;
```

## 设置服务端 Secrets

生成至少 32 字节的随机 worker secret。示例命令中的值必须替换：

```bash
supabase secrets set \
  MOMI_WORKER_SECRET='<随机高熵值>' \
  MOMI_AI_BASE_URL='https://provider.example/v1' \
  MOMI_AI_API_KEY='<仅服务端模型密钥>' \
  MOMI_AI_MODEL='<模型名>' \
  MOMI_AI_TIMEOUT_MS='25000'
```

托管 Supabase Edge Functions 会提供 `SUPABASE_URL` 与 `SUPABASE_SERVICE_ROLE_KEY`。如果使用自托管运行时，必须通过运行时 secret 注入，绝不能写进源码或 `.env` 后提交。

## 部署

函数使用自定义高熵 secret 鉴权，因此关闭平台 JWT 校验；函数内部仍会执行常量时间摘要比较：

```bash
supabase functions deploy momi-chat-worker --no-verify-jwt
```

## 健康检查

GET 只返回配置是否齐全，不领取 job，也不返回任何用户内容：

```bash
curl -fsS \
  -H 'x-momi-worker-secret: <MOMI_WORKER_SECRET>' \
  'https://<PROJECT_REF>.supabase.co/functions/v1/momi-chat-worker'
```

预期：

```json
{"ok":true,"configured":{"database":true,"model":true}}
```

无 secret 或错误 secret 必须返回 `401`。

## 手动处理与调度

每次最多领取 5 条；建议生产调度每次 1-2 条，避免超过 Edge Function 时限：

```bash
curl -fsS -X POST \
  -H 'content-type: application/json' \
  -H 'x-momi-worker-secret: <MOMI_WORKER_SECRET>' \
  -d '{"maxJobs":2}' \
  'https://<PROJECT_REF>.supabase.co/functions/v1/momi-chat-worker'
```

响应只包含领取/成功/失败数量与脱敏错误码。

调度可使用受控的外部 scheduler，或 Supabase Cron + Vault/HTTP。要求：

- secret 必须来自 scheduler secret store / Vault，不得直接写进 SQL 或脚本仓库。
- 建议每分钟调用一次，`maxJobs=2`。
- 禁止从 APK 直接触发 worker。
- 多个并发调度器是安全的：数据库通过 `FOR UPDATE SKIP LOCKED` 与 lease 防止重复领取。

## 验收

1. 在助手页发送一条纯文本消息，确认 `momi_chat_jobs` 出现 `pending`。
2. 关闭 App 或杀掉进程。
3. 调用 worker。
4. 只看状态和数量：

```sql
select status, count(*)
from public.momi_chat_jobs
group by status
order by status;

select count(*) as duplicate_generation_groups
from (
  select generation_key
  from public.momi_assistant_messages
  where generation_key is not null
  group by generation_key
  having count(*) > 1
) duplicates;
```

预期：任务最终为 `completed`，`duplicate_generation_groups = 0`。重新打开任意一方的助手页，应通过 Realtime/历史恢复看到唯一回复。

## 失败与回滚

- 模型超时、429、5xx：任务进入 `retryable`，退避最长 15 分钟；worker 崩溃后的过期 `processing` lease 会被下一次 claim 回收。
- 非重试 4xx、无效 actor、源消息不存在：任务进入 `failed`。
- 紧急停用：先关闭 scheduler，再删除/停用 Edge Function；数据库消息、outbox 与 job 均不会被删除。
- 不要手工把失败任务批量改成 `completed`。修复配置后，仅对确认可重试的任务改回 `retryable`。

## 当前限制

- 当前 worker 仅保证**文本消息**后台回复。图片只会以 `[图片消息]` 占位，不会假装看见图片；服务端视觉输入需独立实现和测试。
- worker 不执行客户端业务动作（例如创建提醒、查询天气/菜谱）。没有权威执行结果时，它只确认收到需求，不会谎称已完成。
- 尚未在真实 PostgreSQL 空库执行 V5 两份 SQL 两遍，也尚未部署 Edge Function；PR 验收时必须如实记录为未验证项，直到实际完成。
