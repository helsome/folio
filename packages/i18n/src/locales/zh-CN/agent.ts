import type { SameKeysAs } from '../keys.ts';
import type { agent as enAgent } from '../en-US/agent.ts';

/** Agent panel + chat chrome — Simplified Chinese. */
export const agent = {
  panel: {
    title: 'Agent Copilot',
    collapsePanel: '收起面板',
    inputPlaceholder: '向 Copilot 提问…',
    inputRunningPlaceholder: 'Agent 运行中…',
    sendMessage: '发送消息',
    stop: '停止',
    agentRunning: 'Agent 运行中',
    thinking: '思考中…',
  },
  runtime: {
    unavailable: 'Agent 不可用',
    failedToStart: 'Pi 运行时启动失败。',
    reasonNoModel: '未配置模型。',
    reasonEnvMissing: '缺少提供方凭据。',
    reasonExtension: '运行时扩展加载失败。',
    reasonCommand: '找不到运行时命令。',
    reasonUnknown: 'Agent 运行时不可用。',
    retry: '重试',
    openDiagnostics: '打开诊断',
    detailsLabel: '高级详情',
  },
  empty: {
    body: '开始新会话，让 Agent 为你探索市场。',
    createSession: '创建新会话',
  },
  context: {
    none: '暂无证券上下文',
    clear: '清除证券上下文',
  },
  model: {
    label: '模型',
    loading: '加载模型中…',
    select: '选择模型',
    none: '暂无可用模型',
  },
  reasoning: {
    label: '推理',
    withLevel: '推理：{{level}}',
    unavailable: '当前运行时不可用思考等级',
  },
  tool: {
    running: '正在处理市场数据',
    analyzedSources_one: '分析了 {{count}} 个数据源',
    analyzedSources_other: '分析了 {{count}} 个数据源',
    statusRunning: '运行中',
    label: '工具：{{name}}',
    calls: '工具调用',
    names: {
      getQuote: '获取最新行情',
      getPortfolio: '获取持仓概况',
      getFinancials: '查看财务表现',
      getValuation: '分析估值',
      getNews: '检查最新新闻',
      getKline: '获取K线图',
      getEarnings: '检查财报信息',
      getProfile: '查看公司概况',
      analyze: '分析中',
      other: '获取数据',
    },
  },
  quote: {
    title: '行情',
    open: '开盘',
    high: '最高',
    low: '最低',
    prevClose: '昨收',
    volume: '成交量',
    updated: '更新于',
  },
  risk: {
    title: '投资组合风险',
    totalValue: '总资产',
    cash: '现金',
    cashPct: '现金占比',
    largestPosition: '最大持仓',
    largestWeight: '最大权重',
    positions: '持仓数',
  },
  chat: {
    noMessages: '还没有消息，开始对话吧！',
  },
  suggestions: {
    title: '试试问',
    research: [
      '为什么得出这个结论？',
      '最大的风险是什么？',
      '哪条证据最关键？',
    ],
    portfolio: [
      '我最大的风险是什么？',
      '哪些持仓集中度过高？',
      '今天哪些持仓值得关注？',
    ],
    discover: [
      '研究排名靠前的候选',
      '比较前两名候选',
    ],
    compare: [
      '对我的目标来说哪个更强？',
      '关键差异是什么？',
    ],
    thesis: [
      '这个投资逻辑还成立吗？',
      '什么会推翻它？',
    ],
    watchlist: [
      '今天什么在驱动行情？',
      '今天哪只标的有看点？',
    ],
    default: [
      '今天应该关注什么？',
      '总结一下今天的市场。',
    ],
  },
} satisfies SameKeysAs<typeof enAgent>;
