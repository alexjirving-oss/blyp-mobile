import React from 'react';
import { View, Text } from 'react-native';

export default function SafeApp() {
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#000' }}>
      <Text style={{ color: '#0f0', fontSize: 18 }}>BLYP SAFE MODE — UI LOADED</Text>
    </View>
  );
}
