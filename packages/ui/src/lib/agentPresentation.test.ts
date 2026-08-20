import { describe, expect, it } from 'bun:test';
import {
  hasSemanticToolLabel,
  semanticCapabilityLabelKey,
  semanticCompletenessLabelKey,
  semanticContextSourceLabelKey,
  semanticStatusLabelKey,
  semanticToolCategory,
  semanticToolLabelKey,
} from './agentPresentation';

describe('agentPresentation (V9.1 shared layer)', () => {
  it('maps every targeted capability id to a user-facing i18n key', () => {
    const ids = [
      'market.quote',
      'market.kline',
      'market.intraday',
      'market.trades',
      'market.depth',
      'market.status',
      'market.capitalFlow',
      'company.profile',
      'company.valuation',
      'company.financials',
      'company.earnings',
      'company.dividends',
      'company.ratings',
      'research.news',
      'research.events',
      'portfolio.summary',
    ];
    for (const id of ids) {
      const key = semanticCapabilityLabelKey(id);
      expect(key, `${id} should have a label key`).not.toBe('agent.tool.names.other');
      expect(key.startsWith('research.capabilities.')).toBe(true);
    }
  });

  it('maps agent tool names to shared labels (no second dictionary)', () => {
    expect(semanticToolLabelKey('get_quote')).toBe('agent.tool.names.getQuote');
    expect(semanticToolLabelKey('get_financials')).toBe('agent.tool.names.getFinancials');
    expect(semanticToolLabelKey('get_news')).toBe('agent.tool.names.getNews');
    expect(semanticToolLabelKey('unknown_tool')).toBe('agent.tool.names.other');
    expect(hasSemanticToolLabel('get_quote')).toBe(true);
    expect(hasSemanticToolLabel('unknown_tool')).toBe(false);
  });

  it('categories tools into stable groups', () => {
    expect(semanticToolCategory('get_quote')).toBe('market');
    expect(semanticToolCategory('get_financials')).toBe('company');
    expect(semanticToolCategory('get_news')).toBe('research');
    expect(semanticToolCategory('get_portfolio')).toBe('portfolio');
    expect(semanticToolCategory('nope')).toBe('other');
  });

  it('status / completeness / context-source labels are stable keys', () => {
    expect(semanticStatusLabelKey('running')).toBe('agent.tool.statusRunning');
    expect(semanticStatusLabelKey('error')).toBe('trace.status.error');
    expect(semanticStatusLabelKey('success')).toBe('trace.status.success');
    expect(semanticCompletenessLabelKey('partial')).toBe('trace.completeness.partial');
    expect(semanticContextSourceLabelKey('evaluation-input')).toBe('trace.contextSource.evaluation-input');
  });
});
