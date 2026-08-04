// ReminderEditSheet.js
//
// A bottom-sheet modal for editing a single reminder: choose how long before the
// event the notification fires ("at the time", "1 hour before", "1 day before"…)
// or delete it. Shared by the home screen reminders list and the Blyp screen.

import React from 'react';
import { Modal, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Icon from './Icon';
import { COLORS } from '../styles/theme';
import { responsiveFont } from '../utils/scaleUtils';
import { LEAD_OPTIONS } from '../services/reminderService';

const ReminderEditSheet = ({ visible, reminder, onClose, onChangeLead, onDelete }) => {
  const current = Number(reminder?.leadMinutes) || 0;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={onClose}>
        <TouchableOpacity style={styles.sheet} activeOpacity={1} onPress={() => {}}>
          <View style={styles.handle} />

          {!!reminder && (
            <>
              <Text style={styles.task} numberOfLines={2}>{reminder.task}</Text>
              <Text style={styles.event}>{reminder.eventLabel || reminder.whenLabel}</Text>
            </>
          )}

          <Text style={styles.sectionLabel}>Remind me</Text>
          <ScrollView style={styles.optionsScroll} showsVerticalScrollIndicator={false}>
            {LEAD_OPTIONS.map((opt) => {
              const on = opt.minutes === current;
              return (
                <TouchableOpacity
                  key={opt.minutes}
                  style={[styles.optionRow, on && styles.optionRowOn]}
                  activeOpacity={0.85}
                  onPress={() => onChangeLead?.(opt.minutes)}
                >
                  <Text style={[styles.optionText, on && styles.optionTextOn]}>{opt.label}</Text>
                  {on && <Icon name="checkmark" size={18} color={COLORS.primary} />}
                </TouchableOpacity>
              );
            })}
          </ScrollView>

          <TouchableOpacity style={styles.deleteBtn} activeOpacity={0.85} onPress={onDelete}>
            <Icon name="trash-outline" size={18} color="#FF5A5F" />
            <Text style={styles.deleteText}>Delete reminder</Text>
          </TouchableOpacity>
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
};

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: COLORS.backgroundLight || COLORS.backgroundCard,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 28,
    maxHeight: '80%',
  },
  handle: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: COLORS.border, marginBottom: 16 },
  task: { color: COLORS.textPrimary, fontSize: responsiveFont(18), fontWeight: '800' },
  event: { color: COLORS.textMuted, fontSize: responsiveFont(13), marginTop: 4, marginBottom: 18 },
  sectionLabel: { color: COLORS.textMuted, fontSize: responsiveFont(11), fontWeight: '800', letterSpacing: 1.2, marginBottom: 8 },
  optionsScroll: { flexGrow: 0 },
  optionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 12,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    marginBottom: 8,
  },
  optionRowOn: { borderColor: COLORS.primary, backgroundColor: 'rgba(0,210,190,0.10)' },
  optionText: { color: COLORS.textPrimary, fontSize: responsiveFont(15), fontWeight: '600' },
  optionTextOn: { color: COLORS.primary, fontWeight: '800' },
  deleteBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 14,
    paddingVertical: 13,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,90,95,0.5)',
  },
  deleteText: { color: '#FF5A5F', fontSize: responsiveFont(14), fontWeight: '700' },
});

export default ReminderEditSheet;
