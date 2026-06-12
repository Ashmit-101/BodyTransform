/**
 * BodyTransform — Root Application
 * 
 * Initializes the database and wraps everything in the navigation container.
 */

import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, StatusBar } from 'react-native';
import { NavigationContainer, DarkTheme } from '@react-navigation/native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import TabNavigator from './src/navigation/TabNavigator';
import { getBooleanAppSetting, initDatabase, setAppSetting } from './src/database/db';
import { ensurePhotosDir } from './src/utils/storage';
import { colors, typography } from './src/theme/theme';
import OnboardingScreen from './src/screens/OnboardingScreen';

// Custom dark navigation theme
const navTheme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    background: colors.background,
    card: colors.surface,
    text: colors.text,
    border: colors.cardBorder,
    primary: colors.primary,
  },
};

export default function App() {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState(null);
  const [showOnboarding, setShowOnboarding] = useState(false);

  useEffect(() => {
    async function init() {
      try {
        await initDatabase();
        await ensurePhotosDir();
        const onboardingComplete = await getBooleanAppSetting('onboarding_completed', false);
        setShowOnboarding(!onboardingComplete);
        setReady(true);
      } catch (err) {
        console.error('Initialization failed:', err);
        setError(err.message);
      }
    }
    init();
  }, []);

  if (error) {
    return (
      <View style={styles.centered}>
        <StatusBar barStyle="light-content" />
        <Text style={styles.errorIcon}>⚠️</Text>
        <Text style={styles.errorTitle}>Failed to Initialize</Text>
        <Text style={styles.errorMessage}>{error}</Text>
      </View>
    );
  }

  if (!ready) {
    return (
      <View style={styles.centered}>
        <StatusBar barStyle="light-content" />
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={styles.loadingText}>Setting up BodyTransform…</Text>
      </View>
    );
  }

  return (
    <GestureHandlerRootView style={styles.root}>
      <StatusBar barStyle="light-content" backgroundColor={colors.background} />
      <NavigationContainer theme={navTheme}>
        {showOnboarding ? (
          <OnboardingScreen
            onFinish={async () => {
              await setAppSetting('onboarding_completed', true);
              setShowOnboarding(false);
            }}
          />
        ) : (
          <TabNavigator onRequestOnboarding={() => setShowOnboarding(true)} />
        )}
      </NavigationContainer>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.background,
  },
  centered: {
    flex: 1,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  loadingText: {
    ...typography.bodySmall,
    marginTop: 16,
  },
  errorIcon: {
    fontSize: 48,
    marginBottom: 16,
  },
  errorTitle: {
    ...typography.heading,
    marginBottom: 8,
  },
  errorMessage: {
    ...typography.bodySmall,
    textAlign: 'center',
    lineHeight: 22,
  },
});
