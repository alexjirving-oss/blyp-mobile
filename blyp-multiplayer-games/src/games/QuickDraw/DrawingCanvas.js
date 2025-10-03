import React, { useRef, useEffect } from 'react';
import { View, StyleSheet } from 'react-native';
import { Canvas, useFrame } from 'react-three-fiber';

const DrawingCanvas = ({ onDraw }) => {
  const canvasRef = useRef();

  useEffect(() => {
    const handleMouseMove = (event) => {
      const { clientX, clientY } = event;
      const rect = canvasRef.current.getBoundingClientRect();
      const x = clientX - rect.left;
      const y = clientY - rect.top;
      onDraw(x, y);
    };

    const canvas = canvasRef.current;
    canvas.addEventListener('mousemove', handleMouseMove);

    return () => {
      canvas.removeEventListener('mousemove', handleMouseMove);
    };
  }, [onDraw]);

  return (
    <View style={styles.container}>
      <Canvas ref={canvasRef} style={styles.canvas}>
        {/* Add drawing logic here */}
      </Canvas>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#ffffff',
  },
  canvas: {
    width: '100%',
    height: '100%',
  },
});

export default DrawingCanvas;