import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, SafeAreaView, ScrollView, TouchableOpacity, Image, FlatList, StatusBar, Alert, Animated } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { LinearGradient } from 'expo-linear-gradient';
import Icon from '../components/Icon';
import BlypLogo from '../components/BlypLogo';
import { auth, db, storage, firebaseEnabled } from '../config/firebase';
import { signOut } from 'firebase/auth';
import { subscribeToFollowersCount, getFollowersCount } from '../utils/followUtils';

const ProfileScreen = () => {
  const navigation = useNavigation();
  const user = auth.currentUser;
  const [userPosts, setUserPosts] = useState([]);
  const [likedPosts, setLikedPosts] = useState([]);
  const [userProfile, setUserProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [selectedTab, setSelectedTab] = useState('posts'); // 'posts' or 'likes'
  const [profileTab, setProfileTab] = useState('myProfile'); // 'myProfile', 'tab1', 'tab2', 'tab3'
  const [followersCount, setFollowersCount] = useState(0);
  const [followingCount, setFollowingCount] = useState(0);
  
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

  // Followers count
  useEffect(() => {
    if (!user) return;
    let unsub;
    try { unsub = subscribeToFollowersCount(user.uid, c => setFollowersCount(c)); }
    catch { getFollowersCount(user.uid).then(c => setFollowersCount(c)).catch(()=>setFollowersCount(0)); }
    return () => { if (unsub) unsub(); };
  }, [user]);

  // Following count
  useEffect(() => {
    if (!user || !firebaseEnabled) return;
    const unsub = db.collection('followers').where('followerId','==',user.uid).onSnapshot(
      snap => setFollowingCount(snap.size),
      err => console.log('[PROFILE][ERROR] following count', err.message)
    );
    return () => unsub();
  }, [user, firebaseEnabled]);

  // User posts subscription
  useEffect(() => {
    if (!user) return;
    if (!firebaseEnabled) { setLoading(false); setUserPosts([]); return; }
    console.log('[PROFILE] Setting up posts query for userId:', user.uid);
    const unsub = db.collection('posts').where('userId','==',user.uid).orderBy('date','desc').limit(50).onSnapshot(
      snap => {
        const posts = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        console.log('[PROFILE] Loaded user posts:', posts.length);
        setUserPosts(posts);
        setLoading(false);
      },
      err => { 
        console.log('[PROFILE][ERROR] posts query', err.message); 
        setLoading(false); 
      }
    );
    return () => unsub();
  }, [user, firebaseEnabled]);

  // Liked posts subscription
  useEffect(() => {
    if (!user || !firebaseEnabled) return;
    console.log('[PROFILE] Setting up liked posts query');
    const unsub = db.collection('posts').where('likedBy','array-contains',user.uid).orderBy('date','desc').limit(50).onSnapshot(
      snap => {
        const posts = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        console.log('[PROFILE] Loaded liked posts:', posts.length);
        setLikedPosts(posts);
      },
      err => console.log('[PROFILE][ERROR] liked posts query', err.message)
    );
    return () => unsub();
  }, [user, firebaseEnabled]);

  const handleLogout = async () => { 
    Alert.alert('Logout','Are you sure you want to logout?',[
      {text:'Cancel',style:'cancel'},
      {text:'Logout',style:'destructive',onPress:async()=>{try{await signOut(auth);}catch(e){console.log('logout error',e.message);}}}
    ]);
  };
  
  const handleDeletePost = (post) => {
    Alert.alert('Delete Post','Delete permanently?',[{text:'Cancel',style:'cancel'},{text:'Delete',style:'destructive',onPress:async()=>{
      try{
        const promises=[];
        if(post.videoUrl){try{promises.push(storage.refFromURL(post.videoUrl).delete());}catch{}}
        if(Array.isArray(post.media)){
          post.media.forEach(m=>{
            if(m.url){try{promises.push(storage.refFromURL(m.url).delete());}catch{}}
            if(m.thumbnail&&m.thumbnail!==m.url){try{promises.push(storage.refFromURL(m.thumbnail).delete());}catch{}}
          });
        }
        if(post.thumbnail&&!post.media?.some(m=>m.thumbnail===post.thumbnail)){
          try{promises.push(storage.refFromURL(post.thumbnail).delete());}catch{}
        }
        if(promises.length) await Promise.allSettled(promises);
        await db.collection('posts').doc(post.id).delete();
        Alert.alert('Deleted','Post deleted successfully');
      }catch(e){Alert.alert('Error deleting',e.message);}
    }}]);
  };
  
  const handlePostPress = post => navigation.navigate('MediaViewer',{ post });
  
  const getPostThumbnail = post => {
    if(post.thumbnail) return post.thumbnail;
    if(post.media?.[0]?.thumbnail) return post.media[0].thumbnail;
    if(post.media?.[0]?.url) return post.media[0].url;
    if(post.videoUrl) return post.videoUrl;
    if(post.imageUrl) return post.imageUrl;
    return 'https://images.unsplash.com/photo-1611162617474-5b21e879e113?w=400&h=400&fit=crop';
  };

  const renderPostItem = ({ item: post }) => {
    const isVideo = post.type==='video'||post.media?.[0]?.type?.includes('video')||post.videoUrl||post.media?.[0]?.url?.includes('.mp4');
    const thumbnail = getPostThumbnail(post);
    return (
      <TouchableOpacity style={styles.gridItem} onPress={()=>handlePostPress(post)} activeOpacity={0.9}>
        <Image source={{ uri: thumbnail }} style={styles.gridImage} resizeMode="cover" />
        {isVideo && (
          <View style={styles.playIconOverlay}>
            <Icon name="play" size={20} color="#fff" />
          </View>
        )}
        <View style={styles.postStats}>
          <View style={styles.statBadge}>
            <Icon name="heart" size={14} color="#fff" />
            <Text style={styles.statText}>{post.likes||0}</Text>
          </View>
        </View>
        <TouchableOpacity style={styles.deleteIcon} onPress={(e)=>{e.stopPropagation();handleDeletePost(post);}}>
          <Icon name="close-circle" size={24} color="rgba(239,68,68,0.9)" />
        </TouchableOpacity>
      </TouchableOpacity>
    );
  };

  const renderPostsGrid = () => {
    const displayPosts = selectedTab === 'posts' ? userPosts : likedPosts;
    if (loading && selectedTab === 'posts') {
      return <View style={styles.emptyState}><Icon name="reload-circle-outline" size={48} color="#ec4899" /><Text style={styles.emptyText}>Loading...</Text></View>;
    }
    if (!firebaseEnabled) {
      return <View style={styles.emptyState}><Icon name="cloud-offline-outline" size={48} color="#6b7280" /><Text style={styles.emptyText}>Offline mode</Text><Text style={styles.emptySubtext}>Posts unavailable</Text></View>;
    }
    if (displayPosts.length === 0) {
      return (
        <View style={styles.emptyState}>
          <Icon name="camera-outline" size={64} color="#6b7280" />
          <Text style={styles.emptyText}>{selectedTab==='posts'?'No posts yet':'No liked posts'}</Text>
          <Text style={styles.emptySubtext}>{selectedTab==='posts'?'Create your first post':'Like posts to see them here'}</Text>
        </View>
      );
    }
    return (
      <FlatList
        data={displayPosts}
        renderItem={renderPostItem}
        keyExtractor={i=>i.id}
        numColumns={3}
        contentContainerStyle={styles.gridContainer}
        showsVerticalScrollIndicator={false}
        initialNumToRender={12}
      />
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="transparent" translucent />
      
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerTop}>
          <TouchableOpacity style={styles.menuButton} onPress={()=>navigation.openDrawer?.()}>
            <Icon name="menu" size={24} color="#d1d5db" />
          </TouchableOpacity>
          <View style={styles.logoContainer}>
            <BlypLogo useGradientBackground={true} />
          </View>
          <TouchableOpacity style={styles.menuButton} onPress={()=>navigation.navigate('Search')}>
            <Icon name="search" size={24} color="#d1d5db" />
          </TouchableOpacity>
        </View>

        {/* Tab Selector */}
        <View style={styles.tabContainer}>
          <View style={styles.tabSelector}>
            <TouchableOpacity 
              style={styles.tab} 
              onPress={()=>setProfileTab('myProfile')}
              activeOpacity={0.7}
            >
              <Text style={[styles.tabText, profileTab==='myProfile' && styles.activeTabText]}>My Profile</Text>
            </TouchableOpacity>
            <TouchableOpacity 
              style={styles.tab} 
              onPress={()=>setProfileTab('tab1')}
              activeOpacity={0.7}
            >
              <Text style={[styles.tabText, profileTab==='tab1' && styles.activeTabText]}>1</Text>
            </TouchableOpacity>
            <TouchableOpacity 
              style={styles.tab} 
              onPress={()=>setProfileTab('tab2')}
              activeOpacity={0.7}
            >
              <Text style={[styles.tabText, profileTab==='tab2' && styles.activeTabText]}>2</Text>
            </TouchableOpacity>
            <TouchableOpacity 
              style={styles.tab} 
              onPress={()=>setProfileTab('tab3')}
              activeOpacity={0.7}
            >
              <Text style={[styles.tabText, profileTab==='tab3' && styles.activeTabText]}>3</Text>
            </TouchableOpacity>
          </View>

          {/* Tab Indicator */}
          <View style={[styles.tabIndicator, {
            left: profileTab === 'myProfile' ? '2%' :
                  profileTab === 'tab1' ? '27%' :
                  profileTab === 'tab2' ? '52%' : '77%'
          }]}>
            <LinearGradient
              colors={['#a855f7', '#d946ef', '#ec4899']}
              style={styles.tabIndicatorGradient}
            />
          </View>
        </View>
      </View>

      <ScrollView style={styles.scrollView} showsVerticalScrollIndicator={false}>
        {/* Profile Info */}
        <View style={styles.profileSection}>
          <TouchableOpacity onPress={()=>navigation.navigate('EditProfile')}>
            <Image 
              source={{ uri: user?.photoURL || `https://ui-avatars.com/api/?name=${encodeURIComponent(user?.displayName||'User')}&size=120&background=a855f7&color=fff&bold=true` }} 
              style={styles.avatar} 
            />
          </TouchableOpacity>
          
          <View style={styles.stats}>
            <View style={styles.statBox}>
              <Text style={styles.statValue}>{followingCount}</Text>
              <Text style={styles.statLabel}>Following</Text>
            </View>
            <TouchableOpacity style={styles.statBox} onPress={()=>navigation.navigate('Followers',{userId:user.uid})}>
              <Text style={styles.statValue}>{followersCount}</Text>
              <Text style={styles.statLabel}>Followers</Text>
            </TouchableOpacity>
            <View style={styles.statBox}>
              <Text style={styles.statValue}>{userPosts.reduce((a,p)=>a+(p.likes||0),0)}</Text>
              <Text style={styles.statLabel}>Likes</Text>
            </View>
          </View>

          {userProfile?.bio ? (
            <Text style={styles.bio}>{userProfile.bio}</Text>
          ) : (
            <Text style={styles.bioPlaceholder}>No bio yet</Text>
          )}

          <TouchableOpacity style={styles.editProfileButton} onPress={()=>navigation.navigate('EditProfile')}>
            <LinearGradient colors={['#a855f7','#d946ef','#ec4899']} style={styles.editProfileGradient}>
              <Icon name="create-outline" size={18} color="#fff" />
              <Text style={styles.editProfileText}>Edit Profile</Text>
            </LinearGradient>
          </TouchableOpacity>
        </View>

        {/* Tabs */}
        <View style={styles.tabBar}>
          <TouchableOpacity 
            style={[styles.tabButton, selectedTab==='posts' && styles.activeTab]} 
            onPress={()=>setSelectedTab('posts')}
          >
            <Icon name="grid-outline" size={24} color={selectedTab==='posts'?'#ec4899':'#94a3b8'} />
            <Text style={[styles.tabLabel, selectedTab==='posts' && styles.activeTabLabel]}>Posts</Text>
          </TouchableOpacity>
          <TouchableOpacity 
            style={[styles.tabButton, selectedTab==='likes' && styles.activeTab]} 
            onPress={()=>setSelectedTab('likes')}
          >
            <Icon name="heart-outline" size={24} color={selectedTab==='likes'?'#ec4899':'#94a3b8'} />
            <Text style={[styles.tabLabel, selectedTab==='likes' && styles.activeTabLabel]}>Likes</Text>
          </TouchableOpacity>
        </View>

        {/* Posts Grid */}
        {renderPostsGrid()}
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container:{ flex:1, backgroundColor:'#0f172a' },
  header:{ paddingTop:50, paddingBottom:1, borderBottomWidth:1, borderBottomColor:'#1e293b' },
  headerTop:{ flexDirection:'row', alignItems:'center', justifyContent:'space-between', paddingHorizontal:16, marginBottom:16 },
  logoContainer:{ flex:1, alignItems:'center', justifyContent:'center' },
  menuButton:{ width:40, height:40, alignItems:'center', justifyContent:'center' },
  tabContainer:{ paddingHorizontal:16, paddingBottom:12 },
  tabSelector:{ position:'relative', backgroundColor:'#374151', borderRadius:9999, padding:4, flexDirection:'row' },
  tab:{ flex:1, paddingVertical:6, alignItems:'center', zIndex:2 },
  tabText:{ color:'#9ca3af', fontSize:12, fontWeight:'600' },
  activeTabText:{ color:'#ffffff' },
  tabIndicator:{ position:'absolute', top:2, bottom:2, width:'25%', borderRadius:9999, zIndex:1 },
  tabIndicatorGradient:{ flex:1, borderRadius:9999 },
  scrollView:{ flex:1 },
  profileSection:{ alignItems:'center', paddingVertical:24, paddingHorizontal:20, borderBottomWidth:1, borderBottomColor:'#1e293b' },
  avatar:{ width:100, height:100, borderRadius:50, borderWidth:2, borderColor:'#a855f7', marginBottom:16 },
  stats:{ flexDirection:'row', marginBottom:16, gap:32 },
  statBox:{ alignItems:'center' },
  statValue:{ fontSize:20, fontWeight:'bold', color:'#fff', marginBottom:4 },
  statLabel:{ fontSize:13, color:'#94a3b8' },
  bio:{ fontSize:14, color:'#e2e8f0', textAlign:'center', lineHeight:20, marginBottom:16, paddingHorizontal:20 },
  bioPlaceholder:{ fontSize:14, color:'#6b7280', fontStyle:'italic', marginBottom:16 },
  editProfileButton:{ width:'100%', borderRadius:12, overflow:'hidden', marginTop:8 },
  editProfileGradient:{ flexDirection:'row', alignItems:'center', justifyContent:'center', paddingVertical:12, gap:8 },
  editProfileText:{ color:'#fff', fontSize:15, fontWeight:'600' },
  tabBar:{ flexDirection:'row', borderBottomWidth:1, borderBottomColor:'#1e293b', paddingHorizontal:16 },
  tabButton:{ flex:1, flexDirection:'row', alignItems:'center', justifyContent:'center', paddingVertical:14, gap:6, borderBottomWidth:2, borderBottomColor:'transparent' },
  activeTab:{ borderBottomColor:'#ec4899' },
  tabLabel:{ fontSize:14, fontWeight:'600', color:'#94a3b8' },
  activeTabLabel:{ color:'#ec4899' },
  gridContainer:{ paddingTop:2 },
  gridItem:{ flex:1/3, aspectRatio:1, margin:1, backgroundColor:'#1e293b', position:'relative' },
  gridImage:{ width:'100%', height:'100%' },
  playIconOverlay:{ position:'absolute', top:8, left:8, backgroundColor:'rgba(0,0,0,0.6)', borderRadius:16, padding:4 },
  postStats:{ position:'absolute', bottom:6, left:6, flexDirection:'row', gap:6 },
  statBadge:{ flexDirection:'row', alignItems:'center', backgroundColor:'rgba(0,0,0,0.6)', borderRadius:12, paddingHorizontal:6, paddingVertical:3, gap:3 },
  statText:{ fontSize:11, fontWeight:'600', color:'#fff' },
  deleteIcon:{ position:'absolute', top:6, right:6, backgroundColor:'rgba(0,0,0,0.5)', borderRadius:12 },
  emptyState:{ flex:1, alignItems:'center', justifyContent:'center', paddingVertical:80, paddingHorizontal:32 },
  emptyText:{ fontSize:16, fontWeight:'600', color:'#6b7280', marginTop:12, textAlign:'center' },
  emptySubtext:{ fontSize:14, color:'#4b5563', marginTop:6, textAlign:'center' }
});

export default ProfileScreen;