/**
 * TabNavigator — Bottom tab navigation with nested stacks
 * 
 * Three tabs: Camera, Poses (with nested stack), Settings
 */

import React from 'react';
import { StyleSheet } from 'react-native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';

import CameraScreen from '../screens/CameraScreen';
import CaptureScreen from '../screens/CaptureScreen';
import PosesScreen from '../screens/PosesScreen';
import TimelineScreen from '../screens/TimelineScreen';
import CompareScreen from '../screens/CompareScreen';
import SettingsScreen from '../screens/SettingsScreen';
import CalendarTimelineScreen from '../screens/CalendarTimelineScreen';
import { colors } from '../theme/theme';

const Tab = createBottomTabNavigator();
const PosesStack = createNativeStackNavigator();

/**
 * Nested stack navigator for Poses tab
 * Poses → Timeline → Compare
 */
function PosesStackNavigator() {
  return (
    <PosesStack.Navigator
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors.background },
        animation: 'slide_from_right',
      }}
    >
      <PosesStack.Screen name="PosesList" component={PosesScreen} />
      <PosesStack.Screen name="Timeline" component={TimelineScreen} />
      <PosesStack.Screen name="Compare" component={CompareScreen} />
    </PosesStack.Navigator>
  );
}

export default function TabNavigator({ onRequestOnboarding }) {
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarIcon: ({ focused, color, size }) => {
          let iconName;
          if (route.name === 'CameraTab') {
            iconName = focused ? 'camera' : 'camera-outline';
          } else if (route.name === 'GhostTab') {
            iconName = focused ? 'scan-circle' : 'scan-circle-outline';
          } else if (route.name === 'PosesTab') {
            iconName = focused ? 'grid' : 'grid-outline';
          } else if (route.name === 'CalendarTab') {
            iconName = focused ? 'calendar' : 'calendar-outline';
          } else if (route.name === 'SettingsTab') {
            iconName = focused ? 'settings' : 'settings-outline';
          }
          return <Ionicons name={iconName} size={size} color={color} />;
        },
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textMuted,
        tabBarStyle: styles.tabBar,
        tabBarLabelStyle: styles.tabLabel,
        tabBarItemStyle: styles.tabItem,
      })}
    >
      <Tab.Screen
        name="CameraTab"
        component={CameraScreen}
        options={{ tabBarLabel: 'Camera' }}
      />
      <Tab.Screen
        name="GhostTab"
        component={CaptureScreen}
        options={{ tabBarLabel: 'Ghost' }}
      />
      <Tab.Screen
        name="PosesTab"
        component={PosesStackNavigator}
        options={{ tabBarLabel: 'Poses' }}
      />
      <Tab.Screen
        name="CalendarTab"
        component={CalendarTimelineScreen}
        options={{ tabBarLabel: 'Timeline' }}
      />
      <Tab.Screen
        name="SettingsTab"
        options={{ tabBarLabel: 'Settings' }}
      >
        {() => <SettingsScreen onRequestOnboarding={onRequestOnboarding} />}
      </Tab.Screen>
    </Tab.Navigator>
  );
}

const styles = StyleSheet.create({
  tabBar: {
    backgroundColor: 'rgba(10, 10, 15, 0.92)',
    borderTopWidth: 1,
    borderTopColor: colors.cardBorder,
    height: 88,
    paddingTop: 8,
    paddingBottom: 28,
    position: 'absolute',
    elevation: 0,
  },
  tabLabel: {
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.3,
  },
  tabItem: {
    paddingTop: 4,
  },
});
