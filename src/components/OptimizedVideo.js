import React, { useRef } from 'react';
import { View, Image } from 'react-native';
import UnifiedVideo from './UnifiedVideo';

const SimpleVideo = ({ 
  source, 
  style, 
  shouldPlay, 
  isLooping = true, 
  isMuted = false, 
  resizeMode = "contain", 
  poster
}) => {
  const videoRef = useRef(null);

  return (
    <View style={style}>
      {/* Poster/Thumbnail */}
      {poster && (
        <Image 
          source={{ uri: poster }}
          style={[style, { position: 'absolute', zIndex: 1 }]}
          resizeMode={resizeMode}
        />
      )}
      
      {/* Video */}
      <UnifiedVideo
        ref={videoRef}
        source={source}
        style={style}
        shouldPlay={shouldPlay}
        isLooping={isLooping}
        isMuted={isMuted}
        resizeMode={resizeMode}
        useNativeControls={false}
      />
    </View>
  );
};

export default SimpleVideo;