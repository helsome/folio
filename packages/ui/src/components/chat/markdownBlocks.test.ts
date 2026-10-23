import { describe, expect, it } from 'bun:test';
import { splitMarkdownBlocks } from './markdownBlocks';

describe('splitMarkdownBlocks (#28)', () => {
  it('returns no blocks for empty or blank content', () => {
    expect(splitMarkdownBlocks('')).toEqual([]);
    expect(splitMarkdownBlocks('\n\n')).toEqual([]);
    expect(splitMarkdownBlocks('   \n\t\n')).toEqual([]);
  });

  it('keeps a single-block document whole', () => {
    expect(splitMarkdownBlocks('Just one paragraph.')).toEqual(['Just one paragraph.']);
    expect(splitMarkdownBlocks('## Heading\n\nBody text.')).toEqual(['## Heading', 'Body text.']);
  });

  it('splits paragraphs, headings and tables at blank lines', () => {
    const blocks = splitMarkdownBlocks('# Title\n\nIntro text.\n\n| a | b |\n| --- | --- |\n| 1 | 2 |');
    expect(blocks).toEqual(['# Title', 'Intro text.', '| a | b |\n| --- | --- |\n| 1 | 2 |']);
  });

  it('never splits inside a fenced code block, blank lines included', () => {
    const partial = '```ts\nconst margin = 0.21;\n\nconst fcf = 312;\n';
    expect(splitMarkdownBlocks(partial)).toEqual([partial]);
    // The closing fence ends the block; later text starts a new one.
    expect(splitMarkdownBlocks(`${partial}\`\`\`\n\nAfter.`)).toEqual([
      '```ts\nconst margin = 0.21;\n\nconst fcf = 312;\n```',
      'After.',
    ]);
  });

  it('respects fence marker length and type when closing', () => {
    // A shorter backtick run cannot close a longer fence.
    expect(splitMarkdownBlocks('````\ncode\n```\nstill code\n````')).toEqual(['````\ncode\n```\nstill code\n````']);
    // A tilde fence is not closed by backticks.
    expect(splitMarkdownBlocks('~~~\ncode\n```\n~~~')).toEqual(['~~~\ncode\n```\n~~~']);
  });

  it('treats a backtick info string containing a backtick as prose', () => {
    // Not a fence: the line is paragraph text and later blank lines still split.
    expect(splitMarkdownBlocks('```ts`x`\n\nAfter.')).toEqual(['```ts`x`', 'After.']);
  });

  it('keeps a loose list one block across blank lines', () => {
    const loose = '1. Revenue growth\n\n2. Operating margin\n\n3. Free cash flow';
    expect(splitMarkdownBlocks(loose)).toEqual([loose]);
  });

  it('keeps indented list continuations with their item', () => {
    const list = '1. Revenue growth\n\n   with detail\n2. Next';
    expect(splitMarkdownBlocks(list)).toEqual([list]);
  });

  it('ends a list when a heading or fence follows the blank line', () => {
    expect(splitMarkdownBlocks('- item\n\n## Heading')).toEqual(['- item', '## Heading']);
    expect(splitMarkdownBlocks('- item\n\n```\ncode\n```')).toEqual(['- item', '```\ncode\n```']);
  });

  it('keeps a multi-line blockquote one block across blank lines', () => {
    const quote = '> Analyst note: fiscal Q4 beat estimates on\n\n> revenue and margin';
    expect(splitMarkdownBlocks(quote)).toEqual([quote]);
  });

  it('ends a blockquote when plain text follows the blank line', () => {
    expect(splitMarkdownBlocks('> quote\n\nAfter.')).toEqual(['> quote', 'After.']);
  });

  it('treats "- - -" as a thematic break, not a list item', () => {
    expect(splitMarkdownBlocks('para\n\n- - -')).toEqual(['para', '- - -']);
    // The break takes precedence, so it ends the list above it.
    expect(splitMarkdownBlocks('- item\n\n- - -')).toEqual(['- item', '- - -']);
  });

  it('splits an indented code block that starts after a blank line', () => {
    expect(splitMarkdownBlocks('para\n\n    code block')).toEqual(['para', '    code block']);
  });

  it('keeps an indented code block one block across internal blank lines', () => {
    // An indented code block runs across blank lines in CommonMark, so the
    // whole-document render shows one <pre>. A boundary at the blank line
    // would render the tail as a second <pre> while streaming (#324).
    expect(splitMarkdownBlocks('    const a = 1;\n\n    const b = 2;')).toEqual([
      '    const a = 1;\n\n    const b = 2;',
    ]);
    // A tab counts as four columns of indentation.
    expect(splitMarkdownBlocks('\tcode1\n\n\tcode2')).toEqual(['\tcode1\n\n\tcode2']);
    // Any number of blank lines between indented lines stays inside the block.
    expect(splitMarkdownBlocks('    code1\n\n\n\n    code2')).toEqual(['    code1\n\n\n\n    code2']);
  });

  it('closes an indented code block at the first non-indented line', () => {
    expect(splitMarkdownBlocks('    const a = 1;\n\nconst b = 2;')).toEqual([
      '    const a = 1;',
      'const b = 2;',
    ]);
    // Headings, list markers, blockquotes and fences all close it too.
    expect(splitMarkdownBlocks('    const a = 1;\n\n## Heading')).toEqual([
      '    const a = 1;',
      '## Heading',
    ]);
    expect(splitMarkdownBlocks('    const a = 1;\n\n- item')).toEqual(['    const a = 1;', '- item']);
    expect(splitMarkdownBlocks('    const a = 1;\n\n> quote')).toEqual(['    const a = 1;', '> quote']);
    expect(splitMarkdownBlocks('    const a = 1;\n\n```\nx\n```')).toEqual(['    const a = 1;', '```\nx\n```']);
  });

  it('does not treat a lazy paragraph continuation as indented code', () => {
    // Without a blank line above it the indented line continues the paragraph,
    // so the following blank line still separates paragraph from code block.
    expect(splitMarkdownBlocks('para text\n    more text\n\n    code block')).toEqual([
      'para text\n    more text',
      '    code block',
    ]);
  });

  it('does not split when the document uses link reference definitions', () => {
    const doc = 'See [the report][ref].\n\n[ref]: https://example.com/report';
    expect(splitMarkdownBlocks(doc)).toEqual([doc]);
  });

  it('does not split documents that open a raw-HTML block', () => {
    // HTML block types such as <pre> run across blank lines until the closing
    // tag; a boundary inside one would render content the whole-document
    // parse keeps inside the inert HTML node.
    expect(splitMarkdownBlocks('<pre>\n\ncode\n\n</pre>')).toEqual(['<pre>\n\ncode\n\n</pre>']);
    expect(splitMarkdownBlocks('para\n\n<script>\n\nalert(1)\n\n</script>')).toEqual([
      'para\n\n<script>\n\nalert(1)\n\n</script>',
    ]);
    expect(splitMarkdownBlocks('<!--\n\ncomment\n\n-->')).toEqual(['<!--\n\ncomment\n\n-->']);
  });

  it('still splits when raw HTML only appears mid-line', () => {
    // Inline HTML inside a paragraph cannot span a blank line, so ordinary
    // documents with the odd inline tag keep their block boundaries.
    expect(splitMarkdownBlocks('text <b>bold</b> more\n\nnext para')).toEqual([
      'text <b>bold</b> more',
      'next para',
    ]);
  });

  it('keeps the tail small while a long answer streams', () => {
    const section =
      '## Section\n\n| Asset | Weight |\n| --- | ---: |\n| Equities | 46% |\n\n- first point\n- second point\n\n';
    const long = section.repeat(30);
    const blocks = splitMarkdownBlocks(long);
    // Many stable blocks (heading + table + list per section), and the block
    // currently streaming stays small — that is what keeps per-frame
    // re-parsing proportional to the tail.
    expect(blocks.length).toBe(90);
    const tail = blocks[blocks.length - 1] ?? '';
    expect(tail.length).toBeLessThan(long.length / 20);
  });

  it('detects fences through CRLF line endings without rewriting them', () => {
    const partial = '```ts\r\nconst margin = 0.21;\r\n';
    expect(splitMarkdownBlocks(partial)).toEqual([partial]);
    // The heading is its own block; the unclosed fence swallows its blank lines.
    expect(splitMarkdownBlocks('## Example\r\n\r\n' + `${partial}\`\`\`\r\n\r\nAfter.`)).toEqual([
      '## Example\r',
      '```ts\r\nconst margin = 0.21;\r\n```\r',
      'After.',
    ]);
  });
});
