import React from 'react';
import { TouchableOpacity, Alert, View, Text } from 'react-native';

const CreatePostButton = ({ accessibilityState }) => {
  return (
    <TouchableOpacity 
      style={{
        width: 56,
        height: 56,
        borderRadius: 28,
        backgroundColor: '#FF1744',
        justifyContent: 'center',
        alignItems: 'center',
        marginBottom: 10,
      }}
      onPress={() => Alert.alert('Test', 'Plus button works! No crash!')}
    >
      <Text style={{ color: 'white', fontSize: 24, fontWeight: 'bold' }}>+</Text>
    </TouchableOpacity>
  );
};

export default CreatePostButton;