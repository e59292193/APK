import React from 'react';
import {
  StyleSheet,
  Text,
  View,
  ScrollView,
  TouchableOpacity,
  Vibration,
  StatusBar,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { typography, spacing, radius, shadows, THEME_LIST, useTheme } from '../theme';
import { AppHeader, Badge } from '../components/ui';

export default function ThemeSelectorScreen({ onBack }) {
  const insets = useSafeAreaInsets();
  const { theme, themeId, colors, setThemeId } = useTheme();

  const handleSelectTheme = (id) => {
    if (id === themeId) return;
    Vibration.vibrate(10);
    setThemeId(id);
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <StatusBar
        barStyle={theme.statusBarStyle || 'dark-content'}
        backgroundColor={colors.backgroundLavender}
      />
      <AppHeader
        title="主题换装"
        subtitle="随心切换专属清新配色，即选即生效"
        showBack
        onBack={onBack}
      />

      <ScrollView
        style={styles.flex}
        contentContainerStyle={[
          styles.scrollContent,
          { paddingBottom: insets.bottom + spacing[6] },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.introCard}>
          <View style={[styles.introIconWrap, { backgroundColor: colors.primary[100] }]}>
            <Ionicons name="color-palette-outline" size={24} color={colors.primaryAction} />
          </View>
          <View style={styles.introTextWrap}>
            <Text style={[styles.introTitle, { color: colors.textPrimary }]}>双人专属氛围感</Text>
            <Text style={[styles.introDesc, { color: colors.textSecondary }]}>
              换肤后全 App 界面即刻统一更新，重启应用自动保持
            </Text>
          </View>
        </View>

        <View style={styles.list}>
          {THEME_LIST.map((item) => {
            const isSelected = item.id === themeId;
            const tColors = item.colors;

            return (
              <TouchableOpacity
                key={item.id}
                style={[
                  styles.themeCard,
                  {
                    backgroundColor: colors.surface,
                    borderColor: isSelected ? colors.primaryAction : colors.border,
                    borderWidth: isSelected ? 2 : 1,
                  },
                ]}
                onPress={() => handleSelectTheme(item.id)}
                activeOpacity={0.85}
              >
                {/* 顶部标题与选中态 */}
                <View style={styles.cardHeader}>
                  <View style={styles.titleArea}>
                    <Text style={[styles.themeTitle, { color: colors.textPrimary }]}>
                      {item.name}
                    </Text>
                    <Text style={[styles.themeSubtitle, { color: colors.textSecondary }]}>
                      {item.subtitle}
                    </Text>
                  </View>
                  {isSelected ? (
                    <Badge variant="primary" size="md">
                      <Ionicons name="checkmark-circle" size={14} color="#FFFFFF" /> 使用中
                    </Badge>
                  ) : (
                    <View style={[styles.unselectedRadio, { borderColor: colors.borderStrong }]} />
                  )}
                </View>

                {/* 主题微缩预览模拟框 */}
                <View
                  style={[
                    styles.mockupContainer,
                    { backgroundColor: tColors.background, borderColor: tColors.border },
                  ]}
                >
                  {/* 模拟顶栏 */}
                  <View style={[styles.mockupHeader, { backgroundColor: tColors.backgroundLavender }]}>
                    <View style={[styles.mockupDot, { backgroundColor: tColors.primaryAction }]} />
                    <View style={[styles.mockupBar, { backgroundColor: tColors.border }]} />
                  </View>

                  {/* 模拟消息气泡 */}
                  <View style={styles.mockupBody}>
                    <View
                      style={[
                        styles.mockupBubbleMe,
                        { backgroundColor: tColors.primaryAction },
                      ]}
                    >
                      <Text style={styles.mockupBubbleTextMe}>今天吃什么？</Text>
                    </View>
                    <View
                      style={[
                        styles.mockupBubblePartner,
                        { backgroundColor: tColors.partnerSoft, borderColor: tColors.partner },
                      ]}
                    >
                      <Text style={[styles.mockupBubbleTextPartner, { color: tColors.partner }]}>
                        去 momi 厨房看看吧~
                      </Text>
                    </View>
                  </View>

                  {/* 色板色块条 */}
                  <View style={styles.paletteRow}>
                    <View style={[styles.swatch, { backgroundColor: tColors.primaryAction }]} />
                    <View style={[styles.swatch, { backgroundColor: tColors.primary[300] }]} />
                    <View style={[styles.swatch, { backgroundColor: tColors.partner }]} />
                    <View style={[styles.swatch, { backgroundColor: tColors.partnerSoft }]} />
                    <View style={[styles.swatch, { backgroundColor: tColors.surfaceSoft }]} />
                  </View>
                </View>
              </TouchableOpacity>
            );
          })}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  container: { flex: 1 },
  scrollContent: { padding: spacing[4] },
  introCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing[3],
    borderRadius: radius.lg,
    marginBottom: spacing[4],
    backgroundColor: 'transparent',
  },
  introIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing[3],
  },
  introTextWrap: { flex: 1 },
  introTitle: { ...typography.sectionTitle, fontSize: 16 },
  introDesc: { ...typography.caption, marginTop: 2 },
  list: { gap: spacing[4] },
  themeCard: {
    borderRadius: radius.xl,
    padding: spacing[4],
    ...shadows.sm,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing[3],
  },
  titleArea: { flex: 1 },
  themeTitle: { ...typography.cardTitle, fontSize: 17 },
  themeSubtitle: { ...typography.caption, marginTop: 2 },
  unselectedRadio: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 1.5,
  },
  mockupContainer: {
    borderRadius: radius.md,
    borderWidth: 1,
    overflow: 'hidden',
    padding: spacing[2],
  },
  mockupHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing[2],
    paddingVertical: 6,
    borderRadius: radius.sm,
    marginBottom: spacing[2],
  },
  mockupDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: spacing[2],
  },
  mockupBar: {
    width: 48,
    height: 6,
    borderRadius: 3,
  },
  mockupBody: {
    paddingHorizontal: spacing[1],
    marginBottom: spacing[2],
    gap: 6,
  },
  mockupBubbleMe: {
    alignSelf: 'flex-end',
    paddingHorizontal: spacing[3],
    paddingVertical: 4,
    borderRadius: radius.sm,
  },
  mockupBubbleTextMe: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '500',
  },
  mockupBubblePartner: {
    alignSelf: 'flex-start',
    paddingHorizontal: spacing[3],
    paddingVertical: 4,
    borderRadius: radius.sm,
    borderWidth: StyleSheet.hairlineWidth,
  },
  mockupBubbleTextPartner: {
    fontSize: 11,
    fontWeight: '500',
  },
  paletteRow: {
    flexDirection: 'row',
    gap: 6,
    paddingTop: 4,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(0,0,0,0.05)',
  },
  swatch: {
    flex: 1,
    height: 14,
    borderRadius: 3,
  },
});
