import type { SameKeysAs } from '../keys.ts';
import type { trace as enTrace } from '../en-US/trace.ts';

/** Trace Inspector（V9.1 §8–11）— 渐进式披露的 Agent 运行调试界面。 */
export const trace = {
  notRecorded: '未记录',
  tabs: {
    overview: '概览',
    timeline: '时间线',
    context: '上下文',
    details: '详情',
  },
  status: {
    success: '成功',
    error: '失败',
  },
  completeness: {
    complete: '完整',
    completeHint: '运行记录、工具调用、运行时元数据与追踪引用均可用。',
    partial: '部分',
    partialHint: '部分证据缺失 —— 结论只反映当前可见的内容。',
    minimal: '最小',
    minimalHint: '该追踪仅有最基本的运行数据。',
  },
  contextSource: {
    recorded: '已记录',
    'evaluation-input': '评测输入',
    runtime: 'Pi 运行时',
    live: '实时',
    'not-recorded': '未记录',
  },
  elementSource: {
    event: 'Agent 事件',
    message: '对话记录',
    'trace-event': '运行时事件',
    run: '运行记录',
    evaluation: '评测记录',
    langsmith: 'LangSmith',
  },
  overview: {
    title: '追踪',
    run: '运行',
    input: '输入',
    answer: '回答',
    error: '错误',
    latency: '{{seconds}} 秒',
    tools: '{{count}} 个工具',
    steps: '{{count}} 个步骤',
    status: '状态',
    sources: '数据来源',
    noAnswer: '未记录回答。',
  },
  evaluation: {
    title: '评测结论',
    verdict: '判定',
    failureMode: '失败模式',
    expected: '预期',
    actual: '实际',
    score: '得分',
    note: '评测结论是对运行的判断 —— 不属于执行时间线的一部分。',
  },
  context: {
    title: '上下文',
    field: '字段',
    value: '值',
    source: '来源',
    explanation:
      '上下文只展示有可靠来源的字段。从未被记录的字段会标记为「未记录」—— 应用不会猜测历史上下文。',
  },
  details: {
    title: '详情',
    sources: '贡献数据源',
    traceRef: '追踪引用',
    budget: '上下文预算',
    budgetNotRecorded: '本次运行未记录详细的上下文预算。',
    budgetInput: '输入 tokens',
    budgetOutput: '输出 tokens',
    budgetTotal: '总 tokens',
    budgetCacheRead: '缓存读取',
    budgetCacheWrite: '缓存写入',
  },
  actions: {
    openLangSmith: '在 LangSmith 中打开',
    close: '关闭',
  },
  footer: {
    completed: '已完成 · {{seconds}} 秒 · {{steps}} 个步骤',
    failed: '失败 · {{tools}} 个工具',
    trace: '追踪',
  },
} satisfies SameKeysAs<typeof enTrace>;
