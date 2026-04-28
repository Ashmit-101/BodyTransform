/**
 * PosesScreen — Pose category list
 * 
 * Shows all pose categories with photo count, last capture, and recent thumbnail.
 * Allows adding new poses.
 */

import React, { useState, useCallback } from 'react';
import {
  View,
  StyleSheet,
  Text,
  FlatList,
  Pressable,
  Alert,
  TextInput,
  Modal,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import Animated, { FadeInDown } from 'react-native-reanimated';

import PoseCard from '../components/PoseCard';
import { colors, typography, spacing, radius } from '../theme/theme';
import { getAllPoses, createPose, deletePose, getLatestPhotoForPose } from '../database/db';

const EMOJI_OPTIONS = ['💪', '🧍', '🫁', '🦅', '🔥', '🏋️', '🤸', '🧘', '⚡', '🎯'];

export default function PosesScreen({ navigation }) {
  const [poses, setPoses] = useState([]);
  const [latestPhotos, setLatestPhotos] = useState({});
  const [showAddModal, setShowAddModal] = useState(false);
  const [newPoseName, setNewPoseName] = useState('');
  const [newPoseIcon, setNewPoseIcon] = useState('💪');

  useFocusEffect(
    useCallback(() => {
      loadData();
    }, [])
  );

  const loadData = async () => {
    try {
      const allPoses = await getAllPoses();
      setPoses(allPoses);

      // Load latest photo for each pose
      const photos = {};
      for (const pose of allPoses) {
        const latest = await getLatestPhotoForPose(pose.id);
        if (latest) photos[pose.id] = latest;
      }
      setLatestPhotos(photos);
    } catch (err) {
      console.error('Failed to load poses:', err);
    }
  };

  const handleAddPose = async () => {
    const name = newPoseName.trim();
    if (!name) {
      Alert.alert('Error', 'Please enter a pose name.');
      return;
    }

    try {
      await createPose(name, newPoseIcon);
      setNewPoseName('');
      setNewPoseIcon('💪');
      setShowAddModal(false);
      loadData();
    } catch (err) {
      if (err.message?.includes('UNIQUE')) {
        Alert.alert('Error', 'A pose with that name already exists.');
      } else {
        Alert.alert('Error', 'Failed to create pose.');
      }
    }
  };

  const handleDeletePose = (pose) => {
    Alert.alert(
      'Delete Pose',
      `Delete "${pose.name}" and all ${pose.photo_count} photos? This cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await deletePose(pose.id);
              loadData();
            } catch (err) {
              Alert.alert('Error', 'Failed to delete pose.');
            }
          },
        },
      ]
    );
  };

  const renderItem = ({ item, index }) => (
    <Animated.View entering={FadeInDown.delay(index * 60).springify()}>
      <PoseCard
        pose={item}
        latestPhoto={latestPhotos[item.id]}
        onPress={(pose) => navigation.navigate('Timeline', { pose })}
      />
    </Animated.View>
  );

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.title}>My Poses</Text>
        <Pressable style={styles.addButton} onPress={() => setShowAddModal(true)}>
          <Ionicons name="add" size={24} color={colors.text} />
        </Pressable>
      </View>

      {/* Pose list */}
      {poses.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyIcon}>📸</Text>
          <Text style={styles.emptyTitle}>No Poses Yet</Text>
          <Text style={styles.emptySubtitle}>
            Add your first pose category to start tracking your progress.
          </Text>
          <Pressable style={styles.emptyButton} onPress={() => setShowAddModal(true)}>
            <Text style={styles.emptyButtonText}>Add First Pose</Text>
          </Pressable>
        </View>
      ) : (
        <FlatList
          data={poses}
          keyExtractor={(item) => item.id.toString()}
          renderItem={renderItem}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
        />
      )}

      {/* Add Pose Modal */}
      <Modal
        visible={showAddModal}
        transparent
        animationType="slide"
        onRequestClose={() => setShowAddModal(false)}
      >
        <KeyboardAvoidingView
          style={styles.modalOverlay}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          <Pressable style={styles.modalDismiss} onPress={() => setShowAddModal(false)} />
          <View style={styles.modalContent}>
            <View style={styles.modalHandle} />
            <Text style={styles.modalTitle}>New Pose Category</Text>

            {/* Icon selector */}
            <Text style={styles.modalLabel}>Choose an Icon</Text>
            <View style={styles.emojiRow}>
              {EMOJI_OPTIONS.map((emoji) => (
                <Pressable
                  key={emoji}
                  style={[
                    styles.emojiButton,
                    newPoseIcon === emoji && styles.emojiButtonActive,
                  ]}
                  onPress={() => setNewPoseIcon(emoji)}
                >
                  <Text style={styles.emojiText}>{emoji}</Text>
                </Pressable>
              ))}
            </View>

            {/* Name input */}
            <Text style={styles.modalLabel}>Pose Name</Text>
            <TextInput
              style={styles.input}
              value={newPoseName}
              onChangeText={setNewPoseName}
              placeholder="e.g. Front Relaxed"
              placeholderTextColor={colors.textMuted}
              autoFocus
              returnKeyType="done"
              onSubmitEditing={handleAddPose}
            />

            {/* Action buttons */}
            <View style={styles.modalActions}>
              <Pressable
                style={styles.cancelButton}
                onPress={() => setShowAddModal(false)}
              >
                <Text style={styles.cancelText}>Cancel</Text>
              </Pressable>
              <Pressable style={styles.saveButton} onPress={handleAddPose}>
                <Text style={styles.saveText}>Create</Text>
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: Platform.OS === 'ios' ? 60 : 40,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
  },
  title: {
    ...typography.title,
  },
  addButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.surfaceLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  list: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.xxl,
  },

  // Empty state
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
  },
  emptyIcon: {
    fontSize: 64,
    marginBottom: spacing.md,
  },
  emptyTitle: {
    ...typography.heading,
    textAlign: 'center',
  },
  emptySubtitle: {
    ...typography.bodySmall,
    textAlign: 'center',
    marginTop: spacing.sm,
    marginBottom: spacing.lg,
    lineHeight: 22,
  },
  emptyButton: {
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    borderRadius: radius.full,
  },
  emptyButtonText: {
    ...typography.body,
    fontWeight: '600',
    color: '#fff',
  },

  // Modal
  modalOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  modalDismiss: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
  },
  modalContent: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    padding: spacing.lg,
    paddingBottom: Platform.OS === 'ios' ? 40 : spacing.lg,
  },
  modalHandle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.textMuted,
    alignSelf: 'center',
    marginBottom: spacing.lg,
  },
  modalTitle: {
    ...typography.heading,
    marginBottom: spacing.lg,
  },
  modalLabel: {
    ...typography.caption,
    marginBottom: spacing.sm,
  },
  emojiRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginBottom: spacing.lg,
  },
  emojiButton: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: colors.surfaceLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emojiButtonActive: {
    borderWidth: 2,
    borderColor: colors.primary,
    backgroundColor: 'rgba(108, 99, 255, 0.15)',
  },
  emojiText: {
    fontSize: 22,
  },
  input: {
    backgroundColor: colors.surfaceLight,
    borderRadius: radius.md,
    padding: spacing.md,
    ...typography.body,
    color: colors.text,
    marginBottom: spacing.lg,
    borderWidth: 1,
    borderColor: colors.cardBorder,
  },
  modalActions: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  cancelButton: {
    flex: 1,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceLight,
    alignItems: 'center',
  },
  cancelText: {
    ...typography.body,
    color: colors.textSecondary,
    fontWeight: '600',
  },
  saveButton: {
    flex: 1,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.primary,
    alignItems: 'center',
  },
  saveText: {
    ...typography.body,
    color: '#fff',
    fontWeight: '600',
  },
});
