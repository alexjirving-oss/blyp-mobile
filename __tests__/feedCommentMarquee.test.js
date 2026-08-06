const {
  LOOP_CAP,
  ROW_ESTIMATE,
  VISIBLE_ROWS,
  buildLoopItems,
  buildMarqueeRenderItems,
  dedupeCommentsById,
  reconcileOptimisticComments,
  shouldMarqueeLoop,
} = require('../src/components/Feed/feedCommentMarquee');

describe('feedCommentMarquee', () => {
  const viewport = VISIBLE_ROWS * ROW_ESTIMATE;

  test('dedupeCommentsById keeps first id and drops empty text', () => {
    const out = dedupeCommentsById([
      { id: 'a', text: 'one' },
      { id: 'a', text: 'dup' },
      { id: 'b', text: '  ' },
      { id: 'c', text: 'two' },
    ]);
    expect(out.map((c) => c.id)).toEqual(['a', 'c']);
    expect(out[0].text).toBe('one');
  });

  test('buildLoopItems reverses newest-first into chronological rise order', () => {
    const items = buildLoopItems(
      [
        { id: '3', text: 'newest' },
        { id: '2', text: 'mid' },
        { id: '1', text: 'oldest' },
      ],
      LOOP_CAP
    );
    expect(items.map((c) => c.id)).toEqual(['1', '2', '3']);
  });

  test('single comment does not marquee-loop (avoids stacked duplicate bubbles)', () => {
    const loopItems = buildLoopItems([{ id: '1', text: 'Test', username: 'alex' }]);
    const cycleHeight = loopItems.length * ROW_ESTIMATE;
    expect(shouldMarqueeLoop(loopItems.length, cycleHeight, viewport)).toBe(false);
    const rendered = buildMarqueeRenderItems(loopItems, false);
    expect(rendered).toHaveLength(1);
    expect(rendered[0].item.text).toBe('Test');
  });

  test('few comments shorter than viewport stay static without clones', () => {
    const loopItems = buildLoopItems([
      { id: '2', text: 'b' },
      { id: '1', text: 'a' },
    ]);
    const cycleHeight = loopItems.length * ROW_ESTIMATE;
    expect(cycleHeight).toBeLessThan(viewport);
    expect(shouldMarqueeLoop(loopItems.length, cycleHeight, viewport)).toBe(false);
    expect(buildMarqueeRenderItems(loopItems, false)).toHaveLength(2);
  });

  test('enough comments to fill viewport may loop with exactly one clone set', () => {
    const comments = Array.from({ length: VISIBLE_ROWS }, (_, i) => ({
      id: String(i + 1),
      text: `c${i + 1}`,
    }));
    const loopItems = buildLoopItems(comments);
    const cycleHeight = loopItems.length * ROW_ESTIMATE;
    expect(shouldMarqueeLoop(loopItems.length, cycleHeight, viewport)).toBe(true);
    const rendered = buildMarqueeRenderItems(loopItems, true);
    expect(rendered).toHaveLength(loopItems.length * 2);
    // First visible half equals unique loop items — no simultaneous twin until scroll.
    expect(rendered.slice(0, loopItems.length).map((r) => r.item.id)).toEqual(
      loopItems.map((c) => c.id)
    );
  });

  test('reconcileOptimisticComments drops temp when server echo matches', () => {
    const optimistic = {
      id: 'temp-1',
      userId: 'u1',
      text: 'Test',
      parentId: null,
      _optimistic: true,
    };
    const server = [{ id: 'server-1', userId: 'u1', text: 'Test', parentId: null }];
    const out = reconcileOptimisticComments(server, [optimistic]);
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe('server-1');
  });

  test('reconcileOptimisticComments keeps pending until match', () => {
    const optimistic = {
      id: 'temp-1',
      userId: 'u1',
      text: 'Hello',
      parentId: null,
      _optimistic: true,
    };
    const server = [{ id: 'other', userId: 'u2', text: 'Nope', parentId: null }];
    const out = reconcileOptimisticComments(server, [optimistic]);
    expect(out.map((c) => c.id)).toEqual(['temp-1', 'other']);
  });
});
