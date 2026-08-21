// OnboardingScreen.js
//
// First-run flow shown once per user after auth. Welcomes them, lets them pick
// the topics they care about, and seeds their personalized Home. Saved via
// userPreferencesService and gated by the `onboarded` flag in App.js.

import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  Linking,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import ScreenContainer from '../components/ScreenContainer';
import Icon from '../components/Icon';
import BlypLogo from '../components/BlypLogo';
import { COLORS } from '../styles/theme';
import { responsiveFont, responsiveSize } from '../utils/scaleUtils';
import { INTEREST_CATALOG, SPORT_PAGE_IDS, completeOnboarding } from '../services/userPreferencesService';
import { getSuggestedCreators, creatorAvatar } from '../services/discoveryService';
import { followUser, unfollowUser } from '../utils/followUtils';
import { PLANS } from '../services/transparencyService';
import { loadEntitlement } from '../services/entitlementService';
import { startCheckout } from '../services/subscriptionService';
import { HOW_BLYP_WORKS, LAYER_2_NOTE, recordAcceptance } from '../services/termsService';
import { requestImport, normalizeHandle, isValidHandle } from '../services/socialImportService';
import { searchFootballTeams } from '../services/footballDataService';
import { getF1Teams } from '../services/formula1DataService';
import { addFollowedTeam } from '../services/teamPreferencesService';

const MIN_PICKS = 3;
// Where the full, formal Terms live (Layer-2). Update when legal review lands.
const FULL_TERMS_URL = 'https://blyp.app/terms';

const OnboardingScreen = ({ uid, onDone }) => {
  const [step, setStep] = useState(0);
  const [selected, setSelected] = useState([]);
  const [saving, setSaving] = useState(false);
  const [creators, setCreators] = useState([]);
  const [loadingCreators, setLoadingCreators] = useState(false);
  const [following, setFollowing] = useState(new Set());
  const [chosenPlan, setChosenPlan] = useState(null);
  const [planBusy, setPlanBusy] = useState(false);
  const [importHandle, setImportHandle] = useState('');
  const [importOwns, setImportOwns] = useState(false);
  const [importBusy, setImportBusy] = useState(false);
  const [importMsg, setImportMsg] = useState('');
  const [teamSport, setTeamSport] = useState(null); // 'football' | 'f1'
  const [teamQuery, setTeamQuery] = useState('');
  const [teamResults, setTeamResults] = useState([]);
  const [teamLoading, setTeamLoading] = useState(false);
  const [pickedTeams, setPickedTeams] = useState([]);

  const sportInterests = selected.filter((id) => SPORT_PAGE_IDS.includes(id));

  const submitImport = async () => {
    const h = normalizeHandle(importHandle);
    if (!importOwns) { setImportMsg('Please confirm these are your own videos.'); return; }
    if (!isValidHandle(h)) { setImportMsg('That doesn’t look like a valid TikTok username.'); return; }
    setImportBusy(true);
    setImportMsg('');
    try {
      await requestImport({ uid, platform: 'tiktok', handle: h, claimedOwnership: importOwns });
      setImportMsg(`Great — we’re bringing @${h}'s videos over. They’ll appear on your profile shortly.`);
      setImportHandle('');
    } catch (e) {
      setImportMsg(e?.message || 'Couldn’t start the import. You can try again later from your profile.');
    } finally {
      setImportBusy(false);
    }
  };

  const toggle = (id) =>
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const goToFollows = async () => {
    setStep(2);
    setLoadingCreators(true);
    try {
      const byId = new Map(INTEREST_CATALOG.map((i) => [i.id, i.label]));
      const terms = selected
        .map((id) => byId.get(id))
        .filter(Boolean)
        .flatMap((l) => String(l).toLowerCase().split(/\s+/));
      const list = await getSuggestedCreators(15, terms, uid);
      setCreators(list);
    } catch {
      setCreators([]);
    } finally {
      setLoadingCreators(false);
    }
  };

  const goAfterInterests = () => {
    if (sportInterests.length > 0) {
      const first = sportInterests.includes('football') ? 'football' : sportInterests[0];
      setTeamSport(first);
      setTeamQuery('');
      setTeamResults([]);
      setStep(6);
      return;
    }
    goToFollows();
  };

  useEffect(() => {
    if (step !== 6 || !teamSport) return undefined;
    let cancelled = false;
    (async () => {
      setTeamLoading(true);
      try {
        let res = [];
        if (teamSport === 'football') {
          res = await searchFootballTeams(teamQuery);
        } else {
          const all = await getF1Teams();
          const needle = String(teamQuery || '').trim().toLowerCase();
          res = needle ? all.filter((t) => (t.name || '').toLowerCase().includes(needle)) : all;
        }
        if (!cancelled) setTeamResults(res || []);
      } catch {
        if (!cancelled) setTeamResults([]);
      } finally {
        if (!cancelled) setTeamLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [step, teamSport, teamQuery]);

  const pickTeam = async (team) => {
    if (!team?.id) return;
    if (pickedTeams.some((t) => t.id === team.id)) return;
    setPickedTeams((prev) => [...prev, team]);
    try {
      await addFollowedTeam(uid, team);
    } catch {
      /* local follow is best-effort */
    }
  };

  const finishTeamStep = () => {
    // If both football + F1 selected and we only did football, offer F1 next.
    if (teamSport === 'football' && sportInterests.includes('f1')) {
      const alreadyDidF1 = pickedTeams.some((t) => t.sport === 'F1');
      if (!alreadyDidF1) {
        setTeamSport('f1');
        setTeamQuery('');
        setTeamResults([]);
        return;
      }
    }
    goToFollows();
  };

  const toggleFollow = async (user) => {
    const targetId = user.id || user.uid || user.userId;
    if (!uid || !targetId) return;
    const isF = following.has(targetId);
    setFollowing((prev) => {
      const next = new Set(prev);
      if (isF) next.delete(targetId);
      else next.add(targetId);
      return next;
    });
    try {
      const res = isF
        ? await unfollowUser(uid, targetId)
        : await followUser(uid, targetId);
      if (!res?.success) {
        setFollowing((prev) => {
          const next = new Set(prev);
          if (isF) next.add(targetId);
          else next.delete(targetId);
          return next;
        });
      }
    } catch {
      setFollowing((prev) => {
        const next = new Set(prev);
        if (isF) next.add(targetId);
        else next.delete(targetId);
        return next;
      });
    }
  };

  const finish = async () => {
    setSaving(true);
    try {
      await completeOnboarding(uid, selected);
    } catch {
      /* best effort — still let them in */
    } finally {
      setSaving(false);
      onDone?.();
    }
  };

  // Plan step: everyone starts the 30-day full-feature trial (server rules allow
  // a self-serve trial). Paid tiers are sold via Google Play (native billing is
  // being finalised), so a paid choice is best-effort and never blocks sign-up.
  const choosePlan = async (planId) => {
    if (planBusy) return;
    setChosenPlan(planId);
    setPlanBusy(true);
    try {
      if (uid) {
        try { await loadEntitlement(uid); } catch { /* non-fatal */ }
      }
      // The "30-day free trial" is sold as a Google Play subscription with a
      // free-trial offer: Google shows the "£0 today, renews on <date>" sheet and
      // auto-converts to Plus after 30 days (cancel any time). If Play billing
      // isn't available yet, we fall back to the no-card 30-day trial so sign-up
      // never blocks.
      if (planId === 'trial') {
        try {
          const res = await startCheckout('plus', uid);
          if (res?.ok) {
            Alert.alert(
              'Free trial started',
              'You won’t be charged today. Your Blyp Plus subscription starts after your 30-day free trial — cancel any time in Google Play before then and pay nothing.'
            );
          } else if (res?.reason && res.reason !== 'user-cancelled') {
            Alert.alert(
              'Your 30 days are on',
              'Full access is unlocked free for 30 days — you won’t be charged. You can set up a paid plan from your profile any time.'
            );
          }
        } catch { /* non-fatal — they keep the no-card trial */ }
      } else if (planId === 'plus' || planId === 'plus_coins') {
        try {
          const res = await startCheckout(planId, uid);
          if (!res?.ok && (res?.reason === 'billing-pending' || res?.reason === 'platform-not-supported')) {
            Alert.alert(
              'Your 30 days are on',
              'Full access is unlocked free for 30 days. You can purchase a paid plan from your profile shortly — you won’t be charged until then.'
            );
          }
        } catch { /* non-fatal */ }
      }
    } finally {
      setPlanBusy(false);
      setStep(4);
    }
  };

  const acceptTerms = async () => {
    try {
      if (uid) await recordAcceptance(uid);
    } catch { /* best effort — still let them in */ }
    await finish();
  };

  const openFullTerms = () => {
    Linking.openURL(FULL_TERMS_URL).catch(() => {
      Alert.alert('Full terms', 'The full Terms are being finalised with our lawyers and will be available here soon.');
    });
  };

  if (step === 0) {
    return (
      <ScreenContainer>
        <View style={styles.welcomeWrap}>
          <View style={styles.logoRow}>
            <BlypLogo textStyle={{ fontSize: responsiveFont(44) }} />
          </View>
          <Text style={styles.welcomeTitle}>Welcome to Blyp</Text>
          <Text style={styles.welcomeSub}>
            Ask anything, watch anything, do nearly everything — in one place. Tell us what you're
            into and we'll set up your home.
          </Text>

          <View style={styles.featureList}>
            {[
              { icon: 'sparkles', text: 'Blyp it — ask the AI anything, get answers + content' },
              { icon: 'albums', text: 'Build your own home from the pages you care about' },
              { icon: 'flash', text: 'Live, sports, games, creators — all in one app' },
            ].map((f) => (
              <View key={f.text} style={styles.featureRow}>
                <View style={styles.featureIcon}>
                  <Icon name={f.icon} size={18} color={COLORS.primary} />
                </View>
                <Text style={styles.featureText}>{f.text}</Text>
              </View>
            ))}
          </View>

          <TouchableOpacity style={styles.primaryBtn} activeOpacity={0.9} onPress={() => setStep(1)}>
            <Text style={styles.primaryBtnText}>Get started</Text>
            <Icon name="arrow-forward" size={18} color={COLORS.black} />
          </TouchableOpacity>
          <TouchableOpacity style={styles.secondaryBtn} activeOpacity={0.9} onPress={() => setStep(5)}>
            <Icon name="logo-tiktok" size={16} color={COLORS.primary} />
            <Text style={styles.secondaryBtnText}>Bring your TikTok videos</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setStep(3)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Text style={styles.skipText}>Skip for now</Text>
          </TouchableOpacity>
        </View>
      </ScreenContainer>
    );
  }

  if (step === 5) {
    const h = normalizeHandle(importHandle);
    const ready = importOwns && isValidHandle(h) && !importBusy;
    return (
      <ScreenContainer>
        <ScrollView contentContainerStyle={styles.importWrap} keyboardShouldPersistTaps="handled">
          <Text style={styles.eyebrow}>BRING YOUR CONTENT</Text>
          <Text style={styles.welcomeTitle}>Import from TikTok</Text>
          <Text style={styles.welcomeSub}>
            Pull your videos in so your Blyp profile feels like home straight away — captions, hashtags and dates come too.
          </Text>

          <View style={styles.importInputRow}>
            <Text style={styles.importAt}>@</Text>
            <TextInput
              style={styles.importInput}
              value={importHandle}
              onChangeText={(t) => { setImportHandle(t); if (importMsg) setImportMsg(''); }}
              placeholder="yourusername"
              placeholderTextColor={COLORS.textMuted}
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="done"
            />
          </View>

          <TouchableOpacity style={styles.importOwnRow} activeOpacity={0.8} onPress={() => setImportOwns((v) => !v)}>
            <View style={[styles.importCheckbox, importOwns && styles.importCheckboxOn]}>
              {importOwns && <Icon name="checkmark" size={14} color={COLORS.black} />}
            </View>
            <Text style={styles.importOwnText}>These are my own videos and I have the right to post them on Blyp.</Text>
          </TouchableOpacity>

          {!!importMsg && <Text style={styles.importMsg}>{importMsg}</Text>}

          <TouchableOpacity
            style={[styles.primaryBtn, !ready && styles.primaryBtnDisabled]}
            activeOpacity={0.9}
            disabled={!ready}
            onPress={submitImport}
          >
            {importBusy
              ? <ActivityIndicator color={COLORS.black} />
              : <Text style={styles.primaryBtnText}>Import my videos</Text>}
          </TouchableOpacity>

          <TouchableOpacity onPress={() => setStep(3)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Text style={styles.skipText}>{importMsg && !importBusy ? 'Continue' : 'Skip for now'}</Text>
          </TouchableOpacity>
        </ScrollView>
      </ScreenContainer>
    );
  }

  if (step === 2) {
    return (
      <ScreenContainer>
        <View style={styles.pickWrap}>
          <Text style={styles.eyebrow}>FILL YOUR FEED</Text>
          <Text style={styles.pickTitle}>Follow a few creators</Text>
          <Text style={styles.pickSub}>We picked these based on your interests. Follow some to fill your feed.</Text>

          {loadingCreators ? (
            <View style={styles.creatorsLoading}>
              <ActivityIndicator size="large" color={COLORS.primary} />
            </View>
          ) : creators.length === 0 ? (
            <View style={styles.creatorsLoading}>
              <Icon name="people-outline" size={40} color={COLORS.textMuted} />
              <Text style={styles.noCreators}>No creators to suggest yet — you can find people anytime.</Text>
            </View>
          ) : (
            <ScrollView contentContainerStyle={styles.creatorList} showsVerticalScrollIndicator={false}>
              {creators.map((c) => {
                const targetId = c.id || c.uid || c.userId;
                const isF = following.has(targetId);
                const avatar = creatorAvatar(c);
                const initial = (c.displayName || c.username || '?').slice(0, 1).toUpperCase();
                return (
                  <View key={targetId} style={styles.creatorRow}>
                    {avatar ? (
                      <Image source={{ uri: avatar }} style={styles.creatorAvatar} />
                    ) : (
                      <View style={[styles.creatorAvatar, styles.creatorAvatarFallback]}>
                        <Text style={styles.creatorInitial}>{initial}</Text>
                      </View>
                    )}
                    <View style={styles.creatorInfo}>
                      <Text style={styles.creatorName} numberOfLines={1}>
                        @{c.username || c.displayName || 'user'}
                      </Text>
                      {!!c.bio && <Text style={styles.creatorBio} numberOfLines={1}>{c.bio}</Text>}
                    </View>
                    <TouchableOpacity
                      style={[styles.followBtn, isF && styles.followingBtn]}
                      activeOpacity={0.85}
                      onPress={() => toggleFollow(c)}
                    >
                      <Text style={[styles.followText, isF && styles.followingText]}>{isF ? 'Following' : 'Follow'}</Text>
                    </TouchableOpacity>
                  </View>
                );
              })}
            </ScrollView>
          )}

          <View style={styles.footer}>
            <TouchableOpacity style={styles.primaryBtn} activeOpacity={0.9} onPress={() => setStep(3)}>
              <Text style={styles.primaryBtnText}>
                {following.size > 0 ? `Continue — following ${following.size}` : 'Continue'}
              </Text>
              <Icon name="arrow-forward" size={18} color={COLORS.black} />
            </TouchableOpacity>
          </View>
        </View>
      </ScreenContainer>
    );
  }

  if (step === 3) {
    const planById = (id) => PLANS.find((p) => p.id === id) || {};
    const plus = planById('plus');
    const plusCoins = planById('plus_coins');
    return (
      <ScreenContainer>
        <View style={styles.pickWrap}>
          <Text style={styles.eyebrow}>CHOOSE YOUR PLAN</Text>
          <Text style={styles.pickTitle}>Start free for 30 days</Text>
          <Text style={styles.pickSub}>
            The whole app is unlocked free for 30 days. After that it stays useful for free — the AI
            extras become a paid upgrade. Paying never buys reach; it buys features and coins.
          </Text>

          <ScrollView contentContainerStyle={{ paddingBottom: 16 }} showsVerticalScrollIndicator={false}>
            <View style={[styles.planCard, styles.planCardHero]}>
              <View style={styles.planHeroBadge}>
                <Text style={styles.planHeroBadgeText}>RECOMMENDED</Text>
              </View>
              <Text style={styles.planName}>30-day free trial</Text>
              <Text style={styles.planPrice}>Free for 30 days</Text>
              <Text style={styles.planBlurb}>
                Everything on — all the AI features, all the time. Cancel any time before it ends and
                pay nothing.
              </Text>
              <TouchableOpacity
                style={styles.planPrimaryBtn}
                activeOpacity={0.9}
                disabled={planBusy}
                onPress={() => choosePlan('trial')}
              >
                {planBusy && chosenPlan === 'trial' ? (
                  <ActivityIndicator size="small" color={COLORS.black} />
                ) : (
                  <Text style={styles.planPrimaryBtnText}>Start my 30-day free trial</Text>
                )}
              </TouchableOpacity>
            </View>

            <Text style={styles.planSectionLabel}>Keep everything after the trial</Text>

            <TouchableOpacity
              style={styles.planCard}
              activeOpacity={0.9}
              disabled={planBusy}
              onPress={() => choosePlan('plus')}
            >
              <View style={styles.planRowTop}>
                <Text style={styles.planName}>{plus.name || 'Blyp Plus'}</Text>
                <Text style={styles.planPriceSm}>{plus.price || '$4.99/mo'}</Text>
              </View>
              <Text style={styles.planBlurb}>{plus.blurb || 'Everything on — all the AI features, all the time.'}</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.planCard}
              activeOpacity={0.9}
              disabled={planBusy}
              onPress={() => choosePlan('plus_coins')}
            >
              <View style={styles.planRowTop}>
                <Text style={styles.planName}>{plusCoins.name || 'Blyp Plus + Coins'}</Text>
                <Text style={styles.planPriceSm}>{plusCoins.price || '$9.99/mo'}</Text>
              </View>
              <Text style={styles.planBlurb}>{plusCoins.blurb || 'Everything in Plus, plus 999 coins every month.'}</Text>
            </TouchableOpacity>

            <Text style={styles.planFootnote}>
              Paid plans are billed securely through Google Play — we never see your card. You can
              upgrade or cancel any time from your profile.
            </Text>
          </ScrollView>

          <View style={styles.footer}>
            <TouchableOpacity
              activeOpacity={0.8}
              disabled={planBusy}
              onPress={() => choosePlan('free')}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <Text style={styles.skipText}>Continue on the free plan</Text>
            </TouchableOpacity>
          </View>
        </View>
      </ScreenContainer>
    );
  }

  if (step === 4) {
    return (
      <ScreenContainer>
        <View style={styles.pickWrap}>
          <Text style={styles.eyebrow}>BEFORE YOU START</Text>
          <Text style={styles.pickTitle}>How Blyp works</Text>
          <Text style={styles.pickSub}>
            The honest gist, in plain English. By continuing you agree to these and to our full Terms.
          </Text>

          <ScrollView contentContainerStyle={{ paddingBottom: 16 }} showsVerticalScrollIndicator={false}>
            {HOW_BLYP_WORKS.map((item) => (
              <View key={item.title} style={styles.termsCard}>
                <View style={styles.termsIcon}>
                  <Icon name={item.icon} size={18} color={COLORS.primary} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.termsTitle}>{item.title}</Text>
                  <Text style={styles.termsBody}>{item.body}</Text>
                </View>
              </View>
            ))}

            <Text style={styles.termsNote}>{LAYER_2_NOTE}</Text>
            <TouchableOpacity onPress={openFullTerms} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Text style={styles.termsLink}>Read the full Terms &amp; Conditions</Text>
            </TouchableOpacity>
          </ScrollView>

          <View style={styles.footer}>
            <TouchableOpacity style={styles.primaryBtn} activeOpacity={0.9} disabled={saving} onPress={acceptTerms}>
              {saving ? (
                <ActivityIndicator size="small" color={COLORS.black} />
              ) : (
                <>
                  <Text style={styles.primaryBtnText}>I agree — enter Blyp</Text>
                  <Icon name="arrow-forward" size={18} color={COLORS.black} />
                </>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </ScreenContainer>
    );
  }

  if (step === 6) {
    const title = teamSport === 'f1' ? 'Pick your F1 team' : 'Pick your club';
    const sub =
      teamSport === 'f1'
        ? 'Follow a constructor — race weekends land on your Formula 1 page.'
        : 'Follow your club — fixtures and football videos land on your Football page.';
    return (
      <ScreenContainer>
        <View style={styles.pickWrap}>
          <Text style={styles.eyebrow}>YOUR TEAM</Text>
          <Text style={styles.pickTitle}>{title}</Text>
          <Text style={styles.pickSub}>{sub}</Text>

          <View style={styles.teamSearchBox}>
            <Icon name="search" size={16} color={COLORS.textMuted} />
            <TextInput
              style={styles.teamSearchInput}
              value={teamQuery}
              onChangeText={setTeamQuery}
              placeholder={teamSport === 'f1' ? 'Search constructors…' : 'Search clubs…'}
              placeholderTextColor={COLORS.textMuted}
              autoCorrect={false}
            />
          </View>

          {pickedTeams.length > 0 && (
            <View style={styles.pickedRow}>
              {pickedTeams.map((t) => (
                <View key={t.id} style={styles.pickedChip}>
                  {!!t.badge && <Image source={{ uri: t.badge }} style={styles.pickedBadge} />}
                  <Text style={styles.pickedText} numberOfLines={1}>{t.name}</Text>
                </View>
              ))}
            </View>
          )}

          {teamLoading ? (
            <View style={styles.creatorsLoading}>
              <ActivityIndicator size="large" color={COLORS.primary} />
            </View>
          ) : (
            <FlatList
              data={teamResults}
              keyExtractor={(item) => String(item.id)}
              style={{ flex: 1 }}
              contentContainerStyle={{ paddingBottom: 12 }}
              keyboardShouldPersistTaps="handled"
              renderItem={({ item }) => {
                const on = pickedTeams.some((t) => t.id === item.id);
                return (
                  <TouchableOpacity
                    style={[styles.teamRow, on && styles.teamRowOn]}
                    activeOpacity={0.85}
                    onPress={() => pickTeam(item)}
                    disabled={on}
                  >
                    {item.badge ? (
                      <Image source={{ uri: item.badge }} style={styles.teamBadge} resizeMode="contain" />
                    ) : (
                      <View style={[styles.teamBadge, styles.teamBadgeFallback]}>
                        <Icon name={teamSport === 'f1' ? 'flag' : 'football'} size={18} color={COLORS.textMuted} />
                      </View>
                    )}
                    <View style={{ flex: 1 }}>
                      <Text style={styles.teamName} numberOfLines={1}>{item.name}</Text>
                      {!!item.league && <Text style={styles.teamLeague} numberOfLines={1}>{item.league}</Text>}
                    </View>
                    <Icon name={on ? 'checkmark-circle' : 'add-circle-outline'} size={22} color={on ? COLORS.primary : COLORS.textMuted} />
                  </TouchableOpacity>
                );
              }}
              ListEmptyComponent={
                <Text style={styles.noCreators}>No teams found — try another search.</Text>
              }
            />
          )}

          <View style={styles.footer}>
            <TouchableOpacity style={styles.primaryBtn} activeOpacity={0.9} onPress={finishTeamStep}>
              <Text style={styles.primaryBtnText}>
                {pickedTeams.length > 0 ? `Continue (${pickedTeams.length} team${pickedTeams.length === 1 ? '' : 's'})` : 'Continue'}
              </Text>
              <Icon name="arrow-forward" size={18} color={COLORS.black} />
            </TouchableOpacity>
            <TouchableOpacity onPress={goToFollows} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <Text style={styles.skipText}>Skip for now</Text>
            </TouchableOpacity>
          </View>
        </View>
      </ScreenContainer>
    );
  }

  const enough = selected.length >= MIN_PICKS;

  return (
    <ScreenContainer>
      <View style={styles.pickWrap}>
        <Text style={styles.eyebrow}>YOUR INTERESTS</Text>
        <Text style={styles.pickTitle}>What are you into?</Text>
        <Text style={styles.pickSub}>Pick at least {MIN_PICKS}. You can change these anytime.</Text>

        <ScrollView contentContainerStyle={styles.grid} showsVerticalScrollIndicator={false}>
          {INTEREST_CATALOG.map((item) => {
            const on = selected.includes(item.id);
            return (
              <TouchableOpacity
                key={item.id}
                style={[styles.chip, on && styles.chipOn]}
                activeOpacity={0.85}
                onPress={() => toggle(item.id)}
              >
                <Icon name={item.icon} size={18} color={on ? COLORS.black : COLORS.textPrimary} />
                <Text style={[styles.chipText, on && styles.chipTextOn]}>{item.label}</Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>

        <View style={styles.footer}>
          <TouchableOpacity
            style={[styles.primaryBtn, !enough && styles.primaryBtnDisabled]}
            activeOpacity={0.9}
            disabled={!enough}
            onPress={goAfterInterests}
          >
            <Text style={styles.primaryBtnText}>
              {enough ? `Continue (${selected.length})` : `Pick ${MIN_PICKS - selected.length} more`}
            </Text>
            {enough && <Icon name="arrow-forward" size={18} color={COLORS.black} />}
          </TouchableOpacity>
        </View>
      </View>
    </ScreenContainer>
  );
};

const styles = StyleSheet.create({
  welcomeWrap: { flex: 1, paddingHorizontal: 28, paddingTop: responsiveSize(60), justifyContent: 'center' },
  logoRow: { alignItems: 'center', marginBottom: 24 },
  welcomeTitle: {
    color: COLORS.textPrimary,
    fontSize: responsiveFont(30),
    fontWeight: '800',
    textAlign: 'center',
    letterSpacing: -0.5,
  },
  welcomeSub: {
    color: COLORS.textSecondary,
    fontSize: responsiveFont(15),
    textAlign: 'center',
    lineHeight: responsiveFont(22),
    marginTop: 12,
  },
  featureList: { marginTop: 36, gap: 16 },
  featureRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  featureIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: 'rgba(255, 45, 85,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  featureText: { flex: 1, color: COLORS.textPrimary, fontSize: responsiveFont(14), lineHeight: responsiveFont(20) },
  primaryBtn: {
    marginTop: 40,
    backgroundColor: COLORS.primary,
    borderRadius: 16,
    height: 54,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  primaryBtnDisabled: { backgroundColor: COLORS.surface },
  primaryBtnText: { color: COLORS.black, fontSize: responsiveFont(16), fontWeight: '800' },
  skipText: { color: COLORS.textMuted, fontSize: responsiveFont(14), textAlign: 'center', marginTop: 18 },

  secondaryBtn: {
    marginTop: 14,
    height: 50,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: COLORS.primary,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  secondaryBtnText: { color: COLORS.primary, fontSize: responsiveFont(15), fontWeight: '800' },

  importWrap: { paddingHorizontal: 28, paddingTop: responsiveSize(60), paddingBottom: 60 },
  importInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingHorizontal: 14,
    marginTop: 24,
  },
  importAt: { color: COLORS.textMuted, fontSize: responsiveFont(16), fontWeight: '800', marginRight: 4 },
  importInput: { flex: 1, color: COLORS.textPrimary, fontSize: responsiveFont(15), paddingVertical: 14 },
  importOwnRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, marginTop: 16 },
  importCheckbox: {
    width: 22, height: 22, borderRadius: 6, borderWidth: 1.5, borderColor: COLORS.border,
    alignItems: 'center', justifyContent: 'center', marginTop: 1,
  },
  importCheckboxOn: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  importOwnText: { flex: 1, color: COLORS.textSecondary, fontSize: responsiveFont(13), lineHeight: responsiveFont(19) },
  importMsg: { color: COLORS.textSecondary, fontSize: responsiveFont(13), lineHeight: responsiveFont(19), marginTop: 16 },

  pickWrap: { flex: 1, paddingHorizontal: 20, paddingTop: responsiveSize(40) },
  eyebrow: { color: COLORS.primary, fontSize: responsiveFont(11), fontWeight: '800', letterSpacing: 1.5 },
  pickTitle: { color: COLORS.textPrimary, fontSize: responsiveFont(26), fontWeight: '800', marginTop: 6, letterSpacing: -0.5 },
  pickSub: { color: COLORS.textSecondary, fontSize: responsiveFont(14), marginTop: 8, marginBottom: 16 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, paddingBottom: 20 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 14,
    backgroundColor: COLORS.backgroundCard,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  chipOn: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  chipText: { color: COLORS.textPrimary, fontSize: responsiveFont(14), fontWeight: '600' },
  chipTextOn: { color: COLORS.black, fontWeight: '800' },
  footer: { paddingVertical: 12 },

  creatorsLoading: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, paddingHorizontal: 20 },
  noCreators: { color: COLORS.textMuted, fontSize: responsiveFont(14), textAlign: 'center', lineHeight: responsiveFont(20) },
  creatorList: { paddingVertical: 8, gap: 10 },
  creatorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 14,
    backgroundColor: COLORS.backgroundCard,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  creatorAvatar: { width: 48, height: 48, borderRadius: 24, backgroundColor: COLORS.surface },
  creatorAvatarFallback: { alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: COLORS.border },
  creatorInitial: { color: COLORS.textPrimary, fontSize: responsiveFont(18), fontWeight: '800' },
  creatorInfo: { flex: 1 },
  creatorName: { color: COLORS.textPrimary, fontSize: responsiveFont(15), fontWeight: '700' },
  creatorBio: { color: COLORS.textMuted, fontSize: responsiveFont(12), marginTop: 2 },
  followBtn: { paddingHorizontal: 18, paddingVertical: 8, borderRadius: 999, backgroundColor: COLORS.primary },
  followingBtn: { backgroundColor: 'transparent', borderWidth: 1, borderColor: COLORS.border },
  followText: { color: COLORS.black, fontSize: responsiveFont(13), fontWeight: '800' },
  followingText: { color: COLORS.textSecondary },

  // Plan step
  planCard: {
    backgroundColor: COLORS.backgroundCard,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: 16,
    marginTop: 12,
  },
  planCardHero: {
    borderColor: COLORS.primary,
    backgroundColor: 'rgba(255, 45, 85,0.08)',
  },
  planHeroBadge: {
    alignSelf: 'flex-start',
    backgroundColor: COLORS.primary,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    marginBottom: 10,
  },
  planHeroBadgeText: { color: COLORS.black, fontSize: responsiveFont(10), fontWeight: '800', letterSpacing: 1 },
  planSectionLabel: {
    color: COLORS.textMuted,
    fontSize: responsiveFont(12),
    fontWeight: '700',
    letterSpacing: 0.5,
    marginTop: 22,
    textTransform: 'uppercase',
  },
  planRowTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  planName: { color: COLORS.textPrimary, fontSize: responsiveFont(17), fontWeight: '800' },
  planPrice: { color: COLORS.primary, fontSize: responsiveFont(15), fontWeight: '800', marginTop: 4 },
  planPriceSm: { color: COLORS.primary, fontSize: responsiveFont(14), fontWeight: '800' },
  planBlurb: { color: COLORS.textSecondary, fontSize: responsiveFont(13), lineHeight: responsiveFont(19), marginTop: 8 },
  planPrimaryBtn: {
    marginTop: 16,
    backgroundColor: COLORS.primary,
    borderRadius: 14,
    height: 50,
    alignItems: 'center',
    justifyContent: 'center',
  },
  planPrimaryBtnText: { color: COLORS.black, fontSize: responsiveFont(15), fontWeight: '800' },
  planFootnote: {
    color: COLORS.textMuted,
    fontSize: responsiveFont(12),
    lineHeight: responsiveFont(18),
    marginTop: 20,
    textAlign: 'center',
  },

  // Terms step
  termsCard: {
    flexDirection: 'row',
    gap: 12,
    backgroundColor: COLORS.backgroundCard,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: 14,
    marginTop: 10,
  },
  termsIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: 'rgba(255, 45, 85,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  termsTitle: { color: COLORS.textPrimary, fontSize: responsiveFont(14), fontWeight: '800' },
  termsBody: { color: COLORS.textSecondary, fontSize: responsiveFont(12.5), lineHeight: responsiveFont(18), marginTop: 4 },
  termsNote: { color: COLORS.textMuted, fontSize: responsiveFont(12.5), lineHeight: responsiveFont(18), marginTop: 18 },
  termsLink: { color: COLORS.primary, fontSize: responsiveFont(13.5), fontWeight: '800', marginTop: 12, textAlign: 'center' },
  teamSearchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: COLORS.backgroundCard,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingHorizontal: 12,
    height: 44,
    marginBottom: 10,
  },
  teamSearchInput: { flex: 1, color: COLORS.textPrimary, fontSize: responsiveFont(14) },
  pickedRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 10 },
  pickedChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(255, 45, 85,0.12)',
    borderRadius: 20,
    paddingVertical: 6,
    paddingHorizontal: 10,
    maxWidth: '48%',
  },
  pickedBadge: { width: 18, height: 18, borderRadius: 4 },
  pickedText: { color: COLORS.textPrimary, fontSize: responsiveFont(12), fontWeight: '700', flexShrink: 1 },
  teamRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
    paddingHorizontal: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.border,
  },
  teamRowOn: { opacity: 0.7 },
  teamBadge: { width: 36, height: 36, borderRadius: 8 },
  teamBadgeFallback: {
    backgroundColor: COLORS.backgroundCard,
    alignItems: 'center',
    justifyContent: 'center',
  },
  teamName: { color: COLORS.textPrimary, fontSize: responsiveFont(14), fontWeight: '700' },
  teamLeague: { color: COLORS.textMuted, fontSize: responsiveFont(12), marginTop: 2 },
});

export default OnboardingScreen;
