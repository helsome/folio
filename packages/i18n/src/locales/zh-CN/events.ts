import type { SameKeysAs } from '../keys.ts';
import type { events as enEvents } from '../en-US/events.ts';

export const events = {
  eyebrow: '市场日历',
  title: '事件与催化剂',
  subtitle: '查看可能影响当前投资组合的即将发生事件与财报。',
  upcomingEyebrow: '今日及之后',
  upcomingTitle: '即将发生',
  loading: '正在加载即将发生的事件…',
  empty: '暂无可用的即将发生事件。连接行情数据提供商后即可填充此页面。',
  loadError: '暂时无法获取事件。请重试或检查行情数据连接。',
  event: '事件',
  marketEvent: '市场事件',
  noDescription: '暂无描述。',
  openResearch: '打开 {{symbol}} 的研究',
  catalystEyebrow: '催化剂综合',
  catalystTitle: 'Folio Agent',
  catalystEmpty: '选择带有标的的事件，即可将其上下文带入研究或 Copilot。',
  catalystHint: '当底层事件或研究数据不可用时，Folio 不会编造催化剂摘要。',
} satisfies SameKeysAs<typeof enEvents>;
