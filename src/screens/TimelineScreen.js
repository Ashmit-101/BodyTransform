/**
 * TimelineScreen — Photo grid for a selected pose category
 * 
 * Displays all photos chronologically with selection for comparison or deletion.
 */

import React, { useState, useCallback, useRef } from 'react';
import {
  View,
  StyleSheet,
  Text,
  FlatList,
  Pressable,
  Alert,
  Image,
  Modal,
  Dimensions,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import Animated, { FadeIn } from 'react-native-reanimated';
import * as ImagePicker from 'expo-image-picker';

import PhotoCard from '../components/PhotoCard';
import { colors, typography, spacing, radius } from '../theme/theme';
import {
  getPhotosForPose,
  deletePhoto,
  savePhoto,
  getPoseReferencePhotoId,
} from '../database/db';
import { deleteImage, saveImageToAppDir } from '../utils/storage';
import { saveReferencePhotoForPose } from '../utils/referencePhotos';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

export default function TimelineScreen({ route, navigation }) {
  const { pose } = route.params;
  const [photos, setPhotos] = useState([]);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [viewerIndex, setViewerIndex] = useState(null); // null = closed
  const [selectionMode, setSelectionMode] = useState(false);
  const [importing, setImporting] = useState(false);
  const viewerRef = useRef(null);
  const viewerClosingRef = useRef(false);

  useFocusEffect(
    useCallback(() => {
      loadPhotos();
      return () => {
        setSelectionMode(false);
        setSelectedIds(new Set());
      };
    }, [pose.id])
  );

  const loadPhotos = async () => {
    try {
      const result = await getPhotosForPose(pose.id);
      setPhotos(result);
    } catch (err) {
      console.error('Failed to load photos:', err);
    }
  };

  const parseExifDate = (exifDate) => {
    if (!exifDate || typeof exifDate !== 'string') return null;
    const parts = exifDate.split(' ');
    if (parts.length < 2) return null;
    return `${parts[0].replace(/:/g, '-')} ${parts[1]}`;
  };

  const handleGalleryImport = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert(
        'Permission Required',
        'Please allow access to your photo library in Settings to import old gym photos.',
      );
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsMultipleSelection: true,
      quality: 1,
      selectionLimit: 20,
      orderedSelection: true,
      exif: true,
    });

    if (result.canceled || result.assets.length === 0) return;

    setImporting(true);
    try {
      let fallbackReferenceSaved = false;
      for (const asset of result.assets) {
        const saved = await saveImageToAppDir(asset.uri, pose.id);
        const capturedAt = parseExifDate(asset.exif?.DateTimeOriginal) || null;
        const photoId = await savePhoto(pose.id, saved.filePath, saved.width, saved.height, capturedAt);
        const referencePhotoId = await getPoseReferencePhotoId(pose.id);
        if (!referencePhotoId) {
          const referenceResult = await saveReferencePhotoForPose(pose, {
            id: photoId,
            pose_id: pose.id,
            file_path: saved.filePath,
            captured_at: capturedAt || new Date().toISOString(),
            width: saved.width,
            height: saved.height,
          });
          fallbackReferenceSaved = fallbackReferenceSaved || referenceResult.referenceSource === 'template';
        }
      }
      await loadPhotos();
      const count = result.assets.length;
      Alert.alert(
        'Imported!',
        fallbackReferenceSaved
          ? `${count} photo${count > 1 ? 's' : ''} added to ${pose.name}. The first reference used a fallback skeleton, so replace it with a clearer bodybuilding pose when you can.`
          : `${count} photo${count > 1 ? 's' : ''} added to ${pose.name}.`,
      );
    } catch (err) {
      console.error('Gallery import failed:', err);
      Alert.alert('Error', 'Failed to import photos. Please try again.');
    } finally {
      setImporting(false);
    }
  };

  const closeViewer = useCallback(() => {
    viewerClosingRef.current = true;
    setViewerIndex(null);
    setTimeout(() => { viewerClosingRef.current = false; }, 800);
  }, []);

  const handleViewerDelete = () => {
    const photo = photos[viewerIndex];
    if (!photo) return;
    Alert.alert(
      'Delete Photo',
      'Delete this photo? This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              const deletedPhoto = await deletePhoto(photo.id);
              if (deletedPhoto?.file_path) await deleteImage(deletedPhoto.file_path);
              if (deletedPhoto?.ghost_file_path) await deleteImage(deletedPhoto.ghost_file_path);
              const newPhotos = photos.filter(p => p.id !== photo.id);
              if (newPhotos.length === 0) {
                setViewerIndex(null);
              } else {
                setViewerIndex(Math.min(viewerIndex, newPhotos.length - 1));
              }
              await loadPhotos();
            } catch (err) {
              Alert.alert('Error', 'Failed to delete photo.');
            }
          },
        },
      ]
    );
  };

  const handlePhotoPress = (photo) => {
    if (viewerClosingRef.current) return;
    if (selectionMode) {
      toggleSelection(photo.id);
    } else {
      const index = photos.findIndex(p => p.id === photo.id);
      setViewerIndex(index >= 0 ? index : 0);
    }
  };

  const handleLongPress = (photo) => {
    if (!selectionMode) {
      setSelectionMode(true);
      setSelectedIds(new Set([photo.id]));
    }
  };

  const toggleSelection = (id) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        if (next.size < 2 || !selectionMode) {
          next.add(id);
        }
      }
      if (next.size === 0) setSelectionMode(false);
      return next;
    });
  };

  const handleCompare = () => {
    if (selectedIds.size !== 2) {
      Alert.alert('Select 2 Photos', 'Please select exactly two photos to compare.');
      return;
    }
    const selected = photos.filter((p) => selectedIds.has(p.id));
    setSelectionMode(false);
    setSelectedIds(new Set());
    navigation.navigate('Compare', {
      photo1: selected[0],
      photo2: selected[1],
      poseName: pose.name,
    });
  };

  const handleDelete = () => {
    const count = selectedIds.size;
    Alert.alert(
      'Delete Photos',
      `Delete ${count} photo${count > 1 ? 's' : ''}? This cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              for (const id of selectedIds) {
                const deletedPhoto = await deletePhoto(id);
                if (deletedPhoto?.file_path) await deleteImage(deletedPhoto.file_path);
                if (deletedPhoto?.ghost_file_path) await deleteImage(deletedPhoto.ghost_file_path);
              }
              setSelectedIds(new Set());
              setSelectionMode(false);
              loadPhotos();
            } catch (err) {
              Alert.alert('Error', 'Failed to delete photos.');
            }
          },
        },
      ]
    );
  };

  const formatFullDate = (dateStr) => {
    const d = new Date(dateStr);
    return d.toLocaleDateString('default', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  };

  const renderItem = ({ item }) => (
    <PhotoCard
      photo={item}
      onPress={handlePhotoPress}
      onLongPress={handleLongPress}
      selected={selectedIds.has(item.id)}
    />
  );

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Pressable onPress={() => navigation.goBack()} style={styles.backButton}>
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </Pressable>
        <View style={styles.headerInfo}>
          <Text style={styles.headerIcon}>{pose.icon}</Text>
          <Text style={styles.headerTitle} numberOfLines={1}>{pose.name}</Text>
        </View>
        <Text style={styles.photoCount}>{photos.length}</Text>
        {photos.length > 0 && (
          <Pressable
            style={[
              styles.selectButton,
              selectionMode && styles.selectButtonActive,
            ]}
            onPress={() => {
              if (selectionMode) {
                setSelectionMode(false);
                setSelectedIds(new Set());
              } else {
                setSelectionMode(true);
              }
            }}
          >
            <Ionicons
              name={selectionMode ? 'close' : 'checkmark-circle-outline'}
              size={16}
              color={selectionMode ? '#fff' : colors.primary}
            />
            <Text
              style={[
                styles.selectButtonText,
                selectionMode && styles.selectButtonTextActive,
              ]}
            >
              {selectionMode ? 'Done' : 'Select'}
            </Text>
          </Pressable>
        )}
        <Pressable
          style={styles.importButton}
          onPress={handleGalleryImport}
          disabled={importing}
        >
          <Ionicons
            name={importing ? 'hourglass-outline' : 'cloud-upload-outline'}
            size={20}
            color={importing ? colors.textMuted : colors.primary}
          />
        </Pressable>
      </View>

      {/* Selection toolbar */}
      {selectionMode && (
        <Animated.View entering={FadeIn} style={styles.selectionBar}>
          <Text style={styles.selectionText}>
            {selectedIds.size} selected
          </Text>
          <View style={styles.selectionActions}>
            {selectedIds.size === 2 && (
              <Pressable style={styles.compareButton} onPress={handleCompare}>
                <Ionicons name="git-compare-outline" size={18} color="#fff" />
                <Text style={styles.compareText}>Compare</Text>
              </Pressable>
            )}
            <Pressable style={styles.deleteButton} onPress={handleDelete}>
              <Ionicons name="trash-outline" size={18} color={colors.danger} />
            </Pressable>
            <Pressable
              style={styles.cancelSelection}
              onPress={() => {
                setSelectionMode(false);
                setSelectedIds(new Set());
              }}
            >
              <Ionicons name="close" size={20} color={colors.text} />
            </Pressable>
          </View>
        </Animated.View>
      )}

      {/* Photo grid */}
      {photos.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyIcon}>📷</Text>
          <Text style={styles.emptyTitle}>No Photos Yet</Text>
          <Text style={styles.emptySubtitle}>
            Capture new photos with the Camera tab, or import your old gym photos below.
          </Text>
          <Pressable
            style={styles.emptyImportButton}
            onPress={handleGalleryImport}
            disabled={importing}
          >
            <Ionicons name="cloud-upload-outline" size={20} color="#fff" />
            <Text style={styles.emptyImportText}>
              {importing ? 'Importing…' : 'Import from Gallery'}
            </Text>
          </Pressable>
        </View>
      ) : (
        <FlatList
          data={photos}
          keyExtractor={(item) => item.id.toString()}
          renderItem={renderItem}
          numColumns={3}
          contentContainerStyle={styles.grid}
          showsVerticalScrollIndicator={false}
          scrollEnabled={viewerIndex === null}
        />
      )}

      {/* Full-screen swipeable photo viewer */}
      <Modal
        visible={viewerIndex !== null}
        transparent={false}
        animationType="fade"
        onRequestClose={closeViewer}
        statusBarTranslucent
      >
        <View style={styles.viewer}>

          {/* Close button */}
          <Pressable
            style={styles.viewerClose}
            onPress={closeViewer}
          >
            <Ionicons name="close" size={26} color={colors.text} />
          </Pressable>

          {/* Delete button */}
          <Pressable
            style={styles.viewerDelete}
            onPress={handleViewerDelete}
          >
            <Ionicons name="trash-outline" size={22} color="#ff5252" />
          </Pressable>

          {/* Photo count */}
          {viewerIndex !== null && (
            <View style={styles.viewerCounter}>
              <Text style={styles.viewerCounterText}>
                {viewerIndex + 1} / {photos.length}
              </Text>
            </View>
          )}

          <FlatList
            ref={viewerRef}
            data={photos}
            keyExtractor={item => item.id.toString()}
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            initialScrollIndex={viewerIndex ?? 0}
            getItemLayout={(_, index) => ({
              length: SCREEN_WIDTH,
              offset: SCREEN_WIDTH * index,
              index,
            })}
            onMomentumScrollEnd={(e) => {
              const newIndex = Math.round(e.nativeEvent.contentOffset.x / SCREEN_WIDTH);
              setViewerIndex(newIndex);
            }}
            renderItem={({ item }) => (
              <View style={styles.viewerSlide}>
                <Image
                  source={{ uri: item.file_path }}
                  style={styles.viewerImage}
                  resizeMode="contain"
                />
                <View style={styles.viewerInfo}>
                  <Text style={styles.viewerDate}>
                    {formatFullDate(item.captured_at)}
                  </Text>
                </View>
              </View>
            )}
          />
        </View>
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
    alignItems: 'center',
    paddingTop: 60,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.md,
    gap: spacing.sm,
  },
  backButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.surfaceLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerInfo: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  headerIcon: {
    fontSize: 22,
  },
  headerTitle: {
    ...typography.heading,
    flex: 1,
  },
  photoCount: {
    ...typography.bodySmall,
    backgroundColor: colors.surfaceLight,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: radius.full,
    overflow: 'hidden',
  },

  // Selection bar
  selectionBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.cardBorder,
  },
  selectionText: {
    ...typography.body,
    fontSize: 14,
    color: colors.primary,
    fontWeight: '600',
  },
  selectionActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  compareButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.full,
  },
  compareText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '600',
  },
  deleteButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255, 82, 82, 0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelSelection: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.surfaceLight,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Grid
  grid: {
    paddingHorizontal: spacing.sm,
    paddingBottom: spacing.xxl,
  },

  // Import button (header)
  importButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.surfaceLight,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Empty
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
  },
  emptyIcon: {
    fontSize: 48,
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
    lineHeight: 22,
  },
  emptyImportButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    borderRadius: radius.full,
    marginTop: spacing.xl,
  },
  emptyImportText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
  },

  // Full-screen viewer
  viewer: {
    flex: 1,
    backgroundColor: '#000',
    justifyContent: 'center',
  },
  viewerClose: {
    position: 'absolute',
    top: 56,
    right: spacing.md,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(255,255,255,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 20,
  },
  viewerDelete: {
    position: 'absolute',
    top: 56,
    left: spacing.md,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(255,82,82,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 20,
  },
  viewerCounter: {
    position: 'absolute',
    top: 60,
    alignSelf: 'center',
    backgroundColor: 'rgba(255,255,255,0.12)',
    paddingHorizontal: spacing.md,
    paddingVertical: 5,
    borderRadius: radius.full,
    zIndex: 20,
  },
  viewerCounterText: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '600',
  },
  viewerSlide: {
    width: SCREEN_WIDTH,
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  viewerImage: {
    width: SCREEN_WIDTH,
    height: SCREEN_WIDTH * 1.5,
  },
  viewerInfo: {
    position: 'absolute',
    bottom: 50,
    alignItems: 'center',
    paddingHorizontal: spacing.xl,
  },
  viewerDate: {
    ...typography.body,
    color: colors.textSecondary,
    fontSize: 14,
    textAlign: 'center',
  },
});
