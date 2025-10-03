import React from 'react';
import { View, StyleSheet } from 'react-native';

const HeaderContainer = ({ children, useOverlay = false, onLayout, paddingBottom = 1 }) => {
  const headerStyle = [styles.header, { paddingBottom }];
  
  if (useOverlay) {
    return (
      <View style={styles.headerOverlay}>
        <View style={headerStyle} onLayout={onLayout}>
          {children}
        </View>
      </View>
    );
  }
  
  return (
    <View style={headerStyle} onLayout={onLayout}>
      {children}
    </View>
  );
};

const styles = StyleSheet.create({
  header: {
    backgroundColor: '#0f172a',
    paddingTop: 50,
    paddingBottom: 1,
    borderBottomWidth: 1,
    borderBottomColor: '#1e293b',
  },
  headerOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 10,
  },
});

export default HeaderContainer;