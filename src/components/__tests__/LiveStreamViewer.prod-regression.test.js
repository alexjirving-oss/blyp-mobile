import fs from 'fs';
import path from 'path';

const { transformSync } = require('@babel/core');
const traverse = require('@babel/traverse').default;

const liveStreamViewerPath = path.resolve(__dirname, '..', 'LiveStreamViewer.js');

function unboundAfterProdTransform(names) {
  const source = fs.readFileSync(liveStreamViewerPath, 'utf8');
  const transformed = transformSync(source, {
    filename: liveStreamViewerPath,
    envName: 'production',
    ast: true,
    code: false,
  });
  const hits = {};

  traverse(transformed.ast, {
    ReferencedIdentifier(referencePath) {
      const name = referencePath.node.name;
      if (!names.includes(name)) return;
      if (referencePath.scope.hasBinding(name)) return;
      const line = referencePath.node.loc?.start?.line;
      hits[name] = hits[name] || [];
      if (line) hits[name].push(line);
    },
  });

  return hits;
}

describe('LiveStreamViewer production regression', () => {
  it('has no unbound hasRenderableStreams or renderableStreams after prod transform', () => {
    const hits = unboundAfterProdTransform(['hasRenderableStreams', 'renderableStreams']);
    expect(hits).toEqual({});
  });

  it('does not force Android mass watch onto HLS', () => {
    const source = fs.readFileSync(liveStreamViewerPath, 'utf8');
    expect(source).toMatch(/preferPlayback:\s*false/);
    expect(source).not.toMatch(
      /Platform\.OS === 'android' && !guestMode && !!NativeIVSPlayerView/,
    );
  });

  it('Host+9 featured tile uses pickHostWatchStream; 3x3 is a sibling grid', () => {
    const source = fs.readFileSync(liveStreamViewerPath, 'utf8');
    expect(source).toMatch(/pickHostWatchStream\(renderableStreams\)/);
    expect(source).toMatch(/ivs-realtime-host-top-9/);
    expect(source).toMatch(/isHostTop9 && !hostExpanded \? renderHostTop9Grid\(\)/);
    const hostTile = source.indexOf('ivs-realtime-host-top-9');
    const gridCall = source.lastIndexOf('renderHostTop9Grid()');
    expect(hostTile).toBeGreaterThan(0);
    expect(gridCall).toBeGreaterThan(hostTile);
    expect(source).not.toMatch(/studioProgramComposite/);
  });

  it('keeps the host IVS tile in one tree across Studio solo / host-top-9 swaps', () => {
    const source = fs.readFileSync(liveStreamViewerPath, 'utf8');
    expect(source).toMatch(/Keep slot 0 in this tree/);
    expect(source).toMatch(/guestLayoutMode = DEFAULT_LIVE_LAYOUT_MODE/);
    expect(source).not.toMatch(
      /if \(guestLayoutMode === LIVE_LAYOUT_MODES\.SOLO\) \{\s*return \(/,
    );
    expect(source).not.toMatch(
      /if \(guestLayoutMode === LIVE_LAYOUT_MODES\.HOST_TOP_9\) \{\s*return \(/,
    );
  });
});
