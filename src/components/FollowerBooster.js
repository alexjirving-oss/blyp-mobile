import React, { useEffect } from 'react';
import { Alert } from 'react-native';

/**
 * Production stub — follower boost UI is removed from the shipped profile flow.
 */
export default function FollowerBooster({ visible = false, onClose }) {
  useEffect(() => {
    if (!visible) return;
    Alert.alert('Unavailable', 'Follower boost tools are disabled.');
    if (typeof onClose === 'function') onClose();
  }, [visible, onClose]);

  return null;
}
