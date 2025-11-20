import React, { useEffect, useRef } from 'react';
import Icon from './Icon';
import { View, Animated, StyleSheet, Dimensions } from 'react-native';
const { width, height } = Dimensions.get('window');

const HeartAnimation = ({ visible, onAnimationComplete }) => {
  const heart1 = useRef(new Animated.ValueXY({ x: 0, y: 0 })).current;
  const heart2 = useRef(new Animated.ValueXY({ x: 0, y: 0 })).current;
  const heart3 = useRef(new Animated.ValueXY({ x: 0, y: 0 })).current;
  
  const opacity1 = useRef(new Animated.Value(0)).current;
  const opacity2 = useRef(new Animated.Value(0)).current;
  const opacity3 = useRef(new Animated.Value(0)).current;
  
  const scale1 = useRef(new Animated.Value(0)).current;
  const scale2 = useRef(new Animated.Value(0)).current;
  const scale3 = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      // Reset all animations
      heart1.setValue({ x: 0, y: 0 });
      heart2.setValue({ x: 0, y: 0 });
      heart3.setValue({ x: 0, y: 0 });
      opacity1.setValue(0);
      opacity2.setValue(0);
      opacity3.setValue(0);
      scale1.setValue(0);
      scale2.setValue(0);
      scale3.setValue(0);

      // Start animations with staggered timing
      const duration = 2000;
      
      // Heart 1 - flies up and to the left
      Animated.parallel([
        Animated.timing(heart1, {
          toValue: { x: -50, y: -150 },
          duration: duration,
          useNativeDriver: false,
        }),
        Animated.sequence([
          Animated.timing(opacity1, {
            toValue: 1,
            duration: 100,
            useNativeDriver: false,
          }),
          Animated.timing(opacity1, {
            toValue: 0,
            duration: duration - 100,
            useNativeDriver: false,
          }),
        ]),
        Animated.sequence([
          Animated.spring(scale1, {
            toValue: 1.2,
            useNativeDriver: false,
          }),
          Animated.timing(scale1, {
            toValue: 0.5,
            duration: duration - 300,
            useNativeDriver: false,
          }),
        ])
      ]).start();

      // Heart 2 - flies up and straight
      setTimeout(() => {
        Animated.parallel([
          Animated.timing(heart2, {
            toValue: { x: 10, y: -180 },
            duration: duration,
            useNativeDriver: false,
          }),
          Animated.sequence([
            Animated.timing(opacity2, {
              toValue: 1,
              duration: 100,
              useNativeDriver: false,
            }),
            Animated.timing(opacity2, {
              toValue: 0,
              duration: duration - 100,
              useNativeDriver: false,
            }),
          ]),
          Animated.sequence([
            Animated.spring(scale2, {
              toValue: 1.0,
              useNativeDriver: false,
            }),
            Animated.timing(scale2, {
              toValue: 0.3,
              duration: duration - 300,
              useNativeDriver: false,
            }),
          ])
        ]).start();
      }, 200);

      // Heart 3 - flies up and to the right
      setTimeout(() => {
        Animated.parallel([
          Animated.timing(heart3, {
            toValue: { x: 70, y: -160 },
            duration: duration,
            useNativeDriver: false,
          }),
          Animated.sequence([
            Animated.timing(opacity3, {
              toValue: 1,
              duration: 100,
              useNativeDriver: false,
            }),
            Animated.timing(opacity3, {
              toValue: 0,
              duration: duration - 100,
              useNativeDriver: false,
            }),
          ]),
          Animated.sequence([
            Animated.spring(scale3, {
              toValue: 0.8,
              useNativeDriver: false,
            }),
            Animated.timing(scale3, {
              toValue: 0.4,
              duration: duration - 300,
              useNativeDriver: false,
            }),
          ])
        ]).start(() => {
          if (onAnimationComplete) {
            onAnimationComplete();
          }
        });
      }, 400);
    }
  }, [visible]);

  if (!visible) return null;

  return (
    <View style={styles.container} pointerEvents="none">
      {/* Heart 1 */}
      <Animated.View
        style={[
          styles.heart,
          {
            transform: [
              { translateX: heart1.x },
              { translateY: heart1.y },
              { scale: scale1 },
            ],
            opacity: opacity1,
          },
        ]}
      >
        <Icon  name="heart" size={30} color="#ff6b6b"  />
      </Animated.View>

      {/* Heart 2 */}
      <Animated.View
        style={[
          styles.heart,
          {
            transform: [
              { translateX: heart2.x },
              { translateY: heart2.y },
              { scale: scale2 },
            ],
            opacity: opacity2,
          },
        ]}
      >
        <Icon  name="heart" size={28} color="#ff8a95"  />
      </Animated.View>

      {/* Heart 3 */}
      <Animated.View
        style={[
          styles.heart,
          {
            transform: [
              { translateX: heart3.x },
              { translateY: heart3.y },
              { scale: scale3 },
            ],
            opacity: opacity3,
          },
        ]}
      >
        <Icon  name="heart" size={25} color="#ffa8b4"  />
      </Animated.View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
  },
  heart: {
    position: 'absolute',
    shadowColor: '#ff6b6b',
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.5,
    shadowRadius: 3.84,
    elevation: 5,
  },
});

export default HeartAnimation;