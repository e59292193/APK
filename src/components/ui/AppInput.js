import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, typography, radius, spacing } from '../../theme';

export function AppInput({
  label,
  placeholder,
  value,
  onChangeText,
  error,
  secureTextEntry = false,
  multiline = false,
  maxLength,
  style,
  inputStyle,
  ...rest
}) {
  const [showPassword, setShowPassword] = useState(false);
  const isPassword = secureTextEntry;
  const hideText = isPassword && !showPassword;

  return (
    <View style={[styles.container, style]}>
      {label && <Text style={[typography.label, styles.label]}>{label}</Text>}
      <View style={[styles.inputWrap, error && styles.inputWrapError, multiline && styles.inputWrapMultiline]}>
        <TextInput
          style={[typography.body, styles.input, multiline && styles.inputMultiline, inputStyle]}
          placeholder={placeholder}
          placeholderTextColor={colors.textMuted}
          value={value}
          onChangeText={onChangeText}
          secureTextEntry={hideText}
          multiline={multiline}
          maxLength={maxLength}
          {...rest}
        />
        {isPassword && (
          <TouchableOpacity
            onPress={() => setShowPassword((v) => !v)}
            style={styles.eyeBtn}
            accessibilityLabel={showPassword ? '隐藏密码' : '显示密码'}
            accessibilityRole="button"
          >
            <Ionicons name={showPassword ? 'eye-off-outline' : 'eye-outline'} size={20} color={colors.textSecondary} />
          </TouchableOpacity>
        )}
      </View>
      {error && <Text style={[typography.caption, styles.errorText]}>{error}</Text>}
      {maxLength && !error && (
        <Text style={[typography.label, styles.countText]}>
          {(value || '').length}/{maxLength}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { marginBottom: spacing[3] },
  label: { color: colors.textSecondary, marginBottom: spacing[1] },
  inputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.primary[50],
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing[4],
  },
  inputWrapError: { borderColor: colors.error, backgroundColor: colors.errorSoft },
  inputWrapMultiline: { alignItems: 'flex-start', paddingVertical: spacing[3] },
  input: { flex: 1, paddingVertical: spacing[3], color: colors.textPrimary },
  inputMultiline: { minHeight: 80, textAlignVertical: 'top' },
  eyeBtn: { padding: spacing[2] },
  errorText: { color: colors.error, marginTop: spacing[1] },
  countText: { color: colors.textMuted, marginTop: spacing[1], textAlign: 'right' },
});

export default AppInput;
