import type { SameKeysAs } from '../keys.ts';
import type { evaluation as enEvaluation } from '../en-US/evaluation.ts';

/** Evaluation Center — Simplified Chinese (spec §35–36). */
export const evaluation = {
  // Shell
  center: '评测中心',
  centerDescription: 'Agent 工程循环的基准评测结果 — 内部工具。',
  refresh: '刷新',
  overview: '概览',
  experiments: '实验',
  modelComparison: '模型对比',
  failureModes: '失败模式',
  loadingExperiments: '加载实验中…',
  retry: '重试',
  loadExperimentsFailed: '无法加载实验。',

  // Overview tab
  latestExperiment: '最近实验',
  latestExperimentNoSummary: '最近实验“{{name}}”还没有摘要。',
  noCompletedExperiments: '还没有完成的实验 — 请从 CLI 运行评测以在此查看结果。',
  viewSummary: '查看摘要',
  cases: '用例数',
  passRate: '通过率',
  composite: '综合得分',
  topFailureMode: '主要失败模式',
  completedCount: '{{count}} 已完成',
  runsScored: '{{count}} 次运行已评分',
  vsBaseline: '{{delta}} vs 基线',
  noBaseline: '无基线',
  runsCount: '{{count}} 次运行',
  noFailures: '无失败',
  perMetricBreakdown: '分指标明细',
  breakdownNote: '始终与综合得分一同展示（规格 §111）',

  // Table headers
  metric: '指标',
  kind: '类型',
  score: '得分',
  samples: '样本数',
  name: '名称',
  dataset: '数据集',
  model: '模型',
  git: 'Git',
  date: '日期',
  regressionColumn: '能力回退',
  status: '状态',
  actions: '操作',

  // Experiments tab
  noExperimentsRecorded: '还没有实验记录。',
  experimentsIntro: '{{count}} 个实验，最新优先。凡出现得分处都会显示样本数。',
  statusCompleted: '已完成',
  statusRunning: '运行中',
  statusQueued: '排队中',
  statusFailed: '失败',
  statusCancelled: '已取消',

  // Model comparison
  noCompletedToCompare: '还没有可比较的已完成实验。',
  modelComparisonIntro:
    '按模型分组的已完成实验。只显示确有数据的指标；空白单元格表示该模型未对该指标评分。',
  experimentCount: '{{count}} 个实验',

  // Metric ids → display; ids stay stable, only the label is translated (§35).
  metrics: {
    task_completion: '任务完成度',
    tool_recall: '必需工具覆盖',
    tool_precision: '工具准确率',
    tool_error_rate: '工具错误率',
    argument_validity: '工具参数有效性',
    max_tool_calls: '最大工具调用数',
    evidence_presence: '依据存在性',
    provenance_presence: '数据来源存在性',
    freshness_compliance: '数据时效合规',
    partial_failure_honesty: '部分失败诚实度',
    latency: '延迟',
    failure_recovery: '失败恢复',
    groundedness: '依据可信度',
    research_completeness: '研究完整性',
    financial_reasoning: '金融推理质量',
    decision_usefulness: '决策有用性',
    trajectory_quality: '执行轨迹质量',
  },
  metricKinds: {
    deterministic: '确定性',
    llmJudge: 'LLM 判官',
    trajectory: '轨迹',
    outcome: '结果',
  },

  // Failure mode ids → display; ids stay stable, only the label is translated.
  failureModeLabels: {
    wrong_tool: '工具选择错误',
    missing_tool: '缺失工具',
    wrong_args: '参数错误',
    tool_loop: '工具循环',
    duplicate_tool: '重复工具调用',
    ignored_tool_result: '忽略工具结果',
    provider_failure: '提供方故障',
    no_evidence: '无依据',
    unsupported_claim: '无据断言',
    premature_answer: '过早作答',
    context_miss: '上下文缺失',
    strategy_miss: '策略缺失',
    timeout: '超时',
    runtime_error: '运行时错误',
    judge_error: '判官错误',
    resource_unavailable: '资源不可用',
  },

  // Run statuses & verdicts written as chips.
  runStatuses: {
    completed: '已完成',
    failed: '失败',
    cancelled: '已取消',
    timeout: '超时',
    skipped: '已跳过',
    error: '出错',
    success: '成功',
  },
  verdicts: {
    pass: '通过',
    fail: '未通过',
    partial: '部分通过',
    notApplicable: '不适用',
  },
  noRun: '无运行',

  // Back / loading
  back: '返回',
  loadingCase: '加载用例中…',
  loadingExperiment: '加载实验中…',
  caseError: '用例 {{id}} 无法加载。',
  experimentError: '实验 {{id}} 无法加载。',
  noRunOrResult: '没有“{{name}}”中用例 {{id}} 的运行或评测记录。',
  caseTitle: '用例',

  // Case definition
  caseDefinition: '用例详情',
  prompt: '提示词',
  workspaceContext: '工作台上下文',
  expectedBehavior: '预期行为',
  forbiddenCapability: '禁止：{{cap}}',
  maxToolCalls: '≤{{count}} 次调用',
  evidenceRequired: '必须提供依据',
  caseDefUnavailable: '此用例定义的注释化提示词与预期行为不可用。',

  // Agent answer
  agentAnswer: 'Agent 回答',
  noAnswer: '此运行没有记录回答。',
  latency: '延迟 {{ms}}ms',

  // Tool timeline
  toolTimeline: '工具执行轨迹',
  calls: '{{count}} 次调用',
  tool: '工具',
  args: '参数',
  result: '结果',
  noToolCalls: '没有记录工具调用。',

  // Evaluator scores
  evaluatorScores: '评测得分',
  noScoresRecorded: '没有记录得分。',

  // Failure modes in case detail
  noFailuresRecorded: '没有记录失败。',
  openLangSmithTrace: '打开 LangSmith Trace',

  // Human review
  humanReview: '人工复核',
  humanReviewDescription: '将本次运行标记为 好/差 — 会写入人工反馈日志（规格 §82）。',
  good: '好',
  bad: '差',
  hideNote: '隐藏备注',
  addNote: '添加备注',
  notePlaceholder: '附加到下一次 👍/👎 的可选备注',
  feedbackRecorded: '反馈已记录（{{emoji}}）。',
  couldNotSubmitFeedback: '无法提交反馈。',

  // Experiment detail
  configuration: '配置',
  datasetLabel: '数据集',
  judgeLabel: '判官',
  thinkingLevel: '思考等级',
  started: '开始时间',
  completed: '完成时间',
  gitSha: 'Git SHA',
  runsMeta: '运行数',
  completedRuns: '{{completed}} / {{total}} 已完成',
  metricScores: '指标得分',
  compositeAndPassRate: '综合 {{score}} · 通过率 {{rate}}',
  runsSection: '运行',
  caseColumn: '用例',
  verdict: '判定',
  latencyColumn: '延迟',
  tools: '工具数',
  trace: 'Trace',
  langsmith: 'LangSmith',

  // Failure modes tab
  noExperimentsToInspect: '没有可检查的实验。',
  allExperiments: '所有实验',
  loadingDetails: '加载详情中…',
  failureSummary: '{{modes}} 种模式 · {{failures}} 次失败',
  filterByCaseId: '按用例 ID 筛选…',
  loadingExperimentDetails: '加载实验详情中…',
  noFailureMatch: '没有与用例筛选匹配的失败模式。',
  noFailureModesRecorded: '没有记录失败模式。',
  caseCount: '{{count}} 个用例',
  couldNotLoadDetails: '无法加载 {{count}} 个实验详情。',

  // Observational / insufficient data
  observationalOnly: '仅观察（样本不足）',
} satisfies SameKeysAs<typeof enEvaluation>;
