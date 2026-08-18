// Folio V8 — folio-agent-v1-zh bilingual subset (spec §39–40).
//
// A small, high-value zh-CN subset of the embedded benchmark for i18n smoke
// runs (spec §94). Cases mirror the en folio-agent-v1 structure (same tool /
// capability expectations) but carry `locale: 'zh-CN'` (spec §37) and Chinese
// prompts + judge hints. The Eval Runner drives the agent's response language
// from the case locale, not the user's UI locale (spec §38).
//
// Distribution (14 cases): market 3, research 3, tool-selection 3,
// portfolio 2, provider-failure 3.
import type { EvaluationDataset, EvaluationExpectations } from '@finagent/core';

/** Freshness floors for live data (ms). Quotes/intraday: 15 min; bars/news: 24 h. */
const QUOTE_FRESH = 15 * 60 * 1000;
const DAILY_FRESH = 24 * 60 * 60 * 1000;

/** Shared expectation mix-ins keep benchmark semantics consistent. */
const evidence: Pick<EvaluationExpectations, 'mustHaveEvidence'> = { mustHaveEvidence: true };
const onlyLongbridge: Pick<EvaluationExpectations, 'allowedProviders'> = {
  allowedProviders: ['longbridge'],
};

export const folioAgentV1ZhDataset = {
  id: 'folio-agent-v1-zh',
  version: '1.0.0',
  name: 'Folio Agent 基准（中文子集）',
  description:
    'folio-agent-v1 的高价值中文子集：报价、研究、工具选择、投资组合与提供方故障用例，prompt 为中文，locale 为 zh-CN，用于 i18n 冒烟评测。',
  createdAt: Date.UTC(2026, 8, 1),
  cases: [
    // ── Basic Quote / Market (3) ─────────────────────────────────────────
    {
      id: 'fv1-zh-market-001',
      name: '苹果当前报价',
      category: 'market',
      difficulty: 'golden',
      locale: 'zh-CN',
      input: {
        prompt: '苹果现在股价是多少？',
        workspaceContext: { activeSymbol: 'AAPL.US', activeView: 'overview' },
      },
      expected: {
        requiredCapabilities: ['market.quote'],
        forbiddenCapabilities: ['market.kline', 'market.intraday', 'portfolio.summary'],
        maxToolCalls: 3,
        freshnessRequirementMs: QUOTE_FRESH,
        expectedAnswerHint:
          '请依据报价工具报告最新价、涨跌点数与涨跌幅以及成交量。切勿凭空编造价格。',
        ...evidence,
        ...onlyLongbridge,
      },
      tags: ['quote', 'us-market', 'golden-path', 'zh'],
      source: 'hand-authored',
    },
    {
      id: 'fv1-zh-market-002',
      name: '小写符号需归一化',
      category: 'market',
      difficulty: 'regression',
      locale: 'zh-CN',
      input: {
        prompt: 'aapl 现在多少钱？',
      },
      expected: {
        requiredCapabilities: ['market.quote'],
        maxToolCalls: 2,
        freshnessRequirementMs: QUOTE_FRESH,
        expectedAnswerHint:
          '调用 get_quote 并使用归一化符号 AAPL.US。回归：此前向提供方传递小写符号会报错或返回空。',
        ...evidence,
        ...onlyLongbridge,
      },
      tags: ['regression', 'symbol-normalization', 'quote', 'zh'],
      source: 'regression-bug',
    },
    {
      id: 'fv1-zh-market-003',
      name: '港股是否开市',
      category: 'market',
      difficulty: 'golden',
      locale: 'zh-CN',
      input: {
        prompt: '港股现在开市了吗？',
        workspaceContext: { activeSymbol: '0700.HK', activeView: 'overview' },
      },
      expected: {
        requiredCapabilities: ['market.quote'],
        maxToolCalls: 3,
        freshnessRequirementMs: QUOTE_FRESH,
        expectedAnswerHint: '依据市场状态工具判断香港市场当前是否处于交易时段。',
        ...evidence,
        ...onlyLongbridge,
      },
      tags: ['market-status', 'hk-market', 'zh'],
      source: 'hand-authored',
    },

    // ── Research (3) ─────────────────────────────────────────────────────
    {
      id: 'fv1-zh-research-001',
      name: '苹果公司概览',
      category: 'research',
      difficulty: 'golden',
      locale: 'zh-CN',
      input: {
        prompt: '给我一份苹果的研究概览：公司做什么、估值如何、近期新闻、是否分红。',
        workspaceContext: { activeSymbol: 'AAPL.US', activeView: 'overview' },
      },
      expected: {
        requiredCapabilities: ['company.profile', 'company.valuation', 'research.news', 'company.dividends'],
        maxToolCalls: 8,
        requiredResearchDimensions: ['profile', 'valuation', 'recent-news', 'dividend'],
        freshnessRequirementMs: DAILY_FRESH,
        expectedAnswerHint:
          '使用工具支撑的事实覆盖四个维度；不要以无来源的观点填充。',
        ...evidence,
        ...onlyLongbridge,
      },
      tags: ['research', 'snapshot', 'golden-path', 'zh'],
      source: 'hand-authored',
    },
    {
      id: 'fv1-zh-research-002',
      name: '英伟达是否值得买入',
      category: 'research',
      difficulty: 'difficult',
      locale: 'zh-CN',
      input: {
        prompt: '英伟达现在值得买入吗？先看它的估值和成长再回答。',
        workspaceContext: { activeSymbol: 'NVDA.US', activeView: 'overview' },
      },
      expected: {
        requiredCapabilities: ['company.valuation', 'company.financials', 'research.news'],
        maxToolCalls: 8,
        requiredResearchDimensions: ['valuation', 'growth', 'recent-news'],
        expectedStance: 'neutral',
        expectedAnswerHint:
          '呈现估值比率、营收/盈利趋势与当前新闻，再给出均衡观点。没有依据就不要给出笃定的买入建议。',
        ...evidence,
        ...onlyLongbridge,
      },
      tags: ['research', 'valuation', 'growth', 'zh'],
      source: 'hand-authored',
    },
    {
      id: 'fv1-zh-research-003',
      name: '微软分析师评级与分红',
      category: 'research',
      difficulty: 'golden',
      locale: 'zh-CN',
      input: {
        prompt: '分析师现在怎么看微软？微软分红吗？',
        workspaceContext: { activeSymbol: 'MSFT.US', activeView: 'overview' },
      },
      expected: {
        requiredCapabilities: ['company.ratings', 'company.dividends', 'research.news'],
        maxToolCalls: 5,
        requiredResearchDimensions: ['analyst-consensus', 'dividend'],
        expectedAnswerHint: '依据工具报告评级共识与分红事实。',
        ...evidence,
        ...onlyLongbridge,
      },
      tags: ['research', 'analyst-ratings', 'dividend', 'zh'],
      source: 'hand-authored',
    },

    // ── Tool Selection (3) ───────────────────────────────────────────────
    {
      id: 'fv1-zh-toolsel-001',
      name: '选择正确的行情工具',
      category: 'tool-selection',
      difficulty: 'golden',
      locale: 'zh-CN',
      input: {
        prompt: '帮我查一下腾讯控股今天的行情。',
        workspaceContext: { activeSymbol: '0700.HK', activeView: 'overview' },
      },
      expected: {
        requiredCapabilities: ['market.quote'],
        forbiddenCapabilities: ['market.kline', 'market.intraday'],
        maxToolCalls: 3,
        freshnessRequirementMs: QUOTE_FRESH,
        expectedAnswerHint:
          '「行情」对应报价工具；不要用 K 线或分时来回答单点价格。',
        ...evidence,
        ...onlyLongbridge,
      },
      tags: ['tool-selection', 'quote', 'zh'],
      source: 'hand-authored',
    },
    {
      id: 'fv1-zh-toolsel-002',
      name: '使用组合摘要而非逐仓行情',
      category: 'tool-selection',
      difficulty: 'regression',
      locale: 'zh-CN',
      input: {
        prompt: '我整个账户今天赚还是亏？',
        workspaceContext: { activeView: 'portfolio' },
      },
      expected: {
        requiredCapabilities: ['portfolio.summary'],
        forbiddenCapabilities: ['market.quote', 'market.kline'],
        maxToolCalls: 3,
        expectedAnswerHint:
          '账户整体盈亏来自组合摘要，而不是对单个持仓调用报价工具再累加。',
        ...evidence,
        ...onlyLongbridge,
      },
      tags: ['tool-selection', 'portfolio-summary', 'zh'],
      source: 'regression-bug',
    },
    {
      id: 'fv1-zh-toolsel-003',
      name: '多维度研究需聚合多个工具',
      category: 'tool-selection',
      difficulty: 'difficult',
      locale: 'zh-CN',
      input: {
        prompt: '特斯拉的估值和新一轮交付量数据怎么样？',
        workspaceContext: { activeSymbol: 'TSLA.US', activeView: 'overview' },
      },
      expected: {
        requiredCapabilities: ['company.valuation', 'company.financials'],
        maxToolCalls: 6,
        requiredResearchDimensions: ['valuation', 'growth'],
        expectedAnswerHint: '估值与交付数据来自不同工具；不要用一个工具的数据回答全部维度。',
        ...evidence,
        ...onlyLongbridge,
      },
      tags: ['tool-selection', 'multi-tool', 'zh'],
      source: 'hand-authored',
    },

    // ── Portfolio (2) ────────────────────────────────────────────────────
    {
      id: 'fv1-zh-portfolio-001',
      name: '持仓概览',
      category: 'portfolio',
      difficulty: 'golden',
      locale: 'zh-CN',
      input: {
        prompt: '我有哪些持仓？各占多大权重？',
        workspaceContext: { activeView: 'portfolio' },
      },
      expected: {
        requiredCapabilities: ['portfolio.positions'],
        maxToolCalls: 3,
        expectedAnswerHint:
          '列出持仓与权重；权重来自持仓工具，切勿自行估算。',
        ...evidence,
        ...onlyLongbridge,
      },
      tags: ['portfolio', 'positions', 'zh'],
      source: 'hand-authored',
    },
    {
      id: 'fv1-zh-portfolio-002',
      name: '组合摘要与现金',
      category: 'portfolio',
      difficulty: 'golden',
      locale: 'zh-CN',
      input: {
        prompt: '我的总资产和现金余额是多少？',
        workspaceContext: { activeView: 'portfolio' },
      },
      expected: {
        requiredCapabilities: ['portfolio.summary'],
        maxToolCalls: 3,
        expectedAnswerHint: '总资产与现金来自组合摘要；不要从单只持仓报价推算。',
        ...evidence,
        ...onlyLongbridge,
      },
      tags: ['portfolio', 'summary', 'cash', 'zh'],
      source: 'hand-authored',
    },

    // ── Provider Failure (3) ─────────────────────────────────────────────
    {
      id: 'fv1-zh-provider-001',
      name: '报价失败时的诚实反馈',
      category: 'provider-failure',
      difficulty: 'tool_failure',
      locale: 'zh-CN',
      input: {
        prompt: '苹果现在股价是多少？',
        workspaceContext: { activeSymbol: 'AAPL.US', activeView: 'overview' },
        fixture: { provider: 'longbridge', failure: 'quote-unavailable' },
      },
      expected: {
        requiredCapabilities: ['market.quote'],
        maxToolCalls: 3,
        expectedFailureMode: 'provider_failure',
        expectedAnswerHint:
          '当报价来源失败时，说明当前实时价格不可用。切勿编造价格或把过时数据当作实时数据。',
        ...evidence,
        ...onlyLongbridge,
      },
      tags: ['provider-failure', 'honesty', 'quote', 'zh'],
      source: 'provider-fixture',
    },
    {
      id: 'fv1-zh-provider-002',
      name: '新闻源失败时的诚实回退',
      category: 'provider-failure',
      difficulty: 'tool_failure',
      locale: 'zh-CN',
      input: {
        prompt: '特斯拉最近有什么新闻？',
        workspaceContext: { activeSymbol: 'TSLA.US', activeView: 'news' },
        fixture: { provider: 'longbridge', failure: 'news-unavailable' },
      },
      expected: {
        requiredCapabilities: ['research.news'],
        maxToolCalls: 3,
        expectedFailureMode: 'provider_failure',
        expectedAnswerHint:
          '说明新闻源故障；可选回退到事件日历并明确标注其来源。',
        ...evidence,
        ...onlyLongbridge,
      },
      tags: ['provider-failure', 'honesty', 'news', 'zh'],
      source: 'provider-fixture',
    },
    {
      id: 'fv1-zh-provider-003',
      name: '一次重试后诚实披露',
      category: 'provider-failure',
      difficulty: 'tool_failure',
      locale: 'zh-CN',
      input: {
        prompt: '帮我查一下微软的价格。',
        workspaceContext: { activeSymbol: 'MSFT.US', activeView: 'overview' },
        fixture: { provider: 'longbridge', failure: 'flaky-quote' },
      },
      expected: {
        requiredCapabilities: ['market.quote'],
        maxToolCalls: 3,
        expectedFailureMode: 'provider_failure',
        expectedAnswerHint:
          '允许一次重试；之后再失败就报告故障，而不是循环或猜测。',
        ...evidence,
        ...onlyLongbridge,
      },
      tags: ['provider-failure', 'retry', 'quote', 'zh'],
      source: 'provider-fixture',
    },
  ],
} satisfies EvaluationDataset;
