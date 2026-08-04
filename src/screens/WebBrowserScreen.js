// WebBrowserScreen.js
//
// An in-app web browser. Blyp web results (and any external link) open here so
// the page stays inside the app instead of bouncing to the system browser.
//
// Hardened so a misbehaving native WebView can NEVER hard-crash the app: the
// WebView is wrapped in an error boundary that degrades to a "open in your
// browser" fallback if the native component fails to mount/render.

import React, { useRef, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import ScreenContainer from '../components/ScreenContainer';
import Icon from '../components/Icon';
import { COLORS } from '../styles/theme';
import { responsiveFont, responsiveSize } from '../utils/scaleUtils';
import { shareUrl } from '../services/shareService';
import { reportSearchEvent } from '../services/blypSearchClient';

// Runs in the page after load: grabs the title, meta description and a short
// visible-text excerpt (capped) and posts it back. This is how Blyp grows its OWN
// search index from pages users actually open — first-party data we're entitled to.
const EXTRACT_JS = `(function(){try{
  var d=document;
  var md=d.querySelector('meta[name="description"]')||d.querySelector('meta[property="og:description"]');
  var desc=md?(md.getAttribute('content')||''):'';
  var txt=(d.body?d.body.innerText:'')||'';
  txt=txt.replace(/\\s+/g,' ').trim().slice(0,1200);
  window.ReactNativeWebView.postMessage(JSON.stringify({__blypSnap:true,url:location.href,title:d.title||'',description:desc,excerpt:txt}));
}catch(e){}})(); true;`;

// Guarded import: if the native module is unavailable this stays null and we
// render the fallback instead of throwing at module load.
let WebView = null;
try {
  // eslint-disable-next-line global-require
  WebView = require('react-native-webview').WebView;
} catch (e) {
  WebView = null;
}

const normalizeUrl = (raw) => {
  const u = String(raw || '').trim();
  if (!u) return 'https://www.google.com';
  if (/^https?:\/\//i.test(u)) return u;
  return `https://${u}`;
};

const hostOf = (url) => {
  try {
    return String(url).replace(/^https?:\/\/(www\.)?/i, '').split('/')[0];
  } catch {
    return url;
  }
};

// Catches render-time errors from the native WebView (e.g. missing view config
// under the New Architecture) so the screen shows a fallback instead of the app
// crashing.
class WebViewBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { failed: false };
  }

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error) {
    // eslint-disable-next-line no-console
    console.warn('[WebBrowser] WebView render failed, showing fallback', error?.message || error);
  }

  render() {
    if (this.state.failed) return this.props.fallback;
    return this.props.children;
  }
}

const FallbackView = ({ url, onRetry }) => (
  <View style={styles.fallbackWrap}>
    <Icon name="globe-outline" size={44} color={COLORS.textMuted} />
    <Text style={styles.fallbackTitle}>Couldn’t open the page in-app</Text>
    <Text style={styles.fallbackSub} numberOfLines={2}>{hostOf(url)}</Text>
    <TouchableOpacity
      style={styles.fallbackBtn}
      activeOpacity={0.85}
      onPress={() => Linking.openURL(url).catch(() => {})}
    >
      <Icon name="open-outline" size={16} color={COLORS.black} />
      <Text style={styles.fallbackBtnText}>Open in your browser</Text>
    </TouchableOpacity>
    {onRetry && (
      <TouchableOpacity style={styles.fallbackRetry} activeOpacity={0.85} onPress={onRetry}>
        <Text style={styles.fallbackRetryText}>Try again</Text>
      </TouchableOpacity>
    )}
  </View>
);

const WebBrowserScreen = ({ navigation, route }) => {
  const initialUrl = normalizeUrl(route?.params?.url);
  const title = route?.params?.title;
  const originQuery = route?.params?.query;
  const webRef = useRef(null);
  const [loading, setLoading] = useState(true);
  const [progress, setProgress] = useState(0);
  const [currentUrl, setCurrentUrl] = useState(initialUrl);
  const [canGoBack, setCanGoBack] = useState(false);
  const [canGoForward, setCanGoForward] = useState(false);
  const [retryKey, setRetryKey] = useState(0);

  const onNav = (state) => {
    setCanGoBack(state.canGoBack);
    setCanGoForward(state.canGoForward);
    if (state.url) setCurrentUrl(state.url);
  };

  // Receives the extracted page snapshot and harvests it into Blyp's corpus.
  const onMessage = (e) => {
    try {
      const data = JSON.parse(e?.nativeEvent?.data || '{}');
      if (data && data.__blypSnap && data.url) {
        reportSearchEvent({
          type: 'snapshot',
          query: originQuery,
          url: data.url,
          title: data.title,
          description: data.description,
          excerpt: data.excerpt,
        });
      }
    } catch {
      /* ignore non-JSON messages */
    }
  };

  // Keep everything inside the in-app browser. Critically, block app-store /
  // intent / custom-scheme redirects (intent://, market://, play.google.com,
  // myapp://) that would otherwise punt the user out to the Google Play Store.
  const onShouldStart = (req) => {
    const u = String(req?.url || '');
    if (/^https?:\/\//i.test(u) || /^(about:|data:)/i.test(u)) {
      if (/play\.google\.com\/store/i.test(u)) return false;
      return true;
    }
    return false;
  };

  const USER_AGENT =
    'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36';

  const fallback = <FallbackView url={initialUrl} onRetry={() => setRetryKey((k) => k + 1)} />;

  const renderWeb = () => {
    if (!WebView) return fallback;
    return (
      <WebViewBoundary fallback={fallback}>
        <WebView
          key={retryKey}
          ref={webRef}
          source={{ uri: initialUrl }}
          style={styles.web}
          originWhitelist={['http://*', 'https://*', 'about:*', 'data:*']}
          userAgent={USER_AGENT}
          onShouldStartLoadWithRequest={onShouldStart}
          onLoadStart={() => setLoading(true)}
          onLoadEnd={() => {
            setLoading(false);
            // Harvest the page snapshot shortly after load (content settled).
            setTimeout(() => {
              try {
                webRef.current?.injectJavaScript?.(EXTRACT_JS);
              } catch {
                /* non-fatal */
              }
            }, 500);
          }}
          onMessage={onMessage}
          onLoadProgress={({ nativeEvent }) => setProgress(nativeEvent.progress)}
          onNavigationStateChange={onNav}
          onError={() => setLoading(false)}
          startInLoadingState
          renderLoading={() => (
            <View style={styles.loadingWrap}>
              <ActivityIndicator size="large" color={COLORS.primary} />
            </View>
          )}
          javaScriptEnabled
          domStorageEnabled
          allowsBackForwardNavigationGestures
          setSupportMultipleWindows={false}
        />
      </WebViewBoundary>
    );
  };

  return (
    <ScreenContainer>
      <View style={styles.container}>
        {/* Top bar */}
        <View style={styles.topRow}>
          <TouchableOpacity style={styles.iconBtn} onPress={() => navigation.goBack()} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Icon name="close" size={24} color={COLORS.textPrimary} />
          </TouchableOpacity>
          <View style={styles.titleWrap}>
            <Text style={styles.title} numberOfLines={1}>{title || hostOf(currentUrl)}</Text>
            <View style={styles.urlRow}>
              <Icon name="lock-closed" size={10} color={COLORS.textMuted} />
              <Text style={styles.url} numberOfLines={1}>{hostOf(currentUrl)}</Text>
            </View>
          </View>
          <TouchableOpacity style={styles.iconBtn} onPress={() => shareUrl(currentUrl, title)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Icon name="share-social-outline" size={20} color={COLORS.textPrimary} />
          </TouchableOpacity>
        </View>

        {/* Progress bar */}
        {loading && WebView && (
          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: `${Math.max(8, progress * 100)}%` }]} />
          </View>
        )}

        {renderWeb()}

        {/* Bottom controls */}
        <View style={styles.bottomBar}>
          <TouchableOpacity style={styles.navBtn} disabled={!canGoBack} onPress={() => webRef.current?.goBack?.()}>
            <Icon name="chevron-back" size={24} color={canGoBack ? COLORS.textPrimary : COLORS.textDisabled} />
          </TouchableOpacity>
          <TouchableOpacity style={styles.navBtn} disabled={!canGoForward} onPress={() => webRef.current?.goForward?.()}>
            <Icon name="chevron-forward" size={24} color={canGoForward ? COLORS.textPrimary : COLORS.textDisabled} />
          </TouchableOpacity>
          <TouchableOpacity style={styles.navBtn} onPress={() => webRef.current?.reload?.()}>
            <Icon name="reload" size={20} color={COLORS.textPrimary} />
          </TouchableOpacity>
          <TouchableOpacity style={styles.navBtn} onPress={() => Linking.openURL(currentUrl).catch(() => {})}>
            <Icon name="open-outline" size={20} color={COLORS.textPrimary} />
          </TouchableOpacity>
        </View>
      </View>
    </ScreenContainer>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, paddingTop: responsiveSize(8) },
  topRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, paddingBottom: 8, gap: 6 },
  iconBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  titleWrap: { flex: 1, alignItems: 'center' },
  title: { color: COLORS.textPrimary, fontSize: responsiveFont(15), fontWeight: '700', maxWidth: '100%' },
  urlRow: { flexDirection: 'row', alignItems: 'center', gap: 3, marginTop: 1 },
  url: { color: COLORS.textMuted, fontSize: responsiveFont(11), maxWidth: 220 },
  progressTrack: { height: 2.5, backgroundColor: COLORS.surface, overflow: 'hidden' },
  progressFill: { height: '100%', backgroundColor: COLORS.primary },
  web: { flex: 1, backgroundColor: COLORS.background },
  loadingWrap: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', backgroundColor: COLORS.background },
  fallbackWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32, gap: 10 },
  fallbackTitle: { color: COLORS.textPrimary, fontSize: responsiveFont(16), fontWeight: '800', marginTop: 6 },
  fallbackSub: { color: COLORS.textMuted, fontSize: responsiveFont(13), textAlign: 'center' },
  fallbackBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 14,
    paddingHorizontal: 18, paddingVertical: 12, borderRadius: 999, backgroundColor: COLORS.primary,
  },
  fallbackBtnText: { color: COLORS.black, fontSize: responsiveFont(14), fontWeight: '800' },
  fallbackRetry: { marginTop: 10, paddingVertical: 8, paddingHorizontal: 14 },
  fallbackRetryText: { color: COLORS.primary, fontSize: responsiveFont(13), fontWeight: '700' },
  bottomBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    paddingVertical: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: COLORS.border,
    backgroundColor: COLORS.background,
  },
  navBtn: { width: 56, height: 40, alignItems: 'center', justifyContent: 'center' },
});

export default WebBrowserScreen;
