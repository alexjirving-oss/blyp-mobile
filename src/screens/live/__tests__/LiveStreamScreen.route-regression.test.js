import fs from 'fs';
import path from 'path';

import {
  unwrapLiveRouteParams,
  useLiveStreamRouteParams,
} from '../useLiveStreamRouteParams';

const { parse } = require('@babel/parser');
const traverse = require('@babel/traverse').default;
const { transformSync } = require('@babel/core');

const liveStreamScreenPath = path.resolve(
  __dirname,
  '..',
  '..',
  'LiveStreamScreen.js'
);

describe('LiveStreamScreen route regression', () => {
  it('has no unbound rawParams reference', () => {
    const source = fs.readFileSync(liveStreamScreenPath, 'utf8');
    const ast = parse(source, {
      sourceType: 'module',
      plugins: ['jsx'],
    });
    const unboundLines = [];

    traverse(ast, {
      ReferencedIdentifier(referencePath) {
        if (
          referencePath.node.name === 'rawParams' &&
          !referencePath.scope.hasBinding('rawParams')
        ) {
          unboundLines.push(referencePath.node.loc.start.line);
        }
      },
    });

    expect(unboundLines).toEqual([]);
  });

  it('has no unbound gameOpen reference after the production transform', () => {
    const source = fs.readFileSync(liveStreamScreenPath, 'utf8');
    const transformed = transformSync(source, {
      filename: liveStreamScreenPath,
      envName: 'production',
      ast: true,
      code: false,
    });
    const unboundLines = [];

    traverse(transformed.ast, {
      ReferencedIdentifier(referencePath) {
        if (
          referencePath.node.name === 'gameOpen' &&
          !referencePath.scope.hasBinding('gameOpen')
        ) {
          unboundLines.push(referencePath.node.loc.start.line);
        }
      },
    });

    expect(unboundLines).toEqual([]);
  });

  it('normalizes nested viewer route params', () => {
    const viewerParams = {
      mode: ' VIEWER ',
      hostUid: ' host-123 ',
      streamId: ' stream-456 ',
      hostDisplayName: ' Example Host ',
      source: ' live-feed ',
    };
    const nestedParams = { params: { params: viewerParams } };

    expect(unwrapLiveRouteParams(nestedParams)).toBe(viewerParams);
    expect(useLiveStreamRouteParams({ params: nestedParams })).toMatchObject({
      normalizedParams: viewerParams,
      routeMode: 'viewer',
      routeHostUid: 'host-123',
      routeStreamId: 'stream-456',
      routeHostDisplayName: 'Example Host',
      routeSource: 'live-feed',
    });
  });
});
