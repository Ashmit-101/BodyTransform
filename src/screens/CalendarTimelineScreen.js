/**
 * CalendarTimelineScreen — Date-based photo timeline
 *
 * Shows a monthly calendar with dots on days that have photos.
 * Tapping a day reveals a horizontal strip of that day's photos,
 * which open into a full-screen swipeable viewer.
 */

import React, { useState, useCallback, useRef } from 'react';
import {
  View,
  StyleSheet,
  Text,
  Pressable,
  FlatList,
  Image,
  Modal,
  Dimensions,
  Platform,
  ScrollView,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';

import { colors, typography, spacing, radius } from '../theme/theme';
import { getAllPhotoDates, getPhotosForDate } from '../database/db';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

const DAY_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

// ─── Helpers ────────────────────────────────────────────────

function toDateKey(year, month, day) {
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function buildCalendarCells(year, month) {
  const firstDow = new Date(year, month, 1).getDay(); // 0=Sun
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells = [];
  for (let i = 0; i < firstDow; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  // Pad to complete last row
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

function formatDisplayDate(dateStr) {
  // dateStr = 'YYYY-MM-DD'
  const d = new Date(dateStr + 'T12:00:00');
  return d.toLocaleDateString('default', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

function formatTime(capturedAt) {
  const d = new Date(capturedAt);
  return d.toLocaleTimeString('default', { hour: '2-digit', minute: '2-digit' });
}

// ─── Component ──────────────────────────────────────────────

export default function CalendarTimelineScreen() {
  const today = new Date();
  const todayKey = toDateKey(today.getFullYear(), today.getMonth(), today.getDate());

  const [viewYear, setViewYear] = useState(today.getFullYear());
  const [viewMonth, setViewMonth] = useState(today.getMonth());
  const [photoDates, setPhotoDates] = useState({}); // { 'YYYY-MM-DD': count }
  const [selectedDate, setSelectedDate] = useState(null);
  const [dayPhotos, setDayPhotos] = useState([]);
  const [loadingDay, setLoadingDay] = useState(false);
  const [viewerIndex, setViewerIndex] = useState(null);

  const viewerRef = useRef(null);

  useFocusEffect(
    useCallback(() => {
      loadPhotoDates();
    }, [])
  );

  const loadPhotoDates = async () => {
    try {
      const rows = await getAllPhotoDates();
      const map = {};
      for (const row of rows) map[row.date] = row.count;
      setPhotoDates(map);
    } catch (err) {
      console.error('Failed to load photo dates:', err);
    }
  };

  const handleDayPress = async (day) => {
    if (!day) return;
    const dateKey = toDateKey(viewYear, viewMonth, day);
    setSelectedDate(dateKey);
    setLoadingDay(true);
    try {
      const photos = await getPhotosForDate(dateKey);
      setDayPhotos(photos);
    } catch (err) {
      console.error('Failed to load day photos:', err);
      setDayPhotos([]);
    } finally {
      setLoadingDay(false);
    }
  };

  const prevMonth = () => {
    setSelectedDate(null);
    setDayPhotos([]);
    if (viewMonth === 0) { setViewYear(y => y - 1); setViewMonth(11); }
    else setViewMonth(m => m - 1);
  };

  const nextMonth = () => {
    setSelectedDate(null);
    setDayPhotos([]);
    if (viewMonth === 11) { setViewYear(y => y + 1); setViewMonth(0); }
    else setViewMonth(m => m + 1);
  };

  const goToToday = () => {
    setViewYear(today.getFullYear());
    setViewMonth(today.getMonth());
    setSelectedDate(todayKey);
    getPhotosForDate(todayKey).then(setDayPhotos);
  };

  const openViewer = (index) => {
    setViewerIndex(index);
  };

  // ─── Calendar ─────────────────────────────────────────────

  const cells = buildCalendarCells(viewYear, viewMonth);
  const CELL_SIZE = (SCREEN_WIDTH - spacing.md * 2) / 7;

  const renderCell = (cell, i) => {
    if (!cell) {
      return <View key={`empty-${i}`} style={[styles.cell, { width: CELL_SIZE, height: CELL_SIZE }]} />;
    }
    const dateKey = toDateKey(viewYear, viewMonth, cell);
    const hasPhotos = !!photoDates[dateKey];
    const count = photoDates[dateKey] || 0;
    const isToday = dateKey === todayKey;
    const isSelected = dateKey === selectedDate;

    return (
      <Pressable
        key={dateKey}
        style={[
          styles.cell,
          { width: CELL_SIZE, height: CELL_SIZE },
          isSelected && styles.cellSelected,
          isToday && !isSelected && styles.cellToday,
        ]}
        onPress={() => handleDayPress(cell)}
      >
        <Text style={[
          styles.cellText,
          isSelected && styles.cellTextSelected,
          isToday && !isSelected && styles.cellTextToday,
        ]}>
          {cell}
        </Text>
        {hasPhotos && (
          <View style={styles.dotRow}>
            {[...Array(Math.min(count, 3))].map((_, di) => (
              <View
                key={di}
                style={[styles.dot, isSelected && styles.dotSelected]}
              />
            ))}
          </View>
        )}
      </Pressable>
    );
  };

  // ─── Render ───────────────────────────────────────────────

  return (
    <View style={styles.container}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scroll}
        stickyHeaderIndices={[0]}
      >
        {/* Sticky Header */}
        <View style={styles.stickyHeader}>
          <View style={styles.header}>
            <Text style={styles.title}>Timeline</Text>
            <Pressable style={styles.todayBtn} onPress={goToToday}>
              <Text style={styles.todayBtnText}>Today</Text>
            </Pressable>
          </View>

          {/* Month navigator */}
          <View style={styles.monthNav}>
            <Pressable onPress={prevMonth} style={styles.navBtn}>
              <Ionicons name="chevron-back" size={22} color={colors.text} />
            </Pressable>
            <Text style={styles.monthLabel}>
              {MONTH_NAMES[viewMonth]} {viewYear}
            </Text>
            <Pressable onPress={nextMonth} style={styles.navBtn}>
              <Ionicons name="chevron-forward" size={22} color={colors.text} />
            </Pressable>
          </View>

          {/* Day-of-week headers */}
          <View style={styles.dayHeaders}>
            {DAY_LABELS.map((d, i) => (
              <Text key={i} style={[styles.dayHeader, { width: CELL_SIZE }]}>{d}</Text>
            ))}
          </View>
        </View>

        {/* Calendar grid */}
        <View style={styles.calendarGrid}>
          {cells.map((cell, i) => renderCell(cell, i))}
        </View>

        {/* Divider */}
        <View style={styles.divider} />

        {/* Selected day section */}
        {selectedDate ? (
          <Animated.View entering={FadeIn.duration(200)} style={styles.daySection}>
            <View style={styles.daySectionHeader}>
              <View>
                <Text style={styles.daySectionDate}>{formatDisplayDate(selectedDate)}</Text>
                <Text style={styles.daySectionCount}>
                  {loadingDay
                    ? 'Loading…'
                    : dayPhotos.length > 0
                      ? `${dayPhotos.length} photo${dayPhotos.length > 1 ? 's' : ''}`
                      : 'No photos'}
                </Text>
              </View>
            </View>

            {dayPhotos.length > 0 ? (
              <FlatList
                data={dayPhotos}
                keyExtractor={item => item.id.toString()}
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.photoStrip}
                scrollEnabled
                renderItem={({ item, index }) => (
                  <Animated.View entering={FadeInDown.delay(index * 50)}>
                    <Pressable onPress={() => openViewer(index)} style={styles.stripCard}>
                      <Image
                        source={{ uri: item.file_path }}
                        style={styles.stripPhoto}
                        resizeMode="cover"
                      />
                      <View style={styles.stripMeta}>
                        <Text style={styles.stripPose} numberOfLines={1}>
                          {item.pose_icon} {item.pose_name}
                        </Text>
                        <Text style={styles.stripTime}>{formatTime(item.captured_at)}</Text>
                      </View>
                    </Pressable>
                  </Animated.View>
                )}
              />
            ) : !loadingDay ? (
              <View style={styles.emptyDay}>
                <Text style={styles.emptyDayText}>No photos taken on this day.</Text>
              </View>
            ) : null}
          </Animated.View>
        ) : (
          <View style={styles.hint}>
            <Ionicons name="tap-outline" size={28} color={colors.textMuted} />
            <Text style={styles.hintText}>Tap a day to see your photos</Text>
          </View>
        )}
      </ScrollView>

      {/* Full-screen swipeable viewer */}
      <Modal
        visible={viewerIndex !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setViewerIndex(null)}
        statusBarTranslucent
      >
        <View style={styles.viewer}>
          {/* Close */}
          <Pressable style={styles.viewerClose} onPress={() => setViewerIndex(null)}>
            <Ionicons name="close" size={26} color={colors.text} />
          </Pressable>

          {/* Photo count indicator */}
          {viewerIndex !== null && (
            <View style={styles.viewerCounter}>
              <Text style={styles.viewerCounterText}>
                {viewerIndex + 1} / {dayPhotos.length}
              </Text>
            </View>
          )}

          <FlatList
            ref={viewerRef}
            data={dayPhotos}
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
                <View style={styles.viewerCaption}>
                  <Text style={styles.viewerPose}>
                    {item.pose_icon} {item.pose_name}
                  </Text>
                  <Text style={styles.viewerDate}>
                    {formatDisplayDate(selectedDate)} · {formatTime(item.captured_at)}
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
  scroll: {
    paddingBottom: 120,
  },

  // ─── Sticky header ───────────────────────────────────────
  stickyHeader: {
    backgroundColor: colors.background,
    paddingBottom: spacing.xs,
    borderBottomWidth: 1,
    borderBottomColor: colors.cardBorder,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: Platform.OS === 'ios' ? 60 : 40,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
  },
  title: {
    ...typography.title,
  },
  todayBtn: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.full,
    backgroundColor: colors.surfaceLight,
    borderWidth: 1,
    borderColor: colors.glassBorder,
  },
  todayBtnText: {
    ...typography.bodySmall,
    color: colors.primary,
    fontWeight: '600',
  },

  // ─── Month nav ───────────────────────────────────────────
  monthNav: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  navBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.surfaceLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  monthLabel: {
    ...typography.heading,
    fontSize: 18,
  },

  // ─── Day headers ─────────────────────────────────────────
  dayHeaders: {
    flexDirection: 'row',
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.xs,
  },
  dayHeader: {
    textAlign: 'center',
    ...typography.caption,
    color: colors.textMuted,
    fontSize: 11,
  },

  // ─── Calendar grid ───────────────────────────────────────
  calendarGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
  },
  cell: {
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.sm,
    paddingVertical: 4,
  },
  cellSelected: {
    backgroundColor: colors.primary,
    borderRadius: radius.sm,
  },
  cellToday: {
    borderWidth: 1,
    borderColor: colors.primary,
    borderRadius: radius.sm,
  },
  cellText: {
    fontSize: 14,
    fontWeight: '500',
    color: colors.text,
  },
  cellTextSelected: {
    color: '#fff',
    fontWeight: '700',
  },
  cellTextToday: {
    color: colors.primary,
    fontWeight: '700',
  },
  dotRow: {
    flexDirection: 'row',
    gap: 2,
    marginTop: 2,
  },
  dot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.secondary,
  },
  dotSelected: {
    backgroundColor: 'rgba(255,255,255,0.8)',
  },

  // ─── Divider ─────────────────────────────────────────────
  divider: {
    height: 1,
    backgroundColor: colors.cardBorder,
    marginHorizontal: spacing.md,
    marginBottom: spacing.md,
  },

  // ─── Day section ─────────────────────────────────────────
  daySection: {
    paddingHorizontal: spacing.md,
  },
  daySectionHeader: {
    marginBottom: spacing.md,
  },
  daySectionDate: {
    ...typography.body,
    fontWeight: '600',
    color: colors.text,
  },
  daySectionCount: {
    ...typography.bodySmall,
    marginTop: 2,
    color: colors.primary,
  },

  // ─── Photo strip ─────────────────────────────────────────
  photoStrip: {
    gap: spacing.sm,
    paddingRight: spacing.md,
  },
  stripCard: {
    width: 130,
    borderRadius: radius.md,
    overflow: 'hidden',
    backgroundColor: colors.surface,
  },
  stripPhoto: {
    width: 130,
    height: 170,
  },
  stripMeta: {
    padding: spacing.xs,
    paddingHorizontal: spacing.sm,
  },
  stripPose: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.text,
  },
  stripTime: {
    fontSize: 10,
    color: colors.textMuted,
    marginTop: 1,
  },

  // ─── Empty / Hint ─────────────────────────────────────────
  emptyDay: {
    paddingVertical: spacing.xl,
    alignItems: 'center',
  },
  emptyDayText: {
    ...typography.bodySmall,
    color: colors.textMuted,
  },
  hint: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.xxl,
    gap: spacing.sm,
  },
  hintText: {
    ...typography.bodySmall,
    color: colors.textMuted,
  },

  // ─── Viewer ──────────────────────────────────────────────
  viewer: {
    flex: 1,
    backgroundColor: '#000',
    justifyContent: 'center',
  },
  viewerClose: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 56 : 36,
    right: spacing.md,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(255,255,255,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 20,
  },
  viewerCounter: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 60 : 40,
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
    height: SCREEN_HEIGHT,
    justifyContent: 'center',
    alignItems: 'center',
  },
  viewerImage: {
    width: SCREEN_WIDTH,
    height: SCREEN_HEIGHT * 0.78,
  },
  viewerCaption: {
    position: 'absolute',
    bottom: Platform.OS === 'ios' ? 60 : 40,
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: spacing.xl,
  },
  viewerPose: {
    ...typography.body,
    fontWeight: '600',
    textAlign: 'center',
  },
  viewerDate: {
    ...typography.bodySmall,
    textAlign: 'center',
    color: colors.textSecondary,
  },
});
