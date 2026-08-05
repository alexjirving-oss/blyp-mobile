// SportPagePanel.js
//
// Bespoke, fan-first home pages for specific sports (Football, F1). Each blends
// the things a real fan wants on day one:
//   - Your team(s): follow your club / constructor -> next fixture / Grand Prix
//     and last result (Football per-team; F1 championship-wide schedule).
//   - Quick "Ask Blyp" shortcuts for the topics fans search most.
//   - Trending posts, creators to follow, and a latest grid (real Firestore).
//
// Team following is restored here via teamPreferencesService + the football/F1
// data services. Falls back to a generic config for any unknown sport id.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  Modal,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Icon from '../Icon';
import { COLORS } from '../../styles/theme';
import { responsiveFont, responsiveSize } from '../../utils/scaleUtils';
import { getTopicPosts, getSuggestedCreators, creatorAvatar } from '../../services/discoveryService';
import { postThumbnail } from '../../services/blypAiService';
import { followUser, unfollowUser, subscribeToFollowingList } from '../../utils/followUtils';
import { searchFootballTeams, getNextMatches, getLastMatches } from '../../services/footballDataService';
import { getF1Teams, getNextRace, getLastRaceResult } from '../../services/formula1DataService';
import {
  subscribeFollowedTeams,
  addFollowedTeam,
  removeFollowedTeam,
} from '../../services/teamPreferencesService';
import { isMatchdayLiveEnabled } from '../../services/matchdayService';
import { mediaViewerParams } from '../../utils/mediaViewerPlaylist';

const SPORTS = {
  football: {
    title: 'Football',
    tagline: 'Your club, fixtures, goals & transfers',
    accent: '#22C55E',
    heroIcon: 'football',
    terms: ['football', 'soccer', 'goal', 'match', 'league', 'premier', 'fixture'],
    chips: ['Premier League', 'Champions League', 'Transfers', 'Goals', 'Highlights', 'Matchday'],
    addLabel: 'Add your club',
    kind: 'football',
  },
  f1: {
    title: 'Formula 1',
    tagline: 'Your team, race weekends & the title fight',
    accent: '#E10600',
    heroIcon: 'flag',
    terms: ['f1', 'formula', 'grand prix', 'race', 'qualifying', 'pole', 'paddock'],
    chips: ['Race', 'Qualifying', 'Standings', 'Teams', 'Highlights', 'Paddock'],
    addLabel: 'Add your team',
    kind: 'f1',
  },
};

const fallbackConfig = (label) => ({
  title: label || 'Topic',
  tagline: `The best of ${label || 'this topic'} on Blyp`,
  accent: COLORS.primary,
  heroIcon: 'sparkles',
  terms: String(label || '').toLowerCase().split(/\s+/).filter(Boolean),
  chips: [],
  addLabel: 'Add',
  kind: 'generic',
});

// ---- date / result formatters -------------------------------------------
function formatKickoff(ev) {
  if (!ev) return 'TBC';
  const ts = ev.timestamp;
  let d = null;
  try {
    if (ts) d = new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(ts) ? ts : `${ts}Z`);
    else if (ev.date) d = new Date(`${ev.date}T${ev.time || '00:00:00'}Z`);
  } catch {
    d = null;
  }
  if (!d || isNaN(d.getTime())) return ev.date || 'TBC';
  return d.toLocaleString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function describeFixture(ev, teamName) {
  if (!ev) return null;
  const isHome = (ev.homeTeam || '').toLowerCase() === (teamName || '').toLowerCase();
  const opponent = isHome ? ev.awayTeam : ev.homeTeam;
  return { opponent: opponent || ev.name || 'TBC', homeAway: isHome ? 'H' : 'A', league: ev.league || '' };
}

function describeResult(ev, teamName) {
  if (!ev || ev.homeScore == null || ev.awayScore == null) return null;
  const isHome = (ev.homeTeam || '').toLowerCase() === (teamName || '').toLowerCase();
  const teamScore = isHome ? ev.homeScore : ev.awayScore;
  const oppScore = isHome ? ev.awayScore : ev.homeScore;
  let outcome = 'D';
  if (teamScore > oppScore) outcome = 'W';
  else if (teamScore < oppScore) outcome = 'L';
  const opponent = isHome ? ev.awayTeam : ev.homeTeam;
  return { outcome, score: `${teamScore}-${oppScore}`, opponent: opponent || '' };
}

function TeamBadge({ uri, size = 40, accent }) {
  if (uri) return <Image source={{ uri }} style={{ width: size, height: size, borderRadius: 8 }} resizeMode="contain" />;
  return (
    <View style={{ width: size, height: size, borderRadius: 8, backgroundColor: COLORS.surface, alignItems: 'center', justifyContent: 'center' }}>
      <Icon name="shield" size={size * 0.5} color={accent || COLORS.textMuted} />
    </View>
  );
}

const outcomeColor = (o) => (o === 'W' ? '#22C55E' : o === 'L' ? '#EF4444' : '#9CA3AF');

const SportPagePanel = ({ navigation, uid, sportId, label }) => {
  const cfg = SPORTS[sportId] || fallbackConfig(label);
  const [posts, setPosts] = useState([]);
  const [creators, setCreators] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [followingSet, setFollowingSet] = useState(new Set());

  // Team following
  const [teams, setTeams] = useState([]);
  const [matches, setMatches] = useState({}); // football: { [teamId]: { next, last } }
  const [f1, setF1] = useState({ next: null, lastRace: null, podium: [], loaded: false });

  // Picker
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerQuery, setPickerQuery] = useState('');
  const [pickerResults, setPickerResults] = useState([]);
  const [pickerLoading, setPickerLoading] = useState(false);

  useEffect(() => {
    if (!uid) return undefined;
    const unsub = subscribeToFollowingList(uid, (ids) => setFollowingSet(new Set(ids || [])));
    return unsub;
  }, [uid]);

  useEffect(() => {
    const unsub = subscribeFollowedTeams(uid, setTeams);
    return unsub;
  }, [uid]);

  const myTeams = useMemo(() => {
    if (cfg.kind === 'f1') return teams.filter((t) => t.sport === 'F1');
    if (cfg.kind === 'football') return teams.filter((t) => (t.sport || 'Soccer') !== 'F1');
    return [];
  }, [teams, cfg.kind]);

  // Sport terms + followed club/constructor names so the rail prefers team content.
  const contentTerms = useMemo(() => {
    const base = [...(cfg.terms || [])];
    for (const t of myTeams) {
      const name = String(t.name || '')
        .toLowerCase()
        .split(/\s+/)
        .filter((w) => w.length > 2);
      base.push(...name);
      if (t.shortName) base.push(String(t.shortName).toLowerCase());
    }
    return Array.from(new Set(base));
  }, [cfg.terms, myTeams]);

  const termsKey = contentTerms.join(',');

  // Football: fetch next/last per followed team.
  useEffect(() => {
    if (cfg.kind !== 'football') return;
    myTeams.forEach((t) => {
      if (matches[t.id]) return;
      (async () => {
        try {
          const [next, last] = await Promise.all([getNextMatches(t.id), getLastMatches(t.id)]);
          setMatches((prev) => ({ ...prev, [t.id]: { next: next?.[0] || null, last: last?.[0] || null } }));
        } catch {
          setMatches((prev) => ({ ...prev, [t.id]: { next: null, last: null } }));
        }
      })();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myTeams, cfg.kind]);

  // F1: championship-wide next race + last podium (once a constructor is followed).
  useEffect(() => {
    if (cfg.kind !== 'f1' || f1.loaded || myTeams.length === 0) return;
    (async () => {
      try {
        const [next, lastRes] = await Promise.all([getNextRace(), getLastRaceResult()]);
        setF1({ next, lastRace: lastRes?.race || null, podium: lastRes?.podium || [], loaded: true });
      } catch {
        setF1({ next: null, lastRace: null, podium: [], loaded: true });
      }
    })();
  }, [cfg.kind, myTeams.length, f1.loaded]);

  const load = useMemo(
    () => async () => {
      const [p, c] = await Promise.all([
        getTopicPosts(contentTerms, 40),
        getSuggestedCreators(12, contentTerms, uid),
      ]);
      setPosts(p);
      setCreators(c);
      setLoading(false);
      setRefreshing(false);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [termsKey, uid]
  );

  useEffect(() => {
    setLoading(true);
    load();
  }, [load]);

  // ---- picker ----
  const runPickerSearch = useCallback(
    async (q) => {
      setPickerLoading(true);
      try {
        let res = [];
        if (cfg.kind === 'football') {
          res = await searchFootballTeams(q);
        } else if (cfg.kind === 'f1') {
          const all = await getF1Teams();
          const needle = String(q || '').trim().toLowerCase();
          res = needle ? all.filter((t) => (t.name || '').toLowerCase().includes(needle)) : all;
        }
        setPickerResults(res || []);
      } catch {
        setPickerResults([]);
      } finally {
        setPickerLoading(false);
      }
    },
    [cfg.kind]
  );

  const openPicker = () => {
    setPickerOpen(true);
    setPickerQuery('');
    setPickerResults([]);
    runPickerSearch('');
  };

  const onAddTeam = async (team) => {
    await addFollowedTeam(uid, team);
    setPickerOpen(false);
  };

  const onRemoveTeam = (team) => {
    removeFollowedTeam(uid, team.id);
    setMatches((prev) => {
      const next = { ...prev };
      delete next[team.id];
      return next;
    });
  };

  const openPost = (post) => navigation.navigate('MediaViewer', mediaViewerParams(post, posts));
  const openCreator = (u) =>
    navigation.navigate('UserProfile', { userId: u.id || u.uid, username: u.username || u.displayName || '@user' });
  const askBlyp = (q) => navigation.navigate('Blyp', { initialQuery: q || cfg.title });

  const toggleFollow = async (targetId) => {
    if (!uid || !targetId) return;
    const isF = followingSet.has(targetId);
    setFollowingSet((prev) => {
      const n = new Set(prev);
      if (isF) n.delete(targetId);
      else n.add(targetId);
      return n;
    });
    try {
      const res = isF
        ? await unfollowUser(uid, targetId)
        : await followUser(uid, targetId);
      if (!res?.success) {
        setFollowingSet((prev) => {
          const n = new Set(prev);
          if (isF) n.add(targetId);
          else n.delete(targetId);
          return n;
        });
      }
    } catch {
      setFollowingSet((prev) => {
        const n = new Set(prev);
        if (isF) n.add(targetId);
        else n.delete(targetId);
        return n;
      });
    }
  };

  const isVideoPost = (p) => p?.type === 'video' || !!p?.videoUrl;
  // Prefer videos for the horizontal rail; fill with other topic posts if thin.
  const rail = useMemo(() => {
    const videos = posts.filter(isVideoPost);
    if (videos.length >= 8) return videos.slice(0, 10);
    const rest = posts.filter((p) => !isVideoPost(p));
    return [...videos, ...rest].slice(0, 10);
  }, [posts]);

  const openMatchday = (ev, team) => {
    if (!ev?.id) return;
    if (!isMatchdayLiveEnabled()) {
      askBlyp(`${team?.name || 'Match'} matchday`);
      return;
    }
    navigation.navigate('MatchdayRoom', {
      eventId: String(ev.id),
      teamId: team?.id ? String(team.id) : undefined,
      eventMeta: {
        id: ev.id,
        name: ev.name,
        homeTeam: ev.homeTeam,
        awayTeam: ev.awayTeam,
        timestamp: ev.timestamp,
        date: ev.date,
        time: ev.time,
        league: ev.league,
      },
    });
  };

  // ---- Football team card ----
  const FootballTeamCard = ({ team }) => {
    const m = matches[team.id];
    const fixture = m?.next ? describeFixture(m.next, team.name) : null;
    const result = m?.last ? describeResult(m.last, team.name) : null;
    return (
      <View style={[styles.teamCard, { borderLeftColor: cfg.accent }]}>
        <View style={styles.teamHeader}>
          <TeamBadge uri={team.badge} accent={cfg.accent} />
          <View style={styles.teamHeaderText}>
            <Text style={styles.teamName} numberOfLines={1}>{team.name}</Text>
            <Text style={styles.teamLeague} numberOfLines={1}>{team.league || 'Football'}</Text>
          </View>
          <TouchableOpacity onPress={() => onRemoveTeam(team)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Icon name="close-circle" size={20} color={COLORS.textMuted} />
          </TouchableOpacity>
        </View>
        <View style={styles.teamRow}>
          <Text style={styles.teamRowLabel}>NEXT</Text>
          {fixture ? (
            <Text style={styles.teamRowValue} numberOfLines={1}>
              {fixture.homeAway === 'H' ? 'vs' : '@'} {fixture.opponent} · {formatKickoff(m.next)}
            </Text>
          ) : (
            <Text style={styles.teamRowMuted}>{m ? 'No upcoming fixture' : 'Loading…'}</Text>
          )}
        </View>
        <View style={styles.teamRow}>
          <Text style={styles.teamRowLabel}>LAST</Text>
          {result ? (
            <Text style={styles.teamRowValue} numberOfLines={1}>
              <Text style={{ color: outcomeColor(result.outcome), fontWeight: '900' }}>{result.outcome}</Text>
              {`  ${result.score} ${result.opponent ? `· ${result.opponent}` : ''}`}
            </Text>
          ) : (
            <Text style={styles.teamRowMuted}>{m ? 'No recent result' : 'Loading…'}</Text>
          )}
        </View>
        {!!m?.next?.id && (
          <TouchableOpacity
            style={[styles.teamAsk, { marginBottom: 6 }]}
            activeOpacity={0.85}
            onPress={() => openMatchday(m.next, team)}
          >
            <Icon name="radio" size={13} color={cfg.accent} />
            <Text style={[styles.teamAskText, { color: cfg.accent }]}>
              {isMatchdayLiveEnabled() ? 'Open Matchday Live' : 'Matchday preview'}
            </Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity style={styles.teamAsk} activeOpacity={0.85} onPress={() => askBlyp(`${team.name} latest news`)}>
          <Icon name="sparkles" size={13} color={cfg.accent} />
          <Text style={[styles.teamAskText, { color: cfg.accent }]}>Ask Blyp about {team.name}</Text>
        </TouchableOpacity>
      </View>
    );
  };

  // ---- F1 followed-constructor + race card ----
  const F1YourTeam = () => (
    <View>
      {/* Followed constructors */}
      <View style={styles.f1Chips}>
        {myTeams.map((t) => (
          <View key={t.id} style={[styles.f1Chip, { borderColor: cfg.accent }]}>
            <TeamBadge uri={t.badge} size={22} accent={cfg.accent} />
            <Text style={styles.f1ChipText} numberOfLines={1}>{t.name}</Text>
            <TouchableOpacity onPress={() => onRemoveTeam(t)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Icon name="close-circle" size={16} color={COLORS.textMuted} />
            </TouchableOpacity>
          </View>
        ))}
      </View>
      {/* Next GP */}
      <View style={[styles.teamCard, { borderLeftColor: cfg.accent }]}>
        <Text style={styles.teamRowLabel}>NEXT GRAND PRIX</Text>
        {f1.next ? (
          <>
            <Text style={styles.gpName} numberOfLines={1}>{f1.next.name}</Text>
            <Text style={styles.teamRowValue} numberOfLines={1}>
              {[f1.next.venue, f1.next.country].filter(Boolean).join(' · ')}
            </Text>
            <Text style={styles.teamRowMuted}>{formatKickoff(f1.next)}</Text>
          </>
        ) : (
          <Text style={styles.teamRowMuted}>{f1.loaded ? 'Schedule unavailable' : 'Loading…'}</Text>
        )}
      </View>
      {/* Last podium */}
      {f1.podium?.length > 0 && (
        <View style={[styles.teamCard, { borderLeftColor: cfg.accent }]}>
          <Text style={styles.teamRowLabel}>LAST PODIUM{f1.lastRace ? ` · ${f1.lastRace.name}` : ''}</Text>
          {f1.podium.map((p) => (
            <View key={p.position} style={styles.podiumRow}>
              <Text style={[styles.podiumPos, { color: cfg.accent }]}>P{p.position}</Text>
              <Text style={styles.podiumDriver} numberOfLines={1}>{p.driver}</Text>
              <Text style={styles.podiumTeam} numberOfLines={1}>{p.teamName}</Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );

  const renderGridItem = ({ item }) => {
    const uri = postThumbnail(item);
    const isVideo = item.type === 'video' || !!item.videoUrl;
    return (
      <TouchableOpacity style={styles.card} activeOpacity={0.85} onPress={() => openPost(item)}>
        <View style={styles.thumbWrap}>
          {uri ? (
            <Image source={{ uri }} style={styles.thumb} resizeMode="cover" />
          ) : (
            <View style={[styles.thumb, styles.thumbFallback]}>
              <Icon name={cfg.heroIcon} size={24} color={COLORS.textMuted} />
            </View>
          )}
          {isVideo && (
            <View style={styles.playBadge}>
              <Icon name="play" size={13} color={COLORS.white} />
            </View>
          )}
        </View>
        <Text style={styles.cardTitle} numberOfLines={2}>
          {item.title || item.caption || item.description || 'Post'}
        </Text>
      </TouchableOpacity>
    );
  };

  const Header = (
    <View>
      {/* Themed hero */}
      <LinearGradient colors={[cfg.accent, 'transparent']} start={{ x: 0, y: 0 }} end={{ x: 0, y: 1 }} style={styles.hero}>
        <View style={[styles.heroBadge, { backgroundColor: cfg.accent }]}>
          <Icon name={cfg.heroIcon} size={22} color={COLORS.white} />
        </View>
        <Text style={styles.heroTitle}>{cfg.title}</Text>
        <Text style={styles.heroTagline}>{cfg.tagline}</Text>
        <TouchableOpacity style={[styles.askBtn, { borderColor: cfg.accent }]} activeOpacity={0.85} onPress={() => askBlyp()}>
          <Icon name="sparkles" size={14} color={cfg.accent} />
          <Text style={[styles.askText, { color: cfg.accent }]}>Ask Blyp about {cfg.title}</Text>
        </TouchableOpacity>
      </LinearGradient>

      {/* Your team(s) */}
      {(cfg.kind === 'football' || cfg.kind === 'f1') && (
        <View style={styles.yourTeamWrap}>
          <View style={styles.sectionRow}>
            <Text style={styles.sectionTitle}>{cfg.kind === 'f1' ? 'Your team' : 'Your teams'}</Text>
            <TouchableOpacity style={[styles.addPill, { backgroundColor: cfg.accent }]} activeOpacity={0.85} onPress={openPicker}>
              <Icon name="add" size={15} color={COLORS.white} />
              <Text style={styles.addPillText}>{cfg.addLabel}</Text>
            </TouchableOpacity>
          </View>

          {myTeams.length === 0 ? (
            <TouchableOpacity style={[styles.emptyTeam, { borderColor: cfg.accent }]} activeOpacity={0.85} onPress={openPicker}>
              <Icon name={cfg.heroIcon} size={26} color={cfg.accent} />
              <Text style={styles.emptyTeamTitle}>{cfg.addLabel}</Text>
              <Text style={styles.emptyTeamSub}>
                {cfg.kind === 'f1'
                  ? 'Follow your constructor for race weekends and results.'
                  : 'Follow your club for fixtures, results and matchday.'}
              </Text>
            </TouchableOpacity>
          ) : cfg.kind === 'f1' ? (
            <F1YourTeam />
          ) : (
            myTeams.map((t) => <FootballTeamCard key={t.id} team={t} />)
          )}
        </View>
      )}

      {/* Sub-topic chips */}
      {cfg.chips.length > 0 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
          {cfg.chips.map((c) => (
            <TouchableOpacity key={c} style={styles.chip} activeOpacity={0.85} onPress={() => askBlyp(`${cfg.title} ${c}`)}>
              <Text style={styles.chipText}>{c}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}

      {/* Trending rail */}
      {rail.length > 0 && (
        <>
          <Text style={[styles.sectionTitle, styles.sectionTitleSpaced]}>
            {myTeams.length > 0 ? `Videos for you` : `Trending in ${cfg.title}`}
          </Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.railRow}>
            {rail.map((p) => {
              const uri = postThumbnail(p);
              const isVideo = p.type === 'video' || !!p.videoUrl;
              return (
                <TouchableOpacity key={p.id} style={styles.railCard} activeOpacity={0.85} onPress={() => openPost(p)}>
                  {uri ? (
                    <Image source={{ uri }} style={styles.railThumb} resizeMode="cover" />
                  ) : (
                    <View style={[styles.railThumb, styles.thumbFallback]}>
                      <Icon name={cfg.heroIcon} size={22} color={COLORS.textMuted} />
                    </View>
                  )}
                  {isVideo && (
                    <View style={styles.playBadge}>
                      <Icon name="play" size={12} color={COLORS.white} />
                    </View>
                  )}
                  <Text style={styles.railTitle} numberOfLines={2}>
                    {p.title || p.caption || p.description || 'Post'}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </>
      )}

      {/* Creators to follow */}
      {creators.length > 0 && (
        <>
          <Text style={[styles.sectionTitle, styles.sectionTitleSpaced]}>{cfg.title} creators to follow</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.railRow}>
            {creators.map((u) => {
              const avatar = creatorAvatar(u);
              const id = u.id || u.uid;
              const isF = followingSet.has(id);
              return (
                <View key={id} style={styles.creatorCard}>
                  <TouchableOpacity activeOpacity={0.85} onPress={() => openCreator(u)}>
                    {avatar ? (
                      <Image source={{ uri: avatar }} style={styles.creatorAvatar} />
                    ) : (
                      <View style={[styles.creatorAvatar, styles.thumbFallback]}>
                        <Icon name="person-circle-outline" size={28} color={COLORS.textMuted} />
                      </View>
                    )}
                    <Text style={styles.creatorName} numberOfLines={1}>@{u.username || u.displayName || 'user'}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.followBtn, isF ? styles.followingBtn : { backgroundColor: cfg.accent }]}
                    activeOpacity={0.85}
                    onPress={() => toggleFollow(id)}
                  >
                    <Text style={[styles.followText, isF && styles.followingText]}>{isF ? 'Following' : 'Follow'}</Text>
                  </TouchableOpacity>
                </View>
              );
            })}
          </ScrollView>
        </>
      )}

      <Text style={[styles.sectionTitle, styles.sectionTitleSpaced]}>Latest</Text>
    </View>
  );

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={cfg.accent} />
      </View>
    );
  }

  return (
    <>
      <FlatList
        style={styles.root}
        data={posts}
        keyExtractor={(item) => String(item.id)}
        renderItem={renderGridItem}
        numColumns={2}
        columnWrapperStyle={styles.gridRow}
        contentContainerStyle={styles.grid}
        ListHeaderComponent={Header}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              load();
            }}
            tintColor={cfg.accent}
          />
        }
        ListEmptyComponent={
          <View style={styles.center}>
            <Icon name={cfg.heroIcon} size={42} color={COLORS.textMuted} />
            <Text style={styles.emptyText}>No {cfg.title} posts yet</Text>
            <Text style={styles.emptySub}>Ask Blyp or check back soon.</Text>
          </View>
        }
      />

      {/* Team picker modal */}
      <Modal visible={pickerOpen} animationType="slide" transparent onRequestClose={() => setPickerOpen(false)}>
        <View style={styles.modalMask}>
          <View style={styles.modalSheet}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>{cfg.addLabel}</Text>
              <TouchableOpacity onPress={() => setPickerOpen(false)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                <Icon name="close" size={24} color={COLORS.textPrimary} />
              </TouchableOpacity>
            </View>
            <View style={styles.searchBox}>
              <Icon name="search" size={16} color={COLORS.textMuted} />
              <TextInput
                style={styles.searchInput}
                placeholder={cfg.kind === 'f1' ? 'Search constructors…' : 'Search clubs…'}
                placeholderTextColor={COLORS.textMuted}
                value={pickerQuery}
                onChangeText={(t) => {
                  setPickerQuery(t);
                  runPickerSearch(t);
                }}
                autoFocus
                returnKeyType="search"
              />
            </View>
            {pickerLoading ? (
              <View style={styles.modalCenter}>
                <ActivityIndicator color={cfg.accent} />
              </View>
            ) : (
              <FlatList
                data={pickerResults}
                keyExtractor={(item) => String(item.id)}
                keyboardShouldPersistTaps="handled"
                style={styles.pickerList}
                renderItem={({ item }) => {
                  const already = teams.some((t) => t.id === item.id);
                  return (
                    <TouchableOpacity style={styles.pickerRow} activeOpacity={0.85} onPress={() => !already && onAddTeam(item)} disabled={already}>
                      <TeamBadge uri={item.badge} size={36} accent={cfg.accent} />
                      <View style={styles.pickerText}>
                        <Text style={styles.pickerName} numberOfLines={1}>{item.name}</Text>
                        <Text style={styles.pickerSub} numberOfLines={1}>
                          {[item.league, item.country].filter(Boolean).join(' · ') || cfg.title}
                        </Text>
                      </View>
                      {already ? (
                        <Icon name="checkmark-circle" size={22} color={cfg.accent} />
                      ) : (
                        <Icon name="add-circle" size={22} color={COLORS.textMuted} />
                      )}
                    </TouchableOpacity>
                  );
                }}
                ListEmptyComponent={
                  <View style={styles.modalCenter}>
                    <Text style={styles.emptySub}>No matches{pickerQuery.trim() ? ` for “${pickerQuery.trim()}”` : ''}.</Text>
                  </View>
                }
              />
            )}
          </View>
        </View>
      </Modal>
    </>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.pageBackground },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: responsiveSize(80), gap: 8 },

  hero: { paddingHorizontal: 18, paddingTop: 22, paddingBottom: 18 },
  heroBadge: { width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center', marginBottom: 12 },
  heroTitle: { color: COLORS.white, fontSize: responsiveFont(28), fontWeight: '900', letterSpacing: -0.5 },
  heroTagline: { color: 'rgba(255,255,255,0.85)', fontSize: responsiveFont(14), marginTop: 4 },
  askBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 7, alignSelf: 'flex-start', marginTop: 14,
    paddingHorizontal: 14, paddingVertical: 9, borderRadius: 999, borderWidth: 1.5, backgroundColor: 'rgba(0,0,0,0.25)',
  },
  askText: { fontSize: responsiveFont(13), fontWeight: '800' },

  yourTeamWrap: { paddingHorizontal: 16, paddingTop: 18 },
  sectionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  sectionTitle: { color: COLORS.textPrimary, fontSize: responsiveFont(16), fontWeight: '800' },
  sectionTitleSpaced: { marginTop: 22, marginBottom: 12, marginLeft: 16 },
  addPill: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999 },
  addPillText: { color: COLORS.white, fontSize: responsiveFont(12), fontWeight: '800' },

  emptyTeam: {
    alignItems: 'center', gap: 6, paddingVertical: 22, paddingHorizontal: 18, borderRadius: 16,
    borderWidth: 1.5, borderStyle: 'dashed', backgroundColor: COLORS.backgroundCard,
  },
  emptyTeamTitle: { color: COLORS.textPrimary, fontSize: responsiveFont(15), fontWeight: '800', marginTop: 4 },
  emptyTeamSub: { color: COLORS.textMuted, fontSize: responsiveFont(12), textAlign: 'center' },

  teamCard: {
    backgroundColor: COLORS.backgroundCard, borderRadius: 14, padding: 14, marginBottom: 12,
    borderLeftWidth: 3, gap: 8,
  },
  teamHeader: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  teamHeaderText: { flex: 1 },
  teamName: { color: COLORS.textPrimary, fontSize: responsiveFont(16), fontWeight: '800' },
  teamLeague: { color: COLORS.textMuted, fontSize: responsiveFont(12), marginTop: 1 },
  teamRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  teamRowLabel: { color: COLORS.textMuted, fontSize: responsiveFont(10), fontWeight: '800', width: 38 },
  teamRowValue: { color: COLORS.textSecondary, fontSize: responsiveFont(13), flex: 1 },
  teamRowMuted: { color: COLORS.textMuted, fontSize: responsiveFont(13), flex: 1 },
  teamAsk: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 },
  teamAskText: { fontSize: responsiveFont(12), fontWeight: '700' },

  f1Chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 },
  f1Chip: {
    flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 6,
    borderRadius: 999, borderWidth: 1, backgroundColor: COLORS.backgroundCard, maxWidth: '100%',
  },
  f1ChipText: { color: COLORS.textPrimary, fontSize: responsiveFont(12), fontWeight: '700', maxWidth: 120 },
  gpName: { color: COLORS.textPrimary, fontSize: responsiveFont(17), fontWeight: '900', marginTop: 2 },
  podiumRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 2 },
  podiumPos: { fontSize: responsiveFont(13), fontWeight: '900', width: 30 },
  podiumDriver: { color: COLORS.textPrimary, fontSize: responsiveFont(13), fontWeight: '700', flex: 1 },
  podiumTeam: { color: COLORS.textMuted, fontSize: responsiveFont(12), flex: 1, textAlign: 'right' },

  chipRow: { gap: 8, paddingHorizontal: 14, paddingTop: 18 },
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, backgroundColor: COLORS.backgroundCard, borderWidth: 1, borderColor: COLORS.border },
  chipText: { color: COLORS.textSecondary, fontSize: responsiveFont(13), fontWeight: '700' },

  railRow: { gap: 12, paddingHorizontal: 16 },
  railCard: { width: 140 },
  railThumb: { width: 140, height: 180, borderRadius: 12, backgroundColor: COLORS.surface },
  railTitle: { color: COLORS.textSecondary, fontSize: responsiveFont(12), marginTop: 6, lineHeight: responsiveFont(16) },

  creatorCard: { width: 110, alignItems: 'center' },
  creatorAvatar: { width: 64, height: 64, borderRadius: 32, backgroundColor: COLORS.surface, alignSelf: 'center' },
  creatorName: { color: COLORS.textSecondary, fontSize: responsiveFont(12), fontWeight: '600', marginTop: 6, textAlign: 'center' },
  followBtn: { marginTop: 8, paddingVertical: 7, paddingHorizontal: 16, borderRadius: 999, alignItems: 'center' },
  followingBtn: { backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border },
  followText: { color: COLORS.black, fontSize: responsiveFont(12), fontWeight: '800' },
  followingText: { color: COLORS.textSecondary },

  grid: { paddingHorizontal: 14, paddingBottom: 120 },
  gridRow: { justifyContent: 'space-between' },
  card: { width: '48%', marginBottom: 16 },
  thumbWrap: { position: 'relative', width: '100%', aspectRatio: 1, borderRadius: 12, overflow: 'hidden' },
  thumb: { width: '100%', height: '100%', backgroundColor: COLORS.surface },
  thumbFallback: { alignItems: 'center', justifyContent: 'center' },
  playBadge: { position: 'absolute', bottom: 8, right: 8, width: 24, height: 24, borderRadius: 12, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center' },
  cardTitle: { color: COLORS.textSecondary, fontSize: responsiveFont(13), marginTop: 6, lineHeight: responsiveFont(18) },

  emptyText: { color: COLORS.textPrimary, fontSize: responsiveFont(15), fontWeight: '700', marginTop: 6 },
  emptySub: { color: COLORS.textMuted, fontSize: responsiveFont(13) },

  // Picker modal
  modalMask: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  modalSheet: { backgroundColor: COLORS.pageBackground, borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingHorizontal: 16, paddingTop: 14, height: '80%' },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  modalTitle: { color: COLORS.textPrimary, fontSize: responsiveFont(18), fontWeight: '800' },
  searchBox: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: COLORS.backgroundCard, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10 },
  searchInput: { flex: 1, color: COLORS.textPrimary, fontSize: responsiveFont(14), padding: 0 },
  modalCenter: { alignItems: 'center', justifyContent: 'center', paddingVertical: 40 },
  pickerList: { marginTop: 10 },
  pickerRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: COLORS.border },
  pickerText: { flex: 1 },
  pickerName: { color: COLORS.textPrimary, fontSize: responsiveFont(15), fontWeight: '700' },
  pickerSub: { color: COLORS.textMuted, fontSize: responsiveFont(12), marginTop: 1 },
});

export default SportPagePanel;
