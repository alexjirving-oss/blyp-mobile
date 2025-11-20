import React, { useRef } from 'react';
import { View, Image } from 'react-native';
import { Video } from 'expo-av';

const SimpleVideo = ({ 
  source, 
  style, 
  shouldPlay, 
  isLooping = true, 
  isMuted = false, 
  resizeMode = "cover", 
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
      <Video
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