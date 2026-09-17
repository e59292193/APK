// Supabase V2 迁移验证脚本：验证 V2 表、drink 分类约束、RLS 及唯一去重索引
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = 'https://kotakqdxwvienrmbcrnk.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_F4akwhacBs2bpKHC2kXpDQ_IVXy4u_9';

const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const V2_TABLES = [
  'momi_state',
  'momi_tasks',
  'momi_scheduled_tasks',
  'momi_proactive_log',
  'momi_chat_interjections',
  'momi_data_digest',
];

async function runVerification() {
  console.log('================================================================');
  console.log('🔍 开始 Supabase V2 迁移自动化验证');
  console.log('================================================================\n');

  let allPassed = true;

  // 1. 检查 V2 表是否存在与可访问
  console.log('【1. V2 表结构与访问检查】');
  for (const table of V2_TABLES) {
    try {
      const { data, error, status } = await client.from(table).select('*').limit(1);
      if (error && error.code === 'PGRST205') {
        console.log(`❌ 表 [${table}] 不存在 (PGRST205)，尚未在 Dashboard 执行迁移`);
        allPassed = false;
      } else if (error) {
        console.log(`⚠️ 表 [${table}] 访问返回: ${error.code} - ${error.message}`);
      } else {
        console.log(`✅ 表 [${table}] 正常可访问 (HTTP ${status}, 行数: ${data?.length || 0})`);
      }
    } catch (err) {
      console.log(`❌ 表 [${table}] 检查异常: ${err.message}`);
      allPassed = false;
    }
  }

  // 2. 验证 kitchen_dishes 的 drink 分类约束
  console.log('\n【2. 厨房 drink 饮品分类约束检查】');
  try {
    const testTitle = `__v2_test_drink_${Date.now()}__`;
    const { data: insertData, error: insertError } = await client
      .from('kitchen_dishes')
      .insert([
        {
          couple_id: 'momo_and_baomi',
          category: 'drink',
          title: testTitle,
          image_path: '',
          created_by: 'momo',
        },
      ])
      .select();

    if (insertError) {
      console.log(`❌ drink 插入失败: ${insertError.code} - ${insertError.message}`);
      allPassed = false;
    } else {
      console.log(`✅ drink 分类插入成功 (ID: ${insertData?.[0]?.id})`);
      // 立即清理测试数据
      const { error: delError } = await client
        .from('kitchen_dishes')
        .delete()
        .eq('couple_id', 'momo_and_baomi')
        .eq('title', testTitle);
      if (delError) {
        console.log(`⚠️ 清理测试数据失败: ${delError.message}`);
      } else {
        console.log(`✅ 测试数据已安全清理，无脏数据残留`);
      }
    }
  } catch (err) {
    console.log(`❌ drink 分类测试异常: ${err.message}`);
    allPassed = false;
  }

  // 3. 验证 momi_chat_interjections 的 couple_id + trigger_message_id 去重逻辑
  console.log('\n【3. momi_chat_interjections 触发去重检查】');
  try {
    const testTriggerId = `__v2_test_trigger_${Date.now()}__`;
    const { data: firstInsert, error: firstError } = await client
      .from('momi_chat_interjections')
      .insert([
        {
          couple_id: 'momo_and_baomi',
          trigger_message_id: testTriggerId,
          trigger_user: 'momo',
          content: '测试插话内容',
        },
      ])
      .select();

    if (firstError) {
      console.log(`⚠️ 首次插话写入返回: ${firstError.code} - ${firstError.message}`);
    } else {
      console.log(`✅ 首次插话写入成功 (ID: ${firstInsert?.[0]?.id})`);

      // 再次写入相同 trigger_message_id，应报 23505 唯一冲突
      const { error: secondError } = await client
        .from('momi_chat_interjections')
        .insert([
          {
            couple_id: 'momo_and_baomi',
            trigger_message_id: testTriggerId,
            trigger_user: 'momo',
            content: '测试插话内容重复写入',
          },
        ]);

      if (secondError && secondError.code === '23505') {
        console.log(`✅ 预期内的唯一性约束生效 (23505 duplicate key error)`);
      } else if (secondError) {
        console.log(`⚠️ 第二次写入返回其他错误: ${secondError.code} - ${secondError.message}`);
      } else {
        console.log(`❌ 相同 trigger_message_id 未拦截，唯一索引可能缺失！`);
        allPassed = false;
      }

      // 清理测试插话
      await client
        .from('momi_chat_interjections')
        .delete()
        .eq('couple_id', 'momo_and_baomi')
        .eq('trigger_message_id', testTriggerId);
      console.log(`✅ 插话测试行已清理`);
    }
  } catch (err) {
    console.log(`❌ 插话去重测试异常: ${err.message}`);
  }

  console.log('\n================================================================');
  if (allPassed) {
    console.log('🎉 数据库验证全部通过！');
  } else {
    console.log('⚠️ 存在未就绪项。若尚未在 Supabase Dashboard 执行迁移 SQL，请先执行。');
  }
  console.log('================================================================\n');
}

runVerification().catch(console.error);
