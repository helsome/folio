import type { SameKeysAs } from '../keys.ts';
import type { agent as enAgent } from '../en-US/agent.ts';

/** Agent panel + chat chrome — Simplified Chinese. */
export const agent = {
  panel: {
    collapsePanel: '收起面板',
    inputPlaceholder: '向 Copilot 提问…',
    inputRunningPlaceholder: 'Agent 运行中…',
    sendMessage: '发送消息',
    stop: '停止',
    agentRunning: 'Agent 运行中',
    thinking: '思考中…',
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
} satisfies SameKeysAs<typeof enAgent>;
