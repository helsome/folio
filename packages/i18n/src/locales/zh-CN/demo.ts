import type { SameKeysAs } from '../keys.ts';
import type { demo as enDemo } from '../en-US/demo.ts';

/** 内置示例数据文案 — 凡展示示例数据处均配有「示例数据」徽标。 */
export const demo = {
  badge: '示例数据',
  hint: '内置示例内容。在「设置」中接入行情数据源与 AI 模型后，即可查看你的真实数据。',
  brief: {
    summary: '今天有 2 项内容需要你关注',
    quiet: '2 只监控标的未超过关注阈值。',
    riskTitle: 'AAPL 监管风险或影响 Q4 利润率',
    riskMessage: '欧盟 App Store 裁决在即，或小幅影响服务业务利润率。建议操作：复核压力测试模型。',
    rotationTitle: '板块轮动：科技动能降温',
    rotationMessage: '科技板块动能放缓，医疗保健显示防御性走强。建议审视防御性配置。',
  },
  events: {
    earningsName: 'AAPL 财报电话会（Q3）',
    earningsContent: '盘后发布季度业绩与指引。',
    macroName: 'PCE 通胀数据',
    macroContent: '核心 PCE 公布，美联储重点参考的通胀指标。',
    fomcName: 'FOMC 新闻发布会',
    fomcContent: '利率决议与前瞻指引，重点关注通胀表态。',
  },
} satisfies SameKeysAs<typeof enDemo>;
