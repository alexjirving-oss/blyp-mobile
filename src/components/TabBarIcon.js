import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import * as Icons from 'lucide-react-native';
import { COLORS, SHADOWS, SURFACE_DEPTH } from '../styles/theme';
import TourTarget from '../tour/TourTarget';

const iconMap = {
  home: Icons.Home,
  'game-controller': Icons.Gamepad2 || Icons.Gamepad,
  'paper-plane': Icons.Send,
  person: Icons.User,
  chatbubbles: Icons.MessagesSquare || Icons.MessageCircle,
  call: Icons.Phone,
};

const TabBarIcon = ({ name, color, size = 24, badge, focused = false, tourTargetId }) => {
  const IconComp = iconMap[name] || Icons.Circle;
  const body = (
    <View style={styles.container}>
      <View style={[styles.iconShell, focused ? styles.iconShellActive : styles.iconShellInactive]}>
        {focused ? <View pointerEvents="none" style={styles.shellSheen} /> : null}
        <IconComp size={focused ? size + 1 : size} color={color} />
      </View>
      {badge && badge > 0 ? (
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{badge > 99 ? '99+' : badge.toString()}</Text>
        </View>
      ) : null}
    </View>
  );
  if (!tourTargetId) return body;
  return <TourTarget id={tourTargetId}>{body}</TourTarget>;
};

const styles = StyleSheet.create({
  container: { position: 'relative', alignItems: 'center', justifyContent: 'center' },
  iconShell: {
    width: 38, height: 38, borderRadius: 19,
    alignItems: 'center', justifyContent: 'center', borderWidth: 1, overflow: 'hidden',
  },
  iconShellActive: {
    backgroundColor: 'rgba(255,45,85,0.16)',
    borderColor: 'rgba(255,45,85,0.45)',
    ...SHADOWS.small,
    shadowColor: COLORS.primary,
    shadowOpacity: 0.22,
  },
  iconShellInactive: {
    backgroundColor: 'rgba(20,20,24,0.72)',
    borderColor: SURFACE_DEPTH.highlightBorder,
  },
  shellSheen: {
    position: 'absolute', top: 0, left: 0, right: 0, height: '45%',
    backgroundColor: SURFACE_DEPTH.sheen,
  },
  badge: {
    position: 'absolute', right: -7, top: -5, backgroundColor: '#DC2626',
    borderRadius: 10, minWidth: 20, height: 20, justifyContent: 'center', alignItems: 'center',
    paddingHorizontal: 4, elevation: 3, shadowColor: '#DC2626',
    shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.35, shadowRadius: 3,
  },
  badgeText: { color: '#fff', fontSize: 11, fontWeight: '700' },
});

export default TabBarIcon;
