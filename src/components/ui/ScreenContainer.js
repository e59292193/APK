import React from 'react';
import { View, ScrollView, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, spacing, layout, useTheme } from '../../theme';

export function ScreenContainer({
  children,
  scrollable = false,
  padding = true,
  bottomPadding = layout.listBottomPadding,
  showBottomInset = false,
  style,
  contentContainerStyle,
}) {
  const insets = useSafeAreaInsets();
  const { colors: currentColors = colors } = useTheme();

  if (scrollable) {
    return (
      <ScrollView
        style={[{ backgroundColor: currentColors.background }, styles.scroll, style]}
        contentContainerStyle={[
          styles.scrollContent,
          padding && { paddingHorizontal: spacing[5] },
          { paddingBottom: bottomPadding + (showBottomInset ? insets.bottom : 0) },
          contentContainerStyle,
        ]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {children}
      </ScrollView>
    );
  }

  return (
    <View
      style={[
        { backgroundColor: currentColors.background },
        styles.view,
        padding && { paddingHorizontal: spacing[5] },
        showBottomInset && { paddingBottom: insets.bottom },
        style,
      ]}
    >
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: colors.background },
  scrollContent: { paddingTop: spacing[4] },
  view: { flex: 1, backgroundColor: colors.background },
});

export default ScreenContainer;
