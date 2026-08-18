import type { SameKeysAs } from '../keys.ts';
import type { onboarding as enOnboarding } from '../en-US/onboarding.ts';

/** First-run onboarding — Simplified Chinese (spec §27–30, §71–72). Provider/model ids stay untranslated (§11). */
export const onboarding = {
  setupAria: 'Folio 设置',
  setupTitle: '设置 Folio',
  stepPrefix: '第 {{index}} 步，共 {{total}} 步',
  skip: '暂时跳过',
  back: '返回',
  continue: '继续',
  startFolio: '开始使用 Folio',
  language: '语言',
  welcome: {
    title: '欢迎使用 Folio',
    titleShort: '欢迎',
    subtitle:
      '只需几分钟即可完成设置，让市场数据和 AI 完成连接。你可以跳过任何步骤，稍后在设置中返回。',
    accept: '我理解并接受这些条款。',
    disclaimerPrivacyTitle: '隐私',
    disclaimerPrivacyBody:
      'Folio 在本地设备上运行。API 密钥和凭据存储在你的机器上，绝不会被共享。市场数据提供方只会收到通过你自己的账户发起的请求。',
    disclaimerAiTitle: 'AI 分析',
    disclaimerAiBody:
      'AI 生成的分析仅供参考，可能不准确或不完整。在依赖其结论前请务必核实。',
    disclaimerFinancialTitle: '金融信息',
    disclaimerFinancialBody:
      'Folio 中的任何内容均不构成投资建议。市场数据可能有延迟。你对自身的投资决策负全部责任。',
  },
  connectAi: {
    title: '连接 AI',
    titleShort: '连接 AI',
    subtitle: '选择 LLM 提供方、添加其凭据并挑选模型。',
    model: '模型',
    providersCredentials: '提供方与凭据',
    loadingProviders: '正在加载提供方…',
    configured: '已配置',
    apiKey: 'API 密钥',
    save: '保存',
    test: '测试',
  },
  providerStep: {
    notAvailable:
      '此版本中该提供方尚不可用——稍后可从设置 → 连接中连接。',
    recommended: '推荐',
  },
  broker: {
    title: '券商账户（可选）',
    titleShort: '券商账户',
    subtitle: '连接你的 Longbridge 券商账户以获取投资组合、持仓和现金流。',
  },
  connectData: {
    title: '连接金融数据',
    titleShort: '连接金融数据',
    subtitle: 'Longbridge 提供美国、香港、中国大陆和新加坡市场的行情、K 线与公司数据。',
  },
  environment: {
    title: '检查环境',
    titleShort: '检查环境',
    subtitle: '快速检查你所连接的一切是否已就绪可用。',
    checking: '正在检查环境…',
    notAvailable: '此版本中健康检查尚不可用。',
    ready: '就绪',
    unavailable: '不可用',
    itemAi: 'AI',
    itemMarketData: '市场数据',
    itemSkills: '技能',
    itemAgentRuntime: 'Agent 运行时',
  },
} satisfies SameKeysAs<typeof enOnboarding>;
