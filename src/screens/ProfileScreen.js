import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, SafeAreaView, ScrollView, TouchableOpacity, Image, FlatList, StatusBar, Alert, Modal, TextInput } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { LinearGradient } from 'expo-linear-gradient';
import Icon from '../components/Icon';
import BlypLogo from '../components/BlypLogo';
import ActivityFeed from '../components/ActivityFeed';
import FollowerBooster from '../components/FollowerBooster';
import { auth, db, storage, firebaseEnabled } from '../config/firebase';
import { signOut } from 'firebase/auth';
import { subscribeToFollowersCount, getFollowersCount } from '../utils/followUtils';
import { addFakeFollowers } from '../utils/boostFollowers';

const ProfileScreen = () => {
  const navigation = useNavigation();
  const user = auth.currentUser;
  const [userPosts, setUserPosts] = useState([]);
  const [userProfile, setUserProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedTab, setSelectedTab] = useState('1');
  const [followersCount, setFollowersCount] = useState(0);
  const [showFollowerBooster, setShowFollowerBooster] = useState(false);
  const [developerMode, setDeveloperMode] = useState(false);
  const [showCodeModal, setShowCodeModal] = useState(false);
  const [codeInput, setCodeInput] = useState('');
  // Load profile
  useEffect(() => {
    if (!user) return;
    db.collection('users').doc(user.uid).get().then(doc => {
      if (doc.exists) setUserProfile(doc.data());
      else setUserProfile({ displayName: user.displayName || 'anonymous', email: user.email, photoURL: user.photoURL, bio: '' });
    }).catch(e => {
      console.log('[PROFILE][ERROR] load profile', e.message);
      setUserProfile({ displayName: user.displayName || 'anonymous', email: user.email, photoURL: user.photoURL, bio: '' });
    });
  }, [user]);

  // Followers
  useEffect(() => {
    if (!user) return;
    let unsub;
    try { unsub = subscribeToFollowersCount(user.uid, c => setFollowersCount(c)); }
    catch { getFollowersCount(user.uid).then(c => setFollowersCount(c)).catch(()=>setFollowersCount(0)); }
    return () => { if (unsub) unsub(); };
  }, [user]);

  // Posts subscription
  useEffect(() => {
    if (!user) return;
    if (!firebaseEnabled) { setLoading(false); setUserPosts([]); return; }
    const unsub = db.collection('posts').orderBy('date','desc').limit(50).onSnapshot(
      snap => {
        const all = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        const uid = user.uid;
        const owned = all.filter(p => p.userId === uid || p.ownerUid === uid || p.uid === uid);
        setUserPosts(owned);
        setLoading(false);
        setError(null);
      },
      err => { setError(err); setLoading(false); }
    );
    return () => unsub();
  }, [user, firebaseEnabled]);

  const handleLogout = async () => { try { await signOut(auth); } catch(e){ console.log('logout error', e.message);} };
  const handleBoostFollowers = async () => {
    Alert.alert('Unavailable', 'Follower boost tools are disabled.');
  };
  const handleDeletePost = (post) => {
    Alert.alert('Delete Post','Delete permanently?',[{text:'Cancel',style:'cancel'},{text:'Delete',style:'destructive',onPress:async()=>{try{const promises=[]; if(post.videoUrl){try{promises.push(storage.refFromURL(post.videoUrl).delete());}catch{}} if(Array.isArray(post.media)){post.media.forEach(m=>{if(m.url){try{promises.push(storage.refFromURL(m.url).delete());}catch{}} if(m.thumbnail&&m.thumbnail!==m.url){try{promises.push(storage.refFromURL(m.thumbnail).delete());}catch{}}});} if(post.thumbnail && !post.media?.some(m=>m.thumbnail===post.thumbnail)){try{promises.push(storage.refFromURL(post.thumbnail).delete());}catch{}} if(promises.length) await Promise.allSettled(promises); await db.collection('posts').doc(post.id).delete();}catch(e){Alert.alert('Error deleting',e.message);}}}]);
  };
  const handlePostPress = post => navigation.navigate('MediaViewer',{ post });
  const getVideoThumbnail = post => post.thumbnail || post.media?.[0]?.thumbnail || post.media?.[0]?.url || post.videoUrl || post.imageUrl || 'https://images.unsplash.com/photo-1574717024653-61fd2cf4d44d?w=400&h=400&fit=crop';
  const handleCodeSubmit = () => { Alert.alert('Unavailable', 'Developer boost tools are disabled.'); setShowCodeModal(false); setCodeInput(''); };

  const renderPostItem = ({ item: post }) => {
    const isVideo = post.type==='video'||post.media?.[0]?.type?.includes('video')||post.videoUrl||post.media?.[0]?.url?.includes('.mp4');
    return (
      <TouchableOpacity style={styles.postCard} onPress={()=>handlePostPress(post)} activeOpacity={0.8}>
        <TouchableOpacity style={styles.deleteButton} onPress={()=>handleDeletePost(post)}><Icon name="trash-outline" size={16} color="#ef4444" /></TouchableOpacity>
        {post.media?.length>0 ? (
          <View style={styles.mediaContainer}>
            <Image source={{ uri: getVideoThumbnail(post) }} style={styles.postImage} />
            {isVideo && <View style={styles.videoIndicator}><Icon name="play" size={16} color="#fff" /></View>}
          </View>
        ) : (
          <View style={styles.postTextPlaceholder}><Text style={styles.postEmoji}>{post.emoji||'💭'}</Text></View>
        )}
        <View style={styles.postOverlay}>
          <Text style={styles.postTitle} numberOfLines={2}>{post.title}</Text>
          <View style={styles.postIndicators}>
            {post.sharedTo?.length>0 && <View style={styles.sharedIndicator}><Icon name="share-outline" size={12} color="#fff" /></View>}
            {post.likes>0 && <View style={styles.likeIndicator}><Icon name="heart" size={12} color="#ff1744" /><Text style={styles.likeCount}>{post.likes}</Text></View>}
          </View>
        </View>
      </TouchableOpacity>
    );
  };

  const renderPostsGrid = () => {
    if (loading) return <View style={styles.loadingContainer}><Icon name="reload" size={32} color="#ec4899" /><Text style={styles.loadingText}>Loading posts...</Text></View>;
    if (error) return <View style={styles.postsGrid}><View style={styles.emptyPosts}><Icon name="warning-outline" size={48} color="#ef4444" /><Text style={styles.emptyText}>Error loading posts</Text><Text style={styles.emptySubtext}>{String(error.message||'Unknown error')}</Text></View></View>;
    if (!firebaseEnabled) return <View style={styles.postsGrid}><View style={styles.emptyPosts}><Icon name="cloud-offline-outline" size={48} color="#374151" /><Text style={styles.emptyText}>Profile posts disabled</Text><Text style={styles.emptySubtext}>Firebase disabled in this build.</Text></View></View>;
    if (userPosts.length===0) return <View style={styles.postsGrid}><View style={styles.emptyPosts}><Icon name="camera-outline" size={48} color="#374151" /><Text style={styles.emptyText}>No posts yet</Text><Text style={styles.emptySubtext}>Create your first post to see it here.</Text></View></View>;
    return <FlatList style={styles.flatListContainer} data={userPosts} renderItem={renderPostItem} numColumns={2} keyExtractor={i=>i.id} contentContainerStyle={styles.postsGridContent} showsVerticalScrollIndicator={false} initialNumToRender={6} />;
  };

  const renderHeader = () => (
    <View style={styles.header}>
      <View style={styles.headerTop}>
        <TouchableOpacity style={styles.menuButton}><Icon name="menu" size={24} color="#d1d5db" /></TouchableOpacity>
        <BlypLogo useGradientBackground />
        <TouchableOpacity style={styles.searchButton}><Icon name="search" size={24} color="#d1d5db" /></TouchableOpacity>
      </View>
      <View style={styles.tabContainer}>
        <View style={styles.tabSelector}>
          {[{key:'1',label:'My Profile'},{key:'2',label:'Activity'},{key:'3',label:'Drafts'},{key:'4',label:'Settings'}].map(t=> (
            <TouchableOpacity key={t.key} style={styles.tab} onPress={()=>setSelectedTab(t.key)}>
              <Text style={[styles.tabText, selectedTab===t.key && styles.activeTabText]}>{t.label}</Text>
            </TouchableOpacity>
          ))}
          <LinearGradient colors={['#a855f7','#d946ef','#ec4899']} style={[styles.tabIndicator,{ left:`${['1','2','3','4'].indexOf(selectedTab)*25}%` }]} />
        </View>
      </View>
    </View>
  );

  const renderProfileInfo = () => (
    <View style={styles.profileHeader}>
      <TouchableOpacity style={styles.profileImageContainer} onPress={()=>navigation.navigate('EditProfile')}>
        <Image source={{ uri: user?.photoURL || `https://placehold.co/120x120/475569/e2e8f0?text=${user?.displayName?.charAt(0).toUpperCase()||'A'}` }} style={styles.profileImage} />
        <View style={styles.editIconContainer}><Icon name="camera" size={16} color="#fff" /></View>
      </TouchableOpacity>
      <Text style={styles.username}>@{userProfile?.displayName || user?.displayName || 'anonymous'}</Text>
      <Text style={styles.userEmail}>{user?.email}</Text>
      {userProfile?.bio ? <Text style={styles.userBio}>{userProfile.bio}</Text> : null}
      <View style={styles.statsContainer}>
        <TouchableOpacity style={styles.statItem} onPress={()=>navigation.navigate('Followers',{userId:user.uid,type:'followers'})} onLongPress={handleBoostFollowers} delayLongPress={2000}>
          <Text style={styles.statNumber}>{followersCount}</Text><Text style={styles.statLabel}>Followers</Text>
        </TouchableOpacity>
        <View style={styles.statItem}><Text style={styles.statNumber}>{userPosts.length}</Text><Text style={styles.statLabel}>Posts</Text></View>
        <View style={styles.statItem}><Text style={styles.statNumber}>{userPosts.reduce((a,p)=>a+(p.likes||0),0)}</Text><Text style={styles.statLabel}>Likes</Text></View>
        <View style={styles.statItem}><Text style={styles.statNumber}>{userPosts.reduce((a,p)=>a+(p.sharedTo?.length||0),0)}</Text><Text style={styles.statLabel}>Shared</Text></View>
      </View>
      <View style={styles.actionButtons}>
        <TouchableOpacity style={styles.editButton} onPress={()=>navigation.navigate('EditProfile')}>
          <LinearGradient colors={['#a855f7','#d946ef','#ec4899']} style={styles.editButtonGradient}><Text style={styles.editButtonText}>Edit Profile</Text></LinearGradient>
        </TouchableOpacity>
        <TouchableOpacity style={styles.bookmarkButton}><Icon name="bookmark-outline" size={20} color="#fff" /></TouchableOpacity>
      </View>
    </View>
  );

  const renderTabContent = () => {
    switch(selectedTab){
      case '1': return <View style={styles.tabContent}>{renderProfileInfo()}{renderPostsGrid()}</View>;
      case '2': return <View style={styles.tabContent}><ActivityFeed navigation={navigation} /></View>;
      case '3': return <View style={styles.tabContent}><View style={styles.comingSoon}><Icon name="document-text-outline" size={64} color="#374151" /><Text style={styles.comingSoonTitle}>Drafts</Text><Text style={styles.comingSoonText}>Your saved drafts will appear here</Text></View></View>;
      case '4': return <View style={styles.tabContent}><ScrollView style={styles.settingsContainer}><View style={styles.settingsSection}><Text style={styles.settingsSectionTitle}>Developer Options</Text><TouchableOpacity style={styles.settingsItem} onPress={()=>setShowCodeModal(true)}><View style={styles.settingsItemLeft}><Icon name="code-outline" size={24} color="#8b5cf6" /><Text style={styles.settingsItemText}>Developer Code</Text></View><Icon name="chevron-forward" size={20} color="#9ca3af" /></TouchableOpacity>{developerMode && <View style={styles.developerBadge}><Text style={styles.developerBadgeText}>🛠️ Developer Mode Active</Text></View>}</View><View style={styles.settingsSection}><Text style={styles.settingsSectionTitle}>Account</Text><TouchableOpacity style={styles.settingsItem}><View style={styles.settingsItemLeft}><Icon name="person-outline" size={24} color="#6b7280" /><Text style={styles.settingsItemText}>Account Information</Text></View><Icon name="chevron-forward" size={20} color="#9ca3af" /></TouchableOpacity><TouchableOpacity style={styles.settingsItem}><View style={styles.settingsItemLeft}><Icon name="shield-outline" size={24} color="#6b7280" /><Text style={styles.settingsItemText}>Privacy & Security</Text></View><Icon name="chevron-forward" size={20} color="#9ca3af" /></TouchableOpacity><TouchableOpacity style={styles.settingsItem}><View style={styles.settingsItemLeft}><Icon name="notifications-outline" size={24} color="#6b7280" /><Text style={styles.settingsItemText}>Notifications</Text></View><Icon name="chevron-forward" size={20} color="#9ca3af" /></TouchableOpacity></View></ScrollView></View>;
      default: return null;
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="transparent" translucent />
      {renderHeader()}
      <View style={styles.content}>{renderTabContent()}</View>
      {showFollowerBooster && <FollowerBooster visible onClose={()=>setShowFollowerBooster(false)} />}
      <Modal animationType="fade" transparent visible={showCodeModal} onRequestClose={()=>{setShowCodeModal(false); setCodeInput('');}}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContainer}>
            <LinearGradient colors={['#8b5cf6','#d946ef']} style={styles.modalGradient}>
              <Text style={styles.modalTitle}>Developer Access</Text>
              <Text style={styles.modalSubtitle}>Enter the developer code:</Text>
              <TextInput style={styles.codeInput} value={codeInput} onChangeText={setCodeInput} placeholder="Enter code" placeholderTextColor="#9ca3af" secureTextEntry autoFocus onSubmitEditing={handleCodeSubmit} />
              <View style={styles.modalButtons}>
                <TouchableOpacity style={[styles.modalButton, styles.cancelButton]} onPress={()=>{setShowCodeModal(false); setCodeInput('');}}><Text style={styles.cancelButtonText}>Cancel</Text></TouchableOpacity>
                <TouchableOpacity style={[styles.modalButton, styles.submitButton]} onPress={handleCodeSubmit}><Text style={styles.submitButtonText}>OK</Text></TouchableOpacity>
              </View>
            </LinearGradient>
          </View>
        </View>
      </Modal>
      <TouchableOpacity style={styles.logoutButton} onPress={handleLogout}><Icon name="log-out-outline" size={24} color="#ef4444" /><Text style={styles.logoutText}>Log Out</Text></TouchableOpacity>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container:{ flex:1, backgroundColor:'#0f172a' },
  header:{ paddingTop:8 },
  headerTop:{ flexDirection:'row', alignItems:'center', justifyContent:'space-between', paddingHorizontal:16, paddingBottom:8 },
  menuButton:{ padding:8 },
  searchButton:{ padding:8 },
  tabContainer:{ paddingHorizontal:16, marginBottom:8 },
  tabSelector:{ position:'relative', flexDirection:'row', backgroundColor:'#1e293b', borderRadius:16, overflow:'hidden' },
  tab:{ flex:1, paddingVertical:12, alignItems:'center' },
  tabText:{ color:'#94a3b8', fontSize:14, fontWeight:'600' },
  activeTabText:{ color:'#fff' },
  tabIndicator:{ position:'absolute', bottom:0, height:3, width:'25%' },
  content:{ flex:1 },
  tabContent:{ flex:1 },
  comingSoon:{ flex:1, justifyContent:'center', alignItems:'center', paddingHorizontal:32 },
  comingSoonTitle:{ fontSize:24, fontWeight:'bold', color:'#e2e8f0', marginTop:16, marginBottom:8 },
  comingSoonText:{ fontSize:16, color:'#94a3b8', textAlign:'center', lineHeight:24 },
  profileHeader:{ alignItems:'center', padding:24 },
  profileImageContainer:{ position:'relative', marginBottom:16 },
  profileImage:{ width:120, height:120, borderRadius:60, borderWidth:3, borderColor:'#a855f7' },
  editIconContainer:{ position:'absolute', bottom:0, right:0, backgroundColor:'#a855f7', borderRadius:16, padding:6, borderWidth:2, borderColor:'#0f172a' },
  username:{ color:'#fff', fontSize:24, fontWeight:'bold', marginBottom:4 },
  userEmail:{ color:'#9ca3af', fontSize:16, marginBottom:8 },
  userBio:{ color:'#e2e8f0', fontSize:14, textAlign:'center', lineHeight:20, marginBottom:12, paddingHorizontal:20 },
  statsContainer:{ flexDirection:'row', marginTop:16, gap:24 },
  statItem:{ alignItems:'center' },
  statNumber:{ color:'#fff', fontSize:18, fontWeight:'bold' },
  statLabel:{ color:'#9ca3af', fontSize:14, marginTop:2 },
  actionButtons:{ flexDirection:'row', marginTop:16, gap:8 },
  editButton:{ flex:1, marginRight:8, borderRadius:12, overflow:'hidden' },
  editButtonGradient:{ paddingVertical:12, paddingHorizontal:24, alignItems:'center' },
  editButtonText:{ color:'#fff', fontWeight:'600' },
  bookmarkButton:{ backgroundColor:'#374151', paddingVertical:8, paddingHorizontal:16, borderRadius:12, alignItems:'center' },
  flatListContainer:{ flex:1 },
  postsGrid:{ flex:1, padding:8 },
  postsGridContent:{ padding:8, flexGrow:1 },
  loadingContainer:{ flex:1, justifyContent:'center', alignItems:'center', paddingVertical:40 },
  loadingText:{ color:'#9ca3af', fontSize:16 },
  postCard:{ flex:1, margin:4, aspectRatio:1, borderRadius:12, overflow:'hidden', backgroundColor:'#374151', position:'relative' },
  deleteButton:{ position:'absolute', top:8, right:8, backgroundColor:'rgba(0,0,0,0.8)', borderRadius:16, padding:6, zIndex:10 },
  postImage:{ width:'100%', height:'100%' },
  postTextPlaceholder:{ width:'100%', height:'100%', justifyContent:'center', alignItems:'center', backgroundColor:'#1e293b' },
  postEmoji:{ fontSize:32 },
  mediaContainer:{ width:'100%', height:'100%', position:'relative' },
  videoIndicator:{ position:'absolute', top:8, left:8, backgroundColor:'rgba(0,0,0,0.7)', borderRadius:12, padding:4, zIndex:1 },
  postOverlay:{ position:'absolute', bottom:0, left:0, right:0, backgroundColor:'rgba(0,0,0,0.7)', padding:8 },
  postTitle:{ color:'#fff', fontSize:12, fontWeight:'600', marginBottom:4 },
  postIndicators:{ flexDirection:'row', alignItems:'center', gap:8 },
  sharedIndicator:{ backgroundColor:'rgba(0,0,0,0.5)', borderRadius:12, padding:4 },
  likeIndicator:{ flexDirection:'row', alignItems:'center', backgroundColor:'rgba(0,0,0,0.5)', borderRadius:12, padding:4, gap:4 },
  likeCount:{ color:'#fff', fontSize:10, fontWeight:'600' },
  emptyPosts:{ flex:1, justifyContent:'center', alignItems:'center', paddingVertical:80 },
  emptyText:{ color:'#6b7280', fontSize:16, fontWeight:'600', marginTop:16 },
  emptySubtext:{ color:'#4b5563', fontSize:14, marginTop:8, textAlign:'center', maxWidth:250 },
  logoutButton:{ flexDirection:'row', alignItems:'center', justifyContent:'center', backgroundColor:'rgba(239,68,68,0.1)', marginHorizontal:16, marginVertical:24, paddingVertical:12, borderRadius:12, gap:8 },
  logoutText:{ color:'#ef4444', fontSize:16, fontWeight:'600' },
  settingsContainer:{ flex:1, paddingHorizontal:20 },
  settingsSection:{ marginBottom:32 },
  settingsSectionTitle:{ fontSize:18, fontWeight:'bold', color:'#e2e8f0', marginBottom:16, marginTop:8 },
  settingsItem:{ flexDirection:'row', justifyContent:'space-between', alignItems:'center', paddingVertical:16, paddingHorizontal:16, backgroundColor:'#1e293b', borderRadius:12, marginBottom:8 },
  settingsItemLeft:{ flexDirection:'row', alignItems:'center', flex:1 },
  settingsItemText:{ fontSize:16, color:'#e2e8f0', marginLeft:12, fontWeight:'500' },
  developerBadge:{ backgroundColor:'rgba(139,92,246,0.1)', borderRadius:8, padding:12, marginTop:8, borderWidth:1, borderColor:'rgba(139,92,246,0.3)' },
  developerBadgeText:{ color:'#8b5cf6', fontSize:14, fontWeight:'600', textAlign:'center' },
  modalOverlay:{ flex:1, backgroundColor:'rgba(0,0,0,0.7)', justifyContent:'center', alignItems:'center' },
  modalContainer:{ width:'85%', borderRadius:16, overflow:'hidden' },
  modalGradient:{ padding:24, alignItems:'center' },
  modalTitle:{ fontSize:20, fontWeight:'bold', color:'#fff', marginBottom:8, textAlign:'center' },
  modalSubtitle:{ fontSize:16, color:'#e2e8f0', marginBottom:24, textAlign:'center' },
  codeInput:{ width:'100%', backgroundColor:'rgba(255,255,255,0.1)', borderRadius:12, padding:16, fontSize:16, color:'#fff', textAlign:'center', marginBottom:24, borderWidth:2, borderColor:'rgba(255,255,255,0.3)' },
  modalButtons:{ flexDirection:'row', gap:12, width:'100%' },
  modalButton:{ flex:1, padding:14, borderRadius:12, alignItems:'center' },
  cancelButton:{ backgroundColor:'rgba(255,255,255,0.1)', borderWidth:1, borderColor:'rgba(255,255,255,0.3)' },
  submitButton:{ backgroundColor:'rgba(255,255,255,0.9)' },
  cancelButtonText:{ color:'#fff', fontSize:16, fontWeight:'600' },
  submitButtonText:{ color:'#8b5cf6', fontSize:16, fontWeight:'600' }
});

export default ProfileScreen;