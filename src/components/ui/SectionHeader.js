import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { typography, spacing, useTheme } from '../../theme';

export function SectionHeader({ title, subtitle, rightAction, icon, style }) {
  const { colors } = useTheme(); const styles = useMemo(() => createStyles(colors), [colors]);
  return <View style={[styles.container, style]}><View style={styles.left}>{icon ? <Ionicons name={icon} size={20} color={colors.primary} style={styles.icon} /> : null}<View>{title ? <Text style={[typography.sectionTitle, styles.title]}>{title}</Text> : null}{subtitle ? <Text style={[typography.caption, styles.subtitle]}>{subtitle}</Text> : null}</View></View>{rightAction}</View>;
}
const createStyles = (c) => StyleSheet.create({ container: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing[3], marginTop: spacing[2] }, left: { flexDirection: 'row', alignItems: 'center', flex: 1 }, icon: { marginRight: spacing[2] }, title: { color: c.text }, subtitle: { color: c.textSecondary, marginTop: 2 } });
export default SectionHeader;
