// ═══════════════════════════════════════════════════════
// momiDataAccess 隐私铁律与意图路由测试
// 用链式 mock 记录所有 supabase 调用，断言：
//   1. time_capsules 查询一定带 opened_at 过滤
//   2. 未开封场景 select 字段不包含 content
//   3. 小纸条绝不读取 content / sender_id
// ═══════════════════════════════════════════════════════

const mockQueryLog = [];
let mockMaybeSingleData = null;

jest.mock('../supabase', () => ({
  supabase: {
    from: jest.fn((table) => {
      const entry = { table, ops: [] };
      mockQueryLog.push(entry);
      const builder = {
        select(cols, opts) { entry.ops.push({ m: 'select', cols, opts }); return builder; },
        eq(k, v) { entry.ops.push({ m: 'eq', k, v }); return builder; },
        not(k, op, v) { entry.ops.push({ m: 'not', k, op, v }); return builder; },
        is(k, v) { entry.ops.push({ m: 'is', k, v }); return builder; },
        gte(k, v) { entry.ops.push({ m: 'gte', k, v }); return builder; },
        ilike(k, v) { entry.ops.push({ m: 'ilike', k, v }); return builder; },
        order(k, o) { entry.ops.push({ m: 'order', k, o }); return builder; },
        limit(n) { entry.ops.push({ m: 'limit', n }); return builder; },
        upsert(rows, opts) { entry.ops.push({ m: 'upsert', rows, opts }); return builder; },
        insert(rows) { entry.ops.push({ m: 'insert', rows }); return builder; },
        maybeSingle() { return Promise.resolve({ data: mockMaybeSingleData, error: null }); },
        then(resolve) { return resolve({ data: [], count: 0, error: null }); },
      };
      return builder;
    }),
    storage: {
      from: jest.fn(() => ({
        list: jest.fn(async () => ({ data: [], error: null })),
      })),
    },
  },
}));

jest.mock('../fetchWithTimeout', () => ({
  fetchWithTimeout: (fn) => fn(),
}));

import {
  getOpenedCapsulesSummary,
  getUnopenedCapsuleCount,
  getEphemeralSummary,
  getKitchenSummary,
  queryByIntent,
} from '../momiDataAccess';

function opsFor(table) {
  return mockQueryLog.filter((e) => e.table === table);
}

describe('momiDataAccess 隐私铁律', () => {
  beforeEach(() => {
    mockQueryLog.length = 0;
    mockMaybeSingleData = null;
  });

  test('已开封信件查询：必须带 opened_at IS NOT NULL 过滤（才允许含 content）', async () => {
    await getOpenedCapsulesSummary(5);
    const entries = opsFor('time_capsules');
    expect(entries.length).toBe(1);
    const ops = entries[0].ops;
    const notOp = ops.find((o) => o.m === 'not');
    expect(notOp).toEqual({ m: 'not', k: 'opened_at', op: 'is', v: null });
    // 有过滤的前提下 select 才允许包含 content
    const selectOp = ops.find((o) => o.m === 'select');
    expect(selectOp.cols).toContain('content');
  });

  test('未开封信件：只 COUNT，select 字段绝不包含 content', async () => {
    await getUnopenedCapsuleCount();
    const entries = opsFor('time_capsules');
    expect(entries.length).toBe(1);
    const ops = entries[0].ops;
    const selectOp = ops.find((o) => o.m === 'select');
    expect(selectOp.cols).toBe('id');
    expect(selectOp.opts).toEqual({ count: 'exact', head: true });
    expect(selectOp.cols).not.toContain('content');
    const isOp = ops.find((o) => o.m === 'is');
    expect(isOp).toEqual({ m: 'is', k: 'opened_at', v: null });
  });

  test('小纸条（阅后即焚）：只统计数量，绝不读取 content / sender_id', async () => {
    await getEphemeralSummary();
    const entries = opsFor('ephemeral_notes');
    expect(entries.length).toBe(1);
    const selectOp = entries[0].ops.find((o) => o.m === 'select');
    expect(selectOp.cols).toBe('receiver_id');
    expect(selectOp.cols).not.toContain('content');
    expect(selectOp.cols).not.toContain('sender_id');
  });

  test('菜品摘要：不拉取 recipe_text 等重字段', async () => {
    await getKitchenSummary();
    const entries = opsFor('kitchen_dishes');
    expect(entries.length).toBeGreaterThan(0);
    const selectOp = entries[0].ops.find((o) => o.m === 'select');
    expect(selectOp.cols).not.toContain('recipe_text');
  });
});

describe('momiDataAccess 意图路由', () => {
  beforeEach(() => {
    mockQueryLog.length = 0;
  });

  test('打卡类问题路由到 checkin', async () => {
    const r = await queryByIntent('我们连续打卡多少天了？');
    expect(r && r.intent).toBe('checkin');
  });

  test('厨房类问题路由到 kitchen（含饮品关键词）', async () => {
    const r = await queryByIntent('这周想喝点什么？');
    expect(r && r.intent).toBe('kitchen');
  });

  test('纪念日 / 愿望 / 游戏 / 胶囊路由正确', async () => {
    expect((await queryByIntent('我们在一起多少天了'))?.intent).toBe('anniversary');
    expect((await queryByIntent('愿望清单还剩几个'))?.intent).toBe('wishlist');
    expect((await queryByIntent('五子棋我赢了几次'))?.intent).toBe('games');
    expect((await queryByIntent('有没有未拆开的信'))?.intent).toBe('capsules');
  });

  test('无关问题不触发查库', async () => {
    const r = await queryByIntent('今天心情不错呀');
    expect(r).toBeNull();
  });
});
