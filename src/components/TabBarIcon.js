import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import * as Icons from 'lucide-react-native';

// Map existing names to lucide components
const iconMap = {
  home: Icons.Home,
  'game-controller': Icons.Gamepad2 || Icons.Gamepad,
  'paper-plane': Icons.Send,
  person: Icons.User,
};

const TabBarIcon = ({ name, color, size = 24, badge, focused = false }) => {
  const IconComp = iconMap[name] || Icons.Circle;
  return (
    <View style={styles.container}>
      <View style={[styles.iconShell, focused ? styles.iconShellActive : styles.iconShellInactive]}>
        <IconComp size={focused ? size + 1 : size} color={color} />
      </View>
      {badge && badge > 0 && (
        <View style={styles.badge}>
          <Text style={styles.badgeText}>
            {badge > 99 ? '99+' : badge.toString()}
          </Text>
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconShell: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  iconShellActive: {
    backgroundColor: 'rgba(30,41,59,0.95)',
    borderColor: 'rgba(255,255,255,0.22)',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.32,
    shadowRadius: 7,
    elevation: 6,
  },
  iconShellInactive: {
    backgroundColor: 'rgba(15,23,42,0.52)',
    borderColor: 'rgba(255,255,255,0.08)',
  },
  badge: {
    position: 'absolute',
    right: -7,
    top: -5,
    backgroundColor: '#DC2626',
    borderRadius: 10,
    minWidth: 20,
    height: 20,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 4,
    elevation: 3,
    shadowColor: '#DC2626',
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.4,
    shadowRadius: 3,
  },
  badgeText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '700',
  },
});

export default TabBarIcon;
