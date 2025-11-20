# HomeScreen.js - TikTok-Style Video Feed Code

## 📍 File Location
`c:\Users\Alex\369369369\src\screens\HomeScreen.js` (1931 lines total)

---

## 🎯 KEY SECTIONS FOR VIDEO AUTOPLAY

### 1. **EnhancedVideo Import** (Line 25)
```javascript
import EnhancedVideo from '../components/EnhancedVideo';
```

---

### 2. **onViewableItemsChanged Callback** (Lines 624-633)
This detects which video is currently visible on screen:

```javascript
const onViewableItemsChanged = useRef(({ viewableItems }) => {
  if (viewableItems.length > 0) {
    if (selectedTab === 'A') { // A = #4ME (randomPosts now)
      setCurrentDiscoverIndex(viewableItems[0].index || 0);
    } else if (selectedTab === 'B') { // B = Videos feed
      setCurrentIndex(viewableItems[0].index);
    }
  }
}).current;
```

**Purpose**: Updates `currentDiscoverIndex` or `currentIndex` when user scrolls, which controls which video plays.

---

### 3. **renderRandomPostItem** (Lines 746-850)
Renders each video item in the feed:

```javascript
const renderRandomPostItem = ({ item, index, dynamicVideoContainerStyle, dynamicVideoStyle }) => {
  const mediaItems = item.media || [{ url: fixStorageUrl(item.imageUrl || item.videoUrl), type: item.type }];
  const hasMultipleMedia = mediaItems.length > 1;
  
  return (
    <View style={dynamicVideoContainerStyle || styles.videoContainer}>
      {/* ... */}
      
      {/* Single video rendering */}
      <EnhancedVideo
        uri={fixStorageUrl(item.videoUrl || mediaItems[0]?.url) || 'https://sample-videos.com/zip/10/mp4/SampleVideo_1280x720_1mb.mp4'}
        poster={item.thumbnail || mediaItems[0]?.thumbnail || item.user?.avatar || item.user?.photoURL}
        style={[{
          position: 'absolute',
          top: 40,
          left: 0,
          right: 0,
          bottom: 0,
          width: '100%',
          height: '100%',
          backgroundColor: 'black'
        }]}
        shouldPlay={isScreenFocused && selectedTab === 'A' && index === currentDiscoverIndex}
        shouldLoad={Math.abs(currentDiscoverIndex - index) <= 2}
        isLooping={true}
        isMuted={false}
        resizeMode="contain"
      />
      
      {/* ... UI overlays ... */}
    </View>
  );
};
```

**Key Props:**
- `shouldPlay={isScreenFocused && selectedTab === 'A' && index === currentDiscoverIndex}`
  - Only plays when: screen is focused AND on tab A AND this is the current video
- `shouldLoad={Math.abs(currentDiscoverIndex - index) <= 2}`
  - Preloads videos within 2 positions of current
- `isMuted={false}` ✅ **Sound is ON**

---

### 4. **FlatList Configuration** (Lines 1135-1170)
The scrolling container that renders the video feed:

```javascript
<FlatList
  ref={flatListRef}
  data={randomPosts}
  renderItem={(props) => {
    const modifiedProps = {
      ...props,
      dynamicVideoContainerStyle,
      dynamicVideoStyle
    };
    return renderRandomPostItem(modifiedProps);
  }}
  keyExtractor={(item) => item.id}
  showsVerticalScrollIndicator={false}
  refreshing={loading}
  onRefresh={loadRandomPosts}
  pagingEnabled={true}
  snapToInterval={screenHeight}
  scrollEnabled={true}
  decelerationRate="fast"
  removeClippedSubviews={true}
  maxToRenderPerBatch={1}
  windowSize={2}
  initialNumToRender={1}
  updateCellsBatchingPeriod={100}
  getItemLayout={(data, index) => ({
    length: screenHeight,
    offset: screenHeight * index,
    index,
  })}
  onViewableItemsChanged={onViewableItemsChanged}
  viewabilityConfig={{
    itemVisiblePercentThreshold: 80,
    minimumViewTime: 100,
  }}
/>
```

**Critical Settings:**
- `pagingEnabled={true}` - Snaps to full-screen videos
- `snapToInterval={screenHeight}` - One video per page
- `onViewableItemsChanged={onViewableItemsChanged}` - Detects which video is visible
- `viewabilityConfig={{ itemVisiblePercentThreshold: 80, minimumViewTime: 100 }}`
  - Video must be 80% visible for at least 100ms to trigger autoplay

---

## 🔄 HOW AUTOPLAY WORKS (Step-by-step)

### Step 1: User Opens #4ME Tab
```javascript
selectedTab === 'A'
```

### Step 2: FlatList Detects First Video is Visible
```javascript
onViewableItemsChanged fires → setCurrentDiscoverIndex(0)
```

### Step 3: EnhancedVideo Receives shouldPlay={true}
```javascript
isScreenFocused=true && selectedTab='A' && index=0 && currentDiscoverIndex=0
→ shouldPlay={true}
```

### Step 4: EnhancedVideo Component Processes
```javascript
// In EnhancedVideo.js:
shouldPlay={shouldPlay && videoLoaded}  // ✅ Both must be true
```

### Step 5: Video Loads and Plays
```javascript
onReadyForDisplay() → setVideoLoaded(true) → shouldPlay becomes true → video plays
```

### Step 6: User Scrolls to Next Video
```javascript
onViewableItemsChanged fires → setCurrentDiscoverIndex(1)
→ Previous video: shouldPlay={false} → pauses
→ Current video: shouldPlay={true} → plays
```

---

## ⚙️ CURRENT CONFIGURATION (Working #1 Settings)

| Setting | Value | Purpose |
|---------|-------|---------|
| **viewabilityConfig.itemVisiblePercentThreshold** | `80` | Video must be 80% visible |
| **viewabilityConfig.minimumViewTime** | `100` | Must be visible for 100ms |
| **shouldPlay logic** | `isScreenFocused && selectedTab === 'A' && index === currentDiscoverIndex` | Only current video plays |
| **isMuted** | `false` | Sound ON |
| **isLooping** | `true` | Videos loop |
| **shouldLoad** | `Math.abs(currentDiscoverIndex - index) <= 2` | Preload ±2 videos |

---

## 🐛 PREVIOUS ISSUES (Now Fixed)

### Issue #1: EnhancedVideo had `shouldPlay={false}` hardcoded
**Impact**: Videos would never receive the play signal from HomeScreen

### Issue #2: MediaCarousel was using wrong props
**Impact**: Videos in multi-media posts wouldn't play

### Issue #3: handlePlayControl had videoLoaded gate
**Impact**: Created chicken-and-egg problem preventing playback

---

## ✅ CURRENT STATUS

All code is now aligned with working #1 folder:
- ✅ EnhancedVideo.js restored to working version
- ✅ HomeScreen.js viewabilityConfig: 80% / 100ms
- ✅ shouldPlay logic passes through correctly
- ✅ Sound enabled (isMuted={false})

**Ready for testing on device!**

---

## 📝 NOTES FOR NOVA

The video feed uses a **two-layer autoplay system**:

1. **HomeScreen Layer**: 
   - Tracks which video is visible via `onViewableItemsChanged`
   - Passes `shouldPlay={true}` to the visible video's EnhancedVideo component

2. **EnhancedVideo Layer**:
   - Waits for video to load (`videoLoaded`)
   - Only enables autoplay when `shouldPlay && videoLoaded` both true
   - Uses both the `shouldPlay` prop AND `playAsync()` method for reliable control

This dual-layer approach ensures videos only play when:
- ✅ They're visible on screen (HomeScreen decides)
- ✅ They're fully loaded (EnhancedVideo decides)
- ✅ The screen is focused (not navigated away)
- ✅ The correct tab is selected (#4ME)
